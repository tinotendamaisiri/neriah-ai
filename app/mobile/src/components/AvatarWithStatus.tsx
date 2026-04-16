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
}

export default function AvatarWithStatus({ initial, onPress, size = 42 }: Props) {
  const radius = size / 2;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.avatar, { width: size, height: size, borderRadius: radius }]}
      activeOpacity={0.7}
    >
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
      <AIStatusDot />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
