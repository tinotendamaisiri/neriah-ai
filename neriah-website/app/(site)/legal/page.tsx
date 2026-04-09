import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { LegalContent } from './LegalContent'

export const metadata: Metadata = {
  title: 'Privacy Policy & Terms of Service | Neriah',
  description:
    "Read Neriah's privacy policy, terms of service, and account deletion policy. Learn how we protect teacher and student data across our AI marking platform.",
  alternates: {
    canonical: 'https://neriah.ai/legal',
  },
  robots: { index: true, follow: true },
}

export default function LegalPage() {
  return (
    <>
      <Navbar />
      <Suspense>
        <LegalContent />
      </Suspense>
      <Footer />
    </>
  )
}
