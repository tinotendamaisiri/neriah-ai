import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// ── GET /api/admin/verify ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const token = req.cookies.get('neriah-admin')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? '';
  if (!sessionSecret) {
    return NextResponse.json({ error: 'Admin access not configured.' }, { status: 503 });
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(sessionSecret),
    );

    const email = (payload.sub ?? '') as string;

    // Re-validate domain in case env vars change
    if (!email.toLowerCase().endsWith('@neriah.ai')) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    return NextResponse.json({ authenticated: true, email });
  } catch {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
}
