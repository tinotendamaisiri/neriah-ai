// src/screens/MarkingScreen.tsx
// Core teacher marking flow:
//   1. Class is pre-selected (from HomeScreen) or teacher picks one
//   2. Teacher selects a student from the class list
//   3. Teacher selects an answer key
//   4. Camera capture → upload → annotated result

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
} from 'react-native';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { listStudents, listAnswerKeys, submitMark } from '../services/api';
import {
  resolveRoute,
  gradeOnDevice,
  showUnavailableAlert,
  queueMarkingScan,
  type OnDeviceUserContext,
} from '../services/router';
import { showError } from '../utils/showError';
import { retryWithBackoff } from '../utils/retry';
import { useAuth } from '../context/AuthContext';
import { useModel } from '../context/ModelContext';
import { Student, AnswerKey, MarkResult, RootStackParamList, EducationLevel } from '../types';
import ScanButton from '../components/ScanButton';
import MarkResultComponent from '../components/MarkResult';
import { COLORS } from '../constants/colors';

type RouteParams = RootStackParamList['Mark'];

export default function MarkingScreen() {
  const route = useRoute<any>();
  const { user } = useAuth();
  const { suppressNudge } = useModel();

  // Suppress the Wi-Fi download nudge while grading is in progress.
  useEffect(() => {
    suppressNudge(true);
    return () => suppressNudge(false);
  }, [suppressNudge]);

  const routeClassId: string | undefined = route.params?.class_id;
  const routeClassName: string | undefined = route.params?.class_name;
  const routeEdLevel: EducationLevel | undefined = route.params?.education_level;
  const routeAnswerKeyId: string | undefined = route.params?.answer_key_id;

  const [students, setStudents] = useState<Student[]>([]);
  const [answerKeys, setAnswerKeys] = useState<AnswerKey[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedAnswerKey, setSelectedAnswerKey] = useState<AnswerKey | null>(null);
  const [result, setResult] = useState<MarkResult | null>(null);
  const [marking, setMarking] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  // Modal state for pickers
  const [studentPickerVisible, setStudentPickerVisible] = useState(false);
  const [answerKeyPickerVisible, setAnswerKeyPickerVisible] = useState(false);
  const [questionsModalVisible, setQuestionsModalVisible] = useState(false);
  const [validationError, setValidationError] = useState('');

  const classId = routeClassId;
  const className = routeClassName ?? 'Select class';
  const educationLevel = routeEdLevel ?? 'grade_7';

  // Load students + answer keys when class changes
  useFocusEffect(
    useCallback(() => {
      if (!classId) return;
      setSelectedStudent(null);
      setSelectedAnswerKey(null);
      setResult(null);
      loadClassData(classId);
    }, [classId]),
  );

  const loadClassData = async (cid: string) => {
    setLoadingData(true);
    try {
      const [studs, keys] = await Promise.all([
        listStudents(cid),
        listAnswerKeys(cid),
      ]);
      setStudents(studs);
      setAnswerKeys(keys);
      // Pre-select answer key if navigated from HomeworkDetail
      if (routeAnswerKeyId) {
        const preSelected = (keys ?? []).find(k => k.id === routeAnswerKeyId) ?? null;
        if (preSelected) setSelectedAnswerKey(preSelected);
      }
    } catch {
      Alert.alert('Error', 'Failed to load class data.');
    } finally {
      setLoadingData(false);
    }
  };

  const handleCapture = async (imageUri: string) => {
    if (!classId) {
      Alert.alert('Select class', 'Go to the Home tab and tap a class first.');
      return;
    }
    if (!selectedStudent) {
      Alert.alert('Select student', 'Please select a student before scanning.');
      return;
    }
    if (!selectedAnswerKey) {
      Alert.alert('Select answer key', 'Please select an answer key before scanning.');
      return;
    }
    if (!user) return;

    const scanPayload = {
      image_uri: imageUri,
      teacher_id: user.id,
      student_id: selectedStudent.id,
      class_id: classId,
      answer_key_id: selectedAnswerKey.id,
      education_level: educationLevel,
    };

    const route = await resolveRoute('grading');

    if (route === 'unavailable') {
      showUnavailableAlert(() => {
        queueMarkingScan(scanPayload).catch(() => {});
      });
      return;
    }

    setMarking(true);
    try {
      let markResult: MarkResult;

      if (route === 'on-device') {
        // On-device grading is text-only — requires pre-extracted student answers.
        // The on-device path is wired here for when LiteRT is linked and the E4B
        // model is loaded. Falls through to cloud if the model throws (e.g. stub).
        const questions = selectedAnswerKey.questions.map(q => ({
          number: q.number,
          correct_answer: q.correct_answer,
          max_marks: q.max_marks,
          marking_notes: q.marking_notes,
        }));
        // Serialize available profile context so LiteRT gets curriculum-aware prompts.
        const onDeviceCtx: OnDeviceUserContext = {
          education_level: educationLevel,
          subject: selectedAnswerKey.subject ?? undefined,
          // country/curriculum come from the teacher's school — not cached locally,
          // so omit them here; the cloud path injects full RAG context instead.
        };
        const raw = await gradeOnDevice(questions, '', educationLevel, onDeviceCtx);
        markResult = JSON.parse(raw) as MarkResult;
      } else {
        // Cloud path — full multimodal pipeline via Vertex Gemma 4.
        markResult = await retryWithBackoff(() => submitMark(scanPayload));
      }

      setResult(markResult);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showError(err);
    } finally {
      setMarking(false);
    }
  };

  const handleNextStudent = () => {
    // Advance to next student in the sorted list
    if (selectedStudent && students.length > 0) {
      const idx = students.findIndex((s) => s.id === selectedStudent.id);
      const next = students[idx + 1] ?? null;
      setSelectedStudent(next);
    }
    setResult(null);
  };

  if (result && selectedStudent) {
    return (
      <View style={styles.container}>
        <MarkResultComponent result={result} student={selectedStudent} />
        <TouchableOpacity style={styles.nextButton} onPress={handleNextStudent}>
          <Text style={styles.nextButtonText}>Next Student</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!classId ? (
        <View style={styles.noClass}>
          <Text style={styles.noClassText}>
            Go to the Home tab and tap a class to start marking.
          </Text>
        </View>
      ) : loadingData ? (
        <ActivityIndicator style={styles.centre} size="large" color={COLORS.teal500} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* 1. QUESTIONS (top — teacher reviews questions first) */}
          <TouchableOpacity
            style={styles.selector}
            onPress={() => selectedAnswerKey ? setQuestionsModalVisible(true) : setAnswerKeyPickerVisible(true)}
          >
            <Text style={styles.selectorLabel}>Questions</Text>
            <Text style={styles.selectorValue}>
              {selectedAnswerKey
                ? `${selectedAnswerKey.questions?.length ?? 0} questions · ${selectedAnswerKey.total_marks ?? 0} marks`
                : 'Select answer key to view'}
            </Text>
            {selectedAnswerKey && (
              <Text style={{ fontSize: 12, color: COLORS.teal500, fontWeight: '600', marginTop: 4 }}>Tap to view questions →</Text>
            )}
          </TouchableOpacity>

          {/* 2. STUDENT (select who you're marking) */}
          <TouchableOpacity
            style={[styles.selector, !selectedStudent && styles.selectorRequired]}
            onPress={() => { setValidationError(''); setStudentPickerVisible(true); }}
          >
            <Text style={styles.selectorLabel}>Student</Text>
            <Text style={styles.selectorValue}>
              {selectedStudent
                ? `${selectedStudent.first_name} ${selectedStudent.surname}`
                : 'Select student'}
            </Text>
          </TouchableOpacity>

          {/* 3. ANSWER KEY (marking scheme) */}
          <TouchableOpacity
            style={[styles.selector, !selectedAnswerKey && styles.selectorRequired]}
            onPress={() => setAnswerKeyPickerVisible(true)}
          >
            <Text style={styles.selectorLabel}>Answer Key</Text>
            <Text style={styles.selectorValue}>
              {selectedAnswerKey
                ? selectedAnswerKey.title ?? selectedAnswerKey.subject
                : 'Select answer key'}
            </Text>
          </TouchableOpacity>

          {/* Validation error */}
          {validationError ? (
            <View style={{ marginHorizontal: 20, marginTop: 8, backgroundColor: '#FEF2F2', borderRadius: 8, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="alert-circle" size={18} color={COLORS.error} />
              <Text style={{ color: COLORS.error, fontSize: 13, fontWeight: '500', flex: 1 }}>{validationError}</Text>
            </View>
          ) : null}

          {/* Capture button */}
          {marking ? (
            <View style={styles.centre}>
              <ActivityIndicator size="large" color={COLORS.teal500} />
              <Text style={styles.markingText}>Marking...</Text>
            </View>
          ) : (
            <ScanButton
              onCapture={handleCapture}
              disabled={!selectedStudent || !selectedAnswerKey}
              label="Capture Homework"
              onDisabledPress={() => {
                if (!selectedStudent) setValidationError('Please select a student first');
                else if (!selectedAnswerKey) setValidationError('Please select an answer key first');
              }}
            />
          )}
        </ScrollView>
      )}

      {/* Student picker modal */}
      <PickerModal
        visible={studentPickerVisible}
        title="Select Student"
        onClose={() => setStudentPickerVisible(false)}
        items={students.map((s) => ({
          id: s.id,
          label: `${s.first_name} ${s.surname}`,
          sublabel: s.register_number ? `#${s.register_number}` : undefined,
        }))}
        onSelect={(id) => {
          setSelectedStudent(students.find((s) => s.id === id) ?? null);
          setStudentPickerVisible(false);
        }}
      />

      {/* Answer key picker modal */}
      <PickerModal
        visible={answerKeyPickerVisible}
        title="Select Answer Key"
        onClose={() => setAnswerKeyPickerVisible(false)}
        items={answerKeys.map((ak) => ({
          id: ak.id,
          label: ak.title ?? ak.subject,
          sublabel: ak.total_marks != null ? `${ak.total_marks} marks` : undefined,
        }))}
        onSelect={(id) => {
          setSelectedAnswerKey(answerKeys.find((ak) => ak.id === id) ?? null);
          setAnswerKeyPickerVisible(false);
        }}
      />

      {/* Questions modal */}
      <Modal visible={questionsModalVisible} animationType="slide" onRequestClose={() => setQuestionsModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: COLORS.white }}>
          <View style={[modal.header, { paddingTop: 56 }]}>
            <Text style={modal.title}>Questions</Text>
            <TouchableOpacity onPress={() => setQuestionsModalVisible(false)}>
              <Text style={modal.close}>✕</Text>
            </TouchableOpacity>
          </View>
          {selectedAnswerKey?.question_paper_text ? (
            <ScrollView style={{ padding: 20 }}>
              <Text style={{ fontSize: 15, color: COLORS.text, lineHeight: 22 }}>{selectedAnswerKey.question_paper_text}</Text>
            </ScrollView>
          ) : (selectedAnswerKey?.questions ?? []).length > 0 ? (
            <FlatList
              data={selectedAnswerKey?.questions ?? []}
              keyExtractor={(_, i) => String(i)}
              contentContainerStyle={{ padding: 20 }}
              renderItem={({ item: q }) => (
                <View style={{ marginBottom: 14, borderBottomWidth: 1, borderBottomColor: COLORS.background, paddingBottom: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>Q{q.question_number ?? q.number}: {q.question_text ?? ''}</Text>
                  <Text style={{ fontSize: 13, color: COLORS.gray500, marginTop: 4 }}>Answer: {q.answer ?? q.correct_answer ?? ''}</Text>
                  <Text style={{ fontSize: 12, color: COLORS.teal500, marginTop: 2 }}>{q.marks ?? q.max_marks ?? 0} marks</Text>
                </View>
              )}
            />
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
              <Ionicons name="document-text-outline" size={48} color={COLORS.gray200} />
              <Text style={{ fontSize: 16, fontWeight: '600', color: COLORS.text, marginTop: 12 }}>No question paper</Text>
              <Text style={{ fontSize: 13, color: COLORS.gray500, marginTop: 4, textAlign: 'center' }}>The question paper hasn't been uploaded yet.</Text>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

// ── Picker modal ──────────────────────────────────────────────────────────────

interface PickerItem {
  id: string;
  label: string;
  sublabel?: string;
}

function PickerModal({
  visible, title, items, onSelect, onClose,
}: {
  visible: boolean;
  title: string;
  items: PickerItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={modal.overlay}>
        <View style={modal.sheet}>
          <View style={modal.header}>
            <Text style={modal.title}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={modal.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={modal.item} onPress={() => onSelect(item.id)}>
                <Text style={modal.itemLabel}>{item.label}</Text>
                {item.sublabel && <Text style={modal.itemSub}>{item.sublabel}</Text>}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={modal.empty}>Nothing here yet.</Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header: {
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.white,
  },
  heading: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  subheading: { fontSize: 13, color: COLORS.gray500, marginTop: 2 },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noClass: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  noClassText: { textAlign: 'center', fontSize: 15, color: COLORS.gray500, lineHeight: 22 },
  selector: {
    marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: COLORS.gray200,
    borderRadius: 10, padding: 14,
  },
  selectorRequired: { borderColor: COLORS.amber100, backgroundColor: COLORS.amber50 },
  selectorLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: '600', textTransform: 'uppercase', marginBottom: 2 },
  selectorValue: { fontSize: 15, color: COLORS.text },
  markingText: { marginTop: 12, fontSize: 16, color: COLORS.gray500 },
  captureBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: COLORS.teal500, marginHorizontal: 20, marginTop: 20,
    borderRadius: 12, paddingVertical: 16,
  },
  captureBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  nextButton: {
    backgroundColor: COLORS.teal500, margin: 16, borderRadius: 10,
    padding: 16, alignItems: 'center',
  },
  nextButtonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
});

const modal = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: 17, fontWeight: '600', color: COLORS.text },
  close: { fontSize: 20, color: COLORS.gray500 },
  item: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.background },
  itemLabel: { fontSize: 16, color: COLORS.text },
  itemSub: { fontSize: 13, color: COLORS.textLight, marginTop: 2 },
  empty: { padding: 24, textAlign: 'center', color: COLORS.textLight },
});
