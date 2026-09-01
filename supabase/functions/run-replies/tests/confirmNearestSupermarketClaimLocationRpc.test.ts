/// <reference lib="deno.ns" />
// Source-text assertions against the DRAFT (not applied) RPC SQL file,
// same convention already used for supabase/functions/run-replies/index.ts
// throughout this test suite — this repo has no SQL execution harness, so
// correctness of an un-applied migration is verified by asserting its
// text directly, the same way luisConversationRouter.test.ts verifies
// run-replies/index.ts's un-deployed handler code.
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const rpcSource = await Deno.readTextFile(
  new URL(
    "../../../../docs/proposed-migrations/20260824_draft_confirm_nearest_supermarket_claim_location.sql",
    import.meta.url,
  ),
);

function functionBody(): string {
  const start = rpcSource.indexOf("create or replace function public.confirm_referral_benefit_claim_location");
  const end = rpcSource.indexOf("revoke all on function", start);
  return rpcSource.slice(start, end);
}

Deno.test("confirm_referral_benefit_claim_location never assigns status or issued_at - issuance stays exclusively issue_referral_benefit_claim's job", () => {
  const body = functionBody();
  assertEquals(body.includes("status = 'ISSUED'"), false);
  // Checks for an actual SQL assignment (issued_at = ...), not the word
  // "issued_at" appearing in this function's own explanatory comments
  // about what it deliberately does NOT do.
  assertEquals(/issued_at\s*=/.test(body), false);
});

Deno.test("the location-assignment UPDATE is WHERE-guarded to status = 'REQUESTED' - a duplicate confirmation after issuance can never silently reassign the location", () => {
  const body = functionBody();
  const updateStart = body.indexOf("update public.referral_benefit_claims");
  const updateEnd = body.indexOf("returning * into v_claim", updateStart);
  const updateStatement = body.slice(updateStart, updateEnd);
  assertStringIncludes(updateStatement, "supermarket_location_id = p_location_id");
  assertStringIncludes(updateStatement, "status = 'REQUESTED'");
});

Deno.test("a reroute audit row is written only when the assigned location actually changed - re-confirming the same location twice writes no duplicate reroute", () => {
  const body = functionBody();
  assertStringIncludes(body, "v_prior_location_id is distinct from p_location_id");
  assertStringIncludes(body, "insert into public.referral_benefit_claim_reroutes");
  assertStringIncludes(body, "'nearest_location_confirmation'");
});

Deno.test("a claim already resolved by a concurrent call re-reads the true current row instead of trusting a stale pre-update snapshot", () => {
  const body = functionBody();
  const foundStart = body.indexOf("if found then");
  const afterFound = body.slice(foundStart);
  assertStringIncludes(afterFound, "select * into v_claim from public.referral_benefit_claims");
});

Deno.test("the confirmed location must belong to the claim's own campaign - defense in depth against cross-campaign assignment", () => {
  const body = functionBody();
  assertStringIncludes(body, "v_location.campaign_id <> v_claim.campaign_id");
  assertStringIncludes(body, "benefit_location_campaign_mismatch");
});

Deno.test("the location must be active and org-scoped to be confirmable", () => {
  const body = functionBody();
  const locationLookupStart = body.indexOf("select * into v_location");
  const locationLookupEnd = body.indexOf(";", locationLookupStart);
  const lookup = body.slice(locationLookupStart, locationLookupEnd);
  assertStringIncludes(lookup, "organization_id = p_organization_id");
  assertStringIncludes(lookup, "active");
});

Deno.test("the function is service_role-only, never callable from the browser/frontend", () => {
  const grantSection = rpcSource.slice(rpcSource.indexOf("revoke all on function"));
  // CORRECTED 2026-08-24 (post-apply grant audit): revoking from PUBLIC
  // alone left anon/authenticated with EXECUTE in production, because
  // Supabase's default privileges grant them EXECUTE directly on function
  // creation, independent of the PUBLIC pseudo-role. Confirmed live via
  // information_schema.role_routine_grants and corrected with an explicit
  // REVOKE naming all three roles - this assertion must match that fix,
  // not the original (insufficient) draft text.
  assertStringIncludes(grantSection, "revoke all on function public.confirm_referral_benefit_claim_location(text, uuid, uuid) from public, anon, authenticated;");
  assertStringIncludes(grantSection, "grant all on function public.confirm_referral_benefit_claim_location(text, uuid, uuid) to service_role;");
  assertEquals(grantSection.includes("to authenticated"), false);
});
