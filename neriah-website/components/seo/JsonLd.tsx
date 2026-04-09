const SITE = 'https://neriah.ai'

export function SoftwareApplicationJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Neriah',
    applicationCategory: 'EducationApplication',
    operatingSystem: 'Web, Android, iOS',
    description:
      'AI-powered assignment grading platform for African schools. Students submit handwritten work via app, WhatsApp, or email. Neriah AI marks it in seconds. Teachers review and approve.',
    url: SITE,
    offers: {
      '@type': 'Offer',
      price: '29',
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '29',
        priceCurrency: 'USD',
        unitText: 'MONTH',
      },
    },
    provider: {
      '@type': 'Organization',
      name: 'Neriah Africa',
      url: SITE,
    },
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

const FAQ_ITEMS = [
  {
    q: 'Is student data safe?',
    a: "All data is stored on encrypted cloud infrastructure. Raw submission images are deleted after 90 days. Grade records are retained for the licence period plus one year. Neriah complies with Zimbabwe's Data Protection Act (2021). We never sell student data.",
  },
  {
    q: 'What if the AI grade is wrong?',
    a: 'Every AI grade is a suggestion. The teacher reviews and approves every grade before it is treated as final. Teachers can override any grade with one tap and an optional comment.',
  },
  {
    q: 'Does it work without internet?',
    a: 'The Neriah app has an offline mode. Students can photograph their work without data, and submissions queue until connectivity is restored.',
  },
  {
    q: 'What subjects does it cover?',
    a: 'Any subject with written answers — Maths, English, Science, History, Geography, Shona, and more. Multiple choice, short answer, and essay questions are all supported.',
  },
  {
    q: 'How accurate is the OCR?',
    a: 'Our target benchmark is 85%+ field-level accuracy on Zimbabwean secondary school exercise books under normal lighting. Low-confidence results are flagged for mandatory teacher review rather than auto-approved.',
  },
  {
    q: 'How long does school onboarding take?',
    a: 'Under 20 minutes for the first teacher session. Our ground team visits the school, demonstrates the app, sets up the first class and rubric, and runs a test marking session.',
  },
  {
    q: 'Does it support tertiary institutions?',
    a: 'Yes. The Institution licence ($199/month) is designed for colleges, polytechnics, and universities still on paper-based workflows.',
  },
  {
    q: 'How is it different from ChatGPT or Google Classroom?',
    a: 'ChatGPT has no structured marking workflow, no curriculum alignment, and no student record-keeping. Google Classroom requires students to have personal devices and reliable internet — neither holds in most Zimbabwean schools.',
  },
]

export function ProductFaqJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

interface BlogPostJsonLdProps {
  title: string
  description?: string
  slug: string
  publishedAt?: string
  authorName?: string
  imageUrl?: string
}

export function BlogPostJsonLd({
  title,
  description,
  slug,
  publishedAt,
  authorName,
  imageUrl,
}: BlogPostJsonLdProps) {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    url: `${SITE}/blog/${slug}`,
    publisher: {
      '@type': 'Organization',
      name: 'Neriah Africa',
      url: SITE,
    },
  }
  if (description)  data.description   = description
  if (publishedAt)  data.datePublished  = publishedAt
  if (authorName)   data.author         = { '@type': 'Person', name: authorName }
  if (imageUrl)     data.image          = imageUrl

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

interface BreadcrumbItem {
  name: string
  url: string
}

export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
