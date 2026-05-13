import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import { runConversationEngine } from "../conversationEngine.ts";
import { mergeDentalServiceTemplates } from "../domain/serviceInfoHandler.ts";

const clinicSettings = {
  timezone: "America/Tegucigalpa",
  services: mergeDentalServiceTemplates([]),
};

Deno.test("availability flow: time without date asks for date", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero limpieza a las 10",
    leadState: { stage: "DISCOVERY", collected: {} },
    clinicSettings,
  });
  assertEquals(result?.statePatch?.stage, "BOOKING");
  assertEquals(result?.statePatch?.nextExpected, "date_time");
  assertStringIncludes((result?.replyText ?? "").toLowerCase(), "para qué día");
  assertStringIncludes((result?.replyText ?? ""), "10:00");
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(collected.preferred_time, "10:00");
  assertEquals(Boolean(collected.preferred_date), false);
});

Deno.test("availability flow: bare time in date_time step asks for date", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "a las 10",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Limpieza dental" },
    },
    clinicSettings,
  });
  assertEquals(result?.statePatch?.nextExpected, "date_time");
  assertStringIncludes((result?.replyText ?? "").toLowerCase(), "para qué día");
  assertStringIncludes((result?.replyText ?? ""), "10:00");
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(collected.preferred_time, "10:00");
  assertEquals(Boolean(collected.preferred_date), false);
});

Deno.test("availability flow: date+time goes to exact check", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero limpieza mañana a las 10",
    leadState: { stage: "DISCOVERY", collected: {} },
    clinicSettings,
  });
  assertEquals(result?.statePatch?.stage, "CONFIRMING");
  assertEquals(result?.statePatch?.nextExpected, "confirm_booking");
  assertEquals(result?.replyText, "__CHECK_REQUESTED_AVAILABILITY__");
});

Deno.test("availability flow: date without time asks for slots on that day", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero limpieza mañana",
    leadState: { stage: "DISCOVERY", collected: {} },
    clinicSettings,
  });
  assertEquals(result?.statePatch?.stage, "BOOKING");
  assertEquals(result?.statePatch?.nextExpected, "date_time");
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY_FOR_DATE__");
});

Deno.test("mañana resolves to local tomorrow in clinic timezone", () => {
  const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: clinicSettings.timezone }));
  const tomorrow = new Date(nowLocal);
  tomorrow.setDate(nowLocal.getDate() + 1);
  const expected = new Intl.DateTimeFormat("en-CA", {
    timeZone: clinicSettings.timezone as string,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(tomorrow);
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "mañana",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Limpieza dental" },
    },
    clinicSettings,
  });
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(collected.preferred_date, expected);
});

Deno.test("complaint about mañana acknowledges and explains no slots", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "pero yo te pedí mañana",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Ortodoncia / brackets",
        unavailable_requested_date: "2026-04-29",
        nearest_available_date: "2026-04-30",
        nearest_available_time: "09:00",
        nearest_available_day_label: "jueves 30 de abril",
      },
    },
    clinicSettings,
  });
  const reply = (result?.replyText ?? "").toLowerCase();
  assertStringIncludes(reply, "tenés razón");
  assertStringIncludes(reply, "pediste mañana");
  assertStringIncludes(reply, "no tengo espacios disponibles");
});

Deno.test("nearest alternative: yes accepts nearest slot", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "sí",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Ortodoncia / brackets",
        unavailable_requested_date: "2026-04-29",
        nearest_available_date: "2026-04-30",
        nearest_available_time: "09:00",
        nearest_available_day_label: "jueves 30 de abril",
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result?.statePatch?.collected as any)?.preferred_date, "2026-04-30");
  assertEquals((result?.statePatch?.collected as any)?.preferred_time, "09:00");
});

Deno.test("nearest alternative: no asks for another day", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "no, otro día",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Ortodoncia / brackets",
        unavailable_requested_date: "2026-04-29",
        nearest_available_date: "2026-04-30",
        nearest_available_time: "09:00",
      },
    } as any,
    clinicSettings,
  });
  assertStringIncludes((result?.replyText ?? "").toLowerCase(), "qué día te gustaría");
  assertEquals(result?.statePatch?.nextExpected, "date_time");
});

