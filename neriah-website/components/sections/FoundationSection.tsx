import Link from 'next/link'
import { ScrollReveal } from '@/components/ui/ScrollReveal'

const steps = [
  {
    num:   '1',
    title: 'Student brings in a completed book',
    desc:  'When their exercise book is full, the student brings it to a Foundation collection point at their school.',
  },
  {
    num:   '2',
    title: 'Student receives a brand new one',
    desc:  'A new Neriah-branded exercise book, free of charge. No conditions. The student keeps learning.',
  },
  {
    num:   '3',
    title: 'The completed book trains our AI',
    desc:  'Real African student handwriting — anonymised and labelled — fed into the Neriah AI Engine to improve accuracy for every student that follows.',
  },
]

const impactStats = [
  { num: '0', label: 'books collected'   },
  { num: '0', label: 'schools reached'   },
  { num: '0', label: 'students served'   },
  { num: '0', label: 'pages labelled'    },
]

export function FoundationSection() {
  return (
    <section className="bg-off-white py-20 px-6" aria-labelledby="foundation-title">
      <div className="section-inner">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 items-center">

          {/* Left — slow warm fade from left */}
          <ScrollReveal direction="left" duration={1200} distance={30}>
            <div>
              <span className="section-tag bg-teal-light text-teal-dark">Neriah Foundation</span>
              <h2 className="display-lg text-dark" id="foundation-title">
                Free exercise books.<br />A moat no one can copy.
              </h2>
              <p className="text-[17px] text-mid leading-relaxed mt-4 mb-8">
                The Neriah Foundation is our NGO arm. It gives free exercise books to students
                across Zimbabwe — and builds the African handwriting dataset that makes our AI
                better every month. A social mission and a competitive moat, inseparable.
              </p>

              <div className="flex flex-col gap-0" role="list">
                {steps.map((s, i) => (
                  <div
                    key={i}
                    className={`flex gap-4 py-5 ${i < steps.length - 1 ? 'border-b border-black/[0.06]' : ''}`}
                    role="listitem"
                  >
                    <div className="w-9 h-9 bg-teal rounded-full flex items-center justify-center font-display text-base font-bold text-white flex-shrink-0">
                      {s.num}
                    </div>
                    <div>
                      <p className="font-medium text-dark mb-1">{s.title}</p>
                      <p className="text-[14px] text-mid leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ScrollReveal>

          {/* Right — slow warm fade from right */}
          <ScrollReveal direction="right" duration={1200} distance={30} delay={150}>
            <div className="bg-teal rounded-[20px] p-6 md:p-9 text-center">
              <h3 className="font-display text-[22px] font-bold text-white mb-2">Foundation Impact</h3>
              <p className="text-[14px] text-teal-mid mb-7">Updated monthly by Kundai from the ground</p>

              <div className="grid grid-cols-2 gap-3 mb-5">
                {impactStats.map((s, i) => (
                  <div key={i} className="bg-white/10 rounded-[10px] py-4 px-2">
                    <p className="font-display text-[28px] font-bold text-amber">{s.num}</p>
                    <p className="text-[11px] text-teal-mid mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              <Link
                href="/foundation"
                className="w-full flex items-center justify-center bg-amber text-amber-dark font-medium rounded-lg py-3 text-[14px] hover:bg-[#e8960d] transition-colors min-h-[44px]"
              >
                Learn about the Foundation
              </Link>
            </div>
          </ScrollReveal>

        </div>
      </div>
    </section>
  )
}
