# NERIAH — Project Status Tracker

**Last updated:** 2026-03-31
**Stack:** Azure Functions v2 (Python 3.11) + React Native (Expo SDK 51) + React/Vite web dashboard

---

## BACKEND STATUS

### Infrastructure
- [x] Azure Functions deployed (`neriah-func-dev`, southafricanorth)
- [x] Cosmos DB — 10 containers provisioned (`neriah-cosmos-dev`, southafricanorth)
- [x] Azure Blob Storage — 3 containers: `scans`, `marked`, `submissions` (`neriahstordev`)
- [x] Azure Document Intelligence (`neriah-docint-dev`, southafricanorth, F0)
- [x] Azure OpenAI — GPT-4o-mini + GPT-4o deployed (`neriah-openai-dev`, eastus)
- [x] Azure Communication Services — email configured (`neriah-comms-dev`)
- [x] ACS domain `neriah.africa` — DKIM + SPF verified, sender `mark@neriah.ai`
- [ ] Azure Communication Services — SMS (`AZURE_SMS_FROM_NUMBER` not purchased yet; falls back to log)
- [x] Bicep IaC templates (`infra/`)
- [ ] Event Grid subscription → `/api/email-webhook` (infrastructure not wired yet)
- [ ] Meta business verification (required for WhatsApp live testing)

### Authentication
- [x] `POST /api/auth/register` (teacher, sends OTP)
- [x] `POST /api/auth/login` (phone + OTP, works for teachers + students)
- [x] `POST /api/auth/verify` (handles `login`, `register`, `activate`, `student_register` purposes)
- [x] `POST /api/auth/resend-otp`
- [x] `GET /api/auth/me` (JWT required, works for both roles)
- [x] `POST /api/auth/student/lookup` (search by phone or name, no auth)
- [x] `POST /api/auth/student/activate` (pre-registered student, sends OTP)
- [x] `POST /api/auth/student/register` (join code + first_name + surname + OTP)
- [x] JWT generation (PyJWT, HS256, 30-day expiry)
- [x] JWT validation middleware (`require_auth`, `require_role`)
- [x] OTP hashing (SHA-256 — never stored raw)
- [x] OTP rate limiting (5 per phone per hour → 429)
- [x] OTP max attempts (3 wrong → locked)
- [x] OTP TTL auto-cleanup (`otp_verifications` container, 10-min TTL)
- [ ] SMS delivery live (falls back to stdout logging until `AZURE_SMS_FROM_NUMBER` set)

### Teacher Endpoints
- [x] `GET /api/classes` (list by teacher JWT)
- [x] `POST /api/classes` (create — auto-generates 6-char join code)
- [x] `PUT /api/classes/{id}` (update name, subject, share_analytics, share_rank)
- [x] `DELETE /api/classes/{id}` (cascade-deletes all students + answer keys)
- [x] `GET /api/students` (list by `class_id` query param)
- [x] `POST /api/students` (create with first_name + surname)
- [x] `PUT /api/students/{id}` (cross-partition update)
- [x] `DELETE /api/students/{id}` (removes from class.student_ids, preserves marks)
- [x] `POST /api/students/batch` (bulk import — partial success, errors returned)
- [x] `GET /api/answer-keys` (list by class)
- [x] `POST /api/answer-keys` (create with `open_for_submission`, teacher_id from JWT)
- [x] `PUT /api/answer-keys/{id}` (update; push batch to students when opened)
- [x] `DELETE /api/answer-keys/{id}` (ownership-guarded)
- [x] `POST /api/mark` (full pipeline: OCR → grade → annotate → store; class_id + source stored)
- [x] `PUT /api/marks/{id}` (teacher approves/edits; push to student on approval)
- [x] `GET /api/submissions` (teacher inbox — primary + tertiary; `type` filter)
- [x] `POST /api/submissions` (tertiary document grading pipeline)
- [x] `POST /api/submissions/{id}/approve` (tertiary approval)

### Student Endpoints
- [x] `GET /api/classes/join/{code}` (validate join code, no auth — returns class + teacher info)
- [x] `POST /api/classes/join` (student JWT — idempotent join, 409 if different class)
- [x] `GET /api/assignments` (student JWT — open answer keys for class)
- [x] `POST /api/submissions/student` (multipart — OCR + grade + annotate; approved=false)
- [x] `GET /api/marks/student/{student_id}` (student JWT — approved marks only)
- [x] `GET /api/submissions/student/{id}` (student JWT — pending + graded; scores hidden for pending)
- [x] `DELETE /api/submissions/student/{mark_id}` (withdraw pending only; 403 if graded)