Deno.test("pending offered slot: yes continues with offered monday slot, not friday", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "si",
    leadState: {
      stage: "BOOKING",
      nextExpected: "confirm_offered_slot",
      collected: {
        service: "Revisión dental",
        preferred_date: "2026-05-11",
        preferred_time: "07:00",
        pending_offered_slot: {
          service: "Revisión dental",
          appointment_date: "2026-05-11",
          appointment_time: "08:00",
          starts_at: "2026-05-11T08:00:00",
          source: "nearest_available_alternative",
          set_at: new Date().toISOString(),
        },
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result?.statePatch?.collected as any)?.preferred_date, "2026-05-11");
  assertEquals((result?.statePatch?.collected as any)?.preferred_time, "08:00");
  assertEquals(String(result?.replyText ?? "").includes("viernes"), false);
  assertEquals(String(result?.replyText ?? "").includes("8 de mayo"), false);
});

Deno.test("pending offered slot also works when nextExpected is date_time", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "si",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "date_time",
      collected: {
        service: "Revisión dental",
        pending_offered_slot: {
          service: "Revisión dental",
          appointment_date: "2026-05-11",
          appointment_time: "08:00",
          starts_at: "2026-05-11T08:00:00",
          source: "nearest_available_alternative",
          set_at: new Date().toISOString(),
        },
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result?.statePatch?.collected as any)?.preferred_date, "2026-05-11");
  assertEquals((result?.statePatch?.collected as any)?.preferred_time, "08:00");
  assertEquals(String(result?.replyText ?? "").includes("Gracias por escribirnos"), false);
  assertEquals(String(result?.replyText ?? "").includes("Buscas agendar una cita"), false);
});

