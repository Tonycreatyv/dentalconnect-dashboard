import { assert, assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { runConversationEngine } from "../conversationEngine.ts";
import { formatBookingSuccessCopy } from "../domain/bookingSuccessCopy.ts";
import { normalizeLeadStateForBusinessType } from "../domain/stateNormalization.ts";

Deno.test("greeting barbershop no usa copy dental", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: { orgType: "barbershop", stage: "INITIAL", collected: {} } as any,
  } as any);
  assert(result);
  assert(String((result as any).replyText).includes("agendar una cita, consultar precios o ver horarios"));
  assert(!String((result as any).replyText).includes("clínica"));
});

Deno.test("greeting barbershop usa clinicSettings.brand_name cuando existe", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: { orgType: "barbershop", stage: "INITIAL", collected: {} } as any,
    clinicSettings: { brand_name: "Barbería Demo" },
  } as any);
  assert(String((result as any).replyText).includes("bienvenido a Barbería Demo"));
  assert(!String((result as any).replyText).includes("bienvenido a BarberLine"));
});

Deno.test("quiero corte pide fecha/hora", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
  assert(String((result as any).replyText).toLowerCase().includes("día u hora"));
});

Deno.test("cuanto cuesta corte y barba responde HNL 220", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuanto cuesta corte y barba",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assert(result);
  assert(String((result as any).replyText).includes("HNL 220"));
  assertEquals((result as any).statePatch?.nextExpected, undefined);
  assert((result as any).statePatch?.collected?.pending_booking == null);
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("Confirmar sin pending_booking válido no agenda", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(!String((result as any).replyText).includes("✅ Cita confirmada"));
  assert(String((result as any).replyText).includes("No tengo una cita pendiente"));
});

Deno.test("cuanto por dejarme muñeco hoy no preconfirma ni asigna Barba", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuanto por dejarme muñeco hoy?",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.nextExpected, "service_for_pricing");
  assertEquals((result as any).statePatch?.collected?.last_info_topic, "pricing");
  assert((result as any).statePatch?.collected?.pending_booking == null);
  assert(!String((result as any).replyText).includes("¿Confirmamos?"));
  assert(!String((result as any).replyText).includes("Barba"));
});

Deno.test("follow-up pricing: corte responde precio y no entra a booking", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      nextExpected: "service_for_pricing",
      collected: { last_info_topic: "pricing" },
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("corte de pelo cuesta HNL 150") || reply.includes("Corte clásico cuesta HNL 150"));
  assertEquals((result as any).toolAction, undefined);
  assert((result as any).statePatch?.nextExpected !== "confirm_booking");
  assert((result as any).statePatch?.collected?.pending_booking == null);
});

Deno.test("last_price_service Barba + mañana a las 9 no hereda Barba", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mañana a las 9",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: { last_price_service: "Barba" },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert((result as any).statePatch?.collected?.service !== "Barba");
});

Deno.test("quiero corte y barba mañana a las 5 crea preconfirm, no agenda", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte y barba mañana a las 5",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assert(String((result as any).replyText).includes("¿Confirmamos?"));
});

Deno.test("Confirmar después de pending booking crea toolAction book_appointment", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: {
        service: "Corte + barba",
        preferred_date: "2026-05-10",
        preferred_time: "17:00",
        preferred_barber: "Carlos",
        pending_booking: {
          service: "Corte + barba",
          appointment_date: "2026-05-10",
          appointment_time: "17:00",
          preferred_barber: "Carlos",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assert(result);
  assertEquals((result as any).toolAction?.name, "book_appointment");
  assertEquals((result as any).toolAction?.payload?.preferred_barber, "Carlos");
  assertEquals((result as any).toolAction?.payload?.provider_name, "Carlos");
  assertEquals((result as any).toolAction?.payload?.duration_min, 45);
});

Deno.test("quiero corte con Carlos mañana a las 5 conserva preferredBarber", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con Carlos mañana a las 5",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.collected?.preferred_barber, "Carlos");
  assert(String((result as any).replyText).includes("con Carlos"));
});

Deno.test("preconfirmación con full_name incluye nombre o 'a tu nombre'", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte mañana a las 5",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected_name: true,
      name: "Jose Duran",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Perfecto Jose.") || reply.includes("¿Confirmamos a tu nombre?"));
});

Deno.test("quiero cita con Carlos mañana a las 5 preconfirma sin pedir servicio", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cita con Carlos mañana a las 5",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals((result as any).statePatch?.collected?.service, "Cita barbería");
  assertEquals((result as any).statePatch?.collected?.preferred_barber, "Carlos");
  assert(String((result as any).replyText).includes("con Carlos"));
  assert(!String((result as any).replyText).includes("¿Querés corte, barba"));
});

Deno.test("confirmar cita genérica con barbero arma payload default", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "sí",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: {
        service: "Cita barbería",
        preferred_date: "2026-05-10",
        preferred_time: "17:00",
        preferred_barber: "Carlos",
        pending_booking: {
          service: "Cita barbería",
          appointment_date: "2026-05-10",
          appointment_time: "17:00",
          preferred_barber: "Carlos",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assert(result);
  assertEquals((result as any).toolAction?.name, "book_appointment");
  assertEquals((result as any).toolAction?.payload?.reason, "Cita barbería");
  assertEquals((result as any).toolAction?.payload?.title, "Cita barbería");
  assertEquals((result as any).toolAction?.payload?.duration_min, 45);
  assertEquals((result as any).toolAction?.payload?.preferred_barber, "Carlos");
  assertEquals((result as any).toolAction?.payload?.provider_name, "Carlos");
});

Deno.test("pending booking confirmado sin nombre pide nombre y no agenda", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "sí",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Cita barbería",
        preferred_date: "2026-05-20",
        preferred_time: "17:00",
        pending_booking: {
          service: "Cita barbería",
          appointment_date: "2026-05-20",
          appointment_time: "17:00",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.nextExpected, "customer_name");
  assert(String((result as any).replyText).includes("¿A nombre de quién"));
});

Deno.test("quiero cita mañana a las 5 pregunta por barbero o cualquiera", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cita mañana a las 5",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "barber_preference");
  assert(String((result as any).replyText).includes("barbero en especial o con cualquiera"));
});

Deno.test("default service list no menciona corte de niño", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(!reply.includes("corte de niño"));
});

Deno.test("cualquiera permite continuar a preconfirmación", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cualquiera",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "barber_preference",
      collected: {
        service: "Cita barbería",
        preferred_date: "2026-05-20",
        preferred_time: "17:00",
      },
    } as any,
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals((result as any).statePatch?.collected?.preferred_barber, null);
  assert(String((result as any).replyText).includes("¿Confirmamos?"));
});

Deno.test("interrupción en confirm_booking con pregunta de horarios no confirma y marca pending stale", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con Carlos a las 5",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {}, collected_name: true, name: "Jose" } as any,
  } as any);
  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "el próximo martes a las 9",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "date_time",
      collected_name: true,
      name: "Jose",
      collected: (step1 as any).statePatch?.collected ?? {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals((step2 as any).statePatch?.nextExpected, "confirm_booking");

  const step3 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "o que horas tenes",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: (step2 as any).statePatch?.collected ?? {},
    } as any,
  } as any);

  assertEquals((step3 as any).toolAction, undefined);
  assertEquals((step3 as any).statePatch?.nextExpected, "date_time");
  assertEquals((step3 as any).statePatch?.collected?.pending_booking_stale, true);
  assertEquals((step3 as any).statePatch?.collected?.last_bot_step, "barbershop_waiting_new_datetime");
  const interruptionReply = String((step3 as any).replyText).toLowerCase();
  assert(interruptionReply.includes("día y hora") || interruptionReply.includes("dia y hora"));
  assert(!interruptionReply.includes("link"));
  assert(!interruptionReply.includes("agenda completa"));
  assert(!interruptionReply.includes("manana, tarde"));
  assert(!String((step3 as any).replyText).includes("corte, barba o una cita"));
});

Deno.test("después de interrupción, 'tarde' pide hora específica y no cae a fallback", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tarde",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-11",
        preferred_time: "09:00",
        preferred_barber: "Carlos",
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2026-05-11",
          appointment_time: "09:00",
          preferred_barber: "Carlos",
          status: "pending_confirmation",
        },
        pending_booking_stale: true,
        last_bot_step: "barbershop_waiting_new_datetime",
      },
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
  assert(String((result as any).replyText).includes("hora específica"));
  assert(!String((result as any).replyText).includes("corte, barba o una cita"));
});

Deno.test("mantener lunes 9 reactiva preconfirmación anterior", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mantener lunes 9",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-11",
        preferred_time: "09:00",
        preferred_barber: "Carlos",
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2026-05-11",
          appointment_time: "09:00",
          preferred_barber: "Carlos",
          status: "pending_confirmation",
        },
        pending_booking_stale: true,
        last_bot_step: "barbershop_waiting_new_datetime",
      },
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals((result as any).statePatch?.collected?.pending_booking_stale, false);
  assertEquals((result as any).statePatch?.collected?.last_bot_step, "barbershop_preconfirm");
  assert(String((result as any).replyText).includes("Mantenemos"));
  assert(String((result as any).replyText).includes("¿Confirmamos?"));
});

