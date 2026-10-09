import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { continueWhatsAppGrocery, startWhatsAppGrocery } from "../domain/referralHub/whatsappGrocery.ts";

const locationId = "11111111-1111-4111-8111-111111111111";
const offerId = "22222222-2222-4222-8222-222222222222";

function database(covered = true) {
  const rpcCalls: Record<string, unknown>[] = [];
  const rows = (table: string, single: boolean) => {
    if (table === "referral_grocery_delivery_coverage") return single ? { data: covered ? { id: "coverage" } : null, error: null } : { data: covered ? [{ partner_location_id: locationId, priority: 1 }] : [], error: null };
    if (table === "referral_partner_locations") return single ? { data: { id: locationId, latitude: 33.8, longitude: -84.3, active: true, delivery_enabled: true }, error: null } : { data: [{ id: locationId, name: "Sucursal Centro" }], error: null };
    if (table === "referral_basket_offers") return single ? { data: { id: offerId, display_name: "Compra Esencial", partner_location_id: locationId, active: true }, error: null } : { data: [{ id: offerId, display_name: "Compra Esencial", price_cents: 6900, currency: "USD" }], error: null };
    return { data: null, error: null };
  };
  const from = (table: string) => {
    let single = false;
    const query: Record<string, unknown> & PromiseLike<unknown> = { then(resolve, reject) { return Promise.resolve(rows(table, single)).then(resolve, reject); } };
    for (const method of ["select", "eq", "in", "order"]) query[method] = () => query;
    query.maybeSingle = () => { single = true; return query; };
    return query;
  };
  return { client: { from, rpc: (_name: string, args: Record<string, unknown>) => { rpcCalls.push(args); return Promise.resolve({ data: { order_code: "RH-REAL-001", status: "submitted", total_cents: 7400, currency: "USD" }, error: null }); } }, rpcCalls };
}

async function reachConfirmation(client: any) {
  let turn = startWhatsAppGrocery();
  turn = await continueWhatsAppGrocery({ supabase: client, state: turn.grocery, inboundText: "30345", leadId: "lead", channelUserId: "+14045551212" });
  assertEquals(turn.interactiveList?.sections[0].rows[0].id, `grocery_offer:${offerId}`);
  turn = await continueWhatsAppGrocery({ supabase: client, state: turn.grocery, inboundText: "Compra Esencial", payloadAction: `grocery_offer:${offerId}`, leadId: "lead", channelUserId: "+14045551212" });
  for (const value of ["Luis Gabriel", "123 Main St", "Atlanta", "GA"]) turn = await continueWhatsAppGrocery({ supabase: client, state: turn.grocery, inboundText: value, leadId: "lead", channelUserId: "+14045551212" });
  turn = await continueWhatsAppGrocery({ supabase: client, state: turn.grocery, inboundText: "Efectivo", payloadAction: "grocery_payment:cash", leadId: "lead", channelUserId: "+14045551212" });
  return await continueWhatsAppGrocery({ supabase: client, state: turn.grocery, inboundText: "Ninguna", leadId: "lead", channelUserId: "+14045551212" });
}

Deno.test("WhatsApp grocery queries real coverage and requires canonical offer UUID", async () => {
  const db = database(); const turn = await reachConfirmation(db.client);
  assertEquals(turn.grocery.locationId, locationId); assertEquals(turn.grocery.offerId, offerId); assertEquals(db.rpcCalls.length, 0);
  const invalid = await continueWhatsAppGrocery({ supabase: db.client as any, state: { ...startWhatsAppGrocery().grocery, step: "offer", locationId }, inboundText: "essential", payloadAction: "grocery_offer:essential", leadId: "lead", channelUserId: "+14045551212" });
  assertStringIncludes(invalid.reply, "lista");
});

Deno.test("uncovered ZIP creates no order", async () => {
  const db = database(false); const result = await continueWhatsAppGrocery({ supabase: db.client as any, state: startWhatsAppGrocery().grocery, inboundText: "99999", leadId: "lead", channelUserId: "+14045551212" });
  assertStringIncludes(result.reply, "no tenemos delivery"); assertEquals(db.rpcCalls.length, 0);
});

Deno.test("confirmation revalidates and RPC calculates canonical price and total", async () => {
  const db = database(); const confirmation = await reachConfirmation(db.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => String(input).includes("geocode") ? Promise.resolve(new Response(JSON.stringify({ results: [{ formattedAddress: "123 Main St, Atlanta, GA 30345", location: { latitude: 33.81, longitude: -84.31 } }] }), { status: 200 })) : Promise.resolve(new Response(JSON.stringify([{ destinationIndex: 0, condition: "ROUTE_EXISTS", distanceMeters: 1609.344, duration: "300s" }]), { status: 200 }))) as typeof fetch;
  Deno.env.set("GOOGLE_MAPS_PLATFORM_API_KEY", "test-key");
  try {
    const result = await continueWhatsAppGrocery({ supabase: db.client as any, state: confirmation.grocery, inboundText: "Confirmar", payloadAction: "grocery_confirm:yes", leadId: "lead", channelUserId: "+14045551212" });
    assertStringIncludes(result.reply, "RH-REAL-001"); assertEquals(db.rpcCalls.length, 1);
    const args = db.rpcCalls[0]; assertEquals(args.p_partner_location_id, locationId); assertEquals(args.p_basket_offer_id, offerId); assertEquals("price_cents" in args, false); assertEquals("total_cents" in args, false);
    const replay = await continueWhatsAppGrocery({ supabase: db.client as any, state: result.grocery, inboundText: "Confirmar", payloadAction: "grocery_confirm:yes", leadId: "lead", channelUserId: "+14045551212" });
    assertStringIncludes(replay.reply, "RH-REAL-001"); assertEquals(db.rpcCalls.length, 1);
  } finally { globalThis.fetch = originalFetch; Deno.env.delete("GOOGLE_MAPS_PLATFORM_API_KEY"); }
});

Deno.test("missing canonical Maps configuration never creates a grocery order", async () => {
  const db = database();
  const confirmation = await reachConfirmation(db.client);
  Deno.env.delete("GOOGLE_MAPS_PLATFORM_API_KEY");
  const result = await continueWhatsAppGrocery({ supabase: db.client as any, state: confirmation.grocery, inboundText: "Confirmar", payloadAction: "grocery_confirm:yes", leadId: "lead", channelUserId: "+14045551212" });
  assertEquals(result.debugNote, "referral_hub:grocery_maps_unavailable");
  assertStringIncludes(result.reply, "No se creó el pedido");
  assertEquals(db.rpcCalls.length, 0);
});
