alter table public.meetings
  drop constraint if exists meetings_status_check;

alter table public.meetings
  add constraint meetings_status_check
  check (status in ('uploaded', 'transcribing', 'summarizing', 'completed', 'failed', 'canceled'));

alter table public.jobs
  drop constraint if exists jobs_status_check;

alter table public.jobs
  add constraint jobs_status_check
  check (status in ('queued', 'processing', 'completed', 'failed', 'canceled'));