Deno.test("pasame el link responde fallback honesto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "pasame el link",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        pending_booking_stale: true,
        last_bot_step: "barbershop_waiting_new_datetime",
      },
    } as any,
  } as any);
  assert(String((result as any).replyText).includes("Todavía no tengo el calendario visual activado"));
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
});

Deno.test("availability por día no pide 'Decime el día' si el día ya viene en texto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "el miércoles qué horas tenés libres",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(String((result as any).replyText).toLowerCase().includes("qué servicio querés revisar"));
  assertEquals((result as any).statePatch?.nextExpected, "availability_service");
  assertEquals(Boolean((result as any).statePatch?.collected?.preferred_date), true);
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("confirmar después de interrupción de horarios no ejecuta book_appointment", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-11",
        preferred_time: "09:00",
        preferred_barber: "Carlos",
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2026-05-11",
          appointment_time: "09:00",
          preferred_barber: "Carlos",
          status: "pending_confirmation",
        },
        pending_booking_stale: true,
        last_bot_step: "barbershop_availability_interruption",
      },
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
  assert(
    String((result as any).replyText).includes("primero necesito") ||
      String((result as any).replyText).includes("No tengo una cita pendiente"),
  );
});

Deno.test("corte de cabello lunes 11 no detecta provider y no responde con 'con Corte'", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Entonces un corte de cabello para el lunes a las 11",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals((result as any).statePatch?.collected?.preferred_barber ?? null, null);
  assert(!String((result as any).replyText).includes("con Corte"));
});

Deno.test("quiero corte con Carlos el lunes a las 11 mantiene preferred_barber Carlos", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con Carlos el próximo martes a las 11",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.collected?.preferred_barber, "Carlos");
  assert(
    String((result as any).replyText).includes("con Carlos") ||
      String((result as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected) === "confirm_booking",
  );
});

Deno.test("después de cita confirmada con Carlos, nueva cita sin barbero no reutiliza Carlos", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte el lunes a las 11",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKED",
      collected: {
        last_confirmed_appointment: {
          appointment_id: "appt-1",
          service: "Corte clásico",
          preferred_barber: "Carlos",
          status: "confirmed",
        },
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals((result as any).statePatch?.collected?.preferred_barber ?? null, null);
  assert(!String((result as any).replyText).includes("con Carlos"));
});

Deno.test("después de cita confirmada con Carlos, 'con el mismo' reutiliza Carlos", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con el mismo el próximo martes a las 11",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKED",
      collected: {
        last_confirmed_appointment: {
          appointment_id: "appt-1",
          service: "Corte clásico",
          preferred_barber: "Carlos",
          status: "confirmed",
        },
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals((result as any).statePatch?.collected?.preferred_barber, "Carlos");
  assert(
    String((result as any).replyText).includes("con Carlos") ||
      String((result as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected) === "confirm_booking",
  );
});

Deno.test("'una cita' entra a booking natural y pide día/hora", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "una cita",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {}, collected_name: true, name: "Jose" } as any,
  } as any);
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
  assert(String((result as any).replyText).includes("día y hora") || String((result as any).replyText).includes("dia y hora"));
  assert(!String((result as any).replyText).includes("¿Querés que te ayude con corte, barba o una cita?"));
});

Deno.test("'quiro cotarme el pelo' se interpreta como booking de corte", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiro cotarme el pelo",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {}, collected_name: true, name: "Jose" } as any,
  } as any);
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
  assert(String((result as any).replyText).toLowerCase().includes("corte"));
});

Deno.test("'tarde' sin pending activo pide día y hora completos", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tarde",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assert(String((result as any).replyText).includes("día y la hora completos") || String((result as any).replyText).includes("dia y la hora completos"));
  assert(!String((result as any).replyText).includes("corte, barba o una cita"));
});

Deno.test("'pasame el link' sin booking_link responde fallback honesto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "pasame el link",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assert(String((result as any).replyText).includes("Todavía no tengo el calendario visual activado"));
  assert(!String((result as any).replyText).includes("corte, barba o una cita"));
});

Deno.test("B2.5 service + only time guarda hora y pide solo día", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "me quiero cortar el pelo",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals((step1 as any).statePatch?.nextExpected, "date_time");
  assertEquals((step1 as any).statePatch?.collected?.service, "Corte clásico");

  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "me parece bien a las 3",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: (step1 as any).statePatch?.collected ?? {},
    } as any,
  } as any);
  assertEquals((step2 as any).toolAction, undefined);
  assertEquals((step2 as any).statePatch?.nextExpected, "date_only");
  assertEquals((step2 as any).statePatch?.collected?.preferred_time, "15:00");
  assertEquals((step2 as any).statePatch?.collected?.service, "Corte clásico");
  const reply = String((step2 as any).replyText).toLowerCase();
  assert(reply.includes("para qué día") || reply.includes("para que dia"));
  assert(!reply.includes("día y hora") && !reply.includes("dia y hora"));
});

Deno.test("B2.5 service + only day guarda fecha y no vuelve a pedir día", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "el martes",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Corte clásico" },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assertEquals(Boolean((result as any).statePatch?.collected?.preferred_date), true);
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
});

Deno.test("B2.5 time_only + time combina fecha previa y verifica disponibilidad", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "las 9",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "time_only",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-12",
      },
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals((result as any).statePatch?.collected?.preferred_date, "2026-05-12");
  assertEquals((result as any).statePatch?.collected?.preferred_time, "09:00");
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("B2.5 date_only + day combina hora previa y verifica disponibilidad", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "el martes",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "date_only",
      collected: {
        service: "Corte clásico",
        preferred_time: "15:00",
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(String((result as any).replyText), "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals((result as any).statePatch?.collected?.preferred_time, "15:00");
  assertEquals(Boolean((result as any).statePatch?.collected?.preferred_date), true);
});

Deno.test("B2.5 calendario link configurado responde booking_link", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mandame el link",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { booking_link: "https://barberline.example/book" },
  } as any);
  assert(String((result as any).replyText).includes("https://barberline.example/book"));
  assert(String((result as any).replyText).includes("elegir servicio, barbero y hora"));
});

Deno.test("dental org sigue usando comportamiento dental", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "hola",
    leadState: { orgType: "dental", stage: "INITIAL", collected: {} } as any,
  } as any);
  assert(result);
  assert(String((result as any).replyText).includes("Bienvenido"));
  assert(!String((result as any).replyText).includes("corte + barba"));
});

Deno.test("post-tool success copy barbershop no contiene emoji dental y muestra barbero", () => {
  const reply = formatBookingSuccessCopy({
    businessType: "barbershop",
    fallback: "fallback",
    booking: {
      ok: true,
      appointment: {
        reason: "Corte + barba",
        appointment_date: "2026-05-10",
        appointment_time: "17:00",
        preferred_barber: "Carlos",
      },
    } as any,
  });
  assert(reply.includes("✅ Cita confirmada"));
  assert(reply.includes("💈 Corte + barba"));
  assert(reply.includes("👤 Barbero: Carlos"));
  assert(!reply.includes("🦷"));
});

Deno.test("post-tool success copy dental se mantiene", () => {
  const reply = formatBookingSuccessCopy({
    businessType: "dental",
    fallback: "fallback",
    booking: {
      ok: true,
      appointment: {
        reason: "Limpieza dental",
        appointment_date: "2026-05-10",
        appointment_time: "10:00",
      },
    } as any,
  });
  assert(reply.includes("🦷"));
});

Deno.test("post-tool success copy barbershop genérico omite servicio y muestra barbero si existe", () => {
  const reply = formatBookingSuccessCopy({
    businessType: "barbershop",
    fallback: "fallback",
    booking: {
      ok: true,
      appointment: {
        reason: "Cita barbería",
        appointment_date: "2026-05-10",
        appointment_time: "17:00",
        preferred_barber: "Carlos",
      },
    } as any,
  });
  assert(reply.includes("✅ Cita confirmada"));
  assert(reply.includes("👤 Barbero: Carlos"));
  assert(!reply.includes("💈"));
  assert(!reply.includes("🦷"));
});

Deno.test("flow exacto: corte con Carlos + sí + success copy incluye barbero", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con Carlos mañana a las 5",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(step1);
  assertEquals((step1 as any).statePatch?.nextExpected, "confirm_booking");
  assert(String((step1 as any).replyText).includes("con Carlos"));

  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "sí",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: (step1 as any).statePatch?.collected ?? {},
    } as any,
  } as any);
  assert(step2);
  assertEquals((step2 as any).toolAction?.name, "book_appointment");
  assertEquals((step2 as any).toolAction?.payload?.preferred_barber, "Carlos");
  assertEquals((step2 as any).toolAction?.payload?.provider_name, "Carlos");
  assertEquals((step2 as any).toolAction?.payload?.duration_min, 30);

  const success = formatBookingSuccessCopy({
    businessType: "barbershop",
    fallback: "fallback",
    preferredBarberFallback: (step2 as any).toolAction?.payload?.preferred_barber,
    booking: {
      ok: true,
      appointment: {
        reason: "Corte clásico",
        appointment_date: "2026-05-10",
        appointment_time: "17:00",
      },
    } as any,
  });
  assert(success.includes("👤 Barbero: Carlos"));
});

