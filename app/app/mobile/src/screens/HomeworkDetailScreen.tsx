// src/screens/HomeworkDetailScreen.tsx
// Homework detail: view submissions, close submissions, trigger Gemma 4 batch grading,
// review/approve/override individual results, and view annotated images.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import {
  approveSubmission,
  closeAndGradeHomework,
  getTeacherSubmissions,
  listAnswerKeys,
  updateAnswerKey,
  updateMark,
  uploadAnswerKeyFile,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { pickFile } from '../utils/filePicker';
import { AnswerKey, TeacherSubmission } from '../types';
import { COLORS } from '../constants/colors';
import { getCached, setCache, cacheKeys, cacheImage } from '../services/offlineCache';
import { enqueueAction } from '../services/offlineQueue';
import { useNetworkStatus } from '../services/syncManager';
import {
  isModelAvailable,
  loadModel,
  getLiteRTState,
  subscribeToLiteRT,
  generateResponse as liteRTGenerate,
  buildGradingPrompt,
} from '../services/litert';
import { getDeviceCapabilities } from '../services/deviceCapabilities';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

const LEVEL_LABELS: Record<string, string> = {
  grade_1: 'Grade 1', grade_2: 'Grade 2', grade_3: 'Grade 3',
  grade_4: 'Grade 4', grade_5: 'Grade 5', grade_6: 'Grade 6', grade_7: 'Grade 7',
  form_1: 'Form 1', form_2: 'Form 2', form_3: 'Form 3', form_4: 'Form 4',
  form_5: 'Form 5 (A-Level)', form_6: 'Form 6 (A-Level)',
  tertiary: 'College/University',
};
const levelLabel = (l?: string | null) => (l ? LEVEL_LABELS[l] ?? l : '');

// ── Grading state ─────────────────────────────────────────────────────────────

type GradingState = 'open' | 'closed_ready' | 'grading' | 'complete';

function deriveGradingState(
  ak: AnswerKey | null,
  subs: TeacherSubmission[],
  triggered: boolean,
  localApproved: Set<string>,
): GradingState {
  if (!ak || ak.open_for_submission) return 'open';
  const pending = subs.filter(s => s.status === 'pending').length;
  const gradedOrApproved = subs.filter(
    s => s.status === 'graded' || s.status === 'approved' || localApproved.has(s.id),
  ).length;
  // Grading in progress if: some pending + some already graded (partial completion)
  if (pending > 0 && gradedOrApproved > 0) return 'grading';
  // Or if teacher explicitly triggered this session and still pending
  if (triggered && pending > 0) return 'grading';
  // All done
  if (gradedOrApproved > 0 && pending === 0) return 'complete';
  return 'closed_ready';
}

// ── Status badge component ────────────────────────────────────────────────────

