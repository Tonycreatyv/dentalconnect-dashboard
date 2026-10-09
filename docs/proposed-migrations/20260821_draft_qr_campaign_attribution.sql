-- DRAFT ONLY — NOT APPLIED. Do not run without explicit approval.
-- Placed outside supabase/migrations/ so it cannot be picked up by
-- `supabase db push`/migration tooling by accident.
--
-- Context: the QR/flyer "campaign" dashboard (Cupones -> Campañas) is
-- already fully self-service today with zero schema changes, because
-- referral_qr_entries already grants full CRUD to authenticated owner/admin
-- members (see 20260808000100_referral_qr_entries.sql). This draft is only
-- about making "coupon requests attributable to a campaign" durable and
-- point-in-time-correct instead of the current heuristic (which reads the
-- lead's CURRENT extracted_data.qr_entry at query time — correct for the
-- common case, but not a permanent record: if a lead scans campaign A,
-- then later scans campaign B without claiming, then finally claims,
-- the current heuristic attributes the claim to B, which is usually
-- what you want, but there is no durable record of "which scan actually
-- produced this specific claim" if extracted_data is ever overwritten by
-- something else in between).
--
-- ============================================================================
-- PART A (recommended): durable claim -> QR entry attribution
-- ============================================================================
begin;

alter table public.referral_benefit_claims
  add column if not exists qr_entry_id uuid null
    references public.referral_qr_entries(id) on delete set null;

comment on column public.referral_benefit_claims.qr_entry_id is
  'The specific QR/flyer campaign entry that led to this claim, captured '
  'at claim-creation time by request_referral_benefit_claim. Null for '
  'claims that did not originate from a QR/flyer scan (e.g. organic menu '
  'navigation). Distinct from campaign_id, which identifies the benefit '
  '(medical/supermarket/...), not the specific flyer/QR/acquisition source.';

create index if not exists referral_benefit_claims_qr_entry_idx
  on public.referral_benefit_claims (qr_entry_id) where qr_entry_id is not null;

-- Extend the existing claim RPC additively: new optional parameter appended
-- at the end (safe for existing callers that omit it), captures qr_entry_id
-- once at insert time, never overwrites it on idempotent replay.
create or replace function public.request_referral_benefit_claim(
  p_organization_id text,
  p_campaign_key text,
  p_lead_id uuid,
  p_postal_code text,
  p_email text default null,
  p_marketing_consent boolean default false,
  p_marketing_source text default null,
  p_marketing_copy_version text default null,
  p_qr_entry_id uuid default null
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
  -- New: if a qr_entry_id is supplied, it must belong to the same org and
  -- reference this same campaign_key (or be a general entry) - never let a
  -- forged/unrelated qr_entry_id attribute a claim to the wrong campaign.
  if p_qr_entry_id is not null and not exists (
    select 1 from public.referral_qr_entries qr
    where qr.id = p_qr_entry_id
      and qr.organization_id = p_organization_id
      and (qr.campaign_key = p_campaign_key or qr.entry_type = 'general')
  ) then
    raise exception 'benefit_qr_entry_scope_mismatch' using errcode = '22023';
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
    -- Idempotent replay: never overwrite a previously recorded qr_entry_id
    -- with a later (possibly unrelated) one.
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
        email_marketing_opt_in, email_marketing_consent_at, email_marketing_consent_source, email_marketing_copy_version,
        qr_entry_id
      ) values (
        p_organization_id, v_campaign.id, p_lead_id, case when v_is_supermarket then v_location.id else null end,
        'LG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)), v_postal, v_email,
        p_marketing_consent, case when p_marketing_consent then now() else null end,
        case when p_marketing_consent then nullif(trim(coalesce(p_marketing_source, '')), '') else null end,
        case when p_marketing_consent then nullif(trim(coalesce(p_marketing_copy_version, '')), '') else null end,
        p_qr_entry_id
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

commit;

-- Frontend/backend follow-up once this is applied (not part of this draft):
--   1. run-replies: pass the lead's current extracted_data.qr_entry.id
--      (need to also start storing the entry's own uuid, not just its
--      public_code, in qrLeadAttribution/withLuisQrAttribution) as
--      p_qr_entry_id when calling request_referral_benefit_claim.
--   2. Dashboard: switch useQrCampaigns' requestsCount from the
--      extracted_data heuristic to `count(*) from referral_benefit_claims
--      where qr_entry_id = <entry.id>` — exact, no heuristic needed.

-- ============================================================================
-- PART B (not needed for the current QR-campaign feature; reference only):
-- an owner/admin write RPC for referral_coupon_campaigns (the underlying
-- benefit DEFINITIONS - medical/supermarket/dental/shipping), which today
-- only grants SELECT to authenticated (see 20260727000100_referral_hub_coupons.sql
-- and 20260801000100_referral_operations_pilot.sql). Editing THOSE rows
-- (display_name, offer_terms, active) is a separate capability from
-- creating/pausing QR campaigns, which already works today without this.
-- Included only because "campaign save security" was raised generally -
-- do not apply unless that separate capability is explicitly requested.
-- ============================================================================
-- begin;
-- create or replace function public.update_referral_campaign(
--   p_organization_id text,
--   p_campaign_id uuid,
--   p_display_name text default null,
--   p_active boolean default null
-- ) returns public.referral_coupon_campaigns
-- language plpgsql security definer set search_path = public, pg_temp as $$
-- declare v_campaign public.referral_coupon_campaigns%rowtype;
-- begin
--   if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
--   if not public.referral_is_member(p_organization_id, array['owner', 'admin']) then
--     raise exception 'referral_access_denied' using errcode = '42501';
--   end if;
--   update public.referral_coupon_campaigns
--      set display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
--          active = coalesce(p_active, active),
--          updated_at = now()
--    where id = p_campaign_id and organization_id = p_organization_id
--    returning * into v_campaign;
--   if not found then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
--   return v_campaign;
-- end;
-- $$;
-- revoke all on function public.update_referral_campaign(text, uuid, text, boolean) from public, anon, authenticated;
-- grant execute on function public.update_referral_campaign(text, uuid, text, boolean) to authenticated;
-- commit;
