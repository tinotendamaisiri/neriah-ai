'use client';

import React, {
  useState, useEffect, useCallback, useRef,
} from 'react';

// ── Brand palette (matches /admin/curriculum) ────────────────────────────────
const C = {
  teal:    '#0D9488',
  tealDk:  '#0F766E',
  tealLt:  '#F0FDFA',
  amber:   '#F59E0B',
  amberLt: '#FFFBEB',
  red:     '#DC2626',
  redLt:   '#FEF2F2',
  redDk:   '#7F1D1D',
  green:   '#16A34A',
  greenLt: '#F0FDF4',
  blue:    '#2563EB',
  blueLt:  '#EFF6FF',
  purple:  '#7C3AED',
  g50:     '#F9FAFB',
  g100:    '#F3F4F6',
  g200:    '#E5E7EB',
  g300:    '#D1D5DB',
  g400:    '#9CA3AF',
  g500:    '#6B7280',
  g700:    '#374151',
  g900:    '#111827',
  white:   '#FFFFFF',
};

// ── Types ────────────────────────────────────────────────────────────────────
type Severity = 'info' | 'warn' | 'error' | 'critical';
type Source   = 'mobile' | 'backend' | 'wa' | 'email';

interface MonitoringEvent {
  id?:          string;
  event_id?:    string;
  trace_id?:    string;
  timestamp:    string;          // ISO string
  severity:     Severity;
  event_type:   string;
  surface?:     string;
  source?:      Source | string;
  user_id?:     string;
  user_role?:   string;
  user_phone?:  string;
  latency_ms?:  number;
  message?:     string;
  payload?:     Record<string, unknown>;
}

interface ErrorGroup {
  error_type:  string;
  message:     string;
  count:       number;
  first_seen:  string;
  last_seen:   string;
  sample_event_id?: string;
  sample_user_id?:  string;
  sample_trace_id?: string;
  surface?:    string;
  source?:     string;
}

type TabKey = 'live' | 'errors' | 'funnels' | 'ai_usage' | 'play' | 'trace';

// ── Proxy fetch helper (browser → Next API → Cloud Functions) ────────────────
async function proxyJson(path: string): Promise<unknown> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Tiny UI primitives (inline-styled, matches curriculum admin) ─────────────
function Btn({
  children, onClick, color = C.teal, disabled = false,
  variant = 'fill', type = 'button',
}: {
  children:  React.ReactNode;
  onClick?:  () => void;
  color?:    string;
  disabled?: boolean;
  variant?:  'fill' | 'outline' | 'ghost';
  type?:     'button' | 'submit';
}) {
  const base: React.CSSProperties = {
    padding:    '8px 16px',
    borderRadius: 8,
    fontSize:   13,
    fontWeight: 600,
    cursor:     disabled ? 'not-allowed' : 'pointer',
    border:     'none',
    transition: 'opacity .15s',
    opacity:    disabled ? 0.5 : 1,
  };
  if (variant === 'fill') {
    return (
      <button type={type} onClick={disabled ? undefined : onClick}
        style={{ ...base, background: color, color: C.white }}>
        {children}
      </button>
    );
  }
  if (variant === 'outline') {
    return (
      <button type={type} onClick={disabled ? undefined : onClick}
        style={{ ...base, background: 'transparent', color,
          border: `1.5px solid ${color}` }}>
        {children}
      </button>
    );
  }
  return (
    <button type={type} onClick={disabled ? undefined : onClick}
      style={{ ...base, background: 'transparent', color: C.g500 }}>
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 13, fontWeight: 600,
      color: C.g700, marginBottom: 4 }}>
      {children}
    </label>
  );
}

function Input({
  value, onChange, placeholder, type = 'text', error,
}: {
  value:        string;
  onChange:     (v: string) => void;
  placeholder?: string;
  type?:        string;
  error?:       boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width:      '100%',
        boxSizing:  'border-box',
        padding:    '8px 12px',
        borderRadius: 8,
        border:     `1.5px solid ${error ? C.red : C.g200}`,
        fontSize:   14,
        outline:    'none',
        background: C.white,
        color:      C.g900,
      }}
    />
  );
}

// ── Login form (copied from curriculum admin, retitled "Monitoring") ─────────
function LoginForm({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [emailErr, setEmailErr] = useState(false);
  const [loading, setLoading]   = useState(false);

  const submit = async () => {
    setError('');
    setEmailErr(false);

    if (!email.trim()) { setError('Email is required.'); setEmailErr(true); return; }
    if (!email.toLowerCase().endsWith('@neriah.ai')) {
      setEmailErr(true);
      setError('Only @neriah.ai email addresses are allowed.');
      return;
    }
    if (!password) { setError('Password is required.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ email: email.trim(), password }),
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(body.error || 'Sign in failed. Please try again.');
        return;
      }
      onSuccess(email.trim());
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.g50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: C.white, borderRadius: 16, padding: 36,
        width: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12,
            background: C.teal, margin: '0 auto 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22 }}>
            📡
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.g900 }}>
            Neriah Monitoring
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: C.g500 }}>
            Sign in with your @neriah.ai account
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Label>Email</Label>
            <Input
              value={email}
              onChange={v => { setEmail(v); setEmailErr(false); setError(''); }}
              placeholder="you@neriah.ai"
              type="email"
              error={emailErr}
            />
            {emailErr && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: C.red }}>
                Only @neriah.ai email addresses are allowed.
              </p>
            )}
          </div>

          <div>
            <Label>Password</Label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                placeholder="••••••••"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '8px 40px 8px 12px', borderRadius: 8,
                  border: `1.5px solid ${C.g200}`, fontSize: 14,
                  outline: 'none', background: C.white, color: C.g900,
                }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: 2, color: C.g400, lineHeight: 1,
                }}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && !emailErr && (
            <p style={{ margin: 0, fontSize: 13, color: C.red }}>{error}</p>
          )}

          <Btn onClick={submit} disabled={loading} type="submit">
            {loading ? 'Signing in…' : 'Sign In'}
          </Btn>
        </div>

        <p style={{ margin: '18px 0 0', fontSize: 12, color: C.g400, textAlign: 'center' }}>
          Admin access only. Reset credentials via environment variables.
        </p>
      </div>
    </div>
  );
}

// ── Helpers: severity colors, relative time, etc. ────────────────────────────
function severityColors(s: Severity): { bg: string; fg: string } {
  switch (s) {
    case 'info':     return { bg: C.tealLt,  fg: C.tealDk };
    case 'warn':     return { bg: C.amberLt, fg: C.amber  };
    case 'error':    return { bg: C.redLt,   fg: C.red    };
    case 'critical': return { bg: C.redDk,   fg: C.white  };
    default:         return { bg: C.g100,    fg: C.g500   };
  }
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 5)     return 'just now';
  if (sec < 60)   return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)   return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)   return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30)   return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function shortId(id: string | undefined, len = 6): string {
  if (!id) return '—';
  return id.length <= len ? id : id.slice(0, len);
}

function payloadPreview(ev: MonitoringEvent): string {
  if (ev.message) return ev.message;
  if (!ev.payload) return '';
  try {
    const s = JSON.stringify(ev.payload);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  } catch { return ''; }
}