Deno.test("availability inquiry after service selected routes to real availability", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "qué días tiene disponible?",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Revisión dental",
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("availability inquiry singular without accent routes to real availability", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "que dia tienes disponible?",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("availability inquiry variant: que dia tiene disponible", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "qué día tiene disponible?",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("booking fallback does not repeat manana prompt", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "no entendí",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  const reply = (result?.replyText ?? "").toLowerCase();
  assertStringIncludes(reply, "voy a revisar horarios para revisión dental");
  assertEquals(reply.includes("mañana o prefieres otro día"), false);
});

Deno.test("service selected + ver horarios routes to __SHOW_AVAILABILITY__", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "ver horarios",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("service selected + ver horarios disponibles routes to __SHOW_AVAILABILITY__", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "ver horarios disponibles",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("availability inquiry phrase: que horas tienes disponibles", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "que horas tienes disponibles",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("availability inquiry phrase with typo: que horas tienees disponibles", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "que horas tienees disponibles",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("availability inquiry phrase: horas disponibles", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "horas disponibles",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("availability inquiry phrase: tienes horarios?", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "tienes horarios?",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("availability inquiry phrase: que horas hay disponibles?", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "que horas hay disponibles?",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("service context + typo phrase qie otros dkas tenes routes to availability", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "qie otros dkas tenes",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Ortodoncia / brackets" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("service context + en la semana routes to availability", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "que horarios tenes en la semana",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Ortodoncia / brackets" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("hours phrasing with service asks appointment availability, not clinic hours", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "Solo dime qué horarios tienes para brackets",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("cancel intent does not fall into booking fallback", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero cancelar",
    leadState: {
      stage: "BOOKED",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__");
  assertEquals(result?.statePatch?.nextExpected, "confirm_cancel_appointment");
});

Deno.test("confirmed appointment flow entry: quiero cancelar asks for cancel lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero cancelar mi cita",
    leadState: {
      stage: "BOOKED",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__");
  assertEquals(result?.statePatch?.nextExpected, "confirm_cancel_appointment");
});

Deno.test("after BOOKED: Que cita tengo routes to active appointment lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "Que cita tengo?",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("after BOOKED: qué cita tengo does not fallback to generic greeting", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "qué cita tengo?",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
  assertEquals(String(result?.replyText ?? "").includes("Gracias por escribirnos"), false);
});

Deno.test("after BOOKED: a qué hora es mi cita routes to active appointment lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "a qué hora es mi cita?",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("after BOOKED: confirmame mi cita routes to active appointment lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "confirmame mi cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("after BOOKED: que cita teng typo routes to active appointment lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "que cita teng",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("after BOOKED: me podes recordar cual es la cita que tengo routes to active appointment lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "ok me podes recordar cual es la cita que tengo",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
  assertEquals(String(result?.replyText ?? "").includes("Tu cita ya está confirmada"), false);
});

Deno.test("after BOOKED: para que fecha quedo mi cita routes to active appointment lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "para que fecha quedo mi cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("after BOOKED: para qué fecha quedó mi cita routes to active appointment lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "para qué fecha quedó mi cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("after BOOKED: cuando quedo mi cita routes to active appointment lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "cuando quedo mi cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("after BOOKED: a que hora quedo mi cita routes to active appointment lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "a que hora quedo mi cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("after BOOKED: que dia quedo mi cita routes to active appointment lookup", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "que dia quedo mi cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("pending booking + cancelar keeps cancel route and avoids generic fallback", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero cancelar",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Revisión dental",
        pending_booking: {
          service: "Revisión dental",
          offered_date: "2026-05-08",
          offered_time: "15:00",
          status: "pending_confirmation",
        },
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__");
  assertEquals(result?.statePatch?.nextExpected, "confirm_cancel_appointment");
});

Deno.test("friday at 3pm keeps requested weekday in parsed preferred date", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "para el viernes a las 3 pm",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Revisión dental",
      },
    } as any,
    clinicSettings,
  });
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  const preferredDate = String(collected.preferred_date ?? "");
  const d = new Date(`${preferredDate}T12:00:00`);
  assertEquals(d.getDay(), 5);
  assertEquals(String(collected.preferred_time ?? ""), "15:00");
});

Deno.test("weekday parsing supports lunes-martes-miercoles-jueves-viernes-sabado at 3 pm", () => {
  const dayToJs: Record<string, number> = {
    lunes: 1,
    martes: 2,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sábado: 6,
  };
  for (const day of Object.keys(dayToJs)) {
    const result = runConversationEngine({
      organizationId: "dentalconnect-demo",
      inboundText: `${day} a las 3 pm`,
      leadState: {
        stage: "BOOKING",
        nextExpected: "date_time",
        collected: { service: "Revisión dental" },
      } as any,
      clinicSettings,
    });
    const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
    const preferredDate = String(collected.preferred_date ?? "");
    const d = new Date(`${preferredDate}T12:00:00`);
    assertEquals(d.getDay(), dayToJs[day]);
    assertEquals(String(collected.preferred_time ?? ""), "15:00");
  }
});

Deno.test("weekday parsing variants for martes time formats", () => {
  for (const phrase of ["martes 3 pm", "martes a las 15:00", "martes a las tres"]) {
    const result = runConversationEngine({
      organizationId: "dentalconnect-demo",
      inboundText: phrase,
      leadState: {
        stage: "BOOKING",
        nextExpected: "date_time",
        collected: { service: "Revisión dental" },
      } as any,
      clinicSettings,
    });
    const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
    const preferredDate = String(collected.preferred_date ?? "");
    const d = new Date(`${preferredDate}T12:00:00`);
    assertEquals(d.getDay(), 2);
    assertEquals(String(collected.preferred_time ?? ""), "15:00");
  }
});

Deno.test("cta context after pricing: yes continues orthodontics evaluation booking", () => {
  const first = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "cuánto valen los brackets?",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  const firstCollected = (first?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(String(first?.statePatch?.stage ?? ""), "BOOKING");
  assertEquals(String(first?.statePatch?.nextExpected ?? ""), "date_time");
  assertEquals((firstCollected.last_cta as any)?.type, "schedule_service");

  const second = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "sí",
    leadState: {
      stage: first?.statePatch?.stage,
      nextExpected: first?.statePatch?.nextExpected,
      collected: firstCollected,
    } as any,
    clinicSettings,
  });
  const reply = String(second?.replyText ?? "").toLowerCase();
  assertStringIncludes(reply, "voy a revisar horarios para evaluación de ortodoncia / brackets");
  assertEquals(reply.includes("gracias por escribirnos"), false);
});

Deno.test("typo normalization: revicion dental maps to revision dental service", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "revicion dental",
    leadState: {
      stage: "BOOKING",
      nextExpected: "service",
      collected: {},
    } as any,
    clinicSettings,
  });
  const reply = (result?.replyText ?? "").toLowerCase();
  assertStringIncludes(reply, "revisión dental");
  assertEquals(result?.statePatch?.stage, "BOOKING");
  assertEquals(result?.statePatch?.nextExpected, "date_time");
});

Deno.test("reschedule intent: quiero reagendarla after BOOKED routes to reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero reagendarla",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  assertEquals(result?.statePatch?.nextExpected, "reschedule_datetime");
});

Deno.test("reschedule intent: quiero reagendar after BOOKED routes to reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero reagendar",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  assertEquals(result?.statePatch?.nextExpected, "reschedule_datetime");
});

Deno.test("reschedule typo intent: qquiero reagendar mi cita routes to reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "qquiero reagendar mi cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  assertEquals(result?.statePatch?.nextExpected, "reschedule_datetime");
});

Deno.test("reschedule intent: cambiarla after BOOKED routes to reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "cambiarla",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  assertEquals(result?.statePatch?.nextExpected, "reschedule_datetime");
});

