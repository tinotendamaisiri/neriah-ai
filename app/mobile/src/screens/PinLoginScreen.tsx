// src/screens/PinLoginScreen.tsx
// Cold-start PIN unlock screen. Rendered directly by AppShell — no navigation hooks.
// Wrong PIN → shake + attempts counter. 5 wrong → 30-min lock → "Use phone number".

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { verifyPin } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants/colors';

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const PIN_LOCK_KEY = 'neriah_pin_lock_until';

export default function PinLoginScreen() {
  const { user, unlockWithPin, logout } = useAuth();
  const [pin, setPin] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [, forceUpdate] = useState(0);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Restore lock state from SecureStore on mount
  useEffect(() => {
    SecureStore.getItemAsync(PIN_LOCK_KEY).then(val => {
      if (!val) return;
      const until = parseInt(val, 10);
      if (Date.now() < until) {
        setLocked(true);
        setLockUntil(until);
      } else {
        SecureStore.deleteItemAsync(PIN_LOCK_KEY);
      }
    });
  }, []);

  // Countdown tick while locked
  useEffect(() => {
    if (!locked) return;
    const interval = setInterval(() => {
      if (Date.now() >= lockUntil) {
        setLocked(false);
        setAttempts(0);
        SecureStore.deleteItemAsync(PIN_LOCK_KEY);
      }
      forceUpdate(n => n + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [locked, lockUntil]);

  const shake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 14, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -14, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const handleKey = (key: string) => {
    if (loading || locked) return;
    if (key === '⌫') {
      setPin(p => p.slice(0, -1));
    } else if (key !== '' && pin.length < 4) {
      const next = pin + key;
      setPin(next);
      if (next.length === 4) {
        submitPin(next);
      }
    }
  };

  const submitPin = async (digits: string) => {
    setLoading(true);
    try {
      await verifyPin(digits);
      unlockWithPin(); // AppShell transitions to main app
    } catch (err: any) {
      setPin('');
      shake();
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);

      if (newAttempts >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCK_DURATION_MS;
        await SecureStore.setItemAsync(PIN_LOCK_KEY, String(until));
        setLockUntil(until);
        setLocked(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUsePhone = async () => {
    await logout();
    // AppShell sees user=null → AuthNavigator
  };

  const firstName = user?.first_name ?? user?.name?.split(' ')[0] ?? 'back';

  const minutesLeft = locked
    ? Math.max(1, Math.ceil((lockUntil - Date.now()) / 60000))
    : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.top}>
          <Text style={styles.heading}>Welcome back, {firstName}</Text>

          {locked ? (
            <Text style={styles.lockedMsg}>
              Too many attempts.{'\n'}Try again in {minutesLeft} minute{minutesLeft !== 1 ? 's' : ''}.
            </Text>
          ) : (
            <>
              <Text style={styles.subheading}>Enter your PIN</Text>
              {attempts > 0 && (
                <Text style={styles.attemptsText}>
                  {MAX_ATTEMPTS - attempts} attempt{MAX_ATTEMPTS - attempts !== 1 ? 's' : ''} remaining
                </Text>
              )}
            </>
          )}

          {/* 4 circles with shake animation */}
          <Animated.View
            style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}
          >
            {[0, 1, 2, 3].map(i => (
              <View
                key={i}
                style={[
                  styles.dot,
                  pin.length > i && styles.dotFilled,
                  locked && styles.dotLocked,
                ]}
              />
            ))}
          </Animated.View>
        </View>

        {/* Numeric keypad */}
        <View style={styles.keypad}>
          {KEYS.map((key, idx) => (
            <TouchableOpacity
              key={idx}
              style={[
                styles.key,
                key === '' && styles.keyHidden,
                (locked || loading) && key !== '' && styles.keyDisabled,
              ]}
              onPress={() => handleKey(key)}
              disabled={key === '' || locked || loading}
              activeOpacity={0.6}
            >
              {loading && key === pin[pin.length - 1] ? (
                <ActivityIndicator size="small" color={COLORS.teal500} />
              ) : (
                <Text style={[styles.keyText, key === '⌫' && styles.keyDelete]}>
                  {key}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Use phone number instead */}
        <TouchableOpacity style={styles.phoneLink} onPress={handleUsePhone}>
          <Text style={styles.phoneLinkText}>Use phone number instead</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 32,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  top: { alignItems: 'center', width: '100%' },
  heading: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  subheading: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 12,
  },
  attemptsText: {
    fontSize: 13,
    color: COLORS.error,
    marginBottom: 12,
  },
  lockedMsg: {
    fontSize: 15,
    color: COLORS.error,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 8,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.teal500,
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: COLORS.teal500,
  },
  dotLocked: {
    borderColor: COLORS.error,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 280,
    justifyContent: 'center',
    gap: 12,
  },
  key: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyHidden: {
    backgroundColor: 'transparent',
  },
  keyDisabled: {
    opacity: 0.4,
  },
  keyText: {
    fontSize: 24,
    fontWeight: '500',
    color: COLORS.text,
  },
  keyDelete: {
    fontSize: 20,
    color: COLORS.gray500,
  },
  phoneLink: {
    padding: 10,
  },
  phoneLinkText: {
    fontSize: 14,
    color: COLORS.teal500,
    fontWeight: '600',
  },
});
