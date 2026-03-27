// src/services/offlineQueue.ts
// Offline scan queue backed by AsyncStorage.
// When the device has no network, scans are queued locally and replayed when connectivity returns.
// Uses NetInfo to detect connectivity changes.

import AsyncStorage from '@react-native-async-storage/async-storage';
// TODO: import NetInfo from '@react-native-community/netinfo' once installed

const QUEUE_KEY = 'neriah_offline_queue';

export interface QueuedScan {
  id: string;               // local UUID assigned at capture time
  image_uri: string;        // local file URI
  student_id: string;
  answer_key_id: string;
  queued_at: string;        // ISO timestamp
  retry_count: number;
}

// ── Queue operations ──────────────────────────────────────────────────────────

export const enqueue = async (scan: Omit<QueuedScan, 'id' | 'queued_at' | 'retry_count'>): Promise<void> => {
  // TODO: implement — read current queue, append new item, write back
  const queue = await getQueue();
  const item: QueuedScan = {
    ...scan,
    id: `${Date.now()}-${Math.random()}`,
    queued_at: new Date().toISOString(),
    retry_count: 0,
  };
  queue.push(item);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
};

export const getQueue = async (): Promise<QueuedScan[]> => {
  // TODO: implement — parse JSON from AsyncStorage, return empty array on miss/error
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedScan[];
  } catch {
    return [];
  }
};

export const removeFromQueue = async (id: string): Promise<void> => {
  // TODO: implement — filter out the item with the given id and write back
  const queue = await getQueue();
  const updated = queue.filter((item) => item.id !== id);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
};

export const clearQueue = async (): Promise<void> => {
  // TODO: implement — used after a successful batch replay
  await AsyncStorage.removeItem(QUEUE_KEY);
};

// ── Replay ────────────────────────────────────────────────────────────────────

export const replayQueue = async (): Promise<void> => {
  /**
   * Attempt to submit all queued scans to the backend.
   * Called when network connectivity is restored.
   * Failed items are left in the queue with retry_count incremented.
   * Items with retry_count >= 3 are moved to a dead-letter list and not retried.
   * TODO: implement using submitMark from api.ts
   * TODO: add exponential backoff between retries
   * TODO: notify user of failed items via toast/notification
   */
  const queue = await getQueue();
  if (queue.length === 0) return;

  for (const item of queue) {
    if (item.retry_count >= 3) {
      // TODO: move to dead letter, do not retry
      continue;
    }
    try {
      // TODO: call submitMark(item) → on success, removeFromQueue(item.id)
      // TODO: on failure, increment retry_count and update queue
    } catch {
      // TODO: increment retry_count
    }
  }
};

// ── Network listener ──────────────────────────────────────────────────────────

export const startNetworkListener = (): (() => void) => {
  /**
   * Start watching for network connectivity changes.
   * When connectivity is restored, call replayQueue().
   * Returns an unsubscribe function — call it in useEffect cleanup.
   * TODO: implement using NetInfo.addEventListener
   */
  // TODO: implement
  return () => {}; // placeholder unsubscribe
};
