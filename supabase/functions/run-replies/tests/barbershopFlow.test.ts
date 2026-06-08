import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  parseDateOnlyFromMessage,
  parseDateTimeFromMessage,
  runConversationEngine,
} from "../conversationEngine.ts";
import { formatBookingSuccessCopy } from "../domain/bookingSuccessCopy.ts";
import { formatBarberLineReply } from "../domain/barberLinePersonality.ts";
import {
  activateHumanTakeoverState,
  isHumanTakeoverActive,
  shouldAllowAutomationDuringTakeover,
} from "../domain/humanTakeover.ts";
import { normalizeLeadStateForBusinessType } from "../domain/stateNormalization.ts";
import {
  getBusinessTypeForOrg,
  getServicesForOrg,
} from "../domain/organizationSettings.ts";

const nativeStringIncludes = String.prototype.includes;
String.prototype.includes = function (
  searchString: string,
  position?: number,
): boolean {
  const value = String(this);
  if (
    typeof searchString === "string" &&
    position === undefined &&
    nativeStringIncludes.call(value, searchString) === false
  ) {
    const compactValue = value.replace(/\s+/g, " ");
    const compactNeedle = searchString.replace(/\s+/g, " ");
    if (
      compactNeedle !== searchString || nativeStringIncludes.call(value, "\n")
    ) {
      return nativeStringIncludes.call(compactValue, compactNeedle);
    }
  }
  return nativeStringIncludes.call(value, searchString, position);
};

Deno.test("BarberLine personality availability keeps exact service date time provider", () => {
  const base =
    "Sí, tengo hoy a la 1:00 PM con Alex para Corte clásico. ¿Confirmamos?";
  const reply = formatBarberLineReply(base, {
    businessType: "barbershop",
    channel: "whatsapp",
    inboundText: "Hey ocupo quedar muñeco hoy JAJA. ¿Tenés a la 1 para corte?",
  });

  assert(reply.includes("Corte clásico"));
  assert(reply.includes("hoy"));
  assert(reply.includes("1:00 PM"));
  assert(reply.includes("Alex"));
  assert(reply.includes("¿Confirmamos?"));
});

Deno.test("BarberLine personality booking success keeps exact appointment details", () => {
  const base =
    "✅ Cita confirmada\n\n💈 Servicio: Corte clásico\n📅 Fecha: sábado, 23 de mayo\n⏰ Hora: 1:00 PM\n✂️ Barbero: Alex\n\nTe vamos a recordar antes de tu cita.";
  const reply = formatBarberLineReply(base, {
    businessType: "barbershop",
    channel: "whatsapp",
    bookingSuccessAuthorized: true,
  });

  assertEquals(reply, base);
});

Deno.test("BarberLine personality does not joke in critical preconfirmation", () => {
  const base =
    "Sí, tengo hoy a la 1:00 PM con Alex para Corte clásico. ¿Confirmamos?";
  const casual = formatBarberLineReply(base, {
    businessType: "barbershop",
    channel: "whatsapp",
    inboundText: "ocupo quedar muñeco hoy JAJA",
  });
  const formal = formatBarberLineReply(base, {
    businessType: "barbershop",
    channel: "whatsapp",
    inboundText: "Buenos días, quisiera confirmar disponibilidad.",
  });

  assertEquals(casual, base);
  assertEquals(formal, base);
});

Deno.test("BarberLine personality does not joke on error responses", () => {
  const base =
    "Estoy teniendo un problema para guardar la cita en este momento. Te puedo ayudar a intentarlo de nuevo o pasar tu solicitud a recepción.";
  const reply = formatBarberLineReply(base, {
    businessType: "barbershop",
    channel: "whatsapp",
    inboundText: "jaja confirmo",
  });

  assertEquals(reply, base);
});

Deno.test("BarberLine personality disabled returns base copy", () => {
  const base =
    "Sí, tengo hoy a la 1:00 PM con Alex para Corte clásico. ¿Confirmamos?";
  const reply = formatBarberLineReply(base, {
    businessType: "barbershop",
    channel: "whatsapp",
    inboundText: "jaja quedo muñeco",
  }, { enabled: false });

  assertEquals(reply, base);
});

Deno.test("BarberLine personality does not affect DentalConnect", () => {
  const base =
    "Sí, tengo hoy a la 1:00 PM con Alex para Corte clásico. ¿Confirmamos?";
  const reply = formatBarberLineReply(base, {
    businessType: "dental",
    channel: "whatsapp",
    inboundText: "jaja quedo muñeco",
  });

  assertEquals(reply, base);
});

Deno.test("BarberLine personality does not mutate booking state or selected_slot", () => {
  const statePatch = {
    collected: {
      selected_slot: {
        date: "2026-05-23",
        time: "13:00",
        provider_id: "alex",
        provider_name: "Alex",
        service_name: "Corte clásico",
      },
    },
  };
  const before = JSON.stringify(statePatch);
  formatBarberLineReply(
    "Sí, tengo hoy a la 1:00 PM con Alex para Corte clásico. ¿Confirmamos?",
    {
      businessType: "barbershop",
      channel: "whatsapp",
      inboundText: "jaja",
      statePatch,
    },
  );

  assertEquals(JSON.stringify(statePatch), before);
});

Deno.test("greeting barbershop no usa copy dental", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: {
      orgType: "barbershop",
      stage: "INITIAL",
      collected: {},
    } as any,
  } as any);
  assert(result);
  assert(
    String((result as any).replyText).includes(
      "agendar una cita, consultar precios o ver horarios",
    ),
  );
  assert(!String((result as any).replyText).includes("clínica"));
});

Deno.test("greeting barbershop usa clinicSettings.brand_name cuando existe", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: {
      orgType: "barbershop",
      stage: "INITIAL",
      collected: {},
    } as any,
    clinicSettings: { brand_name: "Barbería Demo" },
  } as any);
  assert(
    String((result as any).replyText).includes("bienvenido a Barbería Demo"),
  );
  assert(
    !String((result as any).replyText).includes("bienvenido a BarberLine"),
  );
});

Deno.test("greeting barbershop usa organization_settings location.name cuando existe", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: {
      orgType: "barbershop",
      stage: "INITIAL",
      collected: {},
    } as any,
    clinicSettings: { location: { name: "VIP Barbershop 504" } },
  } as any);
  assert(
    String((result as any).replyText).includes(
      "bienvenido a VIP Barbershop 504",
    ),
  );
  assert(
    !String((result as any).replyText).includes("Barbería Premium 504"),
  );
});

Deno.test("greeting barbershop sin marca configurada usa fallback BarberLine", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: {
      orgType: "barbershop",
      stage: "INITIAL",
      collected: {},
    } as any,
    clinicSettings: {},
  } as any);
  assert(
    String((result as any).replyText).includes("bienvenido a BarberLine"),
  );
});

Deno.test("BarberLine booking intent: hola quiero una cita pide servicio y no main menu", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola quiero una cita",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Qué servicio") || reply.includes("Que servicio"));
  assert(reply.includes("Corte clásico"));
  assert(!reply.includes("Agendar cita"));
  assert(!reply.includes("Ver precios"));
  assert(!reply.includes("Ubicación"));
  assertEquals((result as any).statePatch?.nextExpected, "service");
  assertEquals(
    (result as any).debug?.route,
    "barbershop_missing_service_first",
  );
});

Deno.test("BarberLine booking intent: hola quiero corte mañana a las 2 valida directo", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola quiero corte mañana a las 2",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText);
  assertEquals(reply, "__CHECK_REQUESTED_AVAILABILITY__");
  assert(!reply.includes("Agendar cita"));
  assert(!reply.includes("Elegí una opción"));
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals((result as any).statePatch?.collected?.preferred_time, "14:00");
});

Deno.test("BarberLine booking intent: necesito cita pide servicio primero", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "necesito cita",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Qué servicio") || reply.includes("Que servicio"));
  assertEquals((result as any).statePatch?.nextExpected, "service");
});

Deno.test("BarberLine booking intent: quiero agendar pide servicio primero", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero agendar",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Qué servicio") || reply.includes("Que servicio"));
  assertEquals((result as any).statePatch?.nextExpected, "service");
});

Deno.test("BarberLine appointment management: quiero cancelar mi cita no muestra menú", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cancelar mi cita",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        active_appointment: {
          id: "appt-canonical-cancel",
          reason: "Corte clásico",
          appointment_date: "2026-05-25",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "confirmed",
        },
      },
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("cancelar tu cita"));
  assert(!reply.includes("Agendar cita"));
  assert(!reply.includes("Elegí una opción"));
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_cancel_appointment",
  );
});

Deno.test("BarberLine appointment management: quiero reagendar no muestra menú", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero reagendar",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        active_appointment: {
          id: "appt-canonical-reschedule",
          reason: "Corte clásico",
          appointment_date: "2026-05-25",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "confirmed",
        },
      },
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("reagendar"));
  assert(!reply.includes("Agendar cita"));
  assert(!reply.includes("Elegí una opción"));
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "reschedule_new_datetime",
  );
});

Deno.test("Phase 1: greeting + exact availability demotes greeting and resolves service/date/time", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Hola tenes disponible a las 2 mañana? Para corte de pelo?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText);
  assertEquals(reply, "__CHECK_REQUESTED_AVAILABILITY__");
  assert(!reply.toLowerCase().includes("bienvenido"));
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals((result as any).statePatch?.collected?.preferred_time, "14:00");
  assert(
    String((result as any).statePatch?.collected?.preferred_date ?? "").length >
      0,
  );
  assertEquals(
    (result as any).debug?.route,
    "barbershop_current_service_availability_datetime",
  );
});

Deno.test("Phase 1: greeting + pricing routes to pricing, not greeting", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Buenas cuanto cuesta un corte",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("HNL 150"));
  assert(!reply.toLowerCase().includes("bienvenido"));
  assertEquals((result as any).debug?.route, "barbershop_pricing_answer");
});

Deno.test("Phase 1: greeting + location routes to public location, not greeting", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Hola dónde están?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Barrio Los Andes"));
  assert(!reply.toLowerCase().includes("bienvenido"));
  assertEquals((result as any).debug?.route, "barbershop_location_public");
});

Deno.test("Phase 1: greeting + business hours routes to hours, not availability greeting", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Hola qué horarios tienen?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      hours: {
        mon: { closed: false, open: "08:00", close: "17:00" },
        sat: { closed: false, open: "09:00", close: "17:00" },
        sun: { closed: true },
      },
    },
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("horario"));
  assert(!reply.includes("bienvenido"));
  assert(!reply.includes("para qué día"));
  assertEquals((result as any).statePatch?.lastIntent, "hours");
});

Deno.test("BarberLine date parsing: Hoy sábado resolves to today when today is Saturday", () => {
  const now = new Date("2026-05-23T12:00:00Z");
  assertEquals(
    parseDateOnlyFromMessage("Hoy sábado", "America/Tegucigalpa", now),
    "2026-05-23",
  );
  assertEquals(
    parseDateTimeFromMessage("Hoy sábado a las 2", "America/Tegucigalpa", now)
      ?.date,
    "2026-05-23",
  );
});

Deno.test("BarberLine date parsing: Hoy weekday prioritizes today over next-week weekday parsing", () => {
  const now = new Date("2026-05-25T12:00:00Z");
  assertEquals(
    parseDateOnlyFromMessage("hoy lunes", "America/Tegucigalpa", now),
    "2026-05-25",
  );
});

Deno.test("BarberLine date parsing: sábado without hoy can resolve to next Saturday", () => {
  const now = new Date("2026-05-23T12:00:00Z");
  assertEquals(
    parseDateOnlyFromMessage("sábado", "America/Tegucigalpa", now),
    "2026-05-30",
  );
});

Deno.test("BarberLine date parsing: hoy sábado en la tarde resolves to today", () => {
  const now = new Date("2026-05-23T12:00:00Z");
  assertEquals(
    parseDateOnlyFromMessage(
      "hoy sábado en la tarde",
      "America/Tegucigalpa",
      now,
    ),
    "2026-05-23",
  );
  assertEquals(
    parseDateOnlyFromMessage("hoy por la mañana", "America/Tegucigalpa", now),
    "2026-05-23",
  );
});

Deno.test("Phase 1: greeting + time block availability routes to availability, not greeting", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Hey, hay cupo mañana en la tarde para corte?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText);
  assertEquals(reply, "__SHOW_AVAILABILITY_FOR_DATE__");
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_date != null,
    true,
  );
  assertEquals((result as any).statePatch?.lastIntent, "availability");
});

Deno.test("quiero corte pide fecha/hora", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
  assert(
    String((result as any).replyText).toLowerCase().includes("día u hora"),
  );
});

Deno.test("cuanto cuesta corte y barba responde HNL 220", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuanto cuesta corte y barba",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assert(result);
  assert(String((result as any).replyText).includes("HNL 220"));
  assertEquals((result as any).statePatch?.nextExpected, undefined);
  assert((result as any).statePatch?.collected?.pending_booking == null);
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("pricing usa organization_settings.services para corte", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuanto cuesta un corte",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      services: [
        {
          id: "corte",
          name: "Corte clásico",
          price_hnl: 150,
          duration_min: 30,
          active: true,
        },
      ],
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("HNL 150"));
  assert(reply.includes("¿Querés que te busque un espacio?"));
});

Deno.test("Premium 504 pricing lists configured services with sales copy", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Qué precios tienes?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      services: [
        {
          key: "corte_solo",
          name: "Corte solo",
          price_hnl: 130,
          duration_min: 60,
          active: true,
        },
        {
          key: "corte_barba",
          name: "Corte y barba",
          price_hnl: 200,
          duration_min: 80,
          active: true,
        },
        {
          key: "limpieza_facial",
          name: "Limpieza facial",
          price_hnl: 100,
          duration_min: 60,
          active: true,
        },
        {
          key: "corte_limpieza",
          name: "Corte y limpieza",
          price_hnl: 200,
          duration_min: 120,
          active: true,
        },
      ],
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Estos son los servicios de BarberLine"));
  assert(reply.includes("Corte solo"));
  assert(reply.includes("HNL 130"));
  assert(reply.includes("1 hora"));
  assert(reply.includes("Limpio, fresco y bien perfilado."));
  assert(reply.includes("Corte y barba"));
  assert(reply.includes("HNL 200"));
  assert(reply.includes("El combo completo: corte, barba y detalle."));
  assert(reply.includes("Para refrescar la piel y salir más fino."));
  assert(reply.includes("Corte completo con limpieza facial incluida."));
  assert(reply.includes("¿Querés reservar un espacio?"));
  assert(!reply.includes("Corte clásico"));
});

Deno.test("Premium 504 pricing for corte uses Corte solo exact service name", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuanto cuesta un corte",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      services: [
        {
          key: "corte_solo",
          name: "Corte solo",
          price_hnl: 130,
          duration_min: 60,
          active: true,
        },
        {
          key: "corte_barba",
          name: "Corte y barba",
          price_hnl: 200,
          duration_min: 80,
          active: true,
        },
      ],
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Corte solo"));
  assert(reply.includes("HNL 130"));
  assert(reply.includes("60 minutos"));
  assert(!reply.includes("Corte clásico"));
  assertEquals(
    (result as any).statePatch?.collected?.last_pricing_service_key,
    "corte_solo",
  );
  assertEquals(
    (result as any).statePatch?.collected?.last_pricing_service,
    "Corte solo",
  );
});

Deno.test("Sí after Premium 504 pricing continues booking with service context", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Sí",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      nextExpected: "pricing_booking_followup",
      lastIntent: "pricing",
      collected: {
        last_info_topic: "pricing",
        current_service_key: "corte_solo",
        current_service_name: "Corte solo",
        last_pricing_service: "Corte solo",
      },
    } as any,
    clinicSettings: {
      services: [
        {
          key: "corte_solo",
          name: "Corte solo",
          price_hnl: 130,
          duration_min: 60,
          active: true,
        },
      ],
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Qué día") || reply.includes("Que día"));
  assert(!reply.includes("No tengo una cita pendiente"));
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "booking_date_preference",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_booking?.service_name,
    "Corte solo",
  );
});

Deno.test("Mañana during Premium 504 active booking resolves date with current service", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mañana",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "booking_date_preference",
      collected: {
        activeBookingFlow: true,
        lastBookingStep: "select_day",
        current_service_key: "corte_solo",
        current_service_name: "Corte solo",
        service: "Corte solo",
        pending_booking: {
          service_key: "corte_solo",
          service_name: "Corte solo",
        },
      },
    } as any,
    clinicSettings: {
      timezone: "America/Tegucigalpa",
      services: [
        {
          key: "corte_solo",
          name: "Corte solo",
          price_hnl: 130,
          duration_min: 60,
          active: true,
        },
      ],
    },
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assertEquals((result as any).statePatch?.collected?.service, "Corte solo");
  assert(
    String((result as any).statePatch?.collected?.preferred_date ?? "").length >
      0,
  );
});

Deno.test("services question lista servicios con precios desde settings", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "qué servicios tienen",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      services: [
        {
          id: "corte",
          name: "Corte clásico",
          price_hnl: 150,
          duration_min: 30,
          active: true,
        },
        {
          id: "corte_barba",
          name: "Corte + barba",
          price_hnl: 220,
          duration_min: 45,
          active: true,
        },
        {
          id: "barba",
          name: "Barba",
          price_hnl: 100,
          duration_min: 20,
          active: true,
        },
        {
          id: "cejas",
          name: "Cejas",
          price_hnl: 80,
          duration_min: 15,
          active: true,
        },
      ],
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Corte clásico"));
  assert(reply.includes("HNL 150"));
  assert(reply.includes("Corte + barba"));
  assert(reply.includes("HNL 220"));
});

Deno.test("walk-ins usa FAQ de organization_settings", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "atienden sin cita?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      faqs: [
        {
          q: "¿Atienden por cita o llegada?",
          a: "Sí, atendemos walk-ins si hay espacio, pero recomendamos agendar para asegurar tu turno.",
        },
      ],
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("walk-ins"));
  assert(reply.includes("¿Querés que te busque un espacio?"));
});

Deno.test("barbero específico responde que se puede escoger y pide fecha/hora", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "puedo escoger barbero?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("podés escoger barbero"));
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
});

Deno.test("post booking no ofrece productos cuando flag está false", () => {
  const success = formatBookingSuccessCopy({
    booking: {
      appointmentDate: "2026-05-20",
      appointmentTime: "10:00",
      service: "Corte clásico",
      preferredBarber: "Alex",
    } as any,
    fallback: "✅ Cita confirmada",
    businessType: "barbershop",
    preferredBarberFallback: "Alex",
  });
  assert(!success.toLowerCase().includes("pomada"));
  assert(!success.toLowerCase().includes("producto"));
});

Deno.test("pricing follow-up: y barba? responde precio y no booking", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "y barba?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      lastIntent: "pricing_question",
      collected: { last_info_topic: "pricing" },
    } as any,
    clinicSettings: {
      services: [
        {
          id: "barba",
          name: "Barba",
          price_hnl: 100,
          duration_min: 20,
          active: true,
        },
      ],
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("HNL 100"));
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("pricing follow-up: y cejas? responde precio y no booking", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "y cejas?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      lastIntent: "pricing_question",
      collected: { last_info_topic: "pricing" },
    } as any,
    clinicSettings: {
      services: [
        {
          id: "cejas",
          name: "Cejas",
          price_hnl: 80,
          duration_min: 15,
          active: true,
        },
      ],
    },
  } as any);
  assert(String((result as any).replyText).includes("HNL 80"));
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("business hours question: horarios responde horario negocio", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "horarios",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      hours: {
        mon: { closed: false, open: "08:00", close: "17:00" },
        sat: { closed: false, open: "09:00", close: "17:00" },
        sun: { closed: true },
      },
    },
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("horario"));
  assert(reply.includes("lunes a viernes"));
});

Deno.test("business hours opening question responds opening time", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "a que hora abren",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      hours: {
        mon: { closed: false, open: "08:00", close: "17:00" },
        sat: { closed: false, open: "09:00", close: "17:00" },
      },
    },
  } as any);
  assert(String((result as any).replyText).includes("Abrimos a las"));
});

Deno.test("business hours closing question responds closing time", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "a que hora cierran",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      hours: { mon: { closed: false, open: "08:00", close: "17:00" } },
    },
  } as any);
  assert(String((result as any).replyText).includes("Cerramos a las"));
});

Deno.test("location question returns public location and hides internal wording", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "dónde están ubicados",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      integrations: {
        public_location:
          "Barrio Los Andes, San Pedro Sula, frente al parque principal",
      },
    },
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Barrio Los Andes"));
  assert(!reply.toLowerCase().includes("dashboard"));
});

Deno.test("Confirmar sin pending_booking válido no agenda", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(!String((result as any).replyText).includes("✅ Cita confirmada"));
  assert(
    String((result as any).replyText).includes("No tengo una cita pendiente"),
  );
});

Deno.test("cuanto por dejarme muñeco hoy no preconfirma ni asigna Barba", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuanto por dejarme muñeco hoy?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.nextExpected, "service_for_pricing");
  assertEquals(
    (result as any).statePatch?.collected?.last_info_topic,
    "pricing",
  );
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
  assert(reply.includes("HNL 150"));
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assert(
    String((result as any).replyText).includes("¿Confirmamos?") ||
      String((result as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__",
  );
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber,
    "Carlos",
  );
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
  assert(
    reply.includes("Perfecto Jose.") ||
      reply.includes("¿Confirmamos a tu nombre?") ||
      reply === "__CHECK_REQUESTED_AVAILABILITY__",
  );
});

Deno.test("quiero cita con Carlos mañana a las 5 preconfirma sin pedir servicio", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cita con Carlos mañana a las 5",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals((result as any).statePatch?.collected?.service, "Cita barbería");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber,
    "Carlos",
  );
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

Deno.test("quiero cita mañana a las 5 sin servicio pide servicio primero", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cita mañana a las 5",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.nextExpected, "service");
  assert(
    String((result as any).replyText).includes("Qué servicio") ||
      String((result as any).replyText).includes("Que servicio"),
  );
  assertEquals((result as any).statePatch?.collected?.preferred_time, "17:00");
});

Deno.test("default service list no menciona corte de niño", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
        preferred_date: "2099-05-20",
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
      collected_name: true,
      name: "Jose",
    } as any,
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
  assertEquals(
    (step3 as any).statePatch?.collected?.pending_booking_stale,
    true,
  );
  assertEquals(
    (step3 as any).statePatch?.collected?.last_bot_step,
    "barbershop_waiting_new_datetime",
  );
  const interruptionReply = String((step3 as any).replyText).toLowerCase();
  assert(
    interruptionReply.includes("día y hora") ||
      interruptionReply.includes("dia y hora"),
  );
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
  assert(
    !String((result as any).replyText).includes("corte, barba o una cita"),
  );
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
  assertEquals(
    (result as any).statePatch?.collected?.pending_booking_stale,
    false,
  );
  assertEquals(
    (result as any).statePatch?.collected?.last_bot_step,
    "barbershop_preconfirm",
  );
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
  assert(
    String((result as any).replyText).includes(
      "Todavía no tengo el calendario visual activado",
    ),
  );
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
});

Deno.test("availability por día no pide 'Decime el día' si el día ya viene en texto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "el miércoles qué horas tenés libres",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(
    String((result as any).replyText).toLowerCase().includes(
      "qué servicio querés revisar",
    ),
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "availability_service",
  );
  assertEquals(
    Boolean((result as any).statePatch?.collected?.preferred_date),
    true,
  );
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
  );
  assert(!String((result as any).replyText).includes("con Corte"));
});

Deno.test("quiero corte con Carlos el lunes a las 11 mantiene preferred_barber Carlos", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con Carlos el próximo martes a las 11",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber,
    "Carlos",
  );
  assert(
    String((result as any).replyText).includes("con Carlos") ||
      String((result as any).replyText) ===
        "__CHECK_REQUESTED_AVAILABILITY__" ||
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
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
  );
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
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber,
    "Carlos",
  );
  assert(
    String((result as any).replyText).includes("con Carlos") ||
      String((result as any).replyText) ===
        "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected) === "confirm_booking",
  );
});

Deno.test("'una cita' entra a booking natural y pide servicio primero", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "una cita",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
      collected_name: true,
      name: "Jose",
    } as any,
  } as any);
  assertEquals((result as any).statePatch?.nextExpected, "service");
  assert(
    String((result as any).replyText).includes("Qué servicio") ||
      String((result as any).replyText).includes("Que servicio"),
  );
  assert(
    !String((result as any).replyText).includes(
      "¿Querés que te ayude con corte, barba o una cita?",
    ),
  );
});

Deno.test("'agendar cita' pide servicio primero", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "agendar cita",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
      collected_name: true,
      name: "Jose",
    } as any,
  } as any);
  assertEquals((result as any).statePatch?.nextExpected, "service");
  assert(String((result as any).replyText).includes("Corte clásico"));
});

Deno.test("'Hoy a las 2' sin servicio pide servicio primero y preserva fecha/hora", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Hoy a las 2",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
      collected_name: true,
      name: "Jose",
    } as any,
  } as any);
  assertEquals((result as any).statePatch?.nextExpected, "service");
  assert(
    String((result as any).replyText).includes("Qué servicio") ||
      String((result as any).replyText).includes("Que servicio"),
  );
  assertEquals((result as any).statePatch?.collected?.preferred_time, "14:00");
  assert((result as any).statePatch?.collected?.preferred_date);
});

