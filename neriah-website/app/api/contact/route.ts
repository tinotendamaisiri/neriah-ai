import { NextRequest, NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { ContactSchema } from '@/lib/validators/contact'
import { supabaseAdmin } from '@/lib/supabase/client'
import { sendContactNotification, sendContactConfirmation } from '@/lib/email/resend'

const redis = Redis.fromEnv()

// Tier 1: 5 requests per 2 minutes (normal use)
const shortLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '2 m'),
  prefix: 'contact_short',
  analytics: true,
})

// Tier 2: 10 requests per 15 minutes (moderate use)
const mediumLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '15 m'),
  prefix: 'contact_medium',
  analytics: true,
})

// Tier 3: 20 requests per hour (heavy use — likely abuse)
const longLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '1 h'),
  prefix: 'contact_long',
  analytics: true,
})

export async function POST(req: NextRequest) {
  // CORS — only accept from neriah.ai
  const origin = req.headers.get('origin') || ''
  const allowed = ['https://neriah.ai', 'https://www.neriah.ai', 'http://localhost:3000']
  if (!allowed.includes(origin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Tiered rate limiting by IP — check all three in parallel
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1'
  const [short, medium, long] = await Promise.all([
    shortLimit.limit(ip),
    mediumLimit.limit(ip),
    longLimit.limit(ip),
  ])

  if (!long.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again in about an hour.', retryAfter: 3600 },
      { status: 429 }
    )
  }
  if (!medium.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again in about 15 minutes.', retryAfter: 900 },
      { status: 429 }
    )
  }
  if (!short.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again in a couple of minutes.', retryAfter: 120 },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Validate with Zod (also catches honeypot)
  const result = ContactSchema.safeParse(body)
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors
    // Silently succeed if honeypot was filled — don't tell bots it failed
    if (errors.website) {
      return NextResponse.json({ success: true }, { status: 200 })
    }
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 422 })
  }

  const { first_name, last_name, whatsapp_number, email, school_name, city, role, subject, message } = result.data

  try {
    // Store in Supabase
    const { error: dbError } = await supabaseAdmin
      .from('contact_submissions')
      .insert({
        first_name,
        last_name,
        whatsapp_number,
        email,
        school_name,
        city,
        role,
        subject,
        message: message || null,
      })

    if (dbError) throw dbError

    // Send notifications (non-blocking — don't fail if email fails)
    const emailResults = await Promise.allSettled([
      sendContactNotification({ first_name, last_name, whatsapp_number, email, school_name, city, role, subject, message: message || '' }),
      sendContactConfirmation(email, first_name, subject),
    ])

    emailResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Email ${index} failed:`, result.reason)
      } else {
        console.log(`Email ${index} sent:`, JSON.stringify(result.value))
      }
    })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('Contact form error:', JSON.stringify(error, null, 2))
    return NextResponse.json(
      { error: 'Something went wrong. Please email us directly at admin@neriah.ai' },
      { status: 500 }
    )
  }
}

// Block all other methods
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}
