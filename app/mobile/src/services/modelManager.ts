// src/services/modelManager.ts
// On-device model lifecycle — download + cache management.
//
// Hosts the resumable download state machine (ported from the pre-LiteRT-LM
// implementation). react-native-litert-lm's own download API has no resume
// support, so we download the .litertlm file ourselves via expo-file-system's
// createDownloadResumable (which can survive network drops and app restarts
// via an AsyncStorage-persisted DownloadPauseState) and hand the completed
// local path to the library's native loadModel.
//
// Public API:
//   ensureModelDownloaded(variant, onProgress) — resolves to the local path;
//     resumes from savable state on retry.
//   pauseDownload() — pauses the in-flight download and saves state.
//   cancelDownload(variant) — cancels + removes savable + deletes partial.
//   deleteModelFile(variant) — deletes a completed file and clears flags.
//     Callers should separately call litert.unloadModel() to release the
//     native session (this module does NOT import litert to avoid a
//     circular dep; litert imports ensureModelDownloaded from here).
//   isModelOnDisk(variant) — real file-size check on the cached file.
//
// Models served from the LiteRT community on HuggingFace:
//   Student (E2B): ~2.0 GB
//   Teacher (E4B): ~2.96 GB

import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModelVariant = 'e2b' | 'e4b';

// ── SecureStore keys (unchanged — ModelContext reads these directly) ─────────

export const MODEL_DOWNLOADED_KEY       = 'model_downloaded';
export const DOWNLOAD_PROMPTED_KEY      = 'model_download_prompted';
export const WIFI_ONLY_KEY              = 'wifi_only_downloads';
export const WIFI_NUDGE_LAST_DATE_KEY   = 'neriah_wifi_nudge_last_date';
export const WIFI_NUDGE_NEVER_KEY       = 'neriah_wifi_nudge_never';

/** Per-variant resumable snapshot key. */
function resumableKey(variant: ModelVariant): string {
  return `model_download_snapshot_${variant}`;
}

// ── Model URLs (LiteRT-LM community on HuggingFace) ──────────────────────────
// Same URLs the library ships as GEMMA_4_E2B_IT / GEMMA_4_E4B_IT constants;
// inlined so this module doesn't have to import from the native-binding-
// dependent react-native-litert-lm (which crashes at module-load in Expo Go).

export const MODEL_URLS: Record<ModelVariant, string> = {
  e2b: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm',
  e4b: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm',
};

// ── Local cache paths ─────────────────────────────────────────────────────────
// Files live under documentDirectory so they survive app updates (unlike
// Caches, which iOS can evict under storage pressure).

export const MODEL_DIR = `${FileSystem.documentDirectory ?? ''}models/`;

export const MODEL_PATHS: Record<ModelVariant, string> = {
  e2b: `${MODEL_DIR}gemma-4-E2B-it.litertlm`,
  e4b: `${MODEL_DIR}gemma-4-E4B-it.litertlm`,
};

// ── Display metadata (unchanged) ─────────────────────────────────────────────

export const MODEL_SIZES_BYTES: Record<ModelVariant, number> = {
  e2b: 2_000_000_000,   // ~2.0 GB
  e4b: 2_960_000_000,   // ~2.96 GB
};

export const MODEL_SIZE_LABEL: Record<ModelVariant, string> = {
  e2b: '2 GB',
  e4b: '3 GB',
};

export const MODEL_DISPLAY_NAME: Record<ModelVariant, string> = {
  e2b: 'Gemma 4 E2B — Student AI',
  e4b: 'Gemma 4 E4B — Teacher AI',
};

// ── Active download tracking ──────────────────────────────────────────────────
// One download at a time per process. pauseDownload()/cancelDownload() drive
// this from ModelContext button actions and the Wi-Fi-drop handler.

let _active: FileSystem.DownloadResumable | null = null;
let _activeVariant: ModelVariant | null = null;

/** True iff a DownloadResumable is in flight right now. */
export function isDownloadActive(): boolean {
  return _active !== null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureModelDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODEL_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
  }
}

/**
 * True when the cached model file exists AND is at least 80% of the
 * expected size. The 80% tolerance guards against subtle partial-write
 * cases without being so strict that minor size drifts between HuggingFace
 * revisions cause false negatives.
 */
export async function isModelOnDisk(variant: ModelVariant): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(MODEL_PATHS[variant]);
    if (!info.exists) return false;
    const actualSize = (info as { size?: number }).size ?? 0;
    return actualSize > MODEL_SIZES_BYTES[variant] * 0.8;
  } catch {
    return false;
  }
}

// ── Download (with resume) ────────────────────────────────────────────────────

