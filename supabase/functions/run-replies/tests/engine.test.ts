import { assertEquals } from "https://deno.land/std@0.223.0/testing/asserts.ts";
import { detectIntent } from "../domain/intents.ts";
import { Stage } from "../domain/state.ts";
import { enforceMonotonicStage } from "../domain/state.ts";
import { runConversationEngine } from "../conversationEngine.ts";

deno.test("intent detection finds greeting", () => {
  const intent = detectIntent("hola");
  assertEquals(intent.intent, "greeting");
});

deno.test("stage enforcement prevents regression", () => {
  const result = enforceMonotonicStage("IMPACT", "DISCOVERY");
  assertEquals(result, "IMPACT");
});

deno.test("engine handles greeting -> discovery", () => {
  const result = runConversationEngine({
    organizationId: "creatyv-product",
    inboundText: "hola",
    leadState: null,
  });
  assertEquals(result?.statePatch.stage, "DISCOVERY");
  assertEquals(result?.debug.intent, "greeting");
});

deno.test("objection handler answers why question", () => {
  const result = runConversationEngine({
    organizationId: "creatyv-product",
    inboundText: "para que sirve",
    leadState: { stage: "DISCOVERY" },
  });
  assertEquals(result?.debug.intent, "why_question");
  assertEquals(result?.statePatch.collected?.objection_flags?.why_question, true);
});

deno.test("demo interest triggers tool action", () => {
  const result = runConversationEngine({
    organizationId: "creatyv-product",
    inboundText: "quiero ver",
    leadState: { stage: "SOLUTION" },
  });
  assertEquals(result?.toolAction?.name, "show_demo");
  assertEquals(result?.statePatch.stage, "DEMO");
});

deno.test("trial interest triggers trial offer", () => {
  const result = runConversationEngine({
    organizationId: "creatyv-product",
    inboundText: "quiero probar",
    leadState: { stage: "DEMO" },
  });
  assertEquals(result?.toolAction?.name, "start_trial");
  assertEquals(result?.statePatch.stage, "ACTIVATION");
  assertEquals(result?.statePatch.collected?.trial_offered, true);
});

deno.test("onboarding interest advances to activation", () => {
  const result = runConversationEngine({
    organizationId: "creatyv-product",
    inboundText: "quiero empezar",
    leadState: { stage: "TRIAL_OFFER" },
  });
  assertEquals(result?.toolAction?.name, "begin_onboarding");
  assertEquals(result?.statePatch.stage, "ACTIVATION");
  assertEquals(result?.statePatch.collected?.onboarding_started, true);
});

deno.test("acceptance signal transitions from value to activation", () => {
  const result = runConversationEngine({
    organizationId: "creatyv-product",
    inboundText: "si",
    leadState: { stage: "VALUE", collected: { selected_pain: "more_appointments" } },
  });
  assertEquals(result?.statePatch.stage, "ACTIVATION");
  assertEquals(result?.toolAction?.name, "start_trial");
  assertEquals(result?.statePatch.collected?.trial_offered, true);
});

deno.test("activation interest triggers onboarding flow", () => {
  const result = runConversationEngine({
    organizationId: "creatyv-product",
    inboundText: "cómo lo activo",
    leadState: { stage: "VALUE", collected: { selected_pain: "more_appointments" } },
  });
  assertEquals(result?.statePatch.stage, "ACTIVATION");
  assertEquals(result?.toolAction?.name, "begin_onboarding");
  assertEquals(result?.statePatch.collected?.onboarding_started, true);
});
