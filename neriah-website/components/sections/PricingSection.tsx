import Link from 'next/link'
import { ScrollReveal } from '@/components/ui/ScrollReveal'

const tiers = [
  {
    name:     'Starter',
    price:    '$29',
    period:   'Up to 5 teachers · 200 students',
    featured: false,
    features: [
      'All three submission channels',
      'AI grading and annotation',
      'Teacher review dashboard',
      'Student grade history',
      'Email support',
    ],
    cta:  'Get started',
    href: '/contact?subject=demo',
  },
  {
    name:     'Growth',
    price:    '$99',
    period:   'Up to 20 teachers · 1,000 students',
    featured: true,
    badge:    'Most popular',
    features: [
      'Everything in Starter',
      'Student analytics dashboard',
      'Bulk submission grading',
      'Automated report card generation',
      'Priority WhatsApp support',
    ],
    cta:  'Get started',
    href: '/contact?subject=demo',
  },
  {
    name:     'Institution',
    price:    '$400',
    period:   'Up to 100 teachers',
    featured: false,
    features: [
      'Everything in Growth',
      'College and university support',
      'Custom curriculum alignment',
      'Dedicated onboarding session',
      'SLA and dedicated support',
    ],
    cta:  'Contact us',
    href: '/contact?subject=demo',
  },
]

export function PricingSection() {
  return (
    <section className="bg-white py-20 px-6" aria-labelledby="pricing-title">
      <div className="section-inner">

        {/* Header */}
        <ScrollReveal direction="up">
          <div>
            <span className="section-tag bg-teal-light text-teal-dark">Pricing</span>
            <h2 className="display-lg text-dark" id="pricing-title">
              One agreement. All teachers covered.
            </h2>
            <p className="text-[17px] text-mid leading-relaxed mt-3 mb-12 max-w-[540px]">
              School institutional licensing — one payment covers every teacher and student in the school.
            </p>
          </div>
        </ScrollReveal>

        {/* Pricing cards — float up with scale, featured card bigger scale */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tiers.map((t, i) => (
            <ScrollReveal
              key={i}
              direction="up"
              delay={i * 150}
              duration={t.featured ? 900 : 700}
              scale={true}
              distance={t.featured ? 50 : 40}
            >
              <div
                className={`rounded-[16px] p-6 md:p-8 relative transition-transform duration-200 hover:-translate-y-1 h-full flex flex-col ${
                  t.featured
                    ? 'bg-teal border-2 border-teal'
                    : 'bg-white border border-black/[0.08]'
                }`}
              >
                {t.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber text-amber-dark text-[11px] font-medium px-4 py-1 rounded-full whitespace-nowrap">
                    {t.badge}
                  </span>
                )}

                <p className={`text-[12px] font-medium uppercase tracking-[0.5px] mb-3 ${t.featured ? 'text-teal-mid' : 'text-mid'}`}>
                  {t.name}
                </p>
                <p className={`font-display text-[40px] font-bold leading-none ${t.featured ? 'text-white' : 'text-dark'}`}>
                  {t.price}
                  <span className={`text-[18px] font-normal ${t.featured ? 'text-teal-mid' : 'text-mid'}`}>/mo</span>
                </p>
                <p className={`text-[14px] mt-1 ${t.featured ? 'text-teal-mid' : 'text-mid'}`}>{t.period}</p>

                <div className={`h-px my-5 ${t.featured ? 'bg-white/15' : 'bg-black/[0.06]'}`} aria-hidden="true" />

                <ul className="flex flex-col gap-2.5 list-none mb-6 flex-1">
                  {t.features.map((f, j) => (
                    <li key={j} className={`text-[14px] flex items-start gap-2 ${t.featured ? 'text-teal-light' : 'text-mid'}`}>
                      <span className={`flex-shrink-0 mt-[3px] w-[14px] h-[14px] rounded-full flex items-center justify-center ${t.featured ? 'bg-white/20' : 'bg-teal-light'}`} aria-hidden="true">
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path d="M1.5 4l1.8 2L6.5 2" stroke={t.featured ? '#E1F5EE' : '#0D7377'} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href={t.href}
                  className={`w-full flex items-center justify-center rounded-lg py-3 text-[14px] font-medium transition-all min-h-[44px] ${
                    t.featured
                      ? 'bg-amber text-amber-dark hover:bg-[#e8960d]'
                      : 'bg-transparent border border-black/[0.1] text-teal hover:bg-teal-light hover:border-teal'
                  }`}
                >
                  {t.cta}
                </Link>
              </div>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal direction="up" delay={300}>
          <p className="text-center text-[13px] text-mid mt-6">
            Individual teachers can also access Neriah at{' '}
            <Link href="/pricing" className="text-teal hover:underline">$5/month per teacher</Link>.
            {' '}Government and NGO bulk contracts available —{' '}
            <Link href="/contact?subject=demo" className="text-teal hover:underline">get in touch</Link>.
          </p>
        </ScrollReveal>

      </div>
    </section>
  )
}