/**
 * Ensure the model .litertlm file is on disk at MODEL_PATHS[variant],
 * resuming any saved DownloadPauseState if present. Returns the local
 * file URI on success.
 *
 * If the file is already on disk at the expected size, no network is
 * touched and onProgress is called once with 100. Otherwise, a fresh or
 * resumed DownloadResumable streams bytes and reports 0–99 via onProgress
 * (the final 100 tick happens only after the download resolves, so UIs can
 * treat 100 as "library native init starting").
 *
 * Throws on failure. Pause and cancel also throw, but with a message
 * containing 'paused' or 'cancelled' so callers can skip the error UI.
 */
export async function ensureModelDownloaded(
  variant: ModelVariant,
  onProgress: (pct: number) => void,
): Promise<string> {
  const dest = MODEL_PATHS[variant];

  // Fast path: already cached.
  if (await isModelOnDisk(variant)) {
    onProgress(100);
    return dest;
  }

  await ensureModelDir();
  const url = MODEL_URLS[variant];
  const expectedSize = MODEL_SIZES_BYTES[variant];

  const progressCallback = ({
    totalBytesWritten,
    totalBytesExpectedToWrite,
  }: FileSystem.DownloadProgressData) => {
    const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : expectedSize;
    // Cap at 99% so the UI distinguishes "download complete" (100) from
    // "download in progress" (0–99).
    onProgress(Math.min(99, Math.round((totalBytesWritten / total) * 100)));
  };

  // ── Resume from savable if present ───────────────────────────────────────
  const savableRaw = await AsyncStorage.getItem(resumableKey(variant)).catch(() => null);
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
      }
    } catch {
      // Savable corrupted — fall through to fresh.
      await AsyncStorage.removeItem(resumableKey(variant)).catch(() => {});
    }
  }

  // ── Fresh download ───────────────────────────────────────────────────────
  if (!_active) {
    _active = FileSystem.createDownloadResumable(url, dest, {}, progressCallback);
  }
  _activeVariant = variant;

  try {
    const result = await _active.downloadAsync();
    _active = null;
    _activeVariant = null;
    if (!result?.uri) {
      throw new Error('Download completed but no file path was returned.');
    }
    // Download + savable cleanup.
    await AsyncStorage.removeItem(resumableKey(variant)).catch(() => {});
    onProgress(100);
    return result.uri;
  } catch (err) {
    _active = null;
    _activeVariant = null;
    // Propagate — callers distinguish paused / cancelled / real error by
    // inspecting err.message. We intentionally do NOT remove the savable
    // on 'paused' (so resume works) or on generic errors (so retry can
    // continue from the last committed byte).
    throw err;
  }
}

// ── Pause / cancel ────────────────────────────────────────────────────────────

/**
 * Pause the in-flight download and persist its DownloadPauseState to
 * AsyncStorage so a later call to ensureModelDownloaded() can resume.
 * No-op if nothing is active.
 */
export async function pauseDownload(): Promise<void> {
  if (!_active || !_activeVariant) return;
  const variant = _activeVariant;
  try {
    const savable = await _active.pauseAsync();
    if (savable) {
      await AsyncStorage.setItem(resumableKey(variant), JSON.stringify(savable)).catch(() => {});
    }
  } catch {
    // Swallow — pauseAsync occasionally throws on Android if called when
    // the native side has already finished writing the last chunk.
  } finally {
    _active = null;
    _activeVariant = null;
  }
}

/**
 * Cancel the in-flight download, delete the partial file, and discard any
 * savable state. Always safe to call — no-ops cleanly when nothing is in
 * flight or on disk.
 */
export async function cancelDownload(variant: ModelVariant): Promise<void> {
  if (_active && _activeVariant === variant) {
    try { await _active.pauseAsync(); } catch { /* best-effort */ }
    _active = null;
    _activeVariant = null;
  }
  await AsyncStorage.removeItem(resumableKey(variant)).catch(() => {});
  try {
    const info = await FileSystem.getInfoAsync(MODEL_PATHS[variant]);
    if (info.exists) {
      await FileSystem.deleteAsync(MODEL_PATHS[variant], { idempotent: true });
    }
  } catch {
    // File may have been gone already; ignore.
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete a downloaded model to free device storage. Reuses cancelDownload's
 * cleanup path then clears the "has been downloaded" SecureStore flag.
 *
 * Callers that have loaded the model into memory should separately call
 * litert.unloadModel() to release the native session; this function
 * intentionally does NOT import litert to avoid a circular dep.
 */
export async function deleteModelFile(variant: ModelVariant): Promise<void> {
  await cancelDownload(variant);
  await SecureStore.deleteItemAsync(MODEL_DOWNLOADED_KEY).catch(() => {});
}
