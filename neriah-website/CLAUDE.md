# Neriah Africa — CLAUDE.md

## Project
Marketing and demo-request website for **Neriah Africa**, an AI-powered assignment grading platform for African schools. Built by Tinotenda Maisiri (founder).

Live domain: **neriah.ai**
GitHub: `tinotendamaisiri/neriah-website`

---

## Tech stack
| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.1 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| CMS | Sanity (blog only) — project ID `0mg8jt0s`, dataset `production` |
| Database | Supabase (contact_submissions, newsletter_subscribers) |
| Email | Resend — from `admin@neriah.ai`, notify `admin@neriah.ai,tinotenda@neriah.ai,team@neriah.ai` |
| Rate limiting | Upstash Redis (5 req/IP/hour on contact + newsletter APIs) |
| Auth | NextAuth (Google OAuth, studio access only) |
| Sitemap | next-sitemap (runs as postbuild) |

---

## Running locally
```bash
npm install --legacy-peer-deps   # always use legacy-peer-deps
npm run dev                      # http://localhost:3000
npm run build                    # production build + sitemap
```

**Never use `--force`** for npm installs. Use `--legacy-peer-deps` only.

---

## Environment variables
All secrets live in `.env.local` — never commit this file. Key vars:
- `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET`, `SANITY_API_TOKEN`, `SANITY_REVALIDATE_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_NOTIFY_EMAIL`
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_STUDIO_EMAILS`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

---

## Route structure
All public pages live under `/site/`:
- `/` — homepage (hero + all sections)
- `/site/contact` — contact/demo request page
- `/site/product` — how Neriah works
- `/site/pricing` — pricing tiers
- `/site/about` — team
- `/site/foundation` — Neriah Foundation
- `/site/blog` — blog (Sanity-powered)
- `/site/privacy`, `/site/terms`
- `/studio/[[...tool]]` — Sanity Studio (auth-gated)
- `/api/contact`, `/api/newsletter`, `/api/revalidate`, `/api/auth/[...nextauth]`

**Important:** All "Contact" / "Request a demo" links must point to `/site/contact?subject=demo` — not `/contact` (that route doesn't exist).

---

## Contact form (`components/forms/ContactForm.tsx`)
Fields (in order):
1. First name + Last name (side by side, 50/50)
2. WhatsApp number (country code dropdown + number input, combined as `+263771234567`)
3. Email address
4. School name
5. City / Town
6. Role dropdown (Teacher / Head of Department / Principal/Headmaster / Other)
7. Subject buttons (Demo / Sales / Support / Billing) — pre-selected via `?subject=` URL param
8. Message (optional)
9. Privacy consent checkbox
10. Honeypot field (hidden, `website` field, max 0 chars)

Form card is **white** (`bg-white border border-gray-200 shadow-lg`) on top of the teal page background.

Country dropdown: 52 African countries, shows `🇿🇼 ZW +263` in options, has visible chevron SVG. Default: Zimbabwe +263.

Zod schema: `lib/validators/contact.ts` — `ContactSchema` exports `ContactInput` type.

---

## Supabase schema (`contact_submissions`)
Current columns: `id`, `created_at`, `first_name`, `last_name`, `school_name`, `city`, `role`, `whatsapp_number`, `email`, `subject` (default `'Demo'`), `message`, `status`.

Migration file: `SUPABASE_MIGRATION.sql` — run in Supabase SQL editor before deploying. Handles all starting states (fresh table, or table with old `name`/`phone`/`school` or `full_name` columns).

---

## Email (`lib/email/resend.ts`)
- `sendContactNotification` — sends to NOTIFY list with all form fields. Adds `🔴 HIGH PRIORITY —` prefix when role is `Principal/Headmaster`. Includes `wa.me/` WhatsApp click-to-chat link.
- `sendContactConfirmation` — sends to submitter, greets by `first_name`.
- `sendNewsletterConfirmation` — sent on newsletter signup.

---

## Branding / assets
- Logo files: `public/images/logo/logo-light-background.png` (used on dark/teal backgrounds), `public/images/logo/logo-dark-brackground.png`
- Navbar uses `logo-light-background.png` (the project has a light background navbar — wait, the navbar is `bg-off-white` so actually uses the dark logo… currently uses light-background.png via IDE edit)
- Hero section: logo displayed above the headline using `logo-light-background.png`
- Form card: uses inline SVG teal logo + teal "Neriah" text (or the PNG logo via Image component after IDE edit)
- Primary brand colors: teal (`#085041`/`#0D7377`), amber (`#F5A623`), off-white

---

## WhatsApp icons
All three dummy WhatsApp icons have been replaced with the real WhatsApp brand SVG (speech bubble + phone path):
- `components/sections/HeroSection.tsx` — 12×12 white icon on green pill container
- `components/sections/ChannelsSection.tsx` — 22×22 white icon on green card header
- `components/sections/ContactSection.tsx` — 16×16 full brand icon (green + white) on transparent container

---

## Key decisions & things to remember
- `npm install` always needs `--legacy-peer-deps`
- All bare `/contact` links were updated to `/site/contact?subject=demo`
- The middleware file must be named `middleware.ts` in the project root — Next.js only executes that exact filename. `proxy.ts` or any other name is ignored entirely.
- Supabase types in `types/database.ts` must stay in sync with actual schema; TypeScript build will fail if they diverge
- `ContactForm` uses `useSearchParams` so it must be wrapped in `<Suspense>` in any server component page
- The contact page background stays teal — only the form card itself is white
- `app/api/contact/route.ts` silently returns 200 for honeypot hits (don't tell bots it failed)
- Rate limiter: 5 submissions per IP per hour via Upstash sliding window
- CORS on API routes: only `neriah.ai`, `www.neriah.ai`, `localhost:3000`
