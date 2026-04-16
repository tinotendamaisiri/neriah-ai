// src/screens/EditProfileScreen.tsx
// Editable profile screen. Two-step: edit form → OTP verification → save.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { requestProfileOtp, updateProfile, resendOtp } from '../services/api';
import { RootStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import { maskPhone } from '../utils/maskPhone';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Prof', 'Sir', 'Eng', 'Rev'];
const RESEND_COOLDOWN = 60;

export default function EditProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { user, updateUser } = useAuth();

  // ── Edit step state ──────────────────────────────────────────────────────────
  const [title, setTitle] = useState(user?.title ?? '');
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [surname, setSurname] = useState(user?.surname ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');

  // ── OTP verify step state ────────────────────────────────────────────────────
  const [step, setStep] = useState<'edit' | 'verify'>('edit');
  const [verificationId, setVerificationId] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN);
  const otpInputRef = useRef<TextInput>(null);

  // ── Success banner ───────────────────────────────────────────────────────────
  const [showSuccess, setShowSuccess] = useState(false);
  const bannerOpacity = useRef(new Animated.Value(0)).current;

  // ── Save loading ─────────────────────────────────────────────────────────────
  const [saveLoading, setSaveLoading] = useState(false);

  // Resend cooldown timer
  useEffect(() => {
    if (step !== 'verify' || resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [step, resendCooldown]);

  // Auto-focus OTP input when entering verify step
  useEffect(() => {
    if (step === 'verify') {
      const t = setTimeout(() => otpInputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [step]);

  // Auto-submit OTP when 6 digits entered
  useEffect(() => {
    if (otp.length === 6) handleVerify();
  }, [otp]);

  const showBanner = useCallback(() => {
    setShowSuccess(true);
    Animated.sequence([
      Animated.timing(bannerOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(bannerOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      navigation.goBack();
    });
  }, [bannerOpacity, navigation]);

  const handleSave = async () => {
    if (!firstName.trim() || !surname.trim()) {
      Alert.alert('Missing fields', 'First name and surname are required.');
      return;
    }
    setSaveLoading(true);
    try {
      // Send OTP to the phone that will be verified (new phone if changing, current if not)
      const targetPhone = phone.trim() || user?.phone || '';
      const res = await requestProfileOtp(targetPhone);
      setVerificationId(res.verification_id);
      setResendCooldown(RESEND_COOLDOWN);
      setOtp('');
      setStep('verify');
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 429) {
        Alert.alert('Too many requests', 'Please wait a moment and try again.');
      } else {
        Alert.alert('Could not send code', err.message ?? 'Please check your connection and try again.');
      }
    } finally {
      setSaveLoading(false);
    }
  };

  const handleVerify = async () => {
    if (otp.length !== 6) return;
    setOtpLoading(true);
    try {
      const payload: Parameters<typeof updateProfile>[0] = {
        verification_id: verificationId,
        otp_code: otp,
      };
      if (title !== (user?.title ?? '')) payload.title = title || undefined;
      if (firstName.trim() !== (user?.first_name ?? '')) payload.first_name = firstName.trim();
      if (surname.trim() !== (user?.surname ?? '')) payload.surname = surname.trim();
      if (phone.trim() !== (user?.phone ?? '')) payload.phone = phone.trim();

      const res = await updateProfile(payload);

      // Map backend user response to AuthUser fields and persist
      const updates = {
        first_name: res.user.first_name,
        surname: res.user.surname,
        name: res.user.name,
        title: res.user.title,
        display_name: res.user.display_name,
        phone: res.user.phone,
        school: res.user.school ?? user?.school,
      };
      await updateUser(updates, res.token);

      showBanner();
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 400) {
        Alert.alert('Incorrect code', 'The code you entered is wrong. Please try again.');
      } else if (status === 429) {
        Alert.alert('Too many attempts', 'Too many wrong attempts. Please request a new code.');
        setStep('edit');
      } else if (status === 409) {
        Alert.alert('Phone taken', 'That phone number is already registered to another account.');
      } else {
        Alert.alert('Could not save', err.message ?? 'Please try again.');
      }
      setOtp('');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResend = async () => {
    setOtpLoading(true);
    try {
      const res = await resendOtp(verificationId);
      setVerificationId(res.verification_id);
      setResendCooldown(RESEND_COOLDOWN);
      setOtp('');
    } catch (err: any) {
      Alert.alert('Could not resend', 'Please wait and try again.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSchoolPress = () => {
    Alert.alert(
      'School cannot be changed',
      'Please contact Neriah Support at support@neriah.ai to update your school.',
      [{ text: 'OK' }],
    );
  };

  // ── Render: verify step ──────────────────────────────────────────────────────

  if (step === 'verify') {
    return (
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {showSuccess && (
            <Animated.View style={[styles.successBanner, { opacity: bannerOpacity }]}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
              <Text style={styles.successText}>Profile updated</Text>
            </Animated.View>
          )}

          <View style={styles.container}>
            <TouchableOpacity style={styles.backRow} onPress={() => { setStep('edit'); setOtp(''); }}>
              <Ionicons name="chevron-back" size={22} color={COLORS.gray500} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>

            <Text style={styles.heading}>Verify it's you</Text>
            <Text style={styles.subheading}>
              Enter the 6-digit code sent to{'\n'}
              <Text style={styles.phoneHighlight}>{maskPhone(phone || user?.phone || '')}</Text>
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
              onPress={handleVerify}
              disabled={otpLoading || otp.length < 6}
            >
              <Text style={styles.saveButtonText}>{otpLoading ? 'Verifying…' : 'Verify'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.resendButton, (resendCooldown > 0 || otpLoading) && styles.resendDisabled]}
              onPress={handleResend}
              disabled={resendCooldown > 0 || otpLoading}
            >
              <Text style={[styles.resendText, resendCooldown > 0 && styles.resendTextMuted]}>
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Render: edit step ────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()}>
              <Ionicons name="chevron-back" size={22} color={COLORS.gray500} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.heading}>Edit Profile</Text>
          </View>

          {/* Title chips */}
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>Title</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {TITLES.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, title === t && styles.chipSelected]}
                  onPress={() => setTitle(title === t ? '' : t)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, title === t && styles.chipTextSelected]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* First name */}
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>First name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor={COLORS.textLight}
              autoCorrect={false}
            />
          </View>

          {/* Surname */}
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>Surname</Text>
            <TextInput
              style={styles.input}
              value={surname}
              onChangeText={setSurname}
              placeholder="Surname"
              placeholderTextColor={COLORS.textLight}
              autoCorrect={false}
            />
          </View>

          {/* School — non-editable */}
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>School</Text>
            <TouchableOpacity style={styles.inputDisabled} onPress={handleSchoolPress} activeOpacity={0.8}>
              <Text style={styles.inputDisabledText} numberOfLines={1}>
                {user?.school ?? '—'}
              </Text>
              <Ionicons name="lock-closed-outline" size={15} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>

          {/* Phone */}
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>Phone number</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+263..."
              placeholderTextColor={COLORS.textLight}
              keyboardType="phone-pad"
              autoCorrect={false}
            />
            <Text style={styles.fieldHint}>
              Changing your number will require verification on the new number.
            </Text>
          </View>

          {/* Save button */}
          <TouchableOpacity
            style={[styles.saveButton, saveLoading && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saveLoading}
          >
            <Text style={styles.saveButtonText}>
              {saveLoading ? 'Sending code…' : 'Save changes'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 48 },

  header: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backText: { fontSize: 16, color: COLORS.gray500, marginLeft: 2 },
  heading: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },

  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  subheading: {
    fontSize: 15,
    color: COLORS.gray500,
    lineHeight: 22,
    marginBottom: 28,
  },
  phoneHighlight: { color: COLORS.text, fontWeight: '600' },

  section: {
    backgroundColor: COLORS.white,
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.gray500,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  fieldHint: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 6,
  },

  chipsRow: { gap: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  chipSelected: {
    backgroundColor: COLORS.teal500,
    borderColor: COLORS.teal500,
  },
  chipText: { fontSize: 14, fontWeight: '500', color: COLORS.text },
  chipTextSelected: { color: COLORS.white, fontWeight: '600' },

  input: {
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
  },
  inputDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: COLORS.background,
  },
  inputDisabledText: {
    fontSize: 16,
    color: COLORS.textLight,
    flex: 1,
  },

  saveButton: {
    backgroundColor: COLORS.teal500,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 24,
  },
  saveButtonDisabled: { backgroundColor: COLORS.teal100 },
  saveButtonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },

  // Verify step
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
    textAlign: 'center',
  },
  resendButton: { alignItems: 'center', padding: 10, marginTop: 4 },
  resendDisabled: {},
  resendText: { fontSize: 15, color: COLORS.teal500, fontWeight: '600' },
  resendTextMuted: { color: COLORS.textLight },

  // Success banner
  successBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: '#16a34a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  successText: { color: COLORS.white, fontWeight: '600', fontSize: 15 },
});
