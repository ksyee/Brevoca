-- meetings 테이블에 workspace_id 컬럼 추가
-- 기존 데이터에는 null이 허용되지만, 앱 레이어에서 not null을 보장합니다.
alter table public.meetings
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

create index if not exists meetings_workspace_id_idx on public.meetings (workspace_id);

comment on column public.meetings.workspace_id is 'Workspace that owns this meeting. Used for authorization filtering.';