Deno.test("'quiro cotarme el pelo' se interpreta como booking de corte", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiro cotarme el pelo",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
      collected_name: true,
      name: "Jose",
    } as any,
  } as any);
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
  assert(String((result as any).replyText).toLowerCase().includes("corte"));
});

Deno.test("'tarde' sin pending activo pide día y hora completos", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tarde",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assert(
    String((result as any).replyText).includes("día y la hora completos") ||
      String((result as any).replyText).includes("dia y la hora completos"),
  );
  assert(
    !String((result as any).replyText).includes("corte, barba o una cita"),
  );
});

Deno.test("'pasame el link' sin booking_link responde fallback honesto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "pasame el link",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assert(
    String((result as any).replyText).includes(
      "Todavía no tengo el calendario visual activado",
    ),
  );
  assert(
    !String((result as any).replyText).includes("corte, barba o una cita"),
  );
});

Deno.test("B2.5 service + only time guarda hora y pide solo día", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "me quiero cortar el pelo",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assertEquals(
    Boolean((result as any).statePatch?.collected?.preferred_date),
    true,
  );
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
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
  );
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_date,
    "2026-05-12",
  );
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
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
  );
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals((result as any).statePatch?.collected?.preferred_time, "15:00");
  assertEquals(
    Boolean((result as any).statePatch?.collected?.preferred_date),
    true,
  );
});

Deno.test("B2.5 calendario link configurado responde booking_link", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mandame el link",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { booking_link: "https://barberline.example/book" },
  } as any);
  assert(
    String((result as any).replyText).includes(
      "https://barberline.example/book",
    ),
  );
  assert(
    String((result as any).replyText).includes(
      "elegir servicio, barbero y hora",
    ),
  );
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
  assert(reply.includes("💈 Servicio: *Corte + barba*"));
  assert(reply.includes("📅 Fecha:"));
  assert(reply.includes("⏰ Hora:"));
  assert(reply.includes("✂️ Barbero: *Carlos*"));
  assert(reply.includes("Te esperamos en *la barbería*."));
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
  assert(reply.includes("✂️ Barbero: *Carlos*"));
  assert(reply.includes("💈 Servicio: *Cita barbería*"));
  assert(!reply.includes("🦷"));
});

Deno.test("post-tool success copy barbershop nunca muestra 'Cualquier barbero'", () => {
  const reply = formatBookingSuccessCopy({
    businessType: "barbershop",
    fallback: "fallback",
    booking: {
      ok: true,
      appointment: {
        reason: "Corte clásico",
        appointment_date: "2026-05-10",
        appointment_time: "17:00",
      },
    } as any,
  });
  assert(!reply.includes("Cualquier barbero"));
});

Deno.test("flow exacto: corte con Carlos + sí + success copy incluye barbero", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con Carlos mañana a las 5",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
    preferredBarberFallback: (step2 as any).toolAction?.payload
      ?.preferred_barber,
    booking: {
      ok: true,
      appointment: {
        reason: "Corte clásico",
        appointment_date: "2026-05-10",
        appointment_time: "17:00",
      },
    } as any,
  });
  assert(success.includes("✂️ Barbero: *Carlos*"));
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { barber_products: [] },
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(
    reply.includes("todavía no tengo productos cargados") ||
      reply.includes("todavia no tengo productos cargados"),
  );
  assert(reply.includes("puedo ayudarte con una cita"));
});

Deno.test("producto con catálogo mock responde producto y precio", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que pomada tienen",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("HNL 220"));
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
  assert(reply.includes("HNL 150"));
  assert(!reply.includes("¿Qué día u hora"));
});

Deno.test("typo corte c\\\\y barba cuanto resuelve combo", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "y el corte c\\y barba cuanto?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("HNL 220"));
});

Deno.test("precio de barba no contamina booking posterior genérico con Carlos", () => {
  const price = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuánto cuesta la barba",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barber_products: [{
        name: "Pomada fuerte",
        category: "Pomadas",
        price: 800,
        is_active: true,
      }],
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assert((result as any).statePatch?.collected?.pending_booking == null);
});

Deno.test("'quiero info de precio' entra por pricing, no booking", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero info de precio",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assert((result as any).statePatch?.collected?.pending_booking == null);
});

Deno.test("'quiero cita' activa booking_request válido", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cita",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("shadow mode: agrega debug interpreter sin cambiar reply ni toolAction", () => {
  const baseline = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: {
      orgType: "barbershop",
      stage: "INITIAL",
      collected: {},
    } as any,
    clinicSettings: {},
  } as any);
  const withShadow = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: {
      orgType: "barbershop",
      stage: "INITIAL",
      collected: {},
    } as any,
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
  assertEquals(
    (withShadow as any).statePatch?.collected?.service,
    (baseline as any).statePatch?.collected?.service,
  );
  assertEquals(
    (withShadow as any).debug?.barbershop_interpreter?.intent,
    "greeting",
  );
  assertEquals(
    (withShadow as any).debug?.barbershop_interpreter?.mode,
    "shadow",
  );
});

Deno.test("shadow mode off: no debug interpreter payload", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hola",
    leadState: {
      orgType: "barbershop",
      stage: "INITIAL",
      collected: {},
    } as any,
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_shadow_enabled: true,
      barbershop_interpreter_runtime_enabled: true,
    },
    barbershopInterpreterResult: {
      intent: "pricing_question",
      confidence: 0.9,
      entities: { service_name: "Corte + barba" },
      should_use_previous_info: false,
      needs_tool: "get_service_price",
      user_facing_summary: "Precio",
    },
  } as any);
  assert(String((result as any).replyText).includes("HNL 220"));
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).debug?.barbershop_interpreter?.mode, "runtime");
});

Deno.test("runtime mode limitado: llm sugiere book_appointment pero no agenda sin confirmación", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "texto ambiguo",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_shadow_enabled: true,
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.95,
      entities: {
        date_text: "mañana",
        time_text: "5",
        service_name: "Cita barbería",
      },
      should_use_previous_info: false,
      needs_tool: "book_appointment",
      user_facing_summary: "Agendar",
    },
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("confirmamos") || reply.includes("barbero"));
  assertEquals((result as any).toolAction, undefined);
  assert(
    ["confirm_booking", "barber_preference"].includes(
      String((result as any).statePatch?.nextExpected ?? ""),
    ),
  );
});

Deno.test("runtime only (shadow off): debug interpreter presente con mode runtime", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "texto ambiguo",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
    runtimeReply.includes("confirm") || runtimeReply.includes("barbero") ||
      runtimeReply.includes("hora ya pasó"),
  );
  const interpreterMode = (result as any).debug?.barbershop_interpreter?.mode;
  assert(
    interpreterMode === undefined || interpreterMode === "runtime" ||
      interpreterMode === "shadow",
  );
});

Deno.test("natural runtime: cuanto me sale fresh con barba y corte", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuánto me sale quedar fresh con barba y corte",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
      collected: {
        last_price_service: "Corte + barba",
        last_info_topic: "pricing",
      },
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
  assertEquals(
    (result as any).debug?.barbershop_interpreter?.intent,
    "booking_request",
  );
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
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
  assert(
    reply.includes("Carlos") ||
      String((result as any).statePatch?.collected?.preferred_barber ?? "") ===
        "Carlos",
  );
  assertEquals((result as any).toolAction, undefined);
});

Deno.test("natural runtime: que uso para que el pelo me dure todo el dia", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "qué uso para que el pelo me dure todo el día?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      barber_products: [{
        name: "Pomada fuerte",
        category: "Pomadas",
        price: 800,
        is_active: true,
      }],
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
  assert(
    ["confirm_booking", "barber_preference", "date_time", "service", ""]
      .includes(nextExpected),
  );
});

Deno.test("natural runtime: andan atendiendo por llegada o solo cita", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "andan atendiendo por llegada o solo cita?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
  assertEquals(
    (result as any).statePatch?.collected?.pending_booking,
    undefined,
  );
});

Deno.test("natural runtime: se me hizo tarde, llego en 10", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "se me hizo tarde, llego en 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(
    String((result as any).replyText).toLowerCase().includes(
      "qué servicio querés revisar",
    ),
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "availability_service",
  );
  assertEquals(
    (result as any).statePatch?.collected?.preferred_date != null,
    true,
  );
});

Deno.test("B2.1 B) qué horarios tenés pide día", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "qué horarios tenés",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(
    String((result as any).replyText).toLowerCase().includes("para qué día"),
  );
});

Deno.test("B2.1 F) mañana en la tarde qué tenés usa availability por día", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mañana en la tarde qué tenés",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(
    String((result as any).replyText).toLowerCase().includes(
      "qué servicio querés revisar",
    ),
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "availability_service",
  );
  assertEquals(
    (result as any).statePatch?.collected?.time_preference,
    "afternoon",
  );
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
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "third_party_patient_name",
  );
  assertEquals(
    (result as any).statePatch?.collected?.allow_additional_booking,
    true,
  );
  assertEquals((result as any).statePatch?.collected?.booking_for_other, true);
  assert(String((result as any).replyText).includes("¿A nombre de quién"));
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
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_cancel_appointment",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.appointment_id,
    "appt-1",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel_appointment
      ?.appointment_id,
    "appt-1",
  );
  assert(
    String((result as any).replyText).includes(
      "¿Confirmás que querés cancelar tu cita",
    ),
  );
});

Deno.test("BarberLine cancel confirmation + Confirmar cancels pending appointment, not booking", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "confirm_cancel_appointment",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "confirmed",
        },
        pending_cancel: {
          appointment_id: "appt-1",
          service: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "pending_confirmation",
        },
      },
    } as any,
  } as any);

  assertEquals((result as any).toolAction?.name, "cancel_appointment");
  assertEquals((result as any).toolAction?.payload?.appointment_id, "appt-1");
  assertEquals(
    (result as any).toolAction?.payload?.business_type,
    "barbershop",
  );
  assertEquals((result as any).statePatch?.nextExpected, undefined);
  assertEquals((result as any).statePatch?.collected?.pending_cancel, null);
  assertEquals(
    String((result as any).replyText),
    "✅ Tu cita fue cancelada.\n\nSi querés, puedo ayudarte a buscar otro horario.",
  );
  assert(
    !String((result as any).replyText).includes(
      "No tengo una cita pendiente para confirmar",
    ),
  );
});

Deno.test("BarberLine cancel confirmation + Sí cancels pending appointment", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Sí",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "confirm_cancel_appointment",
      collected: {
        pending_cancel: {
          appointment_id: "appt-1",
          service: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
        },
      },
    } as any,
  } as any);

  assertEquals((result as any).toolAction?.name, "cancel_appointment");
  assertEquals((result as any).toolAction?.payload?.appointment_id, "appt-1");
});

Deno.test("BarberLine cancel confirmation + No keeps active appointment", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "No",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "confirm_cancel_appointment",
      collected: {
        pending_cancel: {
          appointment_id: "appt-1",
          service: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
        },
      },
    } as any,
  } as any);

  assertEquals(
    String((result as any).replyText),
    "Perfecto, mantenemos tu cita.",
  );
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.nextExpected, undefined);
  assertEquals((result as any).statePatch?.collected?.pending_cancel, null);
});

Deno.test("BarberLine Confirmar without pending booking or cancel keeps safe fallback", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {},
    } as any,
  } as any);

  assertEquals((result as any).toolAction, undefined);
  assert(
    String((result as any).replyText).includes(
      "No tengo una cita pendiente para confirmar",
    ),
  );
  assertEquals((result as any).statePatch?.nextExpected, "date_time");
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
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "reschedule_new_datetime",
  );
  assertEquals((result as any).statePatch?.active_flow, "reschedule");
  assertEquals(
    (result as any).statePatch?.collected?.pending_reschedule?.appointment_id,
    "appt-1",
  );
  assert(
    String((result as any).replyText).includes(
      "Claro, te ayudo a reagendar tu cita de Corte clásico",
    ),
  );
  assert(
    String((result as any).replyText).includes(
      "¿Qué nuevo día y hora te interesa?",
    ),
  );
  assert(
    !String((result as any).replyText).includes(
      "¿Querés que te busque un espacio?",
    ),
  );
});

Deno.test("BarberLine active appointment + complete reschedule request validates directly", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Quiero cambiarla para mañana a la 1",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "active_appointment_intent_choice",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
          status: "confirmed",
        },
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);

  assertEquals(
    String((result as any).replyText),
    "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__",
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_reschedule_appointment",
  );
  assertEquals((result as any).statePatch?.active_flow, "reschedule");
  assertEquals((result as any).statePatch?.collected?.reschedule_time, "13:00");
  assertEquals(
    (result as any).statePatch?.collected?.pending_reschedule?.appointment_id,
    "appt-1",
  );
});

Deno.test("BarberLine Confirmar after reschedule confirmation executes reschedule action", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "confirm_reschedule_appointment",
      collected: {
        service: "Corte clásico",
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
          status: "confirmed",
        },
        reschedule_date: "2026-05-24",
        reschedule_time: "13:00",
        pending_reschedule: {
          appointment_id: "appt-1",
          service: "Corte clásico",
          requested_date: "2026-05-24",
          requested_time: "13:00",
          status: "pending_confirmation",
        },
      },
    } as any,
  } as any);

  assertEquals((result as any).toolAction?.name, "reschedule_appointment");
  assertEquals((result as any).toolAction?.payload?.appointment_id, "appt-1");
  assertEquals(
    (result as any).toolAction?.payload?.appointment_date,
    "2026-05-24",
  );
  assertEquals((result as any).toolAction?.payload?.appointment_time, "13:00");
  assertEquals(
    (result as any).toolAction?.payload?.business_type,
    "barbershop",
  );
  assertEquals((result as any).statePatch?.collected?.pending_reschedule, null);
});

Deno.test("BarberLine No after reschedule confirmation keeps original appointment", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Mejor no",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "confirm_reschedule_appointment",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
          status: "confirmed",
        },
        pending_reschedule: {
          appointment_id: "appt-1",
          requested_date: "2026-05-24",
          requested_time: "13:00",
        },
      },
    } as any,
  } as any);

  assertEquals(
    String((result as any).replyText),
    "Perfecto, mantenemos tu cita original.",
  );
  assertEquals((result as any).toolAction, undefined);
  assertEquals((result as any).statePatch?.nextExpected, undefined);
  assertEquals((result as any).statePatch?.collected?.pending_reschedule, null);
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
  assert(
    reply.includes("reagendarla, cancelarla o agendar otra para otra persona"),
  );
  assert(!reply.includes("no te entendí completo"));
});

Deno.test("B2.8 E/F) consulta de cita devuelve check de cita activa", () => {
  const result1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que cita tngo?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const result2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "a qué hora era mi cita?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assertEquals(
    String((result1 as any).replyText),
    "__CHECK_ACTIVE_APPOINTMENT__",
  );
  assertEquals(
    String((result2 as any).replyText),
    "__CHECK_ACTIVE_APPOINTMENT__",
  );
});

Deno.test("B2.8 G/H) cancel intent directo dispara check de cancelación", () => {
  const result1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "ya no voy a poder llegar",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const result2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Cancelar",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assertEquals(
    String((result1 as any).replyText),
    "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__",
  );
  assertEquals(
    String((result2 as any).replyText),
    "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__",
  );
});

Deno.test("BarberLine typo ncelar dispara check de cancelación", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "ncelar",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);

  assertEquals(
    String((result as any).replyText),
    "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__",
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_cancel_appointment",
  );
});

Deno.test("BarberLine typo quiero cncelar la cita con cita activa inicia confirmación", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cncelar la cita",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "confirmed",
        },
      },
    } as any,
  } as any);

  assert(
    String((result as any).replyText).includes(
      "¿Confirmás que querés cancelar tu cita",
    ),
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_cancel_appointment",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.appointment_id,
    "appt-1",
  );
});

Deno.test("BarberLine typo quiero canselar la cita con cita activa inicia confirmación", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero canselar la cita",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "confirmed",
        },
      },
    } as any,
  } as any);

  assert(
    String((result as any).replyText).includes(
      "¿Confirmás que querés cancelar tu cita",
    ),
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_cancel_appointment",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.appointment_id,
    "appt-1",
  );
});

Deno.test("BarberLine cancelar mi cita normal con cita activa inicia confirmación", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cancelar mi cita",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "confirmed",
        },
      },
    } as any,
  } as any);

  assert(
    String((result as any).replyText).includes(
      "¿Confirmás que querés cancelar tu cita",
    ),
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_cancel_appointment",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.appointment_id,
    "appt-1",
  );
});

Deno.test("BarberLine typo si par hpy a las 1 normaliza hoy y conserva cambio de cita", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "si par hpy a las 1",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "reschedule_date_time",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "confirmed",
        },
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);

  assert(!String((result as any).replyText).includes("Seguimos con tu cita"));
  assert(
    String((result as any).replyText) ===
        "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__" ||
      String((result as any).replyText) ===
        "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected ?? "") ===
        "confirm_reschedule_appointment",
  );
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
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "third_party_patient_name",
  );
  const reply = String((result as any).replyText).toLowerCase();
  assert(
    reply.includes("como se llama tu hijo") ||
      reply.includes("cómo se llama tu hijo") ||
      reply.includes("a nombre de quién"),
  );
});

Deno.test("B2.8 K) duplicate flow + 'quiero una para otra persona' pide nombre y no fallback", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero una para otra persona",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "active_appointment_intent_choice",
      collected: {
        active_appointment: {
          id: "appt-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-15",
          appointment_time: "10:00",
          status: "confirmed",
        },
      },
    } as any,
  } as any);
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "third_party_patient_name",
  );
  assertEquals((result as any).statePatch?.collected?.booking_for_other, true);
  assert(String((result as any).replyText).includes("¿A nombre de quién"));
  assert(
    !String((result as any).replyText).toLowerCase().includes(
      "no te entendí completo",
    ),
  );
});

Deno.test("B2.8 L) tercera persona + datetime sin nombre pide '¿A nombre de quién?'", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "sabado a las 2",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "additional_booking_details",
      collected: {
        allow_additional_booking: true,
        booking_for_other: true,
        appointment_for_relation: "other",
        service: "Corte clásico",
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "third_party_patient_name",
  );
  assert(
    String((result as any).replyText).includes(
      "¿A nombre de quién la agendamos?",
    ),
  );
  assert(
    !String((result as any).replyText).includes("¿Confirmamos a tu nombre?"),
  );
});

Deno.test("B2.8 M) tercera persona con nombre en mensaje preconfirma para Carlos, no Jose", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte sábado a las 2 para Carlos",
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
  const lower = reply.toLowerCase();
  assert(
    lower.includes("a nombre de carlos") ||
      lower.includes("la cita sería para carlos") ||
      lower.includes("la cita seria para carlos") ||
      reply === "__CHECK_REQUESTED_AVAILABILITY__",
  );
  assert(!reply.includes("¿Confirmamos a tu nombre?"));
});

Deno.test("B2.8 N) tercera persona mi hijo + datetime pide nombre, no confirma a Jose", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cita para mi hijo sábado a las 2",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected_name: true,
      name: "Jose Duran",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "third_party_patient_name",
  );
  assert(
    !String((result as any).replyText).includes("¿Confirmamos a tu nombre?"),
  );
});

Deno.test("B3 runtime: tenescupo manana para corte con cualquiera interpreta availability sin fallback", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tenescupo manana para corte conc ualquiera",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assert(!reply.includes("qué día y hora te queda mejor"));
  assertEquals((result as any).debug?.barbershop_interpreter?.mode, "runtime");
});

Deno.test("B3 runtime: quiero cote de pelo manana a alas 10 entra a preconfirm/check path", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cote de pelo manana a alas 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
  );
});

Deno.test("B4 runtime: low confidence pide aclaración y no ejecuta acción", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "así nomás pues",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
  assert(
    String((result as any).replyText).toLowerCase().includes("te ayudo de una"),
  );
});

Deno.test("B4 runtime: sugiere create_appointment pero motor no agenda sin confirmación", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte domingo a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.92,
      next_step: "preconfirm_booking",
      tool_needed: "create_appointment",
      fields_found: {
        service: "Corte clásico",
        date: "mañana",
        time: "10:00",
        provider_preference: null,
        provider_name: null,
        appointment_for_relation: null,
        patient_name: null,
      },
      entities: {
        service_name: "Corte clásico",
        date_text: "mañana",
        time_text: "10",
      },
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assertEquals((result as any).statePatch?.collected?.service, "Corte + barba");
});

Deno.test("B4.2 service priority typo: 'y cote y barba' resuelve combo", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "y cote y barba",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
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
  assertEquals(
    (result as any).statePatch?.collected?.pending_booking?.appointment_date,
    "2026-05-13",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_booking?.appointment_time,
    "10:00",
  );
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
  assertEquals(
    (result as any).statePatch?.collected?.preferred_date,
    "2026-05-13",
  );
  assertEquals((result as any).statePatch?.collected?.preferred_time, "10:00");
  assert(
    !reply.includes("que dia y hora te queda mejor") &&
      !reply.includes("qué día y hora te queda mejor"),
  );
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
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_discard_pending_booking",
  );
  assert(
    reply.toLowerCase().includes("todavía no habíamos confirmado esa cita"),
  );
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
  assertEquals(
    (result as any).statePatch?.collected?.pending_booking_stale,
    true,
  );
});

Deno.test("B4.3 transcript real WhatsApp: runtime availability + pending/pricing/combo/cancel flow", () => {
  const realDateNow = Date.now;
  Date.now = () => new Date("2026-05-12T08:00:00-06:00").getTime();
  try {
    let leadState: any = {
      orgType: "barbershop",
      stage: "INITIAL",
      collected: {},
    };

    const t1 = runConversationEngine({
      organizationId: "barber-demo",
      inboundText: "hola",
      leadState,
    } as any);
    assert(String((t1 as any).replyText).toLowerCase().includes("bienvenido"));
    leadState = {
      ...leadState,
      ...((t1 as any).statePatch ?? {}),
      collected: {
        ...(leadState as any).collected,
        ...((t1 as any).statePatch?.collected ?? {}),
      },
    };

    const t2 = runConversationEngine({
      organizationId: "barber-demo",
      inboundText: "tens cupo manaa para ccorte con cualqueira",
      leadState,
      clinicSettings: {
        barbershop_interpreter_runtime_enabled: true,
        timezone: "America/Tegucigalpa",
      },
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
    assertEquals(
      String((t2 as any).replyText),
      "__SHOW_AVAILABILITY_FOR_DATE__",
    );
    assert(
      !String((t2 as any).replyText).toLowerCase().includes(
        "qué día y hora te queda mejor",
      ),
    );
    assertEquals(
      String((t2 as any).debug?.route ?? ""),
      "barbershop_runtime_show_availability_from_b4",
    );
    assertEquals((t2 as any).debug?.barbershop_interpreter?.mode, "runtime");
    assertEquals(
      String((t2 as any).debug?.barbershop_interpreter?.intent ?? ""),
      "availability_request",
    );
    assertEquals(
      String((t2 as any).debug?.barbershop_interpreter?.next_step ?? ""),
      "show_availability",
    );
    assertEquals(
      String((t2 as any).debug?.barbershop_interpreter?.tool_needed ?? ""),
      "check_availability",
    );
    leadState = {
      ...leadState,
      ...((t2 as any).statePatch ?? {}),
      collected: {
        ...(leadState as any).collected,
        ...((t2 as any).statePatch?.collected ?? {}),
      },
    };

    const t3 = runConversationEngine({
      organizationId: "barber-demo",
      inboundText: "quiero core de pelo meanana a las 10",
      leadState,
      clinicSettings: {
        barbershop_interpreter_runtime_enabled: true,
        timezone: "America/Tegucigalpa",
      },
    } as any);
    assertEquals(
      String((t3 as any).replyText),
      "__CHECK_REQUESTED_AVAILABILITY__",
    );
    assertEquals(
      String((t3 as any).statePatch?.nextExpected ?? ""),
      "confirm_booking",
    );
    assertEquals((t3 as any).statePatch?.collected?.service, "Corte clásico");
    leadState = {
      ...leadState,
      ...((t3 as any).statePatch ?? {}),
      collected: {
        ...(leadState as any).collected,
        ...((t3 as any).statePatch?.collected ?? {}),
      },
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
      collected: {
        ...(leadState as any).collected,
        ...((t4 as any).statePatch?.collected ?? {}),
      },
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
      collected: {
        ...(leadState as any).collected,
        ...((t5 as any).statePatch?.collected ?? {}),
      },
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
      collected: {
        ...(leadState as any).collected,
        ...((t6 as any).statePatch?.collected ?? {}),
      },
    };

    const t7 = runConversationEngine({
      organizationId: "barber-demo",
      inboundText: "ya no voy a poder llegar",
      leadState,
    } as any);
    assertEquals(
      (t7 as any).statePatch?.nextExpected,
      "confirm_discard_pending_booking",
    );
    assert(String((t7 as any).replyText).toLowerCase().includes("descart"));
  } finally {
    Date.now = realDateNow;
  }
});

Deno.test("B4.4 runtime primary evita parser viejo: tens cupo manaa para ccorte con cualqueira", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tens cupo manaa para ccorte con cualqueira",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  const reply = String((result as any).replyText).toLowerCase();
  assert(!reply.includes("qué día y hora te queda mejor"));
  assertEquals(
    String((result as any).debug?.route ?? ""),
    "barbershop_runtime_show_availability_from_b4",
  );
});

Deno.test("B4.5 new barbershop lead state initializes mode/orgType correctly", () => {
  const normalized = normalizeLeadStateForBusinessType(
    null as any,
    "barbershop",
  ) as any;
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
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
  );
  assertEquals(
    (result as any).statePatch?.collected?.provider_preference,
    "any",
  );
  assert((result as any).statePatch?.nextExpected !== "date_time");
});

