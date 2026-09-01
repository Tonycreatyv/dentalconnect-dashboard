import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveCouponMediaUrl, resolveCouponPartnerName } from "../../_products/referral-hub/luisBenefits.ts";

// Precedence contract (approved plan):
//   Supermarket (location-based):   A) exact-ZIP referral_benefit_campaign_locations.official_media_url
//                                    -> B) nothing else (never a generic/business image; the caller
//                                       returns early via requires_location_verification when unmatched).
//   Non-location benefits:          B) referral_coupon_campaigns.image_url (delivery_source='db')
//                                    -> C) LUIS_BENEFITS[key].mediaUrl hardcoded fallback.

Deno.test("supermarket: ZIP-matched location image wins over everything, including a configured db image", () => {
  const result = resolveCouponMediaUrl({
    isSupermarket: true,
    rpcOfficialMediaUrl: "https://cdn.example.com/mi-tierra-plaza-fiesta.jpg",
    dbImageUrl: "https://cdn.example.com/should-never-be-used.jpg",
    hardcodedFallback: "",
  });
  assertEquals(result, "https://cdn.example.com/mi-tierra-plaza-fiesta.jpg");
});

Deno.test("supermarket: no location match never falls through to a db/business-level image", () => {
  // In production this branch is unreachable in practice - the caller
  // returns early on requires_location_verification before computing a
  // media URL at all - but the pure helper is asserted defensively too,
  // so a future refactor that removes the early return can't silently
  // start leaking a generic image for an unsupported ZIP.
  const result = resolveCouponMediaUrl({
    isSupermarket: true,
    rpcOfficialMediaUrl: "",
    dbImageUrl: "https://cdn.example.com/should-never-be-used.jpg",
    hardcodedFallback: "",
  });
  assertEquals(result, "", "must not fall through to dbImageUrl for supermarket");
});

Deno.test("supermarket: no location match and no hardcoded fallback resolves to empty (never a stale/wrong image)", () => {
  const result = resolveCouponMediaUrl({
    isSupermarket: true,
    rpcOfficialMediaUrl: "",
    dbImageUrl: "",
    hardcodedFallback: "",
  });
  assertEquals(result, "");
});

Deno.test("medical/dental/shipping: db image used when delivery_source='db' and image_url is set", () => {
  const result = resolveCouponMediaUrl({
    isSupermarket: false,
    rpcOfficialMediaUrl: "",
    dbImageUrl: "https://referral.creatyv.io/images/coupons/luis/medico-urgencias-v2.jpeg",
    hardcodedFallback: "https://referral.creatyv.io/images/coupons/luis/medico-urgencias.jpeg",
  });
  assertEquals(result, "https://referral.creatyv.io/images/coupons/luis/medico-urgencias-v2.jpeg");
});

Deno.test("medical/dental/shipping: hardcoded fallback used when not db-driven (delivery_source stays 'legacy')", () => {
  const result = resolveCouponMediaUrl({
    isSupermarket: false,
    rpcOfficialMediaUrl: "",
    dbImageUrl: "",
    hardcodedFallback: "https://referral.creatyv.io/images/coupons/luis/medico-urgencias.jpeg",
  });
  assertEquals(result, "https://referral.creatyv.io/images/coupons/luis/medico-urgencias.jpeg");
});

Deno.test("partner name: supermarket location name wins over a db business name", () => {
  const result = resolveCouponPartnerName({
    rpcSupermarketLocationName: "Mi Tierra Plaza Fiesta",
    dbBusinessName: "Should not win",
    hardcodedFallback: "Also should not win",
  });
  assertEquals(result, "Mi Tierra Plaza Fiesta");
});

Deno.test("partner name: db business name used when no location name and db-driven", () => {
  const result = resolveCouponPartnerName({
    rpcSupermarketLocationName: "",
    dbBusinessName: "Médico Urgencias",
    hardcodedFallback: "Legacy fallback name",
  });
  assertEquals(result, "Médico Urgencias");
});

Deno.test("partner name: hardcoded fallback used when nothing else resolved", () => {
  const result = resolveCouponPartnerName({
    rpcSupermarketLocationName: "",
    dbBusinessName: "",
    hardcodedFallback: "Médico Urgencias",
  });
  assertEquals(result, "Médico Urgencias");
});

Deno.test("partner name: null when nothing resolves at all", () => {
  const result = resolveCouponPartnerName({
    rpcSupermarketLocationName: "",
    dbBusinessName: "",
    hardcodedFallback: null,
  });
  assertEquals(result, null);
});
