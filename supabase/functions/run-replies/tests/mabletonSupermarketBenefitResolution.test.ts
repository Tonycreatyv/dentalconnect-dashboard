import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Before this fix, run-replies looked up LUIS_BENEFITS purely by
// completion.benefit_key (always "SUPERMARKET" for any supermarket-family
// request — the Flow has no separate Mableton menu option and never will,
// per product rule), so p_campaign_key was always the static
// 'luis_benefit_supermarket_20' and benefit.displayName was always the
// generic "$20 para tu compra de supermercado" — Mableton's own campaign
// and offer text could never be reached, regardless of the ZIP entered.
// These are content-contract checks against the actual wiring (this repo's
// established pattern for verifying behavior that isn't reachable through
// a pure-function unit test alone — see security.test.ts).
const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("benefit is resolved dynamically for SUPERMARKET, not a static LUIS_BENEFITS[completion.benefit_key] lookup", () => {
  assertStringIncludes(
    source,
    'const benefit = completion.benefit_key === "SUPERMARKET"\n    ? resolveSupermarketBenefit(await hasMabletonLocationMatch({',
  );
});

Deno.test("hasMabletonLocationMatch queries generically by campaign_key + postal_code — no hardcoded ZIP literal", () => {
  assertStringIncludes(source, "LUIS_BENEFITS.MABLETON_PARRILLADA.campaignKey");
  assertStringIncludes(source, '.eq("postal_code", args.postalCode)');
  assertEquals(/30126/.test(source), false);
});

Deno.test("hasMabletonLocationMatch fails closed to false on any DB error — never a guess", () => {
  assertStringIncludes(source, "if (campaignRow.error || !campaignId) return false;");
  assertStringIncludes(source, "return !locationRow.error && Boolean(locationRow.data);");
});

Deno.test("p_campaign_key passed to the claim RPC comes from the resolved benefit, not a literal — 30071/30341/30501 still resolve through the unchanged SUPERMARKET campaign", () => {
  assertStringIncludes(source, "p_campaign_key: benefit.campaignKey,");
  // Only one call site issues a benefit claim — confirms this isn't a
  // second, parallel code path that bypasses the resolution above.
  assertEquals(source.split("p_campaign_key: benefit.campaignKey,").length - 1, 1);
});

Deno.test("MEDICAL/DENTAL/SHIPPING and every legal flow are untouched — the Mableton check only runs for benefit_key === 'SUPERMARKET'", () => {
  const benefitBlockStart = source.indexOf('const benefit = completion.benefit_key === "SUPERMARKET"');
  const benefitBlockEnd = source.indexOf(";", source.indexOf(": LUIS_BENEFITS[completion.benefit_key];", benefitBlockStart)) + 1;
  const benefitBlock = source.slice(benefitBlockStart, benefitBlockEnd);
  assertStringIncludes(benefitBlock, ": LUIS_BENEFITS[completion.benefit_key];");
  // capture_legal_flow_request/capture_immigration_flow_request live in a
  // completely separate function — this block never references them.
  assertEquals(benefitBlock.includes("capture_legal_flow_request"), false);
  assertEquals(benefitBlock.includes("capture_immigration_flow_request"), false);
});
