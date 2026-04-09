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
  getStudentSuggestions,
} from '../services/api';
import { Assignment, StudentMark, StudentClassAnalytics, StudySuggestionsResponse, StudentRootStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import { TUTOR_PENDING_MSG_KEY } from './StudentTutorScreen';

type Nav = NativeStackNavigationProp<StudentRootStackParamList>;

export default function StudentHomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [recentMarks, setRecentMarks] = useState<StudentMark[]>([]);
  const [analytics, setAnalytics] = useState<StudentClassAnalytics | null>(null);
  const [suggestions, setSuggestions] = useState<StudySuggestionsResponse | null>(null);
  const [strengthsExpanded, setStrengthsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const ASSIGN_CACHE = user ? `cache_assignments_${user.id}` : null;
  const MARKS_CACHE = user ? `cache_marks_${user.id}` : null;

  const load = useCallback(async (isRefresh = false) => {
    if (!user) return;

    const [assignmentsResult, marksResult] = await Promise.allSettled([
      user.class_id ? getAssignments(user.class_id) : Promise.resolve([]),
      getStudentMarks(user.id, 5),
    ]);

    if (assignmentsResult.status === 'fulfilled') {
      setAssignments(assignmentsResult.value);
      if (ASSIGN_CACHE) AsyncStorage.setItem(ASSIGN_CACHE, JSON.stringify(assignmentsResult.value)).catch(() => {});
    } else if (ASSIGN_CACHE) {
      const cached = await AsyncStorage.getItem(ASSIGN_CACHE).catch(() => null);
      if (cached) setAssignments(JSON.parse(cached));
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

    // Suggestions — non-blocking, shown only when available
    try {
      const suggestionsData = await getStudentSuggestions(user.id);
      if (suggestionsData.suggestions.length > 0 || suggestionsData.strengths.length > 0) {
        setSuggestions(suggestionsData);
      }
    } catch {
      // Non-critical — no suggestions shown if unavailable
    }

    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => { load(false); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const goToTutorWithPrompt = async (prompt: string) => {
    await AsyncStorage.setItem(TUTOR_PENDING_MSG_KEY, prompt).catch(() => {});
    (navigation as any).navigate('StudentTutor');
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
          <Text style={styles.greeting}>Hello, {firstName} 👋</Text>
          <Text style={styles.subGreeting}>Here's your learning overview</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{firstName[0].toUpperCase()}</Text>
        </View>
      </View>

      {/* Study suggestions card */}
      {suggestions && suggestions.suggestions.length > 0 && (() => {
        const top3 = suggestions.suggestions.slice(0, 3);
        const hasMore = suggestions.suggestions.length > 3;
        const hasStrengths = suggestions.strengths.length > 0;
        return (
          <View style={styles.suggCard}>
            <View style={styles.suggHeader}>
              <Text style={styles.suggIcon}>📚</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.suggTitle}>Practice Opportunities</Text>
                <Text style={styles.suggSubtitle}>Based on your recent homework</Text>
              </View>
            </View>

            {top3.map((s, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.suggChip}
                onPress={() => goToTutorWithPrompt(s.prompt)}
                activeOpacity={0.75}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggChipTopic}>{s.topic}</Text>
                  <Text style={styles.suggChipReason} numberOfLines={1}>{s.reason}</Text>
                </View>
                <View style={[styles.suggPriBadge, s.priority === 'high' ? styles.suggPriHigh : styles.suggPriMed]}>
                  <Text style={styles.suggPriText}>{s.priority === 'high' ? 'Review' : 'Practice'}</Text>
                </View>
              </TouchableOpacity>
            ))}

            {hasMore && (
              <TouchableOpacity onPress={() => (navigation as any).navigate('StudentTutor')}>
                <Text style={styles.suggSeeAll}>See all {suggestions.suggestions.length} topics →</Text>
              </TouchableOpacity>
            )}

            {hasStrengths && (
              <>
                <TouchableOpacity
                  style={styles.strengthsToggle}
                  onPress={() => setStrengthsExpanded(e => !e)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.strengthsToggleText}>
                    Your strengths 💪 {strengthsExpanded ? '▲' : '▼'}
                  </Text>
                </TouchableOpacity>
                {strengthsExpanded && (
                  <View style={styles.strengthsRow}>
                    {suggestions.strengths.map((s, idx) => (
                      <View key={idx} style={styles.strengthChip}>
                        <Text style={styles.strengthChipText}>{s.topic}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        );
      })()}

      {/* Open assignments */}
      <Text style={styles.sectionTitle}>Open Assignments</Text>
      {assignments.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No open assignments right now.</Text>
        </View>
      ) : (
        assignments.map(a => (
          <TouchableOpacity key={a.id} style={styles.assignmentCard} onPress={() => goToCamera(a)}>
            <View style={styles.assignmentInfo}>
              <Text style={styles.assignmentTitle}>{a.title ?? a.subject}</Text>
              {a.subject && a.title && (
                <Text style={styles.assignmentSub}>{a.subject}</Text>
              )}
            </View>
            <View style={styles.submitChip}>
              <Text style={styles.submitChipText}>Submit →</Text>
            </View>
          </TouchableOpacity>
        ))
      )}

      {/* Ask Neriah tutor card */}
      <TouchableOpacity
        style={styles.tutorCard}
        onPress={() => (navigation as any).navigate('StudentTutor')}
        activeOpacity={0.85}
      >
        <View style={styles.tutorCardAvatar}>
          <Text style={styles.tutorCardAvatarText}>N</Text>
        </View>
        <View style={styles.tutorCardBody}>
          <Text style={styles.tutorCardTitle}>Need help? Ask Neriah</Text>
          <Text style={styles.tutorCardSub}>Your AI study companion — guides you to the answer</Text>
        </View>
        <Text style={styles.tutorCardArrow}>›</Text>
      </TouchableOpacity>

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
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: { color: COLORS.textLight, fontSize: 14 },
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
  // Study suggestions card
  suggCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  suggHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  suggIcon: { fontSize: 20 },
  suggTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  suggSubtitle: { fontSize: 11, color: '#B45309', marginTop: 1 },
  suggChip: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  suggChipTopic: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  suggChipReason: { fontSize: 11, color: COLORS.gray500, marginTop: 2 },
  suggPriBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  suggPriHigh: { backgroundColor: '#FEE2E2' },
  suggPriMed:  { backgroundColor: '#FEF3C7' },
  suggPriText: { fontSize: 10, fontWeight: '700', color: '#92400E' },
  suggSeeAll: {
    fontSize: 12,
    color: '#B45309',
    fontWeight: '600',
    marginTop: 4,
    textDecorationLine: 'underline',
  },
  strengthsToggle: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#FCD34D' },
  strengthsToggleText: { fontSize: 12, fontWeight: '700', color: '#92400E' },
  strengthsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  strengthChip: {
    backgroundColor: '#D1FAE5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  strengthChipText: { fontSize: 12, fontWeight: '600', color: '#065F46' },

  // Tutor card
  tutorCard: {
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: COLORS.teal500,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tutorCardAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  tutorCardAvatarText: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  tutorCardBody: { flex: 1 },
  tutorCardTitle: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  tutorCardSub: { color: COLORS.teal100, fontSize: 12, marginTop: 2 },
  tutorCardArrow: { color: 'rgba(255,255,255,0.7)', fontSize: 24, marginLeft: 8 },
});
