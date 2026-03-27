// src/components/MarkResult.tsx
// Displays the annotated image + per-question score breakdown after marking.

import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { MarkResult, Student, GradingVerdictEnum } from '../types';

interface MarkResultProps {
  result: MarkResult;
  student: Student;
}

const VERDICT_COLOUR: Record<GradingVerdictEnum, string> = {
  correct: '#15803d',
  incorrect: '#dc2626',
  partial: '#ea580c',
};

const VERDICT_LABEL: Record<GradingVerdictEnum, string> = {
  correct: '✓',
  incorrect: '✗',
  partial: '~',
};

export default function MarkResultComponent({ result, student }: MarkResultProps) {
  // TODO: add pinch-to-zoom on the annotated image (react-native-zoom-able)
  // TODO: add share button to export the annotated image to camera roll or share sheet
  // TODO: add "Re-mark" button to re-submit if teacher thinks result is wrong

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.studentName}>{student.name}</Text>

      <View style={styles.scoreBadge}>
        <Text style={styles.scoreNumber}>{result.score}/{result.max_score}</Text>
        <Text style={styles.scorePercent}>{result.percentage}%</Text>
      </View>

      {/* Annotated image */}
      <Image
        source={{ uri: result.marked_image_url }}
        style={styles.annotatedImage}
        resizeMode="contain"
        // TODO: add loading indicator while image loads
      />

      {/* Per-question breakdown */}
      <Text style={styles.breakdownHeading}>Question Breakdown</Text>
      {result.verdicts.map((verdict) => (
        <View key={verdict.question_number} style={styles.verdictRow}>
          <Text style={styles.questionNum}>Q{verdict.question_number}</Text>
          <Text style={[styles.verdictIcon, { color: VERDICT_COLOUR[verdict.verdict] }]}>
            {VERDICT_LABEL[verdict.verdict]}
          </Text>
          <Text style={styles.marks}>{verdict.awarded_marks} mark{verdict.awarded_marks !== 1 ? 's' : ''}</Text>
          {verdict.feedback && (
            <Text style={styles.feedback}>{verdict.feedback}</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  studentName: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  scoreBadge: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 16 },
  scoreNumber: { fontSize: 36, fontWeight: 'bold', color: '#111' },
  scorePercent: { fontSize: 20, color: '#666' },
  annotatedImage: { width: '100%', height: 400, borderRadius: 8, backgroundColor: '#f0f0f0', marginBottom: 20 },
  breakdownHeading: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  questionNum: { width: 32, fontSize: 14, color: '#555' },
  verdictIcon: { width: 20, fontSize: 18, fontWeight: 'bold' },
  marks: { fontSize: 13, color: '#444' },
  feedback: { fontSize: 12, color: '#888', marginLeft: 8, flex: 1 },
});