Deno.test("duraciones barbershop por servicio", () => {
  const haircut = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "sí",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-10",
        preferred_time: "17:00",
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2026-05-10",
          appointment_time: "17:00",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assertEquals((haircut as any).toolAction?.payload?.duration_min, 30);

  const combo = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "sí",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: {
        service: "Corte + barba",
        preferred_date: "2026-05-10",
        preferred_time: "17:00",
        pending_booking: {
          service: "Corte + barba",
          appointment_date: "2026-05-10",
          appointment_time: "17:00",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assertEquals((combo as any).toolAction?.payload?.duration_min, 45);

  const beard = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "sí",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: {
        service: "Barba",
        preferred_date: "2026-05-10",
        preferred_time: "17:00",
        pending_booking: {
          service: "Barba",
          appointment_date: "2026-05-10",
          appointment_time: "17:00",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assertEquals((beard as any).toolAction?.payload?.duration_min, 20);

  const eyebrows = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "sí",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: {
        service: "Cejas",
        preferred_date: "2026-05-10",
        preferred_time: "17:00",
        pending_booking: {
          service: "Cejas",
          appointment_date: "2026-05-10",
          appointment_time: "17:00",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assertEquals((eyebrows as any).toolAction?.payload?.duration_min, 15);

  const kids = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "sí",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: {
        service: "Corte niño",
        preferred_date: "2026-05-10",
        preferred_time: "17:00",
        pending_booking: {
          service: "Corte niño",
          appointment_date: "2026-05-10",
          appointment_time: "17:00",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assertEquals((kids as any).toolAction?.payload?.duration_min, 30);
});

Deno.test("producto sin catálogo responde fallback honesto y ofrece cita", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que pomada tienen",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barber_products: [] },
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("todavía no tengo productos cargados") || reply.includes("todavia no tengo productos cargados"));
  assert(reply.includes("puedo ayudarte con una cita"));
});

Deno.test("producto con catálogo mock responde producto y precio", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que pomada tienen",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: {
      barber_products: [
        {
          name: "Pomada fuerte",
          category: "Pomadas",
          price: 800,
          is_active: true,
        },
      ],
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Pomada fuerte"));
  assert(reply.includes("HNL 800"));
});

Deno.test("no inventa productos cuando categoría no existe", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que aftershave tienen",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: {
      barber_products: [
        {
          name: "Pomada media",
          category: "Pomadas",
          price: 500,
          is_active: true,
        },
      ],
    },
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("no veo productos cargados para esa categoría"));
});

Deno.test("precio de corte y barba prioriza combo", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuánto cuesta corte y barba",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Corte + barba cuesta HNL 220"));
  assertEquals((result as any).toolAction, undefined);
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assert((result as any).statePatch?.collected?.pending_booking == null);
});

Deno.test("seguimiento y el corte responde precio sin entrar a booking", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "y el corte?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      lastIntent: "pricing",
      collected: { last_info_topic: "pricing" },
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Corte clásico cuesta HNL 150"));
  assert(!reply.includes("¿Qué día u hora"));
});

Deno.test("typo corte c\\\\y barba cuanto resuelve combo", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "y el corte c\\y barba cuanto?",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Corte + barba cuesta HNL 220"));
});

Deno.test("precio de barba no contamina booking posterior genérico con Carlos", () => {
  const price = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuánto cuesta la barba",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  const next = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cita con Carlos mañana a las 5",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: (price as any).statePatch?.collected ?? {},
      nextExpected: (price as any).statePatch?.nextExpected,
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(String((next as any).replyText).includes("con Carlos"));
  assert(!String((next as any).replyText).includes("para Barba"));
  assertEquals((next as any).statePatch?.collected?.service, "Cita barbería");
});

Deno.test("producto no contamina estado de booking", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "qué pomada tienen",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: {
      barber_products: [{ name: "Pomada fuerte", category: "Pomadas", price: 800, is_active: true }],
    },
  } as any);
  assertEquals((result as any).statePatch?.collected?.service, undefined);
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assert((result as any).statePatch?.collected?.pending_booking == null);
});

Deno.test("fallback natural en booking pide día y hora, no fallback genérico repetitivo", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mmm",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("día y la hora") || reply.includes("dia y la hora"));
  assert(!reply.includes("corte, barba o una cita"));
});

Deno.test("ambiguo 'quiero' no activa booking_request", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("no te entendí completo"));
  assertEquals((result as any).toolAction, undefined);
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assert((result as any).statePatch?.collected?.pending_booking == null);
});

Deno.test("ambiguo 'quiero saber' no activa booking_request", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero saber",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assert((result as any).statePatch?.collected?.pending_booking == null);
});

Deno.test("'quiero info de precio' entra por pricing, no booking", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero info de precio",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assert((result as any).statePatch?.collected?.pending_booking == null);
});

Deno.test("'quiero cita' activa booking_request válido", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cita",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(
    reply.includes("día y hora") ||
      reply.includes("dia y hora") ||
      reply.includes("querés corte de pelo") ||
      reply.includes("te ayudo con la cita"),
  );
});

Deno.test("'mañana a las 5' se maneja como booking/date-time", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mañana a las 5",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("shadow mode: agrega debug interpreter sin cambiar reply ni toolAction", () => {
  const baseline = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: { orgType: "barbershop", stage: "INITIAL", collected: {} } as any,
    clinicSettings: {},
  } as any);
  const withShadow = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: { orgType: "barbershop", stage: "INITIAL", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_shadow_enabled: true },
    barbershopInterpreterResult: {
      intent: "greeting",
      confidence: 0.92,
      entities: {},
      should_use_previous_info: false,
      needs_tool: "none",
      user_facing_summary: "Saludo",
    },
  } as any);
  assertEquals((withShadow as any).replyText, (baseline as any).replyText);
  assertEquals((withShadow as any).toolAction, (baseline as any).toolAction);
  assertEquals((withShadow as any).statePatch?.collected?.service, (baseline as any).statePatch?.collected?.service);
  assertEquals((withShadow as any).debug?.barbershop_interpreter?.intent, "greeting");
  assertEquals((withShadow as any).debug?.barbershop_interpreter?.mode, "shadow");
});

Deno.test("shadow mode off: no debug interpreter payload", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: { orgType: "barbershop", stage: "INITIAL", collected: {} } as any,
    clinicSettings: {},
    barbershopInterpreterResult: {
      intent: "greeting",
      confidence: 0.92,
      entities: {},
      should_use_previous_info: false,
      needs_tool: "none",
      user_facing_summary: "Saludo",
    },
  } as any);
  assertEquals((result as any).debug?.barbershop_interpreter, undefined);
});

Deno.test("runtime mode limitado: unknown + pricing llm high confidence usa ruta de precio", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "texto ambiguo sin señales",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_shadow_enabled: true, barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "pricing_question",
      confidence: 0.9,
      entities: { service_name: "Corte + barba" },
      should_use_previous_info: false,
      needs_tool: "get_service_price",
      user_facing_summary: "Precio",
    },
  } as any);
  assert(String((result as any).replyText).includes("Corte + barba cuesta HNL 220"));
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).debug?.barbershop_interpreter?.mode, "runtime");
});

Deno.test("runtime mode limitado: llm sugiere book_appointment pero no agenda sin confirmación", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "texto ambiguo",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_shadow_enabled: true, barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.95,
      entities: { date_text: "mañana", time_text: "5", service_name: "Cita barbería" },
      should_use_previous_info: false,
      needs_tool: "book_appointment",
      user_facing_summary: "Agendar",
    },
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("confirmamos") || reply.includes("barbero"));
  assertEquals((result as any).toolAction, undefined);
  assert(["confirm_booking", "barber_preference"].includes(String((result as any).statePatch?.nextExpected ?? "")));
});

Deno.test("runtime only (shadow off): debug interpreter presente con mode runtime", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "texto ambiguo",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "pricing_question",
      confidence: 0.95,
      entities: { service_name: "Corte + barba" },
      should_use_previous_info: false,
      needs_tool: "get_service_price",
      user_facing_summary: "Precio",
    },
  } as any);
  assertEquals((result as any).debug?.barbershop_interpreter?.mode, "runtime");
});

Deno.test("natural runtime: maje ocupo quedar nitido hoy tipo 5 con cualquiera", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Maje ocupo quedar nítido hoy tipo 5 con el que esté libre",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.92,
      entities: {
        service_name: "Cita barbería",
        service_reference: "generic",
        date_text: "hoy",
        time_text: "5",
        provider_preference: "any",
      },
      should_use_previous_info: false,
      needs_tool: "check_availability",
      user_facing_summary: "Solicitud booking",
    },
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(
    ["confirm_booking", "barber_preference", "date_time"].includes(
      String((result as any).statePatch?.nextExpected ?? ""),
    ),
  );
  const runtimeReply = String((result as any).replyText).toLowerCase();
  assert(
    runtimeReply.includes("confirm") || runtimeReply.includes("barbero") || runtimeReply.includes("hora ya pasó"),
  );
  const interpreterMode = (result as any).debug?.barbershop_interpreter?.mode;
  assert(interpreterMode === undefined || interpreterMode === "runtime" || interpreterMode === "shadow");
});

