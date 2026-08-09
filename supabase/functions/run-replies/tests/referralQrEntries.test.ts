import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  extractReferralQrPublicCode,
  publicReferralQrResolution,
  resolveReferralQrEntry,
} from "../../_products/referral-hub/qrEntries.ts";
import { handleReferralHubTurn } from "../domain/referralHub/genericMenuRouter.ts";

Deno.env.set("REFERRAL_HUB_ASSET_BASE_URL", "https://referral.creatyv.io");

const organizationId = "luis-gabriel-referral-hub";
const code = "qR9mP2vX7kL4nB8sT1wY5zAa";
const locationId = "11111111-1111-4111-8111-111111111111";
const offerId = "22222222-2222-4222-8222-222222222222";

type Rows = Record<string, Record<string, unknown> | null>;

function database(entry: Record<string, unknown>, overrides: Rows = {}) {
  const events: unknown[] = [];
  const rows: Rows = {
    referral_qr_entries: entry,
    organizations: { id: organizationId, name: "LG Community Network" },
    service_configs: { id: "luis_compra_super", organization_id: organizationId, nombre: "Compras", activo: true },
    referral_coupon_campaigns: { organization_id: organizationId, campaign_key: "mi_tierra_10", service_id: "luis_cupon_super", display_name: "Mi Tierra", active: true },
    referral_partner_locations: { id: locationId, organization_id: organizationId, name: "Sucursal Centro", active: true, delivery_enabled: true },
    org_settings: { brand_name: "LG Community Network", whatsapp_enabled: true, whatsapp_phone_number: "+1 (404) 555-1212" },
    ...overrides,
  };
  const from = (table: string) => {
    const query: Record<string, unknown> & PromiseLike<unknown> = {
      then(resolve, reject) { return Promise.resolve({ data: rows[table] ?? null, error: null }).then(resolve, reject); },
      insert(value: unknown) { events.push(value); return Promise.resolve({ error: null }); },
      upsert() { return Promise.resolve({ error: null }); },
    };
    for (const method of ["select", "eq", "in", "order"]) query[method] = () => query;
    query.maybeSingle = () => query;
    return query;
  };
  return {
    from,
    events,
    rpc: () => Promise.resolve({ data: { coupon_id: "coupon-id", code: "RH-LG-12345", public_token: "token", coupon_status: "active", issued_at: "2026-08-08T12:00:00Z", expires_at: null, was_created: true }, error: null }),
  };
}

function entry(type: "general" | "service" | "campaign" | "location", context: Record<string, unknown> = {}) {
  return { public_code: code, organization_id: organizationId, entry_type: type, active: true, starts_at: null, expires_at: null, service_id: null, campaign_key: null, partner_location_id: null, attribution_label: "Volante agosto", attribution_source: "community_flyer", ...context };
}

Deno.test("QR resolver supports each scoped entry type without exposing internal identifiers", async () => {
  for (const candidate of [
    entry("general"),
    entry("service", { service_id: "luis_compra_super" }),
    entry("campaign", { campaign_key: "mi_tierra_10" }),
    entry("location", { partner_location_id: locationId, service_id: "luis_compra_super" }),
  ]) {
    const resolved = await resolveReferralQrEntry(database(candidate) as any, code);
    assert(resolved);
    const publicResult = publicReferralQrResolution(resolved);
    assertEquals(publicResult.available, true);
    assertStringIncludes(JSON.stringify(publicResult), "https://wa.me/14045551212");
    assertEquals(JSON.stringify(publicResult).includes("organizationId"), false);
    assertEquals(JSON.stringify(publicResult).includes(locationId), false);
  }
});

Deno.test("QR resolver rejects unknown, inactive, expired, and cross-organization context", async () => {
  assertEquals(await resolveReferralQrEntry(database(entry("general"), { referral_qr_entries: null }) as any, code), null);
  assertEquals(await resolveReferralQrEntry(database(entry("general", { active: false })) as any, code), null);
  assertEquals(await resolveReferralQrEntry(database(entry("general", { expires_at: "2026-01-01T00:00:00Z" })) as any, code), null);
  assertEquals(await resolveReferralQrEntry(database(entry("service", { service_id: "luis_compra_super" }), { service_configs: { id: "luis_compra_super", organization_id: "other-org", activo: true } }) as any, code), null);
});

