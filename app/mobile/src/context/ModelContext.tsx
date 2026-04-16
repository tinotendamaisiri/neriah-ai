// src/context/ModelContext.tsx
// React context for the on-device model download state machine.
//
// State machine:
//   idle        — no download in progress, model not on disk
//   downloading — active download, progress 0–100
//   paused      — download paused, can be resumed
//   done        — model file on disk and ready
//   error       — download failed
//
// One-time prompt logic:
//   After device capability detection, if the device is capable AND the user
//   hasn't been prompted before, showPrompt = true. The modal in App.tsx
//   renders when showPrompt is true. Accepting starts the download; skipping
//   records the prompt and never shows it again.
//
// Wi-Fi only gate:
//   If wifiOnly is enabled, downloads only start/resume on a Wi-Fi connection.
//   The user can toggle this in Settings. Persisted via SecureStore.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Alert, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';

import {
  getStoredCapability,
  type DeviceCapability,
} from '../services/deviceCapabilities';

export type { DeviceCapability };
import {
  startDownload,
  pauseDownload as pauseMgr,
  cancelDownload as cancelMgr,
  deleteModelFile,
  isModelOnDisk,
  MODEL_DOWNLOADED_KEY,
  DOWNLOAD_PROMPTED_KEY,
  WIFI_ONLY_KEY,
  WIFI_NUDGE_LAST_DATE_KEY,
  WIFI_NUDGE_NEVER_KEY,
  MODEL_DISPLAY_NAME,
  MODEL_SIZE_LABEL,
  MODEL_SIZES_BYTES,
  type ModelVariant,
} from '../services/modelManager';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DownloadStatus = 'idle' | 'downloading' | 'paused' | 'done' | 'error';

export interface ModelContextValue {
  /** Current download status. */
  status: DownloadStatus;
  /** Download progress 0–100. Meaningful only when status === 'downloading'. */
  progress: number;
  /** True if the one-time download prompt should be shown. */
  showPrompt: boolean;
  /** True if the model file is present and usable. */
  modelReady: boolean;
  /** Which model variant this device will use (null if cloud-only). */
  variant: ModelVariant | null;
  /** Raw device capability tier — null until first launch detection completes. */
  capability: DeviceCapability | null;
  /** Whether downloads are restricted to Wi-Fi. */
  wifiOnly: boolean;
  /** Last error message, if status === 'error'. */
  errorMessage: string | null;

  /** Called once on app start to check capability + prompt state. */
  initPrompt: () => Promise<void>;
  /** User tapped "Download now" on the prompt. Starts the download. */
  acceptDownload: () => Promise<void>;
  /** User tapped "Skip for now" on the prompt. Records the prompt. */
  skipDownload: () => Promise<void>;
  /** Pause the active download. */
  pauseDownload: () => Promise<void>;
  /** Resume a paused download. */
  resumeDownload: () => Promise<void>;
  /** Cancel download and delete partial file. */
  cancelDownload: () => Promise<void>;
  /** Delete the downloaded model to free storage. */
  deleteModel: () => Promise<void>;
  /** Toggle Wi-Fi only setting. */
  setWifiOnly: (val: boolean) => Promise<void>;

