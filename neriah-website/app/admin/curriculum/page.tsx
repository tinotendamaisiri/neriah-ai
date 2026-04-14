'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';

// ── Proxy base (browser calls our Next.js API, never the Cloud Function directly) ──
const PROXY_BASE = '/api/admin/curriculum';

// ── Brand ─────────────────────────────────────────────────────────────────────
const C = {
  teal:   '#0D9488',
  tealDk: '#0F766E',
  tealLt: '#F0FDFA',
  amber:  '#F59E0B',
  red:    '#DC2626',
  redLt:  '#FEF2F2',
  green:  '#16A34A',
  greenLt:'#F0FDF4',
  g50:    '#F9FAFB',
  g100:   '#F3F4F6',
  g200:   '#E5E7EB',
  g400:   '#9CA3AF',
  g500:   '#6B7280',
  g700:   '#374151',
  g900:   '#111827',
  white:  '#FFFFFF',
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface Syllabus {
  id: string;
  country: string;
  curriculum: string;
  subject: string;
  education_level: string;
  year?: string;
  filename: string;
  chunk_count: number;
  uploaded_at: string;
  uploaded_by: string;
}

interface UploadForm {
  country: string;
  curriculum: string;
  subject: string;
  education_level: string;
  year: string;
  file: File | null;
}

// ── Proxy fetch — browser never sees ADMIN_API_KEY ────────────────────────────
async function proxyFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    ...opts,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Shared UI primitives ──────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 13, fontWeight: 600,
      color: C.g700, marginBottom: 4 }}>
      {children}
    </label>
  );
}

function Input({ value, onChange, placeholder, type = 'text', error }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; error?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '8px 12px', borderRadius: 8,
        border: `1.5px solid ${error ? C.red : C.g200}`, fontSize: 14,
        outline: 'none', background: C.white, color: C.g900,
      }}
    />
  );
}