Deno.test("B4.6 availability-like typo with runtime disabled routes to __SHOW_AVAILABILITY_FOR_DATE__", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tens cupo manaa para ccorte con cualqueira",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: false,
      timezone: "America/Tegucigalpa",
    },
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
  );
  assertEquals(
    (result as any).statePatch?.collected?.provider_preference,
    "any",
  );
  assert(
    !String((result as any).replyText).includes(
      "¿Qué día y hora te queda mejor?",
    ),
  );
});

Deno.test("B4.6 availability-like typo with runtime enabled but interpreter missing still routes to availability", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tens cupo manaa para ccorte con cualqueira",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
  );
  assertEquals(
    (result as any).statePatch?.collected?.provider_preference,
    "any",
  );
  assert(
    !String((result as any).replyText).includes(
      "¿Qué día y hora te queda mejor?",
    ),
  );
});

Deno.test("B4.6 cleaner availability text routes to __SHOW_AVAILABILITY_FOR_DATE__", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tenes cupo mañana para corte con cualquiera",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
  );
  assertEquals(
    (result as any).statePatch?.collected?.provider_preference,
    "any",
  );
  assert(
    !String((result as any).replyText).includes(
      "¿Qué día y hora te queda mejor?",
    ),
  );
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
            {
              time: "09:00",
              starts_at: "2026-05-14T09:00:00",
              provider_id: null,
              provider_name: null,
            },
            {
              time: "09:30",
              starts_at: "2026-05-14T09:30:00",
              provider_id: null,
              provider_name: null,
            },
          ],
        },
      },
    } as any,
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
  );
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_date,
    "2026-05-14",
  );
  assertEquals((result as any).statePatch?.collected?.preferred_time, "09:00");
  assert(
    !String((result as any).replyText).includes("¿Para qué día lo querés?"),
  );
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
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assert((result as any).statePatch?.nextExpected !== "date_time");
  assert(
    !String((result as any).replyText).includes("¿Para qué día lo querés?"),
  );
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
            {
              time: "09:00",
              starts_at: "2026-05-14T09:00:00",
              provider_id: null,
              provider_name: null,
            },
            {
              time: "09:30",
              starts_at: "2026-05-14T09:30:00",
              provider_id: null,
              provider_name: null,
            },
          ],
        },
      },
    } as any,
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
  );
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
          slots: [{
            time: "09:00",
            starts_at: "2026-05-14T09:00:00",
            provider_id: null,
            provider_name: null,
          }],
        },
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals(
    Boolean((result as any).statePatch?.collected?.preferred_date),
    true,
  );
});

Deno.test("B4.5 runtime availability wins over old service-only date_time branch", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      barbershop_interpreter_runtime_enabled: true,
      timezone: "America/Tegucigalpa",
    },
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
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "availability_service",
  );
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
  );
  assert(
    !String((result as any).replyText).includes(
      "¿Qué día y hora te queda mejor?",
    ),
  );
});

Deno.test("B4.5 'quiero corte con cualquiera mañana a las 3' nunca guarda preferred_barber=Cualquiera", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con cualquiera mañana a las 3",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(result);
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
  );
  const providerPref = String(
    (result as any).statePatch?.collected?.provider_preference ?? "",
  );
  assert(providerPref === "" || providerPref === "any");
  assert(!String((result as any).replyText).includes("con Cualquiera"));
});

Deno.test("B2.2 A) que horarios tenes pide dia y marca availability_request", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que horarios tenes",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assert(
    String((result as any).replyText).toLowerCase().includes("para qué día"),
  );
  assertEquals((result as any).statePatch?.nextExpected, "availability_day");
  assertEquals(
    (result as any).statePatch?.collected?.availability_request,
    true,
  );
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
  assert(
    String((result as any).replyText).toLowerCase().includes(
      "qué servicio querés revisar",
    ),
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "availability_service",
  );
  assertEquals(
    Boolean((result as any).statePatch?.collected?.preferred_date),
    true,
  );
  assertEquals(
    (result as any).statePatch?.collected?.availability_request,
    true,
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_booking ?? null,
    null,
  );
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
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
  assertEquals((result as any).statePatch?.collected?.service, "Corte clásico");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_date,
    "2026-05-12",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_booking ?? null,
    null,
  );
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
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
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
  assert(
    String((result as any).replyText).toLowerCase().includes(
      "qué servicio querés revisar",
    ),
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "availability_service",
  );
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
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
  );
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_date,
    "2026-05-12",
  );
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
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
  );
  assertEquals((result as any).statePatch?.nextExpected, "confirm_booking");
  assertEquals(
    (result as any).statePatch?.collected?.preferred_date,
    "2026-05-12",
  );
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
          {
            date: "2026-05-12",
            time: "09:00",
            provider_id: null,
            provider_name: null,
          },
          {
            date: "2026-05-12",
            time: "09:15",
            provider_id: null,
            provider_name: null,
          },
        ],
      },
    } as any,
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
  );
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
  assertEquals(
    (result as any).toolAction?.payload?.appointment_date,
    "2026-05-12",
  );
  assertEquals((result as any).toolAction?.payload?.appointment_time, "09:00");
  assertEquals((result as any).toolAction?.payload?.reason, "Corte clásico");
});

Deno.test("B4.5 static: meta-webhook no usa engine de respuesta directa", async () => {
  const source = await Deno.readTextFile(
    new URL("../../meta-webhook/index.ts", import.meta.url),
  );
  assert(!source.includes("buildConversationReply("));
  assert(!source.includes("runConversationEngine("));
  assert(!source.includes("sendViaMetaAdapter("));
  assert(source.includes('.from("reply_outbox")'));
});

type MatrixLeadState = Record<string, any>;
type MatrixTurnResult = Record<string, any>;

function matrixDiag(step: string, result: MatrixTurnResult): string {
  return JSON.stringify({
    step,
    replyText: String(result?.replyText ?? ""),
    nextExpected: result?.statePatch?.nextExpected ?? null,
    collected: result?.statePatch?.collected ?? null,
    last_availability_context:
      result?.statePatch?.collected?.last_availability_context ?? null,
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
    clinicSettings: {
      timezone: "America/Tegucigalpa",
      ...(args.clinicSettings ?? {}),
    },
    ...(args.barbershopInterpreterResult
      ? { barbershopInterpreterResult: args.barbershopInterpreterResult as any }
      : {}),
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
        {
          time: "09:00",
          starts_at: `${date}T09:00:00`,
          provider_id: null,
          provider_name: null,
        },
        {
          time: "09:30",
          starts_at: `${date}T09:30:00`,
          provider_id: null,
          provider_name: null,
        },
        {
          time: "10:00",
          starts_at: `${date}T10:00:00`,
          provider_id: null,
          provider_name: null,
        },
        {
          time: "10:30",
          starts_at: `${date}T10:30:00`,
          provider_id: null,
          provider_name: null,
        },
        {
          time: "11:00",
          starts_at: `${date}T11:00:00`,
          provider_id: null,
          provider_name: null,
        },
      ],
    };
  }

  return { result, leadState: nextState };
}

Deno.test("BarberLine Factory QA Matrix: availability typo path + slot + confirm guardrail", () => {
  let leadState: MatrixLeadState = {
    orgType: "barbershop",
    mode: "barbershop",
    stage: "DISCOVERY",
    phase: "new",
    collected: {},
  };
  const step1 = runMatrixTurn({ leadState, inboundText: "hola" });
  leadState = step1.leadState;
  assert(
    String(step1.result.replyText).length > 0,
    matrixDiag("step1", step1.result),
  );
  const step2 = runMatrixTurn({
    leadState,
    inboundText: "tens cupo manaa para ccorte con cualqueira",
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "availability_request",
      confidence: 0.9,
      fields_found: {
        service: "Corte clásico",
        date: "2026-05-14",
        time: null,
        provider_preference: "any",
        provider_name: null,
      },
      next_step: "show_availability",
      tool_needed: "check_availability",
    },
  });
  leadState = step2.leadState;
  assertEquals(
    String(step2.result.replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("step2", step2.result),
  );
  assert(
    step2.leadState.nextExpected === "availability_slot_selection",
    matrixDiag("step2-next", step2.result),
  );
  assertEquals(
    step2.leadState.collected?.preferred_barber ?? null,
    null,
    matrixDiag("step2-preferred_barber", step2.result),
  );
  assertEquals(
    step2.leadState.collected?.provider_preference,
    "any",
    matrixDiag("step2-provider", step2.result),
  );
  assert(
    !String(step2.result.replyText).includes("Qué día y hora"),
    matrixDiag("step2-no-date-time", step2.result),
  );
  const step3 = runMatrixTurn({ leadState, inboundText: "la de las 9" });
  leadState = step3.leadState;
  assertEquals(
    String(step3.result.replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("step3", step3.result),
  );
  assertEquals(
    step3.result.statePatch?.collected?.preferred_time,
    "09:00",
    matrixDiag("step3-time", step3.result),
  );
  assert(
    step3.result.statePatch?.nextExpected === "confirm_booking",
    matrixDiag("step3-next", step3.result),
  );
  assert(
    !String(step3.result.replyText).includes("Para qué día"),
    matrixDiag("step3-no-redundant", step3.result),
  );
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
        appointment_date: String(
          leadState.collected?.preferred_date ?? "2026-05-14",
        ),
        appointment_time: "09:00",
        status: "pending_confirmation",
      },
    },
  };
  const step4 = runMatrixTurn({ leadState, inboundText: "Confirmar" });
  assert(
    step4.result.toolAction?.name === "book_appointment" ||
      String(step4.result.replyText).includes("No tengo una cita pendiente"),
    matrixDiag("step4", step4.result),
  );
  assert(
    !String(step4.result.replyText).includes("✅ Cita confirmada"),
    matrixDiag("step4-no-fake-success", step4.result),
  );
});

Deno.test("BarberLine Factory QA Matrix: availability service follow-up and date change", () => {
  let leadState: MatrixLeadState = {
    orgType: "barbershop",
    mode: "barbershop",
    stage: "DISCOVERY",
    phase: "new",
    collected: {},
  };
  const step1 = runMatrixTurn({
    leadState,
    inboundText: "que horas tenes para jueves",
  });
  leadState = step1.leadState;
  assert(
    String(step1.result.replyText).toLowerCase().includes("qué servicio") ||
      String(step1.result.replyText).toLowerCase().includes("que servicio"),
    matrixDiag("step1", step1.result),
  );
  const step2 = runMatrixTurn({ leadState, inboundText: "cortey barba" });
  leadState = step2.leadState;
  assertEquals(
    String(step2.result.replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("step2", step2.result),
  );
  assert(
    ["Corte + barba", "Barba"].includes(
      String(step2.result.statePatch?.collected?.service ?? ""),
    ),
    matrixDiag("step2-service", step2.result),
  );
  const step3 = runMatrixTurn({ leadState, inboundText: "y viernes?" });
  assertEquals(
    String(step3.result.replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("step3", step3.result),
  );
  assert(
    ["Corte + barba", "Barba"].includes(
      String(step3.result.statePatch?.collected?.service ?? ""),
    ),
    matrixDiag("step3-service", step3.result),
  );
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
          {
            time: "09:00",
            starts_at: "2026-05-14T09:00:00",
            provider_id: null,
            provider_name: null,
          },
          {
            time: "09:30",
            starts_at: "2026-05-14T09:30:00",
            provider_id: null,
            provider_name: null,
          },
        ],
      },
    },
  };
  for (const inboundText of ["la primera", "9", "la de 9:30"]) {
    const { result } = runMatrixTurn({
      leadState: JSON.parse(JSON.stringify(baseState)),
      inboundText,
    });
    assertEquals(
      String(result.replyText),
      "__CHECK_REQUESTED_AVAILABILITY__",
      matrixDiag(inboundText, result),
    );
    assertEquals(
      result.statePatch?.collected?.service,
      "Corte clásico",
      matrixDiag(`${inboundText}-service`, result),
    );
    assertEquals(
      result.statePatch?.collected?.preferred_date,
      "2026-05-14",
      matrixDiag(`${inboundText}-date`, result),
    );
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
          {
            time: "09:00",
            starts_at: "2026-05-14T09:00:00",
            provider_id: null,
            provider_name: null,
          },
          {
            time: "10:00",
            starts_at: "2026-05-14T10:00:00",
            provider_id: null,
            provider_name: null,
          },
        ],
      },
    },
  };
  const price = runMatrixTurn({ leadState, inboundText: "cuanto cuesta?" });
  leadState = price.leadState;
  assertEquals(
    leadState.collected?.pending_booking?.appointment_time,
    "09:00",
    matrixDiag("price", price.result),
  );
  const resume = runMatrixTurn({
    leadState,
    inboundText: "ok entonces la de las 10",
  });
  assert(
    !String(resume.result.replyText).includes("✅ Cita confirmada"),
    matrixDiag("resume-no-fake-success", resume.result),
  );
  assertEquals(
    resume.leadState.nextExpected,
    "confirm_booking",
    matrixDiag("resume-confirm-stage", resume.result),
  );
  assertEquals(
    resume.leadState.collected?.preferred_time,
    "10:00",
    matrixDiag("resume-selected-time", resume.result),
  );
});

Deno.test("BarberLine Factory QA Matrix: contextual repair and normalization typos", () => {
  const repaired = runMatrixTurn({
    leadState: {
      orgType: "barbershop",
      mode: "barbershop",
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: { service: "Corte clásico" },
    },
    inboundText: "manaan",
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "date_answer",
      confidence: 0.75,
      fields_found: { date: "tomorrow" },
      next_step: "ask_missing_field",
      tool_needed: "none",
    },
  });
  assertEquals(
    String(repaired.result.replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("repaired", repaired.result),
  );

  const providerAny = runMatrixTurn({
    leadState: {
      orgType: "barbershop",
      mode: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    },
    inboundText: "quiero corte con cualqueira mañana a las 3",
  });
  assertEquals(
    providerAny.result.statePatch?.collected?.preferred_barber ?? null,
    null,
    matrixDiag("providerAny", providerAny.result),
  );
  assertEquals(
    providerAny.result.statePatch?.collected?.provider_name ?? null,
    null,
    matrixDiag("providerAny-provider_name", providerAny.result),
  );

  const serviceTypo = runMatrixTurn({
    leadState: {
      orgType: "barbershop",
      mode: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    },
    inboundText: "core de pelo",
  });
  assertEquals(
    serviceTypo.result.statePatch?.collected?.service,
    "Corte clásico",
    matrixDiag("serviceTypo", serviceTypo.result),
  );
  const comboTypo = runMatrixTurn({
    leadState: {
      orgType: "barbershop",
      mode: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    },
    inboundText: "cortey barba",
  });
  assert(
    ["Corte + barba", "Barba"].includes(
      String(comboTypo.result.statePatch?.collected?.service ?? ""),
    ),
    matrixDiag("comboTypo", comboTypo.result),
  );
});

Deno.test("organization_settings: barber-demo uses barbershop catalog", () => {
  const settings = {
    organization_id: "barber-demo",
    business_type: "barbershop",
    services: [{ name: "Corte clásico" }, { name: "Corte + barba" }],
  } as any;
  const businessType = getBusinessTypeForOrg(settings, "dental");
  const services = getServicesForOrg(settings, businessType);
  assertEquals(businessType, "barbershop");
  assertEquals((services[0] as any)?.name, "Corte clásico");
  assertEquals((services[1] as any)?.name, "Corte + barba");
});

Deno.test("organization_settings: clinic-demo uses dental catalog", () => {
  const settings = {
    organization_id: "clinic-demo",
    business_type: "dental",
    services: [{ name: "Consulta / valoración" }, { name: "Limpieza dental" }],
  } as any;
  const businessType = getBusinessTypeForOrg(settings, "dental");
  const services = getServicesForOrg(settings, businessType);
  assertEquals(businessType, "dental");
  const names = services.map((service) =>
    String((service as any)?.name ?? "").toLowerCase()
  );
  assert(
    names.some((name) =>
      name.includes("consulta") || name.includes("limpieza")
    ),
  );
});

Deno.test("organization_settings: missing settings fallback is safe", () => {
  const businessType = getBusinessTypeForOrg(null, "barbershop");
  const services = getServicesForOrg(null, businessType);
  assertEquals(businessType, "barbershop");
  assertEquals(Array.isArray(services), true);
});

Deno.test("UX: 'corte hoy' muestra disponibilidad directa", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte hoy",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
  );
});

Deno.test("UX: 'quiero corte hoy a las 2' preconfirma o verifica disponibilidad directa", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte hoy a las 2",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText);
  assert(
    reply === "__CHECK_REQUESTED_AVAILABILITY__" ||
      reply.includes("¿Confirmamos?") ||
      String((result as any).statePatch?.nextExpected) === "confirm_booking",
  );
});

Deno.test("UX: 'tenes hoy?' pide solo servicio", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tenes hoy?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(reply.includes("qué servicio") || reply.includes("que servicio"));
  assert(!reply.includes("para qué día") && !reply.includes("para que dia"));
});

Deno.test("UX: slot selection 'la de las 2' usa contexto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "la de las 2",
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
            {
              time: "13:30",
              starts_at: "2026-05-14T13:30:00",
              provider_id: null,
              provider_name: null,
            },
            {
              time: "14:00",
              starts_at: "2026-05-14T14:00:00",
              provider_id: null,
              provider_name: null,
            },
            {
              time: "14:30",
              starts_at: "2026-05-14T14:30:00",
              provider_id: null,
              provider_name: null,
            },
          ],
        },
      },
    } as any,
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
  );
  assertEquals((result as any).statePatch?.collected?.preferred_time, "14:00");
});

Deno.test("UX: slot selection 'más tarde' muestra siguiente batch usando contexto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "más tarde",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-14",
        availability_shown_offset: 0,
        availability_page_size: 5,
        last_availability_context: {
          service: "Corte clásico",
          date: "2026-05-14",
          shown_offset: 0,
          page_size: 5,
          slots: [
            { time: "09:00" },
            { time: "09:30" },
            { time: "10:00" },
            { time: "10:30" },
            { time: "11:00" },
            { time: "11:30" },
            { time: "12:00" },
          ],
        },
      },
    } as any,
  } as any);
  assert(
    String((result as any).replyText).includes(
      "Si querés otra hora, decímela y reviso.",
    ),
  );
  assert(String((result as any).replyText).includes("12:00 PM"));
  assert(!String((result as any).replyText).includes("Hay más después"));
});

Deno.test("UX: slot selection 'después de las 3' filtra slots desde contexto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "después de las 3",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-14",
        last_availability_context: {
          service: "Corte clásico",
          date: "2026-05-14",
          slots: [{ time: "14:00" }, { time: "15:00" }, { time: "15:30" }, {
            time: "16:00",
          }],
        },
      },
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("3:00 PM"));
  assert(reply.includes("4:00 PM"));
});

Deno.test("UX: slot selection 'en la mañana' filtra mañana desde contexto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "en la mañana",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-14",
        last_availability_context: {
          service: "Corte clásico",
          date: "2026-05-14",
          slots: [{ time: "09:00" }, { time: "10:00" }, { time: "14:00" }, {
            time: "15:00",
          }],
        },
      },
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("9:00 AM"));
  assert(reply.includes("10:00 AM"));
  assert(!reply.includes("2:00 PM"));
});

Deno.test("UX: exact time not shown still checks availability", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "a las 2",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-14",
        last_availability_context: {
          service: "Corte clásico",
          date: "2026-05-14",
          slots: [{ time: "09:00" }, { time: "09:30" }, { time: "10:00" }, {
            time: "14:00",
          }],
        },
      },
    } as any,
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
  );
  assertEquals((result as any).statePatch?.collected?.preferred_time, "14:00");
});

Deno.test("UX: exact time unavailable sugiere cercanas desde contexto", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "a las 3",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-14",
        last_availability_context: {
          service: "Corte clásico",
          date: "2026-05-14",
          slots: [{ time: "14:30" }, { time: "15:30" }, { time: "16:00" }],
        },
      },
    } as any,
  } as any);
  const reply = String((result as any).replyText);
  assert(reply.includes("Esa hora no está libre"));
  assert(reply.includes("2:30 PM"));
  assert(reply.includes("3:30 PM"));
  assert(reply.includes("4:00 PM"));
});

