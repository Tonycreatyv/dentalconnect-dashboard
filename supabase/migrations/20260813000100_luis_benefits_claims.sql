-- Luis Gabriel benefits MVP. Additive only: legacy coupon issuance remains untouched.
begin;

create extension if not exists pgcrypto;

-- Existing referral_coupon_campaigns remains the canonical benefit definition.
-- These rows deliberately do not replace the legacy LG coupon campaigns.
insert into public.referral_coupon_campaigns (
  organization_id, campaign_key, service_id, display_name, offer_terms, active
)
values
  ('luis-gabriel-referral-hub', 'luis_benefit_supermarket_20', 'luis_benefit_supermarket', '$20 para tu compra de supermercado', '{"discount_amount":20,"minimum_purchase":150,"currency":"USD"}'::jsonb, true),
  ('luis-gabriel-referral-hub', 'luis_benefit_medical_20', 'luis_benefit_medical', '20% de descuento en servicios médicos', '{"discount_percent":20,"merchant":"Médico Urgencias"}'::jsonb, true),
  ('luis-gabriel-referral-hub', 'luis_benefit_dental_29', 'luis_benefit_dental', 'Consulta + limpieza + rayos X por $29', '{"promotional_price":29,"currency":"USD","merchant":"Dental Now 14"}'::jsonb, true),
  ('luis-gabriel-referral-hub', 'luis_benefit_shipping_20', 'luis_benefit_shipping', '$20 de descuento en tu próximo envío', '{"discount_amount":20,"currency":"USD","merchant":"Ultra Cargo"}'::jsonb, true)
on conflict (organization_id, campaign_key) do update set
  service_id = excluded.service_id,
  display_name = excluded.display_name,
  offer_terms = excluded.offer_terms,
  active = excluded.active,
  updated_at = now();

-- This is benefit routing configuration, not grocery-delivery coverage. A link to
-- an existing canonical partner location may be supplied when that location exists.
create table if not exists public.referral_benefit_campaign_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.referral_coupon_campaigns(id) on delete cascade,
  partner_location_id uuid null references public.referral_partner_locations(id) on delete restrict,
  location_key text not null,
  display_name text not null,
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  address_text text not null,
  official_media_url text not null check (official_media_url ~ '^https://'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, campaign_id, location_key),
  unique (organization_id, campaign_id, postal_code)
);

create table if not exists public.referral_benefit_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.referral_coupon_campaigns(id) on delete restrict,
  lead_id uuid not null references public.leads(id) on delete cascade,
  supermarket_location_id uuid null references public.referral_benefit_campaign_locations(id) on delete restrict,
  claim_code text not null check (claim_code ~ '^LG-[A-Z0-9]{4}$'),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'ISSUED', 'REDEEMED')),
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  email text null,
  email_marketing_opt_in boolean not null default false,
  email_marketing_consent_at timestamptz null,
  email_marketing_consent_source text null,
  email_marketing_copy_version text null,
  requested_at timestamptz not null default now(),
  issued_at timestamptz null,
  redeemed_at timestamptz null,
  redeemed_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_benefit_claims_one_per_benefit unique (organization_id, campaign_id, lead_id),
  constraint referral_benefit_claims_code_unique unique (claim_code),
  constraint referral_benefit_claims_marketing_consent check (
    (email_marketing_opt_in = false and email_marketing_consent_at is null)
    or
    (email_marketing_opt_in = true and email is not null and email_marketing_consent_at is not null and email_marketing_consent_source is not null and email_marketing_copy_version is not null)
  ),
  constraint referral_benefit_claims_lifecycle check (
    (status = 'REQUESTED' and issued_at is null and redeemed_at is null and redeemed_by is null)
    or (status = 'ISSUED' and issued_at is not null and redeemed_at is null and redeemed_by is null)
    or (status = 'REDEEMED' and issued_at is not null and redeemed_at is not null and redeemed_by is not null)
  )
);

create index if not exists referral_benefit_claims_operator_queue_idx
  on public.referral_benefit_claims (organization_id, status, requested_at desc);
create index if not exists referral_benefit_claims_lead_idx
  on public.referral_benefit_claims (organization_id, lead_id, requested_at desc);

