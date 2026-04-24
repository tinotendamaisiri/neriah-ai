// src/components/LocalAnnotationOverlay.tsx
// Visual overlay drawn on top of an UN-annotated page image when a MarkResult
// came from offline (on-device) grading. Matches the Pillow annotator's visual
// contract (shared/annotator.py) — same colours, same per-verdict symbol +
// label, same bottom-right score bubble — but composed in React Native so no
// baked image is needed.
//
// Positioning rules mirror `_resolve_verdict_position` in the Python annotator:
//   - question_x / question_y are fractions of image dimensions (0.0-1.0)
//     clamped to [0.05, 0.95] so symbols never bleed off the edge.
//   - When qx/qy are missing (which is the usual case offline, because OCR
//     gives no spatial info), fall back to evenly-spaced left margin:
//     x = 0.05, y = (index + 0.5) / total.
//
// The overlay is positioned with StyleSheet.absoluteFill and expects to
// sit inside a View whose bounds match the rendered page image — the caller
// is responsible for that alignment.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GradingVerdict, GradingVerdictEnum } from '../types';

// Matches shared/annotator.py palette.
const VERDICT_COLOUR: Record<GradingVerdictEnum, string> = {
  correct: '#22C55E',
  incorrect: '#EF4444',
  partial: '#F59E0B',
};

const VERDICT_SYMBOL: Record<GradingVerdictEnum, string> = {
  correct: '✓',
  incorrect: '✗',
  partial: '~',
};

interface LocalAnnotationOverlayProps {
  /** Verdicts that apply to the page this overlay is drawn on. Pre-filter by
   *  page_index before passing in. */
  verdicts: GradingVerdict[];
  /** Rendered width/height of the page image this overlay sits on top of.
   *  Must match the Image's actual bounds, not the container — otherwise
   *  symbols land in the wrong place. */
  width: number;
  height: number;
  /** Overall score bubble. When omitted, no bubble is rendered — pass only on
   *  the page the bubble should appear on (typically the last page). */
  summary?: {
    score: number;
    max_score: number;
    percentage: number;
  };
}

// Clamp helper — keeps symbols in the visible [0.05, 0.95] band.
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function pickColour(pct: number): string {
  if (pct >= 75) return VERDICT_COLOUR.correct;
  if (pct >= 50) return VERDICT_COLOUR.partial;
  return VERDICT_COLOUR.incorrect;
}

export default function LocalAnnotationOverlay({
  verdicts,
  width,
  height,
  summary,
}: LocalAnnotationOverlayProps) {
  const total = Math.max(verdicts.length, 1);
  // Symbol size: 4% of image height, floored at 40px — matches the Pillow
  // annotator's `max(40, int(height * 0.04))`.
  const symbolSize = Math.max(40, Math.round(height * 0.04));
  const labelSize = Math.max(11, Math.round(symbolSize * 0.4));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {verdicts.map((v, i) => {
        const colour = VERDICT_COLOUR[v.verdict] ?? VERDICT_COLOUR.incorrect;
        const symbol = VERDICT_SYMBOL[v.verdict] ?? VERDICT_SYMBOL.incorrect;

        // Prefer per-verdict qx/qy when present (cloud verdicts will have
        // them; offline ones typically won't). Fall back to evenly-spaced
        // left margin, matching the backend annotator exactly.
        const qxRaw = typeof v.question_x === 'number' ? v.question_x : 0.05;
        const qyRaw = typeof v.question_y === 'number' ? v.question_y : (i + 0.5) / total;
        const qx = clamp(qxRaw, 0.05, 0.95);
        const qy = clamp(qyRaw, 0.05, 0.95);

        const cx = Math.round(qx * width);
        const cy = Math.round(qy * height);

        return (
          <View
            key={`v-${v.question_number}`}
            style={[
              styles.markerWrap,
              {
                left: cx - symbolSize,
                top: cy - symbolSize / 2,
                width: symbolSize * 2,
              },
            ]}
          >
            <Text
              style={[
                styles.symbol,
                { color: colour, fontSize: symbolSize, lineHeight: symbolSize * 1.1 },
              ]}
              numberOfLines={1}
            >
              {symbol}
            </Text>
            <Text
              style={[styles.label, { color: colour, fontSize: labelSize }]}
              numberOfLines={1}
            >
              Q{v.question_number}: {v.awarded_marks}/{v.max_marks}
            </Text>
          </View>
        );
      })}

      {/* Summary bubble — bottom-right, drawn only on the page the caller
          tagged (typically the last page in a multi-page submission). */}
      {summary && (
        <View style={[styles.bubble, { backgroundColor: pickColour(summary.percentage) }]}>
          <Text style={styles.bubbleScore}>
            {summary.score}/{summary.max_score}
          </Text>
          <Text style={styles.bubblePct}>{Math.round(summary.percentage)}%</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  markerWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  symbol: {
    fontWeight: '900',
    textAlign: 'center',
    // Letter-outline effect so symbols stay legible on any page background.
    textShadowColor: 'rgba(255,255,255,0.95)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  label: {
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: 'rgba(255,255,255,0.95)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 2,
  },
  bubble: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
  },
  bubbleScore: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  bubblePct: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
});
