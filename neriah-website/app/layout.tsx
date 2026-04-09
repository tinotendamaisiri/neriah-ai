import type { Metadata, Viewport } from 'next'
import { Fraunces, DM_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import '@/styles/globals.css'

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://neriah.ai'),
  title: {
    default: 'Neriah Africa | AI Homework Marking for African Schools',
    template: '%s | Neriah Africa',
  },
  description:
    'Neriah gives African teachers their evenings back. Students submit work via app, WhatsApp, or email. AI marks it. Teacher verifies. School licensing from $29/month.',
  keywords: [
    'AI grading tool Africa',
    'homework marking Zimbabwe',
    'EdTech Sub-Saharan Africa',
    'AI assessment African schools',
    'WhatsApp EdTech Africa',
    'school licensing EdTech',
  ],
  authors: [{ name: 'Tinotenda Maisiri', url: 'https://neriah.ai/about' }],
  creator: 'Neriah Africa (Private) Limited',
  publisher: 'Neriah Africa (Private) Limited',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_ZW',
    url: 'https://neriah.ai',
    siteName: 'Neriah Africa',
    title: 'Neriah Africa | AI Built for Africa',
    description: 'Students submit. AI marks. Teachers verify. Built for African schools.',
    images: [
      {
        url: '/images/og-default.png',
        width: 1200,
        height: 630,
        alt: 'Neriah Africa | AI Built for Africa',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@NeriahAfrica',
    creator: '@tinotendamaisiri',
    title: 'Neriah Africa | AI Built for Africa',
    description: 'Students submit. AI marks. Teachers verify.',
    images: ['/images/og-default.png'],
  },
  verification: {
    // Add once verified: google: 'your-google-site-verification-token',
  },
  alternates: {
    canonical: 'https://neriah.ai',
  },
}

export const viewport: Viewport = {
  themeColor: '#0D7377',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable}`}>
      <body className="font-body bg-off-white text-dark antialiased">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
