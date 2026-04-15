// src/screens/StudentSettingsScreen.tsx
// Student settings — mirrors teacher SettingsScreen layout:
//   Profile card (avatar + name + phone + school + pencil)
//   Account section (school, class, PIN, language)
//   Offline AI model section
//   About section (version, terms, privacy, delete)
//   Logout button

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Linking,
  Modal, TextInput, ActivityIndicator, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { LangCode } from '../i18n/translations';
import {
  getClassJoinInfo, joinClass, requestProfileOtp, updateProfile, deletePin,
  updateStudentProfile,
} from '../services/api';
import { StudentRootStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import { maskPhone } from '../utils/maskPhone';
import { useModel } from '../context/ModelContext';
import { MODEL_DISPLAY_NAME, MODEL_SIZE_LABEL } from '../services/modelManager';
import { useVerificationGate } from '../hooks/useVerificationGate';

const LANGUAGES: Array<{ code: LangCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'sn', label: 'Shona' },
  { code: 'nd', label: 'Ndebele' },
];

type Nav = NativeStackNavigationProp<StudentRootStackParamList>;

export default function StudentSettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { user, logout, hasPin: ctxHasPin, markPinSet, updateUser } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const isFocused = useIsFocused();
  const {
    status: modelStatus, progress: modelProgress, variant: modelVariant,
    capability: modelCapability, wifiOnly, errorMessage: modelError,
    pauseDownload: modelPause, resumeDownload: modelResume, cancelDownload: modelCancel,
    deleteModel, setWifiOnly, acceptDownload, neverShowNudge,
  } = useModel();

  // ── PIN state ─────────────────────────────────────────────────────────────
  const [hasPin, setHasPinLocal] = useState(ctxHasPin);
  useEffect(() => {
    if (!isFocused) return;
    SecureStore.getItemAsync('neriah_has_pin').then(val => {
      const pinSet = val === 'true';
      setHasPinLocal(pinSet);
      if (pinSet && !ctxHasPin) markPinSet();
    });
  }, [isFocused]);

  // ── Verification gate for sensitive actions ────────────────────────────────
  const gate = useVerificationGate();

  // ── Class + school fetch ────────────────────────────────────────────────────
  const [classDisplay, setClassDisplay] = useState('');
  const [schoolName, setSchoolName] = useState('');
  useEffect(() => {
    if (!user?.class_id) return;
    (async () => {
      try {
        const { getClassDetail } = await import('../services/api');
        const cls = await getClassDetail(user.class_id!);
        const parts = [cls.name];
        if (cls.subject) parts.push(cls.subject);
        setClassDisplay(parts.join(' — '));
        // School from class's school_name or teacher lookup
        if (cls.school_name) {
          setSchoolName(cls.school_name);
        }
      } catch {
        setClassDisplay((user as any).class_name ?? user.class_id ?? '—');
      }
    })();
  }, [user?.class_id]);

  // ── Change Name modal ─────────────────────────────────────────────────────
  const [nameModal, setNameModal] = useState(false);
  const [editFirst, setEditFirst] = useState(user?.first_name ?? '');
  const [editSurname, setEditSurname] = useState(user?.surname ?? '');
  const [nameSaving, setNameSaving] = useState(false);

  const handleSaveName = async () => {
    if (!editFirst.trim() || !editSurname.trim()) {
      Alert.alert('Required', 'Both first name and surname are required.');
      return;
    }
    setNameSaving(true);
    try {
      const res = await updateStudentProfile({ first_name: editFirst.trim(), surname: editSurname.trim() });
      if (res?.student && updateUser) updateUser(res.student);
      setNameModal(false);
      Alert.alert('Updated', 'Name updated successfully.');
    } catch {
      Alert.alert('Error', 'Could not update name. Please try again.');
    } finally {
      setNameSaving(false);
    }
  };

  // ── Join class modal (name-based search) ───────────────────────────────────
  const [joinModal, setJoinModal] = useState(false);
  const [joinSearch, setJoinSearch] = useState('');
  const [joinResults, setJoinResults] = useState<Array<{ id: string; name: string; subject?: string; teacher?: { first_name: string; surname: string } }>>([]);
  const [joinSearching, setJoinSearching] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchClasses = (query: string) => {
    setJoinSearch(query);
    setJoinError('');
    if (joinTimerRef.current) clearTimeout(joinTimerRef.current);
    if (query.trim().length < 2) { setJoinResults([]); return; }
    joinTimerRef.current = setTimeout(async () => {
      setJoinSearching(true);
      try {
        const { getClassesBySchool } = await import('../services/api');
        const school = user?.school ?? '';
        const results = await getClassesBySchool(school, query.trim());
        setJoinResults(results.map(c => ({ id: c.id, name: c.name, subject: c.subject, teacher: c.teacher })));
      } catch { setJoinResults([]); }
      finally { setJoinSearching(false); }
    }, 300);
  };

  const handleJoinById = async (classId: string, className: string) => {
    setJoining(true);
    try {
      const { joinClassByCode } = await import('../services/api');
      // joinClassByCode sends class_id when no join_code
      const res = await joinClassByCode(classId);
      const display = [res.class_name, res.subject].filter(Boolean).join(' — ');
      setClassDisplay(display || res.class_name);
      Alert.alert('Joined!', res.message || `Joined ${res.class_name} successfully!`);
      setJoinModal(false); setJoinSearch(''); setJoinResults([]); setJoinError('');
    } catch (err: any) {
      setJoinError(err?.message ?? 'Could not join class.');
    } finally { setJoining(false); }
  };

  // ── OTP for PIN change/remove ─────────────────────────────────────────────
  const [otpMode, setOtpMode] = useState<'change' | 'remove' | null>(null);
  const [verificationId, setVerificationId] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpInputRef = useRef<TextInput>(null);

  useEffect(() => { if (resendCooldown > 0) { const t2 = setTimeout(() => setResendCooldown(s => s - 1), 1000); return () => clearTimeout(t2); } }, [resendCooldown]);
  useEffect(() => { if (otpMode && otp.length === 6) handleOtpVerify(); }, [otp]);

  const openOtpModal = async (mode: 'change' | 'remove') => {
    if (!user?.phone) return;
    setOtp(''); setOtpLoading(true);
    try {
      const res = await requestProfileOtp(user.phone);
      setVerificationId(res.verification_id);
      setResendCooldown(60); setOtpMode(mode);
      setTimeout(() => otpInputRef.current?.focus(), 350);
    } catch { Alert.alert('Error', 'Could not send code.'); }
    finally { setOtpLoading(false); }
  };

  const handleOtpVerify = async () => {
    if (otp.length !== 6) return;
    setOtpLoading(true);
    try {
      await updateProfile({ verification_id: verificationId, otp_code: otp });
      const mode = otpMode;
      setOtpMode(null); setOtp('');
      if (mode === 'change') { navigation.navigate('StudentSettings' as any); /* TODO: SetPin */ }
      else {
        await deletePin().catch(() => {});
        setHasPinLocal(false);
        await SecureStore.deleteItemAsync('neriah_has_pin');
        Alert.alert('PIN Removed', 'Your PIN has been removed.');
      }
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 400) Alert.alert('Incorrect code', 'Please try again.');
      else if (status === 429) { Alert.alert('Too many attempts', 'Request a new code.'); setOtpMode(null); }
      else Alert.alert('Error', 'Something went wrong.');
      setOtp('');
    } finally { setOtpLoading(false); }
  };

  const handleLanguage = () => {
    Alert.alert('Language', 'Choose your preferred language', [
      ...LANGUAGES.map(l => ({
        text: l.code === language ? `${l.label} ✓` : l.label,
        onPress: () => setLanguage(l.code),
      })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: logout },
    ]);
  };

  const handleDeleteAccount = () => {
    gate.guard(
      () => {
        Alert.alert(
          'Delete Account',
          'This will permanently delete your account and all results. Contact support@neriah.africa to request deletion.',
          [
            { text: 'Contact Support', onPress: () => Linking.openURL(`mailto:support@neriah.africa?subject=${encodeURIComponent('Student Account Deletion')}&body=${encodeURIComponent(`Phone: ${user?.phone ?? ''}`)}`) },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
      },
      { requirePin: true },
    );
  };

  const initials = user ? `${user.first_name?.[0] ?? ''}${user.surname?.[0] ?? ''}`.toUpperCase() : 'S';
  const languageLabel = LANGUAGES.find(l => l.code === language)?.label ?? 'English';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={s.headerBar}>
        <Text style={s.heading}>Settings</Text>
      </View>

      {/* ── PROFILE ─────────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Profile</Text>
        <TouchableOpacity style={s.profileCard} onPress={() => gate.guard(() => setNameModal(true), { requirePin: true })} activeOpacity={0.7}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={s.profileInfo}>
            <Text style={s.profileName}>{user?.first_name} {user?.surname}</Text>
            <Text style={s.profilePhone}>{maskPhone(user?.phone ?? '')}</Text>
            <View style={s.roleBadge}><Text style={s.roleText}>Student</Text></View>
          </View>
          <Ionicons name="pencil-outline" size={18} color={COLORS.teal500} />
        </TouchableOpacity>
      </View>

      {/* ── ACCOUNT ─────────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Account</Text>
        <View style={s.card}>
          <Row label="School" value={schoolName || (user as any)?.school_name || '—'} />
          <Row label="Class" value={classDisplay || '—'} />
          <View style={s.divider} />

          <TouchableOpacity style={s.settingsRow} onPress={() => gate.guard(() => (navigation as any).navigate('ClassManagement'), { requirePin: true })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="school-outline" size={18} color={COLORS.teal500} />
              <Text style={s.settingsRowLabel}>My Classes</Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>

          <View style={s.divider} />

          {hasPin ? (
            <>
              <TouchableOpacity style={s.settingsRow} onPress={() => openOtpModal('change')} disabled={otpLoading}>
                <Text style={s.settingsRowLabel}>Change PIN</Text>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.settingsRow} onPress={() => openOtpModal('remove')} disabled={otpLoading}>
                <Text style={[s.settingsRowLabel, { color: COLORS.error }]}>Remove PIN</Text>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={s.settingsRow} onPress={() => (navigation as any).navigate('SetPin')}>
              <Text style={s.settingsRowLabel}>Set PIN</Text>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={s.settingsRow} onPress={handleLanguage}>
            <Text style={s.settingsRowLabel}>Language</Text>
            <View style={s.rowRight}>
              <Text style={s.rowValue}>{languageLabel}</Text>
              <Text style={s.chevron}>›</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── OFFLINE AI MODEL ────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Offline AI Model</Text>
        <View style={s.card}>
          <View style={[s.capBadge, modelCapability === 'cloud-only' ? s.capBadgeCloud : s.capBadgeCapable]}>
            <Ionicons name={modelCapability === 'cloud-only' ? 'cloud-outline' : 'hardware-chip-outline'} size={13} color={modelCapability === 'cloud-only' ? COLORS.gray500 : COLORS.success} style={{ marginRight: 5 }} />
            <Text style={[s.capBadgeText, modelCapability === 'cloud-only' ? { color: COLORS.gray500 } : { color: COLORS.success }]}>
              {modelCapability === 'cloud-only' ? 'Cloud only' : 'On-device AI supported'}
            </Text>
          </View>

          <View style={s.modelRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.modelName}>Neriah AI</Text>
              <Text style={s.modelSize}>Powered by {modelVariant ? MODEL_DISPLAY_NAME[modelVariant] : 'Gemma 4 E2B'} · {modelVariant ? MODEL_SIZE_LABEL[modelVariant] : '2.5 GB'}</Text>
            </View>
            <View style={[s.modelBadge, modelStatus === 'done' ? s.badgeDone : modelStatus === 'error' ? s.badgeError : s.badgeIdle]}>
              <Text style={[s.modelBadgeText, { color: modelStatus === 'done' ? COLORS.success : modelStatus === 'error' ? COLORS.error : COLORS.gray500 }]}>
                {modelStatus === 'done' ? 'Ready' : modelStatus === 'downloading' ? `${modelProgress}%` : modelStatus === 'error' ? 'Error' : 'Not downloaded'}
              </Text>
            </View>
          </View>

          {(modelStatus === 'downloading' || modelStatus === 'paused') && (
            <View style={s.progressTrack}><View style={[s.progressFill, { width: `${modelProgress}%` as any }]} /></View>
          )}

          <TouchableOpacity style={[s.settingsRow, (modelStatus === 'done' || modelCapability === 'cloud-only') && { opacity: 0.4 }]} onPress={acceptDownload} disabled={modelStatus === 'done' || modelCapability === 'cloud-only'}>
            <Text style={s.settingsRowLabel}>Download model</Text><Text style={s.chevron}>›</Text>
          </TouchableOpacity>

          {modelStatus === 'done' && (
            <TouchableOpacity style={s.settingsRow} onPress={() => Alert.alert('Delete model', 'Remove the AI model?', [{ text: 'Keep', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: deleteModel }])}>
              <Text style={[s.settingsRowLabel, { color: COLORS.error }]}>Delete model</Text><Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          )}

          <View style={[s.settingsRow, { justifyContent: 'space-between' }]}>
            <Text style={[s.settingsRowLabel, { color: COLORS.gray900 }]}>Wi-Fi only downloads</Text>
            <Switch value={wifiOnly} onValueChange={setWifiOnly} trackColor={{ true: COLORS.teal500, false: COLORS.border }} thumbColor={COLORS.white} />
          </View>
        </View>
      </View>

      {/* ── ABOUT ───────────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>About</Text>
        <View style={s.card}>
          <Row label="Version" value="1.0.0" />
          <TouchableOpacity style={s.settingsRow} onPress={() => Linking.openURL('https://neriah.ai/terms')}>
            <Text style={s.settingsRowLabel}>Terms of Service</Text><Text style={s.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.settingsRow} onPress={() => Linking.openURL('https://neriah.ai/privacy')}>
            <Text style={s.settingsRowLabel}>Privacy Policy</Text><Text style={s.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.settingsRow} onPress={handleDeleteAccount}>
            <Text style={[s.settingsRowLabel, { color: COLORS.error }]}>Delete Account</Text><Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── LOG OUT ─────────────────────────────────────────────────── */}
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={s.logoutText}>Sign out</Text>
      </TouchableOpacity>

      <Text style={s.versionFooter}>Neriah v1.0.0</Text>

      {/* ── Change Name Modal ───────────────────────────────────────── */}
      <Modal visible={nameModal} animationType="slide" transparent onRequestClose={() => setNameModal(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View style={m.overlay}>
            <View style={m.sheet}>
              <View style={m.header}>
                <Text style={m.title}>Change Name</Text>
                <TouchableOpacity onPress={() => setNameModal(false)}><Text style={m.close}>✕</Text></TouchableOpacity>
              </View>
              <View style={m.body}>
                <Text style={m.label}>First name</Text>
                <TextInput style={m.input} value={editFirst} onChangeText={setEditFirst} placeholder="First name" autoCapitalize="words" />
                <Text style={m.label}>Surname</Text>
                <TextInput style={m.input} value={editSurname} onChangeText={setEditSurname} placeholder="Surname" autoCapitalize="words" />
                <TouchableOpacity style={[m.btn, nameSaving && { opacity: 0.5 }]} onPress={handleSaveName} disabled={nameSaving}>
                  {nameSaving ? <ActivityIndicator color={COLORS.white} /> : <Text style={m.btnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Join Class Modal ────────────────────────────────────────── */}
      <Modal visible={joinModal} animationType="slide" transparent onRequestClose={() => setJoinModal(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.header}>
              <Text style={m.title}>Join a Class</Text>
              <TouchableOpacity onPress={() => { setJoinModal(false); setJoinSearch(''); setJoinResults([]); setJoinError(''); }}><Text style={m.close}>✕</Text></TouchableOpacity>
            </View>
            <View style={m.body}>
              <Text style={m.label}>Search for your class by name</Text>
              <TextInput
                style={m.input}
                value={joinSearch}
                onChangeText={searchClasses}
                placeholder="e.g. Form 2A"
                autoCapitalize="words"
                autoFocus
              />
              {joinSearching && <ActivityIndicator color={COLORS.teal500} style={{ marginTop: 10 }} />}
              {joinError ? <Text style={{ color: COLORS.error, fontSize: 13, marginTop: 10 }}>{joinError}</Text> : null}
              {joinResults.length > 0 && (
                <View style={{ marginTop: 10, maxHeight: 200 }}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {joinResults.map(c => (
                      <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.background }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.text }}>{c.name}{c.subject ? ` — ${c.subject}` : ''}</Text>
                          {c.teacher && <Text style={{ fontSize: 12, color: COLORS.gray500, marginTop: 2 }}>{c.teacher.first_name} {c.teacher.surname}</Text>}
                        </View>
                        <TouchableOpacity
                          style={{ backgroundColor: COLORS.teal500, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 }}
                          onPress={() => handleJoinById(c.id, c.name)}
                          disabled={joining}
                        >
                          <Text style={{ color: COLORS.white, fontWeight: '700', fontSize: 13 }}>Join</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
              {joinSearch.length >= 2 && !joinSearching && joinResults.length === 0 && (
                <Text style={{ color: COLORS.gray500, fontSize: 13, marginTop: 14, textAlign: 'center' }}>No classes found. Try a different name.</Text>
              )}
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Gate PIN verification modal ────────────────────────────── */}
      <Modal visible={gate.pinModalVisible} animationType="slide" transparent onRequestClose={gate.dismiss}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={m.overlay}>
            <View style={m.sheet}>
              <View style={m.header}>
                <Text style={m.title}>Verify PIN</Text>
                <TouchableOpacity onPress={gate.dismiss}><Text style={m.close}>✕</Text></TouchableOpacity>
              </View>
              <View style={m.body}>
                <Text style={m.label}>Enter your 4-digit PIN to continue</Text>
                <TextInput
                  style={[m.input, { fontSize: 28, fontWeight: '700', letterSpacing: 12, textAlign: 'center' }]}
                  keyboardType="number-pad"
                  maxLength={4}
                  secureTextEntry
                  autoFocus
                  onChangeText={async (pin) => {
                    if (pin.length === 4) {
                      // Verify PIN against stored hash
                      const storedPin = await SecureStore.getItemAsync('neriah_pin');
                      if (storedPin === pin) {
                        gate.onPinVerified();
                      } else {
                        Alert.alert('Wrong PIN', 'The PIN you entered is incorrect.');
                      }
                    }
                  }}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── OTP Modal (PIN change/remove) ───────────────────────────── */}
      <Modal visible={otpMode !== null} animationType="slide" transparent onRequestClose={() => setOtpMode(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.header}>
              <Text style={m.title}>{otpMode === 'change' ? 'Change PIN' : 'Remove PIN'}</Text>
              <TouchableOpacity onPress={() => { setOtpMode(null); setOtp(''); }}><Text style={m.close}>✕</Text></TouchableOpacity>
            </View>
            <View style={m.body}>
              <Text style={m.label}>Enter the 6-digit code sent to {maskPhone(user?.phone ?? '')}</Text>
              <TextInput ref={otpInputRef} style={[m.input, { fontSize: 22, fontWeight: '700', letterSpacing: 6, textAlign: 'center' }]} value={otp} onChangeText={t => setOtp(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
              {otpLoading && <ActivityIndicator color={COLORS.teal500} style={{ marginTop: 12 }} />}
              <TouchableOpacity disabled={resendCooldown > 0 || otpLoading} onPress={async () => { if (!user?.phone) return; try { const r = await requestProfileOtp(user.phone); setVerificationId(r.verification_id); setResendCooldown(60); } catch {} }} style={{ marginTop: 14, alignItems: 'center' }}>
                <Text style={{ color: resendCooldown > 0 ? COLORS.gray500 : COLORS.teal500, fontSize: 14, fontWeight: '600' }}>
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingBottom: 48 },
  headerBar: { backgroundColor: COLORS.white, paddingHorizontal: 18, paddingTop: 56, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  heading: { fontSize: 22, fontWeight: '800', color: COLORS.text },

  section: { marginHorizontal: 16, marginTop: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: COLORS.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  card: { backgroundColor: COLORS.white, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },

  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.teal500, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText: { fontSize: 22, fontWeight: '800', color: COLORS.white },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  profilePhone: { fontSize: 13, color: COLORS.gray500, marginTop: 2 },
  roleBadge: { marginTop: 4, backgroundColor: COLORS.amber300, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  roleText: { color: COLORS.white, fontSize: 11, fontWeight: '700' },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.background },
  infoLabel: { fontSize: 14, color: COLORS.gray500 },
  infoValue: { fontSize: 14, color: COLORS.text, fontWeight: '500', flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  divider: { height: 1, backgroundColor: COLORS.background },

  settingsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderTopWidth: 1, borderTopColor: COLORS.background },
  settingsRowLabel: { fontSize: 14, color: COLORS.teal500, fontWeight: '600' },
  chevron: { fontSize: 18, color: COLORS.teal500 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValue: { fontSize: 14, color: COLORS.gray500 },

  capBadge: { flexDirection: 'row', alignItems: 'center', margin: 14, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' },
  capBadgeCapable: { backgroundColor: '#EBF9F1' },
  capBadgeCloud: { backgroundColor: COLORS.background },
  capBadgeText: { fontSize: 12, fontWeight: '500' },

  modelRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 10 },
  modelName: { fontSize: 14, fontWeight: '600', color: COLORS.gray900 },
  modelSize: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  modelBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  badgeDone: { backgroundColor: '#EBF9F1' },
  badgeError: { backgroundColor: '#fee2e2' },
  badgeIdle: { backgroundColor: COLORS.background },
  modelBadgeText: { fontSize: 12, fontWeight: '600' },

  progressTrack: { height: 6, backgroundColor: COLORS.border, borderRadius: 3, marginHorizontal: 14, marginBottom: 4, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: COLORS.teal500, borderRadius: 3 },

  logoutBtn: { marginHorizontal: 16, marginTop: 24, borderWidth: 1, borderColor: '#fca5a5', borderRadius: 12, padding: 16, alignItems: 'center', backgroundColor: '#fff5f5' },
  logoutText: { color: COLORS.error, fontWeight: '700', fontSize: 16 },
  versionFooter: { marginTop: 20, textAlign: 'center', fontSize: 12, color: COLORS.textLight, marginBottom: 20 },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  close: { fontSize: 22, color: COLORS.gray500, paddingHorizontal: 4 },
  body: { padding: 20 },
  label: { fontSize: 14, color: COLORS.gray500, marginBottom: 8, marginTop: 4 },
  input: { borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10, padding: 14, fontSize: 16, color: COLORS.text },
  btn: { marginTop: 20, backgroundColor: COLORS.teal500, borderRadius: 12, padding: 16, alignItems: 'center' },
  btnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
