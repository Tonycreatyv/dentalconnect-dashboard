import { normalizeText } from "./domain/normalization.ts";
import { detectIntent, isHighValueIntent, needsHumanHandoff, isContinuationResponse } from "./domain/intents.ts";

export type Stage = "INITIAL" | "DISCOVERY" | "QUALIFICATION" | "VALUE" | "TRIAL_OFFER" | "ACTIVATION" | "BOOKING" | "BOOKED" | "HANDOFF" | "CLOSED";

export type ConversationState = {
  stage?: Stage;
  lastIntent?: string;
  nextExpected?: string;
  collected?: Record<string, unknown>;
  asked?: Record<string, boolean>;
  orgType?: "creatyv" | "dental" | "generic";
  name?: string | null;
  full_name?: string | null;
  collected_name?: boolean;
};

export type ConversationResult = {
  replyText: string;
  /** Patch to merge into lead state (index and tests use statePatch). */
  statePatch: Record<string, unknown>;
  debug: { intent: string; phase: string; route: string };
  toolAction?: { name: string; payload: Record<string, unknown> };
};

const RESPONSES = {
  creatyv: {
    greeting: ["¡Hola! 👋 Soy el asistente de Creatyv. Ayudamos a negocios a responder clientes automáticamente. ¿Qué tipo de negocio tienes?"],
    pricing: ["El precio depende del volumen. Lo mejor es que te muestre el sistema. ¿Agendamos 15 min?"],
    services: ["Creatyv responde mensajes 24/7, captura leads, agenda citas y envía recordatorios. ¿Qué te interesa más?"],
    demo: ["¡Perfecto! Te muestro cómo funciona. ¿Tienes 15 minutos esta semana?"],
    trial: ["¡Genial! El trial dura 7 días gratis. ¿Con qué canal quieres empezar?"],
    valueMoreAppointments: ["Para conseguir más citas, este sistema responde al instante y da seguimiento automático. ¿Quieres verlo?"],
    handoff: ["Te conecto con alguien del equipo. En breve te escriben."],
    fallback: ["Gracias por escribir. ¿En qué te puedo ayudar?"],
  },
  dental: {
    greeting: ["¡Hola! 👋 Bienvenido a la clínica. ¿En qué te puedo ayudar?"],
    pricing: ["Los precios varían según el tratamiento. ¿Te gustaría agendar una cita de valoración sin costo?"],
    services: ["Ofrecemos limpieza, blanqueamiento, ortodoncia, implantes y más. ¿Cuál te interesa?"],
    bookAppointment: ["¡Claro! ¿Qué día te funciona mejor? Tenemos disponibilidad de lunes a viernes."],
    hours: ["Nuestro horario es lunes a viernes 9am-6pm, sábados 9am-2pm. ¿Quieres agendar?"],
    location: ["Estamos en [DIRECCIÓN]. ¿Te envío la ubicación por Maps?"],
    emergency: ["⚠️ Para emergencias, llama directamente al [TELÉFONO]. ¿Es dolor fuerte?"],
    handoff: ["Te comunico con alguien del equipo. En breve te contactan."],
    fallback: ["Gracias por escribirnos. ¿Buscas agendar una cita?"],
  },
  generic: {
    greeting: ["¡Hola! 👋 ¿En qué te puedo ayudar?"],
    pricing: ["Para darte precios, ¿me cuentas qué servicio te interesa?"],
    services: ["Con gusto te cuento sobre nuestros servicios. ¿Algo específico?"],
    handoff: ["Te conecto con alguien del equipo."],
    fallback: ["Gracias por tu mensaje. ¿En qué te puedo ayudar?"],
  },
};

export const CX2_GREETING = RESPONSES.creatyv.greeting[0];

