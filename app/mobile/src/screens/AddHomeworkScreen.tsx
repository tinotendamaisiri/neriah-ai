// src/screens/AddHomeworkScreen.tsx
// Create a new homework assignment (answer key) for a class.
// Homework paper upload is mandatory — Gemma 4 auto-generates the marking scheme.

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
  FlatList,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { listClasses, createAnswerKey, createAnswerKeyWithFile } from '../services/api';
import { Class } from '../types';
import { COLORS } from '../constants/colors';

const COMMON_SUBJECTS = [
  'Mathematics',
  'English Language',
  'English Literature',
  'Science',
  'Physics',
  'Chemistry',
  'Biology',
  'Geography',
  'History',
  'Religious Studies',
  'Agriculture',
  'Commerce',
  'Accounts',
  'Economics',
  'Computer Science',
  'Art',
  'Music',
  'Physical Education',
  'Shona',
  'Ndebele',
  'French',
  'Food and Nutrition',
  'Fashion and Fabrics',
  'Technical Graphics',
  'Building Studies',
];

interface QPFile {
  uri: string;
  name: string;
  mimeType: string;
  label: string;
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
  const [subjectModalVisible, setSubjectModalVisible] = useState(false);
  const [subjectSearch, setSubjectSearch] = useState('');

  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>(prefilledClassId ?? '');
  const [showClassPicker, setShowClassPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  // Homework paper state
  const [qpFile, setQpFile] = useState<QPFile | null>(null);
  const [qpText, setQpText] = useState('');
  const [textModalVisible, setTextModalVisible] = useState(false);
  const [textDraft, setTextDraft] = useState('');

  // Manual marking scheme state (takes precedence over auto-generate when present)
  const [showManualScheme, setShowManualScheme] = useState(false);
  const [msFile, setMsFile] = useState<QPFile | null>(null);
  const [msText, setMsText] = useState('');
  const [msTextModalVisible, setMsTextModalVisible] = useState(false);
  const [msTextDraft, setMsTextDraft] = useState('');

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

  // ── Subject picker ─────────────────────────────────────────────────────────

  const openSubjectModal = () => {
    setSubjectSearch('');
    setSubjectModalVisible(true);
  };

  const pickSubject = (s: string) => {
    setSubject(s);
    setSubjectModalVisible(false);
  };

  const useCustomSubject = () => {
    const custom = subjectSearch.trim();
    if (custom) {
      setSubject(custom);
      setSubjectModalVisible(false);
    }
  };

  const filteredSubjects = subjectSearch.trim()
    ? COMMON_SUBJECTS.filter(s => s.toLowerCase().includes(subjectSearch.toLowerCase()))
    : COMMON_SUBJECTS;

  const isExactMatch = COMMON_SUBJECTS.some(
    s => s.toLowerCase() === subjectSearch.toLowerCase(),
  );

  // ── Homework paper pickers ─────────────────────────────────────────────────

  const handleCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setQpFile({ uri: asset.uri, name: `homework_${Date.now()}.jpg`, mimeType: 'image/jpeg', label: '📷 Camera photo' });
    setQpText('');
  };

