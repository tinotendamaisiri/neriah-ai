# Neriah AI
AI-powered homework grading for African classrooms. 
Students photograph their handwritten exercise books 
and submit via app, WhatsApp, or email. Gemma 4 
grades the submission. The teacher reviews and 
approves on their dashboard.

Built for the Gemma 4 Good Hackathon on Kaggle 
(deadline May 18, 2026).

## Live Demo
Backend: https://us-central1-neriah-ai-492302.cloudfunctions.net/neriah-grading

## Architecture
- Cloud Functions (Python 3.11) — all HTTP endpoints
- Firestore — data storage
- Google Cloud Storage — image storage  
- Gemma 4 via Ollama (local dev) / Vertex AI (production)
- React Native + Expo — mobile app
- Twilio — OTP SMS
- WhatsApp Cloud API — submission channel

## What is Built

### Backend
- [x] Authentication — OTP via Twilio, JWT, PIN login
- [x] Teacher registration and profile management
- [x] Student registration (app and WhatsApp)
- [x] Class management with ZIMSEC/Cambridge curriculum
- [x] Student roster with bulk import (photo, Excel, CSV, PDF, Word)
- [x] Answer key / homework creation
- [x] Gemma 4 grading engine (single multimodal call, no OCR step)
- [x] Grading pipeline — batch architecture when teacher closes submissions
- [x] WhatsApp webhook — student submission and state machine
- [x] WhatsApp student onboarding flow
- [x] Analytics endpoints
- [x] Push notification registration
- [x] Schools seed data (20 Zimbabwean schools)
- [x] Student extraction from image (Gemma 4 reads class register photo)
- [x] Student extraction from file (Excel, CSV, PDF, Word)

### Mobile App (Teacher)
- [x] Role select screen
- [x] Teacher registration with school picker
- [x] OTP verification
- [x] PIN setup and PIN login (persistent session)
- [x] Terms of service and privacy policy
- [x] User agreement on first login
- [x] Home screen with class cards
- [x] Create class (curriculum, education level, student roster table)
- [x] Class detail screen with student list
- [x] Student profile with grading history
- [x] Add homework screen (Camera, Gallery, PDF, Word, Text upload)
- [x] Settings with profile editing (OTP verified before save)
- [x] Language picker (English, Shona, Ndebele)
- [x] Offline queue for scans
- [x] Network banner

### Mobile App (Student)
- [x] Student registration (phone, school, class selection)
- [x] Student home screen
- [x] Assignment list
- [x] Camera submission flow (multi-page)
- [x] 3-channel submission (App, WhatsApp, Email)
- [x] Results screen
- [x] Feedback screen with annotated image
- [x] Student analytics

## What is NOT Yet Built

### Backend
- [ ] Batch grading job (Cloud Run Job) — code written, GPU quota pending
- [ ] Vertex AI serverless Gemma 4 — waiting for Google to launch
- [ ] Marking scheme auto-generation wired to homework creation
- [ ] Push notification delivery (token registered, listener not set up)
- [ ] WhatsApp teacher scanning flow (stubbed)
- [ ] Email ingestion (SendGrid inbound)
- [ ] Student AI tutor endpoint
- [ ] Offline grading sync endpoint

### Mobile App
- [ ] Photo guidance (real-time camera quality check via LiteRT)
- [ ] Photo enhancement (on-device before submission)
- [ ] Student AI tutor screen
- [ ] Offline individual grading (teacher grades with E4B on device)
- [ ] Graded offline badge on results
- [ ] HomeworkDetailScreen — close and grade all button
- [ ] Push notification listener in AppShell
- [ ] PIN lock enforcement on cold start (PIN saved but not checked)

### Infrastructure
- [ ] LiteRT on-device model integration (E2B for student, E4B for teacher)
- [ ] Cloud Run Job for batch grading (waiting on GPU quota)
- [ ] Vertex AI serverless Gemma 4 (waiting for Google launch)
- [ ] Fine-tuning pipeline on ZIMSEC data

## Running Locally
```bash
cd app/mobile && npm install && npx expo start
cd neriah-ai && pip install -r requirements.txt
INFERENCE_BACKEND=ollama OLLAMA_BASE_URL=http://localhost:11434 \
functions-framework --target neriah --debug
```

## Environment Variables
See `.env.example` for full list.
Key variables:
- `GCP_PROJECT_ID=neriah-ai-492302`
- `INFERENCE_BACKEND=ollama|vertex`
- `OLLAMA_BASE_URL=http://localhost:11434`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `APP_JWT_SECRET`

## Hackathon
Gemma 4 Good Hackathon on Kaggle — deadline May 18 2026  
Prize categories: Main Track ($50K), Future of Education ($10K),
Digital Equity ($10K), Cactus model routing ($10K), LiteRT ($10K)