Deno.test("reschedule intent: Sabes que reagendame la cita after BOOKED routes to reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "Sabes que reagendame la cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  assertEquals(result?.statePatch?.nextExpected, "reschedule_datetime");
});

Deno.test("reschedule intent: Reagendame la cita after BOOKED routes to reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "Reagendame la cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  assertEquals(result?.statePatch?.nextExpected, "reschedule_datetime");
});

Deno.test("reschedule intent: Teagenda mi cita after BOOKED routes to reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "Teagenda mi cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  assertEquals(result?.statePatch?.nextExpected, "reschedule_datetime");
});

Deno.test("BOOKED + combined reschedule command does not fake confirmation", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "si reagendala para el viernes a las 3",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  assertEquals(String(result?.replyText ?? "").includes("Tu cita ya está confirmada"), false);
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(String(collected.reschedule_time ?? ""), "15:00");
});

Deno.test("reschedule intent: reagenda mi cita after BOOKED routes to reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "reagenda mi cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  assertEquals(result?.statePatch?.nextExpected, "reschedule_datetime");
});

Deno.test("reschedule intent: reagendame mi cita after BOOKED routes to reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "reagendame mi cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  assertEquals(result?.statePatch?.nextExpected, "reschedule_datetime");
});

Deno.test("reschedule datetime typo: vierrnes a las 3 parses Friday 15:00", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "vierrnes a las 3",
    leadState: {
      stage: "BOOKING",
      nextExpected: "reschedule_datetime",
      collected: {},
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_RESCHEDULE_AVAILABILITY__");
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  const d = new Date(`${String(collected.reschedule_date ?? "")}T12:00:00`);
  assertEquals(d.getDay(), 5);
  assertEquals(String(collected.reschedule_time ?? ""), "15:00");
});

Deno.test("reschedule datetime typo phrase: para el vierrnes e a las 3 parses Friday 15:00", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "para el vierrnes e a las 3",
    leadState: {
      stage: "BOOKING",
      nextExpected: "reschedule_datetime",
      collected: {},
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_RESCHEDULE_AVAILABILITY__");
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  const d = new Date(`${String(collected.reschedule_date ?? "")}T12:00:00`);
  assertEquals(d.getDay(), 5);
  assertEquals(String(collected.reschedule_time ?? ""), "15:00");
});

Deno.test("reschedule datetime phrase: viernes 3 parses Friday 15:00", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "viernes 3",
    leadState: {
      stage: "BOOKING",
      nextExpected: "reschedule_datetime",
      collected: {},
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_RESCHEDULE_AVAILABILITY__");
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  const d = new Date(`${String(collected.reschedule_date ?? "")}T12:00:00`);
  assertEquals(d.getDay(), 5);
  assertEquals(String(collected.reschedule_time ?? ""), "15:00");
});

Deno.test("reschedule datetime phrase: viernes a las tres parses Friday 15:00", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "viernes a las tres",
    leadState: {
      stage: "BOOKING",
      nextExpected: "reschedule_datetime",
      collected: {},
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_RESCHEDULE_AVAILABILITY__");
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  const d = new Date(`${String(collected.reschedule_date ?? "")}T12:00:00`);
  assertEquals(d.getDay(), 5);
  assertEquals(String(collected.reschedule_time ?? ""), "15:00");
});

Deno.test("BOOKED + reagendala para mañana a las 9 routes with parsed new slot", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "reagendala para mañana a las 9",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(String(collected.reschedule_time ?? ""), "09:00");
});

Deno.test("reschedule_datetime + manana a las 9 routes to availability check", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "manana a las 9",
    leadState: {
      stage: "BOOKING",
      nextExpected: "reschedule_datetime",
      collected: {},
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_RESCHEDULE_AVAILABILITY__");
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(String(collected.reschedule_time ?? ""), "09:00");
});

