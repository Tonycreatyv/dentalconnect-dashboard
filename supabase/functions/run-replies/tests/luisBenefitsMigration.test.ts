import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL("../../../migrations/20260813000100_luis_benefits_claims.sql", import.meta.url),
);
const rerouteMigration = await Deno.readTextFile(
  new URL("../../../migrations/20260814000200_luis_benefit_supermarket_reroute.sql", import.meta.url),
);
const verificationFixMigration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20260819000100_luis_benefit_claim_verification_contract_fix.sql",
    import.meta.url,
  ),
);

Deno.test("Luis benefits migration is additive and preserves legacy coupon issuances", () => {
  assertStringIncludes(migration, "create table if not exists public.referral_benefit_claims");
  assertStringIncludes(migration, "status in ('REQUESTED', 'ISSUED', 'REDEEMED')");
  assertStringIncludes(migration, "referral_benefit_claims_one_per_benefit unique (organization_id, campaign_id, lead_id)");
  assert(!/alter table\s+public\.referral_coupon_issuances/i.test(migration));
});

Deno.test("Luis supermarket routing is fixed to the three approved ZIPs and has no fallback", () => {
  for (const zip of ["30071", "30341", "30501"]) assertStringIncludes(migration, `'${zip}'`);
  assertStringIncludes(migration, "v_is_supermarket and v_location.id is null");
  assertStringIncludes(migration, "v_is_supermarket and v_claim.supermarket_location_id is null");
});

Deno.test("Luis claim redemption is owner/admin-only and only ISSUED claims transition", () => {
  assertStringIncludes(migration, "public.referral_is_member(p_organization_id, array['owner', 'admin'])");
  assertStringIncludes(migration, "and status = 'ISSUED'");
  assertStringIncludes(migration, "redeemed_at = now(), redeemed_by = auth.uid()");
});

Deno.test("Luis claim lifecycle keeps duplicate claims idempotent and issues only after REQUESTED", () => {
  assertStringIncludes(migration, "where organization_id = p_organization_id and campaign_id = v_campaign.id and lead_id = p_lead_id");
  assertStringIncludes(migration, "set status = 'ISSUED', issued_at = coalesce(issued_at, now())");
  assertStringIncludes(migration, "where id = p_claim_id and status = 'REQUESTED'");
});

Deno.test("Luis supermarket reroute preserves the activation code and audits only unredeemed changes", () => {
  assertStringIncludes(rerouteMigration, "create table if not exists public.referral_benefit_claim_reroutes");
  assertStringIncludes(rerouteMigration, "v_claim.status <> 'REDEEMED'");
  assertStringIncludes(rerouteMigration, "status = 'REQUESTED', issued_at = null");
  assertStringIncludes(rerouteMigration, "v_claim.claim_code");
  assertStringIncludes(rerouteMigration, "from_postal_code, to_postal_code");
  assert(!/referral_coupon_issuances/i.test(rerouteMigration));
});

Deno.test("Luis supermarket reroute uses the current ZIP and preserves independent benefit campaigns", () => {
  assertStringIncludes(rerouteMigration, "postal_code = v_postal, supermarket_location_id = v_location.id");
  assertStringIncludes(rerouteMigration, "p_campaign_key = 'luis_benefit_supermarket_20'");
  assertStringIncludes(rerouteMigration, "campaign_id = v_campaign.id and lead_id = p_lead_id");
  assertStringIncludes(rerouteMigration, "v_location.id is null");
});

// --- 20260819000100: existing-claim + unsupported-ZIP return-contract fix ---
// DRAFT ONLY. Not applied to any database - these tests pin the migration
// FILE's text so the SQL change is reviewable and regression-proof before
// anyone runs it. See report for the four-case behavior matrix.

Deno.test("verification fix is additive: only replaces the one function, no schema/table/column changes", () => {
  assertStringIncludes(verificationFixMigration, "create or replace function public.request_referral_benefit_claim(");
  assert(!/create table|alter table|add column|drop column|drop table/i.test(verificationFixMigration));
  // Claim lifecycle functions (issue/redeem) are untouched by this migration.
  assert(!/create or replace function public\.issue_referral_benefit_claim/.test(verificationFixMigration));
  assert(!/create or replace function public\.redeem_referral_benefit_claim/.test(verificationFixMigration));
  // Grants preserved exactly as the base migration defined them.
  assertStringIncludes(
    verificationFixMigration,
    "revoke all on function public.request_referral_benefit_claim(text, text, uuid, text, text, boolean, text, text) from public, anon, authenticated;",
  );
  assertStringIncludes(
    verificationFixMigration,
    "grant execute on function public.request_referral_benefit_claim(text, text, uuid, text, text, boolean, text, text) to service_role;",
  );
});

