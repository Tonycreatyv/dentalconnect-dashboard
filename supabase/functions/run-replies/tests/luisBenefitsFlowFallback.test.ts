// Regression coverage for a real production incident (2026-08-26): a
// customer texted "Quiero un cupón", correctly got the benefits_clarify
// buttons (Supermercado/Médico/Ver otros), tapped "Supermercado", and the
// bot replied "Estamos preparando tus beneficios. Te ayudaremos por este
// mismo WhatsApp." instead of opening a real Flow.
//
// Root cause (confirmed via production organization_settings.integrations,
// read-only query): only luis_unified_flow_id is configured for the Luis
// org — luis_benefits_flow_id (the separate, legacy standalone Benefits
// Flow) was never set. Every route that resolves to {kind:"benefits"}
// (natural-language specific-benefit requests, all three benefits_clarify
// buttons, the existing "luis main benefits"/"luis benefits another"
// button actions, and benefit-campaign QR scans) went through
// luisBenefitsFlowEntryResult, which only tries the legacy Flow and falls
// to the dead-end fallback text when it isn't configured — never
// gracefully degrading to the one real, configured, working destination
// (the Unified Services Flow), even though every OTHER confident-intent
// route already does exactly that (see luisUnifiedFlowEntryResult).
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLuisConversationResult } from "../index.ts";
import { parseLuisBenefitFlowCompletion } from "../../_products/referral-hub/luisBenefits.ts";

const organizationId = "luis-gabriel-referral-hub";

// Matches the REAL production shape exactly (verified via
// `supabase db query` against organization_settings.integrations for this
// org) — only the Unified Flow is configured, never the legacy Benefits
// Flow. Fixtures elsewhere in this test suite that configure both
// (luisQrCampaign.test.ts's orgSettingsWithBothFlows) describe a
// configuration that does not exist in production and must never be the
// only configuration exercised by this specific regression.
const realProductionOrgSettings = {
  integrations: {
    luis_unified_flow_id: "2465563120620708",
  },
};

// No DB reads are needed on this path: the tapped button resolves via
// Priority-1 payload-action matching in routeLuisConversation before any
// query runs, and luisBenefitsFlowEntryResult/luisUnifiedFlowEntryResult
// only read orgSettings, never the database. A mock that throws on any
// use makes that assumption explicit and self-verifying.
const noDbAccessExpected = {
  from() {
    throw new Error("this regression path must never touch the database");
  },
} as any;

// Updated 2026-08-26 (routing-preservation round): the customer must not
// be forced to re-pick the same category they already selected. The
// original fix here (landing every CTA on the general SERVICE_SELECT
// screen with contextual copy only) was not enough - see the accompanying
// report. These now assert the real fix: each direct-entry CTA targets its
// own zero-inbound-edge screen (SUPERMARKET_ENTRY/MEDICAL_ENTRY/
// BENEFITS_ENTRY - draft-only, see docs/proposed-migrations/
// 20260826_draft_luis_unified_services_flow_direct_entry_screens.{json,md}).
// DO NOT DEPLOY the code that produces these screen names until that Flow
// draft is approved, uploaded, and published - see the report's item J.
Deno.test("[production regression] tapping 'Supermercado' from benefits_clarify opens directly on the supermarket entry screen, never the dead-end fallback or the general welcome screen", async () => {
  const result = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-regression-1",
    leadState: null,
    inboundText: "",
    payloadAction: "luis_benefits_clarify:supermarket",
    channel: "whatsapp",
    orgSettings: realProductionOrgSettings,
  });
  assert(result, "buildLuisConversationResult must not return null for a real button tap");
  assert(result!.flowCta, "result MUST contain a real flowCta");
  assertEquals(result!.flowCta!.flowActionPayload, { screen: "SUPERMARKET_ENTRY" });
  assertStringIncludes(result!.flowCta!.flowId, "2465563120620708");
  assertEquals(result!.reply.includes("Estamos preparando"), false, "result MUST NOT contain the dead-end fallback text");
  assertEquals(result!.debugNote?.includes("not_configured"), false);
});

