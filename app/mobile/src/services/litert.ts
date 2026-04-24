// src/services/litert.ts
// LiteRT on-device inference service.
//
// Wraps @subhajit-gorai/react-native-mediapipe-llm's NativeModules.MediapipeLlm
// directly so it can be used from plain service code (not just React hooks).
//
// Usage:
//   import { loadModel, generateResponse, isModelAvailable } from './litert';
//   await loadModel('e2b');
//   const reply = await generateResponse(prompt);

// LiteRT on-device inference via @subhajit-gorai/react-native-mediapipe-llm.
// This module is native — requires a dev-client build (`npx expo run:ios` /
// `npx expo run:android`) and will be null when running inside Expo Go.
// The router falls back to 'unavailable' in that case.
import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// ── Native module interface ───────────────────────────────────────────────────

interface MediapipeLlmModule {
  initialize(opts: {
    modelPath: string;
    maxTokens?: number;
    temperature?: number;
    topK?: number;
    topP?: number;
  }): Promise<boolean>;
  generateResponse(prompt: string): Promise<string>;
  generateResponseWithCallback(
    prompt: string,
    onToken: (partial: string, done: boolean) => void,
    onError: (error: string) => void,
  ): void;
}

const MediapipeLlm: MediapipeLlmModule | null =
  (NativeModules.MediapipeLlm as MediapipeLlmModule | undefined) ?? null;

// ── Model file paths ──────────────────────────────────────────────────────────
//
// Models are NOT bundled — they live in the device's document directory.
// Download them via modelManager.ts before loading.

export const MODEL_PATHS = {
  e2b: `${FileSystem.documentDirectory ?? ''}models/gemma-4-e2b-it.task`,
  e4b: `${FileSystem.documentDirectory ?? ''}models/gemma-4-e4b-it.task`,
} as const;

export type ModelVariant = keyof typeof MODEL_PATHS;

// ── Singleton state ───────────────────────────────────────────────────────────

export interface LiteRTState {
  loadedModel: ModelVariant | null;
  isLoading: boolean;
  error: string | null;
}

const _state: LiteRTState = {
  loadedModel: null,
  isLoading: false,
  error: null,
};

const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach(fn => fn());
}

/** Subscribe to LiteRT state changes. Returns an unsubscribe function. */
export function subscribeToLiteRT(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/** Read current LiteRT state snapshot. */
export function getLiteRTState(): Readonly<LiteRTState> {
  return _state;
}

// ── Capability checks ─────────────────────────────────────────────────────────

/** Returns true if the native module was successfully linked in the iOS build. */
export function isNativeModuleAvailable(): boolean {
  return MediapipeLlm !== null;
}

/** Returns true if the model .task file exists on the device filesystem. */
export async function isModelAvailable(model: ModelVariant): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(MODEL_PATHS[model]);
    return info.exists && ((info as any).size ?? 0) > 1_000_000;
  } catch {
    return false;
  }
}

// ── Model loading ─────────────────────────────────────────────────────────────

/**
 * Load a model into memory. Safe to call multiple times — skips if already loaded.
 * On-device only: resolves immediately with a no-op on non-mobile platforms.
 */
export async function loadModel(model: ModelVariant): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  if (!MediapipeLlm) throw new Error('MediaPipe LLM native module not linked. Rebuild the app after installing the package.');
  if (_state.loadedModel === model) return;

  _state.isLoading = true;
  _state.error = null;
  _notify();

  try {
    // Native module expects a bare filesystem path (no file:// prefix)
    const modelPath = MODEL_PATHS[model].replace(/^file:\/\//, '');
    const ok = await MediapipeLlm.initialize({
      modelPath,
      maxTokens: 512,
      temperature: 0.8,
      topK: 40,
      topP: 0.9,
    });
    if (!ok) throw new Error('Model initialization returned false — check that the .task file is valid');
    _state.loadedModel = model;
  } catch (err: any) {
    _state.error = err?.message ?? 'Unknown error loading model';
    _state.loadedModel = null;
    throw err;
  } finally {
    _state.isLoading = false;
    _notify();
  }
}

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Generate a response from the currently loaded model.
 *
 * @param prompt   Full prompt text. Prepend system context inline —
 *                 LiteRT has no separate system-prompt parameter.
 * @param onToken  Optional streaming callback. Each call receives a token chunk.
 */
export async function generateResponse(
  prompt: string,
  onToken?: (partial: string) => void,
): Promise<string> {
  if (!MediapipeLlm) throw new Error('MediaPipe LLM native module not linked');
  if (!_state.loadedModel) throw new Error('No model loaded. Call loadModel() first.');

  if (onToken) {
    return new Promise<string>((resolve, reject) => {
      let full = '';
      MediapipeLlm!.generateResponseWithCallback(
        prompt,
        (partial: string, done: boolean) => {
          if (partial) { full += partial; onToken(partial); }
          if (done) resolve(full);
        },
        (error: string) => reject(new Error(error)),
      );
    });
  }

  return MediapipeLlm.generateResponse(prompt);
}

// ── On-device user context ────────────────────────────────────────────────────

/**
 * Profile-derived context passed to on-device prompts.
 * Mirrors the server-side user_context dict, but must be serialized inline
 * because LiteRT cannot call Firestore or the vector DB.
 */
