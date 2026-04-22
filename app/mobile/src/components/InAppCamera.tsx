// src/components/InAppCamera.tsx
// Full-screen in-app camera using expo-camera CameraView.
// Replaces every ImagePicker.launchCameraAsync call so the teacher never leaves the app.
//
// After capture:
//   1. enhanceImage() — resize to ≤2048px + EXIF normalise
//   2. checkImageQuality() — heuristic warnings (blur, dark, low-res)
//   3. Shows warning banner on preview if issues found (never blocks "Use Photo")
//   4. Reads enhanced URI as base64 and returns to parent
//
// Usage:
//   const [cameraVisible, setCameraVisible] = useState(false);
//   <InAppCamera
//     visible={cameraVisible}
//     onCapture={(base64, uri) => { setCameraVisible(false); /* use image */ }}
//     onClose={() => setCameraVisible(false)}
//   />

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Linking,
  Platform,
  Image,
  Dimensions,
  ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions, CameraType, FlashMode } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { enhanceImage } from '../services/imageEnhance';
import { checkImageQuality } from '../services/imageQuality';
import { COLORS } from '../constants/colors';

const { width: SW, height: SH } = Dimensions.get('window');

// ── Frame geometry ────────────────────────────────────────────────────────────
// The visible overlay frame is 95% of the screen width. Height fills the
// available space between the top margin and the shutter button area —
// no aspect-ratio cap, since exercise books come in different proportions
// and the crop step handles trimming. FRAME_TOP_MARGIN and SHUTTER_RESERVED
// are the ONLY knobs; everything else (renderer, mask, crop math) derives
// from them.
const FRAME_TOP_MARGIN = SH * 0.06;
const SHUTTER_RESERVED = 140;  // px reserved for shutter button + its padding
const FRAME_W = SW * 0.95;
const FRAME_H = SH - FRAME_TOP_MARGIN - SHUTTER_RESERVED;

export interface InAppCameraProps {
  visible: boolean;
  /** Called with base64 string and local URI of the enhanced image. */
  onCapture: (base64: string, uri: string) => void;
  /** Called when the user closes/cancels without capturing. */
  onClose: () => void;
  /** Camera capture quality 0–1. Defaults to 0.8. */
  quality?: number;
  /**
   * Override the first line of the quality warning banner.
   * Defaults to the teacher-facing message. Pass a student-specific message
   * when the camera is used in a student submission context.
   */
  warningMessage?: string;
}

interface PreviewState {
  uri: string;       // enhanced URI
  base64: string;    // base64 of enhanced image
  warnings: string[];
}

