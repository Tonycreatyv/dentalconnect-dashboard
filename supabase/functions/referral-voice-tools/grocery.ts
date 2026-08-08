import {
  getPantryDemoPackage,
  PANTRY_DEMO_PACKAGES,
  type PantryDemoItem,
  type PantryPackageKey,
} from "../run-replies/domain/referralHub/pantryDemoCatalog.ts";
import {
  normalizeSourceChannel,
  type ReferralSourceChannel,
  VOICE_SOURCE_ORGANIZATION_ID,
  voiceChannelUserId,
  type VoiceLead,
  type VoiceLeadInput,
} from "./workflow.ts";
import type {
  DrivingRoute,
  GeocodedAddress,
  RouteCoordinate,
} from "./googleMaps.ts";

const IMAGE_BASE_URL = "https://referral.creatyv.io";
const GROCERY_SERVICE_ID = "luis_compra_super";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GroceryUuid = string;

const SERVICE_ZIPS = new Map<string, readonly string[]>([
  ["8bad61aa-3010-6cac-4f62-fd7cf16f35e2", ["30345", "30329", "30341"]],
  ["5af97871-bb3e-5faf-45c9-701cd8d9a635", ["30345", "30329", "30341"]],
  ["85ea7272-0d41-2d09-b29c-cc5c3320669e", ["30315"]],
  ["7a000c5b-fd26-76f0-8bcd-08eecb72c769", ["30345", "30071", "30044"]],
  ["014bb610-a915-e0ab-7c2c-a8a492e0c572", ["30044", "30071"]],
  ["8f1737f1-af9b-0630-6d97-011261ee5791", ["30060"]],
]);
// Compatibility only until 20260802000100_referral_grocery_delivery_coverage.sql
// is applied. Database rows are authoritative whenever the table is available.
const LOCATION_ORDER = new Map(
  [...SERVICE_ZIPS.keys()].map((id, index) => [id, index]),
);

export type GroceryOfferRow = {
  id: GroceryUuid;
  partner_location_id: GroceryUuid;
  basket_key: PantryPackageKey;
  display_name: string;
  price_cents: number;
  currency: string;
  contents_snapshot: unknown;
  active: boolean;
};

export type GroceryLocationRow = {
  id: string;
  partner_id: string;
  name: string;
  formatted_address: string;
  city: string;
  state: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  delivery_enabled: boolean;
  partner_name: string;
  partner_active: boolean;
};

export type GroceryCoverageRow = {
  partner_location_id: GroceryUuid;
  postal_code: string;
  active: boolean;
  priority: number;
};

export type GroceryOrderRow = {
  order_code: string;
  status: string;
  basket_name: string;
  basket_price_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  currency: string;
  delivery_address: string;
  idempotent_replay: boolean;
};

export type GroceryDependencies = {
  listOffers: (partnerLocationId: string) => Promise<{
    data: GroceryOfferRow[] | null;
    error: unknown | null;
  }>;
  getOffer: (offerId: string) => Promise<{
    data: GroceryOfferRow | null;
    error: unknown | null;
  }>;
  listLocations: () => Promise<{
    data: GroceryLocationRow[] | null;
    error: unknown | null;
  }>;
  listDeliveryCoverage?: (postalCode: string) => Promise<{
    data: GroceryCoverageRow[] | null;
    error: unknown | null;
    unavailable?: boolean;
  }>;
  geocodeAddress: (address: string) => Promise<{
    data: GeocodedAddress | null;
    error: unknown | null;
  }>;
  computeDrivingRouteMatrix: (input: {
    origin: RouteCoordinate;
    destinationCoordinates: RouteCoordinate[];
  }) => Promise<{
    data: DrivingRoute[] | null;
    error: unknown | null;
  }>;
  findVoiceLead: (
    channelUserId: string,
    sourceChannel: ReferralSourceChannel,
  ) => Promise<{
    data: VoiceLead | null;
    error: unknown | null;
  }>;
  saveVoiceLead: (input: VoiceLeadInput) => Promise<{
    data: VoiceLead | null;
    error: unknown | null;
  }>;
  createOrder: (args: Record<string, unknown>) => Promise<{
    data: GroceryOrderRow | null;
    error: unknown | null;
  }>;
};

