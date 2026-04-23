// src/screens/HomeworkAnalyticsScreen.tsx
// Per-homework analytics: per-student scores for a single homework assignment.
// Fetches GET /api/analytics/homework/{homework_id}.
// Tapping a student row navigates to TeacherStudentAnalytics.

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
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getHomeworkAnalytics } from '../services/api';
import { COLORS } from '../constants/colors';
import type { RootStackParamList } from '../types';
import { ScreenContainer } from '../components/ScreenContainer';

type Props = NativeStackScreenProps<RootStackParamList, 'HomeworkAnalytics'>;

interface StudentResult {
  student_id: string;
  name: string;
  score: number;
  max_score: number;
  percentage: number;
  pass_fail: 'pass' | 'fail';
  mark_id: string;
}

interface HomeworkAnalyticsData {
  has_data: boolean;
  reason?: string;
  homework_id: string;
  homework_title: string;
  class_id: string;
  class_name: string;
  submission_count: number;
  average_score: number;
  highest_score: number;
  lowest_score: number;
  pass_rate: number;
  students: StudentResult[];
}

function scoreColor(pct: number): string {
  if (pct < 40) return COLORS.error;
  if (pct < 60) return COLORS.warning;
  return COLORS.teal500;
}

export default function HomeworkAnalyticsScreen({ route, navigation }: Props) {
  const { homework_id, homework_title, class_id, class_name } = route.params;

  const [data, setData] = useState<HomeworkAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getHomeworkAnalytics(homework_id);
      setData(res);
    } catch (e: any) {
      setError(e?.message ?? 'Error loading homework analytics');
    } finally {
      setLoading(false);
    }
  }, [homework_id]);

  useFocusEffect(
    useCallback(() => { load(); }, [load]),
  );

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.teal500} />
          <Text style={styles.loadingText}>Loading analytics…</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (error || !data) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error ?? 'Error loading analytics'}</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  if (!data.has_data) {
    return (
      <ScreenContainer scroll={false}>
      <View style={styles.flex}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={20} color={COLORS.white} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.heading} numberOfLines={2}>{homework_title}</Text>
          <Text style={styles.subheading}>{class_name}</Text>
        </View>
        <View style={styles.center}>
          <Ionicons name="bar-chart-outline" size={48} color={COLORS.gray200} />
          <Text style={styles.emptyTitle}>No graded submissions yet</Text>
          <Text style={styles.emptyText}>
            Grade at least one student submission to see analytics for this homework.
          </Text>
        </View>
      </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll={false}>
    <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={20} color={COLORS.white} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading} numberOfLines={2}>{homework_title}</Text>
        <Text style={styles.subheading}>{class_name}</Text>
      </View>

      {/* Summary cards */}
      <Text style={styles.sectionTitle}>Summary</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.cardsScroll}
        contentContainerStyle={styles.cardsContent}
      >
        {[
          { label: 'Average', value: `${data.average_score}%`, color: scoreColor(data.average_score) },
          { label: 'Highest', value: `${data.highest_score}%`, color: COLORS.success },
          { label: 'Lowest',  value: `${data.lowest_score}%`,  color: COLORS.error },
          { label: 'Pass Rate', value: `${data.pass_rate}%`,   color: COLORS.teal500 },
          { label: 'Submitted', value: `${data.submission_count}`, color: COLORS.text },
        ].map(card => (
          <View key={card.label} style={styles.summaryCard}>
            <Text style={[styles.summaryValue, { color: card.color }]}>{card.value}</Text>
            <Text style={styles.summaryLabel}>{card.label}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Per-student results */}
      <Text style={styles.sectionTitle}>Student Results</Text>
      {data.students.length === 0 ? (
        <View style={styles.noDataBox}>
          <Text style={styles.noDataText}>No graded submissions yet</Text>
        </View>
      ) : (
        data.students.map((s, idx) => (
          <TouchableOpacity
            key={s.student_id}
            style={styles.studentRow}
            onPress={() => navigation.navigate('TeacherStudentAnalytics', {
              student_id: s.student_id,
              student_name: s.name,
              class_id,
              class_name,
            })}
            activeOpacity={0.7}
          >
            {/* Rank badge */}
            <View style={[styles.rankBadge, { backgroundColor: scoreColor(s?.percentage ?? 0) }]}>
              <Text style={styles.rankNum}>{idx + 1}</Text>
            </View>

            {/* Student info */}
            <View style={styles.studentInfo}>
              <Text style={styles.studentName}>{s.name}</Text>
              <View style={styles.passBadgeRow}>
                <View style={[
                  styles.passBadge,
                  { backgroundColor: s.pass_fail === 'pass' ? COLORS.teal50 : '#FEF2F2' },
                ]}>
                  <Text style={[
                    styles.passBadgeText,
                    { color: s.pass_fail === 'pass' ? COLORS.teal500 : COLORS.error },
                  ]}>
                    {s.pass_fail === 'pass' ? 'Pass' : 'Fail'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Score */}
            <View style={styles.studentRight}>
              <Text style={[styles.studentScore, { color: scoreColor(s?.percentage ?? 0) }]}>
                {s?.percentage ?? 0}%
              </Text>
              <Text style={styles.studentRaw}>{s.score}/{s.max_score}</Text>
            </View>

            <Ionicons name="chevron-forward" size={16} color={COLORS.gray200} />
          </TouchableOpacity>
        ))
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingBottom: 24 },
  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24,
    gap: 10,
  },
  loadingText: { color: COLORS.gray500, fontSize: 14, marginTop: 8 },
  errorText: { color: COLORS.error, fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: COLORS.teal500, paddingHorizontal: 24,
    paddingVertical: 10, borderRadius: 8,
  },
  retryText: { color: COLORS.white, fontWeight: '600', fontSize: 14 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: COLORS.gray900, textAlign: 'center' },
  emptyText: { fontSize: 13, color: COLORS.textLight, textAlign: 'center', lineHeight: 20 },
  header: {
    backgroundColor: COLORS.teal500,
    paddingBottom: 16, paddingHorizontal: 16,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 2 },
  backText: { color: COLORS.white, fontSize: 14, opacity: 0.9 },
  heading: { fontSize: 20, fontWeight: '700', color: COLORS.white },
  subheading: { fontSize: 13, color: COLORS.white, opacity: 0.8, marginTop: 2 },
  sectionTitle: {
    fontSize: 15, fontWeight: '700', color: COLORS.text,
    marginTop: 20, marginBottom: 10, paddingHorizontal: 16,
  },
  cardsScroll: { paddingLeft: 16 },
  cardsContent: { paddingRight: 16, gap: 10 },
  summaryCard: {
    backgroundColor: COLORS.white, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 18,
    alignItems: 'center', minWidth: 88,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  summaryValue: { fontSize: 22, fontWeight: '700' },
  summaryLabel: { fontSize: 10, color: COLORS.gray500, marginTop: 4, textAlign: 'center' },
  noDataBox: {
    marginHorizontal: 16, backgroundColor: COLORS.white, borderRadius: 10,
    padding: 20, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  noDataText: { color: COLORS.gray500, fontSize: 13, fontStyle: 'italic' },
  studentRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.white, marginHorizontal: 16, marginBottom: 8,
    borderRadius: 10, padding: 12, gap: 10,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  rankBadge: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  rankNum: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
  studentInfo: { flex: 1 },
  studentName: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  passBadgeRow: { flexDirection: 'row', marginTop: 3 },
  passBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  passBadgeText: { fontSize: 10, fontWeight: '700' },
  studentRight: { alignItems: 'flex-end', marginRight: 4 },
  studentScore: { fontSize: 16, fontWeight: '700' },
  studentRaw: { fontSize: 11, color: COLORS.gray500, marginTop: 1 },
});
