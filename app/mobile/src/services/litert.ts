// src/services/litert.ts
// LiteRT-LM on-device inference via `react-native-litert-lm` (Kaggle Gemma 4
// hackathon prize track runtime; supersedes the deprecated
// @subhajit-gorai/react-native-mediapipe-llm package).
//
// Model lifecycle is fully managed by the library:
//   - loadModel(variant) accepts a HuggingFace URL → library downloads (with
//     progress callback), caches locally, then initialises the native model.
//   - Repeat calls with the same URL hit cache and load instantly.
//   - deleteCachedModel(variant) removes the cached file.
//
// Public TypeScript surface kept stable for the rest of the app:
//   loadModel, generateResponse, isNativeModuleAvailable, getLiteRTState,
//   subscribeToLiteRT, unloadModel, deleteCachedModel, ModelVariant,
//   MODEL_URLS, OcrPageInput, OnDeviceUserContext, buildGradingPrompt,
//   buildTutorPrompt, serializeUserContext.
//
// LiteRTState shape:
//   { loadedModel, isLoading, progress, error }
// where `progress` is 0–100 and is meaningful only while isLoading is true
// (covers both the download and the subsequent initialise-into-memory
// phases; the library only reports progress during download — the
// initialise phase shows the same final progress value until the load
// promise resolves).
//
// Expo Go: `require('react-native-litert-lm')` will fail to resolve the
// Nitro native binding inside Expo Go. The lazy require below catches that
// and sets _lib = null, which makes isNativeModuleAvailable() return false
// and the router's 'on-device' branch fall through to 'unavailable'. Rest
// of the app keeps working.

import { Platform } from 'react-native';

// ── Native module interface ───────────────────────────────────────────────────
// Hand-typed minimal surface — matches the public API described in
// react-native-litert-lm's README.

interface LiteRTInstance {
  loadModel(
    urlOrPath: string,
    opts?: {
      backend?: 'cpu' | 'gpu' | 'npu';
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      topK?: number;
      topP?: number;
    },
    onDownloadProgress?: (progress: number) => void,
  ): Promise<void>;
  sendMessage(prompt: string): Promise<string>;
  // Native spec returns void — the library's own hook wraps it in a
  // promise, and we do the same inside generateResponse() below.
  sendMessageAsync(
    prompt: string,
    onToken: (token: string, done: boolean) => void,
  ): void;
  deleteModel(fileName: string): Promise<void>;
  close(): void;
}

interface LiteRTLibrary {
  createLLM: () => LiteRTInstance;
}

// Lazy-load via require() so missing native binding (Expo Go) produces a
// typed null instead of crashing at module load time.
let _lib: LiteRTLibrary | null | undefined = undefined;

function getLib(): LiteRTLibrary | null {
  if (_lib !== undefined) return _lib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('react-native-litert-lm');
    // The library exports createLLM from the top-level module. Handle both
    // default-export and named-export shapes.
    const lib: LiteRTLibrary | undefined =
      (mod?.default?.createLLM ? (mod.default as LiteRTLibrary) : undefined) ??
      (mod?.createLLM ? (mod as LiteRTLibrary) : undefined);
    _lib = lib ?? null;
  } catch {
    _lib = null;
  }
  return _lib;
}

// ── Model URLs (hosted by Google's LiteRT community on HuggingFace) ──────────
//
// These are the same URLs the library exports as GEMMA_4_E2B_IT /
// GEMMA_4_E4B_IT constants. We inline them rather than import them so this
// file doesn't eagerly import the lib (which would crash at module-load
// time in Expo Go where the native binding doesn't resolve).
//
// On first call, the library downloads the .litertlm file under the
// filename extracted from the URL (e.g. "gemma-4-E4B-it.litertlm"), caches
// it in a per-OS directory (Android: app temp; iOS: Library/Caches/
// litert_models/), and reuses it on subsequent calls.

export const MODEL_URLS = {
  e2b: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm',
  e4b: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm',
} as const;

export type ModelVariant = keyof typeof MODEL_URLS;

/** Extract the cache filename the library uses for a variant — handy for
 *  deleteModel calls, which want the filename, not the URL. */
function cacheFileName(variant: ModelVariant): string {
  const url = MODEL_URLS[variant];
  return url.split('/').pop() ?? `${variant}.litertlm`;
}

// ── Singleton state ───────────────────────────────────────────────────────────

export interface LiteRTState {
  loadedModel: ModelVariant | null;
  isLoading: boolean;
  /** 0–100. Meaningful only while isLoading is true. Driven by the library's
   *  download progress callback during the download phase; stays at 100
   *  (or the last reported value) through the subsequent initialise phase,
   *  which has no progress feedback. */
  progress: number;
  error: string | null;
}

const _state: LiteRTState = {
  loadedModel: null,
  isLoading: false,
  progress: 0,
  error: null,
};

const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach(fn => fn());
}

// The single LLM instance currently loaded. LiteRT-LM is instance-based
// (createLLM() returns a new one each call), so we keep one alive and close
// it if we ever swap to a different variant.
let _llm: LiteRTInstance | null = null;

// Concurrent-load dedup. Without this, a Wi-Fi flicker during the native
// init phase (which can take 20–30s after the download reports 100%)
// triggers ModelContext's auto-download branch to start a *second*
// loadModel call on the same variant, which resets the progress bar to
// 0% and re-runs the whole pipeline. The in-flight promise is shared —
// subsequent callers await the original work instead of kicking off a
// parallel one.
const _inFlight: Map<ModelVariant, Promise<void>> = new Map();

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

/** Returns true if the native Nitro binding was successfully linked. */
export function isNativeModuleAvailable(): boolean {
  return getLib() !== null;
}

