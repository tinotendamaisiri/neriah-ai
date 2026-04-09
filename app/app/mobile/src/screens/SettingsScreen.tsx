// src/screens/SettingsScreen.tsx
// Teacher profile, account settings, and logout.

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { LangCode } from '../i18n/translations';
import { hasPin } from '../services/pinLock';
import { RootStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import { isNativeModuleAvailable } from '../services/litert';
import { isModelDownloaded, downloadModel, deleteModel, MODEL_SIZE_LABEL } from '../services/modelManager';
import { getDeviceCapabilities } from '../services/deviceCapabilities';

const LANGUAGES: Array<{ code: LangCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'sn', label: 'Shona' },
  { code: 'nd', label: 'Ndebele' },
];

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { user, logout } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const [pinSet, setPinSet] = useState(false);

  // Refresh PIN state whenever this screen is focused
  useEffect(() => {
    hasPin().then(setPinSet);
  }, []);

  // ── On-Device AI state ────────────────────────────────────────────────────

  const [canRunOnDevice, setCanRunOnDevice] = useState(false);
  const [canRunE4B, setCanRunE4B] = useState(false);
  const [e2bDownloaded, setE2bDownloaded] = useState(false);
  const [e4bDownloaded, setE4bDownloaded] = useState(false);
  const [e2bProgress, setE2bProgress] = useState<number | null>(null);
  const [e4bProgress, setE4bProgress] = useState<number | null>(null);
  const [wifiOnly, setWifiOnly] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [caps, e2b, e4b] = await Promise.all([
        getDeviceCapabilities(),
        isModelDownloaded('e2b'),
        isModelDownloaded('e4b'),
      ]);
      if (!mounted) return;
      setCanRunOnDevice(caps.canRunOnDevice);
      setCanRunE4B(caps.canRunE4B);
      setE2bDownloaded(e2b);
      setE4bDownloaded(e4b);
    })();
    return () => { mounted = false; };
  }, []);

  const handleDownloadModel = async (model: 'e2b' | 'e4b') => {
    const setProgress = model === 'e2b' ? setE2bProgress : setE4bProgress;
    const setDownloaded = model === 'e2b' ? setE2bDownloaded : setE4bDownloaded;
    try {
      setProgress(0);
      await downloadModel(model, pct => setProgress(pct));
      setDownloaded(true);
    } catch (err: any) {
      Alert.alert('Download failed', err?.message ?? 'Could not download model. Check your connection.');
    } finally {
      setProgress(null);
    }
  };

  const handleDeleteModel = (model: 'e2b' | 'e4b') => {
    const label = model === 'e2b' ? 'Student tutor (E2B, 2.5 GB)' : 'Teacher grading (E4B, 3.5 GB)';
    Alert.alert(
      'Delete model?',
      `${label} will be removed from this device. You can re-download it later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteModel(model);
            if (model === 'e2b') setE2bDownloaded(false);
            else setE4bDownloaded(false);
          },
        },
      ],
    );
  };

  const handleLogout = () => {
    Alert.alert(t('log_out'), t('log_out_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('log_out'), style: 'destructive', onPress: logout },
    ]);
  };

  const handleSetPin = () => {
    navigation.navigate('PinLock', { mode: 'setup' });
  };

  const handleChangePin = () => {
    navigation.navigate('PinLock', { mode: 'change' });
  };

  const handleRemovePin = () => {
    navigation.navigate('PinLock', { mode: 'remove' });
  };

  const handleLanguage = () => {
    Alert.alert(
      t('language'),
      'Choose your preferred language',
      [
        ...LANGUAGES.map(l => ({
          text: l.code === language ? `${l.label} ✓` : l.label,
          onPress: () => {
            console.log('[SettingsScreen] language tapped:', l.code, '(current:', language + ')');
            setLanguage(l.code);
            console.log('[SettingsScreen] setLanguage called');
          },
        })),
        { text: t('cancel'), style: 'cancel' },
      ],
    );
  };

  const languageLabel = LANGUAGES.find(l => l.code === language)?.label ?? 'English';

  const displayName = user
    ? `${user.first_name} ${user.surname}`
    : '';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.heading}>{t('settings')}</Text>
      </View>

      {/* Profile */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile')}</Text>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.first_name?.[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profilePhone}>{user?.phone ?? ''}</Text>
            {user?.school && (
              <Text style={styles.profileSchool}>{user.school}</Text>
            )}
          </View>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>
              {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'User'}
            </Text>
          </View>
        </View>
      </View>

      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('subscription')}</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('school')}</Text>
          <Text style={styles.infoValue} numberOfLines={1}>{user?.school ?? '—'}</Text>
        </View>

        <View style={styles.divider} />

        {!pinSet ? (
          <TouchableOpacity style={styles.settingsRow} onPress={handleSetPin}>
            <Text style={styles.settingsRowLabel}>{t('set_pin')}</Text>
            <Text style={styles.rowChevron}>›</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.settingsRow} onPress={handleChangePin}>
              <Text style={styles.settingsRowLabel}>Change PIN</Text>
              <Text style={styles.rowChevron}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.settingsRow} onPress={handleRemovePin}>
              <Text style={[styles.settingsRowLabel, { color: COLORS.error }]}>Remove PIN</Text>
              <Text style={styles.rowChevron}>›</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={[styles.settingsRow, styles.lastRow]} onPress={handleLanguage}>
          <Text style={styles.settingsRowLabel}>{t('language')}</Text>
          <View style={styles.rowRight}>
            <Text style={styles.rowValue}>{languageLabel}</Text>
            <Text style={styles.rowChevron}>›</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* App info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('about')}</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('version')}</Text>
          <Text style={styles.infoValue}>0.1.0</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('backend')}</Text>
          <Text style={styles.infoValue}>neriah-func-dev</Text>
        </View>
      </View>

      {/* On-Device AI */}
      {isNativeModuleAvailable() && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>On-Device AI</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Device capability</Text>
            <Text style={[styles.infoValue, { color: canRunOnDevice ? COLORS.success : COLORS.textLight }]}>
              {canRunOnDevice ? 'Supported' : 'Not supported'}
            </Text>
          </View>
          <View style={styles.divider} />

          {/* E2B — Student tutor model */}
          <View style={styles.modelRow}>
            <View style={styles.modelInfo}>
              <Text style={styles.modelName}>Student tutor (Gemma E2B)</Text>
              <Text style={styles.modelSize}>
                {e2bDownloaded ? `Downloaded · ${MODEL_SIZE_LABEL.e2b}` : MODEL_SIZE_LABEL.e2b}
              </Text>
              {e2bProgress !== null && (
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${e2bProgress}%` }]} />
                </View>
              )}
            </View>
            {e2bProgress !== null ? (
              <ActivityIndicator size="small" color={COLORS.teal500} />
            ) : e2bDownloaded ? (
              <TouchableOpacity onPress={() => handleDeleteModel('e2b')} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            ) : canRunOnDevice ? (
              <TouchableOpacity onPress={() => handleDownloadModel('e2b')} style={styles.downloadBtn}>
                <Text style={styles.downloadBtnText}>Download</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.divider} />

          {/* E4B — Teacher grading model */}
          <View style={styles.modelRow}>
            <View style={styles.modelInfo}>
              <Text style={styles.modelName}>Teacher grading (Gemma E4B)</Text>
              <Text style={styles.modelSize}>
                {e4bDownloaded ? `Downloaded · ${MODEL_SIZE_LABEL.e4b}` : MODEL_SIZE_LABEL.e4b}
              </Text>
              {!canRunE4B && !e4bDownloaded && (
                <Text style={styles.modelHint}>Requires 6 GB+ RAM</Text>
              )}
              {e4bProgress !== null && (
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${e4bProgress}%` }]} />
                </View>
              )}
            </View>
            {e4bProgress !== null ? (
              <ActivityIndicator size="small" color={COLORS.teal500} />
            ) : e4bDownloaded ? (
              <TouchableOpacity onPress={() => handleDeleteModel('e4b')} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            ) : canRunE4B ? (
              <TouchableOpacity onPress={() => handleDownloadModel('e4b')} style={styles.downloadBtn}>
                <Text style={styles.downloadBtnText}>Download</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.divider} />
          <View style={styles.settingsRow}>
            <Text style={styles.settingsRowLabel}>Download on Wi-Fi only</Text>
            <Switch
              value={wifiOnly}
              onValueChange={setWifiOnly}
              trackColor={{ true: COLORS.teal500, false: COLORS.gray200 }}
              thumbColor={COLORS.white}
            />
          </View>
        </View>
      )}

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>{t('log_out')}</Text>
      </TouchableOpacity>
    </ScrollView>
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
  modelRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  modelInfo: { flex: 1 },
  modelName: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  modelSize: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  modelHint: { fontSize: 11, color: COLORS.amber500, marginTop: 2 },
  progressTrack: {
    height: 3, backgroundColor: COLORS.gray200, borderRadius: 2, marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: COLORS.teal500, borderRadius: 2 },
  downloadBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  downloadBtnText: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  deleteBtn: {
    backgroundColor: COLORS.gray200, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  deleteBtnText: { color: COLORS.error, fontSize: 13, fontWeight: '600' },
});
