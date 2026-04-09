import type { Metadata } from 'next'
import Link from 'next/link'
import { Navbar }  from '@/components/layout/Navbar'
import { Footer }  from '@/components/layout/Footer'
import { ScrollReveal } from '@/components/ui/ScrollReveal'
import { SoftwareApplicationJsonLd, ProductFaqJsonLd } from '@/components/seo/JsonLd'
import { EngineDiagram } from '@/components/ui/EngineDiagram'

export const metadata: Metadata = {
  title: 'How Neriah Works | AI Assignment Grading for Schools',
  description: 'Students submit handwritten work via app, WhatsApp, or email. Neriah AI marks it in seconds. Teachers review, approve, and move on.',
  alternates: { canonical: 'https://neriah.ai/product' },
}

const workflow = [
  { step:'01', title:'Teacher sets up their class', desc:'One-time setup per term. The teacher creates a class, adds students by typing the register or photographing the register page, and selects the education level. Our ground team assists with the first session — under 20 minutes total.', detail:'Supported: Grade 1–7, Form 1–6, Tertiary.' },
  { step:'02', title:'Teacher uploads the answer key', desc:'The teacher photographs the question paper and correct answers. Neriah OCRs and stores this as the grading reference. No answer key? Neriah generates a marking scheme from the question paper alone — teacher reviews and approves before grading begins.', detail:'AI-generated schemes require teacher approval before use.' },
  { step:'03', title:'Student submits their work', desc:'The student photographs their handwritten homework and sends it via the Neriah app, WhatsApp, or email. No broadband required. A shared family phone is enough.', detail:'Three channels: App (offline-capable), WhatsApp, Email.' },
  { step:'04', title:'Neriah AI Engine grades it', desc:'The engine reads the handwriting, compares each answer against the marking scheme calibrated to the selected education level. A Grade 3 composition is not evaluated with the same rigour as a Form 4 essay.', detail:'Results returned in approximately 8 seconds.' },
  { step:'05', title:'Teacher receives an annotated result', desc:'The teacher sees the original photo alongside an annotated version showing ticks, crosses, and the AI-suggested score. The teacher approves or overrides in one tap. Every final grade is a teacher decision.', detail:'Low-confidence submissions are flagged and require full review.' },
  { step:'06', title:'Analytics unlock after 10 submissions', desc:'Once a student has 10 graded submissions, Neriah surfaces weak topics, strong topics, score trend, and three personalised study recommendations. Class-level summaries are available on demand.', detail:'Analytics update automatically — no configuration needed.' },
]

const faq = [
  { q:'Is student data safe?', a:'All data is stored on encrypted cloud infrastructure. Raw submission images are deleted after 90 days. Grade records are retained for the licence period plus one year. Neriah complies with Zimbabwe\'s Data Protection Act (2021). We never sell student data.' },
  { q:'What if the AI grade is wrong?', a:'Every AI grade is a suggestion. The teacher reviews and approves every grade before it is treated as final. Teachers can override any grade with one tap and an optional comment.' },
  { q:'Does it work without internet?', a:'The Neriah app has an offline mode. Students can photograph their work without data, and submissions queue until connectivity is restored.' },
  { q:'What subjects does it cover?', a:'Any subject with written answers — Maths, English, Science, History, Geography, Shona, and more. Multiple choice, short answer, and essay questions are all supported.' },
  { q:'How accurate is the OCR?', a:'Our target benchmark is 85%+ field-level accuracy on Zimbabwean secondary school exercise books under normal lighting. Low-confidence results are flagged for mandatory teacher review rather than auto-approved.' },
  { q:'How long does school onboarding take?', a:'Under 20 minutes for the first teacher session. Our ground team visits the school, demonstrates the app, sets up the first class and rubric, and runs a test marking session.' },
  { q:'Does it support tertiary institutions?', a:'Yes. The Institution licence ($199/month) is designed for colleges, polytechnics, and universities still on paper-based workflows.' },
  { q:'How is it different from ChatGPT or Google Classroom?', a:'ChatGPT has no structured marking workflow, no curriculum alignment, and no student record-keeping. Google Classroom requires students to have personal devices and reliable internet — neither holds in most Zimbabwean schools.' },
]

