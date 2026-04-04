# CLAUDE.md — Neriah Project Context

> Keep this file up to date. Every new file added to the project must be reflected in **Section 3 (File Structure)**.

---

## 1. What Neriah Is

Neriah is an AI-powered homework marking assistant built for African teachers. Teachers photograph a student's exercise book; Neriah OCRs the page, grades every answer against a stored answer key, draws ticks and crosses directly onto the original photo, and returns the annotated image with a score — in under 30 seconds.

**Dual channel:**
- **App (primary):** React Native mobile app + React web dashboard. Full-featured: class management, answer key upload, bulk marking, analytics, subscription management.
- **WhatsApp bot (lightweight fallback):** Teachers who cannot or do not want to install an app can run the full marking flow over WhatsApp. Same backend, same pipeline.

**Business model:** $5 USD/month per teacher. Launching in Zimbabwe, expanding across SADC.

**Core value proposition:** A teacher with a class of 40 students can mark a full exercise in the time it takes to photograph each book. No manual scoring, no late nights marking.

---

## 2. Tech Stack

| Layer | Service / Library | Version / Notes |
|---|---|---|
| Backend runtime | Azure Functions v2 | Python 3.11, consumption plan |
| Database | Azure Cosmos DB | NoSQL, serverless, Core (SQL) API |
| File storage | Azure Blob Storage | Two containers: `scans` (raw), `marked` (annotated) |
| OCR | Azure AI Document Intelligence | `prebuilt-read` model, returns text + bounding boxes |
| LLM | Azure OpenAI Service | GPT-4o-mini, deployment name configurable via env |
| Messaging | WhatsApp Cloud API (Meta) | Webhook receiver, send-message via Graph API |
| Gateway | Azure API Management | Webhook receiver, rate limiting, JWT validation |
| Mobile app | React Native (Expo) | SDK 51, TypeScript |
| Web dashboard | React + Vite | TypeScript, Tailwind CSS |
| Payments | EcoCash API | Zimbabwe mobile money |
| Image annotation | Pillow (PIL) | Draws markup onto original JPEG in memory |
| Monitoring | Azure Monitor + Application Insights | Structured logging via `logging` module |
| IaC | Azure Bicep | All infra declared in `infra/` |
| Auth | Phone number as identity (WhatsApp) | JWT (HS256) for App sessions |
| Python deps | See `backend/requirements.txt` | pydantic v2, openai SDK v1+, azure-functions v2 |

---

## 3. Project File Structure

