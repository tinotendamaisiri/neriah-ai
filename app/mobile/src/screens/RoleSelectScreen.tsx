// src/screens/RoleSelectScreen.tsx
// Landing screen for unauthenticated users.
// New users choose their role → registration form.
// Existing users tap "Sign in" → Phone entry.

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../context/LanguageContext';
import { AuthStackParamList } from '../types';
import { COLORS } from '../constants/colors';
const logoImage = require('../../assets/icon-transparent.png');

type Nav = NativeStackNavigationProp<AuthStackParamList, 'RoleSelect'>;

export default function RoleSelectScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useLanguage();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Image source={logoImage} style={styles.logoMark} />
          <Text style={styles.heading}>{t('welcome')}</Text>
        </View>

        {/* Role cards */}
        <View style={styles.cards}>
          {/* Teacher card */}
          <TouchableOpacity
            style={[styles.card, styles.cardTeacher]}
            onPress={() => navigation.navigate('TeacherRegister')}
            activeOpacity={0.85}
          >
            <Ionicons name="briefcase-outline" size={40} color={COLORS.white} />
            <Text style={styles.cardTitle}>{t('im_teacher')}</Text>
            <Text style={styles.cardSubtitle}>{t('teacher_sub')}</Text>
          </TouchableOpacity>

          {/* Student card */}
          <TouchableOpacity
            style={[styles.card, styles.cardStudent]}
            onPress={() => navigation.navigate('StudentRegister')}
            activeOpacity={0.85}
          >
            <Ionicons name="school-outline" size={40} color={COLORS.white} />
            <Text style={styles.cardTitle}>{t('im_student')}</Text>
            <Text style={styles.cardSubtitle}>{t('student_sub')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>
          {t('already_account')}{' '}
          <Text style={styles.hintLink} onPress={() => navigation.navigate('Phone')}>
            {t('sign_in')}
          </Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 40 },
  logoMark: {
    width: 100, height: 100, marginBottom: 8, resizeMode: 'contain',
  },
  heading: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginBottom: 6 },
  subheading: { fontSize: 15, color: COLORS.gray500 },
  cards: { gap: 16 },
  card: {
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 10,
    minHeight: 140,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  cardTeacher: { backgroundColor: COLORS.teal500 },
  cardStudent: { backgroundColor: COLORS.amber300 },
  cardTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.white },
  cardSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  hint: { marginTop: 36, textAlign: 'center', fontSize: 14, color: COLORS.gray500 },
  hintLink: { color: COLORS.teal500, fontWeight: '600' },
});
