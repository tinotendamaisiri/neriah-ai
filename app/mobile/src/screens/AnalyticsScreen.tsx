// src/screens/AnalyticsScreen.tsx
// Class list analytics view for teacher.
// Fetches /api/analytics/classes and shows per-class summary cards.
// Shows a proper "not enough data" state when graded submissions are absent.

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { getClassesAnalytics } from '../services/api';
import { useAuth } from '../context/AuthContext';
import AvatarWithStatus from '../components/AvatarWithStatus';
import { useLanguage } from '../context/LanguageContext';
import { COLORS } from '../constants/colors';
import type { ClassAnalyticsSummary, RootStackParamList } from '../types';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const LEVEL_DISPLAY: Record<string, string> = {
  grade_1: 'Grade 1', grade_2: 'Grade 2', grade_3: 'Grade 3',
  grade_4: 'Grade 4', grade_5: 'Grade 5', grade_6: 'Grade 6', grade_7: 'Grade 7',
  form_1: 'Form 1', form_2: 'Form 2', form_3: 'Form 3', form_4: 'Form 4',
  form_5: 'Form 5 (A-Level)', form_6: 'Form 6 (A-Level)',
  tertiary: 'College/University',
};

function barColor(score: number): string {
  if (score < 40) return COLORS.error;
  if (score <= 60) return COLORS.warning;
  return COLORS.teal500;
}

function trendLabel(t: (k: string) => string, trend: 'up' | 'down' | 'stable'): string {
  if (trend === 'up') return t('trend_up');
  if (trend === 'down') return t('trend_down');
  return t('trend_stable');
}

function trendColor(trend: 'up' | 'down' | 'stable'): string {
  if (trend === 'up') return COLORS.success;
  if (trend === 'down') return COLORS.error;
  return COLORS.gray500;
}

// ── Card for a class with data ─────────────────────────────────────────────────

interface ClassCardProps {
  item: ClassAnalyticsSummary;
  onPress: () => void;
  t: (k: string) => string;
}

const ClassCard = React.memo(({ item, onPress, t }: ClassCardProps) => {
  const hasData = (item as any).has_data !== false;
  const reason  = (item as any).reason as string | undefined;
  const score   = item.average_score ?? 0;
  const barW    = Math.min(Math.max(score, 0), 100);

  // Per-class "not enough data" states
  if (!hasData) {
    if (reason === 'no_homeworks') {
      return (
        <View style={[styles.card, styles.cardEmpty]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.className} numberOfLines={1}>{item.class_name}</Text>
              <Text style={styles.classLevel}>
                {LEVEL_DISPLAY[item.education_level] ?? item.education_level}
                {item.subject ? ` · ${item.subject}` : ''}
              </Text>
            </View>
          </View>
          <View style={styles.emptyCardBody}>
            <Ionicons name="document-text-outline" size={28} color={COLORS.gray200} />
            <Text style={styles.emptyCardTitle}>No homework assigned yet</Text>
            <Text style={styles.emptyCardSub}>Create homework to unlock analytics for this class.</Text>
          </View>
        </View>
      );
    }
    // no_graded_submissions
    return (
      <View style={[styles.card, styles.cardEmpty]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.className} numberOfLines={1}>{item.class_name}</Text>
            <Text style={styles.classLevel}>
              {LEVEL_DISPLAY[item.education_level] ?? item.education_level}
              {item.subject ? ` · ${item.subject}` : ''}
            </Text>
          </View>
          <View style={styles.hwBadge}>
            <Text style={styles.hwBadgeText}>{(item as any).homework_count ?? 0} homework</Text>
          </View>
        </View>
        <View style={styles.emptyCardBody}>
          <Ionicons name="bar-chart-outline" size={28} color={COLORS.gray200} />
          <Text style={styles.emptyCardTitle}>Not enough data yet</Text>
          <Text style={styles.emptyCardSub}>Grade at least one submission to see analytics.</Text>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.className} numberOfLines={1}>{item.class_name}</Text>
          <Text style={styles.classLevel}>
            {LEVEL_DISPLAY[item.education_level] ?? item.education_level}
            {item.subject ? ` · ${item.subject}` : ''}
          </Text>
        </View>
        <Text style={[styles.trendLabel, { color: trendColor(item.recent_trend) }]}>
          {trendLabel(t, item.recent_trend)}
        </Text>
      </View>

      {/* Progress bar */}
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${barW}%` as any, backgroundColor: barColor(score) }]} />
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <Text style={styles.statItem}>
          <Text style={styles.statValue}>{item.total_students}</Text>
          {' '}{t('students')}
        </Text>
        <Text style={styles.statItem}>
          <Text style={styles.statValue}>{item.total_submissions}</Text>
          {' '}{t('submissions_label')}
        </Text>
        <Text style={styles.statItem}>
          {t('avg_score')}{': '}
          <Text style={[styles.statValue, { color: barColor(score) }]}>
            {`${score}%`}
          </Text>
        </Text>
      </View>
    </TouchableOpacity>
  );
});

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigation = useNavigation<NavProp>();

  const [data, setData] = useState<ClassAnalyticsSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      console.log('[Analytics] fetching /analytics/classes');
      const res = await getClassesAnalytics();
      console.log('[Analytics] response:', JSON.stringify(res));
      setData(res);
    } catch (e: any) {
      console.log('[Analytics] error:', e?.message);
      setError(e?.message ?? 'Error loading analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => { load(); }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.teal500} />
        <Text style={styles.loadingText}>{t('analytics_loading')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={() => load()} style={styles.retryBtn}>
          <Text style={styles.retryText}>{t('retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12 }}>
        <Text style={styles.screenHeading}>{t('analytics')}</Text>
        <AvatarWithStatus
          initial={(user?.first_name?.[0] ?? 'T').toUpperCase()}
          onPress={() => navigation.navigate('Settings' as any)}
        />
      </View>
      <FlatList
        data={data}
        keyExtractor={(item) => item.class_id}
        renderItem={({ item }) => (
          <ClassCard
            item={item}
            t={t}
            onPress={() => {
              navigation.navigate('TeacherClassAnalytics', {
                class_id: item.class_id,
                class_name: item.class_name,
              });
            }}
          />
        )}
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
        maxToRenderPerBatch={10}
        windowSize={5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  screenHeading: {
    fontSize: 22, fontWeight: '700', color: COLORS.text,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
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
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  className: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  classLevel: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  trendLabel: { fontSize: 12, fontWeight: '600', marginLeft: 8, marginTop: 2 },
  hwBadge: {
    backgroundColor: COLORS.teal50, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8,
  },
  hwBadgeText: { fontSize: 11, fontWeight: '600', color: COLORS.teal500 },
  emptyCardBody: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  emptyCardTitle: { fontSize: 13, fontWeight: '700', color: COLORS.gray900, textAlign: 'center' },
  emptyCardSub: { fontSize: 12, color: COLORS.textLight, textAlign: 'center' },
  barTrack: { height: 8, backgroundColor: COLORS.gray200, borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
  barFill: { height: 8, borderRadius: 4 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { fontSize: 12, color: COLORS.gray500 },
  statValue: { fontWeight: '700', color: COLORS.text },
});