// ── Model loading ─────────────────────────────────────────────────────────────

/**
 * Download + load a model into memory. Safe to call multiple times — skips
 * the native work if the same variant is already loaded. On-device only:
 * resolves immediately with a no-op on web.
 *
 * The URL for the variant is passed straight to the library's loadModel,
 * which:
 *   1. Extracts the filename from the URL
 *   2. Checks its local cache — if present, skips download
 *   3. Otherwise downloads the .litertlm file, reporting progress through
 *      the onDownloadProgress callback (0–1 fractional)
 *   4. Initialises the native session and resolves
 *
 * @param model       Which variant to load.
 * @param onProgress  Optional external progress callback (0–100). The
 *                    internal state's `progress` field is updated
 *                    regardless; callers who care about real-time UI can
 *                    subscribe via subscribeToLiteRT() instead of passing
 *                    a callback here.
 */
export async function loadModel(
  model: ModelVariant,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  const lib = getLib();
  if (!lib) throw new Error('react-native-litert-lm native module not linked. Rebuild the app after installing the package.');
  if (_state.loadedModel === model && _llm) return;

  // Join an in-flight load for the same variant instead of starting a
  // parallel one. onProgress only fires on the original caller; secondary
  // callers can watch state changes via subscribeToLiteRT() if they need
  // realtime feedback — they will at least wait for the same completion.
  const existing = _inFlight.get(model);
  if (existing) return existing;

  const task = (async () => {
    _state.isLoading = true;
    _state.progress = 0;
    _state.error = null;
    _notify();

    try {
      // If a different variant is loaded, drop the old instance cleanly.
      if (_llm && _state.loadedModel !== model) {
        try { _llm.close(); } catch { /* best-effort */ }
        _llm = null;
        _state.loadedModel = null;
      }

      const instance = lib.createLLM();
      await instance.loadModel(
        MODEL_URLS[model],
        {
          // Default to CPU — most Android devices LiteRT-LM targets don't have
          // reliable GPU support for Gemma 4. Teachers on flagship phones can
          // flip this to 'gpu' later via a settings toggle if we surface one.
          backend: 'cpu',
        },
        (progress: number) => {
          // Library reports 0–1 fractional. Normalise to 0–100 for the rest
          // of the app (existing ModelContext progress UI assumes 0–100).
          const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
          _state.progress = pct;
          _notify();
          if (onProgress) onProgress(pct);
        },
      );

      // Library resolved — either cache hit, or download + init complete.
      // Force progress to 100 so subscribers see a clean finish even if the
      // final progress callback never fired (cache-hit path skips downloads).
      _llm = instance;
      _state.loadedModel = model;
      _state.progress = 100;
    } catch (err: any) {
      _state.error = err?.message ?? 'Unknown error loading model';
      _state.loadedModel = null;
      _llm = null;
      throw err;
    } finally {
      _state.isLoading = false;
      _notify();
    }
  })();

  _inFlight.set(model, task);
  try {
    await task;
  } finally {
    _inFlight.delete(model);
  }
}

/**
 * Delete the library's cached .litertlm file for a variant, freeing the
 * device storage it was occupying. Also unloads the model from memory if
 * it was loaded, so the file isn't held open during the delete.
 *
 * No-op if the native module isn't linked.
 */
export async function deleteCachedModel(variant: ModelVariant): Promise<void> {
  const lib = getLib();
  if (!lib) return;

  // Drop the in-memory instance first so it's not holding the file.
  if (_state.loadedModel === variant && _llm) {
    try { _llm.close(); } catch { /* best-effort */ }
    _llm = null;
    _state.loadedModel = null;
    _notify();
  }

  // The native deleteModel API hangs off any LLM instance. Create a
  // disposable one just for this call.
  const temp = lib.createLLM();
  try {
    await temp.deleteModel(cacheFileName(variant));
  } finally {
    try { temp.close(); } catch { /* best-effort */ }
  }
}

/**
 * Release the currently-loaded model and any native resources it holds.
 * Safe to call when nothing is loaded. Called implicitly by loadModel() when
 * switching variants — exposed for explicit shutdown if needed (e.g. model
 * delete from Settings).
 */
export function unloadModel(): void {
  if (_llm) {
    try { _llm.close(); } catch { /* best-effort */ }
    _llm = null;
  }
  _state.loadedModel = null;
  _state.isLoading = false;
  _state.progress = 0;
  _state.error = null;
  _notify();
}

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Generate a response from the currently loaded model.
 *
 * @param prompt   Full prompt text. Prepend system context inline —
 *                 LiteRT-LM exposes a systemPrompt option on loadModel, but
 *                 we don't use it here because each request can have
 *                 different context (grading vs tutoring vs scheme gen).
 * @param onToken  Optional streaming callback. Each call receives a token
 *                 chunk. When omitted, the call blocks until the full
 *                 response is ready.
 */
export async function generateResponse(
  prompt: string,
  onToken?: (partial: string) => void,
): Promise<string> {
  if (!getLib()) throw new Error('react-native-litert-lm native module not linked');
  if (!_llm || !_state.loadedModel) throw new Error('No model loaded. Call loadModel() first.');

  if (onToken) {
    // Native sendMessageAsync returns void — accumulate tokens and resolve
    // when done=true. Matches the React-hook wrapper the library ships.
    return new Promise<string>((resolve, reject) => {
      let full = '';
      try {
        _llm!.sendMessageAsync(prompt, (token, done) => {
          if (token) {
            full += token;
            onToken(token);
          }
          if (done) resolve(full);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  return _llm.sendMessage(prompt);
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
 * LiteRT-LM has a systemPrompt option on loadModel, but we don't use it
 * here because each request can vary. We embed everything in the user turn.
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