function safeStr(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function determineOrgType(orgId: string): "creatyv" | "dental" | "generic" {
  const id = orgId.toLowerCase();
  if (id.includes("creatyv") || id.includes("product")) return "creatyv";
  if (id.includes("dental") || id.includes("clinic")) return "dental";
  return "generic";
}

function getResponses(orgType: "creatyv" | "dental" | "generic") {
  return RESPONSES[orgType] ?? RESPONSES.generic;
}

function normalizeChannel(channel?: string | null) {
  const value = safeStr(channel, "").trim().toLowerCase();
  if (!value) return "messenger";
  if (value.includes("messenger")) return "messenger";
  if (value.includes("instagram")) return "instagram";
  if (value.includes("whatsapp")) return "whatsapp";
  if (value.includes("sms")) return "sms";
  if (value.includes("web")) return "web";
  return value;
}

function hasCollectedName(state: ConversationState) {
  const collectedName = safeStr(state.collected?.full_name, "").trim();
  const stateName = safeStr((state as any)?.name, "").trim();
  const leadName = safeStr((state as any)?.full_name, "").trim();
  const validCollected = collectedName && !collectedName.startsWith("Usuario ");
  const validState = stateName && !stateName.startsWith("Usuario ");
  const validLead = leadName && !leadName.startsWith("Usuario ");
  return Boolean(validCollected || validState || validLead);
}

function getCollectedName(state: ConversationState) {
  const collectedName = safeStr(state.collected?.full_name, "").trim();
  const stateName = safeStr((state as any)?.name, "").trim();
  const leadName = safeStr((state as any)?.full_name, "").trim();
  if (collectedName && !collectedName.startsWith("Usuario ")) return collectedName;
  if (leadName && !leadName.startsWith("Usuario ")) return leadName;
  if (stateName && !stateName.startsWith("Usuario ")) return stateName;
  return "";
}

function getFirstName(state: ConversationState) {
  const fullName = getCollectedName(state);
  return fullName ? fullName.split(/\s+/)[0] ?? "" : "";
}

const DENTAL_SERVICES: Record<string, string[]> = {
  "Limpieza dental": ["limpieza", "limpiesa", "profilaxis", "cleaning"],
  "Ortodoncia": ["ortodoncia", "brackets", "frenos", "braces"],
  "Blanqueamiento": ["blanqueamiento", "whitening", "blanqueo", "aclarar"],
  "Implantes": ["implante", "implantes", "implant"],
  "Extracción": ["extracción", "extraccion", "sacar muela", "muela", "extraction"],
  "Consulta general": ["consulta", "revisión", "revision", "chequeo", "checkup", "valoración"],
  "Endodoncia": ["endodoncia", "root canal", "nervio"],
  "Corona": ["corona", "crown"],
  "Caries": ["caries", "empaste", "relleno", "filling"],
};

function detectService(text: string): string | null {
  const lower = safeStr(text, "").toLowerCase();
  for (const [service, keywords] of Object.entries(DENTAL_SERVICES)) {
    if (keywords.some((keyword) => lower.includes(keyword))) return service;
  }
  return null;
}

function parseDateTimeFromMessage(text: string): { date: string; time: string } | null {
  const lower = safeStr(text, "").toLowerCase().trim();
  const now = new Date();
  const dayMap: Record<string, number> = {
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
    domingo: 0,
    hoy: -1,
    mañana: -2,
  };

  let targetDate: Date | null = null;
  for (const [dayName, dayNum] of Object.entries(dayMap)) {
    if (!lower.includes(dayName)) continue;
    if (dayNum === -1) {
      targetDate = new Date(now);
    } else if (dayNum === -2) {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 1);
    } else {
      targetDate = new Date(now);
      const currentDay = now.getDay();
      let daysUntil = dayNum - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      targetDate.setDate(targetDate.getDate() + daysUntil);
    }
    break;
  }

  if (!targetDate) return null;
  if (targetDate < now) {
    targetDate.setDate(targetDate.getDate() + 7);
  }

  const timeMatch = lower.match(/(\d{1,2})[:h]?(\d{2})?\s*(am|pm)?/);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2] ?? "0", 10);
  const ampm = timeMatch[3];

  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;
  if (!ampm && hours >= 1 && hours <= 7) hours += 12;

  const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const dateStr = targetDate.toISOString().slice(0, 10);
  return { date: dateStr, time: timeStr };
}

