// src/screens/ClassSetupScreen.tsx
// Create or edit a class: name, education level, and initial student list.

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { createClass } from '../services/api';
import { EducationLevel } from '../types';

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
  { label: 'Form 5', value: 'form_5' },
  { label: 'Form 6', value: 'form_6' },
  { label: 'Tertiary', value: 'tertiary' },
];

export default function ClassSetupScreen() {
  const navigation = useNavigation<any>();
  const [className, setClassName] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<EducationLevel | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    // TODO: validate inputs — class name required, education level required
    if (!className.trim() || !selectedLevel) {
      Alert.alert('Missing info', 'Please enter a class name and select an education level.');
      return;
    }
    setSaving(true);
    try {
      const newClass = await createClass({ name: className.trim(), education_level: selectedLevel });
      // TODO: navigate to student add flow or show success + back to Home
      Alert.alert('Class created!', `${newClass.name} is ready.`, [
        { text: 'Add Students', onPress: () => navigation.navigate('Home') },
        { text: 'Done', onPress: () => navigation.navigate('Home') },
      ]);
    } catch {
      Alert.alert('Error', 'Could not create class. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>New Class</Text>

      <Text style={styles.label}>Class Name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 3B Mathematics"
        value={className}
        onChangeText={setClassName}
        maxLength={50}
      />

      <Text style={styles.label}>Education Level</Text>
      <View style={styles.levelGrid}>
        {EDUCATION_LEVELS.map((level) => (
          <TouchableOpacity
            key={level.value}
            style={[styles.levelChip, selectedLevel === level.value && styles.levelChipSelected]}
            onPress={() => setSelectedLevel(level.value)}
          >
            <Text style={[styles.levelChipText, selectedLevel === level.value && styles.levelChipTextSelected]}>
              {level.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* TODO: add student list editor — bulk add from text, or photograph register */}

      <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? 'Creating...' : 'Create Class'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  heading: { fontSize: 24, fontWeight: 'bold', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: '#444', marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16 },
  levelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  levelChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#f9f9f9' },
  levelChipSelected: { borderColor: '#22c55e', backgroundColor: '#dcfce7' },
  levelChipText: { fontSize: 13, color: '#555' },
  levelChipTextSelected: { color: '#15803d', fontWeight: '600' },
  saveButton: { marginTop: 32, backgroundColor: '#22c55e', borderRadius: 8, padding: 16, alignItems: 'center' },
  saveButtonDisabled: { backgroundColor: '#86efac' },
  saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
