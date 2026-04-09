from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # GCP core
    GCP_PROJECT_ID: str = "neriah-ai-492302"
    GCP_REGION: str = "us-central1"

    # Firestore
    FIRESTORE_DATABASE: str = "(default)"

    # Cloud Storage
    GCS_BUCKET_SCANS: str
    GCS_BUCKET_MARKED: str
    GCS_BUCKET_SUBMISSIONS: str

    # Inference backend: "ollama" (local) | "vertex" (GCP dedicated endpoint)
    INFERENCE_BACKEND: str = "ollama"

    # Ollama — local inference
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL_STUDENT: str = "gemma4:e2b"                  # simple / student queries
    OLLAMA_MODEL_TEACHER: str = "gemma4:latest"               # teacher grading / complex tasks
    OLLAMA_MODEL_CLOUD: str = "gemma4:26b-a4b-it-q4_K_M"     # cloud-equivalent quantised model

    # Vertex AI / Gemma 4 — dedicated endpoint (required when INFERENCE_BACKEND=vertex)
    # Cloud inference model: gemma-4-26b-a4b-it
    # On-device teacher: gemma-4-e4b-it  |  on-device student: gemma-4-e2b-it
    VERTEX_MODEL_ID: str = "gemma-4-26b-a4b-it"
    VERTEX_ENDPOINT_ID: str = ""          # projects/.../locations/.../endpoints/{id}
    VERTEX_TEMPERATURE: float = 0.1
    VERTEX_MAX_OUTPUT_TOKENS: int = 4096

    # Document AI — tertiary PDF/DOCX OCR only (not used for handwriting marking)
    DOCAI_PROCESSOR_ID: str = ""
    DOCAI_PROCESSOR_LOCATION: str = "us"

    # WhatsApp Cloud API (Meta)
    WHATSAPP_VERIFY_TOKEN: str
    WHATSAPP_ACCESS_TOKEN: str
    WHATSAPP_PHONE_NUMBER_ID: str

    # App auth
    APP_JWT_SECRET: str
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
    GCS_BUCKET_TRAINING: str = "neriah-training-data"
    COLLECT_TRAINING_DATA: bool = True


settings = Settings()


def is_demo() -> bool:
    """Return True when running in the isolated demo environment."""
    return settings.NERIAH_ENV == "demo"
