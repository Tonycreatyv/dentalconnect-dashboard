import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  findSupermarketMatch,
  formatNearestSupermarketIntroText,
  formatNearestSupermarketLocation,
  NEAREST_SUPERMARKET_CONFIRM_QUESTION,
  type SupermarketLocationRow,
} from "../domain/referralHub/nearestSupermarket.ts";
import type { GoogleMapsClient } from "../../referral-voice-tools/googleMaps.ts";

const ORG = "luis-gabriel-referral-hub";
const CAMPAIGN = "01a08a7e-0c64-4d0a-877f-848e75dc75c9";

// Mirrors the real active rows found in production (verified read-only via
// `supabase db query`) — same names, same real addresses, no ZIPs/names
// hard-coded into the module itself, only into this test's fixtures.
const REAL_LOCATIONS: SupermarketLocationRow[] = [
  { id: "el-sol", display_name: "El Sol Super Market", postal_code: "30071", address_text: "2880 Simpson Cir #110, Norcross, GA 30071", official_media_url: "https://x/el-sol.jpeg", latitude: null, longitude: null, google_place_id: null, geocoded_at: null },
  { id: "mi-tierra", display_name: "Mi Tierra Supermercados", postal_code: "30341", address_text: "4317 Buford Hwy NE, Atlanta, GA 30341", official_media_url: "https://x/mi-tierra.jpeg", latitude: null, longitude: null, google_place_id: null, geocoded_at: null },
  { id: "el-guero", display_name: "El Güero Supermercado", postal_code: "30501", address_text: "730 Pearl Nix Pkwy, Gainesville, GA 30501", official_media_url: "https://x/el-guero.jpeg", latitude: null, longitude: null, google_place_id: null, geocoded_at: null },
];

// A minimal thenable query-builder mock: every chained call returns `this`,
// and awaiting it resolves to { data, error }. `update` is recorded so
// tests can assert whether a best-effort cache write was attempted - and,
// once a write starts (`update()` called), every subsequent `.eq(col,
// value)` in the chain is captured too, so a test can assert the write was
// truly scoped by organization_id + campaign_id + id, not just that some
// write happened.
function chainable(result: { data: unknown; error: unknown }, onUpdate?: (patch: unknown) => void, onUpdateEq?: (filters: Record<string, unknown>) => void) {
  let updating = false;
  const updateFilters: Record<string, unknown> = {};
  const builder: any = {
    select() { return builder; },
    eq(column: string, value: unknown) {
      if (updating) updateFilters[column] = value;
      return builder;
    },
    update(patch: unknown) { updating = true; onUpdate?.(patch); return builder; },
    then(resolve: (value: unknown) => unknown) {
      if (updating) onUpdateEq?.(updateFilters);
      return Promise.resolve(result).then(resolve);
    },
  };
  return builder;
}

function supabaseWithLocations(rows: SupermarketLocationRow[], error = false, onUpdate?: (patch: unknown) => void, onUpdateEq?: (filters: Record<string, unknown>) => void) {
  return { from: (_table: string) => chainable({ data: error ? null : rows, error: error ? { message: "boom" } : null }, onUpdate, onUpdateEq) };
}

// Simulates the real select-then-fallback the module performs when the
// coordinate-caching migration hasn't been applied yet (Postgres reports
// undefined_column, code 42703, for the extra select columns).
function supabaseUndefinedColumnThenBase(rows: SupermarketLocationRow[]) {
  let calls = 0;
  return {
    from: (_table: string) => chainable({
      data: (() => {
        calls++;
        return calls === 1 ? null : rows.map(({ id, display_name, postal_code, address_text, official_media_url }) => ({ id, display_name, postal_code, address_text, official_media_url }));
      })(),
      error: calls === 1 ? { code: "42703", message: "column does not exist" } : null,
    }),
  };
}

// Part 3 (2026-08-26): Google Routes was dropped from this module entirely,
// so the mock client only ever needs geocodeAddress - computeDrivingRouteMatrix
// is still part of the shared GoogleMapsClient type (other callers use it),
// but findSupermarketMatch never calls it anymore.
function mapsClient(overrides: Partial<GoogleMapsClient>): GoogleMapsClient {
  return {
    geocodeAddress: async () => ({ data: null, error: "geocoding_failed" }),
    computeDrivingRouteMatrix: async () => ({ data: null, error: "routes_failed" }),
    ...overrides,
  };
}

