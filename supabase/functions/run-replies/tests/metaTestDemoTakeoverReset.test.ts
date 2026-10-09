import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  clearMetaTestDemoTakeoverState,
  metaTestDemoResetAction,
} from "../domain/referralHub/demoTakeoverReset.ts";
import { handleReferralHubTurn } from "../domain/referralHub/genericMenuRouter.ts";

const organizationId = "luis-gabriel-referral-hub";

Deno.test("explicit demo reset commands normalize case and accents", () => {
  for (
    const command of [
      "Menu",
      "Menú",
      "demo",
      "inicio",
      "reiniciar",
      "Menú principal",
      "Ver otros servicios",
    ]
  ) {
    assertEquals(metaTestDemoResetAction(command, null) !== null, true);
  }
  assertEquals(metaTestDemoResetAction("Hola", null), null);
  assertEquals(
    metaTestDemoResetAction("", "referral_menu:main"),
    "referral_menu:main",
  );
  assertEquals(
    metaTestDemoResetAction("", "referral_menu:services"),
    "referral_menu:services",
  );
  assertEquals(metaTestDemoResetAction("", "referral_handoff:advisor"), null);
});

Deno.test("demo reset clears takeover plus temporary Luis intake while preserving history", () => {
  const reset = clearMetaTestDemoTakeoverState({
    full_name: "Demo Customer",
    conversation_mode: "human_active",
    bot_paused_until: "2099-01-01T00:00:00.000Z",
    paused_reason: "human_replied_from_whatsapp_app",
    automation_mode: "human_takeover",
    message_history_marker: "preserve",
    collected: {
      luis_legal: { topic: "IMMIGRATION", step: "description" },
      luis_legal_draft: { answer: "temporary" },
      luis_legal_last_completed: { intake_type: "IMMIGRATION", description: "preserve" },
      referral_hub: {
        profile_name: "Demo Customer",
        profile_city: "Atlanta",
        grocery: { step: "zip" },
        service_id: "luis_representante",
        service_label: "Hablar con asesor",
        handoff_status: "created",
        last_completion: {
          service_id: "luis_representante",
          outcome: "handoff_created",
        },
        extracted_data: { service: "asesor", preserved: true },
      },
    },
  });

  assertEquals(reset.full_name, "Demo Customer");
  assertEquals(reset.conversation_mode, undefined);
  assertEquals(reset.bot_paused_until, undefined);
  assertEquals(reset.paused_reason, undefined);
  assertEquals(reset.automation_mode, undefined);
  assertEquals(reset.message_history_marker, "preserve");
  assertEquals((reset.collected as any).luis_legal, undefined);
  assertEquals((reset.collected as any).luis_legal_draft, undefined);
  assertEquals((reset.collected as any).luis_legal_last_completed, {
    intake_type: "IMMIGRATION",
    description: "preserve",
  });
  const referral = (reset.collected as any).referral_hub;
  assertEquals(referral.profile_name, "Demo Customer");
  assertEquals(referral.profile_city, "Atlanta");
  assertEquals(referral.grocery, { step: "zip" });
  assertEquals(referral.service_id, undefined);
  assertEquals(referral.handoff_status, undefined);
  assertEquals(referral.last_completion, undefined);
  assertEquals(referral.extracted_data, { preserved: true });
});

Deno.test("cleared demo takeover continues the same Menu inbound through Luis canonical routing", async () => {
  const resetState = clearMetaTestDemoTakeoverState({
    collected: {
      referral_hub: {
        profile_name: "Demo Customer",
        profile_city: "Atlanta",
        service_id: "luis_representante",
        handoff_status: "created",
      },
    },
  });
  const result = await handleReferralHubTurn({
    organizationId,
    leadState: resetState,
    inboundText: "Menu",
    channel: "whatsapp",
    allowTransientLuisMenuReset: true,
  });

  assertEquals(result.debugNote, "referral_hub:lg_menu");
  assertEquals(
    (result.statePatch.collected as any).referral_hub.service_id,
    null,
  );
});

Deno.test("takeover precedence remains limited to the exact test-demo route", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const resetSection = source.slice(
    source.indexOf("const demoResetAction = explicitMetaTestDemoContext"),
    source.indexOf("if (leadRes.data?.full_name"),
  );
  assertEquals(
    resetSection.includes(
      "effectiveOrganizationId === META_TEST_DEMO_ORGANIZATION_ID",
    ),
    true,
  );
  assertEquals(
    resetSection.includes(
      'eq("organization_id", META_TEST_DEMO_ORGANIZATION_ID)',
    ),
    true,
  );
  assertEquals(resetSection.includes("demo_takeover_reset_applied"), true);
  assertEquals(
    source.indexOf("const demoResetAction") <
      source.indexOf("bot_reply_skipped_human_takeover"),
    true,
  );
  assertEquals(
    source.indexOf("const testLuisFlowIntent") <
      source.indexOf("bot_reply_skipped_human_takeover"),
    true,
  );
  assertEquals(source.includes("demo_luis_temporary_state_cleared_for_navigation"), true);
  assertEquals(source.includes("isTestLuisFreshGreeting"), true);
});
