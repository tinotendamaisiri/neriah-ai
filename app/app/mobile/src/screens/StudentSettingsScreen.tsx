// src/screens/StudentSettingsScreen.tsx
// Full student settings: profile, class management, support, legal, logout.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Linking,
  Modal,
  TextInput,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getClassJoinInfo, joinClass } from '../services/api';
import { hasPin } from '../services/pinLock';
import { COLORS } from '../constants/colors';
import { isNativeModuleAvailable } from '../services/litert';
import { isModelDownloaded, downloadModel, deleteModel, MODEL_SIZE_LABEL } from '../services/modelManager';
import { getDeviceCapabilities } from '../services/deviceCapabilities';

export default function StudentSettingsScreen() {
  const navigation = useNavigation<any>();
  const { user, logout, updateUser } = useAuth();
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [pinSet, setPinSet] = useState(false);

  useEffect(() => {
    hasPin().then(setPinSet);
  }, []);

  // ── On-Device AI state ────────────────────────────────────────────────────

  const [canRunOnDevice, setCanRunOnDevice] = useState(false);
  const [e2bDownloaded, setE2bDownloaded] = useState(false);
  const [e2bProgress, setE2bProgress] = useState<number | null>(null);
  const [wifiOnly, setWifiOnly] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [caps, e2b] = await Promise.all([getDeviceCapabilities(), isModelDownloaded('e2b')]);
      if (!mounted) return;
      setCanRunOnDevice(caps.canRunOnDevice);
      setE2bDownloaded(e2b);
    })();
    return () => { mounted = false; };
  }, []);

  const handleDownloadE2B = async () => {
    try {
      setE2bProgress(0);
      await downloadModel('e2b', pct => setE2bProgress(pct));
      setE2bDownloaded(true);
    } catch (err: any) {
      Alert.alert('Download failed', err?.message ?? 'Could not download model.');
    } finally {
      setE2bProgress(null);
    }
  };

  const handleDeleteE2B = () => {
    Alert.alert(
      'Delete tutor model?',
      'The on-device AI tutor (2.5 GB) will be removed. You can re-download it later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => { await deleteModel('e2b'); setE2bDownloaded(false); } },
      ],
    );
  };

  const initials = user
    ? `${user.first_name?.[0] ?? ''}${user.surname?.[0] ?? ''}`.toUpperCase()
    : 'S';

  const handleLogout = () => {
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: logout },
      ],
    );
  };

  const openLink = (url: string) => {
    Linking.openURL(url).catch(() =>
      Alert.alert('Cannot open link', 'Please visit neriah.ai in your browser.'),
    );
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {/* Header */}
      <View style={styles.headerBg}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.name}>{user?.first_name} {user?.surname}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>Student</Text>
        </View>
      </View>

      {/* Profile */}
      <SectionCard title="Profile">
        <InfoRow label="Phone" value={user?.phone ?? '—'} />
        {user?.school && <InfoRow label="School" value={user.school} />}
      </SectionCard>

      {/* Classes */}
      <SectionCard title="My Class">
        {user?.class_id ? (
          <>
            <InfoRow label="Class ID" value={user.class_id} />
            <TouchableOpacity
              style={styles.dangerRow}
              onPress={() =>
                Alert.alert(
                  'Leave class',
                  "Leaving your class means you won't be able to submit work or see results. Contact your teacher to re-join.",
                  [{ text: 'OK' }],
                )
              }
            >
              <Text style={styles.dangerRowText}>Leave class…</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.noClassRow}>
            <Text style={styles.noClassText}>You are not in a class yet.</Text>
          </View>
        )}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => {
            if (user?.class_id) {
              Alert.alert(
                'Already in a class',
                'You\'re already in a class. Leave your current class first before joining another.',
              );
            } else {
              setJoinModalVisible(true);
            }
          }}
        >
          <Text style={styles.actionRowText}>Join a class with code</Text>
          <Text style={styles.actionRowArrow}>›</Text>
        </TouchableOpacity>
      </SectionCard>

      {/* Security */}
      <SectionCard title="Security">
        {!pinSet ? (
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => navigation.navigate('PinLock', { mode: 'setup' })}
          >
            <Text style={styles.actionRowText}>Set app lock PIN</Text>
            <Text style={styles.actionRowArrow}>›</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => navigation.navigate('PinLock', { mode: 'change' })}
            >
              <Text style={styles.actionRowText}>Change PIN</Text>
              <Text style={styles.actionRowArrow}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionRow, { borderTopWidth: 1, borderTopColor: COLORS.background }]}
              onPress={() => navigation.navigate('PinLock', { mode: 'remove' })}
            >
              <Text style={[styles.actionRowText, { color: COLORS.error }]}>Remove PIN</Text>
              <Text style={styles.actionRowArrow}>›</Text>
            </TouchableOpacity>
          </>
        )}
      </SectionCard>

      {/* Support */}
      <SectionCard title="Support">
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => openLink('https://wa.me/263000000000')}
        >
          <Text style={styles.linkRowText}>Contact support</Text>
          <Text style={styles.linkRowArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => openLink('https://neriah.ai/help')}
        >
          <Text style={styles.linkRowText}>Help / FAQ</Text>
          <Text style={styles.linkRowArrow}>›</Text>
        </TouchableOpacity>
      </SectionCard>

      {/* Legal */}
      <SectionCard title="Legal">
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => openLink('https://neriah.ai/privacy')}
        >
          <Text style={styles.linkRowText}>Privacy policy</Text>
          <Text style={styles.linkRowArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => openLink('https://neriah.ai/terms')}
        >
          <Text style={styles.linkRowText}>Terms of service</Text>
          <Text style={styles.linkRowArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() =>
            Alert.alert(
              'Delete account',
              'To delete your account, please email support@neriah.ai from your registered phone number.',
            )
          }
        >
          <Text style={[styles.linkRowText, { color: COLORS.error }]}>Delete my account</Text>
          <Text style={styles.linkRowArrow}>›</Text>
        </TouchableOpacity>
      </SectionCard>

      {/* On-Device AI (E2B tutor model) */}
      {isNativeModuleAvailable() && (
        <SectionCard title="On-Device AI">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={styles.linkRowText}>
              {canRunOnDevice ? 'Your device supports on-device AI' : 'Your device uses cloud AI'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>AI Tutor (Gemma E2B)</Text>
              <Text style={{ fontSize: 12, color: COLORS.textLight, marginTop: 2 }}>
                {e2bDownloaded ? `Downloaded · ${MODEL_SIZE_LABEL.e2b}` : MODEL_SIZE_LABEL.e2b}
              </Text>
              {e2bProgress !== null && (
                <View style={{ height: 3, backgroundColor: COLORS.gray200, borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                  <View style={{ height: 3, backgroundColor: COLORS.teal500, borderRadius: 2, width: `${e2bProgress}%` }} />
                </View>
              )}
            </View>
            {e2bProgress !== null ? (
              <ActivityIndicator size="small" color={COLORS.teal500} />
            ) : e2bDownloaded ? (
              <TouchableOpacity
                onPress={handleDeleteE2B}
                style={{ backgroundColor: COLORS.gray200, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: COLORS.error, fontSize: 13, fontWeight: '600' }}>Delete</Text>
              </TouchableOpacity>
            ) : canRunOnDevice ? (
              <TouchableOpacity
                onPress={handleDownloadE2B}
                style={{ backgroundColor: COLORS.teal500, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: COLORS.white, fontSize: 13, fontWeight: '600' }}>Download</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <Text style={styles.linkRowText}>Download on Wi-Fi only</Text>
            <Switch
              value={wifiOnly}
              onValueChange={setWifiOnly}
              trackColor={{ true: COLORS.teal500, false: COLORS.gray200 }}
              thumbColor={COLORS.white}
            />
          </View>
        </SectionCard>
      )}

      {/* Sign out */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Neriah v1.0.0</Text>

      {/* Join class modal */}
      <JoinClassModal
        visible={joinModalVisible}
        onClose={() => setJoinModalVisible(false)}
        onJoined={(class_id) => updateUser({ class_id })}
      />
    </ScrollView>
  );
}

// ── Join class modal ──────────────────────────────────────────────────────────

function JoinClassModal({ visible, onClose, onJoined }: { visible: boolean; onClose: () => void; onJoined: (class_id: string) => void }) {
  const [code, setCode] = useState('');
  const [classInfo, setClassInfo] = useState<{ name: string; teacher: { first_name: string; surname: string } } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  const handleCodeChange = async (text: string) => {
    const upper = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setCode(upper);
    setError('');
    setClassInfo(null);

    if (upper.length === 6) {
      setLookingUp(true);
      try {
        const info = await getClassJoinInfo(upper);
        setClassInfo(info);
      } catch {
        setError('Class not found. Check the code and try again.');
      } finally {
        setLookingUp(false);
      }
    }
  };

  const handleJoin = async () => {
    if (!classInfo) return;
    setJoining(true);
    try {
      const { class_id } = await joinClass(code);
      onJoined(class_id);
      Alert.alert('Joined!', `You've joined ${classInfo.name}.`);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not join class. Try again.');
    } finally {
      setJoining(false);
    }
  };

  const handleClose = () => {
    setCode('');
    setClassInfo(null);
    setError('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={modal.overlay}>
        <View style={modal.sheet}>
          <View style={modal.header}>
            <Text style={modal.title}>Join a class</Text>
            <TouchableOpacity onPress={handleClose}>
              <Text style={modal.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={modal.body}>
            <Text style={modal.label}>Enter the 6-character class code from your teacher</Text>
            <TextInput
              style={modal.codeInput}
              value={code}
              onChangeText={handleCodeChange}
              placeholder="e.g. AB12CD"
              placeholderTextColor={COLORS.textLight}
              autoCapitalize="characters"
              maxLength={6}
              autoFocus
            />

            {lookingUp && <ActivityIndicator color={COLORS.teal500} style={{ marginTop: 12 }} />}

            {error ? <Text style={modal.error}>{error}</Text> : null}

            {classInfo && (
              <View style={modal.classCard}>
                <Text style={modal.className}>{classInfo.name}</Text>
                <Text style={modal.classTeacher}>
                  Teacher: {classInfo.teacher.first_name} {classInfo.teacher.surname}
                </Text>
              </View>
            )}

            {classInfo && (
              <TouchableOpacity
                style={[modal.joinBtn, joining && { opacity: 0.6 }]}
                onPress={handleJoin}
                disabled={joining}
              >
                {joining
                  ? <ActivityIndicator color={COLORS.white} />
                  : <Text style={modal.joinBtnText}>Join {classInfo.name}</Text>
                }
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.background },
  container: { paddingBottom: 48 },
  headerBg: {
    backgroundColor: COLORS.teal500,
    paddingTop: 56,
    paddingBottom: 32,
    alignItems: 'center',
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  avatarText: { fontSize: 28, fontWeight: '800', color: COLORS.white },
  name: { fontSize: 20, fontWeight: '800', color: COLORS.white },
  roleBadge: {
    marginTop: 6, backgroundColor: COLORS.amber300,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 3,
  },
  roleText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  sectionCard: { marginHorizontal: 16, marginTop: 20 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: COLORS.gray500,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  sectionContent: {
    backgroundColor: COLORS.white, borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.background,
  },
  infoLabel: { fontSize: 14, color: COLORS.gray500 },
  infoValue: { fontSize: 14, color: COLORS.text, fontWeight: '500', flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  noClassRow: { padding: 14 },
  noClassText: { color: COLORS.textLight, fontSize: 14 },
  actionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, borderTopWidth: 1, borderTopColor: COLORS.background,
  },
  actionRowText: { fontSize: 14, color: COLORS.teal500, fontWeight: '600' },
  actionRowArrow: { fontSize: 18, color: COLORS.teal500 },
  dangerRow: { padding: 14, borderTopWidth: 1, borderTopColor: COLORS.background },
  dangerRowText: { fontSize: 14, color: COLORS.error },
  linkRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.background,
  },
  linkRowText: { fontSize: 14, color: COLORS.gray900 },
  linkRowArrow: { fontSize: 18, color: COLORS.textLight },
  logoutButton: {
    marginHorizontal: 16, marginTop: 24,
    borderWidth: 1, borderColor: '#fca5a5',
    borderRadius: 12, padding: 16, alignItems: 'center', backgroundColor: '#fff5f5',
  },
  logoutText: { color: COLORS.error, fontWeight: '700', fontSize: 16 },
  version: { marginTop: 20, textAlign: 'center', fontSize: 12, color: COLORS.textLight },
});

const modal = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  close: { fontSize: 22, color: COLORS.gray500, paddingHorizontal: 4 },
  body: { padding: 20 },
  label: { fontSize: 14, color: COLORS.gray500, marginBottom: 12 },
  codeInput: {
    borderWidth: 2, borderColor: COLORS.teal500, borderRadius: 10,
    padding: 14, fontSize: 22, fontWeight: '700', letterSpacing: 4,
    textAlign: 'center', color: COLORS.text,
  },
  error: { color: COLORS.error, fontSize: 13, marginTop: 10, textAlign: 'center' },
  classCard: {
    marginTop: 14, backgroundColor: COLORS.teal50, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: COLORS.teal100,
  },
  className: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  classTeacher: { fontSize: 13, color: COLORS.gray500, marginTop: 4 },
  joinBtn: {
    marginTop: 16, backgroundColor: COLORS.teal500,
    borderRadius: 12, padding: 16, alignItems: 'center',
  },
  joinBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
