// src/screens/PhoneScreen.tsx
// Login screen — for users who already have an account.
// Reached via "Sign in" from the RoleSelect landing screen.
//
// Flow:
//   POST /auth/login
//   - 200: account exists (teacher or student) → OTPScreen
//   - 404: no account found → back to RoleSelect landing

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { requestLoginOtp } from '../services/api';
import { showError } from '../utils/showError';
import { useLanguage } from '../context/LanguageContext';
import { AuthStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import PhoneInput from '../components/PhoneInput';
const logoImage = require('../../assets/icon-transparent.png');

// E.164: + followed by 10–15 digits
const E164_RE = /^\+[1-9]\d{9,14}$/;

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Phone'>;

export default function PhoneScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useLanguage();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState('');

  const handleContinue = async () => {
    const cleanPhone = phone.trim();
    setPhoneError('');

    if (!cleanPhone || !E164_RE.test(cleanPhone)) {
      setPhoneError(t('invalid_number_msg'));
      return;
    }

    setLoading(true);
    try {
      const res = await requestLoginOtp(cleanPhone);
      navigation.navigate('OTP', {
        phone: cleanPhone,
        verification_id: res.verification_id,
        ...(res.debug_otp ? { debug_otp: res.debug_otp } : {}),
      });
    } catch (err: any) {
      if (err.status === 404 || err.response?.status === 404 || err._raw?.response?.status === 404) {
        Alert.alert(
          t('no_account_found'),
          t('no_account_msg'),
          [
            { text: t('cancel'), style: 'cancel' },
            { text: t('register'), onPress: () => navigation.navigate('RoleSelect') },
          ],
        );
      } else {
        showError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        {/* Branding */}
        <View style={styles.brand}>
          <Image source={logoImage} style={styles.logoMark} />
          <Text style={styles.appName}>Neriah</Text>
          <Text style={styles.tagline}>{t('tagline')}</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>{t('phone_label')}</Text>
          <PhoneInput
            onChangePhone={p => { setPhone(p); setPhoneError(''); }}
            error={!!phoneError}
            disabled={loading}
          />
          {phoneError ? <Text style={styles.fieldError}>{phoneError}</Text> : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? t('continue_checking') : t('continue_btn')}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.legal}>{t('phone_legal')}</Text>

        <TouchableOpacity style={styles.registerLink} onPress={() => navigation.navigate('RoleSelect')}>
          <Text style={styles.registerLinkText}>{t('new_user_register')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.white },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: 48 },
  logoMark: {
    width: 80, height: 80, marginBottom: 12,
  },
  appName: { fontSize: 28, fontWeight: 'bold', color: COLORS.gray900 },
  tagline: { fontSize: 14, color: COLORS.gray500, marginTop: 4, textAlign: 'center' },
  form: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.gray900, marginTop: 8 },
  fieldError: { color: COLORS.error, fontSize: 13, marginTop: 4 },
  button: {
    marginTop: 24, backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 16, alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: COLORS.teal100 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  legal: {
    marginTop: 40, textAlign: 'center', fontSize: 12, color: COLORS.textLight, lineHeight: 18,
  },
  registerLink: { marginTop: 16, alignItems: 'center' },
  registerLinkText: { fontSize: 14, color: COLORS.teal500, fontWeight: '600' },
});
