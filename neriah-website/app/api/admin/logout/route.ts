import { NextResponse } from 'next/server';

// ── POST /api/admin/logout ────────────────────────────────────────────────────
export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('neriah-admin', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/admin',
  });
  return response;
}
