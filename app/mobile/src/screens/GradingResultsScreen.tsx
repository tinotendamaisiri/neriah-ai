// src/screens/GradingResultsScreen.tsx
// Per-student grading results for a single homework assignment.

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getTeacherSubmissions, approveAllMarks } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { RootStackParamList, TeacherSubmission } from '../types';
import { COLORS } from '../constants/colors';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso ?? ''; }
}

function pct(score?: number, max?: number): string {
  if (score == null || !max) return '';
  return `${Math.round((score / max) * 100)}%`;
}

function scoreColor(score?: number, max?: number): string {
  if (score == null || !max) return COLORS.gray500;
  const p = score / max;
  if (p >= 0.75) return COLORS.teal500;
  if (p >= 0.5) return COLORS.amber500;
  return COLORS.error;
}

function hasAnyFeedback(s: TeacherSubmission): boolean {
  if (s.overall_feedback) return true;
  return (s.verdicts ?? []).some(v => v.feedback);
}

export default function GradingResultsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { answer_key_id, class_id, class_name, answer_key_title } = route.params as {
    answer_key_id?: string;
    class_id: string;
    class_name: string;
    answer_key_title?: string;
  };

  // When answer_key_id is absent we're showing all marked homework for the class.
  const isClassView = !answer_key_id;

  const [submissions, setSubmissions] = useState<TeacherSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const subs = await getTeacherSubmissions({ class_id, teacher_id: user?.id });
      setSubmissions(
        isClassView
          ? subs.filter(s => s.status === 'graded' || s.status === 'pending')
          : subs.filter(s => s.answer_key_id === answer_key_id),
      );
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not load grading results.');
    } finally {
      setLoading(false);
    }
  }, [answer_key_id, class_id, isClassView, user?.id]);

  useFocusEffect(
    useCallback(() => { loadData(); }, [loadData]),
  );

  const handleApproveAll = useCallback(() => {
    const pendingIds = submissions
      .filter(s => s.status === 'pending' && s.mark_id)
      .map(s => s.mark_id!);
    if (pendingIds.length === 0) return;
    Alert.alert(
      'Approve All',
      `Release grades to all ${pendingIds.length} student${pendingIds.length === 1 ? '' : 's'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve All',
          onPress: async () => {
            setApproving(true);
            try {
              const result = await approveAllMarks(pendingIds);
              Alert.alert(
                'Done',
                `${result.approved_count} grade${result.approved_count === 1 ? '' : 's'} released to students.`,
              );
              loadData();
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Could not approve all marks.');
            } finally {
              setApproving(false);
            }
          },
        },
      ],
    );
  }, [submissions, loadData]);

  const graded = submissions.filter(s => s.status === 'graded');
  const pending = submissions.filter(s => s.status === 'pending');
  const gradedPcts = graded.map(s => s.max_score ? ((s.score ?? 0) / s.max_score) : 0);
  const avgPct = gradedPcts.length > 0
    ? Math.round(gradedPcts.reduce((a, b) => a + b, 0) / gradedPcts.length * 100)
    : null;
  const highestPct = gradedPcts.length > 0 ? Math.round(Math.max(...gradedPcts) * 100) : null;
  const lowestPct = gradedPcts.length > 0 ? Math.round(Math.min(...gradedPcts) * 100) : null;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← {class_name}</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>
          {isClassView ? 'Marked Homework' : (answer_key_title ?? '')}
        </Text>
        <Text style={styles.subheading}>{t('grading_results')}</Text>
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={COLORS.teal500} />
        </View>
      ) : (
        <>
          {/* Summary row */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryNum}>{graded.length}</Text>
              <Text style={styles.summaryLabel}>{t('graded')}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryNum}>{pending.length}</Text>
              <Text style={styles.summaryLabel}>{t('pending')}</Text>
            </View>
          </View>
          {avgPct != null && (
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={[styles.summaryNum, { color: scoreColor(avgPct, 100) }]}>
                  {avgPct}%
                </Text>
                <Text style={styles.summaryLabel}>{t('class_avg')}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={[styles.summaryNum, { color: scoreColor(highestPct!, 100) }]}>
                  {highestPct}%
                </Text>
                <Text style={styles.summaryLabel}>{t('highest')}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={[styles.summaryNum, { color: scoreColor(lowestPct!, 100) }]}>
                  {lowestPct}%
                </Text>
                <Text style={styles.summaryLabel}>{t('lowest')}</Text>
              </View>
            </View>
          )}

          {/* Approve all button */}
          {pending.length > 0 && (
            <View style={styles.approveAllRow}>
              <TouchableOpacity
                style={[styles.approveAllBtn, approving && styles.btnDisabled]}
                onPress={handleApproveAll}
                disabled={approving}
                activeOpacity={0.8}
              >
                {approving
                  ? <ActivityIndicator color={COLORS.white} size="small" />
                  : <Text style={styles.approveAllBtnText}>Approve All ({pending.length}) ✓</Text>
                }
              </TouchableOpacity>
            </View>
          )}

          {/* Graded submissions */}
          {graded.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('graded')}</Text>
              {graded.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.row}
                  onPress={() => navigation.navigate('GradingDetail', {
                    mark_id: s.mark_id,
                    student_name: s.student_name ?? 'Student',
                    class_name,
                    answer_key_title,
                  })}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowLeft}>
                    <View style={styles.nameRow}>
                      <Text style={styles.studentName}>{s.student_name ?? 'Student'}</Text>
                      {hasAnyFeedback(s) && (
                        <Text style={styles.commentIcon}>💬</Text>
                      )}
                    </View>
                    {isClassView && s.answer_key_title && (
                      <Text style={styles.homeworkLabel}>{s.answer_key_title}</Text>
                    )}
                    <Text style={styles.submittedDate}>{fmtDate(s.submitted_at)}</Text>
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={[styles.score, { color: scoreColor(s.score, s.max_score) }]}>
                      {s.score ?? 0}/{s.max_score ?? '?'}
                    </Text>
                    <Text style={[styles.scorePct, { color: scoreColor(s.score, s.max_score) }]}>
                      {pct(s.score, s.max_score)}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Pending submissions */}
          {pending.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('pending')}</Text>
              {pending.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.row}
                  onPress={() => navigation.navigate('GradingDetail', {
                    mark_id: s.mark_id,
                    student_name: s.student_name ?? 'Student',
                    class_name,
                    answer_key_title,
                  })}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowLeft}>
                    <Text style={styles.studentName}>{s.student_name ?? 'Student'}</Text>
                    {isClassView && s.answer_key_title && (
                      <Text style={styles.homeworkLabel}>{s.answer_key_title}</Text>
                    )}
                    <Text style={styles.submittedDate}>{fmtDate(s.submitted_at)}</Text>
                  </View>
                  <View style={[styles.pendingBadge]}>
                    <Text style={styles.pendingBadgeText}>{t('awaiting_grade')}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {submissions.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t('no_submissions')}</Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingBottom: 60 },
  centre: { paddingTop: 60, alignItems: 'center' },

  header: {
    backgroundColor: COLORS.white, paddingHorizontal: 20,
    paddingTop: 56, paddingBottom: 20,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backText: { fontSize: 14, color: COLORS.teal500, marginBottom: 10 },
  heading: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  subheading: { fontSize: 13, color: COLORS.gray500, marginTop: 2 },

  summaryRow: {
    flexDirection: 'row', gap: 12, padding: 16,
  },
  summaryCard: {
    flex: 1, backgroundColor: COLORS.white, borderRadius: 12,
    padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  summaryNum: { fontSize: 24, fontWeight: 'bold', color: COLORS.teal500 },
  summaryLabel: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },

  section: {
    backgroundColor: COLORS.white, marginHorizontal: 16, marginBottom: 12,
    borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: COLORS.gray500,
    textTransform: 'uppercase', marginBottom: 12,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.background,
  },
  rowLeft: { flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  studentName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  commentIcon: { fontSize: 13 },
  homeworkLabel: { fontSize: 12, color: COLORS.teal500, fontWeight: '600', marginTop: 1 },
  submittedDate: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  score: { fontSize: 16, fontWeight: 'bold' },
  scorePct: { fontSize: 12, marginTop: 2 },

  pendingBadge: {
    backgroundColor: COLORS.amber50, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  pendingBadgeText: { fontSize: 12, color: COLORS.amber700, fontWeight: '600' },

  empty: { alignItems: 'center', paddingTop: 48 },
  emptyText: { fontSize: 14, color: COLORS.gray500 },

  approveAllRow: { paddingHorizontal: 16, paddingBottom: 4 },
  approveAllBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  approveAllBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
});
