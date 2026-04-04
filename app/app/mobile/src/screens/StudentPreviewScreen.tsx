// src/screens/StudentPreviewScreen.tsx
// Swipeable gallery of captured pages. Allows retaking individual pages.

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Dimensions,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StudentRootStackParamList } from '../types';
import { COLORS } from '../constants/colors';

type Props = NativeStackScreenProps<StudentRootStackParamList, 'StudentPreview'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function StudentPreviewScreen({ route, navigation }: Props) {
  const { answer_key_id, answer_key_title, class_id } = route.params;
  const [images, setImages] = useState<string[]>(route.params.images);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setCurrentIndex(page);
  };

  const retakePage = async (index: number) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed to retake the photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets[0]) {
      setImages(prev => {
        const updated = [...prev];
        updated[index] = result.assets[0].uri;
        return updated;
      });
    }
  };

  const handleContinue = () => {
    navigation.navigate('StudentConfirm', {
      images,
      answer_key_id,
      answer_key_title,
      class_id,
    });
  };

  return (
    <View style={styles.container}>
      {/* Page indicator */}
      <View style={styles.indicatorRow}>
        {images.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === currentIndex && styles.dotActive]}
          />
        ))}
      </View>

      <Text style={styles.pageLabel}>
        Page {currentIndex + 1} of {images.length}
      </Text>

      {/* Swipeable images */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={styles.gallery}
      >
        {images.map((uri, index) => (
          <View key={uri + index} style={styles.pageContainer}>
            <Image source={{ uri }} style={styles.pageImage} resizeMode="contain" />
          </View>
        ))}
      </ScrollView>

      {/* Retake button for current page */}
      <View style={styles.retakeRow}>
        <TouchableOpacity
          style={styles.retakeBtn}
          onPress={() => retakePage(currentIndex)}
        >
          <Text style={styles.retakeBtnText}>🔄  Retake Page {currentIndex + 1}</Text>
        </TouchableOpacity>
      </View>

      {/* Quality tip */}
      <View style={styles.tip}>
        <Text style={styles.tipText}>
          Swipe to check each page. Retake any that are blurry or cut off.
        </Text>
      </View>

      {/* Continue */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.continueBtn} onPress={handleContinue}>
          <Text style={styles.continueBtnText}>
            Submit {images.length} Page{images.length !== 1 ? 's' : ''} →
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  indicatorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 14,
    paddingBottom: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4b5563',
  },
  dotActive: { backgroundColor: COLORS.teal500, width: 18 },
  pageLabel: {
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 8,
  },
  gallery: { flex: 1 },
  pageContainer: {
    width: SCREEN_WIDTH,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  pageImage: {
    width: SCREEN_WIDTH - 16,
    height: '100%',
    borderRadius: 8,
  },
  retakeRow: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  retakeBtn: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#1f2937',
  },
  retakeBtnText: { color: '#d1d5db', fontSize: 14, fontWeight: '600' },
  tip: {
    margin: 16,
    marginBottom: 4,
    backgroundColor: '#1f2937',
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.teal500,
  },
  tipText: { color: '#9ca3af', fontSize: 12, lineHeight: 18 },
  footer: { padding: 16, paddingBottom: 24 },
  continueBtn: {
    backgroundColor: COLORS.teal500,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