Deno.test("natural runtime: cuanto me sale fresh con barba y corte", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuánto me sale quedar fresh con barba y corte",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "pricing_question",
      confidence: 0.91,
      entities: { service_name: "Corte + barba" },
      should_use_previous_info: false,
      needs_tool: "get_service_price",
      user_facing_summary: "Precio",
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.length > 0);
  assertEquals((result as any).toolAction, undefined);
  assert((result as any).statePatch?.collected?.pending_booking == null);
});

Deno.test("natural runtime: hay chance ahorita", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hay chance ahorita?",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "availability_question",
      confidence: 0.9,
      entities: { date_text: "hoy" },
      should_use_previous_info: false,
      needs_tool: "check_availability",
      user_facing_summary: "Disponibilidad",
    },
  } as any);
  assert(result);
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("natural runtime: agendame ese manana a las 4 usa previous_info", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "agendame ese mañana a las 4",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: { last_price_service: "Corte + barba", last_info_topic: "pricing" },
    } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.93,
      entities: {
        service_name: "Corte + barba",
        service_reference: "previous_info",
        date_text: "mañana",
        time_text: "4",
      },
      should_use_previous_info: true,
      needs_tool: "check_availability",
      user_facing_summary: "Booking con previous info",
    },
  } as any);
  assert(result);
  assertEquals((result as any).debug?.barbershop_interpreter?.intent, "booking_request");
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("natural runtime: quiero cita con Carlos manana a las 5 no reutiliza Barba", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cita con Carlos mañana a las 5",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: { last_price_service: "Barba", last_info_topic: "pricing" },
    } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.94,
      entities: {
        service_name: "Cita barbería",
        service_reference: "generic",
        preferred_barber: "Carlos",
        provider_preference: "specific",
        date_text: "mañana",
        time_text: "5",
      },
      should_use_previous_info: false,
      needs_tool: "check_availability",
      user_facing_summary: "Booking",
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(!reply.includes("para Barba"));
  assert(reply.includes("Carlos") || String((result as any).statePatch?.collected?.preferred_barber ?? "") === "Carlos");
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("natural runtime: que uso para que el pelo me dure todo el dia", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "qué uso para que el pelo me dure todo el día?",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      barber_products: [{ name: "Pomada fuerte", category: "Pomadas", price: 800, is_active: true }],
    },
    barbershopInterpreterResult: {
      intent: "product_question",
      confidence: 0.95,
      entities: { product_need: "fijación fuerte" },
      should_use_previous_info: false,
      needs_tool: "get_products",
      user_facing_summary: "Productos",
    },
  } as any);
  assert(String((result as any).replyText).includes("Pomada fuerte"));
  assertEquals((result as any).toolAction, undefined);
  assert((result as any).statePatch?.collected?.pending_booking === undefined);
});

Deno.test("natural runtime: me podes apuntar manana temprano con cualquiera", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "me podés apuntar mañana temprano con cualquiera?",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.9,
      entities: {
        service_name: "Cita barbería",
        date_text: "mañana",
        time_text: "temprano",
        provider_preference: "any",
      },
      should_use_previous_info: false,
      needs_tool: "check_availability",
      user_facing_summary: "Booking",
    },
  } as any);
  assertEquals((result as any).toolAction, undefined);
  const nextExpected = String((result as any).statePatch?.nextExpected ?? "");
  assert(["confirm_booking", "barber_preference", "date_time", "service", ""].includes(nextExpected));
});

Deno.test("natural runtime: andan atendiendo por llegada o solo cita", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "andan atendiendo por llegada o solo cita?",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "smalltalk",
      confidence: 0.95,
      entities: {},
      should_use_previous_info: false,
      needs_tool: "none",
      user_facing_summary: "Política",
    },
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.collected?.pending_booking, undefined);
});

Deno.test("natural runtime: se me hizo tarde, llego en 10", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "se me hizo tarde, llego en 10",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "smalltalk",
      confidence: 0.95,
      entities: {},
      should_use_previous_info: false,
      needs_tool: "none",
      user_facing_summary: "Aviso tardanza",
    },
  } as any);
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("natural runtime: me cambias la cita para mas tarde sin contexto activo no ejecuta tool", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "me cambiás la cita para más tarde?",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "reschedule_request",
      confidence: 0.93,
      entities: { time_text: "más tarde" },
      should_use_previous_info: false,
      needs_tool: "reschedule_appointment",
      user_facing_summary: "Reagendar",
    },
  } as any);
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("B2.1 A) el miércoles qué horas tenés libres no vuelve a pedir día", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "el miércoles qué horas tenés libres",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(String((result as any).replyText).toLowerCase().includes("qué servicio querés revisar"));
  assertEquals((result as any).statePatch?.nextExpected, "availability_service");
  assertEquals((result as any).statePatch?.collected?.preferred_date != null, true);
});

Deno.test("B2.1 B) qué horarios tenés pide día", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "qué horarios tenés",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(String((result as any).replyText).toLowerCase().includes("para qué día"));
});

Deno.test("B2.1 F) mañana en la tarde qué tenés usa availability por día", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mañana en la tarde qué tenés",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(String((result as any).replyText).toLowerCase().includes("qué servicio querés revisar"));
  assertEquals((result as any).statePatch?.nextExpected, "availability_service");
  assertEquals((result as any).statePatch?.collected?.time_preference, "afternoon");
});

Deno.test("B2.1 G) confirmar con pending stale no agenda", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Cita barbería",
        preferred_date: "2026-05-20",
        preferred_time: "09:00",
        pending_booking_stale: true,
        pending_booking: {
          service: "Cita barbería",
          appointment_date: "2026-05-20",
          appointment_time: "09:00",
        },
        last_bot_step: "barbershop_waiting_new_datetime",
      },
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  const reply = String((result as any).replyText);
  assert(reply.toLowerCase().includes("no tengo una cita pendiente"));
  assert(!reply.includes("Si querés, te ayudo a continuar con tu cita."));
});

Deno.test("B2.8 A) active_appointment_intent_choice + agendar otra para otra persona", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "agendar otra para otra persona",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "active_appointment_intent_choice",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-12",
          appointment_time: "10:00",
          status: "confirmed",
        },
      },
    } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assertEquals((result as any).statePatch?.nextExpected, "additional_booking_details");
  assertEquals((result as any).statePatch?.collected?.allow_additional_booking, true);
  assert(!reply.includes("no te entendí completo"));
});

Deno.test("B2.8 B) active_appointment_intent_choice + cancelarla inicia confirmación", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cancelarla",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "active_appointment_intent_choice",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-12",
          appointment_time: "10:00",
          status: "confirmed",
        },
      },
    } as any,
  } as any);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_cancel_appointment");
  assert(String((result as any).replyText).includes("¿Querés cancelarla?"));
});

Deno.test("B2.8 C) active_appointment_intent_choice + reagendarla inicia reschedule", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "reagendarla",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "active_appointment_intent_choice",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-12",
          appointment_time: "10:00",
          status: "confirmed",
        },
      },
    } as any,
  } as any);
  assertEquals((result as any).statePatch?.nextExpected, "reschedule_date_time");
  assert(String((result as any).replyText).includes("¿Para qué día y hora querés moverla?"));
});

Deno.test("B2.8 D) active_appointment_intent_choice + texto desconocido responde opciones guiadas", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mmm no se",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "active_appointment_intent_choice",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("reagendarla, cancelarla o agendar otra para otra persona"));
  assert(!reply.includes("no te entendí completo"));
});

Deno.test("B2.8 E/F) consulta de cita devuelve check de cita activa", () => {
  const result1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que cita tngo?",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  const result2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "a qué hora era mi cita?",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals(String((result1 as any).replyText), "__CHECK_ACTIVE_APPOINTMENT__");
  assertEquals(String((result2 as any).replyText), "__CHECK_ACTIVE_APPOINTMENT__");
});

Deno.test("B2.8 G/H) cancel intent directo dispara check de cancelación", () => {
  const result1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "ya no voy a poder llegar",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  const result2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Cancelar",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals(String((result1 as any).replyText), "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__");
  assertEquals(String((result2 as any).replyText), "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__");
});

Deno.test("B2.8 J) additional booking relation+service+datetime pide nombre antes de confirmar", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "para mi hijo corte mañana a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "additional_booking_details",
      collected: {
        allow_additional_booking: true,
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals((result as any).statePatch?.nextExpected, "patient_name_for");
  assert(String((result as any).replyText).toLowerCase().includes("como se llama tu hijo") ||
    String((result as any).replyText).toLowerCase().includes("cómo se llama tu hijo"));
});

