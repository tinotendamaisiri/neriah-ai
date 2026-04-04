# Neriah — AI Homework Marking on Google Cloud

> **Hackathon submission** — a clean, production-ready implementation of the Neriah
> grading pipeline built natively on Google Cloud, powered by **Gemma 4 on Vertex AI**.

---

## The Problem

A primary school teacher in Zimbabwe has 40 students. Marking a single exercise takes
4–6 minutes per book — three hours every night, for every subject, every week.
Most teachers give up and stop giving written exercises altogether.
Students get no feedback. Learning stalls.

**Neriah solves this in under 30 seconds per book.**

---

## What Neriah Does

A teacher photographs a student's exercise book with their phone.
Neriah grades every handwritten answer against a stored marking scheme,
draws ticks and crosses directly onto the original photo, and sends back
the annotated image with a score — over the mobile app or WhatsApp.

**Key insight:** Gemma 4 is multimodal. Unlike GPT-4o (which required a separate
OCR pass), Gemma 4 reads the handwriting and grades the answers in a single call.
No Azure Document Intelligence equivalent needed for the primary marking pipeline.

---

## Architecture

```
Teacher's Phone
      │
      │  JPEG photo of exercise book
      ▼
┌─────────────────────────────────────────────────────────┐
│              Google Cloud Functions (gen2)               │
│                                                         │
│  POST /api/mark                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  1. Quality gate  ── Gemma 4 vision (multimodal) │   │
│  │  2. Grade         ── Gemma 4 vision (multimodal) │   │
│  │     └─ reads handwriting + grades in ONE call    │   │
│  │  3. Annotate      ── Pillow (in-memory JPEG)     │   │
│  │  4. Store mark    ── Firestore                   │   │
│  │  5. Upload image  ── Cloud Storage               │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  POST /api/whatsapp  (state machine)                    │
│  GET  /api/analytics                                    │
│  CRUD /api/classes  /api/students  /api/answer-keys     │
│  POST /api/auth/register|login|verify                   │
└─────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
  ┌─────────────┐         ┌──────────────────┐
  │  Firestore  │         │  Cloud Storage   │
  │             │         │                  │
  │  teachers   │         │  scans/          │
  │  classes    │         │  marked/         │
  │  students   │         │  submissions/    │
  │  answer_keys│         └──────────────────┘
  │  marks      │
  │  sessions   │         ┌──────────────────┐
  │  rubrics    │         │  Vertex AI       │
  │  submissions│         │                  │
  └─────────────┘         │  Gemma 4 27B IT  │
                          │  (Model Garden)  │
                          └──────────────────┘
                                   ▲
                          ┌────────┴─────────┐
                          │  Document AI     │
                          │  (PDF/DOCX only) │
                          └──────────────────┘
```

**Two delivery channels — same backend:**
- **Mobile App** (React Native / Expo) — primary; live camera overlay guides framing
- **WhatsApp Bot** — zero install; full marking flow over chat

---

## How Gemma 4 Is Used

All AI functionality lives in `shared/gemma_client.py`. Five functions:

| Function | Input | What Gemma does |
|---|---|---|
| `check_image_quality` | `image_bytes` | Multimodal: inspects photo quality, returns pass/fail + reason |
| `grade_submission` | `image_bytes` + answer key | **Multimodal: reads handwriting directly, grades each question, returns verdicts** |
| `generate_marking_scheme` | question paper text | Generates full marking scheme with model answers + mark allocations |
| `grade_document` | extracted text + rubric | Grades tertiary (PDF/DOCX) submissions against a criterion rubric |
| `generate_rubric` | assignment brief | Generates a structured assessment rubric with level descriptors |

`grade_submission` is the core innovation. The Azure build ran OCR first (Azure Document
Intelligence → text), then passed the text to GPT-4o for grading — two API calls, two
billing events, two points of failure. Here, Gemma 4's native vision capability reads
the handwriting and grades it in a single multimodal call.

Grading intensity is calibrated to the education level: Grade 1 (very lenient, accept
phonetic spelling) through College/University (academic rigour, cite evidence).

---

## Project Structure

```
neriah-gcp/
├── main.py                  ← Flask app + Cloud Functions entry point
├── requirements.txt
├── .env.example
├── shared/
│   ├── config.py            ← Pydantic settings (all env vars)
│   ├── models.py            ← Pydantic domain models
│   ├── auth.py              ← JWT + OTP + PIN utilities
│   ├── gemma_client.py      ← Vertex AI / Gemma 4 (5 AI functions)
│   ├── firestore_client.py  ← Firestore CRUD helpers
│   ├── gcs_client.py        ← Cloud Storage upload/download
│   ├── ocr_client.py        ← Document AI (tertiary PDF/DOCX only)
│   ├── annotator.py         ← Pillow image annotation pipeline
│   └── whatsapp_client.py   ← WhatsApp Cloud API send helpers
├── functions/
│   ├── auth.py              ← /api/auth/* endpoints
│   ├── classes.py           ← /api/classes/* endpoints
│   ├── students.py          ← /api/students/* endpoints
│   ├── answer_keys.py       ← /api/answer-keys/* endpoints
│   ├── mark.py              ← /api/mark  (full pipeline)
│   ├── analytics.py         ← /api/analytics
│   └── whatsapp.py          ← /api/whatsapp  (state machine)
└── tests/
    └── test_grading.py      ← Live smoke test: Gemma 4 end-to-end
```