Deno.test("case 1 (existing claim + same supported ZIP): idempotent reuse is unchanged", () => {
  // No reroute fires when the resolved location already matches the claim's
  // stored location (`is distinct from` is false) - identical to the live
  // reroute migration, not touched by this fix.
  assertStringIncludes(
    verificationFixMigration,
    "v_claim.supermarket_location_id is distinct from v_location.id then",
  );
  // requires_location_verification is false whenever v_location resolved AND
  // the claim already has a location - same-ZIP resubmission satisfies both.
  assertStringIncludes(
    verificationFixMigration,
    "v_requires_verification := v_is_supermarket and (v_location.id is null or v_claim.supermarket_location_id is null);",
  );
});

Deno.test("case 2 (existing claim + different supported ZIP): reroute + audit trail preserved verbatim", () => {
  assertStringIncludes(verificationFixMigration, "insert into public.referral_benefit_claim_reroutes (");
  assertStringIncludes(verificationFixMigration, "from_postal_code, to_postal_code,");
  assertStringIncludes(verificationFixMigration, "from_supermarket_location_id, to_supermarket_location_id");
  assertStringIncludes(
    verificationFixMigration,
    "set postal_code = v_postal, supermarket_location_id = v_location.id,\n             status = 'REQUESTED', issued_at = null, updated_at = now()",
  );
  assertStringIncludes(verificationFixMigration, "where id = v_claim.id and status <> 'REDEEMED'");
  // After a successful reroute, v_claim.supermarket_location_id = v_location.id,
  // so the shared v_requires_verification formula evaluates to false and the
  // NEW location's fields (via existing_location, now re-pointed) are returned.
});

Deno.test("case 3 (existing claim + unsupported ZIP): claim location untouched, but the returned fields are nulled", () => {
  // The reroute block is gated on v_location.id is not null, so it never fires
  // for an unsupported ZIP - the claim row's stored location is left exactly
  // as it was (no update statement executes).
  assertStringIncludes(
    verificationFixMigration,
    "if v_is_supermarket and v_location.id is not null and v_claim.status <> 'REDEEMED'",
  );
  // The three location-identifying return columns are now nulled whenever
  // verification is required, instead of leaking the claim's stale location.
  const existingClaimReturn = verificationFixMigration.slice(
    verificationFixMigration.indexOf("v_requires_verification := v_is_supermarket"),
    verificationFixMigration.indexOf("for v_attempt in 1..8 loop"),
  );
  assertStringIncludes(
    existingClaimReturn,
    "case when v_requires_verification then null else v_claim.supermarket_location_id end,",
  );
  assertStringIncludes(
    existingClaimReturn,
    "case when v_requires_verification then null else existing_location.display_name end,",
  );
  assertStringIncludes(
    existingClaimReturn,
    "case when v_requires_verification then null else existing_location.official_media_url end,",
  );
  assertStringIncludes(existingClaimReturn, "v_requires_verification\n    from (select 1) as guard");
});

Deno.test("case 4 (new claim + unsupported ZIP): unchanged - already returned null location fields", () => {
  // The brand-new-claim return path is untouched by this migration: v_location
  // was never found for an unsupported ZIP, so v_claim.supermarket_location_id
  // was inserted as null and v_location.display_name/official_media_url are
  // already null - no case expression was needed here.
  assertStringIncludes(
    verificationFixMigration,
    "return query select v_claim.id, v_claim.claim_code, v_claim.status, true,\n    v_claim.supermarket_location_id, v_location.display_name, v_location.official_media_url,\n    v_is_supermarket and v_location.id is null;",
  );
});

Deno.test("MEDICAL/DENTAL/SHIPPING are unaffected: verification stays gated on v_is_supermarket only", () => {
  assertStringIncludes(
    verificationFixMigration,
    "v_is_supermarket := p_campaign_key = 'luis_benefit_supermarket_20';",
  );
  // Every requires_location_verification computation in the fixed function is
  // still prefixed with v_is_supermarket - MEDICAL/DENTAL/SHIPPING claims
  // always evaluate to false regardless of this fix.
  const verificationFormulas = verificationFixMigration.match(/v_is_supermarket and \([^)]*\)/g) ?? [];
  assert(verificationFormulas.length >= 2, "expected the existing-claim and duplicate-insert-race branches both gated");
});
