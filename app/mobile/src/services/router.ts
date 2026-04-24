// src/services/router.ts
// AI inference router — every AI request (grading, tutoring, scheme generation)
// must pass through here before dispatching to cloud or on-device inference.
//
// Decision logic:
//   isOnline                       → "cloud"       always prefer 26B Gemma when connected
//   !isOnline  AND  modelLoaded    → "on-device"   E4B (teacher) / E2B (student) via LiteRT
//   !isOnline  AND  !modelLoaded   → "unavailable" show "Connect to continue", queue if possible
//
// Web is always "cloud" — short-circuits before any hardware or network check.

import { Platform, Alert } from 'react-native';
import { useEffect, useState, useCallback } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import {
  getLiteRTState,
  generateResponse,
  buildGradingPrompt,
  buildTutorPrompt,
  ModelVariant,
  type OnDeviceUserContext,
  type OcrPageInput,
} from './litert';

export type { OnDeviceUserContext };
import { enqueue } from './offlineQueue';
import type { QueuedScan } from './offlineQueue';
import { recognizePages } from './ocr';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AIRoute = 'cloud' | 'on-device' | 'unavailable';

/** Which kind of AI operation is being requested. */
export type AIRequestType = 'grading' | 'tutoring' | 'scheme';

/** Message shown when no route is available. */
export const CONNECT_TO_CONTINUE = 'Connect to continue';
export const CONNECT_DETAIL =
  "You're offline and no on-device model is loaded. Connect to use Neriah AI.";

// ── Pure routing decision ─────────────────────────────────────────────────────

/**
 * Pure, side-effect-free routing decision.
 *
 * @param isOnline     Whether the device currently has internet access.
 * @param modelLoaded  Whether the relevant on-device LiteRT model is loaded.
 * @returns            The route to take for this AI request.
 */
export function routeRequest(isOnline: boolean, modelLoaded: boolean): AIRoute {
  // Web has no on-device inference capability — always route to cloud.
  if (Platform.OS === 'web') return 'cloud';

  if (isOnline) return 'cloud';
  if (modelLoaded) return 'on-device';
  return 'unavailable';
}

// ── Model variant mapping ─────────────────────────────────────────────────────

/**
 * Returns the LiteRT model variant needed for a given request type.
 * Teacher operations (grading, scheme) need the larger E4B model;
 * student tutoring uses the lighter E2B model.
 */
export function modelVariantForRequest(requestType: AIRequestType): ModelVariant {
  return requestType === 'tutoring' ? 'e2b' : 'e4b';
}

// ── Async route resolution ────────────────────────────────────────────────────

/**
 * Resolve the current route by reading live connectivity and LiteRT model state.
 * Call this just before dispatching any AI request.
 *
 * @param requestType  Determines which model variant must be loaded for on-device.
 */
export async function resolveRoute(requestType: AIRequestType): Promise<AIRoute> {
  if (Platform.OS === 'web') return 'cloud';

  const netState = await NetInfo.fetch();
  // isInternetReachable can be null when unknown — treat null as reachable
  const isOnline =
    (netState.isConnected ?? false) &&
    (netState.isInternetReachable !== false);

  const { loadedModel } = getLiteRTState();
  const needed = modelVariantForRequest(requestType);
  const modelLoaded = loadedModel === needed;

  return routeRequest(isOnline, modelLoaded);
}

// ── Unavailable helpers ───────────────────────────────────────────────────────

/**
 * Show the "Connect to continue" alert.
 *
 * @param onQueue  Optional callback called when the user chooses to save the
 *                 request for later (e.g. queue a marking scan). When omitted,
 *                 only an OK button is shown.
 */
export function showUnavailableAlert(onQueue?: () => void): void {
  const buttons: Array<{ text: string; style?: 'cancel' | 'default'; onPress?: () => void }> = [];

  if (onQueue) {
    buttons.push({ text: 'Save for later', onPress: onQueue });
  }
  buttons.push({ text: 'OK', style: 'cancel' });

  Alert.alert(CONNECT_TO_CONTINUE, CONNECT_DETAIL, buttons);
}

/**
 * Queue a marking scan so it is replayed automatically when connectivity
 * is restored. Delegates to offlineQueue.ts.
 */
export async function queueMarkingScan(
  scan: Omit<QueuedScan, 'id' | 'queued_at' | 'retry_count'>,
): Promise<void> {
  await enqueue(scan);
}

// ── On-device execution helpers ───────────────────────────────────────────────

