'use client';

// Neriah admin hub — single landing at /admin with cards linking to each
// admin tool. To add a new tool: append to TOOLS, point it at the new
// route. Same cookie auth as the existing /admin/curriculum and
// /admin/monitoring screens.

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

const C = {
  teal: '#0D9488',
  tealDk: '#0F766E',
  tealLt: '#F0FDFA',
  amber: '#F59E0B',
  red: '#DC2626',
  g50: '#F9FAFB',
  g100: '#F3F4F6',
  g200: '#E5E7EB',
  g400: '#9CA3AF',
  g500: '#6B7280',
  g700: '#374151',
  g900: '#111827',
  white: '#FFFFFF',
};

interface Tool {
  href: string;
  title: string;
  description: string;
  icon: string;
  badge?: string;
}

const TOOLS: Tool[] = [
  {
    href: '/admin/monitoring',
    title: 'Monitoring',
    description:
      'Live event feed, error groups, signup funnels, AI usage + cost, per-user trace replay.',
    icon: '📡',
  },
  {
    href: '/admin/curriculum',
    title: 'Curriculum',
    description:
      'Upload, list, re-index, and delete syllabuses used by the RAG layer when grading.',
    icon: '📚',
  },
  {
    href: '/admin/training',
    title: 'Training data',
    description:
      'Browse approved teacher-graded submissions archived to gs://neriah-training-data — image, AI score, teacher score, all in one view. For training-set spot checks.',
    icon: '🗂️',
  },
];

function LoginForm({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(data?.error || 'Login failed');
        return;
      }
      onSuccess(email);
    } catch {
      setErr('Network error — try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.g50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: '100%',
          maxWidth: 400,
          background: C.white,
          padding: 32,
          borderRadius: 16,
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          border: `1px solid ${C.g200}`,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: C.teal,
            color: C.white,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            marginBottom: 20,
          }}
        >
          🛠️
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.g900, margin: '0 0 6px' }}>
          Neriah admin
        </h1>
        <p style={{ fontSize: 13, color: C.g500, margin: '0 0 24px' }}>
          Sign in with your @neriah.ai account.
        </p>

        <label style={{ display: 'block', fontSize: 13, color: C.g700, marginBottom: 6 }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          style={{
            width: '100%',
            padding: '10px 12px',
            border: `1px solid ${C.g200}`,
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 16,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <label style={{ display: 'block', fontSize: 13, color: C.g700, marginBottom: 6 }}>
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{
            width: '100%',
            padding: '10px 12px',
            border: `1px solid ${C.g200}`,
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 20,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {err && (
          <div
            style={{
              background: '#FEF2F2',
              color: C.red,
              padding: '10px 12px',
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 16,
              border: `1px solid #FECACA`,
            }}
          >
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: '100%',
            background: busy ? C.g400 : C.teal,
            color: C.white,
            padding: '12px 16px',
            borderRadius: 8,
            border: 'none',
            fontSize: 14,
            fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export default function AdminHubPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/verify', { credentials: 'same-origin' })
      .then((r) => r.json())
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

  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: C.g50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <p style={{ color: C.g400, fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  if (!adminEmail) {
    return <LoginForm onSuccess={(email) => setAdminEmail(email)} />;
  }

  return (
    <div style={{ minHeight: '100vh', background: C.g50, fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div
        style={{
          background: C.white,
          borderBottom: `1px solid ${C.g200}`,
          padding: '16px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: C.teal,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            🛠️
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: C.g900, margin: 0 }}>
              Neriah admin
            </h1>
            <p style={{ fontSize: 12, color: C.g500, margin: 0 }}>
              Pick a tool — all admin surfaces live here.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              fontSize: 13,
              color: C.g500,
              background: C.g100,
              padding: '6px 12px',
              borderRadius: 999,
            }}
          >
            {adminEmail}
          </span>
          <button
            onClick={handleLogout}
            style={{
              background: 'transparent',
              border: `1px solid ${C.g200}`,
              color: C.g700,
              padding: '6px 14px',
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Tools grid */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: C.g500, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Tools
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 20,
          }}
        >
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              style={{
                display: 'block',
                background: C.white,
                border: `1px solid ${C.g200}`,
                borderRadius: 14,
                padding: 24,
                textDecoration: 'none',
                color: 'inherit',
                transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = C.teal;
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(13,148,136,0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.g200;
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: C.tealLt,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  marginBottom: 16,
                }}
              >
                {tool.icon}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: C.g900, margin: 0 }}>
                  {tool.title}
                </h3>
                {tool.badge && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                      background: C.amber,
                      color: C.white,
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    {tool.badge}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 14, color: C.g500, margin: '0 0 16px', lineHeight: 1.5 }}>
                {tool.description}
              </p>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: C.teal,
                }}
              >
                Open <span style={{ fontSize: 16, lineHeight: 1 }}>→</span>
              </span>
            </Link>
          ))}
        </div>

        <div style={{ marginTop: 48, padding: 16, background: C.g100, borderRadius: 8, fontSize: 12, color: C.g500 }}>
          To add a new admin tool: edit <code style={{ background: C.white, padding: '2px 6px', borderRadius: 4 }}>app/admin/page.tsx</code> and append to the <code style={{ background: C.white, padding: '2px 6px', borderRadius: 4 }}>TOOLS</code> array.
        </div>
      </div>
    </div>
  );
}
