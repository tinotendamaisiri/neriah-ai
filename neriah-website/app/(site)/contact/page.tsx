import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { ContactForm } from '@/components/forms/ContactForm'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with the Neriah Africa team.',
  alternates: { canonical: 'https://neriah.ai/contact' },
}

export default function ContactPage() {
  return (
    <>
      <Navbar />
      <main id="main-content">
        <section className="bg-teal py-20 px-6 min-h-screen">
          <div className="max-w-lg mx-auto">
            <Suspense>
              <ContactForm />
            </Suspense>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