  const handleGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const name = asset.fileName ?? `homework_${Date.now()}.jpg`;
    setQpFile({ uri: asset.uri, name, mimeType: asset.mimeType ?? 'image/jpeg', label: `🖼 ${name}` });
    setQpText('');
  };

  const handlePickPDF = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
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

  // ── Manual scheme pickers ──────────────────────────────────────────────────

  const handleMSCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Camera access is required.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setMsFile({ uri: asset.uri, name: `scheme_${Date.now()}.jpg`, mimeType: 'image/jpeg', label: '📷 Camera photo' });
    setMsText('');
  };

  const handleMSGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const name = asset.fileName ?? `scheme_${Date.now()}.jpg`;
    setMsFile({ uri: asset.uri, name, mimeType: asset.mimeType ?? 'image/jpeg', label: `🖼 ${name}` });
    setMsText('');
  };

  const handleMSPickPDF = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setMsFile({ uri: asset.uri, name: asset.name ?? 'scheme.pdf', mimeType: 'application/pdf', label: `📄 ${asset.name}` });
    setMsText('');
  };

  const handleMSPickWord = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setMsFile({ uri: asset.uri, name: asset.name ?? 'scheme.docx', mimeType: asset.mimeType ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: `📝 ${asset.name}` });
    setMsText('');
  };

  const handleMSTextDone = () => {
    const text = msTextDraft.trim();
    if (text) { setMsText(text); setMsFile(null); }
    setMsTextModalVisible(false);
  };

  const clearMS = () => { setMsFile(null); setMsText(''); };

  // ── Create ─────────────────────────────────────────────────────────────────

  const hasQP = !!(qpFile || qpText);
  const hasMS = !!(msFile || msText);
  const hasAnyUpload = hasQP || hasMS;

  const handleCreate = async () => {
    const t = title.trim();
    const s = subject.trim();
    if (!t) { Alert.alert('Title required', 'Please enter a homework title.'); return; }
    if (!s) { Alert.alert('Subject required', 'Please select a subject.'); return; }
    if (!selectedClassId) { Alert.alert('Class required', 'Please select a class.'); return; }
    if (!hasAnyUpload) {
      Alert.alert('Upload required', 'Please upload the homework paper or marking scheme before creating.');
      return;
    }

    const educationLevel = selectedClass?.education_level ?? prefilledLevel ?? '';

    setLoading(true);
    try {
      let ak;

      if (hasMS) {
        // Manual scheme takes precedence — upload it directly as the answer key
        if (msFile) {
          ak = await createAnswerKeyWithFile(
            { class_id: selectedClassId, title: t, education_level: educationLevel, subject: s },
            msFile.uri,
            msFile.name,
            msFile.mimeType,
          );
        } else {
          ak = await createAnswerKey({
            class_id: selectedClassId,
            title: t,
            subject: s,
            education_level: educationLevel,
            question_paper_text: msText,
          });
        }
      } else if (qpFile) {
        // Auto-generate from question paper file
        ak = await createAnswerKeyWithFile(
          { class_id: selectedClassId, title: t, education_level: educationLevel, subject: s },
          qpFile.uri,
          qpFile.name,
          qpFile.mimeType,
        );
      } else {
        // Auto-generate from question paper text
        ak = await createAnswerKey({
          class_id: selectedClassId,
          title: t,
          subject: s,
          education_level: educationLevel,
          question_paper_text: qpText,
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
          <Text style={styles.subheading}>
            Upload the homework paper and Neriah will generate the marking scheme for you.
          </Text>

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

            {/* Subject picker */}
            <Text style={styles.label}>Subject</Text>
            <TouchableOpacity style={styles.pickerButton} onPress={openSubjectModal}>
              <Text style={[styles.pickerText, !subject && styles.placeholder]}>
                {subject || 'Select or type a subject'}
              </Text>
              <Text style={styles.chevronText}>▾</Text>
            </TouchableOpacity>

            {/* ── Homework paper section ──────────────────────────────────── */}
            <Text style={styles.sectionLabel}>HOMEWORK PAPER (required)</Text>
            <Text style={styles.sectionHint}>
              Upload the question paper. Neriah will read it and auto-generate the marking scheme.
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

            {/* ── Divider + manual scheme link / section ─────────────────── */}
            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.manualSchemeLink}
              onPress={() => {
                if (showManualScheme && hasMS) {
                  Alert.alert(
                    'Remove manual scheme?',
                    'Hiding this section will remove your uploaded marking scheme. Neriah will auto-generate one instead.',
                    [
                      { text: 'Remove', style: 'destructive', onPress: () => { clearMS(); setShowManualScheme(false); } },
                      { text: 'Keep', style: 'cancel' },
                    ],
                  );
                } else {
                  setShowManualScheme(v => !v);
                }
              }}
              activeOpacity={0.6}
            >
              <Text style={styles.manualSchemeLinkText}>
                {showManualScheme ? 'Hide manual marking scheme ↑' : 'Upload marking scheme manually →'}
              </Text>
            </TouchableOpacity>

            {showManualScheme && (
              <>
                <Text style={styles.sectionLabel}>MARKING SCHEME (Manual)</Text>
                <Text style={styles.sectionHint}>
                  {hasMS
                    ? 'Manual scheme will be used instead of auto-generating.'
                    : 'Optional. Upload your own answer key — Neriah will extract the marking scheme from it.'}
                </Text>

                <View style={styles.uploadRow}>
                  <TouchableOpacity style={styles.uploadBtn} onPress={handleMSCamera}>
                    <Text style={styles.uploadIcon}>📷</Text>
                    <Text style={styles.uploadLabel}>Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.uploadBtn} onPress={handleMSGallery}>
                    <Text style={styles.uploadIcon}>🖼</Text>
                    <Text style={styles.uploadLabel}>Gallery</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.uploadBtn} onPress={handleMSPickPDF}>
                    <Text style={styles.uploadIcon}>📄</Text>
                    <Text style={styles.uploadLabel}>PDF</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.uploadBtn} onPress={handleMSPickWord}>
                    <Text style={styles.uploadIcon}>📝</Text>
                    <Text style={styles.uploadLabel}>Word</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.uploadBtn} onPress={() => { setMsTextDraft(msText); setMsTextModalVisible(true); }}>
                    <Text style={styles.uploadIcon}>✏️</Text>
                    <Text style={styles.uploadLabel}>Text</Text>
                  </TouchableOpacity>
                </View>

                {hasMS && (
                  <View style={styles.qpPreview}>
                    <Text style={styles.qpPreviewIcon}>✓</Text>
                    <Text style={styles.qpPreviewText} numberOfLines={1}>
                      {msFile ? msFile.label : `✏️ ${msText.length} characters of text`}
                    </Text>
                    <TouchableOpacity onPress={clearMS} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.qpClear}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
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
                    {hasMS ? '  Processing marking scheme…' : '  Neriah is generating your marking scheme…'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>
                  {hasMS ? 'Create Homework' : hasQP ? 'Generate & Create' : 'Create Homework'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Subject picker modal */}
      <Modal
        visible={subjectModalVisible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => setSubjectModalVisible(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Subject</Text>
            <TouchableOpacity onPress={() => setSubjectModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search or type a custom subject…"
              value={subjectSearch}
              onChangeText={setSubjectSearch}
              autoCapitalize="words"
              autoFocus
              clearButtonMode="while-editing"
            />
          </View>

          <FlatList
            data={filteredSubjects}
            keyExtractor={item => item}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isSelected = item === subject;
              return (
                <TouchableOpacity
                  style={[styles.subjectRow, isSelected && styles.subjectRowSelected]}
                  onPress={() => pickSubject(item)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.subjectRowText, isSelected && styles.subjectRowTextSelected]}>
                    {item}
                  </Text>
                  {isSelected && <Text style={styles.subjectRowCheck}>✓</Text>}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListFooterComponent={
              subjectSearch.trim() && !isExactMatch ? (
                <TouchableOpacity style={styles.customRow} onPress={useCustomSubject}>
                  <Text style={styles.customRowText}>
                    Use "<Text style={styles.customRowBold}>{subjectSearch.trim()}</Text>"
                  </Text>
                </TouchableOpacity>
              ) : null
            }
          />
        </SafeAreaView>
      </Modal>

      {/* Text input modal — Homework Paper */}
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
            <Text style={styles.modalTitle}>Homework Paper Text</Text>
            <TouchableOpacity onPress={handleTextDone}>
              <Text style={styles.modalDone}>Done</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            Type or paste the questions from the paper. Gemma 4 will generate the marking scheme.
          </Text>
          <TextInput
            style={styles.modalTextArea}
            placeholder={'1. Solve for x: 2x + 5 = 13\n2. State Newton\'s first law of motion\n...'}
            value={textDraft}
            onChangeText={setTextDraft}
            multiline
            textAlignVertical="top"
            autoFocus
          />
        </SafeAreaView>
      </Modal>

      {/* Text input modal — Manual Marking Scheme */}
      <Modal
        visible={msTextModalVisible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => setMsTextModalVisible(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setMsTextModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Marking Scheme Text</Text>
            <TouchableOpacity onPress={handleMSTextDone}>
              <Text style={styles.modalDone}>Done</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            Type or paste the marking scheme. Neriah will extract the answers and marks from it.
          </Text>
          <TextInput
            style={styles.modalTextArea}
            placeholder={'1. x = 4  [2 marks]\n2. An object at rest stays at rest unless acted on by a force.  [2 marks]\n...'}
            value={msTextDraft}
            onChangeText={setMsTextDraft}
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

  // Homework paper section
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: COLORS.gray500,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 24, marginBottom: 4,
  },
  sectionHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 12 },
  uploadRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
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

  // Section divider
  divider: {
    height: 1, backgroundColor: COLORS.border, marginTop: 24, marginBottom: 16,
  },
  manualSchemeLink: {
    alignItems: 'center', paddingVertical: 4,
  },
  manualSchemeLinkText: {
    fontSize: 13, color: COLORS.gray500,
  },

  // Create button
  button: {
    marginTop: 28, backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 16, alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: COLORS.teal300 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },

  // Shared modal shell
  modal: { flex: 1, backgroundColor: COLORS.white },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  modalCancel: { fontSize: 16, color: COLORS.gray500 },
  modalDone: { fontSize: 16, color: COLORS.teal500, fontWeight: '700' },

  // Subject modal
  searchContainer: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  searchInput: {
    backgroundColor: COLORS.background, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: COLORS.text,
  },
  subjectRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  subjectRowSelected: { backgroundColor: COLORS.teal50 },
  subjectRowText: { flex: 1, fontSize: 16, color: COLORS.text },
  subjectRowTextSelected: { color: COLORS.teal500, fontWeight: '600' },
  subjectRowCheck: { fontSize: 16, color: COLORS.teal500, fontWeight: '700' },
  separator: { height: 1, backgroundColor: COLORS.border, marginLeft: 20 },
  customRow: {
    paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  customRowText: { fontSize: 15, color: COLORS.teal500 },
  customRowBold: { fontWeight: '700' },

  // Text modal
  modalHint: {
    fontSize: 13, color: COLORS.gray500, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
  },
  modalTextArea: {
    flex: 1, paddingHorizontal: 20, paddingTop: 8,
    fontSize: 15, color: COLORS.text, lineHeight: 22,
  },
});
