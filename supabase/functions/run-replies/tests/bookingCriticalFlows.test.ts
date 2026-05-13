import { assert, assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { parseDateTimeFromMessage, runConversationEngine } from "../conversationEngine.ts";

Deno.test("relative date: base 2026-05-07 + manana a las 8 => 2026-05-08 08:00", () => {
  const parsed = parseDateTimeFromMessage(
    "mañana a las 8",
    "America/Tegucigalpa",
    new Date("2026-05-07T10:00:00-06:00"),
  );
  assert(parsed);
  assertEquals(parsed?.date, "2026-05-08");
  assertEquals(parsed?.time, "08:00");
});

Deno.test("relative date: base 2026-05-07 + el lunes a las 8 => 2026-05-11 08:00", () => {
  const parsed = parseDateTimeFromMessage(
    "el lunes a las 8",
    "America/Tegucigalpa",
    new Date("2026-05-07T10:00:00-06:00"),
  );
  assert(parsed);
  assertEquals(parsed?.date, "2026-05-11");
  assertEquals(parsed?.time, "08:00");
});

Deno.test("relative date: base 2026-05-08 + el lunes a las 8 => 2026-05-11 08:00", () => {
  const parsed = parseDateTimeFromMessage(
    "el lunes a las 8",
    "America/Tegucigalpa",
    new Date("2026-05-08T10:00:00-06:00"),
  );
  assert(parsed);
  assertEquals(parsed?.date, "2026-05-11");
  assertEquals(parsed?.time, "08:00");
});

Deno.test("relative date: base 2026-05-08 + lunes a las 8 => 2026-05-11 08:00", () => {
  const parsed = parseDateTimeFromMessage(
    "lunes a las 8",
    "America/Tegucigalpa",
    new Date("2026-05-08T10:00:00-06:00"),
  );
  assert(parsed);
  assertEquals(parsed?.date, "2026-05-11");
  assertEquals(parsed?.time, "08:00");
});

Deno.test("relative date: base 2026-05-08 + el otro lunes a las 8 => 2026-05-18 08:00", () => {
  const parsed = parseDateTimeFromMessage(
    "el otro lunes a las 8",
    "America/Tegucigalpa",
    new Date("2026-05-08T10:00:00-06:00"),
  );
  assert(parsed);
  assertEquals(parsed?.date, "2026-05-18");
  assertEquals(parsed?.time, "08:00");
});

Deno.test("relative date: base 2026-05-08 + manana a las 8 => 2026-05-09 08:00", () => {
  const parsed = parseDateTimeFromMessage(
    "manana a las 8",
    "America/Tegucigalpa",
    new Date("2026-05-08T10:00:00-06:00"),
  );
  assert(parsed);
  assertEquals(parsed?.date, "2026-05-09");
  assertEquals(parsed?.time, "08:00");
});

Deno.test("pending confirm + correction does not confirm old slot", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "mañana es viernes",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Revisión dental",
        preferred_date: "2026-05-09",
        preferred_time: "08:00",
      },
    },
  } as any);
  assert(result);
  assertEquals((result as any).toolAction, undefined);
  assert(!String((result as any).replyText).includes("procesando tu reserva"));
});

Deno.test("pending confirm + new full request replaces pending and recalculates", () => {
  const realDateNow = Date.now;
  Date.now = () => new Date("2026-05-08T10:00:00-06:00").getTime();
  try {
    const result = runConversationEngine({
      organizationId: "clinic-demo",
      inboundText: "quiero una limpieza el lunes a las 8",
      leadState: {
        stage: "CONFIRMING",
        nextExpected: "confirm_booking",
        collected: {
          service: "Revisión dental",
          preferred_date: "2026-05-18",
          preferred_time: "08:00",
          pending_booking: { service: "Revisión dental" },
        },
      },
    } as any);
    assert(result);
    assertEquals((result as any).replyText, "__CHECK_REQUESTED_AVAILABILITY__");
    assertEquals(((result as any).statePatch?.collected ?? {}).service, "Limpieza dental");
    assertEquals(((result as any).statePatch?.collected ?? {}).preferred_date, "2026-05-11");
    assertEquals(((result as any).statePatch?.collected ?? {}).preferred_time, "08:00");
  } finally {
    Date.now = realDateNow;
  }
});

Deno.test("full request with stale pending context uses next immediate monday (2026-05-11)", () => {
  const realDateNow = Date.now;
  Date.now = () => new Date("2026-05-08T10:00:00-06:00").getTime();
  try {
    const result = runConversationEngine({
      organizationId: "clinic-demo",
      inboundText: "quiero una limpieza el lunes a las 8",
      leadState: {
        stage: "BOOKING",
        nextExpected: "date_time",
        collected: {
          service: "Revisión dental",
          preferred_date: "2026-05-18",
          preferred_time: "08:00",
          pending_booking: { service: "Revisión dental" },
        },
      },
      clinicSettings: {
        timezone: "America/Tegucigalpa",
      },
    } as any);

    assert(result);
    assertEquals((result as any).replyText, "__CHECK_REQUESTED_AVAILABILITY__");
    assertEquals(((result as any).statePatch?.collected ?? {}).service, "Limpieza dental");
    assertEquals(((result as any).statePatch?.collected ?? {}).preferred_date, "2026-05-11");
    assertEquals(((result as any).statePatch?.collected ?? {}).preferred_time, "08:00");
  } finally {
    Date.now = realDateNow;
  }
});

