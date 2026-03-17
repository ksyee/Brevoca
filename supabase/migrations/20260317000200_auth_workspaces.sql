create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  default_workspace_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, user_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_default_workspace_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_default_workspace_id_fkey
      foreign key (default_workspace_id)
      references public.workspaces(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists workspaces_owner_id_idx on public.workspaces (owner_id);
create index if not exists workspace_memberships_user_id_idx on public.workspace_memberships (user_id);
create index if not exists workspace_memberships_workspace_id_idx on public.workspace_memberships (workspace_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute procedure public.set_updated_at();

drop trigger if exists workspace_memberships_set_updated_at on public.workspace_memberships;
create trigger workspace_memberships_set_updated_at
before update on public.workspace_memberships
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;

comment on table public.profiles is 'Brevoca user profiles mapped to Supabase Auth users.';
comment on table public.workspaces is 'Workspace container for meetings and collaboration.';
comment on table public.workspace_memberships is 'Workspace membership and roles.';