-- Seed only fixed, exact ZIP routing. The files are intentionally referenced at
-- their final public locations but are not supplied by this migration.
insert into public.referral_benefit_campaign_locations (
  organization_id, campaign_id, location_key, display_name, postal_code, address_text, official_media_url, active
)
select 'luis-gabriel-referral-hub', campaign.id, seed.location_key, seed.display_name,
  seed.postal_code, seed.address_text, seed.official_media_url, true
from public.referral_coupon_campaigns campaign
join (values
  ('el_sol_30071', 'El Sol Super Market', '30071', '2880 Simpson Cir #110, Norcross, GA 30071', 'https://referral.creatyv.io/images/coupons/luis/el-sol-supermarket-30071.jpeg'),
  ('mi_tierra_30341', 'Mi Tierra Supermercados', '30341', '4317 Buford Hwy NE, Atlanta, GA 30341', 'https://referral.creatyv.io/images/coupons/luis/mi-tierra-supermercados-30341.jpeg'),
  ('el_guero_30501', 'El Güero Supermercado', '30501', '730 Pearl Nix Pkwy, Gainesville, GA 30501', 'https://referral.creatyv.io/images/coupons/luis/el-guero-supermercado-30501.jpeg')
) as seed(location_key, display_name, postal_code, address_text, official_media_url) on true
where campaign.organization_id = 'luis-gabriel-referral-hub'
  and campaign.campaign_key = 'luis_benefit_supermarket_20'
on conflict (organization_id, campaign_id, location_key) do update set
  display_name = excluded.display_name,
  postal_code = excluded.postal_code,
  address_text = excluded.address_text,
  official_media_url = excluded.official_media_url,
  active = excluded.active,
  updated_at = now();

alter table public.referral_benefit_campaign_locations enable row level security;
alter table public.referral_benefit_claims enable row level security;
revoke all on public.referral_benefit_campaign_locations, public.referral_benefit_claims from public, anon, authenticated;
grant all on public.referral_benefit_campaign_locations, public.referral_benefit_claims to service_role;
grant select on public.referral_benefit_campaign_locations, public.referral_benefit_claims to authenticated;
create policy referral_benefit_locations_admin_read on public.referral_benefit_campaign_locations
  for select to authenticated using (public.referral_is_member(organization_id, array['owner', 'admin']));
create policy referral_benefit_claims_admin_read on public.referral_benefit_claims
  for select to authenticated using (public.referral_is_member(organization_id, array['owner', 'admin']));

