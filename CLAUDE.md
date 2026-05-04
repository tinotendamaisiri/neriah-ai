# CLAUDE.md — Neriah Project Context

> Single source of truth for navigating this repository. Every directory, every endpoint, every screen, every script, every architecture decision documented here.
>
> Last updated: 2026-05-04. Verified against the actual code, not aspirational docs. Earlier versions of this file referenced Azure — that migration happened. The current backend is **Google Cloud Functions Gen2 in `us-central1`**, not Azure.
>
> Major additions on 2026-05-04: full observability layer (every backend route + mobile screen + AI call logged to Firestore `events`), admin monitoring dashboard at `/admin/monitoring` (Live feed, Errors, Funnels, AI usage, Per-user trace), training-data archive viewer at `/admin/training`, unified admin hub at `/admin`, Vertex AI cost telemetry per call, dedicated runtime SA `neriah-ai-sa`, Supabase keep-alive cron. See § 9.5 for the full diff.

---

## 1. What Neriah Is

Neriah is an AI-powered homework grading assistant for African schools. Teachers upload an answer key, students submit work through one of three channels (mobile app, WhatsApp, email), Gemma 4 grades against the key, the teacher reviews + approves, and students see annotated results plus personalised tutor follow-ups. Launching in Zimbabwe, expanding across SADC.

**Three submission channels — same backend pipeline:**
- **Mobile app (primary):** React Native + Expo, full feature set for both teachers and students.
- **WhatsApp bot:** Stateful conversation that handles class setup, marking, and student submission. Pending Meta business verification.
- **Email:** Zoho IMAP poller routes inbound emails to the right homework via a 6-character submission code.

**Pricing:** $5 USD/month per teacher (mentioned in pricing page; foundation flow exchanges exercise books for free training data).

**Domains:**
- `neriah.ai` — primary marketing site (Vercel) + canonical brand
- `neriah.africa` — redirects to `neriah.ai`; also the verified email-sending domain (`send.neriah.africa`)

---

## 2. Tech Stack

| Layer | Service / Library | Notes |
|---|---|---|
| **Backend runtime** | Google Cloud Functions Gen2 | Python 3.11, 1 GB, 300 s timeout, single Flask app |
| **Backend region** | `us-central1` | Function name `neriah-grading`, project `neriah-ai-492302` |
| **Database** | Firestore (Native mode) | NoSQL, 9 composite indexes in `firestore.indexes.json` |
| **File storage** | Google Cloud Storage | Buckets: `scans`, `marked`, `submissions` |
| **OCR** | Document AI + Gemma 4 Vision | Document AI for layout, Gemma for handwriting |
| **LLM** | Vertex AI — Gemma 4 (cloud) | E2B/E4B variants; LiteRT-LM E2B on-device |
| **Vector RAG** | Firestore vector search | `rag_syllabuses` collection, embeddings via Vertex AI |
| **Messaging** | Meta WhatsApp Cloud API | Webhook receiver + send (state machine in `functions/whatsapp.py`) |
| **SMS / OTP** | Twilio (Verify + Programmable SMS) | Verify API for +1, alphanumeric "Neriah" sender ID for international |
| **Email — outbound** | Resend (`send.neriah.africa`) | Notifications, confirmations, contact-form replies |
| **Email — inbound** | Zoho Mail IMAP poller | Cloud Scheduler → Pub/Sub → `email_poller` |
| **Mobile app** | React Native 0.83.6 + Expo SDK 55 | TypeScript 5.9.2, native arm64 only |
| **On-device AI** | `react-native-litert-lm` 0.3.4 | Vendored XCFramework + AAR (HEAD-of-main Bazel rebuild) |
| **On-device OCR** | `@react-native-ml-kit/text-recognition` | Latin script, runs on device |
| **Web (marketing)** | Next.js 15.2.6 + Tailwind 3.4 | App Router, deployed to Vercel |
| **Web CMS** | Sanity 4.x | Blog + foundation updates, ISR via webhook |
| **Web DB** | Supabase (PostgreSQL) | Contact form + newsletter submissions |
| **Web auth** | NextAuth (Google) + JWT cookie | Studio uses NextAuth, curriculum admin uses JWT |
| **Rate limiting** | Upstash Redis | Per-IP for forms; per-phone for OTP done in-Firestore |
| **Push notifications** | Expo Push Service | Tokens stored in `push_tokens` collection |
| **Observability** | Firestore `events` collection | Async fire-and-forget writes via `shared/observability.py`; every backend route + mobile screen + AI call captured |
| **Training-data archive** | Cloud Storage `gs://neriah-training-data` | Approved teacher-graded submissions copied here on approval (Nearline class, us-central1); browse via `/admin/training` |
| **Admin auth** | JWT cookie (`neriah-admin`, HS256) | Hub at `/admin` gated to `@neriah.ai` emails; backend admin endpoints gated by `Authorization: Bearer ${ADMIN_API_KEY}` |
| **CI/CD — backend** | Google Cloud Build (`cloudbuild.yaml`) | Triggers on `gcloud functions deploy` from branch |
| **CI/CD — web** | Vercel | Auto on push to main; `vercel.json` is empty (defaults) |
| **Health monitoring** | GitHub Actions keep-alive | `.github/workflows/keep-alive.yml`, twice weekly |
| **Auth identity** | Phone number | OTP-based, no passwords; JWT (HS256, 365-day) for sessions |
| **PIN (mobile)** | bcrypt + SecureStore + Firestore backup | 4-digit, 5-attempt lockout |

---

## 3. Repo Layout