/**
 * Run grading via the on-device E4B LiteRT model against already-OCR'd pages.
 *
 * Callers that have image URIs (not pre-extracted text) should use
 * gradeScanOffline() instead — it runs OCR first, then calls this.
 *
 * User context is serialized and prepended to the prompt because LiteRT has
 * no access to Firestore or the vector DB. The caller is responsible for
 * passing whatever context is available (country, curriculum, subject, level).
 *
 * @param questions      Answer key questions (number, correct_answer, max_marks).
 * @param pages          Per-page OCR text; order + page_index must match the
 *                       original page order so annotations land on the right page.
 * @param educationLevel e.g. "Form 3" — calibrates grading intensity.
 * @param userContext    Profile-derived context (country, curriculum, weak areas…).
 * @returns              Raw JSON string from the model (parse with JSON.parse).
 */
export async function gradeOnDevice(
  questions: Array<{ number: number; correct_answer: string; max_marks: number; marking_notes?: string }>,
  pages: OcrPageInput[],
  educationLevel: string,
  userContext?: OnDeviceUserContext,
): Promise<string> {
  const prompt = buildGradingPrompt(questions, pages, educationLevel, userContext);
  return generateResponse(prompt);
}

// ── Offline verdict shape ────────────────────────────────────────────────────

/**
 * Parsed verdict from the on-device grading call, matching
 * shared/models.py:GradingVerdict + the optional page_index we tag in the
 * prompt for the annotator.
 */
export interface OfflineVerdict {
  question_number: number;
  page_index: number;
  student_answer: string;
  expected_answer: string;
  verdict: 'correct' | 'incorrect' | 'partial';
  awarded_marks: number;
  max_marks: number;
  feedback?: string;
}

/**
 * Apply the same dedup + clamp rules the backend enforces (see
 * functions/mark.py) so an offline-graded mark can never produce a score
 * above the answer key's total — even if the local model hallucinates.
 */
export function dedupeAndClampVerdicts(
  raw: Array<Record<string, unknown>>,
  answerKey: { questions: Array<{ number?: number; question_number?: number; marks?: number }>; total_marks?: number },
): { verdicts: OfflineVerdict[]; score: number; max_score: number; percentage: number } {
  // Build per-question max from the answer key.
  const maxPerQ: Record<number, number> = {};
  for (const q of answerKey.questions ?? []) {
    const qn = q.question_number ?? q.number;
    if (qn != null) maxPerQ[Number(qn)] = Number(q.marks ?? 0) || 0;
  }
  const totalMax = Number(answerKey.total_marks) || Object.values(maxPerQ).reduce((s, n) => s + n, 0) || 1;

  // Dedupe by question_number, keeping highest awarded_marks.
  const deduped: Record<number, OfflineVerdict> = {};
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const qnRaw = (v as Record<string, unknown>).question_number;
    const qn = qnRaw == null ? null : Number(qnRaw);
    if (qn == null || Number.isNaN(qn) || !(qn in maxPerQ)) continue;
    const awarded = Number((v as Record<string, unknown>).awarded_marks ?? 0) || 0;
    const prev = deduped[qn];
    if (prev == null || awarded > prev.awarded_marks) {
      deduped[qn] = {
        question_number: qn,
        page_index: Number((v as Record<string, unknown>).page_index ?? 0) || 0,
        student_answer: String((v as Record<string, unknown>).student_answer ?? ''),
        expected_answer: String((v as Record<string, unknown>).expected_answer ?? ''),
        verdict: (['correct', 'incorrect', 'partial'] as const).includes(
          (v as Record<string, unknown>).verdict as 'correct' | 'incorrect' | 'partial',
        )
          ? ((v as Record<string, unknown>).verdict as OfflineVerdict['verdict'])
          : 'incorrect',
        awarded_marks: awarded,
        max_marks: maxPerQ[qn],
        feedback:
          typeof (v as Record<string, unknown>).feedback === 'string'
            ? ((v as Record<string, unknown>).feedback as string)
            : undefined,
      };
    }
  }

  // Clamp per question and sort.
  const verdicts = Object.values(deduped)
    .map((v) => ({
      ...v,
      awarded_marks: Math.max(0, Math.min(v.awarded_marks, v.max_marks)),
    }))
    .sort((a, b) => a.question_number - b.question_number);

  const score = Math.min(
    verdicts.reduce((s, v) => s + v.awarded_marks, 0),
    totalMax,
  );
  const percentage = totalMax > 0 ? Math.round((score / totalMax) * 1000) / 10 : 0;

  return { verdicts, score, max_score: totalMax, percentage };
}