Deno.test("reschedule datetime: misma fecha pero a las 11 keeps active date", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "misma fecha pero a las 11",
    leadState: {
      stage: "BOOKING",
      nextExpected: "reschedule_datetime",
      collected: {
        active_appointment: {
          id: "appt-1",
          appointment_date: "2026-05-15",
          appointment_time: "08:00",
        },
      },
    },
  } as any);
  assert(result);
  assertEquals((result as any).replyText, "__CHECK_RESCHEDULE_AVAILABILITY__");
  assertEquals(((result as any).statePatch?.collected ?? {}).reschedule_date, "2026-05-15");
  assertEquals(((result as any).statePatch?.collected ?? {}).reschedule_time, "11:00");
});

Deno.test("reschedule weekday/day mismatch asks clarification", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "jueves 15 a las 11",
    leadState: {
      stage: "BOOKING",
      nextExpected: "reschedule_datetime",
      collected: {},
    },
  } as any);
  assert(result);
  assert(String((result as any).replyText).includes("Quiero confirmar la fecha"));
});

Deno.test("pending reschedule confirmation + hours question interrupts confirmation", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "a que hora abren los martes",
    leadState: {
      stage: "BOOKING",
      nextExpected: "confirm_reschedule_appointment",
      collected: {
        reschedule_date: "2026-05-15",
        reschedule_time: "15:00",
      },
    },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_reschedule_appointment");
  assert(String((result as any).replyText).includes("Sobre el cambio pendiente"));
});

Deno.test("pending booking + hours question answers and preserves pending", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "a que hora abren los martes",
    clinicSettings: {
      hours: {
        mon: { open: "08:00", close: "17:00" },
        tue: { open: "09:00", close: "17:00" },
        wed: { open: "08:00", close: "17:00" },
        thu: { open: "08:00", close: "17:00" },
        fri: { open: "08:00", close: "17:00" },
        sat: { open: "08:00", close: "15:00" },
        sun: { closed: true },
      },
    },
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: { service: "Limpieza dental", preferred_date: "2026-05-12", preferred_time: "10:00" },
    },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assert(String((result as any).replyText).includes("Sobre la cita pendiente"));
  assert(String((result as any).replyText).includes("9:00 AM"));
});

Deno.test("pending confirm + correction with explicit date/time does not book immediately", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "lo quiero para el lunes 11 no el 18 a las 8",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Limpieza dental",
        preferred_date: "2026-05-18",
        preferred_time: "08:00",
        pending_booking: { id: "pb-1" },
      },
    },
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).replyText, "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
});

Deno.test("pending booking + pricing question answers and preserves pending", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "cuanto cuesta la limpieza",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: { service: "Limpieza dental", preferred_date: "2026-05-12", preferred_time: "10:00" },
    },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assert(String((result as any).replyText).toLowerCase().includes("depende del caso"));
});

Deno.test("pending booking + location question answers and preserves pending", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "donde estan ubicados",
    clinicSettings: { address: "Barrio Centro, Tegucigalpa" },
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: { service: "Limpieza dental", preferred_date: "2026-05-12", preferred_time: "10:00" },
    },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assert(String((result as any).replyText).includes("Barrio Centro"));
});

Deno.test("pending booking + date time change recalculates availability", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "mejor el viernes a las 10",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: { service: "Limpieza dental", preferred_date: "2026-05-12", preferred_time: "10:00" },
    },
  } as any);
  assertEquals((result as any).replyText, "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result as any).statePatch?.collected?.preferred_time, "10:00");
});

Deno.test("pending booking + service change updates service and does not confirm", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "mejor limpieza",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: { service: "Ortodoncia / brackets", preferred_date: "2026-05-12", preferred_time: "10:00" },
    },
  } as any);
  assertEquals((result as any).replyText, "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result as any).statePatch?.collected?.service, "Limpieza dental");
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("pending booking + si confirms", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "si",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: { service: "Limpieza dental", preferred_date: "2026-05-12", preferred_time: "10:00" },
    },
  } as any);
  assertEquals((result as any).toolAction?.name, "book_appointment");
});

Deno.test("pending reschedule + misma fecha pero a las 11 recalculates", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "misma fecha pero a las 11",
    leadState: {
      stage: "BOOKING",
      nextExpected: "confirm_reschedule_appointment",
      collected: {
        active_appointment: { id: "appt-1", appointment_date: "2026-05-15", appointment_time: "08:00" },
        reschedule_date: "2026-05-15",
        reschedule_time: "08:00",
      },
    },
  } as any);
  assertEquals((result as any).replyText, "__CHECK_RESCHEDULE_AVAILABILITY__");
  assertEquals((result as any).statePatch?.collected?.reschedule_time, "11:00");
});

Deno.test("pending booking + unknown interruption does not confirm", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "ok pero contame algo",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: { service: "Limpieza dental", preferred_date: "2026-05-12", preferred_time: "10:00" },
    },
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(String((result as any).replyText).includes("Solo para no confundirme"));
});
