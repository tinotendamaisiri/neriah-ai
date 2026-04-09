// src/screens/GenerateSchemeScreen.tsx
// AI-powered marking scheme generator.
// Teacher photographs a question paper → Gemma 4 reads it and generates a
// structured marking scheme → teacher reviews and edits → saves via POST /api/answer-keys.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import { createAnswerKey, generateMarkingScheme } from '../services/api';
import { COLORS } from '../constants/colors';

// ── Education level options (matches backend _INTENSITY map) ──────────────────

const EDUCATION_LEVELS = [
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
  'Form 1', 'Form 2', 'Form 3', 'Form 4',
  'Form 5 (A-Level)', 'Form 6 (A-Level)',
  'College/University',
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface EditableQuestion {
  number: number;
  question_text: string;
  correct_answer: string;
  max_marks: number;
  marking_notes: string;
}

// ── Question row component ────────────────────────────────────────────────────

function QuestionRow({
  question,
  onUpdate,
  onDelete,
}: {
  question: EditableQuestion;
  onUpdate: (q: EditableQuestion) => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.questionCard}>
      <View style={styles.questionHeader}>
        <View style={styles.questionBadge}>
          <Text style={styles.questionBadgeText}>Q{question.number}</Text>
        </View>
        <TouchableOpacity onPress={onDelete} style={styles.deleteBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="trash-outline" size={17} color={COLORS.error} />
        </TouchableOpacity>
      </View>

      {/* Question text — read-only, shows what Gemma read from the image */}
      {question.question_text ? (
        <Text style={styles.questionTextDisplay}>{question.question_text}</Text>
      ) : null}

      <Text style={styles.fieldLabel}>Correct Answer</Text>
      <TextInput
        style={[styles.questionInput, { minHeight: 42 }]}
        value={question.correct_answer}
        onChangeText={v => onUpdate({ ...question, correct_answer: v })}
        placeholder="Enter correct answer"
        placeholderTextColor={COLORS.gray500}
        multiline
        textAlignVertical="top"
      />

      <View style={styles.marksRow}>
        <Text style={styles.fieldLabel}>Marks</Text>
        <TextInput
          style={[styles.questionInput, styles.marksInput]}
          value={String(question.max_marks)}
          onChangeText={v => {
            const n = parseFloat(v);
            onUpdate({ ...question, max_marks: isNaN(n) ? 0 : n });
          }}
          keyboardType="decimal-pad"
          placeholder="1"
          placeholderTextColor={COLORS.gray500}
        />
      </View>

      <Text style={styles.fieldLabel}>
        Marking Notes <Text style={styles.optional}>(optional)</Text>
      </Text>
      <TextInput
        style={[styles.questionInput, { minHeight: 36 }]}
        value={question.marking_notes}
        onChangeText={v => onUpdate({ ...question, marking_notes: v })}
        placeholder="Acceptable alternatives, partial credit..."
        placeholderTextColor={COLORS.gray500}
        multiline
        textAlignVertical="top"
      />
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function GenerateSchemeScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { class_id, class_name, education_level: prefilledLevel, subject: prefilledSubject } =
    route.params as { class_id: string; class_name: string; education_level?: string; subject?: string };

  // Form state
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [educationLevel, setEducationLevel] = useState(prefilledLevel ?? '');
  const [subject, setSubject] = useState(prefilledSubject ?? '');

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasScheme, setHasScheme] = useState(false);
  const [schemeTitle, setSchemeTitle] = useState('');
  const [questions, setQuestions] = useState<EditableQuestion[]>([]);

  // Pulse animation for loading state
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (generating) {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.25, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    }
    return () => { pulseLoop.current?.stop(); };
  }, [generating]);

  const totalMarks = questions.reduce((sum, q) => sum + (q.max_marks || 0), 0);

  // ── Image picker ────────────────────────────────────────────────────────────

  const showImageOptions = () => {
    Alert.alert('Add Question Paper', undefined, [
      {
        text: 'Take Photo',
        onPress: pickFromCamera,
      },
      {
        text: 'Choose from Gallery',
        onPress: pickFromGallery,
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const pickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow camera access in Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      resetScheme();
    }
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      resetScheme();
    }
  };

  const resetScheme = () => {
    setHasScheme(false);
    setQuestions([]);
    setSchemeTitle('');
  };

  // ── Generation ──────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!imageUri || !educationLevel) return;
    setGenerating(true);
    try {
      const result = await generateMarkingScheme({
        image_uri: imageUri,
        education_level: educationLevel,
        class_id,
        subject: subject.trim() || undefined,
      });
      const scheme = result.scheme;
      if (!scheme.questions || scheme.questions.length === 0) {
        Alert.alert(
          'No questions detected',
          'No questions detected. Please make sure the full question paper is visible in the photo.',
        );
        return;
      }
      setSchemeTitle(scheme.title ?? '');
      setQuestions(
        scheme.questions.map((q, i) => ({
          number: q.number ?? i + 1,
          question_text: q.question_text ?? '',
          correct_answer: q.correct_answer ?? '',
          max_marks: q.max_marks ?? 1,
          marking_notes: q.marking_notes ?? '',
        })),
      );
      setHasScheme(true);
    } catch (err: any) {
      if (err.status === 422) {
        Alert.alert(
          'Could not read the question paper',
          'Please retake the photo with better lighting and try again.',
        );
      } else if (err.isOffline) {
        Alert.alert('No internet connection', 'Please connect and try again.');
      } else {
        Alert.alert('Generation failed', err.message ?? 'Could not generate marking scheme. Please try again.');
      }
    } finally {
      setGenerating(false);
    }
  };

  // ── Question editing ────────────────────────────────────────────────────────

  const updateQuestion = (idx: number, updated: EditableQuestion) => {
    setQuestions(prev => prev.map((q, i) => (i === idx ? updated : q)));
  };

  const deleteQuestion = (idx: number) => {
    setQuestions(prev => {
      const next = prev.filter((_, i) => i !== idx);
      // Renumber
      return next.map((q, i) => ({ ...q, number: i + 1 }));
    });
  };

  const addQuestion = () => {
    setQuestions(prev => [
      ...prev,
      {
        number: prev.length + 1,
        question_text: '',
        correct_answer: '',
        max_marks: 1,
        marking_notes: '',
      },
    ]);
  };

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!hasScheme) return;
    const title = schemeTitle.trim() || 'Generated Marking Scheme';
    setSaving(true);
    try {
      const ak = await createAnswerKey({
        class_id,
        title,
        subject: subject.trim() || undefined,
        education_level: educationLevel,
        generated: true,
        questions: questions.map(q => ({
          number: q.number,
          question_text: q.question_text,
          correct_answer: q.correct_answer,
          max_marks: q.max_marks,
          marking_notes: q.marking_notes || undefined,
        })),
      });
      navigation.replace('HomeworkDetail', {
        answer_key_id: ak.id,
        class_id,
        class_name,
      });
    } catch (err: any) {
      Alert.alert('Could not save', err.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const canGenerate = !!imageUri && !!educationLevel && !generating;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.scroll, hasScheme && { paddingBottom: 104 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.heading}>Generate Marking Scheme</Text>
          <Text style={styles.subheading}>{class_name}</Text>

          {/* ── Image upload ── */}
          <Text style={styles.sectionLabel}>Question Paper Photo <Text style={styles.required}>*</Text></Text>
          {!imageUri ? (
            <TouchableOpacity style={styles.uploadZone} onPress={showImageOptions} activeOpacity={0.75}>
              <Ionicons name="camera-outline" size={36} color={COLORS.teal300} />
              <Text style={styles.uploadTitle}>Photograph your question paper</Text>
              <Text style={styles.uploadSub}>Camera or Gallery</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.imagePreviewContainer}>
              <Image source={{ uri: imageUri }} style={styles.thumbnail} resizeMode="cover" />
              <TouchableOpacity
                style={styles.removeImageBtn}
                onPress={() => { setImageUri(null); resetScheme(); }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <View style={styles.removeImageCircle}>
                  <Ionicons name="close" size={16} color={COLORS.white} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.retakeBtn} onPress={showImageOptions}>
                <Text style={styles.retakeBtnText}>Retake</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Education level ── */}
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
            Education Level <Text style={styles.required}>*</Text>
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
            {EDUCATION_LEVELS.map(level => (
              <TouchableOpacity
                key={level}
                style={[styles.chip, educationLevel === level && styles.chipSelected]}
                onPress={() => setEducationLevel(level)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, educationLevel === level && styles.chipTextSelected]}>
                  {level}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Subject ── */}
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
            Subject <Text style={styles.optional}>(optional)</Text>
          </Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Mathematics, English, Science"
            placeholderTextColor={COLORS.gray500}
            value={subject}
            onChangeText={setSubject}
            autoCapitalize="words"
          />

          {/* ── Generate button ── */}
          <TouchableOpacity
            style={[styles.generateBtn, !canGenerate && styles.generateBtnDisabled]}
            onPress={handleGenerate}
            disabled={!canGenerate}
            activeOpacity={0.85}
          >
            {generating ? (
              <Animated.Text style={[styles.generateBtnText, { opacity: pulseAnim }]}>
                Gemma 4 is reading your question paper...
              </Animated.Text>
            ) : (
              <Text style={styles.generateBtnText}>Generate Marking Scheme</Text>
            )}
          </TouchableOpacity>

          {/* ── Generated scheme preview ── */}
          {hasScheme && (
            <>
              <View style={styles.schemeDivider}>
                <View style={styles.schemeDividerLine} />
                <Text style={styles.schemeDividerText}>Generated Scheme</Text>
                <View style={styles.schemeDividerLine} />
              </View>

              {/* Title */}
              <Text style={styles.sectionLabel}>Title</Text>
              <TextInput
                style={styles.input}
                value={schemeTitle}
                onChangeText={setSchemeTitle}
                placeholder="Marking scheme title"
                placeholderTextColor={COLORS.gray500}
              />

              {/* Total marks */}
              <View style={styles.totalMarksRow}>
                <Text style={styles.totalMarksLabel}>Total Marks</Text>
                <Text style={styles.totalMarksValue}>{totalMarks}</Text>
              </View>

              {/* Questions */}
              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>
                Questions ({questions.length})
              </Text>
              {questions.map((q, idx) => (
                <QuestionRow
                  key={idx}
                  question={q}
                  onUpdate={updated => updateQuestion(idx, updated)}
                  onDelete={() => deleteQuestion(idx)}
                />
              ))}

              {/* Add question */}
              <TouchableOpacity style={styles.addQuestionBtn} onPress={addQuestion}>
                <Ionicons name="add-circle-outline" size={18} color={COLORS.teal500} />
                <Text style={styles.addQuestionText}>Add Question</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>

        {/* ── Sticky bottom action bar (only when scheme ready) ── */}
        {hasScheme && (
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.regenBtn}
              onPress={handleGenerate}
              disabled={generating || saving || !imageUri}
              activeOpacity={0.85}
            >
              <Text style={styles.regenBtnText}>Regenerate</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, (saving || generating) && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving || generating}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color={COLORS.white} size="small" />
                : <Text style={styles.saveBtnText}>Save and Use</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.white },
  scroll: { padding: 24, paddingTop: 48, paddingBottom: 32 },

  back: { marginBottom: 24 },
  backText: { fontSize: 16, color: COLORS.gray500 },
  heading: { fontSize: 26, fontWeight: 'bold', color: COLORS.text, marginBottom: 4 },
  subheading: { fontSize: 14, color: COLORS.gray500, marginBottom: 28 },

  sectionLabel: { fontSize: 14, fontWeight: '600', color: COLORS.gray900, marginBottom: 8 },
  required: { color: COLORS.error },
  optional: { fontWeight: '400', color: COLORS.gray500 },

  // Image upload
  uploadZone: {
    borderWidth: 2,
    borderColor: COLORS.teal100,
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 32,
    alignItems: 'center',
    backgroundColor: COLORS.teal50,
    gap: 8,
  },
  uploadTitle: { fontSize: 15, fontWeight: '600', color: COLORS.teal700, textAlign: 'center' },
  uploadSub: { fontSize: 13, color: COLORS.gray500 },

  imagePreviewContainer: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.gray50,
  },
  thumbnail: { width: '100%', height: 200 },
  removeImageBtn: { position: 'absolute', top: 10, right: 10 },
  removeImageCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  retakeBtn: {
    position: 'absolute', bottom: 10, right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20,
  },
  retakeBtnText: { color: COLORS.white, fontSize: 12, fontWeight: '600' },

  // Education level chips
  chipsScroll: { marginBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
    borderColor: COLORS.gray200,
    backgroundColor: COLORS.background,
    marginRight: 8,
  },
  chipSelected: { borderColor: COLORS.teal500, backgroundColor: COLORS.teal50 },
  chipText: { fontSize: 13, color: COLORS.gray900 },
  chipTextSelected: { color: COLORS.teal700, fontWeight: '600' },

  // Form
  input: {
    borderWidth: 1, borderColor: COLORS.gray200,
    borderRadius: 10, padding: 14,
    fontSize: 16, color: COLORS.text,
    backgroundColor: COLORS.white,
  },

  // Generate button
  generateBtn: {
    marginTop: 24, backgroundColor: COLORS.teal500,
    borderRadius: 12, padding: 16, alignItems: 'center',
  },
  generateBtnDisabled: { backgroundColor: COLORS.teal100 },
  generateBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },

  // Divider
  schemeDivider: {
    flexDirection: 'row', alignItems: 'center',
    marginVertical: 28, gap: 12,
  },
  schemeDividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  schemeDividerText: { fontSize: 13, fontWeight: '600', color: COLORS.gray500 },

  // Total marks row
  totalMarksRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.teal50,
    borderRadius: 10, padding: 14, marginBottom: 4,
  },
  totalMarksLabel: { fontSize: 14, fontWeight: '600', color: COLORS.teal700 },
  totalMarksValue: { fontSize: 20, fontWeight: 'bold', color: COLORS.teal500 },

  // Question cards
  questionCard: {
    backgroundColor: COLORS.white, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  questionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  questionBadge: {
    backgroundColor: COLORS.teal50, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  questionBadgeText: { fontSize: 12, fontWeight: '700', color: COLORS.teal500 },
  deleteBtn: { padding: 4 },

  questionTextDisplay: {
    fontSize: 14, color: COLORS.gray900,
    fontStyle: 'italic', marginBottom: 10,
    paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },

  fieldLabel: { fontSize: 12, fontWeight: '600', color: COLORS.gray500, marginTop: 10, marginBottom: 4 },
  questionInput: {
    borderWidth: 1, borderColor: COLORS.gray200,
    borderRadius: 8, padding: 10,
    fontSize: 14, color: COLORS.text, backgroundColor: COLORS.gray50,
  },
  marksRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  marksInput: { width: 80, textAlign: 'center' },

  // Add question
  addQuestionBtn: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, padding: 14,
    borderWidth: 1, borderColor: COLORS.teal100,
    borderRadius: 10, marginTop: 6,
    backgroundColor: COLORS.teal50, justifyContent: 'center',
  },
  addQuestionText: { fontSize: 14, fontWeight: '600', color: COLORS.teal500 },

  // Bottom action bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: COLORS.white,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8,
    shadowOffset: { width: 0, height: -3 }, elevation: 8,
  },
  regenBtn: {
    flex: 1, borderWidth: 2, borderColor: COLORS.teal500,
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  regenBtnText: { color: COLORS.teal500, fontWeight: 'bold', fontSize: 15 },
  saveBtn: {
    flex: 2, backgroundColor: COLORS.teal500,
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: COLORS.teal100 },
  saveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 15 },
});