  /** True when the recurring Wi-Fi nudge banner should be shown. */
  showWifiNudge: boolean;
  /**
   * Check whether the recurring Wi-Fi nudge should be shown now.
   * Safe to call on every HomeScreen focus — all gates are checked internally.
   */
  checkWifiNudge: () => Promise<void>;
  /** User tapped "Later" — dismisses the nudge and resets the 7-day clock. */
  dismissWifiNudge: () => Promise<void>;
  /** User tapped "Never ask again" — permanently suppresses the nudge. */
  neverShowNudge: () => Promise<void>;
  /**
   * Called by active-task screens (grading, submitting, tutoring) to prevent
   * the nudge from appearing while the user is busy.
   * Pass true on mount, false on unmount.
   */
  suppressNudge: (suppress: boolean) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ModelContext = createContext<ModelContextValue | null>(null);

export function useModel(): ModelContextValue {
  const ctx = useContext(ModelContext);
  if (!ctx) throw new Error('useModel must be used inside ModelProvider');
  return ctx;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function capabilityToVariant(cap: DeviceCapability): ModelVariant | null {
  if (cap === 'e4b-capable') return 'e4b';
  if (cap === 'e2b-capable') return 'e2b';
  return null;
}

async function isWifi(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.type === 'wifi';
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ModelProvider({ children }: { children: React.ReactNode }) {
  // Web never downloads models — all inference is cloud-side.
  if (Platform.OS === 'web') {
    const noopCtx: ModelContextValue = {
      status: 'idle',
      progress: 0,
      showPrompt: false,
      modelReady: false,
      variant: null,
      capability: 'cloud-only',
      wifiOnly: false,
      errorMessage: null,
      initPrompt: async () => {},
      acceptDownload: async () => {},
      skipDownload: async () => {},
      pauseDownload: async () => {},
      resumeDownload: async () => {},
      cancelDownload: async () => {},
      deleteModel: async () => {},
      setWifiOnly: async () => {},
      showWifiNudge: false,
      checkWifiNudge: async () => {},
      dismissWifiNudge: async () => {},
      neverShowNudge: async () => {},
      suppressNudge: () => {},
    };
    return <ModelContext.Provider value={noopCtx}>{children}</ModelContext.Provider>;
  }

  return <ModelProviderNative>{children}</ModelProviderNative>;
}

function ModelProviderNative({ children }: { children: React.ReactNode }) {
  const [status, setStatus]             = useState<DownloadStatus>('idle');
  const [progress, setProgress]         = useState(0);
  const [showPrompt, setShowPrompt]     = useState(false);
  const [modelReady, setModelReady]     = useState(false);
  const [variant, setVariant]           = useState<ModelVariant | null>(null);
  const [capability, setCapability]     = useState<DeviceCapability | null>(null);
  const [wifiOnly, setWifiOnlyState]    = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Keep a ref to the current variant so callbacks can access it without
  // stale-closure issues.
  const variantRef = useRef<ModelVariant | null>(null);
  useEffect(() => { variantRef.current = variant; }, [variant]);

  // ── Wi-Fi nudge refs ───────────────────────────────────────────────────────
  // These are refs (not state) because they govern show-guards, not render output.
  /** True once the nudge banner has been shown in this app session. */
  const nudgeShownThisSessionRef = useRef(false);
  /** Set to true by active-task screens (grading, tutoring) to block the nudge. */
  const nudgeSuppressedRef = useRef(false);

  const [showWifiNudge, setShowWifiNudge] = useState(false);

  // ── Boot: read persisted state ──────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      // Wi-Fi only preference
      const wifiPref = await SecureStore.getItemAsync(WIFI_ONLY_KEY).catch(() => null);
      if (wifiPref === 'true') setWifiOnlyState(true);

      // Check if model already downloaded
      const cap = await getStoredCapability();
      if (!cap) return;
      setCapability(cap);
      const v = capabilityToVariant(cap);
      if (!v) return;
      setVariant(v);
      variantRef.current = v;

      const downloaded = await SecureStore.getItemAsync(MODEL_DOWNLOADED_KEY).catch(() => null);
      if (downloaded === 'true') {
        // Sanity: confirm file actually exists
        const onDisk = await isModelOnDisk(v);
        if (onDisk) {
          setStatus('done');
          setModelReady(true);
        } else {
          // File missing — clear stale flag
          await SecureStore.deleteItemAsync(MODEL_DOWNLOADED_KEY).catch(() => {});
        }
      }
    })();
  }, []);

  // ── initPrompt ─────────────────────────────────────────────────────────────

  const initPrompt = useCallback(async () => {
    if (Platform.OS === 'web') return;

    const cap = await getStoredCapability();
    if (!cap) return;

    setCapability(cap);

    const v = capabilityToVariant(cap);
    if (!v) return; // cloud-only device, nothing to download

    setVariant(v);
    variantRef.current = v;

    // Already done?
    const downloaded = await SecureStore.getItemAsync(MODEL_DOWNLOADED_KEY).catch(() => null);
    if (downloaded === 'true') {
      const onDisk = await isModelOnDisk(v);
      if (onDisk) { setStatus('done'); setModelReady(true); return; }
      await SecureStore.deleteItemAsync(MODEL_DOWNLOADED_KEY).catch(() => {});
    }

    // Already prompted?
    const prompted = await SecureStore.getItemAsync(DOWNLOAD_PROMPTED_KEY).catch(() => null);
    if (prompted === 'true') return;

    // Show the one-time prompt
    setShowPrompt(true);
  }, []);

  // ── acceptDownload ─────────────────────────────────────────────────────────

  const acceptDownload = useCallback(async () => {
    setShowPrompt(false);
    await SecureStore.setItemAsync(DOWNLOAD_PROMPTED_KEY, 'true').catch(() => {});

    const v = variantRef.current;
    if (!v) return;

    // Wi-Fi only gate
    const onWifi = await isWifi();
    const wifiPref = await SecureStore.getItemAsync(WIFI_ONLY_KEY).catch(() => null);
    if (wifiPref === 'true' && !onWifi) {
      Alert.alert(
        'Wi-Fi required',
        `${MODEL_DISPLAY_NAME[v]} (${MODEL_SIZE_LABEL[v]}) will download automatically when you connect to Wi-Fi.`,
      );
      return;
    }

    setStatus('downloading');
    setProgress(0);
    setErrorMessage(null);

    await startDownload(
      v,
      (pct) => setProgress(pct),
      () => { setStatus('done'); setModelReady(true); setProgress(100); },
      (msg) => { setStatus('error'); setErrorMessage(msg); },
    );
  }, []);

  // ── skipDownload ───────────────────────────────────────────────────────────

  const skipDownload = useCallback(async () => {
    setShowPrompt(false);
    await SecureStore.setItemAsync(DOWNLOAD_PROMPTED_KEY, 'true').catch(() => {});
  }, []);

  // ── pauseDownload ──────────────────────────────────────────────────────────

  const pauseDownload = useCallback(async () => {
    await pauseMgr();
    setStatus('paused');
  }, []);

  // ── resumeDownload ─────────────────────────────────────────────────────────

  const resumeDownload = useCallback(async () => {
    const v = variantRef.current;
    if (!v) return;

    // Wi-Fi only gate
    const onWifi = await isWifi();
    const wifiPref = await SecureStore.getItemAsync(WIFI_ONLY_KEY).catch(() => null);
    if (wifiPref === 'true' && !onWifi) {
      Alert.alert('Wi-Fi required', 'Connect to Wi-Fi to resume the download.');
      return;
    }

    setStatus('downloading');
    setErrorMessage(null);

    await startDownload(
      v,
      (pct) => setProgress(pct),
      () => { setStatus('done'); setModelReady(true); setProgress(100); },
      (msg) => { setStatus('error'); setErrorMessage(msg); },
    );
  }, []);

  // ── cancelDownload ─────────────────────────────────────────────────────────

  const cancelDownload = useCallback(async () => {
    const v = variantRef.current;
    if (!v) return;
    await cancelMgr(v);
    setStatus('idle');
    setProgress(0);
    setErrorMessage(null);
  }, []);

  // ── deleteModel ────────────────────────────────────────────────────────────

  const deleteModel = useCallback(async () => {
    const v = variantRef.current;
    if (!v) return;
    await deleteModelFile(v);
    setStatus('idle');
    setModelReady(false);
    setProgress(0);
  }, []);

  // ── setWifiOnly ────────────────────────────────────────────────────────────

  const setWifiOnly = useCallback(async (val: boolean) => {
    setWifiOnlyState(val);
    await SecureStore.setItemAsync(WIFI_ONLY_KEY, val ? 'true' : 'false').catch(() => {});
  }, []);

  // ── checkWifiNudge ─────────────────────────────────────────────────────────
  // All gates are checked here so the caller (HomeScreen) can call this
  // unconditionally on every focus without any logic on its side.

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const checkWifiNudge = useCallback(async () => {
    if (Platform.OS === 'web') return;
    // Once-per-session guard
    if (nudgeShownThisSessionRef.current) return;
    // Active-task suppression guard
    if (nudgeSuppressedRef.current) return;

    // Device must be on-device-capable
    const cap = await getStoredCapability();
    if (!cap || cap === 'cloud-only') return;

    // Model must not already be on disk
    const v = variantRef.current ?? capabilityToVariant(cap);
    if (v) {
      const onDisk = await isModelOnDisk(v);
      if (onDisk) return;
    }

    // User must have seen the one-time prompt (i.e. skipped it, not brand-new)
    const prompted = await SecureStore.getItemAsync(DOWNLOAD_PROMPTED_KEY).catch(() => null);
    if (prompted !== 'true') return;

    // Permanent opt-out
    const neverNudge = await SecureStore.getItemAsync(WIFI_NUDGE_NEVER_KEY).catch(() => null);
    if (neverNudge === 'true') return;

    // 7-day cooldown
    const lastNudgeRaw = await SecureStore.getItemAsync(WIFI_NUDGE_LAST_DATE_KEY).catch(() => null);
    if (lastNudgeRaw) {
      const lastMs = parseInt(lastNudgeRaw, 10);
      if (!isNaN(lastMs) && Date.now() - lastMs < SEVEN_DAYS_MS) return;
    }

    // Must be on Wi-Fi right now
    const onWifi = await isWifi();
    if (!onWifi) return;

    // All gates passed — show the nudge once this session
    nudgeShownThisSessionRef.current = true;
    setShowWifiNudge(true);
  }, []);

  // ── dismissWifiNudge ───────────────────────────────────────────────────────
  // "Later" — hides the banner and resets the 7-day clock.

  const dismissWifiNudge = useCallback(async () => {
    setShowWifiNudge(false);
    await SecureStore.setItemAsync(
      WIFI_NUDGE_LAST_DATE_KEY,
      String(Date.now()),
    ).catch(() => {});
  }, []);

  // ── neverShowNudge ─────────────────────────────────────────────────────────
  // "Never ask again" — permanently suppresses the nudge via SecureStore.

  const neverShowNudge = useCallback(async () => {
    setShowWifiNudge(false);
    await SecureStore.setItemAsync(WIFI_NUDGE_NEVER_KEY, 'true').catch(() => {});
  }, []);

  // ── suppressNudge ──────────────────────────────────────────────────────────
  // Called by active-task screens on mount (true) and unmount (false).

  const suppressNudge = useCallback((suppress: boolean) => {
    nudgeSuppressedRef.current = suppress;
    if (suppress) setShowWifiNudge(false);
  }, []);

  // ── Auto-download on Wi-Fi ──────────────────────────────────────────────────
  // Watches connectivity: starts download when Wi-Fi connects, pauses when it drops.

  const autoDownloadStartedRef = useRef(false);
  const AUTO_NOTIFIED_KEY = 'offline_model_auto_notified';

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const onWifi = state.type === 'wifi' && state.isConnected === true;
      const v = variantRef.current;

      if (onWifi && v) {
        // Model already downloaded or currently downloading — skip
        const downloaded = await SecureStore.getItemAsync(MODEL_DOWNLOADED_KEY).catch(() => null);
        if (downloaded === 'true') return;
        if (autoDownloadStartedRef.current) return; // already triggered this session

        // Check if model is on disk (stale flag cleared earlier)
        const onDisk = await isModelOnDisk(v);
        if (onDisk) return;

        // Auto-start download
        autoDownloadStartedRef.current = true;
        console.log('[ModelProvider] Wi-Fi detected — auto-starting model download');

        // One-time notification (first auto-download ever)
        const notified = await SecureStore.getItemAsync(AUTO_NOTIFIED_KEY).catch(() => null);
        if (notified !== 'true') {
          await SecureStore.setItemAsync(AUTO_NOTIFIED_KEY, 'true').catch(() => {});
          // Mark prompt as shown so the manual prompt never appears
          await SecureStore.setItemAsync(DOWNLOAD_PROMPTED_KEY, 'true').catch(() => {});
          Alert.alert(
            'Downloading offline AI',
            'Neriah is downloading the AI model in the background. Once complete, marking and tutoring work without internet.',
          );
        }

        setStatus('downloading');
        setProgress(0);
        setErrorMessage(null);

        await startDownload(
          v,
          (pct) => setProgress(pct),
          () => { setStatus('done'); setModelReady(true); setProgress(100); },
          (msg) => { setStatus('error'); setErrorMessage(msg); autoDownloadStartedRef.current = false; },
        );
      } else if (!onWifi && status === 'downloading') {
        // Wi-Fi dropped mid-download — pause
        console.log('[ModelProvider] Wi-Fi lost — pausing download');
        await pauseMgr();
        setStatus('paused');
        autoDownloadStartedRef.current = false; // allow resume on next Wi-Fi connect
      }
    });

    return unsubscribe;
  }, [status]);

  // ── Context value ──────────────────────────────────────────────────────────

  const value: ModelContextValue = {
    status,
    progress,
    showPrompt,
    modelReady,
    variant,
    capability,
    wifiOnly,
    errorMessage,
    initPrompt,
    acceptDownload,
    skipDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteModel,
    setWifiOnly,
    showWifiNudge,
    checkWifiNudge,
    dismissWifiNudge,
    neverShowNudge,
    suppressNudge,
  };

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}