```
neriah-ai/
├── CLAUDE.md                          ← this file
├── README.md                          ← public-facing project overview
├── TECHNICAL_REFERENCE.md             ← STALE: written against Azure backend (Apr 2026); useful for grading-pipeline details but routes/env vars are wrong
├── functionality_audit_report.md      ← STALE: April 2026 mobile-vs-web parity audit
├── .env.example                       ← env-var template (mostly Azure-era; check shared/config.py for current names)
├── .gcloudignore                      ← excludes mobile/, web/, infra/ from gcloud upload
├── .vercelignore                      ← excludes Python from web deploy
├── vercel.json                        ← `{}` — defaults only; real Vercel config lives in neriah-website/
├── cloudbuild.yaml                    ← Cloud Build deploy pipeline (Cloud Functions Gen2)
├── firestore.indexes.json             ← 9 composite indexes
├── requirements.txt                   ← Python deps (Flask, google-cloud-firestore, vertexai, twilio, …)
├── main.py                            ← Cloud Function entrypoint (Flask app + blueprint registration + CORS)
├── kaggle_notebook.ipynb              ← Kaggle Gemma 4 hackathon submission

├── functions/                         ← Backend route blueprints (one file per feature)
│   ├── analytics.py                   ← /analytics endpoints (dashboard, class, student, homework)
│   ├── answer_keys.py                 ← Homework + marking-scheme generation
│   ├── auth.py                        ← Register/login/verify/PIN/profile, teacher + student
│   ├── batch_grading.py               ← Async batch grading worker
│   ├── classes.py                     ← Class lifecycle + join codes
│   ├── curriculum.py                  ← Syllabus upload/list/search (RAG)
│   ├── email_poller.py                ← Zoho IMAP → submission routing
│   ├── events.py                      ← POST /events/batch (mobile ingestion) + GET /admin/events/{list,errors,trace,funnel,ai_usage} (dashboard)
│   ├── keep_alive.py                  ← GET /internal/keep-alive — Cloud Scheduler-triggered Supabase + Upstash pings
│   ├── mark.py                        ← POST /mark — full grading pipeline
│   ├── push.py                        ← Expo push-token registration
│   ├── schools.py                     ← School directory (seed + Firestore)
│   ├── students.py                    ← Roster CRUD + image/file extraction
│   ├── submissions.py                 ← Teacher review + approval cascade
│   ├── suggestions.py                 ← Personalised study suggestions per student
│   ├── teacher_assistant.py           ← /teacher/assistant chat (Notes, Methods, Exam Q's, Chat)
│   ├── teacher_whatsapp.py            ← Teacher-only WhatsApp helpers
│   ├── training_admin.py              ← GET /admin/training/{list,stats} — browse gs://neriah-training-data
│   ├── tutor.py                       ← /tutor/chat — Socratic student tutor
│   └── whatsapp.py                    ← Webhook + state machine (IDLE / CLASS_SETUP / …)

├── shared/                            ← Cross-cutting helpers (no HTTP routes)
│   ├── auth.py                        ← JWT encode/decode, OTP gen/hash, role decorators
│   ├── config.py                      ← Env-var loading (pydantic Settings)
│   ├── constants.py                   ← Education levels, curricula, phone country rules
│   ├── country_profile.py             ← Per-country curriculum/grading-style overrides
│   ├── email_client.py                ← Resend wrapper for outbound mail
│   ├── email_parser.py                ← MIME parsing + attachment extraction (inbound)
│   ├── embeddings.py                  ← Vertex AI text embeddings (with Ollama dev fallback)
│   ├── errors.py                      ← Standardised HTTP-error helpers
│   ├── firestore_client.py            ← Firestore CRUD wrappers (and demo-DB switching)
│   ├── gcs_client.py                  ← Cloud Storage upload/download with signed URLs
│   ├── gemma_client.py                ← Vertex AI Gemma 4 calls (text + multimodal)
│   ├── guardrails.py                  ← Output sanitisation, refusal phrasing, length checks
│   ├── models.py                      ← Pydantic models: Teacher, Student, Class, Mark, …
│   ├── observability.py               ← log_event() async writer + @instrument_route decorator + trace_id propagation
│   ├── orientation.py                 ← Image orientation correction (EXIF + heuristics)
│   ├── pdf_pages.py                   ← PDF → page images (pdf2image / pypdfium fallback)
│   ├── router.py                      ← Cross-feature routing helpers
│   ├── sms_client.py                  ← Twilio wrapper (Verify API + alphanumeric)
│   ├── student_matcher.py             ← Fuzzy match inbound submissions to a student
│   ├── submission_codes.py            ← 6-char unique homework code generation
│   ├── training_data.py               ← Optional consented archive to GCS for training
│   ├── user_context.py                ← User-context dict for prompts (country, level, …)
│   ├── utils.py                       ← Misc helpers (ID generation, string utilities)
│   ├── vector_db.py                   ← Firestore vector-search adapter
│   ├── weakness_tracker.py            ← Updates student weakness profile after grading
│   └── whatsapp_client.py             ← WhatsApp Cloud API send + media-download wrapper

├── app/
│   └── mobile/                        ← React Native + Expo SDK 55 (see Section 5)
│       ├── App.tsx
│       ├── app.json
│       ├── package.json
│       ├── android/                   ← gitignored, regenerated by `expo prebuild`
│       ├── ios/                       ← gitignored, regenerated by `expo prebuild`
│       ├── patches/                   ← patch-package overrides
│       │   └── react-native-litert-lm+0.3.4.patch
│       ├── scripts/
│       │   ├── install-litert-frameworks.sh    ← copies vendored artifacts into node_modules
│       │   └── rebuild-litert-all.sh           ← rebuilds XCFramework + AAR from LiteRT-LM main via Bazel
│       ├── vendor/                    ← Pre-built LiteRT-LM artifacts (ours, from main)
│       │   ├── litert-android/litertlm-android.aar
│       │   ├── litert-android-build/build.gradle    ← module build.gradle (uses local Maven repo)
│       │   ├── litert-android-kotlin/HybridLiteRTLM.kt          ← maxNumTokens fix
│       │   ├── litert-android-kotlin/LiteRTLMInitProvider.kt   ← TRIM_MEMORY threshold fix
│       │   ├── litert-android-maven/                ← (gitignored) generated local Maven repo
│       │   ├── litert-cpp/HybridLiteRTLM.cpp        ← iOS Session-API workaround
│       │   ├── litert-cpp/HybridLiteRTLM.hpp
│       │   ├── litert-cpp/include/litert_lm_engine.h
│       │   ├── litert-ios/LiteRTLM.xcframework
│       │   ├── litert-ios/EngineInit/               ← per-slice libengine_init.a
│       │   └── litert-podspec/react-native-litert-lm.podspec
│       └── src/                       ← TypeScript source (see Section 5)

├── neriah-website/                    ← Marketing site (Next.js 15, Vercel) — see Section 6

├── infra/                             ← DEPRECATED: Azure Bicep (kept as historical reference)
│   ├── main.bicep
│   ├── parameters/{dev,prod}.bicepparam
│   └── modules/{cosmos,storage,functions,openai,document_intelligence,api_management}.bicep
│   # No active deployment. Successor is cloudbuild.yaml.

├── backend/                           ← Older Azure Functions v2 source (deprecated; not deployed)
├── batch_job/Dockerfile               ← Container for batch grading worker

├── scripts/                           ← Operational scripts (Python + Bash)
│   ├── deploy.sh                      ← Azure deploy (deprecated; use cloudbuild.yaml)
│   ├── seed_dev.py                    ← Seed Firestore with sample data
│   ├── create_vector_indexes.py       ← One-shot: create Firestore vector indexes
│   ├── index_syllabuses.py            ← Index syllabus PDFs into rag_syllabuses
│   ├── backfill_class_id.py           ← One-time: backfill class_id on legacy Marks
│   ├── migrate_names.py               ← One-time: split `name` → `first_name` + `surname`
│   └── pre-push.sh                    ← Git pre-push hook running pytest

├── tests/                             ← pytest suite (14 modules)
│   ├── conftest.py                    ← env vars, fixtures, role-invariant disable
│   ├── registry.py                    ← @feature_test decorator
│   ├── test_runner.py                 ← Aggregator
│   ├── test_grading.py                ← Verdict/scoring/feedback
│   ├── test_multi_page_grading.py     ← Page-by-page OCR + aggregation
│   ├── test_homework_creation_flow.py ← End-to-end homework setup
│   ├── test_email_submission.py       ← Inbound email routing
│   ├── test_rag_connectivity.py       ← Syllabus indexing + retrieval
│   ├── test_curriculum_options.py
│   ├── test_student_lookup.py
│   ├── test_classes_by_school.py
│   ├── test_teacher_daily_flow.py
│   ├── test_homework_approved_count.py
│   ├── test_guardrails_phase1.py
│   ├── test_guardrails_phase2.py
│   ├── test_role_invariants.py
│   ├── test_integration.py
│   └── CONTRIBUTING.md

├── syllabuses/                        ← 30 Zimbabwean curriculum PDFs (Primary, O-Level, A-Level)
│   └── SYLLABUS_<Subject>_<Level>_Zimbabwe.pdf
├── samples/                           ← question_paper.jpg, student_submission*.jpg, README, placeholder generator
├── notebooks/
│   ├── neriah_demo.ipynb
│   └── _build_notebook.py             ← regenerates the .ipynb from Python (do not hand-edit)

├── docs/                              ← Internal design docs
│   ├── architecture.md                ← System overview + sequence diagrams
│   ├── data-models.md                 ← Firestore/Cosmos schema rationale
│   ├── whatsapp-flow.md               ← State machine docs
│   └── email-channel-setup.md         ← Zoho IMAP + Resend operational setup

└── .github/workflows/keep-alive.yml   ← Twice-weekly health pings (homepage, blog, pricing, demo, Supabase, Upstash)
```

---

## 4. Backend (Google Cloud Functions Gen2)

### 4.1 Runtime

- **Function name:** `neriah-grading`
- **Project:** `neriah-ai-492302`
- **Region:** `us-central1`
- **Runtime:** Python 3.11
- **Memory:** 1 GB
- **Timeout:** 300 s
- **Trigger:** HTTP, allow-unauthenticated (auth is enforced in code via JWT decorators)
- **Entry point:** `neriah` in `main.py`
- **Framework:** `functions-framework` exposes a single Flask app; every blueprint in `functions/` is registered onto it
- **Logging:** Cloud Logging only (no separate App Insights); `gcloud functions logs read neriah-grading --region=us-central1 --gen2`

### 4.2 CORS / Origin Gating

