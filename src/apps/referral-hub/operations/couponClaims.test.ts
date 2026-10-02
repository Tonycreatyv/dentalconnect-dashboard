/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { filterCouponClaims, SIN_LOCALIDAD_KEY, type CouponClaimRow } from "./couponClaims.ts";

// Fixture mirrors the real production shape verified live for this round's
// audit (referral-hub-app, org luis-gabriel-referral-hub, 2026-08-23):
// 2 medical claims, 1 resolved El Sol claim, 2 unresolved supermarket
// claims with no location assigned. Real campaign_key/location_key values,
// not invented ones - see docs/proposed-migrations audit notes.
function claim(overrides: Partial<CouponClaimRow>): CouponClaimRow {
  return {
    id: "claim-1",
    claim_code: "LG-0000",
    status: "ISSUED",
    postal_code: "30071",
    requested_at: "2026-08-21T18:00:00Z",
    lead_id: "lead-1",
    lead_name: "Cliente",
    channel_user_id: null,
    campaign_key: "luis_benefit_medical_20",
    campaign_label: "20% de descuento en servicios médicos",
    location_key: "",
    location_label: "",
    ...overrides,
  };
}

const medicalClaimA = claim({ id: "m1", lead_id: "lead-diana", lead_name: "Diana meza" });
const medicalClaimB = claim({ id: "m2", lead_id: "lead-luis", lead_name: "Luis Gabriel" });
const elSolClaim = claim({
  id: "s1", lead_id: "lead-jose", lead_name: "Jose Duran",
  campaign_key: "luis_benefit_supermarket_20", campaign_label: "$20 para tu compra de supermercado",
  location_key: "el_sol_30071", location_label: "El Sol Super Market",
});
const unresolvedSupermarketA = claim({
  id: "u1", lead_id: "lead-a",
  campaign_key: "luis_benefit_supermarket_20", campaign_label: "$20 para tu compra de supermercado",
  location_key: SIN_LOCALIDAD_KEY, location_label: "Sin localidad",
});
const unresolvedSupermarketB = claim({
  id: "u2", lead_id: "lead-b",
  campaign_key: "luis_benefit_supermarket_20", campaign_label: "$20 para tu compra de supermercado",
  location_key: SIN_LOCALIDAD_KEY, location_label: "Sin localidad",
});
const allClaims = [medicalClaimA, medicalClaimB, elSolClaim, unresolvedSupermarketA, unresolvedSupermarketB];

Deno.test("Médico Urgencias: filtering by its exact campaign_key returns exactly the 2 real medical claims", () => {
  const result = filterCouponClaims(allClaims, "", "luis_benefit_medical_20");
  assertEquals(result.map((c) => c.id).sort(), ["m1", "m2"]);
});

Deno.test("El Sol: filtering by its exact location_key returns exactly its 1 real claim", () => {
  const result = filterCouponClaims(allClaims, "el_sol_30071", "");
  assertEquals(result.map((c) => c.id), ["s1"]);
});

Deno.test("El Sol's claim never leaks into Mi Tierra's or El Güero's location filter", () => {
  assertEquals(filterCouponClaims(allClaims, "mi_tierra_30341", ""), []);
  assertEquals(filterCouponClaims(allClaims, "el_guero_30501", ""), []);
});

Deno.test("Mi Tierra and El Güero have zero real claims today - filtering stays zero, never falls back to another location's claim", () => {
  const result = filterCouponClaims(allClaims, "mi_tierra_30341", "");
  assertEquals(result.length, 0);
});

Deno.test("unsupported-ZIP claims with no resolved location are never attributed to any specific store", () => {
  for (const locationKey of ["el_sol_30071", "mi_tierra_30341", "el_guero_30501"]) {
    const result = filterCouponClaims(allClaims, locationKey, "");
    assertEquals(result.some((c) => c.id === "u1" || c.id === "u2"), false);
  }
});

Deno.test("unsupported-ZIP claims are still visible under the aggregate supermarket campaign filter (they are real requests, just not location-attributed)", () => {
  const result = filterCouponClaims(allClaims, "", "luis_benefit_supermarket_20");
  assertEquals(result.map((c) => c.id).sort(), ["s1", "u1", "u2"]);
});

Deno.test("no filter at all returns every claim, unfiltered", () => {
  assertEquals(filterCouponClaims(allClaims, "", "").length, allClaims.length);
});

Deno.test("combining a campaign filter with a location filter that belongs to a different campaign returns nothing (no accidental OR semantics)", () => {
  const result = filterCouponClaims(allClaims, "el_sol_30071", "luis_benefit_medical_20");
  assertEquals(result, []);
});
