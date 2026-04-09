import { revalidatePath, revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

const INDEXNOW_KEY = '83f71b7e-96f3-4632-8585-2b235b7bc817'
const SITE_HOST    = 'neriah.ai'

async function pingIndexNow(slug: string) {
  const urls = [
    `https://${SITE_HOST}/blog`,
    `https://${SITE_HOST}/blog/${slug}`,
  ]
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: SITE_HOST, key: INDEXNOW_KEY, urlList: urls }),
    })
  } catch (err) {
    console.error('IndexNow ping failed:', err)
  }
}

// Called by Sanity webhook when a post is published or updated
// Configure in Sanity project settings → API → Webhooks
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')

  if (secret !== process.env.SANITY_REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { _type, slug } = body

    if (_type === 'post') {
      revalidatePath('/blog')
      revalidateTag('posts', {})
      if (slug?.current) {
        revalidatePath(`/blog/${slug.current}`)
        await pingIndexNow(slug.current)
      }
    }

    if (_type === 'foundationUpdate') {
      revalidatePath('/foundation')
      revalidatePath('/')
      revalidateTag('foundation', {})
    }

    return NextResponse.json({ revalidated: true, timestamp: Date.now() })
  } catch (error) {
    console.error('Revalidation error:', error)
    return NextResponse.json({ error: 'Revalidation failed' }, { status: 500 })
  }
}
