// src/screens/ClassSetupScreen.tsx
// Create a new class. On success, navigates directly to ClassDetailScreen
// so the teacher can immediately add students and answer keys.

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createClass } from '../services/api';
import { EducationLevel, RootStackParamList } from '../types';
import { COLORS } from '../constants/colors';

type Nav = NativeStackNavigationProp<RootStackParamList>;

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

export default function ClassSetupScreen() {
  const navigation = useNavigation<Nav>();

  const [className, setClassName] = useState('');
  const [subject, setSubject] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<EducationLevel | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!className.trim()) {
      Alert.alert('Missing info', 'Please enter a class name.');
      return;
    }
    if (!selectedLevel) {
      Alert.alert('Missing info', 'Please select an education level.');
      return;
    }

    setSaving(true);
    try {
      const newClass = await createClass({
        name: className.trim(),
        education_level: selectedLevel,
        subject: subject.trim() || undefined,
      });

      // Navigate directly to class detail so teacher can add students + answer keys
      navigation.replace('ClassDetail', {
        class_id: newClass.id,
        class_name: newClass.name,
        education_level: newClass.education_level,
      });
    } catch {
      Alert.alert('Error', 'Could not create class. Please try again.');
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>New Class</Text>

      <Text style={styles.label}>Class Name *</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 3B Mathematics"
        value={className}
        onChangeText={setClassName}
        maxLength={60}
        autoCapitalize="words"
      />

      <Text style={styles.label}>Subject (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Mathematics"
        value={subject}
        onChangeText={setSubject}
        maxLength={60}
        autoCapitalize="words"
      />

      <Text style={styles.label}>Education Level *</Text>
      <View style={styles.levelGrid}>
        {EDUCATION_LEVELS.map((level) => (
          <TouchableOpacity
            key={level.value}
            style={[
              styles.levelChip,
              selectedLevel === level.value && styles.levelChipSelected,
            ]}
            onPress={() => setSelectedLevel(level.value)}
          >
            <Text
              style={[
                styles.levelChipText,
                selectedLevel === level.value && styles.levelChipTextSelected,
              ]}
            >
              {level.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  content: { padding: 20, paddingBottom: 40 },
  heading: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.gray900, marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 13, fontSize: 16, color: COLORS.text,
  },
  levelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  levelChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.gray200, backgroundColor: COLORS.background,
  },
  levelChipSelected: { borderColor: COLORS.teal500, backgroundColor: COLORS.teal50 },
  levelChipText: { fontSize: 13, color: COLORS.gray500 },
  levelChipTextSelected: { color: COLORS.teal500, fontWeight: '600' },
  saveButton: {
    marginTop: 32, backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 16, alignItems: 'center',
  },
  saveButtonDisabled: { backgroundColor: COLORS.teal100 },
  saveButtonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
});
