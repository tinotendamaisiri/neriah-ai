import { getToken } from 'next-auth/jwt'
import { jwtVerify } from 'jose'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_EMAILS = (process.env.ALLOWED_STUDIO_EMAILS || '').split(',').map(e => e.trim())

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── /demo guard ──────────────────────────────────────────────────────────────
  if (pathname === '/demo' || pathname.startsWith('/demo/')) {
    const demoToken = req.cookies.get('demo_admin_token')?.value
    if (!demoToken) {
      return NextResponse.redirect(new URL('/admin/curriculum?redirect=demo', req.url))
    }
    const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? ''
    const demoSecret = new TextEncoder().encode(
      process.env.DEMO_TOKEN_SECRET ?? sessionSecret,
    )
    try {
      await jwtVerify(demoToken, demoSecret)
      return NextResponse.next()
    } catch {
      const res = NextResponse.redirect(new URL('/admin/curriculum?redirect=demo', req.url))
      res.cookies.delete('demo_admin_token')
      return res
    }
  }

  // ── /studio guard ─────────────────────────────────────────────────────────────
  if (!pathname.startsWith('/studio')) {
    return NextResponse.next()
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  // Not logged in
  if (!token) {
    const loginUrl = new URL('/api/auth/signin', req.url)
    loginUrl.searchParams.set('callbackUrl', req.url)
    return NextResponse.redirect(loginUrl)
  }

  // Logged in but not an allowed email
  if (!ALLOWED_EMAILS.includes(token.email as string)) {
    return new NextResponse('Access denied. Your email is not authorised to access the CMS.', {
      status: 403,
    })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/studio/:path*', '/demo', '/demo/:path*'],
}
export default proxy
