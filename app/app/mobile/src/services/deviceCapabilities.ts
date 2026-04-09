// src/services/deviceCapabilities.ts
// Detect device RAM to determine which on-device model can run.
//
// E2B requires ~4 GB RAM (student tutor).
// E4B requires ~6 GB RAM (teacher grading).
//
// Uses expo-device when installed. Falls back to a conservative platform heuristic.
// Install expo-device for accurate detection: npx expo install expo-device

import { Platform } from 'react-native';

export interface DeviceCapabilities {
  /** Device can run the 2.5 GB E2B student tutor model (~4 GB RAM needed) */
  canRunE2B: boolean;
  /** Device can run the 3.5 GB E4B teacher grading model (~6 GB RAM needed) */
  canRunE4B: boolean;
  /** Convenience: any on-device model can run */
  canRunOnDevice: boolean;
  /** Total RAM in GB (0 if unknown) */
  totalMemoryGB: number;
  /** Human-readable device name */
  deviceName: string;
}

let _cached: DeviceCapabilities | null = null;

export async function getDeviceCapabilities(): Promise<DeviceCapabilities> {
  if (_cached) return _cached;

  // ── Try expo-device for accurate RAM detection ────────────────────────────
  try {
    // Dynamic require so the app doesn't crash if expo-device isn't installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Device = require('expo-device');
    const bytes: number | null = Device.totalMemory ?? null;
    const gb = bytes ? bytes / (1024 * 1024 * 1024) : 0;

    _cached = {
      canRunE2B: gb >= 4,
      canRunE4B: gb >= 6,
      canRunOnDevice: gb >= 4,
      totalMemoryGB: Math.round(gb * 10) / 10,
      deviceName: Device.modelName ?? 'Unknown',
    };
    return _cached;
  } catch {
    // expo-device not installed — fall through to heuristic
  }

  // ── Platform heuristic ────────────────────────────────────────────────────
  // iPhone 12+ ships with ≥4 GB RAM; iPhone 13 Pro+ with ≥6 GB.
  // We allow E2B on any iOS device and let model init fail gracefully on
  // under-powered hardware. E4B stays conservative (false) until expo-device
  // is installed and can confirm ≥6 GB.
  if (Platform.OS === 'ios') {
    _cached = {
      canRunE2B: true,
      canRunE4B: false, // install expo-device for accurate E4B detection
      canRunOnDevice: true,
      totalMemoryGB: 0,
      deviceName: 'iPhone',
    };
  } else if (Platform.OS === 'android') {
    _cached = {
      canRunE2B: true,
      canRunE4B: false,
      canRunOnDevice: true,
      totalMemoryGB: 0,
      deviceName: 'Android device',
    };
  } else {
    // Web / test environment — on-device AI not supported
    _cached = {
      canRunE2B: false,
      canRunE4B: false,
      canRunOnDevice: false,
      totalMemoryGB: 0,
      deviceName: 'Unknown',
    };
  }

  return _cached;
}

/** Clear the cached result (useful in tests). */
export function resetDeviceCapabilitiesCache(): void {
  _cached = null;
}
