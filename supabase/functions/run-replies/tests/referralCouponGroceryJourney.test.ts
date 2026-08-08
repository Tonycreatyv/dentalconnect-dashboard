import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  handleReferralHubTurn,
} from "../domain/referralHub/genericMenuRouter.ts";

Deno.env.set("REFERRAL_HUB_ASSET_BASE_URL", "https://referral.creatyv.io");

const organizationId = "luis-gabriel-referral-hub";
const profileState = {
  collected: {
    referral_hub: {
      profile_name: "Luis Gabriel",
      profile_city: "Atlanta",
      profile_complete: true,
    },
  },
};
const locationId = "11111111-1111-4111-8111-111111111111";
const offerId = "22222222-2222-4222-8222-222222222222";

function referralState(result: { statePatch: Record<string, unknown> }) {
  return ((result.statePatch.collected as Record<string, unknown>)?.referral_hub ?? {}) as Record<string, unknown>;
}

function couponDatabase(args?: { error?: { message: string } | null }) {
  return {
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
    rpc: () => Promise.resolve({
      data: args?.error
        ? null
        : {
          coupon_id: "coupon-id",
          code: "RH-LG-12345",
          public_token: "public-token",
          coupon_status: "active",
          issued_at: "2026-08-08T12:00:00Z",
          expires_at: null,
          was_created: true,
        },
      error: args?.error ?? null,
    }),
  };
}

function groceryDatabase() {
  const rows = (table: string, single: boolean) => {
    if (table === "referral_grocery_delivery_coverage") return { data: [{ partner_location_id: locationId, priority: 1 }], error: null };
    if (table === "referral_partner_locations") return single
      ? { data: { id: locationId, active: true, delivery_enabled: true }, error: null }
      : { data: [{ id: locationId, name: "Sucursal Centro" }], error: null };
    if (table === "referral_basket_offers") return single
      ? { data: { id: offerId, display_name: "Canasta Esencial", partner_location_id: locationId, active: true }, error: null }
      : { data: [{ id: offerId, display_name: "Canasta Esencial", price_cents: 6900, currency: "USD" }], error: null };
    return { data: null, error: null };
  };
  const from = (table: string) => {
    let single = false;
    const query: Record<string, unknown> & PromiseLike<unknown> = {
      then(resolve, reject) {
        return Promise.resolve(rows(table, single)).then(resolve, reject);
      },
    };
    for (const method of ["select", "eq", "in", "order"]) query[method] = () => query;
    query.maybeSingle = () => {
      single = true;
      return query;
    };
    return query;
  };
  return { from, rpc: () => Promise.resolve({ data: null, error: null }) };
}

Deno.test("grocery entry offers a coupon or prepared baskets without profile intake", async () => {
  const result = await handleReferralHubTurn({
    organizationId,
    leadState: null,
    inboundText: "",
    payloadAction: "referral_service:luis_compra_super",
    channel: "whatsapp",
  });

  assertStringIncludes(result.reply, "Llegaste al lugar correcto");
  assertEquals(result.interactiveButtons, [
    { id: "referral_grocery:coupon", title: "Quiero mi cupón" },
    { id: "referral_grocery:baskets", title: "Ver las canastas" },
  ]);
  assertEquals(result.debugNote, "referral_hub:grocery_entry");
});

Deno.test("supermarket coupon is prepared before its prepared-basket upsell", async () => {
  const result = await handleReferralHubTurn({
    supabase: couponDatabase() as any,
    organizationId,
    leadId: "lead-id",
    leadState: profileState,
    inboundText: "",
    payloadAction: "referral_grocery:coupon",
    channel: "whatsapp",
  });

  assertEquals(result.outboundMessages?.map((message) => message.type), ["text", "image"]);
  assertStringIncludes(result.reply, "Código: RH-LG-12345");
  assert(result.reply.indexOf("Código: RH-LG-12345") < result.reply.indexOf("Ya que vas a comprar"));
  assertEquals(result.interactiveButtons, [
    { id: "referral_grocery:baskets", title: "Sí, ver las canastas" },
    { id: "referral_grocery:coupon_only", title: "No, ya tengo mi cupón" },
  ]);
});

Deno.test("coupon failure does not expose the prepared-basket upsell", async () => {
  const result = await handleReferralHubTurn({
    supabase: couponDatabase({ error: { message: "coupon campaign not found" } }) as any,
    organizationId,
    leadId: "lead-id",
    leadState: profileState,
    inboundText: "",
    payloadAction: "referral_grocery:coupon",
    channel: "whatsapp",
  });

  assertStringIncludes(result.reply, "No pudimos preparar");
  assertEquals(result.outboundMessages, undefined);
  assertEquals(result.interactiveButtons, undefined);
  assertEquals(referralState(result).coupon_delivery_error, "coupon_campaign_missing");
});

Deno.test("coupon and direct basket actions initialize the durable grocery state", async () => {
  const coupon = await handleReferralHubTurn({
    supabase: couponDatabase() as any,
    organizationId,
    leadId: "lead-id",
    leadState: profileState,
    inboundText: "",
    payloadAction: "referral_grocery:coupon",
    channel: "whatsapp",
  });
  const afterCoupon = await handleReferralHubTurn({
    organizationId,
    leadState: coupon.statePatch,
    inboundText: "",
    payloadAction: "referral_grocery:baskets",
    channel: "whatsapp",
  });
  const direct = await handleReferralHubTurn({
    organizationId,
    leadState: profileState,
    inboundText: "",
    payloadAction: "referral_grocery:baskets",
    channel: "whatsapp",
  });

  for (const result of [afterCoupon, direct]) {
    const state = referralState(result);
    assertEquals(result.debugNote, "referral_hub:grocery_zip");
    assertStringIncludes(result.reply, "canastas ya vienen preparadas");
    assertEquals((state.grocery as Record<string, unknown>).step, "zip");
    assertEquals((state.grocery as Record<string, unknown>).customerName, "Luis Gabriel");
    assertEquals(state.pantry_demo, undefined);
  }
});

Deno.test("the production router continues durable grocery before generic profile intake", async () => {
  const started = await handleReferralHubTurn({
    organizationId,
    leadState: null,
    inboundText: "",
    payloadAction: "referral_grocery:baskets",
    channel: "whatsapp",
  });
  const zip = await handleReferralHubTurn({
    supabase: groceryDatabase() as any,
    organizationId,
    leadId: "lead-id",
    channelUserId: "+14045551212",
    leadState: started.statePatch,
    inboundText: "30345",
    channel: "whatsapp",
  });

  assertEquals(zip.debugNote, "referral_hub:grocery_offers");
  assertEquals(zip.interactiveList?.sections[0].rows[0].id, `grocery_offer:${offerId}`);
  assertEquals((referralState(zip).grocery as Record<string, unknown>).step, "offer");
  assert(!zip.reply.includes("nombre completo"));
});
