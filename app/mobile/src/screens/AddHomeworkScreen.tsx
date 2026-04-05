// src/screens/AddHomeworkScreen.tsx
// Create a new homework assignment (answer key) for a class.
// Optional: attach a question paper (camera, gallery, PDF, Word, or typed text)
// and Gemma 4 will auto-generate the marking scheme.

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
  Modal,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { listClasses, createAnswerKey, createAnswerKeyWithFile } from '../services/api';
import { Class } from '../types';
import { COLORS } from '../constants/colors';

interface QPFile {
  uri: string;
  name: string;
  mimeType: string;
  label: string; // display name shown in preview
}

export default function AddHomeworkScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {
    class_id: prefilledClassId,
    class_name: prefilledClassName,
    education_level: prefilledLevel,
  } = route.params ?? {};

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>(prefilledClassId ?? '');
  const [showClassPicker, setShowClassPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  // Question paper state
  const [qpFile, setQpFile] = useState<QPFile | null>(null);
  const [qpText, setQpText] = useState('');
  const [textModalVisible, setTextModalVisible] = useState(false);
  const [textDraft, setTextDraft] = useState('');

  const selectedClass = prefilledClassId
    ? { id: prefilledClassId, name: prefilledClassName ?? '', education_level: prefilledLevel } as Class
    : classes.find(c => c.id === selectedClassId) ?? null;

  useFocusEffect(
    useCallback(() => {
      if (!prefilledClassId) {
        listClasses().then(setClasses).catch(() => {});
      }
    }, [prefilledClassId]),
  );

  // ── Question paper pickers ─────────────────────────────────────────────────

  const handleCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const name = `question_paper_${Date.now()}.jpg`;
    setQpFile({ uri: asset.uri, name, mimeType: 'image/jpeg', label: '📷 Camera photo' });
    setQpText('');
  };

  const handleGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const name = asset.fileName ?? `question_paper_${Date.now()}.jpg`;
    setQpFile({ uri: asset.uri, name, mimeType: asset.mimeType ?? 'image/jpeg', label: `🖼 ${name}` });
    setQpText('');
  };

  const handlePickPDF = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setQpFile({ uri: asset.uri, name: asset.name ?? 'document.pdf', mimeType: 'application/pdf', label: `📄 ${asset.name}` });
    setQpText('');
  };

  const handlePickWord = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setQpFile({ uri: asset.uri, name: asset.name ?? 'document.docx', mimeType: asset.mimeType ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: `📝 ${asset.name}` });
    setQpText('');
  };

  const handleTextDone = () => {
    const text = textDraft.trim();
    if (text) {
      setQpText(text);
      setQpFile(null);
    }
    setTextModalVisible(false);
  };

  const clearQP = () => {
    setQpFile(null);
    setQpText('');
  };

  // ── Create ─────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    const t = title.trim();
    const s = subject.trim();
    if (!t) { Alert.alert('Title required', 'Please enter a homework title.'); return; }
    if (!s) { Alert.alert('Subject required', 'Please enter the subject.'); return; }
    if (!selectedClassId) { Alert.alert('Class required', 'Please select a class.'); return; }

    const educationLevel = selectedClass?.education_level ?? prefilledLevel ?? '';

    setLoading(true);
    try {
      let ak;
      if (qpFile) {
        // File upload path — multipart POST
        ak = await createAnswerKeyWithFile(
          { class_id: selectedClassId, title: t, education_level: educationLevel, subject: s },
          qpFile.uri,
          qpFile.name,
          qpFile.mimeType,
        );
      } else if (qpText) {
        // Plain text path
        ak = await createAnswerKey({
          class_id: selectedClassId,
          title: t,
          subject: s,
          education_level: educationLevel,
          question_paper_text: qpText,
        });
      } else {
        // No question paper — create empty, teacher sets up scheme later
        ak = await createAnswerKey({
          class_id: selectedClassId,
          title: t,
          subject: s,
          education_level: educationLevel,
        });
      }
      navigation.replace('HomeworkDetail', {
        answer_key_id: ak.id,
        class_id: selectedClassId,
        class_name: selectedClass?.name ?? prefilledClassName ?? '',
      });
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not create homework. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const hasQP = !!(qpFile || qpText);

  return (
    <>
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
            {/* Class selector */}
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

            {/* ── Question paper section ──────────────────────────────────── */}
            <Text style={styles.sectionLabel}>QUESTION PAPER (Optional)</Text>
            <Text style={styles.sectionHint}>
              Attach the question paper and Gemma 4 will generate the marking scheme automatically.
            </Text>

            <View style={styles.uploadRow}>
              <TouchableOpacity style={styles.uploadBtn} onPress={handleCamera}>
                <Text style={styles.uploadIcon}>📷</Text>
                <Text style={styles.uploadLabel}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uploadBtn} onPress={handleGallery}>
                <Text style={styles.uploadIcon}>🖼</Text>
                <Text style={styles.uploadLabel}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uploadBtn} onPress={handlePickPDF}>
                <Text style={styles.uploadIcon}>📄</Text>
                <Text style={styles.uploadLabel}>PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uploadBtn} onPress={handlePickWord}>
                <Text style={styles.uploadIcon}>📝</Text>
                <Text style={styles.uploadLabel}>Word</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uploadBtn} onPress={() => { setTextDraft(qpText); setTextModalVisible(true); }}>
                <Text style={styles.uploadIcon}>✏️</Text>
                <Text style={styles.uploadLabel}>Text</Text>
              </TouchableOpacity>
            </View>

            {hasQP && (
              <View style={styles.qpPreview}>
                <Text style={styles.qpPreviewIcon}>✓</Text>
                <Text style={styles.qpPreviewText} numberOfLines={1}>
                  {qpFile ? qpFile.label : `✏️ ${qpText.length} characters of text`}
                </Text>
                <TouchableOpacity onPress={clearQP} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.qpClear}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleCreate}
              disabled={loading}
            >
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={COLORS.white} size="small" />
                  <Text style={styles.buttonText}>
                    {hasQP ? '  Gemma 4 is generating your marking scheme…' : '  Creating…'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>
                  {hasQP ? 'Generate & Create' : 'Create Homework'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Text input modal */}
      <Modal
        visible={textModalVisible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => setTextModalVisible(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setTextModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Question Paper Text</Text>
            <TouchableOpacity onPress={handleTextDone}>
              <Text style={styles.modalDone}>Done</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            Type or paste the questions from the paper. Gemma 4 will generate the marking scheme.
          </Text>
          <TextInput
            style={styles.modalTextArea}
            placeholder="1. Solve for x: 2x + 5 = 13&#10;2. State Newton's first law of motion&#10;..."
            value={textDraft}
            onChangeText={setTextDraft}
            multiline
            textAlignVertical="top"
            autoFocus
          />
        </SafeAreaView>
      </Modal>
    </>
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
  dropdownItem: { padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  dropdownItemActive: { backgroundColor: COLORS.teal50 },
  dropdownText: { fontSize: 15, color: COLORS.text },
  dropdownTextActive: { color: COLORS.teal500, fontWeight: '600' },

  // Question paper section
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: COLORS.gray500,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 24, marginBottom: 4,
  },
  sectionHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 12 },
  uploadRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 8,
  },
  uploadBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    backgroundColor: COLORS.background,
  },
  uploadIcon: { fontSize: 22 },
  uploadLabel: { fontSize: 11, color: COLORS.gray500, marginTop: 4, fontWeight: '500' },
  qpPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.teal50, borderRadius: 10, padding: 12,
    marginTop: 8, borderWidth: 1, borderColor: COLORS.teal100,
  },
  qpPreviewIcon: { fontSize: 16, color: COLORS.teal500, fontWeight: '700' },
  qpPreviewText: { flex: 1, fontSize: 13, color: COLORS.teal700, fontWeight: '500' },
  qpClear: { fontSize: 14, color: COLORS.teal500 },

  // Create button
  button: {
    marginTop: 28, backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 16, alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: COLORS.teal300 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },

  // Text modal
  modal: { flex: 1, backgroundColor: COLORS.white },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  modalCancel: { fontSize: 16, color: COLORS.gray500 },
  modalDone: { fontSize: 16, color: COLORS.teal500, fontWeight: '700' },
  modalHint: {
    fontSize: 13, color: COLORS.gray500, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
  },
  modalTextArea: {
    flex: 1, paddingHorizontal: 20, paddingTop: 8,
    fontSize: 15, color: COLORS.text, lineHeight: 22,
  },
});
