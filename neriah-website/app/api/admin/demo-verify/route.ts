import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// ── GET /api/admin/demo-verify ────────────────────────────────────────────────
// Verifies the demo_admin_token cookie. Called client-side on /demo mount.
// Returns { valid: true, expiresAt: <ISO string> } or 401.
export async function GET(req: NextRequest) {
  const token = req.cookies.get('demo_admin_token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? '';
  const demoSecret = new TextEncoder().encode(
    process.env.DEMO_TOKEN_SECRET ?? sessionSecret,
  );

  if (!sessionSecret) {
    return NextResponse.json({ error: 'Admin access not configured.' }, { status: 503 });
  }

  try {
    const { payload } = await jwtVerify(token, demoSecret);
    const expiresAt = payload.exp
      ? new Date(payload.exp * 1000).toISOString()
      : null;
    return NextResponse.json({ valid: true, expiresAt });
  } catch {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }
}
