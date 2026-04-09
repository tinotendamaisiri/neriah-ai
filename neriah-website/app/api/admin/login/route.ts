import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { createHash, timingSafeEqual } from 'crypto';

// ── In-memory rate limiter ────────────────────────────────────────────────────
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX       = 5;

const attempts = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(ip: string): boolean {
  const now  = Date.now();
  const rec  = attempts.get(ip);
  if (!rec || now - rec.windowStart > RATE_WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return true; // allowed
  }
  if (rec.count >= RATE_MAX) return false; // blocked
  rec.count += 1;
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(createHash('sha256').update(a).digest('hex'));
  const bufB = Buffer.from(createHash('sha256').update(b).digest('hex'));
  return timingSafeEqual(bufA, bufB);
}

// ── POST /api/admin/login ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ip        = getClientIp(req);
  const timestamp = new Date().toISOString();

  // 1. Rate limit
  if (!checkRateLimit(ip)) {
    console.warn(`[admin/login] RATE_LIMITED ip=${ip} at=${timestamp}`);
    return NextResponse.json(
      { error: 'Too many attempts. Try again in 15 minutes.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({})) as {
    email?: string;
    password?: string;
  };
  const { email = '', password = '' } = body;

  // 2. Domain check
  if (!email.toLowerCase().endsWith('@neriah.ai')) {
    console.warn(`[admin/login] DOMAIN_REJECTED email=${email} ip=${ip} at=${timestamp}`);
    return NextResponse.json(
      { error: 'Access restricted to neriah.ai accounts.' },
      { status: 403 },
    );
  }

  const adminEmail    = process.env.ADMIN_EMAIL    ?? '';
  const adminPassword = process.env.ADMIN_PASSWORD ?? '';
  const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? '';

  if (!adminEmail || !adminPassword || !sessionSecret) {
    console.error(`[admin/login] MISCONFIGURED at=${timestamp}`);
    return NextResponse.json({ error: 'Admin access not configured.' }, { status: 503 });
  }

  // 3 & 4. Email + password — both must match (timing-safe)
  const emailMatch    = timingSafeCompare(email.toLowerCase(), adminEmail.toLowerCase());
  const passwordMatch = timingSafeCompare(password, adminPassword);

  if (!emailMatch || !passwordMatch) {
    console.warn(`[admin/login] FAILED ip=${ip} email=${email} at=${timestamp}`);
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
  }

  // 5. Issue JWT
  const secret = new TextEncoder().encode(sessionSecret);
  const token  = await new SignJWT({ sub: email, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secret);

  console.info(`[admin/login] SUCCESS ip=${ip} email=${email} at=${timestamp}`);

  const response = NextResponse.json({ success: true });
  response.cookies.set('neriah-admin', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 8,
    path: '/admin',
  });
  return response;
}
