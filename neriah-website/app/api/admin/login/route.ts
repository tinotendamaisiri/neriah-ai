import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { createHash, timingSafeEqual } from 'crypto';

// ── Progressive rate limiter ──────────────────────────────────────────────────
// Attempts 1-3: no lockout. From attempt 4 onward, lockout grows with each failure.
const LOCKOUT_SCHEDULE: number[] = [0, 0, 0, 1, 2, 5, 10, 15]; // minutes per attempt index
const MAX_LOCKOUT_MINUTES = 15;

interface IpRecord {
  failures: number;       // total failed attempts
  lockedUntil: number;    // epoch ms; 0 = not locked
}

const ipRecords = new Map<string, IpRecord>();

/** Returns remaining lockout seconds (0 = allowed through). */
function getLockoutSeconds(ip: string): number {
  const rec = ipRecords.get(ip);
  if (!rec || rec.lockedUntil === 0) return 0;
  const remaining = rec.lockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function recordFailure(ip: string): void {
  const rec = ipRecords.get(ip) ?? { failures: 0, lockedUntil: 0 };
  rec.failures += 1;
  const lockMinutes =
    rec.failures < LOCKOUT_SCHEDULE.length
      ? LOCKOUT_SCHEDULE[rec.failures]
      : MAX_LOCKOUT_MINUTES;
  rec.lockedUntil = lockMinutes > 0 ? Date.now() + lockMinutes * 60 * 1000 : 0;
  ipRecords.set(ip, rec);
}

function resetFailures(ip: string): void {
  ipRecords.delete(ip);
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

  // 1. Progressive lockout check
  const lockedSecs = getLockoutSeconds(ip);
  if (lockedSecs > 0) {
    const mins = Math.ceil(lockedSecs / 60);
    console.warn(`[admin/login] LOCKED ip=${ip} remaining=${lockedSecs}s at=${timestamp}`);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` },
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

  const adminPassword = process.env.ADMIN_PASSWORD ?? '';
  const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? '';

  if (!adminPassword || !sessionSecret) {
    console.error(`[admin/login] MISCONFIGURED at=${timestamp}`);
    return NextResponse.json({ error: 'Admin access not configured.' }, { status: 503 });
  }

  // 3. Password check (timing-safe)
  if (!timingSafeCompare(password, adminPassword)) {
    recordFailure(ip);
    const lockedSecsNow = getLockoutSeconds(ip);
    if (lockedSecsNow > 0) {
      const mins = Math.ceil(lockedSecsNow / 60);
      console.warn(`[admin/login] FAILED+LOCKED ip=${ip} email=${email} at=${timestamp}`);
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` },
        { status: 429 },
      );
    }
    console.warn(`[admin/login] FAILED ip=${ip} email=${email} at=${timestamp}`);
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
  }

  // Reset failure count on success
  resetFailures(ip);

  // 4. Issue JWT
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
    path: '/',
  });
  return response;
}
