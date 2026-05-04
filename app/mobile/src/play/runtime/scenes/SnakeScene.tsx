// src/play/runtime/scenes/SnakeScene.tsx
//
// Classic snake on a 12×16 grid. Head is amber, body is teal-500. Four
// food tiles labeled A/B/C/D are placed at random non-occupied cells in
// their locked teal colours. Swipe up/down/left/right to set direction
// (the snake auto-moves on a timer scaled by speedMultiplier). Eating
// the correct food: +2, body grows +1, food respawns. Wrong food: tail
// shrinks. Wall or self collision: instant loss.

import { Canvas, Rect } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import type { AnswerLetter, SceneProps } from '../types';

const COLS = 12;
const ROWS = 16;
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
const HEAD_COLOR = '#F5A623'; // amber
const BODY_COLOR = '#0D7377'; // teal500

const BASE_TICK_SECONDS = 0.32; // base snake step

type Direction = 'up' | 'down' | 'left' | 'right';

interface Cell {
  c: number;
  r: number;
}

interface FoodTile extends Cell {
  letter: AnswerLetter;
}

interface SnakeProps extends SceneProps {
  loseSignal?: boolean;
  /** Engine ticks this when an answer was wrong → tail shrinks. */
  wrongAnswerTick?: number;
  /** Engine ticks this when an answer was correct → body grows. */
  correctAnswerTick?: number;
}