---

## Running Locally

### Prerequisites
- Python 3.11+
- A GCP project with Vertex AI API enabled
- `gcloud auth application-default login` (for local credentials)

### Setup

```bash
# 1. Clone and enter project root
git clone <repo>
cd neriah

# 2. Create virtual environment
python3 -m venv venv
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.example .env
# Edit .env — fill in GCP_PROJECT_ID, APP_JWT_SECRET, WhatsApp tokens, etc.

# 5. Start the local server
functions-framework --target neriah --debug
# → http://localhost:8080
```

### Quick health check
```bash
curl http://localhost:8080/api/health
# {"status": "ok", "project": "neriah-gcp"}
```

---

## Running the Smoke Test

The smoke test makes a live call to Gemma 4 on Vertex AI.
Requires valid Application Default Credentials and `GCP_PROJECT_ID` set.

```bash
# Ensure credentials are set
gcloud auth application-default login

# Run the test
pytest tests/test_grading.py -v
```

Expected output:
```
tests/test_grading.py::test_grade_submission_structure PASSED
tests/test_grading.py::test_grade_submission_all_required_keys PASSED
tests/test_grading.py::test_grade_submission_scores_in_range PASSED
```

---

## Deploying to Cloud Functions

```bash
gcloud functions deploy neriah \
  --gen2 \
  --runtime python311 \
  --region us-central1 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point neriah \
  --set-env-vars "$(cat .env | grep -v '^#' | grep '=' | tr '\n' ',')"
```

Or with explicit vars:
```bash
gcloud functions deploy neriah \
  --gen2 \
  --runtime python311 \
  --region us-central1 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point neriah \
  --set-env-vars \
    GCP_PROJECT_ID=your-project,\
    GCS_BUCKET_SCANS=neriah-scans,\
    GCS_BUCKET_MARKED=neriah-marked,\
    GCS_BUCKET_SUBMISSIONS=neriah-submissions,\
    VERTEX_MODEL_ID=gemma-4-27b-it,\
    APP_JWT_SECRET=your-secret,\
    WHATSAPP_VERIFY_TOKEN=your-token,\
    WHATSAPP_ACCESS_TOKEN=your-token,\
    WHATSAPP_PHONE_NUMBER_ID=your-id,\
    ENVIRONMENT=prod
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GCP_PROJECT_ID` | yes | GCP project ID |
| `GCP_REGION` | no | Vertex AI region (default: `us-central1`) |
| `GCS_BUCKET_SCANS` | yes | Bucket for raw uploaded photos |
| `GCS_BUCKET_MARKED` | yes | Bucket for annotated output images |
| `GCS_BUCKET_SUBMISSIONS` | yes | Bucket for tertiary PDF/DOCX uploads |
| `VERTEX_MODEL_ID` | no | Gemma 4 model ID (default: `gemma-4-27b-it`) |
| `DOCAI_PROCESSOR_ID` | no | Document AI processor (tertiary only; optional) |
| `WHATSAPP_VERIFY_TOKEN` | yes | Meta webhook verification token |
| `WHATSAPP_ACCESS_TOKEN` | yes | WhatsApp Graph API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | WhatsApp Business phone number ID |
| `APP_JWT_SECRET` | yes | Secret for signing HS256 JWTs |
| `ENVIRONMENT` | no | `dev` or `prod` — controls log verbosity |

---

## GCP Services Used

| Service | Purpose |
|---|---|
| Cloud Functions (gen2) | Serverless HTTP backend |
| Vertex AI — Gemma 4 27B IT | Image quality check, handwriting grading, scheme generation |
| Firestore | All structured data (teachers, classes, marks, sessions) |
| Cloud Storage | Raw and annotated images, tertiary document uploads |
| Document AI | Optional PDF/DOCX text extraction (tertiary submissions only) |

---

## Design Decisions

**Why one Cloud Function instead of many?**
All routes are registered on a single Flask app dispatched through one
`@functions_framework.http` handler. This keeps cold starts low, simplifies
deployment, and mirrors the developer experience of the Azure Functions v2 build.

**Why no separate OCR step?**
Gemma 4 is multimodal. Passing the exercise-book image directly to `grade_submission`
eliminates a Document AI call for every book, reducing latency and cost.
Document AI is retained only for tertiary PDF/DOCX extraction where layout matters.

**Why Firestore over Cloud SQL?**
Queries almost always filter by a known parent (all marks for a student, all students
in a class). Firestore's document model matches this access pattern exactly, with no
schema migrations and a serverless billing model that scales to zero.
