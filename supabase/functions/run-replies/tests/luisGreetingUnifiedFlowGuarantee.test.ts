// Regression coverage for a pre-meeting production incident: a customer
// ("hola", "buenas", "menu") got the legacy interactive-list menu (or a
// bare short greeting with no Flow button) instead of the Unified Flow
// entry, even though organization_settings.integrations.luis_unified_flow_id
// was confirmed present ("1083101694475306", string) at the time.
//
// Static trace of buildLuisConversationResult's main_menu branch (index.ts)
// showed luisUnifiedFlowEntryResult was already tried before any legacy
// fallback, for both new and returning contacts, for every greeting/menu
// trigger word. These tests lock that guarantee in explicitly so a future
// change can't silently regress it without a failing test — whatever the
// actual production root cause turns out to be (most likely a stale
// deployed run-replies bundle predating this logic; see the accompanying
// audit report).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLuisConversationResult } from "../index.ts";

const organizationId = "luis-gabriel-referral-hub";

// Matches the confirmed real production value (verified via read-only SQL
// against organization_settings.integrations for this org).
const realProductionOrgSettings = {
  integrations: {
    luis_unified_flow_id: "1083101694475306",
  },
};

const noDbAccessExpected = {
  from() {
    throw new Error("this regression path must never touch the database");
  },
} as any;

const GREETING_AND_MENU_INPUTS = ["hola", "Hola", "buenas", "menu", "menú"];

for (const inboundText of GREETING_AND_MENU_INPUTS) {
  Deno.test(`[hotfix regression] new contact + "${inboundText}" opens the Unified Flow entry, never the legacy menu or a bare greeting`, async () => {
    const result = await buildLuisConversationResult({
      supabase: noDbAccessExpected,
      organizationId,
      leadId: `lead-new-${inboundText}`,
      leadState: null,
      inboundText,
      channel: "whatsapp",
      orgSettings: realProductionOrgSettings,
    });
    assert(result, "buildLuisConversationResult must not return null");
    assert(result!.flowCta, `"${inboundText}" from a new contact MUST produce a real flowCta`);
    assertEquals(result!.flowCta!.flowId, "1083101694475306");
    assertEquals(result!.flowCta!.flowActionPayload, { screen: "SERVICE_SELECT" });
    assert(
      result!.flowCta!.bodyText.includes("Qué gusto tenerte por aquí"),
      "a brand-new contact must see the full first-contact welcome copy",
    );
  });

  Deno.test(`[hotfix regression] existing/returning contact + "${inboundText}" still opens the Unified Flow entry, not just the legacy interactive list`, async () => {
    const result = await buildLuisConversationResult({
      supabase: noDbAccessExpected,
      organizationId,
      leadId: `lead-existing-${inboundText}`,
      // Any non-empty lastIntent marks this as a returning lead per
      // buildLuisConversationResult's own isReturningLead check.
      leadState: { lastIntent: "luis_main_menu", full_name: "Luis" } as any,
      inboundText,
      channel: "whatsapp",
      orgSettings: realProductionOrgSettings,
    });
    assert(result, "buildLuisConversationResult must not return null");
    assert(result!.flowCta, `"${inboundText}" from a returning contact MUST still produce a real flowCta`);
    assertEquals(result!.flowCta!.flowId, "1083101694475306");
    assertEquals(result!.flowCta!.flowActionPayload, { screen: "SERVICE_SELECT" });
    // Returning contacts get a shorter, personalized greeting instead of the
    // full first-contact intro — but it must still be a real flowCta, never
    // the dead-end short text with no button.
    assertEquals(result!.interactiveList, undefined, "must not fall back to the legacy interactive-list menu");
  });
}

Deno.test("[hotfix regression] if luis_unified_flow_id is genuinely missing, the legacy interactive-list menu is still the honest fallback (never silently broken, never a fabricated Flow)", async () => {
  const result = await buildLuisConversationResult({
    supabase: noDbAccessExpected,
    organizationId,
    leadId: "lead-missing-flow-id",
    leadState: null,
    inboundText: "hola",
    channel: "whatsapp",
    orgSettings: { integrations: {} },
  });
  assert(result, "buildLuisConversationResult must not return null even without a configured Flow");
  assertEquals(result!.flowCta, undefined, "must not fabricate a flowCta when no Flow id is configured");
  assert(result!.interactiveList, "must fall back to the legacy interactive-list menu");
  assertEquals(
    result!.reply.includes("Qué gusto tenerte por aquí"),
    false,
    "the legacy fallback greeting is intentionally different copy from the Unified Flow's",
  );
});

// Human handoff is gated entirely inside processSingleJob, strictly before
// buildLuisConversationResult is ever invoked (the job is finalized with
// last_error:"skipped:human_takeover_active" and returned early) — this
// hotfix's diff is scoped to the main_menu branch inside
// buildLuisConversationResult only, so it structurally cannot affect that
// earlier gate. Not independently unit-testable at this level; verified by
// diff inspection instead (see the audit report).
