import type { Metadata } from 'next'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { ScrollReveal } from '@/components/ui/ScrollReveal'

export const metadata: Metadata = {
  title: 'About',
  description: 'Neriah Africa is built by Zimbabweans for African teachers. Meet the team.',
  alternates: { canonical: 'https://neriah.ai/about' },
}

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <main id="main-content">
        <section className="bg-teal py-20 px-6" aria-labelledby="about-title">
          <div className="section-inner">
            <ScrollReveal direction="up" duration={700}>
              <span className="section-tag" style={{background:'rgba(255,255,255,.1)',color:'#9FE1CB'}}>About us</span>
              <h1 className="font-display font-bold text-white leading-[1.15] tracking-tight mt-2 mb-5" style={{fontSize:'clamp(32px,5vw,52px)'}} id="about-title">Built by Zimbabweans.<br />For African teachers.</h1>
            </ScrollReveal>
            <ScrollReveal direction="up" delay={120} duration={700}>
              <p className="text-teal-mid text-[17px] max-w-xl">Neriah Africa (Private) Limited is registered in Zimbabwe. We are not a foreign company entering the African market — we are from here.</p>
            </ScrollReveal>
          </div>
        </section>

        <section className="bg-white py-20 px-6" aria-labelledby="team-title">
          <div className="section-inner">
            <ScrollReveal direction="up" duration={700}>
              <h2 className="display-lg text-dark mb-14" id="team-title">The team</h2>
            </ScrollReveal>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 max-w-3xl">
              {[
                {
                  name: "Tinotenda Maisiri",
                  role: "Founder & CEO",
                  location: "New York, USA",
                  bio: "MS in Data Analytics and Visualisation (Yeshiva University, Katz School). BS in Data Science and Informatics (University of Zimbabwe, 3.7 GPA). 3x AWS Certified: Solutions Architect, Data Engineer, Cloud Practitioner. Professional experience as a Cloud and Infrastructure Engineer. Previously founded Tooltyde, an AI tool marketplace that reached 11,400+ developers. Originally from Zimbabwe with deep firsthand knowledge of the education system.",
                  linkedin: "https://linkedin.com/in/tinotenda-maisiri",
                },
                {
                  name: "Kundai Malcon Baleni",
                  role: "Co-Founder & COO",
                  location: "Harare, Zimbabwe",
                  bio: "Based in Harare. Handles all ground operations, school partnerships, teacher onboarding, customer support, and the Neriah Foundation exercise book exchange programme. Kundai is the face of Neriah in Zimbabwe — she visits the schools, runs the demos, and makes sure every teacher has what they need to succeed with the platform.",
                  linkedin: null,
                },
              ].map((person, i) => (
                <ScrollReveal key={i} direction={i === 0 ? 'left' : 'right'} delay={i * 150} duration={800}>
                  <div>
                    <div className="w-20 h-20 bg-teal-light rounded-full flex items-center justify-center mb-5" aria-hidden="true">
                      <span className="font-display text-[28px] font-bold text-teal">
                        {person.name.split(' ').map((n: string) => n[0]).join('')}
                      </span>
                    </div>
                    <h3 className="font-display text-[24px] font-bold text-dark mb-1">{person.name}</h3>
                    <p className="text-teal text-sm font-medium mb-0.5">{person.role}</p>
                    <p className="text-mid text-[13px] mb-4">{person.location}</p>
                    <p className="text-[15px] text-mid leading-relaxed mb-4">{person.bio}</p>
                    {person.linkedin && (
                      <a href={person.linkedin} target="_blank" rel="noopener noreferrer"
                        className="text-[13px] text-teal hover:underline">LinkedIn →</a>
                    )}
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </>
  )
}