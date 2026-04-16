// src/screens/StudentAnalyticsScreen.tsx
// Student-facing analytics: personal average, trend, class comparison, rank, per-assignment.
// Only shown if teacher has enabled share_analytics on the class.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { getStudentClassAnalytics } from '../services/api';
import { StudentClassAnalytics, StudentRootStackParamList } from '../types';
import { COLORS } from '../constants/colors';

type Props = NativeStackScreenProps<StudentRootStackParamList, 'StudentAnalytics'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 32;

const C = {
  teal: COLORS.teal500,
  amber: COLORS.amber300,
  gray: '#BDC3C7',
  green: COLORS.success,
  red: COLORS.error,
};

const chartConfig = {
  backgroundGradientFrom: '#fff',
  backgroundGradientTo: '#fff',
  color: (opacity = 1) => `rgba(13, 115, 119, ${opacity})`,
  strokeWidth: 2,
  propsForDots: { r: '4', strokeWidth: '2', stroke: C.teal },
  propsForLabels: { fontSize: 11 },
  decimalPlaces: 0,
};

export default function StudentAnalyticsScreen({ route, navigation }: Props) {
  const { class_id } = route.params;
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState<StudentClassAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getStudentClassAnalytics(class_id, user.id)
      .then(data => { setAnalytics(data); })
      .catch(() => { setAnalytics(null); })
      .finally(() => setLoading(false));
  }, [class_id, user]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.teal} />
      </View>
    );
  }

  if (!analytics || !analytics.enabled) {
    return (
      <View style={styles.notEnabled}>
        <Ionicons name="bar-chart-outline" size={56} color={COLORS.gray500} style={styles.notEnabledIcon} />
        <Text style={styles.notEnabledTitle}>Analytics not available</Text>
        <Text style={styles.notEnabledSub}>
          Your teacher hasn't shared class analytics yet. Check back later.
        </Text>
      </View>
    );
  }

  const myAvg = analytics.student_average ?? 0;
  const classAvg = analytics.class_average ?? 0;
  const myColor = myAvg >= 70 ? C.green : myAvg >= 50 ? C.amber : C.red;

  // Trend line data
  const trend = analytics?.trend ?? [];
  const trendData = trend.length > 1
    ? trend.slice(-10)
    : null;

  // Rank
  const showRank = analytics.rank_enabled && analytics.student_rank != null && analytics.total_students != null;
  const totalStudents = analytics?.total_students ?? 0;
  const studentRank = analytics?.student_rank ?? 0;
  const percentile = showRank && totalStudents > 0
    ? Math.round(((totalStudents - studentRank) / totalStudents) * 100)
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Section 1: Personal Performance */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Performance</Text>
        <View style={[styles.avgCard, { borderTopColor: myColor }]}>
          <Text style={[styles.avgNumber, { color: myColor }]}>{myAvg}%</Text>
          <Text style={styles.avgLabel}>
            Your average
            {analytics.total_assignments_graded != null
              ? ` · ${analytics.total_assignments_graded} assignment${analytics.total_assignments_graded !== 1 ? 's' : ''}`
              : ''}
          </Text>
        </View>

        {trendData && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Score Trend (last {trendData.length})</Text>
            <LineChart
              data={{
                labels: trendData.map((_, i) => `${i + 1}`),
                datasets: [{ data: trendData }],
              }}
              width={CHART_WIDTH - 32}
              height={160}
              chartConfig={chartConfig}
              bezier
              withInnerLines={false}
              style={styles.chart}
            />
          </View>
        )}
      </View>

      {/* Section 2: Class Context */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Class Context</Text>

        {/* Comparison bars */}
        <View style={styles.compCard}>
          <CompBar label="You" value={myAvg} color={C.teal} />
          <CompBar label="Class avg" value={classAvg} color={C.gray} />
        </View>

        {/* Distribution chart */}
        {analytics.per_assignment && analytics.per_assignment.length > 0 && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Per Assignment</Text>
            <BarChart
              data={{
                labels: analytics.per_assignment.map(a =>
                  (a.title ?? '').length > 6 ? (a.title ?? '').slice(0, 6) + '…' : (a.title ?? ''),
                ),
                datasets: [
                  { data: analytics.per_assignment.map(a => a?.student_score ?? 0), color: () => C.teal },
                  { data: analytics.per_assignment.map(a => a?.class_average ?? 0), color: () => C.gray },
                ],
              }}
              width={CHART_WIDTH - 32}
              height={180}
              chartConfig={{
                ...chartConfig,
                color: (opacity = 1) => `rgba(13, 115, 119, ${opacity})`,
              }}
              style={styles.chart}
              showValuesOnTopOfBars
              yAxisLabel=""
              yAxisSuffix="%"
            />
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: C.teal }]} />
                <Text style={styles.legendText}>You</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: C.gray }]} />
                <Text style={styles.legendText}>Class avg</Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Section 3: Rank */}
      {showRank && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Class Rank</Text>
          <View style={styles.rankCard}>
            <View>
              <Text style={styles.rankMain}>
                #{analytics.student_rank}
                <Text style={styles.rankOf}> of {analytics.total_students}</Text>
              </Text>
              <Text style={styles.rankLabel}>students in your class</Text>
            </View>
            {percentile != null && (
              <View style={styles.percentileBadge}>
                <Text style={styles.percentileText}>Top {100 - percentile}%</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Section 4: Per-assignment table */}
      {analytics.per_assignment && analytics.per_assignment.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Assignment Breakdown</Text>
          <View style={styles.tableCard}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCell, styles.tableHeaderText, { flex: 2 }]}>Assignment</Text>
              <Text style={[styles.tableCell, styles.tableHeaderText]}>Yours</Text>
              <Text style={[styles.tableCell, styles.tableHeaderText]}>Class</Text>
              <Text style={[styles.tableCell, styles.tableHeaderText]}>Diff</Text>
            </View>
            {analytics.per_assignment.map((a, i) => {
              const diff = a.student_score - a.class_average;
              const diffColor = diff >= 0 ? C.green : C.red;
              return (
                <View key={i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                  <Text style={[styles.tableCell, { flex: 2 }]} numberOfLines={1}>{a.title}</Text>
                  <Text style={styles.tableCell}>{a.student_score}%</Text>
                  <Text style={styles.tableCell}>{a.class_average}%</Text>
                  <Text style={[styles.tableCell, { color: diffColor, fontWeight: '700' }]}>
                    {diff >= 0 ? '+' : ''}{diff}%
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Section 5: Strengths & Weaknesses */}
      {((analytics.strengths && analytics.strengths.length > 0) ||
        (analytics.weaknesses && analytics.weaknesses.length > 0)) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Insights</Text>
          {analytics.strengths && analytics.strengths.length > 0 && (
            <View style={styles.tagsSection}>
              <Text style={styles.tagsLabel}>Strong at</Text>
              <View style={styles.tags}>
                {analytics.strengths.map((s, i) => (
                  <View key={i} style={[styles.tag, styles.tagGreen]}>
                    <Text style={[styles.tagText, { color: C.green }]}>{s}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          {analytics.weaknesses && analytics.weaknesses.length > 0 && (
            <View style={styles.tagsSection}>
              <Text style={styles.tagsLabel}>Work on</Text>
              <View style={styles.tags}>
                {analytics.weaknesses.map((s, i) => (
                  <View key={i} style={[styles.tag, styles.tagAmber]}>
                    <Text style={[styles.tagText, { color: C.amber }]}>{s}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function CompBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={comp.row}>
      <Text style={comp.label}>{label}</Text>
      <View style={comp.trackBg}>
        <View style={[comp.fill, { width: `${Math.min(value, 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[comp.value, { color }]}>{value}%</Text>
    </View>
  );
}

const comp = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  label: { width: 72, fontSize: 13, color: COLORS.text, fontWeight: '600' },
  trackBg: { flex: 1, height: 12, backgroundColor: COLORS.background, borderRadius: 6, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 6 },
  value: { width: 44, textAlign: 'right', fontSize: 13, fontWeight: '700' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  notEnabled: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: 40, backgroundColor: COLORS.background,
  },
  notEnabledIcon: { marginBottom: 16 },
  notEnabledTitle: { fontSize: 20, fontWeight: '700', color: COLORS.gray900, marginBottom: 8 },
  notEnabledSub: { fontSize: 14, color: COLORS.gray500, textAlign: 'center', lineHeight: 22 },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  avgCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    borderTopWidth: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  avgNumber: { fontSize: 48, fontWeight: '900' },
  avgLabel: { fontSize: 13, color: COLORS.gray500, marginTop: 4 },
  chartCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  chartTitle: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  chart: { borderRadius: 8, marginLeft: -8 },
  compCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: COLORS.gray500 },
  rankCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rankMain: { fontSize: 32, fontWeight: '900', color: COLORS.gray900 },
  rankOf: { fontSize: 18, fontWeight: '400', color: COLORS.gray500 },
  rankLabel: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  percentileBadge: {
    backgroundColor: COLORS.teal500,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  percentileText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  tableCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tableHeader: { flexDirection: 'row', backgroundColor: COLORS.background, padding: 10 },
  tableHeaderText: { fontWeight: '700', color: COLORS.text },
  tableRow: { flexDirection: 'row', padding: 10 },
  tableRowAlt: { backgroundColor: COLORS.background },
  tableCell: { flex: 1, fontSize: 12, color: COLORS.text, textAlign: 'center' },
  tagsSection: { marginBottom: 10 },
  tagsLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  tagGreen: { backgroundColor: COLORS.teal50, borderColor: COLORS.teal100 },
  tagAmber: { backgroundColor: COLORS.amber50, borderColor: COLORS.amber100 },
  tagText: { fontSize: 12, fontWeight: '600' },
});
