-- Appointment domain table for booking hooks
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  lead_id uuid not null,
  status text not null default 'pending',
  channel text not null default 'messenger',
  start_at timestamptz null,
  end_at timestamptz null,
  calendar_event_id text null,
  source text not null default 'run_replies',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointments_org_lead_idx
  on public.appointments (organization_id, lead_id);