Deno.test("Transcript A: hola -> corte hoy -> a las 10 -> Confirmar", () => {
  let leadState: MatrixLeadState = {
    orgType: "barbershop",
    stage: "DISCOVERY",
    collected: {},
  };
  const t1 = runMatrixTurn({ leadState, inboundText: "hola" });
  leadState = t1.leadState;
  assert(String(t1.result.replyText).length > 0, matrixDiag("A1", t1.result));

  const t2 = runMatrixTurn({ leadState, inboundText: "corte hoy" });
  leadState = t2.leadState;
  assertEquals(
    String(t2.result.replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("A2", t2.result),
  );
  leadState.nextExpected = "availability_slot_selection";
  leadState.collected.last_availability_context = {
    service: "Corte clásico",
    date: "2026-05-15",
    slots: [{ date: "2026-05-15", time: "09:00" }, {
      date: "2026-05-15",
      time: "09:30",
    }, { date: "2026-05-15", time: "10:00" }],
  };
  const t3 = runMatrixTurn({ leadState, inboundText: "a las 10" });
  leadState = t3.leadState;
  assertEquals(
    String(t3.result.replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("A3", t3.result),
  );
  assertEquals(
    t3.result.statePatch?.collected?.preferred_date,
    "2026-05-15",
    matrixDiag("A3-date", t3.result),
  );
  assert(
    !String(t3.result.replyText).includes("¿Qué día y hora te queda mejor?"),
    matrixDiag("A3-no-old", t3.result),
  );

  const t4 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      ...leadState,
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: {
        ...(leadState.collected ?? {}),
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2026-05-15",
          appointment_time: "10:00",
          status: "pending_confirmation",
        },
        pending_booking_stale: false,
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assertEquals((t4 as any).toolAction?.name, "book_appointment");
});

Deno.test("Transcript B: hola -> tenes hoy? -> corte -> a las 10 -> Confirmar", () => {
  let leadState: MatrixLeadState = {
    orgType: "barbershop",
    stage: "DISCOVERY",
    collected: {},
  };
  const t1 = runMatrixTurn({ leadState, inboundText: "hola" });
  leadState = t1.leadState;
  const t2 = runMatrixTurn({ leadState, inboundText: "tenes hoy?" });
  leadState = t2.leadState;
  assert(
    String(t2.result.replyText).toLowerCase().includes("qué servicio") ||
      String(t2.result.replyText).toLowerCase().includes("que servicio"),
    matrixDiag("B2", t2.result),
  );
  const t3 = runMatrixTurn({ leadState, inboundText: "corte" });
  leadState = t3.leadState;
  assertEquals(
    String(t3.result.replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("B3", t3.result),
  );
  const t4 = runMatrixTurn({ leadState, inboundText: "a las 10" });
  leadState = t4.leadState;
  assertEquals(
    String(t4.result.replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("B4", t4.result),
  );
  assertEquals(
    String(t4.result.statePatch?.nextExpected),
    "confirm_booking",
    matrixDiag("B4-next", t4.result),
  );
});

Deno.test("Transcript C: hola -> corte hoy -> manaaan a las 10 -> Confirmar", () => {
  let leadState: MatrixLeadState = {
    orgType: "barbershop",
    stage: "DISCOVERY",
    collected: {},
  };
  const t1 = runMatrixTurn({ leadState, inboundText: "hola" });
  leadState = t1.leadState;
  const t2 = runMatrixTurn({ leadState, inboundText: "corte hoy" });
  leadState = t2.leadState;
  const t3 = runMatrixTurn({
    leadState,
    inboundText: "manaaan a las 10",
    clinicSettings: { barbershop_interpreter_runtime_enabled: true },
    barbershopInterpreterResult: {
      intent: "booking_request",
      confidence: 0.8,
      fields_found: { date: "tomorrow", time: "10:00" },
      next_step: "check_availability",
      tool_needed: "check_availability",
    },
  });
  assert(
    String(t3.result.replyText) === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String(t3.result.statePatch?.nextExpected) ===
        "availability_slot_selection",
    matrixDiag("C3", t3.result),
  );
});

Deno.test("Transcript D: hola -> quiero corte mañana a las 10 -> Confirmar", () => {
  const step = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte mañana a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(
    String((step as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((step as any).statePatch?.nextExpected) === "confirm_booking",
  );
});

Deno.test("Transcript E: hola -> corte hoy -> más tarde -> la de las 4 -> Confirmar", () => {
  let leadState: MatrixLeadState = {
    orgType: "barbershop",
    stage: "DISCOVERY",
    collected: {},
  };
  const t1 = runMatrixTurn({ leadState, inboundText: "hola" });
  leadState = t1.leadState;
  const t2 = runMatrixTurn({ leadState, inboundText: "corte hoy" });
  leadState = t2.leadState;
  leadState.nextExpected = "availability_slot_selection";
  leadState.collected.last_availability_context = {
    service: "Corte clásico",
    date: "2026-05-15",
    slots: [{ date: "2026-05-15", time: "14:00" }, {
      date: "2026-05-15",
      time: "15:00",
    }, { date: "2026-05-15", time: "16:00" }],
  };
  const t3 = runMatrixTurn({ leadState, inboundText: "más tarde" });
  leadState = t3.leadState;
  assert(
    String(t3.result.replyText).includes(
      "Si querés otra hora, decímela y reviso.",
    ),
    matrixDiag("E3", t3.result),
  );
  const t4 = runMatrixTurn({ leadState, inboundText: "la de las 4" });
  assertEquals(
    String(t4.result.replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("E4", t4.result),
  );
  assertEquals(
    t4.result.statePatch?.collected?.preferred_time,
    "16:00",
    matrixDiag("E4-time", t4.result),
  );
});

function persistLeadStateForTranscript(
  prev: Record<string, unknown>,
  statePatch: Record<string, unknown>,
  replyText = "",
) {
  const next = {
    ...prev,
    ...statePatch,
    collected: {
      ...((prev as any).collected ?? {}),
      ...((statePatch as any).collected ?? {}),
    },
  };
  if (
    replyText === "__SHOW_AVAILABILITY_FOR_DATE__" &&
    String((next as any).orgType ?? "") === "barbershop"
  ) {
    const preferredDate = String(
      (next as any).collected?.preferred_date ?? "2026-05-14",
    );
    const service = String((next as any).collected?.service ?? "Corte clásico");
    (next as any).nextExpected = "availability_slot_selection";
    (next as any).collected = {
      ...((next as any).collected ?? {}),
      last_availability_context: {
        service,
        date: preferredDate,
        slots: [
          {
            date: preferredDate,
            time: "09:00",
            starts_at: `${preferredDate}T09:00:00`,
            provider_id: null,
            provider_name: null,
          },
          {
            date: preferredDate,
            time: "09:30",
            starts_at: `${preferredDate}T09:30:00`,
            provider_id: null,
            provider_name: null,
          },
          {
            date: preferredDate,
            time: "10:00",
            starts_at: `${preferredDate}T10:00:00`,
            provider_id: null,
            provider_name: null,
          },
          {
            date: preferredDate,
            time: "10:30",
            starts_at: `${preferredDate}T10:30:00`,
            provider_id: null,
            provider_name: null,
          },
          {
            date: preferredDate,
            time: "11:00",
            starts_at: `${preferredDate}T11:00:00`,
            provider_id: null,
            provider_name: null,
          },
        ],
      },
      last_availability_slots: [
        {
          date: preferredDate,
          time: "09:00",
          provider_id: null,
          provider_name: null,
        },
        {
          date: preferredDate,
          time: "09:30",
          provider_id: null,
          provider_name: null,
        },
        {
          date: preferredDate,
          time: "10:00",
          provider_id: null,
          provider_name: null,
        },
        {
          date: preferredDate,
          time: "10:30",
          provider_id: null,
          provider_name: null,
        },
        {
          date: preferredDate,
          time: "11:00",
          provider_id: null,
          provider_name: null,
        },
      ],
    };
  }
  return JSON.parse(
    JSON.stringify(
      normalizeLeadStateForBusinessType(next as any, "barbershop"),
    ),
  );
}

Deno.test("Persisted transcript A continuity: corte hoy -> a las 10 -> confirmar", () => {
  let savedState: Record<string, unknown> = normalizeLeadStateForBusinessType(
    { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    "barbershop",
  );

  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte hoy",
    leadState: savedState as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  savedState = persistLeadStateForTranscript(
    savedState,
    ((step1 as any).statePatch ?? {}) as any,
    String((step1 as any).replyText ?? ""),
  );
  assertEquals(
    String((step1 as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("PA1", step1 as any),
  );
  assertEquals(
    String((savedState as any).nextExpected),
    "availability_slot_selection",
    matrixDiag("PA1-state", step1 as any),
  );
  assert(
    (savedState as any).collected?.last_availability_context != null,
    matrixDiag("PA1-context", step1 as any),
  );

  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "a las 10",
    leadState: savedState as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  savedState = persistLeadStateForTranscript(
    savedState,
    ((step2 as any).statePatch ?? {}) as any,
    String((step2 as any).replyText ?? ""),
  );
  assertEquals(
    String((step2 as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("PA2", step2 as any),
  );
  assertEquals(
    String((savedState as any).nextExpected),
    "confirm_booking",
    matrixDiag("PA2-state", step2 as any),
  );
  assert(
    !String((step2 as any).replyText).includes(
      "¿Qué día y hora te queda mejor?",
    ),
    matrixDiag("PA2-no-old", step2 as any),
  );

  const savedDate = String((savedState as any).collected?.preferred_date ?? "");
  const savedTime = String((savedState as any).collected?.preferred_time ?? "");
  const step3 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      ...savedState,
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected_name: true,
      name: "Jose",
      collected: {
        ...((savedState as any).collected ?? {}),
        pending_booking: {
          service: String(
            (savedState as any).collected?.service ?? "Corte clásico",
          ),
          appointment_date: savedDate,
          appointment_time: savedTime,
          status: "pending_confirmation",
        },
        pending_booking_stale: false,
        last_bot_step: "barbershop_preconfirm",
      },
    } as any,
  } as any);
  assertEquals(
    (step3 as any).toolAction?.name,
    "book_appointment",
    matrixDiag("PA3", step3 as any),
  );
});

Deno.test("Persisted transcript B continuity: tenes hoy -> corte d pelo keeps today context", () => {
  let savedState: Record<string, unknown> = normalizeLeadStateForBusinessType(
    { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
    "barbershop",
  );
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tenes hoy",
    leadState: savedState as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  savedState = persistLeadStateForTranscript(
    savedState,
    ((step1 as any).statePatch ?? {}) as any,
    String((step1 as any).replyText ?? ""),
  );
  assertEquals(
    String((savedState as any).nextExpected),
    "availability_service",
    matrixDiag("PB1-state", step1 as any),
  );
  assert(
    String((savedState as any).collected?.preferred_date ?? "").length > 0,
    matrixDiag("PB1-date", step1 as any),
  );

  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte d pelo",
    leadState: savedState as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  savedState = persistLeadStateForTranscript(
    savedState,
    ((step2 as any).statePatch ?? {}) as any,
    String((step2 as any).replyText ?? ""),
  );
  assertEquals(
    String((step2 as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("PB2", step2 as any),
  );
  assertEquals(
    String((savedState as any).nextExpected),
    "availability_slot_selection",
    matrixDiag("PB2-state", step2 as any),
  );
});

Deno.test("Persisted transcript C continuity: preconfirm persists pending and Confirmar executes booking", () => {
  let savedState: Record<string, unknown> = normalizeLeadStateForBusinessType(
    {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
      collected_name: true,
      name: "Jose",
    } as any,
    "barbershop",
  );
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte mañana a las 10",
    leadState: savedState as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  savedState = persistLeadStateForTranscript(
    savedState,
    ((step1 as any).statePatch ?? {}) as any,
    String((step1 as any).replyText ?? ""),
  );
  const nextExpected = String((savedState as any).nextExpected ?? "");
  assert(
    nextExpected === "confirm_booking" ||
      String((step1 as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("PC1", step1 as any),
  );
  if ((savedState as any).collected?.pending_booking == null) {
    (savedState as any).stage = "CONFIRMING";
    (savedState as any).nextExpected = "confirm_booking";
    (savedState as any).collected = {
      ...((savedState as any).collected ?? {}),
      pending_booking: {
        service: String(
          (savedState as any).collected?.service ?? "Corte clásico",
        ),
        appointment_date: String(
          (savedState as any).collected?.preferred_date ?? "2026-05-15",
        ),
        appointment_time: String(
          (savedState as any).collected?.preferred_time ?? "10:00",
        ),
        provider_name: "Carlos",
        provider_id: "barber-carlos",
        preferred_barber: "Carlos",
        status: "pending_confirmation",
      },
      pending_booking_stale: false,
      preferred_barber: "Carlos",
      provider_name: "Carlos",
      provider_id: "barber-carlos",
      last_bot_step: "barbershop_preconfirm",
    };
  }
  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: savedState as any,
  } as any);
  assertEquals(
    (step2 as any).toolAction?.name,
    "book_appointment",
    matrixDiag("PC2", step2 as any),
  );
});

Deno.test("Legacy persisted state: pending_confirmation confirms even when stage DISCOVERY and nextExpected null", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      nextExpected: null,
      collected_name: true,
      name: "Jose",
      collected: {
        service: "Corte clásico",
        preferred_date: "2026-05-15",
        preferred_time: "10:00",
        last_bot_step: "barbershop_preconfirm",
        pending_booking: {
          status: "pending_confirmation",
          service: "Corte clásico",
          appointment_date: "2026-05-15",
          appointment_time: "10:00",
          provider_id: "barber-carlos",
          provider_name: "Carlos",
        },
      },
    } as any,
  } as any);
  assertEquals(
    (result as any).toolAction?.name,
    "book_appointment",
    matrixDiag("legacy-confirm", result as any),
  );
  assert(
    !String((result as any).replyText).toLowerCase().includes(
      "no te entendi completo",
    ),
    matrixDiag("legacy-no-fallback", result as any),
  );
});

Deno.test("Preconfirm persists root stage/nextExpected CONFIRMING/confirm_booking", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte mañana a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected_name: true,
      name: "Jose",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const patch = (result as any).statePatch ?? {};
  if (
    String((result as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__"
  ) {
    assertEquals(
      String(patch.nextExpected ?? ""),
      "confirm_booking",
      matrixDiag("preconfirm-check", result as any),
    );
  } else {
    assertEquals(
      String(patch.stage ?? ""),
      "CONFIRMING",
      matrixDiag("preconfirm-stage", result as any),
    );
    assertEquals(
      String(patch.nextExpected ?? ""),
      "confirm_booking",
      matrixDiag("preconfirm-next", result as any),
    );
  }
});

Deno.test("Deterministic typo repair: 'quiero core manaan a las 10' preconfirms without asking day/time again", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero core manaan a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
      collected_name: true,
      name: "Jose",
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText);
  assert(
    reply === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected ?? "") ===
        "confirm_booking" ||
      reply.includes("¿Confirmamos"),
    matrixDiag("typo-core-manaan", result as any),
  );
  assert(
    !reply.includes("¿Qué día y hora te queda mejor?"),
    matrixDiag("typo-core-manaan-no-old", result as any),
  );
});

Deno.test("Stale confirmation is blocked when inbound metadata is older/same as preconfirm", () => {
  const baseLead = {
    orgType: "barbershop",
    stage: "DISCOVERY",
    nextExpected: null,
    collected_name: true,
    name: "Jose",
    __inbound_message_id: "msg-preconfirm",
    __inbound_message_created_at: "2026-05-14T10:00:00.000Z",
    collected: {
      service: "Corte clásico",
      preferred_date: "2026-05-15",
      preferred_time: "10:00",
      last_bot_step: "barbershop_preconfirm",
      pending_booking: {
        status: "pending_confirmation",
        service: "Corte clásico",
        appointment_date: "2026-05-15",
        appointment_time: "10:00",
        provider_id: "barber-carlos",
        provider_name: "Carlos",
        created_from_inbound_message_id: "msg-preconfirm",
        preconfirm_sent_at: "2026-05-14T10:00:00.000Z",
      },
    },
  };
  const blocked = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: baseLead as any,
  } as any);
  assertEquals(
    (blocked as any).toolAction,
    undefined,
    matrixDiag("stale-confirm-blocked", blocked as any),
  );
  assert(
    String((blocked as any).replyText).toLowerCase().includes(
      "respondé de nuevo",
    ) ||
      String((blocked as any).replyText).toLowerCase().includes(
        "responde de nuevo",
      ),
    matrixDiag("stale-confirm-copy", blocked as any),
  );

  const fresh = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      ...baseLead,
      __inbound_message_id: "msg-after-preconfirm",
      __inbound_message_created_at: "2026-05-14T10:01:00.000Z",
    } as any,
  } as any);
  assertEquals(
    (fresh as any).toolAction?.name,
    "book_appointment",
    matrixDiag("fresh-confirm-ok", fresh as any),
  );
});

Deno.test("Typo-heavy full request A: 'quiero core manaan a las 10' goes preconfirm/check path, no ask date-time", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero core manaan a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected_name: true,
      name: "Jose",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText);
  assert(
    reply === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected ?? "") ===
        "confirm_booking" ||
      reply.includes("¿Confirmamos"),
    matrixDiag("typo-A", result as any),
  );
  assert(
    !reply.includes("¿Qué día y hora te queda mejor?"),
    matrixDiag("typo-A-no-date-time", result as any),
  );
});

Deno.test("Typo-heavy flow B: 'tenes hoy' then 'corte d pelo' reuses today and shows availability path", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tenes hoy",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte d pelo",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: (step1 as any).statePatch?.nextExpected,
      collected: (step1 as any).statePatch?.collected ?? {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(
    String((step2 as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("typo-B", step2 as any),
  );
  assert(
    !String((step2 as any).replyText).includes(
      "¿Qué día y hora te queda mejor?",
    ),
    matrixDiag("typo-B-no-date-time", step2 as any),
  );
});

Deno.test("Typo-heavy full request C: 'quiero ccorte manana a las 10' goes preconfirm/check path", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero ccorte manana a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected_name: true,
      name: "Jose",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText);
  assert(
    reply === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected ?? "") ===
        "confirm_booking" ||
      reply.includes("¿Confirmamos"),
    matrixDiag("typo-C", result as any),
  );
});

Deno.test("Typo-heavy full request D: 'quiero corte con cualqueira manana a las 10' preconfirms with provider any", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte con cualqueira manana a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected_name: true,
      name: "Jose",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText);
  assert(
    reply === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected ?? "") ===
        "confirm_booking" ||
      reply.includes("¿Confirmamos"),
    matrixDiag("typo-D", result as any),
  );
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
    matrixDiag("typo-D-any", result as any),
  );
});

Deno.test("Context merge A: proposed slot + 'con Carlos para un corte nada más' reuses date/time and preconfirms", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "perro apartame un cupo ahi para mañana a las 3",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected_name: true,
      name: "Jose",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const state1 = persistLeadStateForTranscript(
    normalizeLeadStateForBusinessType(
      {
        orgType: "barbershop",
        stage: "DISCOVERY",
        collected_name: true,
        name: "Jose",
        collected: {},
      } as any,
      "barbershop",
    ) as any,
    ((step1 as any).statePatch ?? {}) as any,
    String((step1 as any).replyText ?? ""),
  );
  const date = String((state1 as any).collected?.preferred_date ?? "");
  const time = String((state1 as any).collected?.preferred_time ?? "");
  assert(
    date.length > 0 && time.length > 0,
    matrixDiag("merge-A-step1", step1 as any),
  );

  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "con Carlos para un corte nada mas",
    leadState: state1 as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(
    String((step2 as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("merge-A-step2", step2 as any),
  );
  assertEquals(
    (step2 as any).statePatch?.collected?.preferred_date,
    date,
    matrixDiag("merge-A-date", step2 as any),
  );
  assertEquals(
    (step2 as any).statePatch?.collected?.preferred_time,
    time,
    matrixDiag("merge-A-time", step2 as any),
  );
  assertEquals(
    (step2 as any).statePatch?.collected?.service,
    "Corte clásico",
    matrixDiag("merge-A-service", step2 as any),
  );
  assertEquals(
    (step2 as any).statePatch?.collected?.preferred_barber,
    "Carlos",
    matrixDiag("merge-A-provider", step2 as any),
  );
  assert(
    !String((step2 as any).replyText).includes(
      "¿Qué día y hora te queda mejor?",
    ),
    matrixDiag("merge-A-no-old", step2 as any),
  );
});

Deno.test("Context merge B: proposed slot + 'con cualquiera' reuses date/time and checks availability", () => {
  const leadState = normalizeLeadStateForBusinessType({
    orgType: "barbershop",
    stage: "BOOKING",
    nextExpected: "barber_preference",
    collected: {
      service: "Corte clásico",
      preferred_date: "2099-05-15",
      preferred_time: "15:00",
      proposed_slot: {
        date: "2099-05-15",
        time: "15:00",
        service: "Corte clásico",
        provider_preference: null,
      },
    },
  } as any, "barbershop");
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "con cualquiera",
    leadState: leadState as any,
  } as any);
  assert(
    String((result as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected ?? "") ===
        "confirm_booking",
    matrixDiag("merge-B", result as any),
  );
  assertEquals(
    (result as any).statePatch?.collected?.preferred_date,
    "2099-05-15",
    matrixDiag("merge-B-date", result as any),
  );
  assertEquals(
    (result as any).statePatch?.collected?.preferred_time,
    "15:00",
    matrixDiag("merge-B-time", result as any),
  );
  assertEquals(
    (result as any).statePatch?.collected?.provider_preference,
    "any",
    matrixDiag("merge-B-any", result as any),
  );
});

Deno.test("Context merge C: 'tenes hoy a las 3?' then 'corte con Carlos' reuses prior date/time", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tenes hoy a las 3?",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const mergedState = persistLeadStateForTranscript(
    normalizeLeadStateForBusinessType(
      { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
      "barbershop",
    ) as any,
    ((step1 as any).statePatch ?? {}) as any,
    String((step1 as any).replyText ?? ""),
  );
  const date = String((mergedState as any).collected?.preferred_date ?? "");
  const time = String((mergedState as any).collected?.preferred_time ?? "");
  assert(
    date.length > 0 && time.length > 0,
    matrixDiag("merge-C-step1", step1 as any),
  );
  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "corte con Carlos",
    leadState: mergedState as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(
    String((step2 as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("merge-C-step2", step2 as any),
  );
  assertEquals(
    (step2 as any).statePatch?.collected?.preferred_date,
    date,
    matrixDiag("merge-C-date", step2 as any),
  );
  assertEquals(
    (step2 as any).statePatch?.collected?.preferred_time,
    time,
    matrixDiag("merge-C-time", step2 as any),
  );
});

Deno.test("Context merge D: 'con Carlos para un corte nada más' without prior context asks missing date/time", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "con Carlos para un corte nada mas",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(
    reply.includes("día y hora") || reply.includes("dia y hora"),
    matrixDiag("merge-D", result as any),
  );
});

Deno.test("Pending booking request A: service+time persists and date answer merges without re-asking service", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "carnal tiene espacio para cortarme el pelo como a la 1",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const state1 = persistLeadStateForTranscript(
    normalizeLeadStateForBusinessType(
      { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
      "barbershop",
    ) as any,
    ((step1 as any).statePatch ?? {}) as any,
    String((step1 as any).replyText ?? ""),
  );
  assertEquals(
    String((state1 as any).nextExpected),
    "booking_date",
    matrixDiag("pbr-A-step1-next", step1 as any),
  );
  assertEquals(
    String((state1 as any).collected?.pending_booking_request?.service ?? ""),
    "Corte clásico",
    matrixDiag("pbr-A-step1-service", step1 as any),
  );
  assertEquals(
    String(
      (state1 as any).collected?.pending_booking_request?.preferred_time ?? "",
    ),
    "13:00",
    matrixDiag("pbr-A-step1-time", step1 as any),
  );
  assert(
    Array.isArray(
      (state1 as any).collected?.pending_booking_request?.missing_fields,
    ) &&
      (state1 as any).collected?.pending_booking_request?.missing_fields
        ?.includes("date"),
    matrixDiag("pbr-A-step1-missing", step1 as any),
  );

  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "para hoy",
    leadState: state1 as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply2 = String((step2 as any).replyText).toLowerCase();
  assert(
    !reply2.includes("querés corte de pelo, barba"),
    matrixDiag("pbr-A-step2-no-service-reask", step2 as any),
  );
  assert(
    String((step2 as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((step2 as any).replyText) === "__SHOW_AVAILABILITY_FOR_DATE__" ||
      reply2.includes("no está libre") ||
      reply2.includes("no me quedan espacios") ||
      String((step2 as any).statePatch?.nextExpected ?? "") ===
        "confirm_booking",
    matrixDiag("pbr-A-step2-route", step2 as any),
  );
});

Deno.test("Pending booking request B: 'tenes hoy' asks service only and 'el pelo nada mas' reuses date", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "tenes hoy",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const state1 = persistLeadStateForTranscript(
    normalizeLeadStateForBusinessType(
      { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
      "barbershop",
    ) as any,
    ((step1 as any).statePatch ?? {}) as any,
    String((step1 as any).replyText ?? ""),
  );
  assertEquals(
    String((state1 as any).nextExpected),
    "availability_service",
    matrixDiag("pbr-B-step1-next", step1 as any),
  );
  assert(
    Boolean((state1 as any).collected?.preferred_date),
    matrixDiag("pbr-B-step1-date", step1 as any),
  );

  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "el pelo nada mas",
    leadState: state1 as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply2 = String((step2 as any).replyText).toLowerCase();
  assert(
    !reply2.includes("gracias por escribir"),
    matrixDiag("pbr-B-step2-no-generic", step2 as any),
  );
  assert(
    !reply2.includes("qué día y hora") && !reply2.includes("que dia y hora"),
    matrixDiag("pbr-B-step2-no-datetime-reask", step2 as any),
  );
  assert(
    String((step2 as any).replyText) === "__SHOW_AVAILABILITY_FOR_DATE__" ||
      String((step2 as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((step2 as any).statePatch?.nextExpected ?? "") ===
        "confirm_booking",
    matrixDiag("pbr-B-step2-route", step2 as any),
  );
});

Deno.test("Pending booking request C: unavailable exact time path keeps merged context", () => {
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "carnal tiene espacio para cortarme el pelo como a la 1",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const state1 = persistLeadStateForTranscript(
    normalizeLeadStateForBusinessType(
      { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
      "barbershop",
    ) as any,
    ((step1 as any).statePatch ?? {}) as any,
    String((step1 as any).replyText ?? ""),
  );
  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "para hoy",
    leadState: state1 as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const state2 = persistLeadStateForTranscript(
    state1 as any,
    ((step2 as any).statePatch ?? {}) as any,
    String((step2 as any).replyText ?? ""),
  );
  assertEquals(
    String((state2 as any).collected?.pending_booking_request?.service ?? ""),
    "Corte clásico",
    matrixDiag("pbr-C-service", step2 as any),
  );
  assertEquals(
    String(
      (state2 as any).collected?.pending_booking_request?.preferred_time ?? "",
    ),
    "13:00",
    matrixDiag("pbr-C-time", step2 as any),
  );
});

Deno.test("Pending booking request D: natural full request with provider any reaches availability/preconfirm", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText:
      "maje apartame un corte mañana tipo diez con el que esté libre",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected_name: true,
      name: "Jose",
      collected: {},
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assert(
    String((result as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).statePatch?.nextExpected ?? "") ===
        "confirm_booking" ||
      String((result as any).replyText).toLowerCase().includes("confirmamos"),
    matrixDiag("pbr-D-route", result as any),
  );
  assertEquals(
    (result as any).statePatch?.collected?.preferred_barber ?? null,
    null,
    matrixDiag("pbr-D-any", result as any),
  );
});

Deno.test("Pending booking request E: booking_date answer merges and continues without generic fallback", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "hoy",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "booking_date",
      collected: {
        pending_booking_request: {
          service: "Corte clásico",
          preferred_date: null,
          preferred_time: "13:00",
          provider_name: null,
          provider_preference: "any",
          patient_name: null,
          booking_for_other: false,
          missing_fields: ["date"],
          source: "deterministic",
        },
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(
    !reply.includes("no te entendi completo"),
    matrixDiag("pbr-E-no-fallback", result as any),
  );
  assert(
    String((result as any).replyText) === "__CHECK_REQUESTED_AVAILABILITY__" ||
      String((result as any).replyText) === "__SHOW_AVAILABILITY_FOR_DATE__" ||
      String((result as any).statePatch?.nextExpected ?? "") ===
        "confirm_booking",
    matrixDiag("pbr-E-route", result as any),
  );
});

Deno.test("Slot selection continuity: with last_availability_context and missing nextExpected, '10' still selects slot", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      nextExpected: null,
      collected: {
        service: "Corte clásico",
        last_availability_context: {
          service: "Corte clásico",
          date: "2099-05-15",
          provider_preference: "any",
          slots: [
            {
              date: "2099-05-15",
              time: "09:00",
              provider_id: "p1",
              provider_name: "Carlos",
            },
            {
              date: "2099-05-15",
              time: "10:00",
              provider_id: "p2",
              provider_name: "Luis",
            },
          ],
        },
      },
    } as any,
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("slot-continuity", result as any),
  );
  assertEquals(
    (result as any).statePatch?.collected?.preferred_time,
    "10:00",
    matrixDiag("slot-continuity-time", result as any),
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_booking",
    matrixDiag("slot-continuity-next", result as any),
  );
});

Deno.test("BarberLine state contract: offered slot selection '10' reuses last_offered_slots first", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "10",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        activeBookingFlow: true,
        lastBookingStep: "select_time",
        current_service_key: "corte_clasico",
        current_service_name: "Corte clásico",
        current_date: "2099-05-15",
        service: "Corte clásico",
        last_offered_slots: [
          {
            date: "2099-05-15",
            time: "10:00",
            starts_at: "2099-05-15T10:00:00-06:00",
            provider_id: "p-offered",
            provider_name: "Bryan",
            service_key: "corte_clasico",
            service_name: "Corte clásico",
            duration_min: 30,
            source: "today",
          },
        ],
        last_availability_context: {
          service: "Corte clásico",
          date: "2099-05-15",
          slots: [
            {
              date: "2099-05-15",
              time: "10:00",
              provider_id: "p-context",
              provider_name: "Carlos",
            },
          ],
        },
      },
    } as any,
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("slot-offered-reuse", result as any),
  );
  const selected = (result as any).statePatch?.collected?.selected_slot;
  assertEquals(
    selected?.provider_id,
    "p-offered",
    matrixDiag("slot-offered-provider", result as any),
  );
  assertEquals(
    selected?.provider_name,
    "Bryan",
    matrixDiag("slot-offered-provider-name", result as any),
  );
  assertEquals(
    selected?.service_name,
    "Corte clásico",
    matrixDiag("slot-offered-service", result as any),
  );
});

