// src/services/offlineQueue.ts
// Offline scan queue backed by AsyncStorage.
// When the device loses connectivity, scans are queued locally.
// When connectivity is restored, replayQueue() re-submits them.
//
// Queue schema v2 (2026-04-22): scans store an array of page URIs instead
// of a single image_uri, matching the multi-page /mark backend contract.
// Legacy v1 items (single image_uri) from pre-multi builds are FLUSHED on
// app startup by migrateQueueIfNeeded() — the scans are lost, teacher
// re-scans.

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { submitTeacherScan } from './api';

const QUEUE_KEY = 'neriah_offline_queue';
const DEAD_LETTER_KEY = 'neriah_offline_dead_letter';
const QUEUE_VERSION_KEY = 'neriah_offline_queue_version';
const QUEUE_VERSION = 2;
const MAX_RETRIES = 3;

export interface QueuedScan {
  id: string;
  /** 1-5 page URIs in order. */
  pages: { uri: string }[];
  teacher_id: string;
  student_id: string;
  class_id: string;
  answer_key_id: string;
  education_level: string;
  queued_at: string;
  retry_count: number;
}

/**
 * Flush the queue once on first launch of a build running schema v2.
 * v1 items (single image_uri) can't be safely upgraded — the file URIs
 * may no longer exist on disk, and the mental model is different. So we
 * drop them and log the count. Teacher re-scans.
 *
 * Call this once on app startup, before any replay.
 */
export const migrateQueueIfNeeded = async (): Promise<{ flushed: number }> => {
  let flushed = 0;
  try {
    const rawVersion = await AsyncStorage.getItem(QUEUE_VERSION_KEY);
    const currentVersion = rawVersion ? parseInt(rawVersion, 10) : 1;
    if (currentVersion >= QUEUE_VERSION) return { flushed: 0 };

    // Stored at v1 (or missing entirely) — count + drop.
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        flushed = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        // Corrupted — treat as drop-and-reset.
        flushed = 0;
      }
      await AsyncStorage.removeItem(QUEUE_KEY);
    }
    await AsyncStorage.setItem(QUEUE_VERSION_KEY, String(QUEUE_VERSION));
    if (flushed > 0) {
      // Visible in Flipper / adb logcat for post-deploy impact checks.
      console.warn(`[offlineQueue] v1→v2 migration flushed ${flushed} pre-multi queued scan(s)`);
    }
  } catch {
    // Best-effort — don't crash app startup over this.
  }
  return { flushed };
};

// ── Queue operations ──────────────────────────────────────────────────────────

export const enqueue = async (
  scan: Omit<QueuedScan, 'id' | 'queued_at' | 'retry_count'>,
): Promise<void> => {
  const queue = await getQueue();
  queue.push({
    ...scan,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    queued_at: new Date().toISOString(),
    retry_count: 0,
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
};

export const getQueue = async (): Promise<QueuedScan[]> => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedScan[]) : [];
  } catch {
    return [];
  }
};

export const getQueueLength = async (): Promise<number> => {
  const q = await getQueue();
  return q.length;
};

const _saveQueue = (queue: QueuedScan[]) =>
  AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

export const removeFromQueue = async (id: string): Promise<void> => {
  const queue = await getQueue();
  await _saveQueue(queue.filter((item) => item.id !== id));
};

export const clearQueue = async (): Promise<void> => {
  await AsyncStorage.removeItem(QUEUE_KEY);
};

// ── Dead letter ───────────────────────────────────────────────────────────────

const _moveToDeadLetter = async (item: QueuedScan, reason: string): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(DEAD_LETTER_KEY);
    const dead: Array<QueuedScan & { failed_at: string; reason: string }> = raw
      ? JSON.parse(raw)
      : [];
    dead.push({ ...item, failed_at: new Date().toISOString(), reason });
    await AsyncStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(dead));
  } catch {
    // Best-effort
  }
};

// ── Replay ────────────────────────────────────────────────────────────────────

/**
 * Attempt to re-submit all queued scans.
 * Called automatically when network connectivity is restored.
 * Items that fail permanently (retry_count >= MAX_RETRIES) are moved to dead letter.
 */
export const replayQueue = async (): Promise<{ submitted: number; failed: number }> => {
  const queue = await getQueue();
  if (queue.length === 0) return { submitted: 0, failed: 0 };

  let submitted = 0;
  let failed = 0;
  const remaining: QueuedScan[] = [];

  for (const item of queue) {
    if (item.retry_count >= MAX_RETRIES) {
      await _moveToDeadLetter(item, 'Max retries exceeded');
      failed++;
      continue;
    }

    try {
      await submitTeacherScan({
        teacherId: item.teacher_id,
        studentId: item.student_id,
        classId: item.class_id,
        answerKeyId: item.answer_key_id,
        educationLevel: item.education_level,
        pages: item.pages,
      });
      submitted++;
      // Successfully submitted — do not add back to remaining
    } catch (err: any) {
      const status: number = err.response?.status ?? 0;
      // 4xx client errors won't succeed on retry — move to dead letter
      if (status >= 400 && status < 500) {
        await _moveToDeadLetter(item, `Client error ${status}`);
        failed++;
      } else {
        // Network/server error — increment retry and keep in queue
        remaining.push({ ...item, retry_count: item.retry_count + 1 });
      }
    }
  }

  await _saveQueue(remaining);
  return { submitted, failed };
};

// ── Network listener ──────────────────────────────────────────────────────────

/**
 * Start watching for connectivity changes.
 * When the connection is restored, replayQueue() is called automatically.
 * Returns an unsubscribe function — call it in your useEffect cleanup.
 */
export const startNetworkListener = (): (() => void) => {
  let wasOffline = false;

  const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const isConnected = state.isConnected ?? false;
    if (!isConnected) {
      wasOffline = true;
    } else if (wasOffline && isConnected) {
      wasOffline = false;
      replayQueue().catch(() => {
        // Replay is best-effort; errors are non-critical
      });
    }
  });

  return unsubscribe;
};
