import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  checkDeliveryZip,
  createBasketOrder,
  findNearestSupermarket,
  getBasketDetails,
  type GroceryDependencies,
  type GroceryLocationRow,
  type GroceryOfferRow,
  listBasketOffers,
  normalizePostalCode,
  normalizeUsPhone,
  saveBasketIntake,
} from "./grocery.ts";
import type { VoiceLead, VoiceLeadInput } from "./workflow.ts";

const LOCATION_30345 = "8bad61aa-3010-6cac-4f62-fd7cf16f35e2";
const SECOND_LOCATION_30345 = "5af97871-bb3e-5faf-45c9-701cd8d9a635";
const THIRD_LOCATION_30345 = "7a000c5b-fd26-76f0-8bcd-08eecb72c769";

const items = {
  catalogVersion: "referral-demo-v1",
  products: [
    { name: "Arroz", quantity: "5 lb", category: "pantry" },
    { name: "Pollo", quantity: "3 lb", category: "protein" },
    { name: "Tomates", quantity: "4", category: "produce_home" },
  ],
};

function offer(
  key: "essential" | "family" | "complete",
  price: number,
  location = LOCATION_30345,
): GroceryOfferRow {
  const names = {
    essential: "Compra Esencial",
    family: "Compra Familiar",
    complete: "Compra Completa",
  };
  const keyNumber = { essential: 1, family: 2, complete: 3 }[key];
  const locationNumber = location === LOCATION_30345 ? 0 : 1;
  const suffix = String(locationNumber * 100 + keyNumber).padStart(12, "0");
  return {
    id: `${location.slice(0, 8)}-0000-4000-800${keyNumber}-${suffix}`,
    partner_location_id: location,
    basket_key: key,
    display_name: names[key],
    price_cents: price,
    currency: "USD",
    contents_snapshot: items,
    active: true,
  };
}

const offers = [
  offer("essential", 6900),
  offer("family", 16900),
  offer("complete", 34900),
  offer("essential", 7900, SECOND_LOCATION_30345),
  offer("family", 17900, SECOND_LOCATION_30345),
  offer("complete", 35900, SECOND_LOCATION_30345),
];

function location(
  id: string,
  postalCode: string,
  name: string,
  latitude = 33.8,
  longitude = -84.3,
): GroceryLocationRow {
  return {
    id,
    partner_id: `partner-${id}`,
    name,
    formatted_address: `${name}, Atlanta, GA`,
    city: "Atlanta",
    state: "GA",
    postal_code: postalCode,
    latitude,
    longitude,
    active: true,
    delivery_enabled: true,
    partner_name: "Mi Supermercado",
    partner_active: true,
  };
}