Deno.test("opaque QR marker ignores forged service text and enters the canonical grocery flow", async () => {
  const db = database(entry("service", { service_id: "luis_compra_super" }));
  const result = await handleReferralHubTurn({ supabase: db as any, organizationId, leadId: "lead-id", leadState: null, inboundText: `Hola [[rhq:${code}]] referral_service:luis_accidente`, channel: "whatsapp" });
  assertEquals(result.debugNote, "referral_hub:grocery_entry");
  assertEquals(result.interactiveButtons?.[0].id, "referral_grocery:coupon");
  assertEquals((result.leadPatch?.extracted_data as any).qr_entry.public_code, code);
  assertEquals(db.events.length, 1);
});

Deno.test("campaign QR fulfills the stored coupon before the existing grocery upsell", async () => {
  const db = database(entry("campaign", { campaign_key: "mi_tierra_10" }));
  const result = await handleReferralHubTurn({ supabase: db as any, organizationId, leadId: "lead-id", leadState: null, inboundText: `Hola [[rhq:${code}]]`, channel: "whatsapp" });
  assertStringIncludes(result.reply, "Código: RH-LG-12345");
  assert(result.reply.indexOf("Código: RH-LG-12345") < result.reply.indexOf("Ya que vas a comprar"));
  assertEquals(result.interactiveButtons?.[0].id, "referral_grocery:baskets");
  assertEquals((result.leadPatch?.extracted_data as any).qr_entry.campaign_key, "mi_tierra_10");
  const baskets = await handleReferralHubTurn({ supabase: db as any, organizationId, leadId: "lead-id", leadState: result.statePatch, inboundText: "", payloadAction: "referral_grocery:baskets", channel: "whatsapp" });
  assertEquals((((baskets.statePatch.collected as any).referral_hub.grocery as any).sourceCampaign), "mi_tierra_10");
});

Deno.test("location QR keeps the durable grocery ZIP validation intact", async () => {
  const db = database(entry("location", { partner_location_id: locationId, service_id: "luis_compra_super" }), {
    referral_grocery_delivery_coverage: { partner_location_id: locationId, priority: 1 },
    referral_basket_offers: { id: offerId, display_name: "Canasta Esencial", price_cents: 6900, currency: "USD", active: true, partner_location_id: locationId },
  });
  const entryResult = await handleReferralHubTurn({ supabase: db as any, organizationId, leadId: "lead-id", leadState: null, inboundText: `[[rhq:${code}]]`, channel: "whatsapp" });
  const baskets = await handleReferralHubTurn({ supabase: db as any, organizationId, leadId: "lead-id", leadState: entryResult.statePatch, inboundText: "", payloadAction: "referral_grocery:baskets", channel: "whatsapp" });
  const invalidZip = await handleReferralHubTurn({ supabase: db as any, organizationId, leadId: "lead-id", channelUserId: "+14045551212", leadState: baskets.statePatch, inboundText: "not a zip", channel: "whatsapp" });
  assertEquals(invalidZip.debugNote, "referral_hub:grocery_zip_retry");
  assertStringIncludes(invalidZip.reply, "ZIP válido");
});

Deno.test("QR marker parser accepts only the opaque marker", () => {
  assertEquals(extractReferralQrPublicCode(`Hola [[rhq:${code}]]`), code);
  assertEquals(extractReferralQrPublicCode("campaign=mi_tierra_10&service=luis_compra_super"), null);
});

Deno.test("QR migration keeps the registry private and constrained", async () => {
  const sql = await Deno.readTextFile(new URL("../../../migrations/20260808000100_referral_qr_entries.sql", import.meta.url));
  assertStringIncludes(sql, "unique (public_code)");
  assertStringIncludes(sql, "entry_type in ('general', 'service', 'campaign', 'location')");
  assertStringIncludes(sql, "referral_qr_entries_context_check");
  assertStringIncludes(sql, "revoke all on table public.referral_qr_entries from public, anon, authenticated");
  assertStringIncludes(sql, "grant execute on function public.referral_generate_qr_public_code() to authenticated, service_role");
  assertEquals(sql.includes("to anon\nusing"), false);
});
