import type { SupermarketLocation } from "./types";

// Location-backed benefits use referral_benefit_campaign_locations for the
// participating stores and their official images. These helpers are pure
// presentation only; outbound WhatsApp delivery remains untouched.
export function isSupermarketCampaignKey(campaignKey: string): boolean {
  return campaignKey.includes("supermarket") || campaignKey === "luis_benefit_mableton_parrillada";
}

const MAX_THUMBNAILS = 3;

export function activeLocationThumbnails(locations: SupermarketLocation[], max = MAX_THUMBNAILS): string[] {
  return locations
    .map((location) => location.officialMediaUrl)
    .filter((url) => Boolean(url))
    .slice(0, max);
}

export function supermarketAvailabilityLabel(activeLocationCount: number): string {
  if (activeLocationCount === 0) return "Sin ubicaciones activas todavía";
  return `Disponible en ${activeLocationCount} ${activeLocationCount === 1 ? "ubicación" : "ubicaciones"}`;
}

export function extraLocationCount(locations: SupermarketLocation[], shown = MAX_THUMBNAILS): number {
  return Math.max(0, locations.length - shown);
}

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
