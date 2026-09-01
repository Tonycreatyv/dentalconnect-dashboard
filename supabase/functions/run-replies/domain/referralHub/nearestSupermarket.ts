// Nearest-supermarket fallback for customers whose ZIP does not directly
// match a participating supermarket location, per the approved local-only
// work package. Reads exclusively from referral_benefit_campaign_locations
// (organization-scoped, active-only) — the canonical, already-live table
// backing the real supermarket coupon benefit. Never hard-codes a store
// name or ZIP; the participating set is whatever is actually active in
// that table for this organization/campaign at call time.
//
// Reuses the existing, already-in-production Google Maps client
// (../../../referral-voice-tools/googleMaps.ts, already used by
// whatsappGrocery.ts with the same GOOGLE_MAPS_PLATFORM_API_KEY secret) —
// no new Google Cloud configuration, no new API, nothing hard-coded.
//
// Store-coordinate caching (2026-08-24): referral_benefit_campaign_locations
// may or may not have latitude/longitude/google_place_id/geocoded_at yet —
// see docs/proposed-migrations/20260822_draft_supermarket_location_coordinates_OPTIONAL.sql
// (draft, not applied as of this file). This module works correctly either
// way: if the columns don't exist, the select falls back to the base
// columns and every match geocodes store addresses fresh (today's exact
// behavior, unchanged). Once the migration lands, a store's cached
// lat/lng is reused whenever present and no more than 30 days old — per
// Google Maps Platform's terms, Geocoding-API-derived lat/lng may be
// cached for up to 30 consecutive calendar days and must then be
// refreshed, never stored indefinitely (google_place_id has no such limit
// and may be cached indefinitely, but this module does not currently use
// place_id for anything). A freshly geocoded store address is written
// back best-effort so the next unresolved-ZIP customer benefits — a
// failed write is never treated as a match failure.
//
// Customer ZIP geocoding results and Google Routes distance/duration
// results are NEVER persisted anywhere by this module, only ever
// held in memory for the duration of a single request — this is a
// deliberate compliance choice, not an oversight (see the same
// migration draft's terms note for the reasoning).

import type { GoogleMapsCallDiagnostics, GoogleMapsClient } from "../../../referral-voice-tools/googleMaps.ts";

type SupabaseLike = {
  from(table: string): any;
};

export type SupermarketLocationRow = {
  id: string;
  display_name: string;
  postal_code: string;
  address_text: string;
  official_media_url: string;
  latitude: number | null;
  longitude: number | null;
  google_place_id: string | null;
  geocoded_at: string | null;
};

export type SupermarketMatch =
  | {
    status: "matched";
    matchType: "exact_zip" | "nearest_location";
    customerZip: string;
    locationId: string;
    storeName: string;
    address: string | null;
    // Real coordinates for the chosen store, only ever populated for
    // nearest_location (2026-08-27, native WhatsApp location message) —
    // exact_zip needs no geocoding at all (unchanged) and stays null here.
    // Never invented: nearest_location only reaches "matched" after a real
    // successful Google geocode of this exact store's address.
    latitude: number | null;
    longitude: number | null;
    // Straight-line (Haversine) distance, kept only as an internal ranking
    // signal for the max-distance rule — the customer-facing copy never
    // shows it (Part 3, 2026-08-26: distance/time is optional and may be
    // omitted, and Google Routes was dropped from this flow entirely, so
    // there is no real driving distance/time to show).
    distanceValue: number | null;
    distanceUnit: "mi" | null;
    travelTimeMinutes: null;
    confirmationRequired: boolean;
  }
  | {
    status: "unresolved";
    customerZip: string;
    reason:
      | "no_active_locations"
      | "geocoding_failed"
      | "no_location_within_range";
    // Sanitized diagnostic detail (never an API key, never customer PII) -
    // set only for geocoding_failed, where a real Google response (or its
    // absence) narrows down WHY. See run-replies/index.ts's
    // tryFindNearestSupermarket, the only place this gets logged.
    debugDetail?: GoogleMapsCallDiagnostics;
    // Count of active candidate locations found for this campaign at call
    // time (0 when the query itself failed/returned none) - sanitized
    // diagnostic only, never affects matching/ranking behavior.
    activeLocationCount: number;
  };

const DEFAULT_MAX_DISTANCE_MILES = 25;
// Google Maps Platform terms: Geocoding-API-derived lat/lng may be cached
// for up to 30 consecutive calendar days before it must be refreshed.
const GEOCODE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isUndefinedColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42703";
}

