// src/play/screens/PlayGameScreen.tsx
//
// Mounts the GameEngine for the chosen lesson + format. The engine owns
// the actual gameplay loop; this screen is just a router + loader. On
// session end we hop to PlaySessionEnd.
//
// Wireframes 7-10 are owned by the GameEngine + scenes.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { COLORS } from '../../constants/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import TrackedPressable from '../../components/TrackedPressable';
import { useLanguage } from '../../context/LanguageContext';
import { track, trackError, trackScreen } from '../../services/analytics';
import { playApi } from '../../services/play';
import GameEngine from '../runtime/GameEngine';
import type { PlayLesson, PlayStackParamList, SessionResult } from '../types';
import { PLAY_FONT, playStyles } from '../playStyles';

type Nav = NativeStackNavigationProp<PlayStackParamList, 'PlayGame'>;
type R = RouteProp<PlayStackParamList, 'PlayGame'>;

export default function PlayGameScreen() {
  const navigation = useNavigation<Nav>();
  const routeParams = useRoute<R>();
  const { lessonId, format } = routeParams.params;
  const { t } = useLanguage();

  const [lesson, setLesson] = useState<PlayLesson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackScreen('PlayGame');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await playApi.getLesson(lessonId);
        if (!cancelled) {
          setLesson(data);
          track('play.session.start', { lesson_id: lessonId, format });
        }
      } catch (err) {
        trackError('play.game.load_failed', err, { lesson_id: lessonId });
        if (!cancelled) setError(t('play_game_load_failed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lessonId, format, t]);

  const onSessionEnd = useCallback(
    (sessionResult: SessionResult) => {
      track('play.session.end', { ...sessionResult });
      navigation.replace('PlaySessionEnd', {
        sessionResult,
        lessonId,
      });
    },
    [navigation, lessonId],
  );

  if (error) {
    return (
      <ScreenContainer scroll={false} edges={['top', 'left', 'right']}>
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
          <TrackedPressable
            analyticsId="play.game.back_on_error"
            style={[playStyles.primaryPill, { marginTop: 12 }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={playStyles.primaryPillText}>OK</Text>
          </TrackedPressable>
        </View>
      </ScreenContainer>
    );
  }

  if (!lesson) {
    return (
      <ScreenContainer scroll={false} edges={['top', 'left', 'right']}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={COLORS.teal500} />
          <Text style={styles.loadingText}>{t('play_game_loading')}</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll={false} edges={['top', 'left', 'right']}>
      <GameEngine lesson={lesson} format={format} onSessionEnd={onSessionEnd} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: PLAY_FONT,
    fontSize: 14,
    color: COLORS.textLight,
  },
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorText: {
    fontFamily: PLAY_FONT,
    fontSize: 16,
    color: COLORS.text,
    textAlign: 'center',
  },
});
