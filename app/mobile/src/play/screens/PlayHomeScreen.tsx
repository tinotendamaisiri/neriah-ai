// src/play/screens/PlayHomeScreen.tsx
//
// Play tab landing screen. Shows a personalised greeting, the three most
// recent OWN lessons as recommendations, and primary CTAs for building a
// new game or jumping to the full library.
//
// Wireframe 1.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { COLORS } from '../../constants/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import TrackedPressable from '../../components/TrackedPressable';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { trackScreen } from '../../services/analytics';
import { playApi } from '../../services/play';
import type { PlayLesson, PlayStackParamList } from '../types';
import { PLAY_FONT, playStyles } from '../playStyles';

type Nav = NativeStackNavigationProp<PlayStackParamList, 'PlayHome'>;

export default function PlayHomeScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const { t } = useLanguage();

  const [lessons, setLessons] = useState<PlayLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const firstName = (user?.first_name as string | undefined) || '';

  useEffect(() => {
    trackScreen('PlayHome');
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await playApi.listLessons();
      setLessons(data);
    } catch {
      // Library defaults to empty when the call fails — the screen still
      // renders the build CTA so the student can keep going.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  // Recommended = 3 most recent OWN lessons by created_at desc.
  const recommendations = lessons
    .filter((l) => l.origin === 'mine' || (!l.origin && l.owner_id === (user?.id ?? '')))
    .slice()
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 3);

  if (loading) {
    return (
      <ScreenContainer scroll={false} edges={['top', 'left', 'right']}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={COLORS.teal500} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll={false} edges={['top', 'left', 'right']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.teal500} />
        }
      >
        {/* Teal header with greeting */}
        <View style={playStyles.headerBand}>
          <Text style={playStyles.headerTitle}>
            {t('play_home_greeting').replace('{name}', firstName || 'there')}
          </Text>
          <Text style={playStyles.headerSub}>{t('play')}</Text>
        </View>

        {/* Empty state */}
        {recommendations.length === 0 && (
          <View style={styles.emptyWrap}>
            <Ionicons name="game-controller-outline" size={64} color={COLORS.teal300} />
            <Text style={[playStyles.body, styles.emptyText]}>{t('play_home_empty')}</Text>
            <TrackedPressable
              analyticsId="play.home.build_cta_empty"
              style={[playStyles.primaryPill, styles.emptyCta]}
              onPress={() => navigation.navigate('PlayBuild')}
            >
              <Text style={playStyles.primaryPillText}>{t('play_home_make_new')}</Text>
            </TrackedPressable>
          </View>
        )}

        {recommendations.length > 0 && (
          <>
            <View style={playStyles.section}>
              <Text style={playStyles.sectionTitle}>{t('play_home_recommended')}</Text>
              {recommendations.map((lesson) => (
                <TrackedPressable
                  key={lesson.id}
                  analyticsId="play.home.recommendation.open"
                  analyticsPayload={{ lesson_id: lesson.id }}
                  style={playStyles.card}
                  onPress={() => navigation.navigate('PlayPreview', { lessonId: lesson.id })}
                >
                  <Text style={playStyles.cardTitle} numberOfLines={2}>
                    {lesson.title}
                  </Text>
                  <Text style={playStyles.cardMeta}>
                    {[lesson.subject, t('play_home_questions_count').replace('{n}', String(lesson.question_count))]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <Text style={[styles.gameType]}>{t('play_game_lane_runner')}</Text>
                </TrackedPressable>
              ))}
            </View>

            <View style={[playStyles.section, styles.ctaRow]}>
              <TrackedPressable
                analyticsId="play.home.build_cta"
                style={playStyles.primaryPill}
                onPress={() => navigation.navigate('PlayBuild')}
              >
                <Text style={playStyles.primaryPillText}>{t('play_home_make_new')}</Text>
              </TrackedPressable>

              <TrackedPressable
                analyticsId="play.home.library_link"
                style={styles.linkBtn}
                onPress={() => navigation.navigate('PlayLibrary')}
              >
                <Text style={styles.linkText}>{t('play_home_view_library')}</Text>
              </TrackedPressable>
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: {
    paddingHorizontal: 24,
    paddingVertical: 36,
    alignItems: 'center',
    gap: 16,
  },
  emptyText: {
    textAlign: 'center',
    color: COLORS.textLight,
  },
  emptyCta: { alignSelf: 'stretch', marginTop: 8 },
  gameType: {
    marginTop: 6,
    fontFamily: PLAY_FONT,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.teal500,
  },
  ctaRow: {
    paddingTop: 8,
    paddingBottom: 24,
    gap: 12,
  },
  linkBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  linkText: {
    fontFamily: PLAY_FONT,
    fontSize: 14,
    color: COLORS.teal500,
    fontWeight: '600',
  },
});
