// src/screens/StudentResultsScreen.tsx
//
// Placeholder for the future "Play" surface (gamified study mini-games).
//
// History — what used to live here:
//   This file used to render the full "My Results" screen. As of
//   2026-05-04 the Results UI moved INSIDE StudentHomeScreen as a
//   sub-tab next to "My Assignments" — the tap-to-feedback / withdraw
//   logic was extracted into `components/StudentResultsView.tsx` so
//   both surfaces can share it.
//
//   The bottom-nav tab that used to point at "Results" is now labelled
//   "Play" and points at this screen, which currently just shows a
//   gamepad icon + "Coming soon" copy. Replace with real content when
//   the gamification surface is ready.
//
// Why keep the file path:
//   `StudentResults` is wired into the StudentTabParamList + the
//   StudentTab.Navigator config in App.tsx. Renaming the route would
//   break every existing deep-link target. Keeping the path and
//   swapping content is the minimal-touch change.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { ScreenContainer } from '../components/ScreenContainer';
import { useLanguage } from '../context/LanguageContext';

export default function StudentResultsScreen() {
  const { t } = useLanguage();
  return (
    <ScreenContainer
      scroll={false}
      edges={['top', 'left', 'right']}
      style={{ backgroundColor: COLORS.background }}
    >
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name="game-controller-outline" size={88} color={COLORS.teal500} />
        </View>
        <Text style={styles.title}>{t('play')}</Text>
        <Text style={styles.subtitle}>{t('coming_soon')}</Text>
        <Text style={styles.body}>{t('play_blurb')}</Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: COLORS.teal50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.warning,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  body: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
});
