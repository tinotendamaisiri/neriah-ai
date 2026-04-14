// src/components/AIStatusDot.tsx
// Real-time AI inference status indicator.
//
// States (update live when network changes):
//   Blue  + "Cloud AI"        — online, using Gemma 4 26B via Vertex AI
//   Green + "On-device AI"    — offline, LiteRT E4B/E2B model loaded
//   Gray  + "Offline — queued"— offline, no model loaded
//
// Uses useAIRouter() from router.ts so the dot re-renders whenever
// network connectivity changes — no manual refresh needed.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAIRouter } from '../services/router';

// ── State → visual mapping ────────────────────────────────────────────────────

const CLOUD_COLOR    = '#3B82F6'; // blue
const ONDEVICE_COLOR = '#22C55E'; // green
const OFFLINE_COLOR  = '#9CA3AF'; // gray

interface DotConfig {
  color: string;
  label: string;
}

function getDotConfig(isOnline: boolean, loadedModel: string | null): DotConfig {
  if (isOnline)     return { color: CLOUD_COLOR,    label: 'Cloud AI' };
  if (loadedModel)  return { color: ONDEVICE_COLOR, label: 'On-device AI' };
  return              { color: OFFLINE_COLOR,  label: 'Offline \u2014 queued' };
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Small status pill that shows the current AI inference route.
 * Place in a screen header — it updates automatically when connectivity changes.
 */
export default function AIStatusDot() {
  const { isOnline, loadedModel } = useAIRouter();
  const { color, label } = getDotConfig(isOnline, loadedModel);

  return (
    <View style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    // Subtle shadow so it floats cleanly over any header background
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
