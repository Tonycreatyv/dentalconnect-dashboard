import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  createBasketOrder,
  type GroceryDependencies,
  saveBasketIntake,
} from "./grocery.ts";

const localUrl = Deno.env.get("LOCAL_SUPABASE_URL");
const serviceKey = Deno.env.get("LOCAL_SUPABASE_SERVICE_ROLE_KEY");
const anonKey = Deno.env.get("LOCAL_SUPABASE_ANON_KEY");

if (!localUrl || !serviceKey || !anonKey) {
  Deno.test.ignore(
    "local production-equivalent grocery order integration",
    () => {},
  );
} else {
  Deno.test("local production-equivalent grocery order integration", async () => {
    const admin = createClient(localUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const organizationId = "luis-gabriel-referral-hub";
    const partnerId = "11111111-1111-4111-8111-111111111111";
    const locationId = "22222222-2222-4222-8222-222222222222";
    const secondLocationId = "33333333-3333-4333-8333-333333333333";
    const offerId = "44444444-4444-4444-8444-444444444444";
    const mismatchedOfferId = "55555555-5555-4555-8555-555555555555";
    const email = `owner-${crypto.randomUUID()}@local.test`;
    const password = `Local-${crypto.randomUUID()}!`;

    await admin.from("organizations").delete().eq("id", organizationId);
    assertEquals(
      (await admin.from("organizations").insert({
        id: organizationId,
        name: "LG local fixture",
      })).error,
      null,
    );
    const createdUser = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert(createdUser.data.user?.id);
    assertEquals(
      (await admin.from("org_members").insert({
        organization_id: organizationId,
        user_id: createdUser.data.user.id,
        role: "owner",
      })).error,
      null,
    );
    assertEquals(
      (await admin.from("referral_partners").insert({
        id: partnerId,
        organization_id: organizationId,
        name: "Supermercado local",
        slug: "supermercado-local",
        partnership_status: "demo_reference",
        active: true,
      })).error,
      null,
    );
    assertEquals(
      (await admin.from("referral_partner_locations").insert([{
        id: locationId,
        organization_id: organizationId,
        partner_id: partnerId,
        name: "Sucursal principal",
        formatted_address: "100 Local Way, Atlanta, GA 30345",
        city: "Atlanta",
        state: "GA",
        postal_code: "30345",
        latitude: 33.81,
        longitude: -84.31,
        delivery_enabled: true,
        minimum_order_cents: 5000,
        active: true,
      }, {
        id: secondLocationId,
        organization_id: organizationId,
        partner_id: partnerId,
        name: "Sucursal secundaria",
        formatted_address: "200 Local Way, Atlanta, GA 30329",
        city: "Atlanta",
        state: "GA",
        postal_code: "30329",
        latitude: 33.82,
        longitude: -84.32,
        delivery_enabled: true,
        minimum_order_cents: 5000,
        active: true,
      }])).error,
      null,
    );
    const contents = {
      catalogVersion: "local-production-shape-v1",
      products: [{ name: "Arroz", quantity: "5 lb", category: "pantry" }],
    };
    assertEquals(
      (await admin.from("referral_basket_offers").insert([{
        id: offerId,
        organization_id: organizationId,
        partner_location_id: locationId,
        basket_key: "essential",
        display_name: "Compra Esencial",
        price_cents: 6900,
        currency: "USD",
        contents_snapshot: contents,
        active: true,
      }, {
        id: mismatchedOfferId,
        organization_id: organizationId,
        partner_location_id: secondLocationId,
        basket_key: "essential",
        display_name: "Compra Esencial secundaria",
        price_cents: 7900,
        currency: "USD",
        contents_snapshot: contents,
        active: true,
      }])).error,
      null,
    );
    assertEquals(
      (await admin.from("referral_delivery_fee_bands").insert({
        organization_id: organizationId,
        partner_location_id: locationId,
        min_distance_miles: 0,
        max_distance_miles: 3,
        fee_cents: 499,
        active: true,
      })).error,
      null,
    );

    const dependencies: GroceryDependencies = {
      listOffers: async (partnerLocationId) => {
        const result = await admin.from("referral_basket_offers").select("*")
          .eq("organization_id", organizationId)
          .eq("partner_location_id", partnerLocationId).eq("active", true);
        return { data: result.data, error: result.error };
      },
      getOffer: async (id) => {
        const result = await admin.from("referral_basket_offers").select("*")
          .eq("organization_id", organizationId).eq("id", id).maybeSingle();
        return { data: result.data, error: result.error };
      },
      listLocations: async () => {
        const result = await admin.from("referral_partner_locations").select(
          "*",
        )
          .eq("organization_id", organizationId);
        return {
          data: (result.data ?? []).map((row) => ({
            ...row,
            partner_name: "Supermercado local",
            partner_active: true,
          })),
          error: result.error,
        };
      },
      listDeliveryCoverage: () =>
        Promise.resolve({
          data: [{
            partner_location_id: locationId,
            postal_code: "30345",
            active: true,
            priority: 10,
          }],
          error: null,
        }),
      geocodeAddress: () =>
        Promise.resolve({
          data: {
            formattedAddress: "123 Test St, Atlanta, GA 30345",
            latitude: 33.85,
            longitude: -84.29,
          },
          error: null,
        }),
      computeDrivingRouteMatrix: () =>
        Promise.resolve({
          data: [{
            destinationIndex: 0,
            distanceMeters: 3218.688,
            durationSeconds: 480,
          }],
          error: null,
        }),
      findVoiceLead: async (channelUserId, sourceChannel) => {
        const result = await admin.from("leads").select("*")
          .eq("organization_id", organizationId).eq("channel", sourceChannel)
          .eq("channel_user_id", channelUserId).maybeSingle();
        return { data: result.data, error: result.error };
      },
      saveVoiceLead: async (input) => {
        const result = await admin.from("leads").upsert({
          organization_id: input.organizationId,
          channel: input.sourceChannel,
          last_channel: input.sourceChannel,
          channel_user_id: input.channelUserId,
          service_id: input.serviceId,
          state: input.state,
          full_name: input.fullName,
          first_name: input.firstName,
          last_name: input.lastName,
          handoff_to_human: input.handoffToHuman ?? false,
          status: input.status ?? "contacted",
        }, { onConflict: "organization_id,channel,channel_user_id" }).select(
          "*",
        ).single();
        return { data: result.data, error: result.error };
      },
      createOrder: async (args) => {
        const result = await admin.rpc("create_referral_order", args);
        return {
          data: Array.isArray(result.data)
            ? result.data[0] ?? null
            : result.data,
          error: result.error,
        };
      },
    };

    const intake = {
      conversation_id: `local-order-${crypto.randomUUID()}`,
      source_channel: "whatsapp",
      fields: {
        offer_id: offerId,
        postal_code: "30345",
        partner_location_id: locationId,
        customer_name: "Cliente local",
        phone: "+14045550123",
        address_line_1: "123 Test Street",
        city: "Atlanta",
        state: "GA",
        payment_preference: "Coordinar al recibir",
      },
    };
    const saved = await saveBasketIntake(intake, dependencies);
    assert("body" in saved);
    assertEquals(saved.body?.complete, true);
    const created = await createBasketOrder(
      { ...intake, confirmed: true },
      dependencies,
    );
    assert("body" in created, JSON.stringify(created));
    assertEquals(created.body?.price, 69);
    const replay = await createBasketOrder(
      { ...intake, confirmed: true },
      dependencies,
    );
    assert("body" in replay);
    assertEquals(replay.body?.order_reference, created.body?.order_reference);
    assertEquals(replay.body?.idempotent_replay, true);

    const order = await admin.from("referral_orders").select("*").single();
    assertEquals(order.data?.basket_offer_id, offerId);
    assertEquals(order.data?.basket_price_cents, 6900);
    assertEquals(order.data?.basket_contents_snapshot, contents);
    assertEquals(order.data?.delivery_fee_cents, 499);
    assertEquals(order.data?.total_cents, 7399);
    assertEquals(
      (await admin.from("referral_order_items").select("id")).data?.length,
      1,
    );
    assertEquals(
      (await admin.from("referral_order_status_events").select("id")).data
        ?.length,
      1,
    );

    const rpcArgs = {
      p_organization_id: organizationId,
      p_idempotency_key: `direct-${crypto.randomUUID()}`,
      p_campaign_code: "local-test",
      p_source_channel: "whatsapp",
      p_partner_location_id: locationId,
      p_basket_offer_id: offerId,
      p_customer_name: "Cliente local",
      p_customer_phone: "+14045550123",
      p_customer_email: null,
      p_delivery_address: "123 Test Street",
      p_delivery_city: "Atlanta",
      p_delivery_state: "GA",
      p_delivery_postal_code: "30345",
      p_delivery_country_code: "US",
      p_delivery_latitude: 33.85,
      p_delivery_longitude: -84.29,
      p_delivery_distance_miles: 2,
      p_delivery_duration_minutes: 8,
      p_route_source: "google_routes",
      p_customer_notes: null,
      p_consent_transactional: true,
      p_consent_marketing: false,
      p_consent_version: "local-v1",
    };
    const direct = await admin.rpc("create_referral_order", rpcArgs);
    assertEquals(direct.error, null);
    const directOrder = direct.data[0];
    const directReplay = await admin.rpc("create_referral_order", rpcArgs);
    assertEquals(directReplay.data[0].id, directOrder.id);
    assertEquals(directReplay.data[0].idempotent_replay, true);

    const mismatch = await admin.rpc("create_referral_order", {
      ...rpcArgs,
      p_idempotency_key: `mismatch-${crypto.randomUUID()}`,
      p_basket_offer_id: mismatchedOfferId,
    });
    assertEquals(mismatch.error?.message, "INVALID_BASKET_OFFER");
    const outside = await admin.rpc("create_referral_order", {
      ...rpcArgs,
      p_idempotency_key: `outside-${crypto.randomUUID()}`,
      p_delivery_distance_miles: 12.5,
    });
    assertEquals(outside.error?.message, "DELIVERY_UNAVAILABLE");

    const owner = createClient(localUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    assertEquals(
      (await owner.auth.signInWithPassword({ email, password })).error,
      null,
    );
    for (
      const status of [
        "confirmed",
        "preparing",
        "ready",
        "out_for_delivery",
        "delivered",
      ]
    ) {
      const transition = await owner.rpc("update_referral_order_status", {
        p_organization_id: organizationId,
        p_order_id: directOrder.id,
        p_to_status: status,
        p_note: "local integration",
      });
      assertEquals(transition.error, null);
      assertEquals(transition.data[0].status, status);
    }
    const terminal = await owner.rpc("update_referral_order_status", {
      p_organization_id: organizationId,
      p_order_id: directOrder.id,
      p_to_status: "cancelled",
      p_note: null,
    });
    assertEquals(terminal.error?.message, "INVALID_STATUS_TRANSITION");

    const cancellable = await admin.rpc("create_referral_order", {
      ...rpcArgs,
      p_idempotency_key: `cancel-${crypto.randomUUID()}`,
    });
    const cancelled = await owner.rpc("update_referral_order_status", {
      p_organization_id: organizationId,
      p_order_id: cancellable.data[0].id,
      p_to_status: "cancelled",
      p_note: "customer request",
    });
    assertEquals(cancelled.error, null);
    assertEquals(cancelled.data[0].status, "cancelled");

    await admin.from("referral_partner_locations").update({ active: false }).eq(
      "id",
      locationId,
    );
    const inactive = await admin.rpc("create_referral_order", {
      ...rpcArgs,
      p_idempotency_key: `inactive-${crypto.randomUUID()}`,
    });
    assertEquals(inactive.error?.message, "INVALID_PARTNER_LOCATION");
  });
}
