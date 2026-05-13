import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { classifyPendingFlowMessage } from "../domain/pendingFlowClassifier.ts";

Deno.test("si => clean_confirmation", () => {
  assertEquals(classifyPendingFlowMessage("si"), "clean_confirmation");
});

Deno.test("mañana es viernes != clean_confirmation", () => {
  assertEquals(classifyPendingFlowMessage("mañana es viernes") === "clean_confirmation", false);
});

Deno.test("quiero una limpieza el lunes a las 8 => date_time_change or service_change", () => {
  const intent = classifyPendingFlowMessage("quiero una limpieza el lunes a las 8");
  assertEquals(["date_time_change", "service_change"].includes(intent), true);
});

Deno.test("a qué hora abren los martes => business_hours_question", () => {
  assertEquals(classifyPendingFlowMessage("a qué hora abren los martes"), "business_hours_question");
});

Deno.test("cuánto cuesta la limpieza => pricing_question", () => {
  assertEquals(classifyPendingFlowMessage("cuánto cuesta la limpieza"), "pricing_question");
});

Deno.test("dónde están => location_question", () => {
  assertEquals(classifyPendingFlowMessage("dónde están"), "location_question");
});

Deno.test("no me estás entendiendo => frustration", () => {
  assertEquals(classifyPendingFlowMessage("no me estás entendiendo"), "frustration");
});

Deno.test("pasame con recepción => human_handoff", () => {
  assertEquals(classifyPendingFlowMessage("pasame con recepción"), "human_handoff");
});