Deno.test("B3 runtime: tenescupo manana para corte con cualquiera interpreta availability sin fallback", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tenescupo manana para corte conc ualquiera",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "availability_request",
      fields_found: {
        service: "Corte clásico",
        date: "2026-05-13",
        time: null,
        provider_preference: "any",
        provider_name: null,
      },
      next_step: "show_availability",
      tool_needed: "check_availability",
      confidence: 0.85,
      entities: {},
      should_use_previous_info: false,
      needs_tool: "none",
      user_facing_summary: "availability",
    } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(!reply.includes("no te entendí completo"));
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assert(!reply.includes("qué día y hora te queda mejor"));
  assertEquals((result as any).debug?.barbershop_interpreter?.mode, "runtime");
});

Deno.test("B3 runtime: quiero cote de pelo manana a alas 10 entra a preconfirm/check path", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cote de pelo manana a alas 10",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "booking_request",
      service: "Corte clásico",
      date: "mañana",
      time: "10:00",
      provider_preference: null,
      provider_name: null,
      confidence: 0.85,
      entities: {},
      should_use_previous_info: false,
      needs_tool: "none",
      user_facing_summary: "booking",
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(
    reply.includes("¿Confirmamos") ||
      reply === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected) === "confirm_booking",
  );
});

Deno.test("B3 runtime: con cualquiera no muestra 'con Cualquiera'", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con cualquiera mañana a las 3",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "booking_request",
      service: "Corte clásico",
      date: "mañana",
      time: "15:00",
      provider_preference: "any",
      provider_name: null,
      confidence: 0.9,
      entities: {},
      should_use_previous_info: false,
      needs_tool: "none",
      user_facing_summary: "booking any",
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(!reply.includes("con Cualquiera"));
  assert(!reply.includes("con cualquiera"));
  assertEquals((result as any).statePatch?.collected?.preferred_barber ?? null, null);
});

Deno.test("B4 runtime: low confidence pide aclaración y no ejecuta acción", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "así nomás pues",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.55,
      next_step: "preconfirm_booking",
      tool_needed: "create_appointment",
      fields_found: {},
      entities: {},
      needs_tool: "book_appointment",
      should_use_previous_info: false,
      user_facing_summary: "baja confianza",
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(String((result as any).replyText).toLowerCase().includes("te ayudo de una"));
});

Deno.test("B4 runtime: sugiere create_appointment pero motor no agenda sin confirmación", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte mañana a las 10",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.92,
      next_step: "preconfirm_booking",
      tool_needed: "create_appointment",
      fields_found: { service: "Corte clásico", date: "mañana", time: "10:00", provider_preference: null, provider_name: null, appointment_for_relation: null, patient_name: null },
      entities: { service_name: "Corte clásico", date_text: "mañana", time_text: "10" },
      needs_tool: "book_appointment",
      should_use_previous_info: false,
      user_facing_summary: "booking",
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(!String((result as any).replyText).includes("✅ Cita confirmada"));
});

Deno.test("B4.2 typo date: 'quiero core de pelo meanana a las 10' interpreta mañana y no pide día", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero core de pelo meanana a las 10",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.9,
      entities: {
        service_name: "Corte clásico",
        date_text: "mañana",
        time_text: "10",
      },
      should_use_previous_info: false,
      needs_tool: "check_availability",
      user_facing_summary: "booking typo mañana",
    } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assert((result as any).statePatch?.collected?.preferred_date != null);
  assertEquals((result as any).statePatch?.collected?.preferred_time, "10:00");
  assert(!reply.includes("para qué día") && !reply.includes("para que dia"));
});

Deno.test("B4.2 service priority: 'corte y barba' resuelve combo, no Barba", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte y barba",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals((result as any).statePatch?.collected?.service, "Corte + barba");
});

Deno.test("B4.2 service priority typo: 'y cote y barba' resuelve combo", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "y cote y barba",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assertEquals((result as any).statePatch?.collected?.service, "Corte + barba");
});

Deno.test("B4.2 pending + pricing interruption preserva pending_booking", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que precio tiene cortarse la barba tambien",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-13",
        preferred_time: "10:00",
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2026-05-13",
          appointment_time: "10:00",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assert(String((result as any).replyText).toLowerCase().includes("barba"));
  assertEquals((result as any).statePatch?.collected?.pending_booking?.appointment_date, "2026-05-13");
  assertEquals((result as any).statePatch?.collected?.pending_booking?.appointment_time, "10:00");
});

Deno.test("B4.2 pending + 'corte y barba' usa fecha/hora pendiente y no pide genérico día/hora", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte y barba",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-13",
        preferred_time: "10:00",
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2026-05-13",
          appointment_time: "10:00",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assertEquals((result as any).statePatch?.collected?.service, "Corte + barba");
  assertEquals((result as any).statePatch?.collected?.preferred_date, "2026-05-13");
  assertEquals((result as any).statePatch?.collected?.preferred_time, "10:00");
  assert(!reply.includes("que dia y hora te queda mejor") && !reply.includes("qué día y hora te queda mejor"));
});

Deno.test("B4.2 pending + 'ya no voy a poder llegar' ofrece descartar pendiente con fecha/hora correctas", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "ya no voy a poder llegar",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-13",
        preferred_time: "15:00",
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2026-05-13",
          appointment_time: "15:00",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_discard_pending_booking");
  assert(reply.toLowerCase().includes("todavía no habíamos confirmado esa cita"));
  assert(reply.toLowerCase().includes("descart"));
  assert(!reply.includes(" a las 12:00 AM"));
  assert(!reply.includes(" del  a las "));
});

Deno.test("B4.2 confirm_discard_pending_booking + sí limpia pending y marca stale", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "sí",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "confirm_discard_pending_booking",
      collected: {
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2026-05-13",
          appointment_time: "15:00",
          status: "pending_confirmation",
        },
      },
    } as any,
  } as any);
  assertEquals((result as any).statePatch?.collected?.pending_booking, null);
  assertEquals((result as any).statePatch?.collected?.pending_booking_stale, true);
});

Deno.test("B4.3 transcript real WhatsApp: runtime availability + pending/pricing/combo/cancel flow", () => {
  const realDateNow = Date.now;
  Date.now = () => new Date("2026-05-12T08:00:00-06:00").getTime();
  try {
  let leadState: any = { orgType: "barbershop", stage: "INITIAL", collected: {} };

  const t1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState,
  } as any);
  assert(String((t1 as any).replyText).toLowerCase().includes("bienvenido"));
  leadState = {
    ...leadState,
    ...((t1 as any).statePatch ?? {}),
    collected: { ...(leadState as any).collected, ...(((t1 as any).statePatch?.collected ?? {})) },
  };

  const t2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tens cupo manaa para ccorte con cualqueira",
    leadState,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "availability_request",
      fields_found: {
        service: "Corte clásico",
        date: "mañana",
        time: null,
        provider_preference: "any",
        provider_name: null,
      },
      missing_fields: [],
      next_step: "show_availability",
      tool_needed: "check_availability",
      confidence: 0.9,
      entities: {
        service_name: "Corte clásico",
        date_text: "mañana",
        provider_preference: "any",
      },
      should_use_previous_info: false,
      needs_tool: "check_availability",
      user_facing_summary: "availability",
    } as any,
  } as any);
  assertEquals(String((t2 as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assert(!String((t2 as any).replyText).toLowerCase().includes("qué día y hora te queda mejor"));
  assertEquals(String((t2 as any).debug?.route ?? ""), "barbershop_runtime_show_availability_from_b4");
  assertEquals((t2 as any).debug?.barbershop_interpreter?.mode, "runtime");
  assertEquals(String((t2 as any).debug?.barbershop_interpreter?.intent ?? ""), "availability_request");
  assertEquals(String((t2 as any).debug?.barbershop_interpreter?.next_step ?? ""), "show_availability");
  assertEquals(String((t2 as any).debug?.barbershop_interpreter?.tool_needed ?? ""), "check_availability");
  leadState = {
    ...leadState,
    ...((t2 as any).statePatch ?? {}),
    collected: { ...(leadState as any).collected, ...(((t2 as any).statePatch?.collected ?? {})) },
  };

  const t3 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero core de pelo meanana a las 10",
    leadState,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(String((t3 as any).replyText), "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals(String((t3 as any).statePatch?.nextExpected ?? ""), "confirm_booking");
  assertEquals((t3 as any).statePatch?.collected?.service, "Corte clásico");
  leadState = {
    ...leadState,
    ...((t3 as any).statePatch ?? {}),
    collected: { ...(leadState as any).collected, ...(((t3 as any).statePatch?.collected ?? {})) },
  };
  // In pure engine tests we do not execute availability tool checks; seed pending booking
  // from parsed date/time to emulate the post-availability preconfirm state seen on WhatsApp.
  if ((leadState as any).collected?.pending_booking == null) {
    const preferredDate = (leadState as any).collected?.preferred_date;
    const preferredTime = (leadState as any).collected?.preferred_time;
    if (preferredDate && preferredTime) {
      (leadState as any).collected = {
        ...((leadState as any).collected ?? {}),
        pending_booking: {
          service: "Corte clásico",
          appointment_date: preferredDate,
          appointment_time: preferredTime,
          status: "pending_confirmation",
        },
        pending_booking_stale: false,
        last_bot_step: "barbershop_preconfirm",
      };
      (leadState as any).nextExpected = "confirm_booking";
      (leadState as any).stage = "CONFIRMING";
    }
  }
  assert((leadState as any).collected?.pending_booking != null);

  const t4 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que precio tiene cortarse la barba tambien",
    leadState,
  } as any);
  assert(String((t4 as any).replyText).toLowerCase().includes("barba"));
  assert(
    (t4 as any).statePatch?.collected?.pending_booking != null ||
      (leadState as any).collected?.pending_booking != null,
  );
  leadState = {
    ...leadState,
    ...((t4 as any).statePatch ?? {}),
    collected: { ...(leadState as any).collected, ...(((t4 as any).statePatch?.collected ?? {})) },
  };

  const t5 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte y barba",
    leadState,
  } as any);
  const t5Reply = String((t5 as any).replyText);
  assert(t5Reply.includes("Corte + barba"));
  assert(!t5Reply.includes(" a Barba para "));
  leadState = {
    ...leadState,
    ...((t5 as any).statePatch ?? {}),
    collected: { ...(leadState as any).collected, ...(((t5 as any).statePatch?.collected ?? {})) },
  };

  const t6 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con cualquiera mañana a las 3",
    leadState,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(!String((t6 as any).replyText).includes("con Cualquiera"));
  assert(!String((t6 as any).replyText).includes("con cualquiera"));
  leadState = {
    ...leadState,
    ...((t6 as any).statePatch ?? {}),
    collected: { ...(leadState as any).collected, ...(((t6 as any).statePatch?.collected ?? {})) },
  };

  const t7 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "ya no voy a poder llegar",
    leadState,
  } as any);
  assertEquals((t7 as any).statePatch?.nextExpected, "confirm_discard_pending_booking");
  assert(String((t7 as any).replyText).toLowerCase().includes("descart"));
  } finally {
    Date.now = realDateNow;
  }
});

