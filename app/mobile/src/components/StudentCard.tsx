// src/components/StudentCard.tsx
// Compact card showing a student's name, register number, and latest score.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Student } from '../types';

interface StudentCardProps {
  student: Student;
  latestScore?: { score: number; max_score: number } | null;
  onPress?: () => void;
}

export default function StudentCard({ student, latestScore, onPress }: StudentCardProps) {
  // TODO: add visual indicator for students who haven't been marked yet (grey)
  // TODO: add trend arrow (improving/declining) based on last 3 marks
  // TODO: add long-press to view full mark history

  const scoreText = latestScore
    ? `${latestScore.score}/${latestScore.max_score} (${Math.round((latestScore.score / latestScore.max_score) * 100)}%)`
    : 'Not yet marked';

  const scoreColour = latestScore
    ? latestScore.score / latestScore.max_score >= 0.5
      ? '#15803d'
      : '#dc2626'
    : '#aaa';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.info}>
        <Text style={styles.name}>{student.name}</Text>
        {student.register_number && (
          <Text style={styles.regNumber}>#{student.register_number}</Text>
        )}
      </View>
      <Text style={[styles.score, { color: scoreColour }]}>{scoreText}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#f9fafb', borderRadius: 8, marginBottom: 8, justifyContent: 'space-between' },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: '#111' },
  regNumber: { fontSize: 12, color: '#888', marginTop: 2 },
  score: { fontSize: 14, fontWeight: '600', marginLeft: 8 },
});