```
neriah/
├── CLAUDE.md                          ← project context for Claude Code sessions
├── README.md                          ← public-facing project overview
├── .env.example                       ← template for all environment variables
├── .gitignore

├── infra/                             ← Azure Bicep IaC
│   ├── main.bicep                     ← root module, wires all sub-modules
│   ├── parameters/
│   │   ├── dev.bicepparam             ← dev environment parameter values
│   │   └── prod.bicepparam            ← prod environment parameter values
│   └── modules/
│       ├── functions.bicep            ← Azure Functions + App Service Plan
│       ├── cosmos.bicep               ← Cosmos DB account + containers
│       ├── storage.bicep              ← Blob Storage account + containers
│       ├── openai.bicep               ← Azure OpenAI account + deployment
│       ├── document_intelligence.bicep← Azure AI Document Intelligence resource
│       └── api_management.bicep       ← APIM instance + webhook policy

├── backend/
│   ├── host.json                      ← Azure Functions host configuration
│   ├── local.settings.json.example   ← local dev settings template (never commit real values)
│   ├── requirements.txt               ← Python dependencies
│   ├── shared/
│   │   ├── __init__.py                ← empty package init
│   │   ├── config.py                  ← env var loading via pydantic BaseSettings
│   │   ├── models.py                  ← Pydantic models: Teacher, Student, Class, Mark, AnswerKey, OTPVerification, etc.
│   │   ├── auth.py                    ← JWT (HS256) + OTP utilities: create_jwt, decode_jwt, require_role, generate_otp
│   │   ├── cosmos_client.py           ← CosmosDB CRUD helpers (upsert, get, query, delete)
│   │   ├── blob_client.py             ← Blob upload/download helpers
│   │   ├── ocr_client.py              ← Azure Document Intelligence wrapper — returns text + bounding boxes
│   │   ├── openai_client.py           ← Azure OpenAI: grading, scheme generation, image quality check
│   │   ├── annotator.py               ← Pillow pipeline: draws ticks, crosses, scores onto original photo
│   │   ├── whatsapp_client.py         ← WhatsApp Cloud API send-message helper
│   │   ├── sms_client.py              ← Azure ACS SMS — sends OTP codes; logs to stdout if no number configured
│   │   ├── push_client.py             ← Expo push notifications: send_push_notification, send_push_batch
│   │   ├── document_extractor.py      ← Detect doc type + extract text from PDF/DOCX/image
│   │   ├── feedback_generator.py      ← Generate PDF feedback report from grading verdicts
│   │   └── email_client.py            ← Azure ACS Email: send draft to lecturer, feedback to student, welcome email
│   ├── function_app.py                ← Azure Functions v2 entry point — registers all 34 routes
│   └── functions/
│       ├── whatsapp_webhook.py        ← GET+POST /api/whatsapp — WA verification + full state machine
│       ├── mark.py                    ← POST /api/mark — full marking pipeline (App channel)
│       ├── marks.py                   ← PUT /api/marks/{mark_id} — teacher review + approve student submission
│       ├── classes.py                 ← GET/POST /api/classes, PUT/DELETE /api/classes/{id}, GET+POST /api/classes/join
│       ├── students.py                ← GET/POST /api/students, PUT/DELETE /api/students/{id}, POST /api/students/batch
│       ├── answer_keys.py             ← GET/POST /api/answer-keys, PUT/DELETE /api/answer-keys/{id}
│       ├── analytics.py               ← GET /api/analytics — per-class and per-student stats
│       ├── assignments.py             ← GET /api/assignments — open assignments for student (student JWT)
│       ├── student_submissions.py     ← POST/GET/DELETE /api/submissions/student, GET /api/marks/student/{id}
│       ├── submissions.py             ← GET/POST /api/submissions (tertiary), POST /api/submissions/{id}/approve
│       ├── auth.py                    ← POST /api/auth/register|login|verify|resend-otp, GET /api/auth/me
│       ├── student_auth.py            ← POST /api/auth/student/lookup|activate|register
│       ├── push.py                    ← POST /api/push/register — store Expo push token
│       └── email_webhook.py           ← POST /api/email-webhook — inbound email via Event Grid

├── app/
│   ├── mobile/                        ← React Native (Expo SDK 51)
│   │   ├── package.json               ← deps: expo-notifications, expo-constants, netinfo, vector-icons
│   │   ├── app.json                   ← extra.apiBaseUrl points to APIM dev endpoint
│   │   ├── App.tsx                    ← auth gate: AuthStack if no JWT, RootStack+MainTabs if authenticated
│   │   └── src/
│   │       ├── context/
│   │       │   └── AuthContext.tsx    ← JWT + user state, login/logout, push token registration on login
│   │       ├── screens/
│   │       │   ├── PhoneScreen.tsx    ← phone entry → login OTP or register flow (auto-detects new user)
│   │       │   ├── OTPScreen.tsx      ← 6-digit OTP input, auto-submit, resend with cooldown
│   │       │   ├── HomeScreen.tsx     ← class list, pull-to-refresh, FAB → ClassSetup modal
│   │       │   ├── ClassSetupScreen.tsx← create class: name, education level picker
│   │       │   ├── MarkingScreen.tsx  ← student + answer key pickers, ScanButton, MarkResult
│   │       │   ├── AnalyticsScreen.tsx← placeholder (out of MVP scope)
│   │       │   └── SettingsScreen.tsx ← profile display, subscription status, logout
│   │       ├── components/
│   │       │   ├── ScanButton.tsx     ← camera capture via expo-image-picker, frame guide overlay
│   │       │   ├── StudentCard.tsx    ← first_name + surname display, latest score with colour coding
│   │       │   └── MarkResult.tsx     ← annotated image + per-question verdict breakdown
│   │       ├── services/
│   │       │   ├── api.ts             ← axios client: all endpoints, JWT interceptor, 401 → logout handler
│   │       │   └── offlineQueue.ts    ← AsyncStorage queue: enqueue, replayQueue, startNetworkListener
│   │       └── types/
│   │           └── index.ts           ← TypeScript types mirroring backend models + navigation param lists
│   └── web/
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx               ← Vite entry point
│           ├── App.tsx                ← router + layout shell
│           └── pages/
│               ├── Dashboard.tsx      ← teacher overview: classes, recent marks, stats
│               └── ClassView.tsx      ← drill-down: student list + mark history

├── scripts/
│   ├── deploy.sh                      ← deploys infra (bicep) + backend (func deploy) in one command
│   └── seed_dev.py                    ← seeds Cosmos DB with sample teachers, classes, students

└── docs/
    ├── architecture.md                ← system architecture overview + sequence diagrams
    ├── whatsapp-flow.md               ← WhatsApp state machine documentation
    └── data-models.md                 ← Cosmos DB container schemas + partition key rationale
```

