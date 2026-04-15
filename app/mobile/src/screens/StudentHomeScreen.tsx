// src/screens/StudentHomeScreen.tsx
// Student home: greeting, open assignments, recent feedback, stats card.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import {
  getAssignments,
  getStudentMarks,
  getStudentClassAnalytics,
} from '../services/api';
import { Assignment, StudentMark, StudentClassAnalytics, StudentRootStackParamList } from '../types';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import AIStatusDot from '../components/AIStatusDot';

type Nav = NativeStackNavigationProp<StudentRootStackParamList>;

export default function StudentHomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [recentMarks, setRecentMarks] = useState<StudentMark[]>([]);
  const [analytics, setAnalytics] = useState<StudentClassAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const ASSIGN_CACHE = user ? `cache_assignments_${user.id}` : null;
  const MARKS_CACHE = user ? `cache_marks_${user.id}` : null;

  const load = useCallback(async (isRefresh = false) => {
    if (!user) return;
    console.log('[StudentHome] student class_id:', user?.class_id);
    console.log('[StudentHome] fetching assignments for class:', user?.class_id);

    const [assignmentsResult, marksResult] = await Promise.allSettled([
      user.class_id ? getAssignments(user.class_id) : Promise.resolve([]),
      getStudentMarks(user.id, 5),
    ]);

    if (assignmentsResult.status === 'fulfilled') {
      console.log('[StudentHome] assignments response:', JSON.stringify(assignmentsResult.value));
      setAssignments(assignmentsResult.value);
      if (ASSIGN_CACHE) AsyncStorage.setItem(ASSIGN_CACHE, JSON.stringify(assignmentsResult.value)).catch(() => {});
    } else {
      console.log('[StudentHome] assignments error:', assignmentsResult.status === 'rejected' ? assignmentsResult.reason?.message : 'unknown');
      if (ASSIGN_CACHE) {
        const cached = await AsyncStorage.getItem(ASSIGN_CACHE).catch(() => null);
        if (cached) setAssignments(JSON.parse(cached));
      }
    }

    if (marksResult.status === 'fulfilled') {
      setRecentMarks(marksResult.value);
      if (MARKS_CACHE) AsyncStorage.setItem(MARKS_CACHE, JSON.stringify(marksResult.value)).catch(() => {});
    } else if (MARKS_CACHE) {
      const cached = await AsyncStorage.getItem(MARKS_CACHE).catch(() => null);
      if (cached) setRecentMarks(JSON.parse(cached));
    }

    if (assignmentsResult.status === 'rejected' && marksResult.status === 'rejected' && !isRefresh) {
      Alert.alert('Offline', 'Showing cached data. Pull to refresh when connected.');
    }

    if (user.class_id) {
      try {
        const analyticsData = await getStudentClassAnalytics(user.class_id, user.id);
        setAnalytics(analyticsData);
      } catch {
        // Analytics non-critical
      }
    }

    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => { load(false); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const goToCamera = (assignment: Assignment) => {
    if (!user?.class_id) return;
    navigation.navigate('StudentCamera', {
      answer_key_id: assignment.id,
      answer_key_title: assignment.title ?? assignment.subject ?? 'Assignment',
      class_id: user.class_id,
    });
  };

  const gradeColor = (pct: number) => {
    if (pct >= 70) return COLORS.success;
    if (pct >= 50) return COLORS.warning;
    return COLORS.error;
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.teal500} />
      </View>
    );
  }

  const firstName = user?.first_name ?? 'there';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.teal500} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <View style={styles.greetingRow}>
            <Text style={styles.greeting}>Hello, {firstName} </Text>
            <Ionicons name="hand-left-outline" size={22} color={COLORS.white} />
          </View>
          <Text style={styles.subGreeting}>Here's your learning overview</Text>
        </View>
        <View style={styles.headerRight}>
          <AIStatusDot />
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{firstName[0].toUpperCase()}</Text>
          </View>
        </View>
      </View>

      {/* Assignments */}
      <Text style={styles.sectionTitle}>My Assignments</Text>
      {assignments.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="document-text-outline" size={36} color={COLORS.gray300} style={{ marginBottom: 10 }} />
          <Text style={styles.emptyTitle}>No assignments yet</Text>
          <Text style={styles.emptyText}>Your teacher has not assigned any homework yet.</Text>
        </View>
      ) : (
        assignments.map(a => {
          const isOpen = a.open_for_submission !== false;
          const isSubmitted = a.has_pending_submission === true;
          return (
            <TouchableOpacity
              key={a.id}
              style={styles.assignmentCard}
              onPress={() => isOpen && !isSubmitted ? goToCamera(a) : undefined}
              activeOpacity={isOpen && !isSubmitted ? 0.7 : 1}
            >
              <View style={styles.assignmentInfo}>
                <Text style={styles.assignmentTitle}>{a.title ?? a.subject}</Text>
                {a.subject && a.title && (
                  <Text style={styles.assignmentSub}>{a.subject}{a.total_marks ? ` · ${a.total_marks} marks` : ''}</Text>
                )}
              </View>
              {isSubmitted ? (
                <View style={styles.submittedChip}>
                  <Text style={styles.submittedChipText}>Submitted</Text>
                </View>
              ) : isOpen ? (
                <View style={styles.submitChip}>
                  <Text style={styles.submitChipText}>Submit →</Text>
                </View>
              ) : (
                <View style={styles.closedChip}>
                  <Text style={styles.closedChipText}>Closed</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })
      )}

      {/* Recent feedback */}
      {recentMarks.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Recent Feedback</Text>
          {recentMarks.map(m => {
            const pct = m.max_score > 0 ? Math.round((m.score / m.max_score) * 100) : 0;
            return (
              <View key={m.id} style={styles.markCard}>
                <View style={styles.markCardLeft}>
                  <Text style={styles.markSubject}>{m.answer_key_title ?? 'Assignment'}</Text>
                  {m.feedback ? (
                    <Text style={styles.markFeedback} numberOfLines={2}>{m.feedback}</Text>
                  ) : null}
                </View>
                <View style={[styles.scoreCircle, { borderColor: gradeColor(pct) }]}>
                  <Text style={[styles.scoreText, { color: gradeColor(pct) }]}>{pct}%</Text>
                </View>
              </View>
            );
          })}
        </>
      )}

      {/* Class stats */}
      {analytics && analytics.enabled && (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Class Performance</Text>
            {user?.class_id && (
              <TouchableOpacity onPress={() => navigation.navigate('StudentAnalytics', { class_id: user.class_id! })}>
                <Text style={styles.seeAll}>Full analytics →</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{analytics.student_average ?? '—'}%</Text>
              <Text style={styles.statLabel}>My Average</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{analytics.class_average ?? '—'}%</Text>
              <Text style={styles.statLabel}>Class Average</Text>
            </View>
            {analytics.student_rank != null && analytics.total_students != null && (
              <View style={styles.statCard}>
                <Text style={styles.statValue}>#{analytics.student_rank}</Text>
                <Text style={styles.statLabel}>of {analytics.total_students}</Text>
              </View>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: COLORS.teal500,
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  greetingRow: { flexDirection: 'row', alignItems: 'center' },
  greeting: { color: COLORS.white, fontSize: 22, fontWeight: '800' },
  subGreeting: { color: COLORS.teal100, fontSize: 13, marginTop: 2 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: COLORS.white, fontSize: 20, fontWeight: '700' },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 10,
  },
  seeAll: { fontSize: 13, color: COLORS.teal500, fontWeight: '600', marginHorizontal: 20 },
  emptyCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  emptyText: { color: COLORS.textLight, fontSize: 13, textAlign: 'center' },
  assignmentCard: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  assignmentInfo: { flex: 1 },
  assignmentTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  assignmentSub: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  submitChip: {
    backgroundColor: COLORS.teal500,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  submitChipText: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  closedChip: {
    backgroundColor: COLORS.gray100,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  closedChipText: { color: COLORS.gray500, fontSize: 13, fontWeight: '600' },
  submittedChip: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  submittedChipText: { color: '#388E3C', fontSize: 13, fontWeight: '700' },
  markCard: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  markCardLeft: { flex: 1 },
  markSubject: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  markFeedback: { fontSize: 12, color: COLORS.gray500, marginTop: 4, lineHeight: 18 },
  scoreCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  scoreText: { fontSize: 14, fontWeight: '800' },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    gap: 10,
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: COLORS.teal500 },
  statLabel: { fontSize: 11, color: COLORS.gray500, marginTop: 4, textAlign: 'center' },
});
