-- Generalizes request_referral_benefit_claim's location-aware determination
-- from a literal campaign-key comparison to a generic, data-driven rule:
-- any campaign with active referral_benefit_campaign_locations rows is
-- location-aware and must resolve location/postal code/media using that
-- table. This is preparation for The Mableton Supermarket's own fixed-price
-- campaign (luis_benefit_mableton_parrillada), which needs the exact same
-- exact-ZIP location/media resolution SUPERMARKET already has, without
-- hardcoding a second literal campaign key alongside 'luis_benefit_supermarket_20'.
--
-- No column, argument, or return-shape change: same signature, same
-- returns table. Every other validation/consent/reroute/idempotency rule
-- is copied verbatim from the live 20260819000100 definition. The only
-- change is how v_location_aware (renamed from v_is_supermarket) is
-- computed. luis_benefit_supermarket_20 keeps working exactly as before,
-- since it already has active referral_benefit_campaign_locations rows —
-- this migration does not touch those rows or the campaign row itself.
begin;

do $$
begin
  if to_regprocedure('public.request_referral_benefit_claim(text,text,uuid,text,text,boolean,text,text)') is null
    or to_regclass('public.referral_benefit_campaign_locations') is null then
    raise exception 'mableton_location_aware_claims_baseline_missing';
  end if;
end $$;

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
  v_location_aware boolean;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_postal text := trim(coalesce(p_postal_code, ''));
  v_attempt integer;
  v_inserted boolean := false;
  v_requires_verification boolean;
begin
  if p_campaign_key not in ('luis_benefit_supermarket_20', 'luis_benefit_medical_20', 'luis_benefit_dental_29', 'luis_benefit_shipping_20', 'luis_benefit_mableton_parrillada') then
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
  -- Generic, data-driven rule: a campaign is location-aware exactly when it
  -- has at least one active referral_benefit_campaign_locations row — never
  -- because its campaign_key matches a literal string. This is the only
  -- behavioral change in this migration; luis_benefit_supermarket_20 already
  -- has active location rows today, so its resolution is unaffected.
  select exists(
    select 1 from public.referral_benefit_campaign_locations
     where organization_id = p_organization_id and campaign_id = v_campaign.id and active
  ) into v_location_aware;
  if v_location_aware then
    select * into v_location from public.referral_benefit_campaign_locations
     where organization_id = p_organization_id and campaign_id = v_campaign.id and postal_code = v_postal and active
     order by created_at asc limit 1;
  end if;
  select * into v_claim from public.referral_benefit_claims
   where organization_id = p_organization_id and campaign_id = v_campaign.id and lead_id = p_lead_id;
  if found then
    if v_location_aware and v_location.id is not null and v_claim.status <> 'REDEEMED'
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
    -- Unchanged formula (case 1: same ZIP -> v_location.id = v_claim.supermarket_location_id,
    -- not null, false; case 2: different supported ZIP -> reroute above already made
    -- v_claim.supermarket_location_id = v_location.id, false; case 3: unsupported ZIP ->
    -- v_location.id is null, true, and the claim's stored location is untouched above).
    v_requires_verification := v_location_aware and (v_location.id is null or v_claim.supermarket_location_id is null);
    return query select v_claim.id, v_claim.claim_code, v_claim.status, false,
      case when v_requires_verification then null else v_claim.supermarket_location_id end,
      case when v_requires_verification then null else existing_location.display_name end,
      case when v_requires_verification then null else existing_location.official_media_url end,
      v_requires_verification
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
        p_organization_id, v_campaign.id, p_lead_id, case when v_location_aware then v_location.id else null end,
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
        v_requires_verification := v_location_aware and (v_location.id is null or v_claim.supermarket_location_id is null);
        return query select v_claim.id, v_claim.claim_code, v_claim.status, false,
          case when v_requires_verification then null else v_claim.supermarket_location_id end,
          case when v_requires_verification then null else existing_location.display_name end,
          case when v_requires_verification then null else existing_location.official_media_url end,
          v_requires_verification
        from (select 1) as guard
        left join public.referral_benefit_campaign_locations existing_location on existing_location.id = v_claim.supermarket_location_id;
        return;
      end if;
    end;
  end loop;
  if not v_inserted then raise exception 'benefit_claim_code_generation_failed' using errcode = 'P0001'; end if;
  -- New claim, unsupported ZIP: v_location was never found, so
  -- v_claim.supermarket_location_id was inserted as null and
  -- v_location.display_name/official_media_url are already null - no case
  -- expression needed, this branch was already contract-consistent.
  return query select v_claim.id, v_claim.claim_code, v_claim.status, true,
    v_claim.supermarket_location_id, v_location.display_name, v_location.official_media_url,
    v_location_aware and v_location.id is null;
end;
$$;

revoke all on function public.request_referral_benefit_claim(text, text, uuid, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.request_referral_benefit_claim(text, text, uuid, text, text, boolean, text, text) to service_role;

commit;
