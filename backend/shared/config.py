# shared/config.py
# Loads all environment variables via pydantic-settings BaseSettings.
# Import `settings` anywhere in the backend to access config values.

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Azure Cosmos DB
    azure_cosmos_endpoint: str
    azure_cosmos_key: str

    # Azure Blob Storage
    azure_storage_account: str
    azure_storage_key: str
    azure_storage_container_scans: str = "scans"
    azure_storage_container_marked: str = "marked"
    azure_storage_container_submissions: str = "submissions"

    # Azure OpenAI
    azure_openai_endpoint: str
    azure_openai_key: str
    azure_openai_deployment: str = "gpt-4o"
    azure_openai_deployment_gpt4o: str = "gpt-4o"

    # Azure AI Document Intelligence
    azure_doc_intelligence_endpoint: str
    azure_doc_intelligence_key: str

    # WhatsApp Cloud API
    whatsapp_verify_token: str
    whatsapp_access_token: str
    whatsapp_phone_number_id: str

    # EcoCash (MVP: not yet active)
    ecocash_api_key: str = ""
    ecocash_merchant_id: str = ""

    # App auth
    app_jwt_secret: str

    # Azure Communication Services (email)
    azure_communication_connection_string: str = ""
    neriah_email_from_address: str = "mark@neriah.ai"

    # Azure Communication Services (SMS — legacy, replaced by Twilio)
    azure_sms_from_number: str = ""         # kept for backward compat — no longer used for OTP

    # Twilio (SMS OTP — primary SMS channel)
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""           # used for non-US Programmable SMS if needed
    twilio_verify_sid: str = ""             # Verify Service SID (VAxxxxxxx) — required for US (+1) numbers

    # Function App (used to build approval links in emails)
    function_app_url: str = "https://neriah-func-dev.azurewebsites.net"
    function_app_key: str = ""

    # Runtime
    environment: str = "dev"

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    # TODO: in production, load secrets from Azure Key Vault instead of env vars
    return Settings()


settings = get_settings()
