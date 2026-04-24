// src/services/modelManager.ts
// On-device model lifecycle manager.
//
// As of the LiteRT-LM migration, the heavy lifting — download + resume +
// cache + load — is handled by `react-native-litert-lm` itself (see
// services/litert.ts). This module is now a thin coordination layer:
//
//   - Translates ModelContext's public API (startDownload / pauseDownload /
//     cancelDownload / deleteModelFile / isModelOnDisk) to the library's
//     loadModel / deleteCachedModel calls.
//   - Persists a "has been loaded at least once" flag in SecureStore so the
//     app can answer "is this model available?" without querying the
//     library's private cache directory.
//   - Keeps display metadata (names, size labels, byte counts) that the
//     Settings UI and Wi-Fi nudge banner read.
//
// Breaking change vs the pre-LiteRT-LM implementation: pause / resume is
// no longer supported. The library has no pause API — calling pauseDownload
// is a no-op (logged for visibility). Cancel attempts to delete the cached
// file, which works cleanly once the download has completed; mid-download
// cancels are best-effort (see comment on cancelDownload below).
//
// Models served from Google's LiteRT community on HuggingFace:
//   Student (E2B): ~2.0 GB
//   Teacher (E4B): ~2.96 GB

import * as SecureStore from 'expo-secure-store';

import {
  loadModel as litertLoadModel,
  deleteCachedModel as litertDeleteCachedModel,
  type ModelVariant,
} from './litert';

// Re-export for ModelContext + any other caller that used to import from here.
export type { ModelVariant };

// ── SecureStore keys (unchanged — ModelContext reads these directly) ─────────

export const MODEL_DOWNLOADED_KEY       = 'model_downloaded';
export const DOWNLOAD_PROMPTED_KEY      = 'model_download_prompted';
export const WIFI_ONLY_KEY              = 'wifi_only_downloads';
export const WIFI_NUDGE_LAST_DATE_KEY   = 'neriah_wifi_nudge_last_date';
export const WIFI_NUDGE_NEVER_KEY       = 'neriah_wifi_nudge_never';

// ── Display metadata (unchanged — drives the download prompt + Settings) ─────

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

// ── Active-load tracking ──────────────────────────────────────────────────────
// The library doesn't expose a "cancel in-flight" API. We track whether a
// load is in progress so cancelDownload can be best-effort without
// crashing if nothing is actually running.

let _activeVariant: ModelVariant | null = null;

export function isDownloadActive(): boolean {
  return _activeVariant !== null;
}

// ── Cache presence check ──────────────────────────────────────────────────────

/**
 * True if the model has been successfully loaded (and therefore cached) on
 * this device at least once. Backed by a SecureStore flag that's set after
 * startDownload completes and cleared on deleteModelFile.
 *
 * Caveat: iOS can evict files from Library/Caches under storage pressure.
 * In that case the flag still reads true but the next loadModel call will
 * transparently re-download (cache miss handled by the library). We accept
 * this edge case — the library's own logic is robust to it.
 */
export async function isModelOnDisk(_variant: ModelVariant): Promise<boolean> {
  const flag = await SecureStore.getItemAsync(MODEL_DOWNLOADED_KEY).catch(() => null);
  return flag === 'true';
}

// ── Download / load ──────────────────────────────────────────────────────────

/**
 * Download + load a model. Signature preserved from the pre-LiteRT-LM
 * implementation so ModelContext keeps working unchanged.
 *
 * The callback pattern (onProgress / onComplete / onError) is a thin wrap
 * around litert.loadModel's progress callback + async return/throw. The
 * library handles the actual HTTP download, filesystem cache, and native
 * session init.
 *
 * @param variant    Which model to download.
 * @param onProgress Called with 0–100 as the download advances.
 * @param onComplete Called with no args when the file is cached AND the
 *                   model is loaded into memory.
 * @param onError    Called with a message on unrecoverable failure.
 */
export async function startDownload(
  variant: ModelVariant,
  onProgress: (pct: number) => void,
  onComplete: () => void,
  onError: (msg: string) => void,
): Promise<void> {
  _activeVariant = variant;
  try {
    await litertLoadModel(variant, (pct) => {
      onProgress(pct);
    });
    await SecureStore.setItemAsync(MODEL_DOWNLOADED_KEY, 'true').catch(() => {});
    onProgress(100);
    onComplete();
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    onError(msg);
  } finally {
    _activeVariant = null;
  }
}

// ── Pause ─────────────────────────────────────────────────────────────────────
//
// react-native-litert-lm has no public pause API. Exposed as a no-op so
// the ModelContext's existing pause button doesn't blow up; teachers hitting
// pause get no visible effect but also no error. A future library release
// may add pause support — if/when it does, wire it through here.

export async function pauseDownload(): Promise<void> {
  if (!_activeVariant) return;
  console.warn('[modelManager] pauseDownload: not supported by react-native-litert-lm; no-op.');
}

// ── Cancel ────────────────────────────────────────────────────────────────────

/**
 * Cancel an in-flight download. Like pause, this isn't a real operation on
 * the library — we can't abort the HTTP transfer once it's in flight. What
 * we *can* do is delete whatever was cached (completed downloads, or
 * partials the library may or may not have persisted).
 *
 * The better UX path is "wait for completion, then delete via
 * deleteModelFile". We keep this function around for interface compat but
 * it'll rarely do anything useful mid-transfer.
 */
export async function cancelDownload(variant: ModelVariant): Promise<void> {
  try {
    await litertDeleteCachedModel(variant);
  } catch {
    // Best-effort — the cache file may not exist yet, or the library may
    // refuse to delete while the download is still open. Swallow.
  }
  await SecureStore.deleteItemAsync(MODEL_DOWNLOADED_KEY).catch(() => {});
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete the cached model file to free device storage. Also drops the
 * in-memory native session (via litert.deleteCachedModel → unloadModel
 * internally) and clears the "has been downloaded" flag.
 */
export async function deleteModelFile(variant: ModelVariant): Promise<void> {
  try {
    await litertDeleteCachedModel(variant);
  } catch {
    // Best-effort — nothing there is fine.
  }
  await SecureStore.deleteItemAsync(MODEL_DOWNLOADED_KEY).catch(() => {});
}
