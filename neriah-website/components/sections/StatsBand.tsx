'use client'
import { useEffect, useRef, useState } from 'react'

type Stat = {
  label: string
  countTo: number | null
  format: ((n: number) => string) | null
  static: string
}

const stats: Stat[] = [
  { label: 'less grading time per assignment',  countTo: 80,  format: n => `${n}%`,        static: '80%'       },
  { label: 'from photo to grade',               countTo: 3,   format: n => `${n} secs`,    static: '3 secs'    },
  { label: 'App, WhatsApp and Email',           countTo: 3,   format: n => `${n} channels`,static: '3 channels'},
  { label: "view of every student's progress",  countTo: 360, format: n => `${n}°`,        static: '360°'      },
]

const DURATION = 1500 // ms

function useCountUp(target: number | null, triggered: boolean) {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!triggered || target === null) return
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) { setValue(target); return }

    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / DURATION, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [triggered, target])

  return value
}

function StatItem({ stat, triggered, index }: { stat: Stat; triggered: boolean; index: number }) {
  const count = useCountUp(stat.countTo, triggered)
  const display = stat.countTo !== null && stat.format !== null
    ? stat.format(count)
    : stat.static

  const delay = index * 150
  const style = triggered
    ? {
        opacity: 1,
        transform: 'none',
        transition: `opacity 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      }
    : { opacity: 0, transform: 'translateY(40px) scale(0.96)' }

  return (
    <div
      className={`px-4 py-4 md:py-0 text-center ${
        index < stats.length - 1 ? 'border-b md:border-b-0 md:border-r border-white/10' : ''
      }`}
      style={style}
    >
      <p className="font-display text-[22px] md:text-[32px] font-bold text-amber leading-none">
        {display}
      </p>
      <p className="text-[12px] text-teal-mid mt-1 leading-snug">{stat.label}</p>
    </div>
  )
}

export function StatsBand() {
  const [triggered, setTriggered] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTriggered(true)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="bg-dark py-7 px-6" aria-label="Key statistics" ref={ref}>
      <div className="section-inner">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
          {stats.map((s, i) => (
            <StatItem key={i} stat={s} triggered={triggered} index={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
