// src/screens/PinLoginScreen.tsx
// Cold-start PIN unlock screen. Rendered directly by AppShell — no navigation hooks.
//
// Steps:
//   'pin'     — enter current PIN (wrong × 5 → 30-min lock)
//   'otp'     — Forgot PIN: OTP sent to registered phone, user verifies identity
//   'new_pin' — set replacement PIN (no skip)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { verifyPin, requestProfileOtp, updateProfile, setPin as apiSetPin } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants/colors';
import { maskPhone } from '../utils/maskPhone';

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000;
const PIN_LOCK_KEY = 'neriah_pin_lock_until';
const RESEND_COOLDOWN = 60;

type Step = 'pin' | 'otp' | 'new_pin';

export default function PinLoginScreen() {
  const { user, unlockWithPin, logout, markPinSet } = useAuth();

  // ── PIN step state ───────────────────────────────────────────────────────────
  const [pin, setPin] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [, forceUpdate] = useState(0);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // ── OTP step state ───────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('pin');
  const [verificationId, setVerificationId] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpInputRef = useRef<TextInput>(null);

  // ── New PIN step state ───────────────────────────────────────────────────────
  const [newPin, setNewPin] = useState('');
  const [newPinLoading, setNewPinLoading] = useState(false);

  // Restore lock state on mount
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

  // Resend cooldown tick
  useEffect(() => {
    if (step !== 'otp' || resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendCooldown]);

  // Auto-focus OTP input
  useEffect(() => {
    if (step === 'otp') {
      const t = setTimeout(() => otpInputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [step]);

  // Auto-submit OTP when 6 digits entered
  useEffect(() => {
    if (step === 'otp' && otp.length === 6) handleOtpVerify();
  }, [otp]);

  // ── PIN step handlers ────────────────────────────────────────────────────────

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

  const handlePinKey = (key: string) => {
    if (loading || locked) return;
    if (key === '⌫') {
      setPin(p => p.slice(0, -1));
    } else if (key !== '' && pin.length < 4) {
      const next = pin + key;
      setPin(next);
      if (next.length === 4) submitPin(next);
    }
  };

  const submitPin = async (digits: string) => {
    setLoading(true);
    try {
      await verifyPin(digits);
      unlockWithPin();
    } catch {
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

  // ── Forgot PIN: send OTP ─────────────────────────────────────────────────────

  const handleForgotPin = async () => {
    const phone = user?.phone;
    if (!phone) return;
    setLoading(true);
    try {
      const res = await requestProfileOtp(phone);
      setVerificationId(res.verification_id);
      setResendCooldown(RESEND_COOLDOWN);
      setOtp('');
      setStep('otp');
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 429) {
        Alert.alert('Too many requests', 'Please wait a moment and try again.');
      } else {
        Alert.alert('Could not send code', 'Please check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── OTP step handlers ────────────────────────────────────────────────────────

  const handleOtpVerify = async () => {
    if (otp.length !== 6) return;
    setOtpLoading(true);
    try {
      // Verify identity via PATCH /api/auth/me with no field changes
      await updateProfile({ verification_id: verificationId, otp_code: otp });
      setNewPin('');
      setStep('new_pin');
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 400) {
        Alert.alert('Incorrect code', 'The code you entered is wrong. Please try again.');
      } else if (status === 429) {
        Alert.alert('Too many attempts', 'Please request a new code.');
        setStep('pin');
      } else {
        Alert.alert('Error', 'Something went wrong. Please try again.');
      }
      setOtp('');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResend = async () => {
    const phone = user?.phone;
    if (!phone) return;
    setOtpLoading(true);
    try {
      const res = await requestProfileOtp(phone);
      setVerificationId(res.verification_id);
      setResendCooldown(RESEND_COOLDOWN);
      setOtp('');
    } catch {
      Alert.alert('Could not resend', 'Please wait and try again.');
    } finally {
      setOtpLoading(false);
    }
  };

  // ── New PIN step handlers ────────────────────────────────────────────────────

  const handleNewPinKey = (key: string) => {
    if (newPinLoading) return;
    if (key === '⌫') {
      setNewPin(p => p.slice(0, -1));
    } else if (key !== '' && newPin.length < 4) {
      setNewPin(p => p + key);
    }
  };

  const handleSaveNewPin = async () => {
    if (newPin.length !== 4 || newPinLoading) return;
    setNewPinLoading(true);
    try {
      await apiSetPin(newPin);
      await markPinSet();
      // Clear the lock so the new PIN starts with 0 attempts
      await SecureStore.deleteItemAsync(PIN_LOCK_KEY);
      unlockWithPin();
    } catch (err: any) {
      Alert.alert('Could not save PIN', err.message ?? 'Please try again.');
    } finally {
      setNewPinLoading(false);
    }
  };

  // ── Derived display values ───────────────────────────────────────────────────

  const displayName = user
    ? `${user.title ? user.title + ' ' : ''}${user.surname ?? user.first_name ?? 'back'}`.trim()
    : 'back';

  const minutesLeft = locked
    ? Math.max(1, Math.ceil((lockUntil - Date.now()) / 60000))
    : 0;

  const maskedPhone = maskPhone(user?.phone ?? '');

  // ── Render: OTP verification step ───────────────────────────────────────────

  if (step === 'otp') {
    return (
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.container}>
            <TouchableOpacity style={styles.backRow} onPress={() => { setStep('pin'); setOtp(''); }}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>

            <View style={styles.top}>
              <Text style={styles.heading}>Verify your identity</Text>
              <Text style={styles.subheading}>
                We sent a verification code to{'\n'}
                <Text style={styles.phoneHighlight}>{maskedPhone}</Text>
              </Text>

              <TextInput
                ref={otpInputRef}
                style={styles.otpInput}
                value={otp}
                onChangeText={v => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="------"
                placeholderTextColor={COLORS.gray200}
                textAlign="center"
                editable={!otpLoading}
              />

              <TouchableOpacity
                style={[styles.saveButton, (otpLoading || otp.length < 6) && styles.saveButtonDisabled]}
                onPress={handleOtpVerify}
                disabled={otpLoading || otp.length < 6}
              >
                <Text style={styles.saveButtonText}>{otpLoading ? 'Verifying…' : 'Verify'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.linkBtn, (resendCooldown > 0 || otpLoading) && styles.linkBtnDisabled]}
                onPress={handleResend}
                disabled={resendCooldown > 0 || otpLoading}
              >
                <Text style={[styles.linkText, resendCooldown > 0 && styles.linkTextMuted]}>
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Render: new PIN step ─────────────────────────────────────────────────────

  if (step === 'new_pin') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={styles.top}>
            <Text style={styles.heading}>Create new PIN</Text>
            <Text style={styles.subheading}>Enter a new 4-digit PIN</Text>

            <View style={styles.dotsRow}>
              {[0, 1, 2, 3].map(i => (
                <View
                  key={i}
                  style={[styles.dot, newPin.length > i && styles.dotFilled]}
                />
              ))}
            </View>
          </View>

          <View style={styles.keypad}>
            {KEYS.map((key, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.key,
                  key === '' && styles.keyHidden,
                  newPinLoading && key !== '' && styles.keyDisabled,
                ]}
                onPress={() => handleNewPinKey(key)}
                disabled={key === '' || newPinLoading}
                activeOpacity={0.6}
              >
                <Text style={[styles.keyText, key === '⌫' && styles.keyDelete]}>{key}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.saveButton, (newPin.length < 4 || newPinLoading) && styles.saveButtonDisabled]}
            onPress={handleSaveNewPin}
            disabled={newPin.length < 4 || newPinLoading}
          >
            {newPinLoading
              ? <ActivityIndicator color={COLORS.white} />
              : <Text style={styles.saveButtonText}>Save PIN</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: PIN entry step (default) ─────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.top}>
          <Text style={styles.heading}>Welcome back, {displayName}</Text>

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

        <View style={styles.keypad}>
          {KEYS.map((key, idx) => (
            <TouchableOpacity
              key={idx}
              style={[
                styles.key,
                key === '' && styles.keyHidden,
                (locked || loading) && key !== '' && styles.keyDisabled,
              ]}
              onPress={() => handlePinKey(key)}
              disabled={key === '' || locked || loading}
              activeOpacity={0.6}
            >
              {loading && key === pin[pin.length - 1] ? (
                <ActivityIndicator size="small" color={COLORS.teal500} />
              ) : (
                <Text style={[styles.keyText, key === '⌫' && styles.keyDelete]}>{key}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.linkBtn} onPress={handleForgotPin} disabled={loading}>
          <Text style={styles.linkText}>Forgot PIN?</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  flex: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 32,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backRow: { alignSelf: 'flex-start', marginBottom: 8 },
  backText: { fontSize: 16, color: COLORS.gray500 },
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
    lineHeight: 22,
  },
  phoneHighlight: { color: COLORS.text, fontWeight: '600' },
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
  dotFilled: { backgroundColor: COLORS.teal500 },
  dotLocked: { borderColor: COLORS.error },
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
  keyHidden: { backgroundColor: 'transparent' },
  keyDisabled: { opacity: 0.4 },
  keyText: { fontSize: 24, fontWeight: '500', color: COLORS.text },
  keyDelete: { fontSize: 20, color: COLORS.gray500 },
  otpInput: {
    fontSize: 36,
    fontWeight: 'bold',
    letterSpacing: 8,
    borderWidth: 2,
    borderColor: COLORS.teal500,
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 24,
    color: COLORS.text,
    width: '100%',
    textAlign: 'center',
  },
  saveButton: {
    backgroundColor: COLORS.teal500,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: { backgroundColor: COLORS.teal100 },
  saveButtonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  linkBtn: { padding: 10 },
  linkBtnDisabled: {},
  linkText: { fontSize: 14, color: COLORS.teal500, fontWeight: '600' },
  linkTextMuted: { color: COLORS.textLight },
});
