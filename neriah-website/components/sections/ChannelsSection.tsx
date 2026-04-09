import { ScrollReveal } from '@/components/ui/ScrollReveal'

const channels = [
  {
    title: 'Email',
    desc:  "Students email a photo of their work to their school's dedicated Neriah address. Works on any device. No app download required. No data bundle beyond sending one email.",
    badge: 'No app required',
    iconBg: 'bg-teal-light',
    direction: 'left' as const,
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <rect x="2" y="4" width="18" height="14" rx="2.5" stroke="#085041" strokeWidth="1.5"/>
        <path d="M2 7l9 6 9-6" stroke="#085041" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    title: 'WhatsApp',
    desc:  "The most natural channel in Africa. Students send their photo to the school's Neriah WhatsApp number. Graded feedback returns to the same thread. 85%+ urban penetration — they already use it daily.",
    badge: 'Works on any data',
    iconBg: 'bg-[#25D366]',
    direction: 'up' as const,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path fill="white" d="M12 2C6.48 2 2 6.48 2 12c0 1.78.48 3.45 1.32 4.89L2 22l5.26-1.3A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm.02 15.98a8.02 8.02 0 01-3.94-1.04l-.28-.17-2.9.73.75-2.78-.18-.29A8 8 0 014 12c0-4.42 3.6-8 8.02-8C16.42 4 20 7.58 20 12c0 4.42-3.58 8-7.98 8z"/>
        <path fill="white" d="M16.01 14.3c-.24-.12-1.4-.69-1.62-.77-.21-.08-.37-.12-.52.12-.15.24-.59.77-.73.93-.14.16-.27.18-.51.06-.24-.12-1-.37-1.9-1.18-.7-.62-1.17-1.4-1.31-1.64-.14-.24-.01-.36.1-.48.1-.11.24-.27.36-.4.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.52-1.25-.71-1.73-.18-.45-.37-.38-.52-.38h-.45c-.16 0-.4.06-.62.3-.21.24-.82.8-.82 1.96s.84 2.27.96 2.43c.12.16 1.66 2.54 4.02 3.55.56.24 1 .39 1.34.5.56.18 1.07.15 1.48.09.45-.07 1.38-.56 1.58-1.11.2-.55.2-1.01.14-1.11-.06-.1-.22-.16-.46-.28z"/>
      </svg>
    ),
  },
  {
    title: 'Neriah app',
    desc:  'The primary channel. Real-time photo guidance helps students capture a clean image before submitting. Offline queue stores submissions when data is unavailable and syncs automatically when connected.',
    badge: 'Offline capable',
    iconBg: 'bg-amber',
    direction: 'right' as const,
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <rect x="5" y="2" width="12" height="18" rx="2.5" fill="#412402"/>
        <rect x="8" y="5" width="6" height="1.5" rx=".75" fill="#F5A623"/>
        <rect x="8" y="8" width="4.5" height="1.5" rx=".75" fill="#F5A623" opacity=".6"/>
        <circle cx="11" cy="14" r="1.5" fill="#F5A623" opacity=".5"/>
      </svg>
    ),
  },
]

export function ChannelsSection() {
  return (
    <section className="bg-dark py-20 px-6" aria-labelledby="channels-title">
      <div className="section-inner">

        {/* Header */}
        <ScrollReveal direction="up">
          <div>
            <span className="section-tag" style={{ background: 'rgba(255,255,255,.1)', color: '#9FE1CB' }}>
              Three channels
            </span>
            <h2 className="display-lg text-white" id="channels-title">
              Students submit however they can.
            </h2>
            <p className="text-[17px] text-teal-mid leading-relaxed mt-3 mb-12 max-w-[540px]">
              All three channels route into the same grading pipeline. The teacher sees everything in one dashboard.
            </p>
          </div>
        </ScrollReveal>

        {/* Channel cards — left, up, right entrance */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {channels.map((c, i) => (
            <ScrollReveal key={i} direction={c.direction} delay={i * 120} duration={900}>
              <div className="bg-white/[0.07] border border-white/12 rounded-[16px] p-6 md:p-8 hover:bg-white/[0.11] transition-colors h-full">
                <div className={`w-12 h-12 rounded-[12px] flex items-center justify-center mb-5 ${c.iconBg}`}>
                  {c.icon}
                </div>
                <h3 className="font-display text-[20px] font-bold text-white mb-2">{c.title}</h3>
                <p className="text-[14px] text-teal-mid leading-relaxed mb-4">{c.desc}</p>
                <span className="inline-block text-[11px] text-teal-mid bg-teal-mid/15 border border-teal-mid/25 rounded-full px-3 py-1">
                  {c.badge}
                </span>
              </div>
            </ScrollReveal>
          ))}
        </div>

      </div>
    </section>
  )
}
