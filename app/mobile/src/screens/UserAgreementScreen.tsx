// src/screens/UserAgreementScreen.tsx
// Shown once after first OTP login. User must accept terms before entering the app.

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { acceptTermsOnServer } from '../services/api';
import { COLORS } from '../constants/colors';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function UserAgreementScreen() {
  const navigation = useNavigation<Nav>();
  const { logout, acceptTerms } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleAccept = async () => {
    if (!agreed || loading) return;
    setLoading(true);
    try {
      await acceptTermsOnServer();
    } catch {
      // Non-critical — local acceptance is the source of truth for UX
    }
    await acceptTerms();
    // AppShell re-renders automatically; no navigate() needed
    setLoading(false);
  };

  const handleDecline = () => {
    Alert.alert(
      'Are you sure?',
      'You must accept the Terms of Service and Privacy Policy to use Neriah.',
      [
        { text: 'Go Back', style: 'cancel' },
        {
          text: 'Decline and Exit',
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Logo */}
        <Image
          source={require('../../assets/icon-transparent.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.title}>Before you continue</Text>
        <Text style={styles.subtitle}>
          Please review and accept our terms before using Neriah.
        </Text>

        {/* Document links */}
        <View style={styles.linksCard}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('TermsOfService', { initialTab: 'terms' })}
            activeOpacity={0.7}
          >
            <Ionicons name="document-text-outline" size={20} color={COLORS.teal500} />
            <Text style={styles.linkLabel}>Terms of Service</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.gray500} />
          </TouchableOpacity>

          <View style={styles.linkDivider} />

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('TermsOfService', { initialTab: 'privacy' })}
            activeOpacity={0.7}
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.teal500} />
            <Text style={styles.linkLabel}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.gray500} />
          </TouchableOpacity>
        </View>

        {/* Checkbox */}
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setAgreed(prev => !prev)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
            {agreed && <Ionicons name="checkmark" size={14} color={COLORS.white} />}
          </View>
          <Text style={styles.checkboxLabel}>
            I have read and agree to the{' '}
            <Text style={styles.checkboxLink}>Terms of Service</Text>
            {' '}and{' '}
            <Text style={styles.checkboxLink}>Privacy Policy</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Footer actions */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.acceptBtn, (!agreed || loading) && styles.acceptBtnDisabled]}
          onPress={handleAccept}
          disabled={!agreed || loading}
          activeOpacity={0.8}
        >
          <Text style={styles.acceptBtnText}>
            {loading ? 'Continuing…' : 'Accept and Continue'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.declineBtn} onPress={handleDecline}>
          <Text style={styles.declineBtnText}>Decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  scroll: {
    paddingHorizontal: 28,
    paddingTop: 72,
    paddingBottom: 24,
    alignItems: 'center',
  },
  logo: { width: 80, height: 80, marginBottom: 28 },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 36,
  },
  linksCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    marginBottom: 28,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  linkLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: COLORS.text },
  linkDivider: { height: 1, backgroundColor: COLORS.border, marginHorizontal: 16 },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.teal500,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: COLORS.teal500,
    borderColor: COLORS.teal500,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.gray900 ?? COLORS.text,
    lineHeight: 21,
  },
  checkboxLink: { color: COLORS.teal500, fontWeight: '600' },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 16,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  acceptBtn: {
    backgroundColor: COLORS.teal500,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  acceptBtnDisabled: { opacity: 0.4 },
  acceptBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 16 },
  declineBtn: { alignItems: 'center', paddingVertical: 8 },
  declineBtnText: { fontSize: 15, color: COLORS.gray500, fontWeight: '500' },
});
