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
│   │   ├── models.py                  ← Pydantic models: Teacher, Student, Class, Mark, AnswerKey, etc.
│   │   ├── cosmos_client.py           ← CosmosDB CRUD helpers (upsert, get, query, delete)
│   │   ├── blob_client.py             ← Blob upload/download helpers
│   │   ├── ocr_client.py              ← Azure Document Intelligence wrapper — returns text + bounding boxes
│   │   ├── openai_client.py           ← Azure OpenAI: grading, scheme generation, image quality check
│   │   ├── annotator.py               ← Pillow pipeline: draws ticks, crosses, scores onto original photo
│   │   └── whatsapp_client.py         ← WhatsApp Cloud API send-message helper
│   ├── function_app.py                ← Azure Functions v2 entry point — registers all function blueprints
│   └── functions/
│       ├── whatsapp_webhook.py        ← POST /api/whatsapp — receive + route WA messages, full state machine
│       ├── mark.py                    ← POST /api/mark — full marking pipeline (App channel)
│       ├── classes.py                 ← GET/POST /api/classes
│       ├── students.py                ← GET/POST /api/students
│       ├── answer_keys.py             ← GET/POST /api/answer-keys
│       └── analytics.py              ← GET /api/analytics — per-class and per-student stats

├── app/
│   ├── mobile/                        ← React Native (Expo)
│   │   ├── package.json
│   │   ├── app.json
│   │   ├── App.tsx                    ← root navigator
│   │   └── src/
│   │       ├── screens/
│   │       │   ├── HomeScreen.tsx     ← class list + quick-mark entry point
│   │       │   ├── ClassSetupScreen.tsx← create/edit class + add students
│   │       │   ├── MarkingScreen.tsx  ← camera capture + real-time result
│   │       │   ├── AnalyticsScreen.tsx← per-class score charts
│   │       │   └── SettingsScreen.tsx ← profile, subscription, answer keys
│   │       ├── components/
│   │       │   ├── ScanButton.tsx     ← camera with frame guide overlay
│   │       │   ├── StudentCard.tsx    ← student name + latest score
│   │       │   └── MarkResult.tsx     ← annotated image + score breakdown
│   │       ├── services/
│   │       │   ├── api.ts             ← typed fetch wrapper for all backend endpoints
│   │       │   └── offlineQueue.ts    ← offline scan queue backed by AsyncStorage
│   │       └── types/
│   │           └── index.ts           ← shared TypeScript types mirroring backend Pydantic models
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

| Container | Partition Key | Purpose |
|---|---|---|
| `teachers` | `/phone` | Teacher accounts. Phone is the primary identity. |
| `classes` | `/teacher_id` | Class records owned by a teacher. |
| `students` | `/class_id` | Students belonging to a class. Phone number (E.164) is the primary unique identifier. |
| `answer_keys` | `/class_id` | Answer keys (manual upload or auto-generated) for a class. |
| `marks` | `/student_id` | Individual marking results per student per submission. |
| `sessions` | `/phone` | WhatsApp conversation state. One document per phone number. TTL: 24 h. |

> **Partition key rationale:** Queries almost always filter by the parent entity (e.g. "give me all marks for student X"), so co-locating child documents with their parent partition keeps RU costs low.

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

Last updated: March 27 2026

### Completed backend files (signed off in order)
- `shared/models.py` — includes all school + tertiary models
- `shared/cosmos_client.py`
- `shared/blob_client.py` — includes `upload_bytes()`
- `shared/openai_client.py` — includes `check_image_quality`, `grade_submission`, `generate_marking_scheme`, `grade_document`, `generate_rubric`
- `shared/ocr_client.py`
- `shared/annotator.py`
- `shared/whatsapp_client.py`
- `shared/document_extractor.py`
- `shared/feedback_generator.py`
- `shared/email_client.py`
- `functions/mark.py`
- `functions/whatsapp_webhook.py`
- `functions/classes.py`
- `functions/students.py`
- `functions/answer_keys.py`
- `functions/analytics.py`
- `functions/submissions.py`
- `functions/email_webhook.py`
- `function_app.py`

### Azure infrastructure (live)
- Resource group: `neriah-dev-rg` (southafricanorth)
- Cosmos DB: `neriah-cosmos-dev` (southafricanorth)
  Containers: `teachers`, `classes`, `students`, `answer_keys`, `marks`, `sessions`, `rubrics`, `submissions`, `submission_codes`
- Blob Storage: `neriahstordev` (southafricanorth)
  Containers: `scans`, `marked`, `submissions`
- Document Intelligence: `neriah-docint-dev` (southafricanorth)
- Azure OpenAI: `neriah-openai-dev` (eastus) — GPT-4o-mini + GPT-4o deployed
- Azure Functions: `neriah-func-dev` (southafricanorth)
- Azure Communication Services: `neriah-comms-dev`
  Domain: `neriah.africa` — Domain verified, DKIM verified, SPF functionally correct

### Pending
- Event Grid subscription — wire inbound email to `/api/email-webhook`
- Redeploy backend with all tertiary module changes
- WhatsApp end-to-end test (waiting on Meta business verification)
- App (React Native + Web dashboard)

### Environment variables
All Azure keys in `neriah/backend/.env` and pushed to Function App settings.
Remaining placeholder: `AZURE_STORAGE_CONTAINER_SUBMISSIONS=submissions` (add to `.env` and push to Function App)
