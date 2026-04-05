alter table if exists public.org_settings
  add column if not exists whatsapp_phone_number_id text,
  add column if not exists whatsapp_business_account_id text,
  add column if not exists whatsapp_enabled boolean default false,
  add column if not exists whatsapp_access_token text;

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id text references public.organizations(id) on delete cascade,
  name text not null,
  language text default 'es',
  category text default 'UTILITY',
  status text default 'PENDING',
  header_text text,
  body_text text not null,
  footer_text text,
  buttons jsonb,
  meta_template_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists message_templates_org_name_uidx
  on public.message_templates (organization_id, name);

alter table public.message_templates enable row level security;

drop policy if exists templates_select on public.message_templates;
create policy templates_select on public.message_templates
  for select using (auth.uid() is not null);

drop policy if exists templates_insert on public.message_templates;
create policy templates_insert on public.message_templates
  for insert with check (auth.uid() is not null);

drop policy if exists templates_update on public.message_templates;
create policy templates_update on public.message_templates
  for update using (auth.uid() is not null);