### Analytics
- [x] `GET /api/analytics/class/{class_id}` (avg, median, high/low, distribution, trend, top/struggling)
- [x] `GET /api/analytics/student/{student_id}` (trend, per-assignment, strengths/weaknesses)
- [x] `GET /api/analytics/teacher/{teacher_id}` (cross-class overview, marks this week)
- [x] `GET /api/analytics/student-class/{class_id}` (student JWT — anonymised, share_analytics/rank flags respected)
- [x] Legacy `GET /api/analytics?class_id=&student_id=` (backwards compat)

### Push Notifications
- [x] `POST /api/push/register` (store Expo push token on teacher or student doc)
- [x] `shared/push_client.py` (Expo Push Service, batches of 100)
- [x] Push on: mark approved → student notified
- [x] Push on: student submits (app channel) → teacher notified
- [x] Push on: student submits (WhatsApp channel) → teacher notified
- [x] Push on: student submits (email channel) → teacher notified
- [x] Push on: assignment opened → all students in class notified (batch)

### WhatsApp Integration
- [x] `GET /api/whatsapp` — webhook verification
- [x] `POST /api/whatsapp` — inbound message handler (async)
- [x] State machine routing (IDLE / CLASS_SETUP / AWAITING_REGISTER / AWAITING_ANSWER_KEY / MARKING_ACTIVE / ERROR)
- [x] Student submission: structured format (`NERIAH SUBMISSION\nClass: CODE\n...`)
- [x] Student submission: simple format (phone-registered student + `Name - Assignment`)
- [x] Student auto-create if new name matches valid join code
- [x] Bad format → template reply sent, no state held
- [x] Name enforcement (2+ words required)
- [x] Student submission pipeline (quality gate → OCR → grade → annotate → store; source=`whatsapp`)
- [ ] Teacher marking pipeline (`_handle_image_submission`) — skeleton exists, TODO stubs remain
- [ ] Class setup flow — conversation steps scaffolded, Cosmos writes not implemented
- [ ] Register photo OCR → student name extraction (scaffolded, not implemented)
- [ ] Answer key photo → OCR → generate scheme → confirm (scaffolded, not implemented)

### Email Integration
- [x] `POST /api/email-webhook` (Event Grid receiver + subscription validation handshake)
- [x] Tertiary: `[NER-CODE]` subject → submission code lookup → grading pipeline
- [x] Primary/secondary: `[JOIN_CODE]` (6-char alphanum) → student match → marking pipeline
- [x] Both channels: source=`email`, approved=false, push to teacher on receipt
- [ ] Event Grid subscription wired (infrastructure step — not yet done)

### Data Models (`shared/models.py`)
- [x] `Teacher`: first_name + surname, push_token, school, subscription_status
- [x] `Student`: first_name + surname, class_id (partition key), phone, push_token
- [x] `Class`: join_code, subject, education_level, share_analytics, share_rank
- [x] `AnswerKey`: title, teacher_id, open_for_submission, total_marks, questions
- [x] `Mark`: class_id, source, verdicts, percentage, approved, approved_at, feedback
- [x] `OTPVerification`: phone, hashed code, purpose, pending_data, TTL=600s
- [x] `Session`: WhatsApp state machine
- [x] `Rubric` + `Submission` + `SubmissionCode`: tertiary pipeline (unchanged)

### Scripts & Migrations
- [x] `scripts/migrate_names.py` — split `name` → `first_name` + `surname` (`--dry-run` flag)
- [x] `scripts/backfill_class_id.py` — add `class_id` to existing marks (`--dry-run` flag)
- [x] `scripts/deploy.sh`
- [x] `scripts/seed_dev.py`

### Bugs Fixed (Phase 12a)
- [x] `answer_keys.py`: `generate_marking_scheme()` was not awaited
- [x] `classes.py`: async Cosmos calls not awaited (used sync wrappers incorrectly)
- [x] `students.py`: async Cosmos calls not awaited
- [x] `mark.py`: `settings.azure_storage_container_marked` called as function (`()`) instead of property
- [x] `students.py`: `phone` not accepted in POST body
- [x] `whatsapp_webhook.py`: `upsert_session` referenced in `_handle_error` (should be `save_session`)
- [x] `mark.py`: `class_id`, `source`, `percentage`, `approved` not stored on Mark document

