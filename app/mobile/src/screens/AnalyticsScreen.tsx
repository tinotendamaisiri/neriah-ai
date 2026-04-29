// src/screens/AnalyticsScreen.tsx
// Class list analytics view for teacher.
// Each card shows a mini line chart of recent class averages, an inline
// "View Students" expansion, and class-level weak topics. Tapping the
// class name or the chart drills into TeacherClassAnalytics. Tapping a
// student row inside the expansion drills into TeacherStudentAnalytics.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LineChart } from 'react-native-chart-kit';

import { getClassesAnalytics, getClassAnalytics } from '../services/api';
import { ScreenContainer } from '../components/ScreenContainer';
import { useLanguage } from '../context/LanguageContext';
import { COLORS } from '../constants/colors';
import type { ClassAnalyticsSummary, RootStackParamList } from '../types';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Card has marginHorizontal:16 + internal padding:16 on each side → chart fits SCREEN_WIDTH-64
const CHART_WIDTH = SCREEN_WIDTH - 64;

const LEVEL_DISPLAY: Record<string, string> = {
  grade_1: 'Grade 1', grade_2: 'Grade 2', grade_3: 'Grade 3',
  grade_4: 'Grade 4', grade_5: 'Grade 5', grade_6: 'Grade 6', grade_7: 'Grade 7',
  form_1: 'Form 1', form_2: 'Form 2', form_3: 'Form 3', form_4: 'Form 4',
  form_5: 'Form 5 (A-Level)', form_6: 'Form 6 (A-Level)',
  tertiary: 'College/University',
};

function scoreColor(score: number): string {
  if (score < 40) return COLORS.error;
  if (score <= 60) return COLORS.warning;
  return COLORS.teal500;
}

function accuracyColor(pct: number): string {
  if (pct < 40) return COLORS.error;
  if (pct < 70) return COLORS.warning;
  return COLORS.teal500;
}

const chartConfig = {
  backgroundColor: COLORS.white,
  backgroundGradientFrom: COLORS.white,
  backgroundGradientTo: COLORS.white,
  color: (opacity = 1) => `rgba(13, 115, 119, ${opacity})`,
  decimalPlaces: 0,
  labelColor: () => COLORS.gray500,
  propsForDots: { r: '3', strokeWidth: '2', stroke: COLORS.teal500 },
  propsForBackgroundLines: { stroke: COLORS.background },
};

// ── Card ─────────────────────────────────────────────────────────────────────

interface ClassCardProps {
  item: ClassAnalyticsSummary;
  onPressClass: (item: ClassAnalyticsSummary) => void;
  onPressStudent: (classId: string, className: string, studentId: string, studentName: string) => void;
  t: (k: string) => string;
}

