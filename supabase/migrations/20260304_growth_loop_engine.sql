-- Growth Loop Engine

create table if not exists public.growth_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  event_type text not null,
  lead_id uuid null,
  appointment_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists growth_events_org_event_created_idx
  on public.growth_events (organization_id, event_type, created_at desc);

create index if not exists growth_events_org_lead_event_idx
  on public.growth_events (organization_id, lead_id, event_type, created_at desc);

create unique index if not exists growth_events_review_requested_once_per_appt
  on public.growth_events (organization_id, event_type, appointment_id)
  where event_type = 'review_requested' and appointment_id is not null;

-- allow multiple open actions per type (needed for per-lead growth actions)
drop index if exists public.actions_one_open_per_type;

create index if not exists actions_org_type_status_idx
  on public.actions (organization_id, type, status, priority desc, created_at desc);
