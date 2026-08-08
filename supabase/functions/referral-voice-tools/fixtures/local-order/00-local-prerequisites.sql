-- LOCAL TEST ONLY. Never deploy this compatibility bootstrap.
create extension if not exists pgcrypto with schema extensions;

create table public.organizations (
  id text primary key,
  name text not null
);

create table public.org_members (
  organization_id text not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  primary key (organization_id, user_id)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  channel text not null,
  last_channel text not null,
  channel_user_id text not null,
  service_id text,
  state jsonb not null default '{}'::jsonb,
  full_name text,
  first_name text,
  last_name text,
  handoff_to_human boolean not null default false,
  status text not null default 'contacted',
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, channel_user_id)
);

grant all on table public.organizations, public.org_members, public.leads
  to service_role;

create or replace function public.user_belongs_to_org(p_organization_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members
    where organization_id = p_organization_id and user_id = auth.uid()
  );
$$;

revoke all on function public.user_belongs_to_org(text) from public, anon;
grant execute on function public.user_belongs_to_org(text) to authenticated;
