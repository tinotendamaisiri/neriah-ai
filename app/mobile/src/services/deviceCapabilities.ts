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
  if (ramGB >= RAM_E4B_GB && freeStorageGB >= STOR_E4B_GB) return 'e4b-capable';
  if (ramGB >= RAM_E2B_GB && freeStorageGB >= STOR_E2B_GB) return 'e2b-capable';
  // Even low-end devices get e2b — let the user try, the model will just be slower
  if (freeStorageGB >= STOR_E2B_GB) return 'e2b-capable';
  return 'cloud-only';
}

function isValidCapability(value: string | null): value is DeviceCapability {
  return value === 'e4b-capable' || value === 'e2b-capable' || value === 'cloud-only';
}

/**
 * Run on first launch only. Reads device RAM via expo-device and free storage
 * via expo-file-system, classifies the device, and persists the result to
 * SecureStore under "device_capability".
 *
 * If a stored result already exists it is returned immediately without
 * re-checking hardware — subsequent launches skip the check entirely.
 */
export async function detectAndStoreCapability(): Promise<DeviceCapability> {
  // ── Already stored — skip hardware check ─────────────────────────────────
  try {
    const stored = await SecureStore.getItemAsync(CAPABILITY_STORE_KEY);
    if (isValidCapability(stored)) {
      console.log('[deviceCapabilities] cached result:', stored);
      return stored;
    }
  } catch {
    // SecureStore unavailable (e.g. test environment) — fall through to detect
  }

  // ── Web platform — always cloud-only ──────────────────────────────────────
  if (Platform.OS === 'web') {
    await _persist('cloud-only');
    console.log('[deviceCapabilities] web platform → cloud-only');
    return 'cloud-only';
  }

  // ── Read RAM ──────────────────────────────────────────────────────────────
  const totalMemoryBytes: number | null = Device.totalMemory ?? null;
  const ramGB = totalMemoryBytes != null ? bytesToGB(totalMemoryBytes) : 0;

  // ── Read free storage ─────────────────────────────────────────────────────
  let freeStorageGB = 0;
  try {
    const freeBytes = await FileSystem.getFreeDiskStorageAsync();
    freeStorageGB = bytesToGB(freeBytes);
  } catch {
    // API unavailable in some environments; treat as 0 (conservative)
    freeStorageGB = 0;
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
