-- Additive audit trail and narrowly scoped reroute behavior for the Luis
-- supermarket benefit. Existing claims, coupon issuances, and other campaigns
-- are not reinterpreted or changed by this migration.
begin;

create table if not exists public.referral_benefit_claim_reroutes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  claim_id uuid not null references public.referral_benefit_claims(id) on delete cascade,
  from_postal_code text not null check (from_postal_code ~ '^[0-9]{5}$'),
  to_postal_code text not null check (to_postal_code ~ '^[0-9]{5}$'),
  from_supermarket_location_id uuid null references public.referral_benefit_campaign_locations(id) on delete restrict,
  to_supermarket_location_id uuid not null references public.referral_benefit_campaign_locations(id) on delete restrict,
  rerouted_at timestamptz not null default now(),
  source text not null default 'whatsapp_flow',
  created_at timestamptz not null default now()
);

create index if not exists referral_benefit_claim_reroutes_claim_idx
  on public.referral_benefit_claim_reroutes (organization_id, claim_id, rerouted_at desc);

alter table public.referral_benefit_claim_reroutes enable row level security;
revoke all on public.referral_benefit_claim_reroutes from public, anon, authenticated;
grant all on public.referral_benefit_claim_reroutes to service_role;
grant select on public.referral_benefit_claim_reroutes to authenticated;
create policy referral_benefit_claim_reroutes_admin_read on public.referral_benefit_claim_reroutes
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
    if v_is_supermarket and v_location.id is not null and v_claim.status <> 'REDEEMED'
       and v_claim.supermarket_location_id is distinct from v_location.id then
      insert into public.referral_benefit_claim_reroutes (
        organization_id, claim_id, from_postal_code, to_postal_code,
        from_supermarket_location_id, to_supermarket_location_id
      ) values (
        p_organization_id, v_claim.id, v_claim.postal_code, v_postal,
        v_claim.supermarket_location_id, v_location.id
      );
      update public.referral_benefit_claims
         set postal_code = v_postal, supermarket_location_id = v_location.id,
             status = 'REQUESTED', issued_at = null, updated_at = now()
       where id = v_claim.id and status <> 'REDEEMED'
       returning * into v_claim;
    end if;
    return query select v_claim.id, v_claim.claim_code, v_claim.status, false,
      v_claim.supermarket_location_id, existing_location.display_name, existing_location.official_media_url,
      v_is_supermarket and (v_location.id is null or v_claim.supermarket_location_id is null)
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
          v_is_supermarket and (v_location.id is null or v_claim.supermarket_location_id is null)
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

revoke all on function public.request_referral_benefit_claim(text, text, uuid, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.request_referral_benefit_claim(text, text, uuid, text, text, boolean, text, text) to service_role;

commit;
