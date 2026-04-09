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

// ── Context shape ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;               // true while reading AsyncStorage on startup
  login: (response: VerifyResponse) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (patch: Partial<AuthUser>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  updateUser: async () => {},
});

// ── JWT expiry check ──────────────────────────────────────────────────────────
//
// Decode the payload of a JWT (base64url) and check the `exp` claim.
// Returns true if the token has expired or is unreadable.
// This is a client-side check only — the server is still the authority.

function isJwtExpired(token: string): boolean {
  try {
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

  // Restore session from SecureStore on cold start
  useEffect(() => {
    const restore = async () => {
      try {
        const [storedToken, storedUserJson] = await Promise.all([
          SecureStore.getItemAsync(JWT_STORAGE_KEY),
          SecureStore.getItemAsync(USER_STORAGE_KEY),
        ]);
        if (storedToken && storedUserJson) {
          if (isJwtExpired(storedToken)) {
            // Token expired — clear it now so the auth screen shows immediately
            // rather than flashing the main app then getting a 401.
            await Promise.all([
              SecureStore.deleteItemAsync(JWT_STORAGE_KEY),
              SecureStore.deleteItemAsync(USER_STORAGE_KEY),
            ]).catch(() => {});
          } else {
            setToken(storedToken);
            setUser(JSON.parse(storedUserJson) as AuthUser);
          }
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
      first_name: response.user.first_name,
      surname: response.user.surname,
      school: response.user.school,
      class_id: response.user.class_id,
      join_code: joinCode,
    };
    await Promise.all([
      SecureStore.setItemAsync(JWT_STORAGE_KEY, response.token),
      SecureStore.setItemAsync(USER_STORAGE_KEY, JSON.stringify(authUser)),
    ]);
    setToken(response.token);
    setUser(authUser);

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
  }, []);

  const updateUser = useCallback(async (patch: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...patch };
      SecureStore.setItemAsync(USER_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, logout, updateUser }),
    [user, token, loading, login, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useAuth = () => useContext(AuthContext);