function formatBookingDate(dateValue: string, timeValue: string) {
  const isoCandidate = `${dateValue}T${timeValue}:00`;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.valueOf())) {
    return `${dateValue} a las ${timeValue}`;
  }
  return parsed.toLocaleDateString("es-HN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }) + `, ${parsed.toLocaleTimeString("es-HN", { hour: "numeric", minute: "2-digit", hour12: true })}`;
}

export function extractName(message: string): string | null {
  let cleaned = safeStr(message, "").trim();
  if (!cleaned) return null;

  cleaned = cleaned
    .replace(/^(hola|buenas|buenos dias|buen día|buenas tardes|buenas noches|hello|hi|hey)\s+/i, "")
    .replace(/^(me llamo|soy|mi nombre es|i'm|my name is|i am)\s+/i, "")
    .replace(/[.,!?]+$/g, "")
    .trim();

  const rejected = [
    "hola", "hols", "hol", "ola", "ols", "holaa", "holaaa",
    "buenas", "bueenas", "wenas", "wuenas", "guenas",
    "buenos dias", "buen dia", "buenas tardes", "buenas noches",
    "saludos", "buen día", "que tal", "q tal",
    "buenos", "como estas", "como andas", "hola buenas", "que hay",
    "hello", "hi", "hey", "good morning", "good afternoon", "sup", "yo",
    "si", "sí", "ok", "dale", "no", "gracias", "vale", "claro",
    "por favor", "porfa", "ya", "listo", "bueno", "okey", "okay",
    "bien", "mal", "mas o menos", "regular",
    "info", "información", "quiero", "necesito", "busco",
    "tengo", "pregunta", "ayuda", "help", "cita", "consulta",
    "limpieza", "precio", "precios", "horario", "horarios",
    "agendar", "reservar", "turno", "disponibilidad",
    "ortodoncia", "implante", "implantes", "blanqueamiento",
    "extracción", "extraccion", "corona", "endodoncia", "caries",
    "como funciona", "que hacen", "que ofrecen", "cuanto cuesta",
    "estan abiertos", "donde estan", "que servicios",
    "a", "e", "o", "u", "y", "x", "q",
  ];
  if (rejected.includes(cleaned.toLowerCase())) return null;
  if (cleaned.includes("?")) return null;
  if (cleaned.includes("¿")) return null;
  if (cleaned.split(/\s+/).length === 1 && cleaned.length < 3) return null;

  if (cleaned.length < 2 || cleaned.length > 50) return null;
  if (/\d{3,}/.test(cleaned)) return null;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return null;

  const validWords = words.every((word) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’-]+$/.test(word));
  if (!validWords) return null;

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function maybeHandleNameCapture(args: {
  organizationId: string;
  leadState: ConversationState | null;
  inboundText: string;
  channel?: string | null;
}): ConversationResult | null {
  const state: ConversationState = {
    stage: "INITIAL",
    collected: {},
    asked: {},
    ...(args.leadState ?? {}),
  };
  const asked = { ...(state.asked ?? {}) };
  const collected = { ...(state.collected ?? {}) };
  const channel = normalizeChannel(args.channel);
  const usesMetaProfile = channel === "messenger" || channel === "instagram";
  const metaProfileLookupAttempted = Boolean((state as any)?.meta_profile_lookup_attempted);

  if (hasCollectedName(state)) return null;
  if (usesMetaProfile && !metaProfileLookupAttempted) return null;

  if (!asked.full_name) {
    asked.full_name = true;
    return {
      replyText: "¡Hola! 👋 Bienvenido/a a nuestra clínica dental. ¿Cómo te llamas?",
      statePatch: {
        asked,
        nextExpected: "full_name",
        lastIntent: "ask_name",
      },
      debug: { intent: "ask_name", phase: state.stage ?? "DISCOVERY", route: "name_gate" },
    };
  }

  if (!state.collected_name) {
    const extractedName = extractName(args.inboundText);
    if (extractedName) {
      const firstName = extractedName.split(/\s+/)[0] ?? extractedName;
      return {
        replyText: `¡Mucho gusto, ${firstName}! 😊 ¿En qué te puedo ayudar?`,
        statePatch: {
          asked,
          collected: { ...collected, full_name: extractedName },
          full_name: extractedName,
          name: extractedName,
          collected_name: true,
          nextExpected: undefined,
          lastIntent: "provide_name",
        },
        debug: { intent: "provide_name", phase: state.stage ?? "DISCOVERY", route: "name_capture" },
      };
    }
    return {
      replyText: "No logré captar tu nombre 😅 ¿Me lo puedes repetir?",
      statePatch: {
        asked,
        nextExpected: "full_name",
        lastIntent: "ask_name_retry",
      },
      debug: { intent: "ask_name_retry", phase: state.stage ?? "DISCOVERY", route: "name_retry" },
    };
  }

  return null;
}

export function runConversationEngine(args: {
  organizationId: string;
  leadId?: string;
  leadState: ConversationState | null;
  inboundText: string;
  channel?: string;
  knowledge?: Record<string, unknown>;
  clinicKnowledge?: Record<string, unknown>;
  clinicSettings?: Record<string, unknown>;
}): ConversationResult | null {
  const text = normalizeText(args.inboundText);
  if (!text) return null;

  const orgType = args.leadState?.orgType ?? determineOrgType(args.organizationId);
  const responses = getResponses(orgType);
  const state: ConversationState = {
    stage: "INITIAL",
    orgType,
    collected: {},
    asked: {},
    ...(args.leadState ?? {}),
  };
  const collected = (state.collected ?? {}) as Record<string, unknown>;
  const nameCapture = maybeHandleNameCapture({
    organizationId: args.organizationId,
    leadState: state,
    inboundText: args.inboundText,
    channel: args.channel,
  });
  if (nameCapture) return nameCapture;

  const needsName = !hasCollectedName(state);
  const intent = detectIntent(text, { nextExpected: state.nextExpected });

  // P1: Handoff
  if (needsHumanHandoff(intent.intent)) {
    return {
      replyText: pickRandom(responses.handoff),
      statePatch: { stage: "HANDOFF", lastIntent: intent.intent },
      debug: { intent: intent.intent, phase: "HANDOFF", route: "priority_handoff" },
      toolAction: { name: "request_handoff", payload: {} },
    };
  }

  const isDentalBookingFlow = orgType === "dental" && (
    intent.intent === "book_appointment" ||
    state.stage === "BOOKING" ||
    state.nextExpected === "service" ||
    state.nextExpected === "date_time" ||
    state.nextExpected === "confirm_booking"
  );

  if (isDentalBookingFlow) {
    const bookingCollected = { ...collected };
    const firstName = getFirstName(state);
    const serviceFromMessage = detectService(args.inboundText);
    const llmService = safeStr(bookingCollected.service, "").trim();

    if (state.nextExpected === "confirm_booking") {
      const trimmed = text.trim();
      const isYes = /^(s[ií]|si|yes|ok|dale|claro|confirmo|perfecto|listo)\b/i.test(trimmed);
      const isNo = /^(no|cancel|cambiar|otra)\b/i.test(trimmed);

      if (isYes) {
        return {
          replyText: "__BOOK_APPOINTMENT__",
          statePatch: {
            stage: "BOOKED",
            lastIntent: "booking_confirmed",
            nextExpected: undefined,
            collected: { ...bookingCollected, confirmed: true },
          },
          toolAction: {
            name: "book_appointment",
            payload: {
              patient_name: bookingCollected.full_name || state.full_name || state.name || null,
              service: bookingCollected.service,
              reason: bookingCollected.service,
              title: bookingCollected.service || "Cita dental",
              appointment_date: bookingCollected.preferred_date,
              appointment_time: bookingCollected.preferred_time,
              channel: args.channel ?? "messenger",
            },
          },
          debug: { intent: "booking_confirmed", phase: "BOOKED", route: "confirmed" },
        };
      }

      if (isNo) {
        return {
          replyText: "Entendido, ¿prefieres otro día u hora?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "booking_reschedule",
            nextExpected: "date_time",
            collected: {
              ...bookingCollected,
              preferred_date: null,
              preferred_time: null,
              confirmed: false,
            },
          },
          debug: { intent: "booking_cancelled", phase: "BOOKING", route: "change_time" },
        };
      }

      return {
        replyText: "Solo necesito que me confirmes con Sí o No para reservarte ese espacio.",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "confirm_booking",
          collected: { ...bookingCollected },
        },
        debug: { intent: "booking_confirmed", phase: "BOOKING", route: "retry_confirm" },
      };
    }

    if (!llmService && serviceFromMessage) {
      bookingCollected.service = serviceFromMessage;
    } else if (llmService) {
      bookingCollected.service = llmService;
    }

    if (!bookingCollected.service) {
      return {
        replyText: hasCollectedName(state)
          ? `¡Claro, ${firstName}! ¿Qué servicio necesitas? Ofrecemos: limpieza, ortodoncia, blanqueamiento, implantes, extracciones y más.`
          : "¿Qué servicio necesitas? Ofrecemos: limpieza, ortodoncia, blanqueamiento, implantes, extracciones y más.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "service",
          collected: { ...bookingCollected },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "ask_service" },
      };
    }

    if (state.nextExpected === "service" && !serviceFromMessage) {
      bookingCollected.service = safeStr(args.inboundText, "").trim();
    }

    if (!bookingCollected.preferred_date || !bookingCollected.preferred_time) {
      const parsedDateTime = parseDateTimeFromMessage(args.inboundText);
      if (parsedDateTime) {
        bookingCollected.preferred_date = parsedDateTime.date;
        bookingCollected.preferred_time = parsedDateTime.time;
      } else {
        return {
          replyText: "__SHOW_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            collected: { ...bookingCollected },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "ask_datetime" },
        };
      }
    }

    if (state.nextExpected === "date_time" && (!bookingCollected.preferred_date || !bookingCollected.preferred_time)) {
      return {
        replyText: "No entendí la fecha u hora. ¿Podrías decirme qué día y hora prefieres? Por ejemplo: martes a las 10:00.",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "date_time",
          collected: { ...bookingCollected },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "retry_datetime" },
      };
    }

    if (!bookingCollected.confirmed) {
      const address = safeStr(args.clinicSettings?.address, "").trim();
      const phone = safeStr(args.clinicSettings?.phone, "").trim();
      const summaryLines = [
        "Te confirmo tu cita:",
        `🦷 ${safeStr(bookingCollected.service, "Servicio dental")}`,
        `📅 ${formatBookingDate(safeStr(bookingCollected.preferred_date, ""), safeStr(bookingCollected.preferred_time, ""))}`,
      ];
      if (address) summaryLines.push(`📍 ${address}`);
      if (phone) summaryLines.push(`📞 ${phone}`);
      summaryLines.push("¿Confirmo la cita? (Sí / No)");

      return {
        replyText: summaryLines.join("\n"),
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "confirm_booking",
          collected: { ...bookingCollected },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "confirm" },
      };
    }
  }

  // P2: High value (pricing, services, booking)
  if (isHighValueIntent(intent.intent)) {
    if (intent.intent === "pricing") {
      return {
        replyText: pickRandom(responses.pricing),
        statePatch: { stage: "VALUE", lastIntent: "pricing", nextExpected: "demo_interest" },
        debug: { intent: "pricing", phase: "VALUE", route: "high_value" },
      };
    }
    if (intent.intent === "services") {
      return {
        replyText: pickRandom(responses.services),
        statePatch: { stage: "DISCOVERY", lastIntent: "services" },
        debug: { intent: "services", phase: "DISCOVERY", route: "high_value" },
      };
    }
    if (intent.intent === "book_appointment") {
      const resp = orgType === "dental" ? responses.bookAppointment : responses.demo;
      return {
        replyText: needsName
          ? "¡Claro! Antes de agendar, ¿me compartes tu nombre completo?"
          : pickRandom(resp ?? responses.fallback),
        statePatch: { stage: "BOOKING", lastIntent: "book_appointment", nextExpected: "service" },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "booking" },
      };
    }
    if (intent.intent === "demo_interest" || intent.intent === "trial_interest") {
      const resp = intent.intent === "demo_interest" ? responses.demo : responses.trial;
      return {
        replyText: pickRandom(resp ?? responses.fallback),
        statePatch: { stage: "TRIAL_OFFER", lastIntent: intent.intent },
        debug: { intent: intent.intent, phase: "TRIAL_OFFER", route: "high_value" },
        toolAction: { name: "schedule_demo", payload: {} },
      };
    }
  }

  // P3: Continuation (si hay nextExpected y usuario confirma)
  if (state.nextExpected && isContinuationResponse(intent.intent)) {
    if (intent.intent === "confirmation") {
      const resp = responses.demo ?? responses.fallback;
      return {
        replyText: pickRandom(resp),
        statePatch: { stage: "TRIAL_OFFER", lastIntent: "confirmation", collected: { ...collected, confirmed: true } },
        debug: { intent: "confirmation", phase: "TRIAL_OFFER", route: "continuation" },
      };
    }
    if (intent.intent === "denial") {
      return {
        replyText: "Entendido. Si cambias de opinión, aquí estoy. 👋",
        statePatch: { lastIntent: "denial" },
        debug: { intent: "denial", phase: state.stage ?? "DISCOVERY", route: "soft_close" },
      };
    }
  }

  // P4: Other intents
  if (intent.intent === "greeting") {
    if (state.stage === "INITIAL" || !state.lastIntent) {
      return {
        replyText: needsName
          ? "¡Hola! 👋 Bienvenido a la clínica. Antes de ayudarte, ¿me compartes tu nombre completo?"
          : pickRandom(responses.greeting),
        statePatch: { stage: "DISCOVERY", lastIntent: "greeting", nextExpected: orgType === "dental" ? undefined : "business_type", orgType },
        debug: { intent: "greeting", phase: "DISCOVERY", route: "initial" },
      };
    }
    return {
      replyText: "¿En qué más te puedo ayudar?",
      statePatch: { lastIntent: "greeting" },
      debug: { intent: "greeting", phase: state.stage ?? "DISCOVERY", route: "skip_repeat" },
    };
  }

  if (intent.intent === "hours" && responses.hours) {
    return {
      replyText: pickRandom(responses.hours),
      statePatch: { lastIntent: "hours" },
      debug: { intent: "hours", phase: state.stage ?? "DISCOVERY", route: "info" },
    };
  }

  if (intent.intent === "location" && responses.location) {
    return {
      replyText: pickRandom(responses.location),
      statePatch: { lastIntent: "location" },
      debug: { intent: "location", phase: state.stage ?? "DISCOVERY", route: "info" },
    };
  }

  if (intent.intent === "emergency" && responses.emergency) {
    return {
      replyText: pickRandom(responses.emergency),
      statePatch: { lastIntent: "emergency" },
      debug: { intent: "emergency", phase: "HANDOFF", route: "urgent" },
    };
  }

  if (intent.intent === "gratitude") {
    return {
      replyText: "¡Gracias a ti! 😊",
      statePatch: { lastIntent: "gratitude" },
      debug: { intent: "gratitude", phase: state.stage ?? "DISCOVERY", route: "closing" },
    };
  }

  // Fallback
  if (state.stage === "INITIAL") {
    return {
      replyText: needsName
        ? "¡Hola! 👋 Gracias por escribirnos. Para ayudarte mejor, ¿me compartes tu nombre completo?"
        : pickRandom(responses.greeting),
      statePatch: { stage: "DISCOVERY", lastIntent: "unknown", orgType, nextExpected: needsName ? "confirm_name" : undefined },
      debug: { intent: "unknown", phase: "DISCOVERY", route: "fallback_greeting" },
    };
  }

  return {
    replyText: needsName
      ? "Con gusto te ayudo. Antes de continuar, ¿me compartes tu nombre completo?"
      : pickRandom(responses.fallback),
    statePatch: { lastIntent: "unknown", nextExpected: needsName ? "confirm_name" : state.nextExpected },
    debug: { intent: "unknown", phase: state.stage ?? "DISCOVERY", route: "fallback" },
  };
}