Deno.test("reschedule_datetime + mañana a las 9 routes to availability check", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "mañana a las 9",
    leadState: {
      stage: "BOOKING",
      nextExpected: "reschedule_datetime",
      collected: {},
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_RESCHEDULE_AVAILABILITY__");
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(String(collected.reschedule_time ?? ""), "09:00");
});

Deno.test("reschedule_datetime + mañana asks missing time", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "mañana",
    leadState: {
      stage: "BOOKING",
      nextExpected: "reschedule_datetime",
      collected: {},
    } as any,
    clinicSettings,
  });
  const reply = String(result?.replyText ?? "").toLowerCase();
  assertStringIncludes(reply, "hora");
  assertEquals(result?.replyText === "__CHECK_RESCHEDULE_AVAILABILITY__", false);
});

Deno.test("combined reschedule command stores new slot flag", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "si reagendala para manana a las 9",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(Boolean(collected.reschedule_from_message), true);
});

Deno.test("pending reschedule + Confirmar triggers reschedule action route", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "Confirmar",
    leadState: {
      stage: "BOOKING",
      nextExpected: "confirm_reschedule_appointment",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Ortodoncia / brackets",
        },
        reschedule_date: "2026-05-08",
        reschedule_time: "15:00",
        pending_reschedule: {
          status: "pending_confirmation",
        },
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.toolAction?.name, "reschedule_appointment");
});

Deno.test("incomplete datetime: sabado a las asks for missing time", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "sabado a las",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  const reply = String(result?.replyText ?? "").toLowerCase();
  assertStringIncludes(reply, "hora");
  assertEquals(result?.replyText === "__CHECK_REQUESTED_AVAILABILITY__", false);
});

Deno.test("incomplete datetime: viernes a las asks for missing time", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "viernes a las",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  const reply = String(result?.replyText ?? "").toLowerCase();
  assertStringIncludes(reply, "hora");
});

Deno.test("Saturday context availability follow-up keeps Saturday date", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "mejor dime que horarios tienes",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Revisión dental",
        preferred_date: "2026-05-09",
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY_FOR_DATE__");
});

Deno.test("pending booking confirm stage + availability ask shows alternatives instead of yes/no guard", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "Que horas tienes mejor",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Ortodoncia / brackets",
        preferred_date: "2026-05-09",
        preferred_time: "11:00",
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY_FOR_DATE__");
});

Deno.test("business hours question still routes to clinic hours", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "a qué hora abren",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: {
      ...clinicSettings,
      hours: {
        mon: { closed: false, open: "08:00", close: "17:00" },
      },
    },
  });
  const reply = String(result?.replyText ?? "").toLowerCase();
  assertStringIncludes(reply, "nuestro horario");
});

Deno.test("appointment lookup phrase variant routes to active appointment check", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "para que fecha quedo mi cita?",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("third-party appointment asks for patient name", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero una cita para mi hijo",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "nombre de tu hijo");
  assertEquals(result?.statePatch?.nextExpected, "patient_name_for");
});

Deno.test("third-party initial message preserves service/date/time before asking patient name", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero una limpieza para mi hijo mañana a las 10",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "nombre de tu hijo");
  assertEquals(result?.statePatch?.nextExpected, "patient_name_for");
  assertStringIncludes(String(collected.service ?? "").toLowerCase(), "limpieza");
  assertEquals(Boolean(collected.preferred_date), true);
  assertEquals(String(collected.preferred_time ?? ""), "10:00");
  assertEquals(String(collected.appointment_for_relation ?? ""), "hijo");
});

Deno.test("third-party patient name resumes preconfirm without asking date/time again", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "Mateo",
    leadState: {
      stage: "BOOKING",
      nextExpected: "patient_name_for",
      collected: {
        service: "Limpieza dental",
        preferred_date: "2026-05-08",
        preferred_time: "10:00",
        appointment_for_relation: "hijo",
      },
    } as any,
    clinicSettings,
  });
  const reply = String(result?.replyText ?? "");
  const lower = reply.toLowerCase();
  const collected = (result?.statePatch?.collected ?? {}) as Record<string, unknown>;
  assertEquals(String(collected.patient_name ?? ""), "Mateo");
  assertEquals(result?.statePatch?.nextExpected, "confirm_booking");
  assertEquals(result?.statePatch?.stage, "CONFIRMING");
  assertEquals(lower.includes("querés ver horarios disponibles"), false);
  assertEquals(lower.includes("tenés un día específico en mente"), false);
  assertEquals(lower.includes("gracias por escribirnos"), false);
  assertStringIncludes(lower, "mateo");
  assertStringIncludes(lower, "confirmamos la cita");
});