const SnakeScene: React.FC<SnakeProps> = ({
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
  const cellW = width / COLS;
  const cellH = height / ROWS;
  const cellSize = Math.min(cellW, cellH);
  const gridW = cellSize * COLS;
  const gridH = cellSize * ROWS;
  const offX = (width - gridW) / 2;
  const offY = (height - gridH) / 2;

  // Initial snake: length 4 going right at center
  const initialSnake: Cell[] = useMemo(
    () =>
      Array.from({ length: 4 }).map((_, i) => ({
        c: Math.floor(COLS / 2) - i,
        r: Math.floor(ROWS / 2),
      })),
    [],
  );

  const [snake, setSnake] = useState<Cell[]>(initialSnake);
  const [dir, setDir] = useState<Direction>('right');
  const [foods, setFoods] = useState<FoodTile[]>(() =>
    placeFoods(initialSnake),
  );
  const [pendingGrow, setPendingGrow] = useState<number>(0);
  const [pendingShrink, setPendingShrink] = useState<number>(0);

  const snakeRef = useRef<Cell[]>(snake);
  const dirRef = useRef<Direction>(dir);
  const foodsRef = useRef<FoodTile[]>(foods);
  const lossFiredRef = useRef<boolean>(false);
  const speedRef = useRef<number>(speedMultiplier);
  const pausedRef = useRef<boolean>(paused);
  const pendingGrowRef = useRef<number>(0);
  const pendingShrinkRef = useRef<number>(0);
  speedRef.current = speedMultiplier;
  pausedRef.current = paused;
  snakeRef.current = snake;
  dirRef.current = dir;
  foodsRef.current = foods;
  pendingGrowRef.current = pendingGrow;
  pendingShrinkRef.current = pendingShrink;

  // HUD: length
  useEffect(() => {
    onHudHintsChange?.({ lengthRemaining: snake.length });
  }, [snake.length, onHudHintsChange]);

  // Wrong answer → schedule shrink
  const lastWrongRef = useRef<number | undefined>(wrongAnswerTick);
  useEffect(() => {
    if (
      wrongAnswerTick !== undefined &&
      wrongAnswerTick !== lastWrongRef.current
    ) {
      lastWrongRef.current = wrongAnswerTick;
      setPendingShrink((p) => p + 1);
    }
  }, [wrongAnswerTick]);

  // Correct answer → schedule grow
  const lastCorrectRef = useRef<number | undefined>(correctAnswerTick);
  useEffect(() => {
    if (
      correctAnswerTick !== undefined &&
      correctAnswerTick !== lastCorrectRef.current
    ) {
      lastCorrectRef.current = correctAnswerTick;
      setPendingGrow((p) => p + 1);
    }
  }, [correctAnswerTick]);

  useEffect(() => {
    if (loseSignal && !lossFiredRef.current) {
      lossFiredRef.current = true;
      onLoss('length_zero');
    }
  }, [loseSignal, onLoss]);

  // Swipe gestures
  const pan = useMemo(
    () =>
      Gesture.Pan().onEnd((e) => {
        const dx = e.translationX ?? 0;
        const dy = e.translationY ?? 0;
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0 && dirRef.current !== 'left') {
            dirRef.current = 'right';
            setDir('right');
          } else if (dx < 0 && dirRef.current !== 'right') {
            dirRef.current = 'left';
            setDir('left');
          }
        } else {
          if (dy > 0 && dirRef.current !== 'up') {
            dirRef.current = 'down';
            setDir('down');
          } else if (dy < 0 && dirRef.current !== 'down') {
            dirRef.current = 'up';
            setDir('up');
          }
        }
      }),
    [],
  );

  // Tick loop
  useEffect(() => {
    let raf: number | null = null;
    let last = Date.now();
    let acc = 0;

    const loop = () => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      if (!pausedRef.current && !lossFiredRef.current) {
        acc += dt;
        const tick = BASE_TICK_SECONDS / Math.max(0.5, speedRef.current);
        while (acc >= tick) {
          acc -= tick;
          stepOnce();
          if (lossFiredRef.current) break;
        }
      }
      raf = requestAnimationFrame(loop);
    };

    const stepOnce = () => {
      const head = snakeRef.current[0];
      const next = applyDir(head, dirRef.current);
      // Wall collision
      if (next.c < 0 || next.c >= COLS || next.r < 0 || next.r >= ROWS) {
        if (!lossFiredRef.current) {
          lossFiredRef.current = true;
          onLoss('collision');
        }
        return;
      }
      // Self collision (against any segment except the tail since it moves)
      const willGrow = pendingGrowRef.current > 0;
      const body = willGrow
        ? snakeRef.current
        : snakeRef.current.slice(0, -1);
      if (body.some((s) => s.c === next.c && s.r === next.r)) {
        if (!lossFiredRef.current) {
          lossFiredRef.current = true;
          onLoss('collision');
        }
        return;
      }

      // Food check
      const foodHit = foodsRef.current.find(
        (f) => f.c === next.c && f.r === next.r,
      );
      if (foodHit) {
        onAnswer(foodHit.letter);
        // Respawn that food at a new spot
        const newFoods = foodsRef.current.map((f) =>
          f.letter === foodHit.letter
            ? { ...f, ...randomFreeCell([next, ...snakeRef.current], foodsRef.current.filter((g) => g.letter !== f.letter)) }
            : f,
        );
        foodsRef.current = newFoods;
        setFoods(newFoods);
      }

      // Apply pending grow / shrink AFTER move
      let nextSnake: Cell[];
      if (pendingGrowRef.current > 0) {
        nextSnake = [next, ...snakeRef.current];
        pendingGrowRef.current = pendingGrowRef.current - 1;
        setPendingGrow(pendingGrowRef.current);
      } else {
        nextSnake = [next, ...snakeRef.current.slice(0, -1)];
      }
      // Apply queued shrinks (one tail segment per pending shrink)
      while (pendingShrinkRef.current > 0 && nextSnake.length > 1) {
        nextSnake = nextSnake.slice(0, -1);
        pendingShrinkRef.current = pendingShrinkRef.current - 1;
      }
      setPendingShrink(pendingShrinkRef.current);

      // Length-zero loss
      if (nextSnake.length <= 1 && pendingShrinkRef.current > 0) {
        if (!lossFiredRef.current) {
          lossFiredRef.current = true;
          onLoss('length_zero');
        }
      }

      snakeRef.current = nextSnake;
      setSnake(nextSnake);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render
  return (
    <View style={[styles.root, { width, height }]}>
      <GestureDetector gesture={pan}>
        <View style={[StyleSheet.absoluteFill]}>
          <Canvas style={{ width, height }}>
            <Rect x={0} y={0} width={width} height={height} color="#04342C" />

            {/* Grid background */}
            <Rect
              x={offX}
              y={offY}
              width={gridW}
              height={gridH}
              color="rgba(8,80,65,0.6)"
            />

            {/* Snake body */}
            {snake.slice(1).map((seg, i) => (
              <Rect
                key={`b${i}`}
                x={offX + seg.c * cellSize + 1}
                y={offY + seg.r * cellSize + 1}
                width={cellSize - 2}
                height={cellSize - 2}
                color={BODY_COLOR}
              />
            ))}
            {/* Snake head */}
            {snake[0] ? (
              <Rect
                x={offX + snake[0].c * cellSize + 1}
                y={offY + snake[0].r * cellSize + 1}
                width={cellSize - 2}
                height={cellSize - 2}
                color={HEAD_COLOR}
              />
            ) : null}

            {/* Food backgrounds */}
            {foods.map((f) => (
              <Rect
                key={`f${f.letter}`}
                x={offX + f.c * cellSize + 1}
                y={offY + f.r * cellSize + 1}
                width={cellSize - 2}
                height={cellSize - 2}
                color={COLORS_BY_LETTER[f.letter]}
              />
            ))}
          </Canvas>

          {/* Food letter overlay (RN text on top of canvas) */}
          {foods.map((f) => (
            <View
              key={`l${f.letter}`}
              pointerEvents="none"
              style={[
                styles.foodLabel,
                {
                  left: offX + f.c * cellSize,
                  top: offY + f.r * cellSize,
                  width: cellSize,
                  height: cellSize,
                },
              ]}
            >
              <Text
                style={[
                  styles.foodLetter,
                  {
                    color: TEXT_COLORS[f.letter],
                    fontSize: cellSize * 0.55,
                  },
                ]}
              >
                {f.letter}
              </Text>
            </View>
          ))}
        </View>
      </GestureDetector>
    </View>
  );
};

function applyDir(c: Cell, d: Direction): Cell {
  switch (d) {
    case 'up':
      return { c: c.c, r: c.r - 1 };
    case 'down':
      return { c: c.c, r: c.r + 1 };
    case 'left':
      return { c: c.c - 1, r: c.r };
    case 'right':
      return { c: c.c + 1, r: c.r };
  }
}

function placeFoods(snake: Cell[]): FoodTile[] {
  const occ = [...snake];
  const out: FoodTile[] = [];
  for (const letter of LETTERS) {
    const cell = randomFreeCell(occ, out);
    out.push({ letter, ...cell });
    occ.push(cell);
  }
  return out;
}

function randomFreeCell(occ: Cell[], extra: Cell[]): Cell {
  for (let attempts = 0; attempts < 200; attempts++) {
    const c = Math.floor(Math.random() * COLS);
    const r = Math.floor(Math.random() * ROWS);
    if (
      !occ.some((o) => o.c === c && o.r === r) &&
      !extra.some((o) => o.c === c && o.r === r)
    ) {
      return { c, r };
    }
  }
  return { c: 0, r: 0 };
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  foodLabel: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodLetter: {
    fontFamily: 'Georgia',
    fontWeight: '700',
  },
});

export default SnakeScene;
