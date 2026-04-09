// src/services/modelManager.ts
// Model file download manager.
//
// Production: downloads from GCS (neriah-models bucket).
// Development: downloads from a local HTTP server.
//   Run: npx serve app/mobile/assets/models -p 8082
//   Then call copyModelFromDevServer() to transfer models to the device.
//
// Models are stored in FileSystem.documentDirectory/models/ — outside the app
// bundle so they survive app updates without re-download.

import * as FileSystem from 'expo-file-system';
import { MODEL_PATHS, ModelVariant } from './litert';

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_DIR = `${FileSystem.documentDirectory ?? ''}models/`;

/** GCS URLs for production model downloads. Bucket must be publicly readable or signed. */
const GCS_URLS: Record<ModelVariant, string> = {
  e2b: 'https://storage.googleapis.com/neriah-models/gemma-4-e2b-it.task',
  e4b: 'https://storage.googleapis.com/neriah-models/gemma-4-e4b-it.task',
};

/** Dev server URL — run `npx serve app/mobile/assets/models -p 8082` locally. */
const DEV_SERVER = 'http://localhost:8082';
const DEV_FILENAMES: Record<ModelVariant, string> = {
  e2b: 'gemma-4-e2b-it.task',
  e4b: 'gemma-4-e4b-it.task',
};

/** Expected file sizes in bytes (shown in UI before download). */
export const MODEL_SIZES: Record<ModelVariant, number> = {
  e2b: 2_500_000_000,
  e4b: 3_500_000_000,
};

/** Human-readable size for UI display. */
export const MODEL_SIZE_LABEL: Record<ModelVariant, string> = {
  e2b: '2.5 GB',
  e4b: '3.5 GB',
};

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Check if a model file exists on the device and is larger than 1 MB.
 * (1 MB sanity check catches partial/corrupt downloads.)
 */
export async function isModelDownloaded(model: ModelVariant): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(MODEL_PATHS[model], { size: true });
    return info.exists && ((info as any).size ?? 0) > 1_000_000;
  } catch {
    return false;
  }
}

// ── Download ──────────────────────────────────────────────────────────────────

/**
 * Download a model from GCS (production) or dev server to the device.
 *
 * @param model     Which model to download
 * @param onProgress Called with 0–100 as download progresses
 * @param signal    Optional AbortController signal to pause/cancel
 * @returns Local file:// URI of the downloaded model
 */
export async function downloadModel(
  model: ModelVariant,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  // Ensure models directory exists
  const dirInfo = await FileSystem.getInfoAsync(MODEL_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
  }

  const destPath = MODEL_PATHS[model];
  const url = __DEV__
    ? `${DEV_SERVER}/${DEV_FILENAMES[model]}`
    : GCS_URLS[model];

  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    destPath,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (!onProgress) return;
      const total = totalBytesExpectedToWrite > 0
        ? totalBytesExpectedToWrite
        : MODEL_SIZES[model];
      onProgress(Math.min(99, Math.round((totalBytesWritten / total) * 100)));
    },
  );

  if (signal) {
    signal.addEventListener('abort', () => {
      downloadResumable.pauseAsync().catch(() => {});
    });
  }

  const result = await downloadResumable.downloadAsync();
  if (!result?.uri) throw new Error('Download completed but no URI was returned');

  onProgress?.(100);
  return result.uri;
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Delete a downloaded model to free device storage. */
export async function deleteModel(model: ModelVariant): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODEL_PATHS[model]);
  if (info.exists) {
    await FileSystem.deleteAsync(MODEL_PATHS[model], { idempotent: true });
  }
}

// ── Dev helper ────────────────────────────────────────────────────────────────

/**
 * Development only: copy a model from a local HTTP server to the device.
 *
 * Setup:
 *   1. cd neriah/app/mobile
 *   2. npx serve assets/models -p 8082
 *   3. Call copyModelFromDevServer('e2b') from your app
 *
 * The serve command makes the .task files accessible at http://localhost:8082.
 * On iOS Simulator, localhost resolves to the Mac. On a physical device, use
 * your Mac's local IP (e.g. http://192.168.x.x:8082) and update DEV_SERVER.
 */
export async function copyModelFromDevServer(
  model: ModelVariant,
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (!__DEV__) {
    throw new Error('copyModelFromDevServer is only available in development builds');
  }
  return downloadModel(model, onProgress);
}
