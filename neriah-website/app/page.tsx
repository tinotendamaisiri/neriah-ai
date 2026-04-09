import type { Metadata } from 'next'
import { Navbar }          from '@/components/layout/Navbar'
import { Footer }          from '@/components/layout/Footer'
import { HeroSection }     from '@/components/sections/HeroSection'
import { StatsBand }       from '@/components/sections/StatsBand'
import { ProblemSection }  from '@/components/sections/ProblemSection'
import { HowItWorks }      from '@/components/sections/HowItWorks'
import { ChannelsSection } from '@/components/sections/ChannelsSection'
import { PricingSection }  from '@/components/sections/PricingSection'
import { FoundationSection }from '@/components/sections/FoundationSection'
import { BlogPreview }     from '@/components/sections/BlogPreview'
import { ContactSection }  from '@/components/sections/ContactSection'
import { ScrollProgress }  from '@/components/ui/ScrollProgress'
import { getLatestPosts }  from '@/lib/sanity/queries'

export const metadata: Metadata = {
  title: 'Neriah Africa | AI Homework Marking for African Schools',
  description:
    'Neriah gives African teachers their evenings back. Students submit work via app, WhatsApp, or email. AI marks it. Teacher verifies. School licensing from $29/month.',
  alternates: { canonical: 'https://neriah.ai' },
}

// JSON-LD structured data for Google
function OrganizationSchema() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Neriah Africa',
          url: 'https://neriah.ai',
          logo: 'https://neriah.ai/images/neriah-logo.png',
          description:
            'AI-powered assignment grading platform for African schools. Students submit, AI marks, teachers verify.',
          address: {
            '@type': 'PostalAddress',
            addressLocality: 'Harare',
            addressCountry: 'ZW',
          },
          sameAs: [
            'https://linkedin.com/company/neriah-africa',
            'https://x.com/NeriahAfrica',
            'https://instagram.com/NeriahAfrica',
          ],
        }),
      }}
    />
  )
}

export default async function HomePage() {
  // Fetch latest 3 blog posts from Sanity | falls back to empty array if Sanity not configured
  let posts: Awaited<ReturnType<typeof getLatestPosts>> = []
  try {
    posts = await getLatestPosts(3)
  } catch {
    // Sanity not configured yet | blog preview will show placeholders
  }

  return (
    <>
      <OrganizationSchema />
      <Navbar />
      <main id="main-content">
        <HeroSection />
        <StatsBand />
        <ProblemSection />
        <HowItWorks />
        <ChannelsSection />
        <PricingSection />
        <FoundationSection />
        <BlogPreview posts={posts} />
        <ContactSection />
      </main>
      <Footer />
      <ScrollProgress />
    </>
  )
}
