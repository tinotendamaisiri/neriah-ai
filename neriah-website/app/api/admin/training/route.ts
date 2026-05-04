import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const CLOUD_FN_BASE =
  'https://us-central1-neriah-ai-492302.cloudfunctions.net/neriah-grading/api';

async function verifyAdminCookie(req: NextRequest): Promise<boolean> {
  const token         = req.cookies.get('neriah-admin')?.value;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? '';
  if (!token || !sessionSecret) return false;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(sessionSecret));
    const email = (payload.sub ?? '') as string;
    return email.toLowerCase().endsWith('@neriah.ai');
  } catch {
    return false;
  }
}

function unauthorized() {
  return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
}

// ── GET /api/admin/training       → upstream /api/admin/training/list  ────
// ── GET /api/admin/training?stats → upstream /api/admin/training/stats ────
export async function GET(req: NextRequest) {
  if (!await verifyAdminCookie(req)) return unauthorized();

  const apiKey = process.env.ADMIN_API_KEY ?? '';
  const url = new URL(req.url);
  const wantStats = url.searchParams.get('stats') !== null;
  const upstreamPath = wantStats ? '/admin/training/stats' : '/admin/training/list';
  // strip the `stats` flag before forwarding so the upstream sees only data params
  url.searchParams.delete('stats');
  const upstream = `${CLOUD_FN_BASE}${upstreamPath}${url.search}`;

  try {
    const res = await fetch(upstream, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: 'Upstream training service unreachable', detail: String(err) },
      { status: 502 },
    );
  }
}
