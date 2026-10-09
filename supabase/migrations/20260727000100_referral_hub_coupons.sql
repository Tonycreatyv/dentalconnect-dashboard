-- Isolated persistent coupon support for LG Community Network.
-- No grocery ordering, delivery, events, or client-write access.

create extension if not exists pgcrypto;

create table if not exists public.referral_coupon_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  campaign_key text not null,
  service_id text not null,
  display_name text not null,
  offer_terms jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  starts_at timestamptz null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_coupon_campaigns_org_key_unique
    unique (organization_id, campaign_key)
);

create table if not exists public.referral_coupon_issuances (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  campaign_id uuid not null
    references public.referral_coupon_campaigns(id) on delete restrict,
  lead_id uuid not null
    references public.leads(id) on delete cascade,
  code text not null,
  public_token uuid not null default gen_random_uuid(),
  status text not null default 'active'
    check (status in ('active', 'redeemed', 'expired', 'void')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz null,
  redeemed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_coupon_issuances_idempotency_unique
    unique (organization_id, campaign_id, lead_id),
  constraint referral_coupon_issuances_code_unique unique (code),
  constraint referral_coupon_issuances_public_token_unique unique (public_token)
);

alter table public.referral_coupon_campaigns enable row level security;
alter table public.referral_coupon_issuances enable row level security;

revoke all on table public.referral_coupon_campaigns from anon, authenticated;
revoke all on table public.referral_coupon_issuances from anon, authenticated;

create or replace function public.issue_or_get_coupon(
  p_organization_id text,
  p_campaign_key text,
  p_lead_id uuid
)
returns table (
  coupon_id uuid,
  code text,
  public_token uuid,
  coupon_status text,
  issued_at timestamptz,
  expires_at timestamptz,
  was_created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.referral_coupon_campaigns%rowtype;
  v_coupon public.referral_coupon_issuances%rowtype;
  v_prefix text;
begin
  if not exists (
    select 1
    from public.leads
    where id = p_lead_id
      and organization_id = p_organization_id
  ) then
    raise exception using
      errcode = 'P0002',
      message = 'coupon_lead_not_found';
  end if;

  select *
    into v_campaign
    from public.referral_coupon_campaigns
   where organization_id = p_organization_id
     and campaign_key = p_campaign_key;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'coupon_campaign_missing';
  end if;

  if not v_campaign.active
     or (v_campaign.starts_at is not null and v_campaign.starts_at > now())
     or (v_campaign.expires_at is not null and v_campaign.expires_at <= now()) then
    raise exception using
      errcode = 'P0001',
      message = 'coupon_campaign_inactive';
  end if;

  select *
    into v_coupon
    from public.referral_coupon_issuances
   where organization_id = p_organization_id
     and campaign_id = v_campaign.id
     and lead_id = p_lead_id;

  if found then
    return query
    select
      v_coupon.id,
      v_coupon.code,
      v_coupon.public_token,
      v_coupon.status,
      v_coupon.issued_at,
      v_coupon.expires_at,
      false;
    return;
  end if;

  v_prefix := case p_campaign_key
    when 'mi_tierra_10' then 'MITIERRA10'
    when 'medico_urgencias_20' then 'MEDICO20'
    when 'dental_now_14_29' then 'DENTAL29'
    else 'LGCOUPON'
  end;

  begin
    insert into public.referral_coupon_issuances (
      organization_id,
      campaign_id,
      lead_id,
      code,
      expires_at
    )
    values (
      p_organization_id,
      v_campaign.id,
      p_lead_id,
      v_prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      v_campaign.expires_at
    )
    returning * into v_coupon;
  exception
    when unique_violation then
      select *
        into v_coupon
        from public.referral_coupon_issuances
       where organization_id = p_organization_id
         and campaign_id = v_campaign.id
         and lead_id = p_lead_id;
      if not found then
        raise exception using
          errcode = 'P0001',
          message = 'coupon_insert_rejected';
      end if;
      return query
      select
        v_coupon.id,
        v_coupon.code,
        v_coupon.public_token,
        v_coupon.status,
        v_coupon.issued_at,
        v_coupon.expires_at,
        false;
      return;
  end;

  return query
  select
    v_coupon.id,
    v_coupon.code,
    v_coupon.public_token,
    v_coupon.status,
    v_coupon.issued_at,
    v_coupon.expires_at,
    true;
end;
$$;

revoke all on function public.issue_or_get_coupon(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.issue_or_get_coupon(text, text, uuid)
  to service_role;

insert into public.referral_coupon_campaigns (
  organization_id,
  campaign_key,
  service_id,
  display_name,
  offer_terms,
  active
)
values
  (
    'luis-gabriel-referral-hub',
    'mi_tierra_10',
    'luis_cupon_super',
    'Mi Tierra — cupón $10',
    '{"discount_amount":10,"minimum_purchase":100,"currency":"USD","merchant":"Mi Tierra Supermercados"}'::jsonb,
    true
  ),
  (
    'luis-gabriel-referral-hub',
    'medico_urgencias_20',
    'luis_cupon_medico',
    'Médico Urgencias — 20% de descuento',
    '{"discount_percent":20,"merchant":"Médico Urgencias"}'::jsonb,
    true
  ),
  (
    'luis-gabriel-referral-hub',
    'dental_now_14_29',
    'luis_cupon_dental',
    'Dental Now 14 — promoción $29',
    '{"promotional_price":29,"currency":"USD","merchant":"Dental Now 14"}'::jsonb,
    true
  )
on conflict (organization_id, campaign_key)
do update set
  service_id = excluded.service_id,
  display_name = excluded.display_name,
  offer_terms = excluded.offer_terms,
  active = excluded.active,
  updated_at = now();
