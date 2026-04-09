// src/services/offlineCache.ts
// Generic AsyncStorage cache layer + persistent image cache via expo-file-system.
// All writes are best-effort — never throw to callers.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

// ── Key helpers ──────────────────────────────────────────────────────────────��

const PREFIX = 'neriah_cache_';

export const cacheKeys = {
  classes:     ()                    => `${PREFIX}classes`,
  homework:    (class_id: string)    => `${PREFIX}homework_${class_id}`,
  submissions: (homework_id: string) => `${PREFIX}submissions_${homework_id}`,
  students:    (class_id: string)    => `${PREFIX}students_${class_id}`,
  analytics:   (class_id: string)    => `${PREFIX}analytics_${class_id}`,
  analyticsAll: ()                   => `${PREFIX}analytics_all`,
};

// ── Cache entry shape ─────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  data: T;
  cached_at: string; // ISO-8601
}

// ── Core helpers ──────────────────────────────────────────────────────────────

export async function getCached<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, cached_at: new Date().toISOString() };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch { /* best-effort */ }
}

/**
 * Clear a specific cache key, or every key with the neriah_cache_ prefix.
 */
export async function clearCache(key?: string): Promise<void> {
  try {
    if (key) {
      await AsyncStorage.removeItem(key);
      return;
    }
    const allKeys = await AsyncStorage.getAllKeys();
    const mine = allKeys.filter(k => k.startsWith(PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch { /* best-effort */ }
}

// ── Image cache (expo-file-system) ────────────────────────────────────────────
// Downloads annotated result images to the device so they survive offline.

const IMAGE_DIR = `${FileSystem.documentDirectory}neriah_images/`;

async function ensureImageDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(IMAGE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
  }
}

function filenameFromUrl(url: string): string {
  // Strip query params and use the last path segment as the filename.
  const clean = url.split('?')[0];
  return clean.split('/').pop() ?? `img_${Date.now()}.jpg`;
}

/**
 * Download a remote image to device storage and return the local URI.
 * If already cached locally, returns the local URI immediately.
 * Falls back to the original URL on any error.
 */
export async function cacheImage(url: string): Promise<string> {
  try {
    await ensureImageDir();
    const filename = filenameFromUrl(url);
    const localPath = `${IMAGE_DIR}${filename}`;
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists) return localPath;
    const result = await FileSystem.downloadAsync(url, localPath);
    return result.uri;
  } catch {
    return url;
  }
}

/**
 * Check whether a remote image is cached locally.
 * Returns the local URI if it exists, null otherwise.
 */
export async function getLocalImagePath(url: string): Promise<string | null> {
  try {
    const filename = filenameFromUrl(url);
    const localPath = `${IMAGE_DIR}${filename}`;
    const info = await FileSystem.getInfoAsync(localPath);
    return info.exists ? localPath : null;
  } catch {
    return null;
  }
}
