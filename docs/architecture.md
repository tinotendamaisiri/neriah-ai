# Neriah Architecture

## Overview

Neriah is a serverless, event-driven system. All backend logic runs in Azure Functions (Python 3.11) on a Consumption plan — no standing compute cost.

```
Teacher (WhatsApp) ──→ Meta Webhook ──→ APIM ──→ /api/whatsapp (AzFunc)
                                                        │
Teacher (App)      ──→ REST API     ──→ APIM ──→ /api/mark      (AzFunc)
                                                        │
                                              ┌─────────▼──────────┐
                                              │  Marking Pipeline  │
                                              │  1. Quality gate   │
                                              │  2. OCR (Doc Intel)│
                                              │  3. Grade (OpenAI) │
                                              │  4. Annotate (PIL) │
                                              │  5. Store (Cosmos) │
                                              └─────────┬──────────┘
                                                        │
                                              Blob Storage (marked/)
                                              Cosmos DB   (marks/)
```

## Component Responsibilities

| Component | Responsibility |
|---|---|
| Azure API Management | Single entry point. Webhook verification, JWT validation, rate limiting. |
| `whatsapp_webhook.py` | Stateful conversation handler. Reads/writes session state in Cosmos. Routes to pipeline. |
| `mark.py` | Stateless pipeline orchestrator. Called by webhook handler and directly by App. |
| `shared/ocr_client.py` | Thin wrapper over Azure AI Document Intelligence. |
| `shared/openai_client.py` | Three GPT-4o-mini calls: quality check, grading, scheme generation. |
| `shared/annotator.py` | In-memory Pillow drawing. No disk I/O. Returns JPEG bytes. |
| `shared/cosmos_client.py` | CRUD helpers for all 6 Cosmos containers. |
| `shared/blob_client.py` | Upload/download + SAS URL generation for Azure Blob Storage. |

## Data Flow (Happy Path — WhatsApp Marking)

```
1. Teacher sends photo via WhatsApp
2. Meta sends POST to /api/whatsapp (APIM forwards)
3. whatsapp_webhook.py extracts phone, media_id, looks up session
4. Session state = MARKING_ACTIVE → _handle_image_submission()
5. Download image bytes from WhatsApp media API
6. check_image_quality(bytes) → pass ✓
7. upload_scan(bytes) → raw_scan_url (blob storage, scans/)
8. run_ocr(bytes) → full_text + bounding_boxes
9. Load AnswerKey from Cosmos (answer_keys container)
10. grade_submission(text, answer_key, education_level) → verdicts
11. annotate_image(bytes, boxes, verdicts) → annotated_bytes
12. upload_marked(annotated_bytes) → marked_image_url (blob storage, marked/)
13. upsert Mark document to Cosmos (marks container)
14. send_image(phone, marked_image_url, caption="Score: X/Y")
```

## TODO: Add sequence diagrams for:
- Class setup flow (WhatsApp)
- Answer key auto-generation flow
- Bulk marking session
