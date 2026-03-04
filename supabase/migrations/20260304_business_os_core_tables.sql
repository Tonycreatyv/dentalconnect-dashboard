-- Business OS core minimal tables (multi-tenant via organization_id)

alter table if exists public.leads
  add column if not exists last_channel text;

alter table if exists public.reply_outbox
  drop constraint if exists reply_outbox_status_check;

alter table if exists public.reply_outbox
  add constraint reply_outbox_status_check
  check (status in ('pending', 'queued', 'processing', 'sent', 'failed', 'error', 'paused', 'skipped', 'dead', 'failed_terminal'));

create unique index if not exists reply_outbox_org_inbound_provider_mid_unique
  on public.reply_outbox (organization_id, inbound_provider_message_id)
  where inbound_provider_message_id is not null;

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  lead_id uuid null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_events_org_created_idx
  on public.lead_events (organization_id, created_at desc);

create table if not exists public.content_library (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  category text not null,
  key text not null,
  value_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create unique index if not exists content_library_org_category_key_unique
  on public.content_library (organization_id, category, key);

create table if not exists public.marketing_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  period_start date not null,
  period_end date not null,
  metric_key text not null,
  metric_value_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketing_insights_org_period_idx
  on public.marketing_insights (organization_id, period_start desc, period_end desc);

create table if not exists public.marketing_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  week_of date not null,
  type text not null,
  title text not null,
  reason text null,
  steps_json jsonb not null default '[]'::jsonb,
  assets_json jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create index if not exists marketing_recommendations_org_week_idx
  on public.marketing_recommendations (organization_id, week_of desc, status);

create table if not exists public.recall_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  service_type text not null,
  interval_days integer not null,
  template text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists recall_rules_org_service_unique
  on public.recall_rules (organization_id, service_type);