---

## 4. Cosmos DB Containers

| Container | Partition Key | TTL | Purpose |
|---|---|---|---|
| `teachers` | `/phone` | none | Teacher accounts. Phone is the primary identity. |
| `classes` | `/teacher_id` | none | Class records owned by a teacher. |
| `students` | `/class_id` | none | Students belonging to a class. **class_id is immutable** — partition key cannot change after creation. |
| `answer_keys` | `/class_id` | none | Answer keys (manual upload or auto-generated) for a class. |
| `marks` | `/student_id` | none | Individual marking results per student per submission. `source` field: `teacher_scan` or `student_submission`. `approved` field gates student visibility. |
| `sessions` | `/phone` | 24 h | WhatsApp conversation state. One document per phone number. |
| `rubrics` | `/class_id` | none | Tertiary assessment rubrics. |
| `submissions` | `/student_id` | none | Tertiary document submissions (PDF/DOCX). |
| `submission_codes` | `/class_id` | none | One-time submission access codes for tertiary assignments. |
| `otp_verifications` | `/phone` | 10 min | OTP documents for phone verification. SHA-256 hashed code, auto-deleted by TTL. |

> **Partition key rationale:** Queries almost always filter by the parent entity (e.g. "give me all marks for student X"), so co-locating child documents with their parent partition keeps RU costs low.
>
> **Cross-partition queries:** Used when the partition key is unknown at query time — e.g. finding a student by `id` only, or a class by `join_code`. These are more expensive (RU-wise) and should be reserved for cases where the partition key genuinely cannot be known.

---

## 5. WhatsApp Conversation State Machine

Each teacher's WhatsApp session is stored as a document in the `sessions` container. The `state` field drives routing in `whatsapp_webhook.py`.

### States

#### `IDLE`
Default state. Teacher has no active flow.
- **Incoming message** → intent detection via GPT-4o-mini (or keyword matching for MVP).
- **"setup class"** or similar → transition to `CLASS_SETUP`, ask for class name.
- **"mark"** or sends image with no context → transition to `MARKING_ACTIVE` (or prompt to select class first).
- **"answer key"** → transition to `AWAITING_ANSWER_KEY`.
- **Unrecognised** → stay `IDLE`, send help menu.

#### `CLASS_SETUP`
Collecting class metadata.
- **Step 1:** Bot asks: "What is the class name?" Teacher replies with name → stored in session context.
- **Step 2:** Bot asks: "What education level?" (shows numbered menu). Teacher replies with number → `education_level` stored.
- **Step 3:** Transition to `AWAITING_REGISTER`.

#### `AWAITING_REGISTER`
Collecting student list.
- Bot prompts: "Please photograph the class register page, or type student names one per line."
- **Image received** → OCR to extract names → present list for confirmation → store students → transition to `AWAITING_ANSWER_KEY`.
- **Text received** → parse names → store students → transition to `AWAITING_ANSWER_KEY`.
- **"skip"** → transition to `AWAITING_ANSWER_KEY` with empty student list (names can be added later).

