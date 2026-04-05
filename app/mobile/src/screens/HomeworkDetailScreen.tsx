// src/screens/HomeworkDetailScreen.tsx
// View and manage a single homework assignment (answer key).

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  Image,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import {
  listAnswerKeys,
  updateAnswerKey,
  uploadAnswerKeyFile,
  getTeacherSubmissions,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { pickFile } from '../utils/filePicker';
import { AnswerKey, TeacherSubmission } from '../types';
import { COLORS } from '../constants/colors';

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

const LEVEL_LABELS: Record<string, string> = {
  grade_1: 'Grade 1', grade_2: 'Grade 2', grade_3: 'Grade 3',
  grade_4: 'Grade 4', grade_5: 'Grade 5', grade_6: 'Grade 6', grade_7: 'Grade 7',
  form_1: 'Form 1', form_2: 'Form 2', form_3: 'Form 3', form_4: 'Form 4',
  form_5: 'Form 5 (A-Level)', form_6: 'Form 6 (A-Level)',
  tertiary: 'College/University',
};

function levelLabel(level?: string | null): string {
  if (!level) return '';
  return LEVEL_LABELS[level] ?? level;
}

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

  const [answerKey, setAnswerKey] = useState<AnswerKey | null>(null);
  const [submissions, setSubmissions] = useState<TeacherSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingOpen, setTogglingOpen] = useState(false);

  // Rename state (for pending_setup / Unlabeled homework)
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  // Generate-with-AI modal state
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [qpText, setQpText] = useState('');
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [keysResult, subsResult] = await Promise.allSettled([
        listAnswerKeys(class_id),
        getTeacherSubmissions({ class_id, teacher_id: user?.id }),
      ]);

      if (keysResult.status === 'rejected') {
        console.error('[HomeworkDetail] listAnswerKeys failed:', keysResult.reason);
        Alert.alert(t('error'), 'Could not load homework details.');
        return;
      }

      const ak = keysResult.value.find(k => k.id === answer_key_id) ?? null;
      setAnswerKey(ak);

      if (subsResult.status === 'fulfilled') {
        setSubmissions(subsResult.value.filter(s => s.answer_key_id === answer_key_id));
      } else {
        console.error('[HomeworkDetail] getTeacherSubmissions failed:', subsResult.reason);
      }
    } finally {
      setLoading(false);
    }
  }, [answer_key_id, class_id, user?.id, t]);

  useFocusEffect(
    useCallback(() => { loadData(); }, [loadData]),
  );

  const handleToggleOpen = async () => {
    if (!answerKey) return;
    setTogglingOpen(true);
    try {
      const updated = await updateAnswerKey(answerKey.id, {
        open_for_submission: !answerKey.open_for_submission,
      });
      setAnswerKey(updated);
    } catch (err: any) {
      Alert.alert(t('error'), err.message ?? 'Could not update assignment.');
    } finally {
      setTogglingOpen(false);
    }
  };

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
      // Image: show in preview + open text modal
      setLocalImageUri(file.uri);
      setAiModalVisible(true);
    } else {
      // PDF / Word: send to backend for extraction
      if (!answerKey) return;
      setGenerating(true);
      try {
        const updated = await uploadAnswerKeyFile(
          answerKey.id,
          file.uri,
          file.name,
          file.mimeType,
        );
        setAnswerKey(updated);
        Alert.alert('Done', `Generated ${updated.questions.length} questions from your file.`);
      } catch (err: any) {
        Alert.alert(t('error'), err.message ?? 'Could not generate marking scheme. Please try again.');
      } finally {
        setGenerating(false);
      }
    }
  };

  const handleGenerate = async () => {
    if (!qpText.trim()) {
      Alert.alert(t('error'), 'Question paper text is required.');
      return;
    }
    if (!answerKey) return;
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
      Alert.alert('Done', `Generated ${updated.questions.length} questions from your marking scheme.`);
    } catch (err: any) {
      Alert.alert(t('error'), err.message ?? 'Could not generate marking scheme. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCloseModal = () => {
    setAiModalVisible(false);
    setQpText('');
    setLocalImageUri(null);
  };

  const handleMarkStudents = () => {
    if (!answerKey) return;
    navigation.navigate('Mark', {
      class_id,
      class_name,
      education_level: answerKey.education_level ?? 'grade_7',
      answer_key_id: answerKey.id,
    });
  };

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
        <Text style={styles.notFound}>{t('homework_not_found')}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>{t('back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isPendingSetup = answerKey.status === 'pending_setup';
  const hasQuestions = answerKey.questions.length > 0;
  const pendingCount = submissions.filter(s => s.status === 'pending').length;
  const gradedCount = submissions.filter(s => s.status === 'graded').length;

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← {class_name}</Text>
          </TouchableOpacity>

          {/* Rename row — shown for Unlabeled/pending_setup homework */}
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
                style={[styles.saveBtn, savingTitle && styles.saveBtnDisabled]}
                onPress={handleSaveTitle}
                disabled={savingTitle}
              >
                {savingTitle
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : <Text style={styles.saveBtnText}>{t('save')}</Text>
                }
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.headingRow}>
              <Text style={styles.heading}>{answerKey.title ?? answerKey.subject}</Text>
              {isPendingSetup && (
                <TouchableOpacity
                  onPress={() => { setTitleDraft(answerKey.title ?? ''); setEditingTitle(true); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.renameLink}>{t('rename_homework')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {answerKey.title && (
            <Text style={styles.subjectTag}>{answerKey.subject}</Text>
          )}
        </View>

        {/* Key info row */}
        <View style={styles.infoCard}>
          <InfoRow label={t('created')} value={fmtDate(answerKey.created_at)} />
          {answerKey.due_date && <InfoRow label={t('due_date')} value={fmtDate(answerKey.due_date)} />}
          {answerKey.education_level && (
            <InfoRow label="Level" value={levelLabel(answerKey.education_level)} />
          )}
          <InfoRow label="Questions" value={String(answerKey.questions.length)} />
          {answerKey.total_marks != null && (
            <InfoRow label="Total marks" value={String(answerKey.total_marks)} />
          )}
          <InfoRow label="AI generated" value={answerKey.generated ? 'Yes' : 'No'} />
        </View>

        {/* Setup section — shown when no questions yet */}
        {!hasQuestions && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('set_up_marking_scheme')}</Text>
            <Text style={styles.sectionHint}>{t('marking_scheme_hint')}</Text>
            <TouchableOpacity style={styles.setupBtn} onPress={handlePickFile}>
              <Text style={styles.setupBtnIcon}>📄</Text>
              <View style={styles.setupBtnText}>
                <Text style={styles.setupBtnLabel}>{t('upload_question_paper_photo')}</Text>
                <Text style={styles.setupBtnSub}>{t('upload_question_paper_sub')}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.setupBtn} onPress={() => setAiModalVisible(true)}>
              <Text style={styles.setupBtnIcon}>✨</Text>
              <View style={styles.setupBtnText}>
                <Text style={styles.setupBtnLabel}>{t('generate_with_ai')}</Text>
                <Text style={styles.setupBtnSub}>{t('generate_with_ai_sub')}</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Questions summary — shown when questions exist */}
        {hasQuestions && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t('marking_scheme')}</Text>
              <TouchableOpacity onPress={handlePickFile}>
                <Text style={styles.regenerateLink}>{t('regenerate')}</Text>
              </TouchableOpacity>
            </View>
            {answerKey.questions.slice(0, 5).map(q => (
              <View key={q.number} style={styles.questionRow}>
                <Text style={styles.questionNum}>Q{q.number}</Text>
                <Text style={styles.questionAnswer} numberOfLines={1}>{q.correct_answer}</Text>
                <Text style={styles.questionMarks}>{q.max_marks}mk</Text>
              </View>
            ))}
            {answerKey.questions.length > 5 && (
              <Text style={styles.moreQuestions}>
                + {answerKey.questions.length - 5} more questions
              </Text>
            )}
          </View>
        )}

        {/* Open for submissions toggle */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('submissions')}</Text>
          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.toggleLabel}>{t('open_for_submissions')}</Text>
              <Text style={styles.toggleSub}>
                {answerKey.open_for_submission ? t('submissions_open') : t('submissions_closed')}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.toggle, answerKey.open_for_submission && styles.toggleOn]}
              onPress={handleToggleOpen}
              disabled={togglingOpen || !hasQuestions}
            >
              {togglingOpen
                ? <ActivityIndicator size="small" color={COLORS.white} />
                : <Text style={styles.toggleText}>
                    {answerKey.open_for_submission ? t('open') : t('closed')}
                  </Text>
              }
            </TouchableOpacity>
          </View>
          {!hasQuestions && (
            <Text style={styles.toggleWarning}>{t('setup_before_open')}</Text>
          )}

          {submissions.length > 0 && (
            <View style={styles.submCountRow}>
              <View style={styles.submCountBadge}>
                <Text style={styles.submCountNum}>{pendingCount}</Text>
                <Text style={styles.submCountLabel}>{t('pending')}</Text>
              </View>
              <View style={styles.submCountBadge}>
                <Text style={styles.submCountNum}>{gradedCount}</Text>
                <Text style={styles.submCountLabel}>{t('graded')}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Student submissions list */}
        {submissions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('student_submissions')}</Text>
            {submissions.map(s => (
              <View key={s.id} style={styles.submissionRow}>
                <View style={styles.submissionLeft}>
                  <Text style={styles.submissionName}>{s.student_name ?? 'Student'}</Text>
                  <Text style={styles.submissionDate}>{fmtDate(s.submitted_at)}</Text>
                </View>
                <View style={[
                  styles.submissionBadge,
                  s.status === 'graded' ? styles.badgeGraded : styles.badgePending,
                ]}>
                  <Text style={[
                    styles.submissionBadgeText,
                    s.status === 'graded' ? styles.badgeGradedText : styles.badgePendingText,
                  ]}>
                    {s.status === 'graded' ? `${s.score ?? 0}/${s.max_score ?? '?'}` : t('pending')}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Spacer for bottom button */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom action button */}
      <View style={styles.bottomBar}>
        {hasQuestions ? (
          <TouchableOpacity
            style={styles.markBtn}
            onPress={handleMarkStudents}
            activeOpacity={0.85}
          >
            <Text style={styles.markBtnText}>📷  {t('mark_students')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.uploadBtn}
            onPress={handlePickFile}
            activeOpacity={0.85}
          >
            <Text style={styles.uploadBtnText}>📄  Set Up Marking Scheme</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Generate with AI modal */}
      <Modal
        visible={aiModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('generate_scheme')}</Text>
            <TouchableOpacity onPress={handleCloseModal} hitSlop={{ top: 8, bottom: 8, left: 16, right: 8 }}>
              <Text style={styles.modalCancel}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {localImageUri && (
              <Image source={{ uri: localImageUri }} style={styles.previewImage} resizeMode="contain" />
            )}

            <Text style={styles.modalLabel}>{t('question_paper_text')}</Text>
            <Text style={styles.modalHint}>{t('question_paper_hint')}</Text>
            <TextInput
              style={styles.modalTextArea}
              placeholder={t('question_paper_placeholder')}
              value={qpText}
              onChangeText={setQpText}
              multiline
              textAlignVertical="top"
              autoFocus
            />

            <TouchableOpacity
              style={[styles.generateBtn, (generating || !qpText.trim()) && styles.generateBtnDisabled]}
              onPress={handleGenerate}
              disabled={generating || !qpText.trim()}
            >
              {generating
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.generateBtnText}>{t('generate_scheme_btn')}</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingBottom: 20 },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  notFound: { fontSize: 16, color: COLORS.gray500, marginBottom: 12 },
  backLink: { fontSize: 16, color: COLORS.teal500 },

  header: {
    backgroundColor: COLORS.white, paddingHorizontal: 20,
    paddingTop: 56, paddingBottom: 20,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backText: { fontSize: 14, color: COLORS.teal500, marginBottom: 10 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 22, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  renameLink: { fontSize: 13, color: COLORS.teal500, fontWeight: '600', marginLeft: 10 },
  subjectTag: { marginTop: 4, fontSize: 13, color: COLORS.gray500 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  renameInput: {
    flex: 1, borderWidth: 1, borderColor: COLORS.teal500, borderRadius: 8,
    padding: 10, fontSize: 16, color: COLORS.text,
  },
  saveBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  saveBtnDisabled: { backgroundColor: COLORS.teal300 },
  saveBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },

  infoCard: {
    backgroundColor: COLORS.white, margin: 16, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.background,
  },
  infoLabel: { fontSize: 14, color: COLORS.gray500 },
  infoValue: { fontSize: 14, fontWeight: '600', color: COLORS.text },

  section: {
    backgroundColor: COLORS.white, marginHorizontal: 16, marginBottom: 12,
    borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.gray500, textTransform: 'uppercase', marginBottom: 12 },
  sectionHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 12 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  regenerateLink: { fontSize: 13, color: COLORS.teal500, fontWeight: '600' },

  setupBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, borderTopWidth: 1, borderTopColor: COLORS.background,
  },
  setupBtnIcon: { fontSize: 26 },
  setupBtnText: { flex: 1 },
  setupBtnLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  setupBtnSub: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },

  questionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.background,
  },
  questionNum: { fontSize: 13, fontWeight: '700', color: COLORS.teal500, minWidth: 28 },
  questionAnswer: { flex: 1, fontSize: 14, color: COLORS.text },
  questionMarks: { fontSize: 12, color: COLORS.gray500, minWidth: 32, textAlign: 'right' },
  moreQuestions: { fontSize: 13, color: COLORS.gray500, marginTop: 8 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  toggleSub: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  toggle: {
    backgroundColor: COLORS.gray200, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8, minWidth: 70, alignItems: 'center',
  },
  toggleOn: { backgroundColor: COLORS.teal500 },
  toggleText: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
  toggleWarning: { fontSize: 12, color: COLORS.amber500, marginTop: 8 },

  submCountRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  submCountBadge: {
    flex: 1, backgroundColor: COLORS.background, borderRadius: 10,
    padding: 12, alignItems: 'center',
  },
  submCountNum: { fontSize: 22, fontWeight: 'bold', color: COLORS.teal500 },
  submCountLabel: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },

  submissionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.background,
  },
  submissionLeft: { flex: 1 },
  submissionName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  submissionDate: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  submissionBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgePending: { backgroundColor: COLORS.amber50 },
  badgeGraded: { backgroundColor: COLORS.teal50 },
  submissionBadgeText: { fontSize: 13, fontWeight: '600' },
  badgePendingText: { color: COLORS.amber700 },
  badgeGradedText: { color: COLORS.teal700 },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.white,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    padding: 16, paddingBottom: 32,
  },
  markBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 12,
    padding: 16, alignItems: 'center',
  },
  markBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  uploadBtn: {
    backgroundColor: COLORS.amber50, borderRadius: 12,
    padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.amber100,
  },
  uploadBtnText: { color: COLORS.amber700, fontWeight: 'bold', fontSize: 16 },

  // Modal
  modal: { flex: 1, backgroundColor: COLORS.white },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  modalCancel: { fontSize: 16, color: COLORS.teal500, fontWeight: '600' },
  modalBody: { flex: 1, padding: 20 },
  modalLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  modalHint: { fontSize: 13, color: COLORS.gray500, marginBottom: 12 },
  modalTextArea: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 14, fontSize: 15, color: COLORS.text, height: 180, marginBottom: 20,
  },
  previewImage: {
    width: '100%', height: 160, borderRadius: 10, marginBottom: 16,
    backgroundColor: COLORS.gray50,
  },
  generateBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 10, padding: 16, alignItems: 'center',
  },
  generateBtnDisabled: { backgroundColor: COLORS.teal300 },
  generateBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
});
