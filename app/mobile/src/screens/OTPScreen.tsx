// src/screens/OTPScreen.tsx
// 6-digit OTP verification screen.
// Works for both login and registration — the backend determines which based on the verification_id.

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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { verifyOtp, resendOtp } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { AuthStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import { maskPhone } from '../utils/maskPhone';

type Route = RouteProp<AuthStackParamList, 'OTP'>;

const RESEND_COOLDOWN_SECONDS = 60;

export default function OTPScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<Route>();
  const { phone, verification_id: initialVerificationId, debug_otp } = route.params;
  const { login } = useAuth();
  const { t } = useLanguage();

  const [otp, setOtp] = useState('');
  const [verificationId, setVerificationId] = useState(initialVerificationId);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRef = useRef<TextInput>(null);

  // Countdown timer for resend button
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

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
      const status = err?.response?.status ?? err?.status;
      const serverMsg = err?.response?.data?.error;
      if (status === 400) {
        Alert.alert(t('otp_incorrect'), serverMsg ?? t('otp_incorrect'));
      } else if (status === 410) {
        Alert.alert(t('otp_expired'), t('otp_expired_msg'));
      } else if (status === 429) {
        Alert.alert(t('otp_too_many'), serverMsg ?? t('otp_too_many'));
      } else {
        Alert.alert(t('error'), t('server_error_retry'));
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
      const status = err?.response?.status ?? err?.status;
      if (status === 429) {
        Alert.alert(t('error'), t('too_many_attempts'));
      } else {
        Alert.alert(t('error'), t('server_error_retry'));
      }
    } finally {
      setLoading(false);
    }
  };

  const maskedPhone = maskPhone(phone);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{t('back')}</Text>
        </TouchableOpacity>

        {debug_otp && (
          <TouchableOpacity style={styles.devBanner} onPress={() => setOtp(debug_otp)} activeOpacity={0.7}>
            <Text style={styles.devBannerText}>Dev OTP: {debug_otp} — tap to fill</Text>
          </TouchableOpacity>
        )}

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

        <TouchableOpacity
          style={[styles.button, (loading || otp.length < 6) && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={loading || otp.length < 6}
        >
          <Text style={styles.buttonText}>{loading ? t('verifying') : t('verify')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.resendButton, (resendCooldown > 0 || loading) && styles.resendDisabled]}
          onPress={() => handleResend()}
          disabled={resendCooldown > 0 || loading}
        >
          <Text style={[styles.resendText, resendCooldown > 0 && styles.resendTextDisabled]}>
            {resendCooldown > 0 ? `${t('resend_in')} ${resendCooldown}s` : t('resend_code')}
          </Text>
        </TouchableOpacity>

        {resendCooldown <= 0 && !loading && (
          <TouchableOpacity style={styles.smsLink} onPress={() => handleResend('sms')}>
            <Text style={styles.smsLinkText}>{t('send_via_sms')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.white },
  container: { flex: 1, padding: 24, paddingTop: 60 },
  backButton: { marginBottom: 32 },
  backText: { fontSize: 16, color: COLORS.gray500 },
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
