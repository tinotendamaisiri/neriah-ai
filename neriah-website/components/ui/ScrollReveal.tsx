'use client'
import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react'

export type Direction = 'up' | 'down' | 'left' | 'right' | 'fade'

export interface ScrollRevealProps {
  children: ReactNode
  direction?: Direction
  delay?: number    // ms
  duration?: number // ms
  distance?: number // px (halved automatically on mobile < 768px)
  once?: boolean
  scale?: boolean   // adds scale(0.96) → scale(1)
  rotate?: number   // degrees of initial rotation (e.g. 1 for 1deg → 0deg)
  className?: string
}

function buildHiddenTransform(
  direction: Direction,
  distance: number,
  scale: boolean,
  rotate: number,
): string {
  const parts: string[] = []
  switch (direction) {
    case 'up':    parts.push(`translateY(${distance}px)`);  break
    case 'down':  parts.push(`translateY(-${distance}px)`); break
    case 'left':  parts.push(`translateX(-${distance}px)`); break
    case 'right': parts.push(`translateX(${distance}px)`);  break
    case 'fade':  break
  }
  if (scale)        parts.push('scale(0.96)')
  if (rotate !== 0) parts.push(`rotate(${rotate}deg)`)
  return parts.length > 0 ? parts.join(' ') : 'none'
}

export function ScrollReveal({
  children,
  direction = 'up',
  delay = 0,
  duration = 700,
  distance = 40,
  once = true,
  scale = false,
  rotate = 0,
  className = '',
}: ScrollRevealProps) {
  const ref            = useRef<HTMLDivElement>(null)
  const [visible,  setVisible]  = useState(false)
  const [mounted,  setMounted]  = useState(false)
  const effectiveDist  = useRef(distance)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    effectiveDist.current = (!reduced && window.innerWidth < 768)
      ? distance / 2
      : distance

    if (reduced) {
      setMounted(true)
      setVisible(true)
      return
    }

    setMounted(true)

    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          if (once) observer.disconnect()
        } else if (!once) {
          setVisible(false)
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -20px 0px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [distance, once])

  // Before mount: no inline styles — server-rendered content stays visible.
  // After mount: apply hidden state; IntersectionObserver switches to visible.
  let style: CSSProperties = {}

  if (mounted && !visible) {
    style = {
      opacity: 0,
      transform: buildHiddenTransform(direction, effectiveDist.current, scale, rotate),
      willChange: 'opacity, transform',
    }
  } else if (mounted && visible) {
    style = {
      opacity: 1,
      transform: 'none',
      transition: [
        `opacity ${duration}ms cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
        `transform ${duration}ms cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      ].join(', '),
    }
  }

  return (
    <div ref={ref} style={style} className={className}>
      {children}
    </div>
  )
}