/**
 * Full offline grading pipeline: OCR each page, send the text to the local
 * E4B model, parse + sanitise the JSON response, apply dedup + clamp rules.
 *
 * Returns the same shape the cloud would (minus image URLs — those are
 * filled in by the local annotator in Phase D).
 *
 * Throws:
 *   - OcrUnavailableError   if MLKit isn't linked
 *   - Error('No model loaded') if the E4B model hasn't been loaded yet
 *   - Error on JSON parse failure
 */
export async function gradeScanOffline(args: {
  pageUris: string[];
  answerKey: {
    questions: Array<{ number?: number; question_number?: number; correct_answer?: string; marks?: number; marking_notes?: string }>;
    total_marks?: number;
  };
  educationLevel: string;
  userContext?: OnDeviceUserContext;
}): Promise<{
  verdicts: OfflineVerdict[];
  score: number;
  max_score: number;
  percentage: number;
  page_texts: string[];
}> {
  // 1. OCR every page in order.
  const ocrPages = await recognizePages(args.pageUris);

  // 2. Shape answer key for the prompt.
  const promptQuestions = (args.answerKey.questions ?? []).map((q) => ({
    number: Number(q.question_number ?? q.number ?? 0),
    correct_answer: String(q.correct_answer ?? ''),
    max_marks: Number(q.marks ?? 0) || 0,
    marking_notes: q.marking_notes,
  }));

  // 3. Local LLM grading call.
  const raw = await gradeOnDevice(
    promptQuestions,
    ocrPages.map((p) => ({ page_index: p.page_index, text: p.text })),
    args.educationLevel,
    args.userContext,
  );

  // 4. Parse JSON — Gemma sometimes wraps the array in ```json fences.
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(`Local model returned non-JSON output: ${(err as Error).message}`);
  }
  const rawVerdicts = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];

  // 5. Dedupe + clamp (same rules as functions/mark.py).
  const { verdicts, score, max_score, percentage } = dedupeAndClampVerdicts(rawVerdicts, args.answerKey);

  return {
    verdicts,
    score,
    max_score,
    percentage,
    page_texts: ocrPages.map((p) => p.text),
  };
}

/**
 * Run a Socratic tutoring turn via the on-device E2B LiteRT model.
 *
 * User context is serialized and prepended to the prompt because LiteRT has
 * no access to Firestore or the vector DB. Pass weakness_topics so the tutor
 * gives extra patience on the student's known problem areas.
 *
 * @param history     Prior conversation turns (last ~3 exchanges are used).
 * @param userMessage The student's current message.
 * @param userContext Profile-derived context (curriculum, subject, weak areas…).
 * @param onToken     Optional streaming callback — called with each partial token.
 * @returns           The tutor's full response text.
 */
export async function tutorOnDevice(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  userContext?: OnDeviceUserContext,
  onToken?: (partial: string) => void,
): Promise<string> {
  const prompt = buildTutorPrompt(history, userMessage, userContext);
  return generateResponse(prompt, onToken);
}

// ── React hook ────────────────────────────────────────────────────────────────

/**
 * Reactive hook that exposes the current routing state.
 *
 * ```tsx
 * const { getRoute } = useAIRouter();
 * const route = getRoute('grading'); // 'cloud' | 'on-device' | 'unavailable'
 * ```
 *
 * Re-renders when network connectivity changes. LiteRT model state is read
 * once on mount (model loads are infrequent and driven by explicit user action).
 */
export function useAIRouter() {
  const [isOnline, setIsOnline] = useState(true);
  const [loadedModel, setLoadedModel] = useState<ModelVariant | null>(null);

  useEffect(() => {
    // Read initial connectivity
    NetInfo.fetch().then((state) => {
      setIsOnline(
        (state.isConnected ?? true) && (state.isInternetReachable !== false),
      );
    });

    // Subscribe to connectivity changes
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setIsOnline(
        (state.isConnected ?? true) && (state.isInternetReachable !== false),
      );
    });

    // Read LiteRT model state (updates when model is loaded/unloaded)
    const { loadedModel: lm } = getLiteRTState();
    setLoadedModel(lm);

    return unsubscribe;
  }, []);

  /**
   * Return the current routing decision for a given request type.
   * Synchronous — reads from React state, no I/O.
   */
  const getRoute = useCallback(
    (requestType: AIRequestType): AIRoute => {
      const needed = modelVariantForRequest(requestType);
      return routeRequest(isOnline, loadedModel === needed);
    },
    [isOnline, loadedModel],
  );

  return { isOnline, loadedModel, getRoute };
}
