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

// ── Proxy helpers ─────────────────────────────────────────────────────────────
function buildUpstreamHeaders(req: NextRequest): HeadersInit {
  const apiKey = process.env.ADMIN_API_KEY ?? '';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  // Forward content-type for JSON bodies
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  return headers;
}

function upstreamUrl(req: NextRequest): string {
  // Strip the Next.js prefix /api/admin/curriculum and forward the rest
  const url      = new URL(req.url);
  const suffix   = url.pathname.replace(/^\/api\/admin\/curriculum/, '');
  const search   = url.search;
  return `${CLOUD_FN_BASE}/curriculum${suffix}${search}`;
}

// ── GET /api/admin/curriculum[/*] ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!await verifyAdminCookie(req)) return unauthorized();
  const res = await fetch(upstreamUrl(req), {
    method: 'GET',
    headers: buildUpstreamHeaders(req),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

// ── POST /api/admin/curriculum[/*] ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!await verifyAdminCookie(req)) return unauthorized();
  // Forward body (FormData or JSON)
  const body = await req.blob();
  const res = await fetch(upstreamUrl(req), {
    method: 'POST',
    headers: buildUpstreamHeaders(req),
    body,
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

// ── DELETE /api/admin/curriculum[/*] ─────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  if (!await verifyAdminCookie(req)) return unauthorized();
  const res = await fetch(upstreamUrl(req), {
    method: 'DELETE',
    headers: buildUpstreamHeaders(req),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
