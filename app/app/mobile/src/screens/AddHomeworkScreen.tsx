// src/screens/AddHomeworkScreen.tsx
// Create a new homework assignment (answer key) for a class.
// Accepts optional class_id/class_name from navigation params (from HomeScreen FAB).
// If class_id is absent, shows a class picker.

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { listClasses, createAnswerKey } from '../services/api';
import { Class } from '../types';
import { COLORS } from '../constants/colors';

export default function AddHomeworkScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { class_id: prefilledClassId, class_name: prefilledClassName } = route.params ?? {};

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>(prefilledClassId ?? '');
  const [showClassPicker, setShowClassPicker] = useState(false);
  const [useAI, setUseAI] = useState(false);
  const [questionPaperText, setQuestionPaperText] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedClass = prefilledClassId
    ? { id: prefilledClassId, name: prefilledClassName ?? '' } as Class
    : classes.find(c => c.id === selectedClassId) ?? null;

  useFocusEffect(
    useCallback(() => {
      if (!prefilledClassId) {
        listClasses().then(setClasses).catch(() => {});
      }
    }, [prefilledClassId]),
  );

  const handleCreate = async () => {
    const t = title.trim();
    const s = subject.trim();
    if (!t) { Alert.alert('Title required', 'Please enter a homework title.'); return; }
    if (!s) { Alert.alert('Subject required', 'Please enter the subject.'); return; }
    if (!selectedClassId) { Alert.alert('Class required', 'Please select a class.'); return; }
    if (useAI && !questionPaperText.trim()) {
      Alert.alert('Question paper required', 'Please paste the question paper text for AI generation.');
      return;
    }

    setLoading(true);
    try {
      const ak = await createAnswerKey({
        class_id: selectedClassId,
        title: t,
        subject: s,
        ...(useAI
          ? { auto_generate: true, question_paper_text: questionPaperText.trim() }
          : { questions: [] }
        ),
      });
      navigation.replace('HomeworkDetail', {
        answer_key_id: ak.id,
        class_id: selectedClassId,
        class_name: selectedClass?.name ?? '',
      });
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not create homework. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Add Homework</Text>
        <Text style={styles.subheading}>Create a new assignment for your class.</Text>

        <View style={styles.form}>
          {/* Class selector — only shown when not pre-filled from HomeScreen */}
          {!prefilledClassId && (
            <>
              <Text style={styles.label}>Class</Text>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowClassPicker(v => !v)}
              >
                <Text style={[styles.pickerText, !selectedClassId && styles.placeholder]}>
                  {selectedClass?.name ?? 'Select a class'}
                </Text>
                <Text style={styles.chevronText}>▾</Text>
              </TouchableOpacity>
              {showClassPicker && (
                <View style={styles.dropdown}>
                  {classes.map(c => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.dropdownItem, c.id === selectedClassId && styles.dropdownItemActive]}
                      onPress={() => { setSelectedClassId(c.id); setShowClassPicker(false); }}
                    >
                      <Text style={[styles.dropdownText, c.id === selectedClassId && styles.dropdownTextActive]}>
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Chapter 5 Revision Test"
            value={title}
            onChangeText={setTitle}
            autoCapitalize="sentences"
          />

          <Text style={styles.label}>Subject</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Mathematics"
            value={subject}
            onChangeText={setSubject}
            autoCapitalize="words"
          />

          {/* AI toggle */}
          <TouchableOpacity
            style={styles.aiToggle}
            onPress={() => setUseAI(v => !v)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, useAI && styles.checkboxOn]}>
              {useAI && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.aiToggleLabel}>Generate marking scheme with AI</Text>
          </TouchableOpacity>

          {useAI && (
            <>
              <Text style={styles.label}>Question paper text</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Paste or type the questions from the paper here..."
                value={questionPaperText}
                onChangeText={setQuestionPaperText}
                multiline
                textAlignVertical="top"
              />
            </>
          )}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={COLORS.white} />
              : <Text style={styles.buttonText}>
                  {useAI ? 'Generate & Create' : 'Create Homework'}
                </Text>
            }
          </TouchableOpacity>

          {/* ── Generate with AI entry point ── */}
          <View style={styles.orDivider}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>or</Text>
            <View style={styles.orLine} />
          </View>

          <TouchableOpacity
            style={styles.aiPhotoButton}
            onPress={() => {
              if (!selectedClassId) {
                Alert.alert('Class required', 'Please select a class first.');
                return;
              }
              navigation.navigate('GenerateScheme', {
                class_id: selectedClassId,
                class_name: selectedClass?.name ?? '',
                education_level: (selectedClass as any)?.education_level ?? undefined,
                subject: subject.trim() || undefined,
              });
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.aiPhotoButtonIcon}>✨</Text>
            <View>
              <Text style={styles.aiPhotoButtonTitle}>Generate with AI</Text>
              <Text style={styles.aiPhotoButtonSub}>Photograph your question paper</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.white },
  container: { flexGrow: 1, padding: 24, paddingTop: 48 },
  back: { marginBottom: 24 },
  backText: { fontSize: 16, color: COLORS.gray500 },
  heading: { fontSize: 26, fontWeight: 'bold', color: COLORS.text, marginBottom: 6 },
  subheading: { fontSize: 14, color: COLORS.gray500, marginBottom: 28 },
  form: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.gray900, marginTop: 8 },
  input: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 14, fontSize: 16, color: COLORS.text,
  },
  textArea: { height: 120 },
  pickerButton: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  pickerText: { fontSize: 16, color: COLORS.text },
  placeholder: { color: COLORS.gray500 },
  chevronText: { color: COLORS.gray500, fontSize: 14 },
  dropdown: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    backgroundColor: COLORS.white, marginTop: 4,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  dropdownItem: {
    padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  dropdownItemActive: { backgroundColor: COLORS.teal50 },
  dropdownText: { fontSize: 15, color: COLORS.text },
  dropdownTextActive: { color: COLORS.teal500, fontWeight: '600' },
  aiToggle: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: COLORS.gray200,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxOn: { backgroundColor: COLORS.teal500, borderColor: COLORS.teal500 },
  checkmark: { color: COLORS.white, fontSize: 14, fontWeight: 'bold' },
  aiToggleLabel: { fontSize: 15, color: COLORS.text, flex: 1 },
  button: {
    marginTop: 24, backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 16, alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: COLORS.teal300 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  orDivider: {
    flexDirection: 'row', alignItems: 'center',
    marginVertical: 16, gap: 10,
  },
  orLine: { flex: 1, height: 1, backgroundColor: COLORS.gray200 },
  orText: { fontSize: 13, color: COLORS.gray500 },
  aiPhotoButton: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 2, borderColor: COLORS.teal100,
    borderRadius: 12, padding: 16,
    backgroundColor: COLORS.teal50,
  },
  aiPhotoButtonIcon: { fontSize: 24 },
  aiPhotoButtonTitle: { fontSize: 15, fontWeight: '700', color: COLORS.teal700 },
  aiPhotoButtonSub: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
});
