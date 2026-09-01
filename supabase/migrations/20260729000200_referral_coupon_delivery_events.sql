-- Optional, PII-minimized tracking for coupon images prepared for delivery.
-- This table intentionally has no coupon code, token, redemption, or issuance
-- semantics. delivered_at remains null until a real provider callback can
-- truthfully confirm media delivery.

begin;

create table if not exists public.referral_coupon_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null
    references public.organizations(id) on delete cascade,
  conversation_identity_hash text not null
    check (conversation_identity_hash ~ '^[0-9a-f]{64}$'),
  service_id text not null
    check (
      service_id in (
        'luis_cupon_super',
        'luis_cupon_medico',
        'luis_cupon_dental'
      )
    ),
  campaign_key text not null,
  channel text not null
    check (channel in ('whatsapp', 'voice')),
  prepared_at timestamptz not null default now(),
  delivered_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_coupon_delivery_events_idempotency_unique
    unique (
      organization_id,
      conversation_identity_hash,
      service_id,
      campaign_key,
      channel
    ),
  constraint referral_coupon_delivery_events_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists referral_coupon_delivery_events_org_prepared_idx
  on public.referral_coupon_delivery_events (
    organization_id,
    prepared_at desc
  );

alter table public.referral_coupon_delivery_events enable row level security;

revoke all on table public.referral_coupon_delivery_events
  from anon, authenticated;
grant all on table public.referral_coupon_delivery_events
  to service_role;

commit;
