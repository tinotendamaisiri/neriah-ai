// src/services/syncManager.ts
// Network-aware sync orchestrator.
//
// useNetworkStatus() → { isOnline, pendingActions }
//   isOnline       — whether the device has internet
//   pendingActions — total items in both the scan queue and the action queue
//
// syncAll() — process both queues immediately (call on app foreground or manual pull).

import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import {
  getQueueLength,
  getActionQueueLength,
  processActionQueue,
  replayQueue,
} from './offlineQueue';

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Subscribe to network state and pending queue counts.
 * Automatically processes queued actions when connectivity is restored.
 */
export function useNetworkStatus(): { isOnline: boolean; pendingActions: number } {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingActions, setPendingActions] = useState(0);

  useEffect(() => {
    let wasOffline = false;

    const refreshPending = async () => {
      const [scans, actions] = await Promise.all([getQueueLength(), getActionQueueLength()]);
      setPendingActions(scans + actions);
    };

    // Initial state
    NetInfo.fetch().then(state => {
      setIsOnline(state.isConnected ?? true);
    });
    refreshPending();

    const unsubscribe = NetInfo.addEventListener(state => {
      const connected = state.isConnected ?? true;
      setIsOnline(connected);

      if (!connected) {
        wasOffline = true;
      } else if (wasOffline) {
        wasOffline = false;
        // Back online — sync everything, then refresh count
        syncAll().finally(refreshPending);
      }

      refreshPending();
    });

    return unsubscribe;
  }, []);

  return { isOnline, pendingActions };
}

// ── Sync function ─────────────────────────────────────────────────────────────

/**
 * Process both queues (scans + approval actions).
 * Safe to call any time — returns a summary of what happened.
 */
export async function syncAll(): Promise<{ scansSubmitted: number; actionsProcessed: number; failed: number }> {
  const [scanResult, actionResult] = await Promise.allSettled([
    replayQueue(),
    processActionQueue(),
  ]);

  const scansSubmitted = scanResult.status === 'fulfilled' ? scanResult.value.submitted : 0;
  const actionsProcessed = actionResult.status === 'fulfilled' ? actionResult.value.success : 0;
  const failed =
    (scanResult.status === 'fulfilled' ? scanResult.value.failed : 0) +
    (actionResult.status === 'fulfilled' ? actionResult.value.failed : 0);

  return { scansSubmitted, actionsProcessed, failed };
}
