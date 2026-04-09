import type { Metadata } from 'next'
import Link from 'next/link'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { ScrollReveal } from '@/components/ui/ScrollReveal'

export const metadata: Metadata = {
  title: 'Pricing | Neriah Africa School Licensing',
  description: 'School institutional licensing from $29/month. One agreement covers every teacher and student in the school.',
  alternates: { canonical: 'https://neriah.ai/pricing' },
}

export default function PricingPage() {
  return (
    <>
      <Navbar />
      <main id="main-content">
        <section className="bg-teal py-20 px-6" aria-labelledby="pricing-page-title">
          <div className="section-inner">
            <ScrollReveal direction="up" duration={700}>
              <span className="section-tag" style={{background:'rgba(255,255,255,.1)',color:'#9FE1CB'}}>Pricing</span>
              <h1 className="font-display font-bold text-white leading-[1.15] tracking-tight mt-2 mb-5" style={{fontSize:'clamp(32px,5vw,52px)'}} id="pricing-page-title">Simple pricing.<br />One agreement, whole school.</h1>
            </ScrollReveal>
            <ScrollReveal direction="up" delay={120} duration={700}>
              <p className="text-teal-mid text-[17px] max-w-xl">No per-teacher sign-ups. No individual billing. The school pays once and every teacher is covered. All prices in USD to avoid local currency volatility.</p>
            </ScrollReveal>
          </div>
        </section>

        <section className="bg-off-white py-20 px-6">
          <div className="section-inner">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {[
                {name:'Starter',price:'$29',period:'per month',sub:'Up to 5 teachers · 200 students',features:['All three submission channels','AI grading and annotation','Teacher review dashboard','Student grade history','Email support'],cta:'Get started',featured:false},
                {name:'Growth',price:'$99',period:'per month',sub:'Up to 20 teachers · 1,000 students',badge:'Most popular',features:['Everything in Starter','Student analytics dashboard','Bulk submission grading','Automated report card generation','Priority WhatsApp support'],cta:'Get started',featured:true},
                {name:'Institution',price:'$400',period:'per month',sub:'Up to 100 teachers',features:['Everything in Growth','College and university support','Custom curriculum alignment','Dedicated onboarding session','SLA and dedicated support'],cta:'Contact us',featured:false},
              ].map((t,i) => (
                <ScrollReveal key={i} direction="up" delay={i * 150} duration={800} scale>
                <div className={`rounded-[16px] p-8 relative ${t.featured?'bg-teal border-2 border-teal':'bg-white border border-black/[0.08]'}`}>
                  {t.badge && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber text-amber-dark text-[11px] font-medium px-4 py-1 rounded-full whitespace-nowrap">{t.badge}</span>}
                  <p className={`text-[12px] font-medium uppercase tracking-[0.5px] mb-3 ${t.featured?'text-teal-mid':'text-mid'}`}>{t.name}</p>
                  <p className={`font-display text-[44px] font-bold leading-none ${t.featured?'text-white':'text-dark'}`}>{t.price}<span className={`text-[18px] font-normal ${t.featured?'text-teal-mid':'text-mid'}`}>/mo</span></p>
                  <p className={`text-[14px] mt-1 mb-5 ${t.featured?'text-teal-mid':'text-mid'}`}>{t.sub}</p>
                  <div className={`h-px mb-5 ${t.featured?'bg-white/15':'bg-black/[0.06]'}`} aria-hidden="true" />
                  <ul className="flex flex-col gap-2.5 mb-7 list-none">
                    {t.features.map((f,j) => (
                      <li key={j} className={`flex items-start gap-2 text-[14px] ${t.featured?'text-teal-light':'text-mid'}`}>
                        <svg className="flex-shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="6" fill={t.featured?"rgba(255,255,255,.2)":"#E1F5EE"}/><path d="M4.5 7l2 2 3-3" stroke={t.featured?"#E1F5EE":"#0D7377"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link href="/contact?subject=demo" className={`w-full flex items-center justify-center rounded-lg py-3 text-[14px] font-medium min-h-[44px] transition-colors ${t.featured?'bg-amber text-amber-dark hover:bg-[#e8960d]':'bg-transparent border border-black/10 text-teal hover:bg-teal-light'}`}>{t.cta}</Link>
                </div>
                </ScrollReveal>
              ))}
            </div>
            <ScrollReveal direction="up" delay={100} duration={700}>
              <p className="text-center text-[13px] text-mid">
                Individual teachers can also access Neriah at <strong className="text-dark">$5/month per teacher</strong> — ideal for individuals and small schools not yet ready for institutional licensing.
                6-month billing available at a discount.
              </p>
            </ScrollReveal>
          </div>
        </section>

        <section className="bg-white py-20 px-6" aria-labelledby="payment-title">
          <div className="section-inner max-w-2xl">
            <ScrollReveal direction="up" duration={700}>
              <h2 className="display-lg text-dark mb-8" id="payment-title">Payment methods</h2>
            </ScrollReveal>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
              {[{name:'EcoCash',desc:"Zimbabwe's dominant mobile money platform. Most schools pay via EcoCash."},{name:'Innbucks',desc:"Alternative mobile money — accepted for schools without EcoCash accounts."},{name:'Bank transfer',desc:"Direct bank transfer in USD for larger institutional contracts."}].map((m,i) => (
                <ScrollReveal key={i} direction="up" delay={i * 100} duration={700}>
                  <div className="bg-off-white rounded-[14px] p-5">
                    <p className="font-medium text-dark mb-1.5">{m.name}</p>
                    <p className="text-[13px] text-mid leading-relaxed">{m.desc}</p>
                  </div>
                </ScrollReveal>
              ))}
            </div>
            <ScrollReveal direction="up" delay={100} duration={700}>
              <p className="text-[15px] text-mid leading-relaxed">All licences are billed monthly or on a 6-month cycle. A 7-day grace period applies after each billing date. Cancel any time with 30 days written notice.</p>
            </ScrollReveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}