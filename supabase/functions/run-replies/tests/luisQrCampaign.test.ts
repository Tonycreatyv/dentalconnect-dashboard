import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  mapQrEntryToLuisRoute,
  withLuisQrAttribution,
} from "../domain/referralHub/luisQrCampaign.ts";
import { buildLuisConversationResult } from "../index.ts";
import type { ResolvedReferralQrEntry } from "../../_products/referral-hub/qrEntries.ts";
import { referralQrMarker } from "../../_products/referral-hub/qrEntries.ts";

const organizationId = "luis-gabriel-referral-hub";
const code = "qR9mP2vX7kL4nB8sT1wY5zAa";
const marker = referralQrMarker(code);

function entry(overrides: Partial<ResolvedReferralQrEntry> = {}): ResolvedReferralQrEntry {
  return {
    publicCode: code,
    entryType: "general",
    organizationId,
    serviceId: null,
    campaignKey: null,
    partnerLocationId: null,
    title: "LG Community Network",
    attributionLabel: "Volante doctor",
    attributionSource: "flyer_medical",
    whatsappPhone: "14045551212",
    ...overrides,
  };
}

// --- Pure mapping -----------------------------------------------------------

Deno.test("mapQrEntryToLuisRoute: general entry opens the full Unified Services menu", () => {
  assertEquals(mapQrEntryToLuisRoute(entry({ entryType: "general" })), { kind: "main_menu", trigger: "explicit" });
});

Deno.test("mapQrEntryToLuisRoute: each of the 4 benefit services opens the benefits picker directly", () => {
  for (
    const serviceId of [
      "luis_benefit_medical",
      "luis_benefit_supermarket",
      "luis_benefit_dental",
      "luis_benefit_shipping",
    ]
  ) {
    assertEquals(
      mapQrEntryToLuisRoute(entry({ entryType: "campaign", serviceId, campaignKey: "x" })),
      { kind: "benefits", directCampaignEntry: true },
    );
  }
});

Deno.test("mapQrEntryToLuisRoute: an unrelated/legacy service or location entry falls through to normal routing", () => {
  assertEquals(mapQrEntryToLuisRoute(entry({ entryType: "service", serviceId: "luis_compra_super" })), null);
  assertEquals(mapQrEntryToLuisRoute(entry({ entryType: "location", partnerLocationId: "loc-1", serviceId: "luis_compra_super" })), null);
});

// --- Attribution --------------------------------------------------------

Deno.test("withLuisQrAttribution: merges qr_entry + source_campaign without dropping existing leadPatch fields", () => {
  const result = withLuisQrAttribution(
    { reply: "x", statePatch: {}, debugNote: "d", leadPatch: { full_name: "Luis" } },
    entry({ entryType: "campaign", serviceId: "luis_benefit_medical", campaignKey: "luis_benefit_medical_20" }),
  );
  assertEquals((result.leadPatch as any).full_name, "Luis");
  assertEquals((result.leadPatch as any).source_campaign, "luis_benefit_medical_20");
  assertEquals((result.leadPatch as any).extracted_data.qr_entry.public_code, code);
  assertEquals((result.leadPatch as any).extracted_data.qr_entry.campaign_key, "luis_benefit_medical_20");
});

Deno.test("withLuisQrAttribution: a later scan of a different campaign overwrites, never reuses stale attribution", () => {
  const first = withLuisQrAttribution(
    { reply: "x", statePatch: {}, debugNote: "d" },
    entry({ entryType: "campaign", campaignKey: "luis_benefit_medical_20" }),
  );
  const second = withLuisQrAttribution(
    { reply: "x", statePatch: {}, debugNote: "d", leadPatch: first.leadPatch },
    entry({ entryType: "campaign", campaignKey: "luis_benefit_supermarket_20" }),
  );
  assertEquals((second.leadPatch as any).source_campaign, "luis_benefit_supermarket_20");
  assertEquals((second.leadPatch as any).extracted_data.qr_entry.campaign_key, "luis_benefit_supermarket_20");
});

// --- End-to-end via buildLuisConversationResult ------------------------

type Rows = Record<string, Record<string, unknown> | null>;

function database(qrEntryRow: Record<string, unknown> | null, overrides: Rows = {}) {
  const inserted: Record<string, unknown>[] = [];
  const rows: Rows = {
    referral_qr_entries: qrEntryRow,
    organizations: { id: organizationId, name: "LG Community Network" },
    referral_coupon_campaigns: {
      organization_id: organizationId,
      campaign_key: "luis_benefit_medical_20",
      service_id: "luis_benefit_medical",
      display_name: "20% en servicios médicos",
      active: true,
    },
    org_settings: {
      brand_name: "LG Community Network",
      whatsapp_enabled: true,
      whatsapp_phone_number: "+1 404 555 1212",
    },
    // resolveReferralQrEntry requires an active service_configs row whenever
    // a serviceId is resolved (directly or via a campaign's service_id);
    // the mock ignores .eq() filters, so any active row with the right org
    // satisfies it regardless of which specific service_id is in play.
    service_configs: {
      id: "luis_benefit_medical",
      organization_id: organizationId,
      nombre: "Beneficio",
      menu_label: "Beneficio",
      activo: true,
    },
    ...overrides,
  };
  const from = (table: string) => {
    const query: Record<string, unknown> & PromiseLike<unknown> = {
      then(resolve: any, reject: any) {
        return Promise.resolve({ data: rows[table] ?? null, error: null }).then(resolve, reject);
      },
      insert(value: Record<string, unknown>) {
        inserted.push({ table, value });
        return Promise.resolve({ error: null });
      },
      update() {
        return query;
      },
    };
    for (const method of ["select", "eq", "in", "order"]) query[method] = () => query;
    query.maybeSingle = () => query;
    return query;
  };
  return { from, inserted };
}