async function loadActiveLocations(
  supabase: SupabaseLike,
  organizationId: string,
  campaignId: string,
): Promise<SupermarketLocationRow[] | null> {
  const fullSelect = "id,display_name,postal_code,address_text,official_media_url,latitude,longitude,google_place_id,geocoded_at";
  const baseSelect = "id,display_name,postal_code,address_text,official_media_url";
  let result = await supabase
    .from("referral_benefit_campaign_locations")
    .select(fullSelect)
    .eq("organization_id", organizationId)
    .eq("campaign_id", campaignId)
    .eq("active", true);
  if (result.error && isUndefinedColumnError(result.error)) {
    // Coordinate-caching migration not applied yet - fall back to the
    // columns that definitely exist. Every match still works correctly,
    // just always geocodes store addresses fresh (today's behavior).
    result = await supabase
      .from("referral_benefit_campaign_locations")
      .select(baseSelect)
      .eq("organization_id", organizationId)
      .eq("campaign_id", campaignId)
      .eq("active", true);
    if (result.error) return null;
    return ((result.data ?? []) as Array<Omit<SupermarketLocationRow, "latitude" | "longitude" | "google_place_id" | "geocoded_at">>)
      .map((row) => ({ ...row, latitude: null, longitude: null, google_place_id: null, geocoded_at: null }));
  }
  if (result.error) return null;
  return (result.data ?? []) as SupermarketLocationRow[];
}