function fake() {
  const leads = new Map<string, VoiceLead>();
  const saved: VoiceLeadInput[] = [];
  const rpcCalls: Record<string, unknown>[] = [];
  const routeCalls: Array<{
    origin: { latitude: number; longitude: number };
    destinationCoordinates: Array<{ latitude: number; longitude: number }>;
  }> = [];
  let rpcCount = 0;
  const locations = [
    location(LOCATION_30345, "30000", "Sucursal Norte", 33.81, -84.31),
    location(SECOND_LOCATION_30345, "30329", "Sucursal Sur", 33.82, -84.32),
    location(THIRD_LOCATION_30345, "30071", "Sucursal Este", 33.83, -84.33),
    location(
      "85ea7272-0d41-2d09-b29c-cc5c3320669e",
      "30315",
      "Sucursal Centro",
      33.84,
      -84.34,
    ),
  ];
  const dependencies: GroceryDependencies = {
    listOffers: (partnerLocationId) =>
      Promise.resolve({
        data: offers.filter((row) =>
          row.partner_location_id === partnerLocationId
        ),
        error: null,
      }),
    getOffer: (offerId) =>
      Promise.resolve({
        data: offers.find((row) => row.id === offerId) ?? null,
        error: null,
      }),
    listLocations: () => Promise.resolve({ data: locations, error: null }),
    geocodeAddress: () =>
      Promise.resolve({
        data: {
          formattedAddress: "123 Main St, Atlanta, GA 30345, USA",
          latitude: 33.85,
          longitude: -84.29,
        },
        error: null,
      }),
    computeDrivingRouteMatrix: (input) => {
      routeCalls.push(input);
      const distances = [3218.688, 1609.344, 4828.032];
      const durations = [480, 300, 720];
      return Promise.resolve({
        data: input.destinationCoordinates.map((_, destinationIndex) => ({
          destinationIndex,
          distanceMeters: distances[destinationIndex],
          durationSeconds: durations[destinationIndex],
        })),
        error: null,
      });
    },
    findVoiceLead: (channelUserId, sourceChannel) =>
      Promise.resolve({
        data: leads.get(`${sourceChannel}:${channelUserId}`) ?? null,
        error: null,
      }),
    saveVoiceLead: (input) => {
      saved.push(input);
      const key = `${input.sourceChannel}:${input.channelUserId}`;
      const lead: VoiceLead = {
        id: leads.get(key)?.id ?? crypto.randomUUID(),
        state: input.state,
        channel: input.sourceChannel,
        channel_user_id: input.channelUserId,
        service_id: input.serviceId,
        status: input.status,
        handoff_to_human: input.handoffToHuman,
      };
      leads.set(key, lead);
      return Promise.resolve({ data: lead, error: null });
    },
    createOrder: (args) => {
      rpcCount += 1;
      rpcCalls.push(args);
      return Promise.resolve({
        data: {
          order_code: "RH-ATL-ABCDE",
          status: "submitted",
          basket_name: "Compra Esencial",
          basket_price_cents: 6900,
          delivery_fee_cents: 500,
          total_cents: 7400,
          currency: "USD",
          delivery_address: String(args.p_delivery_address),
          idempotent_replay: false,
        },
        error: null,
      });
    },
  };
  return {
    dependencies,
    leads,
    locations,
    rpcCalls,
    routeCalls,
    saved,
    get rpcCount() {
      return rpcCount;
    },
  };
}

Deno.test("basket list exposes exact names, current prices, images and order", async () => {
  const result = await listBasketOffers(LOCATION_30345, fake().dependencies);
  assert("body" in result);
  const body = result.body!;
  assertEquals(
    body.offers.map((item) => item.offer_id),
    offers.slice(0, 3).map(
      (row) => row.id,
    ),
  );
  assertEquals(body.offers.map((item) => item.basket_key), [
    "essential",
    "family",
    "complete",
  ]);
  assertEquals(body.offers.map((item) => item.name), [
    "Compra Esencial",
    "Compra Familiar",
    "Compra Completa",
  ]);
  assertEquals(body.offers.map((item) => item.price), [69, 169, 349]);
  assertEquals(body.offers.map((item) => item.image_url), [
    "https://referral.creatyv.io/images/shop-essential.jpg",
    "https://referral.creatyv.io/images/shop-family.jpg",
    "https://referral.creatyv.io/images/shop-complete.jpg",
  ]);
});

Deno.test("basket list requires a location and preserves location prices", async () => {
  const state = fake();
  const missing = await listBasketOffers(undefined, state.dependencies);
  assertEquals(missing.error, "missing_partner_location_id");

  const invalid = await listBasketOffers("essential", state.dependencies);
  assertEquals(invalid.error, "invalid_partner_location_id");

  const result = await listBasketOffers(
    SECOND_LOCATION_30345,
    state.dependencies,
  );
  assert("body" in result);
  assertEquals(result.body!.offers.map((item) => item.price), [79, 179, 359]);
  assertEquals(
    result.body!.offers.map((item) => item.partner_location_id),
    [SECOND_LOCATION_30345, SECOND_LOCATION_30345, SECOND_LOCATION_30345],
  );
});

Deno.test("basket list rejects duplicate active keys within one location", async () => {
  const state = fake();
  const original = state.dependencies.listOffers;
  state.dependencies.listOffers = async (partnerLocationId) => {
    const result = await original(partnerLocationId);
    return {
      ...result,
      data: [...(result.data ?? []), offer("essential", 9999)],
    };
  };
  const result = await listBasketOffers(LOCATION_30345, state.dependencies);
  assertEquals(result.error, "basket_configuration_incomplete");
});

Deno.test("basket details return categorized canonical contents", async () => {
  const result = await getBasketDetails(
    offers[0].id,
    LOCATION_30345,
    fake().dependencies,
  );
  assert("body" in result);
  const body = result.body!;
  assertEquals(body.name, "Compra Esencial");
  assertEquals(body.price, 69);
  assertEquals(body.offer_id, offers[0].id);
  assertEquals(body.basket_key, "essential");
  assertEquals(body.categorized_contents.length, 3);
});

