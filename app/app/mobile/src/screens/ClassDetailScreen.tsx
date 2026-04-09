// src/screens/ClassDetailScreen.tsx
// Manage a class: view students, add students, view / toggle answer keys.
// Accessible from HomeScreen "Manage" button and after ClassSetup.

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  SectionList,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  listStudents,
  createStudent,
  deleteStudent,
  listAnswerKeys,
  createAnswerKey,
  updateAnswerKey,
} from '../services/api';
import { Student, AnswerKey } from '../types';
import { COLORS } from '../constants/colors';

export default function ClassDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { class_id, class_name, education_level } = route.params as {
    class_id: string;
    class_name: string;
    education_level: string;
  };

  const [students, setStudents] = useState<Student[]>([]);
  const [answerKeys, setAnswerKeys] = useState<AnswerKey[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [addStudentVisible, setAddStudentVisible] = useState(false);
  const [addKeyVisible, setAddKeyVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [class_id]),
  );

  const loadAll = async () => {
    setLoading(true);
    try {
      const [studs, keys] = await Promise.all([
        listStudents(class_id),
        listAnswerKeys(class_id),
      ]);
      setStudents(studs);
      setAnswerKeys(keys);
    } catch {
      Alert.alert('Error', 'Failed to load class data.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStudent = (student: Student) => {
    Alert.alert(
      'Remove student',
      `Remove ${student.first_name} ${student.surname} from this class?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteStudent(student.id);
              setStudents((prev) => prev.filter((s) => s.id !== student.id));
            } catch {
              Alert.alert('Error', 'Could not remove student.');
            }
          },
        },
      ],
    );
  };

  const handleToggleOpen = async (ak: AnswerKey) => {
    try {
      const updated = await updateAnswerKey(ak.id, {
        open_for_submission: !ak.open_for_submission,
      });
      setAnswerKeys((prev) => prev.map((k) => (k.id === ak.id ? updated : k)));
    } catch {
      Alert.alert('Error', 'Could not update answer key.');
    }
  };

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={COLORS.teal500} />
      </View>
    );
  }

  const sections = [
    {
      title: `Students (${students.length})`,
      data: students as any[],
      type: 'students',
    },
    {
      title: `Answer Keys (${answerKeys.length})`,
      data: answerKeys as any[],
      type: 'keys',
    },
  ];

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() =>
                section.type === 'students'
                  ? setAddStudentVisible(true)
                  : setAddKeyVisible(true)
              }
            >
              <Text style={styles.addButtonText}>+ Add</Text>
            </TouchableOpacity>
          </View>
        )}
        renderItem={({ item, section }) =>
          section.type === 'students' ? (
            <StudentRow
              student={item as Student}
              onDelete={() => handleDeleteStudent(item as Student)}
            />
          ) : (
            <AnswerKeyRow
              answerKey={item as AnswerKey}
              onToggleOpen={() => handleToggleOpen(item as AnswerKey)}
              onPress={() => navigation.navigate('HomeworkDetail', {
                answer_key_id: (item as AnswerKey).id,
                class_id,
                class_name,
              })}
            />
          )
        }
        renderSectionFooter={({ section }) =>
          section.data.length === 0 ? (
            <Text style={styles.emptySection}>
              {section.type === 'students'
                ? 'No students yet. Tap + Add to add students.'
                : 'No answer keys yet. Tap + Add to create one.'}
            </Text>
          ) : null
        }
      />

      <AddStudentModal
        visible={addStudentVisible}
        classId={class_id}
        onClose={() => setAddStudentVisible(false)}
        onAdded={(student) => {
          setStudents((prev) => [...prev, student]);
          setAddStudentVisible(false);
        }}
      />

      <AddAnswerKeyModal
        visible={addKeyVisible}
        classId={class_id}
        educationLevel={education_level}
        onClose={() => setAddKeyVisible(false)}
        onAdded={(key) => {
          setAnswerKeys((prev) => [...prev, key]);
          setAddKeyVisible(false);
        }}
      />
    </View>
  );
}

// ── Student row ───────────────────────────────────────────────────────────────

function StudentRow({
  student,
  onDelete,
}: {
  student: Student;
  onDelete: () => void;
}) {
  return (
    <View style={row.container}>
      <View style={row.avatar}>
        <Text style={row.avatarText}>{student.first_name[0].toUpperCase()}</Text>
      </View>
      <View style={row.info}>
        <Text style={row.name}>{student.first_name} {student.surname}</Text>
        {student.register_number && (
          <Text style={row.sub}>#{student.register_number}</Text>
        )}
      </View>
      <TouchableOpacity style={row.deleteButton} onPress={onDelete}>
        <Text style={row.deleteText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Answer key row ────────────────────────────────────────────────────────────

function AnswerKeyRow({
  answerKey,
  onToggleOpen,
  onPress,
}: {
  answerKey: AnswerKey;
  onToggleOpen: () => void;
  onPress: () => void;
}) {
  const title = answerKey.title ?? answerKey.subject;
  return (
    <TouchableOpacity style={row.container} onPress={onPress} activeOpacity={0.75}>
      <View style={row.info}>
        <Text style={row.name}>{title}</Text>
        <Text style={row.sub}>
          {answerKey.total_marks != null ? `${answerKey.total_marks} marks` : ''}
          {answerKey.questions.length > 0
            ? `  ·  ${answerKey.questions.length} questions`
            : ''}
        </Text>
      </View>
      <TouchableOpacity
        style={[
          row.badge,
          answerKey.open_for_submission ? row.badgeOpen : row.badgeClosed,
        ]}
        onPress={onToggleOpen}
      >
        <Text
          style={[
            row.badgeText,
            answerKey.open_for_submission ? row.badgeTextOpen : row.badgeTextClosed,
          ]}
        >
          {answerKey.open_for_submission ? 'Open' : 'Closed'}
        </Text>
      </TouchableOpacity>
      <Text style={row.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// ── Add student modal ─────────────────────────────────────────────────────────

function AddStudentModal({
  visible,
  classId,
  onClose,
  onAdded,
}: {
  visible: boolean;
  classId: string;
  onClose: () => void;
  onAdded: (student: Student) => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!firstName.trim() || !surname.trim()) {
      Alert.alert('Required', 'First name and surname are required.');
      return;
    }
    setSaving(true);
    try {
      const student = await createStudent({
        class_id: classId,
        first_name: firstName.trim(),
        surname: surname.trim(),
        register_number: regNumber.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setFirstName('');
      setSurname('');
      setRegNumber('');
      setPhone('');
      onAdded(student);
    } catch {
      Alert.alert('Error', 'Could not add student. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={modalS.overlay}>
        <View style={modalS.sheet}>
          <View style={modalS.header}>
            <Text style={modalS.title}>Add Student</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={modalS.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={modalS.body}>
            <Text style={modalS.label}>First name *</Text>
            <TextInput
              style={modalS.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="e.g. Tendai"
              autoCapitalize="words"
            />
            <Text style={modalS.label}>Surname *</Text>
            <TextInput
              style={modalS.input}
              value={surname}
              onChangeText={setSurname}
              placeholder="e.g. Moyo"
              autoCapitalize="words"
            />
            <Text style={modalS.label}>Register number (optional)</Text>
            <TextInput
              style={modalS.input}
              value={regNumber}
              onChangeText={setRegNumber}
              placeholder="e.g. 01"
              keyboardType="number-pad"
            />
            <Text style={modalS.label}>Phone (optional)</Text>
            <TextInput
              style={modalS.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+263..."
              keyboardType="phone-pad"
            />

            <TouchableOpacity
              style={[modalS.button, saving && modalS.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={modalS.buttonText}>{saving ? 'Adding...' : 'Add Student'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Add answer key modal ──────────────────────────────────────────────────────

function AddAnswerKeyModal({
  visible,
  classId,
  educationLevel,
  onClose,
  onAdded,
}: {
  visible: boolean;
  classId: string;
  educationLevel: string;
  onClose: () => void;
  onAdded: (key: AnswerKey) => void;
}) {
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!subject.trim()) {
      Alert.alert('Required', 'Subject is required.');
      return;
    }
    setSaving(true);
    try {
      const key = await createAnswerKey({
        class_id: classId,
        subject: subject.trim(),
        title: title.trim() || undefined,
        education_level: educationLevel,
        open_for_submission: false,
        // Auto-generate from question paper text if provided
        ...(questionText.trim()
          ? { auto_generate: true, question_paper_text: questionText.trim() }
          : {}),
      });
      setTitle('');
      setSubject('');
      setQuestionText('');
      onAdded(key);
    } catch {
      Alert.alert('Error', 'Could not create answer key. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={modalS.overlay}>
        <View style={modalS.sheet}>
          <View style={modalS.header}>
            <Text style={modalS.title}>New Answer Key</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={modalS.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={modalS.body}>
            <Text style={modalS.label}>Subject *</Text>
            <TextInput
              style={modalS.input}
              value={subject}
              onChangeText={setSubject}
              placeholder="e.g. Mathematics"
              autoCapitalize="words"
            />
            <Text style={modalS.label}>Title (optional)</Text>
            <TextInput
              style={modalS.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Term 1 Test"
              autoCapitalize="words"
            />
            <Text style={modalS.label}>Question paper text (optional — auto-generates marking scheme)</Text>
            <TextInput
              style={[modalS.input, modalS.multiline]}
              value={questionText}
              onChangeText={setQuestionText}
              placeholder="Paste your question paper here and AI will generate the answer key..."
              multiline
              numberOfLines={5}
              autoCapitalize="sentences"
            />

            {saving && (
              <Text style={modalS.hint}>
                {questionText.trim() ? 'Generating marking scheme...' : 'Saving...'}
              </Text>
            )}

            <TouchableOpacity
              style={[modalS.button, saving && modalS.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={modalS.buttonText}>
                {saving ? 'Creating...' : 'Create Answer Key'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { paddingBottom: 32 },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8,
    backgroundColor: COLORS.background,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.gray900 },
  addButton: {
    paddingHorizontal: 12, paddingVertical: 4,
    backgroundColor: COLORS.teal50, borderRadius: 12,
  },
  addButtonText: { fontSize: 13, color: COLORS.teal500, fontWeight: '600' },
  emptySection: { textAlign: 'center', color: COLORS.textLight, fontSize: 13, padding: 16 },
});

const row = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.white, marginHorizontal: 16, marginBottom: 8,
    borderRadius: 10, padding: 12,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.teal50,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  avatarText: { fontSize: 15, fontWeight: 'bold', color: COLORS.teal500 },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  sub: { fontSize: 12, color: COLORS.textLight, marginTop: 1 },
  deleteButton: { padding: 6 },
  deleteText: { fontSize: 14, color: COLORS.gray200 },
  badge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  badgeOpen: { backgroundColor: COLORS.teal50 },
  badgeClosed: { backgroundColor: COLORS.background },
  badgeText: { fontSize: 12, fontWeight: '600' },
  badgeTextOpen: { color: COLORS.teal500 },
  badgeTextClosed: { color: COLORS.gray500 },
  chevron: { fontSize: 18, color: COLORS.gray500, marginLeft: 6 },
});

const modalS = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontSize: 17, fontWeight: '600', color: COLORS.text },
  close: { fontSize: 20, color: COLORS.textLight },
  body: { padding: 16, paddingBottom: 32 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.gray900, marginBottom: 4, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 8,
    padding: 12, fontSize: 15, color: COLORS.text,
  },
  multiline: { height: 100, textAlignVertical: 'top' },
  hint: { fontSize: 13, color: COLORS.gray500, textAlign: 'center', marginTop: 8 },
  button: {
    marginTop: 20, backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 14, alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: COLORS.teal100 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 15 },
});