Deno.test("greeting uses clinic_name from settings", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "hola",
    leadState: { stage: "INITIAL", full_name: "Jose Perez", collected_name: true, collected: {} } as any,
    clinicSettings: {
      ...clinicSettings,
      clinic_name: "Clínica Dental Sonría",
    },
  });
  assertStringIncludes(String(result?.replyText ?? ""), "Bienvenido a Clínica Dental Sonría");
});

Deno.test("greeting fallback without clinic_name uses la clínica", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "hola",
    leadState: { stage: "INITIAL", full_name: "Jose Perez", collected_name: true, collected: {} } as any,
    clinicSettings: {
      ...clinicSettings,
      clinic_name: "",
      business_name: "",
      name: "",
    },
  });
  assertStringIncludes(String(result?.replyText ?? ""), "Bienvenido a la clínica");
});

Deno.test("BOOKED confirmation text uses appointment lookup, not raw confirmed text", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "sí",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("third-party confirm booking tool payload uses patient_name from collected", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "Confirmar",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Limpieza dental",
        preferred_date: "2026-05-08",
        preferred_time: "10:00",
        patient_name: "Mateo",
        appointment_for_relation: "hijo",
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.toolAction?.name, "book_appointment");
  assertEquals(String(result?.toolAction?.payload?.patient_name ?? ""), "Mateo");
  assertEquals(String(result?.toolAction?.payload?.appointment_for_relation ?? ""), "hijo");
  assertEquals(String(result?.toolAction?.payload?.patient_name ?? "") === "Jose Duran", false);
});

Deno.test("normal booking confirm keeps lead name as patient when self", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "Confirmar",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      full_name: "Jose Duran",
      collected: {
        service: "Limpieza dental",
        preferred_date: "2026-05-08",
        preferred_time: "10:00",
        appointment_for_relation: "self",
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.toolAction?.name, "book_appointment");
  assertEquals(String(result?.toolAction?.payload?.patient_name ?? ""), "Jose Duran");
});

Deno.test("state correction clears stale offered slot and asks for fresh date/time", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "pero no te he dado fecha ni hora",
    leadState: {
      stage: "BOOKING",
      nextExpected: "confirm_offered_slot",
      collected: {
        service: "Revisión dental",
        preferred_date: "2026-05-11",
        preferred_time: "08:00",
        pending_offered_slot: {
          appointment_date: "2026-05-11",
          appointment_time: "08:00",
          set_at: new Date().toISOString(),
        },
      },
    } as any,
    clinicSettings,
  });
  assertStringIncludes(String(result?.replyText ?? ""), "¿Qué día y hora preferís");
  assertEquals(((result?.statePatch?.collected as any)?.pending_offered_slot ?? null), null);
  assertEquals(((result?.statePatch?.collected as any)?.preferred_date ?? null), null);
  assertEquals((result?.statePatch?.collected as any)?.preferred_time, null);
});

Deno.test("expired pending_offered_slot does not auto-use stale slot on yes", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "si",
    leadState: {
      stage: "BOOKING",
      nextExpected: "confirm_offered_slot",
      collected: {
        service: "Revisión dental",
        pending_offered_slot: {
          appointment_date: "2026-05-11",
          appointment_time: "08:00",
          set_at: "2020-01-01T00:00:00.000Z",
        },
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "Perfecto. ¿Qué día y hora te queda mejor?");
  assertEquals((result?.statePatch?.nextExpected as any), "date_time");
});

Deno.test("new emergency clears stale booking slot context", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "me duele mucho una muela y tengo la cara inflamada",
    leadState: {
      stage: "BOOKING",
      nextExpected: "confirm_offered_slot",
      collected: {
        service: "Revisión dental",
        pending_offered_slot: {
          appointment_date: "2026-05-11",
          appointment_time: "08:00",
          set_at: new Date().toISOString(),
        },
      },
    } as any,
    clinicSettings,
  });
  assertEquals(String(result?.replyText ?? "").length > 0, true);
  assertEquals(((result?.statePatch?.collected as any)?.pending_offered_slot ?? null), null);
  assertEquals(((result?.statePatch?.collected as any)?.preferred_date ?? null), null);
});

Deno.test("durable preferred_hours only suggests and does not preconfirm slot", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero agendar una cita",
    leadState: {
      stage: "DISCOVERY",
      full_name: "Jose Duran",
      collected_name: true,
      collected: { preferred_hours: "mañana" },
    } as any,
    clinicSettings,
  });
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "preferiste horarios por la mañana");
  assertEquals(String(result?.replyText ?? "").includes("está disponible"), false);
});