// ── Severity badge ───────────────────────────────────────────────────────────
function SeverityBadge({ severity }: { severity: Severity }) {
  const { bg, fg } = severityColors(severity);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: bg, color: fg,
      fontSize: 10, fontWeight: 700,
      padding: '2px 7px', borderRadius: 4,
      letterSpacing: 0.4, textTransform: 'uppercase',
      flexShrink: 0,
    }}>
      {severity}
    </span>
  );
}

function SmallBadge({
  children, color = C.g500, bg = C.g100,
}: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: bg, color, fontSize: 11, fontWeight: 600,
      padding: '2px 7px', borderRadius: 4, flexShrink: 0,
    }}>
      {children}
    </span>
  );
}

// ── Filter pills (multi-select chips) ────────────────────────────────────────
function PillRow<T extends string>({
  label, options, selected, onToggle,
}: {
  label:    string;
  options:  readonly T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: C.g500, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 }}>
        {label}
      </span>
      {options.map(opt => {
        const active = selected.has(opt);
        return (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            style={{
              padding: '4px 10px', borderRadius: 999,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1.5px solid ${active ? C.teal : C.g200}`,
              background: active ? C.tealLt : C.white,
              color:      active ? C.tealDk : C.g500,
              transition: 'all .12s',
            }}>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ── Live feed table — extracted for reuse ────────────────────────────────────
function MonitoringEventsTable({
  events, onSelect,
}: {
  events: MonitoringEvent[];
  onSelect: (ev: MonitoringEvent) => void;
}) {
  if (events.length === 0) {
    return (
      <div style={{ background: C.white, borderRadius: 12,
        border: `1.5px solid ${C.g200}`, padding: 32, textAlign: 'center' }}>
        <p style={{ color: C.g400, fontSize: 14, margin: 0 }}>
          No events match these filters yet.
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: C.white, borderRadius: 12,
      border: `1.5px solid ${C.g200}`, overflow: 'hidden' }}>
      {events.map((ev, i) => {
        const id = ev.event_id || ev.id || `${ev.timestamp}-${i}`;
        return (
          <button
            key={id}
            onClick={() => onSelect(ev)}
            style={{
              width: '100%', textAlign: 'left',
              display: 'grid',
              gridTemplateColumns: '70px 90px 1fr 1fr 90px',
              alignItems: 'center', columnGap: 12,
              padding: '10px 16px',
              background: C.white, color: C.g900,
              border: 'none', borderBottom: i === events.length - 1
                ? 'none' : `1px solid ${C.g100}`,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = C.g50)}
            onMouseLeave={e => (e.currentTarget.style.background = C.white)}
          >
            <SeverityBadge severity={ev.severity} />
            <span style={{ fontSize: 11, color: C.g500 }}>
              {relativeTime(ev.timestamp)}
            </span>
            <span style={{ fontSize: 12, color: C.g900,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ev.event_type}
            </span>
            <span style={{ display: 'flex', alignItems: 'center',
              gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
              {ev.surface && <SmallBadge>{ev.surface}</SmallBadge>}
              {ev.user_role && (
                <SmallBadge bg={C.blueLt} color={C.blue}>
                  {ev.user_role}
                </SmallBadge>
              )}
              {ev.user_id && (
                <span style={{ fontSize: 11, color: C.g400,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {shortId(ev.user_id)}
                </span>
              )}
              <span style={{ fontSize: 12, color: C.g500,
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', minWidth: 0 }}>
                {payloadPreview(ev)}
              </span>
            </span>
            <span style={{ fontSize: 11, color: C.g500, textAlign: 'right' }}>
              {typeof ev.latency_ms === 'number'
                ? `${Math.round(ev.latency_ms)}ms`
                : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Side panel with full JSON ────────────────────────────────────────────────
function EventSidePanel({
  event, onClose, onViewTrace,
}: {
  event: MonitoringEvent | null;
  onClose: () => void;
  onViewTrace: (ev: MonitoringEvent) => void;
}) {
  if (!event) return null;
  const traceId = event.trace_id || event.event_id || event.id;

  const copyTrace = () => {
    if (!traceId) return;
    navigator.clipboard.writeText(traceId).catch(() => {});
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(17,24,39,.35)',
          zIndex: 40,
        }}
      />
      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(560px, 92vw)', background: C.white,
        boxShadow: '-8px 0 32px rgba(0,0,0,.14)',
        zIndex: 50, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '16px 20px',
          borderBottom: `1px solid ${C.g200}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <SeverityBadge severity={event.severity} />
            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13, color: C.g900, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {event.event_type}
            </span>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 20, color: C.g500, padding: 4 }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '14px 20px', display: 'flex', gap: 8,
          borderBottom: `1px solid ${C.g100}`, flexWrap: 'wrap' }}>
          <Btn variant="outline" onClick={copyTrace} color={C.teal}>
            Copy trace_id
          </Btn>
          <Btn variant="outline" onClick={() => onViewTrace(event)} color={C.tealDk}>
            View this user&apos;s trace
          </Btn>
        </div>

        <div style={{ padding: '14px 20px', flex: 1, overflow: 'auto' }}>
          <div style={{ display: 'grid',
            gridTemplateColumns: '120px 1fr', gap: '6px 12px',
            fontSize: 12, marginBottom: 14 }}>
            <span style={{ color: C.g500 }}>Timestamp</span>
            <span style={{ color: C.g900 }}>{event.timestamp}</span>

            {event.trace_id && (
              <>
                <span style={{ color: C.g500 }}>trace_id</span>
                <span style={{ color: C.g900,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  wordBreak: 'break-all' }}>
                  {event.trace_id}
                </span>
              </>
            )}
            {event.user_id && (
              <>
                <span style={{ color: C.g500 }}>user_id</span>
                <span style={{ color: C.g900,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  wordBreak: 'break-all' }}>
                  {event.user_id}
                </span>
              </>
            )}
            {event.user_role && (
              <>
                <span style={{ color: C.g500 }}>role</span>
                <span style={{ color: C.g900 }}>{event.user_role}</span>
              </>
            )}
            {event.surface && (
              <>
                <span style={{ color: C.g500 }}>surface</span>
                <span style={{ color: C.g900 }}>{event.surface}</span>
              </>
            )}
            {event.source && (
              <>
                <span style={{ color: C.g500 }}>source</span>
                <span style={{ color: C.g900 }}>{event.source}</span>
              </>
            )}
            {typeof event.latency_ms === 'number' && (
              <>
                <span style={{ color: C.g500 }}>latency</span>
                <span style={{ color: C.g900 }}>{Math.round(event.latency_ms)}ms</span>
              </>
            )}
          </div>

          <Label>Full event JSON</Label>
          <pre style={{
            background: C.g50, border: `1px solid ${C.g200}`,
            borderRadius: 8, padding: 12, fontSize: 12,
            color: C.g900, overflow: 'auto', maxHeight: '50vh',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      </div>
    </>
  );
}

// ── Live feed tab ────────────────────────────────────────────────────────────
const SEVERITY_OPTIONS = ['info', 'warn', 'error', 'critical'] as const;
const SOURCE_OPTIONS   = ['mobile', 'backend', 'wa', 'email']  as const;
const SURFACE_OPTIONS  = [
  'tutor', 'assistant', 'marking', 'grading', 'auth',
  'submissions', 'analytics', 'sync',
] as const;

function LiveFeedTab({ onOpenTraceTab }: {
  onOpenTraceTab: (params: { user_id?: string; phone?: string; trace_id?: string }) => void;
}) {
  const [events, setEvents]       = useState<MonitoringEvent[]>([]);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<MonitoringEvent | null>(null);

  // Filter state
  const [sevFilter,     setSevFilter]     = useState<Set<Severity>>(new Set());
  const [sourceFilter,  setSourceFilter]  = useState<Set<Source>>(new Set());
  const [surfaceFilter, setSurfaceFilter] = useState<Set<string>>(new Set());
  const [search,        setSearch]        = useState('');
  const [paused, setPaused]               = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (sevFilter.size)     params.set('severity', [...sevFilter].join(','));
      if (sourceFilter.size)  params.set('source',   [...sourceFilter].join(','));
      if (surfaceFilter.size) params.set('surface',  [...surfaceFilter].join(','));
      if (search.trim())      params.set('q', search.trim());
      const data = await proxyJson(`/api/admin/events?${params.toString()}`) as
        { events?: MonitoringEvent[] } | MonitoringEvent[];
      const list = Array.isArray(data) ? data : (data.events ?? []);
      // Newest first — assume backend returns newest-first; sort defensively.
      list.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEvents(list);
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load events.');
    } finally {
      setLoading(false);
    }
  }, [sevFilter, sourceFilter, surfaceFilter, search]);

  // Initial fetch + polling
  useEffect(() => {
    loadEvents();
    if (paused) return;
    intervalRef.current = setInterval(loadEvents, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadEvents, paused]);

  const toggle = <T extends string>(set: Set<T>, value: T,
    setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  const handleViewTrace = (ev: MonitoringEvent) => {
    setSelected(null);
    onOpenTraceTab({
      user_id:  ev.user_id,
      phone:    ev.user_phone,
      trace_id: ev.trace_id,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filter toolbar */}
      <div style={{ background: C.white, borderRadius: 12,
        border: `1.5px solid ${C.g200}`, padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 10 }}>

        <PillRow
          label="Severity"
          options={SEVERITY_OPTIONS}
          selected={sevFilter}
          onToggle={v => toggle(sevFilter, v, setSevFilter)}
        />
        <PillRow
          label="Source"
          options={SOURCE_OPTIONS}
          selected={sourceFilter}
          onToggle={v => toggle(sourceFilter, v, setSourceFilter)}
        />
        <PillRow
          label="Surface"
          options={SURFACE_OPTIONS}
          selected={surfaceFilter}
          onToggle={v => toggle(surfaceFilter, v, setSurfaceFilter)}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search event_type…"
            style={{ flex: 1, padding: '7px 12px', borderRadius: 8,
              border: `1.5px solid ${C.g200}`, fontSize: 13, outline: 'none' }}
          />
          <Btn
            variant={paused ? 'fill' : 'outline'}
            color={paused ? C.amber : C.teal}
            onClick={() => setPaused(p => !p)}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </Btn>
          <span style={{ fontSize: 12, color: C.g400 }}>
            {paused ? 'live updates paused' : 'auto-refresh 5s'}
          </span>
        </div>
      </div>

      {error && (
        <div style={{ background: C.redLt, border: `1.5px solid ${C.red}`,
          borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.red }}>
          {error}
        </div>
      )}

      {loading && events.length === 0 && (
        <p style={{ color: C.g400, fontSize: 14, textAlign: 'center' }}>
          Loading events…
        </p>
      )}

      {!loading && (
        <MonitoringEventsTable events={events} onSelect={setSelected} />
      )}

      <EventSidePanel
        event={selected}
        onClose={() => setSelected(null)}
        onViewTrace={handleViewTrace}
      />
    </div>
  );
}

// ── ErrorGroupCard component ─────────────────────────────────────────────────
function ErrorGroupCard({
  group, onOpenTrace,
}: {
  group: ErrorGroup;
  onOpenTrace: (g: ErrorGroup) => void;
}) {
  const firstLine = (group.message || '').split('\n')[0] || '(no message)';
  return (
    <div style={{ background: C.white, borderRadius: 12,
      border: `1.5px solid ${C.g200}`, padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 16 }}>

      <div style={{ width: 40, height: 40, borderRadius: 10,
        background: C.redLt, color: C.red,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, flexShrink: 0 }}>
        ⚠
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.g900,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {group.error_type}
        </div>
        <div style={{ fontSize: 13, color: C.g700, marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' }}>
          {firstLine}
        </div>
        <div style={{ fontSize: 11, color: C.g500, marginTop: 4,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>first {relativeTime(group.first_seen)}</span>
          <span>·</span>
          <span>last {relativeTime(group.last_seen)}</span>
          {group.surface && (<><span>·</span><SmallBadge>{group.surface}</SmallBadge></>)}
          {group.source  && (<><span>·</span><SmallBadge>{group.source}</SmallBadge></>)}
          {group.sample_event_id && (
            <>
              <span>·</span>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                sample {shortId(group.sample_event_id, 8)}
              </span>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column',
        alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        <span style={{ background: C.red, color: C.white,
          padding: '4px 10px', borderRadius: 999, fontSize: 12,
          fontWeight: 700 }}>
          {group.count.toLocaleString()}
        </span>
        <Btn variant="outline" color={C.tealDk} onClick={() => onOpenTrace(group)}>
          Open trace
        </Btn>
      </div>
    </div>
  );
}

// ── Errors tab ───────────────────────────────────────────────────────────────
type ErrorWindow = '1h' | '24h' | '7d';

function ErrorsTab({ onOpenTraceTab }: {
  onOpenTraceTab: (params: { user_id?: string; phone?: string; trace_id?: string }) => void;
}) {
  const [groups, setGroups]   = useState<ErrorGroup[]>([]);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(true);
  const [windowSize, setWindowSize] = useState<ErrorWindow>('24h');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await proxyJson(
        `/api/admin/events/errors?window=${windowSize}`,
      ) as { groups?: ErrorGroup[] } | ErrorGroup[];
      const list = Array.isArray(data) ? data : (data.groups ?? []);
      list.sort((a, b) => b.count - a.count);
      setGroups(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load errors.');
    } finally {
      setLoading(false);
    }
  }, [windowSize]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.g900 }}>
            Error groups
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: C.g500 }}>
            {loading ? 'Loading…' : `${groups.length} group${groups.length === 1 ? '' : 's'} in last ${windowSize}`}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          background: C.white, border: `1.5px solid ${C.g200}`,
          padding: 4, borderRadius: 8 }}>
          {(['1h', '24h', '7d'] as const).map(w => (
            <button
              key={w}
              onClick={() => setWindowSize(w)}
              style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12,
                fontWeight: 600, cursor: 'pointer', border: 'none',
                background: windowSize === w ? C.teal : 'transparent',
                color:      windowSize === w ? C.white : C.g500,
              }}>
              {w}
            </button>
          ))}
          <Btn variant="ghost" onClick={load} color={C.g500}>↻</Btn>
        </div>
      </div>

      {error && (
        <div style={{ background: C.redLt, border: `1.5px solid ${C.red}`,
          borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.red }}>
          {error}
        </div>
      )}

      {!loading && groups.length === 0 && !error && (
        <div style={{ background: C.white, borderRadius: 12,
          border: `1.5px solid ${C.g200}`, padding: 32, textAlign: 'center' }}>
          <p style={{ margin: 0, color: C.green, fontSize: 14, fontWeight: 600 }}>
            ✓ No errors in the last {windowSize}.
          </p>
          <p style={{ margin: '4px 0 0', color: C.g500, fontSize: 13 }}>
            Quiet skies. Keep shipping.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {groups.map((g, i) => (
          <ErrorGroupCard
            key={`${g.error_type}-${i}`}
            group={g}
            onOpenTrace={grp => onOpenTraceTab({
              trace_id: grp.sample_trace_id,
              user_id:  grp.sample_user_id,
            })}
          />
        ))}
      </div>
    </div>
  );
}

// ── Window switcher (7d / 30d / 90d) ─────────────────────────────────────────
type DaysWindow = 7 | 30 | 90;

function DaysSwitcher({
  value, onChange, onRefresh,
}: {
  value: DaysWindow;
  onChange: (v: DaysWindow) => void;
  onRefresh?: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6,
      background: C.white, border: `1.5px solid ${C.g200}`,
      padding: 4, borderRadius: 8 }}>
      {([7, 30, 90] as const).map(w => (
        <button
          key={w}
          onClick={() => onChange(w)}
          style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 12,
            fontWeight: 600, cursor: 'pointer', border: 'none',
            background: value === w ? C.teal : 'transparent',
            color:      value === w ? C.white : C.g500,
          }}>
          {w}d
        </button>
      ))}
      {onRefresh && <Btn variant="ghost" onClick={onRefresh} color={C.g500}>↻</Btn>}
    </div>
  );
}

