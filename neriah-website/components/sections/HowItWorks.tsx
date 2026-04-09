import { ScrollReveal } from '@/components/ui/ScrollReveal'

const steps = [
  {
    num:   '01',
    title: 'Student submits',
    desc:  'The student photographs their handwritten homework and sends it via the Neriah app, WhatsApp, or email — whichever works for them. A family phone is enough. No broadband needed.',
    accent: 'bg-teal',
  },
  {
    num:   '02',
    title: 'Neriah marks it',
    desc:  "The Neriah AI Engine reads the handwriting, grades each answer against the teacher's rubric, and generates an annotated image showing ticks, crosses, and the suggested score. Done in seconds.",
    accent: 'bg-teal-dark',
  },
  {
    num:   '03',
    title: 'Teacher verifies',
    desc:  "The teacher opens their dashboard and sees the pre-marked work. They approve the AI grade or override it if needed. Every grade is a teacher decision — the AI just does the reading.",
    accent: 'bg-amber',
  },
]

const DIRECTIONS = ['left', 'right', 'left'] as const

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-off-white py-20 px-6" aria-labelledby="steps-title">
      <div className="section-inner">

        {/* Header */}
        <ScrollReveal direction="up">
          <div>
            <span className="section-tag bg-teal-light text-teal-dark">How it works</span>
            <h2 className="display-lg text-dark" id="steps-title">Three steps. That is all.</h2>
            <p className="text-[17px] text-mid leading-relaxed mt-3 mb-12 max-w-[540px]">
              No new devices. No training days. Works on the phone every teacher already has.
            </p>
          </div>
        </ScrollReveal>

        {/* Steps grid — alternating left/right per card */}
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-[2px] bg-black/[0.06] rounded-[16px] overflow-hidden"
          role="list"
        >
          {steps.map((s, i) => (
            <ScrollReveal
              key={i}
              direction={DIRECTIONS[i]}
              delay={i * 200}
              duration={800}
              className="bg-white"
            >
              <div className="p-6 md:p-8 relative h-full" role="listitem">
                <div className={`absolute top-0 left-0 right-0 h-[3px] ${s.accent}`} aria-hidden="true" />
                <p className="font-display text-[48px] font-bold text-teal-light leading-none mb-3" aria-hidden="true">
                  {s.num}
                </p>
                <h3 className="font-display text-[20px] font-bold text-dark mb-2">{s.title}</h3>
                <p className="text-[14px] text-mid leading-relaxed">{s.desc}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>

        {/* Analytics unlock row */}
        <ScrollReveal direction="up" delay={200} duration={800}>
          <div className="mt-8 bg-teal-light border border-teal/15 rounded-[14px] px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <p className="font-display text-[28px] md:text-[36px] font-bold text-teal flex-shrink-0">10+</p>
            <div>
              <p className="font-medium text-dark mb-1">Student analytics unlock automatically</p>
              <p className="text-[14px] text-mid leading-relaxed">
                After 10 graded submissions per student, Neriah surfaces weak topics, strengths,
                and AI-generated study recommendations — directly in the teacher&apos;s dashboard.
              </p>
            </div>
          </div>
        </ScrollReveal>

      </div>
    </section>
  )
}
