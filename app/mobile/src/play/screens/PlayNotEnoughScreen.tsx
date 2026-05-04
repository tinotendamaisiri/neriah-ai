// src/play/screens/PlayNotEnoughScreen.tsx
//
// Shown when the generator could not reach the 70-question minimum.
// Wireframe 5.
//
// Two recovery paths:
//   - "Add AI-generated content" → playApi.expandLesson lets Gemma 4 invent
//     more on the same topic.
//   - "Type more notes" → playApi.appendLesson with extra student-typed
//     material.
//
// Each attempt fires a `play.lesson.fallback_attempt` analytics event.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { COLORS } from '../../constants/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { BackButton } from '../../components/BackButton';
import TrackedPressable from '../../components/TrackedPressable';
import { useLanguage } from '../../context/LanguageContext';
import { track, trackError, trackScreen } from '../../services/analytics';
import { playApi } from '../../services/play';
import type { PlayLesson, PlayStackParamList } from '../types';
import { PLAY_FONT, playStyles } from '../playStyles';

type Nav = NativeStackNavigationProp<PlayStackParamList, 'PlayNotEnough'>;
type R = RouteProp<PlayStackParamList, 'PlayNotEnough'>;

export default function PlayNotEnoughScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { lessonId } = route.params;
  const { t } = useLanguage();

  const [lesson, setLesson] = useState<PlayLesson | null>(null);
  const [busy, setBusy] = useState(false);
  const [appendOpen, setAppendOpen] = useState(false);
  const [appendText, setAppendText] = useState('');
  const [attemptCount, setAttemptCount] = useState(0);

  useEffect(() => {
    trackScreen('PlayNotEnough');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await playApi.getLesson(lessonId);
        if (!cancelled) setLesson(data);
      } catch {
        /* allow render with placeholder count */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const finalise = (next: PlayLesson) => {
    if (next.is_draft) {
      setLesson(next);
    } else {
      navigation.replace('PlayPreview', { lessonId: next.id });
    }
  };

  const onExpand = useCallback(async () => {
    if (busy) return;
    const attempt = attemptCount + 1;
    setAttemptCount(attempt);
    track('play.lesson.fallback_attempt', {
      path: 'expand',
      attempt_n: attempt,
      current_count: lesson?.question_count ?? 0,
      lesson_id: lessonId,
    });
    setBusy(true);
    try {
      const next = await playApi.expandLesson(lessonId);
      finalise(next);
    } catch (err) {
      trackError('play.lesson.fallback_failed', err, { path: 'expand' });
      const message = (err as { message?: string })?.message || 'Could not generate more questions.';
      Alert.alert('Expansion failed', message);
    } finally {
      setBusy(false);
    }
  }, [busy, attemptCount, lesson?.question_count, lessonId]);

  const onAppend = useCallback(async () => {
    if (busy || !appendText.trim()) return;
    const attempt = attemptCount + 1;
    setAttemptCount(attempt);
    track('play.lesson.fallback_attempt', {
      path: 'append',
      attempt_n: attempt,
      current_count: lesson?.question_count ?? 0,
      lesson_id: lessonId,
    });
    setBusy(true);
    try {
      const next = await playApi.appendLesson(lessonId, appendText.trim());
      setAppendText('');
      setAppendOpen(false);
      finalise(next);
    } catch (err) {
      trackError('play.lesson.fallback_failed', err, { path: 'append' });
      const message = (err as { message?: string })?.message || 'Could not generate more questions.';
      Alert.alert('Append failed', message);
    } finally {
      setBusy(false);
    }
  }, [busy, appendText, attemptCount, lesson?.question_count, lessonId]);

  const count = lesson?.question_count ?? 0;

  return (
    <ScreenContainer scroll={false} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <BackButton />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('play_notenough_title')}</Text>
        <Text style={styles.subtitle}>{t('play_notenough_subtitle')}</Text>

        <View style={styles.countCard}>
          <Text style={styles.countText}>
            {t('play_notenough_count').replace('{count}', String(count))}
          </Text>
        </View>

        <TrackedPressable
          analyticsId="play.notenough.expand"
          style={[styles.choiceCard]}
          onPress={onExpand}
          disabled={busy}
        >
          <Text style={styles.choiceTitle}>{t('play_notenough_expand')}</Text>
          <Text style={styles.choiceSub}>{t('play_notenough_expand_sub')}</Text>
          {busy && <ActivityIndicator color={COLORS.teal500} style={{ marginTop: 8 }} />}
        </TrackedPressable>

        <TrackedPressable
          analyticsId="play.notenough.append_open"
          style={[styles.choiceCard]}
          onPress={() => setAppendOpen((v) => !v)}
          disabled={busy}
        >
          <Text style={styles.choiceTitle}>{t('play_notenough_append')}</Text>
          <Text style={styles.choiceSub}>{t('play_notenough_append_sub')}</Text>
        </TrackedPressable>

        {appendOpen && (
          <View style={styles.appendBox}>
            <TextInput
              value={appendText}
              onChangeText={setAppendText}
              placeholder={t('play_notenough_append_placeholder')}
              placeholderTextColor={COLORS.textLight}
              multiline
              numberOfLines={5}
              style={styles.appendInput}
            />
            <TrackedPressable
              analyticsId="play.notenough.append_submit"
              style={[
                playStyles.primaryPill,
                { marginTop: 12 },
                (busy || !appendText.trim()) && { opacity: 0.5 },
              ]}
              onPress={onAppend}
              disabled={busy || !appendText.trim()}
            >
              {busy ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={playStyles.primaryPillText}>
                  {t('play_notenough_append_submit')}
                </Text>
              )}
            </TrackedPressable>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: 16, paddingVertical: 8 },
  body: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  title: {
    fontFamily: PLAY_FONT,
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: PLAY_FONT,
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 21,
    marginBottom: 18,
  },
  countCard: {
    backgroundColor: COLORS.amber50,
    borderRadius: 12,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: COLORS.amber100,
  },
  countText: {
    fontFamily: PLAY_FONT,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.amber700,
    textAlign: 'center',
  },
  choiceCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  choiceTitle: {
    fontFamily: PLAY_FONT,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.teal500,
    marginBottom: 4,
  },
  choiceSub: {
    fontFamily: PLAY_FONT,
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 19,
  },
  appendBox: {
    marginTop: 4,
  },
  appendInput: {
    fontFamily: PLAY_FONT,
    minHeight: 120,
    textAlignVertical: 'top',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    color: COLORS.text,
    fontSize: 14,
  },
});
