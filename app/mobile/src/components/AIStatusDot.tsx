// src/components/AIStatusDot.tsx
// Tri-state status dot — sits on the top-right corner of the avatar circle.
//
// Lime green (#22C55E)  = online (Cloud AI via Vertex)
// Amber (#F5A623)       = offline + on-device model ready
// Red (#EF4444)         = offline + no model available
//
// Positioned absolute — parent must have overflow visible or be the avatar View.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useAIRouter } from '../services/router';
import { useModel } from '../context/ModelContext';

export default function AIStatusDot() {
  const { isOnline } = useAIRouter();
  const { status: modelStatus } = useModel();
  const modelReady = modelStatus === 'done';

  // Tri-state: green online, amber offline+model, red offline+no-model
  const color = isOnline ? '#22C55E' : modelReady ? '#F5A623' : '#EF4444';

  return (
    <View style={[styles.dot, { backgroundColor: color }]} />
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#0D7377', // matches teal header background
  },
});
