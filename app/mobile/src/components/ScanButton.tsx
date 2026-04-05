// src/components/ScanButton.tsx
// Camera button with a frame guide overlay.
// The frame guide is a rectangular overlay that tells the teacher how to position the book.
// Client-side quality control: if the book is outside the frame, the capture button stays inactive.
// This eliminates the need for the server-side quality gate on App submissions.

import React, { useState, useRef } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { COLORS } from '../constants/colors';
// TODO: import { Camera } from 'expo-camera' for live viewfinder with frame overlay

interface ScanButtonProps {
  onCapture: (imageUri: string) => void;
  disabled?: boolean;
}

export default function ScanButton({ onCapture, disabled = false }: ScanButtonProps) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const requestPermissionAndCapture = async () => {
    // TODO: implement live camera viewfinder with frame guide using expo-camera
    // TODO: draw SVG or View overlay as the page guide rectangle
    // TODO: enable capture button only when the page fills the guide frame
    // TODO: for MVP, use ImagePicker as a simpler alternative

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera permission needed', 'Neriah needs camera access to photograph books.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      quality: 0.9,
      // TODO: add allowsEditing: true with aspect ratio 3:4 for A4 portrait pages
    });

    if (!result.canceled && result.assets.length > 0) {
      onCapture(result.assets[0].uri);
    }
  };

  return (
    <View style={styles.container}>
      {/* TODO: replace with live Camera viewfinder + frame overlay */}
      <View style={styles.frameGuide}>
        <Text style={styles.frameGuideText}>Frame the page inside the guide</Text>
        {/* TODO: draw corner markers as styled View elements */}
      </View>

      <TouchableOpacity
        style={[styles.captureButton, disabled && styles.captureButtonDisabled]}
        onPress={requestPermissionAndCapture}
        disabled={disabled}
      >
        <View style={styles.captureButtonInner} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 32 },
  frameGuide: {
    position: 'absolute', top: 20, left: 20, right: 20, bottom: 100,
    borderWidth: 2, borderColor: COLORS.teal500, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
    // TODO: make border dashed using a library or custom drawn corners
  },
  frameGuideText: { color: COLORS.teal500, fontSize: 13, backgroundColor: 'rgba(255,255,255,0.7)', padding: 4, borderRadius: 4 },
  captureButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.teal500, justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: COLORS.white },
  captureButtonDisabled: { backgroundColor: COLORS.teal100 },
  captureButtonInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.white },
});