function StatusBadge({
  sub,
  gradingActive,
  isApproved,
  pendingSync,
  pulseAnim,
}: {
  sub: TeacherSubmission;
  gradingActive: boolean;
  isApproved: boolean;
  pendingSync: boolean;
  pulseAnim: Animated.Value;
}) {
  if (isApproved) {
    if (pendingSync) {
      return (
        <View style={[badge.pill, { backgroundColor: '#E8F8F0', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
          <Text style={[badge.text, { color: COLORS.success }]}>Approved</Text>
          <Ionicons name="sync-outline" size={10} color={COLORS.success} />
        </View>
      );
    }
    return (
      <View style={[badge.pill, { backgroundColor: '#E8F8F0' }]}>
        <Text style={[badge.text, { color: COLORS.success }]}>Approved</Text>
      </View>
    );
  }
  if (sub.status === 'graded') {
    return (
      <View style={[badge.pill, { backgroundColor: COLORS.amber50 }]}>
        <Text style={[badge.text, { color: COLORS.amber700 }]}>Graded</Text>
      </View>
    );
  }
  if (gradingActive) {
    return (
      <Animated.View style={[badge.pill, { backgroundColor: '#EBF5FB', opacity: pulseAnim }]}>
        <Text style={[badge.text, { color: '#2980B9' }]}>Grading...</Text>
      </Animated.View>
    );
  }
  return (
    <View style={[badge.pill, { backgroundColor: COLORS.gray200 }]}>
      <Text style={[badge.text, { color: COLORS.gray500 }]}>Pending</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  pill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  text: { fontSize: 11, fontWeight: '700' },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function HomeworkDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const { t } = useLanguage();

  const { answer_key_id, class_id, class_name } = route.params as {
    answer_key_id: string;
    class_id: string;
    class_name: string;
  };

  // ── Core data ─────────────────────────────────────────────────────────────

  const [answerKey, setAnswerKey] = useState<AnswerKey | null>(null);
  const [submissions, setSubmissions] = useState<TeacherSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Grading flow ──────────────────────────────────────────────────────────

  const [hasTriggeredGrading, setHasTriggeredGrading] = useState(false);
  const [closingSubmissions, setClosingSubmissions] = useState(false);
  const [gradingLoading, setGradingLoading] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [localApproved, setLocalApproved] = useState<Set<string>>(new Set());
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());

  // Polling refs
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = useRef(false);

  // ── Offline state ─────────────────────────────────────────────────────────

  const { isOnline } = useNetworkStatus();
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  // Submissions approved offline — waiting for background sync
  const [pendingSyncIds, setPendingSyncIds] = useState<Set<string>>(new Set());

  // ── On-device grading (E4B) ───────────────────────────────────────────────

  const [e4bReady, setE4bReady] = useState(false);
  const [e4bLoading, setE4bLoading] = useState(false);
  const [offlineGradingIds, setOfflineGradingIds] = useState<Set<string>>(new Set());

  // Mirror LiteRT singleton state
  useEffect(() => {
    const unsub = subscribeToLiteRT(() => {
      const s = getLiteRTState();
      setE4bReady(s.loadedModel === 'e4b');
      setE4bLoading(s.isLoading);
    });
    return unsub;
  }, []);

  // When going offline, check E4B availability and load if present
  useEffect(() => {
    if (isOnline) return;
    let cancelled = false;
    (async () => {
      const caps = await getDeviceCapabilities();
      if (!caps.canRunE4B || cancelled) return;
      const available = await isModelAvailable('e4b');
      if (!available || cancelled) return;
      try {
        await loadModel('e4b');
      } catch { /* fall back — grading online only */ }
    })();
    return () => { cancelled = true; };
  }, [isOnline]);

  // Pulse animation (for grading badges)
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // ── Expand / collapse answer key ──────────────────────────────────────────

  const [keyExpanded, setKeyExpanded] = useState(false);

  // ── Rename (pending_setup) ────────────────────────────────────────────────

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  // ── AI scheme modal ───────────────────────────────────────────────────────

  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [qpText, setQpText] = useState('');
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // ── Image viewer ──────────────────────────────────────────────────────────

  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const viewerListRef = useRef<FlatList>(null);

  // ── Override modal ────────────────────────────────────────────────────────

  const [overrideVisible, setOverrideVisible] = useState(false);
  const [overrideSub, setOverrideSub] = useState<TeacherSubmission | null>(null);
  const [overrideScore, setOverrideScore] = useState('');
  const [overrideFeedback, setOverrideFeedback] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  // ── Derived state ─────────────────────────────────────────────────────────

  const gradingState = useMemo(
    () => deriveGradingState(answerKey, submissions, hasTriggeredGrading, localApproved),
    [answerKey, submissions, hasTriggeredGrading, localApproved],
  );

  const pendingCount = useMemo(
    () => submissions.filter(s => s.status === 'pending').length,
    [submissions],
  );
  const gradedCount = useMemo(
    () => submissions.filter(s => s.status === 'graded').length,
    [submissions],
  );
  const approvedCount = useMemo(
    () => submissions.filter(s => s.status === 'approved' || localApproved.has(s.id)).length,
    [submissions, localApproved],
  );

  const viewableSubs = useMemo(
    () => submissions.filter(s => s.status === 'graded' || s.status === 'approved' || localApproved.has(s.id)),
    [submissions, localApproved],
  );

  const hasQuestions = (answerKey?.questions.length ?? 0) > 0;

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadSubmissions = useCallback(async () => {
    try {
      const subs = await getTeacherSubmissions({ class_id, teacher_id: user?.id });
      setSubmissions(subs.filter(s => s.answer_key_id === answer_key_id));
    } catch {
      // Silently fail during polling — don't interrupt UI
    }
  }, [answer_key_id, class_id, user?.id]);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [keysResult, subsResult] = await Promise.allSettled([
        listAnswerKeys(class_id),
        getTeacherSubmissions({ class_id, teacher_id: user?.id }),
      ]);

      let gotFreshData = false;

      if (keysResult.status === 'fulfilled') {
        setAnswerKey(keysResult.value.find(k => k.id === answer_key_id) ?? null);
        // Cache homework list for this class
        setCache(cacheKeys.homework(class_id), keysResult.value).catch(() => {});
        gotFreshData = true;
      }

      if (subsResult.status === 'fulfilled') {
        const filtered = subsResult.value.filter(s => s.answer_key_id === answer_key_id);
        setSubmissions(filtered);
        // Cache submissions for this homework
        setCache(cacheKeys.submissions(answer_key_id), filtered).catch(() => {});
        // Background: download annotated images to device storage
        filtered.forEach(sub => {
          if (sub.marked_image_url && (sub.status === 'graded' || sub.status === 'approved')) {
            cacheImage(sub.marked_image_url).catch(() => {});
          }
        });
        gotFreshData = true;
      }

      if (gotFreshData) {
        setUsingCachedData(false);
        setCachedAt(null);
      } else {
        // Both calls failed — try cache
        await _loadFromCache();
      }
    } catch {
      await _loadFromCache();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [answer_key_id, class_id, user?.id]);

  const _loadFromCache = useCallback(async () => {
    const [keysEntry, subsEntry] = await Promise.all([
      getCached<AnswerKey[]>(cacheKeys.homework(class_id)),
      getCached<TeacherSubmission[]>(cacheKeys.submissions(answer_key_id)),
    ]);
    if (keysEntry) {
      setAnswerKey(keysEntry.data.find(k => k.id === answer_key_id) ?? null);
      setUsingCachedData(true);
      setCachedAt(keysEntry.cached_at);
    }
    if (subsEntry) {
      setSubmissions(subsEntry.data);
      setUsingCachedData(true);
      setCachedAt(prev => prev ?? subsEntry.cached_at);
    }
  }, [answer_key_id, class_id]);

  useFocusEffect(
    useCallback(() => { loadData(); }, [loadData]),
  );

  // ── Polling ───────────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    isPollingRef.current = false;
  }, []);

  const startPolling = useCallback(() => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    pollingRef.current = setInterval(loadSubmissions, 5000);
  }, [loadSubmissions]);

  // Stop polling when grading completes
  useEffect(() => {
    if (gradingState === 'grading') {
      startPolling();
      // Start pulse animation
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
      );
      pulseLoopRef.current.start();
    } else {
      stopPolling();
      pulseLoopRef.current?.stop();
      Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    }
    return stopPolling;
  }, [gradingState]);

  // Cleanup on unmount
  useEffect(() => () => {
    stopPolling();
    pulseLoopRef.current?.stop();
  }, []);

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleCloseSubmissions = () => {
    const count = submissions.length;
    Alert.alert(
      'Close Submissions?',
      `Students will no longer be able to submit. ${count} submission${count !== 1 ? 's' : ''} received.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: async () => {
            setClosingSubmissions(true);
            try {
              const updated = await updateAnswerKey(answer_key_id, { open_for_submission: false });
              setAnswerKey(updated);
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Could not close submissions.');
            } finally {
              setClosingSubmissions(false);
            }
          },
        },
      ],
    );
  };

  const handleGradeAll = () => {
    if (!hasQuestions) {
      Alert.alert('No answer key', 'Add an answer key before grading.');
      return;
    }
    const count = pendingCount;
    if (count === 0) {
      Alert.alert('No pending submissions', 'There are no submissions to grade.');
      return;
    }
    Alert.alert(
      'Grade All with Gemma 4?',
      `Grade ${count} submission${count !== 1 ? 's' : ''} using Gemma 4. This may take a few minutes.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Grade All',
          onPress: async () => {
            setGradingLoading(true);
            try {
              await closeAndGradeHomework(answer_key_id);
              setAnswerKey(prev => prev ? { ...prev, open_for_submission: false } : prev);
              setHasTriggeredGrading(true);
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Could not start grading. Please try again.');
            } finally {
              setGradingLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleApprove = async (sub: TeacherSubmission) => {
    if (!isOnline) {
      // Offline: queue approval and apply optimistically
      await enqueueAction({ action: 'approve_submission', submission_id: sub.id });
      setLocalApproved(prev => new Set(prev).add(sub.id));
      setPendingSyncIds(prev => new Set(prev).add(sub.id));
      // Update cached submissions so the state survives a restart
      const cached = await getCached<TeacherSubmission[]>(cacheKeys.submissions(answer_key_id));
      if (cached) {
        const updated = cached.data.map(s =>
          s.id === sub.id ? { ...s, status: 'approved' as const } : s,
        );
        setCache(cacheKeys.submissions(answer_key_id), updated).catch(() => {});
      }
      return;
    }

    setApprovingIds(prev => new Set(prev).add(sub.id));
    try {
      await approveSubmission(sub.id);
      setLocalApproved(prev => new Set(prev).add(sub.id));
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not approve submission.');
    } finally {
      setApprovingIds(prev => { const n = new Set(prev); n.delete(sub.id); return n; });
    }
  };

  const handleApproveAll = async () => {
    const toApprove = submissions.filter(
      s => s.status === 'graded' && !localApproved.has(s.id),
    );
    if (toApprove.length === 0) return;
    setApprovingAll(true);
    try {
      await Promise.allSettled(toApprove.map(s => approveSubmission(s.id)));
      setLocalApproved(prev => {
        const next = new Set(prev);
        toApprove.forEach(s => next.add(s.id));
        return next;
      });
    } catch { /* individual errors swallowed — optimistic update still applied */ }
    finally {
      setApprovingAll(false);
    }
  };

  const openOverride = (sub: TeacherSubmission) => {
    setOverrideSub(sub);
    setOverrideScore(String(sub.score ?? ''));
    setOverrideFeedback(sub.overall_feedback ?? '');
    setOverrideVisible(true);
  };

  const handleSaveOverride = async () => {
    if (!overrideSub) return;
    const newScore = parseFloat(overrideScore);
    if (isNaN(newScore) || newScore < 0) {
      Alert.alert('Invalid score', 'Please enter a valid number.');
      return;
    }
    setSavingOverride(true);

    if (!isOnline) {
      // Offline: queue override and apply optimistically
      await enqueueAction({
        action: 'override_mark',
        mark_id: overrideSub.mark_id,
        score: newScore,
        feedback: overrideFeedback.trim() || undefined,
        manually_edited: true,
      });
      setSubmissions(prev =>
        prev.map(s =>
          s.id === overrideSub.id
            ? { ...s, score: newScore, overall_feedback: overrideFeedback.trim() || undefined, manually_edited: true }
            : s,
        ),
      );
      setPendingSyncIds(prev => new Set(prev).add(overrideSub.id));
      // Update cache
      const cached = await getCached<TeacherSubmission[]>(cacheKeys.submissions(answer_key_id));
      if (cached) {
        const updated = cached.data.map(s =>
          s.id === overrideSub.id
            ? { ...s, score: newScore, overall_feedback: overrideFeedback.trim() || undefined }
            : s,
        );
        setCache(cacheKeys.submissions(answer_key_id), updated).catch(() => {});
      }
      setSavingOverride(false);
      setOverrideVisible(false);
      return;
    }

    try {
      await updateMark(overrideSub.mark_id, {
        score: newScore,
        overall_feedback: overrideFeedback.trim() || undefined,
        manually_edited: true,
      });
      setSubmissions(prev =>
        prev.map(s =>
          s.id === overrideSub.id
            ? { ...s, score: newScore, overall_feedback: overrideFeedback.trim() || undefined, manually_edited: true }
            : s,
        ),
      );
      setOverrideVisible(false);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not save override.');
    } finally {
      setSavingOverride(false);
    }
  };

  // ── Offline grading (E4B on-device) ──────────────────────────────────────

  const handleGradeOffline = async (sub: TeacherSubmission) => {
    if (!answerKey || !e4bReady) return;

    // TODO: Add multimodal image input when mediapipe-llm adds image API.
    //       For now, text-only grading. Image submissions from teacher scans
    //       require on-device OCR which is not yet implemented.
    if (sub.source === 'teacher_scan') {
      Alert.alert(
        'Image grading offline',
        'On-device grading of scanned images requires OCR support (coming soon). Connect to grade this submission.',
      );
      return;
    }

    setOfflineGradingIds(prev => new Set(prev).add(sub.id));
    try {
      const studentAnswers = `Student: ${sub.student_name ?? 'Unknown'}\nSubmitted: ${sub.submitted_at}`;
      const prompt = buildGradingPrompt(
        answerKey.questions,
        studentAnswers,
        answerKey.education_level ?? undefined,
      );

      const raw = await liteRTGenerate(prompt);

      // Parse JSON response from Gemma
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Model did not return valid JSON');
      const result = JSON.parse(jsonMatch[0]) as {
        score: number;
        max_score: number;
        verdicts: Array<{ question_number: number; verdict: string; awarded_marks: number; max_marks: number }>;
        overall_feedback?: string;
      };

      // Apply grading result locally
      setSubmissions(prev =>
        prev.map(s =>
          s.id === sub.id
            ? {
                ...s,
                status: 'graded' as const,
                score: result.score,
                max_score: result.max_score,
                verdicts: result.verdicts as any,
                overall_feedback: result.overall_feedback,
                graded_offline: true,
                grading_model: 'gemma4-e4b',
              }
            : s,
        ),
      );

      // Cache the updated submissions so the state survives a restart
      const cached = await getCached<TeacherSubmission[]>(cacheKeys.submissions(answer_key_id));
      if (cached) {
        const updated = cached.data.map(s =>
          s.id === sub.id
            ? { ...s, status: 'graded' as const, graded_offline: true, grading_model: 'gemma4-e4b' }
            : s,
        );
        setCache(cacheKeys.submissions(answer_key_id), updated).catch(() => {});
      }
    } catch (err: any) {
      Alert.alert('Grading failed', err?.message ?? 'Could not grade offline. Try again.');
    } finally {
      setOfflineGradingIds(prev => { const n = new Set(prev); n.delete(sub.id); return n; });
    }
  };

  // ── Rename handlers ───────────────────────────────────────────────────────

  const handleSaveTitle = async () => {
    const newTitle = titleDraft.trim();
    if (!newTitle || !answerKey) return;
    setSavingTitle(true);
    try {
      const updated = await updateAnswerKey(answerKey.id, { title: newTitle });
      setAnswerKey(updated);
      setEditingTitle(false);
    } catch (err: any) {
      Alert.alert(t('error'), err.message ?? 'Could not rename homework.');
    } finally {
      setSavingTitle(false);
    }
  };

  // ── File / AI handlers ────────────────────────────────────────────────────

  const handlePickFile = async () => {
    const file = await pickFile({
      title: t('add_question_paper'),
      takePhoto: t('take_photo'),
      gallery: t('choose_from_gallery'),
      uploadFile: t('upload_file'),
      cancel: t('cancel'),
    });
    if (!file) return;
    if (file.isImage) {
      setLocalImageUri(file.uri);
      setAiModalVisible(true);
    } else {
      if (!answerKey) return;
      setGenerating(true);
      try {
        const updated = await uploadAnswerKeyFile(answerKey.id, file.uri, file.name, file.mimeType);
        setAnswerKey(updated);
        Alert.alert('Done', `Generated ${updated.questions.length} questions from your file.`);
      } catch (err: any) {
        Alert.alert(t('error'), err.message ?? 'Could not generate marking scheme.');
      } finally {
        setGenerating(false);
      }
    }
  };

  const handleGenerateAI = async () => {
    if (!qpText.trim() || !answerKey) return;
    setGenerating(true);
    try {
      const updated = await updateAnswerKey(answerKey.id, {
        auto_generate: true,
        question_paper_text: qpText.trim(),
        ...(answerKey.education_level ? { education_level: answerKey.education_level as any } : {}),
      });
      setAnswerKey(updated);
      setAiModalVisible(false);
      setQpText('');
      setLocalImageUri(null);
      Alert.alert('Done', `Generated ${updated.questions.length} questions.`);
    } catch (err: any) {
      Alert.alert(t('error'), err.message ?? 'Could not generate marking scheme.');
    } finally {
      setGenerating(false);
    }
  };

  // ── Image viewer ──────────────────────────────────────────────────────────

  const openViewer = (subId: string) => {
    const idx = viewableSubs.findIndex(s => s.id === subId);
    if (idx < 0) return;
    setViewerIndex(idx);
    setViewerVisible(true);
    setTimeout(() => {
      viewerListRef.current?.scrollToIndex({ index: idx, animated: false });
    }, 50);
  };

  // ── Loading / not found ───────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={COLORS.teal500} />
      </View>
    );
  }

  if (!answerKey) {
    return (
      <View style={styles.centre}>
        <Text style={styles.notFoundText}>{t('homework_not_found')}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>{t('back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isPendingSetup = answerKey.status === 'pending_setup';
  const title = answerKey.title ?? answerKey.subject;

  // ── Status banner config ──────────────────────────────────────────────────

  const bannerConfig = {
    open:         { bg: '#E8F8F0', text: COLORS.success,  label: `Accepting Submissions — ${submissions.length} received` },
    closed_ready: { bg: COLORS.amber50, text: COLORS.amber700, label: `Submissions Closed — Ready to Grade` },
    grading:      { bg: '#EBF5FB',  text: '#2471A3',       label: `Grading... ${gradedCount + approvedCount}/${submissions.length}` },
    complete:     { bg: COLORS.teal50, text: COLORS.teal700, label: `Grading Complete — ${approvedCount}/${submissions.length} Approved` },
  }[gradingState];

  // ── Submission card renderer ───────────────────────────────────────────────

  const renderSubmission = ({ item: sub }: { item: TeacherSubmission }) => {
    const isApproved = localApproved.has(sub.id) || sub.status === 'approved';
    const isGraded = sub.status === 'graded';
    const isBeingApproved = approvingIds.has(sub.id);
    const isViewable = !!sub.marked_image_url && (isGraded || isApproved);

    return (
      <TouchableOpacity
        style={styles.submCard}
        onPress={() => isViewable ? openViewer(sub.id) : undefined}
        activeOpacity={isViewable ? 0.75 : 1}
      >
        <View style={styles.submCardLeft}>
          {/* Thumbnail */}
          <View style={styles.thumbContainer}>
            {sub.marked_image_url ? (
              <Image
                source={{ uri: sub.marked_image_url }}
                style={styles.thumb}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Ionicons name="document-outline" size={20} color={COLORS.gray200} />
              </View>
            )}
          </View>

          {/* Info */}
          <View style={styles.submInfo}>
            <Text style={styles.submName}>{sub.student_name ?? 'Student'}</Text>
            <Text style={styles.submMeta}>
              {fmtDate(sub.submitted_at)}{fmtTime(sub.submitted_at) ? ` · ${fmtTime(sub.submitted_at)}` : ''}
            </Text>
            {(isGraded || isApproved) && sub.score != null && (
              <Text style={styles.submScore}>
                {sub.score}/{sub.max_score ?? '?'} marks
              </Text>
            )}
          </View>
        </View>

        <View style={styles.submCardRight}>
          <StatusBadge
            sub={sub}
            gradingActive={gradingState === 'grading'}
            isApproved={isApproved}
            pendingSync={pendingSyncIds.has(sub.id)}
            pulseAnim={pulseAnim}
          />
          {/* Amber "Graded offline" badge — shown when submission was graded by on-device model */}
          {(sub.graded_offline || sub.grading_model === 'gemma4-e4b') && (
            <View style={styles.offlineBadge}>
              <Ionicons name="phone-portrait-outline" size={9} color={COLORS.amber700} />
              <Text style={styles.offlineBadgeText}>Graded offline</Text>
            </View>
          )}

          {/* Grade Offline button — pending submission + offline + E4B loaded */}
          {sub.status === 'pending' && !isOnline && e4bReady && !offlineGradingIds.has(sub.id) && (
            <TouchableOpacity
              style={styles.gradeOfflineBtn}
              onPress={() => handleGradeOffline(sub)}
            >
              <Ionicons name="phone-portrait-outline" size={11} color={COLORS.amber700} />
              <Text style={styles.gradeOfflineBtnText}>Grade Offline</Text>
            </TouchableOpacity>
          )}
          {offlineGradingIds.has(sub.id) && (
            <ActivityIndicator size="small" color={COLORS.amber300} style={{ marginTop: 6 }} />
          )}

          {/* Action buttons for graded-but-not-approved */}
          {isGraded && !isApproved && (
            <View style={styles.submActions}>
              <TouchableOpacity
                style={styles.approveBtn}
                onPress={() => handleApprove(sub)}
                disabled={isBeingApproved}
              >
                {isBeingApproved
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : <Text style={styles.approveBtnText}>Approve</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.overrideBtn}
                onPress={() => openOverride(sub)}
              >
                <Text style={styles.overrideBtnText}>Override</Text>
              </TouchableOpacity>
            </View>
          )}

          {isViewable && (
            <Ionicons name="chevron-forward" size={16} color={COLORS.gray200} style={{ marginTop: 6 }} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ── Bottom action bar content ─────────────────────────────────────────────

  const renderBottomBar = () => {
    switch (gradingState) {
      case 'open':
        return (
          <TouchableOpacity
            style={[styles.actionBtn, styles.closeBtn, closingSubmissions && styles.btnDisabled]}
            onPress={handleCloseSubmissions}
            disabled={closingSubmissions}
            activeOpacity={0.85}
          >
            {closingSubmissions
              ? <ActivityIndicator color={COLORS.white} />
              : <Text style={styles.actionBtnText}>Close Submissions</Text>
            }
          </TouchableOpacity>
        );

      case 'closed_ready':
        return (
          <TouchableOpacity
            style={[
              styles.actionBtn, styles.gradeAllBtn,
              (!hasQuestions || gradingLoading || !isOnline) && styles.btnDisabled,
            ]}
            onPress={handleGradeAll}
            disabled={!hasQuestions || gradingLoading || !isOnline}
            activeOpacity={0.85}
          >
            {gradingLoading
              ? <ActivityIndicator color={COLORS.white} />
              : (
                <>
                  <Text style={styles.actionBtnText}>
                    {isOnline ? `⚡  Grade All (${pendingCount})` : `⚡  Grade All (${pendingCount})`}
                  </Text>
                  {!hasQuestions && (
                    <Text style={styles.actionBtnSub}>Add an answer key first</Text>
                  )}
                  {!isOnline && (
                    <Text style={styles.actionBtnSub}>Grading requires internet connection</Text>
                  )}
                </>
              )
            }
          </TouchableOpacity>
        );

      case 'grading': {
        const total = submissions.length;
        const done = gradedCount + approvedCount;
        const pct = total > 0 ? done / total : 0;
        return (
          <View style={styles.gradingBarWrapper}>
            <Text style={styles.gradingBarLabel}>
              Grading with Gemma 4... {done}/{total}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
            </View>
            <Text style={styles.gradingBarSub}>Results appear below as they complete</Text>
          </View>
        );
      }

      case 'complete':
        return (
          <View style={styles.completeBar}>
            <TouchableOpacity
              style={[styles.approveAllBtn, approvingAll && styles.btnDisabled]}
              onPress={handleApproveAll}
              disabled={approvingAll}
              activeOpacity={0.85}
            >
              {approvingAll
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.actionBtnText}>Approve All</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {/* scroll to first unapproved — FlatList handles it */}}
              style={styles.reviewLink}
            >
              <Text style={styles.reviewLinkText}>Review Individually</Text>
            </TouchableOpacity>
          </View>
        );
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.flex}>

      {/* ── Main content (ScrollView with all sections) ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshing={refreshing}
        onScrollBeginDrag={() => {}}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={COLORS.teal500} />
            <Text style={styles.backText}>{class_name}</Text>
          </TouchableOpacity>

          {isPendingSetup && editingTitle ? (
            <View style={styles.renameRow}>
              <TextInput
                style={styles.renameInput}
                value={titleDraft}
                onChangeText={setTitleDraft}
                placeholder={t('homework_title_placeholder')}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSaveTitle}
              />
              <TouchableOpacity
                style={[styles.saveTitleBtn, savingTitle && styles.btnDisabled]}
                onPress={handleSaveTitle}
                disabled={savingTitle}
              >
                {savingTitle
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : <Text style={styles.saveTitleText}>{t('save')}</Text>
                }
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.headingRow}>
              <Text style={styles.heading} numberOfLines={2}>{title}</Text>
              {isPendingSetup && (
                <TouchableOpacity
                  onPress={() => { setTitleDraft(title); setEditingTitle(true); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.renameLink}>{t('rename_homework')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {answerKey.subject && answerKey.title && (
            <Text style={styles.subjectTag}>{answerKey.subject}</Text>
          )}
        </View>

        {/* Cached data notice */}
        {usingCachedData && (
          <View style={styles.cachedBanner}>
            <Ionicons name="cloud-offline-outline" size={13} color={COLORS.amber700} />
            <Text style={styles.cachedBannerText}>
              {cachedAt
                ? `Cached data — last updated ${new Date(cachedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
                : 'Viewing cached data'}
            </Text>
          </View>
        )}

        {/* Status banner */}
        <View style={[styles.statusBanner, { backgroundColor: bannerConfig.bg }]}>
          <Text style={[styles.statusBannerText, { color: bannerConfig.text }]}>
            {bannerConfig.label}
          </Text>
        </View>

        {/* Answer key card */}
        <View style={styles.section}>
          {!hasQuestions ? (
            // No answer key — show warning + setup options
            <>
              <View style={styles.noKeyWarning}>
                <Ionicons name="warning-outline" size={18} color={COLORS.amber700} />
                <Text style={styles.noKeyText}>
                  No answer key — add one before grading
                </Text>
              </View>
              <TouchableOpacity style={styles.setupBtn} onPress={handlePickFile}>
                <Text style={styles.setupBtnIcon}>📄</Text>
                <View>
                  <Text style={styles.setupBtnLabel}>{t('upload_question_paper_photo')}</Text>
                  <Text style={styles.setupBtnSub}>{t('upload_question_paper_sub')}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.setupBtn}
                onPress={() => navigation.navigate('GenerateScheme', {
                  class_id,
                  class_name,
                  education_level: answerKey.education_level ?? undefined,
                  subject: answerKey.subject ?? undefined,
                })}
              >
                <Text style={styles.setupBtnIcon}>✨</Text>
                <View>
                  <Text style={styles.setupBtnLabel}>{t('generate_with_ai')}</Text>
                  <Text style={styles.setupBtnSub}>{t('generate_with_ai_sub')}</Text>
                </View>
              </TouchableOpacity>
            </>
          ) : (
            // Answer key summary
            <>
              <TouchableOpacity
                style={styles.keyHeader}
                onPress={() => setKeyExpanded(v => !v)}
                activeOpacity={0.8}
              >
                <View>
                  <Text style={styles.sectionTitle}>Marking Scheme</Text>
                  <Text style={styles.keyMeta}>
                    {answerKey.questions.length} questions · {answerKey.total_marks} marks
                    {answerKey.education_level
                      ? ` · ${levelLabel(answerKey.education_level)}`
                      : ''}
                  </Text>
                </View>
                <View style={styles.keyHeaderRight}>
                  <TouchableOpacity onPress={handlePickFile}>
                    <Text style={styles.regenerateLink}>{t('regenerate')}</Text>
                  </TouchableOpacity>
                  <Ionicons
                    name={keyExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={COLORS.gray500}
                    style={{ marginLeft: 12 }}
                  />
                </View>
              </TouchableOpacity>

              {keyExpanded && (
                <View style={styles.keyQuestions}>
                  {answerKey.questions.map(q => (
                    <View key={q.number} style={styles.keyQuestion}>
                      <Text style={styles.keyQNum}>Q{q.number}</Text>
                      <Text style={styles.keyQAnswer} numberOfLines={2}>{q.correct_answer}</Text>
                      <Text style={styles.keyQMarks}>{q.max_marks}mk</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </View>

        {/* Submissions count row */}
        {submissions.length > 0 && (
          <View style={styles.countsRow}>
            <View style={styles.countCard}>
              <Text style={styles.countNum}>{pendingCount}</Text>
              <Text style={styles.countLabel}>Pending</Text>
            </View>
            <View style={styles.countCard}>
              <Text style={[styles.countNum, { color: COLORS.amber700 }]}>{gradedCount}</Text>
              <Text style={styles.countLabel}>Graded</Text>
            </View>
            <View style={styles.countCard}>
              <Text style={[styles.countNum, { color: COLORS.success }]}>{approvedCount}</Text>
              <Text style={styles.countLabel}>Approved</Text>
            </View>
          </View>
        )}

        {/* Submissions list */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Student Submissions ({submissions.length})
          </Text>
          {submissions.length === 0 ? (
            <Text style={styles.emptyText}>
              No submissions yet. Students can submit via the app, WhatsApp, or email.
            </Text>
          ) : (
            submissions.map(sub => (
              <View key={sub.id}>
                {renderSubmission({ item: sub })}
              </View>
            ))
          )}
        </View>

      </ScrollView>

      {/* Bottom action bar */}
      <View style={styles.bottomBar}>
        {renderBottomBar()}
      </View>

      {/* ── Image viewer modal ── */}
      <Modal
        visible={viewerVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setViewerVisible(false)}
      >
        <View style={styles.viewerContainer}>
          {/* Viewer header */}
          <View style={styles.viewerHeader}>
            <TouchableOpacity
              style={styles.viewerClose}
              onPress={() => setViewerVisible(false)}
            >
              <Ionicons name="close" size={24} color={COLORS.white} />
            </TouchableOpacity>
            {viewableSubs[viewerIndex] && (
              <View style={styles.viewerInfo}>
                <Text style={styles.viewerName}>
                  {viewableSubs[viewerIndex].student_name ?? 'Student'}
                </Text>
                <Text style={styles.viewerScore}>
                  {viewableSubs[viewerIndex].score ?? 0}/{viewableSubs[viewerIndex].max_score ?? '?'} marks
                </Text>
              </View>
            )}
            <Text style={styles.viewerPager}>
              {viewerIndex + 1}/{viewableSubs.length}
            </Text>
          </View>

          {/* Swipeable pages */}
          <FlatList
            ref={viewerListRef}
            data={viewableSubs}
            keyExtractor={s => s.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={viewerIndex}
            getItemLayout={(_, idx) => ({
              length: SCREEN_W, offset: SCREEN_W * idx, index: idx,
            })}
            onMomentumScrollEnd={e => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
              setViewerIndex(idx);
            }}
            renderItem={({ item: sub }) => (
              <View style={{ width: SCREEN_W, flex: 1 }}>
                <ScrollView
                  style={{ flex: 1 }}
                  maximumZoomScale={4}
                  minimumZoomScale={1}
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.viewerImageContainer}
                >
                  {sub.marked_image_url ? (
                    <Image
                      source={{ uri: sub.marked_image_url }}
                      style={styles.viewerImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={styles.viewerNoImage}>
                      <Ionicons name="image-outline" size={64} color={COLORS.gray200} />
                      <Text style={{ color: COLORS.gray500, marginTop: 12 }}>No image available</Text>
                    </View>
                  )}
                </ScrollView>
              </View>
            )}
          />

          {/* Viewer action bar */}
          {viewableSubs[viewerIndex] && (() => {
            const sub = viewableSubs[viewerIndex];
            const isApproved = localApproved.has(sub.id) || sub.status === 'approved';
            return (
              <View style={styles.viewerActions}>
                {!isApproved && (
                  <TouchableOpacity
                    style={[styles.viewerApproveBtn, approvingIds.has(sub.id) && styles.btnDisabled]}
                    onPress={() => handleApprove(sub)}
                    disabled={approvingIds.has(sub.id)}
                  >
                    {approvingIds.has(sub.id)
                      ? <ActivityIndicator color={COLORS.white} />
                      : <Text style={styles.viewerApproveBtnText}>✓ Approve</Text>
                    }
                  </TouchableOpacity>
                )}
                {isApproved && (
                  <View style={styles.viewerApprovedBadge}>
                    <Text style={styles.viewerApprovedText}>✓ Approved</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.viewerOverrideBtn}
                  onPress={() => openOverride(sub)}
                >
                  <Text style={styles.viewerOverrideBtnText}>Override Score</Text>
                </TouchableOpacity>
              </View>
            );
          })()}
        </View>
      </Modal>

      {/* ── Override modal ── */}
      <Modal
        visible={overrideVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setOverrideVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.overlayContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.overrideSheet}>
            <View style={styles.overrideHeader}>
              <Text style={styles.overrideTitle}>Override Score</Text>
              <TouchableOpacity onPress={() => setOverrideVisible(false)}>
                <Ionicons name="close" size={22} color={COLORS.gray500} />
              </TouchableOpacity>
            </View>

            {overrideSub && (
              <View style={styles.overrideBody}>
                <Text style={styles.overrideStudentName}>
                  {overrideSub.student_name ?? 'Student'}
                </Text>
                <Text style={styles.overrideCurrentScore}>
                  Current: {overrideSub.score ?? 0}/{overrideSub.max_score ?? '?'}
                </Text>

                <Text style={styles.overrideLabel}>New Score</Text>
                <TextInput
                  style={styles.overrideInput}
                  value={overrideScore}
                  onChangeText={setOverrideScore}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 8"
                  placeholderTextColor={COLORS.gray500}
                  autoFocus
                />

                <Text style={styles.overrideLabel}>
                  Feedback <Text style={styles.overrideLabelOpt}>(optional)</Text>
                </Text>
                <TextInput
                  style={[styles.overrideInput, styles.overrideFeedback]}
                  value={overrideFeedback}
                  onChangeText={setOverrideFeedback}
                  placeholder="Add a note for this override..."
                  placeholderTextColor={COLORS.gray500}
                  multiline
                  textAlignVertical="top"
                />

                <TouchableOpacity
                  style={[styles.overrideSaveBtn, savingOverride && styles.btnDisabled]}
                  onPress={handleSaveOverride}
                  disabled={savingOverride}
                >
                  {savingOverride
                    ? <ActivityIndicator color={COLORS.white} />
                    : <Text style={styles.overrideSaveBtnText}>Save Override</Text>
                  }
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── AI scheme generation modal ── */}
      <Modal
        visible={aiModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setAiModalVisible(false); setQpText(''); setLocalImageUri(null); }}
      >
        <View style={styles.aiModal}>
          <View style={styles.aiModalHeader}>
            <Text style={styles.aiModalTitle}>{t('generate_scheme')}</Text>
            <TouchableOpacity
              onPress={() => { setAiModalVisible(false); setQpText(''); setLocalImageUri(null); }}
              hitSlop={{ top: 8, bottom: 8, left: 16, right: 8 }}
            >
              <Text style={styles.aiModalCancel}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.aiModalBody} keyboardShouldPersistTaps="handled">
            {localImageUri && (
              <Image source={{ uri: localImageUri }} style={styles.aiPreviewImage} resizeMode="contain" />
            )}
            <Text style={styles.aiModalLabel}>{t('question_paper_text')}</Text>
            <Text style={styles.aiModalHint}>{t('question_paper_hint')}</Text>
            <TextInput
              style={styles.aiTextArea}
              placeholder={t('question_paper_placeholder')}
              value={qpText}
              onChangeText={setQpText}
              multiline
              textAlignVertical="top"
              autoFocus={!localImageUri}
            />
            <TouchableOpacity
              style={[styles.aiGenerateBtn, (generating || !qpText.trim()) && styles.btnDisabled]}
              onPress={handleGenerateAI}
              disabled={generating || !qpText.trim()}
            >
              {generating
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.aiGenerateBtnText}>{t('generate_scheme_btn')}</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  content: { paddingBottom: 120 },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  notFoundText: { fontSize: 16, color: COLORS.gray500, marginBottom: 12 },
  backLink: { fontSize: 16, color: COLORS.teal500 },

  // Header
  header: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 20,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  backText: { fontSize: 14, color: COLORS.teal500, fontWeight: '600' },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  heading: { fontSize: 22, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  renameLink: { fontSize: 13, color: COLORS.teal500, fontWeight: '600', paddingTop: 3 },
  subjectTag: { marginTop: 4, fontSize: 13, color: COLORS.gray500 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  renameInput: {
    flex: 1, borderWidth: 1, borderColor: COLORS.teal500,
    borderRadius: 8, padding: 10, fontSize: 16, color: COLORS.text,
  },
  saveTitleBtn: { backgroundColor: COLORS.teal500, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  saveTitleText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },

  // Status banner
  statusBanner: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  statusBannerText: { fontSize: 14, fontWeight: '700' },

  // Sections
  section: {
    backgroundColor: COLORS.white, marginHorizontal: 16, marginTop: 12,
    borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: COLORS.gray500, textTransform: 'uppercase', marginBottom: 12 },

  // No answer key
  noKeyWarning: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.amber50, borderRadius: 8, padding: 12, marginBottom: 12,
  },
  noKeyText: { fontSize: 14, color: COLORS.amber700, flex: 1 },
  setupBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.background,
  },
  setupBtnIcon: { fontSize: 24 },
  setupBtnLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  setupBtnSub: { fontSize: 12, color: COLORS.gray500, marginTop: 1 },

  // Answer key card
  keyHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
  },
  keyMeta: { fontSize: 13, color: COLORS.gray500, marginTop: 2 },
  keyHeaderRight: { flexDirection: 'row', alignItems: 'center' },
  regenerateLink: { fontSize: 13, color: COLORS.teal500, fontWeight: '600' },
  keyQuestions: { marginTop: 12 },
  keyQuestion: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.background,
  },
  keyQNum: { fontSize: 12, fontWeight: '700', color: COLORS.teal500, minWidth: 28 },
  keyQAnswer: { flex: 1, fontSize: 13, color: COLORS.text },
  keyQMarks: { fontSize: 12, color: COLORS.gray500, minWidth: 30, textAlign: 'right' },

  // Counts row
  countsRow: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 12, gap: 10,
  },
  countCard: {
    flex: 1, backgroundColor: COLORS.white, borderRadius: 10,
    padding: 12, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  countNum: { fontSize: 22, fontWeight: 'bold', color: COLORS.teal500 },
  countLabel: { fontSize: 11, color: COLORS.gray500, marginTop: 2 },

  // Submission cards
  submCard: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.background,
    gap: 10,
  },
  submCardLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  thumbContainer: { flexShrink: 0 },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: COLORS.gray50 },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  submInfo: { flex: 1 },
  submName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  submMeta: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  submScore: { fontSize: 13, fontWeight: '700', color: COLORS.teal500, marginTop: 3 },
  submCardRight: { alignItems: 'flex-end', gap: 6, flexShrink: 0 },
  submActions: { flexDirection: 'row', gap: 6, marginTop: 4 },
  approveBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, minWidth: 68, alignItems: 'center',
  },
  approveBtnText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  overrideBtn: {
    borderWidth: 1, borderColor: COLORS.teal500, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center',
  },
  overrideBtnText: { color: COLORS.teal500, fontSize: 12, fontWeight: '700' },

  emptyText: { fontSize: 14, color: COLORS.gray500, textAlign: 'center', paddingVertical: 20 },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.white,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 28,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8,
    shadowOffset: { width: 0, height: -3 }, elevation: 8,
  },
  actionBtn: { borderRadius: 14, padding: 16, alignItems: 'center' },
  actionBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 17 },
  actionBtnSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  closeBtn: { backgroundColor: COLORS.amber500 },
  gradeAllBtn: { backgroundColor: COLORS.teal500 },
  btnDisabled: { opacity: 0.5 },

  // Grading progress bar
  gradingBarWrapper: { paddingVertical: 4 },
  gradingBarLabel: { fontSize: 15, fontWeight: '700', color: '#2471A3', marginBottom: 8 },
  progressTrack: {
    height: 8, backgroundColor: COLORS.gray200, borderRadius: 4, overflow: 'hidden',
  },
  progressFill: { height: 8, backgroundColor: '#3498DB', borderRadius: 4 },
  gradingBarSub: { fontSize: 12, color: COLORS.gray500, marginTop: 6 },

  // Complete bar
  completeBar: { gap: 10 },
  approveAllBtn: { backgroundColor: COLORS.teal500, borderRadius: 14, padding: 16, alignItems: 'center' },
  reviewLink: { alignItems: 'center', paddingVertical: 4 },
  reviewLinkText: { color: COLORS.teal500, fontSize: 14, fontWeight: '600' },

  // Offline / cached data
  cachedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.amber50,
    paddingHorizontal: 16, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: '#FDEBD0',
  },
  cachedBannerText: { fontSize: 12, color: COLORS.amber700, flex: 1 },
  offlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.amber50,
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: COLORS.amber100,
    marginTop: 4, alignSelf: 'flex-end',
  },
  offlineBadgeText: { fontSize: 10, color: COLORS.amber700, fontWeight: '600' },
  gradeOfflineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.amber50,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: COLORS.amber300,
    marginTop: 6, alignSelf: 'flex-end',
  },
  gradeOfflineBtnText: { fontSize: 11, color: COLORS.amber700, fontWeight: '700' },

  // Image viewer
  viewerContainer: { flex: 1, backgroundColor: '#000' },
  viewerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  viewerClose: { padding: 4 },
  viewerInfo: { flex: 1, paddingHorizontal: 16, alignItems: 'center' },
  viewerName: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  viewerScore: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2 },
  viewerPager: { color: 'rgba(255,255,255,0.6)', fontSize: 13, minWidth: 40, textAlign: 'right' },
  viewerImageContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  viewerImage: { width: SCREEN_W, height: '100%' as any },
  viewerNoImage: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  viewerActions: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 20, paddingVertical: 16, paddingBottom: 32,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  viewerApproveBtn: {
    flex: 1, backgroundColor: COLORS.teal500, borderRadius: 12,
    padding: 14, alignItems: 'center',
  },
  viewerApproveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 15 },
  viewerApprovedBadge: {
    flex: 1, backgroundColor: 'rgba(39,174,96,0.2)', borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.success,
    padding: 14, alignItems: 'center',
  },
  viewerApprovedText: { color: COLORS.success, fontWeight: 'bold', fontSize: 15 },
  viewerOverrideBtn: {
    flex: 1, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  viewerOverrideBtnText: { color: COLORS.white, fontWeight: '600', fontSize: 15 },

  // Override modal
  overlayContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  overrideSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  overrideHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  overrideTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  overrideBody: { padding: 20 },
  overrideStudentName: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  overrideCurrentScore: { fontSize: 14, color: COLORS.gray500, marginBottom: 20 },
  overrideLabel: { fontSize: 14, fontWeight: '600', color: COLORS.gray900, marginBottom: 6, marginTop: 12 },
  overrideLabelOpt: { fontWeight: '400', color: COLORS.gray500 },
  overrideInput: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 14, fontSize: 16, color: COLORS.text,
  },
  overrideFeedback: { height: 80, textAlignVertical: 'top' },
  overrideSaveBtn: {
    marginTop: 24, backgroundColor: COLORS.teal500, borderRadius: 12,
    padding: 16, alignItems: 'center',
  },
  overrideSaveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },

  // AI modal
  aiModal: { flex: 1, backgroundColor: COLORS.white },
  aiModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  aiModalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  aiModalCancel: { fontSize: 16, color: COLORS.teal500, fontWeight: '600' },
  aiModalBody: { flex: 1, padding: 20 },
  aiModalLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  aiModalHint: { fontSize: 13, color: COLORS.gray500, marginBottom: 12 },
  aiTextArea: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 14, fontSize: 15, color: COLORS.text,
    height: 180, marginBottom: 20,
  },
  aiPreviewImage: {
    width: '100%', height: 160, borderRadius: 10, marginBottom: 16,
    backgroundColor: COLORS.gray50,
  },
  aiGenerateBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 10, padding: 16, alignItems: 'center',
  },
  aiGenerateBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
});
