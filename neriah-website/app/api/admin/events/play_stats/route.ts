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

// ── GET /api/admin/events/play_stats  → upstream /api/admin/events/play_stats ─
// Forwards `days` query param to the upstream.
export async function GET(req: NextRequest) {
  if (!await verifyAdminCookie(req)) return unauthorized();

  const apiKey = process.env.ADMIN_API_KEY ?? '';
  const { search } = new URL(req.url);
  const upstream = `${CLOUD_FN_BASE}/admin/events/play_stats${search}`;

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
      { error: 'Upstream Play stats service unreachable', detail: String(err) },
      { status: 502 },
    );
  }
}
