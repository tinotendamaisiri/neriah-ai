// src/screens/OTPScreen.tsx
// 6-digit OTP verification screen.
// Works for both login and registration — the backend determines which based on the verification_id.
// Shows dynamic channel message: WhatsApp (green) or SMS (teal) based on route param.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { verifyOtp, resendOtp } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { AuthStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import { maskPhone } from '../utils/maskPhone';
import { ScreenContainer } from '../components/ScreenContainer';

type Route = RouteProp<AuthStackParamList, 'OTP'>;

const RESEND_COOLDOWN_SECONDS = 60;

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function OTPScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<Route>();
  const { phone, verification_id: initialVerificationId, debug_otp, channel } = route.params;
  const { login } = useAuth();
  const { t } = useLanguage();

  const [otp, setOtp] = useState('');
  const [verificationId, setVerificationId] = useState(initialVerificationId);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const inputRef = useRef<TextInput>(null);

  // Countdown timer for resend button
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Rate-limit countdown — auto-enables buttons when it hits zero
  useEffect(() => {
    if (rateLimitSeconds <= 0) return;
    const timer = setTimeout(() => setRateLimitSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [rateLimitSeconds]);

  // Auto-focus OTP input
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (otp.length === 6) {
      handleVerify();
    }
  }, [otp]);

  const handleVerify = async () => {
    if (otp.length !== 6) {
      Alert.alert(t('otp_enter_title'), t('otp_enter_msg'));
      return;
    }
    setLoading(true);
    try {
      const response = await verifyOtp({ verification_id: verificationId, otp_code: otp });
      await login(response);
      // AuthContext login → App re-renders → navigates to main tabs automatically
    } catch (err: any) {
      // Axios interceptor normalises errors to { title, message, status, _raw }
      // so err.response is stripped — read err.message for the server error text.
      const status = err?.status ?? err?.response?.status;
      const serverMsg: string | undefined = err?.message ?? err?.response?.data?.error;
      if (status === 400 || status === 410) {
        // 400 = wrong code, 410 = expired — backend currently returns 400 for both;
        // handle both here so either status triggers the "request a new code" path
        // when the message indicates expiry, and "incorrect" otherwise.
        const isExpired = serverMsg?.toLowerCase().includes('expir') || status === 410;
        if (isExpired) {
          Alert.alert(t('otp_expired'), t('otp_expired_msg'));
        } else {
          Alert.alert(t('otp_incorrect'), serverMsg ?? t('otp_incorrect'));
        }
      } else if (status === 429) {
        const retryAfter: number = err?.retry_after ?? 0;
        if (retryAfter > 0) {
          setRateLimitSeconds(retryAfter);
        } else {
          Alert.alert(t('otp_too_many'), serverMsg ?? t('otp_too_many'));
        }
      } else {
        Alert.alert(t('error'), serverMsg ?? t('server_error_retry'));
      }
      setOtp('');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async (channel?: 'whatsapp' | 'sms') => {
    setLoading(true);
    try {
      const res = await resendOtp(verificationId, channel);
      setVerificationId(res.verification_id);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setOtp('');
      Alert.alert(t('code_sent_ok'), channel === 'sms' ? t('code_sent_sms') : t('code_sent_phone'));
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const retryAfter: number = err?.retry_after ?? 0;
      if (status === 429 && retryAfter > 0) {
        setRateLimitSeconds(retryAfter);
        setResendCooldown(retryAfter);
      } else {
        Alert.alert(t('error'), status === 429 ? t('too_many_attempts') : t('server_error_retry'));
      }
    } finally {
      setLoading(false);
    }
  };

  const maskedPhone = maskPhone(phone);

  // Channel-specific display — default to SMS if channel is undefined/null
  const displayChannel = channel || 'sms';
  const isWhatsApp = displayChannel === 'whatsapp';
  const isEmail    = displayChannel === 'email';
  const channelColor = isWhatsApp ? '#25D366' : COLORS.teal500;
  const channelIcon  = isWhatsApp
    ? <Ionicons name="logo-whatsapp" size={28} color="#25D366" />
    : isEmail
    ? <Ionicons name="mail-outline"  size={28} color={COLORS.teal500} />
    : <Ionicons name="chatbubble-ellipses-outline" size={28} color={COLORS.teal500} />;
  const channelLabel = isWhatsApp
    ? t('check_your_whatsapp')
    : isEmail
    ? t('check_your_email')
    : t('check_your_sms');

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{t('back')}</Text>
        </TouchableOpacity>

        {debug_otp && (
          <TouchableOpacity style={styles.devBanner} onPress={() => setOtp(debug_otp)} activeOpacity={0.7}>
            <Text style={styles.devBannerText}>Dev OTP: {debug_otp} — tap to fill</Text>
          </TouchableOpacity>
        )}

        {/* Channel icon + dynamic heading */}
        <View style={styles.channelRow}>
          {channelIcon}
          <Text style={[styles.heading, { color: channelColor, marginBottom: 0 }]}>
            {channelLabel}
          </Text>
        </View>

        <Text style={styles.heading}>{t('enter_code')}</Text>
        <Text style={styles.subheading}>
          {t('code_sent_to')}{'\n'}
          <Text style={styles.phone}>{maskedPhone}</Text>
        </Text>

        {/* Single text input — large font, centre-aligned */}
        <TextInput
          ref={inputRef}
          style={styles.otpInput}
          value={otp}
          onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="------"
          placeholderTextColor={COLORS.gray200}
          textAlign="center"
          editable={!loading}
        />

        {rateLimitSeconds > 0 && (
          <View style={styles.rateLimitBanner}>
            <Text style={styles.rateLimitText}>
              Try again in {formatCountdown(rateLimitSeconds)}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, (loading || otp.length < 6 || rateLimitSeconds > 0) && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={loading || otp.length < 6 || rateLimitSeconds > 0}
        >
          <Text style={styles.buttonText}>{loading ? t('verifying') : t('verify')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.resendButton, (resendCooldown > 0 || loading || rateLimitSeconds > 0) && styles.resendDisabled]}
          onPress={() => handleResend()}
          disabled={resendCooldown > 0 || loading || rateLimitSeconds > 0}
        >
          <Text style={[styles.resendText, (resendCooldown > 0 || rateLimitSeconds > 0) && styles.resendTextDisabled]}>
            {rateLimitSeconds > 0
              ? `Try again in ${formatCountdown(rateLimitSeconds)}`
              : resendCooldown > 0
              ? `${t('resend_in')} ${resendCooldown}s`
              : t('resend_code')}
          </Text>
        </TouchableOpacity>

        {resendCooldown <= 0 && !loading && (
          <TouchableOpacity style={styles.smsLink} onPress={() => handleResend('sms')}>
            <Text style={styles.smsLinkText}>{t('send_via_sms')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.white },
  container: { flex: 1, padding: 24, paddingTop: 60 },
  backButton: { marginBottom: 24 },
  backText: { fontSize: 16, color: COLORS.gray500 },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  heading: { fontSize: 28, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  subheading: { fontSize: 15, color: COLORS.gray500, lineHeight: 22, marginBottom: 32 },
  phone: { color: COLORS.text, fontWeight: '600' },
  otpInput: {
    fontSize: 36, fontWeight: 'bold', letterSpacing: 8,
    borderWidth: 2, borderColor: COLORS.teal500, borderRadius: 12,
    paddingVertical: 16, marginBottom: 24, color: COLORS.text,
  },
  button: {
    backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 16, alignItems: 'center', marginBottom: 16,
  },
  buttonDisabled: { backgroundColor: COLORS.teal100 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  resendButton: { alignItems: 'center', padding: 8 },
  resendDisabled: {},
  resendText: { fontSize: 15, color: COLORS.teal500, fontWeight: '600' },
  resendTextDisabled: { color: COLORS.textLight },
  smsLink: { alignItems: 'center', paddingVertical: 6 },
  smsLinkText: { fontSize: 13, color: COLORS.gray500 },
  rateLimitBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    alignItems: 'center',
  },
  rateLimitText: { fontSize: 15, fontWeight: '700', color: '#dc2626' },
  devBanner: {
    backgroundColor: '#fef08a',
    borderWidth: 1,
    borderColor: '#ca8a04',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 20,
    alignItems: 'center',
  },
  devBannerText: { fontSize: 14, fontWeight: '700', color: '#713f12' },
});