export default function ProductPage() {
  return (
    <>
      <SoftwareApplicationJsonLd />
      <ProductFaqJsonLd />
      <Navbar />
      <main id="main-content">
        <section className="bg-teal py-20 px-6" aria-labelledby="product-title">
          <div className="section-inner">
            <div className="flex flex-col md:flex-row items-center gap-12">
              {/* Left column — text content */}
              <div className="flex-1">
                <ScrollReveal direction="up" duration={700}>
                  <span className="section-tag" style={{background:'rgba(255,255,255,.1)',color:'#9FE1CB'}}>The product</span>
                  <h1 className="font-display font-bold text-white leading-[1.15] tracking-tight mt-2 mb-5" style={{fontSize:'clamp(32px,5vw,52px)'}} id="product-title">How Neriah works</h1>
                </ScrollReveal>
                <ScrollReveal direction="up" delay={120} duration={700}>
                  <p className="text-teal-mid text-[17px] leading-relaxed mb-8">Six steps from submission to verified grade. Built for handwritten work, African curricula, and teachers who have been buried under exercise books for too long.</p>
                  <Link href="/contact" className="btn-primary">Get started</Link>
                </ScrollReveal>
              </div>
              {/* Right column — engine diagram */}
              <div className="flex-1 flex justify-center">
                <ScrollReveal direction="up" delay={200} duration={700}>
                  <div className="overflow-x-auto" style={{background:'#fff',borderRadius:'16px',padding:'32px'}}>
                    <EngineDiagram light />
                  </div>
                </ScrollReveal>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-off-white py-20 px-6" aria-labelledby="workflow-title">
          <div className="section-inner">
            <ScrollReveal direction="up" duration={700}>
              <h2 className="display-lg text-dark mb-14" id="workflow-title">The full workflow</h2>
            </ScrollReveal>
            <div className="flex flex-col gap-0">
              {workflow.map((w,i) => (
                <ScrollReveal key={i} direction="up" delay={i * 80} duration={700}>
                <div className={`grid grid-cols-1 md:grid-cols-[80px_1fr] gap-6 py-10 ${i<workflow.length-1?'border-b border-black/[0.06]':''}`}>
                  <div className="font-display text-[48px] font-bold text-teal-light leading-none" aria-hidden="true">{w.step}</div>
                  <div>
                    <h3 className="font-display text-[22px] font-bold text-dark mb-3">{w.title}</h3>
                    <p className="text-[16px] text-dark/80 leading-relaxed mb-3">{w.desc}</p>
                    <p className="text-[13px] text-mid italic">{w.detail}</p>
                  </div>
                </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        <section id="channels" className="bg-white py-20 px-6" aria-labelledby="channels-title">
          <div className="section-inner">
            <ScrollReveal direction="up" duration={700}>
              <span className="section-tag bg-teal-light text-teal-dark">Submission channels</span>
              <h2 className="display-lg text-dark mb-4" id="channels-title">Three channels. One pipeline.</h2>
              <p className="text-[17px] text-mid max-w-xl mb-14">Every channel routes to the same AI Engine. Teachers see all submissions in one dashboard.</p>
            </ScrollReveal>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {name:'App',colour:'bg-amber',best:'Best experience',points:['Real-time photo guidance','Offline queue — syncs automatically','Bulk submission mode','Full teacher dashboard','Student analytics']},
                {name:'WhatsApp',colour:'bg-[#25D366]',best:'Lowest friction',points:['Photo to school\'s Neriah number','Works on any WhatsApp device','Results return to same thread','Teacher commands: RESULTS, APPROVE','85%+ urban penetration in Zimbabwe']},
                {name:'Email',colour:'bg-teal-light',best:'No app required',points:['Photo emailed to school address','Works on any device with email','No student setup required','Result emailed back automatically','Identified by sender address']},
              ].map((ch,i) => (
                <ScrollReveal key={i} direction="up" delay={i * 120} duration={800}>
                <div className="border border-black/[0.08] rounded-[16px] overflow-hidden">
                  <div className={`${ch.colour} px-6 py-4 flex items-center justify-between`}>
                    <span className="font-display text-[20px] font-bold text-dark">{ch.name}</span>
                    <span className="text-xs font-medium bg-white/30 px-3 py-1 rounded-full text-dark">{ch.best}</span>
                  </div>
                  <ul className="p-6 space-y-3 list-none">
                    {ch.points.map((p,j) => (
                      <li key={j} className="flex items-start gap-2.5 text-[14px] text-mid">
                        <svg className="flex-shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="#E1F5EE"/><path d="M4.5 7l2 2 3-3" stroke="#0D7377" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        <section id="analytics" className="bg-dark py-20 px-6" aria-labelledby="analytics-title">
          <div className="section-inner">
            <ScrollReveal direction="up" duration={700}>
              <span className="section-tag" style={{background:'rgba(255,255,255,.1)',color:'#9FE1CB'}}>Student analytics</span>
              <h2 className="display-lg text-white mb-6" id="analytics-title">After 10 submissions, the picture gets clearer.</h2>
              <p className="text-teal-mid text-[17px] max-w-xl mb-14">Analytics unlock automatically once a student reaches 10 graded submissions.</p>
            </ScrollReveal>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[{label:'Weak topics',desc:'Areas where the student consistently loses marks, identified across all submissions.'},{label:'Strong topics',desc:'Concepts the student has mastered, useful for acceleration and confidence-building.'},{label:'Score trend',desc:'Improving, plateauing, or declining — visualised across all graded submissions.'},{label:'Study recommendations',desc:'Three specific, curriculum-aligned study actions generated for each student.'}].map((a,i) => (
                <ScrollReveal key={i} direction="up" delay={i * 100} duration={800}>
                  <div className="bg-white/[0.08] border border-white/12 rounded-[14px] p-6">
                    <h3 className="font-display text-[18px] font-bold text-white mb-3">{a.label}</h3>
                    <p className="text-[14px] text-teal-mid leading-relaxed">{a.desc}</p>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="bg-white py-20 px-6" aria-labelledby="faq-title">
          <div className="section-inner">
            <ScrollReveal direction="up" duration={700}>
              <h2 className="display-lg text-dark mb-14" id="faq-title">Frequently asked questions</h2>
            </ScrollReveal>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-10 max-w-4xl">
              {faq.map((item,i) => (
                <ScrollReveal key={i} direction="up" delay={i * 60} duration={700}>
                  <div>
                    <h3 className="font-display text-[18px] font-bold text-dark mb-3">{item.q}</h3>
                    <p className="text-[15px] text-mid leading-relaxed">{item.a}</p>
                  </div>
                </ScrollReveal>
              ))}
            </div>
            <div className="mt-14 border-t border-black/[0.06] pt-10 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <p className="text-[15px] text-mid">Still have questions?</p>
              <Link href="/contact?subject=demo" className="btn-teal text-sm">Contact Kundai →</Link>
            </div>
          </div>
        </section>

        <section className="bg-off-white py-20 px-6" aria-labelledby="company-title">
          <div className="section-inner max-w-2xl">
            <ScrollReveal direction="up" duration={700}>
              <h2 className="display-lg text-dark mb-8" id="company-title">The company</h2>
              <p className="text-[17px] text-dark/80 leading-[1.8] mb-6">Neriah Africa (Private) Limited was incorporated in Zimbabwe. Neriah Education is the first product — an AI-powered assignment grading platform for African schools. Education is where we started, but it is not the limit of what we are building. The same AI infrastructure that grades exercise books can read insurance claim forms, digitise medical records, and process paper-based workflows across every sector that Africa still runs on paper.</p>
              <p className="text-[17px] text-dark/80 leading-[1.8] mb-10">We are building AI infrastructure for Africa. Education is the first application. The foundation data collected through the Neriah Foundation exercise book exchange — real African handwriting, labelled and anonymised — is the asset that makes everything else possible.</p>
              <Link href="/contact?subject=demo" className="btn-teal">Work with us →</Link>
            </ScrollReveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
