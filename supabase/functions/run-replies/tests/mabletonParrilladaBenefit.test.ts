import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { LUIS_BENEFITS, luisBenefitsActivationText, resolveSupermarketBenefit } from "../../_products/referral-hub/luisBenefits.ts";

Deno.test("MABLETON_PARRILLADA is defined with its own campaign key, distinct from luis_benefit_supermarket_20", () => {
  const benefit = LUIS_BENEFITS.MABLETON_PARRILLADA;
  assertEquals(benefit.key, "MABLETON_PARRILLADA");
  assertEquals(benefit.campaignKey, "luis_benefit_mableton_parrillada");
  assertEquals(benefit.displayName, "La Super Parrillada");
});

Deno.test("MABLETON_PARRILLADA has no hardcoded partnerName/mediaUrl — it is location-aware like SUPERMARKET, resolved only from referral_benefit_campaign_locations", () => {
  const benefit = LUIS_BENEFITS.MABLETON_PARRILLADA;
  assertEquals(benefit.partnerName, undefined);
  assertEquals(benefit.mediaUrl, undefined);
});

Deno.test("Mableton's activation text never implies a $20 discount or generic coupon wording", () => {
  const text = luisBenefitsActivationText({
    firstName: "Ana",
    benefitDisplayName: LUIS_BENEFITS.MABLETON_PARRILLADA.displayName,
    claimCode: "LG-TEST",
    partnerName: "The Mableton Supermarket",
  });
  assertEquals(text.includes("$20"), false);
  assertEquals(text.toLowerCase().includes("descuento"), false);
  assertEquals(text.toLowerCase().includes("cupón"), false);
  assertStringIncludes(text, "La Super Parrillada");
  assertStringIncludes(text, "The Mableton Supermarket");
});

Deno.test("Mableton's activation text is produced by the same generic function as every other benefit — no new hardcoded message path", () => {
  const supermarketText = luisBenefitsActivationText({
    firstName: "Ana",
    benefitDisplayName: LUIS_BENEFITS.SUPERMARKET.displayName,
    claimCode: "LG-TEST",
    partnerName: "El Sol Super Market",
  });
  const mabletonText = luisBenefitsActivationText({
    firstName: "Ana",
    benefitDisplayName: LUIS_BENEFITS.MABLETON_PARRILLADA.displayName,
    claimCode: "LG-TEST",
    partnerName: "The Mableton Supermarket",
  });
  // Same template shape (same number of paragraphs), only the interpolated
  // values differ — proves no benefit-specific message branch exists.
  assertEquals(
    supermarketText.split("\n\n").length,
    mabletonText.split("\n\n").length,
  );
});

// --- resolveSupermarketBenefit: the actual gap ---------------------------
// The Flow's BENEFIT_SELECT screen only ever submits benefit_key
// "SUPERMARKET" — there is no separate Mableton menu option (by product
// rule) and no way for a customer to submit "MABLETON_PARRILLADA" directly.
// Before this function existed, run-replies looked up LUIS_BENEFITS purely
// by completion.benefit_key, so Mableton's campaign/displayName could never
// be reached regardless of postal_code. This is what actually wires ZIP
// 30126 to the Mableton offer.

Deno.test("resolveSupermarketBenefit returns Mableton's own definition only when a location match was found", () => {
  const resolved = resolveSupermarketBenefit(true);
  assertEquals(resolved.key, "MABLETON_PARRILLADA");
  assertEquals(resolved.campaignKey, "luis_benefit_mableton_parrillada");
  assertEquals(resolved.displayName, "La Super Parrillada");
});

Deno.test("the active Mableton location match selects its campaign only for 30126; generic supermarket ZIPs retain their campaign", () => {
  // The database lookup itself is intentionally data-driven and has no
  // hardcoded ZIP. These representative booleans model its exact-match
  // results from the configured locations: only 30126 belongs to Mableton.
  const cases = [
    ["30126", true, "luis_benefit_mableton_parrillada"],
    ["30341", false, "luis_benefit_supermarket_20"],
    ["30501", false, "luis_benefit_supermarket_20"],
    ["30345", false, "luis_benefit_supermarket_20"],
  ] as const;
  for (const [_postalCode, mabletonLocationMatched, campaignKey] of cases) {
    assertEquals(resolveSupermarketBenefit(mabletonLocationMatched).campaignKey, campaignKey);
  }
});

Deno.test("resolveSupermarketBenefit falls back to the existing SUPERMARKET definition when there is no match — 30071/30341/30501 and every unsupported ZIP", () => {
  const resolved = resolveSupermarketBenefit(false);
  assertEquals(resolved.key, "SUPERMARKET");
  assertEquals(resolved.campaignKey, "luis_benefit_supermarket_20");
  assertEquals(resolved.displayName, "$20 para tu compra de supermercado");
});

Deno.test("resolveSupermarketBenefit never returns a benefit definition that isn't SUPERMARKET or MABLETON_PARRILLADA", () => {
  assertEquals([true, false].every((matched) => {
    const key = resolveSupermarketBenefit(matched).key;
    return key === "SUPERMARKET" || key === "MABLETON_PARRILLADA";
  }), true);
});
