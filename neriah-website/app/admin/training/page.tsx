'use client';

// Admin viewer for the training-data archive (gs://neriah-training-data).
// Each card = one approved teacher-graded submission. Image preview uses
// short-lived signed URLs from the backend so the bucket can stay private.

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

const C = {
  teal: '#0D9488',
  tealDk: '#0F766E',
  tealLt: '#F0FDFA',
  amber: '#F59E0B',
  red: '#DC2626',
  redLt: '#FEF2F2',
  green: '#16A34A',
  g50: '#F9FAFB',
  g100: '#F3F4F6',
  g200: '#E5E7EB',
  g400: '#9CA3AF',
  g500: '#6B7280',
  g700: '#374151',
  g900: '#111827',
  white: '#FFFFFF',
};

interface Sample {
  submission_id: string;
  class_id: string;
  school_id: string;
  subject?: string;
  education_level?: string;
  school_name?: string;
  source?: string;
  ai_score?: number;
  teacher_score?: number;
  max_score?: number;
  approved_at?: string;
  image_url?: string | null;
  folder?: string;
}

interface Stats {
  samples: number;
  bytes_total: number;
  bucket: string;
}

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtPct(score: number | undefined, max: number | undefined): string {
  if (score == null || !max) return '—';
  return `${Math.round((score / max) * 100)}%`;
}

function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(d).toLocaleDateString();
}

export default function TrainingViewerPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [openSample, setOpenSample] = useState<Sample | null>(null);

  useEffect(() => {
    fetch('/api/admin/verify', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { authenticated?: boolean; email?: string }) => {
        if (d.authenticated && d.email) setAdminEmail(d.email);
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [listRes, statsRes] = await Promise.all([
        fetch('/api/admin/training?limit=50', { credentials: 'same-origin' }),
        fetch('/api/admin/training?stats', { credentials: 'same-origin' }),
      ]);
      if (!listRes.ok) {
        setErr(`List failed: HTTP ${listRes.status}`);
      } else {
        const data = await listRes.json();
        setSamples(data.samples || []);
      }
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
    } catch (e) {
      setErr(`Network error: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminEmail) load();
  }, [adminEmail, load]);

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
        <p style={{ color: C.g500 }}>
          Sign in at{' '}
          <Link href="/admin" style={{ color: C.teal }}>
            /admin
          </Link>{' '}
          first.
        </p>
      </div>
    );
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
          <Link
            href="/admin"
            style={{ color: C.g500, fontSize: 13, textDecoration: 'none' }}
          >
            ← Admin
          </Link>
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
            🗂️
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: C.g900, margin: 0 }}>
              Training data
            </h1>
            <p style={{ fontSize: 12, color: C.g500, margin: 0 }}>
              Approved teacher-graded submissions archived to{' '}
              <code style={{ background: C.g100, padding: '1px 6px', borderRadius: 4 }}>
                gs://neriah-training-data
              </code>
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: 'transparent',
            border: `1px solid ${C.g200}`,
            color: C.g700,
            padding: '6px 14px',
            borderRadius: 8,
            fontSize: 13,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px' }}>
        {/* Stats card */}
        <div
          style={{
            background: C.white,
            border: `1px solid ${C.g200}`,
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: C.g500, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Approved samples
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: C.g900 }}>
              {stats?.samples?.toLocaleString() ?? '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.g500, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Total stored
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: C.g900 }}>
              {stats ? fmtBytes(stats.bytes_total) : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.g500, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Bucket
            </div>
            <div style={{ fontSize: 14, fontFamily: 'monospace', color: C.g700, marginTop: 8 }}>
              {stats?.bucket ?? settings_default}
            </div>
          </div>
        </div>

        {err && (
          <div
            style={{
              background: C.redLt,
              color: C.red,
              padding: 12,
              borderRadius: 8,
              border: `1px solid #FECACA`,
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {err}
          </div>
        )}

        {samples.length === 0 && !loading && !err && (
          <div
            style={{
              background: C.white,
              border: `1px dashed ${C.g200}`,
              borderRadius: 12,
              padding: 40,
              textAlign: 'center',
              color: C.g500,
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
            <h3 style={{ fontSize: 16, color: C.g700, margin: '0 0 6px' }}>
              No training samples yet
            </h3>
            <p style={{ fontSize: 13, margin: 0 }}>
              Samples land here automatically when a teacher approves a graded submission.
              Check{' '}
              <code style={{ background: C.g100, padding: '1px 6px', borderRadius: 4 }}>
                shared/training_data.py
              </code>{' '}
              for the schema.
            </p>
          </div>
        )}

        {samples.length > 0 && (
          <>
            <h2
              style={{
                fontSize: 13,
                color: C.g500,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                margin: '0 0 12px',
              }}
            >
              Recent ({samples.length})
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 16,
              }}
            >
              {samples.map((s) => (
                <div
                  key={s.submission_id || s.folder}
                  onClick={() => setOpenSample(s)}
                  style={{
                    background: C.white,
                    border: `1px solid ${C.g200}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(13,148,136,0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '4 / 5',
                      background: C.g100,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {s.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.image_url}
                        alt={s.subject ?? 'submission'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ color: C.g400, fontSize: 13 }}>No image</span>
                    )}
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.g900 }}>
                        {s.subject || '—'}
                      </span>
                      <span style={{ fontSize: 11, color: C.g500 }}>{s.education_level || ''}</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.g500, marginBottom: 6 }}>
                      {relativeTime(s.approved_at)}
                      {s.school_name ? ` · ${s.school_name}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Pill
                        label={`AI ${fmtPct(s.ai_score, s.max_score)}`}
                        background={C.g100}
                        color={C.g700}
                      />
                      <Pill
                        label={`Teacher ${fmtPct(s.teacher_score, s.max_score)}`}
                        background={C.tealLt}
                        color={C.tealDk}
                      />
                      {s.source && (
                        <Pill label={s.source} background={C.g100} color={C.g500} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Detail panel */}
      {openSample && (
        <div
          onClick={() => setOpenSample(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 50,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 100vw)',
              background: C.white,
              padding: 24,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 16,
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.g900 }}>
                  {openSample.subject || 'Submission'}
                </div>
                <div style={{ fontSize: 12, color: C.g500 }}>
                  {openSample.education_level || ''} · {relativeTime(openSample.approved_at)}
                </div>
              </div>
              <button
                onClick={() => setOpenSample(null)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${C.g200}`,
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 13,
                  cursor: 'pointer',
                  color: C.g500,
                }}
              >
                Close
              </button>
            </div>
            {openSample.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={openSample.image_url}
                alt="full"
                style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
              />
            )}
            <pre
              style={{
                background: C.g100,
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
                overflowX: 'auto',
              }}
            >
              {JSON.stringify(openSample, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

const settings_default = 'gs://neriah-training-data';

function Pill({ label, background, color }: { label: string; background: string; color: string }) {
  return (
    <span
      style={{
        background,
        color,
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
