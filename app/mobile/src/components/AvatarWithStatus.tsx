// src/components/AvatarWithStatus.tsx
// Circular avatar with connectivity status dot — shared by teacher and student screens.
// Tapping navigates to the role-appropriate Settings screen.

import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import AIStatusDot from './AIStatusDot';

interface Props {
  initial: string;
  onPress: () => void;
  size?: number;
  /** Use 'light' on teal headers, 'solid' on white headers (default). */
  variant?: 'solid' | 'light';
}

export default function AvatarWithStatus({ initial, onPress, size = 42, variant = 'solid' }: Props) {
  const radius = size / 2;
  const bg = variant === 'light' ? 'rgba(255,255,255,0.2)' : '#0D7377';
  const dotBorder = variant === 'light' ? '#0D7377' : '#FFFFFF';
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.avatar, { width: size, height: size, borderRadius: radius, backgroundColor: bg }]}
      activeOpacity={0.7}
    >
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial || 'T'}</Text>
      <AIStatusDot borderColor={dotBorder} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
