import { NextRequest, NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NewsletterSchema } from '@/lib/validators/contact'
import { supabaseAdmin } from '@/lib/supabase/client'
import { sendNewsletterConfirmation } from '@/lib/email/resend'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, '1 h'),
  analytics: true,
})

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1'
  const { success } = await ratelimit.limit(ip)
  if (!success) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const result = NewsletterSchema.safeParse(body)
  if (!result.success) {
    if (result.error.flatten().fieldErrors.website) {
      return NextResponse.json({ success: true })
    }
    return NextResponse.json({ error: 'Invalid email address' }, { status: 422 })
  }

  const { email } = result.data

  try {
    // Upsert — no error if already subscribed
    await supabaseAdmin
      .from('newsletter_subscribers')
      .upsert({ email }, { onConflict: 'email', ignoreDuplicates: true })

    await sendNewsletterConfirmation(email).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Newsletter error:', error)
    return NextResponse.json({ error: 'Could not subscribe. Try again.' }, { status: 500 })
  }
}
