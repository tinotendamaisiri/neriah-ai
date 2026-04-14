// src/components/ScanButton.tsx
// Camera scan button with document frame guide.
// Opens InAppCamera (expo-camera CameraView) full-screen — never leaves the app.

import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';
import InAppCamera from './InAppCamera';

interface ScanButtonProps {
  onCapture: (imageUri: string) => void;
  disabled?: boolean;
}

export default function ScanButton({ onCapture, disabled = false }: ScanButtonProps) {
  const [cameraVisible, setCameraVisible] = useState(false);

  const handleCapture = (base64: string, uri: string) => {
    setCameraVisible(false);
    onCapture(uri);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.captureButton, disabled && styles.captureButtonDisabled]}
        onPress={() => setCameraVisible(true)}
        disabled={disabled}
      >
        <View style={styles.captureButtonInner} />
      </TouchableOpacity>

      <InAppCamera
        visible={cameraVisible}
        onCapture={handleCapture}
        onClose={() => setCameraVisible(false)}
        quality={0.9}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 32 },
  captureButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.teal500, justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: COLORS.white },
  captureButtonDisabled: { backgroundColor: COLORS.teal100 },
  captureButtonInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.white },
});
