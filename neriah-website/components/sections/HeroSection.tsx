'use client'
import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect } from 'react'

const animatedPhrases = [
  'Accept submissions from anywhere.',
  'Grade Smarter. Teach Better.',
  'Track every student\'s performance.',
  'Stop marking at midnight. Get started.',
]

type SlotPhase = 'pre-enter' | 'entering' | 'visible' | 'leaving'

function SlotHeadline() {
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [phase, setPhase]             = useState<SlotPhase>('pre-enter')

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    if (phase === 'pre-enter') {
      // One frame at translateY(100%) — then trigger slide-in
      t = setTimeout(() => setPhase('entering'), 20)
    } else if (phase === 'entering') {
      // Slide-in takes 0.9s — then hold
      t = setTimeout(() => setPhase('visible'), 900)
    } else if (phase === 'visible') {
      // Hold 3s — then slide out
      t = setTimeout(() => setPhase('leaving'), 5000)
    } else {
      // Slide-out takes 0.9s — then next phrase
      t = setTimeout(() => {
        setPhraseIndex(i => (i + 1) % animatedPhrases.length)
        setPhase('pre-enter')
      }, 900)
    }
    return () => clearTimeout(t)
  }, [phase])

  const styleMap: Record<SlotPhase, React.CSSProperties> = {
    'pre-enter': { transform: 'translateY(100%)', opacity: 0, transition: 'none' },
    'entering':  { transform: 'translateY(0)',    opacity: 1, transition: 'transform 0.9s ease-out, opacity 0.9s ease-out' },
    'visible':   { transform: 'translateY(0)',    opacity: 1, transition: 'none' },
    'leaving':   { transform: 'translateY(-100%)',opacity: 0, transition: 'transform 0.9s ease-in,  opacity 0.9s ease-in'  },
  }

  return (
    <>
      {/* Static headline */}
      <h1
        className="font-display font-bold text-white leading-[1.15] tracking-[-1px]"
        style={{ fontSize: 'clamp(28px, 5vw, 44px)' }}
      >
        Your AI Teaching Assistant.
      </h1>

      {/* Slot-machine window — overflow hidden masks entering/leaving phrases */}
      <div
        className="mt-2 overflow-hidden flex items-center justify-center"
        style={{ height: '44px' }}
        aria-live="polite"
        aria-atomic="true"
      >
        <span
          className="font-display font-bold leading-[1.15] tracking-[-0.5px] inline-block"
          style={{ fontSize: 'clamp(16px, 3vw, 26px)', color: '#ffffff', ...styleMap[phase] }}
        >
          {animatedPhrases[phraseIndex]}
        </span>
      </div>
    </>
  )
}

export function HeroSection() {
  return (
    <section className="min-h-[620px] relative overflow-hidden flex flex-col" aria-label="Hero">
      {/* Split background images */}
      <div className="absolute inset-0 flex flex-col md:flex-row" aria-hidden="true">
        <div className="relative flex-1">
          <Image src="/images/hero/hero-students.png" alt="" fill className="object-cover object-center" />
          <div className="absolute inset-0" style={{ backgroundColor: '#0D7377', opacity: 0.55 }} />
        </div>
        <div className="relative flex-1">
          <Image src="/images/hero/hero-teacher.jpg.png" alt="" fill className="object-cover object-center" />
          <div className="absolute inset-0" style={{ backgroundColor: '#0D7377', opacity: 0.55 }} />
        </div>
      </div>

      {/* Grid background texture */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          backgroundImage: `
            repeating-linear-gradient(0deg, transparent, transparent 47px, rgba(255,255,255,.04) 48px),
            repeating-linear-gradient(90deg, transparent, transparent 47px, rgba(255,255,255,.04) 48px)
          `,
        }}
      />

      {/* Headline + CTAs */}
      <div className="relative z-10 flex items-end md:items-center justify-center flex-1 text-center px-6 pb-10 pt-16 md:py-16 w-full">
        <div className="max-w-2xl w-full">
          <SlotHeadline />

          <div className="flex gap-3 justify-center flex-wrap mt-6 hero-animate"
            style={{ animationDelay: '0.6s' }}>
            <Link href="/contact" className="btn-primary font-bold" style={{ boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.6)' }}>Get started</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