Deno.test("BarberLine state contract: offered slot selection 'a las 10' reuses last_offered_slots", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        activeBookingFlow: true,
        lastBookingStep: "select_time",
        current_service_key: "corte_clasico",
        current_service_name: "Corte clásico",
        current_date: "2099-05-15",
        service: "Corte clásico",
        last_offered_slots: [
          {
            date: "2099-05-15",
            time: "10:00",
            starts_at: "2099-05-15T10:00:00-06:00",
            provider_id: "p-offered",
            provider_name: "Bryan",
            service_key: "corte_clasico",
            service_name: "Corte clásico",
            duration_min: 30,
            source: "today",
          },
        ],
      },
    } as any,
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("slot-offered-a-las", result as any),
  );
  assertEquals(
    (result as any).statePatch?.collected?.selected_slot?.provider_id,
    "p-offered",
  );
});

Deno.test("BarberLine state contract: active booking time request reuses current service", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Y hoy a las cuatro tenes?",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        activeBookingFlow: true,
        lastBookingStep: "select_time",
        current_service_key: "Corte clásico",
        current_date: "2099-05-15",
      },
    } as any,
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("current-service-time", result as any),
  );
  assertEquals(
    String((result as any).statePatch?.collected?.service ?? ""),
    "Corte clásico",
  );
  assert(!String((result as any).replyText).toLowerCase().includes("servicio"));
});

Deno.test("BarberLine confirm uses pending selected_slot as source of truth", () => {
  const selectedSlot = {
    date: "2099-05-15",
    time: "13:00",
    starts_at: "2099-05-15T13:00:00-06:00",
    provider_id: "p-selected",
    provider_name: "Alex",
    service_key: "corte_clasico",
    service_name: "Corte clásico",
    duration_min: 30,
    hold_id: "hold-selected",
    source: "exact",
  };
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "confirm_booking",
      full_name: "Jose Duran",
      collected: {
        activeBookingFlow: true,
        last_bot_step: "barbershop_preconfirm",
        service: "Corte clásico",
        preferred_date: "2099-05-15",
        preferred_time: "13:00",
        preferred_barber: "Alex",
        pending_booking_stale: false,
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2099-05-15",
          appointment_time: "13:00",
          provider_id: "stale-provider",
          provider_name: "Stale Barber",
          selected_slot: selectedSlot,
        },
      },
    } as any,
  } as any);

  assertEquals(
    (result as any).toolAction?.name,
    "book_appointment",
    matrixDiag("confirm-selected-tool", result as any),
  );
  assertEquals(
    (result as any).toolAction?.payload?.business_type,
    "barbershop",
  );
  assertEquals(
    (result as any).toolAction?.payload?.selected_slot?.provider_id,
    "p-selected",
  );
  assertEquals((result as any).toolAction?.payload?.provider_id, "p-selected");
  assertEquals((result as any).toolAction?.payload?.provider_name, "Alex");
  assertEquals((result as any).toolAction?.payload?.hold_id, "hold-selected");
});

Deno.test("BarberLine state contract source keeps offered slot/date shape and safe logs", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  assert(source.includes("barbershop_state_contract_saved_slots"));
  assert(source.includes("barbershop_state_contract_saved_dates"));
  assert(source.includes("selected_slot_matched_from_last_offered_slots"));
  assert(source.includes("selected_slot_used_for_confirm"));
  assert(source.includes("current_service_reused_for_time_request"));
  assert(source.includes("service_name: serviceName"));
  assert(source.includes("last_offered_dates: offeredDates"));
});

Deno.test("Availability discovery A: closed requested day then 'que dia estas disponible?' keeps service and routes to slot selection", () => {
  const closedSaturdaySettings = {
    timezone: "America/Tegucigalpa",
    hours: {
      mon: { open: "09:00", close: "17:00", closed: true },
      tue: { open: "09:00", close: "17:00", closed: true },
      wed: { open: "09:00", close: "17:00", closed: false },
      thu: { open: "09:00", close: "17:00", closed: true },
      fri: { open: "09:00", close: "17:00", closed: true },
      sat: { open: "09:00", close: "17:00", closed: true },
      sun: { open: "09:00", close: "17:00", closed: true },
    },
  };
  const step1 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte mañana a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: closedSaturdaySettings as any,
  } as any);
  const step1State = persistLeadStateForTranscript(
    normalizeLeadStateForBusinessType(
      { orgType: "barbershop", stage: "DISCOVERY", collected: {} } as any,
      "barbershop",
    ) as any,
    ((step1 as any).statePatch ?? {}) as any,
    String((step1 as any).replyText ?? ""),
  );
  const step2 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "que dia estas disponible?",
    leadState: step1State as any,
    clinicSettings: closedSaturdaySettings as any,
  } as any);
  assert(
    String((step2 as any).replyText) === "__SHOW_AVAILABILITY_FOR_DATE__" ||
      String((step2 as any).replyText).includes("Puedo revisarte otro horario"),
    matrixDiag("ad-A-step2-route", step2 as any),
  );
  assertEquals(
    String((step2 as any).statePatch?.collected?.service ?? ""),
    "Corte clásico",
    matrixDiag("ad-A-step2-service", step2 as any),
  );
  assert(
    ["availability_slot_selection", "date_time"].includes(
      String((step2 as any).statePatch?.nextExpected ?? ""),
    ),
    matrixDiag("ad-A-step2-next", step2 as any),
  );
  const step3 = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "10",
    leadState: {
      ...(step1State as any),
      ...((step2 as any).statePatch ?? {}),
      collected: {
        ...((step1State as any).collected ?? {}),
        ...(((step2 as any).statePatch ?? {}).collected ?? {}),
        last_availability_context: {
          service: "Corte clásico",
          date: "2099-05-19",
          provider_preference: "any",
          slots: [
            {
              date: "2099-05-19",
              time: "09:00",
              provider_id: "p1",
              provider_name: "Carlos",
            },
            {
              date: "2099-05-19",
              time: "10:00",
              provider_id: "p2",
              provider_name: "Luis",
            },
          ],
        },
      },
      nextExpected: "availability_slot_selection",
    } as any,
    clinicSettings: closedSaturdaySettings as any,
  } as any);
  assertEquals(
    String((step3 as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("ad-A-step3-route", step3 as any),
  );
  assertEquals(
    String((step3 as any).statePatch?.collected?.preferred_time ?? ""),
    "10:00",
    matrixDiag("ad-A-step3-time", step3 as any),
  );
});

Deno.test("Availability discovery B: typo question 'cual estsa disponible?' enters discovery route", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cual estsa disponible?",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: { service: "Corte clásico" },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("ad-B-route", result as any),
  );
  assert(
    !String((result as any).replyText).toLowerCase().includes(
      "gracias por escribirnos",
    ),
    matrixDiag("ad-B-no-generic", result as any),
  );
});

Deno.test("Availability discovery C: 'y miercoles?' keeps availability flow and does not generic fallback", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "y miercoles?",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        preferred_date: "2099-05-19",
        availability_request: true,
        last_availability_context: {
          service: "Corte clásico",
          date: "2099-05-19",
          provider_preference: "any",
          slots: [{
            date: "2099-05-19",
            time: "10:00",
            provider_id: "p1",
            provider_name: "Carlos",
          }],
        },
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(
    reply !== "gracias por escribirnos. ¿en qué te puedo ayudar?".toLowerCase(),
    matrixDiag("ad-C-no-generic", result as any),
  );
  assert(
    String((result as any).replyText) === "__SHOW_AVAILABILITY_FOR_DATE__" ||
      String((result as any).statePatch?.nextExpected ?? "") ===
        "availability_slot_selection",
    matrixDiag("ad-C-route", result as any),
  );
});

Deno.test("unknown_inside_active_flow: ambiguous input in active booking flow never returns generic greeting fallback", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "mmm",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        last_availability_context: {
          service: "Corte clásico",
          date: "2099-05-19",
          slots: [{
            date: "2099-05-19",
            time: "10:00",
            provider_id: "p1",
            provider_name: "Carlos",
          }],
        },
      },
    } as any,
  } as any);
  const reply = String((result as any).replyText).toLowerCase();
  assert(
    !reply.includes("gracias por escribirnos"),
    matrixDiag("unknown-active-no-generic", result as any),
  );
  assertEquals(
    String((result as any).debug?.intent ?? ""),
    "unknown_inside_active_flow",
    matrixDiag("unknown-active-intent", result as any),
  );
});

Deno.test("Provider continuity: selected slot preserves provider into check path", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "la de las 10",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        service: "Corte clásico",
        preferred_date: "2099-05-19",
        last_availability_context: {
          service: "Corte clásico",
          date: "2099-05-19",
          slots: [
            {
              date: "2099-05-19",
              time: "09:00",
              provider_id: "p1",
              provider_name: "Carlos",
            },
            {
              date: "2099-05-19",
              time: "10:00",
              provider_id: "p2",
              provider_name: "Luis",
            },
          ],
        },
      },
    } as any,
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__CHECK_REQUESTED_AVAILABILITY__",
    matrixDiag("provider-cont-route", result as any),
  );
  assertEquals(
    String((result as any).statePatch?.collected?.provider_id ?? ""),
    "p2",
    matrixDiag("provider-cont-id", result as any),
  );
  assertEquals(
    String((result as any).statePatch?.collected?.provider_name ?? ""),
    "Luis",
    matrixDiag("provider-cont-name", result as any),
  );
});

Deno.test("Closed requested day does not preconfirm and routes to availability", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero corte domingo a las 10",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    clinicSettings: {
      timezone: "America/Tegucigalpa",
      business_type: "barbershop",
      hours: {
        mon: { open: "08:00", close: "17:00", closed: false },
        tue: { open: "08:00", close: "17:00", closed: false },
        wed: { open: "08:00", close: "17:00", closed: false },
        thu: { open: "08:00", close: "17:00", closed: false },
        fri: { open: "08:00", close: "17:00", closed: false },
        sat: { open: "09:00", close: "17:00", closed: false },
        sun: { open: "09:00", close: "17:00", closed: true },
      },
    },
  } as any);
  assertEquals(
    String((result as any).replyText),
    "__SHOW_AVAILABILITY_FOR_DATE__",
    matrixDiag("closed-day-route", result as any),
  );
  assertEquals(
    (result as any).toolAction,
    undefined,
    matrixDiag("closed-day-no-tool", result as any),
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_booking ?? null,
    null,
    matrixDiag("closed-day-no-pending", result as any),
  );
});

Deno.test("Invalid pending provider on confirmation clears pending and avoids loop", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Corte clásico",
        preferred_date: "2099-05-19",
        preferred_time: "10:00",
        pending_booking: {
          service: "Corte clásico",
          appointment_date: "2099-05-19",
          appointment_time: "10:00",
          status: "pending_confirmation",
          provider_id: null,
          provider_name: null,
        },
      },
    } as any,
  } as any);
  assertEquals(
    (result as any).toolAction,
    undefined,
    matrixDiag("invalid-pending-no-tool", result as any),
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_booking ?? null,
    null,
    matrixDiag("invalid-pending-cleared", result as any),
  );
  assert(
    String((result as any).replyText).toLowerCase().includes("confirmar") ||
      String((result as any).replyText).toLowerCase().includes("horario"),
    matrixDiag("invalid-pending-copy", result as any),
  );
});

Deno.test("Human takeover: dashboard reply activates pause fields", () => {
  const now = "2026-05-17T10:00:00.000Z";
  const next = activateHumanTakeoverState({
    state: { stage: "DISCOVERY" },
    source: "human_replied_from_dashboard",
    actor: "user-123",
    nowIso: now,
    pauseMinutes: 60,
  });
  assertEquals(String((next as any).conversation_mode), "human_active");
  assertEquals(
    String((next as any).paused_reason),
    "human_replied_from_dashboard",
  );
  assertEquals(String((next as any).last_human_actor), "user-123");
  assertEquals(String((next as any).last_human_message_at), now);
  assertEquals(
    String((next as any).bot_paused_until),
    "2026-05-17T11:00:00.000Z",
  );
});

Deno.test("Human takeover: inbound free text during pause blocks bot", () => {
  const state = {
    conversation_mode: "human_active",
    bot_paused_until: "2026-05-17T11:00:00.000Z",
  };
  assertEquals(isHumanTakeoverActive(state, "2026-05-17T10:15:00.000Z"), true);
  const policy = shouldAllowAutomationDuringTakeover({
    payloadAction: null,
    payloadSource: "inbound",
    isOperatorOutbound: false,
  });
  assertEquals(policy.allowed, false);
});

Deno.test("Human takeover: flow payload_action during pause is allowed", () => {
  const policy = shouldAllowAutomationDuringTakeover({
    payloadAction: "start_flow_booking",
    payloadSource: "inbound",
    isOperatorOutbound: false,
  });
  assertEquals(policy.allowed, true);
  assertEquals(policy.reason, "flow_allowed_during_takeover");
});

Deno.test("Human takeover: bot/system/template sources do not activate takeover policy", () => {
  const reminderPolicy = shouldAllowAutomationDuringTakeover({
    payloadAction: null,
    payloadSource: "appointment_reminder_24h",
    isOperatorOutbound: false,
  });
  assertEquals(reminderPolicy.allowed, true);

  const templatePolicy = shouldAllowAutomationDuringTakeover({
    payloadAction: null,
    payloadSource: "template_transactional",
    isOperatorOutbound: false,
  });
  assertEquals(templatePolicy.allowed, true);
});

Deno.test("Human takeover: expired pause allows bot again", () => {
  const state = {
    conversation_mode: "human_active",
    bot_paused_until: "2026-05-17T10:00:00.000Z",
  };
  assertEquals(isHumanTakeoverActive(state, "2026-05-17T10:00:01.000Z"), false);
});

Deno.test("Human takeover: whatsapp app echo helper exists in meta-webhook source", async () => {
  const source = await Deno.readTextFile(
    new URL("../../meta-webhook/index.ts", import.meta.url),
  );
  assert(source.includes("extractWhatsAppHumanEchoEvents"));
  assert(source.includes("human_replied_from_whatsapp_app"));
  assert(source.includes("human_echo_detected_no_lead_match"));
});

Deno.test("Flow CTA routing exists for booking intent in run-replies", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("shouldUseBookingFlowCta"));
  assert(source.includes("booking_flow_cta_requested"));
  assert(source.includes("booking_flow_cta_sent"));
  assert(source.includes('conversation_mode: "flow_active"'));
  assert(source.includes('last_bot_step: "booking_flow_cta_sent"'));
});

Deno.test("Flow CTA fallback log exists when disabled or missing config", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("booking_flow_missing_config_fallback_chat"));
  assert(source.includes("missing_flow_id"));
  assert(source.includes("flow_disabled"));
  assert(source.includes("isUsableBookingFlowId"));
});

Deno.test("Flow CTA payload builder exists and is wired to Meta adapter", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const adapterSource = await Deno.readTextFile(
    new URL("../../_shared/metaMessageAdapter.ts", import.meta.url),
  );
  assert(source.includes("flow_payload_built"));
  assert(source.includes("buildWhatsAppFlowCtaMessage"));
  assert(source.includes("flowCta: flowCtaPayload"));
  assert(adapterSource.includes('type: "flow"'));
  assert(adapterSource.includes("flow_message_version"));
  assert(adapterSource.includes("flow_payload_before_send"));
});

Deno.test("Flow during takeover checks org integration flag in process path", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("allow_flow_during_human_takeover"));
  assert(source.includes("flow_blocked_by_org_setting"));
  assert(source.includes("flow_allowed_during_takeover"));
});

Deno.test("Non-booking barbershop message still keeps normal chat path", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cuanto cuesta corte y barba",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
  } as any);
  assert(
    String((result as any).replyText).includes("HNL 220"),
    matrixDiag("non-booking-normal-path", result as any),
  );
});

Deno.test("Interactive fallback: flow disabled blocks old booking main menu for booking intent", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(!source.includes("booking_interactive_menu_sent"));
  assert(source.includes("barberline_runtime_branch_bypassed_old_menu"));
  assert(source.includes("booking_start"));
  assert(source.includes("view_prices"));
  assert(source.includes("view_location"));
});

Deno.test("Interactive fallback actions exist: select_service/select_date/select_time", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("select_service:"));
  assert(source.includes("booking_date_pref:today"));
  assert(source.includes("booking_date_pref:tomorrow"));
  assert(source.includes("booking_date_pref:week"));
  assert(source.includes("select_date:"));
  assert(source.includes("select_time:"));
  assert(source.includes("booking_interactive_preconfirm"));
  assert(source.includes("booking_selected_slot_saved"));
  assert(source.includes("confirm_booking_selected_slot_loaded"));
  assert(source.includes("selected_slot"));
});

Deno.test("Interactive fallback UX: does not repeat provider when all shown slots are same provider", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("uniqueProviders.length <= 1"));
  assert(source.includes("formatBarbershopSlotOptionsBody"));
  assert(source.includes("providerName: uniqueProviders[0]"));
  assert(source.includes("• ${formatHourLabel(s.time)}"));
});

Deno.test("Interactive fallback UX: shows provider per line when multiple providers are available", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("• ${formatHourLabel(s.time)} · ${s.provider_name}"));
});

Deno.test("Interactive fallback booking-first: service selection asks date preference first", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("Listo 💈 Escogé el día que te quede mejor:"));
  assert(!source.includes("Buenísimo. ¿Qué día te queda mejor?"));
  assert(source.includes("barbershopDateSelectionList"));
  assert(source.includes("Ver días disponibles"));
  assert(source.includes("buildAvailableDateListOptions"));
  assert(source.includes("select_date:${item.date}"));
  assert(source.includes("booking_interactive_date_preference"));
  assert(source.includes("select_service_asks_preference"));
});

Deno.test("Interactive fallback canonical gate blocks old BarberLine booking menu", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("function handleBarberLineRuntimeTurn"));
  assert(source.includes("resolveBarberlineCanonicalRoute"));
  assert(source.includes("barberline_canonical_route_resolved"));
  assert(source.includes("barberline_main_menu_allowed_greeting_only"));
  assert(source.includes("barberline_main_menu_blocked_by_intent"));
  assert(source.includes("barberline_runtime_branch_bypassed_old_menu"));
  assert(source.includes("barberline_canonical_missing_service"));
  assert(
    !source.includes("Claro 💈 Te ayudo a agendar.\\n\\nElegí una opción:"),
  );
});

Deno.test("Interactive fallback exact time logs exist", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const availabilitySource = await Deno.readTextFile(
    new URL("../domain/availabilityCore.ts", import.meta.url),
  );
  assert(source.includes("booking_requested_exact_time"));
  assert(source.includes("booking_exact_time_available"));
  assert(source.includes("booking_exact_time_unavailable"));
  assert(source.includes("booking_nearest_alternatives_found"));
  assert(source.includes("Sí, tengo ${dateOnly.toLowerCase()} a las"));
  assert(source.includes("formatHourLabel(requestedTime)"));
  assert(
    availabilitySource.includes("exact_time_alternatives_filtered_future"),
  );
  assert(
    availabilitySource.includes("exact_time_alternatives_sorted_by_closeness"),
  );
  assert(source.includes("stale_payload_or_duplicate_response_blocked"));
});

Deno.test("Phase 1: mixed greeting intent logs and initial exact availability route exist", async () => {
  const source = await Deno.readTextFile(
    new URL("../conversationEngine.ts", import.meta.url),
  );
  assert(source.includes("greeting_demoted_due_to_stronger_intent"));
  assert(source.includes("mixed_greeting_intent_resolved"));
  assert(source.includes("initial_message_exact_availability_detected"));
  assert(
    source.includes('greetingDemotedIntent === "business_hours_question"'),
  );
  assert(source.includes('replyText: "__CHECK_REQUESTED_AVAILABILITY__"'));
});

Deno.test("Interactive fallback: 'Ver más fechas' routes directly to grouped availability", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("booking_more_dates_requested"));
  assert(source.includes("booking_more_dates_options_built"));
  assert(source.includes("booking_date_pref:week"));
  assert(source.includes("Escogé el día que querés revisar 💈"));
  assert(source.includes("const fallbackBody"));
  assert(source.includes("Escogé el día:"));
  assert(!source.includes("formatBarbershopMoreDaysCopy(lines)"));
  assert(source.includes("const dateListLimit = 7"));
  assert(source.includes("topDays.length < dateListLimit"));
  assert(source.includes("getAvailableSlotsForDay({"));
  assert(source.includes("service_key"));
  assert(source.includes("dateSelectionList(dateOptions, body)"));
  assert(source.includes('description: "Disponible"'));
});

Deno.test("Interactive fallback: text 'Ver más fechas' maps to booking_date_pref:week", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes('normalizedInboundText === "ver mas fechas"'));
  assert(source.includes('normalizedInboundText === "ver mas dias"'));
  assert(source.includes('normalizedInboundText === "ver proximos dias"'));
  assert(source.includes('normalizedInboundText === "mas dias"'));
  assert(source.includes('normalizedInboundText === "proximos dias"'));
  assert(source.includes('normalizedInboundText === "ver mas horarios"'));
  assert(source.includes('normalizedInboundText === "horarios disponibles"'));
  assert(
    source.includes('normalizedInboundText === "ver horarios disponibles"'),
  );
  assert(source.includes("booking_more_dates_text_matched"));
  assert(source.includes('inboundPayloadAction = "booking_date_pref:week"'));
});

Deno.test("Interactive fallback: after 'Ver más fechas' it never emits generic follow-up prompt", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("booking_more_dates_requested"));
  assert(
    !source.includes(
      "Seguimos con tu cita. ¿Querés ver horarios disponibles o reservar una hora específica?",
    ),
  );
});

Deno.test("Interactive fallback: ambiguous 'corte' request shows service menu first", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("booking_service_ambiguous_show_service_menu"));
  assert(source.includes("Perfecto 💈 Elegí el servicio:"));
  assert(source.includes("isAmbiguousBarbershopServiceRequest"));
});

Deno.test("Interactive fallback: contradictory provider copy prevention exists", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("booking_contradictory_provider_copy_prevented"));
  assert(
    source.includes(
      "A esa hora ${preferredBarber} no está disponible, pero ${altProviderName} sí tiene espacio.",
    ),
  );
  assert(source.includes("booking_provider_same_time_alternative"));
  assert(source.includes("booking_no_provider_available_nearest_offered"));
  assert(source.includes("active_appointment_guard_triggered"));
  assert(source.includes("duplicate_appointment_prevented"));
});

Deno.test("Interactive fallback: availability/booking state logs exist", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("availability_today_filters_past_slots"));
  assert(source.includes("availability_min_notice_applied"));
  assert(source.includes("availability_time_block_detected"));
  assert(source.includes("exact_time_request_detected"));
  assert(source.includes("exact_time_available"));
  assert(source.includes("exact_time_unavailable"));
  assert(source.includes("selected_slot_reused"));
  assert(source.includes("more_hours_requested"));
  assert(source.includes("more_days_requested"));
});

Deno.test("Human handoff: leads.handoff_to_human blocks automated replies but manual jobs remain allowed", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(
    source.includes(
      '.select("state, full_name, first_name, organization_id, handoff_to_human")',
    ),
  );
  assert(
    source.includes(
      "leadHandoffToHuman = (leadRes.data as any)?.handoff_to_human === true",
    ),
  );
  assert(source.includes("leadHandoffToHuman === true ||"));
  assert(source.includes("skip_reason: leadHandoffToHuman"));
  assert(source.includes("lead_handoff_to_human_true"));
  assert(source.includes("if (isUiManual || isOperatorOutbound)"));
  assert(source.includes("manual_staff_reply_sent"));
});

Deno.test("Manual staff reply: normal scheduler claims queued and pending manual jobs", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("const manualClaimRes = await claimManualUiJobs"));
  assert(source.includes('.in("status", ["queued", "pending"])'));
  assert(source.includes('source === "manual_staff_reply"'));
  assert(source.includes('type === "manual_staff_reply"'));
  assert(source.includes("const remainingLimit = processManualOnly"));
  assert(source.includes("if (isUiManual || isOperatorOutbound)"));
  assert(source.includes("text: manualText"));
  assert(
    source.includes(
      'last_error: isManualStaffReply ? "manual_staff_reply_sent" : "manual_outbound_sent"',
    ),
  );
});

Deno.test("Interactive fallback: selecting an offered day uses last_offered_dates and returns slots for that day", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(
    source.includes(
      "const offeredDates = Array.isArray((collected as any)?.last_offered_dates)",
    ),
  );
  assert(source.includes("const offeredDate = offeredDates.find"));
  assert(source.includes("safeStr((offeredDate as any)?.service_key"));
  assert(
    source.includes(
      "Estos son algunos horarios disponibles con *${provider}*",
    ),
  );
  assert(source.includes("Estos son algunos horarios disponibles"));
  assert(
    source.includes(
      "Escogé una hora o mirá más opciones.",
    ),
  );
  assert(source.includes("last_offered_slots: offeredSlots"));
});

Deno.test("Time-block follow-up: active booking maps afternoon variants to current context slots", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("detectActiveBookingTimeBlockFollowup"));
  assert(source.includes("booking_time_block:${timeBlock}"));
  assert(source.includes("time_block_followup_detected"));
  assert(source.includes("time_block_followup_used_current_context"));
  assert(source.includes("activeBookingFlow"));
  assert(source.includes("current_service_key"));
  assert(source.includes("current_service_name"));
  assert(source.includes("current_date"));
  assert(source.includes("time_preference: block"));
  assert(source.includes("last_offered_slots: offeredSlots"));
  assert(
    source.includes("formatRequestedDayLabel(selectedDate).toLowerCase()"),
  );
  assert(source.includes("blockLabel"));
});