const ClassCard = React.memo(({ item, onPressClass, onPressStudent, t }: ClassCardProps) => {
  const handlePressClass = useCallback(() => onPressClass(item), [item, onPressClass]);
  const handlePressStudent = useCallback(
    (sid: string, sname: string) => onPressStudent(item.class_id, item.class_name, sid, sname),
    [item.class_id, item.class_name, onPressStudent],
  );
  const [expanded, setExpanded] = useState(false);
  const [fetchedStudents, setFetchedStudents] = useState<any[] | null>(null);
  const [studentsLoading, setStudentsLoading] = useState(false);

  const hasData = (item as any).has_data !== false;
  const reason = (item as any).reason as string | undefined;
  const score = item.average_score ?? 0;
  const studentCount = item.total_students ?? (item as any).student_count ?? 0;
  const recentScores = item.recent_scores ?? [];
  const weakTopics = (item.class_weaknesses_aggregated ?? []).slice(0, 3);
  const summaryStudents = item.students ?? [];
  const students: any[] = (summaryStudents.length > 0 ? summaryStudents : fetchedStudents) ?? [];

  const handleToggleExpand = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    // Lazy-fetch students if the summary didn't include them and we haven't fetched yet.
    if (next && summaryStudents.length === 0 && fetchedStudents === null && studentCount > 0) {
      setStudentsLoading(true);
      try {
        const detail = await getClassAnalytics(item.class_id);
        setFetchedStudents((detail as any).students ?? []);
      } catch {
        setFetchedStudents([]);
      } finally {
        setStudentsLoading(false);
      }
    }
  }, [expanded, summaryStudents.length, fetchedStudents, studentCount, item.class_id]);

  const emptyMessage = !hasData
    ? (reason === 'no_homeworks'
      ? 'No homework assigned yet. Analytics will appear once students submit.'
      : "This class doesn't have any submissions yet. Analytics will appear once homework is marked.")
    : '';

  // Empty state — keep card simple, single tap navigates in
  if (!hasData) {
    return (
      <TouchableOpacity style={[styles.card, styles.cardEmpty]} onPress={handlePressClass} activeOpacity={0.75}>
        <View style={{ flex: 1 }}>
          <Text style={styles.className} numberOfLines={1}>{item.class_name}</Text>
          <Text style={styles.classLevel}>
            {LEVEL_DISPLAY[item.education_level] ?? item.education_level}
            {item.subject ? ` · ${item.subject}` : ''}
          </Text>
        </View>
        <View style={styles.emptyCardBody}>
          <Ionicons name="bar-chart-outline" size={24} color={COLORS.gray200} />
          <Text style={styles.emptyCardTitle}>{emptyMessage}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Chart data — pad if only one point so chart-kit doesn't crash. Memoised so the
  // expensive SVG only re-renders when scores actually change, not on every parent update.
  const chartData = useMemo(() => {
    const values = recentScores.length === 0
      ? [score, score]
      : recentScores.length === 1
        ? [recentScores[0], recentScores[0]]
        : recentScores;
    return { labels: [] as string[], datasets: [{ data: values }] };
  }, [recentScores, score]);

  return (
    <View style={styles.card}>
      {/* Class name + level — tap to drill into class */}
      <TouchableOpacity onPress={handlePressClass} activeOpacity={0.7}>
        <Text style={styles.className} numberOfLines={1}>{item.class_name}</Text>
        <Text style={styles.classLevel}>
          {LEVEL_DISPLAY[item.education_level] ?? item.education_level}
          {item.subject ? ` · ${item.subject}` : ''}
        </Text>
      </TouchableOpacity>

      {/* Mini line chart — also tappable to drill into class */}
      <TouchableOpacity onPress={handlePressClass} activeOpacity={0.85} style={styles.chartTouchable}>
        <LineChart
          data={chartData}
          width={CHART_WIDTH}
          height={90}
          chartConfig={chartConfig}
          bezier
          withInnerLines={false}
          withOuterLines={false}
          withVerticalLabels={false}
          withHorizontalLabels={false}
          withShadow={false}
          style={styles.chart}
        />
      </TouchableOpacity>

      {/* Stats row — submissions belong to homework, not the class */}
      <View style={styles.statsRow}>
        <Text style={styles.statItem}>
          <Text style={styles.statValue}>{studentCount}</Text>
          {' '}{t('students')}
        </Text>
        <Text style={styles.statItem}>
          <Text style={styles.statValue}>{item.homework_count ?? 0}</Text>
          {' '}homework
        </Text>
        <Text style={styles.statItem}>
          {t('avg_score')}{': '}
          <Text style={[styles.statValue, { color: scoreColor(score) }]}>
            {`${score}%`}
          </Text>
        </Text>
      </View>

      {/* Class weak topics — inline when there's enough data */}
      {weakTopics.length > 0 && (
        <View style={styles.weakTopicsBlock}>
          <Text style={styles.weakTopicsHeading}>Weak topics</Text>
          {weakTopics.map((w, i) => (
            <View key={`${w.topic}-${i}`} style={styles.weakTopicRow}>
              <Text style={styles.weakTopicText} numberOfLines={1}>{w.topic}</Text>
              <Text style={[styles.weakTopicAccuracy, { color: accuracyColor(w.accuracy_pct) }]}>
                {w.accuracy_pct}%
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* View Students — chevron toggles inline expansion */}
      <TouchableOpacity
        style={styles.viewStudentsRow}
        onPress={handleToggleExpand}
        activeOpacity={0.7}
      >
        <Ionicons name="people-outline" size={14} color={COLORS.teal500} />
        <Text style={styles.viewStudentsText}>View Students</Text>
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={16}
          color={COLORS.teal500}
        />
      </TouchableOpacity>

      {/* Inline student list — tap a student to see per-student analytics */}
      {expanded && (
        <View style={styles.studentsList}>
          {studentsLoading ? (
            <ActivityIndicator size="small" color={COLORS.teal500} style={{ paddingVertical: 12 }} />
          ) : students.length === 0 ? (
            <Text style={styles.studentsEmpty}>
              {studentCount > 0 ? 'Student details unavailable.' : 'No students enrolled yet.'}
            </Text>
          ) : (
            students.map((s, idx) => {
              const sid = s.student_id ?? s.id;
              const score = s.average_score ?? 0;
              const hasSubs = (s.submission_count ?? 0) > 0 && !s.no_submissions;
              return (
                <TouchableOpacity
                  key={sid ?? idx}
                  style={styles.studentRow}
                  onPress={() => sid && onPressStudent(sid, s.name)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.studentName} numberOfLines={1}>{s.name}</Text>
                  <Text
                    style={[
                      styles.studentScore,
                      { color: hasSubs ? scoreColor(score) : COLORS.gray500 },
                    ]}
                  >
                    {hasSubs ? `${score}%` : '—'}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}
    </View>
  );
});

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const { t } = useLanguage();
  const navigation = useNavigation<NavProp>();

  const [data, setData] = useState<ClassAnalyticsSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(0);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await getClassesAnalytics();
      setData(res);
      lastFetchRef.current = Date.now();
    } catch (e: any) {
      setError(e?.message ?? 'Error loading analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Skip refetch on focus if data is fresh (< 30s old). Match HomeScreen.
  useFocusEffect(
    useCallback(() => {
      const stale = Date.now() - lastFetchRef.current > 30_000;
      if (stale) load();
    }, [load]),
  );

  const handlePressClass = useCallback((item: ClassAnalyticsSummary) => {
    navigation.navigate('TeacherClassAnalytics', {
      class_id: item.class_id,
      class_name: item.class_name,
    });
  }, [navigation]);

  const handlePressStudent = useCallback((classId: string, className: string, studentId: string, studentName: string) => {
    navigation.navigate('TeacherStudentAnalytics', {
      student_id: studentId,
      student_name: studentName,
      class_id: classId,
      class_name: className,
    });
  }, [navigation]);

  const renderClassCard = useCallback(
    ({ item }: { item: ClassAnalyticsSummary }) => (
      <ClassCard
        item={item}
        t={t}
        onPressClass={handlePressClass}
        onPressStudent={handlePressStudent}
      />
    ),
    [t, handlePressClass, handlePressStudent],
  );

  if (loading) {
    return (
      <ScreenContainer scroll={false} edges={['top', 'left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.teal500} />
          <Text style={styles.loadingText}>{t('analytics_loading')}</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer scroll={false} edges={['top', 'left', 'right']}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => load()} style={styles.retryBtn}>
            <Text style={styles.retryText}>{t('retry')}</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll={false} edges={['top', 'left', 'right']} style={{ backgroundColor: COLORS.background }}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.heading}>{t('analytics')}</Text>
        </View>
        <FlatList
          data={(data ?? []).filter(Boolean)}
          keyExtractor={(item) => item.class_id}
          renderItem={renderClassCard}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="bar-chart-outline" size={56} color={COLORS.gray200} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyTitle}>No classes yet</Text>
              <Text style={styles.emptyText}>{t('analytics_no_classes')}</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={COLORS.teal500}
            />
          }
          contentContainerStyle={data.length === 0 ? styles.emptyContainer : styles.listContent}
          removeClippedSubviews
          initialNumToRender={4}
          maxToRenderPerBatch={6}
          windowSize={5}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    backgroundColor: COLORS.white, paddingHorizontal: 20,
    paddingTop: 16, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  heading: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  loadingText: { marginTop: 12, color: COLORS.gray500, fontSize: 14 },
  errorText: { color: COLORS.error, fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: { backgroundColor: COLORS.teal500, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: COLORS.white, fontWeight: '600', fontSize: 14 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.gray900, marginBottom: 6, textAlign: 'center' },
  emptyText: { color: COLORS.gray500, fontSize: 14, textAlign: 'center' },

  card: {
    backgroundColor: COLORS.white, borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardEmpty: { opacity: 0.85 },
  className: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  classLevel: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },

  emptyCardBody: { alignItems: 'center', gap: 6, paddingVertical: 16 },
  emptyCardTitle: { fontSize: 13, fontWeight: '600', color: COLORS.gray900, textAlign: 'center' },

  chartTouchable: { marginTop: 10, alignItems: 'center' },
  chart: { paddingRight: 0, marginVertical: 0, marginLeft: -16 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  statItem: { fontSize: 12, color: COLORS.gray500 },
  statValue: { fontWeight: '700', color: COLORS.text },

  weakTopicsBlock: {
    marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: COLORS.background,
  },
  weakTopicsHeading: { fontSize: 12, fontWeight: '700', color: COLORS.gray900, marginBottom: 6 },
  weakTopicRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 4,
  },
  weakTopicText: { fontSize: 13, color: COLORS.text, flex: 1, marginRight: 12 },
  weakTopicAccuracy: { fontSize: 13, fontWeight: '700' },

  viewStudentsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: COLORS.background,
  },
  viewStudentsText: { fontSize: 13, fontWeight: '600', color: COLORS.teal500, flex: 1 },

  studentsList: { marginTop: 8 },
  studentsEmpty: { fontSize: 12, color: COLORS.gray500, fontStyle: 'italic', paddingVertical: 8 },
  studentRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  studentName: { fontSize: 14, color: COLORS.text, flex: 1, marginRight: 12 },
  studentScore: { fontSize: 14, fontWeight: '700' },
});