type GroceryIntake = {
  conversation_id_hash: string;
  fields: Record<string, string>;
  order_code?: string;
  submitted_at?: string;
};

const FIELD_PROMPTS: Record<string, string> = {
  offer_id: "¿Qué compra prefieres: Esencial, Familiar o Completa?",
  postal_code: "¿Cuál es el código postal de entrega?",
  partner_location_id: "¿Qué supermercado disponible prefieres?",
  customer_name: "¿Cuál es el nombre de la persona que recibirá el pedido?",
  phone: "¿Cuál es el número de contacto?",
  address_line_1: "¿Cuál es la dirección completa de entrega?",
  city: "¿Cuál es la ciudad de entrega?",
  state: "¿Cuál es el estado?",
  payment_preference: "¿Cómo prefieres coordinar el pago?",
};

const REQUIRED_FIELDS = Object.keys(FIELD_PROMPTS);
const ALLOWED_FIELDS = new Set([
  ...REQUIRED_FIELDS,
  "address_line_2",
  "delivery_instructions",
]);

function text(value: unknown, max = 300): string {
  return typeof value === "string" && value.trim().length <= max
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

export function normalizePostalCode(value: unknown): string | null {
  const raw = text(value, 10);
  const match = raw.match(/^(\d{5})(?:-\d{4})?$/);
  return match?.[1] ?? null;
}

export function normalizeUsPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || /[A-Za-z]/.test(raw)) return null;
  if (
    (raw.match(/\+/g) ?? []).length > 1 ||
    raw.includes("+") && !raw.startsWith("+")
  ) {
    return null;
  }
  const withoutPlus = raw.startsWith("+") ? raw.slice(1) : raw;
  if (/[^\d\s()-]/.test(withoutPlus)) return null;
  const digits = withoutPlus.replace(/[\s()-]/g, "");
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

function basketKey(value: unknown): PantryPackageKey | null {
  const normalized = text(value).toLowerCase();
  if (normalized === "essential" || normalized.includes("esencial")) {
    return "essential";
  }
  if (normalized === "family" || normalized.includes("familiar")) {
    return "family";
  }
  if (normalized === "complete" || normalized.includes("completa")) {
    return "complete";
  }
  return null;
}

