// src/services/analytics.ts
//
// Mobile observability layer — Phase 1.
//
// Captures every screen view, button tap, API call, on-device AI event, and
// auth transition into a buffered queue, then ships them to the backend
// /api/events/batch endpoint so an admin dashboard can render real-time
// activity.
//
// Design constraints:
//   - Never crashes the app. Every persist + post wrapped in try/catch.
//   - Respects offline. Events stay queued in AsyncStorage until a
//     successful flush happens (auth must exist for flush — events stay
//     queued until login).
//   - Bypasses the global axios `client` from api.ts so its interceptors
//     don't recursively emit api.* events for our own /events/batch call.
//
// Public API:
//   bootAnalytics()       — call once from App.tsx top-level.
//   setUser(id, role, …)  — call from AuthContext.login / clear from logout.
//   newTraceId()          — `trc_<base36-time><random>` for request correlation.
//   track(...)            — generic event emitter.
//   trackError(...)       — convenience that fills error.type/message/stack.
//   trackScreen(...)      — fires `screen.<name>.view`.
//   trackTap(...)         — fires `tap.<surface>.<action>`.
//   flush()               — POSTs buffered events; re-enqueues on failure.

import axios, { AxiosInstance } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as Localization from 'expo-localization';
import Constants from 'expo-constants';
import { Platform, AppState, AppStateStatus } from 'react-native';

// ── Constants ────────────────────────────────────────────────────────────────

const QUEUE_KEY = 'neriah_event_queue';
const SESSION_KEY = 'neriah_session_id';
const JWT_KEY = 'neriah_jwt';

const MAX_QUEUE = 1000;
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 30_000;

// Sample-throttle these high-volume event types to 10%.
const THROTTLED_EVENTS = new Set<string>(['tap.scroll', 'tap.focus']);
const THROTTLE_RATE = 0.1;

const BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'https://us-central1-neriah-ai-492302.cloudfunctions.net/neriah-grading/api';

// ── Types ────────────────────────────────────────────────────────────────────

export type EventSeverity = 'debug' | 'info' | 'warn' | 'error';

export interface EventOpts {
  severity?:  EventSeverity;
  surface?:   string;
  trace_id?:  string;
  latency_ms?: number;
  error?: {
    type?:    string;
    message?: string;
    stack?:   string;
  };
}

export interface AnalyticsEvent {
  event_type: string;
  ts:         string;            // ISO timestamp
  session_id: string;
  trace_id?:  string;
  user_id?:   string | null;
  role?:      string | null;
  phone?:     string | null;
  surface?:   string;
  severity?:  EventSeverity;
  latency_ms?: number;
  error?:     EventOpts['error'];
  payload?:   Record<string, unknown>;
  device:     {
    os?:           string;
    os_version?:   string;
    model?:        string;
    app_version?:  string;
    locale?:       string;
    platform?:     string;
  };
}

// ── Module state ─────────────────────────────────────────────────────────────

let _queue: AnalyticsEvent[] = [];
let _sessionId: string = '';
let _userId: string | null = null;
let _role: string | null = null;
let _phone: string | null = null;
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _flushInFlight = false;
let _booted = false;

// Read device fields once at module init.
const _device = {
  os:          (Device.osName ?? Platform.OS) || undefined,
  os_version:  Device.osVersion ?? undefined,
  model:       Device.modelName ?? undefined,
  app_version: Application.nativeApplicationVersion ?? undefined,
  locale:      Localization.getLocales?.()?.[0]?.languageTag ?? undefined,
  platform:    Platform.OS,
};

// Standalone axios instance — does NOT inherit api.ts interceptors.
const _http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// ── ID helpers ───────────────────────────────────────────────────────────────

/** Generates `trc_<base36-time><random>` — short, sortable, unique-enough. */
export function newTraceId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `trc_${t}${r}`;
}

function newSessionId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `ses_${t}${r}`;
}

// ── Queue persistence ────────────────────────────────────────────────────────

async function persistQueue(): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(_queue));
  } catch {
    // Best-effort — never block tracking on storage errors.
  }
}

async function loadQueue(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      _queue = parsed.slice(-MAX_QUEUE);
    }
  } catch {
    _queue = [];
  }
}

async function loadOrCreateSession(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (raw) {
      _sessionId = raw;
      return;
    }
  } catch {
    /* fall through to create */
  }
  _sessionId = newSessionId();
  try {
    await AsyncStorage.setItem(SESSION_KEY, _sessionId);
  } catch {
    /* best-effort */
  }
}

// ── User identity ────────────────────────────────────────────────────────────

/**
 * Set or clear the user identity attached to subsequent events.
 * Pass nulls to clear (called from logout).
 */
export function setUser(
  userId: string | null,
  role: string | null,
  phone: string | null,
): void {
  _userId = userId;
  _role = role;
  _phone = phone;
}

// ── Event construction ───────────────────────────────────────────────────────

