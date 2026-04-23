// src/screens/SettingsScreen.tsx
// Teacher profile, account settings, and logout.

import React, { useState, useEffect, useRef } from 'react';
import {
  Animated, View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Linking,
  Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { LangCode } from '../i18n/translations';
import { deletePin, requestProfileOtp, updateProfile } from '../services/api';
import { RootStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import { maskPhone } from '../utils/maskPhone';
import { useModel } from '../context/ModelContext';
import { MODEL_DISPLAY_NAME, MODEL_SIZE_LABEL } from '../services/modelManager';
import { ScreenContainer } from '../components/ScreenContainer';

const LANGUAGES: Array<{ code: LangCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'sn', label: 'Shona' },
  { code: 'nd', label: 'Ndebele' },
];

type Nav = NativeStackNavigationProp<RootStackParamList>;

function DownloadProgress({ progress, paused }: { progress: number; paused: boolean }) {
  const animWidth = useRef(new Animated.Value(0)).current;
  const [displayPct, setDisplayPct] = useState(Math.round(progress));
  const [stalled, setStalled] = useState(false);
  const lastUpdate = useRef(0);
  const lastProgress = useRef(progress);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.timing(animWidth, {
      toValue: progress,
      duration: 1000,
      useNativeDriver: false,
    }).start();

    const now = Date.now();
    if (now - lastUpdate.current > 1000 || progress >= 100 || progress === 0) {
      setDisplayPct(Math.round(progress));
      lastUpdate.current = now;
    }

    // Detect stall: if progress hasn't changed for 5 seconds, show paused
    if (progress !== lastProgress.current) {
      lastProgress.current = progress;
      setStalled(false);
      if (stallTimer.current) clearTimeout(stallTimer.current);
      stallTimer.current = setTimeout(() => setStalled(true), 5000);
    }

    return () => { if (stallTimer.current) clearTimeout(stallTimer.current); };
  }, [progress]);

  const isPaused = paused || stalled;
  const barColor = isPaused ? '#F59E0B' : COLORS.teal500;
  const label = isPaused
    ? `Paused — ${displayPct}% complete. Will resume when connected.`
    : `Downloading — ${displayPct}% complete`;

  const widthInterp = animWidth.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });
  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
      <View style={{ height: 6, backgroundColor: COLORS.gray200, borderRadius: 3, overflow: 'hidden' }}>
        <Animated.View style={{ height: 6, borderRadius: 3, backgroundColor: barColor, width: widthInterp }} />
      </View>
      <Text style={{ fontSize: 12, color: isPaused ? '#F59E0B' : COLORS.gray500, marginTop: 6 }}>
        {label}
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { user, logout, hasPin: ctxHasPin, markPinSet } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const isFocused = useIsFocused();
  const {
    status: modelStatus,
    progress: modelProgress,
    variant: modelVariant,
    capability: modelCapability,
    wifiOnly,
    errorMessage: modelError,
    pauseDownload: modelPause,
    resumeDownload: modelResume,
    cancelDownload: modelCancel,
    deleteModel,
    setWifiOnly,
    acceptDownload,
    neverShowNudge,
  } = useModel();

  // Re-read SecureStore every time this screen gains focus so the PIN row
  // updates immediately after returning from SetPinScreen, regardless of
  // whether AuthContext has been notified yet.
  const [hasPin, setHasPinLocal] = useState(ctxHasPin);
  useEffect(() => {
    if (!isFocused) return;
    SecureStore.getItemAsync('neriah_has_pin').then(val => {
      const pinSet = val === 'true';
      setHasPinLocal(pinSet);
      if (pinSet && !ctxHasPin) markPinSet();
    });
  }, [isFocused]);

  // ── OTP verification modal (for Change PIN and Remove PIN) ───────────────────
  const [otpMode, setOtpMode] = useState<'change' | 'remove' | null>(null);
  const [verificationId, setVerificationId] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t2 = setTimeout(() => setResendCooldown(s => s - 1), 1000);
    return () => clearTimeout(t2);
  }, [resendCooldown]);

  useEffect(() => {
    if (otpMode && otp.length === 6) handleOtpVerify();
  }, [otp]);

  const openOtpModal = async (mode: 'change' | 'remove') => {
    const phone = user?.phone;
    if (!phone) return;
    setOtp('');
    setOtpLoading(true);
    try {
      const res = await requestProfileOtp(phone);
      setVerificationId(res.verification_id);
      setResendCooldown(60);
      setOtpMode(mode);
      setTimeout(() => otpInputRef.current?.focus(), 350);
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      Alert.alert(
        'Could not send code',
        status === 429 ? 'Please wait a moment and try again.' : 'Please check your connection and try again.',
      );
    } finally {
      setOtpLoading(false);
    }
  };

  const handleOtpVerify = async () => {
    if (otp.length !== 6) return;
    setOtpLoading(true);
    try {
      await updateProfile({ verification_id: verificationId, otp_code: otp });
      const mode = otpMode;
      setOtpMode(null);
      setOtp('');
      if (mode === 'change') {
        navigation.navigate('SetPin');
      } else {
        // Remove PIN
        await deletePin().catch(() => {});
        setHasPinLocal(false);
        await SecureStore.deleteItemAsync('neriah_has_pin');
        Alert.alert(t('pin_removed'), t('pin_removed_msg'));
      }
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 400) {
        Alert.alert('Incorrect code', 'The code you entered is wrong. Please try again.');
      } else if (status === 429) {
        Alert.alert('Too many attempts', 'Please request a new code.');
        setOtpMode(null);
      } else {
        Alert.alert('Error', 'Something went wrong. Please try again.');
      }
      setOtp('');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResendOtp = async () => {
    const phone = user?.phone;
    if (!phone) return;
    setOtpLoading(true);
    try {
      const res = await requestProfileOtp(phone);
      setVerificationId(res.verification_id);
      setResendCooldown(60);
      setOtp('');
    } catch {
      Alert.alert('Could not resend', 'Please wait and try again.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t('log_out'), t('log_out_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('log_out'), style: 'destructive', onPress: logout },
    ]);
  };

  const handleSetPin = () => navigation.navigate('SetPin');

  const handleLanguage = () => {
    Alert.alert(
      t('language'),
      'Choose your preferred language',
      [
        ...LANGUAGES.map(l => ({
          text: l.code === language ? `${l.label} ✓` : l.label,
          onPress: () => setLanguage(l.code),
        })),
        { text: t('cancel'), style: 'cancel' },
      ],
    );
  };

  const languageLabel = LANGUAGES.find(l => l.code === language)?.label ?? 'English';

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Account deletion is not self-service. Please contact Neriah Support to request account deletion. We will process your request within 48 hours.',
      [
        {
          text: 'Contact Support',
          onPress: () => {
            const subject = encodeURIComponent('Account Deletion Request');
            const body = encodeURIComponent(`Hi Neriah Support,\n\nI would like to delete my account.\n\nPhone: ${user?.phone ?? ''}`);
            Linking.openURL(`mailto:support@neriah.ai?subject=${subject}&body=${body}`);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const displayName = user
    ? `${user.title ? user.title + ' ' : ''}${user.surname ?? user.first_name ?? ''}`.trim()
    : '';

  return (
    <ScreenContainer scroll={false} edges={['top', 'left', 'right']} style={{ backgroundColor: COLORS.background }}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.heading}>{t('settings')}</Text>
      </View>

      {/* Profile */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile')}</Text>
        <TouchableOpacity
          style={styles.profileCard}
          onPress={() => navigation.navigate('EditProfile')}
          activeOpacity={0.7}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user?.surname ?? user?.first_name)?.[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profilePhone}>{maskPhone(user?.phone ?? '')}</Text>
            {user?.school && (
              <Text style={styles.profileSchool}>{user.school}</Text>
            )}
          </View>
          <Ionicons name="pencil-outline" size={18} color={COLORS.teal500} />
        </TouchableOpacity>
      </View>

      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('subscription')}</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('school')}</Text>
          <Text style={styles.infoValue} numberOfLines={1}>{user?.school ?? '—'}</Text>
        </View>

        <View style={styles.divider} />

        {hasPin ? (
          <>
            <TouchableOpacity style={styles.settingsRow} onPress={() => openOtpModal('change')} disabled={otpLoading}>
              <Text style={styles.settingsRowLabel}>Change PIN</Text>
              <Text style={styles.rowChevron}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.settingsRow} onPress={() => openOtpModal('remove')} disabled={otpLoading}>
              <Text style={[styles.settingsRowLabel, { color: COLORS.error }]}>Remove PIN</Text>
              <Text style={styles.rowChevron}>›</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.settingsRow} onPress={handleSetPin}>
            <Text style={styles.settingsRowLabel}>{t('set_pin')}</Text>
            <Text style={styles.rowChevron}>›</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={[styles.settingsRow, styles.lastRow]} onPress={handleLanguage}>
          <Text style={styles.settingsRowLabel}>{t('language')}</Text>
          <View style={styles.rowRight}>
            <Text style={styles.rowValue}>{languageLabel}</Text>
            <Text style={styles.rowChevron}>›</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Offline Mode */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Offline Mode</Text>

        <View style={styles.card}>
          {/* Toggle row */}
          <View style={[styles.settingsRow, { borderTopWidth: 0 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsRowLabel}>Enable offline mode</Text>
              <Text style={{ fontSize: 12, color: COLORS.gray500, marginTop: 2 }}>
                Faster grading without internet. Downloads over Wi-Fi only.
              </Text>
            </View>
            <Switch
              value={modelStatus === 'done' || modelStatus === 'downloading' || modelStatus === 'paused'}
              onValueChange={(on) => {
                if (on && modelStatus !== 'done') {
                  if (modelCapability === 'cloud-only') {
                    Alert.alert('Not supported', 'This device does not have enough storage to run the offline model.');
                    return;
                  }
                  Alert.alert(
                    'Download offline model?',
                    'This will download about 3 GB over Wi-Fi. You can pause and resume anytime.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Download', onPress: acceptDownload },
                    ],
                  );
                } else if (!on && modelStatus === 'done') {
                  Alert.alert(
                    'Remove offline model?',
                    'You will need internet for grading until you re-download.',
                    [
                      { text: 'Keep', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: deleteModel },
                    ],
                  );
                }
              }}
              trackColor={{ true: COLORS.teal500, false: COLORS.border }}
              thumbColor={COLORS.white}
            />
          </View>

          {/* Progress — visible during download */}
          {(modelStatus === 'downloading' || modelStatus === 'paused') && (
            <DownloadProgress progress={modelProgress} paused={modelStatus === 'paused'} />
          )}

          {/* Ready state */}
          {modelStatus === 'done' && (
            <View style={{ paddingHorizontal: 14, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
              <Text style={{ fontSize: 13, color: COLORS.success, fontWeight: '600' }}>Offline mode ready</Text>
            </View>
          )}

          {/* Error state */}
          {modelStatus === 'error' && (
            <TouchableOpacity onPress={acceptDownload} style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
              <Text style={{ fontSize: 13, color: COLORS.error }}>Download failed — tap to retry</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* App info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('about')}</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('version')}</Text>
          <Text style={styles.infoValue}>0.1.0</Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.settingsRow} onPress={() => navigation.navigate('TermsOfService', { initialTab: 'terms' })}>
          <Text style={styles.settingsRowLabel}>Terms of Service</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingsRow} onPress={() => navigation.navigate('TermsOfService', { initialTab: 'privacy' })}>
          <Text style={styles.settingsRowLabel}>Privacy Policy</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.settingsRow, styles.lastRow]} onPress={handleDeleteAccount}>
          <Text style={[styles.settingsRowLabel, styles.deleteRowLabel]}>Delete Account</Text>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>{t('log_out')}</Text>
      </TouchableOpacity>

      {/* OTP verification modal — used for Change PIN and Remove PIN */}
      <Modal
        visible={otpMode !== null}
        animationType="slide"
        transparent
        onRequestClose={() => { setOtpMode(null); setOtp(''); }}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Verify your identity</Text>
            <Text style={styles.modalSubtitle}>
              We sent a verification code to{'\n'}
              <Text style={styles.modalPhone}>{maskPhone(user?.phone ?? '')}</Text>
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
              autoFocus
            />

            <TouchableOpacity
              style={[styles.verifyBtn, (otpLoading || otp.length < 6) && styles.verifyBtnDisabled]}
              onPress={handleOtpVerify}
              disabled={otpLoading || otp.length < 6}
            >
              {otpLoading
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.verifyBtnText}>Verify</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.linkBtn, (resendCooldown > 0 || otpLoading) && styles.linkBtnDisabled]}
              onPress={handleResendOtp}
              disabled={resendCooldown > 0 || otpLoading}
            >
              <Text style={[styles.linkText, resendCooldown > 0 && styles.linkTextMuted]}>
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setOtpMode(null); setOtp(''); }}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingBottom: 40 },
  header: {
    backgroundColor: COLORS.white, paddingHorizontal: 20,
    paddingTop: 60, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  heading: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  section: {
    backgroundColor: COLORS.white, marginTop: 16,
    paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.border,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: COLORS.gray500, textTransform: 'uppercase', marginBottom: 12 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.teal500,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 22, fontWeight: 'bold', color: COLORS.white },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 17, fontWeight: '600', color: COLORS.text },
  profilePhone: { fontSize: 14, color: COLORS.gray500, marginTop: 2 },
  profileSchool: { fontSize: 13, color: COLORS.textLight, marginTop: 1 },
  roleBadge: {
    backgroundColor: COLORS.teal500, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  roleText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  infoLabel: { fontSize: 15, color: COLORS.gray900 },
  infoValue: { fontSize: 15, color: COLORS.gray500 },
  trialBadge: {
    backgroundColor: COLORS.amber50, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12,
  },
  trialText: { fontSize: 13, color: COLORS.amber700, fontWeight: '600' },
  hint: { fontSize: 13, color: COLORS.textLight, marginTop: 6 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 4 },
  settingsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderTopWidth: 1, borderTopColor: COLORS.background,
  },
  lastRow: {},
  settingsRowLabel: { fontSize: 15, color: COLORS.gray900 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowValue: { fontSize: 15, color: COLORS.gray500 },
  rowChevron: { fontSize: 18, color: COLORS.gray500 },
  logoutButton: {
    margin: 20, padding: 16, borderRadius: 10,
    backgroundColor: '#fee2e2', alignItems: 'center',
  },
  logoutText: { color: COLORS.error, fontWeight: '600', fontSize: 16 },
  deleteRowLabel: { color: COLORS.error },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 28, paddingBottom: 40, alignItems: 'center',
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  modalSubtitle: { fontSize: 15, color: COLORS.textLight, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  modalPhone: { color: COLORS.text, fontWeight: '600' },
  otpInput: {
    fontSize: 32, fontWeight: 'bold', letterSpacing: 8,
    borderWidth: 2, borderColor: COLORS.teal500, borderRadius: 12,
    paddingVertical: 14, marginBottom: 20, color: COLORS.text,
    width: '100%', textAlign: 'center',
  },
  verifyBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 12, padding: 16,
    width: '100%', alignItems: 'center', marginBottom: 12,
  },
  verifyBtnDisabled: { backgroundColor: COLORS.teal100 },
  verifyBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  linkBtn: { padding: 8, marginBottom: 4 },
  linkBtnDisabled: {},
  linkText: { fontSize: 14, color: COLORS.teal500, fontWeight: '600' },
  linkTextMuted: { color: COLORS.textLight },
  cancelBtn: { padding: 10 },
  cancelBtnText: { fontSize: 14, color: COLORS.gray500 },
  progressTrack: {
    height: 6, backgroundColor: COLORS.border, borderRadius: 3,
    marginTop: 10, marginBottom: 4, overflow: 'hidden',
  },
  progressFill: {
    height: 6, backgroundColor: COLORS.teal500, borderRadius: 3,
  },
  progressFillPaused: { backgroundColor: COLORS.amber300 },
  modelErrorText: { fontSize: 13, color: COLORS.error, marginTop: 6 },
  // capability badge
  capabilityBadge: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    marginBottom: 12, alignSelf: 'flex-start',
  },
  capabilityBadgeCapable: { backgroundColor: '#EBF9F1' },
  capabilityBadgeCloud: { backgroundColor: COLORS.background },
  capabilityBadgeText: { fontSize: 13, fontWeight: '500' },
  capabilityBadgeTextCapable: { color: COLORS.success },
  capabilityBadgeTextCloud: { color: COLORS.gray500 },
  // model card
  modelCard: {
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, padding: 14, marginBottom: 4,
  },
  modelCardHeader: { flexDirection: 'row', alignItems: 'center' },
  modelCardName: { fontSize: 15, fontWeight: '700', color: COLORS.gray900 },
  modelCardSubtitle: { fontSize: 12, color: COLORS.gray500, marginTop: 1 },
  capabilitiesRow: { marginTop: 8 },
  capabilitiesLabel: { fontSize: 11, color: COLORS.gray500, fontWeight: '600', marginBottom: 4 },
  capabilitiesChips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  capabilityChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  capabilityChipText: { fontSize: 12, color: COLORS.gray900, fontWeight: '500' },
  capabilitiesHint: { fontSize: 11, color: COLORS.gray500 },
  modelCardSize: { fontSize: 13, color: COLORS.textLight, marginTop: 6 },
  modelStatusBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  modelStatusDone: { backgroundColor: '#EBF9F1' },
  modelStatusActive: { backgroundColor: COLORS.teal50 },
  modelStatusError: { backgroundColor: '#fee2e2' },
  modelStatusIdle: { backgroundColor: COLORS.background },
  modelStatusText: { fontSize: 13, fontWeight: '600' },
  // disabled rows
  settingsRowDisabled: { opacity: 0.4 },
  settingsRowLabelDisabled: { color: COLORS.textLight },
});
