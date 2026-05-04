// src/play/types.ts
//
// Shared types for the Neriah Play surface (gamified study mini-games for
// students). Mirrors the backend Pydantic models for `play_lessons` and
// `play_sessions`. Question shape stays small and self-contained — no
// references to subject/grade enums elsewhere in the app, those are
// strings here so on-device generation can stamp whatever the model
// produces without enum-mismatch loss.

export type GameFormat = 'lane_runner' | 'stacker' | 'blaster' | 'snake';

export interface PlayQuestion {
  /** Stem text. Capped to 80 chars (truncated at word boundary if longer). */
  prompt: string;
  /** Exactly four answer options. Each capped to 25 chars. */
  options: string[];
  /** Index (0..3) of the correct option in `options`. */
  correct: number;
}

export interface PlayLesson {
  id: string;
  title: string;
  subject: string | null;
  grade: string | null;
  owner_id: string;
  question_count: number;
  /** True when the generator could not reach the 70-question minimum. */
  is_draft?: boolean;
  /** ISO timestamp. */
  created_at: string;
  shared_with_class: boolean;
  allow_copying: boolean;
  class_id: string | null;
  /**
   * Backend-tagged origin so the library UI can colour-code each card:
   *   'mine'   — owned by the current student
   *   'class'  — shared by their teacher / school
   *   'shared' — copied from another student's shared lesson
   */
  origin?: 'mine' | 'class' | 'shared';
  /** Only present when the API returned the full lesson detail. */
  questions?: PlayQuestion[];
  /** Original notes / OCR text the lesson was generated from. */
  source_content?: string;
}

export interface SessionResult {
  lesson_id: string;
  game_format: GameFormat;
  duration_seconds: number;
  final_score: number;
  questions_attempted: number;
  questions_correct: number;
  /** e.g. 'three_lives_lost', 'tower_collapsed', 'asteroid_hit', 'self_collision', 'completed', 'quit'. */
  end_reason: string;
}

// ── Navigation ────────────────────────────────────────────────────────────────

export type PlayStackParamList = {
  PlayHome: undefined;
  PlayLibrary: undefined;
  PlayBuild: undefined;
  PlayBuildProgress: { taskId: string };
  PlayNotEnough: { lessonId: string };
  PlayPreview: { lessonId: string };
  PlayGame: { lessonId: string; format: GameFormat };
  PlaySessionEnd: { sessionResult: SessionResult; lessonId: string };
  PlayShare: { lessonId: string };
};
