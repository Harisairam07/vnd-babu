from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
  model_config = SettingsConfigDict(
    env_file=".env",
    env_file_encoding="utf-8",
    extra="ignore",
    populate_by_name=True,
  )

  app_name: str = "VND Babu Financial Solutions API"
  app_env: str = "development"

  mongo_uri: str = Field(default="mongodb://localhost:27017", alias="MONGO_URI")
  mongo_db: str = Field(default="vnd_babu_finance", alias="MONGO_DB")

  jwt_secret_key: str = Field(default="change-this-in-production", alias="JWT_SECRET_KEY")
  jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
  jwt_expire_minutes: int = Field(default=720, alias="JWT_EXPIRE_MINUTES")

  admin_email: str = Field(default="admin", alias="ADMIN_EMAIL")
  admin_password: str = Field(default="admin", alias="ADMIN_PASSWORD")

  duplicate_window_minutes: int = Field(default=20, alias="DUPLICATE_WINDOW_MINUTES")
  whatsapp_webhook_url: str | None = Field(default=None, alias="WHATSAPP_WEBHOOK_URL")
  whatsapp_enabled: bool = Field(default=False, alias="WHATSAPP_ENABLED")

  cors_origins: List[str] = ["*"]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
  return Settings()