Deno.test("basket details reject an offer from another location", async () => {
  const result = await getBasketDetails(
    offers[0].id,
    SECOND_LOCATION_30345,
    fake().dependencies,
  );
  assertEquals(result.error, "basket_not_found");
});

Deno.test("basket details reject logical keys where a real offer UUID is required", async () => {
  const result = await getBasketDetails(
    "essential",
    LOCATION_30345,
    fake().dependencies,
  );
  assertEquals(result.error, "basket_not_found");
});

Deno.test("ZIP and ZIP+4 normalize and 30345 returns all eligible locations", async () => {
  assertEquals(normalizePostalCode("30345-1234"), "30345");
  assertEquals(normalizePostalCode("3034"), null);
  const result = await checkDeliveryZip("30345-1234", fake().dependencies);
  assert("body" in result);
  const body = result.body!;
  assertEquals(body.postal_code, "30345");
  assertEquals(
    body.supermarkets.map((item) => item.partner_location_id),
    [LOCATION_30345, SECOND_LOCATION_30345, THIRD_LOCATION_30345],
  );
});

Deno.test("nearest supermarket compares exactly three ZIP-eligible locations", async () => {
  const state = fake();
  const result = await findNearestSupermarket({
    postal_code: "30345-1234",
    delivery_address: "123 Main Street, Atlanta, GA 30345",
  }, state.dependencies);
  assert("body" in result);
  assertEquals(result.body!.postal_code, "30345");
  assertEquals(
    result.body!.normalized_delivery_address,
    "123 Main St, Atlanta, GA 30345, USA",
  );
  assertEquals(state.routeCalls.length, 1);
  assertEquals(state.routeCalls[0].destinationCoordinates.length, 3);
  assertEquals(
    result.body!.nearest_location.partner_location_id,
    SECOND_LOCATION_30345,
  );
  assertEquals(
    result.body!.ranked_locations.map((item) => item.partner_location_id),
    [SECOND_LOCATION_30345, LOCATION_30345, THIRD_LOCATION_30345],
  );
  assertEquals(result.body!.nearest_location.distance_miles, 1);
  assertEquals(result.body!.nearest_location.duration_minutes, 5);
  const serialized = JSON.stringify(result.body);
  assert(!serialized.includes("latitude"));
  assert(!serialized.includes("longitude"));
  assert(!serialized.toLowerCase().includes("api_key"));
});

Deno.test("nearest lookup excludes inactive and ZIP-ineligible locations", async () => {
  const state = fake();
  state.locations[2].active = false;
  const result = await findNearestSupermarket({
    postal_code: "30345",
    delivery_address: "123 Main Street, Atlanta, GA 30345",
  }, state.dependencies);
  assert("body" in result);
  assertEquals(state.routeCalls[0].destinationCoordinates, [
    {
      latitude: state.locations[0].latitude,
      longitude: state.locations[0].longitude,
    },
    {
      latitude: state.locations[1].latitude,
      longitude: state.locations[1].longitude,
    },
  ]);
  assertEquals(result.body!.ranked_locations.length, 2);
  assert(
    !state.routeCalls[0].destinationCoordinates.some((coordinate) =>
      coordinate.latitude === state.locations[3].latitude &&
      coordinate.longitude === state.locations[3].longitude
    ),
  );
});

Deno.test("nearest lookup geocodes only the customer and uses stored destinations", async () => {
  const state = fake();
  const geocoded: string[] = [];
  state.dependencies.geocodeAddress = (address) => {
    geocoded.push(address);
    return Promise.resolve({
      data: {
        formattedAddress: "123 Main St, Atlanta, GA 30345, USA",
        latitude: 33.85,
        longitude: -84.29,
      },
      error: null,
    });
  };
  const result = await findNearestSupermarket({
    postal_code: "30345",
    delivery_address: "123 Main Street, Atlanta, GA 30345",
  }, state.dependencies);
  assert("body" in result);
  assertEquals(geocoded, ["123 Main Street, Atlanta, GA 30345"]);
  assertEquals(
    state.routeCalls[0].destinationCoordinates,
    state.locations.slice(0, 3).map((item) => ({
      latitude: item.latitude!,
      longitude: item.longitude!,
    })),
  );
  assert(!JSON.stringify(result.body).includes("latitude"));
  assert(!JSON.stringify(result.body).includes("longitude"));
});

