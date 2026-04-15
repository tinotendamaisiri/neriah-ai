// src/screens/ClassSetupScreen.tsx
// Create a new class. On success, navigates directly to ClassDetailScreen.

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  FlatList,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { createClass, createStudentsBatch, extractStudentsFromImage, extractStudentsFromFile } from '../services/api';
import { EducationLevel, RootStackParamList } from '../types';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import InAppCamera from '../components/InAppCamera';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Curriculum = 'zimsec' | 'cambridge';

interface StudentDraft {
  first_name: string;
  surname: string;
  reg_no: string;
  phone: string;
}

const NUM_COLS = 4;

const EDUCATION_LEVELS: { label: string; value: EducationLevel }[] = [
  { label: 'Grade 1', value: 'grade_1' },
  { label: 'Grade 2', value: 'grade_2' },
  { label: 'Grade 3', value: 'grade_3' },
  { label: 'Grade 4', value: 'grade_4' },
  { label: 'Grade 5', value: 'grade_5' },
  { label: 'Grade 6', value: 'grade_6' },
  { label: 'Grade 7', value: 'grade_7' },
  { label: 'Form 1', value: 'form_1' },
  { label: 'Form 2', value: 'form_2' },
  { label: 'Form 3', value: 'form_3' },
  { label: 'Form 4', value: 'form_4' },
  { label: 'Form 5 (A-Level)', value: 'form_5' },
  { label: 'Form 6 (A-Level)', value: 'form_6' },
  { label: 'College/University', value: 'tertiary' },
];

const CURRICULA: { value: Curriculum; short: string }[] = [
  { value: 'zimsec', short: 'ZIMSEC' },
  { value: 'cambridge', short: 'Cambridge' },
];

function emptyRow(): StudentDraft {
  return { first_name: '', surname: '', reg_no: '', phone: '' };
}

