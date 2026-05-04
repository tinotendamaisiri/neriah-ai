// src/play/runtime/scenes/StackerScene.tsx
//
// 8-cell wide × 12-cell tall grid. The bottom row is split into 4 bins
// (A/B/C/D, each 2 cells wide). A teal block falls from the top, the
// player taps a bin to steer the block toward it; when the block lands
// in whatever bin is closest, the lane is emitted as the answer.
//
// Wrong answer → the bin row pushes up by 1 cell. Loss when the bin
// row reaches the question banner zone (top of canvas).

import { Canvas, Rect } from '@shopify/react-native-skia';
import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import type { AnswerLetter, SceneProps } from '../types';

const COLS = 8;
const ROWS = 12;
const BIN_LETTERS: AnswerLetter[] = ['A', 'B', 'C', 'D'];
const BIN_COLORS = ['#0D7377', '#085041', '#3AAFA9', '#9FE1CB'];
const BIN_TEXT_COLORS = ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#085041'];

const BLOCK_FALL_SECONDS = 3.0; // base fall time top→bottom

interface StackerProps extends SceneProps {
  /** Engine-driven kill switch. */
  loseSignal?: boolean;
  /** Engine signals "wrong answer just submitted" so we bump the bin row up. */
  wrongAnswerTick?: number;
}

const StackerScene: React.FC<StackerProps> = ({
  speedMultiplier,
  paused,
  onAnswer,
  onLoss,
  onHudHintsChange,
  width,
  height,
  loseSignal,
  wrongAnswerTick,
}) => {
  const cellH = height / ROWS;

  const [blockX, setBlockX] = useState<number>(width / 2);
  const [blockY, setBlockY] = useState<number>(0); // 0..1
  const [binOffset, setBinOffset] = useState<number>(0);

  const targetXRef = useRef<number>(width / 2);
  const blockYRef = useRef<number>(0);
  const blockXRef = useRef<number>(width / 2);
  const lossFiredRef = useRef<boolean>(false);
  const speedRef = useRef<number>(speedMultiplier);
  const pausedRef = useRef<boolean>(paused);
  const widthRef = useRef<number>(width);
  speedRef.current = speedMultiplier;
  pausedRef.current = paused;
  widthRef.current = width;

  // HUD hints
  useEffect(() => {
    onHudHintsChange?.({ binRowOffset: binOffset });
  }, [binOffset, onHudHintsChange]);

  // Wrong answer → push bins up
  const lastWrongRef = useRef<number | undefined>(wrongAnswerTick);
  useEffect(() => {
    if (
      wrongAnswerTick !== undefined &&
      wrongAnswerTick !== lastWrongRef.current
    ) {
      lastWrongRef.current = wrongAnswerTick;
      setBinOffset((b) => {
        const next = b + 1;
        if (next * cellH >= height - cellH * 2 && !lossFiredRef.current) {
          lossFiredRef.current = true;
          onLoss('bins_overflow');
        }
        return next;
      });
    }
  }, [wrongAnswerTick, cellH, height, onLoss]);

  useEffect(() => {
    if (loseSignal && !lossFiredRef.current) {
      lossFiredRef.current = true;
      onLoss('bins_overflow');
    }
  }, [loseSignal, onLoss]);

  // Game loop
  useEffect(() => {
    let raf: number | null = null;
    let last = Date.now();

    const loop = () => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;

      if (!pausedRef.current && !lossFiredRef.current) {
        const fallRate = 1 / (BLOCK_FALL_SECONDS / Math.max(0.5, speedRef.current));
        let nextY = blockYRef.current + fallRate * dt;

        const steerSpeed = widthRef.current * 1.5;
        const dx = targetXRef.current - blockXRef.current;
        const move = Math.sign(dx) * Math.min(Math.abs(dx), steerSpeed * dt);
        const nextX = blockXRef.current + move;
        blockXRef.current = nextX;
        setBlockX(nextX);

        if (nextY >= 1) {
          const bin = pickBin(blockXRef.current, widthRef.current);
          const letter = BIN_LETTERS[bin];
          onAnswer(letter);
          nextY = 0;
          const startX = widthRef.current / 2;
          blockXRef.current = startX;
          targetXRef.current = startX;
          setBlockX(startX);
        }
        blockYRef.current = nextY;
        setBlockY(nextY);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_e, g) => {
        targetXRef.current = clampX(g.x0, widthRef.current);
      },
      onPanResponderMove: (_e, g) => {
        targetXRef.current = clampX(g.moveX, widthRef.current);
      },
    }),
  ).current;

  const binTop = height - cellH - cellH * binOffset;
  const blockSize = cellH * 0.9;
  const blockPxY = blockY * (binTop - blockSize);

  return (
    <View style={[styles.root, { width, height }]} {...responder.panHandlers}>
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height} color="#04342C" />
        {BIN_COLORS.map((c, i) => (
          <Rect
            key={i}
            x={i * (width / 4)}
            y={binTop}
            width={width / 4}
            height={cellH}
            color={c}
          />
        ))}
        <Rect
          x={blockX - blockSize / 2}
          y={blockPxY}
          width={blockSize}
          height={blockSize}
          color="#3AAFA9"
        />
        <Rect
          x={blockX - blockSize / 2}
          y={blockPxY}
          width={blockSize}
          height={blockSize}
          color="rgba(255,255,255,0.18)"
        />
      </Canvas>

      <View
        pointerEvents="none"
        style={[styles.binLabelRow, { top: binTop, height: cellH }]}
      >
        {BIN_LETTERS.map((letter, i) => (
          <View key={letter} style={styles.binLabelCell}>
            <Text
              style={[
                styles.binLabelText,
                { color: BIN_TEXT_COLORS[i] },
              ]}
            >
              {letter}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

function pickBin(blockX: number, width: number): number {
  const idx = Math.floor(blockX / (width / 4));
  return Math.max(0, Math.min(3, idx));
}

function clampX(x: number, width: number): number {
  return Math.max(8, Math.min(width - 8, x));
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  binLabelRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
  },
  binLabelCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  binLabelText: {
    fontFamily: 'Georgia',
    fontSize: 22,
    fontWeight: '700',
  },
});

export default StackerScene;