Deno.test("invalid persisted supermarket coordinates fail truthfully", async () => {
  const state = fake();
  state.locations[1].latitude = null;
  const result = await findNearestSupermarket({
    postal_code: "30345",
    delivery_address: "123 Main Street, Atlanta, GA 30345",
  }, state.dependencies);
  assertEquals(result.error, "location_coordinates_invalid");
  assertEquals(state.routeCalls.length, 0);
});

Deno.test("nearest ranking breaks ties by duration then location ID", async () => {
  const state = fake();
  state.dependencies.computeDrivingRouteMatrix = () =>
    Promise.resolve({
      data: [
        { destinationIndex: 0, distanceMeters: 1000, durationSeconds: 300 },
        { destinationIndex: 1, distanceMeters: 1000, durationSeconds: 240 },
        { destinationIndex: 2, distanceMeters: 1000, durationSeconds: 240 },
      ],
      error: null,
    });
  const result = await findNearestSupermarket({
    postal_code: "30345",
    delivery_address: "123 Main Street, Atlanta, GA 30345",
  }, state.dependencies);
  assert("body" in result);
  assertEquals(
    result.body!.ranked_locations.map((item) => item.partner_location_id),
    [SECOND_LOCATION_30345, THIRD_LOCATION_30345, LOCATION_30345],
  );
});

Deno.test("unresolved address and provider failure never select a location", async () => {
  const unresolved = fake();
  unresolved.dependencies.geocodeAddress = () =>
    Promise.resolve({ data: null, error: null });
  const unresolvedResult = await findNearestSupermarket({
    postal_code: "30345",
    delivery_address: "unknown address",
  }, unresolved.dependencies);
  assertEquals(unresolvedResult.error, "address_not_resolved");
  assertEquals(unresolved.routeCalls.length, 0);
  assert(!JSON.stringify(unresolvedResult).includes("nearest_location"));

  const failed = fake();
  failed.dependencies.computeDrivingRouteMatrix = () =>
    Promise.resolve({ data: null, error: "provider_raw_secret_payload" });
  const failedResult = await findNearestSupermarket({
    postal_code: "30345",
    delivery_address: "123 Main Street, Atlanta, GA 30345",
  }, failed.dependencies);
  assertEquals(failedResult.error, "distance_lookup_failed");
  const serialized = JSON.stringify(failedResult);
  assert(!serialized.includes("provider_raw_secret_payload"));
  assert(!serialized.includes("distance_miles"));
});

Deno.test("coverage uses service ZIP policy rather than physical branch ZIP", async () => {
  const state = fake();
  state.locations.push(
    location("00000000-0000-4000-8000-000000000000", "30345", "No coverage"),
  );
  const result = await checkDeliveryZip("30000", state.dependencies);
  assert("body" in result);
  assertEquals(result.body!.delivery_available, false);
  const zip30345 = await checkDeliveryZip("30345", state.dependencies);
  assert("body" in zip30345);
  assert(
    !zip30345.body!.supermarkets.some((item) =>
      item.partner_location_id === "00000000-0000-4000-8000-000000000000"
    ),
  );
});

Deno.test("basket intake incrementally collects complete address and preserves voice identity", async () => {
  const state = fake();
  const first = await saveBasketIntake({
    conversation_id: "grocery-conversation",
    fields: { offer_id: offers[0].id, postal_code: "30345-1234" },
  }, state.dependencies);
  assert("body" in first);
  assertEquals(first.body!.next_field?.id, "partner_location_id");
  const second = await saveBasketIntake({
    conversation_id: "grocery-conversation",
    fields: {
      partner_location_id: LOCATION_30345,
      customer_name: "Ana López",
      phone: "(404) 555-1212",
      address_line_1: "123 Main Street",
      address_line_2: "Apt 4",
      city: "Atlanta",
      state: "ga",
      delivery_instructions: "Llamar al llegar",
      payment_preference: "Efectivo al recibir",
    },
  }, state.dependencies);
  assert("body" in second);
  assertEquals(second.body!.complete, true);
  assert(JSON.stringify(state.saved.at(-1)?.state).includes("+14045551212"));
  assert(
    state.saved.every((input) => input.channelUserId.startsWith("voice:")),
  );
});

