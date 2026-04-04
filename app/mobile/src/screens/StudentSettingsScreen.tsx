// src/screens/StudentSettingsScreen.tsx
// Full student settings: profile, class management, support, legal, logout.

import React, { useState } from 'react';
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
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getClassJoinInfo, joinClass } from '../services/api';
import { COLORS } from '../constants/colors';

export default function StudentSettingsScreen() {
  const { user, logout } = useAuth();
  const [joinModalVisible, setJoinModalVisible] = useState(false);

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

      {/* Sign out */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Neriah v1.0.0</Text>

      {/* Join class modal */}
      <JoinClassModal
        visible={joinModalVisible}
        onClose={() => setJoinModalVisible(false)}
      />
    </ScrollView>
  );
}

// ── Join class modal ──────────────────────────────────────────────────────────

function JoinClassModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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
      await joinClass(code);
      Alert.alert('Joined!', `You've joined ${classInfo.name}. Restart the app to see your assignments.`);
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