`main.py` only accepts requests from these origins (mobile clients send no `Origin`, so they're unaffected):

- `https://neriah.ai`, `https://www.neriah.ai`
- `https://neriah.africa`, `https://www.neriah.africa`
- `http://localhost:3000` (Next.js dev)
- `http://localhost:5173` (Vite dev — leftover from web-dashboard era)

### 4.3 Deployment

`cloudbuild.yaml` runs `gcloud functions deploy neriah-grading --gen2` with secrets pulled from Google Secret Manager (`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `APP_JWT_SECRET`). The `.gcloudignore` keeps mobile, web, infra, and notebooks out of the upload.

### 4.4 Route Catalogue (every endpoint)

All routes are mounted under `/api/`. Auth column: `—` = public, `T` = teacher JWT required, `S` = student JWT required, `T/S` = either, `Adm` = admin/internal.

#### Auth (`functions/auth.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | — | Teacher registration → OTP send |
| POST | `/auth/login` | — | Teacher/student login → OTP send |
| POST | `/auth/verify` | — | Verify OTP → JWT |
| POST | `/auth/resend-otp` | — | Resend OTP (`channel_preference` = whatsapp / sms) |
| GET | `/auth/me` | T/S | Current profile (with `classes` for students) |
| PATCH | `/auth/me` | T | Update profile + phone (re-OTP required) |
| PATCH | `/auth/profile` | T | `training_data_consent` and other mutable flags |
| POST | `/auth/profile/request-otp` | T/S | Request OTP for a profile change |
| POST | `/auth/recover` | — | OTP-based account recovery (bumps `token_version`) |
| POST | `/auth/pin/set` | T | Set 4-digit PIN |
| POST | `/auth/pin/verify` | T | Verify PIN (5-attempt lockout → recovery) |
| DELETE | `/auth/pin` | T | Remove PIN |
| POST | `/auth/terms-accept` | T | Record terms-acceptance with timestamp + IP |
| POST | `/auth/student/lookup` | — | Find class by join code |
| POST | `/auth/student/register` | — | Student registration → OTP send |
| PUT | `/auth/student/update` | S | Update first_name / surname |
| DELETE | `/auth/student/<student_id>` | S (self) | Delete own student record |
| POST | `/auth/student/join-class` | S | Join class by code |
| GET | `/auth/student/classes` | S | List enrolled classes |
| DELETE | `/auth/student/leave-class` | S | Drop a class |

#### Classes (`functions/classes.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/classes` | T | List teacher's classes |
| POST | `/classes` | T | Create class (name, education_level, curriculum) |
| GET | `/classes/<class_id>` | T/S | Get class detail (school_name enriched) |
| PUT | `/classes/<class_id>` | T | Update name / level / curriculum |
| DELETE | `/classes/<class_id>` | T | Delete class |
| POST | `/classes/fix-counts` | Adm | Recount students per class (drift fix) |
| GET | `/classes/school/<school_id>` | — | List classes by school_id |
| GET | `/classes/by-school` | — | List classes by school name (?school=...) |
| GET | `/classes/join/<code>` | — | Resolve join code → class info |
| POST | `/classes/join` | S | Student joins by code |

#### Students (`functions/students.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/students` | T | List students (?class_id=...) |
| POST | `/students` | T | Create one student |
| POST | `/students/batch` | T | Batch create from `students[]` or `names[]` |
| PUT | `/students/<student_id>` | T | Update name / register / phone |
| DELETE | `/students/<student_id>` | T | Delete student |
| POST | `/students/extract-from-image` | T | Roster from photo (Gemma 4 vision) |
| POST | `/students/extract-from-file` | T | Roster from CSV / XLSX / PDF / DOCX |

#### Schools (`functions/schools.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/schools` | — | List seed schools (20 Zimbabwean) |
| GET | `/schools/search` | — | Substring search across seed + teachers' `school_name` |

#### Answer Keys / Homework (`functions/answer_keys.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/answer-keys` | T | List homework for a class (with submission/graded/approved counts) |
| POST | `/answer-keys` | T | Multipart upload — file + metadata → AnswerKey + auto marking-scheme |
| GET | `/answer-keys/<id>` | T | Get answer key |
| PUT | `/answer-keys/<id>` | T | Edit questions / title / due_date |
| DELETE | `/answer-keys/<id>` | T | Delete |
| POST | `/answer-keys/<id>/open-for-submission` | T | Open homework |
| POST | `/answer-keys/<id>/close` | T | Close homework |
| POST | `/homework/<hw_id>/regenerate-marking-scheme` | T | Re-run Gemma on the QP text |

Allowed upload types: `jpg, png, webp, heic, pdf, docx, txt`, max 10 MB. Each homework gets a 6-char `submission_code` (e.g. `HW7K2P`) used by the email channel.

#### Submissions (`functions/submissions.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/submissions` | T | List by `homework_id` / `class_id` / `teacher_id` (?status=...) |
| POST | `/submissions/<id>/approve` | T | Approve (makes mark visible to student, fires push) |
| POST | `/submissions/approve-bulk` | T | Batch approve |
| PATCH | `/submissions/<id>/override` | T | Override score / feedback |
| DELETE | `/submissions/<id>` | T | Cascade-delete (mark + GCS pages + annotated image) |
| DELETE | `/marks/<mark_id>` | T | Same cascade via mark id |

#### Marking (`functions/mark.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/mark` | T (multipart) | Run full grading pipeline: pages → OCR → grade → annotate → store |

#### Tutor (`functions/tutor.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/tutor/chat` | S | Socratic tutor (no direct answers, hints + questions) |

#### Teacher Assistant (`functions/teacher_assistant.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/teacher/assistant` | T | `action_type ∈ {chat, prepare_notes, teaching_methods, exam_questions, class_performance}` — returns plain `response` text and/or `structured` payload |

#### Suggestions (`functions/suggestions.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/students/<student_id>/suggestions` | S | Personalised study suggestions from weakness profile |

#### WhatsApp (`functions/whatsapp.py`, `functions/teacher_whatsapp.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/whatsapp` | — | Meta webhook verification handshake |
| POST | `/whatsapp` | — | Inbound webhook — drives state machine |

State machine: `IDLE` → `CLASS_SETUP` → `AWAITING_REGISTER` → `AWAITING_ANSWER_KEY` → `MARKING_ACTIVE`, plus `ERROR`. Documented in `docs/whatsapp-flow.md`.

#### Email (`functions/email_poller.py`)

Triggered by Cloud Scheduler → Pub/Sub (no public HTTP). Polls Zoho IMAP, classifies inbound mail by either `class_join_code` or 6-char `submission_code`, extracts attachments, creates a Submission, and replies via Resend. Operational setup: `docs/email-channel-setup.md`.

#### Push (`functions/push.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/push/register` | T/S | Store Expo push token |

#### Analytics (`functions/analytics.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/analytics` | T | Dashboard overview |
| GET | `/analytics/classes` | T | All classes summarised |
| GET | `/analytics/class/<class_id>` | T | Class detail |
| GET | `/analytics/me` | T | Personal teacher metrics |
| GET | `/analytics/student/<student_id>` | T/S | Student performance report |
| GET | `/analytics/homework/<homework_id>` | T | Homework stats |
| GET | `/analytics/student-class/<class_id>` | S | Student's view of class |

#### Curriculum / RAG (`functions/curriculum.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/curriculum/options` | — | Curriculum + subject options by country |
| POST | `/curriculum/upload` | T/Adm | Upload syllabus (PDF / DOCX) |
| GET | `/curriculum/list` | T/S | List uploaded syllabuses |
| GET | `/curriculum/<id>` | T/S | Get syllabus |
| DELETE | `/curriculum/<id>` | T/Adm | Delete syllabus |
| POST | `/curriculum/<id>/reindex` | Adm | Re-embed |
| GET | `/curriculum/search` | T/S | RAG vector search over `rag_syllabuses` |

#### Events / Observability (`functions/events.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/events/batch` | T/S | Mobile flush — accepts up to 200 events at a time, validates, writes async to Firestore `events` |
| GET | `/admin/events/list` | Adm Bearer | Recent events with filters (`since`, `severity`, `surface`, `user_id`, `limit`) |
| GET | `/admin/events/errors` | Adm Bearer | Error groups by `error.fingerprint` over last `window` (1h / 24h / 7d) |
| GET | `/admin/events/trace` | Adm Bearer | Chronological events for `?trace_id=` / `?user_id=` / `?phone=` (phone is resolved to user_id via teachers/students lookup first) |
| GET | `/admin/events/funnel` | Adm Bearer | `?id=teacher_signup \| student_signup \| ALL`, `?days=` — step counts + drop-off |
| GET | `/admin/events/ai_usage` | Adm Bearer | Calls/day, latency p50/p95/p99, token spend, top users by cost, failure rate by surface |

Schema for every event: `{id, timestamp, source, surface, event_type, severity, user_id, user_role, user_phone, session_id, trace_id, device, country, ip, payload, error, latency_ms, ai, http, env}`. See `shared/observability.py` for full doc.

#### Training Data Admin (`functions/training_admin.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/training/list` | Adm Bearer | List recent approved teacher-graded submissions in `gs://neriah-training-data` with signed image URLs |
| GET | `/admin/training/stats` | Adm Bearer | Aggregate sample count + total bytes |

#### Keep-alive (`functions/keep_alive.py`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/internal/keep-alive` | `x-keep-alive-secret` header | Cloud Scheduler-triggered. Pings Supabase (authenticated SELECT) + Upstash (SET) so neither auto-pauses |

#### Health

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | Health check |
| OPTIONS | `/api/*` | — | CORS preflight |

### 4.5 Shared Modules (`shared/`)

| Module | Purpose |
|---|---|
| `auth.py` | JWT (HS256) encode/decode, OTP generate/hash (SHA-256), `@require_role` decorator, IP rate limit |
| `config.py` | Pydantic Settings — single source for env-var reads |
| `constants.py` | Education levels, curriculum names, country phone-digit rules |
| `country_profile.py` | Per-country curriculum / grading-style overrides (e.g. lenient marking for Grade 3) |
| `firestore_client.py` | CRUD wrappers, demo-DB switching (`NERIAH_ENV=demo`), atomic counter helpers |
| `gcs_client.py` | Upload/download, signed URLs, content-type detection |
| `gemma_client.py` | Vertex AI Gemma 4 — text + multimodal, retry with exponential backoff |
| `embeddings.py` | Vertex AI text embeddings; falls back to local Ollama in dev |
| `vector_db.py` | Firestore vector search (`rag_syllabuses` queries) |
| `models.py` | Pydantic v2 models: Teacher, Student, Class, AnswerKey, Mark, Submission, Verdict, OTPVerification, Session, Rubric |
| `observability.py` | `log_event(...)` async fire-and-forget Firestore writer; `@instrument_route(prefix, surface)` decorator wraps every Flask view to emit `<prefix>.start/success/failed` with latency + status; ULID generation; `current_trace_id()` reads `x-trace-id` header or generates a fresh one; non-throwing JWT user extraction; error fingerprinting (sha1 of type+message); module-level `ThreadPoolExecutor(max_workers=4)` so writes never block the request |
| `errors.py` | Standardised HTTP error helpers (json + status code) |
| `utils.py` | ID generation (`make_id`), string normalisation, datetime helpers |
| `submission_codes.py` | 6-char unique homework code generation with collision retry |
| `student_matcher.py` | Fuzzy-match inbound submissions to a student by name / register / phone |
| `email_client.py` | Resend wrapper for outbound email (notifications, replies, foundation) |
| `email_parser.py` | MIME parsing + attachment extraction for inbound poller |
| `whatsapp_client.py` | Meta Cloud API send + media-download helper |
| `sms_client.py` | Twilio Verify (US) + Programmable SMS (intl) |
| `pdf_pages.py` | PDF → page images via pdf2image / pypdfium fallback |
| `orientation.py` | Image orientation correction (EXIF + heuristics) |
| `annotator.py` | Pillow pipeline: ticks, crosses, score margins on the original image |
| `guardrails.py` | Output sanitisation (refusal phrasing, length checks, plain-text enforcement) |
| `weakness_tracker.py` | Updates student weakness profile (topics, error patterns) post-grading |
| `user_context.py` | Builds the `user_context` dict prepended to prompts (country, level, weakness topics) |
| `training_data.py` | Optional consented archive to a separate GCS bucket for model fine-tuning |
| `router.py` | Cross-feature routing helpers used by mobile router |

### 4.6 Firestore Collections

| Collection | Partition / key shape | Purpose |
|---|---|---|
| `teachers` | doc id = generated; lookup by `phone` (indexed) | Teacher accounts, JWT `token_version`, PIN hash |
| `students` | doc id = generated; queried by `phone`, `class_ids[]` | Student accounts; `class_ids` is an array (multi-class) |
| `classes` | queried by `teacher_id`, `school_id` | Class records; has `join_code`, `student_count`, `curriculum` |
| `answer_keys` | queried by `class_id` | Homework + marking schemes; has `submission_code`, `due_date` |
| `marks` | queried by `student_id`, `class_id`, `answer_key_id` | Per-submission grading result; `approved` gates student visibility |
| `submissions` | queried by `student_id`, `class_id`, `answer_key_id` | Submission metadata; `source ∈ {teacher_scan, student_app, whatsapp, email}` |
| `sessions` | id = phone | WhatsApp state machine (TTL ~24h) |
| `rubrics` | queried by `class_id` | Tertiary assessment rubrics |
| `submission_codes` | by `class_id` | (legacy, may be removed) |
| `otp_verifications` | id = phone | OTP state with 10-min TTL; `pending_data` carries registration payload |
| `ip_rate_limits` | id = ip | OTP request throttling per IP |
| `schools` | id = generated | Optional Firestore-side school directory (seed lives in code) |
| `push_tokens` | by `user_id` | Expo push tokens |
| `rag_syllabuses` | vector-indexed | Chunked syllabus text + embeddings for RAG |
| `terms_acceptances` | by `user_id` | Audit trail of terms-acceptance events |
| `events` | (severity, ts), (surface, ts), (user_id, ts), (user_phone, ts), (trace_id, ts), (student_id, submitted_at) | Observability event log — every backend route call, every mobile screen view + tap + API call, every Vertex AI call. Written async fire-and-forget via `shared/observability.log_event`. 90-day retention (configurable TTL). Read by `/admin/monitoring` dashboard. |
| `student_submissions` | by `student_id` (composite with `submitted_at` DESC) | Companion row to `marks` for the App / WhatsApp / Email channels — drives the student's Results tab. Teacher-scan marks now back-merge here too via the resilient `/submissions/student/<id>` endpoint. |

### 4.7 External Service Integrations

- **Vertex AI / Gemma 4** — `gemini-1.5-pro` and `gemma-2-it` deployed in `us-central1`. Multimodal calls for OCR + grading. `shared/gemma_client.py` has retry wrapper for 429/503.
- **Document AI** — `prebuilt-read` model for layout / bounding-box extraction (used in annotation step).
- **Twilio** — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER=+15186083556`, `TWILIO_VERIFY_SID`. US numbers go through Verify API (10DLC compliance); international via Programmable SMS with sender ID "Neriah".
- **Meta WhatsApp Cloud API** — production phone-number ID + access token in Secret Manager. Currently held by Meta business verification.
- **Resend** — `noreply@send.neriah.africa` for transactional mail; `RESEND_API_KEY` env var.
- **Zoho Mail IMAP** — `mark@neriah.ai` inbox, app password in Secret Manager. Polled on Cloud Scheduler.
- **Google Cloud Storage** — three buckets: `neriah-scans`, `neriah-marked`, `neriah-submissions` (names from env vars `GCS_BUCKET_*`).
- **Expo Push Service** — token-based send; no API key, just the token from `expo-notifications`.

### 4.8 Environment Variables

Set in Cloud Functions runtime (via Cloud Build) or Secret Manager. Names reflect the *current* code — `.env.example` is partly stale.

```
# GCP core
GCP_PROJECT_ID=neriah-ai-492302
GCP_REGION=us-central1
NERIAH_ENV=prod | dev | demo            # demo accepts OTP "1234"

# Firestore
FIRESTORE_DATABASE_ID=(default)         # demo uses a separate DB id

# Cloud Storage
GCS_BUCKET_SCANS=neriah-scans
GCS_BUCKET_MARKED=neriah-marked
GCS_BUCKET_SUBMISSIONS=neriah-submissions

# Vertex AI
VERTEX_LOCATION=us-central1
VERTEX_TEXT_MODEL=gemini-1.5-pro
VERTEX_VISION_MODEL=gemini-1.5-pro
VERTEX_EMBED_MODEL=text-embedding-004

# Document AI
DOCAI_PROCESSOR_ID=...

# WhatsApp
WHATSAPP_VERIFY_TOKEN=...               # Secret Manager
WHATSAPP_ACCESS_TOKEN=...               # Secret Manager
WHATSAPP_PHONE_NUMBER_ID=...            # Secret Manager
WHATSAPP_TEMPLATE_PENDING=true          # bypasses verify with "000000" while pending

# App auth
APP_JWT_SECRET=...                      # Secret Manager
JWT_EXPIRE_DAYS=365

# Twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+15186083556
TWILIO_VERIFY_SID=...

# Email — Resend (outbound)
RESEND_API_KEY=...
RESEND_FROM=Neriah <noreply@send.neriah.africa>
RESEND_NOTIFY_EMAIL=admin@neriah.ai

# Email — Zoho IMAP (inbound)
ZOHO_IMAP_HOST=imap.zoho.com
ZOHO_IMAP_USER=mark@neriah.ai
ZOHO_IMAP_APP_PASSWORD=...              # Secret Manager

# Inference fallbacks
OLLAMA_BASE_URL=http://localhost:11434  # dev only

# Admin
ADMIN_API_KEY=...                       # Bearer key on every /admin/* backend endpoint; mirrored on the website's Vercel env

# Observability + cost tracking
VERTEX_PRICE_IN_PER_M=0.30              # USD per 1M input tokens (used to compute cost_usd on vertex.call.success events)
VERTEX_PRICE_OUT_PER_M=0.60             # USD per 1M output tokens

# Training-data archive
GCS_BUCKET_TRAINING=neriah-training-data
COLLECT_TRAINING_DATA=true              # set false to disable globally (e.g. on staging)

# Supabase keep-alive (Cloud Run + Cloud Scheduler)
SUPABASE_URL=https://pxhwfuhflthnakqyotdx.supabase.co
SUPABASE_ANON_KEY=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
KEEP_ALIVE_SECRET=...                   # Cloud Scheduler sends this in `x-keep-alive-secret` header
```

**Runtime service account:** `neriah-ai-sa@neriah-ai-492302.iam.gserviceaccount.com` (pinned via `--service-account` in `cloudbuild.yaml`). Roles: `roles/aiplatform.user`, `roles/aiplatform.endpointUser`, `roles/serviceusage.serviceUsageConsumer`, `roles/datastore.user`, `roles/storage.objectAdmin` (on `gs://neriah-training-data` plus the regular buckets), `roles/secretmanager.secretAccessor`, `roles/cloudfunctions.developer`, `roles/iam.serviceAccountTokenCreator` (self-impersonation — needed for the Vertex MaaS token mint workaround in `shared/gemma_client._get_vertex_token`; see § 9.5).

### 4.9 Backend Architecture Decisions

1. **Cloud Functions Gen2, single Flask app** — pay-per-request, scales to zero, GCP-internal calls don't go through a NAT.
2. **Firestore over relational** — schemaless evolution + tight integration with vector search.
3. **OTP-based auth, no passwords** — OTP fires once at registration + on recovery only; sessions are 365-day JWTs invalidated via `token_version`.
4. **PIN as on-device convenience layer** — bcrypt-hashed; SecureStore primary, server backup; 5-attempt lockout.
5. **Approval gate before student notification** — graded mark stays `approved=false` until teacher confirms; only then push fires.
6. **Vertex AI Gemma 4** — chosen for multimodal grading + tutor; same model family runs on-device via LiteRT-LM.
7. **Education level drives grading intensity** — set at class create, inherited by all homework, surfaced to the LLM prompt.
8. **Submission codes for email routing** — 6-char per-homework code printed on the slip students hand out; eliminates fuzzy matching.
9. **Curriculum as RAG** — syllabuses chunked, embedded, stored in `rag_syllabuses` Firestore vector collection; queried during grading + scheme generation.
10. **WhatsApp state machine** — single `sessions` doc per phone with TTL; transitions documented in `docs/whatsapp-flow.md`.
11. **Country profile + grading style** — `shared/country_profile.py` lets the prompt adapt for ZIMSEC vs Cambridge vs other curricula.
12. **Demo-mode isolation** — `NERIAH_ENV=demo` swaps Firestore DB id and accepts OTP `"1234"`; never touches prod data.
13. **Training data archive** — opt-in (teacher consent) writes anonymised graded pages to a separate GCS bucket for future fine-tuning.
14. **Output guardrails** — assistant + tutor outputs go through `shared/guardrails.py` (plain text only, refusal phrasing, no medical/legal advice).
15. **Two-channel grading pipeline** — photo path (primary/secondary, multimodal vision) vs document path (tertiary, OCR-first).

---

## 5. Mobile App (`app/mobile/`)

### 5.1 Stack

- **Framework:** React Native 0.83.6 + Expo SDK 55.0.0
- **Language:** TypeScript 5.9.2
- **Navigation:** React Navigation 6.x (bottom tabs + native stack)
- **State:** React Context (Auth, Model, Language) + AsyncStorage (queues, caches) + SecureStore (JWT, PIN, language)
- **Networking:** axios 1.7.2 with JWT interceptor + 401 → logout handler
- **On-device AI:** `react-native-litert-lm` 0.3.4 (vendored Bazel rebuild)
- **OCR:** `@react-native-ml-kit/text-recognition` 1.5.2
- **File extraction:** `expo-file-system`, `jszip`, `pako` (DOCX, PDF text + scanned-render fallback, legacy .doc via `cfb`)
- **Charts:** `react-native-chart-kit`
- **Camera / picker:** `expo-camera`, `expo-image-picker`, `expo-document-picker`
- **Resilience:** `expo-keep-awake` for downloads, `expo-network` for offline detection, `@react-native-community/netinfo` for online edge

**Platforms:** iOS 14+ arm64 device only (no simulator), Android API 23+ arm64-v8a only.

**API base URL:** `https://us-central1-neriah-ai-492302.cloudfunctions.net/neriah-grading/api` (from `app.json` → `extra.apiBaseUrl`).

### 5.2 Navigation

`App.tsx` renders providers (Language → Auth → Model) then `AppShell`:

- Loading / hydrating → splash
- Not authenticated → `AuthNavigator`
- Authenticated, PIN configured, cold-start → `PinLoginScreen`
- Authenticated, no PIN, post-OTP → `PinSetupScreen` (skippable)
- Teacher → `TeacherNavigator` (bottom tabs: Classes, Analytics, Settings, Assistant)
- Student → `StudentNavigator` (bottom tabs: Home, Tutor, Results, Settings)

### 5.3 Screens (`src/screens/`)

**Auth (shared):**
- `RoleSelectScreen.tsx` — Teacher / Student picker
- `PhoneScreen.tsx` — Phone entry with country selector (auto-detect from locale, default ZW)
- `OTPScreen.tsx` — 6-digit OTP, auto-submit, "Send via SMS instead", resend cooldown
- `PinSetupScreen.tsx` — Optional PIN setup post-OTP
- `PinLoginScreen.tsx` — Cold-start unlock
- `TeacherRegisterScreen.tsx` — name + title + school picker + terms
- `StudentRegisterScreen.tsx` — name + class join code + terms

**Teacher:**
- `HomeScreen.tsx` — Class list, FAB → ClassSetup, pull-to-refresh
- `ClassSetupScreen.tsx` — Create class, pick education level
- `ClassDetailScreen.tsx` — Class drawer (students, homework, analytics shortcuts)
- `HomeworkDetailScreen.tsx` — Per-homework: submissions, marking scheme, "Mark Students" gated by answer key
- `MarkingScreen.tsx` — Student picker → ScanButton → MarkResult
- `AnalyticsScreen.tsx` — Charts via react-native-chart-kit
- `TeacherAssistantScreen.tsx` — Chat UI for `/teacher/assistant`; actions: Prepare Notes, Teaching Methods, Exam Q's, Class Performance, Chat
- `SettingsScreen.tsx` — Profile, school, language picker, Set/Reset PIN, logout, version, training-data consent

**Student:**
- `StudentHomeScreen.tsx` — Class card, open assignments, latest results
- `StudentTutorScreen.tsx` — Socratic tutor chat with multimodal support (image + question)
- `StudentResultsScreen.tsx` — Graded mark history, per-question feedback, annotated image preview. Refetches on tab focus with a 30 s stale check via `useFocusEffect` so newly approved marks appear without pull-to-refresh.
- `StudentSettingsScreen.tsx` — Profile, language, logout

**Components (`src/components/`):**
- `ScanButton.tsx` — Camera capture with frame guide overlay
- `InAppCamera.tsx` — Custom camera UI (orientation lock, tap-to-focus)
- `StudentCard.tsx` — Name + latest score with colour coding
- `MarkResult.tsx` — Annotated image + per-question verdict cards
- `CountrySelector.tsx` — Flag dropdown of supported countries
- `SchoolPickerModal.tsx` — Searchable school picker
- `LevelDisplay.tsx` — Education level badges
- `TypingIndicator.tsx` — Chat typing dots
- `ChatBubble.tsx` — Message bubble (text + attachment)
- `TrackedPressable.tsx` — Drop-in replacement for `Pressable` with `analyticsId` + `analyticsPayload` props. Calls `trackTap(surface, action, payload)` before invoking the user's `onPress`. Existing `Pressable`/`TouchableOpacity` callsites can be migrated incrementally.
- (Plus a handful of small UI primitives — Button, Input, Modal, Spinner)

### 5.4 Services (`src/services/`)

| File | Role |
|---|---|
| `analytics.ts` | Event recorder for the observability layer. `bootAnalytics()` (called from `App.tsx`) hydrates queue from AsyncStorage, schedules 30 s flush, hooks AppState background. `track`, `trackError`, `trackScreen`, `trackTap`, `setUser`, `newTraceId`, `flush`. Buffers up to 1000 events, batches 50 per POST to `/api/events/batch`. Uses its own axios instance (bypasses interceptor) to avoid recursive `api.events.batch.*` events. Sample-throttles `tap.scroll`/`tap.focus` to 10%. |
| `api.ts` | Axios client; every backend endpoint as a typed function; JWT interceptor; 401 → logout. Also: request interceptor injects `x-trace-id` + emits `api.<route>.start`; response interceptor emits `api.<route>.success` / `.failed` with `latency_ms` |
| `router.ts` | Decides cloud vs on-device per request kind. `resolveRoute('teacher_assistant' \| 'tutor' \| 'grading' \| 'scheme')` returns `'cloud' \| 'on-device' \| 'unavailable'` |
| `litert.ts` | `loadModel()`, `generateResponse()`, `generateResponseWithImage()`, prompt builders (`buildTutorPrompt`, `buildGradingPrompt`, `buildAssistantPrompt`), state subscription |
| `modelManager.ts` | Resumable downloads with `DownloadResumable` + `savable()` snapshot every 3 s, exponential-backoff retry (50 attempts), `expo-keep-awake` during downloads, post-download size verification (rejects truncated files) |
| `ocr.ts` | MLKit text-recognition wrapper |
| `clientFileExtract.ts` | Image OCR, DOCX (jszip), PDF (pako + FlateDecode regex + scanned-render fallback), legacy .doc (cfb) |
| `offlineQueue.ts` | Marking submissions queue (AsyncStorage) — replays when network returns |
| `chatOfflineQueue.ts` | Chat (assistant + tutor) queue — replays with optimistic placeholders |
| `mutationQueue.ts` | Generic mutation queue with optimistic cache patching |
| `readCache.ts` | TTL'd cache for read-heavy endpoints (analytics, lists) |
| `prefetch.ts` | Background prefetch on online edge for cold-start performance |
| `deviceCapabilities.ts` | Detects RAM, OS version, can-run-on-device |

### 5.5 State / Contexts (`src/context/`)

- `AuthContext.tsx` — JWT + user, `login`, `logout`, `setUser`, push-token register on login
- `ModelContext.tsx` — On-device model state, download progress, `loadModel`, `unloadModel`
- `LanguageContext.tsx` — `language ∈ {en, sn, nd}`, `t(key)`, persisted in SecureStore as `neriah_language`

### 5.6 Internationalisation

`src/i18n/translations.ts` — three languages, ~150 keys covering all wired screens. Switch is immediate, persisted, and applied via `useLanguage().t(key)`.

### 5.7 On-device AI (LiteRT-LM)

**Model:** Gemma 4 E2B, 2.58 GB `.litertlm` from `litert-community/gemma-4-E2B-it-litert-lm` on HuggingFace.

**iOS pipeline:**
- Vendored XCFramework at `vendor/litert-ios/LiteRTLM.xcframework` (built from LiteRT-LM `main` via `scripts/rebuild-litert-all.sh`)
- Per-slice `EngineInit/libengine_init.a` registered with `-force_load` in the podspec
- Custom C++ wrapper at `vendor/litert-cpp/HybridLiteRTLM.cpp` uses Session API instead of Conversation API to avoid an iOS-only re2 crash inside the upstream prompt-template machinery
- CPU backend only (GPU executor uses fixed-shape compiled prefill that fails for free-form Gemma 4 prompts)
- Multimodal disabled on iOS until the XCFramework is rebuilt with vision/audio executor ops

**Android pipeline:**
- Vendored AAR at `vendor/litert-android/litertlm-android.aar` (HEAD-of-main Bazel rebuild) served via a **local Maven repo** at `vendor/litert-android-maven/` — populated by the install script on every `npm install`
- `exclusiveContent` block in `android/build.gradle` routes `com.google.ai.edge.litertlm` resolution exclusively to the local repo (so Gradle never silently downloads the published AAR, which is missing 6 of the 9 arm64 `.so` files)
- Vendored Kotlin patches at `vendor/litert-android-kotlin/`:
  - `HybridLiteRTLM.kt` — omits `maxNumTokens` from `EngineConfig` to fix `DYNAMIC_UPDATE_SLICE` prefill failure
  - `LiteRTLMInitProvider.kt` — raises `onTrimMemory` threshold from `TRIM_MEMORY_RUNNING_LOW` (10) to `TRIM_MEMORY_COMPLETE` (80) so the engine survives normal backgrounding
- Multimodal enabled — vision backend hardcoded to GPU, audio to CPU

**Model lifecycle:**
- Download: `modelManager.ensureModelDownloaded()` with `DownloadResumable`, periodic `savable()` snapshot to AsyncStorage, expo-keep-awake during download, 50-attempt exponential-backoff retry, post-download size verification (deletes truncated files)
- Wi-Fi only (cellular costs would be prohibitive)
- Cached locally; loaded once per cold-start and kept in memory until OS forces eviction

**Router strategy:**
- `router.resolveRoute(kind)` returns `'cloud' | 'on-device' | 'unavailable'`
- Online → cloud (always wins; on-device is a fallback)
- Offline + model loaded → on-device
- Offline + no model → queue (re-fires when online edge fires)

### 5.8 Build Scripts

- `scripts/install-litert-frameworks.sh` — runs from `npm install` (postinstall). Copies vendored iOS XCFramework + EngineInit + cpp wrapper + podspec, populates the Android local Maven repo from the canonical AAR, copies the patched Kotlin files, copies the vendored library `build.gradle`, and patches the consuming app's `android/build.gradle` to add the `exclusiveContent` rule.
- `scripts/rebuild-litert-all.sh` — manual: clones LiteRT-LM main, runs Bazel for iOS arm64 + simulator + Android arm64, splices outputs (and LFS-pulled prebuilt accelerators) into the vendored XCFramework + AAR. Run only when bumping the LiteRT-LM SHA.
- `patches/react-native-litert-lm+0.3.4.patch` — patch-package overlay for the iOS-side cpp wrapper, podspec, and bundled binary stubs.

### 5.9 Mobile Architecture Decisions

1. **Two-tier inference router** — cloud first, on-device fallback, queue if neither.
2. **Pre-graded marking on offline path** — verdicts computed locally, replayed when online so backend records consistent state.
3. **Multi-page submissions (v2 queue schema)** — pages stored as separate blobs, aggregated on backend.
4. **Resumable model downloads** — `savable()` snapshots survive process kill, screen-lock, and Wi-Fi flicker. expo-keep-awake prevents OS-level interruption.
5. **CPU on iOS, GPU on Android** — iOS GPU executor uses fixed-shape prefill that fails for our prompts.
6. **Session API on iOS, Conversation API on Android** — iOS Conversation API hits a re2 crash inside the prompt-template machinery; Session API takes raw InputData and we format Gemma chat turns ourselves.
7. **Optimistic mutation queue** — UI updates immediately; reverts on server error.
8. **Cold-start cache warm-up** — read cache hydrated from AsyncStorage; first paint avoids a network spinner.
9. **PIN as cold-start gate** — separate from auth (you're still logged in); SecureStore is primary, server backup ensures recovery from app reinstall.
10. **Gemma 4 E2B for all on-device inference** — E4B is too big for typical Android RAM; one model, three uses (grading, tutor, assistant).
11. **MLKit OCR client-side** — no Document AI round-trip needed for offline reading; outputs feed straight into the prompt.
12. **i18n via context, not a library** — small key set, three languages, no need for i18next overhead.

---

## 6. Marketing Website (`neriah-website/`)

### 6.1 Stack

- **Framework:** Next.js 15.2.6 (App Router)
- **Language:** TypeScript (strict)
- **Styling:** Tailwind CSS 3.4 + Fraunces (display) + DM Sans (body)
- **Hosting:** Vercel — production domain `neriah.ai`
- **CMS:** Sanity 4.x (blog + foundation updates)
- **DB:** Supabase PostgreSQL (contact form + newsletter)
- **Email:** Resend
- **Rate limiting:** Upstash Redis
- **Auth:** NextAuth (Google) for `/studio`; JWT cookie for `/admin/curriculum`

### 6.2 Public Pages

| Route | Purpose |
|---|---|
| `/` | Hero, stats, problem, how it works, channels, pricing, foundation, blog preview, contact CTA |
| `/product` | 6-step workflow + channels + analytics + FAQ |
| `/pricing` | Starter ($29), Growth ($99), Institution ($400) |
| `/about` | Tinotenda + Kundai bios |
| `/foundation` | Exercise-book exchange programme stats |
| `/blog` + `/blog/[slug]` | Sanity-driven blog with ISR (revalidate 3600 s) |
| `/contact` | Form: name, WhatsApp w/ 52 African country codes, email, school, city, role, subject, message, consent + honeypot |
| `/legal`, `/privacy` (redirect), `/terms` (redirect) | Combined legal page with Privacy / Terms / Delete Account tabs |
| `/studio/[[...tool]]` | Sanity Studio (NextAuth-gated to `ALLOWED_STUDIO_EMAILS`) |
| `/admin` | **Admin hub** — landing page with cards linking to every admin tool. Single-source for adding new tools (edit the `TOOLS` array). |
| `/admin/curriculum` | Curriculum admin UI (cookie-auth gated to `@neriah.ai`) |
| `/admin/monitoring` | Monitoring dashboard — five tabs: Live feed, Errors, Funnels, AI usage, Per-user trace |
| `/admin/training` | Training-data viewer — thumbnail grid of approved teacher-graded submissions in `gs://neriah-training-data` with signed-URL previews |

### 6.3 API Routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/contact` | POST | Form → Supabase + Resend (notification + confirmation); CORS gated; tiered rate limit |
| `/api/newsletter` | POST | Signup → Supabase upsert + Resend; 3/hour/IP rate limit |
| `/api/revalidate` | POST | Sanity webhook → Next.js ISR + IndexNow ping (key `83f71b7e-96f3-4632-8585-2b235b7bc817`) |
| `/api/auth/[...nextauth]` | * | NextAuth Google OAuth |
| `/api/admin/login` | POST | JWT session for curriculum admin (8 h, progressive lockout) |
| `/api/admin/logout` | POST | Clear cookie |
| `/api/admin/verify` | GET | Check session |
| `/api/admin/curriculum` | GET / POST / DELETE | Proxy to Cloud Functions `/curriculum/*` (uses `ADMIN_API_KEY`) |
| `/api/admin/events` | GET | Proxy to `/admin/events/list` |
| `/api/admin/events/errors` | GET | Proxy to `/admin/events/errors` |
| `/api/admin/events/trace` | GET | Proxy to `/admin/events/trace` |
| `/api/admin/events/funnel` | GET | Proxy to `/admin/events/funnel` |
| `/api/admin/events/ai_usage` | GET | Proxy to `/admin/events/ai_usage` |
| `/api/admin/training` | GET | Proxy to `/admin/training/list` (or `?stats` → `/admin/training/stats`) |

### 6.4 Components

- **Layout:** `Navbar`, `Footer`
- **Sections:** `HeroSection`, `StatsBand`, `ProblemSection`, `HowItWorks`, `ChannelsSection`, `PricingSection`, `FoundationSection`, `ContactSection`, `BlogPreview`
- **Forms:** `ContactForm` (Zod + react-hook-form + 52-country WhatsApp picker + honeypot), `NewsletterForm`
- **Blog:** `PortableText` (custom Sanity renderer)
- **UI:** `ScrollReveal`, `ScrollProgress`, `EngineDiagram`
- **SEO:** `JsonLd` (Organization, BlogPost, Breadcrumb, SoftwareApplication, Product FAQ schemas)

### 6.5 Lib

- `lib/sanity/{client,queries,image}.ts` — two clients (authenticated + public), GROQ queries for posts and foundation updates
- `lib/supabase/client.ts` — service-role admin client
- `lib/email/resend.ts` — `sendContactNotification`, `sendContactConfirmation`, `sendNewsletterConfirmation`
- `lib/validators/contact.ts` — Zod schemas

### 6.6 SEO / Analytics / Security

- Vercel Analytics + Speed Insights embedded in root layout
- `next-sitemap` postbuild generates sitemap + robots.txt (excludes `/api`, `/studio`, `/admin`)
- IndexNow ping on blog publish
- Strict CSP, HSTS preload, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy blocks camera/mic/geo/cohort, X-Frame-Options DENY

### 6.7 Web Architecture Decisions

1. **App Router (not Pages)** — modern Next.js, server components by default, RSC streams.
2. **Sanity for blog** — non-technical co-founders can edit; webhook-driven ISR, no redeploys.
3. **Supabase for forms** — managed Postgres with RLS, no infrastructure to manage.
4. **Resend** — better deliverability than SES at this volume; SPF + DKIM verified for `send.neriah.africa`.
5. **Upstash Redis** — serverless rate limiting; tiered (short / medium / long) for forms.
6. **Honeypot field returns 200 on filled** — bots think they succeeded.
7. **Admin proxy pattern** — `ADMIN_API_KEY` never reaches the browser; all curriculum requests go through `/api/admin/curriculum/*`.
8. **Domain-restricted CMS access** — `ALLOWED_STUDIO_EMAILS` whitelist, all required to be `@neriah.ai`.
9. **`--legacy-peer-deps` is mandatory** — peer-dep conflicts (styled-components, recharts) require it.

---

## 7. Infrastructure & DevOps

### 7.1 Build & Deploy

- **Backend:** `cloudbuild.yaml` → `gcloud functions deploy neriah-grading --gen2 ...`. Secrets (WhatsApp + JWT) injected from Google Secret Manager. **Runtime SA pinned to `neriah-ai-sa@$PROJECT_ID.iam.gserviceaccount.com`** via `--service-account` flag (added 2026-05-04).
- **Web:** Vercel auto-deploy on main branch push. `vercel.json` is `{}` — defaults only. The repo-root `.vercelignore` patterns must be **anchored with leading `/`** — unanchored `app/` matches `neriah-website/app/` too and would exclude every Next.js page from the deploy.
- **Mobile:** EAS Build for store builds; local `./gradlew assembleDebug` or `npx expo run:android` for dev. iOS uses Xcode signing.
- **Keep-alive (two redundant sources):**
  - **Cloud Scheduler `keep-alive-daily`** — runs `09:00 UTC` daily, hits `/api/internal/keep-alive` with `x-keep-alive-secret`. The endpoint runs an authenticated `SELECT id FROM contact_submissions LIMIT 1` against Supabase + a `SET keepalive 1` against Upstash. Both must register actual queries — Supabase counts only real DB activity for pause-prevention.
  - **GitHub Actions `Keep Services Alive`** (`.github/workflows/keep-alive.yml`) — same hits, also daily at 09:00 UTC. Backup so either source can be down without the database pausing. Requires `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` GitHub repo secrets.
- **Monitoring:** Real observability lives at `/admin/monitoring` (Live feed, Errors, Funnels, AI usage, Per-user trace). Cloud Logging tail via `gcloud functions logs read neriah-grading --region=us-central1 --gen2`.

### 7.2 Deprecated Infrastructure

- `infra/` — Azure Bicep templates (Cosmos, Blob, Functions, OpenAI, Document Intelligence, APIM). **Not deployed**, kept as historical reference. The successor is `cloudbuild.yaml`.
- `backend/` — older Azure Functions v2 source. **Not deployed.** The successor is `functions/` + `main.py`.
- `scripts/deploy.sh` — Azure-era deploy orchestrator. Use `cloudbuild.yaml` instead.

### 7.3 Firestore Indexes (`firestore.indexes.json`)

```
classes:              (teacher_id, created_at) ASC
classes:              (school_id, created_at) ASC
students:             (class_id, created_at) ASC
answer_keys:          (class_id, created_at) ASC
marks:                (class_id, timestamp) ASC
marks:                (student_id, timestamp) ASC
marks:                (student_id, approved ASC, timestamp DESC)
marks:                (answer_key_id, timestamp) ASC
teachers:             (school_name, created_at) ASC
events:               (severity, timestamp DESC)
events:               (surface, timestamp DESC)
events:               (user_id, timestamp ASC)
events:               (user_phone, timestamp ASC)
events:               (trace_id, timestamp ASC)
student_submissions:  (student_id ASC, submitted_at DESC)
```

Plus the implicit Firestore vector index on `rag_syllabuses` (created via `scripts/create_vector_indexes.py`).

### 7.4 Scripts (root `scripts/`)

| Script | Purpose | When to run |
|---|---|---|
| `seed_dev.py` | Seeds Firestore with sample teachers / classes / students / answer keys | Fresh dev setup |
| `create_vector_indexes.py` | Creates Firestore vector indexes for `rag_syllabuses` | One-shot per project |
| `index_syllabuses.py` | Reads PDFs from `syllabuses/`, chunks + embeds + writes to `rag_syllabuses`. `--dry-run`, `--force` | After adding syllabuses |
| `backfill_class_id.py` | One-time: adds `class_id` to legacy Marks for analytics queries | Schema migration |
| `migrate_names.py` | One-time: splits `name` → `first_name` + `surname` | Schema migration |
| `pre-push.sh` | Git pre-push hook running pytest | Install via `cp scripts/pre-push.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push` |
| `deploy.sh` | Azure deploy (deprecated) | Don't use |

### 7.5 Tests (`tests/`)

`pytest`-based suite, 14 test modules. `tests/conftest.py` sets env vars + fixtures. Tests use `@feature_test` decorator for categorisation. Skipped automatically when Ollama (local embeddings) is unavailable.

```
test_grading.py                  Verdict / scoring / feedback
test_multi_page_grading.py       Page-by-page OCR + aggregation
test_homework_creation_flow.py   End-to-end homework setup
test_email_submission.py         Inbound email routing
test_rag_connectivity.py         Syllabus indexing + retrieval
test_curriculum_options.py       Curriculum + level validation
test_student_lookup.py           Student fuzzy matching
test_classes_by_school.py        School hierarchy queries
test_teacher_daily_flow.py       Full teacher workflow
test_homework_approved_count.py  Approval state aggregation
test_guardrails_phase1.py        OCR / image quality guardrails
test_guardrails_phase2.py        Country / level / rubric guardrails
test_role_invariants.py          Role-based access enforcement
test_integration.py              Cross-module integration
```

Run: `cd /Users/tinotendamaisiri/Desktop/neriah-ai && source .venv/bin/activate && pytest`.

### 7.6 Data

- **`syllabuses/`** — 30 Zimbabwean curriculum PDFs (Primary, O-Level, A-Level). Indexed by `scripts/index_syllabuses.py` into `rag_syllabuses`.
- **`samples/`** — `question_paper.jpg`, `student_submission.jpg`, `student_submission_2.jpg` + `create_placeholders.py`. Currently placeholders; replace with real (consented) school images.
- **`notebooks/neriah_demo.ipynb`** — Generated by `notebooks/_build_notebook.py`. Walks through OCR → grading → annotation. Don't hand-edit the .ipynb.
- **`kaggle_notebook.ipynb`** — Mirror of the demo notebook hosted on Kaggle for the Gemma 4 hackathon.
- **`batch_job/Dockerfile`** — Container for the batch grading worker (used when on-demand timeouts hurt). Base `python:3.11-slim` + Pillow / OpenCV native deps.

### 7.7 Internal Docs (`docs/`)

| Doc | Summary |
|---|---|
| `docs/architecture.md` | High-level system design |
| `docs/data-models.md` | Firestore / Cosmos schema rationale |
| `docs/whatsapp-flow.md` | Conversation state machine with worked examples |
| `docs/email-channel-setup.md` | Operational steps for Zoho IMAP + Resend |
| `TECHNICAL_REFERENCE.md` | **STALE** — Apr 2026 Azure-era full reference; grading-pipeline detail is still useful, but routes / env vars are wrong |
| `functionality_audit_report.md` | **STALE** — Apr 2026 mobile-vs-web parity audit |

---

## 8. Local Development

### 8.1 Backend

```bash
cd /Users/tinotendamaisiri/Desktop/neriah-ai
source .venv/bin/activate
functions-framework --target=neriah --debug
# or for one-off tests:
pytest
```

Required local env (set in `.env`): `GCP_PROJECT_ID`, `GCP_REGION`, app-default-credentials via `gcloud auth application-default login`, plus the secret-manager values used by whichever code path you're testing.

### 8.2 Mobile

```bash
cd app/mobile
npm install                       # runs postinstall: patch-package + install-litert-frameworks.sh
npx expo prebuild                 # regenerates android/ + ios/
# Android:
cd android && ./gradlew assembleDebug
# iOS:
cd ios && pod install && open Neriah.xcworkspace      # then Run in Xcode

# Or with Expo dev client:
npx expo run:android
npx expo run:ios
```

Notes:
- iOS arm64 device only — register your device in Xcode → Apple ID → Team.
- Android arm64-v8a only — debug APK is ~250 MB because of bundled `.so` files.
- After every `expo prebuild` (which regenerates `android/`), run `bash scripts/install-litert-frameworks.sh` to re-apply the Gradle patches and Kotlin overlays.

### 8.3 Web

```bash
cd neriah-website
npm install --legacy-peer-deps
npm run dev      # localhost:3000
```

### 8.4 Tail Logs

- **Backend:** `gcloud functions logs read neriah-grading --region=us-central1 --gen2 --limit=80`
- **Mobile (Android):** `adb logcat ReactNativeJS:V *:S` or `adb logcat -s ReactNativeJS:*` filtered with grep
- **Mobile (iOS):** Console.app or `npx react-native log-ios`
- **Web:** Vercel dashboard → Functions tab

---

## 9. Current Build State (2026-05-04)

### 9.1 Production / live

- Backend deployed at `https://us-central1-neriah-ai-492302.cloudfunctions.net/neriah-grading` (running as `neriah-ai-sa`, ~95+ instrumented routes)
- Marketing site live at `https://neriah.ai`
- Admin hub live at `https://neriah.ai/admin` → links to Monitoring, Curriculum, Training data
- Mobile app: iOS dev build runs on registered device; Android release APK builds clean and runs on Samsung test device with full observability + JS bundle baked in (no Metro needed)
- 30 syllabus PDFs indexed in `rag_syllabuses`
- 15 Firestore composite indexes deployed (added 6 for `events` + 1 for `student_submissions` on 2026-05-04)
- Twilio SMS OTP live (US Verify + intl Programmable SMS as "Neriah")
- Resend `send.neriah.africa` verified (DKIM + SPF)
- Supabase contact + newsletter tables live, kept alive by daily cron + GH Actions
- Sanity Studio + blog live
- Vertex AI Gemma 4 26B MaaS calls succeeding (cloud tutor, teacher assistant, grading)
- Training-data archive bucket `gs://neriah-training-data` provisioned + wired to approval cascade

### 9.2 Held by external dependencies

- **Meta WhatsApp business verification** — blocks WhatsApp OTP and the WhatsApp bot. Code is ready; once Meta approves, switch the OTP `channel_preference` default to `whatsapp` and submit the `neriah_otp` template.
- **Vertex AI MaaS Gemma 4 is in public preview** — pricing + SLA could change. Self-hosted Vertex endpoint is the migration path once active teachers exceed ~500.

### 9.3 Recent fixes (2026-05-03)

- Android Gemma 4 inference fixed by omitting `maxNumTokens` from `EngineConfig` (prevents `DYNAMIC_UPDATE_SLICE` failure).
- Android engine survives backgrounding (`LiteRTLMInitProvider.kt` raised threshold from `RUNNING_LOW`=10 to `COMPLETE`=80).
- Android build pipeline switched from "strip the cached Maven AAR" hack to a vendored local Maven repo with `exclusiveContent` filter — durable, no cache-mutation, builds reproducibly across machines.
- Resumable model downloads with `savable()` + expo-keep-awake + 50-attempt exponential backoff (Africa-grade unstable connection support).
- Offline file extraction for images, PDFs (text + scanned), DOCX, and legacy .doc binary.

### 9.4 Recent fixes (2026-05-04)

#### Cloud AI / Vertex
- **Vertex MaaS 403 → fixed.** The Cloud Run runtime SA's metadata-server token was being rejected by Vertex AI's OpenAI-compat endpoint (`/v1/projects/.../locations/global/endpoints/openapi/chat/completions`) with a generic `PERMISSION_DENIED`, even though the same SA's token minted via gcloud impersonation worked. Workaround: `shared/gemma_client._get_vertex_token()` now self-impersonates via `iamcredentials.googleapis.com:generateAccessToken` (the IAM Credentials API) instead of using the metadata-server token directly. Requires `roles/iam.serviceAccountTokenCreator` on `neriah-ai-sa` granted **to itself**. Also adds explicit `cloud-platform` scope, quota-project pin, and `x-goog-user-project` header.
- **Dedicated runtime SA.** `cloudbuild.yaml` now pins `--service-account=neriah-ai-sa@$PROJECT_ID.iam.gserviceaccount.com` so deploys don't drift back to the Compute Engine default SA. Roles granted: `aiplatform.user`, `aiplatform.endpointUser`, `serviceusage.serviceUsageConsumer`, `secretmanager.secretAccessor`, `iam.serviceAccountTokenCreator` (self), plus the existing `datastore.user`, `storage.objectAdmin`, `cloudfunctions.developer`.
- **Empty-bubble fix.** `functions/teacher_assistant._call_model` was catching every exception and returning `""` — the route shipped that as `response: ""` and the mobile rendered a silent empty bubble. Now the function raises and the route returns a real 503 with `error: "AI assistant is temporarily unavailable. Please try again."`. Tutor side already raised properly via `classify_vertex_exception` — no change there.
- **JSON-fence stripping in user-visible text.** Added `_strip_code_fence`, `_json_to_plain_text`, `_sanitize_user_visible_text` helpers in `functions/teacher_assistant.py` to flatten any leftover `\`\`\`json ... \`\`\`` blocks the model returns. Used by both `/teacher/assistant` and `/tutor/chat`. Mobile `stripMarkdown` in `TeacherAssistantScreen.tsx` and `StudentTutorScreen.tsx` was also extended to strip fences as a defensive layer.
- **Long-generation timeouts.** Mobile axios bumped to **180 s** for `/tutor/chat` and `/teacher/assistant` (was 35 s and 90 s respectively); backend `requests.post` to Vertex bumped to **240 s** (was 120 s). Long quizzes / lesson notes can take 120 s+ on Gemma 4 26B and were aborting client-side before completing.
- **Vertex retry on 403.** Added 403 to `_VERTEX_RETRY_STATUSES` because Vertex MaaS preview returns intermittent 403s for the same SA + scope that worked moments earlier; treat as transient with exponential backoff.

#### Observability
- **Full observability stack shipped.** Every backend route + mobile screen + AI call now writes to Firestore `events`. Async fire-and-forget. ULID + trace_id propagation across mobile → backend boundaries via `x-trace-id` header.
- **89 backend routes instrumented** with `@instrument_route` across all 16 blueprints.
- **Mobile analytics service** at `app/mobile/src/services/analytics.ts` with offline buffer + 30 s flush; axios interceptor; NavigationContainer screen tracking; `<TrackedPressable>` for taps; LiteRT lifecycle events.
- **Vertex AI cost telemetry.** Every Gemma 4 call emits `vertex.call.success/retry/failed` with `prompt_tokens`, `completion_tokens`, and `cost_usd` (via `VERTEX_PRICE_IN_PER_M` / `VERTEX_PRICE_OUT_PER_M` env vars).
- **Admin monitoring dashboard live** at `/admin/monitoring`. Five tabs: Live feed (auto-refresh 5s), Errors (grouped by stack-trace fingerprint, 1h/24h/7d windows), Funnels (`teacher_signup`, `student_signup`, drop-off %), AI usage (calls/day chart, p50/p95/p99 latency, token spend, top users by cost, failure rate by surface), Per-user trace (chronological timeline by phone / user_id / trace_id).

#### Admin surface
- **Admin hub at `/admin`.** Single landing page with cards linking to Monitoring, Curriculum, Training data. Adding a new tool is a one-line edit to the `TOOLS` array in `app/admin/page.tsx`.
- **Training-data archive viewer at `/admin/training`.** Browses `gs://neriah-training-data`, shows thumbnail grid with AI vs teacher score, click for full-size + metadata. Backend endpoint `functions/training_admin.py` lists samples with signed URLs (1 h expiry) so the bucket stays private.
- **Training bucket created.** `gs://neriah-training-data` (Nearline, us-central1, uniform bucket-level access). `shared/training_data.collect_training_sample` was already wired into the approval cascade — it had been failing silently because the bucket didn't exist; every approval since the bucket was provisioned populates the archive.

#### Student-side fixes
- **Results screen now shows teacher-scan marks.** `/api/submissions/student/<id>` was only reading `student_submissions`; teacher-scanned marks have a `marks` row but no companion. Endpoint now merges approved Marks not represented in `student_submissions` and returns them with synthesised graded entries. Wrapped the `student_submissions` query in try/except so a missing index never returns 500 — falls back to approved-marks only.
- **Missing Firestore index for `student_submissions`** (`student_id ASC, submitted_at DESC`) created.
- **Student tap-to-view-feedback no longer logs the user out.** `GET /api/marks/<mark_id>` previously required teacher JWT; tapping a graded entry hit it with student JWT, returned 401, axios interceptor mapped 401 → AuthContext logout. Endpoint now accepts both roles with the right authorization (teacher: must own the mark; student: must be the student on it AND mark must be `approved=True`).
- **`StudentResultsScreen` refetches on tab focus** with a 30 s stale check via `useFocusEffect` — fix or new approval propagates without pull-to-refresh.

#### Infra
- **Vercel `.vercelignore` patterns anchored.** Unanchored `app/` was matching both `/app/` (mobile, intended) AND `neriah-website/app/` (every Next.js page, NOT intended) — that broke production with cached 404s on every route. Patterns now use leading `/` to anchor at the deploy root.
- **Supabase + Upstash keep-alive** wired on two redundant paths: Cloud Scheduler `keep-alive-daily` calling `/api/internal/keep-alive` (Cloud Function endpoint), and updated GitHub Actions workflow with authenticated SELECT (was hitting `/rest/v1/` root which doesn't count as activity). Project will not pause again as long as either source runs.
- **Cloud Build SA permissions** — granted `roles/secretmanager.secretAccessor` so deploys can access `WHATSAPP_*` and `APP_JWT_SECRET` secrets.

### 9.5 Backlog

- [ ] Bulk scanning — photograph multiple student books in rapid succession
- [ ] Editable marks UI — teacher overrides on individual question verdicts
- [ ] Class-performance summaries on demand (currently lazily computed in analytics)
- [ ] Push notifications on new student submissions (token side wired; trigger side TODO)
- [ ] Automated report-card generation (PDF)
- [ ] Parent notification system
- [ ] Meta WhatsApp business verification (blocks WhatsApp OTP + bot)
- [ ] WhatsApp template `neriah_otp` — submit for Meta approval after verification
- [ ] EcoCash payment integration
- [ ] iOS multimodal — rebuild XCFramework with vision/audio executor ops
- [ ] Replace placeholder images in `samples/` with real consented school photos
- [ ] Migrate `TECHNICAL_REFERENCE.md` to current GCP architecture (or delete)
- [ ] Migrate `functionality_audit_report.md` to current state (or delete)
- [ ] Phase 3 monitoring: Slack alerts on critical errors, WebSocket live tail (replace 5 s polling), session replay
- [ ] Migrate existing `Pressable` / `TouchableOpacity` callsites to `TrackedPressable` for full tap coverage (component is shipped, migration is incremental)
- [ ] `cloudbuild.yaml` cleanup: switch from `--set-env-vars` (which would wipe live config) to `--update-env-vars` + `--set-secrets` referencing only secrets that exist (today's deploys use `gcloud functions deploy` directly to avoid this; cloudbuild path is stale)

---

## 10. Conventions

- **Phone numbers** are always E164 (`+263771234567`). Country digit-rules enforced server-side.
- **IDs** are Firestore-generated unless the doc has a natural key (sessions = phone, otp_verifications = phone).
- **Dates / timestamps** are ISO 8601 strings (`datetime.utcnow().isoformat()`).
- **Currency** in pricing copy is USD to avoid ZWL volatility.
- **Markdown is forbidden** in any AI-generated user-facing text — assistant + tutor prompts enforce plain text + simple bullets (`-` or `•`, never `*`).
- **Refusals** for medical / legal advice come from `shared/guardrails.py`; never let raw model text through unfiltered.
- **JWT** — HS256, 365-day expiry, payload `{sub, role, token_version, iat, exp}`. `token_version` bumped on phone change / logout-all.
- **Education levels** drive grading intensity. Set on the class, inherited by all homework.
- **Submission codes** (HW7K2P) are 6-char unique per homework — printed on the slip students take home, used by email channel.

---

## 11. Where to Start When You Open the Repo

1. **Frontend bug?** → `app/mobile/src/screens/` for UI, `app/mobile/src/services/api.ts` for the API call.
2. **Backend bug?** → `functions/<feature>.py` for the route, `shared/<module>.py` for the helper.
3. **AI behaviour issue?** → cloud path: `functions/teacher_assistant.py` or `functions/tutor.py` or `functions/mark.py` + `shared/gemma_client.py`. On-device: `app/mobile/src/services/litert.ts` (prompts + loader).
4. **Build issue (Android)?** → `app/mobile/scripts/install-litert-frameworks.sh` + `app/mobile/vendor/litert-android-build/build.gradle`.
5. **Build issue (iOS)?** → `app/mobile/vendor/litert-cpp/HybridLiteRTLM.cpp` + `app/mobile/vendor/litert-podspec/`.
6. **Marketing copy / blog?** → Sanity Studio at `neriah.ai/studio` (NextAuth login).
7. **Curriculum admin?** → `neriah.ai/admin/curriculum` (cookie auth).
8. **Logs?** → first stop is `https://neriah.ai/admin/monitoring` (Live feed + Errors tab). Cloud Logging fallback: `gcloud functions logs read neriah-grading --region=us-central1 --gen2`.
9. **Want to know a specific user's history?** → `/admin/monitoring` → Per-user trace tab → enter phone or user_id.
10. **Want to see what AI is costing per day?** → `/admin/monitoring` → AI usage tab.
11. **Want to spot-check what's getting archived for training?** → `/admin/training`.

---

*This file is loaded into every Claude session. Keep it accurate. When the architecture changes, update this file in the same PR.*
