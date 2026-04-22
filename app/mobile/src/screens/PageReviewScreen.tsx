// src/screens/PageReviewScreen.tsx
// Multi-page submission staging screen.
//
// Flow: MarkingScreen captures the FIRST page via InAppCamera, navigates
// here with that page in initialPages. Teacher can:
//   - tap "+ Add page" to capture more (up to 5)
//   - tap a thumbnail to view it full-screen + zoom
//   - tap the X on a thumbnail to delete (with Alert confirm)
//   - reorder via up/down chevrons (no draggable-flatlist installed)
//   - tap "Submit N pages for grading"
//
// On submit success, navigates back to MarkingScreen with the markResult
// in route params. MarkingScreen re-runs its existing post-scan logic.
// On 409 DUPLICATE_SUBMISSION, navigates back with markError so MarkingScreen's
// "Replace existing?" dialog fires.

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  Dimensions,
  Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenContainer } from '../components/ScreenContainer';
import InAppCamera from '../components/InAppCamera';
import { submitTeacherScan } from '../services/api';
import { queueMarkingScan } from '../services/router';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants/colors';
import { CapturedPage, RootStackParamList } from '../types';

const { width: SW } = Dimensions.get('window');
const MAX_PAGES = 5;
const IMAGE_HEIGHT = 380;

type Route = { key: string; name: 'PageReview'; params: RootStackParamList['PageReview'] };