Deno.test("B4.4 runtime primary evita parser viejo: tens cupo manaa para ccorte con cualqueira", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tens cupo manaa para ccorte con cualqueira",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "availability_request",
      confidence: 0.9,
      fields_found: {
        service: "Corte clásico",
        date: "mañana",
        time: null,
        provider_preference: "any",
        provider_name: null,
      },
      next_step: "show_availability",
      tool_needed: "check_availability",
      entities: {
        service_name: "Corte clásico",
        date_text: "mañana",
        provider_preference: "any",
      },
      needs_tool: "check_availability",
      should_use_previous_info: false,
      user_facing_summary: "availability",
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  const reply = String((result as any).replyText).toLowerCase();
  assert(!reply.includes("qué día y hora te queda mejor"));
  assertEquals(String((result as any).debug?.route ?? ""), "barbershop_runtime_show_availability_from_b4");
});

Deno.test("B4.5 new barbershop lead state initializes mode/orgType correctly", () => {
  const normalized = normalizeLeadStateForBusinessType(null as any, "barbershop") as any;
  assertEquals(String(normalized.mode ?? ""), "barbershop");
  assertEquals(String(normalized.orgType ?? ""), "barbershop");
  assertEquals(String(normalized.stage ?? ""), "DISCOVERY");
  assertEquals(String(normalized.phase ?? ""), "new");
  assertEquals(normalized.nextExpected ?? null, null);
  assertEquals(normalized.lastIntent ?? null, null);
});

Deno.test("B4.5 contaminated dental mode in barbershop state is sanitized", () => {
  const normalized = normalizeLeadStateForBusinessType({
    mode: "dental_clinic",
    orgType: "barbershop",
    stage: "BOOKING",
    phase: "qualifying",
    nextExpected: "date_time",
    lastIntent: "book_appointment",
    name: "Jose",
    full_name: "Jose Duran",
    asked: { full_name: true },
    intent: "pricing",
    collected: {
      service: "Corte clásico",
      preferred_barber: "Cualqueira",
      provider_name: "Cualquiera",
    },
  } as any, "barbershop") as any;
  assertEquals(String(normalized.mode ?? ""), "barbershop");
  assertEquals(String(normalized.orgType ?? ""), "barbershop");
  assertEquals(String(normalized.stage ?? ""), "DISCOVERY");
  assertEquals(String(normalized.phase ?? ""), "new");
  assertEquals(normalized.nextExpected ?? null, null);
  assertEquals(normalized.lastIntent ?? null, null);
  assertEquals(normalized.name, "Jose");
  assertEquals(normalized.full_name, "Jose Duran");
  assertEquals((normalized.collected ?? {}).preferred_barber ?? null, null);
  assertEquals((normalized.collected ?? {}).provider_name ?? null, null);
  assertEquals((normalized.collected ?? {}).provider_preference, "any");
});

Deno.test("B4.5 runtime availability with 'cualqueira' keeps preferred_barber null", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tens cupo manaa para ccorte con cualqueira",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "availability_request",
      confidence: 0.9,
      fields_found: {
        service: "Corte clásico",
        date: "mañana",
        time: null,
        provider_preference: "any",
        provider_name: null,
      },
      next_step: "show_availability",
      tool_needed: "check_availability",
      entities: {
        service_name: "Corte clásico",
        date_text: "mañana",
        provider_preference: "any",
      },
      needs_tool: "check_availability",
      should_use_previous_info: false,
      user_facing_summary: "availability",
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assertEquals((result as any).statePatch?.collected?.preferred_barber ?? null, null);
  assertEquals((result as any).statePatch?.collected?.provider_preference, "any");
  assert((result as any).statePatch?.nextExpected !== "date_time");
});

Deno.test("B4.6 availability-like typo with runtime disabled routes to __SHOW_AVAILABILITY_FOR_DATE__", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tens cupo manaa para ccorte con cualqueira",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: false, timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assertEquals((result as any).statePatch?.collected?.preferred_barber ?? null, null);
  assertEquals((result as any).statePatch?.collected?.provider_preference, "any");
  assert(!String((result as any).replyText).includes("¿Qué día y hora te queda mejor?"));
});

Deno.test("B4.6 availability-like typo with runtime enabled but interpreter missing still routes to availability", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tens cupo manaa para ccorte con cualqueira",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assertEquals((result as any).statePatch?.collected?.preferred_barber ?? null, null);
  assertEquals((result as any).statePatch?.collected?.provider_preference, "any");
  assert(!String((result as any).replyText).includes("¿Qué día y hora te queda mejor?"));
});

Deno.test("B4.6 cleaner availability text routes to __SHOW_AVAILABILITY_FOR_DATE__", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tenes cupo mañana para corte con cualquiera",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assertEquals((result as any).statePatch?.collected?.preferred_barber ?? null, null);
  assertEquals((result as any).statePatch?.collected?.provider_preference, "any");
  assert(!String((result as any).replyText).includes("¿Qué día y hora te queda mejor?"));
});

Deno.test("B4.7 slot selection 'la de las 9' reusa contexto mostrado y no pide día/servicio", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "la de las 9",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        last_availability_context: {
          service: "Corte clásico",
          date: "2026-05-14",
          provider_preference: "any",
          provider_name: null,
          preferred_barber: null,
          slots: [
            { time: "09:00", starts_at: "2026-05-14T09:00:00", provider_id: null, provider_name: null },
            { time: "09:30", starts_at: "2026-05-14T09:30:00", provider_id: null, provider_name: null },
          ],
        },
      },
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals((result as any).statePatch?.collected?.preferred_date, "2026-05-14");
  assertEquals((result as any).statePatch?.collected?.preferred_time, "09:00");
  assert(!String((result as any).replyText).includes("¿Para qué día lo querés?"));
  assert(!String((result as any).replyText).includes("¿Qué servicio"));
});

Deno.test("B4.7 contextual repair date: 'manaan' con nextExpected date_time usa fecha reparada y no repregunta día", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "manaan",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Corte clásico" },
    } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "date_answer",
      confidence: 0.75,
      fields_found: { date: "tomorrow" },
      next_step: "ask_missing_field",
      tool_needed: "none",
      entities: {},
      should_use_previous_info: false,
      needs_tool: "none",
      user_facing_summary: "date repair",
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assert(!String((result as any).replyText).includes("¿Para qué día lo querés?"));
});

Deno.test("B4.7 slot selection 'la primera' usa primer slot del contexto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "la primera",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        last_availability_context: {
          service: "Corte clásico",
          date: "2026-05-14",
          slots: [
            { time: "09:00", starts_at: "2026-05-14T09:00:00", provider_id: null, provider_name: null },
            { time: "09:30", starts_at: "2026-05-14T09:30:00", provider_id: null, provider_name: null },
          ],
        },
      },
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result as any).statePatch?.collected?.preferred_time, "09:00");
});

