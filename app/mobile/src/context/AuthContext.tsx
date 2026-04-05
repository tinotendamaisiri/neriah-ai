// src/context/AuthContext.tsx
// Provides JWT auth state to the entire app.
// Stores token + user in SecureStore so the session survives restarts securely.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { JWT_STORAGE_KEY, USER_STORAGE_KEY, registerPushToken, setUnauthorizedHandler } from '../services/api';
import { AuthUser, VerifyResponse } from '../types';
import { PENDING_JOIN_CODE_KEY } from '../constants';

const PIN_SET_KEY = 'neriah_has_pin';

// ── Context shape ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;               // true while reading SecureStore on startup
  hasPin: boolean;                // true if user has set a PIN (persisted)
  pinUnlocked: boolean;           // true after PIN entered or fresh OTP login
  needsPinSetup: boolean;         // true after first OTP login with no PIN set
  login: (response: VerifyResponse) => Promise<void>;
  logout: () => Promise<void>;
  markPinSet: () => Promise<void>;  // call after successful PIN creation
  skipPinSetup: () => void;         // user chose "Skip for now"
  unlockWithPin: () => void;        // call after successful PIN verify on cold start
  updateUser: (updates: Partial<AuthUser>, newToken?: string) => Promise<void>; // update profile in-place
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  hasPin: false,
  pinUnlocked: false,
  needsPinSetup: false,
  login: async () => {},
  logout: async () => {},
  markPinSet: async () => {},
  skipPinSetup: () => {},
  unlockWithPin: () => {},
  updateUser: async () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [needsPinSetup, setNeedsPinSetup] = useState(false);

  // Restore session from SecureStore on cold start
  useEffect(() => {
    const restore = async () => {
      try {
        const [storedToken, storedUserJson, storedPin] = await Promise.all([
          SecureStore.getItemAsync(JWT_STORAGE_KEY),
          SecureStore.getItemAsync(USER_STORAGE_KEY),
          SecureStore.getItemAsync(PIN_SET_KEY),
        ]);
        if (storedToken && storedUserJson) {
          setToken(storedToken);
          setUser(JSON.parse(storedUserJson) as AuthUser);
        }
        if (storedPin === 'true') {
          setHasPin(true);
          // pinUnlocked stays false — user must enter PIN on cold start
        }
      } catch {
        // Ignore corrupt storage — start unauthenticated
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

  // Wire up 401 handler so any request that gets a 401 forces logout
  useEffect(() => {
    setUnauthorizedHandler(() => logout());
  }, []);

  const login = useCallback(async (response: VerifyResponse) => {
    // If this is a student registering via join code, the pending join_code
    // was stored in AsyncStorage by StudentRegisterScreen before OTP navigation.
    let joinCode: string | undefined;
    if (response.user.role === 'student') {
      try {
        const pending = await AsyncStorage.getItem(PENDING_JOIN_CODE_KEY);
        if (pending) {
          joinCode = pending;
          await AsyncStorage.removeItem(PENDING_JOIN_CODE_KEY);
        }
      } catch {
        // Non-critical — proceed without join_code
      }
    }

    const authUser: AuthUser = {
      id: response.user.id,
      phone: response.user.phone,
      role: response.user.role,
      name: response.user.name,
      title: response.user.title,
      display_name: response.user.display_name,
      first_name: response.user.first_name,
      surname: response.user.surname,
      school: response.user.school ?? response.user.school_name,
      class_id: response.user.class_id,
      join_code: joinCode,
    };
    await Promise.all([
      SecureStore.setItemAsync(JWT_STORAGE_KEY, response.token),
      SecureStore.setItemAsync(USER_STORAGE_KEY, JSON.stringify(authUser)),
    ]);
    setToken(response.token);
    setUser(authUser);
    setPinUnlocked(true); // OTP login always unlocks

    // Show PIN setup if user hasn't set one yet
    const existingPin = await SecureStore.getItemAsync(PIN_SET_KEY);
    if (existingPin !== 'true') {
      setNeedsPinSetup(true);
    }

    // Register Expo push token in the background (best-effort)
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        const tokenData = await Notifications.getExpoPushTokenAsync();
        await registerPushToken(tokenData.data);
      }
    } catch {
      // Push registration is non-critical
    }
  }, []);

  const logout = useCallback(async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(JWT_STORAGE_KEY),
      SecureStore.deleteItemAsync(USER_STORAGE_KEY),
    ]);
    setToken(null);
    setUser(null);
    setPinUnlocked(false);
    setNeedsPinSetup(false);
    // hasPin intentionally preserved — user may log back in with same phone
  }, []);

  const markPinSet = useCallback(async () => {
    await SecureStore.setItemAsync(PIN_SET_KEY, 'true');
    setHasPin(true);
    setNeedsPinSetup(false);
  }, []);

  const skipPinSetup = useCallback(() => {
    setNeedsPinSetup(false);
  }, []);

  const unlockWithPin = useCallback(() => {
    setPinUnlocked(true);
  }, []);

  const updateUser = useCallback(async (updates: Partial<AuthUser>, newToken?: string) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      SecureStore.setItemAsync(USER_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    if (newToken) {
      setToken(newToken);
      await SecureStore.setItemAsync(JWT_STORAGE_KEY, newToken);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, hasPin, pinUnlocked, needsPinSetup, login, logout, markPinSet, skipPinSetup, unlockWithPin, updateUser }),
    [user, token, loading, hasPin, pinUnlocked, needsPinSetup, login, logout, markPinSet, skipPinSetup, unlockWithPin, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useAuth = () => useContext(AuthContext);