Deno.test("US grocery phones normalize strictly", () => {
  assertEquals(normalizeUsPhone("(404) 555-1212"), "+14045551212");
  assertEquals(normalizeUsPhone("404-555-1212"), "+14045551212");
  assertEquals(normalizeUsPhone("+1 (404) 555-1212"), "+14045551212");
  assertEquals(normalizeUsPhone("14045551212"), "+14045551212");
  assertEquals(normalizeUsPhone("73483823824"), null);
  assertEquals(normalizeUsPhone("404CALLNOW1"), null);
  assertEquals(normalizeUsPhone("404555121"), null);
  assertEquals(normalizeUsPhone("140455512123"), null);
});

Deno.test("invalid phone does not overwrite valid persisted intake", async () => {
  const state = fake();
  const valid = await saveBasketIntake({
    conversation_id: "phone-preservation",
    fields: { phone: "404 555 1212" },
  }, state.dependencies);
  assert("body" in valid);
  const savedBefore = state.saved.length;
  const stateBefore = JSON.stringify(state.saved.at(-1)?.state);
  const invalid = await saveBasketIntake({
    conversation_id: "phone-preservation",
    fields: { phone: "73483823824" },
  }, state.dependencies);
  assertEquals(invalid.error, "invalid_phone");
  assertEquals(state.saved.length, savedBefore);
  assertEquals(JSON.stringify(state.saved.at(-1)?.state), stateBefore);
  assert(stateBefore.includes("+14045551212"));
});

Deno.test("order requires confirmation and reloads persisted intake", async () => {
  const state = fake();
  const no = await createBasketOrder({
    conversation_id: "order-conversation",
    confirmed: false,
  }, state.dependencies);
  assertEquals(no.error, "confirmation_required");
  const missing = await createBasketOrder({
    conversation_id: "order-conversation",
    confirmed: true,
  }, state.dependencies);
  assertEquals(missing.error, "lead_persistence_failed");
});

Deno.test("real order RPC receives current offer, full address, submitted source and no discount", async () => {
  const state = fake();
  const request = {
    conversation_id: "order-conversation",
    source_channel: "whatsapp",
    fields: {
      offer_id: offers[0].id,
      postal_code: "30345",
      partner_location_id: LOCATION_30345,
      customer_name: "Ana López",
      phone: "+14045551212",
      address_line_1: "123 Main Street",
      address_line_2: "Apt 4",
      city: "Atlanta",
      state: "GA",
      delivery_instructions: "Llamar al llegar",
      payment_preference: "Efectivo",
    },
  };
  await saveBasketIntake(request, state.dependencies);
  const result = await createBasketOrder({
    ...request,
    confirmed: true,
  }, state.dependencies);
  assert("body" in result);
  const body = result.body!;
  assertEquals(body.submitted, true);
  assertEquals(body.status, "submitted");
  assertEquals(body.order_reference, "RH-ATL-ABCDE");
  assertEquals(state.rpcCalls[0].p_basket_offer_id, offers[0].id);
  assertEquals(state.rpcCalls[0].p_source_channel, "whatsapp");
  assertEquals(state.rpcCalls[0].p_delivery_latitude, 33.85);
  assertEquals(state.rpcCalls[0].p_delivery_longitude, -84.29);
  assertEquals(state.rpcCalls[0].p_delivery_distance_miles, 2);
  assertEquals(state.rpcCalls[0].p_delivery_duration_minutes, 8);
  assertEquals(state.rpcCalls[0].p_route_source, "google_routes");
  assert(state.saved.every((input) => input.sourceChannel === "whatsapp"));
  assert(state.saved.every((input) => input.state.channel === "whatsapp"));
  assertEquals(
    state.rpcCalls[0].p_delivery_address,
    "123 Main Street, Apt 4, Atlanta, GA 30345",
  );
  const serialized = JSON.stringify(state.rpcCalls[0]);
  assert(!serialized.includes("coupon"));
  assert(!serialized.includes("discount"));
  assert(!serialized.includes("price_cents"));
  assert(!serialized.includes("basket_key"));
  assertEquals(body.price, 69);
});

