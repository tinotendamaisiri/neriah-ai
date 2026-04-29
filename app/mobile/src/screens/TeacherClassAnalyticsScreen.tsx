// src/screens/TeacherClassAnalyticsScreen.tsx
// Full class analytics breakdown for a teacher.
// Fetches /api/analytics/class/{class_id}
// Shows: summary cards, score distribution bar chart, performance over time line chart,
//        student rankings, AI insights.

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getClassAnalytics, listAnswerKeys } from '../services/api';
import type { AnswerKey } from '../types';
import { ScreenContainer } from '../components/ScreenContainer';
import { BackButton } from '../components/BackButton';
import { useLanguage } from '../context/LanguageContext';
import { COLORS } from '../constants/colors';
import type { ClassAnalyticsDetail, RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'TeacherClassAnalytics'>;

function rankColor(rank: number, total: number): string {
  const pct = rank / total;
  if (pct <= 0.25) return COLORS.teal500;
  if (pct <= 0.75) return COLORS.warning;
  return COLORS.error;
}

function accuracyColor(pct: number): string {
  if (pct < 40) return COLORS.error;
  if (pct < 70) return COLORS.warning;
  return COLORS.teal500;
}

function trendArrow(trend: 'up' | 'down' | 'stable'): string {
  if (trend === 'up') return '↑';
  if (trend === 'down') return '↓';
  return '→';
}

function trendColor(trend: 'up' | 'down' | 'stable'): string {
  if (trend === 'up') return COLORS.success;
  if (trend === 'down') return COLORS.error;
  return COLORS.gray500;
}

export default function TeacherClassAnalyticsScreen({ route }: Props) {
  const navigation = useNavigation<any>();
  const { class_id = '', class_name = '' } = route?.params ?? {};
  const { t } = useLanguage();

  const [data, setData] = useState<ClassAnalyticsDetail | null>(null);
  const [homeworks, setHomeworks] = useState<AnswerKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, keys] = await Promise.all([
        getClassAnalytics(class_id),
        listAnswerKeys(class_id),
      ]);
      setData(res);
      setHomeworks(keys);
    } catch (e: any) {
      setError(e?.message ?? t('error'));
    } finally {
      setLoading(false);
    }
  }, [class_id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.teal500} />
        <Text style={styles.loadingText}>{t('analytics_loading')}</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? t('error')}</Text>
        <TouchableOpacity onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>{t('retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Null-safe destructure — API may return partial data
  const summary = data.summary ?? { class_average: 0, highest_score: 0, lowest_score: 0, total_submissions: 0, graded_submissions: 0, total_students: 0 };
  const performance_over_time = data.performance_over_time ?? [];
  const students = data.students ?? [];

  // ── AI Insights ───────────────────────────────────────────────────────────────
  const showInsights = (summary.total_submissions ?? 0) >= 10;

  const insightStrengths: string[] = [];
  const insightImprovements: string[] = [];
  const insightRecommendations: string[] = [];

  if (showInsights && performance_over_time.length > 0) {
    const highHW = performance_over_time.filter((e) => (e?.average_score ?? 0) > 70);
    highHW.forEach((e) => {
      insightStrengths.push(
        `Strong performance on ${e.homework_title} — ${e.average_score}% average`,
      );
    });

    const lowHW = performance_over_time.filter((e) => e.average_score < 50);
    lowHW.forEach((e) => {
      insightImprovements.push(
        `${e.homework_title} averaging ${e.average_score}% — consider review exercises`,
      );
    });

    const improvPct = summary.improvement_pct;
    if (improvPct !== null && improvPct !== undefined && improvPct < -5) {
      insightRecommendations.push(
        'Class performance declining — consider reviewing recent material',
      );
    }

    const struggling = students.filter((s) => s.average_score < 40);
    if (struggling.length > 0) {
      insightRecommendations.push(
        `${struggling.length} student(s) need extra support`,
      );
    }

    if (insightRecommendations.length === 0) {
      insightRecommendations.push('Keep up the great work!');
    }
  }

  return (
    <ScreenContainer scroll={false}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton variant="onTeal" />
        <Text style={styles.heading} numberOfLines={2}>{class_name}</Text>
      </View>

      {/* Class Weak Topics — aggregated across all students.
          Per-student weakness is on TeacherStudentAnalyticsScreen. */}
      {(data.class_weaknesses_aggregated?.length ?? 0) > 0 && (
        <>
          <Text style={styles.sectionTitle}>Class weak topics</Text>
          <View style={styles.weakTopicsCard}>
            {(data.class_weaknesses_aggregated ?? []).slice(0, 5).map((w, i) => (
              <View
                key={`${w.topic}-${i}`}
                style={[
                  styles.weakTopicRow,
                  i === Math.min(4, (data.class_weaknesses_aggregated?.length ?? 0) - 1) && styles.weakTopicRowLast,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.weakTopicText} numberOfLines={2}>{w.topic}</Text>
                  <Text style={styles.weakTopicMeta}>
                    {w.attempts} attempt{w.attempts === 1 ? '' : 's'} across the class
                  </Text>
                </View>
                <Text style={[styles.weakTopicAccuracy, { color: accuracyColor(w.accuracy_pct) }]}>
                  {w.accuracy_pct}%
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Homeworks in this class — tap any to drill into per-homework analytics */}
      {homeworks.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Homeworks ({homeworks.length})</Text>
          {homeworks.map((hw) => (
            <TouchableOpacity
              key={hw.id}
              style={styles.homeworkRow}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('HomeworkAnalytics', {
                homework_id: hw.id,
                homework_title: hw.title || hw.subject || 'Homework',
                class_id,
                class_name,
              })}
            >
              <Ionicons name="document-text-outline" size={18} color={COLORS.teal500} style={{ marginRight: 10 }} />
              <View style={styles.hwInfo}>
                <Text style={styles.hwTitle} numberOfLines={1}>{hw.title || hw.subject || 'Homework'}</Text>
                {hw.subject ? <Text style={styles.hwSub}>{hw.subject}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.gray200} />
            </TouchableOpacity>
          ))}
        </>
      )}

      {/* Student Rankings — tap a student to see their individual weaknesses + history */}
      <Text style={styles.sectionTitle}>{t('student_rankings')}</Text>
      {students.length === 0 ? (
        <View style={styles.noDataBox}>
          <Text style={styles.noDataText}>No students enrolled yet</Text>
        </View>
      ) : (
        students.filter(Boolean).map((s: any, idx: number) => {
          const sid = s.student_id ?? s.id;
          return (
          <TouchableOpacity
            key={sid ?? idx}
            style={styles.studentRow}
            onPress={() =>
              sid ? navigation.navigate('TeacherStudentAnalytics', {
                student_id: sid,
                student_name: s.name ?? 'Student',
                class_id,
                class_name,
              }) : undefined
            }
          >
            <View
              style={[
                styles.rankBadge,
                { backgroundColor: rankColor(idx + 1, students.length) },
              ]}
            >
              <Text style={styles.rankNum}>{idx + 1}</Text>
            </View>
            <View style={styles.studentInfo}>
              <Text style={styles.studentName}>{s.name}</Text>
              <Text style={styles.studentSub}>
                {s.submission_count ?? s.submissions_count ?? 0} {t('submissions_label').toLowerCase()}
              </Text>
            </View>
            <View style={styles.studentRight}>
              <Text
                style={[
                  styles.studentScore,
                  { color: rankColor(idx + 1, students.length) },
                ]}
              >
                {(s.submission_count ?? s.submissions_count ?? 0) > 0 ? `${s.average_score ?? 0}%` : '—'}
              </Text>
              <Text style={[styles.trendArrow, { color: trendColor(s.trend) }]}>
                {trendArrow(s.trend)}
              </Text>
            </View>
          </TouchableOpacity>
          );
        })
      )}

      {/* AI Insights */}
      {showInsights && (
        <>
          <Text style={styles.sectionTitle}>{t('ai_insights')}</Text>
          <View style={styles.insightCard}>
            {insightStrengths.length > 0 && (
              <>
                <Text style={styles.insightHeading}>{t('class_strengths')}</Text>
                {insightStrengths.map((s, i) => (
                  <Text key={i} style={styles.insightBullet}>{'• ' + s}</Text>
                ))}
              </>
            )}
            {insightImprovements.length > 0 && (
              <>
                <Text style={[styles.insightHeading, { marginTop: 10 }]}>{t('areas_for_improvement')}</Text>
                {insightImprovements.map((s, i) => (
                  <Text key={i} style={[styles.insightBullet, { color: COLORS.error }]}>{'• ' + s}</Text>
                ))}
              </>
            )}
            <Text style={[styles.insightHeading, { marginTop: 10 }]}>{t('recommendations')}</Text>
            {insightRecommendations.map((s, i) => (
              <Text key={i} style={styles.insightBullet}>{'• ' + s}</Text>
            ))}
          </View>
        </>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingBottom: 24,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: COLORS.gray500,
    fontSize: 14,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: COLORS.teal500,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: COLORS.white,
    fontWeight: '600',
    fontSize: 14,
  },
  header: {
    backgroundColor: COLORS.teal500,
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    marginBottom: 8,
  },
  backText: {
    color: COLORS.white,
    fontSize: 14,
    opacity: 0.85,
  },
  heading: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.white,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 20,
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  noDataBox: {
    marginHorizontal: 16,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noDataText: {
    color: COLORS.gray500,
    fontSize: 13,
    fontStyle: 'italic',
  },
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankNum: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 13,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  studentSub: {
    fontSize: 12,
    color: COLORS.gray500,
    marginTop: 1,
  },
  studentRight: {
    alignItems: 'flex-end',
  },
  studentScore: {
    fontSize: 16,
    fontWeight: '700',
  },
  trendArrow: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  insightCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  insightHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  insightBullet: {
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 2,
  },
  homeworkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  hwInfo: { flex: 1 },
  hwTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  hwSub: { fontSize: 11, color: COLORS.gray500, marginTop: 2 },
  weakTopicsCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  weakTopicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.background,
  },
  weakTopicRowLast: { borderBottomWidth: 0 },
  weakTopicText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  weakTopicMeta: { fontSize: 11, color: COLORS.gray500, marginTop: 2 },
  weakTopicAccuracy: { fontSize: 16, fontWeight: '700', marginLeft: 12 },
});