export default function InAppCamera({
  visible,
  onCapture,
  onClose,
  quality = 0.8,
  warningMessage = 'Image may be unclear — Gemma may struggle to read it. Retake for better results, or use as-is.',
}: InAppCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing]       = useState<CameraType>('back');
  const [flash, setFlash]         = useState<FlashMode>('off');
  const [processing, setProcessing] = useState(false);

  const [preview, setPreview] = useState<PreviewState | null>(null);

  const cameraRef = useRef<CameraView>(null);

  // ── Capture + enhance + quality check ────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || processing) return;
    setProcessing(true);
    try {
      // 1. Raw capture — no base64 here; we read it after enhancement
      const photo = await cameraRef.current.takePictureAsync({
        quality,
        base64: false,
        skipProcessing: false,
      });
      if (!photo?.uri) return;

      // 1b. Crop to the on-screen overlay frame. The sensor image is much
      //     larger than the preview (typically 3024×4032 vs ~400×850 points),
      //     so we scale the overlay rect by capturedWidth / previewWidth and
      //     apply the same factor in y. Falls back to the uncropped URI if
      //     manipulateAsync throws or if the image dimensions look wrong.
      let workingUri = photo.uri;
      try {
        const capturedW = photo.width;
        const capturedH = photo.height;
        if (capturedW && capturedH && capturedW > 0 && capturedH > 0) {
          // The preview dimensions equal the screen width/height in points.
          // The sensor is captured in landscape-native orientation even when
          // the phone is held portrait — expo-camera rotates the bytes for us
          // so `photo.width` is the final portrait width.
          const scaleX = capturedW / SW;
          const scaleY = capturedH / SH;
          const frameLeftPreview = (SW - FRAME_W) / 2;
          const frameTopPreview = FRAME_TOP_MARGIN;

          const cropX = Math.max(0, Math.round(frameLeftPreview * scaleX));
          const cropY = Math.max(0, Math.round(frameTopPreview  * scaleY));
          const cropW = Math.min(
            capturedW - cropX,
            Math.round(FRAME_W * scaleX),
          );
          const cropH = Math.min(
            capturedH - cropY,
            Math.round(FRAME_H * scaleY),
          );

          if (cropW > 0 && cropH > 0) {
            const cropped = await ImageManipulator.manipulateAsync(
              photo.uri,
              [{ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } }],
              { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG },
            );
            workingUri = cropped.uri;
          }
        }
      } catch (cropErr) {
        console.warn('[InAppCamera] crop failed — using uncropped image:', cropErr);
      }

      // 2. Enhance: resize to ≤2048px + EXIF normalise
      const enhancedUri = await enhanceImage(workingUri);

      // 3. Quality heuristics on the enhanced URI
      const qualityResult = await checkImageQuality(enhancedUri);

      // 4. Read enhanced file as base64 (FileSystem replaces the need for base64:true)
      const base64 = await FileSystem.readAsStringAsync(enhancedUri, {
        encoding: 'base64' as any,
      });

      setPreview({ uri: enhancedUri, base64, warnings: qualityResult.warnings });
    } catch (err) {
      console.warn('[InAppCamera] capture/enhance error:', err);
    } finally {
      setProcessing(false);
    }
  }, [processing, quality]);

  const handleUsePhoto = useCallback(() => {
    if (!preview) return;
    onCapture(preview.base64, preview.uri);
    setPreview(null);
  }, [preview, onCapture]);

  const handleRetake = useCallback(() => {
    setPreview(null);
  }, []);

  const handleClose = useCallback(() => {
    setPreview(null);
    onClose();
  }, [onClose]);

  const toggleFacing = useCallback(() => {
    setFacing(f => (f === 'back' ? 'front' : 'back'));
  }, []);

  const toggleFlash = useCallback(() => {
    setFlash(f => {
      if (f === 'off') return 'on';
      if (f === 'on') return 'auto';
      return 'off';
    });
  }, []);

  const flashLabel = flash === 'off' ? 'Off' : flash === 'on' ? 'On' : 'Auto';

  // ── Sub-renderers ─────────────────────────────────────────────────────────────

  const renderPermissionDenied = () => (
    <View style={styles.permissionContainer}>
      <Text style={styles.permissionTitle}>Camera Access Needed</Text>
      <Text style={styles.permissionBody}>
        Neriah needs camera access to photograph documents. Please allow camera access in
        Settings.
      </Text>
      <TouchableOpacity style={styles.settingsBtn} onPress={() => Linking.openSettings()}>
        <Text style={styles.settingsBtnText}>Open Settings</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPermissionPrompt = () => (
    <View style={styles.permissionContainer}>
      <Text style={styles.permissionTitle}>Camera Access</Text>
      <Text style={styles.permissionBody}>
        Neriah needs camera access to photograph question papers and student books.
      </Text>
      <TouchableOpacity style={styles.settingsBtn} onPress={requestPermission}>
        <Text style={styles.settingsBtnText}>Allow Camera</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const renderProcessing = () => (
    <View style={styles.processingContainer}>
      <ActivityIndicator color={COLORS.teal300} size="large" />
      <Text style={styles.processingText}>Enhancing photo…</Text>
    </View>
  );

  const renderPreview = () => {
    const hasWarnings = preview!.warnings.length > 0;
    return (
      <View style={styles.previewContainer}>
        {/* Warning banner — advisory, never blocks */}
        {hasWarnings && (
          <View style={styles.warningBanner}>
            <View style={styles.warningTitleRow}>
              <Ionicons name="warning-outline" size={14} color="#fef3c7" />
              <Text style={styles.warningTitle}> Image may be unclear</Text>
            </View>
            <Text style={styles.warningBody}>{warningMessage}</Text>
            <ScrollView style={styles.warningList} scrollEnabled={false}>
              {preview!.warnings.map((w, i) => (
                <Text key={i} style={styles.warningItem}>· {w}</Text>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Photo preview */}
        <Image
          source={{ uri: preview!.uri }}
          style={styles.previewImage}
          resizeMode="contain"
        />

        {/* Actions */}
        <View style={styles.previewActions}>
          <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
            <Text style={styles.retakeBtnText}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.usePhotoBtn, hasWarnings && styles.usePhotoBtnWarning]}
            onPress={handleUsePhoto}
          >
            <Text style={styles.usePhotoBtnText}>
              {hasWarnings ? 'Use Anyway' : 'Use Photo'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderCamera = () => (
    <View style={styles.cameraContainer}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash}
      />

      {/* ── Document frame overlay ─────────────────────────────────────────── */}
      {/* Dim mask + teal corner brackets guide the teacher to align the page  */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Top mask */}
        <View style={[styles.mask, { height: FRAME_TOP_MARGIN }]} />
        {/* Middle row */}
        <View style={styles.middleRow}>
          <View style={[styles.mask, { flex: 1 }]} />
          {/* Frame window — transparent so camera shows through */}
          <View style={styles.frameWindow}>
            {/* Corner brackets */}
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <View style={[styles.mask, { flex: 1 }]} />
        </View>
        {/* Bottom mask + hint */}
        <View style={[styles.mask, { flex: 1 }]}>
          <Text style={styles.frameHint}>Align the page within the frame</Text>
        </View>
      </View>

      {/* ── Top controls ──────────────────────────────────────────────────── */}
      {/* Only a close button — teachers don't need flash/flip toggles on an
          A4 exercise book; removing them simplifies the shooting UI. */}
      <View style={styles.topControls}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleClose}>
          <Ionicons name="close" size={20} color={COLORS.white} />
        </TouchableOpacity>
        <View />
        <View />
      </View>

      {/* ── Capture button ─────────────────────────────────────────────────── */}
      <View style={styles.captureRow}>
        <TouchableOpacity
          style={[styles.captureBtn, processing && styles.captureBtnDisabled]}
          onPress={handleCapture}
          disabled={processing}
          activeOpacity={0.7}
        >
          <View style={styles.captureInner} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const resolveContent = () => {
    if (!permission) return renderPermissionPrompt();
    if (!permission.granted && !permission.canAskAgain) return renderPermissionDenied();
    if (!permission.granted) return renderPermissionPrompt();
    if (processing) return renderProcessing();
    if (preview) return renderPreview();
    return renderCamera();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.root}>
        {resolveContent()}
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },

  // ── Permission / processing ─────────────────────────────────────────────────
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#111827',
  },
  permissionTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionBody: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
  },
  settingsBtn: {
    backgroundColor: COLORS.teal500,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  settingsBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 15 },
  cancelBtn: {
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  cancelBtnText: { color: '#9ca3af', fontSize: 14 },

  processingContainer: {
    flex: 1,
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  processingText: {
    color: '#9ca3af',
    fontSize: 14,
  },

  // ── Camera view ─────────────────────────────────────────────────────────────
  cameraContainer: {
    flex: 1,
  },

  // Frame overlay
  mask: {
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  middleRow: {
    flexDirection: 'row',
    height: FRAME_H,
  },
  frameWindow: {
    width: FRAME_W,
    height: FRAME_H,
    // Transparent — camera shows through
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
  },
  cornerTL: {
    top: 0, left: 0,
    borderTopWidth: 3, borderLeftWidth: 3,
    borderColor: COLORS.teal300,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 0, right: 0,
    borderTopWidth: 3, borderRightWidth: 3,
    borderColor: COLORS.teal300,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 0, left: 0,
    borderBottomWidth: 3, borderLeftWidth: 3,
    borderColor: COLORS.teal300,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 0, right: 0,
    borderBottomWidth: 3, borderRightWidth: 3,
    borderColor: COLORS.teal300,
    borderBottomRightRadius: 4,
  },
  frameHint: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 14,
  },

  // Top controls
  topControls: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 28,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flashLabel: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  flashLabelText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  topRight: {
    flexDirection: 'row',
    gap: 10,
  },

  // Capture button
  captureRow: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 48 : 32,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 5,
    borderColor: COLORS.teal300,
  },
  captureBtnDisabled: {
    opacity: 0.55,
  },
  captureInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: COLORS.teal500,
  },

  // ── Preview ─────────────────────────────────────────────────────────────────
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  warningBanner: {
    backgroundColor: '#78350f',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  warningTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  warningTitle: {
    color: '#fef3c7',
    fontSize: 13,
    fontWeight: '700',
  },
  warningBody: {
    color: '#fde68a',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 6,
  },
  warningList: {
    flexGrow: 0,
  },
  warningItem: {
    color: '#fcd34d',
    fontSize: 11,
    lineHeight: 16,
  },
  previewImage: {
    flex: 1,
    width: '100%',
  },
  previewActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 44 : 28,
    paddingTop: 16,
    gap: 12,
    backgroundColor: '#111827',
  },
  retakeBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.teal300,
    alignItems: 'center',
  },
  retakeBtnText: { color: COLORS.teal300, fontSize: 16, fontWeight: '700' },
  usePhotoBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 12,
    backgroundColor: COLORS.teal500,
    alignItems: 'center',
  },
  usePhotoBtnWarning: {
    backgroundColor: COLORS.amber300,
  },
  usePhotoBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