---

## WEB DASHBOARD STATUS

- [x] Vite + React + TypeScript scaffold (`app/web/`)
- [x] Tailwind CSS configured (brand color `#22c55e`)
- [x] `src/services/api.ts` — typed axios client, all endpoints, JWT interceptor, 401 handler
- [x] `src/context/AuthContext.tsx` — localStorage JWT + user, login/logout
- [x] `src/pages/Login.tsx` — phone + OTP two-step flow, auto-submit, resend cooldown
- [x] `src/App.tsx` — `RequireAuth` guard, `Layout` with sticky nav, routes
- [x] `src/pages/Dashboard.tsx` — class grid, stats row, "+ New Class" modal, empty state
- [x] `src/pages/ClassView.tsx` — students table, analytics, "Add Student" modal, answer keys tab, delete class

---

## MOBILE APP STATUS

> Note: The mobile app files in `app/mobile/` were scaffolded and partially implemented
> (screens, types, API service, auth context, offline queue). Full build from scratch
> is a separate workstream. See Phase 13 below.

### Scaffolded & Partially Implemented
- [x] `package.json` — all deps listed (Expo SDK 51, React Navigation v6, AsyncStorage, NetInfo)
- [x] `src/types/index.ts` — TypeScript types aligned with backend models
- [x] `src/services/api.ts` — axios client, JWT interceptor, all endpoints
- [x] `src/context/AuthContext.tsx` — AsyncStorage JWT, push token registration on login
- [x] `App.tsx` — auth gate (AuthStack / RootStack), offline queue listener
- [x] `src/screens/PhoneScreen.tsx` — phone entry, login/register flow
- [x] `src/screens/OTPScreen.tsx` — 6-digit input, auto-submit, resend cooldown
- [x] `src/screens/HomeScreen.tsx` — class list, pull-to-refresh, greeting
- [x] `src/screens/MarkingScreen.tsx` — student + answer key pickers, scan, result
- [x] `src/screens/ClassDetailScreen.tsx` — student list, answer keys, add student/answer key modals
- [x] `src/screens/ClassSetupScreen.tsx` — create class with level + subject
- [x] `src/screens/SettingsScreen.tsx` — profile, logout
- [x] `src/components/ScanButton.tsx`, `StudentCard.tsx`, `MarkResult.tsx`
- [x] `src/services/offlineQueue.ts` — AsyncStorage queue, retry logic, dead-letter, NetInfo listener
- [ ] `npm install` not yet run in `app/mobile/` — run before `expo start`
- [ ] End-to-end testing on device not yet done

---

## COMPLETE API SURFACE (38 routes)

| # | Method | Route | Auth |
|---|--------|-------|------|
| 1 | GET | `/api/whatsapp` | — |
| 2 | POST | `/api/whatsapp` | — |
| 3 | POST | `/api/auth/register` | — |
| 4 | POST | `/api/auth/login` | — |
| 5 | POST | `/api/auth/verify` | — |
| 6 | POST | `/api/auth/resend-otp` | — |
| 7 | GET | `/api/auth/me` | any JWT |
| 8 | POST | `/api/auth/student/lookup` | — |
| 9 | POST | `/api/auth/student/activate` | — |
| 10 | POST | `/api/auth/student/register` | — |
| 11 | POST | `/api/push/register` | any JWT |
| 12 | GET | `/api/classes` | teacher |
| 13 | POST | `/api/classes` | teacher |
| 14 | PUT | `/api/classes/{class_id}` | teacher |
| 15 | DELETE | `/api/classes/{class_id}` | teacher |
| 16 | GET | `/api/classes/join/{code}` | — |
| 17 | POST | `/api/classes/join` | student |
| 18 | GET | `/api/students` | teacher |
| 19 | POST | `/api/students` | teacher |
| 20 | POST | `/api/students/batch` | teacher |
| 21 | PUT | `/api/students/{student_id}` | teacher |
| 22 | DELETE | `/api/students/{student_id}` | teacher |
| 23 | GET | `/api/answer-keys` | teacher |
| 24 | POST | `/api/answer-keys` | teacher |
| 25 | PUT | `/api/answer-keys/{answer_key_id}` | teacher |
| 26 | DELETE | `/api/answer-keys/{answer_key_id}` | teacher |
| 27 | POST | `/api/mark` | teacher |
| 28 | PUT | `/api/marks/{mark_id}` | teacher |
| 29 | GET | `/api/marks/student/{student_id}` | student |
| 30 | GET | `/api/assignments` | student |
| 31 | POST | `/api/submissions/student` | student |
| 32 | GET | `/api/submissions/student/{id}` | student |
| 33 | DELETE | `/api/submissions/student/{id}` | student |
| 34 | GET | `/api/analytics` | teacher (legacy) |
| 35 | GET | `/api/analytics/class/{class_id}` | teacher |
| 36 | GET | `/api/analytics/student/{student_id}` | teacher |
| 37 | GET | `/api/analytics/teacher/{teacher_id}` | teacher |
| 38 | GET | `/api/analytics/student-class/{class_id}` | student |
| 39 | GET | `/api/submissions` | teacher |
| 40 | POST | `/api/submissions` | — |
| 41 | POST | `/api/submissions/{submission_id}/approve` | — |
| 42 | POST | `/api/email-webhook` | — |

