import { normalizeText } from "./domain/normalization.ts";
import { detectIntent, IntentResult, isHighValueIntent, needsHumanHandoff, isContinuationResponse } from "./domain/intents.ts";

export type Stage = "INITIAL" | "DISCOVERY" | "QUALIFICATION" | "VALUE" | "TRIAL_OFFER" | "ACTIVATION" | "BOOKING" | "HANDOFF" | "CLOSED";

export type ConversationState = {
  stage?: Stage;
  lastIntent?: string;
  nextExpected?: string;
  collected?: Record<string, unknown>;
  orgType?: "creatyv" | "dental" | "generic";
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

export function runConversationEngine(args: {
  organizationId: string;
  leadId: string;
  leadState: ConversationState | null;
  inboundText: string;
  channel: string;
}): ConversationResult | null {
  const text = normalizeText(args.inboundText);
  if (!text) return null;

  const orgType = args.leadState?.orgType ?? determineOrgType(args.organizationId);
  const responses = getResponses(orgType);
  const state: ConversationState = args.leadState ?? { stage: "INITIAL", orgType, collected: {} };
  const collected = (state.collected ?? {}) as Record<string, unknown>;
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
        replyText: pickRandom(resp ?? responses.fallback),
        statePatch: { stage: "BOOKING", lastIntent: "book_appointment", nextExpected: "confirm_name" },
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
        replyText: pickRandom(responses.greeting),
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
      replyText: pickRandom(responses.greeting),
      statePatch: { stage: "DISCOVERY", lastIntent: "unknown", orgType },
      debug: { intent: "unknown", phase: "DISCOVERY", route: "fallback_greeting" },
    };
  }

  return {
    replyText: pickRandom(responses.fallback),
    statePatch: { lastIntent: "unknown" },
    debug: { intent: "unknown", phase: state.stage ?? "DISCOVERY", route: "fallback" },
  };
}