#### `AWAITING_ANSWER_KEY`
Collecting the answer key for the class.
- Bot prompts: "Please photograph the question paper + answer section, or type 'generate' for me to create a marking scheme."
- **Image received** → quality gate → OCR → `generate_marking_scheme()` → confirm with teacher → store `AnswerKey` → transition to `MARKING_ACTIVE`.
- **"generate"** → ask for subject name → call `generate_marking_scheme()` with subject context → confirm → store → transition to `MARKING_ACTIVE`.
- **Manual text** → parse Q&A pairs → store → transition to `MARKING_ACTIVE`.

#### `MARKING_ACTIVE`
Ongoing marking session for a class.
- Bot prompts: "Send the student's book photo. You can identify the student by register number, name, or I will try to read it from the cover."
- **Image received:**
  1. Quality gate → reject immediately with specific message if fail.
  2. OCR → extract answers.
  3. Identify student (from cover scan, reply text, or session context).
  4. Grade against stored answer key.
  5. Annotate image.
  6. Upload annotated image to blob.
  7. Write mark to Cosmos.
  8. Reply with annotated image + score summary.
- **"done"** or "stop" → transition to `IDLE`, send session summary (number of books marked, average score).
- **"next student"** → acknowledge, stay in `MARKING_ACTIVE`, clear last student context.

#### `ERROR`
Unrecoverable parsing or service error.
- Always include a recovery prompt: "Something went wrong. Type 'menu' to start over or 'help' for options."
- After teacher acknowledges → transition to `IDLE`.

### Session document shape
```json
{
  "id": "<phone>",
  "phone": "+263771234567",
  "state": "MARKING_ACTIVE",
  "context": {
    "class_id": "...",
    "answer_key_id": "...",
    "current_student_id": "...",
    "setup_step": null
  },
  "ttl": 86400
}
```

---

## 6. Image Quality Gate (WhatsApp-Specific)

WhatsApp photos bypass the App's client-side camera frame guide, so every inbound image goes through a server-side pre-flight check **before** OCR is called. This avoids burning Azure Document Intelligence credits on unreadable images.

**Implementation:** `check_image_quality()` in `backend/shared/openai_client.py`. Sends the image to GPT-4o-mini vision with a terse system prompt:

> "You are a document quality checker. Inspect the image and return ONLY valid JSON: {\"pass\": bool, \"reason\": string, \"suggestion\": string}. Pass is true only if the image shows a clearly readable, well-lit, in-frame document page."

**Rejection reasons and teacher-facing replies:**

| Reason | WhatsApp reply sent to teacher |
|---|---|
| Low light / underexposed | "The photo is too dark. Move to better lighting and try again." |
| Motion blur or out of focus | "The photo is blurry. Hold your phone steady and retake." |
| Page not fully in frame | "Part of the page is cut off. Step back slightly and make sure the whole page is visible." |
| Heavy glare or shadow | "There is glare or a shadow covering the text. Adjust the angle and retake." |
| Image rotated more than ~30° | "The page appears tilted. Straighten the book and retake." |
| Not a document | "That doesn't look like a page. Please photograph the student's exercise book." |

The App does **not** use this gate — the live camera overlay in `ScanButton.tsx` provides real-time framing guidance client-side, so the image is already known-good before upload.

---

## 7. Marking Pipeline

### Step 1 — Image Quality Gate *(WhatsApp only)*
`check_image_quality(image_bytes)` → `ImageQualityResult`.
If `pass_check == False`: send rejection message to teacher and **stop**. Do not proceed to OCR.

### Step 2 — OCR
`run_ocr(image_bytes)` in `ocr_client.py`.
Calls Azure Document Intelligence `prebuilt-read` model.
Returns: extracted text (full string) + `BoundingBox` object (word-level pixel coordinates for every detected word on every page).

### Step 3 — Grade
`grade_submission(ocr_text, answer_key, education_level)` in `openai_client.py`.
Sends extracted text + serialised answer key to GPT-4o-mini.
Grading intensity is calibrated to `education_level` (lenient spelling for Grade 3, strict for Form 4, domain-rigorous for tertiary).
Returns: `list[GradingVerdict]` — one verdict per question (correct / incorrect / partial), awarded marks, and optional feedback string.

