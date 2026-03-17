create extension if not exists pgcrypto;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique,
  title text not null,
  status text not null check (status in ('uploaded', 'transcribing', 'summarizing', 'completed', 'failed')),
  source_type text not null check (source_type in ('upload', 'browser_recording')),
  language text not null default 'ko',
  duration_sec integer,
  prompt_template_id text not null default 'manufacturing-minutes',
  tags text[] not null default '{}',
  transcript_text text,
  summary jsonb,
  file_name text,
  error_message text,
  storage_key text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  stage text not null check (stage in ('transcribe', 'summarize')),
  status text not null check (status in ('queued', 'processing', 'completed', 'failed')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  logs jsonb not null default '[]'::jsonb,
  error_message text,
  error_type text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists meetings_created_at_idx on public.meetings (created_at desc);
create index if not exists jobs_meeting_id_idx on public.jobs (meeting_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at
before update on public.meetings
for each row execute procedure public.set_updated_at();

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
before update on public.jobs
for each row execute procedure public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do nothing;

comment on table public.meetings is 'Brevoca meeting metadata, transcript, and summary results.';
comment on table public.jobs is 'Brevoca processing pipeline status records.';
