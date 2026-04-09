// src/screens/AnalyticsScreen.tsx
// Class list analytics view for teacher.
// Fetches /api/analytics/classes and shows per-class summary cards.
// Grayed out if total_submissions < 10.
// Tap a class → navigate('TeacherClassAnalytics', { class_id, class_name })

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
import { useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { getClassesAnalytics } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { COLORS } from '../constants/colors';
import type { ClassAnalyticsSummary, RootStackParamList } from '../types';
import { getCached, setCache, cacheKeys } from '../services/offlineCache';

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

interface ClassCardProps {
  item: ClassAnalyticsSummary;
  onPress: () => void;
  t: (k: string) => string;
}

const ClassCard = React.memo(({ item, onPress, t }: ClassCardProps) => {
  const locked = item.total_submissions < 10;
  const score = item.average_score;
  const barW = Math.min(Math.max(score, 0), 100);

  return (
    <TouchableOpacity
      style={[styles.card, locked && styles.cardLocked]}
      onPress={onPress}
      activeOpacity={locked ? 1 : 0.7}
    >
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.className} numberOfLines={1}>{item.class_name}</Text>
          <Text style={styles.classLevel}>
            {LEVEL_DISPLAY[item.education_level] ?? item.education_level}
            {item.subject ? ` · ${item.subject}` : ''}
          </Text>
        </View>
        {!locked && (
          <Text style={[styles.trendLabel, { color: trendColor(item.recent_trend) }]}>
            {trendLabel(t, item.recent_trend)}
          </Text>
        )}
      </View>

      {/* Progress bar */}
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${barW}%` as any, backgroundColor: locked ? COLORS.gray200 : barColor(score) },
          ]}
        />
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
          <Text style={[styles.statValue, { color: locked ? COLORS.gray500 : barColor(score) }]}>
            {locked ? '—' : `${score}%`}
          </Text>
        </Text>
      </View>

      {/* Locked overlay message */}
      {locked && (
        <Text style={styles.lockedMsg}>{t('analytics_unlocked_after')}</Text>
      )}
    </TouchableOpacity>
  );
});

export default function AnalyticsScreen() {
  const { t } = useLanguage();
  const navigation = useNavigation<NavProp>();

  const [data, setData] = useState<ClassAnalyticsSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await getClassesAnalytics();
      setData(res);
      setCachedAt(null);
      setCache(cacheKeys.analyticsAll(), res).catch(() => {});
    } catch (e: any) {
      // Try cache fallback
      const entry = await getCached<ClassAnalyticsSummary[]>(cacheKeys.analyticsAll());
      if (entry && entry.data.length > 0) {
        setData(entry.data);
        setCachedAt(entry.cached_at);
      } else {
        setError(e?.message ?? 'Error loading analytics');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
      <Text style={styles.screenHeading}>{t('analytics')}</Text>
      {cachedAt && (
        <View style={styles.cachedStrip}>
          <Text style={styles.cachedStripText}>
            Last updated {new Date(cachedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {new Date(cachedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      )}
      <FlatList
        data={data}
        keyExtractor={(item) => item.class_id}
        renderItem={({ item }) => (
          <ClassCard
            item={item}
            t={t}
            onPress={() => {
              if (item.total_submissions >= 10) {
                navigation.navigate('TeacherClassAnalytics', {
                  class_id: item.class_id,
                  class_name: item.class_name,
                });
              }
            }}
          />
        )}
        ListEmptyComponent={
          <View style={styles.center}>
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
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  screenHeading: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  cachedStrip: {
    backgroundColor: COLORS.amber50,
    paddingHorizontal: 16, paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: '#FDEBD0',
  },
  cachedStripText: { fontSize: 11, color: COLORS.amber700 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
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
  emptyText: {
    color: COLORS.gray500,
    fontSize: 15,
    textAlign: 'center',
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardLocked: {
    opacity: 0.7,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  className: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  classLevel: {
    fontSize: 12,
    color: COLORS.gray500,
    marginTop: 2,
  },
  trendLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
    marginTop: 2,
  },
  barTrack: {
    height: 8,
    backgroundColor: COLORS.gray200,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
  },
  barFill: {
    height: 8,
    borderRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    fontSize: 12,
    color: COLORS.gray500,
  },
  statValue: {
    fontWeight: '700',
    color: COLORS.text,
  },
  lockedMsg: {
    fontSize: 11,
    color: COLORS.gray500,
    fontStyle: 'italic',
    marginTop: 8,
    textAlign: 'center',
  },
});