const orgSettingsWithBothFlows = {
  integrations: {
    luis_unified_flow_id: "999888777",
    luis_benefits_flow_id: "111222333",
  },
};

Deno.test("general campaign QR opens the complete Unified Services menu (not the benefits picker)", async () => {
  const db = database({
    public_code: code,
    organization_id: organizationId,
    entry_type: "general",
    active: true,
    starts_at: null,
    expires_at: null,
    service_id: null,
    campaign_key: null,
    partner_location_id: null,
    attribution_label: "Flyer general",
    attribution_source: "flyer",
  });
  const result = await buildLuisConversationResult({
    supabase: db as any,
    organizationId,
    leadId: "lead-1",
    leadState: null,
    inboundText: `Hola, quiero conocer los servicios ${marker}`,
    channel: "whatsapp",
    orgSettings: orgSettingsWithBothFlows,
  });
  assert(result);
  assertEquals(result!.flowCta?.flowActionPayload, { screen: "SERVICE_SELECT" });
  assertEquals((result!.leadPatch as any)?.extracted_data?.qr_entry?.public_code, code);
});

Deno.test("medical campaign QR opens the benefits picker directly, not the full menu", async () => {
  const db = database({
    public_code: code,
    organization_id: organizationId,
    entry_type: "campaign",
    active: true,
    starts_at: null,
    expires_at: null,
    service_id: null,
    campaign_key: "luis_benefit_medical_20",
    partner_location_id: null,
    attribution_label: "Volante consultorio",
    attribution_source: "flyer_medical",
  });
  const result = await buildLuisConversationResult({
    supabase: db as any,
    organizationId,
    leadId: "lead-2",
    leadState: null,
    inboundText: `Quiero mi beneficio médico ${marker}`,
    channel: "whatsapp",
    orgSettings: orgSettingsWithBothFlows,
  });
  assert(result);
  assertEquals(result!.flowCta?.flowActionPayload, { screen: "BENEFIT_SELECT" });
  assertEquals((result!.leadPatch as any)?.source_campaign, "luis_benefit_medical_20");
  assertEquals((result!.leadPatch as any)?.extracted_data?.qr_entry?.campaign_key, "luis_benefit_medical_20");
  assertEquals(result!.leadPatch?.handoff_to_human, undefined);
});

Deno.test("supermarket campaign QR opens the benefits picker directly", async () => {
  const db = database(
    {
      public_code: code,
      organization_id: organizationId,
      entry_type: "campaign",
      active: true,
      starts_at: null,
      expires_at: null,
      service_id: null,
      campaign_key: "luis_benefit_supermarket_20",
      partner_location_id: null,
      attribution_label: null,
      attribution_source: null,
    },
    {
      referral_coupon_campaigns: {
        organization_id: organizationId,
        campaign_key: "luis_benefit_supermarket_20",
        service_id: "luis_benefit_supermarket",
        display_name: "$20 para tu compra",
        active: true,
      },
    },
  );
  const result = await buildLuisConversationResult({
    supabase: db as any,
    organizationId,
    leadId: "lead-3",
    leadState: null,
    inboundText: `Quiero mi beneficio de supermercado ${marker}`,
    channel: "whatsapp",
    orgSettings: orgSettingsWithBothFlows,
  });
  assert(result);
  assertEquals(result!.flowCta?.flowActionPayload, { screen: "BENEFIT_SELECT" });
});

Deno.test("an existing/returning lead scanning a new campaign still routes by the new campaign, not blocked by prior stage", async () => {
  const db = database({
    public_code: code,
    organization_id: organizationId,
    entry_type: "campaign",
    active: true,
    starts_at: null,
    expires_at: null,
    service_id: null,
    campaign_key: "luis_benefit_medical_20",
    partner_location_id: null,
    attribution_label: null,
    attribution_source: null,
  });
  const returningLeadState = {
    lastIntent: "luis_unified_flow_cta",
    nextExpected: "luis_unified_flow_cta",
    collected: { luis_legal: { topic: "IMMIGRATION", step: "description" } },
  };
  const result = await buildLuisConversationResult({
    supabase: db as any,
    organizationId,
    leadId: "lead-4",
    leadState: returningLeadState,
    inboundText: `Quiero mi beneficio médico ${marker}`,
    channel: "whatsapp",
    orgSettings: orgSettingsWithBothFlows,
  });
  assert(result);
  assertEquals(result!.flowCta?.flowActionPayload, { screen: "BENEFIT_SELECT" });
  assertEquals((result!.leadPatch as any)?.source_campaign, "luis_benefit_medical_20");
});