### Step 4 — Annotate
`annotate_image(image_bytes, bounding_boxes, verdicts)` in `annotator.py`.
Opens the original JPEG with Pillow. For each `GradingVerdict`, looks up the matching bounding box region.
Draws:
- Correct → green filled circle + white tick glyph, score in right margin.
- Incorrect → red filled circle + white cross glyph.
- Partial → orange underline under the answer region, partial score.
Returns annotated JPEG bytes (in-memory, never written to disk on the function instance).

### Step 5 — Store
Writes `Mark` document to Cosmos DB `marks` container. Records: student_id, answer_key_id, score, max_score, marked_image_url, raw_ocr_text, timestamp.

### Step 6 — Return
- **WhatsApp:** send annotated image as WhatsApp image message + text caption with score.
- **App API:** return JSON `{ marked_image_url, score, max_score, verdicts }`.

---

## 8. Environment Variables

See `.env.example` for the full list. Every variable must be set in `local.settings.json` for local dev and in Azure Functions Application Settings for deployed environments.

| Variable | Description |
|---|---|
| `AZURE_COSMOS_ENDPOINT` | Cosmos DB account HTTPS endpoint |
| `AZURE_COSMOS_KEY` | Cosmos DB primary key |
| `AZURE_STORAGE_ACCOUNT` | Storage account name |
| `AZURE_STORAGE_KEY` | Storage account key |
| `AZURE_STORAGE_CONTAINER_SCANS` | Blob container for raw uploaded scans |
| `AZURE_STORAGE_CONTAINER_MARKED` | Blob container for annotated output images |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI account endpoint |
| `AZURE_OPENAI_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name (default: `gpt-4o-mini`) |
| `AZURE_DOC_INTELLIGENCE_ENDPOINT` | Document Intelligence endpoint |
| `AZURE_DOC_INTELLIGENCE_KEY` | Document Intelligence key |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification token (Meta developer console) |
| `WHATSAPP_ACCESS_TOKEN` | Graph API permanent access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business phone number ID |
| `ECOCASH_API_KEY` | EcoCash API key (billing, MVP out of scope) |
| `ECOCASH_MERCHANT_ID` | EcoCash merchant ID |
| `APP_JWT_SECRET` | Secret for signing App JWTs (HS256) |
| `ENVIRONMENT` | `dev` or `prod` — controls logging verbosity |

---

## Local development

Always activate the venv before running `func start`:
```
cd neriah/backend
source .venv/bin/activate
func start
```

The Azure Functions Core Tools worker uses the system Python path by default.
Activating the venv sets `VIRTUAL_ENV` so the worker finds the installed packages.
Without it you will get `ModuleNotFoundError: No module named 'azure.cosmos'`.

---

## 9. MVP Scope

### In scope
- WhatsApp bot: full class setup → answer key → marking → annotated result flow.
- App alpha: same flows via REST API + mobile UI.
- Class creation with education level selection (Grade 1–7, Form 1–6, Tertiary).
- Answer key upload (image/text) and auto-generation from question paper photo.
- Single and bulk marking flow (one student at a time, rapid fire).
- Annotated result image returned to teacher (WhatsApp message or App screen).
- Per-student mark storage in Cosmos DB.

### Out of scope for MVP
- Student-facing AI product (study guides, personalised feedback to students).
- Analytics dashboard (charts, class averages, progress over time).
- EcoCash billing integration (subscription enforcement).
- Report card generation (PDF export, parent-facing summaries).
- Multi-teacher school accounts.
- Offline-first sync (offline queue exists in app but is not fully implemented).

---

## Current Build State

Last updated: 2026-04-02

---

### Infrastructure — DONE

- [x] Backend: 42 Azure Functions deployed at `neriah-func-dev.azurewebsites.net`
- [x] Domain: `neriah.ai` (primary), `neriah.africa` redirects
- [x] Cosmos DB: `neriah-cosmos-dev` (southafricanorth) — containers: `teachers`, `classes`, `students`, `answer_keys`, `marks`, `sessions`, `rubrics`, `submissions`, `submission_codes`, `otp_verifications`, `schools`
- [x] Blob Storage: `neriahstordev` — containers: `scans`, `marked`, `submissions`
- [x] Document Intelligence: `neriah-docint-dev` (southafricanorth)
- [x] Azure OpenAI: `neriah-openai-dev` (eastus) — GPT-4o (2024-11-20) deployed
- [x] Azure Functions: `neriah-func-dev` (southafricanorth)
- [x] Azure Communication Services: `neriah-comms-dev` — domain `neriah.africa` verified, DKIM verified, SPF correct
- [x] Zoho Mail: tinotenda@, admin@, support@, mark@neriah.ai
- [x] Resend: noreply@send.neriah.ai for contact form
- [x] Google OAuth: updated for neriah.ai

---

### Auth System — DONE

- [x] OTP-based phone auth (no email, no passwords)
- [x] Persistent sessions: 365-day JWT with `token_version` for invalidation
- [x] OTP fires ONCE at registration only (not recurring)
- [x] WhatsApp OTP: primary channel (code ready, waiting on Meta business verification)
- [x] Twilio SMS: fallback channel (live, working)
  - US numbers (+1): Twilio Verify API (handles 10DLC compliance)
  - Non-US numbers: Twilio Messages API with alphanumeric sender ID "Neriah"
- [x] Twilio credentials set in Azure Function App settings (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER=+15186083556`, `TWILIO_VERIFY_SID`)
- [x] `debug_otp` removed from API responses (OTP only in function logs)
- [x] Account recovery: OTP → `token_version` increment → invalidates all old sessions
- [x] Optional 4-digit PIN: local app lock (SecureStore + server bcrypt backup); locks after 5 wrong attempts; cleared on recovery
- [x] Auth middleware checks `token_version` against Cosmos
- [x] `/api/auth/verify` handles both Twilio Verify (US) and self-managed OTP (international)
- [x] All OTP endpoints accept `channel_preference: "whatsapp" | "sms"` and return `channel` in response

