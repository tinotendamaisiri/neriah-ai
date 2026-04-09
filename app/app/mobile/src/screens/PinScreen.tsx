// src/screens/PinScreen.tsx
// Device-local PIN lock screen.
//
// Two usage patterns:
//   1. Overlay (cold start verify) — rendered directly:
//        <PinScreen onUnlock={callback} />
//   2. Navigation screen (setup / change / remove):
//        navigation.navigate('PinLock', { mode: 'setup' | 'change' | 'remove' })
//
// Mode summary:
//   verify  — enter PIN to unlock the app (overlay usage)
//   setup   — enter + confirm a new PIN (no existing PIN required)
//   change  — verify current PIN, then enter + confirm new PIN
//   remove  — verify current PIN, then delete it

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../constants/colors';
import { hasPin, removePin, setPin, verifyPin } from '../services/pinLock';
import { requestLoginOtp, verifyOtp } from '../services/api';
import { useAuth } from '../context/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScreenMode = 'verify' | 'setup' | 'change' | 'remove';

// Internal phase within a session
type Phase =
  | 'verify'   // asking for the existing PIN (verify mode, or first step of change/remove)
  | 'enter'    // entering first PIN (setup, or second step of change)
  | 'confirm'; // confirming the entered PIN

interface PinScreenProps {
  /** When provided the component is in overlay/verify mode (cold start lock). */
  onUnlock?: () => void;
  /** Called when user chose to "Forgot PIN" — handle logout externally */
  onForgotPin?: () => void;
  /** Navigation route params — present when used as a navigator screen */
  route?: { params?: { mode?: ScreenMode } };
}

// ── Shake animation ───────────────────────────────────────────────────────────

function useShake() {
  const anim = useRef(new Animated.Value(0)).current;
  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(anim, { toValue: 10,  duration: 60,  useNativeDriver: true }),
      Animated.timing(anim, { toValue: -10, duration: 60,  useNativeDriver: true }),
      Animated.timing(anim, { toValue: 8,   duration: 60,  useNativeDriver: true }),
      Animated.timing(anim, { toValue: -8,  duration: 60,  useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0,   duration: 60,  useNativeDriver: true }),
    ]).start();
  }, [anim]);
  return { anim, shake };
}

// ── Dot indicator ─────────────────────────────────────────────────────────────

function PinDots({ value, error }: { value: string; error: boolean }) {
  return (
    <View style={styles.dotsRow}>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={[
            styles.dot,
            value.length > i && styles.dotFilled,
            error && styles.dotError,
          ]}
        />
      ))}
    </View>
  );
}

// ── Number pad ────────────────────────────────────────────────────────────────

const PAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