// ── Funnels tab ──────────────────────────────────────────────────────────────
interface FunnelStep {
  name: string;
  users: number;
  drop_off_pct_from_prev: number | null;
}
interface FunnelResult {
  funnel_id: string;
  label: string;
  days: number;
  steps: FunnelStep[];
  total_users_started: number;
}
interface FunnelsResponse { funnels?: FunnelResult[] }

function FunnelCard({ f }: { f: FunnelResult }) {
  const max = f.steps.length > 0 ? Math.max(1, f.steps[0].users) : 1;
  return (
    <div style={{ background: C.white, borderRadius: 12,
      border: `1.5px solid ${C.g200}`, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline',
        justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.g900 }}>
          {f.label}
        </h3>
        <span style={{ fontSize: 12, color: C.g500 }}>
          {f.total_users_started.toLocaleString()} users started
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {f.steps.map((s, i) => {
          const pct = (s.users / max) * 100;
          const dropOff = s.drop_off_pct_from_prev;
          return (
            <div key={`${f.funnel_id}-${i}`}>
              <div style={{ display: 'flex', alignItems: 'baseline',
                justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.g900 }}>
                  {i + 1}. {s.name}
                </span>
                <span style={{ fontSize: 12, color: C.g500 }}>
                  {s.users.toLocaleString()} users
                  {' '}
                  {dropOff === null
                    ? <span style={{ color: C.g400 }}>(start)</span>
                    : (
                      <span style={{ color: dropOff > 50 ? C.red
                        : dropOff > 25 ? C.amber : C.green }}>
                        −{dropOff}% from prev
                      </span>
                    )}
                </span>
              </div>
              <div style={{ background: C.g100, borderRadius: 6,
                height: 14, overflow: 'hidden' }}>
                <div style={{
                  width: `${pct}%`, height: '100%',
                  background: i === 0 ? C.tealDk : C.teal,
                  borderRadius: 6,
                  transition: 'width .3s ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FunnelsTab() {
  const [days, setDays]       = useState<DaysWindow>(30);
  const [funnels, setFunnels] = useState<FunnelResult[]>([]);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await proxyJson(
        `/api/admin/events/funnel?id=ALL&days=${days}`,
      ) as FunnelsResponse;
      setFunnels(data.funnels ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load funnels.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.g900 }}>
            Funnels
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: C.g500 }}>
            Conversion through critical journeys, last {days} days
          </p>
        </div>
        <DaysSwitcher value={days} onChange={setDays} onRefresh={load} />
      </div>

      {error && (
        <div style={{ background: C.redLt, border: `1.5px solid ${C.red}`,
          borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.red }}>
          {error}
        </div>
      )}

      {loading && funnels.length === 0 && (
        <p style={{ color: C.g400, fontSize: 14, textAlign: 'center' }}>
          Loading funnels…
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {funnels.map(f => <FunnelCard key={f.funnel_id} f={f} />)}
      </div>
    </div>
  );
}

// ── AI usage tab ─────────────────────────────────────────────────────────────
interface DailyCallsRow {
  date: string;
  vertex_success: number; vertex_failed: number;
  litert_success: number; litert_failed: number;
}
interface LatencyRow {
  event_type: string;
  samples: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}
interface DailyTokensRow {
  date: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}
interface TopUserRow {
  user_id: string;
  user_role?: string | null;
  user_phone?: string | null;
  calls: number;
  total_cost_usd: number;
}
interface FailureRateRow {
  surface: string;
  success: number;
  failed: number;
  total: number;
  failure_pct: number;
}
interface ModelRow { model: string; calls: number }
interface AiUsageResponse {
  days?: number;
  daily_calls?:        DailyCallsRow[];
  latency_pct?:        LatencyRow[];
  daily_tokens?:       DailyTokensRow[];
  top_users_by_cost?:  TopUserRow[];
  failure_rate?:       FailureRateRow[];
  models_used?:        ModelRow[];
}

function CallsLineChart({ data }: { data: DailyCallsRow[] }) {
  // Inline SVG sparkline-ish line chart with two paths (vertex + litert).
  const w = 760;
  const h = 200;
  const padL = 36, padR = 12, padT = 12, padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  if (data.length === 0) {
    return (
      <p style={{ color: C.g400, fontSize: 13, textAlign: 'center',
        padding: '24px 0' }}>
        No AI calls in this window.
      </p>
    );
  }

  const vertexTotals = data.map(d => d.vertex_success + d.vertex_failed);
  const litertTotals = data.map(d => d.litert_success + d.litert_failed);
  const maxY = Math.max(1, ...vertexTotals, ...litertTotals);

  const xFor = (i: number) =>
    padL + (data.length === 1 ? innerW / 2
      : (i / (data.length - 1)) * innerW);
  const yFor = (v: number) =>
    padT + innerH - (v / maxY) * innerH;

  const buildPath = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');

  // X-axis labels: show first, last, midpoint
  const xLabels: { i: number; label: string }[] = [];
  if (data.length > 0) xLabels.push({ i: 0, label: data[0].date.slice(5) });
  if (data.length > 2) {
    const mid = Math.floor(data.length / 2);
    xLabels.push({ i: mid, label: data[mid].date.slice(5) });
  }
  if (data.length > 1) {
    xLabels.push({ i: data.length - 1, label: data[data.length - 1].date.slice(5) });
  }

  // Y gridlines: 4 ticks
  const ticks = 4;
  const yTicks: number[] = [];
  for (let k = 0; k <= ticks; k++) {
    yTicks.push(Math.round((maxY * k) / ticks));
  }

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg width={w} height={h}
        style={{ display: 'block', maxWidth: '100%' }}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet">
        {/* Y gridlines */}
        {yTicks.map((tv, k) => {
          const y = yFor(tv);
          return (
            <g key={`g-${k}`}>
              <line x1={padL} y1={y} x2={w - padR} y2={y}
                stroke={C.g100} strokeWidth={1} />
              <text x={padL - 6} y={y + 3}
                textAnchor="end" fontSize={10} fill={C.g400}>
                {tv}
              </text>
            </g>
          );
        })}
        {/* X labels */}
        {xLabels.map((xl, k) => (
          <text key={`x-${k}`} x={xFor(xl.i)} y={h - 10}
            textAnchor="middle" fontSize={10} fill={C.g500}>
            {xl.label}
          </text>
        ))}
        {/* Vertex line (teal) */}
        <path d={buildPath(vertexTotals)} fill="none"
          stroke={C.teal} strokeWidth={2} strokeLinejoin="round" />
        {/* LiteRT line (purple) */}
        <path d={buildPath(litertTotals)} fill="none"
          stroke={C.purple} strokeWidth={2} strokeLinejoin="round"
          strokeDasharray="4 3" />
      </svg>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18,
        fontSize: 12, color: C.g500, paddingLeft: padL, marginTop: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 2, background: C.teal }} />
          Vertex (cloud)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 2,
            background: 'transparent',
            borderTop: `2px dashed ${C.purple}` }} />
          LiteRT (on-device)
        </span>
      </div>
    </div>
  );
}

