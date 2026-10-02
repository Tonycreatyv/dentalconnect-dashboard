/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  activeLocationThumbnails,
  extraLocationCount,
  isSupermarketCampaignKey,
  resolveSelectedLocationPreview,
  supermarketAvailabilityLabel,
} from "./supermarketCoupon.ts";
import type { SupermarketLocation } from "./types.ts";

// Fixtures mirror the real active production locations (names/images only —
// not hardcoded anywhere in the module itself, see security.test.ts).
const EL_SOL: SupermarketLocation = { id: "loc-el-sol", locationKey: "el-sol", displayName: "El Sol Super Market", officialMediaUrl: "https://referral.creatyv.io/images/coupons/luis/el-sol-supermarket-30071.jpeg", postalCode: "30071", addressText: "" };
const MI_TIERRA: SupermarketLocation = { id: "loc-mi-tierra", locationKey: "mi-tierra", displayName: "Mi Tierra Supermercados", officialMediaUrl: "https://referral.creatyv.io/images/coupons/luis/mi-tierra-supermercados-30341.jpeg", postalCode: "30341", addressText: "" };
const EL_GUERO: SupermarketLocation = { id: "loc-el-guero", locationKey: "el-guero", displayName: "El Güero Supermercado", officialMediaUrl: "https://referral.creatyv.io/images/coupons/luis/el-guero-supermercado-30501.jpeg", postalCode: "30501", addressText: "" };
const ACTIVE_LOCATIONS = [EL_SOL, MI_TIERRA, EL_GUERO];

Deno.test("isSupermarketCampaignKey recognizes the real campaign key and nothing else", () => {
  assertEquals(isSupermarketCampaignKey("luis_benefit_supermarket_20"), true);
  assertEquals(isSupermarketCampaignKey("luis_benefit_medical_20"), false);
  assertEquals(isSupermarketCampaignKey("luis_benefit_dental_29"), false);
});

Deno.test("shared supermarket campaign displays all active location images, none dropped or duplicated", () => {
  const thumbnails = activeLocationThumbnails(ACTIVE_LOCATIONS);
  assertEquals(thumbnails.length, 3);
  assertEquals(thumbnails.includes(EL_SOL.officialMediaUrl), true);
  assertEquals(thumbnails.includes(MI_TIERRA.officialMediaUrl), true);
  assertEquals(thumbnails.includes(EL_GUERO.officialMediaUrl), true);
  // No single URL repeated - never one location's image standing in for the others.
  assertEquals(new Set(thumbnails).size, thumbnails.length);
});

Deno.test("no single location is ever mislabeled as the global image - a location without an image is skipped, not substituted", () => {
  const missingImage: SupermarketLocation = { ...MI_TIERRA, officialMediaUrl: "" };
  const thumbnails = activeLocationThumbnails([EL_SOL, missingImage, EL_GUERO]);
  assertEquals(thumbnails, [EL_SOL.officialMediaUrl, EL_GUERO.officialMediaUrl]);
  assertEquals(thumbnails.includes(EL_SOL.officialMediaUrl) && thumbnails.every((u) => u !== MI_TIERRA.officialMediaUrl), true);
});

Deno.test("thumbnails cap at 3 and report the real remaining count", () => {
  const fourth: SupermarketLocation = { ...EL_SOL, id: "loc-fourth", locationKey: "fourth", displayName: "Fourth Supermarket" };
  const locations = [...ACTIVE_LOCATIONS, fourth];
  assertEquals(activeLocationThumbnails(locations).length, 3);
  assertEquals(extraLocationCount(locations), 1);
  assertEquals(extraLocationCount(ACTIVE_LOCATIONS), 0);
});

Deno.test("availability label uses the real active-location count, replacing 'Sin imagen'", () => {
  assertEquals(supermarketAvailabilityLabel(3), "Disponible en 3 supermercados");
  assertEquals(supermarketAvailabilityLabel(1), "Disponible en 1 supermercado");
  assertEquals(supermarketAvailabilityLabel(0), "Sin ubicaciones activas todavía");
});

Deno.test("selected-location preview matches exactly that location's official image and name, never another's", () => {
  const preview = resolveSelectedLocationPreview(ACTIVE_LOCATIONS, MI_TIERRA.id);
  assertEquals(preview.imageUrl, MI_TIERRA.officialMediaUrl);
  assertEquals(preview.businessName, MI_TIERRA.displayName);
  assertEquals(preview.imageUrl === EL_SOL.officialMediaUrl, false);
  assertEquals(preview.imageUrl === EL_GUERO.officialMediaUrl, false);
});

Deno.test("selecting each location in turn returns three distinct, correct previews", () => {
  for (const location of ACTIVE_LOCATIONS) {
    const preview = resolveSelectedLocationPreview(ACTIVE_LOCATIONS, location.id);
    assertEquals(preview.imageUrl, location.officialMediaUrl);
    assertEquals(preview.businessName, location.displayName);
  }
});

Deno.test("no active locations resolves to a truthful empty preview, never a fabricated fallback", () => {
  const preview = resolveSelectedLocationPreview([], "anything");
  assertEquals(preview.location, null);
  assertEquals(preview.imageUrl, "");
  assertEquals(preview.businessName, "");
});