Deno.test("a paused campaign QR entry resolves to nothing and falls through to normal free-text routing", async () => {
  const db = database({
    public_code: code,
    organization_id: organizationId,
    entry_type: "campaign",
    active: false, // paused
    starts_at: null,
    expires_at: null,
    service_id: null,
    campaign_key: "luis_benefit_medical_20",
    partner_location_id: null,
    attribution_label: null,
    attribution_source: null,
  });
  const result = await buildLuisConversationResult({
    supabase: db as any,
    organizationId,
    leadId: "lead-5",
    leadState: null,
    inboundText: `Quiero mi beneficio médico ${marker}`,
    channel: "whatsapp",
    orgSettings: orgSettingsWithBothFlows,
  });
  assert(result);
  // Falls through to normal interpretation of the free text. "Quiero mi
  // beneficio médico" names a specific benefit, so it now opens the
  // benefits picker directly (BENEFIT_SELECT) — the same destination a
  // medical-benefit QR scan opens — not the Unified Services menu. This
  // matches the natural-language interpreter's routing (see
  // luisIntentInterpreter.test.ts), unrelated to the paused campaign,
  // which correctly never resolved (no qr_entry attribution below).
  assertEquals(result!.flowCta?.flowActionPayload, { screen: "BENEFIT_SELECT" });
  assertEquals((result!.leadPatch as any)?.extracted_data?.qr_entry, undefined);
});

Deno.test("a QR entry belonging to a different organization never resolves (no cross-tenant campaign entry)", async () => {
  const db = database({
    public_code: code,
    organization_id: "some-other-org",
    entry_type: "campaign",
    active: true,
    starts_at: null,
    expires_at: null,
    service_id: null,
    campaign_key: "luis_benefit_medical_20",
    partner_location_id: null,
    attribution_label: null,
    attribution_source: null,
  });
  const result = await buildLuisConversationResult({
    supabase: db as any,
    organizationId,
    leadId: "lead-6",
    leadState: null,
    inboundText: `Quiero mi beneficio médico ${marker}`,
    channel: "whatsapp",
    orgSettings: orgSettingsWithBothFlows,
  });
  assert(result);
  // Same reasoning as the paused-campaign test above: the cross-org QR
  // entry correctly never resolves, and the free text alone ("Quiero mi
  // beneficio médico") names a specific benefit, so it opens the benefits
  // picker (BENEFIT_SELECT) directly.
  assertEquals(result!.flowCta?.flowActionPayload, { screen: "BENEFIT_SELECT" });
});

Deno.test("first contact gets the full greeting; a returning lead asking for the menu gets the short reentry copy", async () => {
  const db = database(null); // no QR marker involved in this test
  const firstContact = await buildLuisConversationResult({
    supabase: db as any,
    organizationId,
    leadId: "lead-7",
    leadState: null,
    inboundText: "Hola",
    channel: "whatsapp",
    orgSettings: orgSettingsWithBothFlows,
  });
  assert(firstContact);
  assertStringIncludes(firstContact!.flowCta!.bodyText, "Te saluda Luis Gabriel");

  const returning = await buildLuisConversationResult({
    supabase: db as any,
    organizationId,
    leadId: "lead-7",
    leadState: { lastIntent: "luis_unified_flow_cta", nextExpected: "luis_unified_flow_cta" },
    inboundText: "menu",
    channel: "whatsapp",
    orgSettings: orgSettingsWithBothFlows,
  });
  assert(returning);
  assertEquals(returning!.flowCta!.bodyText, "Claro 👌 Acá tenés nuevamente nuestras opciones.");
  assertEquals(returning!.flowCta!.bodyText.includes("Te saluda Luis Gabriel"), false);
});

Deno.test("none of the new QR/greeting paths set handoff_to_human unexpectedly", async () => {
  const db = database({
    public_code: code,
    organization_id: organizationId,
    entry_type: "general",
    active: true,
    starts_at: null,
    expires_at: null,
    service_id: null,
    campaign_key: null,
    partner_location_id: null,
    attribution_label: null,
    attribution_source: null,
  });
  const result = await buildLuisConversationResult({
    supabase: db as any,
    organizationId,
    leadId: "lead-8",
    leadState: null,
    inboundText: `Hola ${marker}`,
    channel: "whatsapp",
    orgSettings: orgSettingsWithBothFlows,
  });
  assert(result);
  // main_menu entry intentionally sets handoff_to_human: false (ensuring the
  // bot is active) — the guard here is that it is never true, i.e. this new
  // QR/greeting path never accidentally claims a human takeover happened.
  assertEquals(result!.leadPatch?.handoff_to_human, false);
});
