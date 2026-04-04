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
  Dimensions,
  FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BarChart, LineChart } from 'react-native-chart-kit';

import { getClassAnalytics } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { COLORS } from '../constants/colors';
import type { ClassAnalyticsDetail, RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'TeacherClassAnalytics'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 32;

const chartConfig = {
  backgroundColor: COLORS.white,
  backgroundGradientFrom: COLORS.white,
  backgroundGradientTo: COLORS.white,
  color: (opacity = 1) => `rgba(13, 115, 119, ${opacity})`,
  decimalPlaces: 0,
  labelColor: () => COLORS.gray500,
  propsForDots: { r: '4', strokeWidth: '2', stroke: COLORS.teal500 },
};

function rankColor(rank: number, total: number): string {
  const pct = rank / total;
  if (pct <= 0.25) return COLORS.teal500;
  if (pct <= 0.75) return COLORS.warning;
  return COLORS.error;
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

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export default function TeacherClassAnalyticsScreen({ route, navigation }: Props) {
  const { class_id, class_name } = route.params;
  const { t } = useLanguage();

  const [data, setData] = useState<ClassAnalyticsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getClassAnalytics(class_id);
      setData(res);
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

  const { summary, score_distribution, performance_over_time, students } = data;

  // ── Score distribution bar chart data ────────────────────────────────────────
  const distKeys = ['0-20', '21-40', '41-60', '61-80', '81-100'] as const;
  const distAsObj = score_distribution as unknown as Record<string, number>;
  const distValues = distKeys.map((k) => distAsObj[k] ?? 0);
  const hasDistData = summary.total_submissions > 0;

  // ── Performance over time line chart ─────────────────────────────────────────
  const hasPotData = performance_over_time.length >= 2;
  const potSlice = performance_over_time.slice(-8);
  const potLabels = potSlice.map((e) => e.homework_title.substring(0, 6));
  const potValues = potSlice.map((e) => e.average_score);

  // ── AI Insights ───────────────────────────────────────────────────────────────
  const showInsights = summary.total_submissions >= 10;

  const insightStrengths: string[] = [];
  const insightImprovements: string[] = [];
  const insightRecommendations: string[] = [];

  if (showInsights && performance_over_time.length > 0) {
    const highHW = performance_over_time.filter((e) => e.average_score > 70);
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

  const improvPct = summary.improvement_pct;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>{t('back')}</Text>
        </TouchableOpacity>
        <Text style={styles.heading} numberOfLines={2}>{class_name}</Text>
      </View>

      {/* Summary cards */}
      <Text style={styles.sectionTitle}>{t('class_summary')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summaryScroll}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{summary.average_score}%</Text>
          <Text style={styles.summaryLabel}>{t('avg_score')}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{summary.total_submissions}</Text>
          <Text style={styles.summaryLabel}>{t('submissions_label')}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{summary.completion_rate}%</Text>
          <Text style={styles.summaryLabel}>{t('completion_rate')}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text
            style={[
              styles.summaryValue,
              {
                color:
                  improvPct === null || improvPct === undefined
                    ? COLORS.gray500
                    : improvPct > 0
                    ? COLORS.success
                    : improvPct < 0
                    ? COLORS.error
                    : COLORS.gray500,
              },
            ]}
          >
            {improvPct === null || improvPct === undefined
              ? '—'
              : `${improvPct > 0 ? '+' : ''}${improvPct}%`}
          </Text>
          <Text style={styles.summaryLabel}>{t('improvement')}</Text>
        </View>
      </ScrollView>

      {/* Score Distribution */}
      <Text style={styles.sectionTitle}>{t('score_distribution')}</Text>
      {hasDistData ? (
        <BarChart
          data={{
            labels: ['0-20', '21-40', '41-60', '61-80', '81-100'],
            datasets: [{ data: distValues }],
          }}
          width={CHART_WIDTH}
          height={200}
          chartConfig={chartConfig}
          style={styles.chart}
          showValuesOnTopOfBars
          withInnerLines={false}
          yAxisLabel=""
          yAxisSuffix=""
        />
      ) : (
        <View style={styles.noDataBox}>
          <Text style={styles.noDataText}>{t('no_chart_data')}</Text>
        </View>
      )}

      {/* Performance Over Time */}
      <Text style={styles.sectionTitle}>{t('perf_over_time')}</Text>
      {hasPotData ? (
        <LineChart
          data={{
            labels: potLabels,
            datasets: [{ data: potValues }],
          }}
          width={CHART_WIDTH}
          height={200}
          chartConfig={chartConfig}
          bezier
          style={styles.chart}
        />
      ) : (
        <View style={styles.noDataBox}>
          <Text style={styles.noDataText}>{t('no_chart_data')}</Text>
        </View>
      )}

      {/* Student Rankings */}
      <Text style={styles.sectionTitle}>{t('student_rankings')}</Text>
      {students.length === 0 ? (
        <View style={styles.noDataBox}>
          <Text style={styles.noDataText}>{t('analytics_no_classes')}</Text>
        </View>
      ) : (
        students.map((s, idx) => (
          <TouchableOpacity
            key={s.id}
            style={styles.studentRow}
            onPress={() =>
              navigation.navigate('TeacherStudentAnalytics', {
                student_id: s.id,
                student_name: s.name,
                class_id,
                class_name,
              })
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
                {s.submissions_count} {t('submissions_label').toLowerCase()}
              </Text>
            </View>
            <View style={styles.studentRight}>
              <Text
                style={[
                  styles.studentScore,
                  { color: rankColor(idx + 1, students.length) },
                ]}
              >
                {s.average_score}%
              </Text>
              <Text style={[styles.trendArrow, { color: trendColor(s.trend) }]}>
                {trendArrow(s.trend)}
              </Text>
            </View>
          </TouchableOpacity>
        ))
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
    paddingTop: 52,
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 20,
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  summaryScroll: {
    paddingLeft: 16,
  },
  summaryCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginRight: 10,
    alignItems: 'center',
    minWidth: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.teal500,
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.gray500,
    marginTop: 4,
    textAlign: 'center',
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
});
