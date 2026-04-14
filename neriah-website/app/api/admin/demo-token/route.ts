import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, SignJWT } from 'jose';

// ── POST /api/admin/demo-token ────────────────────────────────────────────────
// Verifies the admin session cookie (neriah-admin, path=/),
// issues a short-lived demo_admin_token cookie (path=/), and returns { ok: true }.
// The caller then opens /demo in a new tab — the cookie travels with that request.
export async function POST(req: NextRequest) {
  const adminToken = req.cookies.get('neriah-admin')?.value;
  if (!adminToken) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? '';
  if (!sessionSecret) {
    return NextResponse.json({ error: 'Admin access not configured.' }, { status: 503 });
  }

  try {
    const { payload } = await jwtVerify(
      adminToken,
      new TextEncoder().encode(sessionSecret),
    );

    const email = (payload.sub ?? '') as string;
    if (!email.toLowerCase().endsWith('@neriah.ai')) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    // Issue demo token (2h)
    const demoSecret = new TextEncoder().encode(
      process.env.DEMO_TOKEN_SECRET ?? sessionSecret,
    );
    const demoToken = await new SignJWT({ sub: email, role: 'demo-viewer' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(demoSecret);

    const response = NextResponse.json({ ok: true });
    response.cookies.set('demo_admin_token', demoToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 2,
      path: '/',
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
}