---

## PENDING INFRASTRUCTURE

- [ ] **ACS SMS** — purchase phone number in Azure portal; set `AZURE_SMS_FROM_NUMBER`
- [ ] **Meta business verification** — required before WhatsApp bot goes live
- [ ] **Event Grid subscription** — wire inbound email events → `/api/email-webhook`
- [ ] **Domain migration** — update `neriah.africa` → `neriah.ai` in all Azure configs
- [ ] **ACS email** — re-verify `mark@neriah.ai` sender domain (currently `mark@neriah.africa`)

---

## TEST CASES

### Backend Auth Tests
1. Register teacher with valid data → 200 + `verification_id`
2. Register teacher with existing phone → 409
3. Register teacher with invalid phone format → 400
4. Verify OTP correct code → 200 + JWT + user
5. Verify OTP wrong code → 401 + attempts incremented
6. Verify OTP after 3 wrong attempts → 429
7. Verify OTP after expiry (10 min) → 410
8. Resend OTP → new `verification_id`
9. Rate limit: 6th OTP request in 1 hour → 429
10. Login with registered phone → 200 + OTP sent
11. Login with unregistered phone → 404
12. `GET /api/auth/me` with valid teacher JWT → 200 + user
13. `GET /api/auth/me` with expired JWT → 401
14. `GET /api/auth/me` with no header → 401

### Student Auth Tests
15. Student lookup by phone (match) → `matches` array with 1 entry
16. Student lookup by name (match) → `matches` array
17. Student lookup (no match) → `{ "matches": [] }`
18. Student activate (valid student_id) → 200 + OTP sent
19. Student register with valid join code → 200 + OTP sent
20. Student register with invalid join code → 400

### Class & Join Code Tests
21. Create class → `join_code` auto-generated (6 chars, A-Z0-9)
22. `GET /api/classes/join/{valid_code}` → class info + teacher name + student count
23. `GET /api/classes/join/{invalid_code}` → 404
24. Student joins class with valid code → 200
25. Student tries to join class they're already in → 409
26. Student tries to join second class while in first → 400
27. Delete class → cascade-deletes students + answer keys

### Student Submission Tests
28. Student submits with valid open answer key → 200 + mark created (`approved=false`)
29. Student submits duplicate (pending exists) → 409
30. Student submits against closed answer key → 400 / 403
31. Student withdraws pending submission → 200 + mark deleted
32. Student withdraws graded submission → 403
33. `GET /api/marks/student/{id}` → only approved marks returned
34. `GET /api/submissions/student/{id}` → pending shows null score; graded shows score

### Teacher Marking Tests
35. `POST /api/mark` → full pipeline, mark stored with `class_id`, `source=teacher_scan`, `approved=true`
36. `PUT /api/marks/{id}` approve → `approved=true`, push sent to student
37. `PUT /api/marks/{id}` edit score → score + percentage updated
38. Batch import 5 students → 5 created
39. Batch import with duplicate name → error for that entry, others succeed

