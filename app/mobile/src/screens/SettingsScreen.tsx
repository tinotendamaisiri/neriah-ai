// src/screens/SettingsScreen.tsx
// Teacher profile, account settings, and logout.

import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Linking,
} from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { LangCode } from '../i18n/translations';
import { deletePin } from '../services/api';
import { RootStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import { maskPhone } from '../utils/maskPhone';

const LANGUAGES: Array<{ code: LangCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'sn', label: 'Shona' },
  { code: 'nd', label: 'Ndebele' },
];

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { user, logout, hasPin: ctxHasPin, markPinSet } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const isFocused = useIsFocused();

  // Re-read SecureStore every time this screen gains focus so the PIN row
  // updates immediately after returning from SetPinScreen, regardless of
  // whether AuthContext has been notified yet.
  const [hasPin, setHasPinLocal] = useState(ctxHasPin);
  useEffect(() => {
    if (!isFocused) return;
    SecureStore.getItemAsync('neriah_has_pin').then(val => {
      const pinSet = val === 'true';
      console.log('[SettingsScreen] focus check — SecureStore neriah_has_pin =', val, '| ctxHasPin =', ctxHasPin);
      setHasPinLocal(pinSet);
      // Sync AuthContext if it's out of date
      if (pinSet && !ctxHasPin) markPinSet();
    });
  }, [isFocused]);

  const handleLogout = () => {
    Alert.alert(t('log_out'), t('log_out_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('log_out'), style: 'destructive', onPress: logout },
    ]);
  };

  const handleSetPin = () => navigation.navigate('SetPin');

  const handleResetPin = () => {
    Alert.alert(
      t('reset_pin_title'),
      t('reset_pin_msg'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('remove_pin'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePin();
              Alert.alert(t('pin_removed'), t('pin_removed_msg'));
            } catch (err: any) {
              Alert.alert(t('error'), err.message ?? 'Could not remove PIN.');
            }
          },
        },
      ],
    );
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
            Linking.openURL(`mailto:support@neriah.africa?subject=${subject}&body=${body}`);
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
          <TouchableOpacity style={styles.settingsRow} onPress={handleResetPin}>
            <Text style={styles.settingsRowLabel}>{t('reset_pin')}</Text>
            <Text style={styles.rowChevron}>›</Text>
          </TouchableOpacity>
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
  deleteRowLabel: { color: COLORS.error },
});
