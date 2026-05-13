import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import { runConversationEngine } from "../conversationEngine.ts";
import { resolveDentalServiceInfo, mergeDentalServiceTemplates } from "../domain/serviceInfoHandler.ts";

const clinicSettings = {
  timezone: "America/Tegucigalpa",
  services: mergeDentalServiceTemplates([]),
};

Deno.test("pricing brackets does not route to old menu", () => {
  const info = resolveDentalServiceInfo({
    message: "el costo de brackets",
    clinicSettings,
  });
  if (!info.matched) throw new Error("expected pricing match");
  assertStringIncludes(info.replyText.toLowerCase(), "ortodoncia");
  assertStringIncludes(info.replyText.toLowerCase(), "costo puede variar");
  assertEquals(info.replyText.includes("costo aproximado"), false);
});

Deno.test("unknown service never uses Nuevo servicio", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero nuevo servicio",
    leadState: { stage: "BOOKING", nextExpected: "service", collected: {} },
    clinicSettings,
  });
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(collected.service, "Revisión dental");
});

Deno.test("No at confirmation asks change detail", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "no",
    leadState: {
      stage: "BOOKING",
      nextExpected: "confirm_booking",
      collected: { service: "Limpieza dental", preferred_date: "2026-04-29", preferred_time: "10:00" },
    },
    clinicSettings,
  });
  assertEquals(result?.statePatch?.nextExpected, "change_booking_detail");
  assertStringIncludes((result?.replyText ?? "").toLowerCase(), "cambiar el día");
});

Deno.test("quiero cambiar el día clears preferred_date", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero cambiar el día",
    leadState: {
      stage: "BOOKING",
      nextExpected: "change_booking_detail",
      collected: { service: "Limpieza dental", preferred_date: "2026-04-29", preferred_time: "10:00" },
    },
    clinicSettings,
  });
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(collected.preferred_date, null);
  assertEquals(collected.preferred_time, "10:00");
});

Deno.test("ok gracias after booked does not reopen booking", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "ok gracias",
    leadState: {
      stage: "BOOKED",
      collected: { preferred_date: "2026-04-29", preferred_time: "10:00", confirmed: true },
    },
    clinicSettings,
  });
  assertEquals(result?.statePatch?.stage, "BOOKED");
  assertEquals(result?.statePatch?.nextExpected, undefined);
  assertStringIncludes((result?.replyText ?? "").toLowerCase(), "te esperamos");
});

Deno.test("repeated yes after booked does not attempt new booking", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "sí",
    leadState: {
      stage: "BOOKED",
      collected: { preferred_date: "2026-04-29", preferred_time: "10:00", confirmed: true },
    },
    clinicSettings,
  });
  assertEquals(result?.toolAction, undefined);
  assertStringIncludes((result?.replyText ?? "").toLowerCase(), "ya está confirmada");
});

Deno.test("service info keeps service and booking continues without asking service again", () => {
  const bookingTurn = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "sí me gustaría una cita mañana",
    leadState: {
      stage: "DISCOVERY",
      nextExpected: "service_info_or_booking",
      collected_name: true,
      full_name: "Jose Duran",
      collected: {
        service: "Ortodoncia / brackets",
      },
      lastIntent: "service_info",
    } as any,
    clinicSettings,
  });
  assertEquals(bookingTurn?.statePatch?.stage, "BOOKING");
  assertEquals(bookingTurn?.statePatch?.nextExpected, "date_time");
  assertEquals((bookingTurn?.statePatch?.collected as any)?.service, "Ortodoncia / brackets");
  assertEquals(bookingTurn?.replyText, "__SHOW_AVAILABILITY_FOR_DATE__");
});

Deno.test("confirm stage another time request returns nearby alternatives flow", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "No, ocupo otra hora",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Ortodoncia / brackets",
        preferred_date: "2026-04-29",
        preferred_time: "10:00",
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.toolAction, undefined);
  assertEquals(result?.replyText, "__SHOW_NEARBY_TIME_ALTERNATIVES__");
  assertEquals(result?.statePatch?.stage, "BOOKING");
  assertEquals(result?.statePatch?.nextExpected, "date_time");
});
