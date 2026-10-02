import { createGoogleMapsClient } from "../../../referral-voice-tools/googleMaps.ts";

type Json = Record<string, unknown>;
type SupabaseLike = { from(table: string): any; rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type GroceryState = {
  step: "zip" | "offer" | "name" | "address" | "city" | "state" | "payment" | "instructions" | "confirm" | "complete";
  postalCode?: string; locationId?: string; locationName?: string; offerId?: string; offerName?: string; customerName?: string; address?: string; city?: string; state?: string; payment?: string; instructions?: string; sourceCampaign?: string; idempotencyKey: string; orderCode?: string;
};
export type GroceryTurn = { reply: string; grocery: GroceryState; interactiveList?: { body: string; buttonText: string; sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }> }; interactiveButtons?: Array<{ id: string; title: string }>; debugNote: string };

const ORGANIZATION_ID = "luis-gabriel-referral-hub";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: unknown, max = 500) => typeof value === "string" && value.trim().length <= max ? value.trim().replace(/\s+/g, " ") : "";
const money = (cents: unknown, currency = "USD") => new Intl.NumberFormat("es-US", { style: "currency", currency }).format(Number(cents) / 100);

export function startWhatsAppGrocery(args?: { customerName?: string | null; sourceCampaign?: string | null }): GroceryTurn {
  const customerName = clean(args?.customerName, 120);
  const sourceCampaign = clean(args?.sourceCampaign, 120);
  return {
    reply: "Estas canastas ya vienen preparadas para hacerlo rápido y sencillo. Son opciones fijas y no se personalizan; puedes ver qué incluye cada una y elegir la que mejor te convenga.\n\nPrimero, ¿cuál es el código postal de entrega?",
    grocery: {
      step: "zip",
      ...(customerName ? { customerName } : {}),
      ...(sourceCampaign ? { sourceCampaign } : {}),
      idempotencyKey: `whatsapp-grocery:${crypto.randomUUID()}`,
    },
    debugNote: "referral_hub:grocery_zip",
  };
}

function failure(state: GroceryState, reply: string, note: string): GroceryTurn { return { reply, grocery: state, debugNote: note }; }

