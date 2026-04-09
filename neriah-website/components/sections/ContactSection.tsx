import { ContactForm } from '@/components/forms/ContactForm'
import { ScrollReveal } from '@/components/ui/ScrollReveal'

const contactInfo = [
  {
    label: 'Email',
    value: 'admin@neriah.ai',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1" y="3" width="14" height="10" rx="2" stroke="rgba(255,255,255,.6)" strokeWidth="1.2"/>
        <path d="M1 6l7 4.5L15 6" stroke="rgba(255,255,255,.6)" strokeWidth="1.2"/>
      </svg>
    ),
  },
]

export function ContactSection() {
  return (
    <section className="bg-teal py-20 px-6" aria-labelledby="contact-title">
      <div className="section-inner">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 items-start">

          {/* Left info — slides in from left */}
          <ScrollReveal direction="left" duration={800}>
            <div>
              <span
                className="section-tag"
                style={{ background: 'rgba(255,255,255,.1)', color: '#9FE1CB' }}
              >
                Get in touch
              </span>
              <h2 className="display-lg text-white" id="contact-title">
                Ready to give your teachers their evenings back?
              </h2>
              <p className="text-[17px] text-teal-mid leading-relaxed mt-4 mb-8">
                Contact Kundai directly. She will visit your school, run a live demo,
                and onboard your first class in under 20 minutes.
              </p>

              <div className="flex flex-col gap-0">
                {contactInfo.map((c, i) => (
                  <div key={i} className={`flex gap-3 py-4 ${i < contactInfo.length - 1 ? 'border-b border-white/10' : ''}`}>
                    <div className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      {c.icon}
                    </div>
                    <div>
                      <p className="text-[11px] text-teal-mid uppercase tracking-[0.4px]">{c.label}</p>
                      <p className="text-[15px] text-white font-medium mt-0.5">{c.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ScrollReveal>

          {/* Right form — slides in from right */}
          <ScrollReveal direction="right" duration={800}>
            <ContactForm />
          </ScrollReveal>

        </div>
      </div>
    </section>
  )
}
