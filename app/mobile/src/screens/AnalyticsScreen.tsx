// src/screens/AnalyticsScreen.tsx
// Per-class score charts and student performance overview.
// MVP: out of scope — shows placeholder.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function AnalyticsScreen() {
  // TODO: implement class selector
  // TODO: load analytics from GET /api/analytics?class_id=...
  // TODO: render bar chart of score distribution (consider victory-native or react-native-chart-kit)
  // TODO: render list of students sorted by average score
  // TODO: highlight students below a configurable threshold

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Analytics</Text>
      <Text style={styles.placeholder}>
        Analytics dashboard coming soon.{'\n'}
        This feature is out of scope for MVP.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  placeholder: { textAlign: 'center', color: '#aaa', fontSize: 15, lineHeight: 24 },
});