export interface OnDeviceUserContext {
  country?: string;
  curriculum?: string;
  subject?: string;
  education_level?: string;
  weakness_topics?: string[];
}

/**
 * Serialize a user context object to a compact text block suitable for
 * prepending to any on-device prompt.
 *
 * Returns an empty string when ctx is empty so no extra whitespace is added.
 */
export function serializeUserContext(ctx: OnDeviceUserContext): string {
  const lines: string[] = [];
  if (ctx.country)          lines.push(`Country: ${ctx.country}`);
  if (ctx.curriculum)       lines.push(`Curriculum: ${ctx.curriculum}`);
  if (ctx.subject)          lines.push(`Subject: ${ctx.subject}`);
  if (ctx.education_level)  lines.push(`Education level: ${ctx.education_level}`);
  if (ctx.weakness_topics?.length) {
    lines.push(`Student weak areas: ${ctx.weakness_topics.slice(0, 5).join(', ')}`);
  }
  if (lines.length === 0) return '';
  return `--- USER CONTEXT ---\n${lines.join('\n')}\n--- END CONTEXT ---\n\n`;
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

/**
 * Build the Socratic tutor prompt for the E2B student model.
 * LiteRT has no system-prompt parameter, so we embed everything in the user turn.
 * User context is serialized and prepended because LiteRT cannot call Firestore.
 */
export function buildTutorPrompt(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  userContext?: OnDeviceUserContext,
): string {
  const contextBlock = userContext ? serializeUserContext(userContext) : '';

  const system = [
    'You are Neriah, a Socratic AI tutor helping African school students understand their homework.',
    'RULES: Never give direct answers. Guide with questions and hints only.',
    'Be encouraging, use simple language, keep responses under 150 words.',
    'If asked for the answer directly, redirect with "Let\'s think about it step by step — what do you already know about this?"',
  ].join(' ');

  const weakNote = userContext?.weakness_topics?.length
    ? `\nThis student recently struggled with: ${userContext.weakness_topics.slice(0, 3).join(', ')}. Give extra patience on these topics.`
    : '';

  const turns = history
    .slice(-6) // last 3 exchanges for context
    .map(m => `${m.role === 'user' ? 'Student' : 'Neriah'}: ${m.content}`)
    .join('\n');

  return `${contextBlock}${system}${weakNote}\n\n${turns ? turns + '\n' : ''}Student: ${userMessage}\nNeriah:`;
}

/**
 * Per-page OCR text fed to the grading prompt. page_index is the 0-indexed
 * position of the page in the submission; the model echoes it back on each
 * verdict so the annotator knows which page to draw on.
 */
export interface OcrPageInput {
  page_index: number;
  text: string;
}

/**
 * Build the grading prompt for the E4B teacher model.
 * Asks Gemma to grade OCR'd student text against the answer key and return
 * a JSON array of verdicts that mirrors the server-side GradingVerdict shape.
 *
 * Multi-page: the student's work is passed as a list of pages (each tagged
 * with page_index). The model is asked to return page_index on each verdict
 * so the offline annotator can draw ticks/crosses on the correct page.
 *
 * User context is serialized and prepended because LiteRT cannot call
 * Firestore — anything the cloud's RAG layer would have injected has to be
 * passed in directly.
 */
export function buildGradingPrompt(
  questions: Array<{ number: number; correct_answer: string; max_marks: number; marking_notes?: string }>,
  pages: OcrPageInput[],
  educationLevel?: string,
  userContext?: OnDeviceUserContext,
): string {
  const level = educationLevel ?? userContext?.education_level ?? 'secondary school';
  const contextBlock = userContext ? serializeUserContext(userContext) : '';

  const keyText = questions
    .map(q => `Q${q.number} (${q.max_marks} marks): ${q.correct_answer}${q.marking_notes ? ` [${q.marking_notes}]` : ''}`)
    .join('\n');

  const curriculumNote = userContext?.curriculum
    ? `Curriculum: ${userContext.curriculum}. Apply this curriculum's marking conventions.`
    : '';

  const pagesBlock = pages
    .map(p => `--- PAGE ${p.page_index} ---\n${p.text || '(no text extracted)'}`)
    .join('\n\n');

  // The verdict JSON schema below mirrors shared/models.py:GradingVerdict so
  // the offline path can hand a MarkResult straight to the existing UI.
  // fields kept optional in parse (question_x / question_y) can be absent —
  // the annotator falls back to evenly-spaced positions.
  const schema =
    `[{"question_number":<int>,"page_index":<int>,` +
    `"student_answer":"<verbatim from OCR>",` +
    `"expected_answer":"<from answer key>",` +
    `"verdict":"correct"|"incorrect"|"partial",` +
    `"awarded_marks":<number>,"max_marks":<number>,` +
    `"feedback":"<one short sentence or empty>"}]`;

  return [
    `${contextBlock}You are an expert ${level} teacher grading student work. Grade strictly but fairly.`,
    curriculumNote,
    `Answer key:\n${keyText}`,
    `\nStudent pages (OCR-extracted text, may contain errors):\n${pagesBlock}`,
    `\nFor each question in the answer key, locate the student's answer in the pages above. Tag each verdict with the page_index it was found on. Set page_index to 0 if you cannot determine it.`,
    `\nReturn ONLY a JSON array — no markdown fences, no commentary — matching this shape exactly:`,
    schema,
  ].filter(Boolean).join('\n');
}
