// src/services/deviceCapabilities.ts
// Device capability detection — runs once on first launch.
// Stores result in SecureStore under key "device_capability".
//
// Capability tiers:
//   "e4b-capable"  — RAM >= 6 GB AND free storage >= 3.5 GB (teacher grading model ~3 GB)
//   "e2b-capable"  — RAM >= 4 GB AND free storage >= 2 GB   (student tutor model ~2 GB)
//   "cloud-only"   — below thresholds; all inference routed to cloud
//
// Subsequent launches read the stored result and skip hardware checks entirely.

import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export type DeviceCapability = 'e4b-capable' | 'e2b-capable' | 'cloud-only';

export const CAPABILITY_STORE_KEY = 'device_capability';

const RAM_E4B_GB  = 6;
const RAM_E2B_GB  = 3;   // lowered from 4 — most African devices have 3-4 GB
const STOR_E4B_GB = 3.5;
const STOR_E2B_GB = 1.5; // lowered from 2 — model is ~1 GB compressed

function bytesToGB(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}

function classify(ramGB: number, freeStorageGB: number): DeviceCapability {
  // Storage check — must have room for the model file
  if (freeStorageGB < STOR_E2B_GB) return 'cloud-only';
  // RAM check — determines which model variant
  if (ramGB >= RAM_E4B_GB && freeStorageGB >= STOR_E4B_GB) return 'e4b-capable';
  if (ramGB >= RAM_E2B_GB) return 'e2b-capable';
  return 'cloud-only';
}

function isValidCapability(value: string | null): value is DeviceCapability {
  return value === 'e4b-capable' || value === 'e2b-capable' || value === 'cloud-only';
}

/**
 * Detect device capability at runtime. Always re-checks hardware —
 * never returns stale cached values.
 */
export async function detectCapability(): Promise<DeviceCapability> {
  return detectAndStoreCapability();
}

/**
 * Reads device RAM and free storage, classifies the device, and persists.
 * Always re-detects — never skips based on cached values.
 */
export async function detectAndStoreCapability(): Promise<DeviceCapability> {
  // Clear any stale cached value — always re-detect fresh
  try { await SecureStore.deleteItemAsync(CAPABILITY_STORE_KEY); } catch {}

  // ── Web platform — always cloud-only ──────────────────────────────────────
  if (Platform.OS === 'web') {
    await _persist('cloud-only');
    console.log('[deviceCapabilities] web platform → cloud-only');
    return 'cloud-only';
  }

  // ── Read RAM ──────────────────────────────────────────────────────────────
  // On iOS, Device.totalMemory returns app-available memory (~1-3 GB) not
  // physical RAM. Use device model to determine actual RAM at runtime.
  let ramGB = 0;
  if (Platform.OS === 'ios') {
    // iOS: infer from device model — all iPhones since iPhone 11 have ≥ 4 GB
    const model = (Device.modelName ?? '').toLowerCase();
    // iPhone 15 Pro/Max, 14 Pro/Max, 13 Pro/Max = 6 GB
    // iPhone 15, 14, 13, 12, 11 = 4 GB
    // iPhone SE, older = 3 GB
    if (model.includes('pro') || model.includes('max')) ramGB = 6;
    else if (model.includes('iphone')) ramGB = 4;
    else if (model.includes('ipad')) ramGB = 4;
    else ramGB = 4; // default — modern iOS devices have ≥ 4 GB
    console.log(`[deviceCapabilities] iOS model="${Device.modelName}" → inferred RAM=${ramGB} GB`);
  } else {
    // Android: Device.totalMemory is accurate
    const totalMemoryBytes: number | null = Device.totalMemory ?? null;
    ramGB = totalMemoryBytes != null ? bytesToGB(totalMemoryBytes) : 0;
  }

  // ── Read free storage ─────────────────────────────────────────────────────
  let freeStorageGB = 0;
  try {
    const freeBytes = await FileSystem.getFreeDiskStorageAsync();
    freeStorageGB = bytesToGB(freeBytes);
  } catch {
    freeStorageGB = 0;
  }
  // If API returned 0 (deprecated API on Expo 54+ returns 0), don't block —
  // the OS will reject the download if there's truly no space.
  if (freeStorageGB <= 0) {
    console.log('[deviceCapabilities] Free storage API returned 0 — assuming sufficient storage');
    freeStorageGB = 10; // assume capable; OS handles actual storage errors
  }

  const capability = classify(ramGB, freeStorageGB);

  await _persist(capability);
  console.log(
    `[deviceCapabilities] RAM=${ramGB.toFixed(1)} GB, freeStorage=${freeStorageGB.toFixed(1)} GB → ${capability}`,
  );

  return capability;
}

/**
 * Read the stored capability without triggering hardware detection.
 * Returns null if the first-launch check has never been run.
 */
export async function getStoredCapability(): Promise<DeviceCapability | null> {
  try {
    const stored = await SecureStore.getItemAsync(CAPABILITY_STORE_KEY);
    return isValidCapability(stored) ? stored : null;
  } catch {
    return null;
  }
}

async function _persist(capability: DeviceCapability): Promise<void> {
  try {
    await SecureStore.setItemAsync(CAPABILITY_STORE_KEY, capability);
  } catch {
    // Non-fatal — capability detection still succeeds even if storage fails
  }
}