// Best-effort cache write - a failure here must never fail the customer's
// match; the next call simply geocodes fresh again, exactly like today.
// Scoped by organization_id + campaign_id + the row's own id, matching this
// codebase's defense-in-depth convention for any write touching a
// participating location (see confirm_referral_benefit_claim_location's
// equivalent org/campaign guards) — locationId is always a value this
// module itself already loaded via the org+campaign-scoped
// loadActiveLocations query, so this can never in practice touch a row
// outside that scope, but the write states its own boundary explicitly
// rather than relying on that being true elsewhere in the file.
async function tryCacheGeocode(
  supabase: SupabaseLike,
  organizationId: string,
  campaignId: string,
  locationId: string,
  coords: { latitude: number; longitude: number },
): Promise<void> {
  try {
    await supabase
      .from("referral_benefit_campaign_locations")
      .update({ latitude: coords.latitude, longitude: coords.longitude, geocoded_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("campaign_id", campaignId)
      .eq("id", locationId);
  } catch {
    // Ignored on purpose - see comment above.
  }
}

function hasFreshCachedCoords(row: SupermarketLocationRow): row is SupermarketLocationRow & { latitude: number; longitude: number } {
  if (row.latitude === null || row.longitude === null || !row.geocoded_at) return false;
  const geocodedAtMs = new Date(row.geocoded_at).getTime();
  if (Number.isNaN(geocodedAtMs)) return false;
  return Date.now() - geocodedAtMs <= GEOCODE_CACHE_MAX_AGE_MS;
}

// Cheap, non-billed straight-line distance (Haversine) used only to narrow
// which locations are worth an actual Google Routes call - never used as
// the distance/time shown to the customer (that always comes from Routes,
// see findSupermarketMatch below).
function haversineMiles(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.asin(Math.sqrt(h));
}

// Part 3 (2026-08-26): Google Routes was dropped from this flow entirely.
// It was a second, independently-failing Google API (separate enablement/
// billing/quota from Geocoding) whose failure blocked a recommendation
// even when a real nearby store WAS determinable — and its response
// parsing had a real bug: any single destination element without
// condition "ROUTE_EXISTS" (a normal, expected outcome for a farther
// candidate, not an error) rejected the ENTIRE batch, discarding valid
// routes for closer stores along with it. Per the approved simplification,
// "nearest" is now decided purely by geocoding + straight-line (Haversine)
// distance, which needs only the one Google API this module already
// depends on for exact-ZIP-adjacent resolution. Distance/time is no longer
// shown to the customer at all (optional, per spec, and Haversine isn't an
// accurate drive-time estimate anyway) - it is kept internally only to
// rank candidates and apply the max-distance rule.
export async function findSupermarketMatch(args: {
  supabase: SupabaseLike;
  googleMaps: GoogleMapsClient;
  organizationId: string;
  campaignId: string;
  postalCode: string;
  maxDistanceMiles?: number;
}): Promise<SupermarketMatch> {
  const customerZip = args.postalCode;
  const locations = await loadActiveLocations(args.supabase, args.organizationId, args.campaignId);
  if (!locations || locations.length === 0) {
    return { status: "unresolved", customerZip, reason: "no_active_locations", activeLocationCount: 0 };
  }

  // Exact ZIP match always wins, computed fresh every call — never a cached
  // or stale assumption, and never something that could reuse a previous
  // customer's resolved location for a different ZIP.
  const exact = locations.find((row) => row.postal_code === customerZip);
  if (exact) {
    return {
      status: "matched",
      matchType: "exact_zip",
      customerZip,
      locationId: exact.id,
      storeName: exact.display_name,
      address: exact.address_text || null,
      latitude: null,
      longitude: null,
      distanceValue: null,
      distanceUnit: null,
      travelTimeMinutes: null,
      confirmationRequired: false,
    };
  }

  // Customer ZIP is geocoded once per call, in memory only - never
  // persisted anywhere (see the file header's compliance note).
  const customerGeocode = await args.googleMaps.geocodeAddress(customerZip);
  if (customerGeocode.error || !customerGeocode.data) {
    return { status: "unresolved", customerZip, reason: "geocoding_failed", debugDetail: customerGeocode.diagnostics, activeLocationCount: locations.length };
  }
  const customerCoords = { latitude: customerGeocode.data.latitude, longitude: customerGeocode.data.longitude };

  // Resolve coordinates for every active location - reusing a fresh cached
  // value when present, geocoding on demand (and best-effort caching the
  // result) only when genuinely absent or stale. A single store whose
  // address fails to geocode (transient rate limit, a momentary network
  // blip, an address Google's API happens to parse poorly) is SKIPPED,
  // never treated as a reason to fail the whole match - the exact same
  // "don't let one bad element reject a real answer" principle already
  // applied to the (now-removed) Routes batch above. With today's 3 real
  // locations and no cached coordinates yet, every unsupported-ZIP lookup
  // makes 3 sequential store geocode calls; failing on the FIRST one to
  // fail - even the farthest, least relevant store - previously discarded
  // a perfectly good match to a closer store that geocoded successfully.
  // The match only truly fails if NO store resolves at all.
  const geocodedLocations: Array<{ row: SupermarketLocationRow; latitude: number; longitude: number }> = [];
  let lastStoreGeocodeFailureDetail: GoogleMapsCallDiagnostics | undefined;
  for (const row of locations) {
    if (hasFreshCachedCoords(row)) {
      geocodedLocations.push({ row, latitude: row.latitude, longitude: row.longitude });
      continue;
    }
    const geocoded = await args.googleMaps.geocodeAddress(row.address_text);
    if (geocoded.error || !geocoded.data) {
      lastStoreGeocodeFailureDetail = geocoded.diagnostics;
      continue;
    }
    geocodedLocations.push({ row, latitude: geocoded.data.latitude, longitude: geocoded.data.longitude });
    void tryCacheGeocode(args.supabase, args.organizationId, args.campaignId, row.id, geocoded.data);
  }
  if (geocodedLocations.length === 0) {
    return { status: "unresolved", customerZip, reason: "geocoding_failed", debugDetail: lastStoreGeocodeFailureDetail, activeLocationCount: locations.length };
  }

  const rankedByHaversine = [...geocodedLocations].sort(
    (a, b) => haversineMiles(customerCoords, a) - haversineMiles(customerCoords, b),
  );
  const nearest = rankedByHaversine[0];
  const maxDistanceMiles = args.maxDistanceMiles ?? DEFAULT_MAX_DISTANCE_MILES;
  const distanceMiles = Math.round(haversineMiles(customerCoords, nearest) * 10) / 10;
  if (distanceMiles > maxDistanceMiles) {
    return { status: "unresolved", customerZip, reason: "no_location_within_range", activeLocationCount: locations.length };
  }

  return {
    status: "matched",
    matchType: "nearest_location",
    customerZip,
    locationId: nearest.row.id,
    storeName: nearest.row.display_name,
    address: nearest.row.address_text || null,
    latitude: nearest.latitude,
    longitude: nearest.longitude,
    distanceValue: distanceMiles,
    distanceUnit: "mi",
    travelTimeMinutes: null,
    confirmationRequired: true,
  };
}

// Exact required copy (2026-08-27 revision) — split into 3 separate
// outbound messages instead of one combined block: this intro text, a
// native WhatsApp location message (see formatNearestSupermarketLocation),
// then the confirmation question with its own buttons
// (NEAREST_SUPERMARKET_CONFIRM_QUESTION below). No raw Google Maps URL and
// no external URL shortener anywhere in customer-facing text — the real
// coordinates travel in the native location message instead, which
// WhatsApp itself renders as a tappable map, not an ugly pasted link.
export function formatNearestSupermarketIntroText(match: {
  storeName: string;
}): string {
  return [
    "Encontramos una ubicación participante cerca de tu ZIP:",
    match.storeName,
    "",
    "Te compartimos la ubicación.",
  ].join("\n");
}

export const NEAREST_SUPERMARKET_CONFIRM_QUESTION =
  "¿Querés que te enviemos el cupón para esta tienda?";

// Native WhatsApp location message payload for the confirmed nearest
// store - never invented: only ever built from a "matched"/"nearest_location"
// result, whose latitude/longitude only exist after a real successful
// Google geocode (see findSupermarketMatch above). Returns null if
// coordinates are unavailable so the caller can fall back to the existing
// honest "estamos verificando" behavior instead of sending a broken or
// fabricated location.
export function formatNearestSupermarketLocation(match: {
  storeName: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}): { latitude: number; longitude: number; name: string; address: string } | null {
  if (match.latitude === null || match.longitude === null) return null;
  return {
    latitude: match.latitude,
    longitude: match.longitude,
    name: match.storeName,
    address: match.address ?? "",
  };
}
