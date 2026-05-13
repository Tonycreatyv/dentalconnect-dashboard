import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { shouldCheckDbActiveAppointmentBeforeBooking } from "../domain/activeAppointmentGuard.ts";

Deno.test("active appointment only in DB + quiero brackets should trigger DB guard", () => {
  const shouldCheck = shouldCheckDbActiveAppointmentBeforeBooking({
    organizationId: "clinic-demo",
    leadState: { stage: "DISCOVERY", collected: {} },
    inboundText: "quiero brackets",
    deterministicIntent: "unknown",
  });
  assertEquals(shouldCheck, true);
});

Deno.test("active appointment only in DB + me duele la encía should trigger DB guard", () => {
  const shouldCheck = shouldCheckDbActiveAppointmentBeforeBooking({
    organizationId: "clinic-demo",
    leadState: { stage: "DISCOVERY", collected: {} },
    inboundText: "me duele la encía",
    deterministicIntent: "unknown",
  });
  assertEquals(shouldCheck, true);
});

Deno.test("if state already has active_appointment guard should not query DB", () => {
  const shouldCheck = shouldCheckDbActiveAppointmentBeforeBooking({
    organizationId: "clinic-demo",
    leadState: { collected: { active_appointment: { id: "appt-1" } } },
    inboundText: "qué horarios tienen",
    deterministicIntent: "hours",
  });
  assertEquals(shouldCheck, false);
});

Deno.test("no booking/symptom/service signal should not trigger DB guard", () => {
  const shouldCheck = shouldCheckDbActiveAppointmentBeforeBooking({
    organizationId: "clinic-demo",
    leadState: { stage: "DISCOVERY", collected: {} },
    inboundText: "gracias",
    deterministicIntent: "unknown",
  });
  assertEquals(shouldCheck, false);
});
