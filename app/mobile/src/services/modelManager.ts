// src/services/modelManager.ts
// On-device model download manager.
//
// Downloads Gemma 4 task files from GCS into the device's document directory.
// Supports pause / resume across app restarts via AsyncStorage savable state.
//
// Models live at: gs://neriah-scans/models/
//   Student (E2B): gemma-4-e2b-it.task  — 2.5 GB
//   Teacher (E4B): gemma-4-e4b-it.task  — 3.5 GB
//
// Files are stored outside the app bundle so they survive app updates.

import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModelVariant = 'e2b' | 'e4b';

// ── SecureStore / AsyncStorage keys ──────────────────────────────────────────

export const MODEL_DOWNLOADED_KEY       = 'model_downloaded';
export const DOWNLOAD_PROMPTED_KEY      = 'model_download_prompted';
export const WIFI_ONLY_KEY              = 'wifi_only_downloads';
export const WIFI_NUDGE_LAST_DATE_KEY   = 'neriah_wifi_nudge_last_date';
export const WIFI_NUDGE_NEVER_KEY       = 'neriah_wifi_nudge_never';
const RESUMABLE_KEY                     = 'model_download_savable';

// ── Constants ─────────────────────────────────────────────────────────────────

const GCS_BASE = 'https://storage.googleapis.com/neriah-scans/models';

export const MODEL_DIR = `${FileSystem.documentDirectory ?? ''}models/`;

export const MODEL_PATHS: Record<ModelVariant, string> = {
  e2b: `${MODEL_DIR}gemma-4-e2b-it.task`,
  e4b: `${MODEL_DIR}gemma-4-e4b-it.task`,
};

const GCS_URLS: Record<ModelVariant, string> = {
  e2b: `${GCS_BASE}/gemma-4-e2b-it.task`,
  e4b: `${GCS_BASE}/gemma-4-e4b-it.task`,
};

export const MODEL_SIZES_BYTES: Record<ModelVariant, number> = {
  e2b: 2_500_000_000,
  e4b: 3_500_000_000,
};

export const MODEL_SIZE_LABEL: Record<ModelVariant, string> = {
  e2b: '2.5 GB',
  e4b: '3.5 GB',
};

export const MODEL_DISPLAY_NAME: Record<ModelVariant, string> = {
  e2b: 'Gemma 4 E2B — Student AI',
  e4b: 'Gemma 4 E4B — Teacher AI',
};

// ── Module-level singleton download instance ──────────────────────────────────

let _active: FileSystem.DownloadResumable | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function ensureModelDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODEL_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
  }
}

/** True if the model file exists on disk and is larger than 1 MB (sanity check). */
export async function isModelOnDisk(variant: ModelVariant): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(MODEL_PATHS[variant]);
    return info.exists && ((info as any).size ?? 0) > 1_000_000;
  } catch {
    return false;
  }
}

/** True if the download is currently active (not paused or idle). */
export function isDownloadActive(): boolean {
  return _active !== null;
}

// ── Download ──────────────────────────────────────────────────────────────────

/**
 * Start (or resume) downloading the model file.
 *
 * Checks AsyncStorage for a saved pause-state first — if found, the download
 * resumes from where it left off. Otherwise starts fresh from GCS.
 *
 * @param variant    Which model to download ('e2b' or 'e4b').
 * @param onProgress Called with 0–100 as bytes are written.
 * @param onComplete Called with no args when the file is fully downloaded.
 * @param onError    Called with a message on unrecoverable failure.
 */
export async function startDownload(
  variant: ModelVariant,
  onProgress: (pct: number) => void,
  onComplete: () => void,
  onError: (msg: string) => void,
): Promise<void> {
  await ensureModelDir();

  const dest = MODEL_PATHS[variant];
  const url  = GCS_URLS[variant];
  const size = MODEL_SIZES_BYTES[variant];

  const progressCallback = ({
    totalBytesWritten,
    totalBytesExpectedToWrite,
  }: FileSystem.DownloadProgressData) => {
    const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : size;
    onProgress(Math.min(99, Math.round((totalBytesWritten / total) * 100)));
  };

  // ── Resume if a savable exists ────────────────────────────────────────────
  const savableRaw = await AsyncStorage.getItem(RESUMABLE_KEY).catch(() => null);
  if (savableRaw) {
    try {
      const savable: FileSystem.DownloadPauseState = JSON.parse(savableRaw);
      if (savable?.resumeData) {
        _active = new FileSystem.DownloadResumable(
          savable.url ?? url,
          savable.fileUri ?? dest,
          savable.options ?? {},
          progressCallback,
          savable.resumeData,
        );
        await _run(variant, onProgress, onComplete, onError);
        return;
      }
    } catch {
      // Corrupted savable — fall through to fresh download
      await AsyncStorage.removeItem(RESUMABLE_KEY).catch(() => {});
    }
  }

  // ── Fresh download ────────────────────────────────────────────────────────
  _active = FileSystem.createDownloadResumable(url, dest, {}, progressCallback);
  await _run(variant, onProgress, onComplete, onError);
}

async function _run(
  variant: ModelVariant,
  onProgress: (pct: number) => void,
  onComplete: () => void,
  onError: (msg: string) => void,
): Promise<void> {
  if (!_active) return;
  try {
    const result = await _active.downloadAsync();
    _active = null;
    if (result?.uri) {
      await AsyncStorage.removeItem(RESUMABLE_KEY).catch(() => {});
      await SecureStore.setItemAsync(MODEL_DOWNLOADED_KEY, 'true');
      onProgress(100);
      onComplete();
    } else {
      onError('Download finished but no file path was returned.');
    }
  } catch (err: any) {
    _active = null;
    const msg: string = err?.message ?? String(err);
    // Pause/cancel throws — not a real error.
    if (msg.includes('cancelled') || msg.includes('paused')) return;
    onError(msg);
  }
}

// ── Pause ─────────────────────────────────────────────────────────────────────

/**
 * Pause an active download. Saves the resume state to AsyncStorage so the
 * download can be resumed after the app is restarted.
 */
export async function pauseDownload(): Promise<void> {
  if (!_active) return;
  try {
    const savable = await _active.pauseAsync();
    _active = null;
    if (savable) {
      await AsyncStorage.setItem(RESUMABLE_KEY, JSON.stringify(savable)).catch(() => {});
    }
  } catch {
    _active = null;
  }
}

// ── Cancel ────────────────────────────────────────────────────────────────────

/** Cancel the download and delete any partial file. */
export async function cancelDownload(variant: ModelVariant): Promise<void> {
  if (_active) {
    try { await _active.pauseAsync(); } catch {}
    _active = null;
  }
  await AsyncStorage.removeItem(RESUMABLE_KEY).catch(() => {});
  try {
    const info = await FileSystem.getInfoAsync(MODEL_PATHS[variant]);
    if (info.exists) {
      await FileSystem.deleteAsync(MODEL_PATHS[variant], { idempotent: true });
    }
  } catch {}
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Delete a downloaded model to free device storage. Clears the SecureStore flag. */
export async function deleteModelFile(variant: ModelVariant): Promise<void> {
  if (_active) {
    try { await _active.pauseAsync(); } catch {}
    _active = null;
  }
  await AsyncStorage.removeItem(RESUMABLE_KEY).catch(() => {});
  try {
    const info = await FileSystem.getInfoAsync(MODEL_PATHS[variant]);
    if (info.exists) {
      await FileSystem.deleteAsync(MODEL_PATHS[variant], { idempotent: true });
    }
  } catch {}
  await SecureStore.deleteItemAsync(MODEL_DOWNLOADED_KEY).catch(() => {});
}