Deno.test("order is not created when its persisted address route cannot be verified", async () => {
  const state = fake();
  const request = {
    conversation_id: "route-failure-order",
    fields: {
      offer_id: offers[0].id,
      postal_code: "30345",
      partner_location_id: LOCATION_30345,
      customer_name: "Ana López",
      phone: "+14045551212",
      address_line_1: "123 Main Street",
      city: "Atlanta",
      state: "GA",
      payment_preference: "Efectivo",
    },
  };
  await saveBasketIntake(request, state.dependencies);
  state.dependencies.computeDrivingRouteMatrix = () =>
    Promise.resolve({ data: null, error: "provider failure" });
  const result = await createBasketOrder({
    ...request,
    confirmed: true,
  }, state.dependencies);
  assertEquals(result.error, "distance_lookup_failed");
  assertEquals(state.rpcCount, 0);
});

Deno.test("grocery channel records are isolated and invalid source cannot persist", async () => {
  const state = fake();
  const fields = { customer_name: "Ana López" };
  const voice = await saveBasketIntake({
    conversation_id: "shared-customer",
    fields,
  }, state.dependencies);
  const whatsapp = await saveBasketIntake({
    conversation_id: "shared-customer",
    source_channel: "whatsapp",
    fields: { customer_name: "Beatriz" },
  }, state.dependencies);
  assert("body" in voice);
  assert("body" in whatsapp);
  assertEquals(state.leads.size, 2);
  assertEquals(state.saved.map((input) => input.sourceChannel), [
    "voice",
    "whatsapp",
  ]);
  assertEquals(
    new Set(state.saved.map((input) => input.channelUserId)).size,
    1,
  );

  const invalid = await saveBasketIntake({
    conversation_id: "not-persisted",
    source_channel: "sms",
    fields,
  }, state.dependencies);
  assertEquals(invalid.error, "invalid_source_channel");
  assertEquals(state.saved.length, 2);
});

Deno.test("order rejects an ineligible supermarket and is idempotent after success", async () => {
  const ineligible = fake();
  await saveBasketIntake({
    conversation_id: "bad-location",
    fields: {
      offer_id: offers[0].id,
      postal_code: "30345",
      partner_location_id: "85ea7272-0d41-2d09-b29c-cc5c3320669e",
      customer_name: "Ana López",
      phone: "+14045551212",
      address_line_1: "123 Main Street",
      city: "Atlanta",
      state: "GA",
      payment_preference: "Efectivo",
    },
  }, ineligible.dependencies);
  const rejected = await createBasketOrder({
    conversation_id: "bad-location",
    confirmed: true,
  }, ineligible.dependencies);
  assertEquals(rejected.error, "supermarket_not_eligible");

  const valid = fake();
  const intake = {
    conversation_id: "repeat-order",
    fields: {
      offer_id: offers[0].id,
      postal_code: "30345",
      partner_location_id: LOCATION_30345,
      customer_name: "Ana López",
      phone: "+14045551212",
      address_line_1: "123 Main Street",
      city: "Atlanta",
      state: "GA",
      payment_preference: "Efectivo",
    },
  };
  await saveBasketIntake(intake, valid.dependencies);
  await createBasketOrder({ ...intake, confirmed: true }, valid.dependencies);
  const replay = await createBasketOrder({
    ...intake,
    confirmed: true,
  }, valid.dependencies);
  assert("body" in replay);
  assertEquals(replay.body!.idempotent_replay, true);
  assertEquals(valid.rpcCount, 1);
});

Deno.test("order rejects an active offer from a different valid location", async () => {
  const state = fake();
  const intake = {
    conversation_id: "mismatched-offer-location",
    fields: {
      offer_id: offers[0].id,
      postal_code: "30345",
      partner_location_id: SECOND_LOCATION_30345,
      customer_name: "Ana López",
      phone: "+14045551212",
      address_line_1: "123 Main Street",
      city: "Atlanta",
      state: "GA",
      payment_preference: "Efectivo",
    },
  };
  await saveBasketIntake(intake, state.dependencies);
  const result = await createBasketOrder({
    ...intake,
    confirmed: true,
  }, state.dependencies);
  assertEquals(result.error, "basket_location_mismatch");
  assertEquals(state.rpcCount, 0);
});
