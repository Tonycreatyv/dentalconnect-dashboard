/// <reference lib="deno.ns" />
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  "supabase/migrations/20260910000100_mableton_parrillada_location_aware_claims.sql",
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = sql.indexOf("$$;", start) + "$$;".length;
  assert(start >= 0 && end > start, `could not locate ${name} body`);
  return sql.slice(start, end);
}

Deno.test("location-awareness is a generic EXISTS check against referral_benefit_campaign_locations, never a literal campaign-key comparison", () => {
  const body = functionBody("request_referral_benefit_claim");
  assertStringIncludes(
    body,
    "select exists(\n    select 1 from public.referral_benefit_campaign_locations\n     where organization_id = p_organization_id and campaign_id = v_campaign.id and active\n  ) into v_location_aware;",
  );
  // The only literal campaign-key comparisons left are the allowlist check
  // (a legitimate closed-set input validation, not a location-awareness
  // rule) — v_location_aware itself is never assigned from p_campaign_key.
  assertEquals(body.includes("v_location_aware := p_campaign_key"), false);
  assertEquals(body.includes("v_is_supermarket"), false);
});

Deno.test("a campaign with active locations (luis_benefit_supermarket_20 today, luis_benefit_mableton_parrillada once seeded) is treated as location-aware without a second hardcoded literal", () => {
  const body = functionBody("request_referral_benefit_claim");
  // The EXISTS check is parameterized entirely by v_campaign.id (resolved
  // from p_campaign_key via the earlier lookup) — it has no branch that
  // special-cases which campaign_key it's evaluating.
  const existsBlock = body.slice(
    body.indexOf("select exists("),
    body.indexOf("into v_location_aware;") + "into v_location_aware;".length,
  );
  assertEquals(existsBlock.includes("'luis_benefit_supermarket_20'"), false);
  assertEquals(existsBlock.includes("'luis_benefit_mableton_parrillada'"), false);
});

Deno.test("a campaign with zero active location rows is never treated as location-aware — no resolution, no verification flag", () => {
  const body = functionBody("request_referral_benefit_claim");
  // v_location stays at its declared-but-unpopulated %rowtype default (all
  // fields null) whenever v_location_aware is false, so
  // v_claim.supermarket_location_id is inserted as null and
  // requires_location_verification's "v_location_aware and ..." formula
  // short-circuits to false — both read directly off v_location_aware, not
  // off a second independent condition.
  assertStringIncludes(body, "case when v_location_aware then v_location.id else null end");
  assertStringIncludes(body, "v_location_aware and (v_location.id is null or v_claim.supermarket_location_id is null)");
  assertStringIncludes(body, "v_location_aware and v_location.id is null");
});

Deno.test("once a Mableton location row exists for ZIP 30126, the same unconditional postal_code match already used for every other location-aware campaign will find it — no new query needed", () => {
  const body = functionBody("request_referral_benefit_claim");
  // Exactly one location-resolution query exists, generic over campaign_id
  // and postal_code, with no campaign_key literal anywhere in it.
  const queries = [...body.matchAll(/select \* into v_location from public\.referral_benefit_campaign_locations[\s\S]*?limit 1;/g)];
  assertEquals(queries.length, 1);
  assertStringIncludes(queries[0][0], "campaign_id = v_campaign.id and postal_code = v_postal and active");
  assertEquals(queries[0][0].includes("luis_benefit_supermarket_20"), false);
});

Deno.test("luis_benefit_mableton_parrillada is a valid campaign_key input, alongside the four pre-existing ones — none removed", () => {
  assertStringIncludes(
    sql,
    "if p_campaign_key not in ('luis_benefit_supermarket_20', 'luis_benefit_medical_20', 'luis_benefit_dental_29', 'luis_benefit_shipping_20', 'luis_benefit_mableton_parrillada') then",
  );
});

Deno.test("signature and return shape are unchanged — no DROP FUNCTION, no new/removed parameters or output columns", () => {
  assertEquals(sql.includes("drop function"), false);
  assertStringIncludes(
    sql,
    "create or replace function public.request_referral_benefit_claim(\n  p_organization_id text,\n  p_campaign_key text,\n  p_lead_id uuid,\n  p_postal_code text,\n  p_email text default null,\n  p_marketing_consent boolean default false,\n  p_marketing_source text default null,\n  p_marketing_copy_version text default null\n)",
  );
  assertStringIncludes(
    sql,
    "returns table (\n  claim_id uuid,\n  claim_code text,\n  claim_status text,\n  was_created boolean,\n  supermarket_location_id uuid,\n  supermarket_location_name text,\n  official_media_url text,\n  requires_location_verification boolean\n)",
  );
});

Deno.test("no other table, RPC, or routing surface is touched — this migration only redefines request_referral_benefit_claim", () => {
  assertEquals(sql.includes("create table"), false);
  assertEquals(sql.includes("insert into public.referral_coupon_campaigns"), false);
  assertEquals(sql.includes("insert into public.referral_benefit_campaign_locations"), false);
  assertEquals(sql.includes("referral_partner_service_rules"), false);
  assertEquals(sql.includes("auto_assign_"), false);
});
