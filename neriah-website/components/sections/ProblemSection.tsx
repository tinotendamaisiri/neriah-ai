import { ScrollReveal } from '@/components/ui/ScrollReveal'

const cards = [
  { num: '50',     label: 'average students per class in Zimbabwe',                  urgent: false },
  { num: '12+ hrs',label: 'unpaid marking labour per teacher per week',              urgent: false },
  { num: '25,000+',label: 'teacher shortage in Zimbabwe right now',                  urgent: true  },
  { num: '0',      label: 'AI marking tools built for African curricula — until now', urgent: false },
]

export function ProblemSection() {
  return (
    <section className="bg-white py-20 px-6" aria-labelledby="problem-title">
      <div className="section-inner">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 items-center">

          {/* Left — text slides in from left */}
          <ScrollReveal direction="left" duration={800}>
            <div>
              <span className="section-tag bg-teal-light text-teal-dark">The problem</span>
              <h2 className="display-lg text-dark mt-0" id="problem-title">
                136,000 teachers.<br />Every evening. Unpaid.
              </h2>
              <p className="text-[17px] text-mid leading-relaxed mt-4 mb-8 max-w-[520px]">
                A teacher with 50 students marks homework for 2–3 hours every single evening.
                That is 12+ hours of unpaid labour per week. No digital record. No feedback until the next day.
                No time to prepare lessons, develop professionally, or rest.
              </p>
              <blockquote className="bg-teal rounded-[14px] p-6 text-white font-display text-[18px] italic leading-relaxed relative">
                <span className="absolute top-4 left-5 text-[64px] leading-none text-white/20 font-display select-none" aria-hidden="true">&ldquo;</span>
                It is not that they don&apos;t care. It is that they are buried.
                <cite className="block mt-3 text-[13px] text-white/60 not-italic font-body">
                  — Neriah, on why this product exists
                </cite>
              </blockquote>
            </div>
          </ScrollReveal>

          {/* Right — stat cards slide in from right */}
          <ScrollReveal direction="right" duration={800} delay={100}>
            <div className="flex flex-col gap-4">
              {cards.map((c, i) => (
                <div
                  key={i}
                  className="rounded-[14px] px-6 py-5 border-l-4 bg-off-white border border-black/[0.06]"
                  style={{ borderLeftColor: c.urgent ? '#e24b4a' : 'var(--teal)' }}
                >
                  <p
                    className="font-display text-[28px] md:text-[36px] font-bold leading-none"
                    style={{ color: c.urgent ? '#e24b4a' : 'var(--teal)' }}
                  >
                    {c.num}
                  </p>
                  <p className="text-[13px] text-mid mt-1">{c.label}</p>
                </div>
              ))}
            </div>
          </ScrollReveal>

        </div>
      </div>
    </section>
  )
}
