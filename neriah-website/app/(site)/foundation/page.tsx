import type { Metadata } from 'next'
import Link from 'next/link'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { getLatestFoundationStats } from '@/lib/sanity/queries'
import { ScrollReveal } from '@/components/ui/ScrollReveal'

export const metadata: Metadata = {
  title: 'Neriah Foundation | Free Exercise Books for African Students',
  description: 'The Neriah Foundation gives free exercise books to students in exchange for completed ones. The handwriting data improves the Neriah AI Engine.',
  alternates: { canonical: 'https://neriah.ai/foundation' },
}

export const revalidate = 3600

export default async function FoundationPage() {
  let stats = { booksCollected: 0, schoolsReached: 0, studentsServed: 0, pagesLabelled: 0 }
  try { stats = await getLatestFoundationStats() } catch {}

  return (
    <>
      <Navbar />
      <main id="main-content">
        <section className="bg-teal py-20 px-6" aria-labelledby="foundation-title">
          <div className="section-inner">
            <ScrollReveal direction="up" duration={700}>
              <span className="section-tag" style={{background:'rgba(255,255,255,.1)',color:'#9FE1CB'}}>Neriah Foundation</span>
              <h1 className="font-display font-bold text-white leading-[1.15] tracking-tight mt-2 mb-5" style={{fontSize:'clamp(32px,5vw,52px)'}} id="foundation-title">Free exercise books.<br />A dataset no one can buy.</h1>
            </ScrollReveal>
            <ScrollReveal direction="up" delay={120} duration={700}>
              <p className="text-teal-mid text-[17px] max-w-xl">The Foundation is our NGO arm. It gives free exercise books to students across Zimbabwe — and builds the African handwriting dataset that makes the Neriah AI Engine better every month.</p>
            </ScrollReveal>
          </div>
        </section>

        <section className="bg-dark py-12 px-6" aria-label="Foundation impact statistics">
          <div className="section-inner">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
              {[
                {num: stats.booksCollected.toLocaleString(), label:'books collected'},
                {num: stats.schoolsReached.toLocaleString(), label:'schools reached'},
                {num: stats.studentsServed.toLocaleString(), label:'students served'},
                {num: stats.pagesLabelled.toLocaleString(), label:'pages labelled'},
              ].map((s,i) => (
                <ScrollReveal key={i} direction="up" delay={i * 100} duration={700}>
                  <div className={`px-6 py-4 text-center ${i<3?'border-r border-white/10':''}`}>
                    <p className="font-display text-[32px] font-bold text-amber leading-none">{s.num}</p>
                    <p className="text-[12px] text-teal-mid mt-1">{s.label}</p>
                  </div>
                </ScrollReveal>
              ))}
            </div>
            <ScrollReveal direction="up" delay={200} duration={700}>
              <p className="text-center text-[12px] text-teal-mid/60 mt-4">Updated monthly by Kundai from the ground</p>
            </ScrollReveal>
          </div>
        </section>

        <section className="bg-off-white py-20 px-6" aria-labelledby="exchange-title">
          <div className="section-inner">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
              <ScrollReveal direction="left" duration={800}>
                <div>
                  <h2 className="display-lg text-dark mb-8" id="exchange-title">How the exchange works</h2>
                  <div className="flex flex-col gap-0">
                    {[
                      {num:'1',title:'Student brings in a completed book',desc:'When their exercise book is full, the student brings it to a Foundation collection point at their school — usually during school hours with Kundai or a teacher present.'},
                      {num:'2',title:'Student receives a brand new one',desc:'A new Neriah-branded exercise book, free of charge. No conditions. No registration. The student keeps learning without interruption.'},
                      {num:'3',title:'The book trains our AI',desc:'Real Zimbabwean student handwriting — anonymised and labelled by our team — is fed into the Neriah AI Engine. Every book makes the OCR more accurate for every student that follows.'},
                    ].map((s,i) => (
                      <div key={i} className={`flex gap-4 py-6 ${i<2?'border-b border-black/[0.06]':''}`}>
                        <div className="w-9 h-9 bg-teal rounded-full flex items-center justify-center font-display text-base font-bold text-white flex-shrink-0">{s.num}</div>
                        <div>
                          <p className="font-medium text-dark mb-1.5">{s.title}</p>
                          <p className="text-[14px] text-mid leading-relaxed">{s.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </ScrollReveal>
              <ScrollReveal direction="right" delay={150} duration={800}>
                <div className="bg-teal rounded-[20px] p-10">
                  <h3 className="font-display text-[22px] font-bold text-white mb-3">Why this matters</h3>
                  <p className="text-teal-mid text-[15px] leading-relaxed mb-6">Every major AI company needs diverse, labelled voice and handwriting data to build models that work for African languages and scripts. That data does not exist at scale — yet. The Foundation is building it, one exercise book at a time.</p>
                  <p className="text-teal-mid text-[15px] leading-relaxed">The handwriting dataset we collect is a structural competitive moat. It cannot be downloaded. It cannot be scraped. It can only be built by being present in African schools — which is exactly where we are.</p>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </section>

        <section className="bg-white py-20 px-6" aria-labelledby="partner-title">
          <div className="section-inner max-w-2xl">
            <ScrollReveal direction="up" duration={700}>
              <h2 className="display-lg text-dark mb-6" id="partner-title">Partner with the Foundation</h2>
              <p className="text-[17px] text-mid leading-relaxed mb-10">We are looking for school principals, publishers, NGOs, and donors who want to support the Foundation. Whether you want to host a collection point, co-brand exercise books, or fund the programme in a specific district — get in touch.</p>
              <Link href="/contact?subject=demo" className="btn-teal">Get in touch →</Link>
            </ScrollReveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}