// src/play/runtime/PauseOverlay.tsx
//
// Full-screen pause modal. Renders only when `visible`. Resume returns to
// play; Quit ends the session via the engine and routes to PlaySessionEnd.

import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import TrackedPressable from '../../components/TrackedPressable';
import { COLORS } from '../../constants/colors';

interface Props {
  visible: boolean;
  onResume: () => void;
  onQuit: () => void;
}

const PauseOverlay: React.FC<Props> = ({ visible, onResume, onQuit }) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onResume}
    >
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>Paused</Text>
          <Text style={styles.body}>Take a breath. Pick up where you left off.</Text>
          <View style={styles.btnRow}>
            <TrackedPressable
              analyticsId="play.game.pause.resume"
              onPress={onResume}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.btnPrimaryText}>Resume</Text>
            </TrackedPressable>
            <TrackedPressable
              analyticsId="play.game.pause.quit"
              onPress={onQuit}
              style={({ pressed }) => [
                styles.btn,
                styles.btnOutline,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.btnOutlineText}>Quit</Text>
            </TrackedPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(4, 52, 44, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 26,
    paddingHorizontal: 24,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 24,
    color: COLORS.teal700,
    marginBottom: 8,
  },
  body: {
    fontFamily: 'Georgia',
    fontSize: 14,
    color: COLORS.gray500,
    textAlign: 'center',
    marginBottom: 22,
  },
  btnRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  btnPrimary: {
    backgroundColor: COLORS.teal500,
  },
  btnPrimaryText: {
    fontFamily: 'Georgia',
    fontSize: 16,
    color: COLORS.white,
  },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: COLORS.teal500,
    backgroundColor: 'transparent',
  },
  btnOutlineText: {
    fontFamily: 'Georgia',
    fontSize: 16,
    color: COLORS.teal500,
  },
});

export default PauseOverlay;
