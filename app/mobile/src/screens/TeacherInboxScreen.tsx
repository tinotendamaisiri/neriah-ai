// src/screens/TeacherInboxScreen.tsx
// Teacher inbox: list of pending student submissions. Tap to review.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { getTeacherSubmissions, approveSubmission } from '../services/api';
import { showError } from '../utils/showError';
import { TeacherSubmission, RootStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import { ScreenContainer } from '../components/ScreenContainer';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type FilterTab = 'all' | 'pending' | 'graded';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function TeacherInboxScreen() {
  const navigation = useNavigation<Nav>();
  const [submissions, setSubmissions] = useState<TeacherSubmission[]>([]);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    try {
      const data = await getTeacherSubmissions();
      data.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
      setSubmissions(data);
    } catch {
      if (!isRefresh) {
        Alert.alert('Error', 'Could not load submissions. Pull down to retry.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const handleApprove = (sub: TeacherSubmission) => {
    Alert.alert(
      'Approve submission',
      `Approve ${sub.student_name ?? 'this student'}'s submission${sub.score != null ? ` (${sub.score}/${sub.max_score})` : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setApprovingId(sub.id);
            try {
              await approveSubmission(sub.id);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setSubmissions(prev =>
                prev.map(s => s.id === sub.id ? { ...s, status: 'graded' } : s),
              );
            } catch (err) {
              showError(err);
            } finally {
              setApprovingId(null);
            }
          },
        },
      ],
    );
  };

  const displayed = submissions.filter(s => {
    if (filter === 'pending') return s.status === 'pending';
    if (filter === 'graded') return s.status === 'graded';
    return true;
  });

  const pendingCount = submissions.filter(s => s.status === 'pending').length;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.teal500} />
      </View>
    );
  }

  return (
    <ScreenContainer scroll={false}>
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Student Submissions</Text>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>{pendingCount} pending</Text>
          </View>
        )}
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(['all', 'pending', 'graded'] as FilterTab[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.filterTab, filter === tab && styles.filterTabActive]}
            onPress={() => setFilter(tab)}
          >
            <Text style={[styles.filterTabText, filter === tab && styles.filterTabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={displayed}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.teal500} />}
        contentContainerStyle={displayed.length === 0 ? styles.emptyFlex : styles.listContent}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="cloud-download-outline" size={56} color={COLORS.gray500} style={styles.emptyIcon} />
            <Text style={styles.emptyTitle}>
              {filter === 'pending' ? 'No pending submissions' : 'No submissions yet'}
            </Text>
            <Text style={styles.emptyText}>
              Share your class code with students to start receiving their work.
            </Text>
          </View>
        )}
        renderItem={({ item }) => {
          const isPending = item.status === 'pending';
          const isApproving = approvingId === item.id;

          return (
            <View style={[styles.card, isPending && styles.cardPending]}>
              {/* Avatar + names */}
              <View style={styles.cardHeader}>
                <View style={styles.initials}>
                  <Text style={styles.initialsText}>
                    {(item.student_name ?? 'S').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.cardMeta}>
                  <Text style={styles.studentName}>{item.student_name ?? 'Student'}</Text>
                  <Text style={styles.metaLine}>
                    {item.class_name ?? item.class_id}
                    {item.answer_key_title ? ` · ${item.answer_key_title}` : ''}
                  </Text>
                  <Text style={styles.timeAgo}>{timeAgo(item.submitted_at)}</Text>
                </View>
                <View style={[styles.statusBadge, isPending ? styles.badgePending : styles.badgeGraded]}>
                  <Text style={styles.statusBadgeText}>
                    {isPending ? 'Pending' : 'Graded'}
                  </Text>
                </View>
              </View>

              {/* Score (if graded) */}
              {!isPending && item.score != null && item.max_score != null && (
                <View style={styles.scoreRow}>
                  <Text style={styles.scoreText}>
                    Score: {item.score}/{item.max_score}
                    {' '}({Math.round((item.score / item.max_score) * 100)}%)
                  </Text>
                </View>
              )}

              {/* Approve button for pending */}
              {isPending && (
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[styles.approveBtn, isApproving && { opacity: 0.6 }]}
                    onPress={() => handleApprove(item)}
                    disabled={isApproving}
                  >
                    {isApproving
                      ? <ActivityIndicator size="small" color={COLORS.white} />
                      : <Text style={styles.approveBtnText}>Review & Approve</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text, flex: 1 },
  pendingBadge: {
    backgroundColor: COLORS.amber300,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pendingBadgeText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  filterTabActive: { backgroundColor: COLORS.teal500, borderColor: COLORS.teal500 },
  filterTabText: { fontSize: 13, color: COLORS.gray500, fontWeight: '600' },
  filterTabTextActive: { color: COLORS.white },
  listContent: { padding: 16, paddingBottom: 40 },
  emptyFlex: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  emptyText: { fontSize: 14, color: COLORS.gray500, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardPending: { borderColor: COLORS.amber100 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  initials: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.teal500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  cardMeta: { flex: 1 },
  studentName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  metaLine: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  timeAgo: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgePending: { backgroundColor: COLORS.amber300 },
  badgeGraded: { backgroundColor: COLORS.success },
  statusBadgeText: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  scoreRow: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.background },
  scoreText: { fontSize: 13, color: COLORS.gray900, fontWeight: '600' },
  cardActions: { marginTop: 10 },
  approveBtn: {
    backgroundColor: COLORS.teal500,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  approveBtnText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
});
