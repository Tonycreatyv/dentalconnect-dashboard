-- Reconstructed from the live production schema on 2026-10-02.
-- Final location-bound benefit delivery contract.

CREATE OR REPLACE FUNCTION public.request_referral_benefit_claim(p_organization_id text, p_campaign_key text, p_lead_id uuid, p_postal_code text, p_email text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT false, p_marketing_source text DEFAULT NULL::text, p_marketing_copy_version text DEFAULT NULL::text)
 RETURNS TABLE(claim_id uuid, claim_code text, claim_status text, was_created boolean, supermarket_location_id uuid, supermarket_location_name text, official_media_url text, requires_location_verification boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if p_campaign_key not in ('luis_benefit_supermarket_20', 'luis_benefit_medical_20', 'luis_benefit_dental_29', 'luis_benefit_shipping_20', 'luis_benefit_mableton_parrillada', 'luis_benefit_taxes') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.request_location_bound_referral_benefit_claim(p_organization_id text, p_campaign_key text, p_lead_id uuid, p_postal_code text, p_email text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT false, p_marketing_source text DEFAULT NULL::text, p_marketing_copy_version text DEFAULT NULL::text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(claim_id uuid, claim_code text, claim_status text, was_created boolean, supermarket_location_id uuid, supermarket_location_name text, official_media_url text, requires_location_verification boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_campaign public.referral_coupon_campaigns%rowtype;
  v_location public.referral_benefit_campaign_locations%rowtype;
  v_claim public.referral_benefit_claims%rowtype;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_postal text := trim(coalesce(p_postal_code, ''));
  v_attempt integer;
begin
  if p_campaign_key not in ('luis_benefit_supermarket_20', 'luis_benefit_mableton_parrillada') then
    raise exception 'benefit_campaign_invalid' using errcode = '22023';
  end if;
  if v_postal !~ '^[0-9]{5}$' then raise exception 'benefit_postal_code_invalid' using errcode = '22023'; end if;
  if p_location_id is null then raise exception 'benefit_location_required' using errcode = '22023'; end if;
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
  select * into v_location from public.referral_benefit_campaign_locations
   where id = p_location_id and organization_id = p_organization_id
     and campaign_id = v_campaign.id and active;
  if not found then raise exception 'benefit_location_ineligible' using errcode = '22023'; end if;

  select * into v_claim from public.referral_benefit_claims
   where organization_id = p_organization_id and campaign_id = v_campaign.id and lead_id = p_lead_id;
  if found then
    if v_claim.status = 'REQUESTED' and v_claim.supermarket_location_id is distinct from v_location.id then
      update public.referral_benefit_claims
         set postal_code = v_postal, supermarket_location_id = v_location.id, updated_at = now()
       where id = v_claim.id returning * into v_claim;
    end if;
    return query select v_claim.id, v_claim.claim_code, v_claim.status, false,
      v_claim.supermarket_location_id, stored.display_name, stored.official_media_url, false
    from public.referral_benefit_campaign_locations stored where stored.id = v_claim.supermarket_location_id;
    return;
  end if;

  for v_attempt in 1..8 loop
    begin
      insert into public.referral_benefit_claims (
        organization_id, campaign_id, lead_id, supermarket_location_id, claim_code, postal_code, email,
        email_marketing_opt_in, email_marketing_consent_at, email_marketing_consent_source, email_marketing_copy_version
      ) values (
        p_organization_id, v_campaign.id, p_lead_id, v_location.id,
        'LG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)), v_postal, v_email,
        p_marketing_consent, case when p_marketing_consent then now() else null end,
        case when p_marketing_consent then nullif(trim(coalesce(p_marketing_source, '')), '') else null end,
        case when p_marketing_consent then nullif(trim(coalesce(p_marketing_copy_version, '')), '') else null end
      ) returning * into v_claim;
      return query select v_claim.id, v_claim.claim_code, v_claim.status, true,
        v_location.id, v_location.display_name, v_location.official_media_url, false;
      return;
    exception when unique_violation then
      select * into v_claim from public.referral_benefit_claims
       where organization_id = p_organization_id and campaign_id = v_campaign.id and lead_id = p_lead_id;
      if found then
        return query select v_claim.id, v_claim.claim_code, v_claim.status, false,
          v_claim.supermarket_location_id, stored.display_name, stored.official_media_url, false
        from public.referral_benefit_campaign_locations stored where stored.id = v_claim.supermarket_location_id;
        return;
      end if;
    end;
  end loop;
  raise exception 'benefit_claim_code_generation_failed' using errcode = 'P0001';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_referral_benefit_claim_location(p_organization_id text, p_claim_id uuid, p_location_id uuid)
 RETURNS referral_benefit_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_claim public.referral_benefit_claims%rowtype;
  v_location public.referral_benefit_campaign_locations%rowtype;
  v_prior_location_id uuid;
begin
  select * into v_claim from public.referral_benefit_claims
   where id = p_claim_id and organization_id = p_organization_id;
  if not found then
    raise exception 'benefit_claim_not_found' using errcode = 'P0002';
  end if;

  select * into v_location from public.referral_benefit_campaign_locations
   where id = p_location_id and organization_id = p_organization_id and active;
  if not found then
    raise exception 'benefit_location_not_found_or_inactive' using errcode = 'P0002';
  end if;

  -- Defense in depth: the confirmed location must belong to the same
  -- campaign as the claim being confirmed. run-replies today only ever
  -- supplies a location it just computed for this exact claim's campaign
  -- (see nearestSupermarket.ts), so this should never fire in practice —
  -- it exists so a future caller/bug can't silently cross-assign a
  -- location from an unrelated campaign.
  if v_location.campaign_id <> v_claim.campaign_id then
    raise exception 'benefit_location_campaign_mismatch' using errcode = '23514';
  end if;

  v_prior_location_id := v_claim.supermarket_location_id;

  -- Location assignment ONLY — status/issued_at are deliberately never
  -- touched here. Issuance is exclusively issue_referral_benefit_claim's
  -- job, called separately by run-replies after the store-specific image
  -- has actually been sent (see header note). The claim stays REQUESTED
  -- through this call, exactly the "pre-issuance status" the confirmation
  -- step is supposed to preserve. Still WHERE-guarded to status='REQUESTED'
  -- so a claim that somehow already reached ISSUED/REDEEMED (e.g. a
  -- concurrent duplicate confirmation whose image send already completed
  -- and was already marked ISSUED) can never have its location silently
  -- reassigned after the fact.
  update public.referral_benefit_claims
     set supermarket_location_id = p_location_id,
         updated_at = now()
   where id = p_claim_id and organization_id = p_organization_id and status = 'REQUESTED'
   returning * into v_claim;

  if found then
    -- Real audit trail: record the location assignment exactly the way
    -- request_referral_benefit_claim's own reroute branch already does,
    -- so a claim confirmed via the nearest-store flow shows up in
    -- referral_benefit_claim_reroutes like every other location
    -- (re)assignment — not a second, inconsistent history. Only recorded
    -- when the assigned location actually changed (never a same-location
    -- no-op reroute) — this also makes a retried/duplicate confirmation of
    -- the SAME location a true no-op: the UPDATE re-applies harmlessly and
    -- no second reroute row is written.
    if v_prior_location_id is distinct from p_location_id then
      insert into public.referral_benefit_claim_reroutes (
        organization_id, claim_id, from_postal_code, to_postal_code,
        from_supermarket_location_id, to_supermarket_location_id, source
      ) values (
        p_organization_id, v_claim.id, v_claim.postal_code, v_claim.postal_code,
        v_prior_location_id, p_location_id, 'nearest_location_confirmation'
      );
    end if;
    return v_claim;
  end if;

  -- This function's own UPDATE affected zero rows: the claim was already
  -- resolved (ISSUED/REDEEMED) by this or a concurrent call that got all
  -- the way through location-confirmation + image-send + issuance, or was
  -- never REQUESTED. Re-read and return the TRUE current row rather than
  -- the stale pre-update snapshot still held in v_claim — run-replies must
  -- treat an already-ISSUED/REDEEMED result here as "already resolved,
  -- nothing further to send" rather than retrying the image send.
  select * into v_claim from public.referral_benefit_claims
   where id = p_claim_id and organization_id = p_organization_id;
  return v_claim;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_referral_benefit_claim(p_claim_id uuid)
 RETURNS referral_benefit_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

revoke all on function public.request_referral_benefit_claim(
  text,text,uuid,text,text,boolean,text,text
) from public, anon, authenticated;
grant execute on function public.request_referral_benefit_claim(
  text,text,uuid,text,text,boolean,text,text
) to service_role;

revoke all on function public.request_location_bound_referral_benefit_claim(
  text,text,uuid,text,text,boolean,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.request_location_bound_referral_benefit_claim(
  text,text,uuid,text,text,boolean,text,text,uuid
) to service_role;

revoke all on function public.confirm_referral_benefit_claim_location(
  text,uuid,uuid
) from public, anon, authenticated;
grant execute on function public.confirm_referral_benefit_claim_location(
  text,uuid,uuid
) to service_role;

revoke all on function public.issue_referral_benefit_claim(uuid)
  from public, anon, authenticated;
grant execute on function public.issue_referral_benefit_claim(uuid)
  to service_role;