Deno.test("[production regression] 'Médico' opens directly on the medical entry screen; 'Ver otros' opens directly on the benefits picker entry screen - neither ever falls back to SERVICE_SELECT", async () => {
  const medical = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-regression-2a",
    leadState: null,
    inboundText: "",
    payloadAction: "luis_benefits_clarify:medical",
    channel: "whatsapp",
    orgSettings: realProductionOrgSettings,
  });
  assert(medical, "buildLuisConversationResult must not return null for luis_benefits_clarify:medical");
  assert(medical!.flowCta, "result for medical MUST contain a real flowCta");
  assertEquals(medical!.flowCta!.flowActionPayload, { screen: "MEDICAL_ENTRY" });
  assertEquals(medical!.reply.includes("Estamos preparando"), false, "medical MUST NOT hit the dead-end fallback");

  const other = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-regression-2b",
    leadState: null,
    inboundText: "",
    payloadAction: "luis_benefits_clarify:other",
    channel: "whatsapp",
    orgSettings: realProductionOrgSettings,
  });
  assert(other, "buildLuisConversationResult must not return null for luis_benefits_clarify:other");
  assert(other!.flowCta, "result for 'Ver otros' MUST contain a real flowCta");
  // "Ver otros" means "show me all 4 benefits", not "start over from the
  // general menu" - BENEFITS_ENTRY duplicates BENEFIT_SELECT's own 4-item
  // picker as an independent entry point (see the draft Flow JSON).
  assertEquals(other!.flowCta!.flowActionPayload, { screen: "BENEFITS_ENTRY" });
  assertEquals(other!.reply.includes("Estamos preparando"), false, "'Ver otros' MUST NOT hit the dead-end fallback");
});

Deno.test("[production regression] a specific-benefit natural-language request ('Necesito un beneficio médico') is fixed identically to the button-tap path", async () => {
  const result = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-regression-3",
    leadState: null,
    inboundText: "Necesito un beneficio médico",
    channel: "whatsapp",
    orgSettings: realProductionOrgSettings,
  });
  assert(result);
  assert(result!.flowCta, "result MUST contain a real flowCta, not the dead-end text-only fallback");
  assertEquals(result!.flowCta!.flowActionPayload, { screen: "MEDICAL_ENTRY" });
  assertEquals(result!.reply.includes("Estamos preparando"), false);
});

Deno.test("[production regression] no benefits-related CTA (specific benefit or 'Ver otros'/'Ver beneficios') ever falls back to the general SERVICE_SELECT welcome screen", async () => {
  const actions = [
    "luis_benefits_clarify:supermarket",
    "luis_benefits_clarify:medical",
    "luis_benefits_clarify:other",
    "luis benefits another",
    "luis main benefits",
  ];
  for (const payloadAction of actions) {
    const result = await buildLuisConversationResult({
      supabase: noDbAccessExpected,
      organizationId,
      leadId: `lead-no-fallback-${payloadAction}`,
      leadState: null,
      inboundText: "",
      payloadAction,
      channel: "whatsapp",
      orgSettings: realProductionOrgSettings,
    });
    assert(result, `result must not be null for ${payloadAction}`);
    assert(result!.flowCta, `result for ${payloadAction} must contain a flowCta`);
    const screen = (result!.flowCta!.flowActionPayload as { screen?: string })?.screen;
    assert(
      screen !== "SERVICE_SELECT",
      `${payloadAction} must not fall back to SERVICE_SELECT, got ${screen}`,
    );
  }
});

Deno.test("if the legacy Benefits Flow IS configured, it is still preferred over the Unified Flow (no regression to existing behavior)", async () => {
  const result = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-regression-4",
    leadState: null,
    inboundText: "",
    payloadAction: "luis_benefits_clarify:supermarket",
    channel: "whatsapp",
    orgSettings: {
      integrations: {
        luis_unified_flow_id: "2465563120620708",
        luis_benefits_flow_id: "111222333",
      },
    },
  });
  assert(result);
  assert(result!.flowCta);
  assertEquals(result!.flowCta!.flowActionPayload, { screen: "BENEFIT_SELECT" });
  assertStringIncludes(result!.flowCta!.flowId, "111222333");
});

Deno.test("if NEITHER Flow is configured, the honest fallback text is still the last resort (never silently invents a Flow)", async () => {
  const result = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-regression-5",
    leadState: null,
    inboundText: "",
    payloadAction: "luis_benefits_clarify:supermarket",
    channel: "whatsapp",
    orgSettings: { integrations: {} },
  });
  assert(result);
  assertEquals(result!.flowCta, undefined);
  assertStringIncludes(result!.reply, "Estamos preparando tus beneficios");
});

