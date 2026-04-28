from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # GCP core
    GCP_PROJECT_ID: str = "neriah-ai-492302"
    GCP_REGION: str = "us-central1"

    # Firestore
    FIRESTORE_DATABASE: str = "(default)"

    # Cloud Storage (empty string = not configured; ops that need these will fail at call site)
    GCS_BUCKET_SCANS: str = ""
    GCS_BUCKET_MARKED: str = ""
    GCS_BUCKET_SUBMISSIONS: str = ""

    # Vertex AI / Gemma 4 — serverless Model Garden (MaaS) or dedicated endpoint
    # Serverless (default): publishers/google/models/gemma-4-26b-a4b-it-maas
    # Dedicated endpoint:   projects/.../locations/.../endpoints/{id}  (set VERTEX_ENDPOINT_ID)
    # On-device teacher: gemma-4-e4b-it  |  on-device student: gemma-4-e2b-it
    VERTEX_MODEL_ID: str = "google/gemma-4-26b-a4b-it-maas"   # OpenAI-compat model name for MaaS endpoint
    VERTEX_ENDPOINT_ID: str = ""          # reserved — unused by OpenAI-compat path
    VERTEX_TEMPERATURE: float = 0.1
    VERTEX_MAX_OUTPUT_TOKENS: int = 4096

    # Document AI — tertiary PDF/DOCX OCR only (not used for handwriting marking)
    DOCAI_PROCESSOR_ID: str = ""
    DOCAI_PROCESSOR_LOCATION: str = "us"

    # WhatsApp Cloud API (Meta) — empty = not yet configured (pending Meta business verification)
    WHATSAPP_VERIFY_TOKEN: str = ""
    WHATSAPP_ACCESS_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    # App Secret from Meta developer console — used to verify X-Hub-Signature-256.
    # Leave empty to skip verification in local/demo environments.
    WHATSAPP_APP_SECRET: str = ""

    # App auth (empty string = unconfigured; auth endpoints will fail at call time, not startup)
    APP_JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_DAYS: int = 365

    # Cloud Run batch job
    CLOUD_RUN_JOB_NAME: str = "neriah-batch-grading"

    # Runtime
    ENVIRONMENT: str = "dev"

    # Neriah environment — "production" or "demo"
    # Set NERIAH_ENV=demo when deploying the isolated demo Cloud Function.
    # In demo mode: OTP is bypassed (accept "1234"), WhatsApp/push calls are
    # logged only, and Firestore uses the "demo" database.
    NERIAH_ENV: str = "production"

    # Separate JWT secret for the demo environment
    APP_JWT_SECRET_DEMO: str = ""

    # Training data collection
    # Set GCS_BUCKET_TRAINING to the destination bucket (Nearline, us-central1).
    # Set COLLECT_TRAINING_DATA=false to disable globally (e.g. on staging).
    GCS_BUCKET_TRAINING: str = "neriah-training-data"  # Archive storage class — $0.001/GB/month
    COLLECT_TRAINING_DATA: bool = True

    # Syllabus / curriculum uploads (RAG)
    # Defaults to GCS_BUCKET_SUBMISSIONS if not set (stored under syllabuses/ prefix).
    GCS_BUCKET_SYLLABUSES: str = ""

    # Admin API key — used by the curriculum admin panel and other admin-only routes.
    # Any request with "Authorization: Bearer <ADMIN_API_KEY>" bypasses teacher JWT.
    # Set to a strong random string in production. Empty string disables admin bypass.
    ADMIN_API_KEY: str = ""

    # Resend (outbound email replies for the email-submission channel — sends
    # the annotated grade back to the student after the teacher approves).
    # Empty string = not configured; email replies will be skipped at call time.
    RESEND_API_KEY: str = ""
    # Sends from the Resend-verified subdomain (mark@send.neriah.ai) so
    # SPF/DKIM are aligned to Resend without disturbing the apex SPF
    # record that Zoho relies on for inbound at mark@neriah.ai. The
    # subdomain pattern keeps the two providers isolated cleanly.
    RESEND_FROM_ADDRESS: str = "mark@send.neriah.ai"

    # Zoho IMAP credentials for the inbound email poller (mark@neriah.ai).
    # ZOHO_IMAP_PASSWORD must be an *app-specific* password generated in Zoho
    # account settings — the main account password won't work over IMAP if
    # 2FA is on. Stored in GCP Secret Manager in production.
    ZOHO_IMAP_HOST: str = "imap.zoho.com"
    ZOHO_IMAP_PORT: int = 993
    ZOHO_IMAP_USER: str = "mark@neriah.ai"
    ZOHO_IMAP_PASSWORD: str = ""

    # While the neriah_otp WhatsApp template is awaiting Meta approval, the
    # WhatsApp template send returns HTTP 400 ("Template not found") and the
    # SMS fallback fires (which costs Twilio credits). To let everyone test
    # the verification flow without burning SMS or waiting on Meta, we
    # accept the literal code "000000" as a successful OTP for any phone
    # while this flag is True. Flip to False once Meta approves the
    # template — production must NEVER ship with this enabled.
    WHATSAPP_TEMPLATE_PENDING: bool = True


settings = Settings()


def is_demo() -> bool:
    """Return True when running in the isolated demo environment."""
    return settings.NERIAH_ENV == "demo"
