'use client'
import { useState } from 'react'

export function NewsletterForm({ variant = 'dark' }: { variant?: 'dark' | 'light' }) {
  const [email, setEmail]   = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [hp, setHp]         = useState('')           // honeypot

  const isDark = variant === 'dark'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hp) return                                    // bot — silently ignore
    if (!email) return

    setStatus('loading')
    try {
      const res = await fetch('/api/newsletter', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, consent: 'on', website: hp }),
      })
      if (!res.ok) throw new Error()
      setStatus('success')
      setEmail('')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <p className={`text-sm ${isDark ? 'text-teal-mid' : 'text-teal'}`}>
        ✓ You&apos;re subscribed. We&apos;ll be in touch.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Newsletter signup">
      {/* Honeypot */}
      <div className="absolute opacity-0 pointer-events-none h-0 overflow-hidden" aria-hidden="true">
        <input type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={e => setHp(e.target.value)} />
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          aria-label="Email address"
          className={`flex-1 min-w-[200px] px-3.5 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal transition min-h-[44px] ${
            isDark
              ? 'bg-white/10 border border-white/20 text-white placeholder-white/40 focus:ring-teal-mid'
              : 'bg-white border border-black/10 text-dark placeholder-mid'
          }`}
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="bg-amber text-amber-dark font-medium px-4 py-2.5 rounded-lg text-sm hover:bg-[#e8960d] transition-colors disabled:opacity-60 min-h-[44px]"
        >
          {status === 'loading' ? '...' : 'Subscribe'}
        </button>
      </div>

      <p className={`text-[11px] mt-2 ${isDark ? 'text-teal-mid/70' : 'text-mid'}`}>
        By subscribing you agree to receive email updates from Neriah Africa.
        Unsubscribe any time.
      </p>

      {status === 'error' && (
        <p className="text-red-400 text-xs mt-2">Could not subscribe. Try again.</p>
      )}
    </form>
  )
}