export async function continueWhatsAppGrocery(args: { supabase: SupabaseLike; state: GroceryState; inboundText: string; payloadAction?: string | null; leadId: string; channelUserId: string }): Promise<GroceryTurn> {
  const { supabase, state } = args; const value = clean(args.inboundText); const action = clean(args.payloadAction);
  if (state.step === "complete") return failure(state, `Tu pedido ${state.orderCode ?? ""} ya fue recibido.`, "referral_hub:grocery_complete_replay");
  if (state.step === "zip") {
    const postalCode = value.match(/^(\d{5})(?:-\d{4})?$/)?.[1];
    if (!postalCode) return failure(state, "Escribe un ZIP válido de cinco dígitos.", "referral_hub:grocery_zip_retry");
    const coverage = await supabase.from("referral_grocery_delivery_coverage").select("partner_location_id,priority").eq("organization_id", ORGANIZATION_ID).eq("postal_code", postalCode).eq("active", true).order("priority", { ascending: true });
    if (coverage.error) return failure(state, "No pudimos verificar la cobertura en este momento.", "referral_hub:grocery_coverage_failed");
    const ids = (coverage.data ?? []).map((row: Json) => clean(row.partner_location_id)).filter(Boolean);
    if (!ids.length) return failure(state, "Todavía no tenemos delivery disponible en ese código postal.", "referral_hub:grocery_uncovered");
    const locations = await supabase.from("referral_partner_locations").select("id,name").eq("organization_id", ORGANIZATION_ID).eq("active", true).eq("delivery_enabled", true).in("id", ids);
    const byId = new Map((locations.data ?? []).map((row: Json) => [clean(row.id), row]));
    const location = ids.map((id: string) => byId.get(id)).find(Boolean) as Json | undefined;
    if (locations.error || !location) return failure(state, "No hay una sucursal activa disponible para ese código postal.", "referral_hub:grocery_location_unavailable");
    const locationId = clean(location.id); const offers = await supabase.from("referral_basket_offers").select("id,display_name,price_cents,currency").eq("organization_id", ORGANIZATION_ID).eq("partner_location_id", locationId).eq("active", true).order("price_cents", { ascending: true });
    if (offers.error || !(offers.data ?? []).length) return failure(state, "No hay canastas activas disponibles para esa sucursal.", "referral_hub:grocery_offers_unavailable");
    return { reply: "Elige la canasta ya preparada que mejor te convenga:", grocery: { ...state, step: "offer", postalCode, locationId, locationName: clean(location.name) }, interactiveList: { body: "Canastas preparadas con precio actual:", buttonText: "Ver canastas", sections: [{ title: clean(location.name, 24) || "Sucursal", rows: (offers.data ?? []).map((offer: Json) => ({ id: `grocery_offer:${clean(offer.id)}`, title: clean(offer.display_name, 24), description: money(offer.price_cents, clean(offer.currency) || "USD") })) }] }, debugNote: "referral_hub:grocery_offers" };
  }
  if (state.step === "offer") {
    const offerId = (action.match(/^grocery_offer:([0-9a-f-]+)$/i)?.[1] ?? "");
    if (!UUID.test(offerId) || !state.locationId) return failure(state, "Selecciona una compra de la lista.", "referral_hub:grocery_offer_retry");
    const offer = await supabase.from("referral_basket_offers").select("id,display_name,partner_location_id,active").eq("organization_id", ORGANIZATION_ID).eq("id", offerId).eq("partner_location_id", state.locationId).eq("active", true).maybeSingle();
    if (offer.error || !offer.data) return failure(state, "Esa compra ya no está disponible. Selecciona otra opción.", "referral_hub:grocery_offer_invalid");
    return state.customerName
      ? { reply: "¿Cuál es la dirección de entrega?", grocery: { ...state, step: "address", offerId, offerName: clean(offer.data.display_name) }, debugNote: "referral_hub:grocery_address" }
      : { reply: "¿Cuál es el nombre de la persona que recibirá el pedido?", grocery: { ...state, step: "name", offerId, offerName: clean(offer.data.display_name) }, debugNote: "referral_hub:grocery_name" };
  }
  if (state.step === "name") return value.length < 2 ? failure(state, "Escribe un nombre válido.", "referral_hub:grocery_name_retry") : { reply: "¿Cuál es la dirección de entrega?", grocery: { ...state, step: "address", customerName: value }, debugNote: "referral_hub:grocery_address" };
  if (state.step === "address") return value.length < 5 ? failure(state, "Escribe una dirección completa.", "referral_hub:grocery_address_retry") : { reply: "¿Cuál es la ciudad?", grocery: { ...state, step: "city", address: value }, debugNote: "referral_hub:grocery_city" };
  if (state.step === "city") return value.length < 2 ? failure(state, "Escribe una ciudad válida.", "referral_hub:grocery_city_retry") : { reply: "¿Cuál es el estado? Escribe sus dos letras, por ejemplo GA.", grocery: { ...state, step: "state", city: value }, debugNote: "referral_hub:grocery_state" };
  if (state.step === "state") return !/^[A-Za-z]{2}$/.test(value) ? failure(state, "Escribe las dos letras del estado.", "referral_hub:grocery_state_retry") : { reply: "¿Cómo prefieres coordinar el pago?", grocery: { ...state, step: "payment", state: value.toUpperCase() }, interactiveButtons: [{ id: "grocery_payment:cash", title: "Efectivo al recibir" }, { id: "grocery_payment:card", title: "Tarjeta al recibir" }, { id: "grocery_payment:zelle", title: "Zelle al confirmar" }], debugNote: "referral_hub:grocery_payment" };
  if (state.step === "payment") {
    const payment = action.match(/^grocery_payment:(cash|card|zelle)$/)?.[1]; if (!payment) return failure(state, "Selecciona una forma de pago.", "referral_hub:grocery_payment_retry");
    return { reply: "¿Tienes instrucciones para la entrega? Escribe “Ninguna” si no aplica.", grocery: { ...state, step: "instructions", payment }, debugNote: "referral_hub:grocery_instructions" };
  }
  if (state.step === "instructions") return { reply: `Revisa tu pedido:\n• Compra: ${state.offerName}\n• Sucursal: ${state.locationName}\n• Nombre: ${state.customerName}\n• Dirección: ${state.address}, ${state.city}, ${state.state} ${state.postalCode}\n• Pago: ${state.payment}\n• Instrucciones: ${value}\n\n¿Confirmas que deseas crear el pedido?`, grocery: { ...state, step: "confirm", instructions: value }, interactiveButtons: [{ id: "grocery_confirm:yes", title: "Confirmar pedido" }, { id: "grocery_confirm:no", title: "Cancelar" }], debugNote: "referral_hub:grocery_confirm" };
  if (state.step === "confirm") {
    if (action === "grocery_confirm:no") return failure({ ...state, step: "complete" }, "Cancelamos la solicitud. No se creó ningún pedido ni cobro.", "referral_hub:grocery_cancelled");
    if (action !== "grocery_confirm:yes" || !state.locationId || !state.offerId || !state.postalCode) return failure(state, "Confirma o cancela el pedido.", "referral_hub:grocery_confirm_retry");
    const coverage = await supabase.from("referral_grocery_delivery_coverage").select("id").eq("organization_id", ORGANIZATION_ID).eq("partner_location_id", state.locationId).eq("postal_code", state.postalCode).eq("active", true).maybeSingle();
    const location = await supabase.from("referral_partner_locations").select("id,latitude,longitude,active,delivery_enabled").eq("organization_id", ORGANIZATION_ID).eq("id", state.locationId).eq("active", true).eq("delivery_enabled", true).maybeSingle();
    const offer = await supabase.from("referral_basket_offers").select("id,partner_location_id,active").eq("organization_id", ORGANIZATION_ID).eq("id", state.offerId).eq("partner_location_id", state.locationId).eq("active", true).maybeSingle();
    if (coverage.error || !coverage.data || location.error || !location.data || offer.error || !offer.data) return failure(state, "La cobertura o la compra cambió. No se creó el pedido.", "referral_hub:grocery_revalidation_failed");
    const mapsKey = Deno.env.get("GOOGLE_MAPS_PLATFORM_API_KEY") ?? ""; if (!mapsKey) return failure(state, "No pudimos validar la ruta de entrega. No se creó el pedido.", "referral_hub:grocery_maps_unavailable");
    const maps = createGoogleMapsClient(mapsKey); const fullAddress = `${state.address}, ${state.city}, ${state.state} ${state.postalCode}`; const geocoded = await maps.geocodeAddress(fullAddress);
    const latitude = Number(location.data.latitude); const longitude = Number(location.data.longitude);
    if (geocoded.error || !geocoded.data || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return failure(state, "No pudimos validar la dirección de entrega. No se creó el pedido.", "referral_hub:grocery_address_unresolved");
    const route = await maps.computeDrivingRouteMatrix({ origin: { latitude: geocoded.data.latitude, longitude: geocoded.data.longitude }, destinationCoordinates: [{ latitude, longitude }] }); const selected = route.data?.[0];
    if (route.error || !selected) return failure(state, "No pudimos validar la ruta de entrega. No se creó el pedido.", "referral_hub:grocery_route_failed");
    const result = await supabase.rpc("create_referral_order", { p_organization_id: ORGANIZATION_ID, p_idempotency_key: state.idempotencyKey, p_campaign_code: state.sourceCampaign || "whatsapp_grocery_v1", p_source_channel: "whatsapp", p_partner_location_id: state.locationId, p_basket_offer_id: state.offerId, p_customer_name: state.customerName, p_customer_phone: args.channelUserId, p_customer_email: null, p_delivery_address: fullAddress, p_delivery_city: state.city, p_delivery_state: state.state, p_delivery_postal_code: state.postalCode, p_delivery_country_code: "US", p_delivery_latitude: geocoded.data.latitude, p_delivery_longitude: geocoded.data.longitude, p_delivery_distance_miles: Math.round(selected.distanceMeters / 1609.344 * 100) / 100, p_delivery_duration_minutes: Math.round(selected.durationSeconds / 60), p_route_source: "google_routes", p_customer_notes: `Pago: ${state.payment}${state.instructions ? ` · Entrega: ${state.instructions}` : ""}`, p_consent_transactional: true, p_consent_marketing: false, p_consent_version: "whatsapp_grocery_v1" });
    const row = (Array.isArray(result.data) ? result.data[0] : result.data) as Json | null; const orderCode = clean(row?.order_code);
    if (result.error || !orderCode) return failure(state, "No pudimos crear el pedido. No se realizó ningún cobro.", "referral_hub:grocery_order_failed");
    return { reply: `Pedido recibido. Tu referencia es ${orderCode}. Total: ${money(row?.total_cents, clean(row?.currency) || "USD")}. Estado: recibido.`, grocery: { ...state, step: "complete", orderCode }, debugNote: "referral_hub:grocery_order_created" };
  }
  return failure(state, "No pudimos continuar con el pedido.", "referral_hub:grocery_invalid_state");
}

export function groceryStateFromReferral(value: unknown): GroceryState | null { if (!value || typeof value !== "object") return null; const state = value as GroceryState; return state.step && state.idempotencyKey ? state : null; }
