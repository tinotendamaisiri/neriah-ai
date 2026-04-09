import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Page not found | Neriah Africa',
}

export default function NotFound() {
  return (
    <main className="min-h-screen bg-teal flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        {/* Logo mark */}
        <div className="w-14 h-14 bg-white/10 border border-white/20 rounded-2xl flex items-center justify-center mx-auto mb-8">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect x="3" y="8" width="22" height="16" rx="3" stroke="white" strokeWidth="1.5" fill="none"/>
            <rect x="8" y="3" width="12" height="8" rx="2" stroke="white" strokeWidth="1.5" fill="none"/>
            <line x1="14" y1="10" x2="14" y2="20" stroke="white" strokeWidth="1.5"/>
            <line x1="9" y1="15" x2="19" y2="15" stroke="white" strokeWidth="1.5"/>
          </svg>
        </div>

        <p className="text-teal-mid text-sm font-medium uppercase tracking-widest mb-4">404</p>

        <h1 className="font-display text-3xl font-bold text-white mb-4 leading-tight">
          This page doesn&apos;t exist.
        </h1>

        <p className="text-teal-mid text-base leading-relaxed mb-10">
          The link you followed may be broken, or the page may have moved.
          Head back to the homepage | everything you need is there.
        </p>

        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-amber text-amber-dark font-medium px-6 py-3 rounded-lg text-sm hover:bg-[#e8960d] transition-colors min-h-[44px]"
        >
          ← Back to neriah.ai
        </Link>
      </div>
    </main>
  )
}
