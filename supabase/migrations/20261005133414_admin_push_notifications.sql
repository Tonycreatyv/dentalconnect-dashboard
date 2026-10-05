-- ConeXXion Admin Operator Mode — Web Push schema.
-- Applied to production as migration 20261005133414_admin_push_notifications.
-- Isolated from referral_notification_attempts and all WhatsApp delivery paths.

create table if not exists public.referral_admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  device_label text,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists referral_admin_push_subscriptions_org_user_idx
  on public.referral_admin_push_subscriptions (organization_id, user_id)
  where active = true;

alter table public.referral_admin_push_subscriptions enable row level security;

create policy referral_admin_push_subscriptions_read_own
  on public.referral_admin_push_subscriptions
  for select to authenticated
  using (
    user_id = auth.uid()
    and referral_is_member(organization_id, array['owner'::text, 'admin'::text])
  );

create policy referral_admin_push_subscriptions_insert_own
  on public.referral_admin_push_subscriptions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and referral_is_member(organization_id, array['owner'::text, 'admin'::text])
  );

create policy referral_admin_push_subscriptions_update_own
  on public.referral_admin_push_subscriptions
  for update to authenticated
  using (
    user_id = auth.uid()
    and referral_is_member(organization_id, array['owner'::text, 'admin'::text])
  )
  with check (
    user_id = auth.uid()
    and referral_is_member(organization_id, array['owner'::text, 'admin'::text])
  );

create policy referral_admin_push_subscriptions_delete_own
  on public.referral_admin_push_subscriptions
  for delete to authenticated
  using (
    user_id = auth.uid()
    and referral_is_member(organization_id, array['owner'::text, 'admin'::text])
  );

create table if not exists public.referral_admin_notification_preferences (
  organization_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  push_enabled boolean not null default true,
  new_case boolean not null default true,
  unassigned_case boolean not null default true,
  exception_case boolean not null default true,
  partner_assignment boolean not null default true,
  partner_access boolean not null default true,
  benefit_changes boolean not null default false,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.referral_admin_notification_preferences enable row level security;

create policy referral_admin_notification_preferences_own
  on public.referral_admin_notification_preferences
  for all to authenticated
  using (
    user_id = auth.uid()
    and referral_is_member(organization_id, array['owner'::text, 'admin'::text])
  )
  with check (
    user_id = auth.uid()
    and referral_is_member(organization_id, array['owner'::text, 'admin'::text])
  );

create table if not exists public.referral_admin_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text,
  title text not null,
  body text not null,
  action_url text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed','suppressed')),
  idempotency_key text not null unique,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referral_admin_notification_outbox_ready_idx
  on public.referral_admin_notification_outbox (status, available_at)
  where status = 'queued';

alter table public.referral_admin_notification_outbox enable row level security;

create policy referral_admin_notification_outbox_recipient_read
  on public.referral_admin_notification_outbox
  for select to authenticated
  using (
    recipient_user_id = auth.uid()
    and referral_is_member(organization_id, array['owner'::text, 'admin'::text])
  );

-- Inserts/updates to the outbox are service-role only. No authenticated
-- INSERT/UPDATE policy is intentionally created here.

create table if not exists public.referral_admin_notification_cursor (
  organization_id text primary key,
  last_event_at timestamptz not null,
  last_exception_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.referral_admin_notification_cursor enable row level security;
-- No authenticated policies: only trusted server-side collector code may read/write.
