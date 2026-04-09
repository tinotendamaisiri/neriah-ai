'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'

const links = [
  { href: '/',           label: 'Home'       },
  { href: '/product',    label: 'Neriah'     },
  { href: '/pricing',    label: 'Pricing'    },
  { href: '/foundation', label: 'Foundation' },
  { href: '/blog',       label: 'Blog'       },
  { href: '/product#faq', label: 'FAQ'        },
]

export function Navbar() {
  const [open,     setOpen]     = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className={`sticky top-0 z-50 bg-off-white/95 backdrop-blur-md border-b border-black/[0.08] transition-shadow duration-300 ${scrolled ? 'shadow-sm' : ''}`}
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5" aria-label="Neriah Africa homepage">
          <Image
            src="/images/logo/logo-light-background.png"
            alt="Neriah Africa"
            width={160}
            height={54}
            className="h-8 w-auto md:h-11"
            priority
          />
        </Link>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-7 list-none">
          {links.map(l => (
            <li key={l.href}>
              <Link href={l.href} className="nav-link text-sm font-medium text-mid hover:text-teal transition-colors">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Desktop CTA */}
        <Link
          href="/contact?subject=demo"
          className="hidden md:inline-flex btn-teal"
        >
          Get started
        </Link>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-dark"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            {open ? (
              <>
                <line x1="5" y1="5" x2="17" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="17" y1="5" x2="5" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </>
            ) : (
              <>
                <line x1="3" y1="7"  x2="19" y2="7"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="3" y1="11" x2="19" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="3" y1="15" x2="19" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div
          id="mobile-menu"
          className="md:hidden bg-off-white border-t border-black/[0.08] px-6 py-4"
        >
          <ul className="flex flex-col gap-1 list-none">
            {links.map(l => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="nav-link block py-3 text-sm font-medium text-dark hover:text-teal transition-colors border-b border-black/[0.05] last:border-0"
                  onClick={() => setOpen(false)}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/contact?subject=demo"
            className="btn-teal w-full mt-4 text-center"
            onClick={() => setOpen(false)}
          >
            Get started
          </Link>
        </div>
      )}
    </nav>
  )
}