---

### Mobile App — IN PROGRESS

#### Brand & UI
- [x] Brand: Neriah teal `#0D7377`, amber `#F5A623` palette
- [x] `colors.ts` constants file with full palette
- [x] App icons: icon.png, adaptive-icon.png, splash.png, favicon.png
- [x] Replace "N" placeholder on auth screens with actual logo image
- [x] Country code selector on all phone inputs (African countries + US)
- [x] Auto-detect country from device locale, default to ZW

#### Auth Flow
- [x] Persistent session: app opens → token exists → straight to dashboard
- [x] Role selection first (Teacher/Student), then registration form
- [x] Login: phone → OTP → dashboard (role auto-detected)
- [x] "Already have an account? Sign in" on registration screens
- [x] 409 "Phone already registered" → specific message + "Sign in instead" button
- [x] OTP screen shows "Check your WhatsApp" or "Check your SMS" based on channel
- [x] "Send via SMS instead" button on OTP screen (resendOtp with channel_preference wired)

#### Teacher Flow
- [x] Dashboard/Classes screen with class cards
- [x] Class creation with education level dropdown (Grade 1–7, Form 1–4, Form 5–6 A-Level, College/University)
- [x] Education level inherited by all homework under the class
- [x] Homework cards under each class (title, created date, submissions count, status badge)
- [x] "Add Homework" button under each class
- [x] "Upload Answer Key" amber badge on homework cards (when no key uploaded)
- [x] "Manage" link under student count on class cards
- [x] Mark tab removed from bottom nav — marking accessed from Homework Detail screen
- [x] Bottom tabs: Classes, Analytics, Settings
- [x] Homework Detail screen with "Mark Students" button (only when answer key exists)
- [x] File upload supports: camera, gallery, PDF, Word, images (`expo-document-picker`)
- [x] Education level drives AI grading intensity in LLM prompt (grading + scheme generation)
- [x] AI scheme generation calibrated per level (Grade 1–3 lenient → College/University academic)
- [x] Education level badge on Homework Detail screen
- [x] "View Grading" button on homework card (appears after grading done)
- [x] Unlabeled homework: auto-created when submissions arrive without homework entry
- [x] Rename unlabeled homework + upload answer key flow

#### Student Flow
- [x] Student registration with auto-match or join code
- [x] Student dashboard
- [x] 3-channel submission (app, WhatsApp, email)
- [x] Results with feedback
- [x] Student analytics

