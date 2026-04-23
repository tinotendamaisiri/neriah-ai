// src/screens/TeacherStudentAnalyticsScreen.tsx
// Per-student analytics for teacher.
// Fetches /api/analytics/student/{student_id}?class_id={class_id}
// Shows: student header, performance line chart (student vs class avg),
//        strengths/weaknesses, submission history, commendations.

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LineChart } from 'react-native-chart-kit';

import { getTeacherStudentAnalytics } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { COLORS } from '../constants/colors';
import type { TeacherStudentAnalyticsData, RootStackParamList } from '../types';
import { ScreenContainer } from '../components/ScreenContainer';

type Props = NativeStackScreenProps<RootStackParamList, 'TeacherStudentAnalytics'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 32;

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export default function TeacherStudentAnalyticsScreen({ route, navigation }: Props) {
  const { student_id, student_name, class_id, class_name } = route.params;
  const { t } = useLanguage();

  const [data, setData] = useState<TeacherStudentAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTeacherStudentAnalytics(student_id, class_id);
      setData(res);
    } catch (e: any) {
      setError(e?.message ?? t('error'));
    } finally {
      setLoading(false);
    }
  }, [student_id, class_id]);

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

  // Null-safe destructure — API may return partial data for new students
  const student = data.student ?? { name: student_name, average_score: 0, total_submissions: 0, register_number: '', first_submission_date: '' };
  const performance_over_time = data.performance_over_time ?? [];
  const strengths = data.strengths ?? [];
  const weaknesses = data.weaknesses ?? [];
  const weaknessesAggregated = data.weaknesses_aggregated ?? [];
  const submissions = data.submissions ?? [];
  const MAX_STRUGGLING_ROWS = 7;
  const strugglingVisible = weaknessesAggregated.slice(0, MAX_STRUGGLING_ROWS);
  const strugglingHiddenCount = Math.max(0, weaknessesAggregated.length - MAX_STRUGGLING_ROWS);

  // ── Performance chart (guard every field — chart-kit crashes on NaN/undefined) ─
  const hasPotData = performance_over_time.length >= 2;
  const potSlice = performance_over_time.slice(-8);
  const potLabels = potSlice.map((e) => (e?.homework_title ?? '').substring(0, 6));
  const studentPcts = potSlice.map((e) => e?.score_pct ?? 0);
  const classAvgs = potSlice.map((e) => e?.class_average ?? 0);
  const hasClassAvg = classAvgs.some((v) => v > 0);

  const chartDatasets = hasPotData
    ? hasClassAvg
      ? [
          {
            data: studentPcts,
            color: (opacity = 1) => `rgba(13,115,119,${opacity})`,
          },
          {
            data: classAvgs,
            color: (opacity = 1) => `rgba(245,166,35,${opacity})`,
            strokeDashArray: [5, 3],
          },
        ]
      : [
          {
            data: studentPcts,
            color: (opacity = 1) => `rgba(13,115,119,${opacity})`,
          },
        ]
    : [];

  const chartConfig = {
    backgroundColor: COLORS.white,
    backgroundGradientFrom: COLORS.white,
    backgroundGradientTo: COLORS.white,
    color: (opacity = 1) => `rgba(13, 115, 119, ${opacity})`,
    decimalPlaces: 0,
    labelColor: () => COLORS.gray500,
    propsForDots: { r: '4', strokeWidth: '2', stroke: COLORS.teal500 },
  };

  // ── Commendations ─────────────────────────────────────────────────────────────
  const showCommendations = (student.total_submissions ?? 0) >= 10;
  let commendation = '';

  if (showCommendations) {
    const recent = performance_over_time.slice(-5);
    const prevRecent = performance_over_time.slice(-10, -5);

    if (
      recent.length >= 2 &&
      prevRecent.length >= 2 &&
      mean(recent.map((e) => e.score_pct)) > mean(prevRecent.map((e) => e.score_pct)) + 3
    ) {
      const diff = mean(recent.map((e) => e.score_pct)) - mean(prevRecent.map((e) => e.score_pct));
      commendation = `Great improvement! Score increased by ${Math.round(diff)}% over last 5 submissions`;
    } else if (student.average_score >= 80) {
      commendation = 'Excellent consistency — averaging above 80%';
    } else if ((student.average_score ?? 0) < 40 && weaknesses.length > 0) {
      commendation = `Keep going — focus on ${weaknesses[0]?.homework_title ?? 'weak areas'} for improvement`;
    } else {
      commendation = 'Good progress! Keep it up.';
    }
  }

  return (
    <ScreenContainer scroll={false}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>{t('back')}</Text>
        </TouchableOpacity>
        <Text style={styles.heading} numberOfLines={2}>{student_name}</Text>
        <Text style={styles.subheading}>{class_name}</Text>
      </View>

      {/* Student header card */}
      <View style={styles.studentCard}>
        <View style={styles.studentCardRow}>
          <View style={styles.studentCardLeft}>
            <Text style={styles.studentCardName}>{student.name || student_name}</Text>
            {student.register_number ? (
              <Text style={styles.studentCardSub}>Reg: {student.register_number}</Text>
            ) : null}
            <Text style={styles.studentCardSub}>
              {student.total_submissions ?? 0} {t('submissions_label').toLowerCase()}
              {student.first_submission_date
                ? `  ·  ${t('since_label')} ${student.first_submission_date}`
                : ''}
            </Text>
          </View>
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreBadgeValue}>{student.average_score ?? 0}%</Text>
            <Text style={styles.scoreBadgeLabel}>{t('avg_score')}</Text>
          </View>
        </View>
      </View>

      {/* Empty state — no submissions yet */}
      {submissions.length === 0 && performance_over_time.length === 0 && (
        <View style={styles.noDataBox}>
          <Text style={[styles.noDataText, { fontWeight: '700', fontSize: 15 }]}>No submissions yet</Text>
          <Text style={[styles.noDataText, { marginTop: 4 }]}>
            This student has not submitted any homework yet. Grades will appear here once work is marked.
          </Text>
        </View>
      )}

      {/* Performance Over Time */}
      <Text style={styles.sectionTitle}>{t('performance_chart')}</Text>
      {hasPotData ? (
        <>
          {hasClassAvg && (
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: COLORS.teal500 }]} />
              <Text style={styles.legendLabel}>{student.name}</Text>
              <View style={[styles.legendDot, { backgroundColor: COLORS.warning, marginLeft: 12 }]} />
              <Text style={styles.legendLabel}>Class Avg</Text>
            </View>
          )}
          <LineChart
            data={{
              labels: potLabels,
              datasets: chartDatasets,
            }}
            width={CHART_WIDTH}
            height={200}
            chartConfig={chartConfig}
            bezier
            style={styles.chart}
          />
        </>
      ) : (
        <View style={styles.noDataBox}>
          <Text style={styles.noDataText}>{t('no_chart_data')}</Text>
        </View>
      )}

      {/* Strengths */}
      {strengths.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('class_strengths')}</Text>
          <View style={styles.listCard}>
            {strengths.map((item, i) => item ? (
              <Text key={i} style={[styles.bulletItem, { color: COLORS.success }]}>
                {`✓ ${item.homework_title ?? 'Assignment'}: ${item.score ?? 0}% (class avg: ${item.class_average ?? 0}%)`}
              </Text>
            ) : null)}
          </View>
        </>
      )}

      {/* Weaknesses */}
      {weaknesses.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('areas_for_improvement')}</Text>
          <View style={styles.listCard}>
            {weaknesses.map((item, i) => item ? (
              <Text key={i} style={[styles.bulletItem, { color: COLORS.error }]}>
                {`✗ ${item.homework_title ?? 'Assignment'}: ${item.score ?? 0}% (class avg: ${item.class_average ?? 0}%)`}
              </Text>
            ) : null)}
          </View>
        </>
      )}

      {/* Areas they're struggling with — topic-aggregated weaknesses from the
          /analytics/student/<id> response's weaknesses_aggregated field. */}
      <Text style={styles.sectionTitle}>Areas they're struggling with</Text>
      {strugglingVisible.length === 0 ? (
        <View style={styles.noDataBox}>
          <Text style={styles.noDataText}>Not enough graded work to identify patterns yet.</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {strugglingVisible.map((row) => (
            <View key={row.topic} style={styles.strugglingRow}>
              <Text style={styles.strugglingTopic} numberOfLines={2}>{row.topic}</Text>
              <Text style={styles.strugglingMeta}>
                {row.accuracy_pct}% accuracy ({row.attempts} attempt{row.attempts === 1 ? '' : 's'})
              </Text>
            </View>
          ))}
          {strugglingHiddenCount > 0 && (
            <Text style={styles.strugglingMore}>
              + {strugglingHiddenCount} more
            </Text>
          )}
        </View>
      )}

      {/* Submission History */}
      <Text style={styles.sectionTitle}>{t('submission_history')}</Text>
      {submissions.length === 0 ? (
        <View style={styles.noDataBox}>
          <Text style={styles.noDataText}>{t('no_chart_data')}</Text>
        </View>
      ) : (
        submissions.map((sub) => sub ? (
          <TouchableOpacity
            key={sub.id ?? Math.random().toString()}
            style={styles.submissionRow}
            onPress={() =>
              sub.id ? navigation.navigate('GradingDetail', {
                mark_id: sub.id,
                student_name: student.name || student_name,
                class_name,
                answer_key_title: sub.homework_title ?? '',
              }) : undefined
            }
          >
            <View style={styles.submissionLeft}>
              <Text style={styles.submissionTitle} numberOfLines={1}>{sub.homework_title ?? 'Assignment'}</Text>
              <Text style={styles.submissionDate}>{sub.date ?? ''}</Text>
              {sub.feedback_preview ? (
                <Text style={styles.feedbackPreview} numberOfLines={2}>{sub.feedback_preview}</Text>
              ) : null}
            </View>
            <View style={styles.submissionRight}>
              <Text style={styles.submissionScore}>{sub.score ?? 0}/{sub.max_score ?? 0}</Text>
            </View>
          </TouchableOpacity>
        ) : null)
      )}

      {/* Commendations */}
      {showCommendations && commendation !== '' && (
        <>
          <Text style={styles.sectionTitle}>{t('commendations')}</Text>
          <View style={styles.commendCard}>
            <Text style={styles.commendText}>{commendation}</Text>
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
    paddingBottom: 16,
    paddingHorizontal: 16,
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
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.white,
  },
  subheading: {
    fontSize: 13,
    color: COLORS.white,
    opacity: 0.8,
    marginTop: 2,
  },
  studentCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  studentCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  studentCardLeft: {
    flex: 1,
  },
  studentCardName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  studentCardSub: {
    fontSize: 12,
    color: COLORS.gray500,
    marginTop: 3,
  },
  scoreBadge: {
    backgroundColor: COLORS.teal50,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginLeft: 12,
  },
  scoreBadgeValue: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.teal500,
  },
  scoreBadgeLabel: {
    fontSize: 11,
    color: COLORS.teal500,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 20,
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 4,
  },
  legendLabel: {
    fontSize: 12,
    color: COLORS.gray500,
  },
  chart: {
    marginLeft: 16,
    borderRadius: 10,
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
  listCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  bulletItem: {
    fontSize: 13,
    lineHeight: 22,
  },
  submissionRow: {
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
  submissionLeft: {
    flex: 1,
    paddingRight: 8,
  },
  submissionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  submissionDate: {
    fontSize: 12,
    color: COLORS.gray500,
    marginTop: 2,
  },
  feedbackPreview: {
    fontSize: 12,
    color: COLORS.gray500,
    fontStyle: 'italic',
    marginTop: 4,
  },
  submissionRight: {
    alignItems: 'flex-end',
  },
  submissionScore: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.teal500,
  },
  commendCard: {
    backgroundColor: COLORS.teal50,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.teal100,
  },
  commendText: {
    fontSize: 14,
    color: COLORS.teal700,
    lineHeight: 20,
    fontWeight: '500',
  },

  // "Areas they're struggling with" topic-aggregated rows
  strugglingRow: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 2,
  },
  strugglingTopic: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  strugglingMeta: {
    fontSize: 12,
    color: COLORS.gray500,
  },
  strugglingMore: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.teal500,
    fontWeight: '600',
    textAlign: 'center',
  },
});
