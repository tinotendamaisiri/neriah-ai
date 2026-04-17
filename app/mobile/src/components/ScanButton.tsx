// src/components/ScanButton.tsx
// Camera capture button — opens InAppCamera full-screen.

import React, { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import InAppCamera from './InAppCamera';

interface ScanButtonProps {
  onCapture: (imageUri: string) => void;
  disabled?: boolean;
  label?: string;
  onDisabledPress?: () => void;
}

export default function ScanButton({
  onCapture,
  disabled = false,
  label = 'Capture Homework',
  onDisabledPress,
}: ScanButtonProps) {
  const [cameraVisible, setCameraVisible] = useState(false);

  const handleCapture = (base64: string, uri: string) => {
    setCameraVisible(false);
    onCapture(uri);
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.btn, disabled && styles.btnDisabled]}
        onPress={() => {
          if (disabled) {
            onDisabledPress?.();
            return;
          }
          setCameraVisible(true);
        }}
        activeOpacity={0.7}
      >
        <Ionicons name="camera" size={22} color={COLORS.white} />
        <Text style={styles.btnText}>{label}</Text>
      </TouchableOpacity>

      <InAppCamera
        visible={cameraVisible}
        onCapture={handleCapture}
        onClose={() => setCameraVisible(false)}
        quality={0.9}
      />
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.teal500,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 16,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
});
