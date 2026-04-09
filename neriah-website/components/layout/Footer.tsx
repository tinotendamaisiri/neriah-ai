import Link from 'next/link'
import Image from 'next/image'

const product = [
  { href: '/product',           label: 'How it works'       },
  { href: '/pricing',           label: 'Pricing'            },
  { href: '/product#channels',  label: 'Submission channels'},
  { href: '/product#analytics', label: 'Student analytics'  },
]

const company = [
  { href: '/about',      label: 'About us'          },
  { href: '/foundation', label: 'Neriah Foundation' },
  { href: '/blog',       label: 'Blog'              },
  { href: '/contact',    label: 'Contact'           },
]

const legal = [
  { href: '/legal?tab=privacy', label: 'Privacy Policy'   },
  { href: '/legal?tab=terms',   label: 'Terms of Service' },
  { href: '/legal?tab=delete',  label: 'Delete Account'   },
]

export function Footer() {
  return (
    <footer className="bg-dark text-white pt-14 pb-8" role="contentinfo">
      <div className="section-inner px-6">
        {/* Top grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 pb-10 border-b border-white/[0.08]">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <Image
                src="/images/logo/logo-light-background.png"
                alt="Neriah Africa"
                width={160}
                height={54}
                className="h-[22px] w-auto object-contain"
              />
              <span className="font-display text-xl font-bold text-teal-mid">Neriah Africa</span>
            </div>
            <p className="text-[13px] text-white/50 leading-relaxed max-w-[220px] mb-5">
              AI Built for Africa. Starting with the people who teach it.
            </p>
            {/* Social links */}
            <nav aria-label="Social media links" className="flex gap-2">
              {[
                { href: 'https://linkedin.com/company/neriah-africa', label: 'LinkedIn', text: 'in' },
                { href: 'https://x.com/NeriahAfrica',                 label: 'X',        text: '𝕏'  },
                { href: 'https://instagram.com/NeriahAfrica',         label: 'Instagram', text: 'ig' },
              ].map(s => (
                <a
                  key={s.href}
                  href={s.href}
                  aria-label={s.label}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 min-w-[36px] min-h-[36px] bg-white/[0.08] border border-white/10 rounded-lg flex items-center justify-center text-white/60 text-xs hover:bg-white/15 hover:text-white transition-colors"
                >
                  {s.text}
                </a>
              ))}
            </nav>
          </div>

          {/* Product */}
          <div>
            <p className="text-[11px] font-medium text-white/40 uppercase tracking-wider mb-4">Product</p>
            <ul className="flex flex-col gap-2.5 list-none">
              {product.map(l => (
                <li key={l.href}>
                  <Link href={l.href} className="text-[13px] text-white/55 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <p className="text-[11px] font-medium text-white/40 uppercase tracking-wider mb-4">Company</p>
            <ul className="flex flex-col gap-2.5 list-none">
              {company.map(l => (
                <li key={l.href}>
                  <Link href={l.href} className="text-[13px] text-white/55 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="text-[11px] font-medium text-white/40 uppercase tracking-wider mb-4">Legal</p>
            <ul className="flex flex-col gap-2.5 list-none">
              {legal.map(l => (
                <li key={l.href}>
                  <Link href={l.href} className="text-[13px] text-white/55 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-6">
          <p className="text-[12px] text-white/30">
            © 2026 Neriah Africa (Private) Limited. All rights reserved.
            {' · '}
            <Link href="/legal?tab=privacy" className="text-white/40 hover:text-white/70 transition-colors">Privacy</Link>
            {' · '}
            <Link href="/legal?tab=terms"   className="text-white/40 hover:text-white/70 transition-colors">Terms</Link>
          </p>
          <p className="text-[11px] text-white/25">
            Registered in Zimbabwe · Harare · neriah.ai
          </p>
        </div>
      </div>
    </footer>
  )
}
