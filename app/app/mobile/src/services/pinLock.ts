// src/services/pinLock.ts
// Device-local PIN lock.  PIN is stored in expo-secure-store ONLY — never sent
// to the server.  AsyncStorage is used for the nudge-dismissed timestamp only.

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PIN_KEY          = 'neriah_app_pin';
const PIN_SET_AT_KEY   = 'neriah_pin_set_at';
const LAST_NUDGE_KEY   = 'neriah_last_pin_nudge';
const NUDGE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** True if a 4-digit PIN is stored on this device. */
export async function hasPin(): Promise<boolean> {
  try {
    const pin = await SecureStore.getItemAsync(PIN_KEY);
    return typeof pin === 'string' && pin.length === 4;
  } catch {
    return false;
  }
}

/** Store a new 4-digit PIN.  Throws if the input is not exactly 4 digits. */
export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits.');
  }
  await SecureStore.setItemAsync(PIN_KEY, pin);
  await SecureStore.setItemAsync(PIN_SET_AT_KEY, new Date().toISOString());
}

/** Compare `input` to the stored PIN.  Returns false if no PIN is set. */
export async function verifyPin(input: string): Promise<boolean> {
  try {
    const stored = await SecureStore.getItemAsync(PIN_KEY);
    return stored !== null && stored === input;
  } catch {
    return false;
  }
}

/** Delete the stored PIN from this device. */
export async function removePin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY);
  await SecureStore.deleteItemAsync(PIN_SET_AT_KEY);
}

/**
 * Returns true iff the teacher should see the "set a PIN" nudge:
 *   1. role is "teacher"
 *   2. No PIN is currently set
 *   3. The nudge hasn't been shown in the last 30 days (or never shown)
 */
export async function shouldShowPinNudge(role: string): Promise<boolean> {
  if (role !== 'teacher') return false;
  try {
    if (await hasPin()) return false;
    const raw = await AsyncStorage.getItem(LAST_NUDGE_KEY);
    if (!raw) return true;
    return Date.now() - new Date(raw).getTime() >= NUDGE_INTERVAL_MS;
  } catch {
    return false;
  }
}

/** Record that the nudge was dismissed — suppresses it for the next 30 days. */
export async function dismissPinNudge(): Promise<void> {
  await AsyncStorage.setItem(LAST_NUDGE_KEY, new Date().toISOString());
}