// --- Follow-up (2026-08-26, same day, round 1): true screen-level
// skip-to-ZIP was requested next. Structurally proven impossible without
// editing and republishing a Meta Flow — these tests ground that proof
// directly in the real, vendored Flow JSON files (not just in prose). The
// contextual-copy-only mitigation that used to follow this comment (still
// landing on SERVICE_SELECT) was superseded by round 2 the same day — see
// the tests above (real direct-entry screens) and below (draft Flow JSON
// structural proof + "Ver servicios"/"Menú principal" stay unaffected).

async function inboundEdgeCounts(flowJsonPath: string): Promise<Record<string, number>> {
  const raw = await Deno.readTextFile(new URL(flowJsonPath, import.meta.url));
  const flow = JSON.parse(raw) as { routing_model: Record<string, string[]> };
  const counts: Record<string, number> = {};
  for (const screenId of Object.keys(flow.routing_model)) counts[screenId] = 0;
  for (const destinations of Object.values(flow.routing_model)) {
    for (const destination of destinations) counts[destination] = (counts[destination] ?? 0) + 1;
  }
  return counts;
}

Deno.test("[Meta Flow structural proof] BENEFIT_SELECT/BENEFIT_DETAILS are not valid direct-entry screens in the Unified Services Flow", async () => {
  // Per Meta's own INVALID_ROUTING_MODEL error reference: "Expected a
  // screen with no inbound edges as the entry screen." A screen with >=1
  // inbound edge cannot be targeted by flow_action_payload.screen.
  const counts = await inboundEdgeCounts("../../_products/referral-hub/luis-unified-services-flow.json");
  assertEquals(counts.SERVICE_SELECT, 0, "SERVICE_SELECT must be the zero-inbound-edge entry screen");
  assert(counts.BENEFIT_SELECT >= 1, "BENEFIT_SELECT has an inbound edge from SERVICE_SELECT - not a valid entry screen");
  assert(counts.BENEFIT_DETAILS >= 1, "BENEFIT_DETAILS has an inbound edge from BENEFIT_SELECT - not a valid entry screen");
});

Deno.test("[Meta Flow structural proof] the same constraint applies identically to the separate legacy Benefits Flow", async () => {
  const counts = await inboundEdgeCounts("../../_products/referral-hub/luis-benefits-flow.json");
  assertEquals(counts.BENEFIT_SELECT, 0, "BENEFIT_SELECT is this Flow's own entry screen");
  assert(counts.CUSTOMER_DETAILS >= 1, "CUSTOMER_DETAILS (the ZIP screen) has an inbound edge from BENEFIT_SELECT - not directly targetable either, even if this Flow were configured");
});

Deno.test("[draft Flow structural proof] the proposed direct-entry screens each independently have zero inbound edges, so each qualifies as a valid flow_action_payload.screen target", async () => {
  const counts = await inboundEdgeCounts(
    "../../../../docs/proposed-migrations/20260826_draft_luis_unified_services_flow_direct_entry_screens.json",
  );
  assertEquals(counts.SUPERMARKET_ENTRY, 0, "SUPERMARKET_ENTRY must have zero inbound edges to be a valid entry screen");
  assertEquals(counts.MEDICAL_ENTRY, 0, "MEDICAL_ENTRY must have zero inbound edges to be a valid entry screen");
  assertEquals(counts.BENEFITS_ENTRY, 0, "BENEFITS_ENTRY must have zero inbound edges to be a valid entry screen");
  // The existing constraint is unchanged for every existing screen - this
  // is a purely additive draft, not a replacement.
  assertEquals(counts.SERVICE_SELECT, 0);
  assert(counts.BENEFIT_SELECT >= 1);
  assert(counts.BENEFIT_DETAILS >= 1);
});

Deno.test("tapping 'Supermercado' lands directly on SUPERMARKET_ENTRY with a supermarket-specific greeting and CTA, not the generic welcome", async () => {
  const result = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-copy-1",
    leadState: null,
    inboundText: "",
    payloadAction: "luis_benefits_clarify:supermarket",
    channel: "whatsapp",
    orgSettings: realProductionOrgSettings,
  });
  assert(result);
  assert(result!.flowCta);
  assertEquals(result!.flowCta!.flowActionPayload, { screen: "SUPERMARKET_ENTRY" });
  assertStringIncludes(result!.flowCta!.bodyText, "supermercado");
  assertEquals(result!.flowCta!.bodyText.includes("Qué gusto tenerte por aquí"), false, "must not be the generic first-contact greeting");
  assertEquals(result!.flowCta!.ctaText, "Ver mi beneficio");
});

