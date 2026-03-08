import { assertEquals } from "https://deno.land/std@0.223.0/testing/asserts.ts";
import { bookAppointment, cancelAppointment, rescheduleAppointment } from "../domain/tools.ts";

deno.test("bookAppointment returns stub appointment", async () => {
  const result = await bookAppointment({ organization_id: "org", lead_id: "lead-1", start_at: new Date().toISOString() });
  assertEquals(result.ok, true);
  assertEquals(result.appointment.lead_id, "lead-1");
});

deno.test("cancelAppointment returns ok", async () => {
  const result = await cancelAppointment({ eventId: "event-123" });
  assertEquals(result.ok, true);
  assertEquals(result.canceled_event, "event-123");
});

deno.test("rescheduleAppointment returns ok", async () => {
  const result = await rescheduleAppointment({ eventId: "event-123", start_at: "2026-03-10T10:00:00Z" });
  assertEquals(result.ok, true);
});
