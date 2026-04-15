// src/screens/ClassDetailScreen.tsx
// Manage a class: view students, add individual students.
// Answer keys (homework) are created and managed via the Homework flow.

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
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { listStudents, createStudent, deleteStudent } from '../services/api';
import { Student } from '../types';
import { COLORS } from '../constants/colors';

export default function ClassDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { class_id, class_name, education_level, curriculum } = route.params as {
    class_id: string;
    class_name: string;
    education_level: string;
    curriculum?: 'zimsec' | 'cambridge';
  };

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [addStudentVisible, setAddStudentVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadStudents();
    }, [class_id]),
  );

  const loadStudents = async () => {
    setLoading(true);
    try {
      const studs = await listStudents(class_id);
      setStudents(studs);
    } catch {
      Alert.alert('Error', 'Failed to load students.');
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

  const curriculumLabel = curriculum === 'cambridge' ? 'Cambridge' : 'ZIMSEC';

  return (
    <View style={styles.container}>
      <FlatList
        data={students}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.classHeader}>
              <View style={styles.classHeaderLeft}>
                <Text style={styles.classHeaderName}>{class_name}</Text>
                <View style={[
                  styles.curriculumBadge,
                  curriculum === 'cambridge' && styles.curriculumBadgeCambridge,
                ]}>
                  <Text style={[
                    styles.curriculumBadgeText,
                    curriculum === 'cambridge' && styles.curriculumBadgeTextCambridge,
                  ]}>
                    {curriculumLabel}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.markedBtn}
                onPress={() => navigation.navigate('HomeworkList', {
                  class_id,
                  class_name,
                })}
                activeOpacity={0.7}
              >
                <Text style={styles.markedBtnText}>Marked Homework</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Students ({students.length})</Text>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setAddStudentVisible(true)}
              >
                <Text style={styles.addButtonText}>+ Add</Text>
              </TouchableOpacity>
            </View>

            {loading && (
              <ActivityIndicator
                size="small"
                color={COLORS.teal500}
                style={{ marginTop: 20 }}
              />
            )}
          </>
        }
        renderItem={({ item }) => (
          <StudentRow
            student={item}
            onPress={() => navigation.navigate('TeacherStudentAnalytics', {
              student_id: item.id,
              student_name: `${item.first_name} ${item.surname}`,
              class_id,
              class_name,
            })}
            onDelete={() => handleDeleteStudent(item)}
          />
        )}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.emptySection}>
              No students yet. Tap + Add to add students.
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
    </View>
  );
}

// ── Student row ───────────────────────────────────────────────────────────────

function StudentRow({
  student,
  onPress,
  onDelete,
}: {
  student: Student;
  onPress: () => void;
  onDelete: () => void;
}) {
  return (
    <TouchableOpacity style={row.container} onPress={onPress} activeOpacity={0.7}>
      <View style={row.avatar}>
        <Text style={row.avatarText}>{student.first_name[0].toUpperCase()}</Text>
      </View>
      <View style={row.info}>
        <Text style={row.name}>{student.first_name} {student.surname}</Text>
        {student.register_number && (
          <Text style={row.sub}>#{student.register_number}</Text>
        )}
      </View>
      <TouchableOpacity
        style={row.deleteButton}
        onPress={onDelete}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={row.deleteText}>✕</Text>
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

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingBottom: 32 },
  classHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4,
    backgroundColor: COLORS.background,
  },
  classHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' },
  classHeaderName: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  curriculumBadge: {
    backgroundColor: COLORS.teal50, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  curriculumBadgeCambridge: { backgroundColor: '#EEF2FF' },
  curriculumBadgeText: { fontSize: 11, fontWeight: '700', color: COLORS.teal500 },
  curriculumBadgeTextCambridge: { color: '#4F46E5' },
  markedBtn: {
    borderWidth: 1, borderColor: COLORS.teal500, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5, marginLeft: 8,
  },
  markedBtnText: { fontSize: 12, color: COLORS.teal500, fontWeight: '600' },
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
  chevron: { fontSize: 20, color: COLORS.gray200, marginLeft: 4 },
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
  button: {
    marginTop: 20, backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 14, alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: COLORS.teal100 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 15 },
});
