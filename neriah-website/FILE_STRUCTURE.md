# Neriah Website — File Structure

```
neriah-website/
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── contact/route.ts
│   │   ├── demo/
│   │   ├── newsletter/route.ts
│   │   └── revalidate/route.ts
│   ├── site/                     # Public-facing pages
│   │   ├── about/page.tsx
│   │   ├── blog/
│   │   │   ├── [slug]/page.tsx
│   │   │   └── page.tsx
│   │   ├── contact/page.tsx
│   │   ├── foundation/page.tsx
│   │   ├── pricing/page.tsx
│   │   ├── privacy/page.tsx
│   │   ├── product/page.tsx
│   │   └── terms/page.tsx
│   ├── studio/[[...tool]]/page.tsx  # Sanity Studio embedded
│   ├── error.tsx
│   ├── layout.tsx
│   ├── loading.tsx
│   ├── not-found.tsx
│   └── page.tsx                  # Homepage
│
├── components/
│   ├── blog/PortableText.tsx
│   ├── forms/ContactForm.tsx
│   ├── layout/
│   │   ├── Footer.tsx
│   │   └── Navbar.tsx
│   ├── sections/
│   │   ├── BlogPreview.tsx
│   │   ├── ChannelsSection.tsx
│   │   ├── ContactSection.tsx
│   │   ├── FoundationSection.tsx
│   │   ├── HeroSection.tsx
│   │   ├── HowItWorks.tsx
│   │   ├── PricingSection.tsx
│   │   ├── ProblemSection.tsx
│   │   └── StatsBand.tsx
│   └── ui/
│       ├── NewsletterForm.tsx
│       └── ScrollReveal.tsx
│
├── lib/
│   ├── email/resend.ts
│   ├── sanity/
│   │   ├── client.ts
│   │   ├── image.ts
│   │   └── queries.ts
│   ├── supabase/client.ts
│   └── validators/contact.ts
│
├── sanity/
│   ├── sanity.config.ts
│   └── schemas/
│       ├── author.ts
│       ├── category.ts
│       ├── foundationUpdate.ts
│       └── post.ts
│
├── public/
│   ├── fonts/
│   ├── images/
│   │   ├── foundation/
│   │   ├── hero/
│   │   ├── og-default.svg
│   │   └── team/
│   ├── robots.txt
│   └── sitemap.xml
│
├── styles/globals.css
├── types/
│   ├── database.ts
│   └── sanity.ts
│
├── middleware.ts
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router) |
| CMS | Sanity (embedded Studio at `/studio`) |
| Database | Supabase |
| Email | Resend |
| Auth | NextAuth |
| Styling | Tailwind CSS |
| SEO | next-sitemap |