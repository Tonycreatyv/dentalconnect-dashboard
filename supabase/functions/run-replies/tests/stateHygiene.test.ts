import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { clearActiveBookingState } from "../domain/bookingStateHygiene.ts";

Deno.test("clearActiveBookingState removes active booking fields and preserves durable context", () => {
  const input = {
    stage: "BOOKING",
    nextExpected: "confirm_booking",
    lastIntent: "book_appointment",
    full_name: "Jose Duran",
    phone: "+50499999999",
    preferred_hours: "mañana",
    last_appointment_summary: { status: "cancelled" },
    pending_booking: { status: "pending" },
    pending_offered_slot: { appointment_date: "2026-05-11" },
    preferred_date: "2026-05-11",
    preferred_time: "08:00",
    collected: {
      service: "Revisión dental",
      pending_booking: { status: "pending" },
      pending_offered_slot: { appointment_date: "2026-05-11" },
      preferred_date: "2026-05-11",
      preferred_time: "08:00",
      patient_name: "Mateo",
    },
  } as Record<string, unknown>;

  const cleaned = clearActiveBookingState(input);
  assertEquals(cleaned.pending_booking, null);
  assertEquals(cleaned.pending_offered_slot, null);
  assertEquals(cleaned.preferred_date, null);
  assertEquals(cleaned.preferred_time, null);
  assertEquals(cleaned.nextExpected, undefined);
  assertEquals(cleaned.lastIntent, undefined);
  assertEquals(cleaned.full_name, "Jose Duran");
  assertEquals(cleaned.phone, "+50499999999");
  assertEquals((cleaned.collected as any).patient_name, "Mateo");
  assertEquals((cleaned.collected as any).pending_offered_slot, null);
});
