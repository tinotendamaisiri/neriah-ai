'use client'
import { useEffect, useState } from 'react'

export function ScrollProgress() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const update = () => {
      const { scrollY } = window
      const maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight
      setProgress(maxScroll > 0 ? scrollY / maxScroll : 0)
    }
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  return (
    <div
      aria-hidden="true"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 200 }}
    >
      <div
        style={{
          height: '100%',
          width: '100%',
          background: '#0D7377',
          transform: `scaleX(${progress})`,
          transformOrigin: 'left',
          transition: 'transform 80ms linear',
        }}
      />
    </div>
  )
}
