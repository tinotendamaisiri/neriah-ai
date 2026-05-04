// src/services/play.ts
// Typed REST client for the Neriah Play backend (gamified study mini-games).
//
// All calls go through the shared axios `client` from api.ts so they pick up
// JWT auth, the route-key trace headers, and the same offline error mapping
// the rest of the app uses. Long timeouts are applied to LLM-bound endpoints
// (createLesson, expand, append) — Gemma 4 generation typically takes 30-60s
// on the cloud path.

import type { AxiosResponse } from 'axios';
import { client } from './api';
import type { PlayLesson, PlayQuestion, SessionResult } from '../play/types';

// ── Generation timeouts ──────────────────────────────────────────────────────
//
// Cloud Function timeout is 540s and the gemma_client request timeout is
// 240s, so 180s here gives the request room to complete without the mobile
// axios bailing first. Same reasoning as /tutor/chat.
const GEN_TIMEOUT = 180000;

export interface CreateLessonInput {
  title: string;
  source_content: string;
  subject?: string;
  grade?: string;
}

export interface AppendLessonInput {
  additional_content: string;
}

export interface PlayLessonStats {
  best_score: number;
  last_played: string | null;
  total_sessions: number;
}

export const playApi = {
  /**
   * Cloud-side lesson generation. Backend OCRs / cleans the source content,
   * calls Gemma 4 to emit MCQs, dedupes (semantic + hash), validates and
   * persists. Returns the full PlayLesson on success.
   *
   * When the backend can only generate <70 unique questions, the lesson
   * comes back with `is_draft=true` so the caller can route to
   * PlayNotEnoughScreen for an expand / append fallback.
   */
  createLesson: async (data: CreateLessonInput): Promise<PlayLesson> => {
    const res: AxiosResponse<PlayLesson> = await client.post('/play/lessons', data, {
      timeout: GEN_TIMEOUT,
    });
    return res.data;
  },

  /**
   * Lessons the student can see: own + shared-by-class + copied. Backend
   * tags `origin` on each so the library UI can filter + colour-code.
   */
  listLessons: async (): Promise<PlayLesson[]> => {
    const res: AxiosResponse<PlayLesson[]> = await client.get('/play/lessons');
    return res.data ?? [];
  },

  getLesson: async (id: string): Promise<PlayLesson> => {
    const res: AxiosResponse<PlayLesson> = await client.get(`/play/lessons/${id}`);
    return res.data;
  },

  deleteLesson: async (id: string): Promise<void> => {
    await client.delete(`/play/lessons/${id}`);
  },

  /**
   * Toggle "share with class" + "allow copying" flags. `class_id` is
   * required when shared_with_class is true so the backend knows which
   * roster gets read access.
   */
  updateSharing: async (
    id: string,
    shared_with_class: boolean,
    allow_copying: boolean,
    class_id?: string,
  ): Promise<PlayLesson> => {
    const res: AxiosResponse<PlayLesson> = await client.put(
      `/play/lessons/${id}/sharing`,
      {
        shared_with_class,
        allow_copying,
        ...(class_id ? { class_id } : {}),
      },
    );
    return res.data;
  },

  /**
   * Ask Gemma 4 to invent more questions on the same topic, no extra text
   * input from the student. Used by the "Add AI-generated content" CTA on
   * PlayNotEnoughScreen.
   */
  expandLesson: async (id: string): Promise<PlayLesson> => {
    const res: AxiosResponse<PlayLesson> = await client.post(
      `/play/lessons/${id}/expand`,
      {},
      { timeout: GEN_TIMEOUT },
    );
    return res.data;
  },

  /**
   * Append student-typed extra notes so Gemma 4 has more material to draw
   * from. Used by the "Type more notes" CTA on PlayNotEnoughScreen.
   */
  appendLesson: async (id: string, additional_content: string): Promise<PlayLesson> => {
    const res: AxiosResponse<PlayLesson> = await client.post(
      `/play/lessons/${id}/append`,
      { additional_content },
      { timeout: GEN_TIMEOUT },
    );
    return res.data;
  },

  /**
   * Persist a finished session. Fire-and-forget from the caller's POV — we
   * still surface errors so the screen can decide whether to retry.
   */
  logSession: async (
    session: SessionResult & { started_at: string; ended_at: string },
  ): Promise<void> => {
    await client.post('/play/sessions', session);
  },

  /** Best score / last played / count for the lesson card stats strip. */
  getLessonStats: async (id: string): Promise<PlayLessonStats> => {
    const res: AxiosResponse<PlayLessonStats> = await client.get(
      `/play/lessons/${id}/stats`,
    );
    return res.data;
  },
};

// ── Types re-exported for convenience ────────────────────────────────────────

export type { PlayLesson, PlayQuestion, SessionResult };