// Real approximate coordinates (Gwinnett/metro-Atlanta area) used across
// several tests below - close enough to reality to make the relative
// ranking (El Sol nearest, El Güero farthest) meaningful, not just a
// synthetic ordering.
const REAL_COORDS: Record<string, { latitude: number; longitude: number }> = {
  "30047": { latitude: 33.89, longitude: -84.13 }, // Lilburn, GA - Duluth/30096's immediate area
  "2880 Simpson Cir #110, Norcross, GA 30071": { latitude: 33.9539, longitude: -84.1854 },
  "4317 Buford Hwy NE, Atlanta, GA 30341": { latitude: 33.905, longitude: -84.29 },
  "730 Pearl Nix Pkwy, Gainesville, GA 30501": { latitude: 34.29, longitude: -83.85 },
};

Deno.test("exact ZIP match wins, no geocoding call needed, confirmation not required", async () => {
  let geocodeCalls = 0;
  const maps = mapsClient({
    geocodeAddress: async () => { geocodeCalls++; return { data: { formattedAddress: "x", latitude: 0, longitude: 0 }, error: null }; },
  });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(REAL_LOCATIONS),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30341",
  });
  assertEquals(result, {
    status: "matched",
    matchType: "exact_zip",
    customerZip: "30341",
    locationId: "mi-tierra",
    storeName: "Mi Tierra Supermercados",
    address: "4317 Buford Hwy NE, Atlanta, GA 30341",
    latitude: null,
    longitude: null,
    distanceValue: null,
    distanceUnit: null,
    travelTimeMinutes: null,
    confirmationRequired: false,
  });
  assertEquals(geocodeCalls, 0);
});

Deno.test("unsupported ZIP proposes a genuine nearest active location by geocoding + straight-line distance alone, no Routes call", async () => {
  let routesCalled = false;
  const maps = mapsClient({
    geocodeAddress: async (address) => {
      const coords = REAL_COORDS[address];
      return coords ? { data: { formattedAddress: address, ...coords }, error: null } : { data: null, error: "geocoding_failed" };
    },
    computeDrivingRouteMatrix: async () => { routesCalled = true; return { data: null, error: "routes_failed" }; },
  });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(REAL_LOCATIONS),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
  });
  assertEquals(result.status, "matched");
  if (result.status !== "matched") throw new Error("unreachable");
  assertEquals(result.matchType, "nearest_location");
  // El Sol (Norcross) is genuinely the closest of the three real stores to
  // Lilburn/Duluth-area coordinates.
  assertEquals(result.locationId, "el-sol");
  assertEquals(result.storeName, "El Sol Super Market");
  assertEquals(result.confirmationRequired, true);
  assertEquals(result.distanceUnit, "mi");
  assertEquals(typeof result.distanceValue, "number");
  assertEquals(result.travelTimeMinutes, null);
  // Real coordinates from the winning store's own successful geocode -
  // never invented, never left over from a different store.
  assertEquals(result.latitude, REAL_COORDS["2880 Simpson Cir #110, Norcross, GA 30071"].latitude);
  assertEquals(result.longitude, REAL_COORDS["2880 Simpson Cir #110, Norcross, GA 30071"].longitude);
  // The whole point of dropping Routes: a Google Routes outage/failure
  // (mocked here to always fail) never even gets called, let alone blocks
  // the recommendation.
  assertEquals(routesCalled, false);
});

