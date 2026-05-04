// src/play/runtime/scenes/BlasterScene.tsx
//
// Starfield gameplay. A small triangular ship sits at the bottom centre.
// Four invaders labeled A/B/C/D in their locked teal colours descend
// from the top with a slow side-to-side oscillation. The player taps an
// invader to shoot it; that letter becomes the answer.
//
// Health: 4 segments. Each wrong shot drains one segment. Two correct
// in a row regenerates one. Health zero or any invader reaching the
// bottom triggers loss.

import { Canvas, Circle, Path, Rect, Skia } from '@shopify/react-native-skia';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AnswerLetter, SceneProps } from '../types';

const LETTERS: AnswerLetter[] = ['A', 'B', 'C', 'D'];
const COLORS_BY_LETTER: Record<AnswerLetter, string> = {
  A: '#0D7377',
  B: '#085041',
  C: '#3AAFA9',
  D: '#9FE1CB',
};
const TEXT_COLORS: Record<AnswerLetter, string> = {
  A: '#FFFFFF',
  B: '#FFFFFF',
  C: '#FFFFFF',
  D: '#085041',
};

const STAR_COUNT = 24;
const INVADER_BASE_FALL = 0.012; // fraction of height per second base
const HEALTH_MAX = 4;
const INVADER_SIZE_RATIO = 0.16; // of canvas width

interface Invader {
  letter: AnswerLetter;
  x: number; // 0..1 — relative center x
  y: number; // 0..1 — relative center y
  baseX: number; // anchor x for oscillation
  oscPhase: number;
}

interface Star {
  x: number;
  y: number;
  speed: number;
  size: number;
}

interface BlasterProps extends SceneProps {
  loseSignal?: boolean;
  /** Engine ticks this when an answer was wrong → drain health. */
  wrongAnswerTick?: number;
  /** Engine ticks this when an answer was correct → maybe regen. */
  correctAnswerTick?: number;
}