export default function ClassSetupScreen() {
  const navigation = useNavigation<Nav>();

  const [className, setClassName] = useState('');
  const [curriculum, setCurriculum] = useState<Curriculum>('zimsec');
  const [selectedLevel, setSelectedLevel] = useState<EducationLevel | null>(null);
  const [levelModalVisible, setLevelModalVisible] = useState(false);
  const [rows, setRows] = useState<StudentDraft[]>(() => Array.from({ length: 5 }, emptyRow));
  const [rosterExpanded, setRosterExpanded] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);

  // Flat ref array: index = rowIndex * NUM_COLS + colIndex
  const cellRefs = useRef<(TextInput | null)[]>([]);

  const focusCell = useCallback((row: number, col: number) => {
    const idx = row * NUM_COLS + col;
    cellRefs.current[idx]?.focus();
  }, []);

  const handleCellSubmit = useCallback((rowIdx: number, colIdx: number) => {
    if (colIdx < NUM_COLS - 1) {
      focusCell(rowIdx, colIdx + 1);
    } else if (rowIdx < rows.length - 1) {
      focusCell(rowIdx + 1, 0);
    }
  }, [focusCell, rows.length]);

  const updateCell = useCallback((rowIdx: number, field: keyof StudentDraft, value: string) => {
    setRows(prev => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [field]: value };
      return next;
    });
  }, []);

  const addRow = useCallback(() => {
    setRows(prev => [...prev, emptyRow()]);
  }, []);

  const selectedLevelLabel = EDUCATION_LEVELS.find(l => l.value === selectedLevel)?.label ?? null;

  const applyExtracted = useCallback((extracted: { first_name: string; surname: string; register_number?: string | null; phone?: string | null }[]) => {
    if (extracted.length === 0) {
      Alert.alert('No students found', 'Could not find any student names. Try a clearer image or different file.');
      return;
    }
    setRows(prev => {
      const newRows = extracted.map(s => ({
        first_name: s.first_name ?? '',
        surname: s.surname ?? '',
        reg_no: s.register_number ?? '',
        phone: s.phone ?? '',
      }));
      // Keep existing filled rows, append extracted after them
      const filled = prev.filter(r => r.first_name.trim());
      const merged = [...filled, ...newRows];
      Alert.alert(`${extracted.length} student${extracted.length === 1 ? '' : 's'} found`, 'The table has been populated.');
      return merged;
    });
    setRosterExpanded(true);
  }, []);

  const handleUpload = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv',
        'application/csv',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setExtracting(true);
    try {
      const extracted = await extractStudentsFromFile(
        asset.uri,
        asset.name ?? 'upload',
        asset.mimeType ?? 'application/octet-stream',
      );
      applyExtracted(extracted);
    } catch {
      Alert.alert('Error', 'Could not read the file. Please try again.');
    } finally {
      setExtracting(false);
    }
  }, [applyExtracted]);

  const handlePhoto = useCallback(() => {
    setCameraVisible(true);
  }, []);

  const handleCameraCapture = useCallback(async (_base64: string, uri: string) => {
    setCameraVisible(false);
    setExtracting(true);
    try {
      const extracted = await extractStudentsFromImage(uri);
      applyExtracted(extracted);
    } catch {
      Alert.alert('Error', 'Could not process the image. Please try again.');
    } finally {
      setExtracting(false);
    }
  }, [applyExtracted]);

  const handleSave = async () => {
    if (!className.trim()) {
      Alert.alert('Missing info', 'Please enter a class name.');
      return;
    }
    if (!selectedLevel) {
      Alert.alert('Missing info', 'Please select an education level.');
      return;
    }

    const validStudents = rows.filter(r => r.first_name.trim().length > 0);

    setSaving(true);
    try {
      const newClass = await createClass({
        name: className.trim(),
        education_level: selectedLevel,
        curriculum,
      });

      if (validStudents.length > 0) {
        await createStudentsBatch({
          class_id: newClass.id,
          students: validStudents.map(r => ({
            first_name: r.first_name.trim(),
            surname: r.surname.trim(),
            register_number: r.reg_no.trim() || undefined,
            phone: r.phone.trim() || undefined,
          })),
        });
      }

      navigation.replace('ClassDetail', {
        class_id: newClass.id,
        class_name: newClass.name,
        education_level: newClass.education_level,
        curriculum: (newClass.curriculum ?? 'zimsec') as 'zimsec' | 'cambridge',
      });
    } catch {
      Alert.alert('Error', 'Could not create class. Please try again.');
      setSaving(false);
    }
  };

  return (
    <>
      <InAppCamera
        visible={cameraVisible}
        onCapture={handleCameraCapture}
        onClose={() => setCameraVisible(false)}
        quality={0.85}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>New Class</Text>

        {/* Class name */}
        <Text style={styles.label}>Class Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 3B Mathematics"
          value={className}
          onChangeText={setClassName}
          maxLength={60}
          autoCapitalize="words"
        />

        {/* Curriculum */}
        <Text style={styles.label}>CURRICULUM</Text>
        <View style={styles.curriculumRow}>
          {CURRICULA.map((c) => {
            const selected = curriculum === c.value;
            return (
              <TouchableOpacity
                key={c.value}
                style={[styles.levelChip, selected && styles.levelChipSelected]}
                onPress={() => setCurriculum(c.value)}
              >
                <Text style={[styles.levelChipText, selected && styles.levelChipTextSelected]}>
                  {c.short}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Education level */}
        <Text style={styles.label}>Education Level *</Text>
        <TouchableOpacity
          style={styles.pickerField}
          onPress={() => setLevelModalVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={[styles.pickerFieldText, !selectedLevelLabel && styles.pickerFieldPlaceholder]}>
            {selectedLevelLabel ?? 'Select education level'}
          </Text>
          <Text style={styles.pickerChevron}>▾</Text>
        </TouchableOpacity>

        {/* Student roster toggle */}
        <TouchableOpacity
          style={styles.rosterToggle}
          onPress={() => setRosterExpanded(prev => !prev)}
          activeOpacity={0.7}
        >
          <Text style={styles.rosterToggleText}>
            {rosterExpanded ? '− Hide student list' : '+ Add students to this class'}
          </Text>
        </TouchableOpacity>

        {rosterExpanded && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View>
                {/* Table header */}
                <View style={table.header}>
                  <Text style={[table.headerCell, { width: COL_W.firstName }]}>First Name</Text>
                  <Text style={[table.headerCell, { width: COL_W.surname }]}>Surname</Text>
                  <Text style={[table.headerCell, { width: COL_W.regNo }]}>Reg No.</Text>
                  <Text style={[table.headerCell, { width: COL_W.phone }]}>Phone</Text>
                </View>

                {/* Data rows */}
                {rows.map((row, rowIdx) => (
                  <View
                    key={rowIdx}
                    style={[table.row, rowIdx % 2 === 1 && table.rowAlt]}
                  >
                    <TextInput
                      ref={el => { cellRefs.current[rowIdx * NUM_COLS + 0] = el; }}
                      style={[table.cell, { width: COL_W.firstName }]}
                      value={row.first_name}
                      onChangeText={v => updateCell(rowIdx, 'first_name', v)}
                      placeholder="First name"
                      placeholderTextColor={COLORS.gray200}
                      autoCapitalize="words"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => handleCellSubmit(rowIdx, 0)}
                    />
                    <TextInput
                      ref={el => { cellRefs.current[rowIdx * NUM_COLS + 1] = el; }}
                      style={[table.cell, { width: COL_W.surname }]}
                      value={row.surname}
                      onChangeText={v => updateCell(rowIdx, 'surname', v)}
                      placeholder="Surname"
                      placeholderTextColor={COLORS.gray200}
                      autoCapitalize="words"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => handleCellSubmit(rowIdx, 1)}
                    />
                    <TextInput
                      ref={el => { cellRefs.current[rowIdx * NUM_COLS + 2] = el; }}
                      style={[table.cell, { width: COL_W.regNo }]}
                      value={row.reg_no}
                      onChangeText={v => updateCell(rowIdx, 'reg_no', v)}
                      placeholder="—"
                      placeholderTextColor={COLORS.gray200}
                      keyboardType="number-pad"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => handleCellSubmit(rowIdx, 2)}
                    />
                    <TextInput
                      ref={el => { cellRefs.current[rowIdx * NUM_COLS + 3] = el; }}
                      style={[table.cell, { width: COL_W.phone }, table.cellLast]}
                      value={row.phone}
                      onChangeText={v => updateCell(rowIdx, 'phone', v)}
                      placeholder="Optional"
                      placeholderTextColor={COLORS.gray200}
                      keyboardType="phone-pad"
                      returnKeyType={rowIdx < rows.length - 1 ? 'next' : 'done'}
                      blurOnSubmit={rowIdx === rows.length - 1}
                      onSubmitEditing={() => handleCellSubmit(rowIdx, 3)}
                    />
                  </View>
                ))}
              </View>
            </ScrollView>

            <View style={styles.tableActions}>
              <TouchableOpacity style={styles.tableActionBtn} onPress={addRow} disabled={extracting}>
                <Text style={styles.tableActionText}>＋  Add row</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.tableActionBtn} onPress={handleUpload} disabled={extracting}>
                {extracting
                  ? <ActivityIndicator size="small" color={COLORS.teal500} />
                  : (
                    <View style={styles.tableActionInner}>
                      <Ionicons name="attach-outline" size={15} color={COLORS.teal500} />
                      <Text style={styles.tableActionText}>  Upload</Text>
                    </View>
                  )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.tableActionBtn} onPress={handlePhoto} disabled={extracting}>
                {extracting
                  ? <ActivityIndicator size="small" color={COLORS.teal500} />
                  : (
                    <View style={styles.tableActionInner}>
                      <Ionicons name="camera-outline" size={15} color={COLORS.teal500} />
                      <Text style={styles.tableActionText}>  Photo</Text>
                    </View>
                  )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Create button */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? 'Creating...' : 'Create Class'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Education level picker modal */}
      <Modal
        visible={levelModalVisible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => setLevelModalVisible(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Education Level</Text>
            <TouchableOpacity
              onPress={() => setLevelModalVisible(false)}
              hitSlop={{ top: 8, bottom: 8, left: 16, right: 8 }}
            >
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={EDUCATION_LEVELS}
            keyExtractor={item => item.value}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isSelected = item.value === selectedLevel;
              return (
                <TouchableOpacity
                  style={[styles.levelRow, isSelected && styles.levelRowSelected]}
                  onPress={() => {
                    setSelectedLevel(item.value);
                    setLevelModalVisible(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.levelRowText, isSelected && styles.levelRowTextSelected]}>
                    {item.label}
                  </Text>
                  {isSelected && <Text style={styles.levelRowCheck}>✓</Text>}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

// ── Column widths ──────────────────────────────────────────────────────────────

const COL_W = {
  firstName: 120,
  surname: 120,
  regNo: 72,
  phone: 110,
};

// ── Table styles ──────────────────────────────────────────────────────────────

const table = StyleSheet.create({
  header: {
    flexDirection: 'row',
    backgroundColor: COLORS.teal500,
  },
  headerCell: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
    borderRightWidth: 1,
    borderRightColor: COLORS.teal500,
  },
  row: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowAlt: {
    backgroundColor: '#f9fafb',
  },
  cell: {
    paddingVertical: 9,
    paddingHorizontal: 8,
    fontSize: 13,
    color: COLORS.text,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  cellLast: {
    borderRightWidth: 0,
  },
});

// ── Screen styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  content: { padding: 20, paddingBottom: 40 },
  heading: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginBottom: 20 },
  label: {
    fontSize: 12, fontWeight: '700', color: COLORS.gray500,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 8, marginTop: 20,
  },
  input: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 13, fontSize: 16, color: COLORS.text,
  },
  curriculumRow: { flexDirection: 'row', gap: 8 },
  levelChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.gray200, backgroundColor: COLORS.background,
  },
  levelChipSelected: { borderColor: COLORS.teal500, backgroundColor: COLORS.teal50 },
  levelChipText: { fontSize: 13, color: COLORS.gray500 },
  levelChipTextSelected: { color: COLORS.teal500, fontWeight: '600' },
  pickerField: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10, padding: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.white,
  },
  pickerFieldText: { fontSize: 16, color: COLORS.text, flex: 1 },
  pickerFieldPlaceholder: { color: COLORS.gray500 },
  pickerChevron: { fontSize: 14, color: COLORS.gray500 },
  rosterToggle: { marginTop: 20, paddingVertical: 4 },
  rosterToggleText: { fontSize: 15, color: COLORS.teal500, fontWeight: '600' },
  tableActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 10,
    gap: 24,
  },
  tableActionBtn: { alignItems: 'center', paddingVertical: 4, minWidth: 72 },
  tableActionInner: { flexDirection: 'row', alignItems: 'center' },
  tableActionText: { fontSize: 14, color: COLORS.teal500, fontWeight: '600' },
  saveButton: {
    marginTop: 32, backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 16, alignItems: 'center',
  },
  saveButtonDisabled: { backgroundColor: COLORS.teal100 },
  saveButtonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  // Modal
  modal: { flex: 1, backgroundColor: COLORS.white },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  modalCancel: { fontSize: 16, color: COLORS.teal500, fontWeight: '600' },
  levelRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  levelRowSelected: { backgroundColor: COLORS.teal50 },
  levelRowText: { flex: 1, fontSize: 16, color: COLORS.text },
  levelRowTextSelected: { color: COLORS.teal500, fontWeight: '600' },
  levelRowCheck: { fontSize: 16, color: COLORS.teal500, fontWeight: '700' },
  separator: { height: 1, backgroundColor: COLORS.border, marginLeft: 20 },
});
