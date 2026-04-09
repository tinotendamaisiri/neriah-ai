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
const TERMS_ACCEPTED_KEY = 'neriah_terms_accepted';
const TERMS_VERSION = '1.0';

// ── Context shape ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;               // true while reading SecureStore on startup
  hasPin: boolean;                // true if user has set a PIN (persisted)
  pinUnlocked: boolean;           // true after PIN entered or fresh OTP login
  needsPinSetup: boolean;         // true after first OTP login with no PIN set
  termsAccepted: boolean;         // true if user has accepted current terms version
  login: (response: VerifyResponse) => Promise<void>;
  logout: () => Promise<void>;
  markPinSet: () => Promise<void>;  // call after successful PIN creation
  skipPinSetup: () => void;         // user chose "Skip for now"
  unlockWithPin: () => void;        // call after successful PIN verify on cold start
  updateUser: (updates: Partial<AuthUser>, newToken?: string) => Promise<void>; // update profile in-place
  acceptTerms: () => Promise<void>; // call after user accepts terms agreement
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  hasPin: false,
  pinUnlocked: false,
  needsPinSetup: false,
  termsAccepted: false,
  login: async () => {},
  logout: async () => {},
  markPinSet: async () => {},
  skipPinSetup: () => {},
  unlockWithPin: () => {},
  updateUser: async () => {},
  acceptTerms: async () => {},
});

// ── JWT expiry check ──────────────────────────────────────────────────────────
//
// Decode the payload of a JWT (base64url) and check the `exp` claim.
// Returns true if the token has expired or is unreadable.
// This is a client-side check only — the server is still the authority.

function isJwtExpired(token: string): boolean {
  try {
    // JWT payload is base64url-encoded (uses - and _ instead of + and /)
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as { exp?: number };
    if (!payload.exp) return false; // no exp claim → treat as valid
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true; // malformed JWT → treat as expired
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Restore session from SecureStore on cold start
  useEffect(() => {
    const restore = async () => {
      try {
        const [storedToken, storedUserJson, storedPin, storedTermsVersion] = await Promise.all([
          SecureStore.getItemAsync(JWT_STORAGE_KEY),
          SecureStore.getItemAsync(USER_STORAGE_KEY),
          SecureStore.getItemAsync(PIN_SET_KEY),
          SecureStore.getItemAsync(TERMS_ACCEPTED_KEY),
        ]);

        if (storedToken && storedUserJson) {
          if (isJwtExpired(storedToken)) {
            // Token is expired — clear it now so the auth screen shows immediately
            // rather than flashing the main app and then getting a 401.
            // hasPin is NOT cleared — user can still re-authenticate on this device.
            await Promise.all([
              SecureStore.deleteItemAsync(JWT_STORAGE_KEY),
              SecureStore.deleteItemAsync(USER_STORAGE_KEY),
            ]).catch(() => {});
          } else {
            const stored = JSON.parse(storedUserJson) as AuthUser;
            // Backfill surname from combined name for sessions saved before split fields existed
            if (!stored.surname && stored.name) {
              const parts = stored.name.trim().split(' ');
              stored.first_name = stored.first_name || parts[0];
              stored.surname = parts.slice(1).join(' ') || parts[0];
            }
            setToken(storedToken);
            setUser(stored);
          }
        }

        if (storedPin === 'true') {
          setHasPin(true);
          // pinUnlocked stays false — user must enter PIN on cold start
        }
        if (storedTermsVersion === TERMS_VERSION) {
          setTermsAccepted(true);
        }
      } catch {
        // Ignore corrupt storage — start unauthenticated
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

  // Wire up 401 handler so any request that gets a 401 forces logout.
  // A 401 on a non-expired token means the server revoked it (token_version
  // change from account recovery). Logout clears the JWT and shows auth screen.
  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

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

    // Show PIN setup prompt if user hasn't set a PIN AND hasn't dismissed the prompt before.
    // "neriah_pin_prompt_shown" is written to AsyncStorage when the user either sets a PIN
    // or taps "Skip" in PinSetupScreen, so it survives logout/re-login and JWT rotation.
    const [existingPin, promptShown] = await Promise.all([
      SecureStore.getItemAsync(PIN_SET_KEY),
      AsyncStorage.getItem('neriah_pin_prompt_shown'),
    ]);
    if (existingPin !== 'true' && promptShown !== 'true') {
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

  const acceptTerms = useCallback(async () => {
    await SecureStore.setItemAsync(TERMS_ACCEPTED_KEY, TERMS_VERSION);
    setTermsAccepted(true);
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
    () => ({ user, token, loading, hasPin, pinUnlocked, needsPinSetup, termsAccepted, login, logout, markPinSet, skipPinSetup, unlockWithPin, updateUser, acceptTerms }),
    [user, token, loading, hasPin, pinUnlocked, needsPinSetup, termsAccepted, login, logout, markPinSet, skipPinSetup, unlockWithPin, updateUser, acceptTerms],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useAuth = () => useContext(AuthContext);
