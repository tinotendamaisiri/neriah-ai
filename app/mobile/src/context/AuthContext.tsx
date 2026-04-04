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
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

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
          setToken(storedToken);
          setUser(JSON.parse(storedUserJson) as AuthUser);
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

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, logout }),
    [user, token, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useAuth = () => useContext(AuthContext);