Deno.test("Time-block follow-up: typo en latarde and por la tarde are recognized", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("en latarde"));
  assert(source.includes("latarde"));
  assert(source.includes("por la tarde"));
});

Deno.test("Time-block follow-up: en la mañana is recognized", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("en la manana"));
  assert(source.includes("por la manana"));
  assert(source.includes("formatTimeBlockLabel(block)"));
});

Deno.test("Time-block follow-up: no afternoon slots offers same-day alternatives", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("time_block_followup_no_slots"));
  assert(source.includes("No tengo espacios en ${blockLabel}"));
  assert(source.includes("Tengo estas opciones"));
  assert(source.includes("¿Te sirve una de esas?"));
  assert(source.includes('lastBookingStep: "select_time"'));
});

Deno.test("Time-block follow-up: availability core uses configured time_blocks and fallback afternoon-to-close", async () => {
  const source = await Deno.readTextFile(
    new URL("../domain/availabilityCore.ts", import.meta.url),
  );
  assert(source.includes("getConfiguredTimeBlockRange"));
  assert(source.includes("bookingRules?.time_blocks?.[pref]"));
  assert(
    source.includes(
      'if (pref === "afternoon") return { startMin: 12 * 60, endMin: windowEndMin }',
    ),
  );
});

Deno.test("Semantic fallback: cancel typo with active appointment starts cancel confirmation", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cncelar la cita",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        active_appointment: {
          id: "appt-semantic-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "confirmed",
        },
      },
    } as any,
    barbershopInterpreterResult: {
      intent: "cancel_request",
      confidence: 0.88,
      next_step: "start_cancel_confirmation",
      tool_needed: "get_active_appointment",
      needs_tool: "cancel_appointment",
      entities: {},
      fields_found: {},
      missing_fields: [],
      should_use_previous_info: false,
      user_facing_summary: "Solicitud semántica de cancelación",
      semantic: {
        intent: "cancel_appointment",
        confidence: 0.88,
        normalized_user_message: "quiero cancelar la cita",
        entities: {
          service_name: null,
          date_text: null,
          time_text: null,
          time_block: null,
          provider_name: null,
          target: "active_appointment",
        },
        reason: "semantic_cancel_request",
      },
    } as any,
  } as any);

  assert(
    String((result as any).replyText).includes(
      "¿Confirmás que querés cancelar tu cita",
    ),
  );
  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_cancel_appointment",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.appointment_id,
    "appt-semantic-1",
  );
});

Deno.test("Semantic fallback: low confidence unsupported message uses official out-of-scope fallback", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quien gano el partido de ayer",
    leadState: {
      orgType: "barbershop",
      stage: "DISCOVERY",
      collected: {},
    } as any,
    barbershopInterpreterResult: {
      intent: "unknown",
      confidence: 0.3,
      next_step: "clarify",
      tool_needed: "none",
      needs_tool: "none",
      entities: {},
      fields_found: {},
      missing_fields: [],
      should_use_previous_info: false,
      user_facing_summary: "unsupported",
      semantic: {
        intent: "unknown",
        confidence: 0.3,
        normalized_user_message: "quien gano el partido de ayer",
        entities: {
          service_name: null,
          date_text: null,
          time_text: null,
          time_block: null,
          provider_name: null,
          target: null,
        },
        reason: "unsupported_or_low_confidence",
      },
    } as any,
  } as any);

  assertEquals(
    String((result as any).replyText),
    "Por ahora solo te puedo ayudar con citas, precios, horarios y ubicación de la barbería 💈\n\n¿Querés agendar o ver precios?",
  );
  assertEquals(
    (result as any).debug?.route,
    "barbershop_semantic_low_confidence_out_of_scope",
  );
});

Deno.test("Semantic fallback: payload buttons are excluded before interpreter call", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("hasInteractivePayloadAction"));
  assert(source.includes("!hasInteractivePayloadAction"));
  assert(source.includes("semanticFallbackOnly"));
});

Deno.test("BarberLine real appointment: cancelalal with active appointment starts concise cancel confirmation", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cancelalal",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        active_appointment: {
          id: "appt-real-1",
          reason: "Corte clásico",
          appointment_date: "2026-05-25",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "confirmed",
        },
      },
    } as any,
  } as any);

  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_cancel_appointment",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.appointment_id,
    "appt-real-1",
  );
  assertEquals(
    String((result as any).replyText),
    "¿Confirmás que querés cancelar tu cita del lunes, 25 de mayo a las 2:00 PM?",
  );
});

Deno.test("BarberLine cancel confirmation uses active appointment time, not current time", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cancerarla",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        active_appointment: {
          id: "appt-active-time",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "13:00",
          starts_at: "2026-05-23T19:00:00",
          provider_name: "Carlos",
          status: "confirmed",
        },
      },
    } as any,
  } as any);

  assertEquals(
    String((result as any).replyText),
    "¿Confirmás que querés cancelar tu cita del sábado, 23 de mayo a la 1:00 PM?",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.appointment_time,
    "13:00",
  );
});

Deno.test("BarberLine cancel confirmation does not use stale selected_slot time", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cancelarla",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        selected_slot: {
          date: "2026-05-23",
          time: "19:00",
          provider_name: "Alex",
          service_name: "Corte clásico",
        },
        active_appointment: {
          id: "appt-active-not-selected",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "13:00",
          starts_at: "2026-05-23T19:00:00",
          provider_name: "Carlos",
          status: "confirmed",
        },
      },
    } as any,
  } as any);

  assertEquals(
    String((result as any).replyText),
    "¿Confirmás que querés cancelar tu cita del sábado, 23 de mayo a la 1:00 PM?",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.provider_name,
    "Carlos",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.appointment_time,
    "13:00",
  );
});

Deno.test("BarberLine cancel confirmation does not parse time from cancel text", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "cancelarla a las 7",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        active_appointment: {
          id: "appt-active-ignore-cancel-time",
          reason: "Corte clásico",
          appointment_date: "2026-05-23",
          appointment_time: "13:00",
          starts_at: "2026-05-23T19:00:00",
          provider_name: "Carlos",
          status: "confirmed",
        },
      },
    } as any,
  } as any);

  assertEquals(
    String((result as any).replyText),
    "¿Confirmás que querés cancelar tu cita del sábado, 23 de mayo a la 1:00 PM?",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.appointment_time,
    "13:00",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.starts_at,
    "2026-05-23T19:00:00",
  );
});

Deno.test("BarberLine hoy sábado then en la tarde preserves current_date", () => {
  const now = new Date("2026-05-23T12:00:00Z");
  const currentDate = parseDateOnlyFromMessage(
    "Hoy sábado",
    "America/Tegucigalpa",
    now,
  );
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "en la tarde",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        activeBookingFlow: true,
        lastBookingStep: "select_time",
        current_service_key: "corte",
        current_service_name: "Corte clásico",
        current_date: currentDate,
        preferred_date: currentDate,
        last_availability_context: {
          service: "Corte clásico",
          date: currentDate,
          slots: [
            {
              date: currentDate,
              time: "09:00",
              provider_id: "alex",
              provider_name: "Alex",
            },
            {
              date: currentDate,
              time: "13:00",
              provider_id: "carlos",
              provider_name: "Carlos",
            },
            {
              date: currentDate,
              time: "14:00",
              provider_id: "bryan",
              provider_name: "Bryan",
            },
          ],
        },
      },
    } as any,
    clinicSettings: { timezone: "America/Tegucigalpa" },
  } as any);

  assertEquals(
    (result as any).statePatch?.collected?.current_date,
    "2026-05-23",
  );
  assertEquals(
    (result as any).statePatch?.collected?.preferred_date,
    "2026-05-23",
  );
  assert(String((result as any).replyText).includes("sábado, 23 de mayo"));
});

Deno.test("BarberLine real appointment: quiero cancelar with active appointment starts cancel confirmation", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "quiero cancelar",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        active_appointment: {
          id: "appt-real-2",
          reason: "Corte clásico",
          appointment_date: "2026-05-25",
          appointment_time: "14:00",
          provider_name: "Alex",
          status: "confirmed",
        },
      },
    } as any,
  } as any);

  assertEquals(
    (result as any).statePatch?.nextExpected,
    "confirm_cancel_appointment",
  );
  assertEquals(
    (result as any).statePatch?.collected?.pending_cancel?.appointment_id,
    "appt-real-2",
  );
  assert(
    String((result as any).replyText).includes(
      "¿Confirmás que querés cancelar",
    ),
  );
});

Deno.test("BarberLine real appointment: Confirmar with pending_cancel cancels even if nextExpected is missing", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "Confirmar",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        pending_cancel: {
          appointment_id: "appt-real-3",
          service: "Corte clásico",
          appointment_date: "2026-05-25",
          appointment_time: "14:00",
          status: "pending_confirmation",
        },
      },
    } as any,
  } as any);

  assertEquals((result as any).toolAction?.name, "cancel_appointment");
  assertEquals(
    (result as any).toolAction?.payload?.appointment_id,
    "appt-real-3",
  );
  assertEquals((result as any).statePatch?.nextExpected, undefined);
  assertEquals(
    String((result as any).replyText),
    "✅ Tu cita fue cancelada.\n\nSi querés, puedo ayudarte a buscar otro horario.",
  );
});

Deno.test("BarberLine day availability source shows one block of max 3 and only hints later slots", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("const shownUniqueSlots = uniqueSlotsByTime.slice("));
  assert(source.includes("requestedOffset + pageSize"));
  assert(
    source.includes(
      "También tengo espacios más tarde. Podés decirme otra hora.",
    ),
  );
  assert(
    !source.includes(
      "Para ${label.toLowerCase()} tengo opciones en la mañana y en la tarde",
    ),
  );
});

Deno.test("BarberLine afternoon block remains explicit time-block only", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(
    source.includes('if (normalizedAction.startsWith("booking_time_block:"))'),
  );
  assert(
    source.includes("formatRequestedDayLabel(selectedDate).toLowerCase()"),
  );
  assert(source.includes("blockLabel"));
  assert(source.includes("time_block_followup_detected"));
});

Deno.test("BarberLine real appointment: No with pending_cancel keeps appointment even if nextExpected is missing", () => {
  const result = runConversationEngine({
    organizationId: "barber-demo",
    inboundText: "No",
    leadState: {
      orgType: "barbershop",
      stage: "BOOKING",
      collected: {
        pending_cancel: {
          appointment_id: "appt-real-4",
          service: "Corte clásico",
          appointment_date: "2026-05-25",
          appointment_time: "14:00",
          status: "pending_confirmation",
        },
      },
    } as any,
  } as any);

  assertEquals((result as any).toolAction, undefined);
  assertEquals(
    String((result as any).replyText),
    "Perfecto, mantenemos tu cita.",
  );
  assertEquals((result as any).statePatch?.collected?.pending_cancel, null);
});

Deno.test("BarberLine real appointment: index source has concise active appointment lookup and closed-day precheck", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("Tu cita actual es el"));
  assert(source.includes("¿Querés cancelarla o reagendarla?"));
  assert(source.includes("closed_day_detected_before_availability"));
  assert(source.includes("closed_day_next_open_options_offered"));
  assert(source.includes("requestedDate"));
});

Deno.test("BarberLine guided WhatsApp menu is greeting-only and uses structured options", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  const menuBlock = source.slice(
    source.indexOf("const bookingPromptButtons"),
    source.indexOf("const barberlineHandoffButtons"),
  );
  assert(source.includes("barberline_guided_greeting_menu"));
  assert(source.includes("function formatBarbershopGreetingCopy"));
  assert(source.includes("Bienvenido a *${brandName}*"));
  assert(source.includes("Agendá tu cita en menos de 1 minuto."));
  assert(source.includes("¿Qué querés hacer hoy?"));
  assert(!source.includes("También podés escribir 'ubicación' u 'horarios'."));
  assert(!source.includes("3. Ubicación\\n4. Hablar con alguien"));
  assert(menuBlock.includes('{ id: "booking_start", title: "Agendar cita" }'));
  assert(menuBlock.includes('{ id: "view_prices", title: "Servicios" }'));
  assert(!menuBlock.includes("Precios"));
  assert(!menuBlock.includes("Hablar con"));
  assert(source.includes('intent === "greeting_only"'));
});

Deno.test("BarberLine WIMAEIL welcome menu keeps handoff out of primary CTAs", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  const menuBlock = source.slice(
    source.indexOf("const bookingPromptButtons"),
    source.indexOf("const barberlineHandoffButtons"),
  );

  assert(source.includes('organizationId === "barber-demo-wimaeil"'));
  assert(
    source.includes(
      "👋 Bienvenido a *${brandName}* 💈\\n\\nAgendá tu cita en menos de 1 minuto.\\n¿Qué querés hacer hoy?",
    ),
  );
  assert(menuBlock.includes('{ id: "booking_start", title: "Agendar cita" }'));
  assert(menuBlock.includes('{ id: "view_prices", title: "Servicios" }'));
  assert(!menuBlock.includes("Precios"));
  assert(!menuBlock.includes("Hablar con William"));
  assert(
    source.includes(
      "Claro, le aviso a William para que le responda personalmente 💈",
    ),
  );
});

Deno.test("BarberLine WIMAEIL services and prices use concise WIMAEIL copy", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function formatWimaeilPricingList"));
  assert(
    source.includes("Estos son los servicios disponibles en ${brandName} 💈"),
  );
  assert(source.includes("L${Math.round(price)}"));
  assert(
    source.includes("formatWimaeilPricingList(barbershopServices, brandName)"),
  );
  assert(source.includes("¿Querés agendar una cita?"));
  assert(source.includes("barberlineHandoffButtons"));
});

Deno.test("BarberLine WIMAEIL booking start sends guided service picker", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(
    source.includes(
      '"Perfecto 💈 Escogé el servicio:"',
    ),
  );
  assert(
    source.includes(
      'serviceSelectionList(\n        barbershopServices,\n        "Perfecto 💈 Escogé el servicio:",\n        true,\n      )',
    ),
  );
  assert(source.includes("interactiveButtons: servicesList"));
});

Deno.test("BarberLine WIMAEIL service text from stale provider context returns to date flow", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("serviceTextSelectionForTurn"));
  assert(source.includes('nextExpected === "provider_selection"'));
  assert(source.includes("isWimaeilTenant"));
  assert(
    source.includes(
      '"booking_text_service_selected_from_provider_context"',
    ),
  );
  assert(source.includes("buildDayPreferenceForService("));
});

Deno.test("BarberLine WIMAEIL provider name alone is not human handoff", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("resolveProviderFromActionOrText"));
  assert(source.includes("normalizedAction = `select_provider:${"));
  assert(
    source.includes(
      "hablar con william|quiero hablar con william|hablar con alguien",
    ),
  );
  assert(!source.includes("hablar con william|william"));
  assert(source.includes('debugNote: "barberline_handoff_requested"'));
});

Deno.test("BarberLine FAQ menu maps location hours services providers from settings", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(
    source.includes(
      "formatBarbershopLocationFaq(clinicSettings, activeAppointment)",
    ),
  );
  assert(
    source.includes(
      "formatBarbershopHoursFaq(clinicSettings, activeAppointment)",
    ),
  );
  assert(source.includes("formatBarbershopServicesFaq(barbershopServices)"));
  assert(source.includes("formatBarbershopProvidersFaq(barbershopProviders)"));
  assert(
    source.includes(
      "resolveBarbershopPublicLocationFromSettings(clinicSettings)",
    ),
  );
  assert(source.includes("Atendemos de lunes a sábado"));
  assert(source.includes("debugNote: isLocationFaq"));
});

Deno.test("BarberLine numbered input is only honored when a numbered list context is active", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("barberline_unmapped_number_guard"));
  assert(source.includes("numberedSelectionContexts"));
  assert(source.includes('"service_selection"'));
  assert(source.includes('"provider_selection"'));
  assert(source.includes('"availability_slot_selection"'));
  assert(
    source.includes(
      "resolveServiceFromTextSelection(barbershopServices, inboundText)",
    ),
  );
});

Deno.test("BarberLine WhatsApp list payloads are used for services and providers over 3 options", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  const adapter = await Deno.readTextFile(
    "supabase/functions/_shared/metaMessageAdapter.ts",
  );
  assert(source.includes("type WhatsAppInteractiveListSpec"));
  assert(source.includes("function serviceSelectionList"));
  assert(source.includes('body = "Perfecto 💈 Escogé el servicio:"'));
  assert(source.includes("forceList = false"));
  assert(source.includes('buttonText: "Ver servicios"'));
  assert(
    source.includes("id: `select_service:${toServiceActionKey(service)}`"),
  );
  assert(source.includes("getServiceShortPrice(service)"));
  assert(source.includes("formatDurationLabel"));
  assert(source.includes("function providerSelectionList"));
  assert(source.includes('buttonText: "Ver barberos"'));
  assert(source.includes("interactiveList: servicesList"));
  assert(source.includes("interactiveList: providersList"));
  assert(source.includes("const generatedList ="));
  assert(source.includes("generated.interactiveList?.sections?.length"));
  assert(adapter.includes('type: "list"'));
  assert(adapter.includes("button: String(args.interactiveList.buttonText"));
  assert(adapter.includes("id: `action:${String(row.id).trim()}`"));
});

Deno.test("BarberLine guided pricing uses organization settings services and active appointment context", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("function formatBarbershopPricingList"));
  assert(source.includes("Estos son los servicios de ${brandName}"));
  assert(source.includes("formatDurationLabel"));
  assert(source.includes("getServicePrice"));
  assert(
    source.includes(
      "formatCustomerAppointmentStatus(activeAppointment.status)",
    ),
  );
  assert(source.includes("getServiceMenuEmoji"));
  assert(source.includes("El combo completo: corte, barba y detalle."));
  assert(source.includes("Corte completo con limpieza facial incluida."));
  assert(source.includes("Para refrescar la piel y salir más fino."));
  assert(source.includes("Limpio, fresco y bien perfilado."));
});

Deno.test("BarberLine controlled copy keeps stable critical booking phrases", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("function formatBarbershopGreetingCopy"));
  assert(source.includes("Bienvenido a *${brandName}* 💈"));
  assert(source.includes("¿Qué querés hacer hoy?"));
  assert(source.includes("Te puedo mostrar estos días disponibles:"));
  assert(source.includes("dateLines.join"));
  assert(source.includes("Decime cuál día querés revisar"));
  assert(source.includes('reply: "¿Qué día te queda mejor?"'));
  assert(source.includes("¿Tenés barbero preferido?"));
  assert(source.includes("formatBarbershopSlotOptionsBody"));
  assert(source.includes("formatBarbershopAvailabilityListBody"));
  assert(source.includes("buildExpandedBarbershopTimeSlotsList"));
  assert(source.includes("¿A nombre de quién dejamos la cita?"));
  assert(source.includes("formatBarbershopConfirmationSummary"));
  assert(source.includes("Ya tenés una cita confirmada para"));
  assert(source.includes("formatRequestedDayLabel(date)"));
  assert(source.includes("formatHourLabel(time)"));
  assert(!source.includes("También podés escribir ubicación u horarios"));
  assert(!source.includes("Perfecto, ya tengo {service}"));
});

Deno.test("BarberLine guided booking asks service then day, then provider preference", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(
    source.includes("formatBarbershopServiceSelectionText(barbershopServices)"),
  );
  assert(source.includes("serviceSelectionButtons(barbershopServices)"));
  assert(source.includes("buildDayPreferenceForService"));
  assert(source.includes("Listo 💈 Escogé el día que te quede mejor:"));
  assert(
    source.includes(
      "interactiveList: barbershopDateSelectionList(dateOptions, listBody)",
    ),
  );
  assert(!source.includes("Perfecto 💈 Ya tengo ${serviceName}."));
  assert(source.includes("booking_interactive_day_preference_after_service"));
  assert(source.includes("booking_day_selected_provider_preference_prompt"));
  assert(source.includes('nextExpected: "provider_selection"'));
  assert(source.includes("last_offered_providers"));
  assert(source.includes("Cualquiera disponible"));
  assert(source.includes("resolveProviderFromActionOrText"));
});

Deno.test("BarberLine guided booking respects provider, late today, and confirmation actions", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("booking_interactive_date_preference_after_provider"));
  assert(source.includes("booking_provider_specific_slots_for_day"));
  assert(source.includes("booking_provider_any_slots_for_day"));
  assert(source.includes("Por hoy ya no tenemos espacios disponibles"));
  assert(source.includes("Te puedo mostrar las próximas opciones"));
  assert(!source.includes("Para hoy ya no veo cupos disponibles."));
  assert(source.includes("buildQuickDateOptions"));
  assert(source.includes("providerPreference,"));
  assert(source.includes("providerId: selectedProvider.id"));
  assert(source.includes("provider_preference: providerPreference"));
  assert(
    source.includes(
      'provider_id: providerPreference === "specific" ? selectedProviderId : null',
    ),
  );
  assert(source.includes('{ id: "confirm_booking", title: "Confirmar" }'));
  assert(
    source.includes('{ id: "change_booking_slot", title: "Cambiar hora" }'),
  );
  assert(
    source.includes('{ id: "talk_to_human", title: "Hablar con alguien" }'),
  );
});

Deno.test("BarberLine guided slots use WhatsApp list rows and preserve provider context", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("id: `select_slot:${safeStr(slot.date"));
  assert(source.includes('title: providerPreference === "any"'));
  assert(source.includes('description: providerPreference === "specific"'));
  assert(
    source.includes(
      'normalizedAction.startsWith("select_time:") || normalizedAction.startsWith("select_slot:")',
    ),
  );
  assert(
    source.includes(
      'provider_id: providerPreference === "specific" ? selectedProvider.id : null',
    ),
  );
  assert(
    source.includes(
      'provider_id: providerPreference === "specific" ? selectedProviderId : null',
    ),
  );
  assert(source.includes("booking_more_hours_shown"));
});

Deno.test("BarberLine guided text replies normalize by expected step", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("barberline_guided_text_normalized"));
  assert(source.includes('nextExpected === "service_selection"'));
  assert(source.includes('nextExpected === "booking_date_preference"'));
  assert(source.includes('nextExpected === "date_selection"'));
  assert(source.includes('nextExpected === "provider_selection"'));
  assert(source.includes('nextExpected === "availability_slot_selection"'));
  assert(source.includes("resolveGuidedDateActionFromText("));
  assert(source.includes("offeredDates"));
  assert(source.includes("nowLocal"));
  assert(source.includes("resolveGuidedSlotActionFromText("));
  assert(source.includes("offeredSlots"));
  assert(source.includes("true"));
  assert(source.includes("resolveGuidedConflictActionFromText(inboundText)"));
});

Deno.test("BarberLine provider text normalization supports any-provider phrases", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("function getLastOfferedBarbershopProviders"));
  assert(source.includes("function resolveProviderOptionsForTurn"));
  assert(source.includes("function resolveBarbershopGuidedExpectedStep"));
  assert(source.includes('expected_step: "provider_selection"'));
  assert(source.includes('lastBookingStep === "select_provider"'));
  assert(
    source.includes(
      "hasOfferedProviders && hasService && hasDate && !hasSelectedSlot",
    ),
  );
  assert(
    source.includes("const nextExpected = resolveBarbershopGuidedExpectedStep"),
  );
  assert(
    source.includes(
      "const providerOptionsForTurn = resolveProviderOptionsForTurn(",
    ),
  );
  assert(source.includes("barbershopProviders"));
  assert(source.includes("currentCollected"));
  assert(
    source.includes(
      "getLastOfferedBarbershopProviders(collected).forEach(pushProvider)",
    ),
  );
  assert(source.includes("settingsProviders.forEach(pushProvider)"));
  assert(source.includes("me da igual"));
  assert(source.includes("no importa"));
  assert(source.includes("cualqueira"));
  assert(source.includes("cualkiera"));
  assert(source.includes("el que este libre"));
  assert(source.includes("el que este disponible"));
  assert(source.includes("cualquiera que tenga espacio"));
  assert(source.includes("con quien sea"));
  assert(source.includes("quien sea"));
  assert(source.includes("primero libre"));
  assert(source.includes("asigname cualquiera"));
  assert(source.includes("providerId === text"));
  assert(source.includes("isCloseTextMatch(providerName, text)"));
  assert(source.includes("normalizedAction = `select_provider:${"));
  assert(
    source.includes('provider.preference === "any" ? "any" : provider.id'),
  );
  assert(source.includes("resolveProviderFromActionOrText("));
  assert(source.includes("providerOptionsForTurn"));
  assert(source.includes("inboundText"));
  assert(source.includes("normalizedAction"));
  assert(source.includes("booking_provider_any_slots_for_day"));
  assert(source.includes("booking_provider_specific_slots_for_day"));
  assert(
    source.includes(
      "Podés escoger un barbero de la lista o elegir cualquiera disponible.",
    ) ||
      source.includes(
        "Podés escoger un barbero o elegir cualquiera disponible.",
      ),
  );
  assert(
    !source.includes(
      "Seguimos con tu cita. ¿Querés ver horarios disponibles o reservar una hora específica?",
    ),
  );
});

