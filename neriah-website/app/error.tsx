'use client'
import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to error tracking (add Sentry here when ready)
    console.error(error)
  }, [error])

  return (
    <main className="min-h-screen bg-off-white flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-mid text-sm uppercase tracking-widest mb-4">Something went wrong</p>
        <h1 className="font-display text-3xl font-bold text-dark mb-4">
          We hit an unexpected error.
        </h1>
        <p className="text-mid text-base leading-relaxed mb-10">
          This has been noted. Try refreshing the page, or return to the homepage.
          If it keeps happening, email{' '}
          <a href="mailto:admin@neriah.ai" className="text-teal hover:underline">
            admin@neriah.ai
          </a>
          .
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="bg-teal text-white font-medium px-5 py-2.5 rounded-lg text-sm hover:bg-teal-dark transition-colors min-h-[44px]"
          >
            Try again
          </button>
          <Link
            href="/"
            className="bg-transparent border border-black/10 text-teal font-medium px-5 py-2.5 rounded-lg text-sm hover:bg-teal-light transition-colors min-h-[44px]"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  )
}
