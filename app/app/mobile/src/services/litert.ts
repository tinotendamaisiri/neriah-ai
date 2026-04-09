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

import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

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
  (NativeModules.MediapipeLlm as MediapipeLlmModule) ?? null;

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
    const info = await FileSystem.getInfoAsync(MODEL_PATHS[model], { size: true });
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

// ── Prompt helpers ────────────────────────────────────────────────────────────

/**
 * Build the Socratic tutor prompt for the E2B student model.
 * LiteRT has no system-prompt parameter, so we embed it in the user turn.
 */
export function buildTutorPrompt(history: Array<{ role: 'user' | 'assistant'; content: string }>, userMessage: string): string {
  const system = [
    'You are Neriah, a Socratic AI tutor helping African school students understand their homework.',
    'RULES: Never give direct answers. Guide with questions and hints only.',
    'Be encouraging, use simple language, keep responses under 150 words.',
    'If asked for the answer directly, redirect with "Let\'s think about it step by step — what do you already know about this?"',
  ].join(' ');

  const turns = history
    .slice(-6) // last 3 exchanges for context
    .map(m => `${m.role === 'user' ? 'Student' : 'Neriah'}: ${m.content}`)
    .join('\n');

  return `${system}\n\n${turns ? turns + '\n' : ''}Student: ${userMessage}\nNeriah:`;
}

/**
 * Build the grading prompt for the E4B teacher model.
 * Asks Gemma to grade student answers against the answer key and return JSON.
 *
 * TODO: Add multimodal image support when mediapipe-llm adds image input API.
 *       Currently text-only — requires student text answers to be available.
 */
export function buildGradingPrompt(
  questions: Array<{ number: number; correct_answer: string; max_marks: number; marking_notes?: string }>,
  studentAnswers: string,
  educationLevel?: string,
): string {
  const level = educationLevel ?? 'secondary school';
  const keyText = questions
    .map(q => `Q${q.number} (${q.max_marks} marks): ${q.correct_answer}${q.marking_notes ? ` [${q.marking_notes}]` : ''}`)
    .join('\n');

  return [
    `You are an expert ${level} teacher grading student work. Grade strictly but fairly.`,
    `Answer key:\n${keyText}`,
    `\nStudent answers:\n${studentAnswers}`,
    `\nReturn ONLY valid JSON — no explanation, no markdown:`,
    `{"score": number, "max_score": number, "verdicts": [{"question_number": number, "verdict": "correct"|"incorrect"|"partial", "awarded_marks": number, "max_marks": number}], "overall_feedback": "string"}`,
  ].join('\n');
}
