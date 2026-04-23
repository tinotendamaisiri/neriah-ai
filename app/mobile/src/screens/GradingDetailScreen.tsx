// src/screens/GradingDetailScreen.tsx
// Teacher detail view for a single student mark.
// Shows per-question verdicts with editable marks and per-question comments,
// plus an overall feedback field. Teacher saves edits and optionally approves.

import React, { useCallback, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { getMarkById, updateMark, deleteMark } from '../services/api';
import { GradingVerdict } from '../types';
import { COLORS } from '../constants/colors';

interface EditableVerdict {
  question_number: number;
  verdict: string;
  awarded_marks: string; // string so TextInput stays controlled
  max_marks: number;
  feedback: string;
}

function verdictColor(v: string): string {
  if (v === 'correct') return COLORS.success;
  if (v === 'partial') return COLORS.warning;
  return COLORS.error;
}

function verdictIcon(v: string): string {
  if (v === 'correct') return '✓';
  if (v === 'partial') return '~';
  return '✗';
}

export default function GradingDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { mark_id, student_name, class_name, answer_key_title } = route.params as {
    mark_id: string;
    student_name: string;
    class_name: string;
    answer_key_title: string;
  };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasVerdicts, setHasVerdicts] = useState(false);
  const [verdicts, setVerdicts] = useState<EditableVerdict[]>([]);
  const [totalScore, setTotalScore] = useState('');
  const [totalMax, setTotalMax] = useState('');
  const [overallFeedback, setOverallFeedback] = useState('');
  const [approved, setApproved] = useState(false);
  const [manuallyEdited, setManuallyEdited] = useState(false);

  const loadMark = useCallback(async () => {
    setLoading(true);
    try {
      const mark = await getMarkById(mark_id);
      const rawVerdicts: GradingVerdict[] = mark.verdicts ?? [];
      if (rawVerdicts.length > 0) {
        setHasVerdicts(true);
        setVerdicts(rawVerdicts.map(v => ({
          question_number: v.question_number,
          verdict: v.verdict,
          awarded_marks: String(v.awarded_marks),
          max_marks: v.max_marks,
          feedback: v.feedback ?? '',
        })));
      } else {
        setHasVerdicts(false);
        setTotalScore(String(mark.score ?? 0));
        setTotalMax(String(mark.max_score ?? 0));
      }
      setOverallFeedback(mark.feedback ?? '');
      setApproved(mark.approved ?? false);
      setManuallyEdited(mark.manually_edited ?? false);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not load mark details.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [mark_id]);

  useFocusEffect(
    useCallback(() => { loadMark(); }, [loadMark]),
  );

  const updateVerdictField = (qNum: number, field: 'awarded_marks' | 'feedback', value: string) => {
    setVerdicts(prev =>
      prev.map(v => v.question_number === qNum ? { ...v, [field]: value } : v)
    );
  };

  const handleSave = async (shouldApprove = false) => {
    setSaving(true);
    try {
      const payload: Parameters<typeof updateMark>[1] = {
        overall_feedback: overallFeedback || undefined,
        manually_edited: true,
      };

      if (hasVerdicts) {
        const parsed = (verdicts ?? []).map(v => ({
          question_number: v.question_number,
          verdict: v.verdict,
          awarded_marks: parseFloat(v.awarded_marks) || 0,
          max_marks: v.max_marks,
          feedback: v.feedback || undefined,
        }));
        payload.verdicts = parsed;
        // score/max_score recomputed server-side from verdicts
      } else {
        payload.score = parseFloat(totalScore) || 0;
        payload.max_score = parseFloat(totalMax) || 0;
      }

      if (shouldApprove) {
        payload.approved = true;
      }

      await updateMark(mark_id, payload);
      Alert.alert(
        shouldApprove ? 'Approved' : 'Saved',
        shouldApprove
          ? 'Mark saved and released to the student.'
          : 'Changes saved.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  // Delete pattern mirrors MarkResult.tsx and GradingResultsScreen.tsx so
  // teachers see the same confirm copy across every surface that can
  // trigger a cascade delete.
  const handleDelete = () => {
    if (!mark_id) {
      Alert.alert('Cannot delete', 'This mark has no server ID.');
      return;
    }
    Alert.alert(
      'Delete submission?',
      `This will permanently delete ${student_name}'s submission for ${answer_key_title}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await deleteMark(mark_id);
              Alert.alert(
                'Deleted',
                'Submission deleted.',
                [{ text: 'OK', onPress: () => navigation.goBack() }],
              );
            } catch (err: any) {
              Alert.alert('Could not delete', err.message ?? 'Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={COLORS.teal500} />
      </View>
    );
  }

  return (
    <ScreenContainer scroll={false} edges={['top', 'left', 'right']} keyboardVerticalOffset={80}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← {class_name}</Text>
          </TouchableOpacity>
          <View style={styles.titleRow}>
            <View style={styles.titleLeft}>
              <Text style={styles.studentName}>{student_name}</Text>
              <Text style={styles.homeworkTitle}>{answer_key_title}</Text>
            </View>
            {approved && (
              <View style={styles.approvedBadge}>
                <Text style={styles.approvedBadgeText}>Approved</Text>
              </View>
            )}
          </View>
          {manuallyEdited && (
            <View style={styles.editedHintRow}>
              <Ionicons name="pencil-outline" size={12} color={COLORS.amber500} />
              <Text style={styles.editedHint}> Teacher-edited</Text>
            </View>
          )}
        </View>

        {/* Per-question section */}
        {hasVerdicts ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Question Breakdown</Text>
            {(verdicts ?? []).map(v => (
              <View key={v.question_number} style={styles.verdictCard}>
                <View style={styles.verdictTop}>
                  <View style={[styles.iconCircle, { backgroundColor: verdictColor(v.verdict) }]}>
                    <Text style={styles.iconText}>{verdictIcon(v.verdict)}</Text>
                  </View>
                  <Text style={styles.qNum}>Q{v.question_number}</Text>
                  <View style={styles.marksRow}>
                    <TextInput
                      style={styles.marksInput}
                      value={v.awarded_marks}
                      onChangeText={val => updateVerdictField(v.question_number, 'awarded_marks', val)}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                    <Text style={styles.marksDivider}> / {v.max_marks}</Text>
                  </View>
                </View>
                <TextInput
                  style={[styles.commentInput, !v.feedback && styles.commentEmpty]}
                  value={v.feedback}
                  onChangeText={val => updateVerdictField(v.question_number, 'feedback', val)}
                  placeholder="Add comment..."
                  placeholderTextColor={COLORS.gray500}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Score</Text>
            <Text style={styles.sectionHint}>No auto-grading data. Enter the score manually.</Text>
            <View style={styles.manualScoreRow}>
              <View style={styles.manualField}>
                <Text style={styles.manualLabel}>Awarded</Text>
                <TextInput
                  style={styles.manualInput}
                  value={totalScore}
                  onChangeText={setTotalScore}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
              </View>
              <Text style={styles.manualSep}>/</Text>
              <View style={styles.manualField}>
                <Text style={styles.manualLabel}>Out of</Text>
                <TextInput
                  style={styles.manualInput}
                  value={totalMax}
                  onChangeText={setTotalMax}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
              </View>
            </View>
          </View>
        )}

        {/* Overall feedback */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Overall Feedback</Text>
          <TextInput
            style={styles.overallInput}
            value={overallFeedback}
            onChangeText={setOverallFeedback}
            placeholder="Add overall feedback for this student..."
            placeholderTextColor={COLORS.gray500}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.btnDisabled]}
            onPress={() => handleSave(false)}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color={COLORS.white} size="small" />
              : <Text style={styles.saveBtnText}>Save Changes</Text>
            }
          </TouchableOpacity>
          {!approved && (
            <TouchableOpacity
              style={[styles.approveBtn, saving && styles.btnDisabled]}
              onPress={() => handleSave(true)}
              disabled={saving}
            >
              <Text style={styles.approveBtnText}>Save & Approve ✓</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.deleteLink, saving && styles.btnDisabled]}
            onPress={handleDelete}
            disabled={saving}
            accessibilityLabel="Delete submission"
          >
            <Text style={styles.deleteLinkText}>Delete submission</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  content: { paddingBottom: 24 },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    backgroundColor: COLORS.white, paddingHorizontal: 20,
    paddingTop: 56, paddingBottom: 20,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backText: { fontSize: 14, color: COLORS.teal500, marginBottom: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  titleLeft: { flex: 1 },
  studentName: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  homeworkTitle: { fontSize: 14, color: COLORS.gray500, marginTop: 3 },
  approvedBadge: {
    backgroundColor: COLORS.teal50, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4, marginLeft: 10,
  },
  approvedBadgeText: { fontSize: 12, color: COLORS.teal500, fontWeight: '700' },
  editedHintRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  editedHint: { fontSize: 12, color: COLORS.amber500 },

  section: {
    backgroundColor: COLORS.white, marginHorizontal: 16, marginTop: 16,
    borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: COLORS.gray500,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12,
  },
  sectionHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 12 },

  verdictCard: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    padding: 12, marginBottom: 10,
  },
  verdictTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  iconCircle: {
    width: 28, height: 28, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  iconText: { color: COLORS.white, fontSize: 13, fontWeight: '900' },
  qNum: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginLeft: 8, flex: 1 },
  marksRow: { flexDirection: 'row', alignItems: 'center' },
  marksInput: {
    borderWidth: 1, borderColor: COLORS.teal300, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    fontSize: 15, fontWeight: '700', color: COLORS.teal500,
    minWidth: 44, textAlign: 'center',
  },
  marksDivider: { fontSize: 14, color: COLORS.gray500, marginLeft: 2 },
  commentInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, color: COLORS.text, minHeight: 40,
  },
  commentEmpty: { borderStyle: 'dashed', borderColor: COLORS.gray200 },

  manualScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  manualField: { alignItems: 'center', gap: 6 },
  manualLabel: { fontSize: 12, color: COLORS.gray500, fontWeight: '600', textTransform: 'uppercase' },
  manualInput: {
    borderWidth: 1, borderColor: COLORS.teal300, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 22, fontWeight: 'bold', color: COLORS.teal500,
    minWidth: 80, textAlign: 'center',
  },
  manualSep: { fontSize: 28, color: COLORS.gray500, fontWeight: '300', marginTop: 18 },

  overallInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: COLORS.text, minHeight: 100,
  },

  actions: { marginHorizontal: 16, marginTop: 20, gap: 10 },
  saveBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  saveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  approveBtn: {
    backgroundColor: COLORS.white, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
    borderWidth: 2, borderColor: COLORS.teal500,
  },
  approveBtnText: { color: COLORS.teal500, fontWeight: 'bold', fontSize: 16 },
  deleteLink: {
    alignSelf: 'center', paddingVertical: 12, marginTop: 4,
  },
  deleteLinkText: { color: COLORS.error, fontSize: 12, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
});
