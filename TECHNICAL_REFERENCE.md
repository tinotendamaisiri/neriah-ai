# Neriah — Comprehensive Technical Reference

> Generated 2026-04-03. Covers every Azure Function, both grading pipelines, AI engine call sites, OCR usage, Cosmos DB schemas, WhatsApp and email handling, answer key/rubric storage, authentication, and all environment variables.

---

## Table of Contents

1. [Every Azure Function](#1-every-azure-function)
2. [Complete Grading Pipeline](#2-complete-grading-pipeline)
3. [AI Engine Call Sites](#3-ai-engine-call-sites)
4. [Azure Document Intelligence Usage](#4-azure-document-intelligence-usage)
5. [Cosmos DB Document Schemas](#5-cosmos-db-document-schemas)
6. [WhatsApp Inbound and Outbound](#6-whatsapp-inbound-and-outbound)
7. [Email Ingestion](#7-email-ingestion)
8. [Answer Keys and Rubrics](#8-answer-keys-and-rubrics)
9. [Authentication](#9-authentication)
10. [Environment Variables](#10-environment-variables)

---

## 1. Every Azure Function

All functions are registered in `function_app.py` using `@app.route` on an `AsyncFunctionApp` with `AuthLevel.ANONYMOUS` (APIM handles auth externally). All triggers are HTTP.

### Auth — Teacher (`functions/auth.py`)

| Handler | Method | Route | Description |
|---|---|---|---|
| `auth_register` | POST | `/api/auth/register` | Creates a `Teacher` document in Cosmos, fires OTP via Twilio (Verify for US +1, Programmable SMS international). Returns `verification_id`. |
| `auth_login` | POST | `/api/auth/login` | Looks up teacher by phone. If found, fires a new OTP. Returns `verification_id`. |
| `auth_verify` | POST | `/api/auth/verify` | Accepts `verification_id + otp_code`. US numbers use Twilio Verify API; others compare SHA-256 hashes. On success issues a 365-day HS256 JWT. Checks `token_version`. |
| `auth_resend_otp` | POST | `/api/auth/resend-otp` | Creates a fresh `OTPVerification` doc and fires a new code. Accepts `channel_preference: "whatsapp" \| "sms"`. |
| `auth_me` | GET | `/api/auth/me` | Decodes JWT, reads teacher or student doc from Cosmos, returns full profile. |
| `auth_recover` | POST | `/api/auth/recover` | Account recovery: increments `token_version` (invalidates all old JWTs), fires new OTP. |
| `auth_pin_set` | POST | `/api/auth/pin/set` | Hashes a 4-digit PIN with bcrypt and stores it in the teacher/student document. |
| `auth_pin_verify` | POST | `/api/auth/pin/verify` | Compares provided PIN against stored bcrypt hash. Increments fail counter; locks after 5 failures. |
| `auth_pin_delete` | DELETE | `/api/auth/pin` | Clears `pin_hash` and `pin_locked` on the teacher/student doc. |

### Auth — Student (`functions/student_auth.py`)

| Handler | Method | Route | Description |
|---|---|---|---|
| `auth_student_lookup` | POST | `/api/auth/student/lookup` | Finds a student by phone or name within a class. Returns match status without creating a session. |
| `auth_student_activate` | POST | `/api/auth/student/activate` | Attaches a phone number to an existing `Student` doc (teacher-created student activating their account). Fires OTP. |
| `auth_student_register` | POST | `/api/auth/student/register` | Self-registration: creates `Student` doc, joins class by `join_code`. Fires OTP. |

### Classes (`functions/classes.py`)

| Handler | Method | Route | Description |
|---|---|---|---|
| `classes` GET | GET | `/api/classes` | Returns all classes for the authenticated teacher. |
| `classes` POST | POST | `/api/classes` | Creates a `Class` doc with an auto-generated 6-char `join_code`. |
| `class_update` | PUT | `/api/classes/{class_id}` | Updates name, education level, subject, `share_analytics`, `share_rank`. |
| `class_delete` | DELETE | `/api/classes/{class_id}` | Deletes the class document. |
| `class_join_info` | GET | `/api/classes/join/{code}` | Returns class name and teacher name for a join code (unauthenticated, for the student join screen). |
| `class_join` | POST | `/api/classes/join` | Adds student to a class by `join_code`. Requires student JWT. |

### Students (`functions/students.py`)

| Handler | Method | Route | Description |
|---|---|---|---|
| `students` GET | GET | `/api/students` | Lists all students in a class (`?class_id=`). |
| `students` POST | POST | `/api/students` | Creates a single `Student` document. |
| `students_batch` | POST | `/api/students/batch` | Creates multiple students at once (for register upload). |
| `student_update` | PUT | `/api/students/{student_id}` | Updates `first_name`, `surname`, `phone`, `register_number`. |
| `student_delete` | DELETE | `/api/students/{student_id}` | Deletes a student document. |

### Answer Keys (`functions/answer_keys.py`)

| Handler | Method | Route | Description |
|---|---|---|---|
| `answer_keys` GET | GET | `/api/answer-keys?class_id=` | Lists all answer keys for a class. |
| `answer_keys` POST | POST | `/api/answer-keys` | Creates an answer key. If `auto_generate: true`, calls `generate_marking_scheme()` with `question_paper_text`. |
| `answer_key_update` | PUT | `/api/answer-keys/{id}` | Updates fields. Accepts multipart with file upload — extracts text via `document_extractor`, then auto-generates marking scheme. Sends push batch to all students when `open_for_submission` flips to `true`. |
| `answer_key_delete` | DELETE | `/api/answer-keys/{id}` | Deletes the answer key. |

### Marking

| Handler | Method | Route | Description |
|---|---|---|---|
| `mark` (`function_app.py` inline + `functions/mark.py`) | POST | `/api/mark` | Main marking pipeline (teacher scan). Multipart form: `image`, `teacher_id`, `student_id`, `class_id`, `answer_key_id`, `education_level`. Calls `run_marking()`. Returns `MarkingResult`. |

### Marks (`functions/marks.py`)

| Handler | Method | Route | Description |
|---|---|---|---|
| `mark_get` | GET | `/api/marks/{mark_id}` | Fetches a single mark document. |
| `mark_update` | PUT | `/api/marks/{mark_id}` | Teacher review: sets `approved`, optional `feedback` string, manual score override. |
| `marks_approve_bulk` | POST | `/api/marks/approve-bulk` | Approves a list of mark IDs in one call. |

### Student Submissions (`functions/student_submissions.py`)

| Handler | Method | Route | Description |
|---|---|---|---|
| `student_submission_create` | POST | `/api/submissions/student` | Student uploads their own work (image). Runs marking pipeline with `source="student_submission"`, `approved=False`. |
| `student_submissions_list` | GET | `/api/submissions/student/{id}` | Lists all submissions for a student. |
| `student_submission_delete` | DELETE | `/api/submissions/student/{id}` | Deletes a student submission. |
| `student_marks_list` | GET | `/api/marks/student/{student_id}` | Returns all marks for a student where `approved=true`. |

### Assignments (`functions/assignments.py`)

| Handler | Method | Route | Description |
|---|---|---|---|
| `assignments` | GET | `/api/assignments` | Returns open answer keys (`open_for_submission=true`) for the student's enrolled classes. Student JWT required. |

### Tertiary Submissions (`functions/submissions.py`)

| Handler | Method | Route | Description |
|---|---|---|---|
| `submissions` GET | GET | `/api/submissions` | Lists submissions with `type=tertiary\|primary\|all` and optional `status`, `class_id` filters. |
| `submissions` POST | POST | `/api/submissions` | Creates a tertiary submission: extracts text, grades against rubric with GPT-4o, generates feedback PDF, sends draft to lecturer. |
| `submission_approve` | POST | `/api/submissions/{id}/approve` | Lecturer approves draft: transitions DRAFT → APPROVED → RELEASED, emails feedback PDF to student. |

### Analytics (`functions/analytics.py`)

| Handler | Method | Route | Description |
|---|---|---|---|
| `analytics_classes` | GET | `/api/analytics/classes` | Overview stats across all classes for a teacher. |
| `analytics` | GET | `/api/analytics` | General analytics entry point. |
| `analytics_class` | GET | `/api/analytics/class/{class_id}` | Per-class stats: average score, pass rate, score distribution. |
| `analytics_student` | GET | `/api/analytics/student/{student_id}` | Per-student history: scores over time per answer key. |
| `analytics_teacher` | GET | `/api/analytics/teacher/{teacher_id}` | Teacher-level aggregate stats. |
| `analytics_student_class` | GET | `/api/analytics/student-class/{class_id}` | Student-facing class analytics (only if `share_analytics=true`). |

### Misc

| Handler | Method | Route | Description |
|---|---|---|---|
| `whatsapp_verify` | GET | `/api/whatsapp` | Meta webhook verification — echoes `hub.challenge` if token matches. |
| `whatsapp_webhook` | POST | `/api/whatsapp` | Inbound WhatsApp messages — full state machine + student submission intercept. |
| `email_webhook` | POST | `/api/email-webhook` | Azure Event Grid inbound email — routes APPROVE replies and student submissions. |
| `push_register` | POST | `/api/push/register` | Stores Expo push token on teacher or student document. |
| `schools` | GET | `/api/schools` | Returns list of `School` documents (seed data for registration school picker). |

---

## 2. Complete Grading Pipeline

There are three inbound channels. All three converge on the same core logic.

### Channel routing

**App (teacher scan):**
```
POST /api/mark  (multipart form)
  └─ function_app.py reads files["image"] + form fields
  └─ constructs MarkingRequest(source="app")
  └─ calls run_marking(request)
```

**WhatsApp (student submission — fully implemented):**
```
POST /api/whatsapp  →  _handle_message()
  └─ _try_student_submission()          ← intercepted before teacher state machine
  └─ _process_student_submission()      ← source="whatsapp", approved=False
```

**WhatsApp (teacher scan — currently stubbed):**
```
POST /api/whatsapp  →  _handle_message()
  └─ _dispatch(session, message)
  └─ _handle_marking_active()
  └─ _handle_image_submission()         ← TODO stubs, not yet wired
```

**Email (image submission):**
```
POST /api/email-webhook  →  process_inbound_email()
  └─ 6-char alphanumeric code  →  _run_primary_email_pipeline()
```

**Email (document submission, tertiary):**
```
POST /api/email-webhook  →  process_inbound_email()
  └─ NER-YYYY-... code  →  _run_email_submission_pipeline()
```

---

### Pipeline A — Photo marking (primary/secondary)

Used by `run_marking()` in `functions/mark.py:116`.

```
Step 1   Quality gate                     (WhatsApp and email only — NOT app)
         check_image_quality(image_bytes)
         → GPT-4o vision → {pass_check, reason, suggestion}
         If pass_check=False: return early / send rejection message, STOP

Step 2   Upload raw scan
         upload_scan(image_bytes, "{teacher_id}/{class_id}/{student_id}/{uuid}.jpg")
         → Azure Blob Storage  container: scans

Step 3   OCR
         analyse_image(image_bytes)       ← Azure Document Intelligence prebuilt-read
         → (full_text: str, bounding_box: BoundingBox)

Step 4   Load answer key
         get_item("answer_keys", answer_key_id, partition_key=class_id)
         → AnswerKey with questions list

Step 5   Grade
         grade_submission(ocr_text, answer_key, education_level)
         → list[GradingVerdict]           ← GPT-4o, text-only

Step 6   Group bounding boxes into per-question AnswerRegions
         group_answer_regions(bounding_box, answer_key)
         Heuristic: divide page height into N equal horizontal bands (N = question count)

Step 7   Annotate                         (wrapped in try/except — failure does not block)
         annotate_image(image_bytes, regions, verdicts)
         → annotated JPEG bytes           ← Pillow, in-memory, no disk I/O
         Correct   → green circle + ✓ glyph, "+N" in right margin
         Incorrect → red circle + ✗ glyph, "0" in right margin
         Partial   → orange underline, "N/M" in right margin
         Banner    → "Score: X / Y" at image bottom

Step 8   Upload annotated image
         upload_marked(annotated_bytes, "{teacher_id}/{class_id}/{student_id}/marked_{uuid}.jpg")
         → Azure Blob Storage  container: marked
         generate_sas_url(container, path, expiry_hours=168)   → marked_image_url
         (expiry_hours=24*365 for WhatsApp and email channels)

Step 9   Write Mark to Cosmos
         Mark(student_id, teacher_id, answer_key_id, class_id,
              score, max_score, percentage, marked_image_url,
              raw_ocr_text, source, approved, verdicts)
         approved = True  if source == "teacher_scan"
         approved = False if source == "student_submission" | "whatsapp" | "email"

Step 10  Return MarkingResult
         { mark_id, student_id, score, max_score, marked_image_url, verdicts, quality_passed }
         App:       JSON response body
         WhatsApp:  send_image(phone, marked_image_url, caption="Score: X/Y")
         Email:     teacher notified via Expo push notification
```

---

### Pipeline B — Document grading (tertiary)

Used by `functions/submissions.py:create_submission` and `email_webhook._run_email_submission_pipeline`.

```
Step 1   Detect document type
         detect_document_type(file_bytes, filename)
         → "pdf" | "pdf_scanned" | "docx" | "image" | "mixed"

Step 2   Extract text
         extract_text(file_bytes, filename, doc_type)
         pdf          → pdfplumber native text extraction
         pdf_scanned  → Azure Document Intelligence OCR (same analyse_image)
         docx         → python-docx paragraphs + table cells
         image        → Azure Document Intelligence OCR
         mixed        → per-page: pdfplumber if ≥ 20 chars, else OCR

Step 3   Upload original document
         → Azure Blob Storage  container: submissions

Step 4   Load rubric
         get_item("rubrics", rubric_id, partition_key=class_id)
         → Rubric with criteria and band descriptors

Step 5   Grade
         grade_document(extracted_text, rubric, education_level)
         Input truncated to 12,000 chars if longer
         → (list[CriterionVerdict], plagiarism_flag: bool)    ← GPT-4o

Step 6   Generate feedback PDF
         generate_feedback_pdf(...)
         → PDF bytes via reportlab (shared/feedback_generator.py)

Step 7   Upload feedback PDF
         → Azure Blob Storage  container: marked

Step 8   Email draft to lecturer
         send_draft_to_lecturer(lecturer_email, ...)
         Email includes approve link:
         POST /api/submissions/{id}/approve?code={FUNCTION_APP_KEY}

Step 9   Write Submission document
         upsert_item("submissions", submission_doc)
         status = "draft"

Step 10  On lecturer approval (email APPROVE reply or link click):
         status: draft → approved → released
         send_feedback_to_student() sends PDF to student email
```

---

## 3. AI Engine Call Sites

**Module:** `shared/openai_client.py`
**SDK:** `openai.AsyncAzureOpenAI` (OpenAI Python SDK v1+, async)
**API version:** `2024-02-01`
**Auth:** API key (`AZURE_OPENAI_KEY`) in the `api-key` header
**Endpoint:** `AZURE_OPENAI_ENDPOINT`

Two lazy singleton client instances:

| Client | Config key | Default deployment | Used for |
|---|---|---|---|
| `_client` | `AZURE_OPENAI_DEPLOYMENT` | `"gpt-4o"` | Quality gate, homework grading, scheme generation |
| `_gpt4o_client` | `AZURE_OPENAI_DEPLOYMENT_GPT4O` | `"gpt-4o"` | Document grading (tertiary), rubric generation |

Both currently resolve to the same deployment. The split is a hook for routing heavy workloads to a dedicated deployment.

---

### Call 1 — `check_image_quality(image_bytes)` → `ImageQualityResult`

**When called:** WhatsApp and email pipelines only (before OCR). The app uses a client-side camera frame guide instead.

**Model:** `AZURE_OPENAI_DEPLOYMENT`

**How image is passed:** base64-encoded JPEG in a multimodal `image_url` content block:
```python
{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
```

**System prompt:**
```
You are a document image quality checker for a homework marking system.
Assess whether the image is clear enough for OCR text extraction.
Respond ONLY with valid JSON matching this schema exactly:
{"pass_check": boolean, "reason": string, "suggestion": string}
reason must be one of: low_light, blurry, page_not_in_frame, glare_or_shadow,
rotated, not_a_document, ok
suggestion must be a friendly one-sentence instruction to the teacher in plain English.
If pass_check is true, set reason to ok and suggestion to an empty string.
```

**User message:** `[{image_url block}, {text: "Assess this image and respond with the JSON schema described."}]`

**max_tokens:** 1000

**Response:** raw JSON string → parsed into `ImageQualityResult(pass_check, reason, suggestion)`. Parse failure returns a hard-coded fallback with `pass_check=False`.

---

### Call 2 — `grade_submission(ocr_text, answer_key, education_level)` → `list[GradingVerdict]`

**When called:** Step 5 of Pipeline A. No image is sent — only the OCR-extracted text.

**Model:** `AZURE_OPENAI_DEPLOYMENT`

**System prompt (template):**
```
You are an expert homework marker for African schools.
Grade the student's answers against the provided answer key.
Calibration: {calibration}
Respond ONLY with valid JSON: a list of objects each matching:
{"question_number": int, "verdict": "correct"|"incorrect"|"partial",
 "awarded_marks": float, "feedback": string|null}
Do not include any text outside the JSON array.
```

**Calibration strings** (injected by education level):

| Level | Calibration |
|---|---|
| grade_1–3 | "very lenient: accept phonetic/creative spelling, basic sentence structure, and simple arithmetic; reward intent and partial understanding." |
| grade_4–7 | "moderate: expect mostly correct spelling, clear paragraph structure, and multi-step arithmetic; minor spelling errors are acceptable." |
| form_1–4 | "strict: require proper grammar and spelling, well-structured essays, and algebraic reasoning; penalise unclear expression." |
| form_5–6 | "rigorous: apply A-level standards; expect analytical depth, precise subject terminology, and well-reasoned arguments." |
| tertiary | "academic: apply tertiary standards; expect formal structure, correct citations where applicable, critical analysis, and domain-specific precision." |

**User message:**
```
ANSWER KEY:
{answer_key.model_dump_json()}

STUDENT ANSWERS (OCR extracted):
{ocr_text}
```

**max_tokens:** 2000

**Response:** JSON array → `list[GradingVerdict]`. Missing questions filled as `verdict=incorrect, awarded_marks=0`. Any parse failure returns all-zero verdicts.

---

### Call 3 — `generate_marking_scheme(question_paper_text, education_level)` → `list[Question]`

**When called:** answer key creation (`POST /api/answer-keys` with `auto_generate=true`) and answer key update with file upload.

**Model:** `AZURE_OPENAI_DEPLOYMENT`

**System prompt (template):**
```
You are a curriculum-aligned marking scheme generator for African schools.
Generate a complete marking scheme for the question paper provided.
Level calibration: {calibration}
Keep answers appropriate for this level...
Respond ONLY with valid JSON: a list of objects each matching:
{"number": int, "correct_answer": string, "max_marks": float, "marking_notes": string|null}
Assign marks proportionally. Do not include any text outside the JSON array.
```

**User message:** raw question paper OCR text

**max_tokens:** 1500

**Response:** JSON array → `list[Question]`. Empty list on parse failure.

---

### Call 4 — `grade_document(extracted_text, rubric, education_level)` → `(list[CriterionVerdict], bool)`

**When called:** Step 5 of Pipeline B (tertiary).

**Model:** `AZURE_OPENAI_DEPLOYMENT_GPT4O`

**Input truncation:** `extracted_text` is capped at `12000` characters. If longer, a `[DOCUMENT TRUNCATED — N total chars]` suffix is appended.

**System prompt (template):**
```
You are an expert academic assessor for African tertiary institutions.
Grade the student submission against the provided rubric.
Education level: {education_level}
Apply rigorous academic standards appropriate for tertiary assessment.
Also flag if the submission appears formulaic, templated, or suspiciously
generic — this may indicate AI generation or plagiarism.
Respond ONLY with valid JSON object:
{
  "verdicts": [
    {
      "criterion_number": int,
      "criterion_name": string,
      "awarded_marks": float,
      "max_marks": float,
      "feedback": string,
      "band": "distinction"|"merit"|"pass"|"fail"
    }
  ],
  "plagiarism_flag": boolean,
  "plagiarism_note": string
}
Do not include any text outside the JSON object.
```

**User message:**
```
RUBRIC:
{rubric.model_dump_json()}

STUDENT SUBMISSION:
{extracted_text}
```

**max_tokens:** 4000

**Response:** JSON object → `(list[CriterionVerdict], plagiarism_flag)`. Missing criteria filled as `band="fail", awarded_marks=0`.

---

### Call 5 — `generate_rubric(assignment_brief, education_level, num_criteria=5)` → `list[RubricCriterion]`

**When called:** rubric creation with auto-generation.

**Model:** `AZURE_OPENAI_DEPLOYMENT_GPT4O`

**System prompt (template):**
```
You are a curriculum-aligned rubric designer for African tertiary institutions.
Generate a marking rubric for the assignment brief provided.
Education level: {education_level}
Number of criteria: {num_criteria}
Total marks must sum to 100.
Respond ONLY with valid JSON: a list of objects each matching:
{
  "number": int,
  "name": string,
  "description": string,
  "max_marks": float,
  "band_descriptors": {
    "distinction": string,
    "merit": string,
    "pass": string,
    "fail": string
  }
}
Do not include any text outside the JSON array.
```

**User message:** assignment brief text

**max_tokens:** 2000

**Response:** JSON array → `list[RubricCriterion]`. Total marks are validated to be in the range 98–102; a warning is logged if outside this range.

---

## 4. Azure Document Intelligence Usage

**Module:** `shared/ocr_client.py`
**SDK:** `azure.ai.documentintelligence.aio.DocumentIntelligenceClient` (async)
**Auth:** `AzureKeyCredential(AZURE_DOC_INTELLIGENCE_KEY)`
**Model:** `prebuilt-read` — optimised for dense printed and handwritten text

### Where in the pipeline

| Location | Purpose |
|---|---|
| `run_marking()` Step 3 | Every student photo (app, WhatsApp, email image submissions) |
| `document_extractor._extract_via_ocr()` | Scanned PDF pages and image files in the tertiary pipeline |
| `document_extractor._extract_mixed_pdf()` | Per-page fallback when a PDF page has fewer than 20 chars of native text |

### What it extracts

`analyse_image(image_bytes)` makes one async call using `begin_analyze_document("prebuilt-read", AnalyzeDocumentRequest(bytes_source=image_bytes))` and returns two things:

**1. `full_text: str`**
All detected words joined with spaces in reading order. This string is the sole input to `grade_submission()`.

**2. `bounding_box: BoundingBox`**
Word-level pixel coordinates. Each `WordBound` has `{text, x, y, width, height}` derived from the polygon the API returns (`polygon[0..7]`, clockwise from top-left):
- `x = poly[0]`, `y = poly[1]`
- `width = poly[4] - poly[0]`, `height = poly[5] - poly[1]`

Words with fewer than 6 polygon points are skipped. These coordinates feed directly into `annotator.py`.

### Spatial clustering for annotation

`group_answer_regions(bounding_box, answer_key)` divides the estimated page height (max bottom-edge of any word + 5% padding) into N equal horizontal bands where N = `len(answer_key.questions)`. Each detected word is assigned to the band whose y-range contains it. This produces one `AnswerRegion` per non-empty band — the coordinates used to position tick/cross circles on the annotated image.

---

## 5. Cosmos DB Document Schemas

**Database name:** `neriah`
**SDK:** `azure.cosmos.aio` (async)
**Query language:** Cosmos SQL (parameterised)

### Container summary

| Container | Partition key | TTL | Notes |
|---|---|---|---|
| `teachers` | `/phone` | none | One document per teacher. Phone is the primary identity. |
| `classes` | `/teacher_id` | none | |
| `students` | `/class_id` | none | `class_id` is immutable after creation (partition key cannot change). |
| `answer_keys` | `/class_id` | none | |
| `marks` | `/student_id` | none | Grading results for primary/secondary pipeline. |
| `sessions` | `/phone` | 86400 s | WhatsApp conversation state. One doc per phone. Auto-deleted after 24 h of inactivity. |
| `rubrics` | `/class_id` | none | Tertiary marking rubrics. |
| `submissions` | `/student_id` | none | Tertiary document submissions and grading results. |
| `submission_codes` | `/class_id` | none | Access codes linking a code to a class and rubric. |
| `otp_verifications` | `/phone` | 600 s | Auto-deleted after 10 min. Raw OTP never stored — only SHA-256 hash. |
| `schools` | `/id` | none | Reference data, seeded on first `GET /api/schools`. |

---

### `Mark` document (primary/secondary grading result)

Partition key: `student_id`

```json
{
  "id": "<uuid>",
  "student_id": "<uuid>",
  "teacher_id": "<uuid>",
  "answer_key_id": "<uuid>",
  "class_id": "<uuid>",
  "score": 7.0,
  "max_score": 10.0,
  "percentage": 70.0,
  "marked_image_url": "https://neriahstordev.blob.core.windows.net/marked/...?sv=...",
  "raw_ocr_text": "Q1. Paris Q2. 1945 ...",
  "timestamp": "2026-04-03T10:00:00",
  "source": "teacher_scan",
  "approved": true,
  "feedback": null,
  "file_type": "image",
  "verdicts": [
    {
      "question_number": 1,
      "verdict": "correct",
      "awarded_marks": 2.0,
      "max_marks": 2.0,
      "feedback": null
    },
    {
      "question_number": 2,
      "verdict": "partial",
      "awarded_marks": 1.0,
      "max_marks": 2.0,
      "feedback": "Partially correct — missing the year"
    }
  ]
}
```

`source` values: `"teacher_scan"` | `"student_submission"` | `"whatsapp"` | `"email"`

`approved=true` is set automatically for `teacher_scan`. All other sources require explicit teacher approval before the student can see the result.

---

### `Submission` document (tertiary grading result)

Partition key: `student_id` (or student email string for email-channel submissions where no student UUID exists)

```json
{
  "id": "<uuid>",
  "student_id": "<uuid or email>",
  "class_id": "<uuid>",
  "teacher_id": "<uuid>",
  "rubric_id": "<uuid>",
  "assignment_name": "Business Report Assignment 2",
  "submission_code": "NER-2026-BCOM1-ACCT101-A2",
  "document_url": "https://...SAS URL to original PDF/DOCX...",
  "document_type": "pdf",
  "extracted_text": "Introduction: In this report...",
  "feedback_pdf_url": "https://...SAS URL to generated feedback PDF...",
  "verdicts": [
    {
      "criterion_number": 1,
      "criterion_name": "Critical Analysis",
      "awarded_marks": 18.0,
      "max_marks": 25.0,
      "feedback": "Good use of frameworks but limited engagement with counter-arguments.",
      "band": "merit"
    }
  ],
  "total_score": 72.0,
  "max_score": 100.0,
  "plagiarism_flag": false,
  "status": "released",
  "student_email": "student@example.com",
  "submitted_at": "2026-04-03T09:00:00",
  "graded_at": "2026-04-03T09:00:15",
  "approved_at": "2026-04-03T11:30:00",
  "released_at": "2026-04-03T11:30:01"
}
```

`status` lifecycle: `received` → `grading` → `draft` → `approved` → `released` | `failed`

---

### `Session` document (WhatsApp conversation state)

Partition key: `phone`. TTL: 86400 s.

```json
{
  "id": "+263771234567",
  "phone": "+263771234567",
  "state": "MARKING_ACTIVE",
  "updated_at": "2026-04-03T10:22:00",
  "context": {
    "class_id": "<uuid>",
    "answer_key_id": "<uuid>",
    "current_student_id": "<uuid>",
    "setup_step": null
  },
  "ttl": 86400
}
```

`state` values: `IDLE` | `CLASS_SETUP` | `AWAITING_REGISTER` | `AWAITING_ANSWER_KEY` | `MARKING_ACTIVE` | `ERROR`

---

### `OTPVerification` document

Partition key: `phone`. TTL: 600 s.

```json
{
  "id": "<uuid>",
  "phone": "+263771234567",
  "otp_code": "<sha256 hex digest>",
  "role": "teacher",
  "purpose": "register",
  "pending_data": {"first_name": "Tinotenda", "surname": "Maisiri", "school": "..."},
  "channel_preference": "sms",
  "channel_used": "sms",
  "otp_method": "self",
  "verify_sid": null,
  "attempts": 0,
  "created_at": "2026-04-03T10:00:00",
  "expires_at": "2026-04-03T10:05:00",
  "verified": false,
  "ttl": 600
}
```

`otp_method`: `"self"` = hash in `otp_code` field; `"verify"` = Twilio Verify API (no hash stored).

---

## 6. WhatsApp Inbound and Outbound

### Webhook payload structure (inbound)

Meta POSTs a JSON body on every message:

```json
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "+263771234567",
          "type": "text",
          "text": {"body": "mark"}
        }]
      }
    }]
  }]
}
```

For image messages, `messages[0]` looks like:

```json
{
  "from": "+263771234567",
  "type": "image",
  "image": {
    "id": "<media_id>",
    "caption": "NERIAH SUBMISSION\nClass: A7B3K2\nStudent: Tendai Moyo\nAssignment: Term 1 Test"
  }
}
```

Sender phone: `body["entry"][0]["changes"][0]["value"]["messages"][0]["from"]`

The webhook handler **always returns HTTP 200** to prevent Meta retries, even on internal errors.

### Media download — two-step process (`_download_wa_media()`)

Images are not embedded in the webhook payload. Only a `media_id` is provided.

```
Step 1: Resolve download URL
GET https://graph.facebook.com/v19.0/{media_id}
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
→ {"url": "https://lookaside.fbsbx.com/..."}

Step 2: Download raw bytes
GET {url}
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
→ raw JPEG bytes
```

### Outbound messages (`shared/whatsapp_client.py`)

All outbound calls POST to:
```
POST https://graph.facebook.com/v19.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
Content-Type: application/json
```

**Text message:**
```json
{
  "messaging_product": "whatsapp",
  "to": "+263771234567",
  "type": "text",
  "text": {"body": "Marking mode ready. Send a student's book photo."}
}
```

**Image message (annotated result):**
```json
{
  "messaging_product": "whatsapp",
  "to": "+263771234567",
  "type": "image",
  "image": {
    "link": "https://neriahstordev.blob.core.windows.net/marked/...?sv=...",
    "caption": "Tendai Moyo: 7/10"
  }
}
```

WhatsApp fetches the image from the SAS URL server-side. The teacher's device never contacts Blob Storage.

### State machine

| State | Trigger | Action |
|---|---|---|
| `IDLE` | Any message | Keyword detection → route to correct state. "setup class" → CLASS_SETUP. "mark" / image → MARKING_ACTIVE. "answer key" → AWAITING_ANSWER_KEY. Else → send help menu. |
| `CLASS_SETUP` | Text | Two-step: collect class name, then education level. Transitions to AWAITING_REGISTER. |
| `AWAITING_REGISTER` | Text or image | Collect student names (text or register OCR). "skip" → AWAITING_ANSWER_KEY. |
| `AWAITING_ANSWER_KEY` | Text or image | "generate" → ask subject → call GPT. Image → OCR question paper → generate scheme. Manual text → parse Q&A pairs. Transitions to MARKING_ACTIVE. |
| `MARKING_ACTIVE` | Image | Full pipeline (currently stubbed for teacher flow; fully implemented for student submissions). "done"/"stop" → IDLE. "next student" → clear student context. |
| `ERROR` | Any | Reset session to IDLE, send recovery prompt. |

**Note:** The teacher scanning path (`_handle_image_submission`) is currently stubbed with `TODO` comments. The student submission path via WhatsApp (`_process_student_submission`) is **fully implemented**.

### Student submission formats accepted via WhatsApp

**Structured format** (caption starts with `NERIAH SUBMISSION`):
```
NERIAH SUBMISSION
Class: A7B3K2
Student: Tendai Moyo
Assignment: Term 1 Mathematics Test
```

**Simple format** (registered student phone, `Name - Assignment` caption):
```
Tendai Moyo - Term 1 Test
```
Phone must be registered as a student. Falls through to teacher state machine if not recognised.

Student matching order: phone match → case-insensitive name match → auto-create (flagged for teacher review).

---

## 7. Email Ingestion

### Trigger

`POST /api/email-webhook` receives `Microsoft.Communication.EmailReceived` (or `InboundEmail`) events from Azure Communication Services via **Event Grid**. Events arrive as a JSON array.

### Event Grid subscription validation

On first subscription, Event Grid sends `Microsoft.EventGrid.SubscriptionValidationEvent`. The handler echoes `data.validationCode`:

```json
{"validationResponse": "<validationCode>"}
```

### Routing logic (`process_inbound_email()`)

```
1. If "APPROVE" in subject:
   Extract submission_id from "APPROVE NER-SUBMISSION-{id}"
   → _approve_submission_internal(submission_id)

2. If subject contains [CODE]:
   Code matches /^[A-Z0-9]{6}$/ (join code)
   → _run_primary_email_pipeline()   ← primary/secondary image submission

   Code matches NER-YYYY-... format
   → look up submission_codes container
   → _run_email_submission_pipeline()  ← tertiary document submission
```

### Attachment extraction

Azure Communication Services delivers attachments inline in the event payload as base64:

```python
attachment = event_data["attachments"][0]
filename         = attachment["name"]
content_type     = attachment["contentType"]
file_bytes       = base64.b64decode(attachment["contentInBase64"])
```

### Primary email pipeline (`_run_primary_email_pipeline`)

Subject format: `[JOIN_CODE] FirstName Surname - Assignment Title`

Example: `[A7B3K2] Tendai Moyo - Term 1 Math Test`

Processing:
1. Parse name and assignment title from subject
2. Resolve class by join code (cross-partition query on `classes`)
3. Match student by case-insensitive first_name + surname
4. Find open answer key by fuzzy title match (`open_for_submission=true`)
5. Quality gate → OCR → grade → annotate → upload → write Mark → push notification to teacher

### Tertiary email pipeline (`_run_email_submission_pipeline`)

Accepts PDF or DOCX attachments. Runs the full tertiary grading pipeline (text extraction → GPT-4o grade → feedback PDF → Submission doc → draft email to lecturer).

---

## 8. Answer Keys and Rubrics

### Answer Keys (`answer_keys` container, partition key `/class_id`)

```json
{
  "id": "<uuid>",
  "class_id": "<uuid>",
  "teacher_id": "<uuid>",
  "subject": "Mathematics",
  "title": "Term 1 Test",
  "education_level": "form_2",
  "questions": [
    {
      "number": 1,
      "correct_answer": "Paris",
      "max_marks": 2.0,
      "marking_notes": null
    },
    {
      "number": 2,
      "correct_answer": "1945",
      "max_marks": 1.0,
      "marking_notes": "Accept 1944–1945"
    }
  ],
  "generated": true,
  "total_marks": 10.0,
  "open_for_submission": true,
  "due_date": "2026-05-01T00:00:00",
  "status": null,
  "created_at": "2026-04-01T08:00:00"
}
```

`status: "pending_setup"` — key was auto-created when a student submitted without a pre-existing homework entry. Teacher must rename it and add a marking scheme.

**Creation paths:**
- Manual: `POST /api/answer-keys` with `questions` array
- Auto-generate: `POST /api/answer-keys` with `auto_generate: true` + `question_paper_text` → calls `generate_marking_scheme()`
- File upload: `PUT /api/answer-keys/{id}` with `multipart/form-data` file → text extracted by `document_extractor`, then auto-generation triggered

**Retrieval at mark time:** `get_item("answer_keys", answer_key_id, class_id)` — single-partition point read, cheapest Cosmos query type.

**Student visibility:** `open_for_submission=true` makes the key visible in `GET /api/assignments`.

---

### Rubrics (`rubrics` container, partition key `/class_id`)

```json
{
  "id": "<uuid>",
  "class_id": "<uuid>",
  "teacher_id": "<uuid>",
  "assignment_name": "Business Report Assignment 2",
  "assignment_brief": "Analyse the financial performance of a SADC-listed company...",
  "criteria": [
    {
      "number": 1,
      "name": "Critical Analysis",
      "description": "Depth and quality of analytical reasoning",
      "max_marks": 25.0,
      "band_descriptors": {
        "distinction": "Sophisticated analysis with well-supported, original arguments",
        "merit": "Good analysis with adequate supporting evidence",
        "pass": "Basic analysis, limited evidence",
        "fail": "Minimal or no analysis"
      }
    }
  ],
  "generated": false,
  "created_at": "2026-04-01T08:00:00"
}
```

The entire rubric is serialised as `rubric.model_dump_json()` and included verbatim in the GPT-4o grading prompt.

---

### Submission Codes (`submission_codes` container, partition key `/class_id`)

```json
{
  "id": "<uuid>",
  "code": "NER-2026-BCOM1-ACCT101-A2",
  "class_id": "<uuid>",
  "teacher_id": "<uuid>",
  "rubric_id": "<uuid>",
  "assignment_name": "Assignment 2",
  "active": true,
  "created_at": "2026-04-01T08:00:00"
}
```

Students include the code in the subject line of their submission email (`[NER-2026-BCOM1-ACCT101-A2] Assignment Title`). The code routes the email to the correct rubric and teacher.

---

## 9. Authentication

**Module:** `shared/auth.py`
**Algorithm:** HS256
**Secret:** `APP_JWT_SECRET`
**Token lifetime:** 365 days

### JWT payload

```json
{
  "id": "<user_id>",
  "phone": "+263771234567",
  "role": "teacher",
  "token_version": 1,
  "iat": 1712345678,
  "exp": 1743881678
}
```

Extra claims may be present (e.g. `class_id` for students).

### Per-request validation

Three helper functions in `shared/auth.py`:

```python
get_user_from_request(req)    # returns decoded payload or None — no exception
require_auth(req)             # raises ValueError("Authentication required") if missing/invalid
require_role(req, "teacher")  # raises ValueError if JWT invalid or role doesn't match
```

Header format: `Authorization: Bearer <token>`

Every protected endpoint calls `require_auth()` or `require_role()` as its first action and returns HTTP 401 on `ValueError`.

### Token version invalidation

On account recovery, `token_version` is incremented in the Cosmos document. The auth middleware checks `payload["token_version"] == db_user["token_version"]`. A mismatch causes a 401 — all previously issued tokens for that account become invalid immediately without requiring a token blacklist.

### OTP delivery

| Phone region | Method | Details |
|---|---|---|
| US (+1) | Twilio Verify API | Twilio handles code delivery and verification via `TWILIO_VERIFY_SID`. No hash stored in Cosmos. |
| International | Twilio Programmable SMS | 6-digit code generated with `secrets.randbelow(1_000_000)`, SHA-256 hashed, stored in `otp_verifications`. Delivered with sender ID `"Neriah"`. |

`otp_method` field on the verification doc (`"self"` vs `"verify"`) determines which path `POST /api/auth/verify` uses.

Attempts are capped at 3. The verification doc auto-deletes via Cosmos TTL after 10 minutes.

### WhatsApp and email channels

No JWT. Sessions are keyed by phone number in the `sessions` container (WhatsApp) or identified by sender email (email webhooks). These channels are secured at the APIM layer.

---

## 10. Environment Variables

All loaded by `shared/config.py` via `pydantic_settings.BaseSettings`. Case-insensitive. Can be sourced from a `.env` file locally or from Azure Functions Application Settings in production.

```bash
# ── Azure Cosmos DB ───────────────────────────────────────────────────────────
AZURE_COSMOS_ENDPOINT
AZURE_COSMOS_KEY

# ── Azure Blob Storage ────────────────────────────────────────────────────────
AZURE_STORAGE_ACCOUNT
AZURE_STORAGE_KEY
AZURE_STORAGE_CONTAINER_SCANS          # default: "scans"
AZURE_STORAGE_CONTAINER_MARKED         # default: "marked"
AZURE_STORAGE_CONTAINER_SUBMISSIONS    # default: "submissions"

# ── Azure OpenAI ──────────────────────────────────────────────────────────────
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_KEY
AZURE_OPENAI_DEPLOYMENT                # default: "gpt-4o"  — quality gate, grading, scheme gen
AZURE_OPENAI_DEPLOYMENT_GPT4O          # default: "gpt-4o"  — document grading, rubric gen

# ── Azure AI Document Intelligence ───────────────────────────────────────────
AZURE_DOC_INTELLIGENCE_ENDPOINT
AZURE_DOC_INTELLIGENCE_KEY

# ── WhatsApp Cloud API (Meta) ─────────────────────────────────────────────────
WHATSAPP_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID

# ── App JWT ───────────────────────────────────────────────────────────────────
APP_JWT_SECRET

# ── Azure Communication Services (email) ─────────────────────────────────────
AZURE_COMMUNICATION_CONNECTION_STRING
NERIAH_EMAIL_FROM_ADDRESS              # default: "mark@neriah.ai"

# ── Legacy ACS SMS (replaced by Twilio — kept for backward compat) ────────────
AZURE_SMS_FROM_NUMBER

# ── Twilio (SMS OTP — primary SMS channel) ────────────────────────────────────
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER                    # used for non-US Programmable SMS
TWILIO_VERIFY_SID                      # Verify Service SID (VAxxxxxxx) — required for US (+1)

# ── EcoCash payments (not yet active) ─────────────────────────────────────────
ECOCASH_API_KEY
ECOCASH_MERCHANT_ID

# ── Function App (used to build approval links in emails) ─────────────────────
FUNCTION_APP_URL                       # default: "https://neriah-func-dev.azurewebsites.net"
FUNCTION_APP_KEY

# ── Runtime ───────────────────────────────────────────────────────────────────
ENVIRONMENT                            # "dev" | "prod"
```

---

## AI Engine Migration Notes (Azure OpenAI → Gemma 4 on GCP)

The entire AI surface is isolated in `shared/openai_client.py`. Replacing the module — or swapping the import — is the complete migration boundary.

### What needs to change

| Item | Current value | What to replace it with |
|---|---|---|
| Client class | `openai.AsyncAzureOpenAI` | Google GenAI SDK / OpenAI-compatible Gemma endpoint client |
| Endpoint config | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY` | GCP project, region, Gemma endpoint URL |
| Model names | `"gpt-4o"` | Gemma 4 model ID |
| Image passing | base64 data URI in `image_url` content block | Google multimodal content format |
| Response format | `response.choices[0].message.content` | equivalent field on the GCP response object |

### What does NOT change

- All 5 prompt templates (system + user message structure)
- All 5 output schemas (JSON arrays and objects)
- All callers throughout the backend (they import `grade_submission`, `check_image_quality`, etc. by name)
- `shared/ocr_client.py` — Azure Document Intelligence is a separate service, not part of the AI engine
- All Cosmos, Blob, and WhatsApp code