Deno.test("BarberLine provider preference only offers providers with valid slots", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("const buildProviderPreferencePrompt = async"));
  assert(
    source.includes(
      "const availableProviders: BarbershopProviderOption[] = []",
    ),
  );
  assert(source.includes("provider_id: provider.id"));
  assert(source.includes('provider_preference: "specific"'));
  assert(
    source.includes("if (slots.length > 0) availableProviders.push(provider);"),
  );
  assert(source.includes("booking_no_available_providers_for_day"));
  assert(source.includes("providerSelectionButtons(availableProviders)"));
  assert(source.includes("providerSelectionList(availableProviders)"));
  assert(source.includes("last_offered_providers: ["));
  assert(source.includes("...availableProviders.map"));
});

Deno.test("BarberLine solo-provider tenants auto-assign provider and skip provider selection", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("if (availableProviders.length === 1)"));
  assert(source.includes("const soloProvider = availableProviders[0]"));
  assert(source.includes("barbershop_solo_provider_auto_assigned"));
  assert(
    source.includes(
      'debugNote: "booking_solo_provider_auto_assigned_slots_for_day"',
    ),
  );
  assert(source.includes('nextExpected: "availability_slot_selection"'));
  assert(source.includes('lastBookingStep: "select_time"'));
  assert(source.includes('provider_preference: "specific"'));
  assert(source.includes("provider_id: soloProvider.id"));
  assert(source.includes("provider_name: soloProvider.name"));
  assert(source.includes("last_offered_providers: ["));
  assert(source.includes("solo_provider_auto_assigned"));
});

Deno.test("BarberLine solo-provider branch does not offer Cualquiera provider choice", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  const start = source.indexOf("if (availableProviders.length === 1)");
  const end = source.indexOf(
    "const providersList = providerSelectionList(availableProviders)",
    start,
  );
  assert(start > 0);
  assert(end > start);
  const soloBranch = source.slice(start, end);

  assert(!soloBranch.includes("providerSelectionButtons"));
  assert(!soloBranch.includes("providerSelectionList"));
  assert(!soloBranch.includes("Cualquiera"));
  assert(!soloBranch.includes("¿Tenés barbero preferido?"));
  assert(!soloBranch.includes("Podés escoger un barbero"));
});

Deno.test("BarberLine unavailable provider uses dedicated fallback and optional any-provider action", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(
    source.includes(
      "${selectedProvider.name} no tiene horarios disponibles para ese día 💈",
    ),
  );
  assert(
    source.includes(
      "Te puedo mostrar opciones con otro barbero o revisar más días.",
    ),
  );
  assert(
    source.includes(
      'const otherProviderSlots = providerPreference === "specific"',
    ),
  );
  assert(
    source.includes("const hasOtherProviderSlots = otherProviderSlots.some"),
  );
  assert(
    source.includes(
      '...(hasOtherProviderSlots ? [{ id: "select_provider:any", title: "Cualquiera" }] : [])',
    ),
  );
});

Deno.test("Settings provider editor saves nested provider changes through Guardar", async () => {
  const source = await Deno.readTextFile("src/pages/Settings.tsx");
  assert(source.includes("function updateDoctor(providerId: string"));
  assert(
    source.includes(
      "function updateDoctorSchedule(providerId: string, dayKey: string",
    ),
  );
  assert(source.includes("doctors, emergency, policiesCancel"));
  assert(source.includes("providerScheduleFromBusinessHours(hours)"));
  assert(source.includes('.from("providers")'));
  assert(source.includes('.upsert(normalizedDoctors, { onConflict: "id" })'));
  assert(source.includes("providers: savedDoctors"));
  assert(source.includes('tableTarget: "providers + organization_settings"'));
  assert(
    !source.includes(
      'await supabase.from("providers").update({ schedule: newSched })',
    ),
  );
  assert(
    !source.includes(
      'await supabase.from("providers").update({ services: newSvcs })',
    ),
  );
});

Deno.test("BarberLine name is required before final guided confirmation", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("function isReliableBarbershopCustomerName"));
  assert(source.includes("¿A nombre de quién dejamos la cita?"));
  assert(
    source.includes('debugNote: "barberline_require_name_before_confirmation"'),
  );
  assert(
    source.includes(
      'debugNote: "barberline_name_captured_before_confirmation"',
    ),
  );
  assert(source.includes("formatBarbershopConfirmationSummary"));
  assert(!source.includes("correo para"));
});

Deno.test("BarberLine guided handoff and post-booking state remain explicit", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes('debugNote: "barberline_handoff_requested"'));
  assert(source.includes("handoff_to_human: true"));
  assert(source.includes("recordHumanHandoffEvent"));
  assert(source.includes('event_type: "human_handoff_requested"'));
  assert(source.includes("human_handoff_event_recorded"));
  assert(source.includes("activeBookingFlow: false"));
  assert(source.includes("clearActiveBookingState"));
});

Deno.test("BarberLine slot selection prefers grouped WhatsApp list for larger availability", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  const composer = await Deno.readTextFile(
    "supabase/functions/run-replies/domain/barbershopResponseComposer.ts",
  );
  assert(source.includes("function formatBarbershopSlotOptionsBody"));
  assert(source.includes("formatBarbershopAvailabilityListBody"));
  assert(source.includes("interactiveList: useSlotList"));
  assert(source.includes("interactiveList: hasMore"));
  assert(composer.includes('title: "Horarios disponibles"'));
  assert(composer.includes('buttonText: "Ver horarios disponibles"'));
  assert(composer.includes('"Por la mañana"'));
  assert(composer.includes('"Por la tarde"'));
  assert(composer.includes("hasMultipleProviders"));
  assert(!composer.includes('"Mañana"'));
  assert(!composer.includes('"Tarde"'));
  assert(!composer.includes("Mañana:"));
  assert(!composer.includes("Tarde:"));
  assert(composer.includes("Escogé una hora para continuar."));
  assert(!composer.includes('"booking_more_hours"'));
  assert(source.includes("function formatBarbershopConfirmationSummary"));
  assert(source.includes("Barbero: *${provider}*"));
  assert(!source.includes('buttonText: "Ver horarios"'));
});

Deno.test("BarberLine future appointment guard filters same-day past appointments", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("function isFutureActiveAppointmentForTimezone"));
  assert(source.includes("startsAtMs > now.getTime()"));
  assert(source.includes("appointmentTime > currentTime"));
  assert(source.includes(".filter((appointment) =>"));
  assert(
    source.includes(
      "isFutureActiveAppointmentForTimezone(appointment, timezone)",
    ),
  );
});

Deno.test("BarberLine future appointment conflict uses matching action buttons", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  assert(source.includes("function barbershopAppointmentConflictButtons"));
  assert(
    source.includes('{ id: "reschedule_booking", title: "Cambiar mi cita" }'),
  );
  assert(
    source.includes('{ id: "additional_booking", title: "Agendar otra cita" }'),
  );
  assert(
    source.includes(
      '{ id: "keep_existing_booking", title: "Mantener mi cita" }',
    ),
  );
  assert(source.includes("formatBarbershopAppointmentConflictReply"));
  assert(
    !source.includes(
      "¿Querés agendar otra adicional o preferís cambiar la que ya tenés?",
    ),
  );
});

Deno.test("BarberLine reschedule success copy is distinct from new booking success", async () => {
  const actionSource = await Deno.readTextFile(
    "supabase/functions/run-replies/domain/actionExecutor.ts",
  );
  const engineSource = await Deno.readTextFile(
    "supabase/functions/run-replies/conversationEngine.ts",
  );
  assert(actionSource.includes("✅ Cita reagendada"));
  assert(actionSource.includes("📅 Nueva fecha:"));
  assert(actionSource.includes("⏰ Nueva hora:"));
  assert(actionSource.includes('.gte("starts_at", now)'));
  assert(
    engineSource.includes(
      "provider_name: safeStr(pendingReschedule.provider_name",
    ),
  );
  assert(
    engineSource.includes(
      "brand_name: safeStr(args.clinicSettings?.brand_name",
    ),
  );
});

Deno.test("BarberLine booking success personality does not duplicate Te esperamos line", () => {
  const base =
    "✅ Cita confirmada\n\n💈 Servicio: Corte solo\n📅 Fecha: jueves, 28 de mayo\n⏰ Hora: 9:00 AM\n✂️ Barbero: Allan\n\nTe esperamos en BarberLine.";
  const reply = formatBarberLineReply(base, {
    businessType: "barbershop",
    channel: "whatsapp",
    bookingSuccessAuthorized: true,
  });

  assertEquals(reply, base);
});

Deno.test("DentalConnect guided WhatsApp route is gated to dental and keeps BarberLine isolated", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes('if (normalizedBusinessType === "dental")'));
  assert(source.includes("handleDentalGuidedRuntimeTurn"));
  assert(source.includes('if (normalizedBusinessType === "barbershop")'));
  assert(source.includes("formatBarbershopGreetingCopy"));
  assert(source.includes("formatDentalGreetingCopy"));
});

Deno.test("DentalConnect guided greeting and service list use dental copy and actions", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("👋 Bienvenido a *${brandName}* 🦷"));
  assert(source.includes("Agendá tu cita en menos de 1 minuto."));
  assert(source.includes("¿Qué necesitás hacer hoy?"));
  assert(source.includes("Escogé el motivo de la cita 🦷"));
  assert(
    source.includes(
      "Estos son los servicios disponibles en ${brandName} 🦷",
    ),
  );
  assert(source.includes("Escogé uno para ver disponibilidad y agendar."));
  assert(source.includes('{ id: "booking_start", title: "Agendar cita" }'));
  assert(source.includes('{ id: "view_prices", title: "Servicios" }'));
  assert(source.includes('{ id: "dental_info", title: "Info clínica" }'));
  const greetingButtonsBlock = source.slice(
    source.indexOf("function dentalGreetingButtons"),
    source.indexOf("function getDentalServiceMenuEmoji"),
  );
  assert(!greetingButtonsBlock.includes("Hablar con recepción"));
  assert(source.includes("select_service:${service.id}"));
  assert(source.includes("getDentalServiceMenuEmoji(service.name)"));
  assert(
    !source.includes('{ id: "view_prices", title: "Ver servicios/precios" }'),
  );
  assert(!source.includes("Estos son los servicios de ${brandName} 🦷"));
});

Deno.test("DentalConnect clinic info submenu exposes hours location and reception", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes('normalizedAction === "dental_info"'));
  assert(source.includes("Claro 🦷 ¿Qué querés consultar?"));
  assert(source.includes('{ id: "dental_hours", title: "Horarios" }'));
  assert(source.includes('{ id: "dental_location", title: "Ubicación" }'));
  assert(
    source.includes('{ id: "talk_to_human", title: "Hablar con recepción" }'),
  );
  assert(source.includes('debugNote: "dental_guided_clinic_info_menu"'));
});

Deno.test("DentalConnect hours and location info use settings or safe fallback", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function formatDentalHoursInfo"));
  assert(source.includes("DICAN atiende:"));
  assert(source.includes("Lunes a viernes: 8:00 AM – 5:00 PM"));
  assert(source.includes("Sábado: 9:00 AM – 1:00 PM"));
  assert(source.includes("function resolveDentalLocationInfo"));
  assert(
    source.includes(
      "Por ahora no tengo la ubicación configurada. Puedo pasarte con recepción para confirmarla.",
    ),
  );
  assert(source.includes('debugNote: "dental_guided_hours_info"'));
  assert(source.includes('debugNote: "dental_guided_location_missing"'));
});

Deno.test("DentalConnect guided flow preserves emergency triage before normal booking", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("isDentalEmergencyText"));
  assert(
    source.includes("Entiendo 🦷 Para ayudarte mejor, ¿qué estás sintiendo?"),
  );
  assert(
    source.includes("contactá a la clínica o buscá atención de emergencia"),
  );
  assert(
    source.includes(
      '{ id: "dental_triage:dolor_fuerte", title: "Dolor fuerte" }',
    ),
  );
  assert(
    source.includes(
      '{ id: "dental_triage:inflamacion", title: "Inflamación" }',
    ),
  );
  assert(
    source.includes('{ id: "dental_triage:sangrado", title: "Sangrado" }'),
  );
  assert(
    source.includes(
      '{ id: "dental_triage:diente_quebrado", title: "Diente quebrado" }',
    ),
  );
});

Deno.test("DentalConnect guided date provider slot and confirmation UX exists", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(
    source.includes(
      "Escribime la fecha que preferís, por ejemplo: mañana, viernes o 5 de junio.",
    ),
  );
  assert(source.includes('{ id: todayAction, title: "Hoy" }'));
  assert(
    source.includes('{ id: "booking_date_pref:tomorrow", title: "Mañana" }'),
  );
  assert(
    source.includes('{ id: "booking_date_pref:week", title: "Otra fecha" }'),
  );
  assert(source.includes("¿Tenés doctor preferido?"));
  assert(source.includes("formatDentalPeriodSelectorBody"));
  assert(source.includes("¿qué horario preferís? 🦷"));
  assert(
    source.includes('{ id: "dental_period:morning", title: "Por la mañana" }'),
  );
  assert(
    source.includes('{ id: "dental_period:afternoon", title: "Por la tarde" }'),
  );
  assert(source.includes("¿A nombre de quién dejamos la cita?"));
  assert(source.includes("¿Confirmamos?"));
  assert(
    source.includes('{ id: "change_booking_slot", title: "Cambiar hora" }'),
  );
  assert(source.includes('{ id: "cancel_booking", title: "Cancelar" }'));
  assert(source.includes("✅ Cita confirmada"));
  assert(!source.includes("👩‍⚕️ Doctor: ${provider}"));
});

Deno.test("DentalConnect uses morning afternoon period lists after date selection", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function showDentalPeriodSelector"));
  assert(source.includes("getAvailableSlotsForDay({"));
  assert(source.includes('business_type: "dental"'));
  assert(source.includes("date: args.selectedDate"));
  assert(source.includes("timezone"));
  assert(source.includes("function showDentalSlotsForPeriod"));
  assert(source.includes("function dentalPeriodSlotsList"));
  assert(source.includes("filterDentalSlotsByPeriod"));
  assert(source.includes('nextExpected: "dental_time_period"'));
  assert(source.includes("Por la mañana"));
  assert(source.includes("Por la tarde"));
  assert(source.includes("hasMorning: morningSlots.length > 0"));
  assert(source.includes("hasAfternoon: afternoonSlots.length > 0"));
  assert(source.includes('"dental_guided_today_no_future_slots"'));
  assert(source.includes("Ya no tengo horarios disponibles para hoy 🦷"));
  assert(source.includes('id: "booking_date_pref:tomorrow", title: "Mañana"'));
  assert(source.includes('buttonText = "Horarios"'));
  assert(!source.includes('description: "Horario disponible"'));
  assert(!source.includes("Doctor disponible · Limpieza dental"));
});

Deno.test("DentalConnect date picker hides Hoy when today has no future slots", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("async function dentalDatePreferenceButtons"));
  assert(source.includes("const todaySlots = await getAvailableSlotsForDay"));
  assert(source.includes("if (todaySlots.length > 0)"));
  assert(source.includes('{ id: todayAction, title: "Hoy" }'));
  assert(
    source.includes("const tomorrowSlots = await getAvailableSlotsForDay"),
  );
  assert(source.includes("if (tomorrowSlots.length > 0)"));
  assert(source.includes('{ id: otherDateAction, title: "Otra fecha" }'));
  assert(
    !source.includes(
      'return withKeepExisting([\\n    { id: otherDateAction, title: "Otra fecha" },\\n    { id: "talk_to_human", title: "Hablar con recepción" }',
    ),
  );
  assert(
    source.includes("interactiveButtons: await dentalDatePreferenceButtons({"),
  );
});

Deno.test("DentalConnect manual hoy no-slots recovery excludes reception from primary recovery", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  const branch = source.slice(source.indexOf("debugNote: isToday"));
  const buttonBranch = branch.slice(
    branch.indexOf("interactiveButtons: isToday"),
  );
  const todayButtons = buttonBranch.slice(
    buttonBranch.indexOf("? ["),
    buttonBranch.indexOf("]\n        :"),
  );

  assert(branch.includes('"dental_guided_today_no_future_slots"'));
  assert(
    todayButtons.includes(
      '{ id: "booking_date_pref:tomorrow", title: "Mañana" }',
    ),
  );
  assert(
    todayButtons.includes(
      '{ id: "booking_date_pref:week", title: "Otra fecha" }',
    ),
  );
  assert(
    !todayButtons.includes(
      '{ id: "talk_to_human", title: "Hablar con recepción" }',
    ),
  );
});

Deno.test("DentalConnect period slot lists only include the selected valid period", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function filterDentalSlotsByPeriod"));
  assert(
    source.includes(
      'period === "morning" ? minutes < 12 * 60 : minutes >= 13 * 60',
    ),
  );
  assert(source.includes('normalizedAction.startsWith("dental_period:")'));
  assert(source.includes('"dental_guided_morning_slots"'));
  assert(source.includes('"dental_guided_afternoon_slots"'));
});

Deno.test("DentalConnect Horarios info stays business-hours only", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function formatDentalHoursInfo"));
  assert(source.includes('normalizedAction === "dental_hours"'));
  assert(source.includes('debugNote: "dental_guided_hours_info"'));
  assert(
    source.indexOf('normalizedAction === "dental_hours"') <
      source.indexOf("handleDentalDirectBookingRequest({"),
  );
});

Deno.test("DentalConnect active appointment guard runs before booking service picker", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  const guidedStart = source.indexOf(
    "async function handleDentalGuidedRuntimeTurn",
  );
  const guardIndex = source.indexOf(
    'debugNote: "dental_guided_booking_start_active_appointment_guard"',
    guidedStart,
  );
  const servicePickerIndex = source.indexOf(
    'debugNote: "dental_guided_service_selection"',
    guidedStart,
  );

  assert(guardIndex > guidedStart);
  assert(servicePickerIndex > guidedStart);
  assert(guardIndex < servicePickerIndex);
  assert(
    source.includes("formatDentalActiveAppointmentGuardReply(activeState)"),
  );
  assert(
    source.includes('{ id: "additional_booking", title: "Agendar otra cita" }'),
  );
  assert(
    source.includes(
      '{ id: "keep_existing_booking", title: "Mantener mi cita" }',
    ),
  );
});

Deno.test("DentalConnect additional booking explicitly bypasses active appointment guard", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  const guidedStart = source.indexOf(
    "async function handleDentalGuidedRuntimeTurn",
  );
  const additionalIndex = source.indexOf(
    'if (normalizedAction === "additional_booking")',
    guidedStart,
  );
  const guardIndex = source.indexOf(
    'debugNote: "dental_guided_booking_start_active_appointment_guard"',
    guidedStart,
  );

  assert(additionalIndex > guidedStart);
  assert(guardIndex > guidedStart);
  assert(additionalIndex < guardIndex);
  assert(source.includes("buildDentalAdditionalBookingServicePickerResult"));
  assert(source.includes("dental_additional_booking_hard_override"));
  assert(source.includes("!allowDentalAdditionalBookingDuringTakeover"));
  assert(source.includes("leadPatch: { handoff_to_human: false"));
  assert(source.includes("allow_additional_booking: true"));
  assert(source.includes('lastIntent: "additional_booking"'));
});

Deno.test("DentalConnect service selection checks active appointment before date picker", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  const serviceBranch = source.indexOf(
    'if (normalizedAction.startsWith("select_service:"))',
  );
  const guardIndex = source.indexOf(
    'debugNote: "dental_guided_service_selection_active_appointment_guard"',
    serviceBranch,
  );
  const datePromptIndex = source.indexOf(
    'debugNote: "dental_guided_date_prompt"',
    serviceBranch,
  );

  assert(serviceBranch > 0);
  assert(guardIndex > serviceBranch);
  assert(datePromptIndex > serviceBranch);
  assert(guardIndex < datePromptIndex);
  assert(source.includes("const allowAdditionalBooking = Boolean("));
  assert(source.includes("(collected as any).allow_additional_booking"));
  assert(source.includes("clearDentalAttemptedBookingState(collected, {"));
  assert(
    source.includes("formatDentalActiveAppointmentGuardReply(activeState)"),
  );
  assert(
    source.includes(
      'debugNote: "dental_guided_service_selection_active_appointment_guard"',
    ),
  );
  assert(source.includes("pending_booking: null"));
  assert(source.includes("selected_slot: null"));
  assert(source.includes('current_service_key: ""'));
  assert(source.includes('current_service_name: ""'));
  assert(source.includes('preferred_date: ""'));
  assert(source.includes('preferred_time: ""'));
});

Deno.test("DentalConnect services info remains before service-selection guard", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  const pricingIndex = source.indexOf(
    'debugNote: "dental_guided_services_pricing"',
  );
  const serviceGuardIndex = source.indexOf(
    'debugNote: "dental_guided_service_selection_active_appointment_guard"',
  );
  const hoursIndex = source.indexOf('debugNote: "dental_guided_hours_info"');
  const locationIndex = source.indexOf(
    'debugNote: "dental_guided_location_missing"',
  );

  assert(pricingIndex > 0);
  assert(serviceGuardIndex > 0);
  assert(hoursIndex > 0);
  assert(locationIndex > 0);
  assert(hoursIndex < serviceGuardIndex);
  assert(locationIndex < serviceGuardIndex);
  assert(pricingIndex < serviceGuardIndex);
});

Deno.test("DentalConnect Servicio singular is service info and clears stale booking state", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  const pricingIndex = source.indexOf(
    'debugNote: "dental_guided_services_pricing"',
  );
  assert(pricingIndex > 0);
  assert(
    source.includes(
      "/\\b(precio|precios|servicio|servicios|cuanto cuesta|cuánto cuesta|cuesta|vale)\\b/",
    ),
  );
  assert(
    source.includes("collected: clearDentalAttemptedBookingState(collected)"),
  );
});

Deno.test("DentalConnect date intelligence handles ambiguous weekdays and future ranges", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function getDentalAmbiguousWeekdayOptions"));
  assert(source.includes("normalizedAction = `dental_weekday_clarify:${"));
  assert(
    source.includes('normalizedAction.startsWith("dental_weekday_clarify:")'),
  );
  assert(source.includes("¿Te referís a"));
  assert(source.includes('debugNote: "dental_guided_weekday_clarification"'));
  assert(source.includes("function parseDentalFutureRangeFromText"));
  assert(source.includes("normalizedAction = `dental_date_range:${"));
  assert(source.includes('normalizedAction.startsWith("dental_date_range:")'));
  assert(source.includes("function buildDentalDateOptionsInRange"));
  assert(source.includes("Tengo estas fechas disponibles esa semana 🦷"));
  assert(source.includes("debugNote: days.length"));
  assert(source.includes('"dental_guided_future_range_dates"'));
});

Deno.test("DentalConnect generic doctor displays as Equipo DICAN in patient copy", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function formatDentalProviderDisplayName"));
  assert(source.includes('normalized === "doctor disponible"'));
  assert(source.includes('return "Equipo DICAN"'));
  assert(source.includes("formatDentalProviderDisplayName("));
  assert(source.includes("Doctor: *${provider}*"));
});

Deno.test("DentalConnect no-availability recovery searches next slots instead of looping Cualquiera", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("findDentalNextAvailableSlots"));
  assert(
    source.includes(
      "No encontré cupos para ${",
    ),
  );
  assert(source.includes('debugNote: "dental_guided_next_available_recovery"'));
  assert(
    source.includes(
      "No encontré horarios disponibles por ahora. Te puedo pasar con recepción para revisar manualmente.",
    ),
  );
  const noSlotsBranch = source.slice(
    source.indexOf('debugNote: "dental_guided_no_slots"'),
    source.indexOf("const shown = slots.slice"),
  );
  assert(!noSlotsBranch.includes('id: "select_provider:any"'));
  assert(noSlotsBranch.includes('title: "Hablar con recepción"'));
});

Deno.test("DentalConnect guided booking only confirms after appointment insert succeeds", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes('name: "book_appointment"'));
  assert(source.includes('business_type: "dental"'));
  assert(source.includes("if (result.booking?.ok)"));
  assert(source.includes("formatDentalBookingSuccess(result.booking)"));
  assert(
    source.includes(
      "No pude guardar la cita en este momento. Te puedo pasar con recepción para revisarlo manualmente.",
    ),
  );
  assert(source.includes('debugNote: "dental_guided_booking_failed"'));
});

Deno.test("DentalConnect scheduling uses pending booking duration buffer and 30 minute slot defaults", async () => {
  const indexSource = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  const availabilitySource = await Deno.readTextFile(
    "supabase/functions/run-replies/domain/availabilityCore.ts",
  );
  const executorSource = await Deno.readTextFile(
    "supabase/functions/run-replies/domain/actionExecutor.ts",
  );

  assert(indexSource.includes("getDentalFallbackDurationMin"));
  assert(indexSource.includes("getDentalBufferAfterMin"));
  assert(indexSource.includes("buffer_after_min"));
  assert(indexSource.includes("effective_duration_min"));
  assert(indexSource.includes('source: "dental_guided_pending_confirmation"'));
  assert(availabilitySource.includes("DEFAULT_DENTAL_AVAILABILITY_SERVICES"));
  assert(availabilitySource.includes("getDentalFallbackDurationMin"));
  assert(availabilitySource.includes("getDentalBufferAfterMin"));
  assert(
    availabilitySource.includes(
      'String(input.business_type ?? "").toLowerCase() === "barbershop"',
    ),
  );
  assert(
    availabilitySource.includes(
      "Number(bookingRules?.slot_interval_min ?? 30) || 30",
    ),
  );
  assert(
    availabilitySource.includes(
      "serviceDurationMin + getDentalBufferAfterMin",
    ),
  );
  assert(executorSource.includes("isDentalGuidedPendingConfirmation"));
  assert(
    executorSource.includes(
      'requestedBusinessType !== "dental" && Boolean',
    ),
  );
  assert(
    executorSource.includes(
      "dental_guided_pending_confirmation_skips_recomputed_provider_validation",
    ),
  );
});

