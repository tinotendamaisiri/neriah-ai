// src/components/AvatarWithStatus.tsx
// Circular avatar with connectivity status dot — shared by teacher and student screens.
// Tapping navigates to the role-appropriate Settings screen.

import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';

interface Props {
  initial: string;
  onPress: () => void;
  size?: number;
  /** 'solid' = teal circle on white headers (default), 'light' = translucent on teal headers */
  variant?: 'solid' | 'light';
}

// Lazy-import AIStatusDot so a crash inside it never kills the avatar
let StatusDot: React.FC<{ borderColor?: string }> | null = null;
try {
  StatusDot = require('./AIStatusDot').default;
} catch {
  // AIStatusDot failed to load — avatar still renders, just without dot
}

export default function AvatarWithStatus({ initial, onPress, size = 44, variant = 'solid' }: Props) {
  const radius = size / 2;
  const isSolid = variant === 'solid';
  const bg = isSolid ? '#0D7377' : 'rgba(255,255,255,0.22)';
  const dotBorder = isSolid ? '#FFFFFF' : '#0D7377';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        // Ensure the absolute-positioned dot is visible
        overflow: 'visible',
      }}
    >
      <Text style={{
        color: '#FFFFFF',
        fontSize: size * 0.40,
        fontWeight: '700',
        // Ensure text doesn't interfere with the dot
        includeFontPadding: false,
      }}>
        {(initial && initial.trim()) || 'T'}
      </Text>

      {/* Status dot — top-right corner */}
      {StatusDot ? (
        <ErrorSafe>
          <StatusDot borderColor={dotBorder} />
        </ErrorSafe>
      ) : (
        <View style={{
          position: 'absolute', top: 1, right: 1,
          width: 12, height: 12, borderRadius: 6,
          backgroundColor: '#22C55E', borderWidth: 2, borderColor: dotBorder,
        }} />
      )}
    </TouchableOpacity>
  );
}

/** Catches render errors from AIStatusDot so the avatar still shows. */
class ErrorSafe extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