function uuid(value: unknown): GroceryUuid | null {
  const normalized = text(value, 36);
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function publicImageUrl(key: PantryPackageKey): string {
  return `${IMAGE_BASE_URL}/images/shop-${key}.jpg`;
}

function products(snapshot: unknown): PantryDemoItem[] {
  if (
    snapshot && typeof snapshot === "object" &&
    Array.isArray((snapshot as Record<string, unknown>).products)
  ) {
    return ((snapshot as Record<string, unknown>).products as unknown[])
      .filter((item) => item && typeof item === "object")
      .map((item) => item as PantryDemoItem);
  }
  return [];
}

function categorizedContents(items: PantryDemoItem[]) {
  const labels = {
    pantry: "Despensa",
    protein: "Proteínas y lácteos",
    produce_home: "Frutas, vegetales y hogar",
  };
  return Object.entries(labels).map(([category, label]) => ({
    category,
    label,
    items: items.filter((item) => item.category === category).map((item) => ({
      name: item.name,
      quantity: item.quantity,
    })),
  })).filter((category) => category.items.length);
}

function canonicalOffers(rows: GroceryOfferRow[], partnerLocationId: string) {
  return PANTRY_DEMO_PACKAGES.map((catalog) => {
    const matching = rows.filter((row) =>
      row.active && row.partner_location_id === partnerLocationId &&
      row.basket_key === catalog.id
    );
    if (matching.length !== 1) return null;
    const row = matching[0];
    if (!Number.isSafeInteger(row.price_cents) || row.price_cents < 0) {
      return null;
    }
    const currentItems = products(row.contents_snapshot);
    const count = currentItems.length || catalog.items.length;
    return {
      offer_id: row.id,
      basket_key: catalog.id,
      partner_location_id: row.partner_location_id,
      name: row.display_name,
      price: row.price_cents / 100,
      currency: row.currency,
      short_summary: `Para ${catalog.audience}; ${count} productos.`,
      voice_summary: `${row.display_name}, $${
        row.price_cents / 100
      }, para ${catalog.audience}.`,
      image_url: publicImageUrl(catalog.id),
      active: true as const,
      contents: categorizedContents(
        currentItems.length ? currentItems : catalog.items,
      ),
    };
  }).filter((offer) => offer !== null);
}

export async function listBasketOffers(
  partnerLocationIdInput: unknown,
  dependencies: GroceryDependencies,
) {
  if (!text(partnerLocationIdInput)) {
    return { error: "missing_partner_location_id", status: 400 };
  }
  const partnerLocationId = uuid(partnerLocationIdInput);
  if (!partnerLocationId) {
    return { error: "invalid_partner_location_id", status: 400 };
  }
  const result = await dependencies.listOffers(partnerLocationId);
  if (result.error) return { error: "basket_lookup_failed", status: 500 };
  const offers = canonicalOffers(result.data ?? [], partnerLocationId);
  if (offers.length !== 3) {
    return { error: "basket_configuration_incomplete", status: 500 };
  }
  return { status: 200, body: { success: true, offers } };
}

export async function getBasketDetails(
  offerId: unknown,
  partnerLocationIdInput: unknown,
  dependencies: GroceryDependencies,
) {
  const id = uuid(offerId);
  if (!id) return { error: "basket_not_found", status: 404 };
  if (!text(partnerLocationIdInput)) {
    return { error: "missing_partner_location_id", status: 400 };
  }
  const partnerLocationId = uuid(partnerLocationIdInput);
  if (!partnerLocationId) {
    return { error: "invalid_partner_location_id", status: 400 };
  }
  const result = await dependencies.getOffer(id);
  if (result.error) return { error: "basket_lookup_failed", status: 500 };
  const row = result.data;
  if (
    !row?.active || row.id !== id ||
    row.partner_location_id !== partnerLocationId ||
    !Number.isSafeInteger(row.price_cents) || row.price_cents < 0
  ) {
    return { error: "basket_not_found", status: 404 };
  }
  const catalog = getPantryDemoPackage(row.basket_key);
  if (!catalog) return { error: "basket_not_found", status: 404 };
  const currentItems = products(row.contents_snapshot);
  const contents = categorizedContents(
    currentItems.length ? currentItems : catalog.items,
  );
  return row
    ? {
      status: 200,
      body: {
        success: true,
        offer_id: row.id,
        basket_key: catalog.id,
        partner_location_id: row.partner_location_id,
        name: row.display_name,
        price: row.price_cents / 100,
        currency: row.currency,
        categorized_contents: contents,
        short_summary: `Para ${catalog.audience}; ${
          currentItems.length || catalog.items.length
        } productos.`,
        image_url: publicImageUrl(catalog.id),
      },
    }
    : { error: "basket_not_found", status: 404 };
}

function eligibleLocations(
  rows: GroceryLocationRow[],
  postalCode: string,
  coverageRows: GroceryCoverageRow[] | null,
) {
  const coverage = coverageRows === null
    ? SERVICE_ZIPS
    : new Map<string, readonly string[]>(
      coverageRows.filter((row) => row.active).map((
        row,
      ) => [row.partner_location_id, [row.postal_code]]),
    );
  const priorities = coverageRows === null ? LOCATION_ORDER : new Map(
    coverageRows.map((row) => [row.partner_location_id, row.priority]),
  );
  return rows.filter((location) =>
    location.active && location.delivery_enabled && location.partner_active &&
    coverage.get(location.id)?.includes(postalCode) === true
  ).sort((left, right) =>
    (priorities.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (priorities.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

async function coverageRows(
  postalCode: string,
  dependencies: GroceryDependencies,
) {
  if (!dependencies.listDeliveryCoverage) {
    return { data: null as GroceryCoverageRow[] | null, error: null };
  }
  const result = await dependencies.listDeliveryCoverage(postalCode);
  if (result.error) return { data: null, error: result.error };
  return {
    data: result.unavailable ? null : result.data ?? [],
    error: null,
  };
}

function destinationCoordinates(locations: GroceryLocationRow[]) {
  const coordinates: RouteCoordinate[] = [];
  for (const location of locations) {
    const latitude = location.latitude;
    const longitude = location.longitude;
    if (
      typeof latitude !== "number" || !Number.isFinite(latitude) ||
      latitude < -90 || latitude > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) ||
      longitude < -180 || longitude > 180
    ) return null;
    coordinates.push({ latitude, longitude });
  }
  return coordinates;
}

export async function checkDeliveryZip(
  postalCodeInput: unknown,
  dependencies: GroceryDependencies,
) {
  const postalCode = normalizePostalCode(postalCodeInput);
  if (!postalCode) return { error: "invalid_postal_code", status: 400 };
  const result = await dependencies.listLocations();
  if (result.error) return { error: "location_lookup_failed", status: 500 };
  const coverage = await coverageRows(postalCode, dependencies);
  if (coverage.error) return { error: "coverage_lookup_failed", status: 500 };
  const locations = eligibleLocations(
    result.data ?? [],
    postalCode,
    coverage.data,
  ).map(
    (location) => ({
      partner_location_id: location.id,
      name: `${location.partner_name} — ${location.name}`,
      city: location.city,
      state: location.state,
      active: true,
    }),
  );
  return {
    status: 200,
    body: {
      success: true,
      postal_code: postalCode,
      delivery_available: locations.length > 0,
      supermarkets: locations,
    },
  };
}

function publicLocation(location: GroceryLocationRow) {
  return {
    partner_location_id: location.id,
    name: `${location.partner_name} — ${location.name}`,
    city: location.city,
    state: location.state,
  };
}

function miles(meters: number): number {
  return Math.round((meters / 1_609.344) * 100) / 100;
}

export async function findNearestSupermarket(
  body: Record<string, unknown>,
  dependencies: GroceryDependencies,
) {
  const postalCode = normalizePostalCode(body.postal_code);
  if (!postalCode) return { error: "invalid_postal_code", status: 400 };
  const deliveryAddress = text(body.delivery_address, 500);
  if (!deliveryAddress) {
    return { error: "missing_delivery_address", status: 400 };
  }

  const locationResult = await dependencies.listLocations();
  if (locationResult.error) {
    return { error: "service_unavailable", status: 503 };
  }
  const coverage = await coverageRows(postalCode, dependencies);
  if (coverage.error) return { error: "coverage_lookup_failed", status: 500 };
  const eligible = eligibleLocations(
    locationResult.data ?? [],
    postalCode,
    coverage.data,
  );
  if (!eligible.length) {
    return { error: "no_eligible_locations", status: 404 };
  }

  const geocoded = await dependencies.geocodeAddress(deliveryAddress);
  if (geocoded.error) {
    return { error: "distance_lookup_failed", status: 502 };
  }
  if (!geocoded.data) {
    return { error: "address_not_resolved", status: 422 };
  }

  const destinations = destinationCoordinates(eligible);
  if (!destinations) {
    return { error: "location_coordinates_invalid", status: 500 };
  }
  const matrix = await dependencies.computeDrivingRouteMatrix({
    origin: {
      latitude: geocoded.data.latitude,
      longitude: geocoded.data.longitude,
    },
    destinationCoordinates: destinations,
  });
  if (matrix.error || !matrix.data || matrix.data.length !== eligible.length) {
    return { error: "distance_lookup_failed", status: 502 };
  }
  const byDestination = new Map(
    matrix.data.map((route) => [route.destinationIndex, route]),
  );
  if (
    byDestination.size !== eligible.length ||
    eligible.some((_, index) => !byDestination.has(index))
  ) {
    return { error: "distance_lookup_failed", status: 502 };
  }

  const ranked = eligible.map((location, index) => {
    const route = byDestination.get(index)!;
    return {
      ...publicLocation(location),
      distance_miles: miles(route.distanceMeters),
      duration_minutes: Math.round(route.durationSeconds / 60),
      _distance_meters: route.distanceMeters,
      _duration_seconds: route.durationSeconds,
    };
  }).sort((left, right) =>
    left._distance_meters - right._distance_meters ||
    left._duration_seconds - right._duration_seconds ||
    left.partner_location_id.localeCompare(right.partner_location_id)
  );
  const rankedLocations = ranked.map(({
    _distance_meters: _distanceMeters,
    _duration_seconds: _durationSeconds,
    ...location
  }) => location);

  return {
    status: 200,
    body: {
      success: true,
      postal_code: postalCode,
      normalized_delivery_address: geocoded.data.formattedAddress,
      nearest_location: rankedLocations[0],
      ranked_locations: rankedLocations,
    },
  };
}

function groceryState(state: Record<string, unknown> | null) {
  const collected = state?.collected;
  if (!collected || typeof collected !== "object") return null;
  const grocery = (collected as Record<string, unknown>).referral_grocery;
  return grocery && typeof grocery === "object"
    ? grocery as GroceryIntake
    : null;
}

function mergeGroceryState(
  state: Record<string, unknown> | null,
  intake: GroceryIntake,
  sourceChannel: ReferralSourceChannel,
) {
  const collected = state?.collected && typeof state.collected === "object"
    ? state.collected as Record<string, unknown>
    : {};
  return {
    ...(state ?? {}),
    orgType: "referral_hub",
    channel: sourceChannel,
    collected: { ...collected, referral_grocery: intake },
  };
}

async function context(
  body: Record<string, unknown>,
  dependencies: GroceryDependencies,
) {
  const conversationId = text(body.conversation_id, 200);
  if (!conversationId) return { error: "missing_conversation_id" as const };
  const channelUserId = await voiceChannelUserId(conversationId);
  const sourceChannel = normalizeSourceChannel(body.source_channel);
  if (!sourceChannel) return { error: "invalid_source_channel" as const };
  const found = await dependencies.findVoiceLead(channelUserId, sourceChannel);
  if (
    found.error || found.data?.channel && found.data.channel !== sourceChannel
  ) {
    return { error: "lead_persistence_failed" as const };
  }
  return {
    conversationHash: channelUserId.slice(6),
    channelUserId,
    sourceChannel,
    lead: found.data,
  };
}

function missingFields(fields: Record<string, string>) {
  return REQUIRED_FIELDS.filter((field) => !fields[field]);
}

export async function saveBasketIntake(
  body: Record<string, unknown>,
  dependencies: GroceryDependencies,
) {
  const loaded = await context(body, dependencies);
  if ("error" in loaded) return { error: loaded.error, status: 400 };
  const supplied = body.fields && typeof body.fields === "object" &&
      !Array.isArray(body.fields)
    ? body.fields as Record<string, unknown>
    : {};
  for (const field of Object.keys(supplied)) {
    if (!ALLOWED_FIELDS.has(field)) {
      return { error: "invalid_field", status: 400 };
    }
  }
  const current = groceryState(loaded.lead?.state ?? null);
  const fields = { ...(current?.fields ?? {}) };
  for (const [field, value] of Object.entries(supplied)) {
    let normalized = text(value, field === "delivery_instructions" ? 500 : 300);
    if (field === "offer_id" || field === "partner_location_id") {
      normalized = uuid(value) ?? "";
    }
    if (field === "postal_code") normalized = normalizePostalCode(value) ?? "";
    if (field === "phone") {
      const phone = normalizeUsPhone(value);
      if (!phone) return { error: "invalid_phone", status: 400 };
      normalized = phone;
    }
    if (field === "state" && normalized) normalized = normalized.toUpperCase();
    if (!normalized && field !== "address_line_2") {
      return { error: "invalid_field", status: 400 };
    }
    fields[field] = normalized;
  }
  const intake: GroceryIntake = {
    conversation_id_hash: loaded.conversationHash,
    fields,
    ...(current?.order_code ? { order_code: current.order_code } : {}),
    ...(current?.submitted_at ? { submitted_at: current.submitted_at } : {}),
  };
  const saved = await dependencies.saveVoiceLead({
    organizationId: VOICE_SOURCE_ORGANIZATION_ID,
    sourceChannel: loaded.sourceChannel,
    channelUserId: loaded.channelUserId,
    serviceId: GROCERY_SERVICE_ID,
    state: mergeGroceryState(
      loaded.lead?.state ?? null,
      intake,
      loaded.sourceChannel,
    ),
    fullName: fields.customer_name || null,
    firstName: null,
    lastName: null,
    status: loaded.lead?.status ?? "contacted",
    handoffToHuman: false,
  });
  if (saved.error || !saved.data?.id) {
    return { error: "lead_persistence_failed", status: 500 };
  }
  const missing = missingFields(fields);
  return {
    status: 200,
    body: {
      success: true,
      lead_saved: true,
      complete: missing.length === 0,
      missing_required_fields: missing,
      next_field: missing[0]
        ? { id: missing[0], prompt: FIELD_PROMPTS[missing[0]] }
        : null,
    },
  };
}

function fullAddress(fields: Record<string, string>) {
  return [
    fields.address_line_1,
    fields.address_line_2,
    `${fields.city}, ${fields.state} ${fields.postal_code}`,
  ].filter(Boolean).join(", ");
}

export async function createBasketOrder(
  body: Record<string, unknown>,
  dependencies: GroceryDependencies,
) {
  if (body.confirmed !== true) {
    return { error: "confirmation_required", status: 400 };
  }
  const loaded = await context(body, dependencies);
  if ("error" in loaded || !loaded.lead?.id) {
    return { error: "lead_persistence_failed", status: 500 };
  }
  const intake = groceryState(loaded.lead.state);
  if (!intake) return { error: "missing_required_fields", status: 400 };
  const missing = missingFields(intake.fields);
  if (missing.length) {
    return {
      status: 400,
      body: {
        success: false,
        error: "missing_required_fields",
        missing_required_fields: missing,
        next_field: {
          id: missing[0],
          prompt: FIELD_PROMPTS[missing[0]],
        },
      },
    };
  }
  if (intake.order_code) {
    return {
      status: 200,
      body: {
        success: true,
        submitted: true,
        order_reference: intake.order_code,
        status: "submitted",
        idempotent_replay: true,
      },
    };
  }
  if (
    !uuid(intake.fields.offer_id) ||
    !uuid(intake.fields.partner_location_id)
  ) {
    return { error: "basket_not_available", status: 400 };
  }
  const [offerResult, locationResult] = await Promise.all([
    dependencies.getOffer(intake.fields.offer_id),
    dependencies.listLocations(),
  ]);
  if (offerResult.error || locationResult.error) {
    return { error: "order_validation_failed", status: 500 };
  }
  const coverage = await coverageRows(intake.fields.postal_code, dependencies);
  if (coverage.error) return { error: "coverage_lookup_failed", status: 500 };
  const locations = eligibleLocations(
    locationResult.data ?? [],
    intake.fields.postal_code,
    coverage.data,
  );
  const location = locations.find((row) =>
    row.id === intake.fields.partner_location_id
  );
  if (!location) return { error: "supermarket_not_eligible", status: 400 };
  const offer = offerResult.data;
  if (
    !offer?.active || offer.id !== intake.fields.offer_id ||
    !Number.isSafeInteger(offer.price_cents) || offer.price_cents < 0
  ) return { error: "basket_not_available", status: 400 };
  if (offer.partner_location_id !== intake.fields.partner_location_id) {
    return { error: "basket_location_mismatch", status: 400 };
  }
  if (!getPantryDemoPackage(offer.basket_key)) {
    return { error: "basket_not_available", status: 400 };
  }

  const address = fullAddress(intake.fields);
  const geocoded = await dependencies.geocodeAddress(address);
  if (geocoded.error) {
    return { error: "distance_lookup_failed", status: 502 };
  }
  if (!geocoded.data) {
    return { error: "address_not_resolved", status: 422 };
  }
  const destinations = destinationCoordinates([location]);
  if (!destinations) {
    return { error: "location_coordinates_invalid", status: 500 };
  }
  const routeResult = await dependencies.computeDrivingRouteMatrix({
    origin: {
      latitude: geocoded.data.latitude,
      longitude: geocoded.data.longitude,
    },
    destinationCoordinates: destinations,
  });
  const selectedRoute = routeResult.data?.find((route) =>
    route.destinationIndex === 0
  );
  if (
    routeResult.error || !selectedRoute || routeResult.data?.length !== 1
  ) {
    return { error: "distance_lookup_failed", status: 502 };
  }
  const notes = [
    intake.fields.delivery_instructions
      ? `Entrega: ${intake.fields.delivery_instructions}`
      : "",
    `Pago: ${intake.fields.payment_preference}`,
  ].filter(Boolean).join(" · ");
  const orderResult = await dependencies.createOrder({
    p_organization_id: VOICE_SOURCE_ORGANIZATION_ID,
    p_idempotency_key: `elevenlabs-grocery:${loaded.conversationHash}`,
    p_campaign_code: "elevenlabs_grocery_v1",
    p_source_channel: loaded.sourceChannel,
    p_partner_location_id: location.id,
    p_basket_offer_id: offer.id,
    p_customer_name: intake.fields.customer_name,
    p_customer_phone: intake.fields.phone,
    p_customer_email: null,
    p_delivery_address: address,
    p_delivery_city: intake.fields.city,
    p_delivery_state: intake.fields.state,
    p_delivery_postal_code: intake.fields.postal_code,
    p_delivery_country_code: "US",
    p_delivery_latitude: geocoded.data.latitude,
    p_delivery_longitude: geocoded.data.longitude,
    p_delivery_distance_miles: miles(selectedRoute.distanceMeters),
    p_delivery_duration_minutes: Math.round(
      selectedRoute.durationSeconds / 60,
    ),
    p_route_source: "google_routes",
    p_customer_notes: notes || null,
    p_consent_transactional: true,
    p_consent_marketing: false,
    p_consent_version: "elevenlabs_grocery_v1",
  });
  if (orderResult.error || !orderResult.data?.order_code) {
    return { error: "order_creation_failed", status: 500 };
  }
  const submittedAt = new Date().toISOString();
  const saved = await dependencies.saveVoiceLead({
    organizationId: VOICE_SOURCE_ORGANIZATION_ID,
    sourceChannel: loaded.sourceChannel,
    channelUserId: loaded.channelUserId,
    serviceId: GROCERY_SERVICE_ID,
    state: mergeGroceryState(loaded.lead.state, {
      ...intake,
      order_code: orderResult.data.order_code,
      submitted_at: submittedAt,
    }, loaded.sourceChannel),
    fullName: intake.fields.customer_name,
    firstName: null,
    lastName: null,
    status: "qualified",
    handoffToHuman: false,
  });
  if (saved.error) {
    return { error: "order_state_persistence_failed", status: 500 };
  }
  return {
    status: 200,
    body: {
      success: true,
      submitted: true,
      order_reference: orderResult.data.order_code,
      status: orderResult.data.status,
      basket_name: orderResult.data.basket_name,
      price: orderResult.data.basket_price_cents / 100,
      currency: orderResult.data.currency,
      delivery_address: orderResult.data.delivery_address,
      directions_url: `https://www.google.com/maps/dir/?api=1&destination=${
        encodeURIComponent(address)
      }`,
      idempotent_replay: orderResult.data.idempotent_replay,
      voice_confirmation:
        `Tu pedido ${orderResult.data.order_code} fue recibido correctamente.`,
    },
  };
}

export { getPantryDemoPackage };
