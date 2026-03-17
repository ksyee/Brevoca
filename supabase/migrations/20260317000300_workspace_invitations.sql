create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'member')),
  invited_by_user_id uuid not null references auth.users(id) on delete cascade,
  accepted_by_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists workspace_invitations_pending_unique_idx
on public.workspace_invitations (workspace_id, lower(email))
where accepted_at is null and revoked_at is null;

create index if not exists workspace_invitations_workspace_id_idx on public.workspace_invitations (workspace_id);
create index if not exists workspace_invitations_email_idx on public.workspace_invitations (lower(email));

drop trigger if exists workspace_invitations_set_updated_at on public.workspace_invitations;
create trigger workspace_invitations_set_updated_at
before update on public.workspace_invitations
for each row execute procedure public.set_updated_at();

alter table public.workspace_invitations enable row level security;

comment on table public.workspace_invitations is 'Pending and accepted workspace invitations.';
