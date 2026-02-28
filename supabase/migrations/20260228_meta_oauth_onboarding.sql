-- Onboarding + Messenger OAuth support

create table if not exists public.org_settings (
  organization_id text primary key,
  name text,
  business_type text,
  primary_goal text,
  branches jsonb,
  plan text not null default 'trial',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  is_trial_active boolean not null default true,
  stripe_customer_id text,
  stripe_subscription_id text,
  billing_status text,
  meta_page_id text,
  messenger_enabled boolean not null default false,
  meta_connected_at timestamptz,
  meta_last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_settings
  add column if not exists business_type text,
  add column if not exists primary_goal text,
  add column if not exists branches jsonb,
  add column if not exists plan text not null default 'trial',
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists is_trial_active boolean not null default true,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists billing_status text,
  add column if not exists meta_page_id text,
  add column if not exists messenger_enabled boolean not null default false,
  add column if not exists meta_connected_at timestamptz,
  add column if not exists meta_last_error text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.org_secrets (
  organization_id text primary key,
  meta_page_id text,
  meta_page_access_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_secrets
  add column if not exists meta_page_id text,
  add column if not exists meta_page_access_token text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.lead_defaults (
  organization_id text primary key,
  business_type text not null default 'dental',
  primary_goal text not null default 'citas',
  default_status text not null default 'new',
  default_source text not null default 'messenger',
  followup_hours integer not null default 24,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
