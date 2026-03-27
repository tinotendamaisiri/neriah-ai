// src/screens/MarkingScreen.tsx
// Camera capture + real-time marking result.
// Teacher selects a class, selects a student, captures a photo, sees annotated result.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Image } from 'react-native';
import { useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { submitMark } from '../services/api';
import { MarkResult, Student, AnswerKey } from '../types';
import ScanButton from '../components/ScanButton';
import MarkResultComponent from '../components/MarkResult';

export default function MarkingScreen() {
  const route = useRoute<any>();
  const class_id = route.params?.class_id;

  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedAnswerKey, setSelectedAnswerKey] = useState<AnswerKey | null>(null);
  const [result, setResult] = useState<MarkResult | null>(null);
  const [marking, setMarking] = useState(false);

  const handleCapture = async (imageUri: string) => {
    // TODO: validate student and answer key are selected before submitting
    if (!selectedStudent || !selectedAnswerKey) {
      Alert.alert('Setup needed', 'Please select a student and answer key first.');
      return;
    }

    setMarking(true);
    try {
      // TODO: if offline, enqueue(scan) instead of calling submitMark
      const markResult = await submitMark({
        image_uri: imageUri,
        student_id: selectedStudent.id,
        answer_key_id: selectedAnswerKey.id,
      });
      setResult(markResult);
    } catch (e) {
      Alert.alert('Marking failed', 'Could not mark the book. Please try again.');
    } finally {
      setMarking(false);
    }
  };

  const handleNextStudent = () => {
    // TODO: advance to next student in the class list automatically
    setSelectedStudent(null);
    setResult(null);
  };

  if (result) {
    return (
      <View style={styles.container}>
        <MarkResultComponent result={result} student={selectedStudent!} />
        <TouchableOpacity style={styles.nextButton} onPress={handleNextStudent}>
          <Text style={styles.nextButtonText}>Next Student</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Mark Books</Text>

      {/* TODO: student selector — show class list, let teacher pick student */}
      <TouchableOpacity style={styles.selector} onPress={() => {}}>
        <Text style={styles.selectorText}>
          {selectedStudent ? selectedStudent.name : 'Select Student'}
        </Text>
      </TouchableOpacity>

      {/* TODO: answer key selector */}
      <TouchableOpacity style={styles.selector} onPress={() => {}}>
        <Text style={styles.selectorText}>
          {selectedAnswerKey ? selectedAnswerKey.subject : 'Select Answer Key'}
        </Text>
      </TouchableOpacity>

      {marking ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#22c55e" />
          <Text style={styles.loadingText}>Marking...</Text>
        </View>
      ) : (
        <ScanButton onCapture={handleCapture} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  heading: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  selector: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 14, marginBottom: 12 },
  selectorText: { fontSize: 15, color: '#333' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  nextButton: { backgroundColor: '#22c55e', borderRadius: 8, padding: 16, alignItems: 'center', margin: 16 },
  nextButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
