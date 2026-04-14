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
} from './litert';

export type { OnDeviceUserContext };
import { enqueue } from './offlineQueue';
import type { QueuedScan } from './offlineQueue';

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
 * Run grading via the on-device E4B LiteRT model (text-only — no image OCR).
 *
 * User context is serialized and prepended to the prompt because LiteRT has
 * no access to Firestore or the vector DB. The caller is responsible for
 * passing whatever context is available (country, curriculum, subject, level).
 *
 * @param questions      Answer key questions (number, correct_answer, max_marks).
 * @param studentAnswers Raw text of the student's answers.
 * @param educationLevel e.g. "Form 3" — calibrates grading intensity.
 * @param userContext    Profile-derived context (country, curriculum, weak areas…).
 * @returns              Raw JSON string from the model (parse with JSON.parse).
 */
export async function gradeOnDevice(
  questions: Array<{ number: number; correct_answer: string; max_marks: number; marking_notes?: string }>,
  studentAnswers: string,
  educationLevel: string,
  userContext?: OnDeviceUserContext,
): Promise<string> {
  const prompt = buildGradingPrompt(questions, studentAnswers, educationLevel, userContext);
  return generateResponse(prompt);
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