function buildEvent(eventType: string, payload?: Record<string, unknown>, opts?: EventOpts): AnalyticsEvent {
  return {
    event_type: eventType,
    ts:         new Date().toISOString(),
    session_id: _sessionId,
    trace_id:   opts?.trace_id,
    user_id:    _userId,
    role:       _role,
    phone:      _phone,
    surface:    opts?.surface,
    severity:   opts?.severity ?? (opts?.error ? 'error' : 'info'),
    latency_ms: opts?.latency_ms,
    error:      opts?.error,
    payload,
    device:     _device,
  };
}

// ── Public emit ──────────────────────────────────────────────────────────────

/** Main event method. */
export function track(
  eventType: string,
  payload?: Record<string, unknown>,
  opts?: EventOpts,
): void {
  try {
    // Sample-throttle high-volume event prefixes.
    if (THROTTLED_EVENTS.has(eventType) && Math.random() > THROTTLE_RATE) return;

    const ev = buildEvent(eventType, payload, opts);
    _queue.push(ev);

    // Cap queue to MAX_QUEUE — drop OLDEST events when overflowing.
    if (_queue.length > MAX_QUEUE) {
      _queue.splice(0, _queue.length - MAX_QUEUE);
    }

    // Fire-and-forget persist; intentionally not awaited so tracking is sync.
    persistQueue();
  } catch {
    // Never crash the app over telemetry.
  }
}

/** Convenience: build an `error` block from an Error/unknown and emit. */
export function trackError(
  eventType: string,
  err: unknown,
  payload?: Record<string, unknown>,
): void {
  let type: string | undefined;
  let message: string | undefined;
  let stack: string | undefined;
  try {
    if (err instanceof Error) {
      type = err.name;
      message = err.message;
      stack = err.stack;
    } else if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      type = (e.name as string) ?? (e.error_code as string) ?? 'object';
      message = (e.message as string) ?? (e.error as string) ?? JSON.stringify(err).slice(0, 500);
      stack = (e.stack as string) ?? undefined;
    } else {
      message = String(err);
    }
  } catch {
    message = 'Unserializable error';
  }
  track(eventType, payload, { severity: 'error', error: { type, message, stack } });
}

/** Fires `screen.<name>.view`. */
export function trackScreen(name: string, params?: Record<string, unknown>): void {
  track(`screen.${name}.view`, params, { surface: 'screen' });
}

/** Fires `tap.<surface>.<action>`. */
export function trackTap(
  surface: string,
  action: string,
  payload?: Record<string, unknown>,
): void {
  track(`tap.${surface}.${action}`, payload, { surface });
}

// ── Flush ────────────────────────────────────────────────────────────────────

/**
 * POST buffered events to /api/events/batch in chunks of BATCH_SIZE.
 * Bypasses the api.ts axios instance to avoid the request/response
 * interceptors emitting their own analytics events for this call.
 *
 * On failure, re-enqueues the dropped batch at the FRONT so order is
 * preserved on the next attempt.
 *
 * Skips entirely when no JWT is in SecureStore — events stay queued and
 * are replayed after login.
 */
export async function flush(): Promise<void> {
  if (_flushInFlight) return;
  if (_queue.length === 0) return;

  let token: string | null = null;
  try {
    token = await SecureStore.getItemAsync(JWT_KEY);
  } catch {
    /* SecureStore can throw on cold-start race conditions */
  }
  if (!token) return; // not authed yet; events stay queued

  _flushInFlight = true;
  try {
    while (_queue.length > 0) {
      const batch = _queue.splice(0, BATCH_SIZE);
      try {
        await _http.post(
          '/events/batch',
          { events: batch },
          { headers: { Authorization: `Bearer ${token}` } },
        );
      } catch {
        // Re-enqueue at the FRONT so order is preserved next attempt.
        _queue.unshift(...batch);
        break;
      }
    }
    await persistQueue();
  } catch {
    // Should be impossible — guard anyway.
  } finally {
    _flushInFlight = false;
  }
}

// ── AppState handling ────────────────────────────────────────────────────────

let _lastAppState: AppStateStatus = 'active';
function onAppStateChange(next: AppStateStatus) {
  // Background → trigger one final flush attempt so a kill-from-recents
  // doesn't strand the last 30s of events on disk.
  if ((_lastAppState === 'active' || _lastAppState === 'inactive') && next === 'background') {
    flush().catch(() => {});
  }
  _lastAppState = next;
}

// ── Boot ─────────────────────────────────────────────────────────────────────

/**
 * Initialise the analytics layer. Idempotent — safe to call multiple times.
 * Hydrates the queue from AsyncStorage, generates / reads the session id,
 * starts the 30s flush interval, hooks AppState background-flush.
 */
export function bootAnalytics(): void {
  if (_booted) return;
  _booted = true;

  // Hydrate session + queue asynchronously. We don't block the caller — the
  // first few track() calls before hydration completes go into the in-memory
  // queue and will be persisted on the next flush. Worst case we double-buffer
  // a handful of events; fine.
  (async () => {
    await loadOrCreateSession();
    await loadQueue();
  })().catch(() => {});

  // Periodic flush.
  if (_flushTimer) clearInterval(_flushTimer);
  _flushTimer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS);

  // Flush when app moves to background.
  try {
    AppState.addEventListener('change', onAppStateChange);
  } catch {
    /* RN < 0.65 had a different API; harmless to skip */
  }
}
