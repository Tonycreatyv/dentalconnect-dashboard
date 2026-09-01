import { assert, assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  buildCreatedAccidentHandoffState,
  LG_ADVISOR_HANDOFF_SUCCESS,
  LG_ACCIDENT_HANDOFF_FAILURE,
  LG_ACCIDENT_HANDOFF_SUCCESS,
  resolveAdvisorHandoffOutcome,
  resolveAccidentHandoffOutcome,
} from "../domain/referralHub/accidentHandoff.ts";

Deno.test("successful deterministic handoff uses exact new copy", () => {
  const created = buildCreatedAccidentHandoffState({
    collected: { referral_hub: { profile_name: "Luis", current_field: null } },
  }, "2026-07-26T12:00:00.000Z");
  const outcome = resolveAccidentHandoffOutcome({
    persisted: true,
    createdStatePatch: created,
  });
  assertEquals(outcome.reply, LG_ACCIDENT_HANDOFF_SUCCESS);
  assert(!outcome.reply.includes("podrá revisar tu caso"));
  assert(!outcome.reply.includes("¡Hola!"));
  assertEquals(
    outcome.reply,
    "Gracias por la información.\n\nLG Community Network no ofrece asesoría legal directamente. Te conectamos con profesionales o recursos participantes.\n\nUn asesor te contactará en breve para orientarte sobre el siguiente paso.",
  );
  const disclaimerIndex = outcome.reply.indexOf("LG Community Network no ofrece asesoría legal directamente.");
  const confirmationIndex = outcome.reply.indexOf("Un asesor te contactará en breve");
  assert(disclaimerIndex >= 0 && confirmationIndex > disclaimerIndex);
  assertEquals((outcome.statePatch.collected as any).referral_hub.handoff_status, "created");
  assertEquals((outcome.statePatch as any).handoff_to_human, undefined);
});

Deno.test("failed handoff does not promise advisor contact", () => {
  const outcome = resolveAccidentHandoffOutcome({
    persisted: false,
    createdStatePatch: {},
  });
  assertEquals(outcome.reply, LG_ACCIDENT_HANDOFF_FAILURE);
  assertEquals(
    outcome.reply,
    "No pudimos completar la solicitud en este momento. Inténtalo nuevamente o selecciona ‘Hablar con asesor’.",
  );
  assert(!outcome.reply.includes("te contactará"));
  assert(!outcome.reply.includes("¡Hola!"));
  assertEquals(outcome.statePatch, {});
});

Deno.test("advisor handoff promises contact only after persistence", () => {
  const created = buildCreatedAccidentHandoffState({
    active_flow: "referral_hub_menu",
  }, "2026-07-27T12:00:00.000Z");
  const success = resolveAdvisorHandoffOutcome({
    persisted: true,
    createdStatePatch: created,
  });
  const failure = resolveAdvisorHandoffOutcome({
    persisted: false,
    createdStatePatch: created,
  });
  assertEquals(success.reply, LG_ADVISOR_HANDOFF_SUCCESS);
  assert(success.reply.includes("te contactará en breve"));
  assertEquals(failure.reply, LG_ACCIDENT_HANDOFF_FAILURE);
  assert(!failure.reply.includes("te contactará"));
  assertEquals(failure.statePatch, {});
});
