# Neriah Africa — Website

Marketing website for **neriah.ai** — the AI-powered assignment grading platform for African schools.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Sanity.io · Supabase · Resend · Vercel

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env.local
# Fill in all values in .env.local (see comments in that file)

# 3. Run locally
npm run dev
# → http://localhost:3000
```

The site runs immediately. Blog shows placeholder cards until Sanity is configured. Forms require Supabase + Resend keys to submit.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SANITY_PROJECT_ID` | sanity.io/manage → your project |
| `NEXT_PUBLIC_SANITY_DATASET` | `production` |
| `SANITY_API_TOKEN` | Sanity → API → Tokens |
| `SANITY_REVALIDATE_SECRET` | Generate: `openssl rand -base64 32` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (service role) |
| `RESEND_API_KEY` | resend.com → API Keys |
| `NEXTAUTH_SECRET` | Generate: `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → OAuth 2.0 |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → OAuth 2.0 |
| `ALLOWED_STUDIO_EMAILS` | `tinotenda@neriah.ai,ops@neriah.ai` |
| `UPSTASH_REDIS_REST_URL` | upstash.com → Redis |
| `UPSTASH_REDIS_REST_TOKEN` | upstash.com → Redis |

---

## Supabase setup

Run these SQL statements in the Supabase SQL editor before first form submission:

```sql
-- Contact submissions
create table contact_submissions (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  name text not null,
  school text not null,
  role text not null,
  phone text,
  email text not null,
  message text,
  status text default 'new' check (status in ('new','contacted','converted','closed'))
);

-- Newsletter subscribers
create table newsletter_subscribers (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  email text unique not null,
  confirmed boolean default false,
  unsubscribed_at timestamptz
);

-- Demo requests
create table demo_requests (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  name text not null,
  school text not null,
  role text not null,
  email text not null,
  phone text,
  teacher_count integer,
  student_count integer,
  preferred_date text,
  status text default 'new' check (status in ('new','scheduled','completed','cancelled'))
);

-- Enable Row Level Security on all tables
alter table contact_submissions    enable row level security;
alter table newsletter_subscribers enable row level security;
alter table demo_requests          enable row level security;

-- Only service role can access (no public reads)
create policy "service_role_only" on contact_submissions    using (false);
create policy "service_role_only" on newsletter_subscribers using (false);
create policy "service_role_only" on demo_requests          using (false);
```

---

## Sanity Studio

The CMS is deployed at `/studio`. Protected by Google OAuth — only emails in `ALLOWED_STUDIO_EMAILS` can access it.

First-time setup:

```bash
# Create a Sanity project if you haven't already
npx sanity@latest init

# The schemas are already defined in sanity/schemas/
# Just add the project ID to .env.local
```

Initial content to create in Studio:
1. Create Author entries for Tino and Kundai
2. Create Category entries: Building in Public, African AI, Education, Neriah Foundation, Product Updates
3. Write and publish the first 3 blog posts

---

## Sanity webhook (for instant blog revalidation)

In Sanity project settings → API → Webhooks, add:

- **URL:** `https://neriah.ai/api/revalidate?secret=YOUR_SANITY_REVALIDATE_SECRET`
- **Trigger on:** Create, Update, Delete
- **Filter:** `_type in ["post", "foundationUpdate"]`

New posts appear on the site within 60 seconds of publishing — no redeploy needed.

---

## Project structure

```
neriah-website/
├── app/
│   ├── layout.tsx              Root layout (fonts, metadata, analytics)
│   ├── page.tsx                Homepage
│   ├── not-found.tsx           Custom 404
│   ├── loading.tsx             Global loading state
│   ├── error.tsx               Error boundary
│   ├── api/
│   │   ├── contact/            Contact form → Supabase + Resend
│   │   ├── newsletter/         Newsletter signup
│   │   ├── revalidate/         Sanity webhook handler
│   │   └── auth/               NextAuth (Google OAuth for /studio)
│   ├── site/                   All public pages
│   │   ├── product/
│   │   ├── pricing/
│   │   ├── foundation/
│   │   ├── about/
│   │   ├── blog/[slug]/
│   │   ├── contact/
│   │   ├── privacy/
│   │   └── terms/
│   └── studio/                 Sanity Studio (protected)
├── components/
│   ├── layout/                 Navbar, Footer
│   ├── sections/               All homepage sections
│   ├── forms/                  ContactForm, NewsletterForm
│   ├── blog/                   PortableText renderer
│   └── ui/                     ScrollReveal, shared UI
├── lib/
│   ├── sanity/                 Client, GROQ queries, image helper
│   ├── supabase/               Admin client
│   ├── email/                  Resend helpers
│   └── validators/             Zod schemas
├── sanity/
│   ├── sanity.config.ts
│   └── schemas/                post, author, category, foundationUpdate
├── types/
│   ├── sanity.ts
│   └── database.ts
└── styles/
    └── globals.css
```

---

## Deployment (Vercel)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Add environment variables in Vercel dashboard
# Settings → Environment Variables → paste from .env.local
```

Point `neriah.ai` DNS to Vercel. SSL is automatic.

---

## Before launch checklist

- [ ] Fill in `.env.local` with real values
- [ ] Run Supabase SQL setup above
- [ ] Create Sanity project and add schema
- [ ] Create Author and Category entries in Sanity Studio
- [ ] Write and publish 3 launch blog posts
- [ ] Replace hero illustration placeholders with real photos from Kundai
- [ ] Add real company registration number to Footer
- [ ] Run `npm run build` — fix any TypeScript errors
- [ ] Run Lighthouse on mobile — target 90+ score
- [ ] Test contact form on a real Android device
- [ ] Check securityheaders.com — target A+ rating
- [ ] Submit to Google Search Console

---

## Contact

**Tinotenda Maisiri** — tinotenda@neriah.ai  
**Kundai Baleni** — ops@neriah.ai  
**Neriah Africa (Private) Limited** — Harare, Zimbabwe — neriah.ai