create or replace function public.request_referral_benefit_claim(
  p_organization_id text,
  p_campaign_key text,
  p_lead_id uuid,
  p_postal_code text,
  p_email text default null,
  p_marketing_consent boolean default false,
  p_marketing_source text default null,
  p_marketing_copy_version text default null
)
returns table (
  claim_id uuid,
  claim_code text,
  claim_status text,
  was_created boolean,
  supermarket_location_id uuid,
  supermarket_location_name text,
  official_media_url text,
  requires_location_verification boolean
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.referral_coupon_campaigns%rowtype;
  v_claim public.referral_benefit_claims%rowtype;
  v_location public.referral_benefit_campaign_locations%rowtype;
  v_is_supermarket boolean;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_postal text := trim(coalesce(p_postal_code, ''));
  v_attempt integer;
  v_inserted boolean := false;
begin
  if p_campaign_key not in ('luis_benefit_supermarket_20', 'luis_benefit_medical_20', 'luis_benefit_dental_29', 'luis_benefit_shipping_20') then
    raise exception 'benefit_campaign_invalid' using errcode = '22023';
  end if;
  if v_postal !~ '^[0-9]{5}$' then raise exception 'benefit_postal_code_invalid' using errcode = '22023'; end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'benefit_email_invalid' using errcode = '22023';
  end if;
  if p_marketing_consent and v_email is null then raise exception 'benefit_marketing_email_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.leads where id = p_lead_id and organization_id = p_organization_id and channel = 'whatsapp') then
    raise exception 'benefit_lead_not_found' using errcode = 'P0002';
  end if;
  select * into v_campaign from public.referral_coupon_campaigns
   where organization_id = p_organization_id and campaign_key = p_campaign_key and active
     and (starts_at is null or starts_at <= now()) and (expires_at is null or expires_at > now());
  if not found then raise exception 'benefit_campaign_unavailable' using errcode = 'P0002'; end if;
  v_is_supermarket := p_campaign_key = 'luis_benefit_supermarket_20';
  if v_is_supermarket then
    select * into v_location from public.referral_benefit_campaign_locations
     where organization_id = p_organization_id and campaign_id = v_campaign.id and postal_code = v_postal and active
     order by created_at asc limit 1;
  end if;
  select * into v_claim from public.referral_benefit_claims
   where organization_id = p_organization_id and campaign_id = v_campaign.id and lead_id = p_lead_id;
  if found then
    return query select v_claim.id, v_claim.claim_code, v_claim.status, false,
      v_claim.supermarket_location_id, existing_location.display_name, existing_location.official_media_url,
      v_is_supermarket and v_claim.supermarket_location_id is null
    from (select 1) as guard
    left join public.referral_benefit_campaign_locations existing_location on existing_location.id = v_claim.supermarket_location_id;
    return;
  end if;
  for v_attempt in 1..8 loop
    begin
      insert into public.referral_benefit_claims (
        organization_id, campaign_id, lead_id, supermarket_location_id, claim_code, postal_code, email,
        email_marketing_opt_in, email_marketing_consent_at, email_marketing_consent_source, email_marketing_copy_version
      ) values (
        p_organization_id, v_campaign.id, p_lead_id, case when v_is_supermarket then v_location.id else null end,
        'LG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)), v_postal, v_email,
        p_marketing_consent, case when p_marketing_consent then now() else null end,
        case when p_marketing_consent then nullif(trim(coalesce(p_marketing_source, '')), '') else null end,
        case when p_marketing_consent then nullif(trim(coalesce(p_marketing_copy_version, '')), '') else null end
      ) returning * into v_claim;
      v_inserted := true;
      exit;
    exception when unique_violation then
      select * into v_claim from public.referral_benefit_claims
        where organization_id = p_organization_id and campaign_id = v_campaign.id and lead_id = p_lead_id;
      if found then
        return query select v_claim.id, v_claim.claim_code, v_claim.status, false,
          v_claim.supermarket_location_id, existing_location.display_name, existing_location.official_media_url,
          v_is_supermarket and v_claim.supermarket_location_id is null
        from (select 1) as guard
        left join public.referral_benefit_campaign_locations existing_location on existing_location.id = v_claim.supermarket_location_id;
        return;
      end if;
    end;
  end loop;
  if not v_inserted then raise exception 'benefit_claim_code_generation_failed' using errcode = 'P0001'; end if;
  return query select v_claim.id, v_claim.claim_code, v_claim.status, true,
    v_claim.supermarket_location_id, v_location.display_name, v_location.official_media_url,
    v_is_supermarket and v_location.id is null;
end;
$$;

create or replace function public.issue_referral_benefit_claim(p_claim_id uuid)
returns public.referral_benefit_claims
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_claim public.referral_benefit_claims%rowtype;
begin
  update public.referral_benefit_claims
     set status = 'ISSUED', issued_at = coalesce(issued_at, now()), updated_at = now()
   where id = p_claim_id and status = 'REQUESTED'
   returning * into v_claim;
  if found then return v_claim; end if;
  select * into v_claim from public.referral_benefit_claims where id = p_claim_id;
  if not found then raise exception 'benefit_claim_not_found' using errcode = 'P0002'; end if;
  return v_claim;
end;
$$;

create or replace function public.redeem_referral_benefit_claim(p_organization_id text, p_claim_id uuid)
returns public.referral_benefit_claims
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_claim public.referral_benefit_claims%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not public.referral_is_member(p_organization_id, array['owner', 'admin']) then raise exception 'referral_access_denied' using errcode = '42501'; end if;
  update public.referral_benefit_claims
     set status = 'REDEEMED', redeemed_at = now(), redeemed_by = auth.uid(), updated_at = now()
   where id = p_claim_id and organization_id = p_organization_id and status = 'ISSUED'
   returning * into v_claim;
  if not found then raise exception 'benefit_claim_not_issuable' using errcode = 'P0001'; end if;
  return v_claim;
end;
$$;

revoke all on function public.request_referral_benefit_claim(text, text, uuid, text, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.issue_referral_benefit_claim(uuid) from public, anon, authenticated;
grant execute on function public.request_referral_benefit_claim(text, text, uuid, text, text, boolean, text, text) to service_role;
grant execute on function public.issue_referral_benefit_claim(uuid) to service_role;
grant execute on function public.redeem_referral_benefit_claim(text, uuid) to authenticated;

commit;
