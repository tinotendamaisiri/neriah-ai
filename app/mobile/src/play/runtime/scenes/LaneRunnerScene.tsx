// src/play/runtime/scenes/LaneRunnerScene.tsx
//
// Four-lane endless runner. The lanes are filled left-to-right with the
// locked answer-letter teals (A/B/C/D). A "checkpoint line" sweeps from
// the horizon down toward the runner; when it lines up with the runner
// the lane the runner is in becomes the player's pick — onAnswer fires
// for that letter. The player swipes left/right to snap between lanes.
//
// Loss: this scene reports loss via `onLoss('score_zero')` when the
// engine sets `loseSignal` true (the engine drives that — score=0 at
// the start of LaneRunner means the player exhausted the buffer of 5).
//
// All gameplay drawing is on a Skia canvas; the swipe is captured by a
// PanGesture overlay covering the canvas.

import {
  Canvas,
  Circle,
  LinearGradient,
  Rect,
  vec,
} from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import type { AnswerLetter, SceneProps } from '../types';

const LANE_COLORS = ['#0D7377', '#085041', '#3AAFA9', '#9FE1CB'];
const LETTER_BY_LANE: AnswerLetter[] = ['A', 'B', 'C', 'D'];

// Frame loop tuning
const BASE_SWEEP_SECONDS = 1.5; // seconds for the line to traverse from horizon to runner

interface LaneRunnerProps extends SceneProps {
  /** Engine-driven kill switch; when true, scene reports loss once. */
  loseSignal?: boolean;
}

const LaneRunnerScene: React.FC<LaneRunnerProps> = ({
  speedMultiplier,
  paused,
  onAnswer,
  onLoss,
  width,
  height,
  loseSignal,
}) => {
  // Runner's lane (0..3). Default to lane 0 (A).
  const [lane, setLane] = useState<number>(0);
  // Sweep progress 0..1 (0 = top horizon, 1 = at runner).
  const [progress, setProgress] = useState<number>(0);
  // Loss-fade tween
  const [lossFade, setLossFade] = useState<number>(0);

  const laneRef = useRef<number>(0);
  const lossFiredRef = useRef<boolean>(false);

  // Latest values readable by the loop without re-binding.
  const speedRef = useRef<number>(speedMultiplier);
  const pausedRef = useRef<boolean>(paused);
  speedRef.current = speedMultiplier;
  pausedRef.current = paused;

  // Loss propagation when engine flags it
  useEffect(() => {
    if (loseSignal && !lossFiredRef.current) {
      lossFiredRef.current = true;
      // brief teal-900 fade then onLoss
      const start = Date.now();
      const tick = () => {
        const t = Math.min(1, (Date.now() - start) / 350);
        setLossFade(t);
        if (t < 1) requestAnimationFrame(tick);
        else onLoss('score_zero');
      };
      tick();
    }
  }, [loseSignal, onLoss]);

  // Game loop — drives the sweep line. When it reaches the runner,
  // emit onAnswer for the current lane and reset the line to top.
  useEffect(() => {
    let raf: number | null = null;
    let last = Date.now();

    const loop = () => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;

      if (!pausedRef.current && !lossFiredRef.current) {
        const sweepRate = 1 / (BASE_SWEEP_SECONDS / Math.max(0.5, speedRef.current));
        setProgress((p) => {
          const next = p + sweepRate * dt;
          if (next >= 1) {
            // Sweep reached runner — emit answer for current lane.
            const pickedLane = laneRef.current;
            const letter = LETTER_BY_LANE[pickedLane] ?? 'A';
            onAnswer(letter);
            return 0;
          }
          return next;
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pan gesture: capture swipe direction, snap lane left or right.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onEnd((e) => {
          // Use translationX to decide direction
          const dx = e.translationX ?? 0;
          if (Math.abs(dx) < 20) return;
          if (dx < 0) {
            const next = Math.max(0, laneRef.current - 1);
            laneRef.current = next;
            setLane(next);
          } else {
            const next = Math.min(3, laneRef.current + 1);
            laneRef.current = next;
            setLane(next);
          }
        }),
    [],
  );

  // Geometry
  const laneWidth = width / 4;
  const horizonY = height * 0.08;
  const runnerY = height * 0.78;

  // Sweep line Y: interpolate horizon → runner
  const sweepY = horizonY + (runnerY - horizonY) * progress;

  // Runner X: lane center (lerp animated for snap feel)
  const runnerX = laneWidth * lane + laneWidth / 2;

  // Loss overlay
  const overlayAlpha = Math.max(0, Math.min(1, lossFade));

  return (
    <View style={[styles.root, { width, height }]}>
      <Canvas style={{ width, height }}>
        {/* Lanes */}
        {LANE_COLORS.map((color, i) => (
          <Rect
            key={i}
            x={i * laneWidth}
            y={0}
            width={laneWidth}
            height={height}
            color={color}
          />
        ))}

        {/* Subtle vertical gradient toward horizon for depth */}
        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={['rgba(4,52,44,0.55)', 'rgba(4,52,44,0)']}
          />
        </Rect>

        {/* Lane divider hairlines */}
        {[1, 2, 3].map((i) => (
          <Rect
            key={`d${i}`}
            x={i * laneWidth - 0.5}
            y={0}
            width={1}
            height={height}
            color="rgba(255,255,255,0.18)"
          />
        ))}

        {/* Sweep checkpoint line */}
        <Rect
          x={0}
          y={sweepY - 2}
          width={width}
          height={4}
          color="rgba(255,255,255,0.85)"
        />

        {/* Runner */}
        <Circle cx={runnerX} cy={runnerY} r={Math.min(18, laneWidth * 0.22)} color="#FFFFFF" />
        <Circle cx={runnerX} cy={runnerY} r={Math.min(8, laneWidth * 0.1)} color="#0D7377" />

        {/* Loss fade overlay */}
        {overlayAlpha > 0 ? (
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            color={`rgba(4, 52, 44, ${overlayAlpha})`}
          />
        ) : null}
      </Canvas>

      {/* Gesture target overlays the canvas */}
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
});

export default LaneRunnerScene;