#### Settings
- [x] Profile section: name, phone, role badge (dynamic from `user.role`)
- [x] School name display (from registration)
- [x] School picker on registration (searchable modal, seeded with fictional schools)
- [x] Set PIN / Reset PIN
- [x] Language selector: English, Shona, Ndebele
- [x] Log out button
- [x] Version and backend info

#### Internationalization (i18n)
- [x] `src/i18n/translations.ts` — en/sn/nd, 148 keys, all 3 languages in sync
- [x] `LanguageProvider` context wrapping app (above `AuthProvider`)
- [x] `useLanguage()` hook with `t(key)`, `language`, `setLanguage`
- [x] Language persisted in SecureStore under key `neriah_language`
- [x] Language switch takes effect immediately, no restart needed
- [x] All screens wired: HomeScreen, SettingsScreen, HomeworkDetailScreen, GradingResultsScreen, PhoneScreen, OTPScreen, RoleSelectScreen, TeacherRegisterScreen, ClassSetupScreen, MarkingScreen

#### Performance
- [x] Navigation animations removed (`animation: 'none'` on TeacherStack + StudentRootStack)
- [x] Tab screens: `lazy={true}`, `freezeOnBlur: true`
- [x] Class list items wrapped in `React.memo` (`ClassGroupItem` component)
- [x] All FlatList navigation handlers wrapped in `useCallback`
- [x] FlatList: `removeClippedSubviews`, `maxToRenderPerBatch={10}`, `windowSize={5}`
- [x] HomeScreen stale check: skip refetch if data < 30 s old (prevents loading spinner on back navigation)

---

### Bug Fixes Applied

- [x] Wrong OTP returns 400 (not 401) — no longer triggers logout via axios interceptor
- [x] OTPScreen error handling uses `err.status` (not `err.response?.status`)
- [x] `GradingVerdict` model has `max_marks` field in backend + frontend
- [x] `getMe()` typed as `Promise<Teacher | Student>`
- [x] `resendOtp` passes `channel_preference`
- [x] SettingsScreen role badge uses `user.role` dynamically
- [x] SMS body updated: "Hi, your Neriah verification code is…"
- [x] Homework Detail error fixed (`getTeacherSubmissions` was missing `teacher_id` param)
- [x] `getTeacherSubmissions` now passes `teacher_id` on HomeScreen and HomeworkDetailScreen
- [x] Education level labels updated: "Form 5 (A-Level)", "Form 6 (A-Level)", "College/University"
- [x] `LEVEL_DISPLAY` map in HomeScreen matches new labels

---

### API Surface (42 routes)

| Method | Route | Auth | Handler |
|---|---|---|---|
| GET | /api/whatsapp | — | whatsapp_verify |
| POST | /api/whatsapp | — | whatsapp_webhook |
| POST | /api/auth/register | — | auth_register |
| POST | /api/auth/login | — | auth_login |
| POST | /api/auth/verify | — | auth_verify |
| POST | /api/auth/resend-otp | — | auth_resend_otp |
| GET | /api/auth/me | teacher/student JWT | auth_me |
| POST | /api/auth/recover | — | auth_recover |
| POST | /api/auth/pin/set | any JWT | auth_pin_set |
| POST | /api/auth/pin/verify | any JWT | auth_pin_verify |
| DELETE | /api/auth/pin | any JWT | auth_pin_delete |
| POST | /api/auth/student/lookup | — | auth_student_lookup |
| POST | /api/auth/student/activate | — | auth_student_activate |
| POST | /api/auth/student/register | — | auth_student_register |
| POST | /api/push/register | any JWT | push_register |
| GET | /api/classes | teacher JWT | classes |
| POST | /api/classes | teacher JWT | classes |
| PUT | /api/classes/{class_id} | teacher JWT | class_update |
| DELETE | /api/classes/{class_id} | teacher JWT | class_delete |
| GET | /api/classes/join/{code} | — | class_join_info |
| POST | /api/classes/join | student JWT | class_join |
| GET | /api/students | teacher JWT | students |
| POST | /api/students | teacher JWT | students |
| POST | /api/students/batch | teacher JWT | students_batch |
| PUT | /api/students/{student_id} | teacher JWT | student_update |
| DELETE | /api/students/{student_id} | teacher JWT | student_delete |
| GET | /api/answer-keys | teacher JWT | answer_keys |
| POST | /api/answer-keys | teacher JWT | answer_keys |
| PUT | /api/answer-keys/{answer_key_id} | teacher JWT | answer_key_update |
| DELETE | /api/answer-keys/{answer_key_id} | teacher JWT | answer_key_delete |
| POST | /api/mark | teacher JWT (form) | mark |
| PUT | /api/marks/{mark_id} | teacher JWT | mark_update |
| GET | /api/marks/student/{student_id} | student JWT | student_marks_list |
| GET | /api/assignments | student JWT | assignments |
| POST | /api/submissions/student | student JWT | student_submission_create |
| GET | /api/submissions/student/{id} | student JWT | student_submissions_list |
| DELETE | /api/submissions/student/{id} | student JWT | student_submission_delete |
| GET | /api/analytics | teacher JWT | analytics |
| GET | /api/submissions | teacher JWT | submissions |
| POST | /api/submissions | — | submissions |
| POST | /api/submissions/{submission_id}/approve | — | submission_approve |
| POST | /api/email-webhook | — | email_webhook |

