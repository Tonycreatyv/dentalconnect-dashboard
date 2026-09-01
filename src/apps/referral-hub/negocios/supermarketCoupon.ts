import type { SupermarketLocation } from "./types";

// The supermarket benefit is ONE shared coupon campaign backed by MULTIPLE
// real, independently-imaged locations (referral_benefit_campaign_locations)
// — never a single global image. These are pure presentation helpers only;
// they never decide which image is actually sent to a customer (that stays
// entirely inside request_referral_benefit_claim / run-replies, untouched
// by this file).

export function isSupermarketCampaignKey(campaignKey: string): boolean {
  return campaignKey.includes("supermarket");
}

const MAX_THUMBNAILS = 3;

// Real official images only, from active locations, capped at 3 for the
// collage - never padded with a placeholder or another location's image.
export function activeLocationThumbnails(locations: SupermarketLocation[], max = MAX_THUMBNAILS): string[] {
  return locations
    .map((location) => location.officialMediaUrl)
    .filter((url) => Boolean(url))
    .slice(0, max);
}

export function supermarketAvailabilityLabel(activeLocationCount: number): string {
  if (activeLocationCount === 0) return "Sin ubicaciones activas todavía";
  return `Disponible en ${activeLocationCount} ${activeLocationCount === 1 ? "supermercado" : "supermercados"}`;
}

export function extraLocationCount(locations: SupermarketLocation[], shown = MAX_THUMBNAILS): number {
  return Math.max(0, locations.length - shown);
}

// The exact image + name that would be shown/sent for the currently
// selected location — never a different location's data, never a shared
// campaign fallback. Falls back to the first location when the selected id
// isn't found (e.g. stale selection after a reload), and to empty values
// when there are no locations at all - never fabricated.
export function resolveSelectedLocationPreview(
  locations: SupermarketLocation[],
  selectedLocationId: string,
): { location: SupermarketLocation | null; imageUrl: string; businessName: string } {
  const location = locations.find((l) => l.id === selectedLocationId) ?? locations[0] ?? null;
  return {
    location,
    imageUrl: location?.officialMediaUrl ?? "",
    businessName: location?.displayName ?? "",
  };
}
