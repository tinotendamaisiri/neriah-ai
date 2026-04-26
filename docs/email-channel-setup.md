# Email submission channel — one-time setup

This is the GCP-side and Zoho-side setup that the email-submission code
needs to actually run in production. Code is already wired and tested
(`tests/test_email_submission.py`); these steps are the manual glue.

Estimated time: ~20 minutes.

---

## 1. Generate a Zoho IMAP app password

Zoho's main account password won't work over IMAP if 2FA is enabled (it
should be). Generate a dedicated app password:

1. Sign in to Zoho Mail at https://accounts.zoho.com.
2. **My Account → Security → App Passwords → Generate New Password**.
3. Name it `neriah-email-poller`, click Generate.
4. Copy the password immediately — Zoho only shows it once.

Also confirm IMAP is enabled for `mark@neriah.ai`:

- **Zoho Mail → Settings → Mail Accounts → mark@neriah.ai → IMAP**
- Set status to **Enabled**.

---

## 2. Store the IMAP password in Secret Manager

```bash
echo -n "PASTE_THE_APP_PASSWORD_HERE" \
  | gcloud secrets create ZOHO_IMAP_PASSWORD \
      --replication-policy=automatic \
      --data-file=-

# Grant the Cloud Function runtime SA permission to read it.
gcloud secrets add-iam-policy-binding ZOHO_IMAP_PASSWORD \
  --member=serviceAccount:816807640529-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

---

## 3. Resend API key (for outbound grade replies)

If `RESEND_API_KEY` isn't already set on the existing `neriah-grading`
function, add it. The marketing site already uses Resend, so the
account exists — generate a new API key for the backend:

1. Resend dashboard → API Keys → Create API Key, scope **Sending access
   only**, name `neriah-backend-grading`.
2. Store + grant access:

```bash
echo -n "re_..." \
  | gcloud secrets create RESEND_API_KEY \
      --replication-policy=automatic \
      --data-file=-

gcloud secrets add-iam-policy-binding RESEND_API_KEY \
  --member=serviceAccount:816807640529-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

3. Verify `mark@neriah.ai` as a Resend sending address (already verified
   if the inbox is live; otherwise SPF/DKIM/DMARC for `neriah.ai` need
   to include Resend's records — Resend's domain settings page lists the
   exact TXT/CNAME entries to add at your DNS provider).

---

## 4. Pub/Sub topic + Cloud Scheduler trigger

The poller is a Pub/Sub-triggered Cloud Function. Cloud Scheduler
publishes to the topic every 60 s — Pub/Sub buffers retries and gives
us at-least-once delivery semantics for free.

```bash
# 4a. Create the topic.
gcloud pubsub topics create neriah-email-poll

# 4b. Create the scheduler job (60 s cadence). Cloud Scheduler does
#     "every minute" via the standard cron string; the message body
#     itself is ignored — its arrival is the cron tick.
gcloud scheduler jobs create pubsub neriah-email-poll-cron \
  --location=us-central1 \
  --schedule="* * * * *" \
  --topic=neriah-email-poll \
  --message-body="tick" \
  --time-zone="UTC"
```

If you want a slower cadence (cheaper, higher latency), change the
schedule to `*/2 * * * *` (every 2 min) etc.

---

## 5. Deploy the email-poller Cloud Function

The poller is a separate Cloud Function from `neriah-grading` so its
crashes / quota / cold starts don't bleed into the main HTTP API.

```bash
# Run from the repo root.
gcloud functions deploy neriah-email-poller \
  --gen2 \
  --runtime=python311 \
  --region=us-central1 \
  --source=. \
  --entry-point=poll_email_pubsub \
  --trigger-topic=neriah-email-poll \
  --memory=2Gi \
  --timeout=300s \
  --max-instances=1 \
  --set-env-vars=GCP_PROJECT_ID=neriah-ai-492302,GCS_BUCKET_MARKED=neriah-marked,GCS_BUCKET_SUBMISSIONS=neriah-submissions,RESEND_FROM_ADDRESS=mark@neriah.ai \
  --set-secrets=ZOHO_IMAP_PASSWORD=ZOHO_IMAP_PASSWORD:latest,RESEND_API_KEY=RESEND_API_KEY:latest
```

Important flags:

- `--max-instances=1` — belt-and-braces against double-runs. The
  Firestore lock is the primary guard but the runtime cap is cheaper
  to enforce.
- `--memory=2Gi` — Gemma's grading call peaks ~1.4 GB resident. 2 GB
  gives headroom for pdf2image rendering on large PDFs.
- `--timeout=300s` — matches the lock TTL constant in
  `functions/email_poller.py:LOCK_TTL_SECONDS`.

The `poll_email_pubsub(event, context)` entry point is in
`functions/email_poller.py`.

---

## 6. Smoke test

1. Send a test email **from any non-Zoho address** to `mark@neriah.ai`
   with:
   - Subject: `Name: Your Name | Class: Form 4A | School: Your School`
     (use one that exists in Firestore).
   - Body: anything.
   - Attachment: a clear photo of an answer page that matches an
     existing answer key for that class.
2. Wait ≤ 60 s for the next scheduler tick.
3. Check function logs:
   ```bash
   gcloud functions logs read neriah-email-poller --region=us-central1 --limit=50
   ```
4. Verify in Firestore:
   - `marks` has a new doc with `source: "email_submission"` and
     `approved: false`.
   - `student_submissions` has a companion row with `status: "graded"`.
5. Verify in Zoho Mail:
   - Inbox is empty (the message was MOVE'd).
   - `Processed` folder contains the message.
6. As the teacher, approve the submission in the app. Within a few
   seconds the student should receive the Resend grade-reply email
   with the annotated page attached.

---

## 7. Failure-mode dashboards

Useful queries to bookmark in Cloud Logging:

```
resource.type="cloud_function"
resource.labels.function_name="neriah-email-poller"
severity>=WARNING
```

```
# The processed/failed counts surfaced at the end of every run:
resource.labels.function_name="neriah-email-poller"
jsonPayload.message=~"^email_poller pubsub run"
```

If `ZOHO_IMAP_PASSWORD` rotates, regenerate it in Zoho, update the
secret (`gcloud secrets versions add ZOHO_IMAP_PASSWORD --data-file=-`),
and the function picks up the new version on its next cold start.

---

## What this checklist intentionally does NOT cover

- **DNS / MX records on neriah.ai** — Zoho already owns the inbox so
  the MX records are already correct. No changes needed unless we
  later switch inbound providers.
- **SPF/DKIM/DMARC for outbound from neriah.ai** — done at the time the
  domain was verified for outbound. Resend may need its own SPF
  include if not already present; check `dig TXT neriah.ai +short` —
  the SPF record should include both `_spf.zoho.com` and Resend's
  include host.
- **Cloud Build IAM** — the email-poller is deployed via direct
  `gcloud functions deploy`, not via cloudbuild.yaml, so the existing
  Cloud Build SA permission gap (Secret Manager access) doesn't apply.
