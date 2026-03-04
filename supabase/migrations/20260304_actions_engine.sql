-- Action Engine core table + indexes

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  type text not null,
  title text not null,
  description text null,
  priority integer not null default 50,
  status text not null default 'open',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists actions_org_status_priority_idx
  on public.actions (organization_id, status, priority desc, created_at desc);

create unique index if not exists actions_one_open_per_type
  on public.actions (organization_id, type)
  where status = 'open';