Deno.test("[2026-08-27 revision] intro text names the store, never claims the coupon is already sent, never mentions distance/time or a raw Google Maps URL", () => {
  const text = formatNearestSupermarketIntroText({ storeName: "El Sol Super Market" });
  assertEquals(text.includes("Encontramos una ubicación participante cerca de tu ZIP:"), true);
  assertEquals(text.includes("El Sol Super Market"), true);
  assertEquals(text.includes("Te compartimos la ubicación."), true);
  assertEquals(/enviad|emitid|activad/i.test(text), false, "must not claim the coupon was already sent/issued");
  assertEquals(/milla|min en auto/i.test(text), false, "distance/time is optional and is omitted from this copy");
  assertEquals(text.includes("google.com/maps"), false, "no raw Google Maps URL - the location travels in the native WhatsApp location message instead");
  assertEquals(/https?:\/\//.test(text), false, "no URL of any kind (no external shortener either)");
});

Deno.test("the confirmation question is exactly the required copy, sent as its own separate message", () => {
  assertEquals(NEAREST_SUPERMARKET_CONFIRM_QUESTION, "¿Querés que te enviemos el cupón para esta tienda?");
});

Deno.test("[native location message] builds a real WhatsApp location payload from the matched store's own name/address/coordinates - never invented", () => {
  const location = formatNearestSupermarketLocation({
    storeName: "El Sol Super Market",
    address: "2880 Simpson Cir #110, Norcross, GA 30071",
    latitude: 33.9539,
    longitude: -84.1854,
  });
  assertEquals(location, {
    latitude: 33.9539,
    longitude: -84.1854,
    name: "El Sol Super Market",
    address: "2880 Simpson Cir #110, Norcross, GA 30071",
  });
});

Deno.test("[native location message] returns null (never a fabricated/broken location) when coordinates are unavailable", () => {
  assertEquals(
    formatNearestSupermarketLocation({ storeName: "El Sol Super Market", address: "some address", latitude: null, longitude: -84.1854 }),
    null,
  );
  assertEquals(
    formatNearestSupermarketLocation({ storeName: "El Sol Super Market", address: "some address", latitude: 33.9539, longitude: null }),
    null,
  );
});

Deno.test("[native location message] address falls back to an empty string, never null/undefined, when the store has no address on file", () => {
  const location = formatNearestSupermarketLocation({
    storeName: "El Sol Super Market",
    address: null,
    latitude: 33.9539,
    longitude: -84.1854,
  });
  assertEquals(location?.address, "");
});

Deno.test("Google geocoding failure never guesses a store - returns truthful unresolved state", async () => {
  const maps = mapsClient({ geocodeAddress: async () => ({ data: null, error: "geocoding_failed" }) });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(REAL_LOCATIONS),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
  });
  assertEquals(result, { status: "unresolved", customerZip: "30047", reason: "geocoding_failed", debugDetail: undefined, activeLocationCount: REAL_LOCATIONS.length });
});

Deno.test("a real Google error (sanitized) is surfaced through debugDetail so a production failure is diagnosable, never just a bare 'unresolved'", async () => {
  const maps = mapsClient({
    geocodeAddress: async () => ({
      data: null,
      error: "geocoding_failed",
      diagnostics: { httpStatus: 403, googleErrorStatus: "PERMISSION_DENIED", googleErrorMessage: "Geocoding API v4 has not been used in project 123 before or it is disabled", networkError: false },
    }),
  });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(REAL_LOCATIONS),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
  });
  assertEquals(result.status, "unresolved");
  if (result.status === "unresolved") {
    assertEquals(result.debugDetail?.httpStatus, 403);
    assertEquals(result.debugDetail?.googleErrorStatus, "PERMISSION_DENIED");
  }
});

Deno.test("inactive/other-org locations are excluded by construction (query never returns them)", async () => {
  // The module trusts its query to already be active+org scoped (it adds
  // .eq("active", true) and .eq("organization_id", ...) itself); this test
  // asserts that when the (mocked) query legitimately returns zero rows -
  // exactly what a correct active+org-scoped query returns when nothing
  // qualifies - the module reports unresolved rather than fabricating one.
  const maps = mapsClient({});
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations([]),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
  });
  assertEquals(result, { status: "unresolved", customerZip: "30047", reason: "no_active_locations", activeLocationCount: 0 });
});

Deno.test("missing/failed location data never fails silently into a guess", async () => {
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations([], true),
    googleMaps: mapsClient({}),
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
  });
  assertEquals(result, { status: "unresolved", customerZip: "30047", reason: "no_active_locations", activeLocationCount: 0 });
});