---

### Environment Variables (Function App settings)

```
APP_JWT_SECRET=<set>
TWILIO_ACCOUNT_SID=<set>
TWILIO_AUTH_TOKEN=<set>
TWILIO_PHONE_NUMBER=+15186083556
TWILIO_VERIFY_SID=<set>
AZURE_COMMUNICATION_CONNECTION_STRING=<set>
WHATSAPP_ACCESS_TOKEN=<empty — pending Meta business verification>
WHATSAPP_PHONE_NUMBER_ID=<empty — pending Meta business verification>
```

All Azure service keys (`AZURE_COSMOS_*`, `AZURE_STORAGE_*`, `AZURE_OPENAI_*`, `AZURE_DOC_INTELLIGENCE_*`) are set in Function App settings.

---

### Backlog (not yet built)

- [ ] Bulk scanning — photograph multiple student books in rapid succession
- [ ] Student identification from cover scan (register number, fuzzy name match)
- [ ] Editable marks — teacher overrides AI grade
- [ ] Class performance summaries on demand
- [ ] Push notifications for new student submissions
- [ ] Offline scan-and-sync queue (queue exists in app code, not fully wired)
- [ ] Automated report card generation (PDF)
- [ ] Parent notification system
- [ ] ZIMSEC syllabus integration (per-subject, per-level LLM context)
- [ ] EcoCash payment integration
- [ ] Meta WhatsApp business verification (unblocks WhatsApp OTP + bot)
- [ ] WhatsApp OTP template "neriah_otp" — submit for Meta approval post-verification
- [ ] Event Grid subscription — wire inbound email to `/api/email-webhook`
- [ ] IndexNow automatic blog indexing (update domain to neriah.ai)
- [ ] Web dashboard (app/web/) — stubs only, not started

---

### Key Architecture Decisions

- **SMS provider:** Twilio. US (+1): Verify API (10DLC compliant). International: Messages API with sender ID "Neriah".
- **OTP strategy:** Once at registration + account recovery only. No recurring SMS cost.
- **Session:** 365-day JWT, `token_version` for invalidation, no token blacklist needed.
- **PIN:** On-device primary (SecureStore), server backup (bcrypt hash). Locks after 5 wrong attempts.
- **Education level:** Set at class creation, inherited by all homework, drives both grading intensity and scheme generation calibration in LLM prompts.
- **File uploads:** Camera, gallery, PDF, Word, images via `expo-document-picker`. Non-image files stored in blob without OCR/grading pipeline; mark created with score=0 pending teacher review.
- **i18n:** English (default), Shona, Ndebele — context-based (`LanguageProvider`), immediate switch, persisted to SecureStore under `neriah_language`.
- **Unlabeled homework:** Auto-created when a student submits without a pre-existing homework entry. Teacher renames and uploads answer key afterwards.
- **Production principle:** No throwaway tools. Every decision built for production from day one.