### Analytics Tests
40. Class analytics empty (no marks) → zeros, empty arrays
41. Class analytics with data → correct avg, median, distribution, trend
42. Student analytics → trend array in timestamp order, per-assignment breakdown
43. Teacher analytics → total across all classes, marks_this_week correct
44. Student-class analytics (`share_analytics=true`) → data, no other student names
45. Student-class analytics (`share_analytics=false`) → `{ "enabled": false }`
46. Student-class analytics (`share_rank=true`) → includes `student_rank` + `total_students`
47. Student-class analytics (`share_rank=false`) → rank fields absent
48. Student requests another student's analytics → 403

### Push Notification Tests
49. Register push token (teacher) → stored on teacher document
50. Register push token (student) → stored on student document
51. Mark approved → student push received
52. Student submits → teacher push received
53. Answer key opened → batch push to all students in class

### WhatsApp Submission Tests
54. Structured format, valid code + full name + open assignment → pipeline runs, teacher notified
55. Structured format, invalid code → format template reply
56. Structured format, 1-word name → format template reply
57. Structured format, unknown student → auto-created, teacher notified
58. Simple format, pre-registered phone → pipeline runs
59. Simple format, unregistered phone → no match, falls through to teacher state machine
60. Photo with no caption → format template reply

### Email Submission Tests
61. `[A7B3K2] Tendai Moyo - Term 1 Math Test` + image → primary pipeline runs
62. `[NER-2026-BCOM1-ACCT101-A2] Essay Title` + PDF → tertiary pipeline runs
63. Subject without bracket code → error reply
64. Valid code but student name not in class → error reply

### Cross-Role Integration Tests
65. Teacher creates class → join_code exists in response
66. Teacher adds students manually
67. Teacher creates answer key, opens for submission
68. Student registers with join code → can see assignment
69. Student submits via app → teacher sees in inbox (`source=student_submission`)
70. Teacher grades → student sees feedback with annotated image
71. Teacher enables `share_analytics` → student sees class performance
72. Teacher disables → `{ "enabled": false }` for student

---

## ENVIRONMENT VARIABLES

### Configured in Azure Function App Settings
```
AZURE_COSMOS_ENDPOINT
AZURE_COSMOS_KEY
AZURE_COSMOS_DATABASE          (default: "neriah")
AZURE_STORAGE_ACCOUNT
AZURE_STORAGE_KEY
AZURE_STORAGE_CONTAINER_SCANS
AZURE_STORAGE_CONTAINER_MARKED
AZURE_STORAGE_CONTAINER_SUBMISSIONS
AZURE_DOC_INTELLIGENCE_ENDPOINT
AZURE_DOC_INTELLIGENCE_KEY
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_KEY
AZURE_OPENAI_DEPLOYMENT        (gpt-4o-mini)
AZURE_OPENAI_DEPLOYMENT_GPT4O  (gpt-4o)
AZURE_COMMUNICATION_CONNECTION_STRING
NERIAH_EMAIL_FROM_ADDRESS      (mark@neriah.ai)
APP_JWT_SECRET
WHATSAPP_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
FUNCTION_APP_URL               (https://neriah-func-dev.azurewebsites.net)
```

### Not Yet Configured
```
AZURE_SMS_FROM_NUMBER   # empty = OTP logged to stdout (dev fallback)
```

---

## WHAT'S NEEDED BEFORE MOBILE BUILD

1. **Backend deployed** — `func azure functionapp publish neriah-func-dev --python --build remote`
2. **`otp_verifications` container** — deploy updated `infra/modules/cosmos.bicep`
3. **Test teacher registration** — POST /api/auth/register with a real phone number
4. **`AZURE_SMS_FROM_NUMBER`** — purchase in Azure portal to receive live OTPs
5. **Migration scripts** — run `scripts/migrate_names.py` + `scripts/backfill_class_id.py` on prod data
6. **`npm install` in `app/mobile/`** — install Expo SDK 51 + all new deps
7. **`app.json` API URL** — confirm `extra.apiBaseUrl` points to live function app URL

---

## KNOWN ISSUES

| Issue | Severity | Status |
|-------|----------|--------|
| WhatsApp teacher marking pipeline (`_handle_image_submission`) — pipeline is stubbed, not implemented | Medium | Open — needs implementation in Phase 12e |
| WhatsApp class setup flow — conversation steps scaffolded but Cosmos writes not implemented | Medium | Open — Phase 12e |
| Event Grid → email-webhook not wired | Medium | Infrastructure task |
| ACS SMS phone number not purchased | Low | Unblocks live OTP only |
| `mark@neriah.ai` domain not yet re-verified in ACS | Low | Email won't send until done |
