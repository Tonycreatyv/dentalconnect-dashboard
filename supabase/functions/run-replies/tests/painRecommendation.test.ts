import { assertEquals, assert } from "https://deno.land/std@0.223.0/testing/asserts.ts";
import { runConversationEngine } from "../conversationEngine.ts";
import { mergeLeadState } from "../index.ts";

type MockState = Record<string, unknown> & {
  stage?: string;
  collected?: Record<string, unknown>;
};

function step(state: MockState, text: string) {
  const result = runConversationEngine({
    organizationId: "creatyv-product",
    inboundText: text,
    leadState: state,
    knowledge: {},
  });
  if (!result) throw new Error(`Engine returned null for '${text}'`);
  return { result, state: mergeLeadState(state, result.statePatch) };
}

const recommendations = [
  {
    name: "more appointments",
    initial: "que es lo que mas me generaria dinero",
    confirm: "conseguir mas citas",
    repeat: "citas",
    pain: "more_appointments",
    phrases: ["conseguir más citas", "citas"],
  },
  {
    name: "faster replies",
    initial: "quiero responder mas rapido",
    confirm: "responder rapido",
    repeat: "respuestas rapidas",
    pain: "faster_replies",
  },
  {
    name: "organization",
    initial: "necesito mas organizacion",
    confirm: "organizar consultas",
    repeat: "mas orden",
    pain: "organization",
  },
  {
    name: "follow up",
    initial: "necesito dar seguimiento",
    confirm: "seguimiento",
    repeat: "recordatorios",
    pain: "follow_up",
  },
];

for (const scenario of recommendations) {
  Deno.test(`recommendation flow locks selected pain (${scenario.name})`, () => {
    let state: MockState = { stage: "DISCOVERY", collected: {} };
    const first = step(state, scenario.initial);
    state = first.state;
    const collected1 = (state as any).collected as Record<string, unknown> | undefined;
    assertEquals(collected1?.selected_pain, scenario.pain);
    assertEquals(state.stage, "VALUE");
    assert(!first.result.replyText.includes("Qué te gustaría resolver primero"), "Should not ask discovery");

    const second = step(state, scenario.confirm);
    state = second.state;
    const collected2 = (state as any).collected as Record<string, unknown> | undefined;
    assertEquals(collected2?.selected_pain, scenario.pain);
    assertEquals(state.stage, "VALUE");
    assert(!second.result.replyText.includes("Qué te gustaría resolver primero"));

    const third = step(state, scenario.repeat);
    state = third.state;
    const collected3 = (state as any).collected as Record<string, unknown> | undefined;
    assertEquals(collected3?.selected_pain, scenario.pain);
    assertEquals(state.stage, "VALUE");
    assert(!third.result.replyText.includes("Qué te gustaría resolver primero"));
  });
}
