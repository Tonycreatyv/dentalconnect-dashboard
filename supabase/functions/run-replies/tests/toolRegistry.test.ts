import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { executeTool } from "../domain/tools/toolRegistry.ts";

Deno.test("tool registry rejects unknown tool", async () => {
  const result = await executeTool("made_up_tool", {}, {});
  assertEquals(result.ok, false);
  assertEquals(result.error?.code, "unknown_tool");
});

Deno.test("book_appointment requires service/date/time/patient", async () => {
  const result = await executeTool("book_appointment", { service: "", appointment_date: "", appointment_time: "" }, {});
  assertEquals(result.ok, false);
  assertEquals(result.error?.code, "validation_error");
});

Deno.test("book_appointment cannot fake success", async () => {
  const result = await executeTool("book_appointment", {
    service: "Limpieza dental",
    appointment_date: "2026-05-08",
    appointment_time: "10:00",
    patient_name: "Mateo",
  }, {});
  assertEquals(result.ok, false);
  assertEquals(result.error?.code, "not_executed_in_registry");
});

Deno.test("cancel requires appointment id and confirmation", async () => {
  const result = await executeTool("cancel_appointment", { appointment_id: "", confirmed: false }, {});
  assertEquals(result.ok, false);
  assertEquals(result.error?.code, "validation_error");
});

Deno.test("check_availability returns structured slots", async () => {
  const result = await executeTool("check_availability", {
    service: "Revisión dental",
    slots: [{ date: "2026-05-08", time: "08:00" }],
  }, {});
  assertEquals(result.ok, true);
  assertEquals(Array.isArray(result.data?.slots), true);
});