Deno.test("a fresh cached lat/lng is reused - no geocoding call for that store", async () => {
  const fresh: SupermarketLocationRow[] = REAL_LOCATIONS.map((row) => ({
    ...row,
    latitude: row.id === "el-sol" ? 33.9539 : 33.9,
    longitude: row.id === "el-sol" ? -84.1854 : -84.2,
    geocoded_at: new Date().toISOString(), // just cached - well within 30 days
  }));
  const geocodedAddresses: string[] = [];
  const maps = mapsClient({
    geocodeAddress: async (address) => {
      geocodedAddresses.push(address);
      if (address === "30047") return { data: { formattedAddress: address, latitude: 33.96, longitude: -84.15 }, error: null };
      return { data: null, error: "geocoding_failed" };
    },
  });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(fresh),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
  });
  assertEquals(result.status, "matched");
  // Only the customer ZIP was geocoded - all 3 stores had fresh cached
  // coordinates, so none of their addresses were ever geocoded.
  assertEquals(geocodedAddresses, ["30047"]);
});

Deno.test("a stale cached lat/lng (>30 days old) is never reused - the store is re-geocoded", async () => {
  const stale: SupermarketLocationRow[] = REAL_LOCATIONS.map((row) => ({
    ...row,
    latitude: 10,
    longitude: 10,
    geocoded_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(), // 31 days ago
  }));
  const geocodedAddresses: string[] = [];
  const maps = mapsClient({
    geocodeAddress: async (address) => { geocodedAddresses.push(address); return { data: { formattedAddress: address, latitude: 33.9, longitude: -84.2 }, error: null }; },
  });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(stale),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
  });
  assertEquals(result.status, "matched");
  // Customer ZIP + all 3 real store addresses were geocoded fresh - the
  // 31-day-old cached value was correctly treated as absent.
  assertEquals(geocodedAddresses.length, 4);
  assertEquals(geocodedAddresses.includes("2880 Simpson Cir #110, Norcross, GA 30071"), true);
});

Deno.test("a freshly geocoded store address is cached back best-effort (write attempted, never blocks the match)", async () => {
  const updates: unknown[] = [];
  const maps = mapsClient({
    geocodeAddress: async (address) => ({ data: { formattedAddress: address, latitude: 33.9, longitude: -84.2 }, error: null }),
  });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(REAL_LOCATIONS, false, (patch) => updates.push(patch)),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
  });
  assertEquals(result.status, "matched");
  // One cache-write attempt per store that was actually geocoded (all 3,
  // since none had cached coordinates in this fixture).
  assertEquals(updates.length, 3);
  for (const patch of updates) {
    assertEquals(typeof (patch as { latitude: number }).latitude, "number");
    assertEquals(typeof (patch as { geocoded_at: string }).geocoded_at, "string");
  }
});

Deno.test("the coordinate cache-write is scoped by organization_id + campaign_id + the exact canonical location id, not id alone", async () => {
  const updateFilterSets: Record<string, unknown>[] = [];
  const maps = mapsClient({
    geocodeAddress: async (address) => ({ data: { formattedAddress: address, latitude: 33.9, longitude: -84.2 }, error: null }),
  });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(REAL_LOCATIONS, false, undefined, (filters) => updateFilterSets.push(filters)),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
  });
  assertEquals(result.status, "matched");
  // One scoped write per geocoded store (all 3) - every single one carries
  // all three filters, matching this codebase's defense-in-depth
  // convention (see confirm_referral_benefit_claim_location's equivalent
  // org/campaign guards).
  assertEquals(updateFilterSets.length, 3);
  const expectedIds = new Set(REAL_LOCATIONS.map((row) => row.id));
  for (const filters of updateFilterSets) {
    assertEquals(filters.organization_id, ORG);
    assertEquals(filters.campaign_id, CAMPAIGN);
    assertEquals(expectedIds.has(filters.id as string), true);
  }
});

Deno.test("works correctly when the coordinate-caching migration hasn't been applied yet (undefined_column fallback)", async () => {
  const maps = mapsClient({
    geocodeAddress: async (address) => ({ data: { formattedAddress: address, latitude: 33.9, longitude: -84.2 }, error: null }),
  });
  const result = await findSupermarketMatch({
    supabase: supabaseUndefinedColumnThenBase(REAL_LOCATIONS),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
  });
  assertEquals(result.status, "matched");
});