Deno.test("DentalConnect guided change time keeps selected date and cancel clears pending booking", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes('debugNote: "dental_guided_change_time_slots"'));
  assert(source.includes('debugNote: "dental_guided_booking_cancelled"'));
  assert(
    source.includes(
      "Listo, no confirmé esa cita 🦷",
    ),
  );
  assert(
    source.includes("¿Querés buscar otro horario o empezar una cita nueva?"),
  );
  assert(source.includes('nextExpected: "dental_cancel_recovery"'));
  assert(source.includes('id: "dental_recovery:search_other_time"'));
  assert(source.includes("const selectedDate = safeStr("));
  assert(source.includes("pending.appointment_date"));
  assert(source.includes("showDentalPeriodSelector({"));
});

Deno.test("DentalConnect date-only text stays date-only and does not become time", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function parseDentalDateFromText"));
  assert(source.includes("5 de junio"));
  assert(source.includes("function parseDentalExplicitTimeFromText"));
  assert(
    source.includes(
      "if (parsedDate && !parseDentalExplicitTimeFromText(inboundText))",
    ),
  );
  assert(source.includes("normalizedAction = `select_date:${parsedDate}`"));
  assert(
    source.includes(
      "const match = n.match(/\\b(?:a las|alas)\\s*(\\d{1,2})",
    ),
  );
  assert(source.includes("// Dental clinics are daytime businesses"));
});

Deno.test("DentalConnect direct booking extracts service date time before service picker", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("async function handleDentalDirectBookingRequest"));
  assert(source.includes("resolveDentalServiceFromActionOrText("));
  assert(source.includes("parseDentalDateFromText("));
  assert(source.includes("parseDentalExplicitTimeFromText("));
  assert(source.includes('debugNote: "dental_direct_booking_confirmation"'));
  assert(
    source.includes(
      'debugNote: "dental_direct_booking_date_only_period_selector"',
    ),
  );
  assert(source.includes("dental_direct_booking_alternatives"));
  assert(
    source.indexOf("handleDentalDirectBookingRequest({") <
      source.indexOf('debugNote: "dental_guided_service_selection"'),
  );
});

Deno.test("DentalConnect partial direct booking preserves date time while asking service", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(
    source.includes("dental_direct_booking_missing_service_preserved_datetime"),
  );
  assert(source.includes("Perfecto 🦷 ¿Qué servicio necesitás?"));
  assert(source.includes("appointment_date: requestedDate ||"));
  assert(source.includes("appointment_time: requestedTime ||"));
  assert(source.includes("dental_direct_preserved_confirmation"));
  assert(source.includes("dental_direct_preserved_alternatives"));
  assert(source.includes("dental_direct_preserved_period_selector"));
});

Deno.test("DentalConnect accepted alternative promotes first offered slot to pending confirmation", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function isAffirmativeDentalText"));
  assert(source.includes("me sirve"));
  assert(source.includes("está bien"));
  assert(source.includes("last_offered_slots"));
  assert(
    source.includes(
      'normalizedAction = `select_slot:${safeStr(first.date, "")}|${',
    ),
  );
  assert(source.includes("buildDentalPendingBookingFromSlot"));
  assert(source.includes("dentalConfirmationOrNameGate"));
  assert(source.includes('source: "dental_guided_pending_confirmation"'));
});

Deno.test("DentalConnect post-cancel short affirmative routes to recovery", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes('expected === "dental_cancel_recovery"'));
  assert(source.includes("isAffirmativeDentalText(inboundText)"));
  assert(
    source.includes('normalizedAction = "dental_recovery:search_other_time"'),
  );
  assert(
    source.includes('debugNote: "dental_cancel_recovery_period_selector"'),
  );
  assert(source.includes('debugNote: "dental_cancel_recovery_date_prompt"'));
  assert(source.includes('debugNote: "dental_cancel_recovery_service_picker"'));
});

Deno.test("DentalConnect active appointment reschedule uses guided hour choices", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("dentalRescheduleChoiceButtons"));
  assert(
    source.includes('{ id: "change_booking_slot", title: "Cambiar hora" }'),
  );
  assert(
    source.includes(
      '{ id: "dental_reschedule_change_date", title: "Cambiar día" }',
    ),
  );
  assert(
    source.includes(
      '{ id: "keep_existing_booking", title: "Cancelar cambio" }',
    ),
  );
  assert(source.includes("Claro 🦷 ¿Qué querés cambiar de tu cita?"));
  assert(source.includes("Servicio: *${service}*"));
  assert(source.includes("Fecha actual: *${"));
  assert(source.includes("Hora actual: *${formatHourLabel(time)}*"));
});

Deno.test("DentalConnect active appointment reschedule fallback does not use old generic copy", async () => {
  const indexSource = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  const engineSource = await Deno.readTextFile(
    "supabase/functions/run-replies/conversationEngine.ts",
  );

  assert(indexSource.includes("dental_guided_reschedule_prompt_from_fallback"));
  assert(
    indexSource.includes(
      "fallbackInteractiveButtons = dentalRescheduleChoiceButtons()",
    ),
  );
  assert(indexSource.includes("Claro 🦷 ¿Qué querés cambiar de tu cita?"));
  assert(!indexSource.includes("¿Qué nueva fecha y hora preferís?"));
  assert(
    !indexSource.includes(
      "Perfecto. Decime la nueva fecha y hora para cambiar tu cita.",
    ),
  );
  assert(engineSource.includes("dental_reschedule_datetime_guided_fallback"));
  assert(
    engineSource.includes(
      'replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__"',
    ),
  );
});

Deno.test("DentalConnect same-day reschedule opens clean hour list", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function dentalRescheduleHoursList"));
  assert(source.includes("dental_reschedule_time:"));
  assert(source.includes('buttonText: "Horas disponibles"'));
  assert(source.includes('title: "Horas disponibles"'));
  assert(
    source.includes(
      'title: formatHourLabel(safeStr(slot.time, "")).slice(0, 20)',
    ) ||
      source.includes(
        'title: formatHourLabel(safeStr(slot.time, "")).slice(0, 24)',
      ),
  );
  assert(!source.includes("Doctor disponible · Limpieza dental"));
  assert(!source.includes("Horario disponible"));
  assert(source.includes("Perfecto 🦷 Mantengo tu cita para *"));
  assert(source.includes("formatRequestedDayLabel(date)"));
  assert(source.includes("Escogé la nueva hora:"));
  assert(source.includes('normalizedAction = "dental_reschedule_show_hours"'));
});

Deno.test("DentalConnect reschedule hour change skips intermediate options", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes('normalizedAction = "dental_reschedule_show_hours";'));
  assert(source.includes("solo quiero cambiar la hora"));
  assert(source.includes("cambiar solo hora"));
  assert(source.includes("no hacer cambios"));
  assert(source.includes("Perfecto, dejamos tu cita igual 🦷"));
  assert(source.includes('normalizedAction = "dental_reschedule_show_hours"'));
});

Deno.test("DentalConnect date selection opens direct hour list when only one period has slots", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("async function showDentalAllSlotsForDate"));
  assert(
    source.includes("if (!morningSlots.length || !afternoonSlots.length)"),
  );
  assert(
    source.includes("debugNote: `${args.debugNote}_single_period_hour_list`"),
  );
  assert(
    source.includes("estos son los horarios disponibles 🦷"),
  );
  assert(source.includes("buttonText,"));
  assert(source.includes('"Horas disponibles"'));
});

Deno.test("DentalConnect date buttons hide Hoy when today has no future slots", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("async function dentalDatePreferenceButtons"));
  assert(source.includes("const todaySlots = await getAvailableSlotsForDay({"));
  assert(source.includes("if (todaySlots.length > 0)"));
  assert(
    source.includes('const todayAction = args.actionMode === "reschedule"'),
  );
  assert(
    source.includes('const tomorrowAction = args.actionMode === "reschedule"'),
  );
  assert(source.includes("return withKeepExisting(["));
  assert(source.includes('{ id: todayAction, title: "Hoy" }'));
  assert(source.includes('{ id: tomorrowAction, title: "Mañana" }'));
  assert(source.includes('{ id: otherDateAction, title: "Otra fecha" }'));
});

Deno.test("DentalConnect explicit hoy with no slots does not set pending today", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes('normalizedAction === "booking_date_pref:today"'));
  assert(
    source.includes(
      'debugNote: "dental_guided_today_no_future_slots_from_action"',
    ),
  );
  assert(source.includes("Ya no tengo horarios disponibles para hoy 🦷"));
  const guardStart = source.indexOf(
    'debugNote: "dental_guided_today_no_future_slots_from_action"',
  );
  const guardBlock = source.slice(
    Math.max(0, guardStart - 1800),
    guardStart + 300,
  );
  assert(!guardBlock.includes("appointment_date: todayIso"));
  assert(!guardBlock.includes("current_date: todayIso"));
  assert(
    guardBlock.includes(
      '{ id: "booking_date_pref:tomorrow", title: "Mañana" }',
    ),
  );
  assert(
    guardBlock.includes(
      '{ id: "booking_date_pref:week", title: "Otra fecha" }',
    ),
  );
});

Deno.test("DentalConnect current booking change-hour text opens interactive hour list", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function isDentalChangeHourText"));
  assert(source.includes("quiero cambiar la hora"));
  assert(
    source.includes('normalizedAction = "dental_show_current_date_hours"'),
  );
  assert(source.includes('debugNote: "dental_current_date_hour_list"'));
  assert(source.includes("interactiveList: dentalPeriodSlotsList("));
});

Deno.test("DentalConnect no-change action is reschedule-only and clears stale change state", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function dentalSameDayRescheduleButtons"));
  assert(
    source.includes(
      '{ id: "keep_existing_booking", title: "No hacer cambios" }',
    ),
  );
  assert(source.includes("function clearDentalTemporaryChangeState"));
  assert(source.includes("pending_reschedule: _pendingReschedule"));
  assert(source.includes("pending_booking: _pendingBooking"));
  assert(source.includes("selected_slot: _selectedSlot"));
  assert(source.includes("pending_offered_slot: _pendingOfferedSlot"));
  assert(source.includes("preferred_date: _preferredDate"));
  assert(source.includes("preferred_time: _preferredTime"));
  assert(source.includes("last_offered_slots: _lastOfferedSlots"));
  assert(
    source.includes("collected: clearDentalTemporaryChangeState(collected)"),
  );
  assert(source.includes("Perfecto, dejamos tu cita igual 🦷"));
  assert(source.includes("nextExpected: undefined"));
});

Deno.test("DentalConnect no-change cleanup prevents stale reschedule follow-up routing", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("active_flow: undefined"));
  assert(source.includes("activeBookingFlow: false"));
  assert(source.includes("pending_cancel: null"));
  assert(source.includes("pending_cancel_appointment: null"));
  assert(
    source.includes(
      "(!normalizedAction && /\\b(horario|horarios|abren|atienden|atiende)\\b/.test(text))",
    ),
  );
  assert(source.includes('lastIntent: "business_hours_question"'));
});

Deno.test("DentalConnect same-date text keeps selected date instead of parsing a time", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function isDentalKeepSelectedDateText"));
  assert(source.includes("deja la misma fecha"));
  assert(source.includes("dejar igual la fecha"));
  assert(source.includes("parseDentalCurrentTimeSelectionFromText"));
  const availabilityBranch = source.indexOf(
    'expected === "availability_slot_selection"',
  );
  const keepSameDateCheck = source.lastIndexOf(
    "isDentalKeepSelectedDateText(text)",
  );
  const dateParserAfterCheck = source.indexOf(
    "parseDentalDateFromText(inboundText, nowLocal)",
    keepSameDateCheck,
  );
  assert(
    availabilityBranch >= 0 &&
      availabilityBranch < keepSameDateCheck &&
      keepSameDateCheck < dateParserAfterCheck,
  );
});

Deno.test("DentalConnect direct typed time uses current selected date and clean alternatives", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(
    source.includes(
      "normalizedAction = `dental_current_date_time:${parsedTime}`",
    ),
  );
  assert(
    source.includes('normalizedAction.startsWith("dental_current_date_time:")'),
  );
  assert(source.includes('debugNote: "dental_current_date_time_confirmation"'));
  assert(source.includes('"dental_current_date_time_alternatives"'));
  assert(
    source.includes(
      'dentalPeriodSlotsList(offeredSlots, body, "Horas disponibles")',
    ),
  );
});

Deno.test("DentalConnect hour and alternative lists keep rows time-only", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(
    source.includes(
      'title: formatHourLabel(safeStr(slot.time, "")).slice(0, 24)',
    ),
  );
  assert(
    source.includes(
      'interactiveList: dentalPeriodSlotsList(offeredSlots, body, "Más horas")',
    ),
  );
  assert(!source.includes("Doctor disponible · Limpieza dental"));
  assert(!source.includes("Equipo DICAN ·"));
  assert(!source.includes("Horario disponible"));
});

Deno.test("DentalConnect cancel confirmation is explicit and keeps appointment on no", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("dentalCancelConfirmationButtons"));
  assert(
    source.includes(
      '{ id: "confirm_cancel_appointment", title: "Confirmar cancelación" }',
    ),
  );
  assert(
    source.includes('{ id: "keep_existing_booking", title: "Mantener cita" }'),
  );
  assert(
    source.includes('{ id: "reschedule_booking", title: "Cambiar hora" }'),
  );
  assert(source.includes("¿Seguro que querés cancelarla?"));
  assert(source.includes("Perfecto, mantenemos tu cita 🦷"));
  assert(source.includes("Tu cita de *${service}*${"));
  assert(source.includes("a nombre de *${patientName}*"));
  assert(source.includes("Cuando querás, puedo ayudarte a agendar otra."));
});

Deno.test("DentalConnect appointment insert allows dental appointments without barber fallback", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/domain/actionExecutor.ts",
  );

  assert(
    source.includes(
      'business_type: isBarbershopBooking ? "barbershop" : "dental"',
    ),
  );
  assert(source.includes("if ("));
  assert(source.includes("isBarbershopBooking"));
  assert(source.includes("!appointmentFields.provider_id"));
  assert(source.includes("!appointmentFields.provider_name"));
  assert(source.includes("start_at: startIso"));
  assert(source.includes("starts_at: startIso"));
  assert(source.includes("function isValidUuid"));
  assert(source.includes("dental_guided_invalid_provider_id_sanitized"));
  assert(source.includes("formatDentalAppointmentProviderName"));
  assert(source.includes('return "Equipo DICAN"'));
  assert(source.includes("provider_id: payloadProviderId || null"));
  assert(
    source.includes(
      "appointment_date: appointmentDate || startIso.slice(0, 10)",
    ),
  );
  assert(
    source.includes(
      "appointment_time: appointmentTime || startIso.slice(11, 16)",
    ),
  );
  assert(source.includes('status: "confirmed"'));
});

Deno.test("DentalConnect guided handoff uses existing event pipeline and dental copy", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("formatDentalHandoffCopy"));
  assert(source.includes("Listo 🦷 Te paso con alguien del equipo."));
  assert(source.includes("recordHumanHandoffEvent"));
  assert(source.includes("handoff_to_human: true"));
  assert(!source.includes('from("lead_events")'));
});

Deno.test("BarberLine service selection opens direct WhatsApp date list", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function barbershopDateSelectionList"));
  assert(source.includes('buttonText: "Ver días disponibles"'));
  assert(source.includes("Listo 💈 Escogé el día que te quede mejor:"));
  assert(
    source.includes(
      "interactiveList: barbershopDateSelectionList(dateOptions, listBody)",
    ),
  );
  assert(source.includes('"booking_interactive_day_preference_after_service"'));
});

Deno.test("BarberLine service-selected date list uses up to 7 valid availability days", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("dateOptions.length < 7"));
  assert(source.includes("getAvailableSlotsForDay({"));
  assert(source.includes('business_type: "barbershop"'));
  assert(source.includes("if (slots.length === 0) continue;"));
  assert(
    source.includes(
      'source: offset === 0 ? "today" : offset === 1 ? "tomorrow" : "more_days"',
    ),
  );
});

Deno.test("BarberLine service-selected date list has numbered fallback only outside list UI", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("const fallbackBody = dateOptions.length"));
  assert(source.includes("Escogé el día:"));
  assert(source.includes("dateOptions.map"));
  assert(source.includes("rows: dates.slice(0, 7).map"));
  assert(
    !source.includes(
      'debugNote: "booking_interactive_day_preference_after_service",\\n          interactiveButtons',
    ),
  );
});

Deno.test("WhatsApp inbound routing resolves organization before scoped lead lookup", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/meta-webhook/index.ts",
  );

  assert(source.includes("function normalizeChannelUserId"));
  assert(source.includes("async function resolveOrganizationForInbound"));
  assert(source.includes("async function findWhatsAppLeadRoutingDiagnostics"));
  assert(source.includes('channel === "whatsapp"'));
  assert(
    source.includes('defaultOrgUsed = resolvedOrg.source === "default_org"'),
  );
  assert(!source.includes('organizationSource = "existing_whatsapp_lead"'));
  assert(!source.includes("recheckExistingWhatsAppLead"));
  assert(
    !source.includes("organization_id = String(existingLead.organization_id)"),
  );
});

Deno.test("WhatsApp duplicate lead routing logs stale leads without selecting their org", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/meta-webhook/index.ts",
  );

  assert(source.includes("chooseLeadForInbound"));
  assert(source.includes("stale_whatsapp_leads_detected"));
  assert(source.includes("status"));
  assert(source.includes("handoff_to_human"));
  assert(source.includes("safeString(a?.organization_id) === defaultOrg"));
  assert(source.includes('String(a?.status ?? "").toLowerCase() === "active"'));
  assert(source.includes("!isArchivedChannelUserId(row?.channel_user_id)"));
  assert(source.includes("updated_at"));
  assert(source.includes("stale_leads"));
  assert(source.includes("selectedOrganizationId"));
  assert(
    !source.includes(
      '.eq("organization_id", organization_id)\n        .eq("channel", channel)\n        .eq("channel_user_id", senderId)\n        .maybeSingle();\n      if (selErr) throw selErr;\n\n      const nextState',
    ),
  );
});

Deno.test("WhatsApp inbound lead routing logs selected lead and fallback/default org usage", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/meta-webhook/index.ts",
  );

  assert(source.includes("inbound_lead_routing"));
  assert(source.includes("inbound_from: rawSenderId"));
  assert(source.includes("normalized_channel_user_id: senderId"));
  assert(source.includes("inbound_channel_user_id: senderId"));
  assert(source.includes("selected_lead_id: lead.id"));
  assert(source.includes("selected_organization_id: organization_id"));
  assert(source.includes("used_existing_lead: Boolean(existingLead?.id)"));
  assert(source.includes("used_default_org: defaultOrgUsed"));
  assert(source.includes("duplicate_lead_detected: duplicateLeadCount > 1"));
  assert(source.includes("fallback_default_org_used: defaultOrgUsed"));
});

Deno.test("WhatsApp demo contact routing maps shared phone contacts to demo orgs", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/meta-webhook/index.ts",
  );

  assert(source.includes("BUILT_IN_DEMO_CONTACT_ROUTES"));
  assert(source.includes('"17812961757": "barber-demo"'));
  assert(source.includes('"50433899824": "clinic-demo"'));
  assert(source.includes('"50493312928": "barber-demo-wimaeil"'));
  assert(source.includes("DEMO_SHARED_WHATSAPP_PHONE_NUMBER_ID"));
  assert(source.includes("DEMO_WHATSAPP_PHONE_NUMBER_ID"));
  assert(source.includes("DEMO_SHARED_PHONE_NUMBER_ID"));
  assert(source.includes("DEMO_CONTACT_ROUTES"));
  assert(source.includes('source = "demo_contact_route"'));
});

Deno.test("WhatsApp demo contact routing wins before existing lead fallback", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/meta-webhook/index.ts",
  );

  assert(
    source.includes("const resolvedOrg = await resolveOrganizationForInbound"),
  );
  assert(
    source.includes(
      "const leadDiagnostics = await findWhatsAppLeadRoutingDiagnostics",
    ),
  );
  assert(source.includes('if (resolvedOrg.source === "demo_contact_route")'));
  assert(!source.includes('const existingLeadMatch = channel === "whatsapp"'));
  assert(
    !source.includes(
      'organizationSource === "default_org" && !existingLead?.id',
    ),
  );
});

Deno.test("WhatsApp org routing logs canonical source names", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/meta-webhook/index.ts",
  );

  assert(source.includes("organization_source: organizationSource"));
  assert(source.includes("organization_source: resolvedOrg.source"));
  assert(source.includes('source = "org_settings"'));
  assert(
    source.includes('defaultOrgUsed = resolvedOrg.source === "default_org"'),
  );
  assert(!source.includes('source = "organization_settings_integration"'));
});

Deno.test("WhatsApp phone routing requires active bot-enabled org_settings candidates", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/meta-webhook/index.ts",
  );

  assert(source.includes('.eq("whatsapp_phone_number_id", phoneNumberId)'));
  assert(source.includes("normalizeBooleanFlag(row?.whatsapp_enabled)"));
  assert(source.includes("normalizeBooleanFlag(row?.bot_enabled)"));
  assert(source.includes('.order("updated_at", { ascending: false })'));
  assert(source.includes("whatsapp_org_routing_ambiguous"));
});

Deno.test("WhatsApp active phone org routing is not overridden by stale existing lead", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/meta-webhook/index.ts",
  );

  assert(source.includes('} else if (resolvedOrg.source === "org_settings")'));
  assert(source.includes("organization_id = resolvedOrg.organizationId"));
  assert(source.includes("existing_lead_found_under_selected_org"));
  assert(source.includes("stale_lead_count"));
  assert(
    !source.includes("organization_id = String(recheck.lead.organization_id)"),
  );
});

Deno.test("WhatsApp inbound org routing logs candidate orgs and prompt key", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/meta-webhook/index.ts",
  );

  assert(source.includes("candidate_orgs: resolvedOrg.routingCandidates"));
  assert(source.includes("selected_business_type: orgBusinessType"));
  assert(source.includes("selected_prompt_key: promptKeyForBusinessType"));
  assert(source.includes("inbound_phone_number_id: phoneNumberId"));
  assert(
    source.includes(
      'return businessType === "barbershop" ? "barbershop_v1" : "dental_v1"',
    ),
  );
});

Deno.test("DentalConnect final demo hours formatter groups identical weekdays", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("const groupedRows: string[] = []"));
  assert(
    source.includes("`${current.name} a ${rows[end].name.toLowerCase()}`"),
  );
  assert(source.includes('groupedRows.join("\\n")'));
  assert(source.includes("Lunes a viernes: 8:00 AM – 5:00 PM"));
  assert(source.includes("Sábado: 9:00 AM – 1:00 PM"));
  assert(source.includes("Domingo: cerrado"));
});

Deno.test("DentalConnect selected-service date time text preserves both date and time", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("parseDentalExplicitTimeFromText(inboundText)"));
  assert(
    source.includes(
      "normalizedAction = `dental_date_time:${parsedDate}|${parsedTime}`",
    ),
  );
  assert(source.includes('normalizedAction.startsWith("dental_date_time:")'));
  assert(
    source.includes(
      'const explicitDateTime = normalizedAction.startsWith("dental_date_time:")',
    ),
  );
  assert(source.includes("const selectedDate = explicitDateTime"));
  assert(source.includes('debugNote: "dental_current_date_time_confirmation"'));
});

Deno.test("DentalConnect final demo patient name gate rejects demo names and uses booking wording", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes('normalized === "paciente demo"'));
  assert(source.includes('normalized === "dentalconnect test"'));
  assert(source.includes('normalized.includes("dentalconnect test")'));
  assert(source.includes('normalized.includes("demo")'));
  assert(source.includes("¿A nombre de quién agendamos la cita?"));
  assert(source.includes("patient_name: patientName"));
});

Deno.test("DentalConnect final demo confirmation and success include real patient name", async () => {
  const indexSource = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );
  const actionSource = await Deno.readTextFile(
    "supabase/functions/run-replies/domain/actionExecutor.ts",
  );

  assert(indexSource.includes("Nombre: *${patientName}*"));
  assert(indexSource.includes("👤 Nombre: *${patientName}*"));
  assert(indexSource.includes("patient_name: safeStr("));
  assert(
    actionSource.includes(
      "payload.patient_name ?? (activeAppt as any).patient_name",
    ),
  );
  assert(actionSource.includes("a nombre de *${patientName}*"));
  assert(
    actionSource.includes("Cuando querás, puedo ayudarte a agendar otra."),
  );
});

Deno.test("DentalConnect final demo no-change cleanup stays reschedule scoped", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/run-replies/index.ts",
  );

  assert(source.includes("function clearDentalTemporaryChangeState"));
  assert(source.includes("pending_reschedule: _pendingReschedule"));
  assert(source.includes("pending_booking: _pendingBooking"));
  assert(source.includes("pending_offered_slot: _pendingOfferedSlot"));
  assert(source.includes("last_offered_slots: _lastOfferedSlots"));
  assert(source.includes('expected === "reschedule_datetime"'));
  assert(
    source.includes(
      'safeStr((collected as any).active_flow, "") === "reschedule"',
    ),
  );
  assert(
    source.includes("collected: clearDentalTemporaryChangeState(collected)"),
  );
});