function NumPad({ onPress }: { onPress: (key: string) => void }) {
  return (
    <View style={styles.pad}>
      {PAD_ROWS.map((row, r) => (
        <View key={r} style={styles.padRow}>
          {row.map((key) =>
            key === '' ? (
              <View key="empty" style={styles.padEmpty} />
            ) : (
              <TouchableOpacity
                key={key}
                style={styles.padKey}
                onPress={() => onPress(key)}
                activeOpacity={0.6}
              >
                <Text style={key === '⌫' ? styles.padBackspace : styles.padKeyText}>
                  {key}
                </Text>
              </TouchableOpacity>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PinScreen({ onUnlock, onForgotPin, route }: PinScreenProps) {
  const navigation = useNavigation<any>();
  const { user, login } = useAuth();
  const isOverlay = Boolean(onUnlock);
  const mode: ScreenMode = isOverlay ? 'verify' : (route?.params?.mode ?? 'setup');

  // Derived: which phase are we starting in?
  const initialPhase: Phase =
    mode === 'verify' || mode === 'change' || mode === 'remove' ? 'verify' : 'enter';

  const [phase, setPhase]           = useState<Phase>(initialPhase);
  const [input, setInput]           = useState('');
  const [firstPin, setFirstPin]     = useState('');
  const [errorMsg, setErrorMsg]     = useState('');
  const [wrongCount, setWrongCount] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [countdown, setCountdown]   = useState(0);

  // ── Forgot PIN OTP state ─────────────────────────────────────────────────────
  const [fpStep, setFpStep]               = useState<'idle' | 'otp'>('idle');
  const [fpVerificationId, setFpVerificationId] = useState('');
  const [fpOtp, setFpOtp]               = useState('');
  const [fpLoading, setFpLoading]         = useState(false);
  const [fpCooldown, setFpCooldown]       = useState(0);
  const fpInputRef = useRef<TextInput>(null);

  const { anim, shake } = useShake();

  // ── Lockout countdown timer ──────────────────────────────────────────────
  useEffect(() => {
    if (!lockedUntil) return;
    const tick = setInterval(() => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null);
        setCountdown(0);
        setWrongCount(0);
        clearInterval(tick);
      } else {
        setCountdown(remaining);
      }
    }, 500);
    return () => clearInterval(tick);
  }, [lockedUntil]);

  // ── Forgot PIN: cooldown tick ────────────────────────────────────────────
  useEffect(() => {
    if (fpCooldown <= 0) return;
    const t = setTimeout(() => setFpCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [fpCooldown]);

  // ── Forgot PIN: auto-submit when 6 digits entered ────────────────────────
  useEffect(() => {
    if (fpStep === 'otp' && fpOtp.length === 6) handleFpOtpVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fpOtp]);

  // ── Auto-submit when 4 digits entered ────────────────────────────────────
  useEffect(() => {
    if (input.length === 4) {
      handleSubmit(input);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // ── Number pad handler ───────────────────────────────────────────────────
  const handleKey = useCallback((key: string) => {
    if (lockedUntil) return;
    if (key === '⌫') {
      setInput((p) => p.slice(0, -1));
      setErrorMsg('');
      return;
    }
    if (input.length < 4) {
      setInput((p) => p + key);
      setErrorMsg('');
    }
  }, [input.length, lockedUntil]);

  // ── Core submit logic ────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (pin: string) => {
    setInput('');

    // ── Verify phase ────────────────────────────────────────────────────────
    if (phase === 'verify') {
      const ok = await verifyPin(pin);
      if (!ok) {
        const newCount = wrongCount + 1;
        setWrongCount(newCount);
        shake();
        if (newCount >= 5) {
          const until = Date.now() + 30_000;
          setLockedUntil(until);
          setCountdown(30);
          setErrorMsg('Too many attempts. Please wait 30 seconds.');
        } else {
          setErrorMsg(`Incorrect PIN. ${5 - newCount} attempt${5 - newCount !== 1 ? 's' : ''} remaining.`);
        }
        return;
      }

      // Correct PIN
      setWrongCount(0);
      setErrorMsg('');

      if (mode === 'verify') {
        // Overlay unlock
        onUnlock?.();
      } else if (mode === 'change') {
        // Verified old PIN → now set a new one
        setPhase('enter');
      } else if (mode === 'remove') {
        // Verified → delete PIN
        await removePin();
        Alert.alert('PIN removed', 'Your app lock PIN has been removed.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
      return;
    }

    // ── Enter phase (first entry of new PIN) ────────────────────────────────
    if (phase === 'enter') {
      setFirstPin(pin);
      setPhase('confirm');
      return;
    }

    // ── Confirm phase ───────────────────────────────────────────────────────
    if (pin !== firstPin) {
      shake();
      setErrorMsg("PINs don't match. Try again.");
      setFirstPin('');
      setPhase('enter');
      return;
    }

    // Match — save PIN
    try {
      await setPin(pin);
      Alert.alert('PIN saved', 'Your app lock PIN has been set.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Could not save PIN. Please try again.');
      setFirstPin('');
      setPhase('enter');
    }
  }, [phase, wrongCount, firstPin, mode, onUnlock, shake, navigation]);

  // ── Forgot PIN: send OTP ─────────────────────────────────────────────────
  const handleForgotPin = () => {
    const phone = user?.phone;
    if (!phone) return;
    Alert.alert(
      'Forgot PIN?',
      'We\'ll send a verification code to your phone to confirm your identity.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send code',
          onPress: async () => {
            setFpLoading(true);
            try {
              const res = await requestLoginOtp(phone);
              setFpVerificationId(res.verification_id);
              setFpCooldown(60);
              setFpOtp('');
              setFpStep('otp');
              setTimeout(() => fpInputRef.current?.focus(), 350);
            } catch (err: any) {
              const status = err?.status ?? err?.response?.status;
              Alert.alert(
                'Could not send code',
                status === 429 ? 'Please wait a moment and try again.' : 'Please check your connection and try again.',
              );
            } finally {
              setFpLoading(false);
            }
          },
        },
      ],
    );
  };

  // ── Forgot PIN: OTP verify ────────────────────────────────────────────────
  const handleFpOtpVerify = async () => {
    if (fpOtp.length !== 6) return;
    setFpLoading(true);
    try {
      const response = await verifyOtp({ verification_id: fpVerificationId, otp_code: fpOtp });
      // Re-login so JWT is fresh, then remove PIN
      await login(response);
      await removePin();
      setFpStep('idle');
      setFpOtp('');

      // Prompt user to set a new PIN or skip
      Alert.alert(
        'Secure your account',
        'Would you like to set a new PIN?',
        [
          {
            text: 'Set PIN',
            onPress: () => {
              setInput('');
              setFirstPin('');
              setErrorMsg('');
              setPhase('enter');
            },
          },
          {
            text: 'Skip',
            style: 'cancel',
            onPress: () => onUnlock?.(),
          },
        ],
        { cancelable: false },
      );
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 400) {
        Alert.alert('Incorrect code', 'The code you entered is wrong. Please try again.');
      } else if (status === 429) {
        Alert.alert('Too many attempts', 'Please request a new code.');
        setFpStep('idle');
      } else {
        Alert.alert('Error', 'Something went wrong. Please try again.');
      }
      setFpOtp('');
    } finally {
      setFpLoading(false);
    }
  };

  const handleFpResend = async () => {
    const phone = user?.phone;
    if (!phone) return;
    setFpLoading(true);
    try {
      const res = await requestLoginOtp(phone);
      setFpVerificationId(res.verification_id);
      setFpCooldown(60);
      setFpOtp('');
    } catch {
      Alert.alert('Could not resend', 'Please wait and try again.');
    } finally {
      setFpLoading(false);
    }
  };

  // ── Title & subtitle based on current phase/mode ─────────────────────────
  const title = (() => {
    if (phase === 'verify') {
      if (mode === 'remove') return 'Confirm to remove PIN';
      if (mode === 'change') return 'Enter current PIN';
      return 'Enter your PIN';
    }
    if (phase === 'enter') return 'Set a new PIN';
    return 'Confirm your PIN';
  })();

  const subtitle = (() => {
    if (phase === 'verify') return 'Enter your 4-digit app lock PIN';
    if (phase === 'enter')  return 'Choose a 4-digit PIN';
    return 'Enter the same PIN again';
  })();

  const isLocked = Boolean(lockedUntil);

  // ── Render: Forgot PIN OTP step ──────────────────────────────────────────
  if (fpStep === 'otp') {
    return (
      <SafeAreaView style={styles.otpSafe}>
        <KeyboardAvoidingView
          style={styles.otpFlex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.otpContainer}>
            <TouchableOpacity style={styles.backBtn} onPress={() => { setFpStep('idle'); setFpOtp(''); }}>
              <Text style={styles.backBtnText}>← Back</Text>
            </TouchableOpacity>

            <View style={styles.logo}>
              <Text style={styles.logoText}>N</Text>
            </View>

            <Text style={styles.title}>Verify your identity</Text>
            <Text style={styles.subtitle}>
              Enter the code sent to your phone
            </Text>

            <TextInput
              ref={fpInputRef}
              style={styles.otpInput}
              value={fpOtp}
              onChangeText={v => setFpOtp(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="------"
              placeholderTextColor={COLORS.gray200}
              textAlign="center"
              editable={!fpLoading}
            />

            <TouchableOpacity
              style={[styles.otpBtn, (fpLoading || fpOtp.length < 6) && styles.otpBtnDisabled]}
              onPress={handleFpOtpVerify}
              disabled={fpLoading || fpOtp.length < 6}
            >
              {fpLoading
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.otpBtnText}>Verify</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={handleFpResend}
              disabled={fpCooldown > 0 || fpLoading}
            >
              <Text style={[styles.forgotText, (fpCooldown > 0 || fpLoading) && styles.forgotTextMuted]}>
                {fpCooldown > 0 ? `Resend in ${fpCooldown}s` : 'Resend code'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {/* Back button (navigation mode only) */}
      {!isOverlay && (
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
      )}

      {/* Neriah brand mark */}
      <View style={styles.logo}>
        <Text style={styles.logoText}>N</Text>
      </View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      {/* Dot indicator with shake */}
      <Animated.View style={{ transform: [{ translateX: anim }] }}>
        <PinDots value={input} error={Boolean(errorMsg)} />
      </Animated.View>

      {/* Error / countdown */}
      {errorMsg ? (
        <Text style={styles.errorText}>{errorMsg}</Text>
      ) : isLocked ? (
        <Text style={styles.errorText}>Retry in {countdown}s</Text>
      ) : null}

      {/* Number pad */}
      <NumPad onPress={handleKey} />

      {/* Forgot PIN — only in overlay verify mode */}
      {isOverlay && phase === 'verify' && (
        <TouchableOpacity style={styles.forgotBtn} onPress={handleForgotPin}>
          <Text style={styles.forgotText}>Forgot PIN?</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  backBtn: {
    position: 'absolute',
    top: 56,
    left: 20,
  },
  backBtnText: { fontSize: 16, color: COLORS.gray500 },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.teal500,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoText: { fontSize: 28, fontWeight: '800', color: COLORS.white },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.gray500,
    marginBottom: 36,
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 16,
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
  dotError: { borderColor: COLORS.error },
  errorText: {
    color: COLORS.error,
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
    minHeight: 18,
  },
  // Number pad
  pad: {
    width: '100%',
    maxWidth: 300,
    marginTop: 8,
    gap: 8,
  },
  padRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  padKey: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  padEmpty: {
    width: 76,
    height: 76,
  },
  padKeyText: {
    fontSize: 26,
    fontWeight: '500',
    color: COLORS.text,
  },
  padBackspace: {
    fontSize: 22,
    color: COLORS.gray500,
  },
  forgotBtn: {
    marginTop: 32,
  },
  forgotText: {
    color: COLORS.teal500,
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  forgotTextMuted: { color: COLORS.textLight },
  // ── Forgot PIN OTP step styles ─────────────────────────────────────────────
  otpSafe: { flex: 1, backgroundColor: COLORS.white },
  otpFlex: { flex: 1 },
  otpContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  otpBtn: {
    backgroundColor: COLORS.teal500,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 8,
  },
  otpBtnDisabled: { backgroundColor: COLORS.teal100 },
  otpBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
});
