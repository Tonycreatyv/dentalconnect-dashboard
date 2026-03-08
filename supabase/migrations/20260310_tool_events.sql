-- Ensure lead_events can store structured action audit details
create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  lead_id uuid null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.lead_events
  alter column payload set default '{}'::jsonb;

create index if not exists lead_events_org_created_idx
  on public.lead_events (organization_id, created_at desc);

create index if not exists lead_events_lead_idx
  on public.lead_events (lead_id);

create index if not exists lead_events_org_event_type_idx
  on public.lead_events (organization_id, event_type);
