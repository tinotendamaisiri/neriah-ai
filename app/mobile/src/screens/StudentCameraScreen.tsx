// src/screens/StudentCameraScreen.tsx
// Multi-page image capture for student submissions.
// Allows capturing multiple pages; each page becomes one image in the submission.

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StudentRootStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import InAppCamera from '../components/InAppCamera';

type Props = NativeStackScreenProps<StudentRootStackParamList, 'StudentCamera'>;

export default function StudentCameraScreen({ route, navigation }: Props) {
  const { answer_key_id, answer_key_title, class_id } = route.params;
  const [images, setImages] = useState<string[]>([]);
  const [cameraVisible, setCameraVisible] = useState(false);

  const captureImage = () => {
    setCameraVisible(true);
  };

  const handleCameraCapture = (_base64: string, uri: string) => {
    setCameraVisible(false);
    setImages(prev => [...prev, uri]);
  };

  const removePage = (index: number) => {
    Alert.alert('Remove page', 'Remove this page from your submission?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setImages(prev => prev.filter((_, i) => i !== index)),
      },
    ]);
  };

  const handleDone = () => {
    if (images.length === 0) {
      Alert.alert('No pages captured', 'Capture at least one page before continuing.');
      return;
    }
    navigation.navigate('StudentPreview', {
      images,
      answer_key_id,
      answer_key_title,
      class_id,
    });
  };

  return (
    <>
      <InAppCamera
        visible={cameraVisible}
        onCapture={handleCameraCapture}
        onClose={() => setCameraVisible(false)}
        quality={0.85}
        warningMessage="Your submission photo is unclear. Please retake or choose a clearer image — your teacher needs to read your answers."
      />
      <View style={styles.container}>
      {/* Assignment context */}
      <View style={styles.header}>
        <Text style={styles.assignmentLabel}>Assignment</Text>
        <Text style={styles.assignmentTitle}>{answer_key_title}</Text>
      </View>

      {/* Page counter */}
      <Text style={styles.pageCount}>
        {images.length === 0
          ? 'No pages captured yet'
          : `${images.length} page${images.length !== 1 ? 's' : ''} captured`}
      </Text>

      {/* Thumbnail strip */}
      {images.length > 0 && (
        <ScrollView
          horizontal
          style={styles.thumbnailScroll}
          contentContainerStyle={styles.thumbnailContent}
          showsHorizontalScrollIndicator={false}
        >
          {images.map((uri, index) => (
            <TouchableOpacity
              key={uri}
              style={styles.thumbnailWrapper}
              onLongPress={() => removePage(index)}
              onPress={() => removePage(index)}
            >
              <Image source={{ uri }} style={styles.thumbnail} />
              <View style={styles.thumbnailBadge}>
                <Text style={styles.thumbnailBadgeText}>{index + 1}</Text>
              </View>
              <View style={styles.thumbnailRemove}>
                <Text style={styles.thumbnailRemoveText}>✕</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Frame guide */}
      <View style={styles.frameGuide}>
        <View style={styles.frameInner}>
          {/* Corner brackets */}
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
          <Text style={styles.frameHint}>Align page within this area</Text>
        </View>
      </View>

      {/* Tip */}
      <View style={styles.tip}>
        <Text style={styles.tipText}>
          Tip: Lay the book flat, hold the phone directly above, and ensure all text is visible.
        </Text>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.captureBtn}
          onPress={captureImage}
        >
          <View style={styles.captureBtnInner}>
            <Ionicons name="camera-outline" size={18} color={COLORS.white} />
            <Text style={styles.captureBtnText}>
              {'  '}{images.length === 0 ? 'Capture Page 1' : 'Add Another Page'}
            </Text>
          </View>
        </TouchableOpacity>

        {images.length > 0 && (
          <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
            <Text style={styles.doneBtnText}>Preview & Continue →</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    backgroundColor: COLORS.teal500,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  assignmentLabel: { color: COLORS.teal100, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  assignmentTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginTop: 2 },
  pageCount: {
    textAlign: 'center',
    color: COLORS.gray500,
    fontSize: 14,
    marginVertical: 16,
  },
  thumbnailScroll: { maxHeight: 130, flexGrow: 0 },
  thumbnailContent: { paddingHorizontal: 16, gap: 10 },
  thumbnailWrapper: {
    width: 90,
    height: 110,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.teal500,
  },
  thumbnail: { width: '100%', height: '100%' },
  thumbnailBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: COLORS.teal500,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  thumbnailBadgeText: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  thumbnailRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailRemoveText: { color: COLORS.white, fontSize: 11 },
  frameGuide: {
    marginHorizontal: 16,
    marginTop: 8,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frameInner: {
    width: '88%',
    height: 140,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 8,
    backgroundColor: COLORS.gray50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
  },
  cornerTL: {
    top: -1,
    left: -1,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: COLORS.teal500,
    borderTopLeftRadius: 6,
  },
  cornerTR: {
    top: -1,
    right: -1,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: COLORS.teal500,
    borderTopRightRadius: 6,
  },
  cornerBL: {
    bottom: -1,
    left: -1,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: COLORS.teal500,
    borderBottomLeftRadius: 6,
  },
  cornerBR: {
    bottom: -1,
    right: -1,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: COLORS.teal500,
    borderBottomRightRadius: 6,
  },
  frameHint: {
    color: COLORS.gray500,
    fontSize: 12,
    fontStyle: 'italic',
  },
  tip: {
    margin: 16,
    marginTop: 8,
    backgroundColor: COLORS.amber50,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.amber300,
  },
  tipText: { color: COLORS.amber700, fontSize: 13, lineHeight: 19 },
  actions: { padding: 20, gap: 12 },
  captureBtn: {
    backgroundColor: COLORS.teal500,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  captureBtnInner: { flexDirection: 'row', alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  captureBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  doneBtn: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.teal500,
  },
  doneBtnText: { color: COLORS.teal500, fontSize: 16, fontWeight: '700' },
});