Deno.test("after cancellation + generic new booking does not auto-reuse old service", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "si busco una cita",
    leadState: {
      stage: "DISCOVERY",
      nextExpected: undefined,
      collected: {
        service: null,
        last_discussed_service: null,
        last_appointment_summary: {
          service: "Revisión dental",
          status: "cancelled",
        },
      },
    } as any,
    clinicSettings,
  });
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "qué tipo de cita");
  assertEquals(String(result?.replyText ?? "").toLowerCase().includes("voy a revisar horarios"), false);
});

Deno.test("after cancellation + horarios without active service asks service first", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "que horarios tenes",
    leadState: {
      stage: "DISCOVERY",
      collected: {
        service: null,
        last_discussed_service: null,
        last_appointment_summary: {
          service: "Revisión dental",
          status: "cancelled",
        },
      },
    } as any,
    clinicSettings,
  });
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "qué tipo de cita");
});

Deno.test("explicit another review can use review service", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "otra revisión dental",
    leadState: {
      stage: "DISCOVERY",
      collected: {
        service: null,
        last_discussed_service: null,
      },
    } as any,
    clinicSettings,
  });
  assertStringIncludes(String(((result?.statePatch as any)?.collected?.service ?? "")).toLowerCase(), "revisión dental");
});

Deno.test("lo mismo de antes can reuse historical service as suggestion context", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "lo mismo de antes",
    leadState: {
      stage: "DISCOVERY",
      collected: {
        last_appointment_summary: {
          service: "Revisión dental",
          status: "cancelled",
        },
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.statePatch?.nextExpected, "date_time");
  assertStringIncludes(String(((result?.statePatch as any)?.collected?.service ?? "")).toLowerCase(), "revisión dental");
});

Deno.test("emergency sets active review service and urgent context", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "me duele mucho una muela y tengo la cara inflamada",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.statePatch?.stage, "BOOKING");
  assertEquals(result?.statePatch?.nextExpected, "date_time");
  assertEquals((result?.statePatch?.collected as any)?.service, "Revisión dental");
  assertEquals((result?.statePatch?.collected as any)?.emergency, true);
  assertEquals((result?.statePatch?.collected as any)?.priority, "urgent");
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "cita prioritaria");
});

Deno.test("date/time after emergency does not ask service again", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "mañana a las 7",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Revisión dental",
        emergency: true,
        priority: "urgent",
        booking_reason: "me duele mucho una muela y tengo la cara inflamada",
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals(String(result?.replyText ?? "").includes("Qué tipo de cita necesitás"), false);
});

Deno.test("after cancel symptom mention reactivates review dental flow", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "sí, sigo con dolor de muela",
    leadState: {
      stage: "DISCOVERY",
      collected: {
        last_appointment_summary: {
          service: "Revisión dental",
          status: "cancelled",
        },
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.statePatch?.nextExpected, "date_time");
  assertEquals((result?.statePatch?.collected as any)?.service, "Revisión dental");
});

Deno.test("horarios with active emergency service can show availability", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "que horarios tenes?",
    leadState: {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Revisión dental",
        emergency: true,
        priority: "urgent",
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__SHOW_AVAILABILITY__");
});

Deno.test("tengo picado el diente activates review dental booking flow", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "tengo picado el diente",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.statePatch?.stage, "BOOKING");
  assertEquals(result?.statePatch?.nextExpected, "date_time");
  assertEquals((result?.statePatch?.collected as any)?.service, "Revisión dental");
});

Deno.test("triage message + date/time in same turn checks availability", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "tengo picado el diente mañana a las 7",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result?.statePatch?.collected as any)?.service, "Revisión dental");
});

Deno.test("triage message then date/time next turn does not ask service again", () => {
  const first = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "tengo picado el diente",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  const second = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "mañana a las 7",
    leadState: {
      stage: (first?.statePatch?.stage as any) ?? "BOOKING",
      nextExpected: (first?.statePatch?.nextExpected as any) ?? "date_time",
      collected: (first?.statePatch?.collected as any) ?? { service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(second?.replyText, "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals(String(second?.replyText ?? "").includes("Qué tipo de cita necesitás"), false);
});

Deno.test("teengo picado el diente typo activates review dental booking flow", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "teengo picado el diente",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  assertEquals((result?.statePatch?.collected as any)?.service, "Revisión dental");
});

Deno.test("tengo una caries activates review dental booking flow", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "tengo una caries",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  assertEquals((result?.statePatch?.collected as any)?.service, "Revisión dental");
});

Deno.test("se me picó una muela activates review dental booking flow", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "se me picó una muela",
    leadState: { stage: "DISCOVERY", collected: {} } as any,
    clinicSettings,
  });
  assertEquals((result?.statePatch?.collected as any)?.service, "Revisión dental");
});