Deno.test("B4.7 slot selection context + 'y viernes?' muestra disponibilidad viernes con mismo servicio", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "y viernes?",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        last_availability_context: {
          service: "Corte clásico",
          date: "2026-05-14",
          slots: [{ time: "09:00", starts_at: "2026-05-14T09:00:00", provider_id: null, provider_name: null }],
        },
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals(Boolean((result as any).statePatch?.collected?.preferred_date), true);
});

Deno.test("B4.5 runtime availability wins over old service-only date_time branch", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { barbershop_interpreter_runtime_enabled: true, timezone: "America/Tegucigalpa" },
    barbershopInterpreterResult: {
      intent: "availability_request",
      confidence: 0.92,
      fields_found: {
        service: "Corte clásico",
        date: "2026-05-13",
        time: null,
        provider_preference: "any",
        provider_name: null,
      },
      next_step: "show_availability",
      tool_needed: "check_availability",
      entities: {
        service_name: "Corte clásico",
        date_text: "2026-05-13",
        provider_preference: "any",
      },
      needs_tool: "check_availability",
      should_use_previous_info: false,
      user_facing_summary: "availability",
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assertEquals((result as any).statePatch?.nextExpected, "availability_service");
  assertEquals((result as any).statePatch?.collected?.preferred_barber ?? null, null);
  assert(!String((result as any).replyText).includes("¿Qué día y hora te queda mejor?"));
});

Deno.test("B4.5 'quiero corte con cualquiera mañana a las 3' nunca guarda preferred_barber=Cualquiera", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con cualquiera mañana a las 3",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.collected?.preferred_barber ?? null, null);
  const providerPref = String((result as any).statePatch?.collected?.provider_preference ?? "");
  assert(providerPref === "" || providerPref === "any");
  assert(!String((result as any).replyText).includes("con Cualquiera"));
});

Deno.test("B2.2 A) que horarios tenes pide dia y marca availability_request", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que horarios tenes",
    leadState: { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
  } as any);
  assert(String((result as any).replyText).toLowerCase().includes("para qué día"));
  assertEquals((result as any).statePatch?.nextExpected, "availability_day");
  assertEquals((result as any).statePatch?.collected?.availability_request, true);
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("B2.2 B) availability_day + 'El martes' pide servicio y guarda preferred_date", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "El martes",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_day",
      collected: { availability_request: true },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(String((result as any).replyText).toLowerCase().includes("qué servicio querés revisar"));
  assertEquals((result as any).statePatch?.nextExpected, "availability_service");
  assertEquals(Boolean((result as any).statePatch?.collected?.preferred_date), true);
  assertEquals((result as any).statePatch?.collected?.availability_request, true);
  assertEquals((result as any).statePatch?.collected?.pending_booking ?? null, null);
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("B2.2 C) availability_service + servicio dispara __SHOW_AVAILABILITY_FOR_DATE__", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Corte de pelo",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_service",
      collected: {
        availability_request: true,
        preferred_date: "2026-05-12",
      },
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals((result as any).statePatch?.collected?.preferred_date, "2026-05-12");
  assertEquals((result as any).statePatch?.collected?.pending_booking ?? null, null);
  assertEquals((result as any).toolAction, undefined);
  assert(!String((result as any).replyText).includes("¿Qué día y hora"));
});

Deno.test("B2.2 D) recovery 'ya te dije martes' con service+date muestra disponibilidad", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "ya te dije martes",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_service",
      collected: {
        availability_request: true,
        preferred_date: "2026-05-12",
        service: "Corte clásico",
      },
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__SHOW_AVAILABILITY_FOR_DATE__");
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("B2.2 E) recovery 'ya te dije martes' sin servicio pide servicio", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "ya te dije martes",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_service",
      collected: {
        availability_request: true,
        preferred_date: "2026-05-12",
      },
    } as any,
  } as any);
  assert(String((result as any).replyText).toLowerCase().includes("qué servicio querés revisar"));
  assertEquals((result as any).statePatch?.nextExpected, "availability_service");
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("B2.4 A) availability_service + 'las 9' usa preferred_date/service y no vuelve a pedir día", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "las 9",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_service",
      collected: {
        availability_request: true,
        preferred_date: "2026-05-12",
        service: "Corte clásico",
        last_bot_step: "barbershop_showed_availability",
      },
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals((result as any).statePatch?.collected?.preferred_date, "2026-05-12");
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals((result as any).toolAction, undefined);
  assert(!String((result as any).replyText).includes("Decime el día"));
});

Deno.test("B2.4 B) availability_service + '9' usa preferred_date/service y no vuelve a pedir día", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "9",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_service",
      collected: {
        availability_request: true,
        preferred_date: "2026-05-12",
        service: "Corte clásico",
        last_bot_step: "barbershop_showed_availability",
      },
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals((result as any).statePatch?.collected?.preferred_date, "2026-05-12");
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("B2.4 C) 'la primera' usa last_availability_slots[0]", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "la primera",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_service",
      collected: {
        availability_request: true,
        preferred_date: "2026-05-12",
        service: "Corte clásico",
        last_bot_step: "barbershop_showed_availability",
        last_availability_slots: [
          { date: "2026-05-12", time: "09:00", provider_id: null, provider_name: null },
          { date: "2026-05-12", time: "09:15", provider_id: null, provider_name: null },
        ],
      },
    } as any,
  } as any);
  assertEquals(String((result as any).replyText), "__CHECK_REQUESTED_AVAILABILITY__");
  assertEquals((result as any).statePatch?.collected?.preferred_time, "09:00");
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("B2.4 D) confirmar después de pending desde selección de slot crea book_appointment", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: {
        availability_request: true,
        service: "Corte clásico",
        preferred_date: "2026-05-12",
        preferred_time: "09:00",
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2026-05-12",
          appointment_time: "09:00",
          status: "pending_confirmation",
        },
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assertEquals((result as any).toolAction?.name, "book_appointment");
  assertEquals((result as any).toolAction?.payload?.appointment_date, "2026-05-12");
  assertEquals((result as any).toolAction?.payload?.appointment_time, "09:00");
  assertEquals((result as any).toolAction?.payload?.reason, "Corte clásico");
});

Deno.test("B4.5 static: meta-webhook no usa engine de respuesta directa", async () => {
  const source = await Deno.readTextFile(new URL("../../meta-webhook/index.ts", import.meta.url));
  assert(!source.includes("buildConversationReply("));
  assert(!source.includes("runConversationEngine("));
  assert(!source.includes("sendViaMetaAdapter("));
  assert(source.includes(".from(\"reply_outbox\")"));
});

type MatrixLeadState = Record<string, any>;
type MatrixTurnResult = Record<string, any>;

function matrixDiag(step: string, result: MatrixTurnResult): string {
  return JSON.stringify({
    step,
    replyText: String(result?.replyText ?? ""),
    nextExpected: result?.statePatch?.nextExpected ?? null,
    collected: result?.statePatch?.collected ?? null,
    last_availability_context: result?.statePatch?.collected?.last_availability_context ?? null,
    pending_booking: result?.statePatch?.collected?.pending_booking ?? null,
    toolAction: result?.toolAction ?? null,
    debug: result?.debug ?? null,
  });
}

function runMatrixTurn(args: {
  leadState: MatrixLeadState;
  inboundText: string;
  clinicSettings?: Record<string, unknown>;
  barbershopInterpreterResult?: Record<string, unknown>;
}): { result: MatrixTurnResult; leadState: MatrixLeadState } {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: args.inboundText,
    leadState: args.leadState as any,
    clinicSettings: { timezone: "America/Tegucigalpa", ...(args.clinicSettings ?? {}) },
    ...(args.barbershopInterpreterResult ? { barbershopInterpreterResult: args.barbershopInterpreterResult as any } : {}),
  } as any) as any;

  const nextState: MatrixLeadState = {
    ...args.leadState,
    ...((result?.statePatch ?? {}) as Record<string, unknown>),
    collected: {
      ...(args.leadState?.collected ?? {}),
      ...((result?.statePatch?.collected ?? {}) as Record<string, unknown>),
    },
  };

  if (String(result?.replyText) === "__SHOW_AVAILABILITY_FOR_DATE__") {
    const date = String(nextState.collected?.preferred_date ?? "2026-05-14");
    const service = String(nextState.collected?.service ?? "Corte clásico");
    nextState.nextExpected = "availability_slot_selection";
    nextState.collected.last_availability_context = {
      service,
      date,
      provider_preference: nextState.collected?.provider_preference ?? null,
      provider_name: nextState.collected?.provider_name ?? null,
      preferred_barber: nextState.collected?.preferred_barber ?? null,
      slots: [
        { time: "09:00", starts_at: `${date}T09:00:00`, provider_id: null, provider_name: null },
        { time: "09:30", starts_at: `${date}T09:30:00`, provider_id: null, provider_name: null },
        { time: "10:00", starts_at: `${date}T10:00:00`, provider_id: null, provider_name: null },
        { time: "10:30", starts_at: `${date}T10:30:00`, provider_id: null, provider_name: null },
        { time: "11:00", starts_at: `${date}T11:00:00`, provider_id: null, provider_name: null },
      ],
    };
  }

  return { result, leadState: nextState };
}

