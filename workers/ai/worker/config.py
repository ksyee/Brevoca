from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    broker_url: str = "redis://localhost:6379/0"
    result_backend: str = "redis://localhost:6379/1"
    default_queue: str = "brevoca-ai"

    model_config = SettingsConfigDict(
        env_prefix="BREVOCA_WORKER_",
        extra="ignore",
    )


settings = WorkerSettings()