function _uid(): string {
  return `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function PageReviewScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<Route>();
  const { user } = useAuth();
  const { initialPages, studentId, answerKeyId, educationLevel, classId, className, replace } = route.params;

  const [pages, setPages] = useState<CapturedPage[]>(initialPages);
  const [selectedId, setSelectedId] = useState<string>(initialPages[0]?.id ?? '');
  const [showCamera, setShowCamera] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedPage = pages.find(p => p.id === selectedId) ?? pages[0];

  // ── Camera handlers ────────────────────────────────────────────────────────
  const openCamera = useCallback(() => {
    if (pages.length >= MAX_PAGES) return;
    setShowCamera(true);
  }, [pages.length]);

  const handleCameraCapture = useCallback((_b64: string, uri: string) => {
    // InAppCamera already cropped to the overlay frame and ran enhanceImage.
    // Width/height aren't surfaced by InAppCamera's onCapture signature today;
    // they're only used by the zoom view, where the Image component infers
    // them. Storing 0/0 — the renderer doesn't depend on them.
    setShowCamera(false);
    const newPage: CapturedPage = {
      id: _uid(),
      uri,
      width: 0,
      height: 0,
      capturedAt: Date.now(),
    };
    setPages(prev => [...prev, newPage]);
    setSelectedId(newPage.id);
  }, []);

  // ── Page management ────────────────────────────────────────────────────────
  const handleDeletePage = useCallback((pageId: string) => {
    const idx = pages.findIndex(p => p.id === pageId);
    if (idx < 0) return;
    Alert.alert(
      'Delete page?',
      `Remove page ${idx + 1} from this submission?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setPages(prev => {
              const next = prev.filter(p => p.id !== pageId);
              // If we deleted the currently-selected page, fall back to the
              // first remaining one (or empty selection if none left).
              if (selectedId === pageId) {
                setSelectedId(next[0]?.id ?? '');
              }
              return next;
            });
          },
        },
      ],
    );
  }, [pages, selectedId]);

  const movePage = useCallback((pageId: string, direction: -1 | 1) => {
    setPages(prev => {
      const idx = prev.findIndex(p => p.id === pageId);
      if (idx < 0) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (pages.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      // Find education level / class info from route params (passed in from
      // MarkingScreen — PageReview doesn't have access to selectedAnswerKey).
      const result = await submitTeacherScan({
        teacherId: '',  // server resolves from JWT; field unused server-side for auth
        studentId,
        answerKeyId,
        classId,
        educationLevel,
        pages: pages.map(p => ({ uri: p.uri })),
        replace: !!replace,
      });
      // Navigate back to Marking with the result. MarkingScreen reads
      // route.params.markResult on focus and runs its existing post-scan logic.
      navigation.navigate('Mark', {
        class_id: classId,
        class_name: className,
        education_level: educationLevel,
        answer_key_id: answerKeyId,
        markResult: result,
      });
    } catch (err: any) {
      // Split network failures from typed server errors. The api.ts axios
      // interceptor tags "no response reached server" with isOffline=true +
      // error_code='NO_CONNECTION' — treat that as "enqueue for replay" so
      // the teacher doesn't lose the scan. Everything else (409 duplicate,
      // 400 quality rejected, 5xx server) bubbles back to MarkingScreen
      // where the existing dialog/error UI lives.
      const isNetworkError = err?.isOffline === true || err?.error_code === 'NO_CONNECTION';
      if (isNetworkError) {
        try {
          await queueMarkingScan({
            teacher_id: user?.id ?? '',
            student_id: studentId,
            class_id: classId,
            answer_key_id: answerKeyId,
            education_level: educationLevel,
            pages: pages.map(p => ({ uri: p.uri })),
          });
        } catch {
          // Queue write is best-effort — an AsyncStorage failure shouldn't
          // block the teacher from moving on. Fall through to the same
          // "Saved offline" message; replay will just have nothing to replay.
        }
        Alert.alert(
          'Saved offline',
          "We'll grade this submission when you're back online. Continue with the next student.",
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
        return;
      }

      // Typed server error — hand it back to MarkingScreen. Ship the pages
      // so MarkingScreen can preload them for "Replace" on a 409.
      navigation.navigate('Mark', {
        class_id: classId,
        class_name: className,
        education_level: educationLevel,
        answer_key_id: answerKeyId,
        markError: {
          status: err?.status,
          error_code: err?.error_code,
          message: err?.message,
          extra: err?.extra,
        },
        pendingPages: pages,
      });
    } finally {
      setSubmitting(false);
    }
  }, [pages, submitting, studentId, answerKeyId, classId, className, educationLevel, replace, navigation]);

  // ── Renderers ──────────────────────────────────────────────────────────────
  const renderThumb = ({ item, index }: { item: CapturedPage; index: number }) => {
    const isSelected = item.id === selectedId;
    return (
      <View style={[styles.thumbWrap, isSelected && styles.thumbWrapSelected]}>
        <TouchableOpacity onPress={() => setSelectedId(item.id)} activeOpacity={0.8}>
          <Image source={{ uri: item.uri }} style={styles.thumb} />
          <View style={styles.pageBadge}>
            <Text style={styles.pageBadgeText}>{index + 1}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.thumbDelete}
          onPress={() => handleDeletePage(item.id)}
          accessibilityLabel="Delete page"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={12} color={COLORS.white} />
        </TouchableOpacity>
        {/* Reorder chevrons — visible only when there's somewhere to move to. */}
        <View style={styles.reorderRow}>
          <TouchableOpacity
            style={[styles.reorderBtn, index === 0 && styles.reorderBtnDisabled]}
            onPress={() => movePage(item.id, -1)}
            disabled={index === 0}
            accessibilityLabel="Move page left"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={12} color={index === 0 ? COLORS.gray200 : COLORS.teal500} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reorderBtn, index === pages.length - 1 && styles.reorderBtnDisabled]}
            onPress={() => movePage(item.id, 1)}
            disabled={index === pages.length - 1}
            accessibilityLabel="Move page right"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-forward" size={12} color={index === pages.length - 1 ? COLORS.gray200 : COLORS.teal500} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderAddTile = () => {
    if (pages.length >= MAX_PAGES) return null;
    return (
      <TouchableOpacity style={styles.addTile} onPress={openCamera} activeOpacity={0.7}>
        <Ionicons name="add" size={28} color={COLORS.teal500} />
        <Text style={styles.addTileText}>Add page</Text>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer scroll={false}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review pages</Text>
        <Text style={styles.counter}>{pages.length} / {MAX_PAGES}</Text>
      </View>

      {/* Selected page — full-width with pinch-to-zoom (iOS) */}
      <View style={styles.imageCard}>
        {selectedPage ? (
          <ScrollView
            style={styles.imageScroll}
            contentContainerStyle={styles.imageScrollContent}
            maximumZoomScale={5}
            minimumZoomScale={1}
            bouncesZoom
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent
            pinchGestureEnabled
          >
            <Image source={{ uri: selectedPage.uri }} style={styles.fullImage} resizeMode="contain" />
          </ScrollView>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="document-outline" size={48} color={COLORS.gray200} />
            <Text style={styles.emptyText}>No pages — add one to get started.</Text>
          </View>
        )}
      </View>

      {/* Thumbnail strip + add tile */}
      <View style={styles.stripContainer}>
        <FlatList
          data={pages}
          renderItem={renderThumb}
          keyExtractor={p => p.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stripContent}
          ListFooterComponent={renderAddTile()}
        />
      </View>

      {/* Submit button */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.submitBtn,
            (pages.length === 0 || submitting) && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={pages.length === 0 || submitting}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.submitBtnText}>
              Submit {pages.length} page{pages.length === 1 ? '' : 's'} for grading
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* InAppCamera modal — opened by "+ Add page". Untouched component, the
          PageReviewScreen owns the open/close state and adds the captured
          page to its local state. */}
      <InAppCamera
        visible={showCamera}
        onCapture={handleCameraCapture}
        onClose={() => setShowCamera(false)}
        quality={0.85}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 8 : 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, flex: 1 },
  counter: {
    fontSize: 13, fontWeight: '600', color: COLORS.gray500,
    backgroundColor: COLORS.background,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
  },

  imageCard: {
    width: '100%', height: IMAGE_HEIGHT,
    backgroundColor: COLORS.background,
    overflow: 'hidden',
  },
  imageScroll: { flex: 1 },
  imageScrollContent: { flexGrow: 1, justifyContent: 'center' },
  fullImage: { width: SW, height: IMAGE_HEIGHT },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { color: COLORS.gray500, fontSize: 13 },

  stripContainer: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  stripContent: { paddingHorizontal: 16, gap: 12, alignItems: 'flex-start' },

  thumbWrap: {
    width: 80,
    alignItems: 'center',
    gap: 4,
    padding: 4,
    borderRadius: 8,
  },
  thumbWrapSelected: {
    backgroundColor: COLORS.teal50,
  },
  thumb: {
    width: 72, height: 96,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    backgroundColor: COLORS.white,
  },
  pageBadge: {
    position: 'absolute', top: 4, left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  pageBadgeText: { color: COLORS.white, fontSize: 10, fontWeight: '700' },
  thumbDelete: {
    position: 'absolute', top: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.error,
    alignItems: 'center', justifyContent: 'center',
  },
  reorderRow: {
    flexDirection: 'row', gap: 8,
  },
  reorderBtn: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.white,
    borderWidth: 1, borderColor: COLORS.teal100,
    alignItems: 'center', justifyContent: 'center',
  },
  reorderBtnDisabled: { borderColor: COLORS.gray200 },

  addTile: {
    width: 72, height: 96,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.teal300,
    borderStyle: 'dashed',
    backgroundColor: COLORS.teal50,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  addTileText: { fontSize: 11, color: COLORS.teal500, fontWeight: '600', marginTop: 2 },

  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  submitBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 16 },
});