function Btn({ children, onClick, color = C.teal, disabled = false,
  variant = 'fill', type = 'button' }: {
  children: React.ReactNode; onClick?: () => void;
  color?: string; disabled?: boolean;
  variant?: 'fill' | 'outline' | 'ghost';
  type?: 'button' | 'submit';
}) {
  const base: React.CSSProperties = {
    padding: '8px 18px', borderRadius: 8, fontSize: 14,
    fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none', transition: 'opacity .15s',
    opacity: disabled ? 0.5 : 1,
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

// ── Login form ────────────────────────────────────────────────────────────────
function LoginForm({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [error, setError]         = useState('');
  const [emailErr, setEmailErr]   = useState(false);
  const [loading, setLoading]     = useState(false);

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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
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

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') submit(); };

  return (
    <div style={{ minHeight: '100vh', background: C.g50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: C.white, borderRadius: 16, padding: 36,
        width: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12,
            background: C.teal, margin: '0 auto 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22 }}>
            📚
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.g900 }}>
            Curriculum Admin
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: C.g500 }}>
            Sign in with your @neriah.ai account
          </p>
        </div>

        {/* Fields */}
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
                {showPw ? (
                  // Eye-off (slash through eye)
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  // Eye open
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
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

// ── Upload form ───────────────────────────────────────────────────────────────
const EDUCATION_LEVELS = [
  { value: 'all',      label: 'All levels' },
  { value: 'grade_1',  label: 'Grade 1' },
  { value: 'grade_2',  label: 'Grade 2' },
  { value: 'grade_3',  label: 'Grade 3' },
  { value: 'grade_4',  label: 'Grade 4' },
  { value: 'grade_5',  label: 'Grade 5' },
  { value: 'grade_6',  label: 'Grade 6' },
  { value: 'grade_7',  label: 'Grade 7' },
  { value: 'form_1',   label: 'Form 1' },
  { value: 'form_2',   label: 'Form 2' },
  { value: 'form_3',   label: 'Form 3' },
  { value: 'form_4',   label: 'Form 4' },
  { value: 'form_5',   label: 'Form 5 (A-Level)' },
  { value: 'form_6',   label: 'Form 6 (A-Level)' },
  { value: 'tertiary', label: 'College/University' },
];

function UploadPanel({ onUploaded }: { onUploaded: () => void }) {
  const [form, setForm] = useState<UploadForm>({
    country: 'Zimbabwe', curriculum: 'ZIMSEC',
    subject: '', education_level: 'all', year: '', file: null,
  });
  const [uploading, setUploading] = useState(false);
  const [result, setResult]       = useState<{ chunks: number; subject: string } | null>(null);
  const [error, setError]         = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof UploadForm) => (v: string | File | null) =>
    setForm(f => ({ ...f, [k]: v }));

  const upload = async () => {
    if (!form.file || !form.country || !form.curriculum || !form.subject || !form.education_level) {
      setError('All fields except Year are required.'); return;
    }
    setUploading(true); setError(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', form.file);
      fd.append('country', form.country);
      fd.append('curriculum', form.curriculum);
      fd.append('subject', form.subject);
      fd.append('education_level', form.education_level);
      if (form.year) fd.append('year', form.year);

      // POST through proxy — ADMIN_API_KEY added server-side
      const res = await fetch(`${PROXY_BASE}/upload`, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult({ chunks: data.chunks, subject: data.subject });
      setForm(f => ({ ...f, subject: '', file: null, year: '' }));
      if (fileRef.current) fileRef.current.value = '';
      onUploaded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ background: C.white, borderRadius: 12,
      border: `1.5px solid ${C.g200}`, padding: 24 }}>
      <h2 style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 700, color: C.g900 }}>
        Upload Syllabus
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <Label>Country</Label>
          <Input value={form.country} onChange={set('country')} placeholder="Zimbabwe" />
        </div>
        <div>
          <Label>Curriculum</Label>
          <Input value={form.curriculum} onChange={set('curriculum')} placeholder="ZIMSEC" />
        </div>
        <div>
          <Label>Subject</Label>
          <Input value={form.subject} onChange={set('subject')} placeholder="Mathematics" />
        </div>
        <div>
          <Label>Education level</Label>
          <select
            value={form.education_level}
            onChange={e => set('education_level')(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8,
              border: `1.5px solid ${C.g200}`, fontSize: 14,
              background: C.white, color: C.g900, outline: 'none' }}>
            {EDUCATION_LEVELS.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Year (optional)</Label>
          <Input value={form.year} onChange={set('year')} placeholder="2026" />
        </div>
        <div>
          <Label>File (PDF, DOCX, or TXT)</Label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={e => set('file')(e.target.files?.[0] ?? null)}
            style={{ fontSize: 13, color: C.g700, width: '100%' }}
          />
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Btn onClick={upload} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload & index'}
        </Btn>
        {result && (
          <span style={{ fontSize: 13, color: C.green }}>
            ✓ {result.subject} uploaded — {result.chunks} chunks indexed
          </span>
        )}
        {error && (
          <span style={{ fontSize: 13, color: C.red }}>{error}</span>
        )}
      </div>
    </div>
  );
}

// ── Syllabus list ─────────────────────────────────────────────────────────────
function SyllabusList({ syllabuses, onDelete, onReindex }: {
  syllabuses: Syllabus[];
  onDelete: (id: string) => void;
  onReindex: (id: string) => void;
}) {
  const [loadingId,   setLoadingId]   = useState<string | null>(null);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [errors, setErrors]           = useState<Record<string, string>>({});

  const doDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this syllabus and all its vector DB chunks?')) return;
    setLoadingId(id);
    try {
      await proxyFetch(`/${id}`, { method: 'DELETE' });
      onDelete(id);
    } catch (e: unknown) {
      setErrors(prev => ({ ...prev, [id]: e instanceof Error ? e.message : 'Delete failed' }));
    } finally {
      setLoadingId(null);
    }
  }, [onDelete]);

  const doReindex = useCallback(async (id: string) => {
    setReindexingId(id);
    try {
      await proxyFetch(`/${id}/reindex`, { method: 'POST' });
      onReindex(id);
    } catch (e: unknown) {
      setErrors(prev => ({ ...prev, [id]: e instanceof Error ? e.message : 'Reindex failed' }));
    } finally {
      setReindexingId(null);
    }
  }, [onReindex]);

  if (syllabuses.length === 0) {
    return (
      <div style={{ background: C.white, borderRadius: 12,
        border: `1.5px solid ${C.g200}`, padding: 32, textAlign: 'center' }}>
        <p style={{ color: C.g400, fontSize: 14, margin: 0 }}>
          No syllabuses uploaded yet. Use the form above to add one.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {syllabuses.map(s => (
        <div key={s.id} style={{ background: C.white, borderRadius: 12,
          border: `1.5px solid ${C.g200}`, padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: 16 }}>

          <div style={{ width: 40, height: 40, borderRadius: 10,
            background: C.tealLt, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18 }}>
            📄
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: C.g900 }}>
              {s.curriculum} — {s.subject}
              {s.year && <span style={{ fontWeight: 400, color: C.g500 }}> ({s.year})</span>}
            </div>
            <div style={{ fontSize: 12, color: C.g500, marginTop: 2 }}>
              {s.country} · {s.education_level} · {s.chunk_count} chunks ·{' '}
              {s.filename} ·{' '}
              {new Date(s.uploaded_at).toLocaleDateString()}
            </div>
            {errors[s.id] && (
              <div style={{ fontSize: 12, color: C.red, marginTop: 4 }}>{errors[s.id]}</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <Btn variant="outline" color={C.teal} disabled={reindexingId === s.id}
              onClick={() => doReindex(s.id)}>
              {reindexingId === s.id ? 'Reindexing…' : '↺ Reindex'}
            </Btn>
            <Btn variant="outline" color={C.red} disabled={loadingId === s.id}
              onClick={() => doDelete(s.id)}>
              {loadingId === s.id ? '…' : 'Delete'}
            </Btn>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function FilterBar({ value, onChange }: {
  value: { curriculum: string; subject: string };
  onChange: (v: { curriculum: string; subject: string }) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <input
        placeholder="Filter by curriculum…"
        value={value.curriculum}
        onChange={e => onChange({ ...value, curriculum: e.target.value })}
        style={{ padding: '7px 12px', borderRadius: 8,
          border: `1.5px solid ${C.g200}`, fontSize: 13,
          outline: 'none', width: 180 }}
      />
      <input
        placeholder="Filter by subject…"
        value={value.subject}
        onChange={e => onChange({ ...value, subject: e.target.value })}
        style={{ padding: '7px 12px', borderRadius: 8,
          border: `1.5px solid ${C.g200}`, fontSize: 13,
          outline: 'none', width: 180 }}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CurriculumAdminPage() {
  const [adminEmail, setAdminEmail] = useState<string | null>(null); // null = checking
  const [authChecked, setAuthChecked] = useState(false);
  const [syllabuses, setSyllabuses]   = useState<Syllabus[]>([]);
  const [loading, setLoading]         = useState(false);
  const [fetchError, setFetchError]   = useState('');
  const [filter, setFilter]           = useState({ curriculum: '', subject: '' });

  // On mount: check if already authenticated
  useEffect(() => {
    fetch('/api/admin/verify', { credentials: 'same-origin' })
      .then(r => r.json())
      .then((d: { authenticated?: boolean; email?: string }) => {
        if (d.authenticated && d.email) setAdminEmail(d.email);
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  const loadSyllabuses = useCallback(async () => {
    setLoading(true); setFetchError('');
    try {
      const params = new URLSearchParams();
      if (filter.curriculum) params.set('curriculum', filter.curriculum);
      if (filter.subject)    params.set('subject', filter.subject);
      const qs   = params.toString() ? '?' + params.toString() : '';
      const data = await proxyFetch(`/list${qs}`);
      setSyllabuses(data);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load syllabuses');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (adminEmail) loadSyllabuses();
  }, [adminEmail, filter, loadSyllabuses]);

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    setAdminEmail(null);
    setSyllabuses([]);
  };

  const [demoLaunching, setDemoLaunching] = useState(false);
  const [demoError, setDemoError]         = useState('');

  const handleLaunchDemo = async () => {
    setDemoLaunching(true);
    setDemoError('');
    try {
      const res = await fetch('/api/admin/demo-token', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setDemoError(body.error || 'Failed to launch demo.');
        return;
      }
      // Cookie is now set — open demo in a new tab so the admin panel stays open
      window.open('/demo', '_blank', 'noopener');
    } catch {
      setDemoError('Network error. Please try again.');
    } finally {
      setDemoLaunching(false);
    }
  };

  // Still checking cookie
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
    return <LoginForm onSuccess={email => { setAdminEmail(email); }} />;
  }

  // ── Admin panel ─────────────────────────────────────────────────────────────
  const filtered = syllabuses.filter(s =>
    (!filter.curriculum || s.curriculum.toLowerCase().includes(filter.curriculum.toLowerCase())) &&
    (!filter.subject    || s.subject.toLowerCase().includes(filter.subject.toLowerCase()))
  );

  return (
    <div style={{ minHeight: '100vh', background: C.g50, fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.g200}`,
        padding: '16px 32px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: C.teal,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18 }}>
            📚
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.g900 }}>
              Curriculum Admin
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: C.g500 }}>
              Manage Neriah syllabus RAG index
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Email badge */}
          <span style={{ fontSize: 13, color: C.g500,
            background: C.g100, borderRadius: 20,
            padding: '4px 12px' }}>
            {adminEmail}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <Btn variant="outline" color={C.teal}
              disabled={demoLaunching}
              onClick={handleLaunchDemo}>
              {demoLaunching ? 'Opening…' : 'Launch Demo'}
            </Btn>
            {demoError && (
              <span style={{ fontSize: 11, color: C.red }}>{demoError}</span>
            )}
          </div>
          <Btn variant="ghost" onClick={handleLogout} color={C.g500}>
            Logout
          </Btn>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px',
        display: 'flex', flexDirection: 'column', gap: 24 }}>

        <UploadPanel onUploaded={loadSyllabuses} />

        <div style={{ display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.g900 }}>
              Uploaded syllabuses
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: C.g500 }}>
              {filtered.length} syllabus{filtered.length !== 1 ? 'es' : ''}
            </p>
          </div>
          <FilterBar value={filter} onChange={setFilter} />
        </div>

        {fetchError && (
          <div style={{ background: C.redLt, border: `1.5px solid ${C.red}`,
            borderRadius: 10, padding: '12px 16px', fontSize: 14, color: C.red }}>
            {fetchError}
          </div>
        )}
        {loading && (
          <p style={{ color: C.g400, fontSize: 14, textAlign: 'center' }}>Loading…</p>
        )}

        {!loading && (
          <SyllabusList
            syllabuses={filtered}
            onDelete={id => setSyllabuses(prev => prev.filter(s => s.id !== id))}
            onReindex={loadSyllabuses}
          />
        )}

        <div style={{ background: C.tealLt, borderRadius: 10,
          border: `1.5px solid #99F6E4`, padding: '14px 18px' }}>
          <p style={{ margin: 0, fontSize: 13, color: C.tealDk, fontWeight: 600 }}>
            How RAG works in Neriah
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: C.tealDk, lineHeight: 1.5 }}>
            When a teacher scans a student's work, Neriah retrieves relevant curriculum context
            from uploaded syllabuses and similar verified gradings. This context is injected into
            the Gemma 4 grading prompt, improving accuracy for curriculum-specific questions.
            Expanding to a new country: upload that country's national syllabus PDFs — no code changes needed.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: C.g500 }}>
            Supported: ZIMSEC (Zimbabwe) · Cambridge International · Add more by uploading
          </p>
        </div>
      </div>
    </div>
  );
}