function AiUsageTab() {
  const [days, setDays]       = useState<DaysWindow>(30);
  const [data, setData]       = useState<AiUsageResponse | null>(null);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await proxyJson(
        `/api/admin/events/ai_usage?days=${days}`,
      ) as AiUsageResponse;
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load AI usage.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const totalsForTokens = (rows: DailyTokensRow[]) => {
    const t = rows.reduce((acc, r) => ({
      prompt_tokens:     acc.prompt_tokens     + (r.prompt_tokens     || 0),
      completion_tokens: acc.completion_tokens + (r.completion_tokens || 0),
      cost_usd:          acc.cost_usd          + (r.cost_usd          || 0),
    }), { prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 });
    return { ...t, cost_usd: Math.round(t.cost_usd * 10000) / 10000 };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.g900 }}>
            AI usage
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: C.g500 }}>
            Vertex + LiteRT telemetry, last {days} days
          </p>
        </div>
        <DaysSwitcher value={days} onChange={setDays} onRefresh={load} />
      </div>

      {error && (
        <div style={{ background: C.redLt, border: `1.5px solid ${C.red}`,
          borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.red }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <p style={{ color: C.g400, fontSize: 14, textAlign: 'center' }}>
          Loading AI usage…
        </p>
      )}

      {data && (
        <>
          {/* Calls per day */}
          <div style={{ background: C.white, borderRadius: 12,
            border: `1.5px solid ${C.g200}`, padding: 18 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: C.g900 }}>
              Calls per day
            </h3>
            <CallsLineChart data={data.daily_calls ?? []} />
          </div>

          {/* Failure rate by surface */}
          <div style={{ display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {(data.failure_rate ?? []).map(fr => (
              <div key={fr.surface} style={{ background: C.white, borderRadius: 12,
                border: `1.5px solid ${C.g200}`, padding: 16 }}>
                <div style={{ fontSize: 12, color: C.g500, fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  {fr.surface}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800,
                  color: fr.failure_pct > 10 ? C.red
                    : fr.failure_pct > 2 ? C.amber : C.green,
                  lineHeight: 1.1 }}>
                  {fr.failure_pct.toFixed(2)}%
                </div>
                <div style={{ fontSize: 12, color: C.g500, marginTop: 4 }}>
                  {fr.failed.toLocaleString()} fails / {fr.total.toLocaleString()} calls
                </div>
              </div>
            ))}
          </div>

          {/* Latency table */}
          <div style={{ background: C.white, borderRadius: 12,
            border: `1.5px solid ${C.g200}`, padding: 18, overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: C.g900 }}>
              Latency (ms)
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.g50, color: C.g500 }}>
                  <th style={{ textAlign: 'left',  padding: 8 }}>event_type</th>
                  <th style={{ textAlign: 'right', padding: 8 }}>samples</th>
                  <th style={{ textAlign: 'right', padding: 8 }}>p50</th>
                  <th style={{ textAlign: 'right', padding: 8 }}>p95</th>
                  <th style={{ textAlign: 'right', padding: 8 }}>p99</th>
                </tr>
              </thead>
              <tbody>
                {(data.latency_pct ?? []).map((row, i) => (
                  <tr key={row.event_type}
                    style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.g100}` }}>
                    <td style={{ padding: 8, color: C.g900,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      {row.event_type}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right', color: C.g500 }}>
                      {row.samples.toLocaleString()}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right', color: C.g900 }}>
                      {row.p50 === null ? '—' : Math.round(row.p50)}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right', color: C.g900 }}>
                      {row.p95 === null ? '—' : Math.round(row.p95)}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right', color: C.g900 }}>
                      {row.p99 === null ? '—' : Math.round(row.p99)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tokens & cost table */}
          <div style={{ background: C.white, borderRadius: 12,
            border: `1.5px solid ${C.g200}`, padding: 18, overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: C.g900 }}>
              Tokens &amp; cost (Vertex)
            </h3>
            {(() => {
              const rows = data.daily_tokens ?? [];
              const totals = totalsForTokens(rows);
              return (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: C.g50, color: C.g500 }}>
                      <th style={{ textAlign: 'left',  padding: 8 }}>date</th>
                      <th style={{ textAlign: 'right', padding: 8 }}>prompt_tokens</th>
                      <th style={{ textAlign: 'right', padding: 8 }}>completion_tokens</th>
                      <th style={{ textAlign: 'right', padding: 8 }}>cost_usd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.date} style={{
                        borderTop: i === 0 ? 'none' : `1px solid ${C.g100}` }}>
                        <td style={{ padding: 8, color: C.g700,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          {r.date}
                        </td>
                        <td style={{ padding: 8, textAlign: 'right', color: C.g900 }}>
                          {r.prompt_tokens.toLocaleString()}
                        </td>
                        <td style={{ padding: 8, textAlign: 'right', color: C.g900 }}>
                          {r.completion_tokens.toLocaleString()}
                        </td>
                        <td style={{ padding: 8, textAlign: 'right', color: C.g900 }}>
                          ${r.cost_usd.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: `2px solid ${C.g200}`,
                      background: C.tealLt }}>
                      <td style={{ padding: 8, color: C.tealDk, fontWeight: 700 }}>
                        Total
                      </td>
                      <td style={{ padding: 8, textAlign: 'right',
                        color: C.tealDk, fontWeight: 700 }}>
                        {totals.prompt_tokens.toLocaleString()}
                      </td>
                      <td style={{ padding: 8, textAlign: 'right',
                        color: C.tealDk, fontWeight: 700 }}>
                        {totals.completion_tokens.toLocaleString()}
                      </td>
                      <td style={{ padding: 8, textAlign: 'right',
                        color: C.tealDk, fontWeight: 700 }}>
                        ${totals.cost_usd.toFixed(4)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
          </div>

          {/* Top users by spend */}
          <div style={{ background: C.white, borderRadius: 12,
            border: `1.5px solid ${C.g200}`, padding: 18, overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: C.g900 }}>
              Top users by spend
            </h3>
            {(data.top_users_by_cost ?? []).length === 0 ? (
              <p style={{ color: C.g400, fontSize: 13, margin: 0 }}>
                No paid AI calls in this window.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: C.g50, color: C.g500 }}>
                    <th style={{ textAlign: 'left',  padding: 8 }}>phone</th>
                    <th style={{ textAlign: 'left',  padding: 8 }}>role</th>
                    <th style={{ textAlign: 'right', padding: 8 }}>calls</th>
                    <th style={{ textAlign: 'right', padding: 8 }}>cost_usd</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.top_users_by_cost ?? []).map((u, i) => {
                    const phone = u.user_phone || u.user_id || '—';
                    const trunc = phone.length > 14 ? `${phone.slice(0, 14)}…` : phone;
                    return (
                      <tr key={u.user_id}
                        style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.g100}` }}>
                        <td style={{ padding: 8, color: C.g900,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          {trunc}
                        </td>
                        <td style={{ padding: 8 }}>
                          <SmallBadge bg={C.blueLt} color={C.blue}>
                            {u.user_role || 'unknown'}
                          </SmallBadge>
                        </td>
                        <td style={{ padding: 8, textAlign: 'right', color: C.g900 }}>
                          {u.calls.toLocaleString()}
                        </td>
                        <td style={{ padding: 8, textAlign: 'right', color: C.g900 }}>
                          ${u.total_cost_usd.toFixed(4)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Models seen */}
          {(data.models_used ?? []).length > 0 && (
            <div style={{ background: C.white, borderRadius: 12,
              border: `1.5px solid ${C.g200}`, padding: 18 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: C.g900 }}>
                Models used
              </h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(data.models_used ?? []).map(m => (
                  <SmallBadge key={m.model} bg={C.tealLt} color={C.tealDk}>
                    {m.model} · {m.calls.toLocaleString()}
                  </SmallBadge>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Play tab — Neriah Play telemetry ─────────────────────────────────────────

interface PlayDailyRow {
  date: string;
  lessons_created: number;
  lessons_failed: number;
  sessions_started: number;
  sessions_ended: number;
}
interface PlayStatsResponse {
  days: number;
  totals: {
    lessons_created: number;
    lessons_failed: number;
    sessions_started: number;
    sessions_ended: number;
    generation_fell_short: number;
    generation_tier_escalations: number;
    generation_auto_expand_starts: number;
    generation_batch_failed: number;
    generation_batch_success: number;
  };
  daily: PlayDailyRow[];
  format_distribution: { format: string; sessions: number }[];
  end_reasons: { reason: string; count: number }[];
  top_players: { user_id: string; phone: string; sessions: number; last_played: string }[];
}

function PlayTab({ onOpenTraceTab }: {
  onOpenTraceTab: (params: { user_id?: string; phone?: string; trace_id?: string }) => void;
}) {
  const [days, setDays]       = useState<DaysWindow>(7);
  const [data, setData]       = useState<PlayStatsResponse | null>(null);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await proxyJson(
        `/api/admin/events/play_stats?days=${days}`,
      ) as PlayStatsResponse;
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load Play stats.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const formatLabel = (f: string) =>
    f === 'lane_runner' ? 'Lane Runner'
    : f === 'stacker'   ? 'Stacker'
    : f === 'blaster'   ? 'Blaster'
    : f === 'snake'     ? 'Snake'
    : f;

  const reasonLabel = (r: string) =>
    r === 'completed'      ? 'Completed bank'
    : r === 'quit'         ? 'Quit'
    : r === 'collision'    ? 'Snake collision'
    : r === 'length_zero'  ? 'Snake → length 0'
    : r === 'bins_overflow'? 'Stacker → bins overflow'
    : r === 'health_zero'  ? 'Blaster → health 0'
    : r === 'invader_breach' ? 'Blaster → invader breach'
    : r === 'score_zero'   ? 'Lane Runner → score 0'
    : r;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.g900 }}>
            Neriah Play
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: C.g500 }}>
            Lessons generated, sessions played, generator errors — last {days} days
          </p>
        </div>
        <DaysSwitcher value={days} onChange={setDays} onRefresh={load} />
      </div>

      {error && (
        <div style={{ background: C.redLt, border: `1.5px solid ${C.red}`,
          borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.red }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <p style={{ color: C.g400, fontSize: 14, textAlign: 'center' }}>
          Loading Play stats…
        </p>
      )}

      {data && (
        <>
          {/* Headline KPIs */}
          <div style={{ display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <KpiCard
              label="Lessons created"
              value={data.totals.lessons_created.toLocaleString()}
              tone="green"
            />
            <KpiCard
              label="Lesson failures"
              value={data.totals.lessons_failed.toLocaleString()}
              tone={data.totals.lessons_failed > 0 ? 'red' : 'g500'}
            />
            <KpiCard
              label="Sessions started"
              value={data.totals.sessions_started.toLocaleString()}
              tone="teal"
            />
            <KpiCard
              label="Sessions ended"
              value={data.totals.sessions_ended.toLocaleString()}
              tone="teal"
            />
            <KpiCard
              label="Generator fell short"
              value={data.totals.generation_fell_short.toLocaleString()}
              tone={data.totals.generation_fell_short > 0 ? 'red' : 'g500'}
              hint="<100 questions on a generation"
            />
            <KpiCard
              label="Tier escalations"
              value={data.totals.generation_tier_escalations.toLocaleString()}
              tone="amber"
              hint="grounded → broader → fundamentals"
            />
            <KpiCard
              label="Auto-expand triggered"
              value={data.totals.generation_auto_expand_starts.toLocaleString()}
              tone="amber"
            />
            <KpiCard
              label="Batch failures"
              value={data.totals.generation_batch_failed.toLocaleString()}
              tone={data.totals.generation_batch_failed > 0 ? 'red' : 'g500'}
            />
          </div>

          {/* Daily timeline */}
          <div style={{ background: C.white, borderRadius: 12,
            border: `1.5px solid ${C.g200}`, padding: 18, overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: C.g900 }}>
              Daily activity
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.g50, color: C.g500 }}>
                  <th style={{ textAlign: 'left',  padding: 8 }}>Date</th>
                  <th style={{ textAlign: 'right', padding: 8 }}>Lessons</th>
                  <th style={{ textAlign: 'right', padding: 8 }}>Failures</th>
                  <th style={{ textAlign: 'right', padding: 8 }}>Sessions</th>
                  <th style={{ textAlign: 'right', padding: 8 }}>Ended</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map(d => (
                  <tr key={d.date} style={{ borderTop: `1px solid ${C.g200}` }}>
                    <td style={{ padding: 8, color: C.g700, fontFamily: 'monospace' }}>
                      {d.date}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right', color: C.g900, fontWeight: 600 }}>
                      {d.lessons_created || '·'}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right',
                      color: d.lessons_failed > 0 ? C.red : C.g400 }}>
                      {d.lessons_failed || '·'}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right', color: C.g900 }}>
                      {d.sessions_started || '·'}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right', color: C.g500 }}>
                      {d.sessions_ended || '·'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-format + end-reason breakdown side by side */}
          <div style={{ display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={{ background: C.white, borderRadius: 12,
              border: `1.5px solid ${C.g200}`, padding: 18 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: C.g900 }}>
                Sessions by format
              </h3>
              {data.format_distribution.every(f => f.sessions === 0) ? (
                <p style={{ color: C.g400, fontSize: 13 }}>No sessions in this window.</p>
              ) : (
                data.format_distribution.map(f => {
                  const max = Math.max(1, ...data.format_distribution.map(x => x.sessions));
                  const pct = (f.sessions / max) * 100;
                  return (
                    <div key={f.format} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between',
                        fontSize: 13, color: C.g700, marginBottom: 4 }}>
                        <span>{formatLabel(f.format)}</span>
                        <span style={{ fontFamily: 'monospace', color: C.g500 }}>
                          {f.sessions}
                        </span>
                      </div>
                      <div style={{ height: 6, background: C.g100, borderRadius: 3 }}>
                        <div style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: C.teal,
                          borderRadius: 3,
                        }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ background: C.white, borderRadius: 12,
              border: `1.5px solid ${C.g200}`, padding: 18 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: C.g900 }}>
                Why sessions end
              </h3>
              {data.end_reasons.length === 0 ? (
                <p style={{ color: C.g400, fontSize: 13 }}>No ended sessions in this window.</p>
              ) : (
                data.end_reasons.map(r => {
                  const max = Math.max(1, ...data.end_reasons.map(x => x.count));
                  const pct = (r.count / max) * 100;
                  const colour = r.reason === 'completed' ? C.green
                    : r.reason === 'quit' ? C.g400
                    : C.amber;
                  return (
                    <div key={r.reason} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between',
                        fontSize: 13, color: C.g700, marginBottom: 4 }}>
                        <span>{reasonLabel(r.reason)}</span>
                        <span style={{ fontFamily: 'monospace', color: C.g500 }}>
                          {r.count}
                        </span>
                      </div>
                      <div style={{ height: 6, background: C.g100, borderRadius: 3 }}>
                        <div style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: colour,
                          borderRadius: 3,
                        }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Top players */}
          <div style={{ background: C.white, borderRadius: 12,
            border: `1.5px solid ${C.g200}`, padding: 18, overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: C.g900 }}>
              Top players (by sessions)
            </h3>
            {data.top_players.length === 0 ? (
              <p style={{ color: C.g400, fontSize: 13 }}>No sessions in this window.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: C.g50, color: C.g500 }}>
                    <th style={{ textAlign: 'left',  padding: 8 }}>User</th>
                    <th style={{ textAlign: 'left',  padding: 8 }}>Phone</th>
                    <th style={{ textAlign: 'right', padding: 8 }}>Sessions</th>
                    <th style={{ textAlign: 'left',  padding: 8 }}>Last played</th>
                    <th style={{ textAlign: 'right', padding: 8 }}>Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_players.map(p => (
                    <tr key={p.user_id} style={{ borderTop: `1px solid ${C.g200}` }}>
                      <td style={{ padding: 8, color: C.g700, fontFamily: 'monospace' }}>
                        {p.user_id.slice(0, 12)}…
                      </td>
                      <td style={{ padding: 8, color: C.g500 }}>{p.phone || '—'}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: C.g900, fontWeight: 600 }}>
                        {p.sessions}
                      </td>
                      <td style={{ padding: 8, color: C.g500, fontFamily: 'monospace' }}>
                        {(p.last_played || '').replace('T', ' ').slice(0, 19)}
                      </td>
                      <td style={{ padding: 8, textAlign: 'right' }}>
                        <button
                          onClick={() => onOpenTraceTab({ user_id: p.user_id })}
                          style={{ background: 'transparent', border: 'none',
                            color: C.teal, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                        >
                          Open →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, tone, hint }: {
  label: string;
  value: string;
  tone: 'teal' | 'amber' | 'green' | 'red' | 'g500';
  hint?: string;
}) {
  const colour =
    tone === 'teal'  ? C.teal :
    tone === 'amber' ? C.amber :
    tone === 'green' ? C.green :
    tone === 'red'   ? C.red :
    C.g500;
  return (
    <div style={{ background: C.white, borderRadius: 12,
      border: `1.5px solid ${C.g200}`, padding: 16 }}>
      <div style={{ fontSize: 12, color: C.g500, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: colour, lineHeight: 1.05 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: C.g400, marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// ── Per-user trace tab — full timeline ───────────────────────────────────────
type TraceLookup = { user_id?: string; phone?: string; trace_id?: string };

function PerUserTraceTab({ initial }: { initial: TraceLookup }) {
  const [phone,   setPhone]   = useState(initial.phone   ?? '');
  const [userId,  setUserId]  = useState(initial.user_id ?? '');
  const [traceId, setTraceId] = useState(initial.trace_id ?? '');
  const [events, setEvents]   = useState<MonitoringEvent[]>([]);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selected, setSelected] = useState<MonitoringEvent | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync if the initial values change (auto-prefill from other tabs)
  useEffect(() => {
    if (initial.phone)    setPhone(initial.phone);
    if (initial.user_id)  setUserId(initial.user_id);
    if (initial.trace_id) setTraceId(initial.trace_id);
  }, [initial.phone, initial.user_id, initial.trace_id]);

  const submit = useCallback(async (overrides?: TraceLookup) => {
    const p = (overrides?.phone    ?? phone).trim();
    const u = (overrides?.user_id  ?? userId).trim();
    const t = (overrides?.trace_id ?? traceId).trim();
    if (!p && !u && !t) {
      setEvents([]); setHasSearched(false); setError('');
      return;
    }
    setLoading(true); setError(''); setHasSearched(true);
    const params = new URLSearchParams();
    if (t) params.set('trace_id', t);
    else if (u) params.set('user_id', u);
    else if (p) params.set('phone', p);
    try {
      const data = await proxyJson(
        `/api/admin/events/trace?${params.toString()}`,
      ) as { events?: MonitoringEvent[] };
      const list = (data.events ?? []).slice();
      // Backend already returns ASC, but sort defensively in case.
      list.sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setEvents(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load trace.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [phone, userId, traceId]);

  // Auto-submit on prefill
  useEffect(() => {
    if (initial.phone || initial.user_id || initial.trace_id) {
      submit({
        phone:    initial.phone,
        user_id:  initial.user_id,
        trace_id: initial.trace_id,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.phone, initial.user_id, initial.trace_id]);

  // Debounced auto-search when the user types
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!phone && !userId && !traceId) {
      setEvents([]); setHasSearched(false); setError('');
      return;
    }
    debounceRef.current = setTimeout(() => { submit(); }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // Don't include `submit` in deps to avoid double-firing on field changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, userId, traceId]);

  const focusTrace = (tid: string | undefined) => {
    if (!tid) return;
    setTraceId(tid);
    setUserId('');
    setPhone('');
    submit({ trace_id: tid });
  };

  // Group events by date for the timeline
  const byDate: { date: string; events: MonitoringEvent[] }[] = [];
  for (const ev of events) {
    const d = (ev.timestamp || '').slice(0, 10);
    const last = byDate[byDate.length - 1];
    if (last && last.date === d) {
      last.events.push(ev);
    } else {
      byDate.push({ date: d, events: [ev] });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: C.white, borderRadius: 12,
        border: `1.5px solid ${C.g200}`, padding: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: C.g900 }}>
          Per-user trace lookup
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: C.g500 }}>
          Search by phone, user_id, or trace_id. trace_id wins; otherwise user_id; otherwise phone.
        </p>
        <div style={{ display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={setPhone} placeholder="+263771234567" />
          </div>
          <div>
            <Label>User ID</Label>
            <Input value={userId} onChange={setUserId} placeholder="user_…" />
          </div>
          <div>
            <Label>Trace ID</Label>
            <Input value={traceId} onChange={setTraceId} placeholder="trace_…" />
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex',
          alignItems: 'center', gap: 10 }}>
          <Btn onClick={() => submit()} disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </Btn>
          <Btn variant="ghost" color={C.g500}
            onClick={() => {
              setPhone(''); setUserId(''); setTraceId('');
              setEvents([]); setError(''); setHasSearched(false);
            }}>
            Clear
          </Btn>
          {hasSearched && !loading && !error && (
            <span style={{ fontSize: 12, color: C.g500 }}>
              {events.length} event{events.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: C.redLt, border: `1.5px solid ${C.red}`,
          borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.red }}>
          {error}
        </div>
      )}

      {hasSearched && !loading && !error && events.length === 0 && (
        <div style={{ background: C.white, borderRadius: 12,
          border: `1.5px solid ${C.g200}`, padding: 32, textAlign: 'center' }}>
          <p style={{ margin: 0, color: C.g500, fontSize: 14 }}>
            No events for this user/trace in the last 30 days.
          </p>
        </div>
      )}

      {/* Timeline */}
      {!loading && events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {byDate.map(group => (
            <div key={group.date} style={{ background: C.white, borderRadius: 12,
              border: `1.5px solid ${C.g200}`, overflow: 'hidden' }}>
              <div style={{ background: C.g50, padding: '8px 16px',
                fontSize: 12, fontWeight: 700, color: C.g500,
                letterSpacing: 0.4, textTransform: 'uppercase',
                borderBottom: `1px solid ${C.g100}` }}>
                {group.date}
              </div>
              {group.events.map((ev, i) => {
                const id = ev.event_id || ev.id || `${ev.timestamp}-${i}`;
                return (
                  <div key={id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '70px 90px 1fr auto',
                      alignItems: 'center', gap: 12,
                      padding: '10px 16px',
                      borderBottom: i === group.events.length - 1
                        ? 'none' : `1px solid ${C.g100}`,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.g50)}
                    onMouseLeave={e => (e.currentTarget.style.background = C.white)}
                  >
                    <SeverityBadge severity={ev.severity} />
                    <span style={{ fontSize: 11, color: C.g500 }}>
                      {relativeTime(ev.timestamp)}
                    </span>
                    <button
                      onClick={() => setSelected(ev)}
                      style={{ textAlign: 'left', background: 'transparent',
                        border: 'none', cursor: 'pointer', padding: 0,
                        display: 'flex', flexDirection: 'column', gap: 2,
                        minWidth: 0, fontFamily: 'inherit' }}>
                      <span style={{ fontSize: 12, color: C.g900,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap' }}>
                        {ev.event_type}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center',
                        gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                        {ev.surface && <SmallBadge>{ev.surface}</SmallBadge>}
                        {ev.source && (
                          <SmallBadge bg={C.blueLt} color={C.blue}>
                            {ev.source}
                          </SmallBadge>
                        )}
                        <span style={{ fontSize: 12, color: C.g500,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', minWidth: 0 }}>
                          {payloadPreview(ev)}
                        </span>
                      </span>
                    </button>
                    <Btn variant="outline" color={C.tealDk}
                      onClick={() => focusTrace(ev.trace_id)}
                      disabled={!ev.trace_id}>
                      View this trace
                    </Btn>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <EventSidePanel
        event={selected}
        onClose={() => setSelected(null)}
        onViewTrace={ev => {
          setSelected(null);
          focusTrace(ev.trace_id || ev.event_id || ev.id);
        }}
      />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
const TABS: { key: TabKey; label: string }[] = [
  { key: 'live',     label: 'Live feed'      },
  { key: 'errors',   label: 'Errors'         },
  { key: 'funnels',  label: 'Funnels'        },
  { key: 'ai_usage', label: 'AI usage'       },
  { key: 'play',     label: 'Neriah Play'    },
  { key: 'trace',    label: 'Per-user trace' },
];

export default function MonitoringAdminPage() {
  const [adminEmail,  setAdminEmail]  = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState<TabKey>('live');
  const [tracePrefill, setTracePrefill] =
    useState<{ user_id?: string; phone?: string; trace_id?: string }>({});

  // Cookie-auth check on mount
  useEffect(() => {
    fetch('/api/admin/verify', { credentials: 'same-origin' })
      .then(r => r.json())
      .then((d: { authenticated?: boolean; email?: string }) => {
        if (d.authenticated && d.email) setAdminEmail(d.email);
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    setAdminEmail(null);
  };

  const openTraceTab = useCallback(
    (params: { user_id?: string; phone?: string; trace_id?: string }) => {
      setTracePrefill(params);
      setTab('trace');
    }, []);

  // Loading
  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', background: C.g50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: C.g400, fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  // Not logged in
  if (!adminEmail) {
    return <LoginForm onSuccess={email => setAdminEmail(email)} />;
  }

  return (
    <div style={{ minHeight: '100vh', background: C.g50,
      fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.g200}`,
        padding: '16px 32px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: C.teal,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18 }}>
            📡
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.g900 }}>
              Neriah Monitoring
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: C.g500 }}>
              Live system telemetry · errors · user traces
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="/admin/curriculum" style={{ fontSize: 13, color: C.g500,
            textDecoration: 'none', borderBottom: `1px dashed ${C.g300}` }}>
            Curriculum admin →
          </a>
          <span style={{ fontSize: 13, color: C.g500,
            background: C.g100, borderRadius: 20,
            padding: '4px 12px' }}>
            {adminEmail}
          </span>
          <Btn variant="ghost" onClick={handleLogout} color={C.g500}>
            Logout
          </Btn>
        </div>
      </div>

      {/* Tab nav */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.g200}`,
        padding: '0 32px', display: 'flex', alignItems: 'center', gap: 4 }}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '12px 16px', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', background: 'transparent',
                color: active ? C.tealDk : C.g500,
                borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                borderBottom: `2px solid ${active ? C.teal : 'transparent'}`,
                transition: 'all .12s',
              }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1100, margin: '0 auto',
        padding: '24px 24px 80px' }}>
        {tab === 'live'     && <LiveFeedTab onOpenTraceTab={openTraceTab} />}
        {tab === 'errors'   && <ErrorsTab   onOpenTraceTab={openTraceTab} />}
        {tab === 'funnels'  && <FunnelsTab />}
        {tab === 'ai_usage' && <AiUsageTab />}
        {tab === 'play'     && <PlayTab     onOpenTraceTab={openTraceTab} />}
        {tab === 'trace'    && <PerUserTraceTab initial={tracePrefill} />}
      </div>
    </div>
  );
}
