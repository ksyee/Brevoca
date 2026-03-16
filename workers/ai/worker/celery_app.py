from celery import Celery

from worker.config import settings

celery_app = Celery(
    "brevoca-ai",
    broker=settings.broker_url,
    backend=settings.result_backend,
)

celery_app.conf.task_default_queue = settings.default_queue
celery_app.conf.task_track_started = True
celery_app.conf.result_expires = 3600

celery_app.autodiscover_tasks(["worker"])
