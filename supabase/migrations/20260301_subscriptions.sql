create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  plan text not null check (plan in ('starter', 'growth', 'pro')),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_org_unique on public.subscriptions (organization_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);
create index if not exists subscriptions_stripe_customer_idx on public.subscriptions (stripe_customer_id);
create index if not exists subscriptions_stripe_subscription_idx on public.subscriptions (stripe_subscription_id);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own_org" on public.subscriptions;
create policy "subscriptions_select_own_org"
on public.subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.clinic_users cu
    join public.clinics c on c.id = cu.clinic_id
    where cu.user_id = auth.uid()
      and c.organization_id = subscriptions.organization_id
  )
);
