alter table public.meetings
  add column if not exists transcript_segments jsonb;

comment on column public.meetings.transcript_segments is 'Speaker-labeled transcript segments returned by the transcription provider.';
