/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { LEGAL_INTAKE_SERVICE_ID, legalTopicLabel, parseLegalIntake } from "./legalIntake.ts";

// Shape verified against the one real production lead
// (867dace6-d2a9-4ebb-80d2-4ad877316058) that actually completed the
// published Unified Services Flow's immigration screen.
function realImmigrationState() {
  return {
    collected: {
      luis_legal_last_completed: {
        source: "whatsapp_flow",
        intake_type: "IMMIGRATION",
        topic: "CONSULTATION",
        full_name: "Jose Duran",
        postal_code: "30345",
        description: "Necesito asesoria en este proceso gracias!",
        completed_at: "2026-08-19T16:51:39.324Z",
      },
    },
  };
}

Deno.test("parseLegalIntake reads the real immigration completion shape", () => {
  const intake = parseLegalIntake(realImmigrationState());
  assertEquals(intake?.intakeType, "IMMIGRATION");
  assertEquals(intake?.topic, "CONSULTATION");
  assertEquals(intake?.postalCode, "30345");
  assertEquals(intake?.description, "Necesito asesoria en este proceso gracias!");
  assertEquals(intake?.completedAt, "2026-08-19T16:51:39.324Z");
});

Deno.test("parseLegalIntake never invents a description - returns null when the real field is missing", () => {
  const state = { collected: { luis_legal_last_completed: { intake_type: "IMMIGRATION", topic: "OTHER" } } };
  assertEquals(parseLegalIntake(state), null);
});

Deno.test("parseLegalIntake returns null for a lead with no completed legal intake at all", () => {
  assertEquals(parseLegalIntake(null), null);
  assertEquals(parseLegalIntake({}), null);
  assertEquals(parseLegalIntake({ collected: {} }), null);
});

Deno.test("parseLegalIntake rejects an unknown intake_type rather than guessing", () => {
  const state = { collected: { luis_legal_last_completed: { intake_type: "SOMETHING_ELSE", description: "x" } } };
  assertEquals(parseLegalIntake(state), null);
});

Deno.test("optional postal_code is honestly null when the customer skipped it (the Flow field is not required)", () => {
  const state = { collected: { luis_legal_last_completed: { intake_type: "AUTO_ACCIDENT", description: "Choque en la 285" } } };
  const intake = parseLegalIntake(state);
  assertEquals(intake?.postalCode, null);
});

Deno.test("LEGAL_INTAKE_SERVICE_ID groups AUTO_ACCIDENT and DUI_CRIMINAL under the same combined service row, matching SERVICE_REQUEST_LABEL elsewhere", () => {
  assertEquals(LEGAL_INTAKE_SERVICE_ID.IMMIGRATION, "luis_inmigracion");
  assertEquals(LEGAL_INTAKE_SERVICE_ID.AUTO_ACCIDENT, "luis_accidente");
  assertEquals(LEGAL_INTAKE_SERVICE_ID.DUI_CRIMINAL, "luis_accidente");
});

Deno.test("legalTopicLabel translates a known immigration topic to its real Flow wording", () => {
  const intake = parseLegalIntake(realImmigrationState())!;
  assertEquals(legalTopicLabel(intake), "Consulta de inmigración");
});

Deno.test("legalTopicLabel falls back to the raw topic value for an unrecognized code rather than hiding it", () => {
  const state = { collected: { luis_legal_last_completed: { intake_type: "IMMIGRATION", topic: "SOME_NEW_TOPIC", description: "x" } } };
  const intake = parseLegalIntake(state)!;
  assertEquals(legalTopicLabel(intake), "SOME_NEW_TOPIC");
});

Deno.test("legalTopicLabel returns null when no topic was captured, never an empty-string placeholder", () => {
  const state = { collected: { luis_legal_last_completed: { intake_type: "IMMIGRATION", description: "x" } } };
  const intake = parseLegalIntake(state)!;
  assertEquals(legalTopicLabel(intake), null);
});