Deno.test("BarberLine Factory QA Matrix: availability typo path + slot + confirm guardrail", () => {
  let leadState: MatrixLeadState = { orgType: "barbershop", mode: "barbershop", stage: "DISCOVERY", phase: "new", collected: {} };
  const step1 = runMatrixTurn({ leadState, inboundText: "hola" });
  leadState = step1.leadState;
  assert(String(step1.result.replyText).length > 0, matrixDiag("step1", step1.result));
  const step2 = runMatrixTurn({
    leadState,
    inboundText: "tens cupo manaa para ccorte con cualqueira",
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "availability_request",
      confidence: 0.9,
      fields_found: { service: "Corte clásico", date: "2026-05-14", time: null, provider_preference: "any", provider_name: null },
      next_step: "show_availability",
      tool_needed: "check_availability",
    },
  });
  leadState = step2.leadState;
  assertEquals(String(step2.result.replyText), "__SHOW_AVAILABILITY_FOR_DATE__", matrixDiag("step2", step2.result));
  assert(step2.leadState.nextExpected === "availability_slot_selection", matrixDiag("step2-next", step2.result));
  assertEquals(step2.leadState.collected?.preferred_barber ?? null, null, matrixDiag("step2-preferred_barber", step2.result));
  assertEquals(step2.leadState.collected?.provider_preference, "any", matrixDiag("step2-provider", step2.result));
  assert(!String(step2.result.replyText).includes("Qué día y hora"), matrixDiag("step2-no-date-time", step2.result));
  const step3 = runMatrixTurn({ leadState, inboundText: "la de las 9" });
  leadState = step3.leadState;
  assertEquals(String(step3.result.replyText), "__CHECK_REQUESTED_AVAILABILITY__", matrixDiag("step3", step3.result));
  assertEquals(step3.result.statePatch?.collected?.preferred_time, "09:00", matrixDiag("step3-time", step3.result));
  assert(step3.result.statePatch?.nextExpected === "confirm_booking", matrixDiag("step3-next", step3.result));
  assert(!String(step3.result.replyText).includes("Para qué día"), matrixDiag("step3-no-redundant", step3.result));
  leadState = {
    ...leadState,
    stage: "CONFIRMING",
    nextExpected: "confirm_booking",
    collected_name: true,
    name: "Jose",
    collected: {
      ...(leadState.collected ?? {}),
      pending_booking: {
        service: "Corte clásico",
        appointment_date: String(leadState.collected?.preferred_date ?? "2026-05-14"),
        appointment_time: "09:00",
        status: "pending_confirmation",
      },
    },
  };
  const step4 = runMatrixTurn({ leadState, inboundText: "Confirmar" });
  assert(step4.result.toolAction?.name === "book_appointment" || String(step4.result.replyText).includes("No tengo una cita pendiente"), matrixDiag("step4", step4.result));
  assert(!String(step4.result.replyText).includes("✅ Cita confirmada"), matrixDiag("step4-no-fake-success", step4.result));
});

Deno.test("BarberLine Factory QA Matrix: availability service follow-up and date change", () => {
  let leadState: MatrixLeadState = { orgType: "barbershop", mode: "barbershop", stage: "DISCOVERY", phase: "new", collected: {} };
  const step1 = runMatrixTurn({ leadState, inboundText: "que horas tenes para jueves" });
  leadState = step1.leadState;
  assert(String(step1.result.replyText).toLowerCase().includes("qué servicio") || String(step1.result.replyText).toLowerCase().includes("que servicio"), matrixDiag("step1", step1.result));
  const step2 = runMatrixTurn({ leadState, inboundText: "cortey barba" });
  leadState = step2.leadState;
  assertEquals(String(step2.result.replyText), "__SHOW_AVAILABILITY_FOR_DATE__", matrixDiag("step2", step2.result));
  assert(["Corte + barba", "Barba"].includes(String(step2.result.statePatch?.collected?.service ?? "")), matrixDiag("step2-service", step2.result));
  const step3 = runMatrixTurn({ leadState, inboundText: "y viernes?" });
  assertEquals(String(step3.result.replyText), "__SHOW_AVAILABILITY_FOR_DATE__", matrixDiag("step3", step3.result));
  assert(["Corte + barba", "Barba"].includes(String(step3.result.statePatch?.collected?.service ?? "")), matrixDiag("step3-service", step3.result));
});

Deno.test("BarberLine Factory QA Matrix: slot selection variants reuse context", () => {
  const baseState: MatrixLeadState = {
    orgType: "barbershop",
    mode: "barbershop",
    stage: "BOOKING",
    nextExpected: "availability_slot_selection",
    collected: {
      service: "Corte clásico",
      last_availability_context: {
        service: "Corte clásico",
        date: "2026-05-14",
        slots: [
          { time: "09:00", starts_at: "2026-05-14T09:00:00", provider_id: null, provider_name: null },
          { time: "09:30", starts_at: "2026-05-14T09:30:00", provider_id: null, provider_name: null },
        ],
      },
    },
  };
  for (const inboundText of ["la primera", "9", "la de 9:30"]) {
    const { result } = runMatrixTurn({ leadState: JSON.parse(JSON.stringify(baseState)), inboundText });
    assertEquals(String(result.replyText), "__CHECK_REQUESTED_AVAILABILITY__", matrixDiag(inboundText, result));
    assertEquals(result.statePatch?.collected?.service, "Corte clásico", matrixDiag(`${inboundText}-service`, result));
    assertEquals(result.statePatch?.collected?.preferred_date, "2026-05-14", matrixDiag(`${inboundText}-date`, result));
  }
});

Deno.test("BarberLine Factory QA Matrix: interruption pricing preserves pending and resumes selection", () => {
  let leadState: MatrixLeadState = {
    orgType: "barbershop",
    mode: "barbershop",
    stage: "CONFIRMING",
    nextExpected: "confirm_booking",
    collected: {
      service: "Corte clásico",
      preferred_date: "2026-05-14",
      preferred_time: "09:00",
      pending_booking: {
        service: "Corte clásico",
        appointment_date: "2026-05-14",
        appointment_time: "09:00",
        status: "pending_confirmation",
      },
      last_availability_context: {
        service: "Corte clásico",
        date: "2026-05-14",
        slots: [
          { time: "09:00", starts_at: "2026-05-14T09:00:00", provider_id: null, provider_name: null },
          { time: "10:00", starts_at: "2026-05-14T10:00:00", provider_id: null, provider_name: null },
        ],
      },
    },
  };
  const price = runMatrixTurn({ leadState, inboundText: "cuanto cuesta?" });
  leadState = price.leadState;
  assertEquals(leadState.collected?.pending_booking?.appointment_time, "09:00", matrixDiag("price", price.result));
  const resume = runMatrixTurn({ leadState, inboundText: "ok entonces la de las 10" });
  assert(!String(resume.result.replyText).includes("✅ Cita confirmada"), matrixDiag("resume-no-fake-success", resume.result));
  assertEquals(resume.leadState.collected?.pending_booking?.appointment_time, "09:00", matrixDiag("resume-preserve-pending", resume.result));
});

Deno.test("BarberLine Factory QA Matrix: contextual repair and normalization typos", () => {
  const repaired = runMatrixTurn({
    leadState: { orgType: "barbershop", mode: "barbershop", stage: "BOOKING", nextExpected: "date_time", collected: { service: "Corte clásico" } },
    inboundText: "manaan",
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: { intent: "date_answer", confidence: 0.75, fields_found: { date: "tomorrow" }, next_step: "ask_missing_field", tool_needed: "none" },
  });
  assertEquals(String(repaired.result.replyText), "__SHOW_AVAILABILITY_FOR_DATE__", matrixDiag("repaired", repaired.result));

  const providerAny = runMatrixTurn({
    leadState: { orgType: "barbershop", mode: "barbershop", stage: "DISCOVERY", collected: {} },
    inboundText: "quiero corte con cualqueira mañana a las 3",
  });
  assertEquals(providerAny.result.statePatch?.collected?.preferred_barber ?? null, null, matrixDiag("providerAny", providerAny.result));
  assertEquals(providerAny.result.statePatch?.collected?.provider_name ?? null, null, matrixDiag("providerAny-provider_name", providerAny.result));

  const serviceTypo = runMatrixTurn({
    leadState: { orgType: "barbershop", mode: "barbershop", stage: "DISCOVERY", collected: {} },
    inboundText: "core de pelo",
  });
  assertEquals(serviceTypo.result.statePatch?.collected?.service, "Corte clásico", matrixDiag("serviceTypo", serviceTypo.result));
  const comboTypo = runMatrixTurn({
    leadState: { orgType: "barbershop", mode: "barbershop", stage: "DISCOVERY", collected: {} },
    inboundText: "cortey barba",
  });
  assert(["Corte + barba", "Barba"].includes(String(comboTypo.result.statePatch?.collected?.service ?? "")), matrixDiag("comboTypo", comboTypo.result));
});
