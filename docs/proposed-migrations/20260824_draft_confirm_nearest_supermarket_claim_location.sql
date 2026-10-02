-- DRAFT ONLY — NOT APPLIED. Do not run without explicit approval.
-- Placed outside supabase/migrations/ so it cannot be picked up by
-- `supabase db push`/migration tooling by accident.
--
-- GATE 3 (activation-readiness audit, 2026-08-24; CORRECTED 2026-08-24):
-- fixes a real gap in the local-only (not yet deployed) nearest-supermarket
-- confirmation handler in supabase/functions/run-replies/index.ts (the
-- "route.kind === 'nearest_supermarket_confirm'" block). That handler
-- currently issues a claim with a direct service-role table UPDATE instead
-- of going through any of the three existing, already-locked-down
-- (service_role-only) claim-mutation entry points:
--   - request_referral_benefit_claim (claim creation/rerouting)
--   - issue_referral_benefit_claim(p_claim_id)  <- the general-purpose
--     REQUESTED -> ISSUED transition, already exists, already idempotent
--   - redeem_referral_benefit_claim (staff-facing, ISSUED -> REDEEMED)
--
-- Concretely, the current bare UPDATE:
--   1. never writes to referral_benefit_claim_reroutes, so a claim
--      resolved via "confirm the nearest store" leaves NO audit trail of
--      which location got assigned or when — every OTHER location
--      (re)assignment in this product (see request_referral_benefit_
--      claim's reroute branch) is recorded there. This creates a real gap
--      an operator/support investigation would hit.
--   2. does not validate that the confirmed location still belongs to the
--      claim's own campaign (defense in depth — today's caller always
--      supplies a value it just computed itself, so this isn't exploitable
--      yet, but the validation belongs in the trusted boundary, not only
--      in the calling code).
--   3. duplicates issue_referral_benefit_claim's idempotency logic instead
--      of reusing it, so the two code paths could silently drift.
--   4. **CRITICAL, found during this correctness audit**: the original
--      version of THIS function itself set status='ISSUED' in the same
--      UPDATE that assigned the confirmed location — i.e. the moment the
--      customer taps "Sí, quiero el cupón", BEFORE the store-specific
--      image has actually been sent to them or accepted by WhatsApp. That
--      violates the one hard invariant this whole product enforces
--      elsewhere (issue_referral_benefit_claim is the ONLY place that ever
--      sets status='ISSUED', and every existing caller in run-replies only
--      calls it after a successful outbound image send): a claim must
--      never be ISSUED until its required official image has actually
--      been accepted by the delivery provider. Corrected below: this
--      function now ONLY validates and associates the location + records
--      the reroute — it never touches status/issued_at. The claim stays
--      REQUESTED. run-replies must call the existing, unchanged
--      issue_referral_benefit_claim(p_claim_id) separately, and only after
--      the image send actually succeeds — see the local (not yet deployed)
--      nearestSupermarket.ts / run-replies handler update alongside this
--      file for the corrected call order.
--
-- OPTIONS CONSIDERED:
--   1. "Carefully guarded service-role update" — keep the raw UPDATE in
--      run-replies/index.ts, but add the reroute insert, the campaign
--      match check, and the re-read-on-conflict fix directly in
--      TypeScript. Rejected: duplicates business logic that already has a
--      single canonical home (three existing RPCs), spreads claim-lifecycle
--      invariants across two languages/two files instead of one, and every
--      future caller (a future admin "manually assign a location" screen,
--      for example) would have to re-implement the same guarded logic
--      instead of calling one function.
--   2. "A minimal dedicated source-of-truth RPC" (this file) — one new
--      function, SECURITY DEFINER, service_role-only (same grant shape as
--      the three existing claim RPCs), doing exactly the location-
--      assignment + reroute-audit work this flow genuinely needs, and
--      nothing else — status/issuance stays exclusively
--      issue_referral_benefit_claim's job, called separately by
--      run-replies after a successful image send. Chosen: smallest
--      possible surface area, reuses the exact idempotency idiom already
--      proven in issue_referral_benefit_claim, keeps every claim-state
--      transition in the one place that already owns it, and keeps
--      issuance-after-image-delivery true for every call path, not just
--      the original ones.
--
-- Idempotent: CREATE OR REPLACE FUNCTION; grants use IF EXISTS-safe
-- REVOKE/GRANT (both are no-ops to re-run).
--
-- Impact on existing behavior: NONE by itself — this is a new function,
-- nothing calls it until supabase/functions/run-replies/index.ts is
-- edited to call it instead of its current raw UPDATE, and that edit is
-- separate frontend/function-code work (not part of this SQL file) that
-- still requires a run-replies deploy before it does anything in
-- production. Applying this migration alone changes nothing observable.
--
-- Does not touch meta-webhook, whatsapp-signup, Embedded Signup,
-- coexistence, WABA mapping, or any published Meta Flow.
--
-- Rollback: drop the function. Nothing else references it until the
-- separate run-replies code change (not included here) is deployed.
begin;

create or replace function public.confirm_referral_benefit_claim_location(
  p_organization_id text,
  p_claim_id uuid,
  p_location_id uuid
) returns public.referral_benefit_claims
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
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
$$;

-- CORRECTED 2026-08-24 (post-apply grant audit): revoking from PUBLIC
-- alone is NOT sufficient on this project — Supabase's default privileges
-- grant EXECUTE to anon/authenticated directly on function creation,
-- independent of the PUBLIC pseudo-role, so a PUBLIC-only revoke left
-- anon/authenticated still able to call this function directly. The two
-- sibling RPCs (request_referral_benefit_claim, issue_referral_benefit_
-- claim) already revoke from all three roles by name — this now matches
-- that exact, proven-correct pattern instead of assuming PUBLIC covers
-- everyone.
revoke all on function public.confirm_referral_benefit_claim_location(text, uuid, uuid) from public, anon, authenticated;
grant all on function public.confirm_referral_benefit_claim_location(text, uuid, uuid) to service_role;

commit;