Deno.test("tapping 'Médico' lands directly on MEDICAL_ENTRY with its own contextual copy, distinct from the supermarket copy", async () => {
  const result = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-copy-2",
    leadState: null,
    inboundText: "",
    payloadAction: "luis_benefits_clarify:medical",
    channel: "whatsapp",
    orgSettings: realProductionOrgSettings,
  });
  assert(result);
  assert(result!.flowCta);
  assertEquals(result!.flowCta!.flowActionPayload, { screen: "MEDICAL_ENTRY" });
  assertStringIncludes(result!.flowCta!.bodyText, "médicos");
  assertEquals(result!.flowCta!.bodyText.includes("supermercado"), false);
  assertEquals(result!.flowCta!.ctaText, "Ver mi beneficio");
});

Deno.test("'Ver otros' opens directly on BENEFITS_ENTRY (the picker), while the general menu entry ('Menú') still opens the general SERVICE_SELECT welcome screen — the two are deliberately different", async () => {
  const verOtros = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-copy-3",
    leadState: null,
    inboundText: "",
    payloadAction: "luis_benefits_clarify:other",
    channel: "whatsapp",
    orgSettings: realProductionOrgSettings,
  });
  assert(verOtros);
  assert(verOtros!.flowCta);
  assertEquals(verOtros!.flowCta!.flowActionPayload, { screen: "BENEFITS_ENTRY" });
  assertEquals(verOtros!.flowCta!.ctaText, "Ver beneficios");

  const generalMenu = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-copy-4",
    leadState: null,
    inboundText: "Menú",
    channel: "whatsapp",
    orgSettings: realProductionOrgSettings,
  });
  assert(generalMenu);
  assert(generalMenu!.flowCta);
  assertEquals(generalMenu!.flowCta!.flowActionPayload, { screen: "SERVICE_SELECT" });
  assertEquals(generalMenu!.flowCta!.ctaText, "Ver opciones");
});

Deno.test("'Ver servicios' (explicit request to browse professional services) still opens the general SERVICE_SELECT welcome screen, unaffected by this change", async () => {
  const result = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-services-1",
    leadState: null,
    inboundText: "",
    payloadAction: "luis benefits services",
    channel: "whatsapp",
    orgSettings: realProductionOrgSettings,
  });
  assert(result);
  assert(result!.flowCta);
  assertEquals(result!.flowCta!.flowActionPayload, { screen: "SERVICE_SELECT" });
});

Deno.test("the selected canonical benefit_key survives the direct-entry Flow launch and Flow completion, exactly like the picker path", async () => {
  // SUPERMARKET_ENTRY/MEDICAL_ENTRY hardcode benefit_key as a literal in
  // their navigate payload (same pattern as HANDOFF_CONFIRM's existing
  // "service_key": "HANDOFF" literal) - BENEFIT_DETAILS' own unchanged
  // Footer reads whatever data.benefit_key it was navigated with and
  // submits it back on complete, so parseLuisBenefitFlowCompletion (already
  // generic across all 4 benefits, unchanged by this round) sees the exact
  // same completion shape regardless of which entry screen was used.
  const draftFlow = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../docs/proposed-migrations/20260826_draft_luis_unified_services_flow_direct_entry_screens.json",
        import.meta.url,
      ),
    ),
  ) as { screens: Array<Record<string, unknown>> };
  const supermarketEntry = draftFlow.screens.find((s) => s.id === "SUPERMARKET_ENTRY") as any;
  const medicalEntry = draftFlow.screens.find((s) => s.id === "MEDICAL_ENTRY") as any;
  const footerAction = (screen: any) =>
    screen.layout.children.find((c: any) => c.type === "Footer")["on-click-action"];
  assertEquals(footerAction(supermarketEntry).payload.benefit_key, "SUPERMARKET");
  assertEquals(footerAction(medicalEntry).payload.benefit_key, "MEDICAL");
  assertEquals(footerAction(supermarketEntry).next.type, "screen");
  assertEquals(footerAction(supermarketEntry).next.name, "BENEFIT_DETAILS");
  assertEquals(footerAction(medicalEntry).next.name, "BENEFIT_DETAILS");
  // The completion parser itself needs no benefit_key-specific handling for
  // either entry path - already proven generically in luisBenefitsFlow.test.ts.
  const parsed = parseLuisBenefitFlowCompletion({
    benefit_key: "SUPERMARKET",
    full_name: "Cliente",
    postal_code: "30071",
    email: null,
    marketing_consent: false,
  });
  assertEquals(parsed?.benefit_key, "SUPERMARKET");
});