const BlasterScene: React.FC<BlasterProps> = ({
  speedMultiplier,
  paused,
  onAnswer,
  onLoss,
  onHudHintsChange,
  width,
  height,
  loseSignal,
  wrongAnswerTick,
  correctAnswerTick,
}) => {
  const [invaders, setInvaders] = useState<Invader[]>(() =>
    seedInvaders(),
  );
  const [stars, setStars] = useState<Star[]>(() => seedStars());
  const [health, setHealth] = useState<number>(HEALTH_MAX);
  const [streak, setStreak] = useState<number>(0);

  const invadersRef = useRef<Invader[]>(invaders);
  const starsRef = useRef<Star[]>(stars);
  const lossFiredRef = useRef<boolean>(false);
  const speedRef = useRef<number>(speedMultiplier);
  const pausedRef = useRef<boolean>(paused);
  const widthRef = useRef<number>(width);
  const heightRef = useRef<number>(height);
  speedRef.current = speedMultiplier;
  pausedRef.current = paused;
  widthRef.current = width;
  heightRef.current = height;
  invadersRef.current = invaders;
  starsRef.current = stars;

  useEffect(() => {
    onHudHintsChange?.({ health });
  }, [health, onHudHintsChange]);

  // Wrong answer → drain health
  const lastWrongRef = useRef<number | undefined>(wrongAnswerTick);
  useEffect(() => {
    if (
      wrongAnswerTick !== undefined &&
      wrongAnswerTick !== lastWrongRef.current
    ) {
      lastWrongRef.current = wrongAnswerTick;
      setStreak(0);
      setHealth((h) => {
        const next = Math.max(0, h - 1);
        if (next === 0 && !lossFiredRef.current) {
          lossFiredRef.current = true;
          onLoss('health_zero');
        }
        return next;
      });
    }
  }, [wrongAnswerTick, onLoss]);

  // Correct answer → bump streak; regen on every other one
  const lastCorrectRef = useRef<number | undefined>(correctAnswerTick);
  useEffect(() => {
    if (
      correctAnswerTick !== undefined &&
      correctAnswerTick !== lastCorrectRef.current
    ) {
      lastCorrectRef.current = correctAnswerTick;
      setStreak((s) => {
        const next = s + 1;
        if (next >= 2) {
          setHealth((h) => Math.min(HEALTH_MAX, h + 1));
          return 0;
        }
        return next;
      });
    }
  }, [correctAnswerTick]);

  useEffect(() => {
    if (loseSignal && !lossFiredRef.current) {
      lossFiredRef.current = true;
      onLoss('health_zero');
    }
  }, [loseSignal, onLoss]);

  // Game loop
  useEffect(() => {
    let raf: number | null = null;
    let last = Date.now();
    let elapsed = 0;

    const loop = () => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      elapsed += dt;

      if (!pausedRef.current && !lossFiredRef.current) {
        const fall = INVADER_BASE_FALL * Math.max(0.5, speedRef.current);
        const next = invadersRef.current.map((inv) => {
          const ny = inv.y + fall * dt;
          const osc = Math.sin(elapsed * 1.2 + inv.oscPhase) * 0.05;
          const nx = clamp01(inv.baseX + osc);
          return { ...inv, x: nx, y: ny };
        });
        // Loss check — any invader past 0.92 (just above ship)
        if (next.some((i) => i.y >= 0.92)) {
          if (!lossFiredRef.current) {
            lossFiredRef.current = true;
            onLoss('invader_breach');
          }
        }
        invadersRef.current = next;
        setInvaders(next);

        // Drift stars downward
        const sNext = starsRef.current.map((s) => {
          const ny = s.y + s.speed * dt;
          if (ny > 1)
            return {
              x: Math.random(),
              y: 0,
              speed: s.speed,
              size: s.size,
            };
          return { ...s, y: ny };
        });
        starsRef.current = sNext;
        setStars(sNext);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build ship triangle path
  const shipPath = (() => {
    const cx = width / 2;
    const baseY = height - 30;
    const p = Skia.Path.Make();
    p.moveTo(cx, baseY - 22);
    p.lineTo(cx - 14, baseY);
    p.lineTo(cx + 14, baseY);
    p.close();
    return p;
  })();

  const handleInvaderTap = (letter: AnswerLetter) => {
    if (pausedRef.current || lossFiredRef.current) return;
    onAnswer(letter);
    // Respawn the invader at top after a tap
    invadersRef.current = invadersRef.current.map((inv) =>
      inv.letter === letter
        ? { ...inv, y: 0, baseX: Math.random() * 0.8 + 0.1 }
        : inv,
    );
    setInvaders([...invadersRef.current]);
  };

  const invSize = width * INVADER_SIZE_RATIO;

  return (
    <View style={[styles.root, { width, height }]}>
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height} color="#04342C" />
        {/* Stars */}
        {stars.map((s, i) => (
          <Circle
            key={i}
            cx={s.x * width}
            cy={s.y * height}
            r={s.size}
            color="rgba(255,255,255,0.6)"
          />
        ))}
        {/* Ship */}
        <Path path={shipPath} color="#FFFFFF" />
      </Canvas>

      {/* Invaders rendered as RN Pressables to preserve hit-test reliability */}
      {invaders.map((inv) => {
        const px = inv.x * width - invSize / 2;
        const py = inv.y * height - invSize / 2;
        return (
          <Pressable
            key={inv.letter}
            onPress={() => handleInvaderTap(inv.letter)}
            style={[
              styles.invader,
              {
                left: px,
                top: py,
                width: invSize,
                height: invSize,
                backgroundColor: COLORS_BY_LETTER[inv.letter],
              },
            ]}
          >
            <Text
              style={[
                styles.invaderText,
                { color: TEXT_COLORS[inv.letter] },
              ]}
            >
              {inv.letter}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

function seedInvaders(): Invader[] {
  return LETTERS.map((letter, i) => ({
    letter,
    baseX: 0.15 + i * 0.235,
    x: 0.15 + i * 0.235,
    y: -0.05 - i * 0.1, // staggered start above the canvas
    oscPhase: Math.random() * Math.PI * 2,
  }));
}

function seedStars(): Star[] {
  const out: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    out.push({
      x: Math.random(),
      y: Math.random(),
      speed: 0.04 + Math.random() * 0.06,
      size: Math.random() < 0.7 ? 1 : 1.6,
    });
  }
  return out;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  invader: {
    position: 'absolute',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invaderText: {
    fontFamily: 'Georgia',
    fontSize: 24,
    fontWeight: '700',
  },
});

export default BlasterScene;
