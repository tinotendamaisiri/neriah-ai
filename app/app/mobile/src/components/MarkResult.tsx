// src/components/MarkResult.tsx
// Displays the annotated image + per-question score breakdown after marking.

import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { MarkResult, Student, GradingVerdictEnum } from '../types';
import { COLORS } from '../constants/colors';

interface MarkResultProps {
  result: MarkResult;
  student: Student;
}

const VERDICT_COLOUR: Record<GradingVerdictEnum, string> = {
  correct: COLORS.success,
  incorrect: COLORS.error,
  partial: COLORS.warning,
};

const VERDICT_LABEL: Record<GradingVerdictEnum, string> = {
  correct: '✓',
  incorrect: '✗',
  partial: '~',
};

export default function MarkResultComponent({ result, student }: MarkResultProps) {
  const displayName = `${student.first_name} ${student.surname}`;

  const pctColour =
    result.percentage >= 75
      ? COLORS.success
      : result.percentage >= 50
      ? COLORS.warning
      : COLORS.error;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.studentName}>{displayName}</Text>

      {/* Score badge */}
      <View style={styles.scoreBadge}>
        <Text style={styles.scoreNumber}>
          {result.score}/{result.max_score}
        </Text>
        <Text style={[styles.scorePercent, { color: pctColour }]}>
          {result.percentage}%
        </Text>
      </View>

      {/* Annotated image */}
      <Image
        source={{ uri: result.marked_image_url }}
        style={styles.annotatedImage}
        resizeMode="contain"
      />

      {/* Per-question breakdown */}
      {result.verdicts.length > 0 && (
        <>
          <Text style={styles.breakdownHeading}>Question Breakdown</Text>
          {result.verdicts.map((verdict) => (
            <View key={verdict.question_number} style={styles.verdictRow}>
              <Text style={styles.questionNum}>Q{verdict.question_number}</Text>
              <Text style={[styles.verdictIcon, { color: VERDICT_COLOUR[verdict.verdict] }]}>
                {VERDICT_LABEL[verdict.verdict]}
              </Text>
              <Text style={styles.marks}>
                {verdict.awarded_marks}/{verdict.max_marks}
              </Text>
              {verdict.feedback && (
                <Text style={styles.feedback}>{verdict.feedback}</Text>
              )}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  content: { padding: 16, paddingBottom: 32 },
  studentName: { fontSize: 22, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  scoreBadge: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 16 },
  scoreNumber: { fontSize: 36, fontWeight: 'bold', color: COLORS.text },
  scorePercent: { fontSize: 20, fontWeight: '600' },
  annotatedImage: {
    width: '100%', height: 420, borderRadius: 8,
    backgroundColor: COLORS.background, marginBottom: 24,
  },
  breakdownHeading: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  verdictRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  questionNum: { width: 32, fontSize: 14, color: COLORS.gray500 },
  verdictIcon: { width: 20, fontSize: 18, fontWeight: 'bold' },
  marks: { fontSize: 13, color: COLORS.text, minWidth: 44 },
  feedback: { fontSize: 12, color: COLORS.textLight, marginLeft: 4, flex: 1 },
});
