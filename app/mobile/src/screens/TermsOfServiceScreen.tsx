// src/screens/TermsOfServiceScreen.tsx

import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { BackButton } from '../components/BackButton';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { RootStackParamList } from '../types';
import { useLanguage } from '../context/LanguageContext';

type Tab = 'terms' | 'privacy';

interface Section {
  title: string;
  body: string | React.ReactNode;
}

const TERMS_SECTIONS: Section[] = [
  {
    title: '1. About Neriah',
    body: 'Neriah is an AI-powered homework grading platform built for African classrooms. The platform uses artificial intelligence to assist teachers and students with homework grading and feedback, reducing the time teachers spend on manual marking.',
  },
  {
    title: '2. Acceptance of Terms',
    body: 'By creating an account and using Neriah, you agree to these terms. If you do not agree to any part of these terms, do not use the service.',
  },
  {
    title: '3. Use of the Service',
    body: '• Neriah is intended for educational use only.\n• Teachers are responsible for reviewing all AI-generated grades before sharing with students.\n• Students may only submit their own work.\n• You may not use Neriah to submit fraudulent, plagiarised, or AI-generated work as your own.\n• You may not attempt to reverse-engineer, manipulate, or abuse the AI grading system.',
  },
  {
    title: '4. AI Grading Disclaimer',
    body: 'Neriah uses artificial intelligence to assist with grading. AI-generated grades are suggestions and must be reviewed and approved by the teacher before being shared with students.\n\nNeriah does not guarantee the accuracy of AI-generated grades. AI can misread handwriting, miss context-dependent answers, or grade too strictly or too leniently. Final grading decisions rest solely with the teacher.',
  },
  {
    title: '5. Data and Privacy',
    body: '• We collect your name, phone number, and school to create your account.\n• Student submission images are processed by AI and stored securely.\n• We do not sell your data to third parties.\n• Data is stored on Google Cloud infrastructure.\n\nSee our Privacy Policy tab for full details.',
  },
  {
    title: '6. Intellectual Property',
    body: 'All content, branding, and software on Neriah is owned by Neriah Africa. You may not reproduce, distribute, or create derivative works from any part of the platform without prior written permission.',
  },
  {
    title: '7. Termination',
    body: 'We reserve the right to suspend or terminate accounts that violate these terms, engage in fraudulent activity, or misuse the platform. You may delete your account at any time by contacting support@neriah.ai.',
  },
  {
    title: '8. Limitation of Liability',
    body: 'Neriah is provided as-is. We are not liable for any loss of data, incorrect grades, or any indirect, incidental, or consequential damages arising from use of the service.',
  },
  {
    title: '9. Changes to Terms',
    body: 'We may update these terms at any time. We will update the date at the bottom of this page when we do. Continued use of the service after changes constitutes acceptance of the new terms.',
  },
  {
    title: '10. Contact',
    body: 'For questions about these terms, contact us at:\n\nEmail: support@neriah.ai\nWebsite: neriah.ai',
  },
];

const PRIVACY_SECTIONS: Section[] = [
  {
    title: '1. Information We Collect',
    body: '• Name, phone number, and school name (at registration)\n• Student submission images (for AI grading)\n• Usage data (app interactions, grading history)\n• Device information (for push notifications)',
  },
  {
    title: '2. How We Use Your Information',
    body: '• To provide the homework grading service\n• To send OTP verification codes via SMS\n• To send push notifications about grading results\n• To improve AI grading accuracy over time\n• To provide customer support',
  },
  {
    title: '3. Data Storage and Security',
    body: '• All data is stored on Google Cloud Platform.\n• Data is encrypted in transit (TLS) and at rest.\n• Images are stored securely and not shared with third parties.\n• OTP codes are hashed and never stored in plain text.\n• We retain your data for as long as your account is active. On account deletion, your data is permanently removed.',
  },
  {
    title: '4. Data Sharing',
    body: 'We do not sell your personal data. We share data only with:\n\n• Google Cloud — infrastructure and storage provider\n• Twilio — OTP SMS delivery only\n\nWe do not share data with advertising networks, data brokers, or any other third parties.',
  },
  {
    title: '5. Your Rights',
    body: '• You may request a copy of your personal data by contacting support@neriah.ai.\n• You may request account and data deletion by contacting support@neriah.ai.\n• We will acknowledge and process all requests within 48 hours.',
  },
  {
    title: '6. Children',
    body: 'Neriah may be used by students under the age of 18 under the direct supervision of their teacher or school. We do not knowingly collect personal data from children without teacher or school authorisation.',
  },
  {
    title: '7. Contact',
    body: 'For privacy-related questions or data requests:\n\nEmail: support@neriah.ai\nWebsite: neriah.ai',
  },
];

type Route = RouteProp<RootStackParamList, 'TermsOfService'>;

export default function TermsOfServiceScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<Route>();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>(route.params?.initialTab ?? 'terms');

  const sections = activeTab === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS;
  const lastUpdated = 'April 2026';

  return (
    <ScreenContainer scroll={false}>
      {/* Header — back button + title side-by-side */}
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.heading, styles.headerTitleFlex]}>{t('legal')}</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'terms' && styles.tabActive]}
          onPress={() => setActiveTab('terms')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabLabel, activeTab === 'terms' && styles.tabLabelActive]}>
            {t('terms_of_service')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'privacy' && styles.tabActive]}
          onPress={() => setActiveTab('privacy')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabLabel, activeTab === 'privacy' && styles.tabLabelActive]}>
            {t('privacy_policy')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        key={activeTab}
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        {sections.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.body}>{section.body as string}</Text>
          </View>
        ))}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Last updated: {lastUpdated}</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  header: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitleFlex: { flex: 1 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  backText: { fontSize: 16, color: COLORS.gray500, marginLeft: 2 },
  heading: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  // Tabs
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: COLORS.teal500,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  tabLabelActive: {
    color: COLORS.teal500,
  },
  // Content
  scroll: { flex: 1, backgroundColor: COLORS.white },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.teal500,
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: COLORS.gray900 ?? COLORS.text,
    lineHeight: 22,
  },
  footer: { marginTop: 16, alignItems: 'center', paddingBottom: 8 },
  footerText: { fontSize: 13, color: COLORS.textLight },
});