Deno.test("active appointment + que horarios tienen asks clarify reschedule or additional", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "que horarios tienen",
    leadState: {
      stage: "BOOKED",
      collected: {
        service: "Revisión dental",
        active_appointment: {
          id: "appt-1",
          status: "confirmed",
          reason: "Revisión dental",
          starts_at: "2026-05-09T10:00:00",
        },
      },
    } as any,
    clinicSettings,
  });
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "ya tenés una cita confirmada");
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "agregar esto a esa cita");
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "más pronto");
});

Deno.test("active appointment + me duele la encia asks add/reschedule/additional", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "me duele la encía",
    leadState: {
      stage: "BOOKED",
      collected: {
        service: "Revisión dental",
        active_appointment: {
          id: "appt-1",
          status: "confirmed",
          reason: "Revisión dental",
          starts_at: "2026-05-09T10:00:00",
        },
      },
    } as any,
    clinicSettings,
  });
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "ya tenés una cita confirmada");
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "agregar esto a esa cita");
  assertEquals(result?.statePatch?.nextExpected, "active_appointment_intent_choice");
});

Deno.test("active appointment + quiero brackets asks additional/change", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero brackets",
    leadState: {
      stage: "BOOKED",
      collected: {
        service: "Revisión dental",
        active_appointment: {
          id: "appt-1",
          status: "confirmed",
          reason: "Revisión dental",
          starts_at: "2026-05-09T10:00:00",
        },
      },
    } as any,
    clinicSettings,
  });
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "ya tenés una cita confirmada");
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "cita adicional");
});

Deno.test("active appointment + buscar más pronto enters reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "buscar más pronto",
    leadState: {
      stage: "BOOKED",
      collected: {
        service: "Revisión dental",
        active_appointment: {
          id: "appt-1",
          status: "confirmed",
          reason: "Revisión dental",
          starts_at: "2026-05-09T10:00:00",
        },
      },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
});

Deno.test("active appointment + agregarlo a mi cita stores note in state patch", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "agregarlo a mi cita",
    leadState: {
      stage: "BOOKING",
      nextExpected: "active_appointment_intent_choice",
      collected: {
        service: "Revisión dental",
        active_appointment: {
          id: "appt-1",
          status: "confirmed",
          reason: "Revisión dental",
          starts_at: "2026-05-09T10:00:00",
        },
      },
    } as any,
    clinicSettings,
  });
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "lo agrego como nota");
  assertEquals((result?.statePatch?.collected as any)?.appointment_note_for_id, "appt-1");
});

Deno.test("active appointment + quiero otro horario enters reschedule", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "quiero otro horario",
    leadState: {
      stage: "BOOKING",
      nextExpected: "active_appointment_intent_choice",
      collected: { active_appointment: { id: "appt-1", status: "confirmed" }, service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__");
});

Deno.test("active appointment + otra cita para mi hijo enters third-party new booking", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "otra cita para mi hijo",
    leadState: {
      stage: "BOOKING",
      nextExpected: "active_appointment_intent_choice",
      full_name: "Jose",
      collected_name: true,
      collected: { active_appointment: { id: "appt-1", status: "confirmed" }, service: "Revisión dental" },
    } as any,
    clinicSettings,
  });
  assertEquals(result?.statePatch?.nextExpected, "service");
  assertStringIncludes(String(result?.replyText ?? "").toLowerCase(), "qué tipo de cita");
});

Deno.test("revisarla after appointment CTA routes to lookup details", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "revisarla",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("verla routes to lookup details", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "verla",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("detalles de la cita routes to lookup details", () => {
  const result = runConversationEngine({
    organizationId: "dentalconnect-demo",
    inboundText: "detalles de la cita",
    leadState: { stage: "BOOKED", collected: {} } as any,
    clinicSettings,
  });
  assertEquals(result?.replyText, "__CHECK_ACTIVE_APPOINTMENT__");
});
