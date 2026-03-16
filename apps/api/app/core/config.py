from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Brevoca API"
    app_env: str = "development"
    api_prefix: str = "/v1"
    postgres_dsn: str = "postgresql://brevoca:brevoca@localhost:5432/brevoca"
    redis_url: str = "redis://localhost:6379/0"
    storage_endpoint: str = "http://localhost:9000"
    storage_bucket: str = "brevoca-dev"

    model_config = SettingsConfigDict(
        env_prefix="BREVOCA_",
        extra="ignore",
    )


settings = Settings()