// Regression (2026-08-26): a real customer, ZIP 30096 (Duluth, GA - the
// same immediate area as 30047 in REAL_COORDS above), reached the
// "Estamos verificando..." dead-end even though El Sol (the genuinely
// nearest, correctly geocodable store) should have produced a proposal.
// Root cause found by code review: with zero cached coordinates (the real
// production state at the time), every unsupported-ZIP lookup made 3
// sequential store-geocode calls, and the loop treated ANY single one of
// them failing - even El Güero, the farthest and least relevant store -
// as a reason to fail the ENTIRE match. This reproduces that exact shape:
// the two nearer stores (El Sol, Mi Tierra) geocode fine, only the
// farthest (El Güero) fails - the match must still succeed, proposing the
// genuinely nearest store that did resolve.
Deno.test("[ZIP 30096 regression] one store's geocode failing (even a real, non-farthest one) never fails the whole match - the nearest store that DID resolve still wins", async () => {
  const geocodedAddresses: string[] = [];
  const maps = mapsClient({
    geocodeAddress: async (address) => {
      geocodedAddresses.push(address);
      if (address === "30096") return { data: { formattedAddress: address, latitude: 34.0029, longitude: -84.1446 }, error: null }; // Duluth, GA
      if (address === "730 Pearl Nix Pkwy, Gainesville, GA 30501") {
        return { data: null, error: "geocoding_failed", diagnostics: { httpStatus: 429, googleErrorStatus: "RESOURCE_EXHAUSTED", googleErrorMessage: "Quota exceeded", networkError: false } };
      }
      const coords = REAL_COORDS[address];
      return coords ? { data: { formattedAddress: address, ...coords }, error: null } : { data: null, error: "geocoding_failed" };
    },
  });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(REAL_LOCATIONS),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30096",
  });
  assertEquals(result.status, "matched");
  if (result.status !== "matched") throw new Error("unreachable");
  // El Sol (Norcross) is genuinely nearest to Duluth/30096 among the
  // stores that successfully geocoded.
  assertEquals(result.locationId, "el-sol");
  assertEquals(result.matchType, "nearest_location");
  assertEquals(result.confirmationRequired, true);
  // All 3 stores were attempted (no early bail-out on the first failure).
  assertEquals(geocodedAddresses.includes("730 Pearl Nix Pkwy, Gainesville, GA 30501"), true);
  assertEquals(geocodedAddresses.includes("2880 Simpson Cir #110, Norcross, GA 30071"), true);
});

Deno.test("[ZIP 30096 regression, boundary] if EVERY store's geocode fails, the match is still honestly unresolved - never a fabricated nearest store", async () => {
  const maps = mapsClient({
    geocodeAddress: async (address) => {
      if (address === "30096") return { data: { formattedAddress: address, latitude: 34.0029, longitude: -84.1446 }, error: null };
      return { data: null, error: "geocoding_failed", diagnostics: { httpStatus: 429, googleErrorStatus: "RESOURCE_EXHAUSTED", googleErrorMessage: "Quota exceeded", networkError: false } };
    },
  });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(REAL_LOCATIONS),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30096",
  });
  assertEquals(result.status, "unresolved");
  if (result.status === "unresolved") {
    assertEquals(result.reason, "geocoding_failed");
    assertEquals(result.debugDetail?.googleErrorStatus, "RESOURCE_EXHAUSTED");
  }
});

Deno.test("a nearest match beyond the configured max distance is reported unresolved, not forced", async () => {
  const maps = mapsClient({
    // Customer far from every store (~180 miles away on each axis).
    geocodeAddress: async (address) => {
      if (address === "30047") return { data: { formattedAddress: address, latitude: 30.0, longitude: -80.0 }, error: null };
      const coords = REAL_COORDS[address];
      return coords ? { data: { formattedAddress: address, ...coords }, error: null } : { data: null, error: "geocoding_failed" };
    },
  });
  const result = await findSupermarketMatch({
    supabase: supabaseWithLocations(REAL_LOCATIONS),
    googleMaps: maps,
    organizationId: ORG,
    campaignId: CAMPAIGN,
    postalCode: "30047",
    maxDistanceMiles: 25,
  });
  assertEquals(result, { status: "unresolved", customerZip: "30047", reason: "no_location_within_range", activeLocationCount: REAL_LOCATIONS.length });
});
