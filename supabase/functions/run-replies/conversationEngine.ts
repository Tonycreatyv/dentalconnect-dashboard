import { normalizeText } from "./domain/normalization.ts";
import {
  detectIntent,
  isContinuationResponse,
  isContinuationText,
  isHighValueIntent,
  needsHumanHandoff,
} from "./domain/intents.ts";
import {
  hasServiceLikeSignal,
  isLikelyBookingRequest,
  resolveDentalServiceInfo,
  toPatientFacingServiceLabel,
} from "./domain/serviceInfoHandler.ts";
import {
  clearActiveBookingState,
  isPendingOfferedSlotFresh,
} from "./domain/bookingStateHygiene.ts";
import { classifyDentalPatientMessage } from "./domain/dental/dentalTriage.ts";
import { classifyDentalDeterministic } from "./domain/dental/dentalDeterministicClassifier.ts";
import type { DentalInterpreterResult } from "./domain/interpreter/dentalInterpreterTypes.ts";
import {
  detectBarbershopService,
  resolveBarbershopPrice,
  getBarbershopServiceById,
} from "./domain/barbershop/index.ts";
import {
  orchestrateConversationTurn,
  type ConversationContext,
} from "./domain/conversationOrchestrator.ts";
import {
  buildInfoContextCollected,
  getPendingActionFromBarbershopCollected,
} from "./domain/coreConversationContract.ts";
import { canExecuteBookingConfirmation } from "./domain/stateGuards.ts";
import { classifyBarbershopIntent } from "./domain/barbershopIntentRouter.ts";
import {
  extractBarbershopBookingContext,
  extractBarbershopInfoContext,
} from "./domain/barbershopState.ts";
import { composeBarbershopNaturalFallback } from "./domain/barbershopResponseComposer.ts";
import {
  getBarbershopInterpreterRuntimeStatus,
  type BarbershopInterpretedTurn,
} from "./domain/barbershopInterpreter.ts";
import {
  mergeConversationContext,
  normalizeInboundRuntime,
} from "./domain/conversationRuntime.ts";
import {
  calculateInsuranceScoring,
  interpretInsuranceTurn,
  type InsuranceCollected,
} from "./domain/insurance/insuranceInterpreter.ts";
import {
  buildInsuranceBudgetButtons,
  buildInsuranceCurrentCoverageButtons,
  buildInsurancePreferredTimeButtons,
  buildInsuranceTypeList,
  composeInsuranceBudgetPrompt,
  composeInsuranceConfirmation,
  composeInsuranceContactPrompt,
  composeInsuranceCurrentCoveragePrompt,
  composeInsuranceEmailPrompt,
  composeInsuranceLocationPrompt,
  composeInsurancePreferredTimePrompt,
  composeInsuranceTypePrompt,
  getInsuranceServiceOptions,
} from "./domain/insurance/insuranceResponseComposer.ts";
import type {
  InteractiveButton,
  WhatsAppInteractiveListSpec,
} from "../_shared/metaMessageAdapter.ts";

export type Stage =
  | "INITIAL"
  | "DISCOVERY"
  | "SERVICE_INFO"
  | "QUALIFICATION"
  | "VALUE"
  | "TRIAL_OFFER"
  | "ACTIVATION"
  | "BOOKING"
  | "CONFIRMING"
  | "BOOKED"
  | "HANDOFF"
  | "CLOSED";

export type ConversationState = {
  stage?: Stage;
  lastIntent?: string;
  nextExpected?: string;
  collected?: Record<string, unknown>;
  asked?: Record<string, boolean>;
  orgType?: "creatyv" | "dental" | "barbershop" | "insurance" | "generic";
  name?: string | null;
  full_name?: string | null;
  collected_name?: boolean;
};

export type ConversationResult = {
  replyText: string;
  /** Patch to merge into lead state (index and tests use statePatch). */
  statePatch: Record<string, unknown>;
  interactiveButtons?: InteractiveButton[];
  interactiveList?: WhatsAppInteractiveListSpec;
  debug: {
    intent: string;
    phase: string;
    route: string;
    barbershop_interpreter?: {
      mode: "shadow" | "runtime";
      intent: string;
      confidence: number;
      entities: Record<string, unknown>;
      needs_tool: string;
      user_facing_summary: string;
    };
  };
  toolAction?: { name: string; payload: Record<string, unknown> };
};

const RESPONSES = {
  creatyv: {
    greeting: [
      "¡Hola! 👋 Soy el asistente de Creatyv. Ayudamos a negocios a responder clientes automáticamente. ¿Qué tipo de negocio tienes?",
    ],
    pricing: [
      "El precio depende del volumen. Lo mejor es que te muestre el sistema. ¿Agendamos 15 min?",
    ],
    services: [
      "Creatyv responde mensajes 24/7, captura leads, agenda citas y envía recordatorios. ¿Qué te interesa más?",
    ],
    demo: [
      "¡Perfecto! Te muestro cómo funciona. ¿Tienes 15 minutos esta semana?",
    ],
    trial: [
      "¡Genial! El trial dura 7 días gratis. ¿Con qué canal quieres empezar?",
    ],
    valueMoreAppointments: [
      "Para conseguir más citas, este sistema responde al instante y da seguimiento automático. ¿Quieres verlo?",
    ],
    handoff: ["Te conecto con alguien del equipo. En breve te escriben."],
    fallback: ["Gracias por escribir. ¿En qué te puedo ayudar?"],
  },
  dental: {
    greeting: ["¡Hola! 👋 Bienvenido a la clínica. ¿En qué te puedo ayudar?"],
    pricing: [
      "Los precios varían según el tratamiento. ¿Querés que te ayude a agendar una revisión dental?",
    ],
    services: [
      "Claro 😊 Podemos ayudarte con:\n\n• Limpieza dental\n• Dolor o molestia\n• Blanqueamiento\n• Ortodoncia\n• Revisión dental\n\n¿Cuál te interesa?",
    ],
    bookAppointment: [
      "Claro. ¿La cita sería para revisión general, limpieza, dolor/molestia, ortodoncia o algún otro servicio?",
    ],
    hours: [
      "Nuestro horario es lunes a viernes 9am-6pm, sábados 9am-2pm. ¿Quieres agendar?",
    ],
    location: ["Estamos en [DIRECCIÓN]. ¿Te envío la ubicación por Maps?"],
    emergency: [
      "Entiendo, si te duele mucho es importante revisarlo lo antes posible 🙏\n\nPuedo ayudarte a agendar una cita prioritaria.\n\n¿Te queda bien hoy o mañana temprano?",
    ],
    handoff: ["Te comunico con alguien del equipo. En breve te contactan."],
    fallback: ["Gracias por escribirnos. ¿Buscas agendar una cita?"],
  },
  barbershop: {
    greeting: ["¡Hola! Te ayudo con tu cita. ¿Querés corte, barba o corte + barba?"],
    pricing: ["Decime el servicio y te comparto precio y duración."],
    services: ["Claro. ¿Querés Corte de pelo, barba, corte + barba o cejas?"],
    bookAppointment: ["Perfecto. ¿Qué día u hora te queda mejor?"],
    hours: ["¿Querés que revisemos disponibilidad por día y hora?"],
    location: ["Te comparto la ubicación de la barbería por aquí."],
    emergency: ["Si querés, te ayudo a buscar el primer horario disponible."],
    handoff: ["Te comunico con recepción en un momento."],
    fallback: ["¿Querés que te ayude con corte, barba o una cita?"],
  },
  insurance: {
    greeting: ["Hola. Te ayudo con tu seguro. ¿En qué te puedo ayudar?"],
    pricing: ["Te ayudo a revisar opciones de seguro."],
    services: ["Decime qué tipo de seguro necesitás."],
    handoff: ["Te conecto con alguien del equipo."],
    fallback: ["Gracias por escribir. ¿Buscás cotizar un seguro?"],
  },
  generic: {
    greeting: ["¡Hola! 👋 ¿En qué te puedo ayudar?"],
    pricing: ["Para darte precios, ¿me cuentas qué servicio te interesa?"],
    services: [
      "Con gusto te cuento sobre nuestros servicios. ¿Algo específico?",
    ],
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

function isEnabledFlag(value: unknown): boolean {
  const text = safeStr(value, "").trim().toLowerCase();
  if (!text) return false;
  return text === "true" || text === "1" || text === "yes" || text === "on";
}

function getClinicDisplayName(clinicSettings?: Record<string, unknown>): string {
  return safeStr(
    clinicSettings?.clinic_name,
    safeStr(clinicSettings?.business_name, safeStr(clinicSettings?.name, "")),
  ).trim();
}

function buildDentalGreeting(clinicSettings?: Record<string, unknown>): string {
  const clinicName = getClinicDisplayName(clinicSettings);
  if (clinicName) return `¡Hola! 👋 Bienvenido a ${clinicName}. ¿En qué te puedo ayudar?`;
  return "¡Hola! 👋 Bienvenido a la clínica. ¿En qué te puedo ayudar?";
}

function toDisplayPersonName(rawName: string): string {
  const name = safeStr(rawName, "").trim();
  if (!name) return "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function resolveAppointmentPatientName(
  bookingCollected: Record<string, unknown>,
  state: ConversationState,
): string | null {
  const relation = safeStr(bookingCollected.appointment_for_relation, "").trim().toLowerCase();
  const collectedPatient = toDisplayPersonName(safeStr(bookingCollected.patient_name, ""));
  const leadPerson = toDisplayPersonName(
    safeStr(bookingCollected.full_name, safeStr(state.full_name, safeStr(state.name, ""))),
  );
  if (relation && relation !== "self" && collectedPatient) return collectedPatient;
  return collectedPatient || leadPerson || null;
}

function normalizeTextForIntent(input: string): string {
  return normalizeText(input)
    .replace(/([a-z])\1{2,}/g, "$1")
    .replace(/([aeiou])\1+/g, "$1")
    .replace(/\bqquiero\b/g, "quiero")
    .replace(/\bq\b/g, "que")
    .replace(/\bk\b/g, "que")
    .replace(/\bke\b/g, "que")
    .replace(/\bqie\b/g, "que")
    .replace(/\bsita\b/g, "cita")
    .replace(/\bque cita teng\b/g, "que cita tengo")
    .replace(/\bq cita teng\b/g, "que cita tengo")
    .replace(/\bke cita teng\b/g, "que cita tengo")
    .replace(/\bteagenda\b/g, "reagenda")
    .replace(/\bte agenda\b/g, "reagenda")
    .replace(/\breagendala\b/g, "reagendarla")
    .replace(/\bre[\s-]+agenda\b/g, "reagenda")
    .replace(/\bre[\s-]+agendar\b/g, "reagendar")
    .replace(/\breagendame\b/g, "reagendar")
    .replace(/\breagendarla\b/g, "reagendar")
    .replace(/\bcambiamela\b/g, "cambiar")
    .replace(/\bmovemela\b/g, "mover")
    .replace(/\bpasarla\b/g, "pasar")
    .replace(/\bpasame la cita\b/g, "pasar mi cita")
    .replace(/\bcambiarla\b/g, "cambiar")
    .replace(/\bmoverla\b/g, "mover")
    .replace(/\bsita\b/g, "cita")
    .replace(/\brevicion\b/g, "revision")
    .replace(/\bbraket?s?\b/g, "brackets")
    .replace(/\b(meanana|menana|maniana|mañan)\b/g, "manana")
    .replace(/\b(manaan|manaana|manana|mañana)\b/g, "manana")
    .replace(/\bmanan?a?\b/g, "manana")
    .replace(/\bcore\b/g, "corte")
    .replace(/\bccorte\b/g, "corte")
    .replace(/\bcort\s+d\s+pelo\b/g, "corte de pelo")
    .replace(/\bcorte\s+d\s+pelo\b/g, "corte de pelo")
    .replace(/\b(ncelar|ncelarlo|ncelarla|cncelar|cncelarla|canselar|canselarla|cancalar|cancelr)\b/g, "cancelar")
    .replace(/\bcambair\b/g, "cambiar")
    .replace(/\bhpy\b/g, "hoy")
    .replace(/\bpar\b/g, "para")
    .replace(/\bvierrnes\b/g, "viernes")
    .replace(/\bvierness\b/g, "viernes")
    .replace(/\bsabdo\b/g, "sabado")
    .replace(/\bmierciles\b/g, "miercoles")
    .replace(/\borarios\b/g, "horarios")
    .replace(/\bdkas\b/g, "dias")
    .replace(/\btenes\b/g, "tienes")
    .replace(/\bdispnible\b/g, "disponible")
    .replace(/\bdisponivle\b/g, "disponible")
    .replace(/\bestsa\b/g, "esta")
    .replace(/\s+/g, " ")
    .trim();
}

function isAffirmativeShortText(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  return /^(si|s[ií]|ok|dale|me funciona|esta bien|confirmar|claro)$/.test(text);
}

function isAnyBarberPreferenceText(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  return /\b(cualquiera|cualqueira|cualqiera|cualquier|el que este disponible|el que este libre|el que esté disponible|el que esté libre|quien este libre|quien esté libre|no importa|sin preferencia)\b/.test(text);
}

function isBarbershopAvailabilityLikeText(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  const hasAvailabilitySignal =
    /\b(cupo|cuppo|chance|espacio|disponible|disponibilidad|horario|horarios|hora|horas)\b/.test(text);
  const hasAskingVerb = /\b(tenes|tens|tienes|hay)\b/.test(text);
  return hasAvailabilitySignal && hasAskingVerb;
}

function isAnyProviderAlias(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  return /\b(cualquiera|cualqueira)\b/.test(text);
}

function isBarbershopAvailabilityInterruptionText(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  return /\b(que horas tenes|que horarios tenes|que horas hay|dime horarios|para la otra semana|otra hora|otro dia|mas horarios|ver mas|que disponibilidad hay|horarios|disponibilidad)\b/i
    .test(text);
}

function isVagueTimePreferenceText(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  return /^(tarde|manana|en la tarde|mas tarde|mas temprano)$/.test(text);
}

function isKeepPreviousSlotText(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  return /\bmantener\b/.test(text);
}

function isAgendaLinkRequestText(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  return /\b(pasame el link|pasame link|mandame el link|mandame link|pasame calendario|quiero ver agenda|mejor veo horarios|ver agenda completa|agenda completa|calendario)\b/.test(text);
}

function isSameBarberReferenceText(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  return /\b(con el mismo|con el de antes|igual que la anterior)\b/.test(text);
}

function isFreshPendingConfirmation(args: {
  inboundMessageId: string;
  inboundMessageCreatedAt: string;
  pendingCreatedFromInboundMessageId: string;
  pendingPreconfirmSentAt: string;
}): { fresh: boolean; blocked: boolean; reason: string } {
  const inboundId = safeStr(args.inboundMessageId, "").trim();
  const inboundAt = safeStr(args.inboundMessageCreatedAt, "").trim();
  const pendingInboundId = safeStr(args.pendingCreatedFromInboundMessageId, "").trim();
  const pendingAt = safeStr(args.pendingPreconfirmSentAt, "").trim();

  if (inboundId && pendingInboundId && inboundId === pendingInboundId) {
    return { fresh: false, blocked: true, reason: "same_inbound_id_as_preconfirm" };
  }
  if (inboundAt && pendingAt) {
    const inboundTs = Date.parse(inboundAt);
    const pendingTs = Date.parse(pendingAt);
    if (Number.isFinite(inboundTs) && Number.isFinite(pendingTs) && inboundTs <= pendingTs) {
      return { fresh: false, blocked: true, reason: "inbound_not_newer_than_preconfirm" };
    }
    return { fresh: true, blocked: false, reason: "newer_than_preconfirm" };
  }
  return { fresh: true, blocked: false, reason: "no_temporal_metadata" };
}

function isBarbershopGenericBookingRequestText(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  return /\b(una cita|quiero una cita|quiero agendar|agendar cita|agendar una cita|necesito cita|ocupo cita|quiero reservar|reservar cita|reservar una cita)\b/.test(text);
}

function isBarbershopProductQuestionText(input: string): boolean {
  const text = normalizeTextForIntent(input);
  if (/\b(pomada|gel|shampoo|acondicionador|aceite|aftershave|kit|kits)\b/.test(text)) return true;
  if (/\b(producto|productos)\b/.test(text)) return true;
  if (/\b(producto para barba|cuidado de barba|beard care)\b/.test(text)) return true;
  return false;
}

function extractBarbershopProductTopic(input: string): string | null {
  const text = normalizeTextForIntent(input);
  if (/\bpomada\b/.test(text)) return "pomadas";
  if (/\bgel\b/.test(text)) return "gel";
  if (/\bshampoo\b/.test(text)) return "shampoo";
  if (/\bacondicionador\b/.test(text)) return "acondicionador";
  if (/\b(barba|beard)\b/.test(text)) return "beard care";
  if (/\baceite\b/.test(text)) return "aceites";
  if (/\bkit\b/.test(text)) return "kits";
  if (/\baftershave\b/.test(text)) return "aftershave";
  return null;
}

function resolveBarbershopServiceFromSettings(
  input: string,
  clinicSettings?: Record<string, unknown>,
): { key: string; name: string; durationMin: number; price?: number; preferredBarber: string | null } | null {
  const detected = detectBarbershopService(input);
  const configuredServices = Array.isArray((clinicSettings ?? {}).services)
    ? ((clinicSettings ?? {}).services as Array<Record<string, unknown>>)
    : [];
  const legacyConfigured = Array.isArray((clinicSettings ?? {}).barber_services)
    ? ((clinicSettings ?? {}).barber_services as Array<Record<string, unknown>>)
    : [];
  const configured = configuredServices.length > 0 ? configuredServices : legacyConfigured;
  if (configured.length === 0 && !detected.matchedService) return null;
  const normalizedInput = normalizeTextForIntent(input);
  const preferredBarber = detected.preferredBarber;
  const candidates = configured.filter((row) => row?.is_active !== false && row?.active !== false);
  const toServiceKey = (row: Record<string, unknown>, fallbackName: string) =>
    safeStr(row?.key, safeStr(row?.service_key, safeStr(row?.id, fallbackName))).trim();
  const toServiceResult = (row: Record<string, unknown>, name: string) => {
    const durationMin = Number(row?.duration_min ?? row?.durationMinutes);
    const price = Number(row?.price_from ?? row?.price ?? row?.amount ?? row?.price_hnl ?? row?.base_price_hnl);
    return {
      key: toServiceKey(row, name) || name,
      name,
      durationMin: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 45,
      price: Number.isFinite(price) ? price : undefined,
      preferredBarber,
    };
  };
  if (candidates.length > 0) {
    for (const row of candidates) {
      const name = safeStr(row?.name, "").trim();
      if (!name) continue;
      const key = normalizeTextForIntent(toServiceKey(row, name)).replace(/_/g, " ");
      const aliases = Array.isArray(row?.aliases)
        ? (row.aliases as unknown[]).map((a) => normalizeTextForIntent(safeStr(a, "")))
        : [];
      const normalizedName = normalizeTextForIntent(name);
      if (
        normalizedInput.includes(normalizedName) ||
        (key && normalizedInput.includes(key)) ||
        aliases.some((a) => a && normalizedInput.includes(a))
      ) {
        return toServiceResult(row, name);
      }
    }
    const wantsCorteBarba = /\b(corte y barba|corte con barba|corte \+ barba|barba y corte)\b/.test(normalizedInput);
    const wantsCorteLimpieza = /\b(corte y limpieza|corte con limpieza|corte \+ limpieza)\b/.test(normalizedInput);
    const wantsLimpieza = /\b(limpieza facial|facial|limpieza)\b/.test(normalizedInput);
    const wantsCorte = /\b(corte|pelo|cabello|cortarme)\b/.test(normalizedInput);
    const score = (row: Record<string, unknown>) => {
      const name = normalizeTextForIntent(safeStr(row?.name, ""));
      const key = normalizeTextForIntent(toServiceKey(row, name)).replace(/_/g, " ");
      const haystack = `${name} ${key}`;
      if (wantsCorteBarba && haystack.includes("corte") && haystack.includes("barba")) return 100;
      if (wantsCorteLimpieza && haystack.includes("corte") && haystack.includes("limpieza")) return 95;
      if (wantsLimpieza && haystack.includes("limpieza")) return haystack.includes("corte") ? 60 : 90;
      if (wantsCorte && haystack.includes("corte")) {
        if (!haystack.includes("barba") && !haystack.includes("limpieza")) return 85;
        return 50;
      }
      if (/\bbarba\b/.test(normalizedInput) && haystack.includes("barba")) return 80;
      return 0;
    };
    const scored = candidates
      .map((row) => ({ row, score: score(row) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored[0]) {
      const name = safeStr(scored[0].row?.name, "").trim();
      if (name) return toServiceResult(scored[0].row, name);
    }
  }
  if (!detected.matchedService) return null;
  return {
    key: detected.matchedService.id,
    name: detected.matchedService.name,
    durationMin: detected.matchedService.durationMinutes,
    price: detected.matchedService.basePriceHnl,
    preferredBarber,
  };
}

function getBarbershopServicesFromSettings(
  clinicSettings?: Record<string, unknown>,
): Array<{ id: string; key: string; name: string; durationMin: number; price?: number }> {
  const raw = Array.isArray((clinicSettings ?? {}).services)
    ? ((clinicSettings ?? {}).services as Array<Record<string, unknown>>)
    : [];
  if (!raw.length) return [];
  return raw
    .filter((row) => row?.is_active !== false && row?.active !== false)
    .map((row) => {
      const name = safeStr(row?.name, "").trim();
      const id = safeStr(row?.id, safeStr(row?.key, name)).trim();
      const key = safeStr(row?.key, safeStr(row?.service_key, id || name)).trim();
      const durationMin = Number(row?.duration_min ?? row?.durationMinutes);
      const priceNum = Number(row?.price_from ?? row?.price ?? row?.amount ?? row?.price_hnl ?? row?.base_price_hnl);
      return {
        id: id || key || name,
        key: key || id || name,
        name,
        durationMin: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 45,
        price: Number.isFinite(priceNum) ? priceNum : undefined,
      };
    })
    .filter((row) => row.name);
}

function getBarbershopProvidersFromSettings(
  clinicSettings?: Record<string, unknown>,
): Array<{ id: string; name: string }> {
  const raw = Array.isArray((clinicSettings ?? {}).providers)
    ? ((clinicSettings ?? {}).providers as Array<Record<string, unknown>>)
    : (Array.isArray((clinicSettings ?? {}).barbers)
      ? ((clinicSettings ?? {}).barbers as Array<Record<string, unknown>>)
      : []);
  return raw
    .filter((row) => row?.active !== false && row?.is_active !== false)
    .map((row) => ({
      id: safeStr(row?.id, safeStr(row?.barber_id, safeStr(row?.name, ""))).trim(),
      name: safeStr(row?.name, "").trim(),
    }))
    .filter((row) => row.id && row.name);
}

function findBarbershopFaqAnswer(
  inboundText: string,
  clinicSettings?: Record<string, unknown>,
): string | null {
  const normalized = normalizeTextForIntent(inboundText);
  const faqs = Array.isArray((clinicSettings ?? {}).faqs)
    ? ((clinicSettings ?? {}).faqs as Array<Record<string, unknown>>)
    : [];
  if (!faqs.length) return null;
  const walkInSignal = /\b(sin cita|walk ?ins?|walkins?|por llegada|por orden de llegada|atienden sin cita)\b/.test(normalized);
  if (walkInSignal) {
    const walkFaq = faqs.find((faq) => {
      const q = normalizeTextForIntent(safeStr(faq?.q, safeStr(faq?.question, "")));
      return /\b(sin cita|walk ?ins?|walkins?|por llegada|por cita o llegada)\b/.test(q);
    });
    const answer = safeStr(walkFaq?.a, safeStr(walkFaq?.answer, "")).trim();
    if (answer) return answer;
  }
  const generalFaq = faqs.find((faq) => {
    const q = normalizeTextForIntent(safeStr(faq?.q, safeStr(faq?.question, "")));
    return q && (normalized.includes(q) || q.includes(normalized));
  });
  const answer = safeStr(generalFaq?.a, safeStr(generalFaq?.answer, "")).trim();
  return answer || null;
}

function isBarbershopServicesQuestion(input: string): boolean {
  const t = normalizeTextForIntent(input);
  return /\b(que servicios|qué servicios|que ofrecen|qué ofrecen|servicios tienen|menu de servicios)\b/.test(t);
}

function isBarbershopChooseBarberQuestion(input: string): boolean {
  const t = normalizeTextForIntent(input);
  const asksChoice = /\b(puedo escoger barbero|puedo elegir barbero|se puede escoger barbero|puedo elegir con quien|esta bryan|esta alex|esta carlos|esta luis)\b/.test(t);
  const hasDateOrTime = /\b(hoy|manana|mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|a las \d{1,2}|\d{1,2}:\d{2})\b/.test(t);
  return asksChoice && !hasDateOrTime;
}

function buildBarbershopProductsReply(
  input: string,
  clinicSettings?: Record<string, unknown>,
): string {
  const products = Array.isArray((clinicSettings ?? {}).barber_products)
    ? ((clinicSettings ?? {}).barber_products as Array<Record<string, unknown>>).filter((p) => p?.is_active !== false)
    : [];
  if (products.length === 0) {
    return "Todavía no tengo productos cargados para esta barbería, pero puedo ayudarte con una cita.";
  }
  const topic = extractBarbershopProductTopic(input);
  const normalizedTopic = topic ? normalizeTextForIntent(topic) : "";
  const matches = products.filter((p) => {
    if (!topic) return true;
    const name = normalizeTextForIntent(safeStr(p?.name, ""));
    const category = normalizeTextForIntent(safeStr(p?.category, ""));
    const desc = normalizeTextForIntent(safeStr(p?.description, ""));
    return name.includes(normalizedTopic) || category.includes(normalizedTopic) || desc.includes(normalizedTopic);
  });
  if (matches.length === 0) {
    return "No veo productos cargados para esa categoría en este momento, pero puedo ayudarte con una cita.";
  }
  const top = matches.slice(0, 3);
  const lines = top.map((p) => {
    const name = safeStr(p?.name, "Producto");
    const priceNum = Number(p?.price);
    const priceText = Number.isFinite(priceNum) ? `HNL ${priceNum}` : "precio en tienda";
    return `• ${name}: ${priceText}`;
  });
  return `Claro, estos son algunos productos disponibles:\n${lines.join("\n")}`;
}

function isBarbershopHaircutIntentText(input: string): boolean {
  const text = normalizeTextForIntent(input)
    .replace(/\bquiro\b/g, "quiero")
    .replace(/\bcotarme\b/g, "cortarme")
    .trim();
  return /\b(quiero cortarme el pelo|me quiero cortar|corte de cabello|quiero corte|cortarme el pelo|core de pelo|cote de pelo|el pelo nada mas|el pelo nada más|pelo nada mas|pelo nada más)\b/.test(text);
}

function isGenericGroomingExpression(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  return /\b(quedar nitido|dejarme muneco|dejarme muñeco|quedar fresh)\b/.test(text);
}

function getLocalNowInTimezone(timezone: string): Date {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
  return Number.isNaN(d.valueOf()) ? new Date() : d;
}

function toDateTimeFromParts(dateIso: string, time24: string): Date | null {
  const m = safeStr(time24, "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.valueOf())) return null;
  d.setHours(hh, mm, 0, 0);
  return d;
}

function isBarbershopSlotInPast(dateIso: string, time24: string, timezone: string): boolean {
  const nowLocal = getLocalNowInTimezone(timezone);
  const target = toDateTimeFromParts(dateIso, time24);
  if (!target) return false;
  return target.getTime() <= nowLocal.getTime();
}

function isWithinClinicHours(
  dateIso: string,
  time24: string,
  clinicSettings?: Record<string, unknown>,
): boolean {
  const hours = (clinicSettings?.hours ?? null) as Record<string, unknown> | null;
  if (!hours || typeof hours !== "object") return true;
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.valueOf())) return true;
  const keyMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const cfg = (hours[keyMap[d.getDay()]] ?? null) as Record<string, unknown> | null;
  if (!cfg) return true;
  if (cfg.closed === true) return false;
  const toMin = (v: string) => {
    const m = v.match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const openMin = toMin(safeStr(cfg.open, ""));
  const closeMin = toMin(safeStr(cfg.close, ""));
  const slotMin = toMin(time24);
  if (openMin == null || closeMin == null || slotMin == null) return true;
  return slotMin >= openMin && slotMin < closeMin;
}

function validateRequestedDateTimeBookability(args: {
  requestedDate: string;
  requestedTime: string;
  timezone: string;
  clinicSettings?: Record<string, unknown>;
}): {
  canBookRequestedDateTime: boolean;
  reason: "requested_day_closed" | "requested_time_outside_hours" | "requested_time_in_past" | null;
} {
  if (isBarbershopSlotInPast(args.requestedDate, args.requestedTime, args.timezone)) {
    return { canBookRequestedDateTime: false, reason: "requested_time_in_past" };
  }
  if (!isWithinClinicHours(args.requestedDate, args.requestedTime, args.clinicSettings)) {
    const d = new Date(`${args.requestedDate}T12:00:00`);
    const hours = (args.clinicSettings?.hours ?? null) as Record<string, unknown> | null;
    if (hours && !Number.isNaN(d.valueOf())) {
      const keyMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const cfg = (hours[keyMap[d.getDay()]] ?? null) as Record<string, unknown> | null;
      if (cfg?.closed === true) {
        return { canBookRequestedDateTime: false, reason: "requested_day_closed" };
      }
    }
    return { canBookRequestedDateTime: false, reason: "requested_time_outside_hours" };
  }
  return { canBookRequestedDateTime: true, reason: null };
}

function isCleanConfirmationText(input: string): boolean {
  const text = normalizeTextForIntent(input).trim();
  if (!/^(si|s[ií]|ok|dale|me funciona|esta bien|confirmar|claro|correcto)$/.test(text)) return false;
  if (
    /\b(manana|hoy|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|a las|quiero|cambiar|yo dije|no te dije|ese no era)\b/
      .test(text)
  ) {
    return false;
  }
  return true;
}

function mergeBookingContext(args: {
  currentEntities: {
    serviceName: string;
    providerName: string;
    providerPreference: "any" | "specific" | null;
    hasAnyProviderPreference: boolean;
  };
  leadState: ConversationState;
  bookingCollected: Record<string, unknown>;
  lastBotQuestion: string;
}): {
  serviceName: string;
  providerName: string;
  providerPreference: "any" | "specific" | null;
  proposedDate: string;
  proposedTime: string;
  reusedPreviousDateTime: boolean;
} {
  const serviceName = safeStr(
    args.currentEntities.serviceName,
    safeStr(args.bookingCollected.service, ""),
  ).trim();
  const providerName = safeStr(
    args.currentEntities.providerName,
    safeStr(args.bookingCollected.preferred_barber, ""),
  ).trim();
  const providerPreference = args.currentEntities.hasAnyProviderPreference
    ? "any"
    : (providerName ? "specific" : args.currentEntities.providerPreference);

  const proposed = ((args.bookingCollected.proposed_slot ?? {}) as Record<string, unknown>);
  const proposedDate = safeStr(
    proposed.date,
    safeStr(args.bookingCollected.preferred_date, ""),
  ).trim();
  const proposedTime = safeStr(
    proposed.time,
    safeStr(args.bookingCollected.preferred_time, ""),
  ).trim();
  const reusedPreviousDateTime = Boolean(proposedDate && proposedTime);

  return {
    serviceName,
    providerName,
    providerPreference,
    proposedDate,
    proposedTime,
    reusedPreviousDateTime,
  };
}

type PendingInterruptionType =
  | "clean_confirmation"
  | "clean_rejection"
  | "date_time_change"
  | "service_change"
  | "business_hours_question"
  | "pricing_question"
  | "location_question"
  | "service_info_question"
  | "human_handoff"
  | "correction"
  | "unknown";

function classifyPendingFlowInterruption(input: string): { type: PendingInterruptionType; confidence: number } {
  const text = normalizeTextForIntent(input);
  const raw = safeStr(input, "");
  const hasDateTime = Boolean(parseDateTimeFromMessage(raw));
  const hasDateOnly = Boolean(parseDateOnlyFromMessage(raw));
  const hasService = Boolean(detectService(raw));

  if (isCleanConfirmationText(raw)) return { type: "clean_confirmation", confidence: 0.98 };
  if (/^(no|negativo|cancelar|ya no|mejor no)\b/.test(text)) return { type: "clean_rejection", confidence: 0.95 };
  if (isBusinessHoursQuestionText(raw)) return { type: "business_hours_question", confidence: 0.95 };
  if (isPricingQuestion(raw)) return { type: "pricing_question", confidence: 0.95 };
  if (/\b(donde|dónde|ubicacion|ubicación|direccion|dirección|maps)\b/.test(text)) {
    return { type: "location_question", confidence: 0.95 };
  }
  if (isServiceQuestion(raw)) return { type: "service_info_question", confidence: 0.9 };
  if (needsHumanHandoff(detectIntent(raw).intent)) return { type: "human_handoff", confidence: 0.85 };
  if (isStateCorrectionText(raw) || /\b(manana es|yo dije|no te dije|ese no era)\b/.test(text)) {
    return { type: "correction", confidence: 0.92 };
  }
  if (hasService) return { type: "service_change", confidence: 0.88 };
  if (
    hasDateTime ||
    hasDateOnly ||
    /\b(misma fecha|mismo dia|ese mismo dia|cambiemos|mejor)\b/.test(text)
  ) {
    return { type: "date_time_change", confidence: 0.88 };
  }
  return { type: "unknown", confidence: 0.5 };
}

function isStateCorrectionText(input: string): boolean {
  const text = normalizeTextForIntent(input);
  return /\b(no te he dado fecha ni hora|no te di fecha|yo no pedi ese dia|nadie pidio viernes|yo pedi lunes|no te pedi eso)\b/
    .test(text);
}

type PendingBookingRequest = {
  service: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  provider_name: string | null;
  provider_preference: "any" | "specific" | null;
  patient_name: string | null;
  booking_for_other: boolean;
  missing_fields: string[];
  source: "llm_interpreter" | "deterministic" | "context_merge";
};

function normalizePendingBookingRequest(raw: unknown): PendingBookingRequest {
  const value = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const providerPrefRaw = safeStr(value.provider_preference, "").trim().toLowerCase();
  const provider_preference = providerPrefRaw === "any" || providerPrefRaw === "specific"
    ? (providerPrefRaw as "any" | "specific")
    : null;
  const missing_fields = Array.isArray(value.missing_fields)
    ? value.missing_fields.map((f) => safeStr(f, "").trim()).filter(Boolean)
    : [];
  const sourceRaw = safeStr(value.source, "").trim();
  const source = sourceRaw === "llm_interpreter" || sourceRaw === "context_merge" || sourceRaw === "deterministic"
    ? sourceRaw
    : "deterministic";
  return {
    service: safeStr(value.service, "").trim() || null,
    preferred_date: safeStr(value.preferred_date, "").trim() || null,
    preferred_time: safeStr(value.preferred_time, "").trim() || null,
    provider_name: safeStr(value.provider_name, "").trim() || null,
    provider_preference: provider_preference,
    patient_name: safeStr(value.patient_name, "").trim() || null,
    booking_for_other: Boolean(value.booking_for_other),
    missing_fields,
    source,
  };
}

function computeBookingMissingFields(req: PendingBookingRequest): string[] {
  const missing: string[] = [];
  if (!safeStr(req.service, "").trim()) missing.push("service");
  if (!safeStr(req.preferred_date, "").trim()) missing.push("date");
  if (!safeStr(req.preferred_time, "").trim()) missing.push("time");
  return missing;
}

function mergePendingBookingRequest(args: {
  bookingCollected: Record<string, unknown>;
  detectedServiceName: string;
  parsedDate: string | null;
  parsedTime: string | null;
  providerName: string | null;
  providerPreference: "any" | "specific" | null;
  source: PendingBookingRequest["source"];
}): PendingBookingRequest {
  const existing = normalizePendingBookingRequest((args.bookingCollected as any).pending_booking_request);
  const merged: PendingBookingRequest = {
    service: safeStr(args.detectedServiceName, "").trim() || existing.service || safeStr(args.bookingCollected.service, "").trim() || null,
    preferred_date: args.parsedDate || existing.preferred_date || safeStr(args.bookingCollected.preferred_date, "").trim() || null,
    preferred_time: args.parsedTime || existing.preferred_time || safeStr(args.bookingCollected.preferred_time, "").trim() || null,
    provider_name: args.providerName || existing.provider_name || safeStr(args.bookingCollected.provider_name, safeStr(args.bookingCollected.preferred_barber, "")).trim() || null,
    provider_preference: args.providerPreference || existing.provider_preference || null,
    patient_name: existing.patient_name || safeStr(args.bookingCollected.patient_name, "").trim() || null,
    booking_for_other: existing.booking_for_other || Boolean((args.bookingCollected as any).booking_for_other),
    missing_fields: [],
    source: args.source,
  };
  merged.missing_fields = computeBookingMissingFields(merged);
  return merged;
}

function hasIncompleteTimePhrase(input: string): boolean {
  const text = normalizeTextForIntent(input);
  return /\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(text) &&
    /\ba\s+las\b/.test(text) &&
    !/\ba\s+las\s+\d{1,2}(\s*:\s*\d{2})?(\s*(am|pm))?\b/.test(text);
}

function isAppointmentLookupInquiry(input: string): boolean {
  const text = normalizeTextForIntent(input);
  return /\b(que cita tengo|que cita teng|que cita tngo|tengo cita|tengo cita hoy|a que hora es mi cita|a que hora era mi cita|para cuando es mi cita|confirmame mi cita|cual es mi cita|cuando tengo cita|me podes recordar mi cita|me pod[eé]s recordar mi cita|me podes recordar cual es la cita que tengo|me pod[eé]s recordar cual es la cita que tengo|tengo cita\?|para que fecha quedo mi cita|en que fecha quedo mi cita|cuando quedo mi cita|para cuando quedo|como quedo mi cita|quedo mi cita|quedo agendada mi cita|en que quedo mi cita|a que hora quedo mi cita|para que dia quedo mi cita|que dia quedo mi cita)\b/
    .test(text);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function determineOrgType(
  _orgId: string,
  businessType?: string | null,
): "creatyv" | "dental" | "barbershop" | "insurance" | "generic" {
  const type = safeStr(businessType, "").trim().toLowerCase();
  if (type === "creatyv") return "creatyv";
  if (type === "dental") return "dental";
  if (type === "barbershop") return "barbershop";
  if (type === "insurance") return "insurance";
  return "generic";
}

function getResponses(orgType: "creatyv" | "dental" | "barbershop" | "insurance" | "generic") {
  return RESPONSES[orgType] ?? RESPONSES.generic;
}

function formatInsuranceCurrentCoverageForCopy(value: unknown): string {
  const normalized = safeStr(value).toLowerCase();
  if (normalized === "vence_pronto") return "Vence pronto";
  if (normalized === "comparando") return "Ya tengo, comparo";
  if (normalized === "no_tiene") return "No tengo";
  if (normalized === "si") return "Sí";
  if (normalized === "no") return "No";
  return safeStr(value);
}

function buildRecoveryContextFromState(state: ConversationState): ConversationContext {
  const collected = (state.collected ?? {}) as Record<string, unknown>;
  const nextExpected = safeStr(state.nextExpected, "");
  const stage = safeStr(state.stage, "");
  const active = (collected.active_appointment ?? {}) as Record<string, unknown>;
  const currentGoal: ConversationContext["currentGoal"] =
    nextExpected === "confirm_booking"
      ? "confirm_booking"
      : nextExpected === "confirm_reschedule_appointment"
      ? "confirm_reschedule"
      : isRescheduleDateTimeExpected(nextExpected)
      ? "reschedule_appointment"
      : nextExpected === "confirm_cancel_appointment"
      ? "cancel_appointment"
      : nextExpected === "active_appointment_intent_choice"
      ? "active_appointment_choice"
      : stage === "BOOKING"
      ? "book_appointment"
      : "unknown";
  return {
    currentGoal,
    service: safeStr(collected.service, safeStr(collected.last_discussed_service, "")) || null,
    pendingDate: safeStr(collected.preferred_date, safeStr(collected.reschedule_date, "")) || null,
    pendingTime: safeStr(collected.preferred_time, safeStr(collected.reschedule_time, "")) || null,
    activeAppointment: safeStr(active.id, "")
      ? {
        id: safeStr(active.id, ""),
        service: safeStr(active.reason, safeStr(active.service, "")),
        dateLabel: safeStr(active.appointment_date, ""),
        timeLabel: safeStr(active.appointment_time, ""),
      }
      : null,
    recoveryCount: Number((collected.recovery_count ?? 0) as number),
  };
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
  if (collectedName && !collectedName.startsWith("Usuario ")) {
    return collectedName;
  }
  if (leadName && !leadName.startsWith("Usuario ")) return leadName;
  if (stateName && !stateName.startsWith("Usuario ")) return stateName;
  return "";
}

function getFirstName(state: ConversationState) {
  const fullName = getCollectedName(state);
  return fullName ? fullName.split(/\s+/)[0] ?? "" : "";
}

const DENTAL_SERVICES: Record<string, string[]> = {
  "Limpieza dental": ["limpieza", "limpiesa", "limpueza", "profilaxis", "cleaning"],
  "Ortodoncia": ["ortodoncia", "brackets", "frenos", "braces"],
  "Blanqueamiento": ["blanqueamiento", "whitening", "blanqueo", "aclarar"],
  "Implantes": ["implante", "implantes", "implant"],
  "Extracción": [
    "extracción",
    "extraccion",
    "sacar muela",
    "muela",
    "extraction",
  ],
  "Consulta general": [
    "consulta",
    "revisión",
    "revision",
    "chequeo",
    "checkup",
    "valoración",
  ],
  "Endodoncia": ["endodoncia", "root canal", "nervio"],
  "Corona": ["corona", "crown"],
  "Caries": ["caries", "empaste", "relleno", "filling"],
};

function detectService(text: string): string | null {
  const lower = normalizeTextForIntent(safeStr(text, ""));
  for (const [service, keywords] of Object.entries(DENTAL_SERVICES)) {
    if (keywords.some((keyword) => lower.includes(keyword))) return service;
  }
  return null;
}

function hasDeterministicBookingSignal(text: string): boolean {
  if (isLikelyBookingRequest(text)) return true;
  const service = detectService(text);
  const dateTime = parseDateTimeFromMessage(text);
  const hasDateSignal =
    /\b(hoy|mañana|pasado mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i
      .test(text);
  return Boolean(service && (dateTime || hasDateSignal));
}

function shouldOfferSameDayFromSettings(
  clinicSettings?: Record<string, unknown>,
): boolean {
  const timezone = safeStr(
    clinicSettings?.timezone,
    "America/Tegucigalpa",
  ).trim() || "America/Tegucigalpa";
  const cutoffRaw = safeStr(clinicSettings?.same_day_booking_cutoff, "15:00")
    .trim();
  const m = cutoffRaw.match(/^(\d{1,2}):(\d{2})$/);
  const cutoffMin = m ? Number(m[1]) * 60 + Number(m[2]) : 15 * 60;
  const nowLocal = new Date(
    new Date().toLocaleString("en-US", { timeZone: timezone }),
  );
  if (Number.isNaN(nowLocal.valueOf())) return true;
  const nowMin = nowLocal.getHours() * 60 + nowLocal.getMinutes();
  return nowMin < cutoffMin;
}

function isAvailabilityInquiryText(input: string): boolean {
  const text = normalizeTextForIntent(input);

  const phraseMatch = /\b(ver horarios|ver horario|ver horarios disponibles|mostrar horarios|horarios disponibles|horas disponibles|disponibilidad de horarios|quiero ver horarios|disponibilidad|que horarios hay|que horarios tienen|que horarios tienes|que horas tienes|que horas tiene|que dias hay|que otros dias tienes|otros dias|otros horarios|que dia tienes disponible|que dias tienes disponible|que dia tiene disponible|que dias tiene disponible|que horas tienes disponibles|que horas tiene disponibles|que horas hay disponibles|que espacios hay|cuando tienen disponible|tiene espacio|hay espacio esta semana|que tiene disponible|tienes horarios|tiene horarios|tienes disponible|tienes disponibles|tiene disponible|tiene disponibles|cupo para|espacios para|horarios para|en la semana)\b/i
    .test(text);
  if (phraseMatch) return true;

  const hasDayOrPeriodSignal =
    /\b(hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|en la tarde|temprano|en la manana|en la noche)\b/
      .test(text);
  if (hasDayOrPeriodSignal && /\b(que tenes|que tienes|tenes|tienes)\b/.test(text)) return true;

  const hasAvailabilitySubject = /\b(hora|horas|horario|horarios|espacio|espacios|dia|dias)\b/.test(text);
  const hasAvailabilitySignal =
    /\b(disponible|disponibles|disponibilidad|hay|ver|mostrar)\b/.test(text) ||
    /\btien\w*\b/.test(text);
  return hasAvailabilitySubject && hasAvailabilitySignal;
}

function isAvailabilityDiscoveryIntentText(input: string): boolean {
  const text = normalizeTextForIntent(input);
  const asksOpenQuestion = /\b(que|cual|cuando|para cuando)\b/.test(text);
  const availabilityCoreSignal = /\b(disponible|disponibilidad|cupo|espacio|horario|horarios|hora|horas|atienden|atiende)\b/
    .test(text);
  const dayQuestionSignal = /\b(dia|dias|semana)\b/.test(text);
  const bookingAskSignal = /\b(puedo llegar|hay|tienen|tienes|tenes|esta|estan)\b/.test(text);
  if (isAvailabilityInquiryText(input)) return true;
  return asksOpenQuestion && availabilityCoreSignal && (dayQuestionSignal || bookingAskSignal);
}

function isBusinessHoursQuestionText(input: string): boolean {
  const text = normalizeTextForIntent(input);
  if (/\b(que horas tenes disponible|horarios disponibles|hay cupo|hay espacio|tenes espacio|tienes espacio)\b/.test(text)) {
    return false;
  }
  if (/\b(que horarios tenes|que horarios tienes|que horas tenes|que horas tienes)\b/.test(text)) {
    return false;
  }
  return /\b(horario|horarios|horario de atencion|a que hora abren|a que hora cierran|cuando abren|cuando cierran|abren|cierran)\b/i
    .test(text);
}

function formatBarbershopPrice(price: unknown): string {
  const num = Number(price);
  if (Number.isFinite(num) && num > 0) return `HNL ${Math.round(num)}`;
  return "precio por confirmar";
}

function formatBarbershopDurationLabel(minutesRaw: unknown): string {
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(minutes) || minutes <= 0) return "duración por confirmar";
  if (minutes === 60) return "1 hora";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return remainder > 0 ? `${hours} h ${remainder} min` : `${hours} horas`;
}

function getBarbershopServiceBenefitLine(serviceNameRaw: string): string {
  const name = normalizeTextForIntent(serviceNameRaw);
  if (name.includes("barba") && name.includes("corte")) return "El combo completo: corte, barba y detalle.";
  if (name.includes("limpieza") && name.includes("corte")) return "Corte completo con limpieza facial incluida.";
  if (name.includes("limpieza")) return "Para refrescar la piel y salir más fino.";
  if (name.includes("corte")) return "Limpio, fresco y bien perfilado.";
  return "Para salir listo.";
}

function getBarbershopServiceEmoji(serviceNameRaw: string): string {
  const name = normalizeTextForIntent(serviceNameRaw);
  if (name.includes("barba")) return "🧔";
  if (name.includes("limpieza")) return name.includes("corte") ? "💈" : "✨";
  if (name.includes("corte")) return "✂️";
  return "💈";
}

function getBarbershopCopyBrandName(clinicSettings?: Record<string, unknown>): string {
  const location = clinicSettings?.location && typeof clinicSettings.location === "object"
    ? (clinicSettings.location as Record<string, unknown>)
    : {};
  const configured = safeStr(
    location.name,
    safeStr(
      clinicSettings?.brand_name,
      safeStr(clinicSettings?.display_name, safeStr(clinicSettings?.business_name, "")),
    ),
  ).trim();
  if (configured) return configured;
  return "BarberLine";
}

function getBarbershopServiceActionKey(service: { id?: string; key?: string; name?: string } | null | undefined): string {
  const key = safeStr(service?.key, safeStr(service?.id, safeStr(service?.name, ""))).trim();
  if (key) return key;
  return safeStr(service?.name, "").trim().toLowerCase().replace(/\s+/g, "_");
}

function formatBarbershopServiceMenuFromSettings(
  services: Array<{ name: string }>,
  fallback = "Corte clásico\n• Corte + barba\n• Barba",
): string {
  const visible = services.slice(0, 4).map((service) => safeStr(service.name, "").trim()).filter(Boolean);
  if (!visible.length) return fallback;
  return visible.map((name) => `• ${name}`).join("\n");
}

function buildBarbershopPricingCollected(
  bookingCollected: Record<string, unknown>,
  service?: { id?: string; key?: string; name?: string; durationMin?: number; price?: number } | null,
  preservePendingBooking = false,
): Record<string, unknown> {
  const base = preservePendingBooking
    ? { ...bookingCollected, last_info_topic: "pricing", lastTopic: "pricing" }
    : buildInfoContextCollected(bookingCollected, "pricing");
  if (!service) {
    return preservePendingBooking ? base : {
      ...base,
      pending_booking: null,
      pending_booking_stale: true,
    };
  }
  const serviceKey = getBarbershopServiceActionKey(service);
  return {
    ...base,
    ...(preservePendingBooking ? {} : { pending_booking: null, pending_booking_stale: true }),
    last_service_discussed: service.name,
    lastServiceDiscussed: service.name,
    last_pricing_service: service.name,
    last_pricing_service_key: serviceKey,
  };
}

function formatBarbershopPricingAnswer(
  service: { name: string; durationMin: number; price?: number },
): string {
  const price = formatBarbershopPrice(service.price);
  return `${service.name} anda en ${price} y dura aprox. ${service.durationMin} minutos.\n\n¿Querés que te busque un espacio?`;
}

function resolveBarbershopPublicLocation(clinicSettings?: Record<string, unknown>): string {
  const locationRaw = clinicSettings?.location;
  const locationObj = (locationRaw && typeof locationRaw === "object")
    ? (locationRaw as Record<string, unknown>)
    : null;
  const integrations = (clinicSettings?.integrations && typeof clinicSettings.integrations === "object")
    ? (clinicSettings.integrations as Record<string, unknown>)
    : null;
  const candidates = [
    typeof locationRaw === "string" ? locationRaw : "",
    safeStr(locationObj?.address, ""),
    safeStr(locationObj?.label, ""),
    safeStr(clinicSettings?.address, ""),
    safeStr(integrations?.public_location, ""),
    "Barrio Los Andes, San Pedro Sula, frente al parque principal",
  ].map((v) => safeStr(v, "").trim());
  return candidates.find((v) => v.length > 0) ?? "Barrio Los Andes, San Pedro Sula, frente al parque principal";
}

function resolveConfiguredBarbershopPublicLocation(clinicSettings?: Record<string, unknown>): string {
  const locationRaw = clinicSettings?.location;
  const locationObj = (locationRaw && typeof locationRaw === "object")
    ? (locationRaw as Record<string, unknown>)
    : null;
  const integrations = (clinicSettings?.integrations && typeof clinicSettings.integrations === "object")
    ? (clinicSettings.integrations as Record<string, unknown>)
    : null;
  const candidates = [
    typeof locationRaw === "string" ? locationRaw : "",
    safeStr(locationObj?.address, ""),
    safeStr(locationObj?.label, ""),
    safeStr(clinicSettings?.address, ""),
    safeStr(integrations?.public_location, ""),
  ].map((v) => safeStr(v, "").trim());
  return candidates.find((v) => v.length > 0) ?? "";
}

function getBarbershopBusinessHoursReply(
  input: string,
  clinicSettings?: Record<string, unknown>,
): string {
  const hours = (clinicSettings?.hours && typeof clinicSettings.hours === "object")
    ? (clinicSettings.hours as Record<string, unknown>)
    : {};
  const normalized = normalizeTextForIntent(input);
  const get = (key: string) => ((hours[key] ?? null) as Record<string, unknown> | null);
  const mon = get("mon");
  const sat = get("sat");
  const sun = get("sun");
  const openMon = mon && mon.closed !== true ? formatHourForReply(safeStr(mon.open, "08:00")) : "8:00 AM";
  const closeMon = mon && mon.closed !== true ? formatHourForReply(safeStr(mon.close, "17:00")) : "5:00 PM";
  const openSat = sat && sat.closed !== true ? formatHourForReply(safeStr(sat.open, "09:00")) : "9:00 AM";
  const closeSat = sat && sat.closed !== true ? formatHourForReply(safeStr(sat.close, "17:00")) : "5:00 PM";
  const sunClosed = !sun || sun.closed === true;
  if (/\b(abren|apertura|a que hora abren|cuando abren)\b/.test(normalized)) {
    return `Abrimos a las ${openMon} de lunes a viernes y a las ${openSat} los sábados.`;
  }
  if (/\b(cierran|cierre|a que hora cierran|cuando cierran)\b/.test(normalized)) {
    return `Cerramos a las ${closeMon}.`;
  }
  return `Horario:\nLunes a viernes: ${openMon} – ${closeMon}\nSábado: ${openSat} – ${closeSat}\nDomingo: ${sunClosed ? "cerrado" : `${formatHourForReply(safeStr(sun.open, "09:00"))} – ${formatHourForReply(safeStr(sun.close, "17:00"))}`}\n\n¿Querés que revise espacios disponibles?`;
}

function getConfiguredHoursEntry(
  hours: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const aliases: Record<string, string[]> = {
    mon: ["mon", "monday", "lunes", "1"],
    tue: ["tue", "tuesday", "martes", "2"],
    wed: ["wed", "wednesday", "miercoles", "miércoles", "3"],
    thu: ["thu", "thursday", "jueves", "4"],
    fri: ["fri", "friday", "viernes", "5"],
    sat: ["sat", "saturday", "sabado", "sábado", "6"],
    sun: ["sun", "sunday", "domingo", "0", "7"],
  };
  for (const alias of aliases[key] ?? [key]) {
    const entry = hours[alias];
    if (entry && typeof entry === "object") return entry as Record<string, unknown>;
  }
  return null;
}

function formatBarbershopConfiguredHoursReply(
  clinicSettings?: Record<string, unknown>,
): string {
  const brandName = getBarbershopCopyBrandName(clinicSettings);
  const hours = (clinicSettings?.hours && typeof clinicSettings.hours === "object")
    ? (clinicSettings.hours as Record<string, unknown>)
    : {};
  if (Object.keys(hours).length === 0) {
    return `Por ahora no tengo los horarios exactos de ${brandName} configurados. Podés tocar "Hablar con alguien" para que te ayuden.`;
  }
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const dayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const rows = dayKeys.map((key, index) => {
    const entry = getConfiguredHoursEntry(hours, key) ??
      (index > 0 && index < 5 ? getConfiguredHoursEntry(hours, "mon") : null);
    const open = safeStr(entry?.open ?? entry?.open_time, "");
    const close = safeStr(entry?.close ?? entry?.close_time, "");
    const closed = !entry || Boolean(entry.closed ?? entry.is_closed) || !open || !close;
    return {
      label: dayNames[index],
      value: closed ? "cerrado" : `${formatHourForReply(open)} – ${formatHourForReply(close)}`,
    };
  });
  const weekdays = rows.slice(0, 5);
  const sameWeekdays = weekdays.every((row) => row.value === weekdays[0].value);
  const lines = sameWeekdays
    ? [
      `Lunes a viernes: ${weekdays[0].value}`,
      `Sábado: ${rows[5].value}`,
      `Domingo: ${rows[6].value}`,
    ]
    : rows.map((row) => `${row.label}: ${row.value}`);
  return `Horario:\n${brandName} atiende:\n\n${lines.join("\n")}`;
}

function formatBarbershopServicesPricesReply(
  input: string,
  clinicSettings?: Record<string, unknown>,
): string {
  const brandName = getBarbershopCopyBrandName(clinicSettings);
  const services = getBarbershopServicesFromSettings(clinicSettings);
  const priceShort = (price: unknown) => {
    const num = Number(price);
    return Number.isFinite(num) && num > 0 ? `L${Math.round(num)}` : "precio por confirmar";
  };
  if (services.length === 0) {
    return `Por ahora no tengo servicios configurados para ${brandName}. Podés tocar "Hablar con alguien" para que te ayuden.`;
  }
  const specific = resolveBarbershopServiceFromSettings(input, clinicSettings);
  const normalized = normalizeTextForIntent(input);
  const asksSpecific = specific &&
    /\b(corte|barba|limpieza|facial|cejas|servicio|cuanto|cuánto|precio|vale|cuesta)\b/.test(normalized) &&
    !/\b(precios|servicios|que servicios tienen|lista de precios)\b/.test(normalized);
  if (asksSpecific && specific) {
    return `${specific.name}: ${priceShort(specific.price)} · ${formatBarbershopDurationLabel(specific.durationMin)}.\n\nPara agendar, tocá "Agendar cita" o escribí el servicio que querés.`;
  }
  const lines = services.slice(0, 8).map((service) =>
    `${getBarbershopServiceEmoji(service.name)} ${service.name} — ${priceShort(service.price)}`
  );
  return `Estos son los servicios disponibles en ${brandName}:\n\n${lines.join("\n")}\n\nPara agendar, tocá "Agendar cita" o escribí el servicio que querés.`;
}

function formatBarbershopProvidersReply(
  clinicSettings?: Record<string, unknown>,
): string {
  const providers = getBarbershopProvidersFromSettings(clinicSettings);
  if (providers.length === 0) {
    return 'Por ahora no tengo barberos configurados para mostrar. Podés tocar "Hablar con alguien" para que te ayuden.';
  }
  return `Estos barberos están disponibles:\n\n${providers.map((provider) => `💈 ${provider.name}`).join("\n")}\n\nPodés escoger uno o elegir “cualquiera disponible”.`;
}

function formatBarbershopPendingBookingConfirmationReminder(
  pendingBooking: Record<string, unknown>,
  bookingCollected: Record<string, unknown>,
  state: ConversationState,
): string {
  const service = safeStr(
    pendingBooking.service_name,
    safeStr(pendingBooking.service, safeStr(bookingCollected.service, "Cita barbería")),
  );
  const provider = safeStr(
    pendingBooking.provider_name,
    safeStr(
      pendingBooking.preferred_barber,
      safeStr(bookingCollected.preferred_barber, "Barbero disponible"),
    ),
  );
  const date = formatHumanDay(
    safeStr(pendingBooking.appointment_date, safeStr(bookingCollected.preferred_date, "")),
  );
  const time = formatHourLabel(
    safeStr(pendingBooking.appointment_time, safeStr(bookingCollected.preferred_time, "")),
  );
  const customerName = toDisplayPersonName(
    safeStr(
      pendingBooking.patient_name,
      safeStr(
        pendingBooking.customer_name,
        safeStr(
          pendingBooking.client_name,
          safeStr(
            bookingCollected.patient_name,
            safeStr(
              bookingCollected.customer_name,
              safeStr(bookingCollected.client_name, safeStr(resolveAppointmentPatientName(bookingCollected, state), "")),
            ),
          ),
        ),
      ),
    ),
  );
  const nameLine = safeStr(customerName, "").trim() ? `\n👤 Nombre: ${customerName}` : "";
  return `Tenés esta cita pendiente:

✂️ Servicio: ${service}
💈 Barbero: ${provider}
📅 Fecha: ${date}
🕝 Hora: ${time}${nameLine}

¿Confirmamos?`;
}

function classifyBarbershopGlobalInfoInterrupt(input: string): "hours" | "location" | "services_prices" | "providers" | "availability" | null {
  const text = normalizeTextForIntent(input);
  if (!text) return null;
  if (
    /^(disponibilidad)$/.test(text) ||
    /\b(tienen|tienes|tenes|hay|que|qué|cual|cuál|quien|quién)\b.*\b(cupo|cupos|espacio|espacios|disponibilidad|chance)\b/.test(text) ||
    /\b(que horas disponibles|horas disponibles|horarios disponibles|quien esta disponible|quien está disponible)\b/.test(text)
  ) {
    return "availability";
  }
  if (
    /^(hora|horario|horarios)$/.test(text) ||
    /\b(que horarios tienen|que horario tienen|horario de atencion|a que hora abren|a que hora cierran|cuando abren|cuando cierran|hasta que hora trabajan|hasta que hora atienden|hoy hasta que hora)\b/.test(text)
  ) {
    return "hours";
  }
  if (/\b(ubicacion|ubicación|direccion|dirección|donde estan|donde están|donde quedan|ubicados|me pasan ubicacion|me pasan ubicación|como llego|cómo llego)\b/.test(text)) {
    return "location";
  }
  if (/\b(que barberos hay|barberos disponibles|barberos|quien corta|quienes cortan|con quien puedo agendar|con quien puedo reservar)\b/.test(text)) {
    return "providers";
  }
  if (
    /\b(precio|precios|cuanto cuesta|cuánto cuesta|cuanto vale|cuánto vale|costo|costos|tarifa|tarifas|servicios|que servicios tienen|que ofrecen|tienen limpieza facial|limpieza facial)\b/.test(text)
  ) {
    return "services_prices";
  }
  return null;
}

function hasActiveBarbershopBookingContext(
  state: ConversationState,
  bookingCollected: Record<string, unknown>,
): boolean {
  return Boolean(
    state.nextExpected ||
      state.stage === "BOOKING" ||
      state.stage === "CONFIRMING" ||
      bookingCollected.activeBookingFlow ||
      bookingCollected.lastBookingStep ||
      bookingCollected.pending_booking ||
      bookingCollected.current_service_name ||
      bookingCollected.service ||
      bookingCollected.preferred_date ||
      bookingCollected.current_date,
  );
}

function isBarbershopPricingFollowup(input: string): boolean {
  const t = normalizeTextForIntent(input);
  return /^(y\s+barba\??|y\s+la\s+barba\??|y\s+solo\s+barba\??|y\s+cejas\??|y\s+las\s+cejas\??|y\s+corte\s+y\s+barba\??|y\s+el\s+pelo\??)$/.test(t);
}

function logBarbershopDiagnostic(event: string, payload: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...payload }));
}

function intentEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function isBarberlineSemanticCancelIntent(input: string): { matched: boolean; fuzzy: boolean } {
  const t = normalizeTextForIntent(input);
  if (/\b(cancelar|cancelala|cancelarla|cancelar cita|cancelar la cita|quiero cancelar|cancelar mi cita|anular)\b/.test(t)) {
    return { matched: true, fuzzy: false };
  }
  const tokens = t.split(/\s+/).filter(Boolean);
  const fuzzy = tokens.some((token) =>
    token.length >= 6 && (
      /^cancel[a-z]*$/.test(token) ||
      intentEditDistance(token, "cancelar") <= 2 ||
      intentEditDistance(token, "cancelarla") <= 3 ||
      intentEditDistance(token, "cancelala") <= 3
    )
  );
  return { matched: fuzzy, fuzzy };
}

function isBarbershopOutOfScopeText(input: string): boolean {
  const t = normalizeTextForIntent(input);
  if (!t) return false;
  const hasBarbershopScope = /\b(cita|agendar|agenda|precio|precios|servicio|servicios|horario|horarios|ubicacion|ubicación|direccion|dirección|barbero|barba|corte|cejas|cupo|espacio|disponible)\b/
    .test(t);
  if (hasBarbershopScope) return false;
  return /\b(clima|tiempo|futbol|partido|politica|noticias|bitcoin|criptomoneda|receta|tarea|escuela|universidad)\b/.test(t);
}

function formatHourForReply(value: string): string {
  const m = safeStr(value, "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return value;
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${min} ${ampm}`;
}

function getBusinessHoursReplyForQuestion(
  input: string,
  clinicSettings?: Record<string, unknown>,
): string | null {
  const hours = clinicSettings?.hours as Record<string, unknown> | undefined;
  if (!hours || typeof hours !== "object") return null;
  const normalized = normalizeTextForIntent(input);
  const dayOrder: Array<{ k: string; label: string; aliases: string[] }> = [
    { k: "mon", label: "lunes", aliases: ["lunes"] },
    { k: "tue", label: "martes", aliases: ["martes"] },
    { k: "wed", label: "miércoles", aliases: ["miercoles", "miércoles"] },
    { k: "thu", label: "jueves", aliases: ["jueves"] },
    { k: "fri", label: "viernes", aliases: ["viernes"] },
    { k: "sat", label: "sábado", aliases: ["sabado", "sábado"] },
    { k: "sun", label: "domingo", aliases: ["domingo"] },
  ];
  const findDay = dayOrder.find((d) => d.aliases.some((a) => normalized.includes(a)));
  const dayConfig = (key: string) => (hours[key] ?? null) as Record<string, unknown> | null;
  if (findDay) {
    const cfg = dayConfig(findDay.k);
    if (!cfg || cfg.closed === true) return `Los ${findDay.label} estamos cerrados.`;
    const open = formatHourForReply(safeStr(cfg.open, "08:00"));
    const close = formatHourForReply(safeStr(cfg.close, "17:00"));
    return `Los ${findDay.label} abrimos de ${open} a ${close}.`;
  }
  const parts: string[] = [];
  for (const d of dayOrder) {
    const cfg = dayConfig(d.k);
    if (!cfg) continue;
    if (cfg.closed === true) {
      parts.push(`${d.label} cerrado`);
      continue;
    }
    const open = formatHourForReply(safeStr(cfg.open, "08:00"));
    const close = formatHourForReply(safeStr(cfg.close, "17:00"));
    parts.push(`${d.label} ${open}-${close}`);
  }
  if (parts.length === 0) return null;
  return `Nuestro horario es: ${parts.join(", ")}.`;
}

function mentionsToday(text: string): boolean {
  const lower = safeStr(text, "").toLowerCase();
  return /\bhoy\b/.test(lower) || /\besta\s+tarde\b/.test(lower);
}

function isMoreInfoWithoutService(text: string): boolean {
  const lower = safeStr(text, "").toLowerCase();
  const asksMoreInfo = /\b(mas info|más info|mas informacion|más información|más detalles|mas detalles)\b/.test(lower);
  if (!asksMoreInfo) return false;
  return !detectService(text);
}

function isPricingQuestion(text: string): boolean {
  const normalized = normalizeTextForIntent(text)
    .replace(/c\\y/g, "c y")
    .replace(/\bcy\b/g, "c y")
    .replace(/\bc\s*y\b/g, "y")
    .replace(/\s+/g, " ");
  return /\b(precio|precios|costo|costos|cuanto cuesta|cuanto valen|cuanto vale|vale|cuesta|costo|cost[oó]|cuanto cobran|desde cuanto|tarifa|tarifas|valor)\b/.test(normalized) ||
    /\bcuanto por\b/.test(normalized) ||
    /\bcuanto\s+uesta\b/.test(normalized) ||
    /^\s*y\s+el\s+corte\??\s*$/.test(normalized) ||
    /^\s*y\s+la\s+barba\??\s*$/.test(normalized) ||
    /^\s*y\s+(el\s+)?combo\??\s*$/.test(normalized) ||
    /^\s*y\s+(el\s+)?corte\s+y\s+barba(\s+cuanto)?\??\s*$/.test(normalized) ||
    /^\s*cuanto\s+el\s+corte\??\s*$/.test(normalized) ||
    /^\s*cuanto\s+la\s+barba\??\s*$/.test(normalized);
}

function isDurationProcessQuestion(text: string): boolean {
  const lower = safeStr(text, "").toLowerCase();
  return /\b(cu[aá]nto tiempo dura|cuanto tiempo dura|cuanto dura|cuánto dura|duraci[oó]n|proceso|c[oó]mo funciona|como funciona)\b/
    .test(lower);
}

function isServiceQuestion(text: string): boolean {
  const lower = safeStr(text, "").toLowerCase();
  return /\b(ustedes ponen|ustedes hacen|hacen|ofrecen|tienen|trabajan|realizan)\b/.test(lower);
}

function detectThirdPartyPatient(text: string): { relation: string; self: boolean } | null {
  const normalized = normalizeTextForIntent(text);
  if (/\b(es para mi|es para mí)\b/.test(normalized)) {
    return { relation: "self", self: true };
  }
  const relations: Array<{ pattern: RegExp; relation: string }> = [
    { pattern: /\b(mi hijo|mi nino|mi niño)\b/, relation: "hijo" },
    { pattern: /\b(mi hija|mi nina|mi niña)\b/, relation: "hija" },
    { pattern: /\b(mi esposa)\b/, relation: "esposa" },
    { pattern: /\b(mi esposo)\b/, relation: "esposo" },
    { pattern: /\b(mi mama|mi mamá)\b/, relation: "mamá" },
    { pattern: /\b(mi papa|mi papá)\b/, relation: "papá" },
  ];
  for (const item of relations) {
    if (item.pattern.test(normalized)) return { relation: item.relation, self: false };
  }
  return null;
}

function detectAdditionalBookingRelation(text: string): { relation: string; self: boolean } | null {
  const normalized = normalizeTextForIntent(text);
  if (/\b(es para mi|es para mí)\b/.test(normalized)) return { relation: "self", self: true };
  if (/\b(mi hijo|mi nino|mi niño)\b/.test(normalized)) return { relation: "hijo", self: false };
  if (/\b(mi hija|mi nina|mi niña)\b/.test(normalized)) return { relation: "hija", self: false };
  if (/\b(mi hermano)\b/.test(normalized)) return { relation: "hermano", self: false };
  if (/\b(mi hermana)\b/.test(normalized)) return { relation: "hermana", self: false };
  if (/\b(mi mama|mi mamá)\b/.test(normalized)) return { relation: "mamá", self: false };
  if (/\b(mi papa|mi papá)\b/.test(normalized)) return { relation: "papá", self: false };
  if (/\b(otra persona|alguien mas|alguien más|para otro|para otra)\b/.test(normalized)) {
    return { relation: "other", self: false };
  }
  return null;
}

function extractExplicitThirdPartyName(text: string): string | null {
  const direct = safeStr(text, "").match(/\bpara\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})\b/i);
  if (!direct) return null;
  const raw = safeStr(direct[1], "").trim();
  if (!raw) return null;
  const normalized = normalizeTextForIntent(raw);
  if (!normalized) return null;
  if (/^(mi|otra|otro|alguien|la|el|una|un|cita|persona|hijo|hija|hermano|hermana|papa|papá|mama|mamá)$/.test(normalized)) return null;
  if (/\b(mi|hijo|hija|hermano|hermana|papa|papá|mama|mamá|corte|barba|cejas|cita|manana|mañana|hoy|sabado|sábado|domingo|lunes|martes|miercoles|miércoles|jueves|viernes)\b/.test(normalized)) {
    return null;
  }
  return toDisplayPersonName(raw);
}

function classifyActiveAppointmentChoice(text: string): "reschedule" | "cancel" | "additional" | "unknown" {
  const normalized = normalizeTextForIntent(text);
  if (
    /\b(reagendar|reagendarla|cambiar|cambiarla|mover|moverla|mejor otro dia|mejor otro día|quiero cambiarla)\b/
      .test(normalized)
  ) return "reschedule";
  if (/\b(cancelar|cancelarla|ya no voy|no voy a poder llegar|no puedo ir|anular)\b/.test(normalized)) return "cancel";
  if (
    /\b(otra|otra cita|agendar otra|agendar otra para otra persona|para otra persona|quiero una para otra persona|quiero una cita para otra persona|para alguien mas|para alguien más|para mi hijo|para mi hermano|para mi mama|para mi mamá|para mi papa|para mi papá)\b/
      .test(normalized)
  ) return "additional";
  return "unknown";
}

function isPendingDiscardConfirmationText(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /^(si|s[ií]|ok|dale|confirmar|claro|cancelar|descartar|quit[ae]la?)\b/.test(normalized);
}

function isRescheduleDateTimeExpected(nextExpected?: string): boolean {
  const value = safeStr(nextExpected, "").trim();
  return value === "reschedule_datetime" || value === "reschedule_date_time" || value === "reschedule_new_datetime";
}

function isServiceActiveForOrg(
  clinicSettings: Record<string, unknown> | undefined,
  serviceLabel: string,
): boolean {
  const configured = Array.isArray(clinicSettings?.services)
    ? (clinicSettings?.services as Array<Record<string, unknown>>)
    : [];
  if (configured.length === 0) return true;
  const normalizedService = normalizeText(serviceLabel);
  return configured.some((row) => {
    const rowName = normalizeText(safeStr(row?.name, ""));
    const rowAliases = Array.isArray(row?.aliases)
      ? (row.aliases as unknown[]).map((v) => normalizeText(safeStr(v, "")))
      : [];
    const bookingAllowed = row?.booking_allowed !== false;
    return bookingAllowed && (
      rowName === normalizedService ||
      normalizedService.includes(rowName) ||
      rowName.includes(normalizedService) ||
      rowAliases.some((alias) =>
        alias && (normalizedService.includes(alias) || alias.includes(normalizedService))
      )
    );
  });
}

function buildServiceOnlyReply(serviceLabel: string, shortExplanation: string): string {
  const normalized = normalizeText(serviceLabel);
  if (normalized.includes("ortodoncia") || normalized.includes("bracket") || normalized.includes("frenillo")) {
    return "Sí, hacemos ortodoncia/brackets. Primero se realiza una evaluación para revisar tu caso, ver la posición de los dientes y definir el tratamiento adecuado.\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para la evaluación?";
  }
  if (normalized.includes("limpieza")) {
    return "Sí, hacemos limpieza dental. La limpieza ayuda a mantener dientes y encías sanos y prevenir molestias.\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para una limpieza?";
  }
  if (normalized.includes("extraccion") || normalized.includes("muela")) {
    return "Sí, realizamos extracciones dentales. Primero el doctor revisa la pieza para confirmar si es una extracción simple, quirúrgica o si hay otra opción de tratamiento.\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para una evaluación?";
  }
  const explanation = safeStr(shortExplanation, "").trim() ||
    "Primero se realiza una evaluación para definir el mejor plan para tu caso.";
  return `Sí, hacemos ${serviceLabel}.\n\n${explanation}\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para la evaluación?`;
}

function hasSchedulingCta(reply: string): boolean {
  const lower = safeStr(reply, "").toLowerCase();
  return lower.includes("querés") && lower.includes("horarios");
}

function resolveCtaTargetService(serviceLabel: string): string {
  const normalized = normalizeText(serviceLabel);
  if (normalized.includes("ortodoncia") || normalized.includes("bracket") || normalized.includes("frenillo")) {
    return "Evaluación de ortodoncia / brackets";
  }
  if (normalized.includes("limpieza")) {
    return "Limpieza dental";
  }
  if (normalized.includes("extraccion") || normalized.includes("muela")) {
    return "Evaluación para extracción dental";
  }
  if (
    normalized.includes("implante") ||
    normalized.includes("endodoncia") ||
    normalized.includes("carilla") ||
    normalized.includes("corona") ||
    normalized.includes("periodoncia")
  ) {
    return `Evaluación de ${serviceLabel}`;
  }
  return "Revisión dental";
}

function isServiceFollowupQuestion(text: string): boolean {
  const lower = safeStr(text, "").toLowerCase();
  return /\b(cu[aá]nto tiempo|cuanto tiempo|proceso|c[oó]mo es|como es|qu[eé] incluye|que incluye|duele|precio|costo|valor|tarifa)\b/
    .test(lower);
}

function buildServiceFollowupReply(service: string, text: string): string | null {
  const s = normalizeText(service);
  const lower = safeStr(text, "").toLowerCase();
  if ((s.includes("ortodoncia") || s.includes("bracket")) && /(cu[aá]nto tiempo|cuanto tiempo|proceso)/.test(lower)) {
    return "El tiempo con frenillos varía según cada caso. En muchos pacientes puede durar entre 1 y 3 años, dependiendo de la posición de los dientes y el plan indicado por el doctor.\n\nPara saberlo con más precisión, lo ideal es una revisión.\n\nSi querés, te ayudo a agendar esa revisión.";
  }
  if ((s.includes("ortodoncia") || s.includes("bracket")) && /(duele)/.test(lower)) {
    return "Al inicio puede haber molestia leve mientras te adaptás, pero suele mejorar en pocos días.\n\nSi querés, te ayudo a agendar una revisión para orientarte mejor.";
  }
  return null;
}

export function parseDateTimeFromMessage(
  text: string,
  timezone = "America/Tegucigalpa",
  now?: Date,
): { date: string; time: string } | null {
  const lowerRaw = safeStr(text, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const lower = lowerRaw
    .replace(/\bvierrnes\b|\bvierness\b/g, "viernes")
    .replace(/\bsabdo\b/g, "sabado")
    .replace(/\bmierciles\b/g, "miercoles")
    .replace(/\b(meanana|menana|maniana|mañan)\b/g, "manana")
    .replace(/\bpasado manana\b/g, "pasado manana")
    .replace(/\bmanana\b/g, "manana")
    .replace(/\bpara el ([a-z]+)\s+e a las\b/g, "para el $1 a las")
    .replace(/\ba la una\b|\ba la 1\b|\ba las una\b/g, "a las 1")
    .replace(/\ba las dos\b/g, "a las 2")
    .replace(/\ba las tres\b/g, "a las 3")
    .replace(/\ba las cuatro\b/g, "a las 4")
    .replace(/\ba las cinco\b/g, "a las 5")
    .replace(/\ba las seis\b/g, "a las 6")
    .replace(/\ba las siete\b/g, "a las 7")
    .replace(/\ba las ocho\b/g, "a las 8")
    .replace(/\ba las nueve\b/g, "a las 9")
    .replace(/\ba las diez\b/g, "a las 10")
    .replace(/\ba las once\b/g, "a las 11")
    .replace(/\ba las doce\b/g, "a las 12")
    .replace(/\btipo una\b/g, "tipo 1")
    .replace(/\btipo dos\b/g, "tipo 2")
    .replace(/\btipo tres\b/g, "tipo 3")
    .replace(/\btipo cuatro\b/g, "tipo 4")
    .replace(/\btipo cinco\b/g, "tipo 5")
    .replace(/\btipo seis\b/g, "tipo 6")
    .replace(/\btipo siete\b/g, "tipo 7")
    .replace(/\btipo ocho\b/g, "tipo 8")
    .replace(/\btipo nueve\b/g, "tipo 9")
    .replace(/\btipo diez\b/g, "tipo 10")
    .replace(/\btipo once\b/g, "tipo 11")
    .replace(/\btipo doce\b/g, "tipo 12");
  const baseLocal = getClinicLocalDate(timezone, now);
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
    manana: -2,
    "pasado manana": -3,
  };

  let targetDateIso: string | null = null;
  if (/\bhoy\b/.test(lower)) {
    targetDateIso = baseLocal.isoDate;
  }
  const weekdayDayNumber = resolveWeekdayDayNumberDate(lower, timezone, now);
  if (weekdayDayNumber.conflict) {
    return null;
  }
  if (!targetDateIso && weekdayDayNumber.date) {
    targetDateIso = weekdayDayNumber.date;
  }
  for (const [dayName, dayNum] of Object.entries(dayMap)) {
    if (targetDateIso) break;
    if (!lower.includes(dayName)) continue;
    if (dayNum === -1) {
      targetDateIso = baseLocal.isoDate;
    } else if (dayNum === -2) {
      targetDateIso = addDaysToIsoDate(baseLocal.isoDate, 1);
    } else if (dayNum === -3) {
      targetDateIso = addDaysToIsoDate(baseLocal.isoDate, 2);
    } else {
      const includeToday = new RegExp(`\\b(el|este)\\s+${dayName}\\b`).test(lower);
      const nextImmediate = nextWeekdayFromIsoDate(baseLocal.isoDate, dayNum, includeToday);
      const hasExplicitNextWeek = new RegExp(`\\b(el otro ${dayName}|el siguiente ${dayName}|${dayName} de la otra semana)\\b`)
        .test(lower);
      targetDateIso = hasExplicitNextWeek ? addDaysToIsoDate(nextImmediate, 7) : nextImmediate;
    }
    break;
  }

  if (!targetDateIso) return null;

  const timeMatch = lower.match(/\ba\s+las\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/) ??
    lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) ??
    lower.match(/(\d{1,2})[:h]?(\d{2})?\s*(am|pm)?/);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2] ?? "0", 10);
  const ampm = timeMatch[3];

  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;
  if (!ampm && hours >= 1 && hours <= 7) hours += 12;

  const timeStr = `${String(hours).padStart(2, "0")}:${
    String(minutes).padStart(2, "0")
  }`;
  return { date: targetDateIso, time: timeStr };
}

export function parseDateOnlyFromMessage(
  text: string,
  timezone = "America/Tegucigalpa",
  now?: Date,
): string | null {
  const lower = safeStr(text, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\b(meanana|menana|maniana|mañan)\b/g, "manana")
    .replace(/\bvierrnes\b|\bvierness\b/g, "viernes")
    .replace(/\bsabdo\b/g, "sabado")
    .replace(/\bmierciles\b/g, "miercoles");
  const baseLocal = getClinicLocalDate(timezone, now);
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
    manana: -2,
    "pasado manana": -3,
  };
  if (/\bhoy\b/.test(lower)) {
    return baseLocal.isoDate;
  }
  const weekdayDayNumber = resolveWeekdayDayNumberDate(lower, timezone, now);
  if (weekdayDayNumber.conflict) return null;
  if (weekdayDayNumber.date) return weekdayDayNumber.date;

  let targetDateIso: string | null = null;
  for (const [dayName, dayNum] of Object.entries(dayMap)) {
    if (!lower.includes(dayName)) continue;
    if (dayNum === -1) {
      targetDateIso = baseLocal.isoDate;
    } else if (dayNum === -2) {
      targetDateIso = addDaysToIsoDate(baseLocal.isoDate, 1);
    } else if (dayNum === -3) {
      targetDateIso = addDaysToIsoDate(baseLocal.isoDate, 2);
    } else {
      const includeToday = new RegExp(`\\b(el|este)\\s+${dayName}\\b`).test(lower);
      const nextImmediate = nextWeekdayFromIsoDate(baseLocal.isoDate, dayNum, includeToday);
      const hasExplicitNextWeek = new RegExp(`\\b(el otro ${dayName}|el siguiente ${dayName}|${dayName} de la otra semana)\\b`)
        .test(lower);
      targetDateIso = hasExplicitNextWeek ? addDaysToIsoDate(nextImmediate, 7) : nextImmediate;
    }
    break;
  }
  return targetDateIso;
}

export function getClinicLocalDate(timezone: string, now?: Date): {
  isoDate: string;
  weekday: number;
} {
  const base = now ?? new Date(Date.now());
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = dtf.formatToParts(base);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  const wdRaw = (parts.find((p) => p.type === "weekday")?.value ?? "").toLowerCase();
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return {
    isoDate: `${y}-${m}-${d}`,
    weekday: map[wdRaw.slice(0, 3)] ?? new Date(`${y}-${m}-${d}T12:00:00`).getDay(),
  };
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayFromIsoDate(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

function nextWeekdayFromIsoDate(baseIsoDate: string, targetWeekday: number, includeToday: boolean): string {
  const current = weekdayFromIsoDate(baseIsoDate);
  let delta = (targetWeekday - current + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDaysToIsoDate(baseIsoDate, delta);
}

function resolveWeekdayDayNumberDate(
  normalizedText: string,
  timezone: string,
  now?: Date,
): { date: string | null; conflict: boolean } {
  const match = normalizedText.match(
    /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+(\d{1,2})\b/,
  );
  if (!match) return { date: null, conflict: false };
  const weekdayMap: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };
  const targetDow = weekdayMap[match[1]];
  const dayNum = Number(match[2]);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) return { date: null, conflict: true };
  // "viernes 3" / "martes 3 pm" are usually weekday + hour, not day-of-month.
  const hasExplicitDateConnector = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+de\s+\d{1,2}\b/.test(
    normalizedText,
  );
  if (!hasExplicitDateConnector && dayNum <= 12) {
    return { date: null, conflict: false };
  }
  const base = getClinicLocalDate(timezone, now);
  const [y, m] = base.isoDate.split("-").map(Number);
  const candidates = [
    new Date(Date.UTC(y, m - 1, dayNum)),
    new Date(Date.UTC(y, m, dayNum)),
  ];
  for (const c of candidates) {
    if (c.getUTCDate() !== dayNum) continue;
    if (c.getUTCDay() !== targetDow) continue;
    return { date: c.toISOString().slice(0, 10), conflict: false };
  }
  return { date: null, conflict: true };
}

function getNowInTimezone(timezone: string): Date {
  const localized = new Date().toLocaleString("en-US", { timeZone: timezone });
  const parsed = new Date(localized);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
}

function formatDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function parseTimeOnlyFromMessage(text: string): string | null {
  const lower = safeStr(text, "").toLowerCase().trim()
    .replace(/\ba la una\b|\ba la 1\b|\ba las una\b/g, "a las 1")
    .replace(/\ba las dos\b/g, "a las 2")
    .replace(/\ba las tres\b/g, "a las 3")
    .replace(/\ba las cuatro\b/g, "a las 4")
    .replace(/\ba las cinco\b/g, "a las 5")
    .replace(/\ba las seis\b/g, "a las 6")
    .replace(/\ba las siete\b/g, "a las 7")
    .replace(/\ba las ocho\b/g, "a las 8")
    .replace(/\ba las nueve\b/g, "a las 9")
    .replace(/\ba las diez\b/g, "a las 10")
    .replace(/\ba las once\b/g, "a las 11")
    .replace(/\ba las doce\b/g, "a las 12");
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!timeMatch) return null;
  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2] ?? "0", 10);
  const ampm = timeMatch[3];
  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;
  if (!ampm && hours >= 1 && hours <= 7) hours += 12;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isFirstSlotSelectionText(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(la primera|el primero|la primera opcion|la primera opción)\b/.test(normalized);
}

function getSlotOrdinalSelection(text: string): number | null {
  const normalized = normalizeTextForIntent(text);
  if (/\b(la primera|el primero|primera opcion|primera opción)\b/.test(normalized)) return 0;
  if (/\b(la segunda|el segundo|segunda opcion|segunda opción)\b/.test(normalized)) return 1;
  if (/\b(la tercera|el tercero|tercera opcion|tercera opción)\b/.test(normalized)) return 2;
  return null;
}

function isLastSlotSelectionText(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(la ultima|la última|la de mas tarde|la de más tarde)\b/.test(normalized);
}

function isMoreSlotsRequestText(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(mas tarde|más tarde|ver mas|ver más|otros horarios|despues|después|la tarde|en la tarde)\b/.test(normalized);
}

function isEarlierSlotsRequestText(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(mas temprano|más temprano|temprano)\b/.test(normalized);
}

function isOtherHourRequestText(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(otra hora|otro horario|otros horarios|ver mas|ver más)\b/.test(normalized);
}

function isMorningSlotsRequestText(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(en la manana|en la mañana|por la manana|por la mañana|manana)\b/.test(normalized);
}

function isAfternoonSlotsRequestText(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(en la tarde|por la tarde|tarde)\b/.test(normalized);
}

function isLikelySlotSelectionText(input: string): boolean {
  return Boolean(
    parseTimeOnlyFromMessage(input) ||
      isFirstSlotSelectionText(input) ||
      isLastSlotSelectionText(input) ||
      getSlotOrdinalSelection(input) !== null ||
      /\bla de las?\s+\d{1,2}(:\d{2})?\b/i.test(normalizeTextForIntent(input)),
  );
}

function parseAfterTimeThreshold(text: string): string | null {
  const normalized = normalizeTextForIntent(text);
  if (!/\bdespues de las\b/.test(normalized)) return null;
  return parseTimeOnlyFromMessage(normalized);
}

function toMinutes(time: string): number {
  const [hRaw, mRaw] = safeStr(time, "").split(":");
  const h = Number(hRaw);
  const m = Number(mRaw ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  return h * 60 + m;
}

function isSevereEmergencyText(text: string): boolean {
  const lower = safeStr(text, "").toLowerCase();
  const severePatterns = [
    "no puedo respirar",
    "sangrado que no para",
    "accidente fuerte",
    "hinchazon en garganta",
    "hinchazón en garganta",
    "muchisima sangre",
    "muchísima sangre",
  ];
  return severePatterns.some((p) => lower.includes(p));
}

function hasSymptomEmergencySignal(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(dolor de muela|me duele una muela|me duele la encia|me duele la enci|cara inflamada|inflamacion|no aguanto el dolor|sangrado|absceso|diente quebrado|sigo con dolor|por la inflamacion)\b/
    .test(normalized);
}

function isAppointmentDetailsRequest(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(revisarla|verla|revisar|ver mi cita|detalles|detalles de la cita|confirmar detalles)\b/.test(normalized);
}

function isAdditionalAppointmentRequest(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(otra cita|cita adicional|adicional|para mi hijo|para mi hija|para mi esposa|para mi esposo)\b/.test(normalized);
}

function isAddToCurrentAppointmentRequest(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(agregarlo a mi cita|agregar a mi cita|anotalo en mi cita|sumalo a mi cita|agregalo a esa cita|agregar a esa cita)\b/
    .test(normalized);
}

function isRescheduleSoonerRequest(text: string): boolean {
  const normalized = normalizeTextForIntent(text);
  return /\b(buscar mas pronto|buscar más pronto|mas pronto|más pronto|cambiarla|cambiar mi cita|reagendar|reagenda|moverla|otro horario)\b/
    .test(normalized);
}

function resolveActiveAppointmentSummary(activeAppointment: Record<string, unknown>): {
  service: string;
  dateLabel: string;
  timeLabel: string;
} {
  const service = safeStr(
    activeAppointment.reason,
    safeStr(activeAppointment.service, safeStr(activeAppointment.title, "Revisión dental")),
  ).trim() || "Revisión dental";
  const appointmentDate = safeStr(activeAppointment.appointment_date, "").trim();
  const appointmentTime = safeStr(activeAppointment.appointment_time, "").trim();
  if (appointmentDate || appointmentTime) {
    return {
      service,
      dateLabel: appointmentDate ? formatHumanDay(appointmentDate) : "la fecha programada",
      timeLabel: appointmentTime ? formatHourLabel(appointmentTime) : "la hora programada",
    };
  }
  const startsAt = safeStr(activeAppointment.starts_at, safeStr(activeAppointment.start_at, ""));
  let dateLabel = "";
  let timeLabel = "";
  if (startsAt) {
    const d = new Date(startsAt);
    if (!Number.isNaN(d.valueOf())) {
      dateLabel = d.toLocaleDateString("es-HN", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      timeLabel = d.toLocaleTimeString("es-HN", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
  }
  if (!dateLabel) {
    const dateIso = safeStr(activeAppointment.appointment_date, "");
    if (dateIso) dateLabel = formatHumanDay(dateIso);
  }
  if (!timeLabel) {
    const time24 = safeStr(activeAppointment.appointment_time, "");
    if (time24) timeLabel = formatHourLabel(time24);
  }
  if (!dateLabel) dateLabel = "la fecha programada";
  if (!timeLabel) timeLabel = "la hora programada";
  return { service, dateLabel, timeLabel };
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
  }) +
    `, ${
      parsed.toLocaleTimeString("es-HN", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    }`;
}

function formatHumanDay(dateValue: string): string {
  if (!dateValue) return "ese día";
  const parsed = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(parsed.valueOf())) return dateValue;
  return parsed.toLocaleDateString("es-HN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatHourLabel(time24: string): string {
  const [hRaw, mRaw] = time24.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time24;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatAtHourLabel(timeLabel: string): string {
  return /^1:/.test(safeStr(timeLabel, "").trim()) ? `a la ${timeLabel}` : `a las ${timeLabel}`;
}

export function extractName(message: string): string | null {
  let cleaned = safeStr(message, "").trim();
  if (!cleaned) return null;

  cleaned = cleaned
    .replace(
      /^(hola|buenas|buenos dias|buen día|buenas tardes|buenas noches|hello|hi|hey)\s+/i,
      "",
    )
    .replace(/^(me llamo|soy|mi nombre es|i'm|my name is|i am)\s+/i, "")
    .replace(/[.,!?]+$/g, "")
    .trim();

  const rejected = [
    "hola",
    "hols",
    "hol",
    "ola",
    "ols",
    "holaa",
    "holaaa",
    "buenas",
    "bueenas",
    "wenas",
    "wuenas",
    "guenas",
    "buenos dias",
    "buen dia",
    "buenas tardes",
    "buenas noches",
    "saludos",
    "buen día",
    "que tal",
    "q tal",
    "buenos",
    "como estas",
    "como andas",
    "hola buenas",
    "que hay",
    "hello",
    "hi",
    "hey",
    "good morning",
    "good afternoon",
    "sup",
    "yo",
    "si",
    "sí",
    "ok",
    "dale",
    "no",
    "gracias",
    "vale",
    "claro",
    "por favor",
    "porfa",
    "ya",
    "listo",
    "bueno",
    "okey",
    "okay",
    "bien",
    "mal",
    "mas o menos",
    "regular",
    "info",
    "información",
    "quiero",
    "necesito",
    "busco",
    "tengo",
    "pregunta",
    "ayuda",
    "help",
    "cita",
    "consulta",
    "limpieza",
    "precio",
    "precios",
    "horario",
    "horarios",
    "agendar",
    "reservar",
    "turno",
    "disponibilidad",
    "ortodoncia",
    "implante",
    "implantes",
    "blanqueamiento",
    "extracción",
    "extraccion",
    "corona",
    "endodoncia",
    "caries",
    "como funciona",
    "que hacen",
    "que ofrecen",
    "cuanto cuesta",
    "estan abiertos",
    "donde estan",
    "que servicios",
    "a",
    "e",
    "o",
    "u",
    "y",
    "x",
    "q",
  ];
  if (rejected.includes(cleaned.toLowerCase())) return null;
  if (cleaned.includes("?")) return null;
  if (cleaned.includes("¿")) return null;
  if (cleaned.split(/\s+/).length === 1 && cleaned.length < 3) return null;

  if (cleaned.length < 2 || cleaned.length > 50) return null;
  if (/\d{3,}/.test(cleaned)) return null;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return null;

  const validWords = words.every((word) =>
    /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’-]+$/.test(word)
  );
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
  const metaProfileLookupAttempted = Boolean(
    (state as any)?.meta_profile_lookup_attempted,
  );

  if (hasCollectedName(state)) return null;
  if (usesMetaProfile && !metaProfileLookupAttempted) return null;

  if (!asked.full_name) {
    asked.full_name = true;
    return {
      replyText:
        "¡Hola! 👋 Bienvenido/a a nuestra clínica dental. ¿Cómo te llamas?",
      statePatch: {
        asked,
        nextExpected: "full_name",
        lastIntent: "ask_name",
      },
      debug: {
        intent: "ask_name",
        phase: state.stage ?? "DISCOVERY",
        route: "name_gate",
      },
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
        debug: {
          intent: "provide_name",
          phase: state.stage ?? "DISCOVERY",
          route: "name_capture",
        },
      };
    }
    return {
      replyText: "No logré captar tu nombre 😅 ¿Me lo puedes repetir?",
      statePatch: {
        asked,
        nextExpected: "full_name",
        lastIntent: "ask_name_retry",
      },
      debug: {
        intent: "ask_name_retry",
        phase: state.stage ?? "DISCOVERY",
        route: "name_retry",
      },
    };
  }

  return null;
}

export function runConversationEngine(args: {
  organizationId: string;
  leadId?: string;
  channelUserId?: string | null;
  leadState: ConversationState | null;
  inboundText: string;
  channel?: string;
  knowledge?: Record<string, unknown>;
  clinicKnowledge?: Record<string, unknown>;
  clinicSettings?: Record<string, unknown>;
  businessType?: string | null;
  dentalInterpreterResult?: DentalInterpreterResult | null;
  barbershopInterpreterResult?: BarbershopInterpretedTurn | null;
}): ConversationResult | null {
  const text = normalizeText(args.inboundText);
  if (!text) return null;

  const resolvedBusinessType = safeStr(
    args.businessType,
    safeStr(args.clinicSettings?.business_type, safeStr(args.leadState?.orgType, "")),
  );
  const orgType = determineOrgType(args.organizationId, resolvedBusinessType);
  const responses: any = getResponses(orgType);
  const state: ConversationState = {
    stage: "INITIAL",
    orgType,
    collected: {},
    asked: {},
    ...(args.leadState ?? {}),
  };
  const collected = (state.collected ?? {}) as Record<string, unknown>;
  if (orgType === "dental" && isStateCorrectionText(args.inboundText)) {
    const cleaned = clearActiveBookingState({
      stage: "BOOKING",
      lastIntent: "book_appointment",
      nextExpected: "date_time",
      collected: { ...collected },
    });
    return {
      replyText: "Tenés razón. ¿Qué día y hora preferís para revisar disponibilidad?",
      statePatch: cleaned,
      debug: { intent: "book_appointment", phase: "BOOKING", route: "state_correction_reset_datetime" },
    };
  }
  if (orgType !== "insurance") {
    const nameCapture = maybeHandleNameCapture({
      organizationId: args.organizationId,
      leadState: state,
      inboundText: args.inboundText,
      channel: args.channel,
    });
    if (nameCapture) return nameCapture;
  }

  const needsName = !hasCollectedName(state);
  const normalizedIntentText = normalizeTextForIntent(text);
  const intent = detectIntent(normalizedIntentText, { nextExpected: state.nextExpected });
  const deterministicDentalInterpretation = orgType === "dental"
    ? classifyDentalDeterministic(args.inboundText)
    : null;
  const activeDentalInterpretation = orgType === "dental"
    ? (
      (args.dentalInterpreterResult && args.dentalInterpreterResult.confidence >= 0.65
        ? args.dentalInterpreterResult
        : (deterministicDentalInterpretation && deterministicDentalInterpretation.confidence >= 0.75
          ? deterministicDentalInterpretation
          : null))
    )
    : null;
  const triage = orgType === "dental" && activeDentalInterpretation?.intent === "book_appointment" &&
      activeDentalInterpretation.service_suggestion
    ? {
      matched: true,
      category: activeDentalInterpretation.clinical_category,
      service_suggestion: activeDentalInterpretation.service_suggestion,
      urgency: activeDentalInterpretation.urgency === "emergency"
        ? "urgent"
        : activeDentalInterpretation.urgency,
      symptoms: activeDentalInterpretation.symptoms,
      safe_reply_hint: safeStr(activeDentalInterpretation.safe_reply_hint, ""),
      should_book: true,
      date: activeDentalInterpretation.date,
      time: activeDentalInterpretation.time,
    }
    : (orgType === "dental" ? classifyDentalPatientMessage(args.inboundText) : null);
  console.log(JSON.stringify({
    event: "intent_detected",
    stage_before: state.stage ?? null,
    intent: intent.intent,
  }));
  const lowerText = text.trim().toLowerCase();
  const isYes =
    /^(s[ií]|si|yes|ok|dale|claro|confirmo|confirmar|perfecto|listo)\b/i.test(lowerText);
  const isNo = /^(no|cancel|cambiar|otra)\b/i.test(lowerText);
  if (/quiero empezar de nuevo/i.test(text)) {
    return {
      replyText: "Perfecto, empezamos de nuevo 😊 ¿En qué te ayudo hoy?",
      statePatch: {
        stage: "DISCOVERY",
        lastIntent: "reset_requested",
        nextExpected: undefined,
        collected: {},
      },
      debug: { intent: "reset", phase: "DISCOVERY", route: "explicit_reset" },
    };
  }

  if (orgType === "insurance") {
    const insuranceServices = getInsuranceServiceOptions(args.clinicSettings?.services);
    const insuranceTypeList = buildInsuranceTypeList(insuranceServices);
    const existingInsurance = ((collected.insurance ?? {}) as InsuranceCollected);
    const interpreted = interpretInsuranceTurn({
      inboundText: args.inboundText,
      nextExpected: state.nextExpected,
      services: insuranceServices,
      collected: existingInsurance,
    });
    const currentInsurance: InsuranceCollected = {
      ...existingInsurance,
      contacto: { ...(existingInsurance.contacto ?? {}) },
    };
    const channelPhone = safeStr(args.channelUserId, "");
    if (channelPhone && !safeStr(currentInsurance.contacto?.telefono)) {
      currentInsurance.contacto!.telefono = channelPhone;
    }
    if (interpreted.fields_found.tipo_seguro) {
      currentInsurance.tipo_seguro = interpreted.fields_found.tipo_seguro;
      currentInsurance.tipo_seguro_id = interpreted.fields_found.tipo_seguro_id ?? undefined;
    }
    if (interpreted.fields_found.nombre) currentInsurance.contacto!.nombre = interpreted.fields_found.nombre;
    if (interpreted.fields_found.estado) currentInsurance.contacto!.estado = interpreted.fields_found.estado;
    if (interpreted.fields_found.telefono) currentInsurance.contacto!.telefono = interpreted.fields_found.telefono;
    if (interpreted.fields_found.email) currentInsurance.contacto!.email = interpreted.fields_found.email;
    if (interpreted.fields_found.seguro_actual) currentInsurance.seguro_actual = interpreted.fields_found.seguro_actual;
    if (interpreted.fields_found.presupuesto) currentInsurance.presupuesto = interpreted.fields_found.presupuesto;
    if (
      safeStr(state.nextExpected, "") === "insurance_preferred_time" &&
      interpreted.fields_found.horario_preferido
    ) {
      currentInsurance.horario_preferido = interpreted.fields_found.horario_preferido;
    }

    const contactMissing = ["nombre", "estado", "email"].filter((field) =>
      !safeStr((currentInsurance.contacto as Record<string, unknown> | undefined)?.[field])
    );
    const baseCollected = { ...collected, insurance: currentInsurance };
    const stateBase = {
      stage: "DISCOVERY" as Stage,
      orgType: "insurance" as const,
      collected: baseCollected,
    };

    if (interpreted.intent === "restart") {
      return {
        replyText: insuranceTypeList?.body ?? composeInsuranceTypePrompt(insuranceServices),
        interactiveList: insuranceTypeList,
        statePatch: {
          ...stateBase,
          collected: { ...collected, insurance: {} },
          lastIntent: "insurance_restart",
          nextExpected: "insurance_type",
        },
        debug: { intent: "restart", phase: "DISCOVERY", route: "insurance_restart" },
      };
    }

    if (!safeStr(currentInsurance.tipo_seguro)) {
      return {
        replyText: insuranceTypeList?.body ?? composeInsuranceTypePrompt(insuranceServices),
        interactiveList: insuranceTypeList,
        statePatch: {
          ...stateBase,
          lastIntent: "insurance_type",
          nextExpected: "insurance_type",
        },
        debug: { intent: interpreted.intent, phase: "DISCOVERY", route: "insurance_ask_type" },
      };
    }

    if (contactMissing.includes("nombre")) {
      return {
        replyText: composeInsuranceContactPrompt(safeStr(currentInsurance.tipo_seguro)),
        statePatch: {
          ...stateBase,
          lastIntent: "insurance_name",
          nextExpected: "insurance_name",
        },
        debug: { intent: interpreted.intent, phase: "DISCOVERY", route: "insurance_ask_name" },
      };
    }

    if (contactMissing.includes("estado")) {
      return {
        replyText: composeInsuranceLocationPrompt(),
        statePatch: {
          ...stateBase,
          lastIntent: "insurance_location",
          nextExpected: "insurance_location",
        },
        debug: { intent: interpreted.intent, phase: "DISCOVERY", route: "insurance_ask_location" },
      };
    }

    if (contactMissing.includes("email")) {
      return {
        replyText: composeInsuranceEmailPrompt(),
        statePatch: {
          ...stateBase,
          lastIntent: "insurance_email",
          nextExpected: "insurance_email",
        },
        debug: { intent: interpreted.intent, phase: "DISCOVERY", route: "insurance_ask_email" },
      };
    }

    if (!currentInsurance.seguro_actual) {
      return {
        replyText: composeInsuranceCurrentCoveragePrompt(),
        interactiveButtons: buildInsuranceCurrentCoverageButtons(),
        statePatch: {
          ...stateBase,
          lastIntent: "insurance_current",
          nextExpected: "insurance_current",
        },
        debug: { intent: interpreted.intent, phase: "QUALIFICATION", route: "insurance_ask_current" },
      };
    }

    if (!safeStr(currentInsurance.presupuesto)) {
      return {
        replyText: composeInsuranceBudgetPrompt(),
        interactiveButtons: buildInsuranceBudgetButtons(),
        statePatch: {
          ...stateBase,
          lastIntent: "insurance_budget",
          nextExpected: "insurance_budget",
        },
        debug: { intent: interpreted.intent, phase: "QUALIFICATION", route: "insurance_ask_budget" },
      };
    }

    if (!safeStr(currentInsurance.horario_preferido)) {
      return {
        replyText: composeInsurancePreferredTimePrompt(),
        interactiveButtons: buildInsurancePreferredTimeButtons(),
        statePatch: {
          ...stateBase,
          lastIntent: "insurance_preferred_time",
          nextExpected: "insurance_preferred_time",
        },
        debug: { intent: interpreted.intent, phase: "QUALIFICATION", route: "insurance_ask_preferred_time" },
      };
    }

    const scoring = calculateInsuranceScoring(currentInsurance);
    const savedInsurance: InsuranceCollected = {
      ...currentInsurance,
      scoring,
      saved: true,
    };
    return {
      replyText: composeInsuranceConfirmation({
        typeName: safeStr(savedInsurance.tipo_seguro),
        contact: (savedInsurance.contacto ?? {}) as Record<string, unknown>,
        currentInsurance: formatInsuranceCurrentCoverageForCopy(savedInsurance.seguro_actual),
        budget: safeStr(savedInsurance.presupuesto),
        preferredTime: safeStr(savedInsurance.horario_preferido),
        priority: scoring.prioridad,
      }),
      statePatch: {
        stage: "CLOSED",
        orgType: "insurance",
        collected: { ...collected, insurance: savedInsurance },
        lastIntent: "insurance_confirmed",
        nextExpected: undefined,
      },
      debug: { intent: interpreted.intent, phase: "CLOSED", route: "insurance_saved_confirmed" },
    };
  }

  if (orgType === "barbershop") {
    const normalizedInbound = normalizeInboundRuntime({
      inboundText: args.inboundText,
      channel: args.channel ?? "unknown",
      payloadAction: null,
    });
    console.log(JSON.stringify({
      event: "barbershop:normalized_inbound",
      normalized_inbound: normalizedInbound,
    }));
    const bookingCollected = { ...collected };
    const shadowEnabled = isEnabledFlag(args.clinicSettings?.barbershop_interpreter_shadow_enabled);
    const runtimeEnabled = isEnabledFlag(args.clinicSettings?.barbershop_interpreter_runtime_enabled);
    const semanticFallbackEnabled = Boolean((args.barbershopInterpreterResult as any)?.semantic);
    const runtimeMinConfidence = 0.6;
    const protectedNextExpectedSet = new Set([
      "confirm_booking",
      "confirm_cancel_appointment",
      "confirm_reschedule_appointment",
      "confirm_discard_pending_booking",
      "active_appointment_intent_choice",
    ]);
    const nextExpectedValue = safeStr(state.nextExpected, "").trim();
    const isProtectedState = protectedNextExpectedSet.has(nextExpectedValue);
    const isCleanConfirmation = isCleanConfirmationText(args.inboundText);
    const isCleanButtonPayload = /^\s*__[^_]+/.test(safeStr(args.inboundText, ""));
    const llmRuntime = getBarbershopInterpreterRuntimeStatus();
    console.log(JSON.stringify({
      event: "barbershop:b4_interpreter_before",
      organization_id: args.organizationId ?? null,
      runtime_enabled: runtimeEnabled,
      shadow_enabled: shadowEnabled,
      inbound_text: args.inboundText ?? null,
      business_type: "barbershop",
      llm_provider: llmRuntime.provider,
      has_groq_key: llmRuntime.has_groq_key,
      has_openai_key: llmRuntime.has_openai_key,
      llm_available: llmRuntime.llm_available,
      llm_interpreter_enabled: runtimeEnabled || shadowEnabled,
    }));
    const interpreterResult = args.barbershopInterpreterResult ?? null;
    const interpreterDebug = interpreterResult && (shadowEnabled || runtimeEnabled || semanticFallbackEnabled)
      ? {
        mode: (runtimeEnabled || semanticFallbackEnabled ? "runtime" : "shadow") as "shadow" | "runtime",
        intent: interpreterResult.intent,
        confidence: interpreterResult.confidence,
        entities: (interpreterResult.entities ?? {}) as Record<string, unknown>,
        needs_tool: interpreterResult.needs_tool,
        next_step: safeStr((interpreterResult as unknown as Record<string, unknown>).next_step, ""),
        tool_needed: safeStr((interpreterResult as unknown as Record<string, unknown>).tool_needed, ""),
        user_facing_summary: interpreterResult.user_facing_summary,
      }
      : null;
    const withInterpreterDebug = (
      debug: { intent: string; phase: string; route: string },
      mode: "shadow" | "runtime" = "shadow",
    ) => {
      if (!interpreterDebug) return debug;
      return {
        ...debug,
        barbershop_interpreter: {
          ...interpreterDebug,
          mode,
        },
      };
    };
    const routedIntent = classifyBarbershopIntent({
      text: args.inboundText,
      nextExpected: state.nextExpected,
    });
    const runtimeRaw = (interpreterResult ?? {}) as Record<string, unknown>;
    const runtimeEntities = ((runtimeRaw.entities ?? {}) as Record<string, unknown>);
    const runtimeConfidence = Number(runtimeRaw.confidence ?? 0);
    const runtimeIntentRaw = safeStr(runtimeRaw.intent, "").trim().toLowerCase();
    const runtimeIntentMapped = runtimeIntentRaw === "availability_request"
      ? "availability_question"
      : runtimeIntentRaw === "availability_question"
      ? "availability_question"
      : runtimeIntentRaw === "pricing_request"
      ? "pricing_question"
      : runtimeIntentRaw === "pricing_question"
      ? "pricing_question"
      : runtimeIntentRaw === "product_request"
      ? "product_question"
      : runtimeIntentRaw === "product_question"
      ? "product_question"
      : runtimeIntentRaw === "appointment_lookup"
      ? "appointment_lookup"
      : runtimeIntentRaw === "cancel_request"
      ? "cancel_request"
      : runtimeIntentRaw === "cancel_appointment"
      ? "cancel_request"
      : runtimeIntentRaw === "reschedule_request"
      ? "reschedule_request"
      : runtimeIntentRaw === "reschedule_appointment"
      ? "reschedule_request"
      : runtimeIntentRaw === "booking_request"
      ? "booking_request"
      : runtimeIntentRaw === "location_question"
      ? "location_question"
      : runtimeIntentRaw === "business_hours_question"
      ? "business_hours_question"
      : runtimeIntentRaw === "services_question"
      ? "services_question"
      : runtimeIntentRaw === "out_of_scope"
      ? "out_of_scope"
      : runtimeIntentRaw === "appointment_lookup"
      ? "appointment_lookup"
      : "unknown";
    const runtimeNextStep = safeStr(runtimeRaw.next_step, "").trim().toLowerCase();
    const runtimeToolNeeded = safeStr(runtimeRaw.tool_needed, "").trim().toLowerCase();
    const runtimeServiceNameRaw = safeStr(
      runtimeRaw.service,
      safeStr(runtimeEntities.service, safeStr(runtimeEntities.service_name, "")),
    ).trim();
    const runtimeDateTextRaw = safeStr(
      runtimeRaw.date,
      safeStr(runtimeEntities.date, safeStr(runtimeEntities.date_text, "")),
    ).trim();
    const runtimeTimeTextRaw = safeStr(
      runtimeRaw.time,
      safeStr(runtimeEntities.time, safeStr(runtimeEntities.time_text, "")),
    ).trim();
    const runtimeProviderPrefRaw = safeStr(
      runtimeRaw.provider_preference,
      safeStr(runtimeEntities.provider_preference, ""),
    ).trim().toLowerCase();
    const runtimeProviderNameRaw = safeStr(
      runtimeRaw.provider_name,
      safeStr(runtimeEntities.provider_name, safeStr(runtimeEntities.preferred_barber, "")),
    ).trim();
    const hasDeterministicDateTime = Boolean(parseDateTimeFromMessage(args.inboundText, safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa")));
    const hasDeterministicService = Boolean(resolveBarbershopServiceFromSettings(args.inboundText, args.clinicSettings) ?? detectBarbershopService(args.inboundText).matchedService);
    const deterministicCompleteBooking = hasDeterministicDateTime && hasDeterministicService;
    const runtimeCandidateIntent = runtimeIntentMapped;
    const hasRuntimeValidSignal = Boolean(
      runtimeCandidateIntent !== "unknown" ||
        runtimeNextStep === "show_availability" ||
        runtimeNextStep === "lookup_active_appointment" ||
        runtimeNextStep === "start_cancel_confirmation" ||
        runtimeNextStep === "preconfirm_booking" ||
        runtimeToolNeeded === "check_availability" ||
        runtimeToolNeeded === "get_active_appointment" ||
        runtimeToolNeeded === "book_appointment",
    );
    const runtimeEligibleForPrimary = Boolean(
      (runtimeEnabled || semanticFallbackEnabled) &&
        interpreterResult &&
        !isCleanConfirmation &&
        !isCleanButtonPayload &&
        !isProtectedState,
    );
    const shouldUseRuntimeInterpreter = Boolean(
      runtimeEligibleForPrimary &&
      Number.isFinite(runtimeConfidence) &&
      runtimeConfidence >= runtimeMinConfidence &&
      hasRuntimeValidSignal,
    );
    console.log(JSON.stringify({
      event: "barbershop:b4_interpreter_after",
      organization_id: args.organizationId ?? null,
      inbound_text: args.inboundText ?? null,
      interpreter_called: Boolean(interpreterResult),
      interpreter_error: interpreterResult ? null : "not_available",
      intent: runtimeIntentMapped || "unknown",
      confidence: Number.isFinite(runtimeConfidence) ? runtimeConfidence : null,
      fields_found: (typeof runtimeRaw.fields_found === "object" && runtimeRaw.fields_found !== null) ? runtimeRaw.fields_found : null,
      next_step: runtimeNextStep || null,
      tool_needed: runtimeToolNeeded || null,
      used_for_routing: shouldUseRuntimeInterpreter,
      llm_provider: llmRuntime.provider,
      has_groq_key: llmRuntime.has_groq_key,
      has_openai_key: llmRuntime.has_openai_key,
      llm_available: llmRuntime.llm_available,
    }));
    if (shouldUseRuntimeInterpreter) {
      console.log(JSON.stringify({
        event: "barbershop:b4_old_parser_skipped",
        inbound_text: args.inboundText ?? null,
        reason: "llm_runtime_primary",
        intent: runtimeIntentMapped || "unknown",
        next_step: runtimeNextStep || null,
        tool_needed: runtimeToolNeeded || null,
      }));
      if (semanticFallbackEnabled) {
        console.log(JSON.stringify({
          event: "barbershop_semantic_interpreter_routed",
          inbound_text: args.inboundText ?? null,
          intent: runtimeIntentMapped || "unknown",
          confidence: Number.isFinite(runtimeConfidence) ? runtimeConfidence : null,
        }));
      }
    } else {
      const fallbackReason = !runtimeEnabled
        ? "runtime_disabled"
        : !interpreterResult
        ? "interpreter_missing"
        : isProtectedState
        ? "protected_state"
        : isCleanConfirmation
        ? "clean_confirmation"
        : isCleanButtonPayload
        ? "button_payload"
        : !Number.isFinite(runtimeConfidence) || runtimeConfidence < runtimeMinConfidence
        ? "low_confidence"
        : !hasRuntimeValidSignal
        ? "invalid_runtime_signal"
        : "deterministic_fallback";
      console.log(JSON.stringify({
        event: "barbershop:b4_old_parser_fallback",
        inbound_text: args.inboundText ?? null,
        reason: fallbackReason,
        fallback_reason: fallbackReason,
      }));
      if (semanticFallbackEnabled && (!Number.isFinite(runtimeConfidence) || runtimeConfidence < runtimeMinConfidence)) {
        console.log(JSON.stringify({
          event: "barbershop_semantic_interpreter_low_confidence",
          inbound_text: args.inboundText ?? null,
          confidence: Number.isFinite(runtimeConfidence) ? runtimeConfidence : null,
        }));
      }
    }
    if (
      runtimeEligibleForPrimary &&
      interpreterResult &&
      Number.isFinite(runtimeConfidence) &&
      runtimeConfidence > 0 &&
      runtimeConfidence < runtimeMinConfidence &&
      routedIntent === "unknown"
    ) {
      return {
        replyText: semanticFallbackEnabled
          ? "Por ahora solo te puedo ayudar con citas, precios, horarios y ubicación de la barbería 💈\n\n¿Querés agendar o ver precios?"
          : "Te ayudo de una. ¿Querés agendar cita, ver horarios, consultar precios o revisar una cita que ya tenés?",
        statePatch: {
          stage: safeStr(state.stage, "DISCOVERY"),
          lastIntent: "clarify",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({
          intent: "unknown",
          phase: safeStr(state.stage, "DISCOVERY"),
          route: semanticFallbackEnabled ? "barbershop_semantic_low_confidence_out_of_scope" : "barbershop_runtime_low_confidence_clarify",
        }, "runtime"),
      };
    }
    const runtimeIntent = shouldUseRuntimeInterpreter ? runtimeCandidateIntent : "unknown";
    const runtimeServiceName = shouldUseRuntimeInterpreter ? runtimeServiceNameRaw : "";
    const runtimeDateText = shouldUseRuntimeInterpreter ? runtimeDateTextRaw : "";
    const runtimeTimeText = shouldUseRuntimeInterpreter ? runtimeTimeTextRaw : "";
    const rawFieldsFound = (runtimeRaw as Record<string, unknown>).fields_found;
    const runtimeFieldsFound = (typeof rawFieldsFound === "object" && rawFieldsFound !== null)
      ? (rawFieldsFound as Record<string, unknown>)
      : {};
    const runtimeFieldService = safeStr(runtimeFieldsFound.service, runtimeServiceNameRaw).trim();
    const runtimeFieldDate = safeStr(runtimeFieldsFound.date, runtimeDateTextRaw).trim();
    const runtimeFieldTime = safeStr(runtimeFieldsFound.time, runtimeTimeTextRaw).trim();
    const runtimeFieldProviderPref = safeStr(
      runtimeFieldsFound.provider_preference,
      runtimeProviderPrefRaw,
    ).trim().toLowerCase();
    const runtimeDateTime = runtimeDateText || runtimeTimeText
      ? parseDateTimeFromMessage(`${runtimeDateText} ${runtimeTimeText}`.trim(), safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa"))
      : null;
    const repairedInboundText = normalizeTextForIntent(args.inboundText);
    const bookingContext = extractBarbershopBookingContext(bookingCollected);
    const _infoContext = extractBarbershopInfoContext(bookingCollected);
    const serviceDetection = detectBarbershopService(repairedInboundText);
    const genericGrooming = isGenericGroomingExpression(args.inboundText);
    const detectedServiceFromSettings = resolveBarbershopServiceFromSettings(
      repairedInboundText,
      args.clinicSettings,
    );
    const runtimeDetectedService = runtimeServiceName
      ? (
        resolveBarbershopServiceFromSettings(runtimeServiceName, args.clinicSettings)
          ? {
            name: resolveBarbershopServiceFromSettings(runtimeServiceName, args.clinicSettings)!.name,
            durationMinutes: resolveBarbershopServiceFromSettings(runtimeServiceName, args.clinicSettings)!.durationMin,
            basePriceHnl: resolveBarbershopServiceFromSettings(runtimeServiceName, args.clinicSettings)!.price,
          }
          : detectBarbershopService(runtimeServiceName).matchedService
      )
      : null;
    const detectedService = detectedServiceFromSettings
      ? {
        name: detectedServiceFromSettings.name,
        durationMinutes: detectedServiceFromSettings.durationMin,
        basePriceHnl: detectedServiceFromSettings.price,
      }
      : (serviceDetection.matchedService ?? runtimeDetectedService);
    const effectiveDetectedService = genericGrooming && !isPricingQuestion(args.inboundText)
      ? null
      : detectedService;
    const timezone = safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa");
	    const parsedDateTime = parseDateTimeFromMessage(repairedInboundText, timezone);
	    const parsedDateOnly = parseDateOnlyFromMessage(repairedInboundText, timezone);
	    const parsedTimeOnly = parseTimeOnlyFromMessage(repairedInboundText);
	    const currentServiceName = safeStr(
	      (bookingCollected as any).current_service_name,
	      safeStr((bookingCollected as any).service, safeStr((bookingCollected as any).current_service_key, "")),
	    ).trim();
	    const currentServiceKey = safeStr((bookingCollected as any).current_service_key, "").trim();
	    const currentDate = safeStr((bookingCollected as any).current_date, safeStr((bookingCollected as any).preferred_date, "")).trim();
	    const hasActiveBookingStateContract = Boolean((bookingCollected as any).activeBookingFlow) ||
	      ["select_day", "select_time"].includes(safeStr((bookingCollected as any).lastBookingStep, ""));
	    const currentServiceForTimeRequest = currentServiceName || safeStr((bookingCollected as any)?.pending_booking?.service_name, "");
	    const hasBarberMention = /\bcon\s+[a-z]+\b/i.test(repairedInboundText);
    const runtimeAnyProvider = runtimeProviderPrefRaw === "any";
    const runtimeSpecificProvider = runtimeProviderPrefRaw === "specific";
    const hasAnyBarberPreference = isAnyBarberPreferenceText(args.inboundText) || runtimeAnyProvider;
    const wantsSameBarber = isSameBarberReferenceText(args.inboundText);
    const asksAgendaLink = isAgendaLinkRequestText(args.inboundText);
    const isVagueTime = isVagueTimePreferenceText(args.inboundText);
    const hasActivePreconfirm = safeStr((bookingCollected as any).last_bot_step, "") === "barbershop_preconfirm";
    const hasPendingBooking = Boolean((bookingCollected as any).pending_booking);
    const pendingIsStale = Boolean((bookingCollected as any).pending_booking_stale);
    const pendingAction = getPendingActionFromBarbershopCollected(state.nextExpected, bookingCollected);
    const rememberedBarber = safeStr(
      (bookingCollected as any).preferred_barber,
      safeStr(((bookingCollected as any).last_confirmed_appointment ?? {})?.preferred_barber, ""),
    ).trim();
    const hasValidPendingForConfirm = Boolean(
      (bookingCollected as any).pending_booking &&
      !Boolean((bookingCollected as any).pending_booking_stale) &&
      safeStr(((bookingCollected as any).pending_booking ?? {})?.service, "").trim() &&
      safeStr(((bookingCollected as any).pending_booking ?? {})?.appointment_date, "").trim() &&
      safeStr(((bookingCollected as any).pending_booking ?? {})?.appointment_time, "").trim(),
    );
    const activePendingBooking = ((bookingCollected as any).pending_booking ?? null) as Record<string, unknown> | null;
    const inboundMessageId = safeStr((state as any).__inbound_message_id, "").trim();
    const inboundMessageCreatedAt = safeStr((state as any).__inbound_message_created_at, "").trim();
    const pendingCreatedFromInboundMessageId = safeStr(
      activePendingBooking?.created_from_inbound_message_id,
      safeStr((bookingCollected as any).pending_booking_created_from_inbound_message_id, ""),
    ).trim();
    const pendingPreconfirmSentAt = safeStr(
      activePendingBooking?.preconfirm_sent_at,
      safeStr((bookingCollected as any).pending_booking_preconfirm_sent_at, ""),
    ).trim();
    const pendingConfirmationFreshness = isFreshPendingConfirmation({
      inboundMessageId,
      inboundMessageCreatedAt,
      pendingCreatedFromInboundMessageId,
      pendingPreconfirmSentAt,
    });
    const activePendingDate = safeStr(
      activePendingBooking?.appointment_date,
      safeStr((bookingCollected as any).preferred_date, ""),
    ).trim();
    const activePendingTime = safeStr(
      activePendingBooking?.appointment_time,
      safeStr((bookingCollected as any).preferred_time, ""),
    ).trim();
    const activePendingService = safeStr(
      activePendingBooking?.service,
      safeStr((bookingCollected as any).service, "Cita barbería"),
    ).trim() || "Cita barbería";
    const activeAppointment = ((bookingCollected as any).active_appointment ?? null) as Record<string, unknown> | null;
    const hasConfirmedActiveAppointment = Boolean(
      activeAppointment &&
      safeStr(activeAppointment.status, "").toLowerCase() === "confirmed" &&
      safeStr(activeAppointment.id, safeStr(activeAppointment.appointment_id, "")).trim(),
    );
    const pendingThreadStep = safeStr((bookingCollected as any).last_bot_step, "").trim();
    const hasPendingThreadWithoutConfirmation = Boolean(
      !hasConfirmedActiveAppointment &&
      pendingIsStale &&
      activePendingDate &&
      activePendingTime &&
      (
        pendingThreadStep === "barbershop_pending_service_change_recheck" ||
        pendingThreadStep === "barbershop_waiting_new_datetime" ||
        pendingThreadStep === "barbershop_availability_interruption"
      ),
    );
    const hasDiscardablePendingContext = Boolean(
      hasPendingBooking ||
      hasPendingThreadWithoutConfirmation ||
      (
        safeStr(state.nextExpected, "") === "confirm_booking" &&
        hasActivePreconfirm &&
        activePendingDate &&
        activePendingTime
      ),
    );
    const detectedServiceName = safeStr(
      effectiveDetectedService?.name,
      isBarbershopHaircutIntentText(args.inboundText) ? "Corte clásico" : "",
    ).trim();
    const normalizedBarbershopInbound = normalizeTextForIntent(args.inboundText);
    const hasBarbershopGreetingToken = /\b(hola|hey|buenas|buen dia|buenos dias|que tal)\b/.test(normalizedBarbershopInbound);
    const shouldResolveMixedGreeting = intent.intent === "greeting" || hasBarbershopGreetingToken;
    const barbershopLocationQuestion = /\b(donde estan|donde están|donde quedan|donde quedan ubicados|donde estan ubicados|donde están ubicados|ubicacion|ubicación|direccion|dirección)\b/
      .test(normalizedBarbershopInbound);
    const barbershopServicesQuestion = /\b(que servicios tienen|qué servicios tienen|que ofrecen|qué ofrecen|lista de precios|que precios tienen|qué precios tienen)\b/
      .test(normalizedBarbershopInbound);
    const greetingDemotedIntent = shouldResolveMixedGreeting
      ? (
        isCleanConfirmationText(args.inboundText) ? "confirm_booking"
          : routedIntent === "booking_cancel" ? "cancel"
          : routedIntent === "booking_reschedule" ? "reschedule"
          : isPricingQuestion(args.inboundText) || isBarbershopPricingFollowup(args.inboundText) || routedIntent === "pricing_question" ? "pricing_question"
          : barbershopLocationQuestion ? "location_question"
          : isBusinessHoursQuestionText(args.inboundText) ? "business_hours_question"
          : barbershopServicesQuestion ? "services_question"
          : isAvailabilityDiscoveryIntentText(args.inboundText) || isAvailabilityInquiryText(args.inboundText) ? "availability_question"
          : parsedDateTime || parsedDateOnly || parsedTimeOnly || routedIntent === "booking_request" || detectedServiceName ? "booking_request"
          : isBarbershopOutOfScopeText(args.inboundText) ? "out_of_scope"
          : ""
      )
      : "";
    if (greetingDemotedIntent) {
      logBarbershopDiagnostic("greeting_demoted_due_to_stronger_intent", {
        inbound_text: args.inboundText,
        resolved_intent: greetingDemotedIntent,
      });
      logBarbershopDiagnostic("mixed_greeting_intent_resolved", {
        inbound_text: args.inboundText,
        resolved_intent: greetingDemotedIntent,
      });
    }
    const mergedPendingBookingRequest = mergePendingBookingRequest({
      bookingCollected,
      detectedServiceName,
      parsedDate: (parsedDateTime?.date ?? parsedDateOnly ?? null),
      parsedTime: (parsedDateTime?.time ?? parsedTimeOnly ?? null),
      providerName: safeStr(serviceDetection.preferredBarber, "").trim() || (runtimeSpecificProvider ? runtimeProviderNameRaw : null),
      providerPreference: hasAnyBarberPreference ? "any" : (runtimeSpecificProvider ? "specific" : null),
      source: shouldUseRuntimeInterpreter ? "llm_interpreter" : "deterministic",
    });
    console.log(JSON.stringify({
      event: "barbershop:pending_booking_request_before",
      pending_booking_request_before: normalizePendingBookingRequest((bookingCollected as any).pending_booking_request),
    }));
    console.log(JSON.stringify({
      event: "barbershop:interpreter_entities",
      interpreter_entities: {
        service: runtimeFieldService || null,
        date: runtimeFieldDate || null,
        time: runtimeFieldTime || null,
        provider_name: runtimeProviderNameRaw || null,
        provider_preference: runtimeFieldProviderPref || null,
      },
    }));
    console.log(JSON.stringify({
      event: "barbershop:merged_booking_request_after",
      merged_booking_request_after: mergedPendingBookingRequest,
      missing_fields_after: mergedPendingBookingRequest.missing_fields,
    }));
    const runtimeContext = mergeConversationContext({
      normalizedInbound,
      interpreterResult: interpreterResult as unknown as Record<string, unknown> | null,
      leadState: state as unknown as Record<string, unknown>,
      lastBotText: safeStr((bookingCollected as any).last_bot_text, ""),
    });
    const universalIntent = (() => {
      if (isCleanConfirmationText(args.inboundText)) return "confirm_booking";
      if (runtimeContext.route_recommendation === "select_slot" && isLikelySlotSelectionText(args.inboundText)) return "slot_selection";
      if (isAvailabilityDiscoveryIntentText(args.inboundText) || isAvailabilityInquiryText(args.inboundText)) return "availability_discovery";
      if (routedIntent === "booking_request" || runtimeIntent === "booking_request") return "booking_request";
      if (runtimeIntent === "pricing_question" || intent.intent === "pricing") return "pricing_question";
      if (runtimeIntent === "appointment_lookup") return "booking_request";
      if (intent.intent === "greeting") return "greeting";
      if (runtimeContext.has_active_context) return "unknown_inside_active_flow";
      return "unknown_outside_active_flow";
    })();
    const routeDecision = {
      resolved_intent: universalIntent,
      active_flow: runtimeContext.active_flow,
      booking_request: runtimeContext.booking_request,
      missing_fields: runtimeContext.booking_request?.missing_fields ?? [],
      selected_slot: runtimeContext.selected_slot,
      tool_to_call:
        runtimeContext.route_recommendation === "check_availability" || runtimeContext.route_recommendation === "show_availability"
          ? "check_availability"
          : runtimeContext.route_recommendation === "confirm_booking"
          ? "book_appointment"
          : "none",
      response_type: runtimeContext.route_recommendation,
      fallback_mode: runtimeContext.has_active_context ? "unknown_inside_active_flow" : "unknown_outside_active_flow",
      legacy_branch_bypassed: shouldUseRuntimeInterpreter,
    };
    console.log(JSON.stringify({
      event: "barbershop:runtime_path_entered",
      resolved_intent: routeDecision.resolved_intent,
      active_flow: routeDecision.active_flow,
      route_decision: routeDecision,
      tool_to_call: routeDecision.tool_to_call,
      fallback_mode: routeDecision.fallback_mode,
      legacy_branch_bypassed: routeDecision.legacy_branch_bypassed,
    }));
    console.log(JSON.stringify({
      event: "barbershop:context_merge_before",
      nextExpected_before: safeStr(state.nextExpected, ""),
      stage_before: safeStr(state.stage, ""),
      pending_booking_request_before: normalizePendingBookingRequest((bookingCollected as any).pending_booking_request),
    }));
    console.log(JSON.stringify({
      event: "barbershop:context_merge_after",
      context_merge_after: runtimeContext,
    }));

    const hasKnownBarbershopService = Boolean(
      detectedServiceName ||
        safeStr(bookingCollected.service, "").trim() ||
        currentServiceName ||
        safeStr((bookingCollected as any)?.pending_booking?.service_name, "").trim() ||
        safeStr((bookingCollected as any)?.pending_booking_request?.service, "").trim(),
    );
    const globalInfoInterrupt = classifyBarbershopGlobalInfoInterrupt(args.inboundText);
    const globalInfoActiveContext = hasActiveBarbershopBookingContext(state, bookingCollected);
    const globalServicesPriceListQuestion = /\b(precios|servicios|que servicios tienen|qué servicios tienen|lista de precios|que precios tienen|qué precios tienen)\b/
      .test(normalizedBarbershopInbound);
    const shouldSkipGlobalInfoInterrupt = (
      globalInfoInterrupt === "services_prices" &&
      (
        getBarbershopServicesFromSettings(args.clinicSettings).length === 0 ||
        (
          !globalInfoActiveContext &&
          (!globalServicesPriceListQuestion || !/^(precios|servicios)$/.test(normalizedBarbershopInbound))
        )
      )
    ) || (
      !globalInfoActiveContext &&
      (
        globalInfoInterrupt === "location" ||
        (globalInfoInterrupt === "services_prices" && !/^(precios|servicios)$/.test(normalizedBarbershopInbound))
      )
    );
    if (globalInfoInterrupt && !shouldSkipGlobalInfoInterrupt) {
      const pending = ((bookingCollected as any).pending_booking ?? null) as Record<string, unknown> | null;
      const serviceForAvailability = (
        detectedServiceName ||
        safeStr(bookingCollected.service, "").trim() ||
        safeStr((bookingCollected as any).current_service_name, "").trim() ||
        safeStr((bookingCollected as any)?.pending_booking_request?.service, "").trim()
      ).trim();
      const dateForAvailability = (
        parsedDateTime?.date ||
        parsedDateOnly ||
        safeStr((bookingCollected as any).preferred_date, "").trim() ||
        safeStr((bookingCollected as any).current_date, "").trim()
      ).trim();
      const providerForAvailability = (
        safeStr((bookingCollected as any).preferred_barber, "").trim() ||
        safeStr((bookingCollected as any).provider_name, "").trim() ||
        safeStr((bookingCollected as any).preferred_provider_id, "").trim()
      ).trim();
      const providerPreference = safeStr((bookingCollected as any).provider_preference, "").trim();
      if (globalInfoInterrupt === "availability" && !serviceForAvailability) {
        if (!serviceForAvailability) {
          const serviceMenu = formatBarbershopServiceMenuFromSettings(getBarbershopServicesFromSettings(args.clinicSettings));
          return {
            replyText: `Claro 💈 ¿Qué servicio querés revisar?\n\n${serviceMenu}`,
            statePatch: {
              stage: "BOOKING",
              lastIntent: "availability",
              nextExpected: "service",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                activeBookingFlow: true,
                lastBookingStep: "select_service",
                ...(dateForAvailability ? { preferred_date: dateForAvailability, current_date: dateForAvailability } : {}),
              },
            },
            debug: withInterpreterDebug({ intent: "availability", phase: "BOOKING", route: "barbershop_global_availability_ask_service" }, "shadow"),
          };
        }
      }
      if (globalInfoInterrupt === "availability") {
        // Service/date/provider availability is already handled by the booking engine below.
      } else {
      const infoReply = globalInfoInterrupt === "hours"
        ? (!globalInfoActiveContext && /\b(a que hora abren|cuando abren|a que hora cierran|cuando cierran)\b/.test(normalizedBarbershopInbound)
          ? getBarbershopBusinessHoursReply(args.inboundText, args.clinicSettings)
          : formatBarbershopConfiguredHoursReply(args.clinicSettings))
        : globalInfoInterrupt === "location"
        ? (() => {
          const address = resolveConfiguredBarbershopPublicLocation(args.clinicSettings);
          return address
            ? `Estamos ubicados en:\n${address}`
            : 'Por ahora no tengo la ubicación exacta configurada. Podés tocar "Hablar con alguien" para que te ayuden.';
        })()
        : globalInfoInterrupt === "providers"
        ? formatBarbershopProvidersReply(args.clinicSettings)
        : formatBarbershopServicesPricesReply(args.inboundText, args.clinicSettings);
      if (
        safeStr(state.nextExpected, "") === "confirm_booking" &&
        hasValidPendingForConfirm &&
        !pendingIsStale &&
        pending
      ) {
        const pendingReminder = formatBarbershopPendingBookingConfirmationReminder(pending, bookingCollected, state);
        return {
          replyText: `${infoReply}\n\n${pendingReminder}`,
          statePatch: {
            stage: "CONFIRMING",
            lastIntent: globalInfoInterrupt,
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking: pending,
              pending_booking_stale: false,
              last_bot_step: "barbershop_preconfirm",
            },
          },
          debug: withInterpreterDebug({ intent: globalInfoInterrupt, phase: "CONFIRMING", route: "barbershop_global_info_pending_confirm" }, "shadow"),
        };
      }
      return {
        replyText: globalInfoActiveContext
          ? `${infoReply}\n\nPodés continuar con la cita cuando querás.`
          : `${infoReply}\n\n¿Querés agendar una cita?`,
        statePatch: {
          stage: globalInfoActiveContext ? safeStr(state.stage, "BOOKING") as Stage : "DISCOVERY",
          lastIntent: globalInfoInterrupt,
          nextExpected: globalInfoActiveContext ? state.nextExpected : "main_menu_selection",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            ...(globalInfoActiveContext ? {} : { activeBookingFlow: false }),
          },
        },
        debug: withInterpreterDebug({ intent: globalInfoInterrupt, phase: globalInfoActiveContext ? "BOOKING" : "DISCOVERY", route: globalInfoActiveContext ? "barbershop_global_info_preserve_flow" : "barbershop_global_info_menu" }, "shadow"),
      };
      }
    }
    const plainAppointmentRequest = isBarbershopGenericBookingRequestText(args.inboundText) ||
      /\b(agendar cita|agendar una cita|reservar cita|reservar una cita)\b/.test(normalizedBarbershopInbound);
    const thirdPartySignalBeforeRouting = /\b(para mi hijo|para mi hija|para mi hermano|para mi hermana|para mi mama|para mi mamá|para mi papa|para mi papá|para otra persona|para alguien mas|para alguien más)\b/
      .test(normalizedBarbershopInbound);
    const rescheduleSignalBeforeRouting = isRescheduleDateTimeExpected(nextExpectedValue) ||
      routedIntent === "booking_reschedule" || runtimeIntent === "reschedule_request" ||
      /\b(reagendar|cambiar|mover|moverla|cambiarla)\b/.test(normalizedBarbershopInbound);
    const hasProviderSignalBeforeRouting = hasBarberMention || hasAnyBarberPreference || runtimeSpecificProvider || runtimeAnyProvider;
    const genericBookingMissingService = (
      (plainAppointmentRequest && !parsedDateTime && !parsedDateOnly && !parsedTimeOnly && !hasProviderSignalBeforeRouting) ||
      (
        !isPricingQuestion(args.inboundText) &&
        !barbershopLocationQuestion &&
        !isBusinessHoursQuestionText(args.inboundText) &&
        !genericGrooming &&
        !thirdPartySignalBeforeRouting &&
        !rescheduleSignalBeforeRouting &&
        !hasProviderSignalBeforeRouting &&
        (parsedDateTime || (parsedDateOnly && parsedTimeOnly)) &&
        (isAvailabilityDiscoveryIntentText(args.inboundText) || isAvailabilityInquiryText(args.inboundText) || routedIntent === "booking_request")
      )
    ) && !hasKnownBarbershopService;
    if (genericBookingMissingService) {
      const serviceMenu = formatBarbershopServiceMenuFromSettings(
        getBarbershopServicesFromSettings(args.clinicSettings),
      );
      if (hasBarbershopGreetingToken || intent.intent === "greeting") {
        logBarbershopDiagnostic("booking_intent_skipped_main_menu", {
          inbound_text: args.inboundText,
          reason: "booking_intent_with_greeting",
        });
      }
      logBarbershopDiagnostic("booking_missing_service_asks_service_first", {
        inbound_text: args.inboundText,
        has_datetime: Boolean(parsedDateTime || parsedDateOnly || parsedTimeOnly),
      });
      return {
        replyText: `Perfecto 💈 ¿Qué servicio querés?\n\n${serviceMenu}`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "service",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            activeBookingFlow: true,
            lastBookingStep: "select_service",
            ...(parsedDateTime?.date || parsedDateOnly ? { preferred_date: parsedDateTime?.date ?? parsedDateOnly } : {}),
            ...(parsedDateTime?.time || parsedTimeOnly ? { preferred_time: parsedDateTime?.time ?? parsedTimeOnly } : {}),
            pending_booking_request: {
              ...mergedPendingBookingRequest,
              preferred_date: parsedDateTime?.date ?? parsedDateOnly ?? mergedPendingBookingRequest.preferred_date,
              preferred_time: parsedDateTime?.time ?? parsedTimeOnly ?? mergedPendingBookingRequest.preferred_time,
              missing_fields: ["service"],
              source: "deterministic",
            },
          },
        },
        debug: withInterpreterDebug(
          { intent: "book_appointment", phase: "BOOKING", route: "barbershop_missing_service_first" },
          runtimeIntent === "booking_request" || runtimeIntent === "availability_question" ? "runtime" : "shadow",
        ),
      };
    }

    if (
      hasActiveBookingStateContract &&
      currentServiceForTimeRequest &&
      parsedDateOnly &&
      !parsedTimeOnly &&
      !isPricingQuestion(args.inboundText)
    ) {
      return {
        replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "availability",
          nextExpected: "availability_slot_selection",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            service: currentServiceForTimeRequest,
            preferred_date: parsedDateOnly,
            current_date: parsedDateOnly,
            activeBookingFlow: true,
            lastBookingStep: "select_time",
            pending_booking_request: {
              ...mergedPendingBookingRequest,
              service: currentServiceForTimeRequest,
              preferred_date: parsedDateOnly,
              missing_fields: ["time"],
              source: "deterministic",
            },
          },
        },
        debug: withInterpreterDebug(
          { intent: "availability", phase: "BOOKING", route: "barbershop_active_booking_date_followup" },
          "shadow",
        ),
      };
    }

    if (safeStr(state.nextExpected, "").trim() === "booking_date") {
      if (mergedPendingBookingRequest.preferred_date) {
        if (mergedPendingBookingRequest.service && mergedPendingBookingRequest.preferred_time) {
          return {
            replyText: "__CHECK_REQUESTED_AVAILABILITY__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "confirm_booking",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                service: mergedPendingBookingRequest.service,
                preferred_date: mergedPendingBookingRequest.preferred_date,
                preferred_time: mergedPendingBookingRequest.preferred_time,
                provider_preference: mergedPendingBookingRequest.provider_preference,
                provider_name: mergedPendingBookingRequest.provider_name,
                preferred_barber: mergedPendingBookingRequest.provider_preference === "any" ? null : mergedPendingBookingRequest.provider_name,
                pending_booking_request: { ...mergedPendingBookingRequest, source: "context_merge" },
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: withInterpreterDebug(
              { intent: "book_appointment", phase: "BOOKING", route: "barbershop_pending_booking_request_date_merged_check" },
              runtimeIntent === "booking_request" ? "runtime" : "shadow",
            ),
          };
        }
      }
      return {
        replyText: "Claro 🔥 ¿Para qué día querés que te revise horarios?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "booking_date",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            pending_booking_request: { ...mergedPendingBookingRequest, source: "context_merge" },
          },
        },
        debug: withInterpreterDebug(
          { intent: "book_appointment", phase: "BOOKING", route: "barbershop_pending_booking_request_date_reask" },
          runtimeIntent === "booking_request" ? "runtime" : "shadow",
        ),
      };
    }
    const thirdPartyRelation = detectAdditionalBookingRelation(repairedInboundText);
    const explicitThirdPartyName = extractExplicitThirdPartyName(repairedInboundText);
    const likelySelfBookingPhrase = /\b(cortarme|hacerme|para mi|para mí|yo)\b/.test(repairedInboundText);
    if (((thirdPartyRelation && !thirdPartyRelation.self) || explicitThirdPartyName) && !likelySelfBookingPhrase) {
      (bookingCollected as any).booking_for_other = true;
      (bookingCollected as any).appointment_for_relation = thirdPartyRelation?.relation ?? "other";
      if (explicitThirdPartyName) {
        (bookingCollected as any).patient_name = explicitThirdPartyName;
      }
    }
    const thirdPartyPatientName = safeStr((bookingCollected as any).patient_name, "").trim();
    if (thirdPartyRelation && !thirdPartyRelation.self && parsedDateTime && !thirdPartyPatientName) {
      const inferredService = safeStr(
        (bookingCollected as any).service,
        safeStr(effectiveDetectedService?.name, "Cita barbería"),
      );
      return {
        replyText: `Perfecto. ${formatHumanDay(parsedDateTime.date)} a las ${formatHourLabel(parsedDateTime.time)} está disponible para ${inferredService}. ¿A nombre de quién la agendamos?`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "third_party_patient_name",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            service: inferredService,
            preferred_date: parsedDateTime.date,
            preferred_time: parsedDateTime.time,
            booking_for_other: true,
            appointment_for_relation: thirdPartyRelation.relation,
            pending_booking: null,
            pending_booking_stale: true,
          },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_third_party_missing_name_after_datetime" },
      };
    }

    if (safeStr(state.nextExpected, "") === "confirm_discard_pending_booking") {
      if (isPendingDiscardConfirmationText(args.inboundText)) {
        return {
          replyText: "Listo, descarté esa opción pendiente.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: undefined,
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking: null,
              pending_booking_stale: true,
              last_bot_step: "barbershop_pending_discarded",
            },
          },
          debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_discard_pending_confirmed" }),
        };
      }
      return {
        replyText: "¿Querés que descarte esa opción pendiente? Respondé sí para confirmarlo.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "confirm_discard_pending_booking",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_discard_pending_reask" }),
      };
    }

    if (
      shouldUseRuntimeInterpreter &&
      Number.isFinite(runtimeConfidence) &&
      runtimeConfidence >= runtimeMinConfidence &&
      (runtimeCandidateIntent === "availability_question" || runtimeNextStep === "show_availability" || runtimeToolNeeded === "check_availability") &&
      runtimeFieldService &&
      runtimeFieldDate &&
      !runtimeFieldTime
    ) {
      const serviceFromRuntime = resolveBarbershopServiceFromSettings(runtimeFieldService, args.clinicSettings)
        ? resolveBarbershopServiceFromSettings(runtimeFieldService, args.clinicSettings)!.name
        : (detectBarbershopService(runtimeFieldService).matchedService?.name ?? runtimeFieldService);
      const parsedDateOnly = parseDateOnlyFromMessage(runtimeFieldDate, safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa"));
      const normalizedProviderPref = runtimeFieldProviderPref === "any" ? "any" : runtimeFieldProviderPref === "specific" ? "specific" : "";
      return {
        replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "availability",
          nextExpected: "availability_service",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            service: serviceFromRuntime,
            preferred_date: parsedDateOnly ?? runtimeFieldDate,
            ...(normalizedProviderPref === "any" ? { preferred_barber: null, provider_preference: "any", provider_name: null } : {}),
            availability_request: true,
            pending_booking: null,
          },
        },
        debug: withInterpreterDebug(
          { intent: "availability", phase: "BOOKING", route: "barbershop_runtime_show_availability_from_b4" },
          "runtime",
        ),
      };
    }

    const isInActiveChoiceFlow = safeStr(state.nextExpected, "") === "active_appointment_intent_choice";
    const isInAdditionalDetailsFlow = safeStr(state.nextExpected, "") === "additional_booking_details";
    const rawCancelTypoDetected = /\b(cncelar|canselar|cancalar|cancelr|canselarla|cncelarla)\b/i.test(args.inboundText);
    const semanticCancelDetection = isBarberlineSemanticCancelIntent(args.inboundText);
    const normalizedCancelIntentDetected = semanticCancelDetection.matched ||
      /\b(ya no voy|no voy a poder llegar|no puedo ir)\b/.test(normalizeTextForIntent(args.inboundText));

    if (
      !isInActiveChoiceFlow &&
      !isInAdditionalDetailsFlow &&
      hasDiscardablePendingContext &&
      normalizedCancelIntentDetected
    ) {
      logBarbershopDiagnostic("cancel_intent_detected", { inbound_text: args.inboundText });
      logBarbershopDiagnostic("barberline_cancel_semantic_detected", {
        inbound_text: args.inboundText,
        fuzzy: semanticCancelDetection.fuzzy,
      });
      if (rawCancelTypoDetected || semanticCancelDetection.fuzzy) {
        logBarbershopDiagnostic("cancel_intent_typo_detected", { inbound_text: args.inboundText });
      }
      const pendingDateLabel = activePendingDate ? formatHumanDay(activePendingDate) : "la fecha pendiente";
      const pendingTimeLabel = activePendingTime ? formatHourLabel(activePendingTime) : "la hora pendiente";
      return {
        replyText:
          `Todavía no habíamos confirmado esa cita, así que no hay nada que cancelar. ¿Querés que descarte la opción del ${pendingDateLabel} a las ${pendingTimeLabel}?`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "confirm_discard_pending_booking",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            last_bot_step: "barbershop_pending_discard_offer",
          },
        },
        debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_pending_cancel_interruption" }),
      };
    }

    if (!isInActiveChoiceFlow && !isInAdditionalDetailsFlow && isAppointmentLookupInquiry(args.inboundText)) {
      return {
        replyText: "__CHECK_ACTIVE_APPOINTMENT__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "appointment_lookup",
          nextExpected: "active_appointment_intent_choice",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "appointment_lookup", phase: "BOOKING", route: "barbershop_direct_appointment_lookup" }),
      };
    }

    if (
      !isInActiveChoiceFlow &&
      !isInAdditionalDetailsFlow &&
      normalizedCancelIntentDetected
    ) {
      logBarbershopDiagnostic("cancel_intent_detected", { inbound_text: args.inboundText });
      logBarbershopDiagnostic("barberline_cancel_semantic_detected", {
        inbound_text: args.inboundText,
        fuzzy: semanticCancelDetection.fuzzy,
      });
      if (rawCancelTypoDetected || semanticCancelDetection.fuzzy) {
        logBarbershopDiagnostic("cancel_intent_typo_detected", { inbound_text: args.inboundText });
      }
      if (activeAppointment && safeStr(activeAppointment.id, safeStr(activeAppointment.appointment_id, "")).trim()) {
        const activeSummary = resolveActiveAppointmentSummary(activeAppointment);
        const providerName = safeStr(activeAppointment.provider_name, "").trim();
        const pendingCancel = {
          appointment_id: safeStr(activeAppointment.id, safeStr(activeAppointment.appointment_id, "")),
          service: activeSummary.service,
          appointment_date: safeStr(activeAppointment.appointment_date, ""),
          appointment_time: safeStr(activeAppointment.appointment_time, ""),
          starts_at: safeStr(activeAppointment.starts_at, safeStr(activeAppointment.start_at, "")),
          status: "pending_confirmation",
          provider_id: safeStr(activeAppointment.provider_id, "") || null,
          provider_name: safeStr(activeAppointment.provider_name, "") || null,
        };
        logBarbershopDiagnostic("cancel_confirmation_requested", {
          appointment_id: pendingCancel.appointment_id || null,
        });
        return {
          replyText: `¿Confirmás que querés cancelar tu cita del ${activeSummary.dateLabel} ${formatAtHourLabel(activeSummary.timeLabel)}?`,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "cancel_appointment",
            nextExpected: "confirm_cancel_appointment",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              active_appointment: activeAppointment,
              pending_cancel: pendingCancel,
              pending_cancel_appointment: pendingCancel,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug({ intent: "cancel_appointment", phase: "BOOKING", route: "barbershop_direct_cancel_active_context" }),
        };
      }
      return {
        replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "cancel_appointment",
          nextExpected: "confirm_cancel_appointment",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "cancel_appointment", phase: "BOOKING", route: "barbershop_direct_cancel_lookup" }),
      };
    }

    if (
      !isInActiveChoiceFlow &&
      !isInAdditionalDetailsFlow &&
      (runtimeIntent === "reschedule_request" || runtimeNextStep === "start_reschedule")
    ) {
      return {
        replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "reschedule_appointment",
          nextExpected: runtimeDateText || runtimeTimeText ? "confirm_reschedule_appointment" : "reschedule_new_datetime",
          orgType: "barbershop",
          active_flow: "reschedule",
          collected: {
            ...bookingCollected,
            ...(runtimeDateTime ? {
              reschedule_date: runtimeDateTime.date,
              reschedule_time: runtimeDateTime.time,
            } : {}),
          },
        },
        debug: withInterpreterDebug({ intent: "reschedule_appointment", phase: "BOOKING", route: "barbershop_runtime_reschedule_lookup" }, "runtime"),
      };
    }

    if (
      !isInActiveChoiceFlow &&
      !isInAdditionalDetailsFlow &&
      intent.intent === "reschedule_appointment"
    ) {
      if (activeAppointment && safeStr(activeAppointment.id, safeStr(activeAppointment.appointment_id, "")).trim()) {
        const activeSummary = resolveActiveAppointmentSummary(activeAppointment);
        const pendingReschedule = {
          appointment_id: safeStr(activeAppointment.id, safeStr(activeAppointment.appointment_id, "")),
          service: activeSummary.service,
          current_date: safeStr(activeAppointment.appointment_date, ""),
          current_time: safeStr(activeAppointment.appointment_time, ""),
          current_starts_at: safeStr(activeAppointment.starts_at, ""),
          provider_id: safeStr(activeAppointment.provider_id, "") || null,
          provider_name: safeStr(activeAppointment.provider_name, "") || null,
          status: "awaiting_new_datetime",
        };
        logBarbershopDiagnostic("reschedule_requested", {
          appointment_id: pendingReschedule.appointment_id || null,
        });
        if (parsedDateTime) {
          logBarbershopDiagnostic("reschedule_new_datetime_requested", {
            appointment_id: pendingReschedule.appointment_id || null,
            requested_date: parsedDateTime.date,
            requested_time: parsedDateTime.time,
          });
          return {
            replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "reschedule_appointment",
              nextExpected: "confirm_reschedule_appointment",
              orgType: "barbershop",
              active_flow: "reschedule",
              collected: {
                ...bookingCollected,
                active_appointment: activeAppointment,
                service: activeSummary.service,
                reschedule_date: parsedDateTime.date,
                reschedule_time: parsedDateTime.time,
                reschedule_from_message: true,
                pending_reschedule: {
                  ...pendingReschedule,
                  requested_date: parsedDateTime.date,
                  requested_time: parsedDateTime.time,
                  status: "pending_availability_check",
                },
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: withInterpreterDebug({ intent: "reschedule_appointment", phase: "BOOKING", route: "barbershop_direct_reschedule_active_context_with_datetime" }),
          };
        }
        return {
          replyText: `Claro, te ayudo a reagendar tu cita de ${activeSummary.service} del ${activeSummary.dateLabel} a las ${activeSummary.timeLabel}.\n\n¿Qué nuevo día y hora te interesa?`,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: "reschedule_new_datetime",
            orgType: "barbershop",
            active_flow: "reschedule",
            collected: {
              ...bookingCollected,
              active_appointment: activeAppointment,
              service: activeSummary.service,
              pending_reschedule: pendingReschedule,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug({ intent: "reschedule_appointment", phase: "BOOKING", route: "barbershop_direct_reschedule_active_context" }),
        };
      }
      return {
        replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "reschedule_appointment",
          nextExpected: parsedDateTime ? "confirm_reschedule_appointment" : "reschedule_new_datetime",
          orgType: "barbershop",
          active_flow: "reschedule",
          collected: {
            ...bookingCollected,
            ...(parsedDateTime ? {
              reschedule_date: parsedDateTime.date,
              reschedule_time: parsedDateTime.time,
              reschedule_from_message: true,
            } : {}),
          },
        },
        debug: withInterpreterDebug({ intent: "reschedule_appointment", phase: "BOOKING", route: "barbershop_direct_reschedule_lookup" }),
      };
    }

    if (
      !isInActiveChoiceFlow &&
      !isInAdditionalDetailsFlow &&
      (runtimeIntent === "appointment_lookup" ||
        runtimeNextStep === "lookup_active_appointment" ||
        runtimeToolNeeded === "get_active_appointment" && !["cancel_request", "reschedule_request"].includes(runtimeIntent))
    ) {
      return {
        replyText: "__CHECK_ACTIVE_APPOINTMENT__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "appointment_lookup",
          nextExpected: "active_appointment_intent_choice",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "appointment_lookup", phase: "BOOKING", route: "barbershop_runtime_appointment_lookup" }, "runtime"),
      };
    }

    if (
      !isInActiveChoiceFlow &&
      !isInAdditionalDetailsFlow &&
      (runtimeIntent === "cancel_request" || runtimeNextStep === "start_cancel_confirmation")
    ) {
      return {
        replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "cancel_appointment",
          nextExpected: "confirm_cancel_appointment",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "cancel_appointment", phase: "BOOKING", route: "barbershop_runtime_cancel_lookup" }, "runtime"),
      };
    }

    if (safeStr(state.nextExpected, "") === "active_appointment_intent_choice") {
      const choice = classifyActiveAppointmentChoice(args.inboundText);
      const activeAppt = ((bookingCollected as any).active_appointment ?? {}) as Record<string, unknown>;
      const activeSummary = resolveActiveAppointmentSummary(activeAppt);
      if (choice === "reschedule") {
        const pendingReschedule = {
          appointment_id: safeStr(activeAppt.id, safeStr(activeAppt.appointment_id, "")),
          service: activeSummary.service,
          current_date: safeStr(activeAppt.appointment_date, ""),
          current_time: safeStr(activeAppt.appointment_time, ""),
          current_starts_at: safeStr(activeAppt.starts_at, ""),
          provider_id: safeStr(activeAppt.provider_id, "") || null,
          provider_name: safeStr(activeAppt.provider_name, "") || null,
          status: "awaiting_new_datetime",
        };
        logBarbershopDiagnostic("reschedule_requested", {
          appointment_id: pendingReschedule.appointment_id || null,
        });
        if (parsedDateTime) {
          logBarbershopDiagnostic("reschedule_new_datetime_requested", {
            appointment_id: pendingReschedule.appointment_id || null,
            requested_date: parsedDateTime.date,
            requested_time: parsedDateTime.time,
          });
          return {
            replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "reschedule_appointment",
              nextExpected: "confirm_reschedule_appointment",
              orgType: "barbershop",
              active_flow: "reschedule",
              collected: {
                ...bookingCollected,
                active_appointment: activeAppt,
                service: activeSummary.service,
                reschedule_date: parsedDateTime.date,
                reschedule_time: parsedDateTime.time,
                reschedule_from_message: true,
                pending_reschedule: {
                  ...pendingReschedule,
                  requested_date: parsedDateTime.date,
                  requested_time: parsedDateTime.time,
                  status: "pending_availability_check",
                },
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: withInterpreterDebug({ intent: "reschedule_appointment", phase: "BOOKING", route: "barbershop_active_choice_reschedule_with_datetime" }),
          };
        }
        return {
          replyText: `Claro, te ayudo a reagendar tu cita de ${activeSummary.service} del ${activeSummary.dateLabel} a las ${activeSummary.timeLabel}.\n\n¿Qué nuevo día y hora te interesa?`,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: "reschedule_new_datetime",
            orgType: "barbershop",
            active_flow: "reschedule",
            collected: {
              ...bookingCollected,
              active_appointment: activeAppt,
              service: activeSummary.service,
              pending_reschedule: pendingReschedule,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug({ intent: "reschedule_appointment", phase: "BOOKING", route: "barbershop_active_choice_reschedule" }),
        };
      }
      if (choice === "cancel") {
        const pendingCancel = {
          appointment_id: safeStr(activeAppt.id, ""),
          service: activeSummary.service,
          appointment_date: safeStr(activeAppt.appointment_date, ""),
          appointment_time: safeStr(activeAppt.appointment_time, ""),
          starts_at: safeStr(activeAppt.starts_at, safeStr(activeAppt.start_at, "")),
          status: "pending_confirmation",
          provider_id: safeStr(activeAppt.provider_id, "") || null,
          provider_name: safeStr(activeAppt.provider_name, "") || null,
        };
        logBarbershopDiagnostic("cancel_confirmation_requested", {
          appointment_id: pendingCancel.appointment_id || null,
        });
        return {
          replyText: `¿Confirmás que querés cancelar tu cita del ${activeSummary.dateLabel} ${formatAtHourLabel(activeSummary.timeLabel)}?`,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "cancel_appointment",
            nextExpected: "confirm_cancel_appointment",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              active_appointment: activeAppt,
              pending_cancel: pendingCancel,
              pending_cancel_appointment: pendingCancel,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug({ intent: "cancel_appointment", phase: "BOOKING", route: "barbershop_active_choice_cancel" }),
        };
      }
      if (choice === "additional") {
        const relation = detectAdditionalBookingRelation(args.inboundText);
        const detectedExtraService = resolveBarbershopServiceFromSettings(args.inboundText, args.clinicSettings);
        const relationLabel = relation?.relation ?? "other";
        const isOtherPersonWithoutRelation = !relation || relation.relation === "other";
        if (isOtherPersonWithoutRelation) {
          return {
            replyText: "Claro. ¿A nombre de quién agendamos la cita?",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "third_party_patient_name",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                allow_additional_booking: true,
                booking_for_other: true,
                appointment_for_relation: "other",
                patient_name: null,
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_active_choice_additional_ask_name" }),
          };
        }
        if (relation && relation.relation !== "other" && !detectedExtraService) {
          return {
            replyText: "Claro. ¿Qué servicio necesita esa persona: corte, barba o corte + barba?",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "additional_booking_details",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                allow_additional_booking: true,
                booking_for_other: true,
                appointment_for_relation: relationLabel,
                patient_name: null,
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_active_choice_additional_ask_service" }),
          };
        }
        return {
          replyText: "Claro. ¿Para quién sería la otra cita y qué servicio necesita?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "additional_booking_details",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              allow_additional_booking: true,
              booking_for_other: true,
              appointment_for_relation: relationLabel,
              patient_name: null,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_active_choice_additional" }),
        };
      }
      return {
        replyText:
          "Te puedo ayudar con una de estas opciones: reagendarla, cancelarla o agendar otra para otra persona. ¿Cuál preferís?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "appointment_lookup",
          nextExpected: "active_appointment_intent_choice",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "appointment_lookup", phase: "BOOKING", route: "barbershop_active_choice_guided_retry" }),
      };
    }

    if (safeStr(state.nextExpected, "") === "additional_booking_details") {
      const relation = detectAdditionalBookingRelation(args.inboundText) ??
        (safeStr((bookingCollected as any).appointment_for_relation, "").trim()
          ? { relation: safeStr((bookingCollected as any).appointment_for_relation, ""), self: false }
          : null);
      const additionalService = resolveBarbershopServiceFromSettings(args.inboundText, args.clinicSettings);
      const additionalDateTime = parseDateTimeFromMessage(args.inboundText, timezone);
      const currentPatientName = safeStr((bookingCollected as any).patient_name, "").trim();
      const relationNeedsName = Boolean(
        relation &&
          !relation.self &&
          !currentPatientName,
      );

      const updatedCollected = {
        ...bookingCollected,
        allow_additional_booking: true,
        booking_for_other: true,
        appointment_for_relation: relation?.relation ?? safeStr((bookingCollected as any).appointment_for_relation, "other"),
        ...(additionalService ? { service: additionalService.name } : {}),
        ...(additionalDateTime
          ? { preferred_date: additionalDateTime.date, preferred_time: additionalDateTime.time }
          : {}),
      } as Record<string, unknown>;
      const existingService = safeStr((bookingCollected as any).service, "").trim();

      if (!additionalService && !existingService) {
        return {
          replyText: "Claro. ¿Qué servicio necesita esa persona: corte, barba o corte + barba?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "additional_booking_details",
            orgType: "barbershop",
            collected: updatedCollected,
          },
          debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_additional_missing_service" }),
        };
      }

      if (!additionalDateTime) {
        return {
          replyText: "Perfecto. ¿Qué día y hora te queda mejor para esa persona?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            orgType: "barbershop",
            collected: updatedCollected,
          },
          debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_additional_missing_datetime" }),
        };
      }

      if (relationNeedsName) {
        const relationValue = safeStr((relation as any)?.relation, "").trim();
        const askNameReply = relationValue && relationValue !== "other"
          ? `¿Cómo se llama tu ${relationValue}?`
          : `Perfecto. ${formatHumanDay(additionalDateTime.date)} a las ${formatHourLabel(additionalDateTime.time)} está disponible para ${safeStr(additionalService?.name, existingService || "Cita barbería")}. ¿A nombre de quién la agendamos?`;
        return {
          replyText: askNameReply,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "third_party_patient_name",
            orgType: "barbershop",
            collected: updatedCollected,
          },
          debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_additional_missing_patient_name" }),
        };
      }

      return {
        replyText: "__CHECK_REQUESTED_AVAILABILITY__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "confirm_booking",
          orgType: "barbershop",
          collected: updatedCollected,
        },
        debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_additional_check_availability" }),
      };
    }

    if (isRescheduleDateTimeExpected(nextExpectedValue) && (parsedDateTime || (parsedDateOnly && parsedTimeOnly))) {
      const nextRescheduleDate = parsedDateTime?.date ?? parsedDateOnly ?? "";
      const nextRescheduleTime = parsedDateTime?.time ?? parsedTimeOnly ?? "";
      const activeAppt = (((bookingCollected as any).active_appointment ?? {}) as Record<string, unknown>);
      const activeService = safeStr(
        activeAppt.reason,
        safeStr(activeAppt.title, safeStr(bookingCollected.service, "Corte clásico")),
      ).trim();
      const pendingReschedule = (((bookingCollected as any).pending_reschedule ?? {}) as Record<string, unknown>);
      logBarbershopDiagnostic("reschedule_new_datetime_requested", {
        appointment_id: safeStr(activeAppt.id, safeStr(pendingReschedule.appointment_id, "")) || null,
        requested_date: nextRescheduleDate,
        requested_time: nextRescheduleTime,
      });
      return {
        replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "reschedule_appointment",
          nextExpected: "confirm_reschedule_appointment",
          orgType: "barbershop",
          active_flow: "reschedule",
          collected: {
            ...bookingCollected,
            active_appointment: activeAppt,
            service: activeService || "Corte clásico",
            reschedule_date: nextRescheduleDate,
            reschedule_time: nextRescheduleTime,
            reschedule_from_message: true,
            pending_reschedule: {
              ...pendingReschedule,
              appointment_id: safeStr(activeAppt.id, safeStr(pendingReschedule.appointment_id, "")),
              service: activeService || safeStr(pendingReschedule.service, "Corte clásico"),
              current_date: safeStr(activeAppt.appointment_date, safeStr(pendingReschedule.current_date, "")),
              current_time: safeStr(activeAppt.appointment_time, safeStr(pendingReschedule.current_time, "")),
              current_starts_at: safeStr(activeAppt.starts_at, safeStr(pendingReschedule.current_starts_at, "")),
              requested_date: nextRescheduleDate,
              requested_time: nextRescheduleTime,
              status: "pending_availability_check",
            },
            pending_booking: null,
            pending_booking_stale: true,
          },
        },
        debug: withInterpreterDebug({ intent: "reschedule_appointment", phase: "BOOKING", route: "barbershop_reschedule_datetime_from_context" }),
      };
    }

    if (nextExpectedValue === "confirm_reschedule_appointment") {
      const pendingInterruption = classifyPendingFlowInterruption(args.inboundText);
      const activeAppt = (((bookingCollected as any).active_appointment ?? {}) as Record<string, unknown>);
      const pendingReschedule = (((bookingCollected as any).pending_reschedule ?? {}) as Record<string, unknown>);
      const appointmentId = safeStr(activeAppt.id, safeStr(pendingReschedule.appointment_id, ""));
      const requestedDate = safeStr(bookingCollected.reschedule_date, safeStr(pendingReschedule.requested_date, ""));
      const requestedTime = safeStr(bookingCollected.reschedule_time, safeStr(pendingReschedule.requested_time, ""));

      if (pendingInterruption.type === "clean_confirmation") {
        logBarbershopDiagnostic("reschedule_confirmed", {
          appointment_id: appointmentId || null,
          requested_date: requestedDate || null,
          requested_time: requestedTime || null,
        });
        return {
          replyText: "Perfecto, estoy actualizando tu cita ahora mismo.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: undefined,
            orgType: "barbershop",
            active_flow: "reschedule",
            collected: {
              ...bookingCollected,
              pending_reschedule: null,
              pending_booking: null,
              selected_slot: null,
            },
          },
          toolAction: {
            name: "reschedule_appointment",
            payload: {
              appointment_id: appointmentId,
              appointment_date: requestedDate,
              appointment_time: requestedTime,
              reason: safeStr(bookingCollected.service, safeStr(activeAppt.reason, "Corte clásico")),
              business_type: "barbershop",
              provider_id: safeStr(pendingReschedule.provider_id, ""),
              provider_name: safeStr(pendingReschedule.provider_name, ""),
              duration_min: Number(pendingReschedule.duration_min ?? 60) || 60,
              brand_name: safeStr(args.clinicSettings?.brand_name, safeStr(args.clinicSettings?.business_name, "la barbería")),
            },
          },
          debug: withInterpreterDebug({ intent: "reschedule_appointment", phase: "BOOKING", route: "barbershop_reschedule_confirmed" }),
        };
      }

      if (pendingInterruption.type === "clean_rejection" || /^(no|mejor\s+no|no\s+cambiar)\b/i.test(args.inboundText.trim())) {
        logBarbershopDiagnostic("reschedule_declined", {
          appointment_id: appointmentId || null,
        });
        return {
          replyText: "Perfecto, mantenemos tu cita original.",
          statePatch: {
            stage: "DISCOVERY",
            lastIntent: "reschedule_declined",
            nextExpected: undefined,
            orgType: "barbershop",
            active_flow: undefined,
            collected: {
              ...bookingCollected,
              pending_reschedule: null,
              reschedule_date: null,
              reschedule_time: null,
            },
          },
          debug: withInterpreterDebug({ intent: "reschedule_appointment", phase: "DISCOVERY", route: "barbershop_reschedule_declined" }),
        };
      }
    }

    const pendingCancelForConfirmation = ((bookingCollected as any).pending_cancel ??
      (bookingCollected as any).pending_cancel_appointment ??
      null) as Record<string, unknown> | null;
    if (nextExpectedValue === "confirm_cancel_appointment" || pendingCancelForConfirmation) {
      const pendingCancel = (((bookingCollected as any).pending_cancel ??
        (bookingCollected as any).pending_cancel_appointment ??
        (bookingCollected as any).active_appointment ??
        {}) as Record<string, unknown>);
      const activeAppt = (((bookingCollected as any).active_appointment ?? {}) as Record<string, unknown>);
      const appointmentId = safeStr(
        pendingCancel.appointment_id,
        safeStr(pendingCancel.id, safeStr(activeAppt.id, "")),
      );

      if (isCleanConfirmationText(args.inboundText)) {
        if (!appointmentId) {
          logBarbershopDiagnostic("cancel_confirmation_missing_pending_cancel", {
            next_expected: nextExpectedValue,
          });
          return {
            replyText: "No tengo una cita pendiente para cancelar. Si querés, puedo revisar tu cita confirmada.",
            statePatch: {
              stage: "DISCOVERY",
              lastIntent: "cancel_appointment",
              nextExpected: undefined,
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                pending_cancel: null,
                pending_cancel_appointment: null,
              },
            },
            debug: withInterpreterDebug({ intent: "cancel_appointment", phase: "DISCOVERY", route: "barbershop_cancel_missing_pending" }),
          };
        }
        logBarbershopDiagnostic("cancel_confirmation_confirmed", {
          appointment_id: appointmentId,
        });
        return {
          replyText: "✅ Tu cita fue cancelada.\n\nSi querés, puedo ayudarte a buscar otro horario.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "cancel_appointment",
            nextExpected: undefined,
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_cancel: null,
              pending_cancel_appointment: null,
              pending_booking: null,
              selected_slot: null,
            },
          },
          toolAction: {
            name: "cancel_appointment",
            payload: {
              appointment_id: appointmentId,
              business_type: "barbershop",
            },
          },
          debug: withInterpreterDebug({ intent: "cancel_appointment", phase: "BOOKING", route: "barbershop_cancel_confirmed" }),
        };
      }

      if (classifyPendingFlowInterruption(args.inboundText).type === "clean_rejection" || /^(no\s+cancelar|mejor\s+no)\b/i.test(args.inboundText.trim())) {
        logBarbershopDiagnostic("cancel_confirmation_declined", {
          appointment_id: appointmentId || null,
        });
        return {
          replyText: "Perfecto, mantenemos tu cita.",
          statePatch: {
            stage: "DISCOVERY",
            lastIntent: "cancel_appointment_denied",
            nextExpected: undefined,
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_cancel: null,
              pending_cancel_appointment: null,
            },
          },
          debug: withInterpreterDebug({ intent: "cancel_appointment", phase: "DISCOVERY", route: "barbershop_cancel_declined" }),
        };
      }

      return {
        replyText: "¿Confirmás que querés cancelarla? Respondé Sí o No.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "cancel_appointment",
          nextExpected: "confirm_cancel_appointment",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "cancel_appointment", phase: "BOOKING", route: "barbershop_cancel_retry_confirm" }),
      };
    }

    const confirmsPricingBookingCta = isCleanConfirmationText(args.inboundText) &&
      !hasValidPendingForConfirm &&
      (
        safeStr(state.nextExpected, "") === "pricing_booking_followup" ||
        safeStr(state.nextExpected, "") === "pricing_followup" ||
        safeStr(bookingCollected.last_info_topic, "") === "pricing" ||
        safeStr(bookingCollected.lastTopic, "") === "pricing" ||
        safeStr(state.lastIntent, "") === "pricing"
      );
    if (confirmsPricingBookingCta) {
      const pricingServiceName = safeStr(
        (bookingCollected as any).current_service_name,
        safeStr((bookingCollected as any).last_pricing_service, safeStr((bookingCollected as any).last_service_discussed, "")),
      ).trim();
      const pricingService = pricingServiceName
        ? resolveBarbershopServiceFromSettings(pricingServiceName, args.clinicSettings)
        : null;
      const configured = getBarbershopServicesFromSettings(args.clinicSettings);
      const selectedPricingService = pricingService ?? configured[0] ?? null;
      if (selectedPricingService) {
        const serviceKey = getBarbershopServiceActionKey(selectedPricingService);
        return {
          replyText: "Buenísimo. ¿Qué día te queda mejor?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "booking_date_preference",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: selectedPricingService.name,
              activeBookingFlow: true,
              lastBookingStep: "select_day",
              current_service_key: serviceKey,
              current_service_name: selectedPricingService.name,
              pending_booking: {
                ...(((bookingCollected as any).pending_booking ?? {}) as Record<string, unknown>),
                service_key: serviceKey,
                service_name: selectedPricingService.name,
                service: selectedPricingService.name,
                provider_preference: "any",
              },
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_pricing_yes_continue_booking" },
            "shadow",
          ),
        };
      }
      const serviceMenu = formatBarbershopServiceMenuFromSettings(configured);
      return {
        replyText: `Perfecto 💈 ¿Qué servicio querés?\n\n${serviceMenu}`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "service",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            activeBookingFlow: true,
            lastBookingStep: "select_service",
          },
        },
        debug: withInterpreterDebug(
          { intent: "book_appointment", phase: "BOOKING", route: "barbershop_pricing_yes_ask_service" },
          "shadow",
        ),
      };
    }

    if (isCleanConfirmationText(args.inboundText) && !hasValidPendingForConfirm) {
      return {
        replyText: "No tengo una cita pendiente para confirmar todavía. Decime qué día y hora te queda mejor y te ayudo a agendar.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            pending_booking: null,
            pending_booking_stale: true,
            last_bot_step: "barbershop_confirm_without_pending_guard",
          },
        },
        debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_confirm_without_pending" }),
      };
    }

    if (isCleanConfirmationText(args.inboundText) && hasValidPendingForConfirm && safeStr(state.nextExpected, "") !== "confirm_booking") {
      if (pendingConfirmationFreshness.blocked) {
        console.log(JSON.stringify({
          event: "barbershop:stale_confirmation_blocked",
          confirm_inbound_message_id: inboundMessageId || null,
          pending_booking_created_from_inbound_message_id: pendingCreatedFromInboundMessageId || null,
          pending_booking_preconfirm_sent_at: pendingPreconfirmSentAt || null,
          confirm_inbound_message_created_at: inboundMessageCreatedAt || null,
          confirmation_is_fresh: pendingConfirmationFreshness.fresh,
          reason: pendingConfirmationFreshness.reason,
        }));
        return {
          replyText: "Perfecto. Para confirmar, respondé de nuevo \"Confirmar\" sobre la última propuesta de horario.",
          statePatch: {
            stage: "CONFIRMING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking_stale: false,
            },
          },
          debug: withInterpreterDebug({ intent: "book_appointment", phase: "CONFIRMING", route: "barbershop_legacy_pending_stale_confirmation_blocked" }),
        };
      }
      const pending = ((bookingCollected as any).pending_booking ?? {}) as Record<string, unknown>;
      const normalizedCollected = {
        ...bookingCollected,
        service: safeStr((bookingCollected as any).service, safeStr(pending.service, "Corte clásico")),
        preferred_date: safeStr((bookingCollected as any).preferred_date, safeStr(pending.appointment_date, "")),
        preferred_time: safeStr((bookingCollected as any).preferred_time, safeStr(pending.appointment_time, "")),
      } as Record<string, unknown>;
      const selectedServiceName = safeStr(normalizedCollected.service, "Corte clásico");
      const isGenericBarberBooking = selectedServiceName === "Cita barbería";
      const selectedServiceFromSettings = isGenericBarberBooking
        ? null
        : resolveBarbershopServiceFromSettings(selectedServiceName, args.clinicSettings);
      const selectedServiceDetection = isGenericBarberBooking
        ? null
        : detectBarbershopService(selectedServiceName).matchedService;
      const selectedService = selectedServiceDetection ?? getBarbershopServiceById("haircut");
      const durationMin = isGenericBarberBooking
        ? 45
        : (selectedServiceFromSettings?.durationMin ?? selectedService?.durationMinutes ?? 30);
      const preferredBarber = safeStr(normalizedCollected.preferred_barber, "").trim();
      const pendingProviderName = safeStr(pending.provider_name, safeStr(pending.preferred_barber, preferredBarber)).trim();
      const pendingProviderId = safeStr(pending.provider_id, safeStr(normalizedCollected.provider_id, "")).trim();
      if (!pendingProviderName || !pendingProviderId) {
        return {
          replyText: "Ese horario ya no tiene un barbero asignado. Te muestro opciones disponibles para elegir una nueva hora.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...normalizedCollected,
              pending_booking: null,
              pending_booking_stale: true,
              last_bot_step: "barbershop_pending_missing_provider",
            },
          },
          debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_pending_missing_provider_recover" }),
        };
      }
      const reasonAndTitle = isGenericBarberBooking
        ? "Cita barbería"
        : safeStr(normalizedCollected.service, "Corte clásico");
      const patientName = resolveAppointmentPatientName(normalizedCollected, state);
      if (!safeStr(patientName, "").trim()) {
        return {
          replyText: "Perfecto. ¿A nombre de quién dejamos la cita?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "customer_name",
            orgType: "barbershop",
            collected: {
              ...normalizedCollected,
              pending_booking_stale: false,
              last_bot_step: "barbershop_ask_customer_name",
            },
          },
          debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_legacy_pending_require_name" }),
        };
      }
      return {
        replyText: "Perfecto, estoy procesando tu reserva ahora mismo.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "booking_confirmed",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: {
            ...normalizedCollected,
            confirmed: true,
            pending_booking_stale: false,
            last_bot_step: "barbershop_booking_confirmed",
          },
        },
        toolAction: {
          name: "book_appointment",
	          payload: {
	            business_type: "barbershop",
	            selected_slot: (pending as any).selected_slot ?? (normalizedCollected as any).selected_slot ?? null,
	            patient_name: patientName,
            service: reasonAndTitle,
            reason: reasonAndTitle,
            title: reasonAndTitle,
            appointment_date: safeStr(normalizedCollected.preferred_date, ""),
            appointment_time: safeStr(normalizedCollected.preferred_time, ""),
            duration_min: durationMin,
            preferred_barber: pendingProviderName || preferredBarber || null,
            provider_name: pendingProviderName || preferredBarber || null,
            provider_id: pendingProviderId || null,
          },
        },
        debug: withInterpreterDebug({ intent: "book_appointment", phase: "CONFIRMING", route: "barbershop_legacy_pending_confirm" }),
      };
    }

    if (intent.intent === "greeting" && !greetingDemotedIntent) {
      const brandName = getBarbershopCopyBrandName(args.clinicSettings);
      return {
        replyText: `👋 Hola, bienvenido a ${brandName}. ¿Qué querés hacer hoy: agendar una cita, consultar precios o ver horarios?`,
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "greeting",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "greeting", phase: "DISCOVERY", route: "barbershop_greeting" }),
      };
    }

    if (
      (isBarbershopProductQuestionText(args.inboundText) && !isLikelyBookingRequest(args.inboundText)) ||
      runtimeIntent === "product_question"
    ) {
      return {
        replyText: buildBarbershopProductsReply(args.inboundText, args.clinicSettings),
        statePatch: {
          stage: safeStr(state.stage, "DISCOVERY"),
          lastIntent: "service_info",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: {
            ...buildInfoContextCollected(bookingCollected, "product_info"),
            pending_booking_stale: true,
          },
        },
        debug: withInterpreterDebug(
          { intent: "service_info", phase: "DISCOVERY", route: "barbershop_product_assistant" },
          runtimeIntent === "product_question" ? "runtime" : "shadow",
        ),
      };
    }

    if (
      asksAgendaLink &&
      (!state.nextExpected || state.nextExpected === "date_time" || state.nextExpected === "confirm_booking" || state.nextExpected === "date_only")
    ) {
      const bookingLink = safeStr(args.clinicSettings?.booking_link, "").trim();
      return {
        replyText: bookingLink
          ? `Claro, aquí podés elegir servicio, barbero y hora: ${bookingLink}`
          : "Todavía no tengo el calendario visual activado, pero te puedo buscar horarios por aquí.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: state.nextExpected ?? "date_time",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: bookingLink ? "barbershop_link_share" : "barbershop_link_not_available" },
      };
    }

    if (
      state.nextExpected === "confirm_booking" &&
      hasValidPendingForConfirm &&
      !pendingIsStale &&
      (isBusinessHoursQuestionText(args.inboundText) || barbershopLocationQuestion)
    ) {
      const pending = ((bookingCollected as any).pending_booking ?? {}) as Record<string, unknown>;
      const pendingReminder = formatBarbershopPendingBookingConfirmationReminder(pending, bookingCollected, state);
      const infoReply = isBusinessHoursQuestionText(args.inboundText)
        ? getBarbershopBusinessHoursReply(args.inboundText, args.clinicSettings)
          .replace(/\n\n¿Querés que revise espacios disponibles\?$/, "")
        : (() => {
          const address = resolveConfiguredBarbershopPublicLocation(args.clinicSettings);
          return address
            ? `Estamos ubicados en:\n${address}`
            : 'Por ahora no tengo la ubicación exacta configurada. Podés tocar "Hablar con alguien" para que te ayuden.';
        })();
      return {
        replyText: `${infoReply}\n\n${pendingReminder}`,
        statePatch: {
          stage: "CONFIRMING",
          lastIntent: isBusinessHoursQuestionText(args.inboundText) ? "hours" : "location",
          nextExpected: "confirm_booking",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            pending_booking: pending,
            pending_booking_stale: false,
            last_bot_step: "barbershop_preconfirm",
          },
        },
        debug: withInterpreterDebug({
          intent: isBusinessHoursQuestionText(args.inboundText) ? "hours" : "location",
          phase: "CONFIRMING",
          route: isBusinessHoursQuestionText(args.inboundText)
            ? "barbershop_pending_booking_hours_answer"
            : "barbershop_pending_booking_location_answer",
        }, "shadow"),
      };
    }

    if (!state.nextExpected && (isVagueTime || routedIntent === "vague_time")) {
      return {
        replyText: "Decime el día y la hora completos para revisar, por ejemplo: lunes a las 3 o mañana a las 5.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_vague_time_without_context" },
      };
    }

    if (
      state.nextExpected === "confirm_booking" &&
      (isBarbershopAvailabilityInterruptionText(args.inboundText) || isAvailabilityInquiryText(args.inboundText))
    ) {
      const preferredBarber = safeStr(bookingCollected.preferred_barber, "").trim();
      const interruptionReply = preferredBarber
        ? `Claro. Puedo revisarte otro horario con ${preferredBarber}. Decime qué día y hora querés probar.`
        : "Claro. Puedo revisarte otro horario. Decime qué día y hora querés probar.";
      return {
        replyText: interruptionReply,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            pending_booking_stale: true,
            last_bot_step: "barbershop_waiting_new_datetime",
          },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_confirm_interrupted_availability" },
      };
    }

    if (greetingDemotedIntent === "business_hours_question") {
      logBarbershopDiagnostic("business_hours_detected", { inbound_text: args.inboundText });
      return {
        replyText: getBarbershopBusinessHoursReply(args.inboundText, args.clinicSettings),
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "hours",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "hours", phase: "DISCOVERY", route: "barbershop_mixed_greeting_hours_answer" }, "shadow"),
      };
    }

    if (
      (isAvailabilityInquiryText(args.inboundText) ||
        isAvailabilityDiscoveryIntentText(args.inboundText) ||
        runtimeIntent === "availability_question") &&
      !isBusinessHoursQuestionText(args.inboundText) &&
      state.nextExpected !== "confirm_booking"
    ) {
      console.log(JSON.stringify({
        event: "barbershop:availability_discovery_entered",
        inbound_text: args.inboundText ?? null,
        route_selected: "barbershop_availability_discovery",
        nextExpected_before: safeStr(state.nextExpected, ""),
      }));
      const availabilityDateTime = parseDateTimeFromMessage(args.inboundText, timezone);
      const availabilityDate = parseDateOnlyFromMessage(args.inboundText, timezone);
      const availabilityTimeOnly = parseTimeOnlyFromMessage(args.inboundText);
      const normalizedAvailability = normalizeTextForIntent(args.inboundText);
      const availabilityTimePreference =
        /\b(en la tarde|tarde|mas tarde)\b/.test(normalizedAvailability)
          ? "afternoon"
          : /\b(temprano|en la manana|por la manana)\b/.test(normalizedAvailability)
          ? "morning"
          : /\b(en la noche|noche)\b/.test(normalizedAvailability)
          ? "evening"
          : undefined;
      if (availabilityDate) {
	        const serviceFromState = safeStr(bookingCollected.service, currentServiceForTimeRequest).trim();
        const resolvedInlineService = resolveBarbershopServiceFromSettings(args.inboundText, args.clinicSettings);
        const detectedInlineService = detectBarbershopService(normalizeTextForIntent(args.inboundText)).matchedService;
        const serviceForAvailability = serviceFromState ||
          safeStr(resolvedInlineService?.name, safeStr(detectedInlineService?.name, "")).trim();
        const providerAnyInAvailability = isAnyBarberPreferenceText(args.inboundText);
	        if (serviceForAvailability) {
	          if (availabilityDateTime?.time) {
	            if (hasActiveBookingStateContract) {
	              console.log(JSON.stringify({
	                event: "current_service_reused_for_time_request",
	                organization_id: args.organizationId ?? null,
	                service_key: currentServiceKey || null,
	                service_name: serviceForAvailability,
	                requested_date: availabilityDate,
	                requested_time: availabilityDateTime.time,
	              }));
	            } else {
	              logBarbershopDiagnostic("initial_message_exact_availability_detected", {
	                inbound_text: args.inboundText,
	                service: serviceForAvailability,
	                requested_date: availabilityDate,
	                requested_time: availabilityDateTime.time,
	              });
	            }
	            return {
	              replyText: "__CHECK_REQUESTED_AVAILABILITY__",
	              statePatch: {
	                stage: "BOOKING",
	                lastIntent: "book_appointment",
	                nextExpected: "confirm_booking",
	                orgType: "barbershop",
	                collected: {
	                  ...bookingCollected,
	                  service: serviceForAvailability,
	                  current_service_key: currentServiceKey || safeStr((bookingCollected as any).current_service_key, ""),
	                  current_service_name: serviceForAvailability,
	                  current_date: availabilityDate,
	                  activeBookingFlow: true,
	                  lastBookingStep: "select_time",
	                  availability_request: true,
	                  preferred_date: availabilityDate,
	                  preferred_time: availabilityDateTime.time,
	                  pending_booking: null,
	                  pending_booking_stale: true,
	                },
	              },
	              debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_current_service_availability_datetime" },
	            };
	          }
	          return {
            replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "availability_service",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                service: serviceForAvailability,
                availability_request: true,
                preferred_date: availabilityDate,
                ...(availabilityDateTime?.time ? { preferred_time: availabilityDateTime.time } : {}),
                ...(availabilityTimePreference ? { time_preference: availabilityTimePreference } : {}),
                ...(providerAnyInAvailability
                  ? { provider_preference: "any", provider_name: null, preferred_barber: null }
                  : {}),
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_day_known_with_service" },
          };
        }
        return {
          replyText: "Perfecto. ¿Qué servicio querés revisar: corte de pelo, barba, corte + barba o cejas?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "availability_service",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              availability_request: true,
              preferred_date: availabilityDate,
              ...(availabilityDateTime?.time ? { preferred_time: availabilityDateTime.time } : {}),
              ...(availabilityTimePreference ? { time_preference: availabilityTimePreference } : {}),
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_day_known_ask_service" },
        };
      }
      const serviceFromStateOrPending = safeStr(
        bookingCollected.service,
        safeStr((bookingCollected as any).pending_booking_request?.service, ""),
      ).trim();
      const inferredServiceNoDate = safeStr(
        resolveBarbershopServiceFromSettings(args.inboundText, args.clinicSettings)?.name,
        safeStr(detectBarbershopService(normalizeTextForIntent(args.inboundText)).matchedService?.name, isBarbershopHaircutIntentText(args.inboundText) ? "Corte clásico" : ""),
      ).trim();
      const inferredTimeNoDate = safeStr(availabilityDateTime?.time, safeStr(availabilityTimeOnly, "")).trim();
      if (inferredServiceNoDate && inferredTimeNoDate) {
        const pending = mergePendingBookingRequest({
          bookingCollected,
          detectedServiceName: inferredServiceNoDate,
          parsedDate: null,
          parsedTime: inferredTimeNoDate,
          providerName: null,
          providerPreference: isAnyBarberPreferenceText(args.inboundText) ? "any" : null,
          source: shouldUseRuntimeInterpreter ? "llm_interpreter" : "deterministic",
        });
        return {
          replyText: "Claro 🔥 ¿Para qué día querés que te revise horarios?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "booking_date",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking_request: pending,
              service: inferredServiceNoDate,
              preferred_time: inferredTimeNoDate,
              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_missing_date_with_time" },
        };
      }
      const serviceFromInputOnly = safeStr(
        resolveBarbershopServiceFromSettings(args.inboundText, args.clinicSettings)?.name,
        safeStr(detectBarbershopService(normalizeTextForIntent(args.inboundText)).matchedService?.name, ""),
      ).trim();
      const serviceForDiscovery = serviceFromStateOrPending || serviceFromInputOnly;
      if (serviceForDiscovery) {
        const discoveryDate = safeStr(
          bookingCollected.preferred_date,
          getNowInTimezone(timezone).toISOString().slice(0, 10),
        );
        console.log(JSON.stringify({
          event: "barbershop:availability_discovery_service_context",
          service: serviceForDiscovery,
          discovery_date: discoveryDate,
        }));
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: serviceForDiscovery,
              availability_request: true,
              preferred_date: discoveryDate,
              ...(availabilityTimePreference ? { time_preference: availabilityTimePreference } : {}),
              pending_booking: null,
              pending_booking_stale: true,
              pending_booking_request: {
                service: serviceForDiscovery,
                preferred_date: discoveryDate,
                preferred_time: null,
                provider_name: safeStr((bookingCollected as any).provider_name, "") || null,
                provider_preference: safeStr((bookingCollected as any).provider_preference, "") === "any" ? "any" : null,
                patient_name: safeStr((bookingCollected as any).patient_name, "") || null,
                booking_for_other: Boolean((bookingCollected as any).booking_for_other),
                missing_fields: ["time"],
                source: "context_merge",
              },
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_discovery_show_next" },
        };
      }
      console.log(JSON.stringify({
        event: "barbershop:availability_discovery_blocked_reason",
        reason: "missing_service",
      }));
      const hasDateContext = Boolean(
        safeStr(bookingCollected.preferred_date, "").trim() ||
          safeStr((bookingCollected as any).pending_booking_request?.preferred_date, "").trim(),
      );
      if (!hasDateContext) {
        return {
          replyText: "Claro 🔥 ¿Para qué día querés que te revise horarios?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "availability_day",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_discovery_ask_day_first" },
        };
      }
      return {
        replyText: "Te reviso. ¿Qué servicio querés: corte, barba o corte + barba?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "availability_service",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            availability_request: true,
            pending_booking: null,
            pending_booking_stale: true,
            pending_booking_request: {
              service: null,
              preferred_date: safeStr(bookingCollected.preferred_date, getNowInTimezone(timezone).toISOString().slice(0, 10)),
              preferred_time: null,
              provider_name: null,
              provider_preference: null,
              patient_name: safeStr((bookingCollected as any).patient_name, "") || null,
              booking_for_other: Boolean((bookingCollected as any).booking_for_other),
              missing_fields: ["service"],
              source: "context_merge",
            },
          },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_discovery_ask_service" },
      };
    }

	    if (safeStr(state.nextExpected, "") === "availability_day") {
      const parsedDate = parseDateOnlyFromMessage(args.inboundText, timezone);
      if (!parsedDate) {
        return {
          replyText: "Claro 🔥 Decime qué día querés que te revise horarios.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "availability_day",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              availability_request: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_day_reask" },
        };
      }
      return {
        replyText: "Perfecto. ¿Qué servicio querés revisar: corte de pelo, barba, corte + barba o cejas?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "availability_service",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            availability_request: true,
            preferred_date: parsedDate,
            pending_booking: null,
            pending_booking_stale: true,
          },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_day_to_service" },
	      };
	    }

	    const currentDateTimeRequest = parsedDateTime ??
	      (parsedTimeOnly && (parsedDateOnly || currentDate)
	        ? { date: parsedDateOnly || currentDate, time: parsedTimeOnly }
	        : null);
	    const hasLastOfferedSlotsForState = Array.isArray((bookingCollected as any).last_offered_slots) &&
	      ((bookingCollected as any).last_offered_slots as unknown[]).length > 0;
	    if (
	      hasActiveBookingStateContract &&
	      currentServiceForTimeRequest &&
	      currentDateTimeRequest &&
	      (Boolean(parsedDateTime) || !hasLastOfferedSlotsForState)
	    ) {
	      console.log(JSON.stringify({
	        event: "current_service_reused_for_time_request",
	        organization_id: args.organizationId ?? null,
	        service_key: currentServiceKey || null,
	        service_name: currentServiceForTimeRequest,
	        requested_date: currentDateTimeRequest.date,
	        requested_time: currentDateTimeRequest.time,
	      }));
	      return {
	        replyText: "__CHECK_REQUESTED_AVAILABILITY__",
	        statePatch: {
	          stage: "BOOKING",
	          lastIntent: "book_appointment",
	          nextExpected: "confirm_booking",
	          orgType: "barbershop",
	          collected: {
	            ...bookingCollected,
	            service: currentServiceForTimeRequest,
	            current_service_key: currentServiceKey || safeStr((bookingCollected as any).current_service_key, ""),
	            current_service_name: currentServiceForTimeRequest,
	            current_date: currentDateTimeRequest.date,
	            preferred_date: currentDateTimeRequest.date,
	            preferred_time: currentDateTimeRequest.time,
	            activeBookingFlow: true,
	            lastBookingStep: "select_time",
	            pending_booking: null,
	            pending_booking_stale: true,
	          },
	        },
	        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_current_service_time_request" },
	      };
	    }

	    if (
	      safeStr(state.nextExpected, "") === "availability_slot_selection" ||
      (Boolean((bookingCollected as any).last_availability_context) && isLikelySlotSelectionText(args.inboundText))
    ) {
	      const context = (((bookingCollected as any).last_availability_context ?? {}) as Record<string, unknown>);
	      const contextService = safeStr(context.service, currentServiceForTimeRequest || safeStr(bookingCollected.service, "")).trim();
	      const contextDate = safeStr(context.date, currentDate || safeStr(bookingCollected.preferred_date, "")).trim();
	      const lastOfferedSlots = Array.isArray((bookingCollected as any).last_offered_slots)
	        ? ((bookingCollected as any).last_offered_slots as Array<Record<string, unknown>>)
	        : [];
	      const contextSlots = Array.isArray(context.slots) ? (context.slots as Array<Record<string, unknown>>) : [];
      const shownOffset = Math.max(
        0,
        Number((context as any).shown_offset ?? (bookingCollected as any).availability_shown_offset ?? 0) || 0,
      );
      const pageSize = Math.max(
        1,
        Math.min(10, Number((context as any).page_size ?? (bookingCollected as any).availability_page_size ?? 3) || 3),
      );
      const moreRequest = isMoreSlotsRequestText(args.inboundText);
      const earlierRequest = isEarlierSlotsRequestText(args.inboundText);
      const otherHourRequest = isOtherHourRequestText(args.inboundText);
      const morningRequest = isMorningSlotsRequestText(args.inboundText);
      const afternoonRequest = isAfternoonSlotsRequestText(args.inboundText);
      const afterThreshold = parseAfterTimeThreshold(args.inboundText);
      const contextTimes = contextSlots
        .map((slot) => safeStr(slot.time, "").trim())
        .filter(Boolean)
        .filter((time, idx, arr) => arr.indexOf(time) === idx)
        .sort();
      const contextSlotByTime = new Map<string, Record<string, unknown>>();
      for (const slot of contextSlots) {
        const time = safeStr(slot.time, "").trim();
        if (!time || contextSlotByTime.has(time)) continue;
        contextSlotByTime.set(time, slot);
      }
      const formatSelectionReply = (times: string[]) => {
        const line = times.slice(0, 3).map((time) => formatHourLabel(time)).join(" · ");
        return `Para ${formatHumanDay(contextDate)} tengo estos espacios disponibles:\n\n${line}\n\nSi querés otra hora, decímela y reviso.`;
      };
      const hourOf = (time: string): number => Number((time.split(":")[0] ?? "-1"));
      if (
        contextService &&
        contextDate &&
        contextTimes.length > 0 &&
        (moreRequest || earlierRequest || otherHourRequest || morningRequest || afternoonRequest || Boolean(afterThreshold))
      ) {
        let filteredTimes = [...contextTimes];
        if (afterThreshold) {
          filteredTimes = filteredTimes.filter((time) => time >= afterThreshold);
        } else if (morningRequest) {
          filteredTimes = filteredTimes.filter((time) => {
            const hour = hourOf(time);
            return hour >= 0 && hour < 12;
          });
        } else if (afternoonRequest) {
          filteredTimes = filteredTimes.filter((time) => {
            const hour = hourOf(time);
            return hour >= 12;
          });
        } else {
          const start = earlierRequest
            ? Math.max(0, shownOffset - pageSize)
            : Math.min(Math.max(0, contextTimes.length - 1), shownOffset + pageSize);
          filteredTimes = contextTimes.slice(start, start + pageSize);
        }
        if (filteredTimes.length === 0) {
          return {
            replyText: "No encontré una opción en ese rango. Si querés, decime una hora exacta y la reviso.",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "availability",
              nextExpected: "availability_slot_selection",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                service: contextService,
                preferred_date: contextDate,
                availability_request: true,
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_slot_selection_context_empty_range" },
          };
        }
        const selectedPreviewTimes = filteredTimes.slice(0, 3);
        const nextOffset = contextTimes.findIndex((time) => time === selectedPreviewTimes[0]);
        return {
          replyText: formatSelectionReply(selectedPreviewTimes),
          statePatch: {
            stage: "BOOKING",
            lastIntent: "availability",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: contextService,
              preferred_date: contextDate,
              availability_request: true,
              availability_shown_offset: nextOffset >= 0 ? nextOffset : shownOffset,
              last_availability_slots: selectedPreviewTimes.map((time) => ({
                date: contextDate,
                time,
                provider_id: safeStr(contextSlotByTime.get(time)?.provider_id, "") || null,
                provider_name: safeStr(contextSlotByTime.get(time)?.provider_name, "") || null,
              })),
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_slot_selection_context_filter" },
        };
      }
      if (moreRequest && contextService && contextDate && contextSlots.length > 0) {
        const nextOffset = Math.min(contextSlots.length, shownOffset + pageSize);
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "availability",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: contextService,
              preferred_date: contextDate,
              availability_request: true,
              availability_shown_offset: nextOffset,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_slot_selection_more_slots" },
        };
      }
	      const selectedOrdinal = getSlotOrdinalSelection(args.inboundText);
	      const selectedByOfferedOrdinal = selectedOrdinal != null ? (lastOfferedSlots[selectedOrdinal] ?? null) : null;
	      const selectedByOrdinal = selectedOrdinal != null ? (contextSlots[selectedOrdinal] ?? null) : null;
	      const selectedByOfferedLast = isLastSlotSelectionText(args.inboundText) && lastOfferedSlots.length > 0
	        ? lastOfferedSlots[lastOfferedSlots.length - 1]
	        : null;
	      const selectedByLast = isLastSlotSelectionText(args.inboundText) && contextSlots.length > 0
	        ? contextSlots[Math.max(0, Math.min(contextSlots.length - 1, shownOffset + pageSize - 1))]
	        : null;
	      const selectedByTime = parseTimeOnlyFromMessage(args.inboundText);
	      const selectedByOfferedTime = selectedByTime
	        ? lastOfferedSlots.find((slot) => safeStr(slot.time, "").trim() === selectedByTime)
	        : null;
	      const selectedSlot = selectedByOfferedOrdinal ?? selectedByOfferedLast ?? selectedByOfferedTime ??
	        selectedByOrdinal ?? selectedByLast ?? (selectedByTime
	        ? contextSlots.find((slot) => safeStr(slot.time, "").trim() === selectedByTime)
	        : null);
	      const selectedFromLastOffered = Boolean(selectedByOfferedOrdinal ?? selectedByOfferedLast ?? selectedByOfferedTime);

      const requestedNewDate = parseDateOnlyFromMessage(args.inboundText, timezone);
      if (requestedNewDate && contextService) {
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "availability",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: contextService,
              preferred_date: requestedNewDate,
              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_slot_selection_switch_day" },
        };
      }

	      if (selectedSlot && contextService && contextDate) {
	        const selectedTime = safeStr(selectedSlot.time, "").trim();
	        const selectedDateFromSlot = safeStr(selectedSlot.date, "").trim();
	        const resolvedSelectedDate = selectedDateFromSlot || contextDate;
	        const selectedProviderName = safeStr(selectedSlot.provider_name, "").trim();
	        const selectedProviderId = safeStr(selectedSlot.provider_id, "").trim();
	        const selectedSlotContract = {
	          service_key: safeStr(selectedSlot.service_key, currentServiceKey),
	          service_name: safeStr(selectedSlot.service_name, contextService),
	          date: resolvedSelectedDate,
	          time: selectedTime,
	          starts_at: safeStr(selectedSlot.starts_at, ""),
	          provider_id: selectedProviderId,
	          provider_name: selectedProviderName,
	          duration_min: Number((selectedSlot as any).duration_min ?? 30) || 30,
	          source: safeStr((selectedSlot as any).source, selectedFromLastOffered ? "last_offered_slots" : "availability_context"),
	        };
	        console.log(JSON.stringify({
	          event: "barbershop:slot_selection_context_used",
	          inbound_text: args.inboundText ?? null,
          selected_time: selectedTime || null,
	          service: contextService,
	          date: resolvedSelectedDate,
	        }));
	        if (selectedFromLastOffered) {
	          console.log(JSON.stringify({
	            event: "selected_slot_matched_from_last_offered_slots",
	            organization_id: args.organizationId ?? null,
	            selected_slot: selectedSlotContract,
	          }));
	        }
	        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: contextService,
              preferred_date: resolvedSelectedDate,
	              preferred_time: selectedTime,
	              provider_name: selectedProviderName || null,
	              provider_id: selectedProviderId || null,
	              preferred_barber: selectedProviderName || null,
	              current_service_key: safeStr(selectedSlotContract.service_key, currentServiceKey),
	              current_service_name: safeStr(selectedSlotContract.service_name, contextService),
	              current_date: resolvedSelectedDate,
	              activeBookingFlow: true,
	              lastBookingStep: "select_time",
	              selected_slot: selectedSlotContract,
	              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
              ...(isAnyBarberPreferenceText(args.inboundText) ? { provider_preference: "any", provider_name: null, preferred_barber: null } : {}),
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_slot_selection_check_requested" },
        };
      }

      if (contextService && contextDate && selectedByTime && !contextTimes.includes(selectedByTime)) {
        const requestedMin = toMinutes(selectedByTime);
        const nearest = contextTimes
          .map((time) => ({ time, distance: Math.abs(toMinutes(time) - requestedMin) }))
          .filter((entry) => Number.isFinite(entry.distance))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3)
          .map((entry) => formatHourLabel(entry.time))
          .join(" · ");
        return {
          replyText: nearest
            ? `Esa hora no está libre, pero tengo estas opciones cercanas:\n${nearest}\n¿Cuál te queda mejor?`
            : "Esa hora no está libre. Si querés, te paso opciones cercanas.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "availability",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: contextService,
              preferred_date: contextDate,
              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_slot_selection_unavailable_nearest" },
        };
      }

      if (contextService && contextDate && selectedByTime) {
        const matchedSlotByTime = contextSlots.find((slot) => safeStr(slot.time, "").trim() === selectedByTime);
        const selectedDateFromTimeMatch = safeStr(matchedSlotByTime?.date, "").trim();
        const resolvedSelectedDate = selectedDateFromTimeMatch || contextDate;
        const selectedProviderName = safeStr(matchedSlotByTime?.provider_name, "").trim();
        const selectedProviderId = safeStr(matchedSlotByTime?.provider_id, "").trim();
        console.log(JSON.stringify({
          event: "barbershop:slot_selection_context_used",
          inbound_text: args.inboundText ?? null,
          selected_time: selectedByTime,
          service: contextService,
          date: resolvedSelectedDate,
        }));
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: contextService,
              preferred_date: resolvedSelectedDate,
              preferred_time: selectedByTime,
              provider_name: selectedProviderName || null,
              provider_id: selectedProviderId || null,
              preferred_barber: selectedProviderName || null,
              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_slot_selection_time_repair" },
        };
      }
    }

    if (safeStr(state.nextExpected, "") === "availability_service") {
      const detectedServiceName =
        resolveBarbershopServiceFromSettings(args.inboundText, args.clinicSettings)?.name ??
        detectBarbershopService(args.inboundText).matchedService?.name ??
        (isBarbershopHaircutIntentText(args.inboundText) ? "Corte clásico" : "");
      const selectedService = detectedServiceName || safeStr((mergedPendingBookingRequest as any).service, "");
      const preferredDate = safeStr(bookingCollected.preferred_date, "");
      const selectedTimeFromText = parseTimeOnlyFromMessage(args.inboundText);
      const selectedFirstOption = isFirstSlotSelectionText(args.inboundText);
      const lastAvailabilitySlots = Array.isArray((bookingCollected as any).last_availability_slots)
        ? ((bookingCollected as any).last_availability_slots as Array<Record<string, unknown>>)
        : [];
      const firstSlot = lastAvailabilitySlots.find((slot) =>
        safeStr(slot?.date, "").trim() && safeStr(slot?.time, "").trim()
      );
      const selectedTime = selectedFirstOption
        ? safeStr(firstSlot?.time, "")
        : safeStr(selectedTimeFromText, "");
      const selectedDate = selectedFirstOption
        ? safeStr(firstSlot?.date, preferredDate)
        : preferredDate;
      const normalizedInbound = normalizeTextForIntent(args.inboundText);
      const existingService = safeStr(bookingCollected.service, "").trim();

      if (selectedFirstOption && !firstSlot) {
        return {
          replyText: "Decime una hora específica de la lista, por ejemplo: 9:00 o 9:30.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "availability_service",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              availability_request: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_first_slot_missing_list" },
        };
      }

      if (selectedTime && selectedDate && existingService) {
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              availability_request: true,
              service: existingService,
              preferred_date: selectedDate,
              preferred_time: selectedTime,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_pick_time" },
        };
      }

      if (!selectedService) {
        if (/\bya te dije\b/.test(normalizedInbound)) {
          if (preferredDate && safeStr(bookingCollected.service, "").trim()) {
            return {
              replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
              statePatch: {
                stage: "BOOKING",
                lastIntent: "book_appointment",
                nextExpected: "availability_service",
                orgType: "barbershop",
                collected: {
                  ...bookingCollected,
                  availability_request: true,
                  pending_booking: null,
                  pending_booking_stale: true,
                },
              },
              debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_recover_show" },
            };
          }
          return {
            replyText: "Perfecto. ¿Qué servicio querés revisar: corte de pelo, barba, corte + barba o cejas?",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "availability_service",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                availability_request: true,
              },
            },
            debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_recover_ask_service" },
          };
        }
        return {
          replyText: "Decime qué servicio querés revisar: corte de pelo, barba, corte + barba o cejas.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "availability_service",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              availability_request: true,
              pending_booking_request: { ...mergedPendingBookingRequest, source: "context_merge" },
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_service_reask" },
        };
      }
      if (!preferredDate) {
        return {
          replyText: "Perfecto. ¿Para qué día querés que te revise horarios?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "availability_day",
            orgType: "barbershop",
          collected: {
            ...bookingCollected,
            service: selectedService,
            availability_request: true,
            pending_booking_request: { ...mergedPendingBookingRequest, service: selectedService, source: "context_merge" },
          },
        },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_missing_day" },
        };
      }
      const preferredTime = safeStr((bookingCollected as any).preferred_time, "").trim();
      if (selectedService && preferredDate && preferredTime) {
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              availability_request: true,
              service: selectedService,
              preferred_date: preferredDate,
              preferred_time: preferredTime,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_service_reuse_date_time" },
        };
      }
      return {
        replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "availability_service",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            availability_request: true,
            service: selectedService,
            preferred_date: preferredDate,
            pending_booking: null,
            pending_booking_stale: true,
          },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_availability_service_show_slots" },
      };
    }

    if (safeStr(state.nextExpected, "").trim() === "service") {
      const selectedService = resolveBarbershopServiceFromSettings(args.inboundText, args.clinicSettings)?.name ??
        detectBarbershopService(args.inboundText).matchedService?.name ??
        (isBarbershopHaircutIntentText(args.inboundText) ? "Corte clásico" : "");
      const merged = {
        ...mergedPendingBookingRequest,
        service: selectedService || mergedPendingBookingRequest.service,
        source: "context_merge" as const,
      };
      merged.missing_fields = computeBookingMissingFields(merged);
      if (merged.service && merged.preferred_date && merged.preferred_time) {
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: merged.service,
              preferred_date: merged.preferred_date,
              preferred_time: merged.preferred_time,
              provider_name: merged.provider_name,
              preferred_barber: merged.provider_preference === "any" ? null : merged.provider_name,
              provider_preference: merged.provider_preference,
              pending_booking_request: merged,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_service_reply_merged_to_check_availability" },
        };
      }
      if (merged.service && merged.preferred_date && !merged.preferred_time) {
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "availability",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: merged.service,
              preferred_date: merged.preferred_date,
              pending_booking_request: merged,
              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_service_reply_merged_to_show_availability" },
        };
      }
      if (!merged.service) {
        return {
          replyText: "Claro. ¿Querés Corte de pelo, barba, corte + barba o cejas?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "service",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking_request: merged,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_service_reply_reask_service" },
        };
      }
    }

    if (
      state.nextExpected === "date_time" &&
      safeStr((bookingCollected as any).last_bot_step, "") === "barbershop_waiting_new_datetime" &&
      isAgendaLinkRequestText(args.inboundText)
    ) {
      const bookingLink = safeStr(args.clinicSettings?.booking_link, "").trim();
      const replyText =
        bookingLink
          ? `Claro, aquí podés elegir servicio, barbero y hora: ${bookingLink}`
          : "Todavía no tengo el calendario visual activado, pero te puedo buscar horarios por aquí.";
      return {
        replyText,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: bookingLink ? "barbershop_waiting_new_datetime_link_share" : "barbershop_waiting_new_datetime_link" },
      };
    }

    if (state.nextExpected === "date_only") {
      const parsedDateOnly = parseDateOnlyFromMessage(args.inboundText, timezone);
      if (parsedDateOnly) {
        const keptTime = safeStr((bookingCollected as any).preferred_time, "").trim();
        if (keptTime) {
          return {
            replyText: "__CHECK_REQUESTED_AVAILABILITY__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "confirm_booking",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                preferred_date: parsedDateOnly,
                preferred_time: keptTime,
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_date_only_to_check_availability" },
          };
        }
      }
      return {
        replyText: "Perfecto. ¿Para qué día lo querés?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_only",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_date_only_reask" },
      };
    }

    if (state.nextExpected === "time_only") {
      const timeOnly = parseTimeOnlyFromMessage(args.inboundText);
      const keptDate = safeStr((bookingCollected as any).preferred_date, "").trim();
      if (timeOnly && keptDate) {
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              preferred_date: keptDate,
              preferred_time: timeOnly,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_time_only_to_check_availability" },
        };
      }
      return {
        replyText: "Perfecto. ¿A qué hora te queda bien?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "time_only",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_time_only_reask" },
      };
    }

    if (state.nextExpected === "date_time") {
      const parsedDateOnly = parseDateOnlyFromMessage(args.inboundText, timezone);
      const timeOnly = parseTimeOnlyFromMessage(args.inboundText);
      const hasDateSignal =
        /\b(hoy|mañana|pasado mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i
          .test(args.inboundText);
      const hasTimeOnly = Boolean(timeOnly) && !hasDateSignal && !parseDateTimeFromMessage(args.inboundText, timezone);
      const hasServiceContext = safeStr(bookingCollected.service, "").trim().length > 0;
      if (hasServiceContext && hasTimeOnly) {
        return {
          replyText: `Perfecto, a las ${formatHourLabel(safeStr(timeOnly, ""))}. ¿Para qué día lo querés?`,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_only",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              preferred_time: timeOnly,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_time_only_capture" },
        };
      }
      if (hasServiceContext && parsedDateOnly && !parseDateTimeFromMessage(args.inboundText, timezone)) {
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              preferred_date: parsedDateOnly,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_date_only_show_slots" },
        };
      }
    }

    if (isBarbershopGenericBookingRequestText(args.inboundText) && !parsedDateTime) {
      return {
        replyText: "Dale, te ayudo con la cita. ¿Qué día y hora querés?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          orgType: "barbershop",
          collected: { ...bookingCollected, preferred_barber: null },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_generic_booking_datetime" },
      };
    }

    if (
      isBarbershopGenericBookingRequestText(args.inboundText) &&
      parsedDateTime &&
      !effectiveDetectedService
    ) {
      bookingCollected.service = "";
    }

    if (
      isBarbershopHaircutIntentText(args.inboundText) &&
      !parsedDateTime &&
      !hasBarberMention &&
      !serviceDetection.preferredBarber
    ) {
      return {
        replyText: "Dale, ¿qué día u hora te queda mejor para el corte?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          orgType: "barbershop",
          collected: { ...bookingCollected, service: "Corte clásico", preferred_barber: null },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_haircut_datetime" },
      };
    }

    if (
      state.nextExpected === "date_time" &&
      safeStr((bookingCollected as any).last_bot_step, "") === "barbershop_waiting_new_datetime" &&
      isVagueTimePreferenceText(args.inboundText)
    ) {
      return {
        replyText: "Decime una hora específica para revisar, por ejemplo: lunes a las 3 o mañana a las 5.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_waiting_specific_time" },
      };
    }

    if (
      state.nextExpected === "date_time" &&
      isKeepPreviousSlotText(args.inboundText) &&
      Boolean((bookingCollected as any).pending_booking_stale) &&
      Boolean((bookingCollected as any).pending_booking)
    ) {
      const pending = ((bookingCollected as any).pending_booking ?? {}) as Record<string, unknown>;
      const restoreDate = safeStr((pending as any).appointment_date, safeStr((bookingCollected as any).preferred_date, ""));
      const restoreTime = safeStr((pending as any).appointment_time, safeStr((bookingCollected as any).preferred_time, ""));
      const restoreBarber = safeStr((pending as any).preferred_barber, safeStr((bookingCollected as any).preferred_barber, "")).trim();
      const withBarber = restoreBarber ? ` con ${restoreBarber}` : "";
      return {
        replyText: `Perfecto. Mantenemos ${formatHumanDay(restoreDate)} a las ${formatHourLabel(restoreTime)}${withBarber}. ¿Confirmamos?`,
        statePatch: {
          stage: "CONFIRMING",
          lastIntent: "book_appointment",
          nextExpected: "confirm_booking",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            preferred_date: restoreDate,
            preferred_time: restoreTime,
            preferred_barber: restoreBarber || null,
            pending_booking_stale: false,
            last_bot_step: "barbershop_preconfirm",
            pending_booking: {
              ...(pending ?? {}),
              appointment_date: restoreDate,
              appointment_time: restoreTime,
              preferred_barber: restoreBarber || null,
              status: "pending_confirmation",
            },
          },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_restore_previous_preconfirm" },
      };
    }

    if (state.nextExpected === "confirm_booking" && isCleanConfirmationText(args.inboundText)) {
      console.log(JSON.stringify({
        event: "barbershop:confirmation_freshness_check",
        confirm_inbound_message_id: inboundMessageId || null,
        pending_booking_created_from_inbound_message_id: pendingCreatedFromInboundMessageId || null,
        pending_booking_preconfirm_sent_at: pendingPreconfirmSentAt || null,
        confirm_inbound_message_created_at: inboundMessageCreatedAt || null,
        confirmation_is_fresh: pendingConfirmationFreshness.fresh,
        stale_confirmation_blocked: pendingConfirmationFreshness.blocked,
        reason: pendingConfirmationFreshness.reason,
      }));
      if (pendingConfirmationFreshness.blocked) {
        return {
          replyText: "Perfecto. Para confirmar, respondé de nuevo \"Confirmar\" sobre la última propuesta de horario.",
          statePatch: {
            stage: "CONFIRMING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking_stale: false,
            },
          },
          debug: { intent: "book_appointment", phase: "CONFIRMING", route: "barbershop_confirm_stale_confirmation_blocked" },
        };
      }
      if (!canExecuteBookingConfirmation({
        pendingAction,
        lastBotStep: safeStr(bookingCollected.last_bot_step, ""),
        hasPendingBooking,
        pendingBookingStale: pendingIsStale,
      }) || !hasActivePreconfirm) {
        return {
          replyText: "Para confirmar, primero necesito que revisemos y dejemos un horario específico. ¿Qué día y hora te queda mejor?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking: null,
              pending_booking_stale: false,
              last_bot_step: "barbershop_confirm_requires_fresh_preconfirm",
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_confirm_stale_guard" },
        };
      }
      const selectedServiceName = safeStr(bookingCollected.service, "Corte clásico");
      const pending = ((bookingCollected as any).pending_booking ?? {}) as Record<string, unknown>;
      const selectedSlot = ((pending as any).selected_slot ?? (bookingCollected as any).selected_slot ?? null) as Record<string, unknown> | null;
      const isGenericBarberBooking = selectedServiceName === "Cita barbería";
      const selectedServiceFromSettings = isGenericBarberBooking
        ? null
        : resolveBarbershopServiceFromSettings(selectedServiceName, args.clinicSettings);
      const selectedServiceDetection = isGenericBarberBooking
        ? null
        : detectBarbershopService(selectedServiceName).matchedService;
      const selectedService = selectedServiceDetection ?? getBarbershopServiceById("haircut");
      const durationMin = isGenericBarberBooking
        ? 45
        : (Number((selectedSlot as any)?.duration_min) || selectedServiceFromSettings?.durationMin || selectedService?.durationMinutes || 30);
      const preferredBarber = safeStr(
        (selectedSlot as any)?.provider_name,
        safeStr((pending as any).provider_name, safeStr(bookingCollected.preferred_barber, "")),
      ).trim();
      const providerId = safeStr((selectedSlot as any)?.provider_id, safeStr((pending as any).provider_id, "")).trim();
      const reasonAndTitle = isGenericBarberBooking
        ? "Cita barbería"
        : safeStr((selectedSlot as any)?.service_name, safeStr(bookingCollected.service, "Corte clásico"));
      const patientName = resolveAppointmentPatientName(bookingCollected, state);
      if (!safeStr(patientName, "").trim()) {
        return {
          replyText: "Perfecto. ¿A nombre de quién dejamos la cita?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "customer_name",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking_stale: false,
              last_bot_step: "barbershop_ask_customer_name",
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_require_name_before_booking" },
        };
      }
      return {
        replyText: "Perfecto, estoy procesando tu reserva ahora mismo.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "booking_confirmed",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            confirmed: true,
            pending_booking_stale: false,
            last_bot_step: "barbershop_booking_confirmed",
          },
        },
        toolAction: {
          name: "book_appointment",
          payload: {
            business_type: "barbershop",
            selected_slot: selectedSlot,
            patient_name: patientName,
            service: reasonAndTitle,
            reason: reasonAndTitle,
            title: reasonAndTitle,
            appointment_date: safeStr((selectedSlot as any)?.date, safeStr(bookingCollected.preferred_date, "")),
            appointment_time: safeStr((selectedSlot as any)?.time, safeStr(bookingCollected.preferred_time, "")),
            starts_at: safeStr((selectedSlot as any)?.starts_at, ""),
            duration_min: durationMin,
            preferred_barber: preferredBarber || null,
            provider_name: preferredBarber || null,
            provider_id: providerId || null,
            hold_id: safeStr((selectedSlot as any)?.hold_id, safeStr((pending as any).hold_id, "")) || null,
          },
        },
        debug: { intent: "book_appointment", phase: "CONFIRMING", route: "barbershop_confirm_booking" },
      };
    }

    const configuredServices = getBarbershopServicesFromSettings(args.clinicSettings);
    const walkInFaqAnswer = findBarbershopFaqAnswer(args.inboundText, args.clinicSettings);
    if (isBusinessHoursQuestionText(args.inboundText)) {
      logBarbershopDiagnostic("business_hours_detected", { inbound_text: args.inboundText });
      return {
        replyText: getBarbershopBusinessHoursReply(args.inboundText, args.clinicSettings),
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "hours",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "hours", phase: "DISCOVERY", route: "barbershop_hours_answer" }, "shadow"),
      };
    }
    if (
      /\b(donde estan|donde están|donde quedan|donde quedan ubicados|donde estan ubicados|donde están ubicados|ubicacion|ubicación|direccion|dirección)\b/
        .test(normalizeTextForIntent(args.inboundText))
    ) {
      const publicLocation = resolveBarbershopPublicLocation(args.clinicSettings);
      logBarbershopDiagnostic("location_question_detected", { inbound_text: args.inboundText });
      return {
        replyText: `Estamos en ${publicLocation} 💈\n\n¿Querés que te busque un espacio?`,
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "location",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "location", phase: "DISCOVERY", route: "barbershop_location_public" }, "shadow"),
      };
    }
    if (walkInFaqAnswer) {
      return {
        replyText: `${walkInFaqAnswer}\n\n¿Querés que te busque un espacio?`,
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "faq",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "faq", phase: "DISCOVERY", route: "barbershop_faq_answer" }, "shadow"),
      };
    }

    if ((isBarbershopServicesQuestion(args.inboundText) || /\b(que precios|precios tienes|precios tenes|que precios tienen|lista de precios)\b/.test(normalizeTextForIntent(args.inboundText))) && configuredServices.length > 0) {
      const servicesLine = configuredServices
        .slice(0, 4)
        .map((service) =>
          `${getBarbershopServiceEmoji(service.name)} ${service.name} — ${formatBarbershopPrice(service.price)} · ${formatBarbershopDurationLabel(service.durationMin)}\n${getBarbershopServiceBenefitLine(service.name)}`
        )
        .join("\n\n");
      const brandName = getBarbershopCopyBrandName({
        ...(args.clinicSettings ?? {}),
        organization_id: args.organizationId,
      });
      return {
        replyText: `Estos son los servicios de ${brandName} 💈\n\n${servicesLine}\n\n¿Querés reservar un espacio?`,
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "services",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug({ intent: "services", phase: "DISCOVERY", route: "barbershop_services_from_settings" }, "shadow"),
      };
    }

    if (isBarbershopChooseBarberQuestion(args.inboundText)) {
      return {
        replyText: "Dale, podés escoger barbero o te asigno el que esté libre. Si me decís día y hora, te reviso disponibilidad.",
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug(
          { intent: "book_appointment", phase: "DISCOVERY", route: "barbershop_choose_barber_answer" },
          "shadow",
        ),
      };
    }
    const hasInlineBookingContext = Boolean(
      safeStr(state.stage, "") === "BOOKING" ||
      safeStr(state.stage, "") === "CONFIRMING" ||
      safeStr(state.nextExpected, "").trim(),
    );
    if (!hasInlineBookingContext && !hasPendingBooking && isBarbershopOutOfScopeText(args.inboundText)) {
      logBarbershopDiagnostic("out_of_scope_barbershop", { inbound_text: args.inboundText });
      return {
        replyText:
          "Por ahora solo te puedo ayudar con citas, precios, horarios y ubicación de la barbería 💈\n\n¿Querés agendar o ver precios?",
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "unknown",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: { ...bookingCollected },
        },
        debug: withInterpreterDebug(
          { intent: "unknown", phase: "DISCOVERY", route: "barbershop_out_of_scope_fallback" },
          "shadow",
        ),
      };
    }

    if (state.nextExpected === "service_for_pricing" || (safeStr(bookingCollected.last_info_topic, "") === "pricing" && isBarbershopPricingFollowup(args.inboundText))) {
      logBarbershopDiagnostic("pricing_followup_detected", { inbound_text: args.inboundText });
      const normalizedServicePick = normalizeTextForIntent(args.inboundText)
        .replace(/c\\y/g, "c y")
        .replace(/\bcy\b/g, "c y")
        .replace(/\bc\s*y\b/g, "y")
        .replace(/\s+/g, " ");
      const picked = resolveBarbershopServiceFromSettings(normalizedServicePick, args.clinicSettings);
      if (picked) {
          return {
            replyText: formatBarbershopPricingAnswer(picked),
            statePatch: {
              stage: "DISCOVERY",
              lastIntent: "pricing",
              lastTopic: "pricing",
              nextExpected: undefined,
              orgType: "barbershop",
              collected: buildBarbershopPricingCollected(bookingCollected, picked, hasPendingBooking && !pendingIsStale),
            },
            debug: withInterpreterDebug(
              { intent: "pricing", phase: "DISCOVERY", route: "barbershop_pricing_followup_service_pick" },
              "shadow",
            ),
          };
      }
      const serviceMenu = formatBarbershopServiceMenuFromSettings(configuredServices, "");
      return {
        replyText: serviceMenu ? `Dale 💈 ¿Qué servicio querés consultar?\n\n${serviceMenu}` : "Dale 💈 ¿Qué servicio querés consultar?",
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "pricing",
          lastTopic: "pricing",
          nextExpected: "service_for_pricing",
          orgType: "barbershop",
          collected: {
            ...(hasPendingBooking && !pendingIsStale
              ? { ...bookingCollected, last_info_topic: "pricing" }
              : {
                ...buildInfoContextCollected(bookingCollected, "pricing"),
                pending_booking: null,
                pending_booking_stale: true,
              }),
          },
        },
        debug: withInterpreterDebug(
          { intent: "pricing", phase: "DISCOVERY", route: "barbershop_pricing_followup_ask_service_again" },
          "shadow",
        ),
      };
    }

    if (isPricingQuestion(args.inboundText) || routedIntent === "pricing_question" || runtimeIntent === "pricing_question") {
      logBarbershopDiagnostic("intent_priority_resolved", {
        inbound_text: args.inboundText,
        resolved_intent: "pricing_question",
      });
      const normalizedPriceQ = normalizeTextForIntent(args.inboundText)
        .replace(/c\\y/g, "c y")
        .replace(/\bcy\b/g, "c y")
        .replace(/\bc\s*y\b/g, "y")
        .replace(/\s+/g, " ");
      const serviceFromExplicitPrice = resolveBarbershopServiceFromSettings(normalizedPriceQ, args.clinicSettings);
      if (!detectedService && !safeStr(bookingCollected.service, "").trim()) {
        if (serviceFromExplicitPrice) {
          return {
            replyText: formatBarbershopPricingAnswer(serviceFromExplicitPrice),
            statePatch: {
              stage: "DISCOVERY",
              lastIntent: "pricing",
              lastTopic: "pricing",
              nextExpected: undefined,
              orgType: "barbershop",
              collected: buildBarbershopPricingCollected(bookingCollected, serviceFromExplicitPrice, hasPendingBooking && !pendingIsStale),
            },
          debug: withInterpreterDebug(
            { intent: "pricing", phase: "DISCOVERY", route: "barbershop_pricing_explicit_followup" },
            runtimeIntent === "pricing_question" ? "runtime" : "shadow",
          ),
          };
        }
        const serviceMenu = formatBarbershopServiceMenuFromSettings(configuredServices, "");
        return {
          replyText: serviceMenu ? `Dale 💈 ¿Qué servicio querés consultar?\n\n${serviceMenu}` : "Dale 💈 ¿Qué servicio querés consultar?",
          statePatch: {
            stage: "DISCOVERY",
            lastIntent: "pricing",
            lastTopic: "pricing",
            nextExpected: "service_for_pricing",
            orgType: "barbershop",
            collected: {
              ...(hasPendingBooking && !pendingIsStale
                ? { ...bookingCollected, last_info_topic: "pricing" }
                : {
                  ...buildInfoContextCollected(bookingCollected, "pricing"),
                  pending_booking: null,
                  pending_booking_stale: true,
                }),
            },
          },
          debug: withInterpreterDebug(
            { intent: "pricing", phase: "DISCOVERY", route: "barbershop_pricing_ask_service" },
            runtimeIntent === "pricing_question" ? "runtime" : "shadow",
          ),
        };
      }
      const inferredDetectedService = detectedService
        ? {
          name: detectedService.name,
          durationMin: detectedService.durationMinutes,
          price: detectedService.basePriceHnl,
          preferredBarber: null,
        }
        : null;
      const inferredPriceService = (genericGrooming && !serviceFromExplicitPrice)
        ? null
        : (resolveBarbershopServiceFromSettings(args.inboundText, args.clinicSettings) ?? inferredDetectedService);
      const serviceForPrice = serviceFromExplicitPrice ?? inferredPriceService ??
        (safeStr(bookingCollected.service, "").trim() && safeStr(state.nextExpected, "").trim() === "date_time"
          ? resolveBarbershopServiceFromSettings(safeStr(bookingCollected.service, ""), args.clinicSettings)
          : null);
      if (serviceForPrice) {
        return {
          replyText: formatBarbershopPricingAnswer(serviceForPrice),
          statePatch: {
            stage: "DISCOVERY",
            lastIntent: "pricing",
            lastTopic: "pricing",
            nextExpected: undefined,
            orgType: "barbershop",
            collected: buildBarbershopPricingCollected(bookingCollected, serviceForPrice, hasPendingBooking && !pendingIsStale),
          },
          debug: withInterpreterDebug(
            { intent: "pricing", phase: "DISCOVERY", route: "barbershop_pricing_answer" },
            runtimeIntent === "pricing_question" ? "runtime" : "shadow",
          ),
        };
      }
      if (configuredServices.length > 0) {
        const compact = configuredServices
          .slice(0, 4)
          .map((service) => `${service.name} ${formatBarbershopPrice(service.price)} (${service.durationMin} min)`)
          .join(", ");
        return {
          replyText: `Perfecto 💈 Tenemos ${compact}. ¿Querés que te busque un espacio?`,
          statePatch: {
            stage: "DISCOVERY",
            lastIntent: "pricing",
            lastTopic: "pricing",
            nextExpected: undefined,
            orgType: "barbershop",
            collected: {
              ...(hasPendingBooking && !pendingIsStale
                ? { ...bookingCollected, last_info_topic: "pricing" }
                : {
                  ...buildInfoContextCollected(bookingCollected, "pricing"),
                  pending_booking: null,
                  pending_booking_stale: true,
                }),
            },
          },
          debug: withInterpreterDebug(
            { intent: "pricing", phase: "DISCOVERY", route: "barbershop_pricing_from_services_list" },
            runtimeIntent === "pricing_question" ? "runtime" : "shadow",
          ),
        };
      }
      const fallbackPrice = resolveBarbershopPrice("unknown");
      return {
        replyText: fallbackPrice.priceText,
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "pricing",
          lastTopic: "pricing",
          nextExpected: undefined,
          orgType: "barbershop",
          collected: {
            ...(hasPendingBooking && !pendingIsStale
              ? { ...bookingCollected, last_info_topic: "pricing" }
              : {
                ...buildInfoContextCollected(bookingCollected, "pricing"),
                pending_booking: null,
                pending_booking_stale: true,
              }),
          },
        },
        debug: withInterpreterDebug(
          { intent: "pricing", phase: "DISCOVERY", route: "barbershop_pricing_fallback" },
          runtimeIntent === "pricing_question" ? "runtime" : "shadow",
        ),
      };
    }

    if (effectiveDetectedService) {
      if (effectiveDetectedService) {
        bookingCollected.service = effectiveDetectedService.name;
      }
      const runtimeProviderName =
        runtimeProviderNameRaw && !isAnyProviderAlias(runtimeProviderNameRaw)
          ? runtimeProviderNameRaw
          : "";
      if (serviceDetection.preferredBarber) {
        bookingCollected.preferred_barber = serviceDetection.preferredBarber;
      } else if (runtimeSpecificProvider && runtimeProviderName) {
        bookingCollected.preferred_barber = runtimeProviderName;
      } else if (wantsSameBarber && rememberedBarber) {
        bookingCollected.preferred_barber = rememberedBarber;
      } else {
        bookingCollected.preferred_barber = null;
      }
      if (isAnyProviderAlias(safeStr(bookingCollected.preferred_barber, ""))) {
        bookingCollected.preferred_barber = null;
      }
    }

    if (
      hasPendingBooking &&
      !pendingIsStale &&
      effectiveDetectedService &&
      !parsedDateTime &&
      !runtimeDateTime &&
      activePendingDate &&
      activePendingTime
    ) {
      const targetService = safeStr(effectiveDetectedService.name, "").trim() || activePendingService;
      return {
        replyText:
          `¿Querés cambiar la cita pendiente a ${targetService} para ${formatHumanDay(activePendingDate)} a las ${formatHourLabel(activePendingTime)}? Te reviso disponibilidad.`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "confirm_booking",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            service: targetService,
            preferred_date: activePendingDate,
            preferred_time: activePendingTime,
            pending_booking_stale: true,
            last_bot_step: "barbershop_pending_service_change_recheck",
          },
        },
        debug: withInterpreterDebug({ intent: "book_appointment", phase: "BOOKING", route: "barbershop_pending_service_change_recheck" }),
      };
    }

    if (state.nextExpected === "barber_preference" && isAnyBarberPreferenceText(args.inboundText)) {
      const requestedDate = safeStr(bookingCollected.preferred_date, "");
      const requestedTime = safeStr(bookingCollected.preferred_time, "");
      const requestedService = safeStr((bookingCollected as any).service, "Cita barbería");
      if (requestedDate && requestedTime) {
        if (isBarbershopSlotInPast(requestedDate, requestedTime, timezone)) {
          return {
            replyText: "Esa hora ya pasó. Te puedo revisar otro horario para hoy o mañana.",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "date_time",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_any_slot_in_past_guard" },
          };
        }
        if (!isWithinClinicHours(requestedDate, requestedTime, args.clinicSettings)) {
          return {
            replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "availability_slot_selection",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                service: requestedService,
                preferred_date: requestedDate,
                preferred_time: requestedTime,
                availability_request: true,
                provider_preference: "any",
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_any_outside_hours_guard" },
          };
        }
        const bookingFirstName = hasCollectedName(state)
          ? safeStr(state.name, "").trim().split(/\s+/)[0]
          : "";
        const isThirdPartyMissingName = Boolean(
          Boolean((bookingCollected as any).booking_for_other) &&
            !safeStr((bookingCollected as any).patient_name, "").trim(),
        );
        if (isThirdPartyMissingName) {
          return {
            replyText: `Perfecto. ${formatHumanDay(requestedDate)} a las ${formatHourLabel(requestedTime)} está disponible para ${requestedService}. ¿A nombre de quién la agendamos?`,
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "third_party_patient_name",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                service: requestedService,
                preferred_date: requestedDate,
                preferred_time: requestedTime,
                preferred_barber: null,
                provider_preference: "any",
                provider_name: null,
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_any_barber_missing_patient_name" },
          };
        }
        return {
          replyText: bookingFirstName
            ? `Perfecto ${bookingFirstName}. ${formatHumanDay(requestedDate)} a las ${formatHourLabel(requestedTime)} está disponible. ¿Confirmamos a tu nombre?`
            : `Perfecto. ${formatHumanDay(requestedDate)} a las ${formatHourLabel(requestedTime)} está disponible. ¿Confirmamos?`,
          statePatch: {
            stage: "CONFIRMING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: requestedService,
              preferred_barber: null,
              provider_preference: "any",
              provider_name: null,
              pending_booking_stale: false,
              last_bot_step: "barbershop_preconfirm",
              pending_booking: {
                service: requestedService,
                appointment_date: requestedDate,
                appointment_time: requestedTime,
                preferred_barber: null,
                provider_preference: "any",
                provider_name: null,
                status: "pending_confirmation",
              },
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_any_barber_preconfirm" },
        };
      }
    }

    if (state.nextExpected === "barber_preference") {
      const contextResolved = mergeBookingContext({
        currentEntities: {
          serviceName: safeStr(effectiveDetectedService?.name, ""),
          providerName: safeStr(
            serviceDetection.preferredBarber,
            runtimeSpecificProvider ? runtimeProviderNameRaw : "",
          ),
          providerPreference: runtimeFieldProviderPref === "any" ? "any" : (runtimeSpecificProvider ? "specific" : null),
          hasAnyProviderPreference: hasAnyBarberPreference || isAnyBarberPreferenceText(args.inboundText),
        },
        leadState: state,
        bookingCollected,
        lastBotQuestion: safeStr((bookingCollected as any).last_bot_text, ""),
      });
      console.log(JSON.stringify({
        event: "barbershop:context_resolver_input",
        inbound_text: args.inboundText,
        nextExpected_before: safeStr(state.nextExpected, ""),
        current_service: safeStr(effectiveDetectedService?.name, ""),
        current_provider: safeStr(serviceDetection.preferredBarber, ""),
        previous_preferred_date: safeStr(bookingCollected.preferred_date, ""),
        previous_preferred_time: safeStr(bookingCollected.preferred_time, ""),
        proposed_slot: (bookingCollected as any).proposed_slot ?? null,
      }));
      console.log(JSON.stringify({
        event: "barbershop:context_resolver_output",
        reused_previous_date_time: contextResolved.reusedPreviousDateTime,
        service: contextResolved.serviceName || null,
        provider_name: contextResolved.providerName || null,
        provider_preference: contextResolved.providerPreference,
        proposed_date: contextResolved.proposedDate || null,
        proposed_time: contextResolved.proposedTime || null,
      }));

      if (contextResolved.reusedPreviousDateTime && contextResolved.serviceName && (contextResolved.providerName || contextResolved.providerPreference === "any")) {
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: contextResolved.serviceName,
              preferred_date: contextResolved.proposedDate,
              preferred_time: contextResolved.proposedTime,
              preferred_barber: contextResolved.providerPreference === "any" ? null : (contextResolved.providerName || null),
              provider_preference: contextResolved.providerPreference === "any" ? "any" : "specific",
              provider_name: contextResolved.providerPreference === "any" ? null : (contextResolved.providerName || null),
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_provider_preference_reuse_proposed_slot" },
            runtimeDateTime && !parsedDateTime ? "runtime" : "shadow",
          ),
        };
      }
    }

    if (
      (parsedDateTime || runtimeDateTime) &&
      safeStr(bookingCollected.service, "").trim()
    ) {
      const preconfirmDateTime = parsedDateTime ?? runtimeDateTime!;
      const requestedGuard = validateRequestedDateTimeBookability({
        requestedDate: preconfirmDateTime.date,
        requestedTime: preconfirmDateTime.time,
        timezone,
        clinicSettings: args.clinicSettings,
      });
      console.log(JSON.stringify({
        event: "barbershop:requested_datetime_guard_entered",
        requested_date: preconfirmDateTime.date,
        requested_day_of_week: weekdayFromIsoDate(preconfirmDateTime.date),
        requested_day_open: requestedGuard.reason !== "requested_day_closed",
        requested_time: preconfirmDateTime.time,
        requested_time_within_hours: requestedGuard.reason !== "requested_time_outside_hours",
        blocked_reason: requestedGuard.reason,
      }));
      if (!requestedGuard.canBookRequestedDateTime && requestedGuard.reason === "requested_time_in_past") {
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              preferred_date: preconfirmDateTime.date,
              preferred_time: preconfirmDateTime.time,
              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_slot_in_past_check_availability" },
        };
      }
      if (!requestedGuard.canBookRequestedDateTime) {
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              availability_request: true,
              preferred_date: preconfirmDateTime.date,
              pending_booking_request: {
                service: safeStr(bookingCollected.service, "Corte clásico"),
                preferred_date: preconfirmDateTime.date,
                preferred_time: null,
                provider_name: safeStr(bookingCollected.provider_name, "") || null,
                provider_preference: safeStr(bookingCollected.provider_preference, "") === "any" ? "any" : null,
                patient_name: safeStr((bookingCollected as any).patient_name, "") || null,
                booking_for_other: Boolean((bookingCollected as any).booking_for_other),
                missing_fields: ["time"],
                source: "context_merge",
              },
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_outside_hours_discovery_redirect" },
        };
      }
      if (
        !serviceDetection.preferredBarber &&
        !(runtimeSpecificProvider && runtimeProviderNameRaw) &&
        !wantsSameBarber &&
        !hasAnyBarberPreference
      ) {
        bookingCollected.preferred_barber = null;
      }
      const cleanPreferredBarber = isAnyProviderAlias(safeStr(bookingCollected.preferred_barber, ""))
        ? ""
        : safeStr(bookingCollected.preferred_barber, "").trim();
      if (!cleanPreferredBarber) {
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              preferred_date: preconfirmDateTime.date,
              preferred_time: preconfirmDateTime.time,
              provider_preference: "any",
              preferred_barber: null,
              provider_name: null,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_require_provider_assignment_before_preconfirm" },
            runtimeDateTime && !parsedDateTime ? "runtime" : "shadow",
          ),
        };
      }
      const withBarber = cleanPreferredBarber
        ? ` con ${cleanPreferredBarber}`
        : "";
      const bookingFirstName = hasCollectedName(state)
        ? safeStr(state.name, "").trim().split(/\s+/)[0]
        : "";
      const thirdPartyPatientName = safeStr((bookingCollected as any).patient_name, "").trim();
      const isThirdPartyWithName = Boolean(Boolean((bookingCollected as any).booking_for_other) && thirdPartyPatientName);
      const isThirdPartyMissingName = Boolean(
        Boolean((bookingCollected as any).booking_for_other) &&
          !safeStr((bookingCollected as any).patient_name, "").trim(),
      );
      if (isThirdPartyMissingName) {
        return {
          replyText: `Perfecto. ${formatHumanDay(preconfirmDateTime.date)} a las ${formatHourLabel(preconfirmDateTime.time)} está disponible para ${safeStr(bookingCollected.service, "Corte clásico")}${withBarber}. ¿A nombre de quién la agendamos?`,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "third_party_patient_name",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              preferred_date: preconfirmDateTime.date,
              preferred_time: preconfirmDateTime.time,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_missing_patient_name_before_preconfirm" },
            runtimeDateTime && !parsedDateTime ? "runtime" : "shadow",
          ),
        };
      }
      return {
        replyText: isThirdPartyWithName
          ? `Perfecto. ${formatHumanDay(preconfirmDateTime.date)} a las ${formatHourLabel(preconfirmDateTime.time)} está disponible para ${safeStr(bookingCollected.service, "Corte clásico")}${withBarber} a nombre de ${thirdPartyPatientName}. ¿Confirmamos?`
          : bookingFirstName
          ? `Perfecto ${bookingFirstName}. ${formatHumanDay(preconfirmDateTime.date)} a las ${formatHourLabel(preconfirmDateTime.time)} está disponible para ${safeStr(bookingCollected.service, "Corte clásico")}${withBarber}. ¿Confirmamos a tu nombre?`
          : `Perfecto. ${formatHumanDay(preconfirmDateTime.date)} a las ${formatHourLabel(preconfirmDateTime.time)} está disponible para ${safeStr(bookingCollected.service, "Corte clásico")}${withBarber}. ¿Confirmamos?`,
        statePatch: {
          stage: "CONFIRMING",
          lastIntent: "book_appointment",
          nextExpected: "confirm_booking",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            preferred_date: preconfirmDateTime.date,
            preferred_time: preconfirmDateTime.time,
            pending_booking_stale: false,
            last_bot_step: "barbershop_preconfirm",
            pending_booking: {
              service: safeStr(bookingCollected.service, "Corte clásico"),
              appointment_date: preconfirmDateTime.date,
              appointment_time: preconfirmDateTime.time,
              preferred_barber: safeStr(bookingCollected.preferred_barber, "") || null,
              patient_name: thirdPartyPatientName || null,
              status: "pending_confirmation",
            },
          },
        },
        debug: withInterpreterDebug(
          { intent: "book_appointment", phase: "BOOKING", route: "barbershop_preconfirm" },
          runtimeDateTime && !parsedDateTime ? "runtime" : "shadow",
        ),
      };
    }

    if ((parsedDateTime || runtimeDateTime) && !safeStr(bookingCollected.service, "").trim()) {
      const genericDateTime = parsedDateTime ?? runtimeDateTime!;
      const requestedGuard = validateRequestedDateTimeBookability({
        requestedDate: genericDateTime.date,
        requestedTime: genericDateTime.time,
        timezone,
        clinicSettings: args.clinicSettings,
      });
      console.log(JSON.stringify({
        event: "barbershop:requested_datetime_guard_entered",
        requested_date: genericDateTime.date,
        requested_day_of_week: weekdayFromIsoDate(genericDateTime.date),
        requested_day_open: requestedGuard.reason !== "requested_day_closed",
        requested_time: genericDateTime.time,
        requested_time_within_hours: requestedGuard.reason !== "requested_time_outside_hours",
        blocked_reason: requestedGuard.reason,
      }));
      if (!requestedGuard.canBookRequestedDateTime && requestedGuard.reason === "requested_time_in_past") {
        return {
          replyText: "Esa hora ya pasó. Te puedo revisar otro horario para hoy o mañana.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_generic_slot_in_past_guard" },
        };
      }
      if (!requestedGuard.canBookRequestedDateTime) {
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              availability_request: true,
              preferred_date: genericDateTime.date,
              pending_booking_request: {
                service: safeStr((bookingCollected as any).service, ""),
                preferred_date: genericDateTime.date,
                preferred_time: null,
                provider_name: null,
                provider_preference: null,
                patient_name: safeStr((bookingCollected as any).patient_name, "") || null,
                booking_for_other: Boolean((bookingCollected as any).booking_for_other),
                missing_fields: safeStr((bookingCollected as any).service, "").trim() ? ["time"] : ["service", "time"],
                source: "context_merge",
              },
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_generic_outside_hours_discovery_redirect" },
        };
      }
      if (safeStr(bookingCollected.preferred_barber, "").trim() || hasBarberMention) {
        const resolvedBarber = safeStr(
          bookingCollected.preferred_barber,
          serviceDetection.preferredBarber ?? "",
        ).trim();
        const cleanResolvedBarber = normalizeTextForIntent(resolvedBarber) === "cualquiera" ? "" : resolvedBarber;
        const withBarber = cleanResolvedBarber ? ` con ${cleanResolvedBarber}` : "";
        const bookingFirstName = hasCollectedName(state)
          ? safeStr(state.name, "").trim().split(/\s+/)[0]
          : "";
        const thirdPartyPatientName = safeStr((bookingCollected as any).patient_name, "").trim();
        const isThirdPartyWithName = Boolean(Boolean((bookingCollected as any).booking_for_other) && thirdPartyPatientName);
        const isThirdPartyMissingName = Boolean(
          Boolean((bookingCollected as any).booking_for_other) &&
            !safeStr((bookingCollected as any).patient_name, "").trim(),
        );
        if (isThirdPartyMissingName) {
          return {
            replyText: `Perfecto. ${formatHumanDay(genericDateTime.date)} a las ${formatHourLabel(genericDateTime.time)} está disponible${withBarber}. ¿A nombre de quién la agendamos?`,
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "third_party_patient_name",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                service: "Cita barbería",
                preferred_date: genericDateTime.date,
                preferred_time: genericDateTime.time,
                preferred_barber: cleanResolvedBarber || null,
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: withInterpreterDebug(
              { intent: "book_appointment", phase: "BOOKING", route: "barbershop_generic_with_barber_missing_patient_name" },
              runtimeDateTime && !parsedDateTime ? "runtime" : "shadow",
            ),
          };
        }
        return {
          replyText: isThirdPartyWithName
            ? `Perfecto. ${formatHumanDay(genericDateTime.date)} a las ${formatHourLabel(genericDateTime.time)} está disponible${withBarber} a nombre de ${thirdPartyPatientName}. ¿Confirmamos?`
            : bookingFirstName
            ? `Perfecto ${bookingFirstName}. ${formatHumanDay(genericDateTime.date)} a las ${formatHourLabel(genericDateTime.time)} está disponible${withBarber}. ¿Confirmamos a tu nombre?`
            : `Perfecto. ${formatHumanDay(genericDateTime.date)} a las ${formatHourLabel(genericDateTime.time)} está disponible${withBarber}. ¿Confirmamos?`,
          statePatch: {
            stage: "CONFIRMING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: "Cita barbería",
              preferred_date: genericDateTime.date,
              preferred_time: genericDateTime.time,
              preferred_barber: cleanResolvedBarber || null,
              pending_booking_stale: false,
              last_bot_step: "barbershop_preconfirm",
              pending_booking: {
                service: "Cita barbería",
                appointment_date: genericDateTime.date,
                appointment_time: genericDateTime.time,
                preferred_barber: cleanResolvedBarber || null,
                patient_name: thirdPartyPatientName || null,
                status: "pending_confirmation",
              },
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_generic_booking_with_barber" },
            runtimeDateTime && !parsedDateTime ? "runtime" : "shadow",
          ),
        };
      }
      if (hasAnyBarberPreference) {
        const bookingFirstName = hasCollectedName(state)
          ? safeStr(state.name, "").trim().split(/\s+/)[0]
          : "";
        const thirdPartyPatientName = safeStr((bookingCollected as any).patient_name, "").trim();
        const isThirdPartyWithName = Boolean(Boolean((bookingCollected as any).booking_for_other) && thirdPartyPatientName);
        const isThirdPartyMissingName = Boolean(
          Boolean((bookingCollected as any).booking_for_other) &&
            !safeStr((bookingCollected as any).patient_name, "").trim(),
        );
        if (isThirdPartyMissingName) {
          return {
            replyText: `Perfecto. ${formatHumanDay(genericDateTime.date)} a las ${formatHourLabel(genericDateTime.time)} está disponible. ¿A nombre de quién la agendamos?`,
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "third_party_patient_name",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                service: "Cita barbería",
                preferred_date: genericDateTime.date,
                preferred_time: genericDateTime.time,
                preferred_barber: null,
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: withInterpreterDebug(
              { intent: "book_appointment", phase: "BOOKING", route: "barbershop_generic_any_missing_patient_name" },
              runtimeDateTime && !parsedDateTime ? "runtime" : "shadow",
            ),
          };
        }
        return {
          replyText: isThirdPartyWithName
            ? `Perfecto. ${formatHumanDay(genericDateTime.date)} a las ${formatHourLabel(genericDateTime.time)} está disponible a nombre de ${thirdPartyPatientName}. ¿Confirmamos?`
            : bookingFirstName
            ? `Perfecto ${bookingFirstName}. ${formatHumanDay(genericDateTime.date)} a las ${formatHourLabel(genericDateTime.time)} está disponible. ¿Confirmamos a tu nombre?`
            : `Perfecto. ${formatHumanDay(genericDateTime.date)} a las ${formatHourLabel(genericDateTime.time)} está disponible. ¿Confirmamos?`,
          statePatch: {
            stage: "CONFIRMING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: "Cita barbería",
              preferred_date: genericDateTime.date,
              preferred_time: genericDateTime.time,
              preferred_barber: null,
              pending_booking_stale: false,
              last_bot_step: "barbershop_preconfirm",
              pending_booking: {
                service: "Cita barbería",
                appointment_date: genericDateTime.date,
                appointment_time: genericDateTime.time,
                preferred_barber: null,
                patient_name: thirdPartyPatientName || null,
                status: "pending_confirmation",
              },
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_generic_booking_any_barber" },
            runtimeDateTime && !parsedDateTime ? "runtime" : "shadow",
          ),
        };
      }
      return {
        replyText:
          `Dale. Tengo ${formatHumanDay(genericDateTime.date)} a las ${formatHourLabel(genericDateTime.time)}. ¿Querés con algún barbero en especial o con cualquiera?`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "barber_preference",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            service: "Cita barbería",
            preferred_date: genericDateTime.date,
            preferred_time: genericDateTime.time,
            proposed_slot: {
              date: genericDateTime.date,
              time: genericDateTime.time,
              service: safeStr(bookingCollected.service, "Cita barbería"),
              provider_preference: null,
            },
          },
        },
        debug: withInterpreterDebug(
          { intent: "book_appointment", phase: "BOOKING", route: "barbershop_ask_barber_preference" },
          runtimeDateTime && !parsedDateTime ? "runtime" : "shadow",
        ),
      };
    }

    if (
      (effectiveDetectedService ||
        intent.intent === "book_appointment" ||
        routedIntent === "booking_request" ||
        runtimeIntent === "booking_request") &&
      !(
        shouldUseRuntimeInterpreter &&
        (runtimeCandidateIntent === "availability_question" ||
          runtimeNextStep === "show_availability" ||
          runtimeToolNeeded === "check_availability")
      )
    ) {
      const availabilityDateFallback = parseDateOnlyFromMessage(args.inboundText, timezone);
      const normalizedInboundForFallback = normalizeTextForIntent(args.inboundText);
      const availabilityDateFromNormalized = parseDateOnlyFromMessage(normalizedInboundForFallback, timezone);
      const availabilityDateCandidate = availabilityDateFallback ?? availabilityDateFromNormalized;
      const fallbackServiceDetected = effectiveDetectedService ?? detectBarbershopService(normalizedInboundForFallback).matchedService;
      const availabilityLikeFallback = isBarbershopAvailabilityLikeText(args.inboundText) ||
        isAvailabilityInquiryText(args.inboundText) ||
        routedIntent === "availability_question";
      if (
        availabilityLikeFallback &&
        fallbackServiceDetected &&
        availabilityDateCandidate &&
        !parsedDateTime &&
        !runtimeDateTime
      ) {
        const providerAnyFallback = isAnyBarberPreferenceText(args.inboundText) ||
          runtimeProviderPrefRaw === "any" ||
          runtimeFieldProviderPref === "any";
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "availability",
            nextExpected: "availability_service",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: fallbackServiceDetected.name,
              preferred_date: availabilityDateCandidate,
              availability_request: true,
              ...(providerAnyFallback
                ? { provider_preference: "any", provider_name: null, preferred_barber: null }
                : {}),
              pending_booking: null,
            },
          },
          debug: withInterpreterDebug(
            { intent: "availability", phase: "BOOKING", route: "barbershop_availability_fallback_from_service_date" },
            runtimeEnabled ? "runtime" : "shadow",
          ),
        };
      }
      const hasService = safeStr(bookingCollected.service, "").trim().length > 0;
      if (!hasService) {
        const pendingWithContext = {
          ...mergedPendingBookingRequest,
          source: "context_merge" as const,
        };
        return {
          replyText: "Claro. ¿Querés Corte de pelo, barba, corte + barba o cejas?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "service",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking_request: pendingWithContext,
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_ask_service" },
            runtimeIntent === "booking_request" ? "runtime" : "shadow",
          ),
        };
      }
      const runtimeFieldsFound = (runtimeRaw.fields_found && typeof runtimeRaw.fields_found === "object")
        ? (runtimeRaw.fields_found as Record<string, unknown>)
        : {};
      const runtimeRepairedDateRaw = safeStr(runtimeFieldsFound.date, "").trim();
      const runtimeRepairedDateToken = runtimeRepairedDateRaw.toLowerCase() === "tomorrow"
        ? "manana"
        : runtimeRepairedDateRaw;
      const runtimeRepairedDate = runtimeRepairedDateToken
        ? parseDateOnlyFromMessage(runtimeRepairedDateToken, timezone)
        : null;
      if (
        safeStr(state.nextExpected, "") === "date_time" &&
        runtimeEnabled &&
        Number.isFinite(runtimeConfidence) &&
        runtimeConfidence >= 0.65 &&
        runtimeRepairedDate &&
        !safeStr(bookingCollected.preferred_time, "").trim()
      ) {
        console.log(JSON.stringify({
          event: "barbershop:llm_contextual_repair_used",
          inbound_text: args.inboundText ?? null,
          nextExpected: "date_time",
          repaired_fields: { date: runtimeRepairedDate },
          confidence: runtimeConfidence,
        }));
        console.log(JSON.stringify({
          event: "barbershop:redundant_question_blocked",
          reason: "runtime_repaired_date_prevents_ask_datetime",
          inbound_text: args.inboundText ?? null,
          last_availability_context: (bookingCollected as any).last_availability_context ?? null,
        }));
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "availability",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              preferred_date: runtimeRepairedDate,
              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_repaired_date_show_availability" },
            "runtime",
          ),
        };
      }
      const bookingService = safeStr(bookingCollected.service, "").trim();
      const parsedDateOnly = parseDateOnlyFromMessage(args.inboundText, timezone);
      if (bookingService && parsedDateOnly && !(parsedDateTime || runtimeDateTime)) {
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "availability",
            nextExpected: "availability_slot_selection",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              preferred_date: parsedDateOnly,
              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_service_date_show_availability" },
            runtimeIntent === "booking_request" ? "runtime" : "shadow",
          ),
        };
      }
      if (bookingService && (parsedDateTime || runtimeDateTime)) {
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              preferred_date: (parsedDateTime ?? runtimeDateTime)!.date,
              preferred_time: (parsedDateTime ?? runtimeDateTime)!.time,
              availability_request: true,
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_service_datetime_check_availability" },
            runtimeIntent === "booking_request" ? "runtime" : "shadow",
          ),
        };
      }
      const contextDate = safeStr((bookingCollected as any).preferred_date, "").trim();
      const contextTime = safeStr((bookingCollected as any).preferred_time, "").trim();
      const proposed = ((bookingCollected as any).proposed_slot ?? {}) as Record<string, unknown>;
      const proposedDate = safeStr(proposed.date, contextDate).trim();
      const proposedTime = safeStr(proposed.time, contextTime).trim();
      const providerFromTurn = safeStr(serviceDetection.preferredBarber, "").trim() ||
        (runtimeSpecificProvider ? runtimeProviderNameRaw : "");
      const providerAnyFromTurn = hasAnyBarberPreference || isAnyBarberPreferenceText(args.inboundText);
      if (
        bookingService &&
        proposedDate &&
        proposedTime &&
        !(parsedDateTime || runtimeDateTime) &&
        (providerAnyFromTurn || providerFromTurn || safeStr(state.nextExpected, "") === "barber_preference")
      ) {
        console.log(JSON.stringify({
          event: "barbershop:context_resolver_output",
          reused_previous_date_time: true,
          nextExpected_before: safeStr(state.nextExpected, ""),
          route_selected: "barbershop_reuse_proposed_datetime_check_availability",
          proposed_date: proposedDate,
          proposed_time: proposedTime,
          provider_name: providerFromTurn || null,
          provider_preference: providerAnyFromTurn ? "any" : (providerFromTurn ? "specific" : null),
        }));
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              service: bookingService,
              preferred_date: proposedDate,
              preferred_time: proposedTime,
              preferred_barber: providerAnyFromTurn ? null : (providerFromTurn || null),
              provider_preference: providerAnyFromTurn ? "any" : (providerFromTurn ? "specific" : null),
              provider_name: providerAnyFromTurn ? null : (providerFromTurn || null),
              pending_booking: null,
              pending_booking_stale: true,
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_reuse_proposed_datetime_check_availability" },
            runtimeIntent === "booking_request" ? "runtime" : "shadow",
          ),
        };
      }
      const bookingServiceLabel = bookingService === "Corte clásico"
        ? "corte de pelo"
        : bookingService.toLowerCase();
      if (mergedPendingBookingRequest.service && mergedPendingBookingRequest.preferred_time && !mergedPendingBookingRequest.preferred_date) {
        console.log(JSON.stringify({
          event: "barbershop:route_selected",
          route_selected: "barbershop_pending_booking_request_ask_date_only",
        }));
        return {
          replyText: "Claro 🔥 ¿Para qué día querés que te revise horarios?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "booking_date",
            orgType: "barbershop",
            collected: {
              ...bookingCollected,
              pending_booking_request: { ...mergedPendingBookingRequest, source: "context_merge" },
            },
          },
          debug: withInterpreterDebug(
            { intent: "book_appointment", phase: "BOOKING", route: "barbershop_pending_booking_request_ask_date_only" },
            runtimeIntent === "booking_request" ? "runtime" : "shadow",
          ),
        };
      }
      console.log(JSON.stringify({
        event: "barbershop:old_date_time_branch_hit",
        inbound_text: args.inboundText ?? null,
        organization_id: args.organizationId ?? null,
        runtime_enabled: runtimeEnabled,
        stage: safeStr(state.stage, "") || null,
        nextExpected_before: safeStr(state.nextExpected, "") || null,
        service_detected: bookingService || null,
        provider_preference: safeStr((bookingCollected as any).provider_preference, "") || null,
        preferred_barber: safeStr((bookingCollected as any).preferred_barber, "") || null,
        route_name: "barbershop_ask_datetime",
      }));
      return {
        replyText: `🔥 Perfecto, ${bookingServiceLabel}. ¿Qué día y hora te queda mejor?`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            pending_booking_request: { ...mergedPendingBookingRequest, source: "context_merge" },
          },
        },
        debug: withInterpreterDebug(
          { intent: "book_appointment", phase: "BOOKING", route: "barbershop_ask_datetime" },
          runtimeIntent === "booking_request" ? "runtime" : "shadow",
        ),
      };
    }

    const finalRepairRaw = ((args.barbershopInterpreterResult ?? {}) as Record<string, unknown>);
    const finalRepairFields = (finalRepairRaw.fields_found && typeof finalRepairRaw.fields_found === "object")
      ? (finalRepairRaw.fields_found as Record<string, unknown>)
      : {};
    const finalRepairDateRaw = safeStr(finalRepairFields.date, "").trim();
    const finalRepairDateToken = finalRepairDateRaw.toLowerCase() === "tomorrow" ? "manana" : finalRepairDateRaw;
    const finalRepairDate = finalRepairDateToken ? parseDateOnlyFromMessage(finalRepairDateToken, timezone) : null;
    const finalRepairConfidence = Number(finalRepairRaw.confidence ?? 0);
    if (
      safeStr(state.nextExpected, "") === "date_time" &&
      isEnabledFlag(args.clinicSettings?.barbershop_interpreter_runtime_enabled) &&
      Number.isFinite(finalRepairConfidence) &&
      finalRepairConfidence >= 0.65 &&
      finalRepairDate &&
      safeStr(bookingCollected.service, "").trim()
    ) {
      console.log(JSON.stringify({
        event: "barbershop:llm_contextual_repair_used",
        inbound_text: args.inboundText ?? null,
        nextExpected: "date_time",
        repaired_fields: { date: finalRepairDate },
        confidence: finalRepairConfidence,
      }));
      console.log(JSON.stringify({
        event: "barbershop:redundant_question_blocked",
        reason: "final_fallback_repaired_date",
        inbound_text: args.inboundText ?? null,
        last_availability_context: (bookingCollected as any).last_availability_context ?? null,
      }));
      return {
        replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "availability",
          nextExpected: "availability_slot_selection",
          orgType: "barbershop",
          collected: {
            ...bookingCollected,
            preferred_date: finalRepairDate,
            availability_request: true,
            pending_booking: null,
            pending_booking_stale: true,
          },
        },
        debug: withInterpreterDebug(
          { intent: "book_appointment", phase: "BOOKING", route: "barbershop_repaired_date_show_availability" },
          "runtime",
        ),
      };
    }

    const hasActiveBookingContext = Boolean(
      runtimeContext.has_active_context ||
      safeStr(state.nextExpected, "").trim() ||
      safeStr(state.stage, "") === "BOOKING" ||
      bookingContext.pending_booking ||
      bookingContext.last_booking_step ||
      pendingAction.type !== "none" ||
      (bookingCollected as any).last_availability_context ||
      (bookingCollected as any).proposed_slot,
    );
    if (hasActiveBookingContext && (bookingCollected as any).pending_booking_request) {
      console.log(JSON.stringify({
        event: "barbershop:fallback_blocked_reason",
        fallback_blocked_reason: "pending_booking_request_context_available",
        route_selected: "barbershop_natural_fallback_with_context",
      }));
    }
    if (hasActiveBookingContext && !(bookingCollected as any).pending_booking_request) {
      console.log(JSON.stringify({
        event: "barbershop:fallback_blocked_reason",
        fallback_blocked_reason: "active_booking_context_without_pending_request",
        route_selected: "barbershop_natural_fallback_with_context",
      }));
    }
    const replyText = hasActiveBookingContext
      ? composeBarbershopNaturalFallback({ nextExpected: state.nextExpected, activeFlow: "booking" })
      : "No te entendí completo. Podés escribirme algo como: quiero cita mañana a las 5, cuánto cuesta corte y barba, o qué pomadas tienen. También puedo pasarte el calendario completo si querés elegir con calma.";
    return {
      replyText,
      statePatch: {
        stage: hasActiveBookingContext ? safeStr(state.stage, "BOOKING") : "DISCOVERY",
        lastIntent: safeStr(state.lastIntent, "unknown"),
        nextExpected: hasActiveBookingContext ? state.nextExpected : undefined,
        orgType: "barbershop",
        collected: {
          ...bookingCollected,
          ...(bookingContext.pending_booking ? { pending_booking: bookingContext.pending_booking } : {}),
        },
      },
      debug: {
        ...withInterpreterDebug({
          intent: hasActiveBookingContext ? "unknown_inside_active_flow" : "unknown_outside_active_flow",
          phase: safeStr(state.stage, "DISCOVERY"),
          route: hasActiveBookingContext ? "barbershop_natural_fallback_contextual" : "barbershop_unknown_clarify",
        }),
      },
    };
  }

  if (
    orgType === "dental" &&
    /frenillos?.*ya te dije|ya te dije.*frenillos?|brackets?.*ya te dije|ya te dije.*brackets?/i.test(text)
  ) {
    const rememberedService = toPatientFacingServiceLabel(
      safeStr(collected.last_discussed_service, safeStr(collected.service, "Ortodoncia / brackets")),
    );
    return {
      replyText:
        "Tenés razón, me dijiste frenillos. Disculpá 😊\n\nTe ayudo con ortodoncia/brackets.",
      statePatch: {
        stage: "SERVICE_INFO",
        lastIntent: "service_info",
        nextExpected: "service_info_or_booking",
        collected: {
          ...collected,
          service: rememberedService,
          last_discussed_service: rememberedService,
        },
      },
      debug: { intent: "services", phase: "SERVICE_INFO", route: "service_frustration_recover" },
    };
  }

  if (
    orgType === "dental" &&
    /pero yo te ped[ií]\s+ma(ñ|n)ana/i.test(text)
  ) {
    const reqDate = safeStr((collected as any).unavailable_requested_date, "");
    const nearestDate = safeStr((collected as any).nearest_available_date, "");
    const nearestTime = safeStr((collected as any).nearest_available_time, "");
    const nearestDay = safeStr((collected as any).nearest_available_day_label, "");
    if (reqDate && nearestDate && nearestTime) {
      return {
        replyText:
          `Tenés razón. Pediste mañana. Revisé y para mañana no tengo espacios disponibles. El más cercano es ${nearestDay || nearestDate} a las ${formatHourLabel(nearestTime)}. ¿Querés tomar ese o buscamos otro día?`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          collected: { ...collected },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "requested_tomorrow_acknowledged" },
      };
    }
  }

  if (
    orgType === "dental" &&
    isDurationProcessQuestion(args.inboundText)
  ) {
    const rememberedService = toPatientFacingServiceLabel(
      safeStr(collected.last_discussed_service, safeStr(collected.service, "")),
    );
    const durationService = rememberedService || (detectService(args.inboundText) ?? "");
    if (
      /frenillos?|brackets?|ortodoncia/i.test(durationService) ||
      /frenillos?|brackets?|ortodoncia/i.test(args.inboundText)
    ) {
      const chosenService = "Ortodoncia / brackets";
      return {
        replyText:
          "El tiempo con frenillos varía según cada caso. En muchos pacientes puede durar entre 1 y 3 años, dependiendo de la posición de los dientes y el plan indicado por el doctor.\n\nPara saberlo con más precisión, lo ideal es una revisión.\n\nSi querés, te ayudo a agendar esa revisión.",
        statePatch: {
          stage: "SERVICE_INFO",
          lastIntent: "service_info",
          nextExpected: "service_info_or_booking",
          collected: {
            ...collected,
            service: chosenService,
            last_discussed_service: chosenService,
          },
        },
        debug: { intent: "services", phase: "SERVICE_INFO", route: "service_duration_priority" },
      };
    }
  }

  const hasActiveAppointmentInState = Boolean(
    safeStr(((collected as any)?.active_appointment ?? {})?.id, "").trim(),
  );

  if (
    orgType === "dental" &&
    triage?.matched &&
    triage.should_book &&
    !hasActiveAppointmentInState &&
    [
      "dental_pain",
      "swelling",
      "bleeding",
      "broken_tooth",
      "cavity_or_decay",
      "general_checkup",
    ].includes(triage.category)
  ) {
    const triageService = safeStr(triage.service_suggestion, "");
    if (triageService && !isServiceActiveForOrg(args.clinicSettings, triageService)) {
      return {
        replyText:
          "Ese servicio tendría que confirmarlo recepción directamente, porque no quiero darte información incorrecta.",
        statePatch: {
          stage: "SERVICE_INFO",
          lastIntent: "service_info",
          nextExpected: "service",
          collected: { ...collected },
        },
        debug: { intent: "service_info", phase: "SERVICE_INFO", route: "triage_service_inactive_guard" },
      };
    }
    const urgencyHint = triage.urgency === "urgent"
      ? " ¿Te queda bien hoy o mañana temprano?"
      : " ¿Te queda mejor hoy, mañana o algún día específico?";
    const urgentPrefix = triage.urgency === "urgent" &&
        !safeStr(triage.safe_reply_hint, "").toLowerCase().includes("cita prioritaria")
      ? " Puedo ayudarte a agendar una cita prioritaria."
      : "";
    const triageTimezone = safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa");
    const triageDate = safeStr((triage as Record<string, unknown> | null)?.date, "");
    const triageTime = safeStr((triage as Record<string, unknown> | null)?.time, "");
    const parsedTriageDateTime = triageDate && triageTime
      ? { date: triageDate, time: triageTime }
      : parseDateTimeFromMessage(args.inboundText, triageTimezone);
    const cleaned = clearActiveBookingState({
      stage: "BOOKING",
      lastIntent: "emergency",
      nextExpected: "date_time",
      collected: { ...collected },
    }, { resetLastIntent: false });
    const triageCollected = {
      ...((cleaned.collected ?? {}) as Record<string, unknown>),
      service: triageService || "Revisión dental",
      triage_category: triage.category,
      symptoms: triage.symptoms,
      booking_reason: safeStr(args.inboundText, "").trim(),
      interpreter_source: activeDentalInterpretation?.source ?? "deterministic",
      priority: triage.urgency === "urgent" ? "urgent" : triage.urgency === "soon" ? "soon" : "normal",
      emergency: triage.urgency === "urgent",
      ...(parsedTriageDateTime
        ? {
          preferred_date: parsedTriageDateTime.date,
          preferred_time: parsedTriageDateTime.time,
        }
        : {}),
    };
    if (parsedTriageDateTime) {
      return {
        replyText: "__CHECK_REQUESTED_AVAILABILITY__",
        statePatch: {
          ...cleaned,
          stage: "CONFIRMING",
          lastIntent: "book_appointment",
          nextExpected: "confirm_booking",
          collected: triageCollected,
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "dental_triage_with_datetime" },
      };
    }
    return {
      replyText:
        `${safeStr(triage.safe_reply_hint, "Entiendo, eso conviene revisarlo a tiempo. Puedo ayudarte a agendar una revisión dental.")}${urgentPrefix}${urgencyHint}`,
      statePatch: {
        ...cleaned,
        stage: "BOOKING",
        nextExpected: "date_time",
        collected: triageCollected,
      },
      debug: { intent: "book_appointment", phase: "BOOKING", route: "dental_triage_booking" },
    };
  }

  if (safeStr(state.stage, "") === "BOOKED" && isAppointmentDetailsRequest(args.inboundText)) {
    return {
      replyText: "__CHECK_ACTIVE_APPOINTMENT__",
      statePatch: {
        stage: "BOOKED",
        lastIntent: "appointment_lookup",
        nextExpected: undefined,
        collected: { ...collected, confirmed: true },
      },
      debug: { intent: "appointment_lookup", phase: "BOOKED", route: "appointment_details_shortcut" },
    };
  }

  if (
    intent.intent === "cancel_appointment" ||
    state.nextExpected === "confirm_cancel_appointment"
  ) {
    if (state.nextExpected === "confirm_cancel_appointment") {
      const activeAppt = (collected.active_appointment ??
        {}) as Record<string, unknown>;
      if (isYes) {
        return {
          replyText: "Perfecto, estoy cancelando tu cita ahora mismo.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "cancel_appointment",
            nextExpected: undefined,
            collected: { ...collected },
          },
          toolAction: {
            name: "cancel_appointment",
            payload: {
              appointment_id: safeStr(activeAppt.id, ""),
            },
          },
          debug: {
            intent: "cancel_appointment",
            phase: "BOOKING",
            route: "cancel_confirmed",
          },
        };
      }
      if (isNo) {
        return {
          replyText: "Entendido. Mantengo tu cita confirmada.",
          statePatch: {
            stage: "DISCOVERY",
            lastIntent: "cancel_appointment_denied",
            nextExpected: undefined,
            collected: { ...collected },
          },
          debug: {
            intent: "cancel_appointment",
            phase: "DISCOVERY",
            route: "cancel_denied",
          },
        };
      }
      return {
        replyText: "¿Confirmás que querés cancelarla? Respondé Sí o No.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "cancel_appointment",
          nextExpected: "confirm_cancel_appointment",
          collected: { ...collected },
        },
        debug: {
          intent: "cancel_appointment",
          phase: "BOOKING",
          route: "cancel_retry_confirm",
        },
      };
    }

    return {
      replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__",
      statePatch: {
        stage: "BOOKING",
        lastIntent: "cancel_appointment",
        nextExpected: "confirm_cancel_appointment",
        collected: { ...collected },
      },
      debug: {
        intent: "cancel_appointment",
        phase: "BOOKING",
        route: "cancel_lookup",
      },
    };
  }

  if (
    intent.intent === "reschedule_appointment" ||
    isRescheduleDateTimeExpected(state.nextExpected) ||
    state.nextExpected === "confirm_reschedule_appointment"
  ) {
    if (state.nextExpected === "confirm_reschedule_appointment") {
      const pendingInterruption = classifyPendingFlowInterruption(args.inboundText);
      if (pendingInterruption.type === "business_hours_question") {
        const hoursReply = getBusinessHoursReplyForQuestion(args.inboundText, args.clinicSettings) ?? pickRandom(responses.hours);
        return {
          replyText: `${hoursReply}\n\nSobre el cambio pendiente, ¿querés seguir con ese horario o revisar otro?`,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: "confirm_reschedule_appointment",
            collected: { ...collected },
          },
          debug: {
            intent: "hours",
            phase: "BOOKING",
            route: "reschedule_confirm_interrupted_hours",
          },
        };
      }
      if (pendingInterruption.type === "pricing_question") {
        return {
          replyText: "Depende del caso; en consulta te dan el número exacto.\n\nSobre el cambio pendiente, ¿querés seguir con ese horario o revisar otro?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: "confirm_reschedule_appointment",
            collected: { ...collected },
          },
          debug: {
            intent: "pricing",
            phase: "BOOKING",
            route: "reschedule_confirm_interrupted_pricing",
          },
        };
      }
      if (pendingInterruption.type === "location_question") {
        const address = safeStr(args.clinicSettings?.address, "").trim();
        const reply = address
          ? `Estamos ubicados en: ${address}.\n\nSobre el cambio pendiente, ¿querés seguir con ese horario o revisar otro?`
          : `Claro, te comparto la ubicación por aquí.\n\nSobre el cambio pendiente, ¿querés seguir con ese horario o revisar otro?`;
        return {
          replyText: reply,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: "confirm_reschedule_appointment",
            collected: { ...collected },
          },
          debug: {
            intent: "location",
            phase: "BOOKING",
            route: "reschedule_confirm_interrupted_location",
          },
        };
      }
      if (pendingInterruption.type === "clean_confirmation") {
        const activeAppt = (collected.active_appointment ??
          {}) as Record<string, unknown>;
        return {
          replyText: "Perfecto, estoy actualizando tu cita ahora mismo.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: undefined,
            collected: { ...collected },
          },
          toolAction: {
            name: "reschedule_appointment",
            payload: {
              appointment_id: safeStr(activeAppt.id, ""),
              appointment_date: safeStr(collected.reschedule_date, ""),
              appointment_time: safeStr(collected.reschedule_time, ""),
              reason: safeStr(collected.service, safeStr(activeAppt.reason, "Consulta general")),
            },
          },
          debug: {
            intent: "reschedule_appointment",
            phase: "BOOKING",
            route: "reschedule_confirmed",
          },
        };
      }
      if (pendingInterruption.type === "clean_rejection") {
        return {
          replyText: "Perfecto. ¿Qué nueva fecha y hora te conviene?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: "reschedule_datetime",
            collected: { ...collected, reschedule_date: null, reschedule_time: null },
          },
          debug: {
            intent: "reschedule_appointment",
            phase: "BOOKING",
            route: "reschedule_retry_datetime",
          },
        };
      }
      if (pendingInterruption.type === "date_time_change" || pendingInterruption.type === "correction") {
        const sameDayTimeMatch = normalizeTextForIntent(args.inboundText).match(
          /\b(misma fecha|ese mismo dia|el mismo dia)\b/,
        );
        if (sameDayTimeMatch) {
          const activeAppt = (collected.active_appointment ?? {}) as Record<string, unknown>;
          const baseDate = safeStr(
            collected.reschedule_date,
            safeStr(activeAppt.appointment_date, safeStr(activeAppt.starts_at, "").slice(0, 10)),
          );
          const onlyTime = parseTimeOnlyFromMessage(args.inboundText);
          if (baseDate && onlyTime) {
            return {
              replyText: "__CHECK_RESCHEDULE_AVAILABILITY__",
              statePatch: {
                stage: "BOOKING",
                lastIntent: "reschedule_appointment",
                nextExpected: "confirm_reschedule_appointment",
                collected: { ...collected, reschedule_date: baseDate, reschedule_time: onlyTime },
              },
              debug: { intent: "reschedule_appointment", phase: "BOOKING", route: "reschedule_confirm_same_date_new_time" },
            };
          }
        }
        const parsed = parseDateTimeFromMessage(args.inboundText, safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa"));
        if (!parsed) {
          return {
            replyText: "Tenés razón. ¿Qué día y hora querés que revise?",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "reschedule_appointment",
              nextExpected: "reschedule_datetime",
              collected: { ...collected, reschedule_date: null, reschedule_time: null },
            },
            debug: { intent: "reschedule_appointment", phase: "BOOKING", route: "reschedule_confirm_correction_ask_datetime" },
          };
        }
        return {
          replyText: "__CHECK_RESCHEDULE_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: "confirm_reschedule_appointment",
            collected: { ...collected, reschedule_date: parsed.date, reschedule_time: parsed.time },
          },
          debug: { intent: "reschedule_appointment", phase: "BOOKING", route: "reschedule_confirm_interrupted_new_datetime" },
        };
      }
      return {
        replyText: "Claro. Solo para no confundirme: ¿querés confirmar el cambio pendiente o revisar otro horario?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "reschedule_appointment",
          nextExpected: "confirm_reschedule_appointment",
          collected: { ...collected },
        },
        debug: {
          intent: "reschedule_appointment",
          phase: "BOOKING",
          route: "reschedule_retry_confirm",
        },
      };
    }

    if (isRescheduleDateTimeExpected(state.nextExpected)) {
      const isDentalConversation =
        safeStr(state.orgType, determineOrgType(args.organizationId, resolvedBusinessType)).toLowerCase() ===
          "dental" ||
        args.organizationId === "clinic-demo";
      const sameDayTimeMatch = normalizeTextForIntent(args.inboundText).match(
        /\b(misma fecha|ese mismo dia|el mismo dia)\b/,
      );
      if (sameDayTimeMatch) {
        const activeAppt = (collected.active_appointment ?? {}) as Record<string, unknown>;
        const baseDate = safeStr(
          activeAppt.appointment_date,
          safeStr(activeAppt.starts_at, "").slice(0, 10),
        );
        const onlyTime = parseTimeOnlyFromMessage(args.inboundText);
        if (baseDate && onlyTime) {
          return {
            replyText: "__CHECK_RESCHEDULE_AVAILABILITY__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "reschedule_appointment",
              nextExpected: "confirm_reschedule_appointment",
              collected: { ...collected, reschedule_date: baseDate, reschedule_time: onlyTime },
            },
            debug: {
              intent: "reschedule_appointment",
              phase: "BOOKING",
              route: "reschedule_same_date_new_time",
            },
          };
        }
      }
      if (resolveWeekdayDayNumberDate(normalizeTextForIntent(args.inboundText), safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa")).conflict) {
        return {
          replyText: "Quiero confirmar la fecha: ¿te referís a viernes 15 de mayo?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: "reschedule_datetime",
            collected: { ...collected },
          },
          debug: {
            intent: "reschedule_appointment",
            phase: "BOOKING",
            route: "reschedule_weekday_day_conflict_clarify",
          },
        };
      }
      const parsedDateTime = parseDateTimeFromMessage(
        args.inboundText,
        safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa"),
      );
      if (!parsedDateTime) {
        const parsedDateOnly = parseDateOnlyFromMessage(
          args.inboundText,
          safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa"),
        );
        if (parsedDateOnly) {
          const humanDate = formatHumanDay(parsedDateOnly);
          return {
            replyText: `Claro, ¿a qué hora de ${humanDate} te gustaría?`,
            statePatch: {
              stage: "BOOKING",
              lastIntent: "reschedule_appointment",
              nextExpected: "reschedule_datetime",
              collected: { ...collected, reschedule_date: parsedDateOnly, reschedule_time: null },
            },
            debug: {
              intent: "reschedule_appointment",
              phase: "BOOKING",
              route: "reschedule_ask_missing_time",
            },
          };
        }
      }
      if (!parsedDateTime) {
        if (isDentalConversation) {
          return {
            replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "reschedule_appointment",
              nextExpected: "reschedule_datetime",
              collected: { ...collected },
            },
            debug: {
              intent: "reschedule_appointment",
              phase: "BOOKING",
              route: "dental_reschedule_datetime_guided_fallback",
            },
          };
        }
        return {
          replyText:
            "Perfecto. Decime la nueva fecha y hora (por ejemplo: martes a las 10:00).",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: "reschedule_datetime",
            collected: { ...collected },
          },
          debug: {
            intent: "reschedule_appointment",
            phase: "BOOKING",
            route: "reschedule_ask_datetime",
          },
        };
      }
      return {
        replyText: "__CHECK_RESCHEDULE_AVAILABILITY__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "reschedule_appointment",
          nextExpected: "confirm_reschedule_appointment",
          collected: {
            ...collected,
            reschedule_date: parsedDateTime.date,
            reschedule_time: parsedDateTime.time,
          },
        },
        debug: {
          intent: "reschedule_appointment",
          phase: "BOOKING",
          route: "reschedule_check_availability",
        },
      };
    }

    const directParsedDateTime = parseDateTimeFromMessage(
      args.inboundText,
      safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa"),
    );
    return {
      replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "reschedule_appointment",
          nextExpected: directParsedDateTime
            ? "confirm_reschedule_appointment"
            : "reschedule_datetime",
          collected: {
            ...collected,
            ...(directParsedDateTime
              ? {
                reschedule_date: directParsedDateTime.date,
                reschedule_time: directParsedDateTime.time,
                reschedule_from_message: true,
              }
              : {}),
          },
        },
      debug: {
        intent: "reschedule_appointment",
        phase: "BOOKING",
        route: directParsedDateTime
          ? "reschedule_lookup_with_datetime"
          : "reschedule_lookup",
      },
    };
  }

  const isRetryBookingConfirmation =
    safeStr(state.lastIntent, "") === "booking_failed" &&
    /^(s[ií]|si|yes|ok|dale|claro|confirmo|confirmar|perfecto|listo)\b/i.test(
      text.trim(),
    );
  if (isRetryBookingConfirmation) {
    const bookingCollected = { ...collected };
    if (!safeStr(bookingCollected.service, "").trim()) {
      const remembered = safeStr(bookingCollected.last_discussed_service, "").trim();
      if (remembered) bookingCollected.service = remembered;
    }
    const hasRetryContext = Boolean(
      safeStr(bookingCollected.service, "").trim() &&
        safeStr(bookingCollected.preferred_date, "").trim() &&
        safeStr(bookingCollected.preferred_time, "").trim(),
    );
    if (hasRetryContext) {
      const serviceLabel = toPatientFacingServiceLabel(
        safeStr(bookingCollected.service, "Revisión dental"),
      );
      const bookingLabel = safeStr(
        bookingCollected.booking_label,
        serviceLabel || safeStr(bookingCollected.service, "Revisión dental"),
      );
      console.log(JSON.stringify({
        event: "booking:confirmed",
        route: "booking_retry_confirmation_yes",
        service: bookingCollected.service ?? null,
        preferred_date: bookingCollected.preferred_date ?? null,
        preferred_time: bookingCollected.preferred_time ?? null,
      }));
      return {
        replyText: "Perfecto, estoy procesando tu reserva ahora mismo.",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "booking_retry",
          nextExpected: undefined,
          collected: { ...bookingCollected, confirmed: true },
        },
        toolAction: {
          name: "book_appointment",
          payload: {
            patient_name: resolveAppointmentPatientName(bookingCollected, state),
            appointment_for_relation: bookingCollected.appointment_for_relation || null,
            service: bookingCollected.service,
            reason: bookingCollected.service,
            title: bookingLabel || "Revisión dental",
            appointment_date: bookingCollected.preferred_date,
            appointment_time: bookingCollected.preferred_time,
            channel: args.channel ?? "messenger",
          },
        },
        debug: {
          intent: "booking_confirmed",
          phase: "BOOKING",
          route: "retry_confirmed",
        },
      };
    }
  }

  // Pricing must always answer first and bypass booking orchestration.
  if (
    orgType === "dental" &&
    state.nextExpected !== "confirm_booking" &&
    !isDurationProcessQuestion(args.inboundText) &&
    (intent.intent === "pricing" || isPricingQuestion(args.inboundText))
  ) {
    const serviceInfo = resolveDentalServiceInfo({
      message: text,
      clinicSettings: args.clinicSettings,
    });
    if (serviceInfo.matched) {
      const chosenService = toPatientFacingServiceLabel(
        serviceInfo.booking_service || serviceInfo.service.name,
      );
      const targetService = resolveCtaTargetService(chosenService);
      const shouldSetCta = hasSchedulingCta(serviceInfo.replyText);
      return {
        replyText: serviceInfo.replyText,
        statePatch: {
          stage: shouldSetCta ? "BOOKING" : "DISCOVERY",
          lastIntent: "pricing",
          nextExpected: shouldSetCta ? "date_time" : "pricing_followup",
          collected: {
            ...collected,
            last_pricing_service: serviceInfo.service.name,
            service: shouldSetCta ? targetService : serviceInfo.service.name,
            last_discussed_service: chosenService,
            last_cta: shouldSetCta
              ? {
                type: "schedule_service",
                service: chosenService,
                target_service: targetService,
                source: "pricing",
                created_at: new Date().toISOString(),
              }
              : (collected as any)?.last_cta,
          },
        },
        debug: { intent: "pricing", phase: "DISCOVERY", route: "pricing_answer_first" },
      };
    }
    return {
      replyText:
        "El precio puede variar según cada caso. Si quieres, puedo ayudarte a agendar esa revisión 😊",
      statePatch: {
        stage: "DISCOVERY",
        lastIntent: "pricing",
        nextExpected: "pricing_followup",
        collected: { ...collected },
      },
      debug: { intent: "pricing", phase: "DISCOVERY", route: "pricing_generic_answer_first" },
    };
  }

  // Service-info priority: answer service questions first, do not auto-enter booking.
  if (orgType === "dental" && isServiceQuestion(args.inboundText)) {
    const serviceInfo = resolveDentalServiceInfo({
      message: text,
      clinicSettings: args.clinicSettings,
    });
    if (serviceInfo.matched) {
      const chosenService = toPatientFacingServiceLabel(
        serviceInfo.booking_service || serviceInfo.service.name,
      );
      const serviceInfoReply = buildServiceOnlyReply(
        chosenService,
        safeStr(serviceInfo.service.short_description, ""),
      );
      const targetService = resolveCtaTargetService(chosenService);
      const shouldSetCta = hasSchedulingCta(serviceInfoReply);
      return {
        replyText: serviceInfoReply,
        statePatch: {
          stage: shouldSetCta ? "BOOKING" : "SERVICE_INFO",
          lastIntent: "service_info",
          nextExpected: shouldSetCta ? "date_time" : "service_info_or_booking",
          collected: {
            ...collected,
            service: shouldSetCta ? targetService : chosenService,
            last_discussed_service: chosenService,
            last_cta: shouldSetCta
              ? {
                type: "schedule_service",
                service: chosenService,
                target_service: targetService,
                source: "service_info",
                created_at: new Date().toISOString(),
              }
              : (collected as any)?.last_cta,
          },
        },
        debug: { intent: "services", phase: "SERVICE_INFO", route: "service_question_priority" },
      };
    }
  }

  // Service-info continuity: if a service was discussed and user asks follow-up, answer it before booking.
  if (
    orgType === "dental" &&
    safeStr(state.nextExpected, "") === "service_info_or_booking" &&
    isServiceFollowupQuestion(args.inboundText)
  ) {
    const knownService = safeStr(collected.last_discussed_service, safeStr(collected.service, ""));
    if (knownService) {
      const followup = buildServiceFollowupReply(knownService, args.inboundText);
      if (followup) {
        return {
          replyText: followup,
          statePatch: {
            stage: "SERVICE_INFO",
            lastIntent: "service_info",
            nextExpected: "service_info_or_booking",
            collected: {
              ...collected,
              service: knownService,
              last_discussed_service: knownService,
            },
          },
          debug: { intent: "services", phase: "SERVICE_INFO", route: "service_followup_answered" },
        };
      }
    }
  }

  if (intent.intent === "confusion" && safeStr(state.lastIntent, "") === "pricing") {
    const lastService = safeStr((collected as any)?.last_pricing_service, "ese tratamiento");
    return {
      replyText:
        `Me refería a una revisión para poder darte un precio exacto, pero primero te respondo: el precio de ${lastService.toLowerCase()} puede variar según el caso.`,
      statePatch: {
        stage: "DISCOVERY",
        lastIntent: "pricing",
        nextExpected: "pricing_followup",
        collected: { ...collected },
      },
      debug: { intent: "confusion", phase: "DISCOVERY", route: "pricing_clarification" },
    };
  }

  if (intent.intent === "emergency" && responses.emergency) {
    const cleaned = clearActiveBookingState({
      stage: "BOOKING",
      lastIntent: "emergency",
      nextExpected: "date_time",
      collected: { ...collected },
    }, { resetLastIntent: false });
    const emergencyReason = safeStr(args.inboundText, "").trim();
    const emergencyCollected = {
      ...((cleaned.collected ?? {}) as Record<string, unknown>),
      service: "Revisión dental",
      booking_reason: emergencyReason,
      priority: "urgent",
      emergency: true,
    };
    const severe = isSevereEmergencyText(args.inboundText);
    if (severe) {
      return {
        replyText: "Entiendo. Por seguridad, te recomiendo comunicarte de inmediato con la clínica o un servicio de urgencias.",
        statePatch: {
          ...cleaned,
          stage: "BOOKING",
          nextExpected: "date_time",
          collected: emergencyCollected,
        },
        debug: { intent: "emergency", phase: "HANDOFF", route: "urgent_severe" },
      };
    }
    return {
      replyText: pickRandom(responses.emergency),
      statePatch: {
        ...cleaned,
        stage: "BOOKING",
        nextExpected: "date_time",
        collected: emergencyCollected,
      },
      debug: { intent: "emergency", phase: "HANDOFF", route: "urgent" },
    };
  }

  // P1: Handoff
  if (needsHumanHandoff(intent.intent)) {
    return {
      replyText: pickRandom(responses.handoff),
      statePatch: { stage: "HANDOFF", lastIntent: intent.intent },
      debug: {
        intent: intent.intent,
        phase: "HANDOFF",
        route: "priority_handoff",
      },
      toolAction: { name: "request_handoff", payload: {} },
    };
  }

  const isDentalBookingFlow = orgType === "dental" && (
    /\b(lo mismo de antes|el mismo tratamiento|otra limpieza como la anterior|el mismo horario de la vez pasada)\b/i
      .test(args.inboundText) ||
    intent.intent === "book_appointment" ||
    hasDeterministicBookingSignal(args.inboundText) ||
    state.stage === "BOOKING" ||
    state.stage === "BOOKED" ||
    state.nextExpected === "confirm_offered_slot" ||
    state.nextExpected === "confirm_booking_suggestion" ||
    state.nextExpected === "service_info_or_booking" ||
    state.nextExpected === "service" ||
    state.nextExpected === "date_time" ||
    state.nextExpected === "confirm_booking"
  );
  const hasServiceContext = Boolean(
    safeStr((state.collected as any)?.service, "").trim() ||
      safeStr((state.collected as any)?.last_discussed_service, "").trim() ||
      (Boolean((state.collected as any)?.emergency) && hasSymptomEmergencySignal(args.inboundText)) ||
      detectService(args.inboundText),
  );
  const shouldRouteAvailability = orgType === "dental" &&
    isAvailabilityInquiryText(args.inboundText) &&
    !isBusinessHoursQuestionText(args.inboundText) &&
    hasServiceContext;

  const lastCta = (collected as any)?.last_cta as Record<string, unknown> | undefined;
  if (
    orgType === "dental" &&
    safeStr(lastCta?.type, "") === "schedule_service" &&
    /^(s[ií]|si|claro|ok|dale|me parece|quiero|revisemos horarios)\b/i.test(text.trim().toLowerCase())
  ) {
    const targetService = safeStr(lastCta?.target_service, safeStr((collected as any)?.service, "Revisión dental"));
    return {
      replyText: `Perfecto. Voy a revisar horarios para ${targetService.toLowerCase()}. ¿Tenés algún día u hora que te quede mejor?`,
      statePatch: {
        stage: "BOOKING",
        lastIntent: "book_appointment",
        nextExpected: "date_time",
        collected: {
          ...collected,
          service: targetService,
          last_discussed_service: safeStr(lastCta?.service, targetService),
        },
      },
      debug: { intent: "book_appointment", phase: "BOOKING", route: "cta_schedule_affirmation" },
    };
  }

  if (isDentalBookingFlow || shouldRouteAvailability) {
    console.log(JSON.stringify({
      event: "booking:detected",
      route: "dental_booking_flow",
      next_expected: state.nextExpected ?? null,
      stage: state.stage ?? null,
    }));
    const bookingCollected = { ...collected };
    const firstName = getFirstName(state);
    const serviceFromMessage = detectService(args.inboundText);
    const llmService = safeStr(bookingCollected.service, "").trim();
    const thirdParty = detectThirdPartyPatient(args.inboundText);
    const thirdPartyTimezone = safeStr(
      args.clinicSettings?.timezone,
      "America/Tegucigalpa",
    );
    const parsedDateTimeForThirdParty = parseDateTimeFromMessage(args.inboundText, thirdPartyTimezone);
    const parsedDateOnlyForThirdParty = parseDateOnlyFromMessage(args.inboundText, thirdPartyTimezone);
    const wantsSameAsBefore = /\b(lo mismo de antes|el mismo tratamiento|otra limpieza como la anterior|el mismo horario de la vez pasada)\b/i
      .test(args.inboundText);
    const activeAppointment = ((bookingCollected as any).active_appointment ?? {}) as Record<string, unknown>;
    const hasActiveAppointment = Boolean(safeStr(activeAppointment.id, "").trim());
    const parsedDateTimeWithContext = parseDateTimeFromMessage(
      args.inboundText,
      safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa"),
    );

    if (
      hasActiveAppointment &&
      !isAdditionalAppointmentRequest(args.inboundText) &&
      isAvailabilityInquiryText(args.inboundText)
    ) {
      const summary = resolveActiveAppointmentSummary(activeAppointment);
      return {
        replyText:
          `Veo que ya tenés una cita confirmada para ${summary.service} el ${summary.dateLabel} a las ${summary.timeLabel}.\n\n¿Querés agregar esto a esa cita, buscar un horario más pronto o agendar una cita adicional?`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "appointment_lookup",
          nextExpected: "active_appointment_intent_choice",
          collected: { ...bookingCollected },
        },
        debug: { intent: "appointment_lookup", phase: "BOOKING", route: "active_appointment_availability_clarify" },
      };
    }

    if (
      hasActiveAppointment &&
      (
        hasSymptomEmergencySignal(args.inboundText) ||
        isRescheduleSoonerRequest(args.inboundText) ||
        Boolean(serviceFromMessage) ||
        isAvailabilityInquiryText(args.inboundText)
      )
    ) {
      if (isRescheduleSoonerRequest(args.inboundText)) {
        return {
          replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "reschedule_appointment",
            nextExpected: parsedDateTimeWithContext ? "confirm_reschedule_appointment" : "reschedule_datetime",
            collected: {
              ...bookingCollected,
              ...(parsedDateTimeWithContext
                ? {
                  reschedule_date: parsedDateTimeWithContext.date,
                  reschedule_time: parsedDateTimeWithContext.time,
                }
                : {}),
            },
          },
          debug: { intent: "reschedule_appointment", phase: "BOOKING", route: "active_appointment_sooner_reschedule" },
        };
      }

      if (isAddToCurrentAppointmentRequest(args.inboundText)) {
        const summary = resolveActiveAppointmentSummary(activeAppointment);
        return {
          replyText: `Perfecto, lo agrego como nota para tu cita de ${summary.service} el ${summary.dateLabel} a las ${summary.timeLabel}.`,
          statePatch: {
            stage: "BOOKED",
            lastIntent: "appointment_note_added",
            nextExpected: undefined,
            collected: {
              ...bookingCollected,
              appointment_note: safeStr(args.inboundText, "").trim(),
              appointment_note_for_id: safeStr(activeAppointment.id, ""),
            },
          },
          debug: { intent: "appointment_lookup", phase: "BOOKED", route: "active_appointment_add_note" },
        };
      }

      const summary = resolveActiveAppointmentSummary(activeAppointment);
      const urgentSignal = isSevereEmergencyText(args.inboundText) || triage?.urgency === "urgent";
      const reply = urgentSignal
        ? `Veo que ya tenés una cita, pero por lo que contás quizá conviene revisarlo antes. ¿Querés buscar un horario más pronto?`
        : `Veo que ya tenés una cita confirmada para ${summary.service} el ${summary.dateLabel} a las ${summary.timeLabel}.\n\n¿Querés agregar esto a esa cita, buscar un horario más pronto o agendar una cita adicional?`;
      return {
        replyText: reply,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "appointment_lookup",
          nextExpected: "active_appointment_intent_choice",
          collected: { ...bookingCollected },
        },
        debug: { intent: "appointment_lookup", phase: "BOOKING", route: "active_appointment_new_symptom_clarify" },
      };
    }

    if (safeStr(state.nextExpected, "") === "active_appointment_intent_choice") {
      const pendingInterruption = classifyPendingFlowInterruption(args.inboundText);
      if (pendingInterruption.type === "business_hours_question") {
        const hoursReply = getBusinessHoursReplyForQuestion(args.inboundText, args.clinicSettings) ?? pickRandom(responses.hours);
        return {
          replyText: `${hoursReply}\n\nSobre tu cita actual, ¿querés cambiarla o agendar una adicional?`,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "appointment_lookup",
            nextExpected: "active_appointment_intent_choice",
            collected: { ...bookingCollected },
          },
          debug: { intent: "hours", phase: "BOOKING", route: "active_appointment_choice_interrupted_hours" },
        };
      }
      if (pendingInterruption.type === "pricing_question") {
        return {
          replyText:
            "Depende del caso; en consulta te dan el número exacto.\n\nSobre tu cita actual, ¿querés cambiarla o agendar una adicional?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "appointment_lookup",
            nextExpected: "active_appointment_intent_choice",
            collected: { ...bookingCollected },
          },
          debug: { intent: "pricing", phase: "BOOKING", route: "active_appointment_choice_interrupted_pricing" },
        };
      }
      if (pendingInterruption.type === "location_question") {
        const address = safeStr(args.clinicSettings?.address, "").trim();
        const reply = address
          ? `Estamos ubicados en: ${address}.\n\nSobre tu cita actual, ¿querés cambiarla o agendar una adicional?`
          : "Claro, te comparto la ubicación por aquí.\n\nSobre tu cita actual, ¿querés cambiarla o agendar una adicional?";
        return {
          replyText: reply,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "appointment_lookup",
            nextExpected: "active_appointment_intent_choice",
            collected: { ...bookingCollected },
          },
          debug: { intent: "location", phase: "BOOKING", route: "active_appointment_choice_interrupted_location" },
        };
      }
      if (isAddToCurrentAppointmentRequest(args.inboundText)) {
        const summary = resolveActiveAppointmentSummary(activeAppointment);
        return {
          replyText: `Perfecto, lo agrego como nota para tu cita de ${summary.service} el ${summary.dateLabel} a las ${summary.timeLabel}.`,
          statePatch: {
            stage: "BOOKED",
            lastIntent: "appointment_note_added",
            nextExpected: undefined,
            collected: {
              ...bookingCollected,
              appointment_note: safeStr(args.inboundText, "").trim(),
              appointment_note_for_id: safeStr(activeAppointment.id, ""),
            },
          },
          debug: { intent: "appointment_lookup", phase: "BOOKED", route: "active_appointment_choice_add_note" },
        };
      }
      if (isAdditionalAppointmentRequest(args.inboundText)) {
        return {
          replyText: hasCollectedName(state)
            ? `Claro, ${firstName}. ¿Qué tipo de cita necesitás: revisión general, limpieza, ortodoncia, blanqueamiento o alguna molestia dental?`
            : "Claro. ¿Qué tipo de cita necesitás: revisión general, limpieza, ortodoncia, blanqueamiento o alguna molestia dental?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "service",
            collected: { ...bookingCollected, service: null, last_discussed_service: null },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "active_appointment_new_booking_choice" },
        };
      }
      return {
        replyText: "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "reschedule_appointment",
          nextExpected: parsedDateTimeWithContext ? "confirm_reschedule_appointment" : "reschedule_datetime",
          collected: {
            ...bookingCollected,
            ...(parsedDateTimeWithContext
              ? {
                reschedule_date: parsedDateTimeWithContext.date,
                reschedule_time: parsedDateTimeWithContext.time,
              }
              : {}),
          },
        },
        debug: { intent: "reschedule_appointment", phase: "BOOKING", route: "active_appointment_reschedule_choice" },
      };
    }

    if (thirdParty && !thirdParty.self) {
      if (!safeStr(bookingCollected.service, "").trim() && serviceFromMessage) {
        bookingCollected.service = serviceFromMessage;
      }
      if (parsedDateTimeForThirdParty) {
        bookingCollected.preferred_date = parsedDateTimeForThirdParty.date;
        bookingCollected.preferred_time = parsedDateTimeForThirdParty.time;
      } else if (parsedDateOnlyForThirdParty) {
        bookingCollected.preferred_date = parsedDateOnlyForThirdParty;
      }
      return {
        replyText: `Claro. ¿Cuál es el nombre de tu ${thirdParty.relation}?`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "third_party_patient_name",
          collected: {
            ...bookingCollected,
            booking_for_other: true,
            appointment_for_relation: thirdParty.relation,
          },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "ask_third_party_patient_name" },
      };
    }
    if (["patient_name_for", "third_party_patient_name"].includes(safeStr(state.nextExpected, ""))) {
      if (thirdParty?.self) {
        bookingCollected.patient_name = toDisplayPersonName(
          safeStr(state.full_name, safeStr(state.name, "")),
        );
        bookingCollected.appointment_for_relation = "self";
      } else {
        bookingCollected.patient_name = toDisplayPersonName(safeStr(args.inboundText, ""));
      }
      const hasService = Boolean(safeStr(bookingCollected.service, "").trim());
      const hasDate = Boolean(
        safeStr(bookingCollected.preferred_date, "").trim() ||
          safeStr(bookingCollected.appointment_date, "").trim(),
      );
      const hasTime = Boolean(
        safeStr(bookingCollected.preferred_time, "").trim() ||
          safeStr(bookingCollected.appointment_time, "").trim(),
      );
      if (hasService && hasDate && hasTime) {
        const requestedDate = safeStr(
          bookingCollected.preferred_date,
          safeStr(bookingCollected.appointment_date, ""),
        );
        const requestedTime = safeStr(
          bookingCollected.preferred_time,
          safeStr(bookingCollected.appointment_time, ""),
        );
        return {
          replyText: `Perfecto, la cita sería para ${safeStr(bookingCollected.patient_name, "el paciente")}.\n\n${formatHumanDay(requestedDate)} a las ${formatHourLabel(requestedTime)} está disponible para ${toPatientFacingServiceLabel(safeStr(bookingCollected.service, "Revisión dental"))}.\n\n¿Confirmamos la cita?`,
          statePatch: {
            stage: "CONFIRMING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            collected: {
              ...bookingCollected,
              preferred_date: requestedDate,
              preferred_time: requestedTime,
              confirmed: false,
            },
          },
          debug: {
            intent: "book_appointment",
            phase: "BOOKING",
            route: "third_party_resume_preconfirm",
          },
        };
      }
      state.nextExpected = hasService ? "date_time" : "service";
    }

    if (
      safeStr(state.stage, "") === "BOOKED" &&
      /^(ok|ok gracias|gracias|muchas gracias|gracias!?)$/i.test(text.trim())
    ) {
      return {
        replyText: "Con gusto 😊 Te esperamos.",
        statePatch: {
          stage: "BOOKED",
          lastIntent: "gratitude",
          nextExpected: undefined,
          collected: { ...bookingCollected, confirmed: true },
        },
        debug: { intent: "gratitude", phase: "BOOKED", route: "booked_thanks" },
      };
    }

    if (
      safeStr(state.stage, "") === "BOOKED" &&
      (
        intent.intent === "appointment_lookup" ||
        isAppointmentLookupInquiry(args.inboundText)
      )
    ) {
      return {
        replyText: "__CHECK_ACTIVE_APPOINTMENT__",
        statePatch: {
          stage: "BOOKED",
          lastIntent: "appointment_lookup",
          nextExpected: undefined,
          collected: { ...bookingCollected, confirmed: true },
        },
        debug: { intent: "appointment_lookup", phase: "BOOKED", route: "appointment_lookup" },
      };
    }

    const normalizedInbound = normalizeTextForIntent(args.inboundText);
    const isRescheduleLikeInBooked = /\b(reagend\w*|cambiar\w*|mover\w*|pasar\w*)\b/.test(normalizedInbound);
    const isLookupLikeInBooked = isAppointmentLookupInquiry(args.inboundText);
    if (
      safeStr(state.stage, "") === "BOOKED" &&
      !isRescheduleLikeInBooked &&
      !isLookupLikeInBooked &&
      /^(s[ií]|si|confirmo|confirmar|ok|dale|claro)\b/i.test(text.trim())
    ) {
      return {
        replyText: "__CHECK_ACTIVE_APPOINTMENT__",
        statePatch: {
          stage: "BOOKED",
          nextExpected: undefined,
          collected: { ...bookingCollected, confirmed: true },
        },
        debug: { intent: "appointment_lookup", phase: "BOOKED", route: "already_booked_guard_lookup" },
      };
    }

    if (
      /^(y hoy\??|ser[ií]a hoy\??)$/i.test(text.trim())
    ) {
      if (safeStr(bookingCollected.preferred_date, "") && safeStr(bookingCollected.preferred_time, "")) {
        const dateLabel = formatBookingDate(
          safeStr(bookingCollected.preferred_date, ""),
          safeStr(bookingCollected.preferred_time, ""),
        );
        return {
          replyText: `Sí, sería para ${dateLabel}.`,
          statePatch: { stage: "BOOKING", nextExpected: "confirm_booking", collected: { ...bookingCollected } },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "clarify_today_existing_slot" },
        };
      }
      return {
        replyText: "Sí, puedo revisar horarios para hoy. ¿Qué hora te queda bien?",
        statePatch: { stage: "BOOKING", nextExpected: "date_time", collected: { ...bookingCollected } },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "clarify_today_ask_time" },
      };
    }

    const hasNearestAlternative = Boolean(
      safeStr((bookingCollected as any).nearest_available_date, "").trim() &&
      safeStr((bookingCollected as any).nearest_available_time, "").trim(),
    );
    const pendingOfferedSlot = ((bookingCollected as any).pending_offered_slot ?? {}) as Record<string, unknown>;
    const pendingOfferedSlotFresh = isPendingOfferedSlotFresh(pendingOfferedSlot);
    const hasPendingOfferedSlot = Boolean(
      safeStr(pendingOfferedSlot.appointment_date, "").trim() &&
      safeStr(pendingOfferedSlot.appointment_time, "").trim() &&
      pendingOfferedSlotFresh,
    );
    if (
      !hasPendingOfferedSlot &&
      safeStr(state.nextExpected, "") === "confirm_offered_slot" &&
      isAffirmativeShortText(args.inboundText)
    ) {
      return {
        replyText: "Perfecto. ¿Qué día y hora te queda mejor?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          collected: {
            ...bookingCollected,
            pending_offered_slot: null,
          },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "offered_slot_expired_ask_datetime" },
      };
    }
    if (
      hasPendingOfferedSlot &&
      ["confirm_offered_slot", "date_time"].includes(safeStr(state.nextExpected, ""))
    ) {
      console.log(JSON.stringify({
        event: "pending_offered_slot:read",
        lead_id: args.leadId ?? null,
        next_expected: safeStr(state.nextExpected, ""),
        pending_offered_slot: pendingOfferedSlot,
      }));
      const trimmed = text.trim().toLowerCase();
      const acceptAlt = /^(s[ií]|si|ok|dale|claro|perfecto|listo|me funciona|est[aá] bien|confirmar)\b/i.test(trimmed);
      const rejectAlt = /^(no|otro d[ií]a|prefiero otro d[ií]a|cambiar d[ií]a)\b/i.test(trimmed);
      if (acceptAlt) {
        const offeredDate = safeStr(pendingOfferedSlot.appointment_date, "");
        const offeredTime = safeStr(pendingOfferedSlot.appointment_time, "");
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "CONFIRMING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            collected: {
              ...bookingCollected,
              preferred_date: offeredDate,
              preferred_time: offeredTime,
              confirmed: false,
            },
          },
          debug: { intent: "book_appointment", phase: "CONFIRMING", route: "accept_pending_offered_slot" },
        };
      }
      if (rejectAlt) {
        return {
          replyText: "Claro 👍 ¿Qué día te gustaría revisar?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            collected: {
              ...bookingCollected,
              pending_offered_slot: null,
              preferred_date: null,
              preferred_time: null,
              confirmed: false,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "reject_pending_offered_slot" },
        };
      }
    }

    if (
      hasNearestAlternative &&
      safeStr(state.nextExpected, "") === "date_time"
    ) {
      const trimmed = text.trim().toLowerCase();
      const acceptAlt = /^(s[ií]|si|ok|dale|claro|perfecto|listo|me funciona|est[aá] bien)\b/i.test(trimmed);
      const rejectAlt = /^(no|otro d[ií]a|prefiero otro d[ií]a|cambiar d[ií]a)\b/i.test(trimmed);
      if (acceptAlt) {
        const nearestDate = safeStr((bookingCollected as any).nearest_available_date, "");
        const nearestTime = safeStr((bookingCollected as any).nearest_available_time, "");
        return {
          replyText: "__CHECK_REQUESTED_AVAILABILITY__",
          statePatch: {
            stage: "CONFIRMING",
            lastIntent: "book_appointment",
            nextExpected: "confirm_booking",
            collected: {
              ...bookingCollected,
              preferred_date: nearestDate,
              preferred_time: nearestTime,
              confirmed: false,
            },
          },
          debug: { intent: "book_appointment", phase: "CONFIRMING", route: "accept_nearest_alternative" },
        };
      }
      if (rejectAlt) {
        return {
          replyText: "Claro 👍 ¿Qué día te gustaría revisar?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            collected: {
              ...bookingCollected,
              preferred_date: null,
              preferred_time: null,
              confirmed: false,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "reject_nearest_alternative" },
        };
      }
    }

    if (
      safeStr(state.nextExpected, "") === "change_booking_detail" &&
      /cambiar.*d[ií]a|quiero cambiar el d[ií]a/i.test(text)
    ) {
      return {
        replyText: "Perfecto 👍 ¿Para qué día la querés?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "booking_reschedule",
          nextExpected: "date_time",
          collected: {
            ...bookingCollected,
            preferred_date: null,
            confirmed: false,
          },
        },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "change_day_explicit" },
      };
    }

    if (state.nextExpected === "confirm_booking_suggestion") {
      const trimmed = text.trim().toLowerCase();
      const isYes =
        /^(s[ií]|si|yes|ok|dale|claro|por\s*favor|porfavor|porfa|s[ií]\s+por\s+favo?r|perfecto|listo|quiero|me\s+interesa)\b/i
          .test(trimmed);

      if (isYes || isContinuationText(trimmed)) {
        if (safeStr(bookingCollected.service, "").trim()) {
          return {
            replyText: `Perfecto. Voy a revisar horarios para ${toPatientFacingServiceLabel(safeStr(bookingCollected.service, "revisión dental")).toLowerCase()}. ¿Tenés algún día u hora que te quede mejor?`,
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "date_time",
              collected: { ...bookingCollected },
            },
            debug: {
              intent: "book_appointment",
              phase: "BOOKING",
              route: "confirmed_suggestion_to_datetime",
            },
          };
        }
        return {
          replyText: hasCollectedName(state)
            ? `Claro, ${getFirstName(state)}. ¿Qué tipo de cita necesitás: revisión general, limpieza, ortodoncia, blanqueamiento o alguna molestia dental?`
            : "Claro. ¿Qué tipo de cita necesitás: revisión general, limpieza, ortodoncia, blanqueamiento o alguna molestia dental?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "service",
            collected: { ...bookingCollected },
          },
          debug: {
            intent: "book_appointment",
            phase: "BOOKING",
            route: "confirmed_suggestion",
          },
        };
      }

      state.nextExpected = undefined;
      state.stage = "DISCOVERY";
    }

    if (state.nextExpected === "confirm_booking") {
      const trimmed = text.trim();
      const pendingInterruption = classifyPendingFlowInterruption(args.inboundText);
      const isYes = pendingInterruption.type === "clean_confirmation";
      const timezone = safeStr(args.clinicSettings?.timezone, "America/Tegucigalpa");
      const hasNewDateTime = Boolean(parseDateTimeFromMessage(args.inboundText, timezone));
      const conflictWeekdayDay = resolveWeekdayDayNumberDate(normalizeTextForIntent(args.inboundText), timezone).conflict;
      if (isAvailabilityInquiryText(args.inboundText)) {
        return {
          replyText: safeStr(bookingCollected.preferred_date, "").trim()
            ? "__SHOW_AVAILABILITY_FOR_DATE__"
            : "__SHOW_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "booking_change_time",
            nextExpected: "date_time",
            collected: {
              ...bookingCollected,
              confirmed: false,
            },
          },
          debug: {
            intent: "booking_reschedule",
            phase: "BOOKING",
            route: "confirm_stage_availability_alternatives",
          },
        };
      }
      const wantsAnotherTime = /\b(otra hora|ten[eé]s otra hora|tienes otra hora|otro horario|m[aá]s tarde|m[aá]s temprano|cambiar hora|ocupo otra hora|quiero otra hora)\b/i
        .test(trimmed);
      const isNo = pendingInterruption.type === "clean_rejection" || /^(no|cancel|cambiar|otra)\b/i.test(trimmed);
      const hasServiceChange = Boolean(detectService(args.inboundText));
      if (
        pendingInterruption.type === "business_hours_question" ||
        pendingInterruption.type === "pricing_question" ||
        pendingInterruption.type === "service_info_question" ||
        pendingInterruption.type === "location_question"
      ) {
        const infoReply = pendingInterruption.type === "business_hours_question"
          ? (getBusinessHoursReplyForQuestion(args.inboundText, args.clinicSettings) ?? pickRandom(responses.hours))
          : pendingInterruption.type === "location_question"
          ? (safeStr(args.clinicSettings?.address, "").trim()
            ? `Estamos ubicados en: ${safeStr(args.clinicSettings?.address, "").trim()}.`
            : "Claro, te comparto la ubicación por aquí.")
          : pendingInterruption.type === "pricing_question"
          ? "Depende del caso; en consulta te dan el número exacto."
          : "Claro. Te respondo esa consulta, y después seguimos con la confirmación pendiente.";
        return {
          replyText: `${infoReply}\n\nSobre la cita pendiente, ¿querés confirmar ese horario o revisar otro?`,
          statePatch: {
            stage: "CONFIRMING",
            nextExpected: "confirm_booking",
            collected: { ...bookingCollected },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "confirm_booking_interrupted_info" },
        };
      }
      if (pendingInterruption.type === "correction") {
        const parsedCorrection = parseDateTimeFromMessage(args.inboundText, timezone);
        if (parsedCorrection) {
          return {
            replyText: "__CHECK_REQUESTED_AVAILABILITY__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "confirm_booking",
              collected: {
                ...bookingCollected,
                pending_booking: null,
                pending_offered_slot: null,
                preferred_date: parsedCorrection.date,
                preferred_time: parsedCorrection.time,
                confirmed: false,
              },
            },
            debug: { intent: "book_appointment", phase: "BOOKING", route: "confirm_booking_correction_new_datetime" },
          };
        }
        return {
          replyText: "Tenés razón. ¿Qué día y hora querés que revise?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            collected: { ...bookingCollected, confirmed: false, pending_offered_slot: null },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "confirm_booking_correction_ask_datetime" },
        };
      }
      if (conflictWeekdayDay) {
        return {
          replyText: "Quiero confirmar la fecha: ¿te referís a viernes 15 de mayo?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            collected: { ...bookingCollected, confirmed: false },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "confirm_booking_weekday_day_conflict" },
        };
      }
      if (hasNewDateTime || hasServiceChange) {
        const parsed = parseDateTimeFromMessage(args.inboundText, timezone);
        const keepDate = safeStr(bookingCollected.preferred_date, "").trim();
        const keepTime = safeStr(bookingCollected.preferred_time, "").trim();
        const nextDate = parsed?.date ?? keepDate;
        const nextTime = parsed?.time ?? keepTime;
        return {
          replyText: (nextDate && nextTime) ? "__CHECK_REQUESTED_AVAILABILITY__" : "Tenés razón. ¿Qué día y hora querés que revise?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: (nextDate && nextTime) ? "confirm_booking" : "date_time",
            collected: {
              ...bookingCollected,
              pending_booking: null,
              pending_offered_slot: null,
              ...(hasServiceChange ? { service: detectService(args.inboundText) } : {}),
              ...(nextDate ? { preferred_date: nextDate } : {}),
              ...(nextTime ? { preferred_time: nextTime } : {}),
              confirmed: false,
            },
          },
          debug: { intent: "book_appointment", phase: "BOOKING", route: "confirm_booking_new_request_replaces_pending" },
        };
      }

      if (isYes) {
        const serviceLabel = toPatientFacingServiceLabel(
          safeStr(bookingCollected.service, "Revisión dental"),
        );
        const bookingLabel = safeStr(
          bookingCollected.booking_label,
          serviceLabel || safeStr(bookingCollected.service, "Revisión dental"),
        );
        console.log(JSON.stringify({
          event: "booking:confirmed",
          route: "booking_confirmation_yes",
          service: bookingCollected.service ?? null,
          preferred_date: bookingCollected.preferred_date ?? null,
          preferred_time: bookingCollected.preferred_time ?? null,
        }));
        return {
          replyText: "Perfecto, estoy procesando tu reserva ahora mismo.",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "booking_confirmed",
            nextExpected: undefined,
            collected: { ...bookingCollected, confirmed: true },
          },
          toolAction: {
            name: "book_appointment",
            payload: {
              patient_name: resolveAppointmentPatientName(bookingCollected, state),
              appointment_for_relation: bookingCollected.appointment_for_relation || null,
              service: bookingCollected.service,
              reason: bookingCollected.service,
              title: bookingLabel || "Revisión dental",
              appointment_date: bookingCollected.preferred_date,
              appointment_time: bookingCollected.preferred_time,
              channel: args.channel ?? "messenger",
            },
          },
          debug: {
            intent: "booking_confirmed",
            phase: "BOOKED",
            route: "confirmed",
          },
        };
      }

      if (wantsAnotherTime) {
        return {
          replyText: "__SHOW_NEARBY_TIME_ALTERNATIVES__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "booking_change_time",
            nextExpected: "date_time",
            collected: {
              ...bookingCollected,
              awaiting_new_time: true,
              preferred_time_anchor: safeStr(bookingCollected.preferred_time, ""),
              preferred_time: null,
              confirmed: false,
            },
          },
          debug: {
            intent: "booking_reschedule",
            phase: "BOOKING",
            route: "confirm_stage_change_time",
          },
        };
      }

      if (isNo) {
        return {
          replyText: "Claro, ¿querés cambiar el día o la hora?",
          statePatch: {
            stage: "CONFIRMING",
            lastIntent: "booking_reschedule",
            nextExpected: "change_booking_detail",
            collected: {
              ...bookingCollected,
              confirmed: false,
            },
          },
          debug: {
            intent: "booking_cancelled",
            phase: "BOOKING",
            route: "change_time",
          },
        };
      }

      return {
        replyText:
          "Claro. Solo para no confundirme: ¿querés confirmar la cita pendiente o revisar otro horario?",
        statePatch: {
          stage: "CONFIRMING",
          nextExpected: "confirm_booking",
          collected: { ...bookingCollected },
        },
        debug: {
          intent: "booking_confirmed",
          phase: "BOOKING",
          route: "retry_confirm",
        },
      };
    }

    const rememberedService = safeStr(
      bookingCollected.last_discussed_service,
      safeStr(bookingCollected.service, ""),
    ).trim();
    if (!safeStr(bookingCollected.service, "").trim() && wantsSameAsBefore) {
      const fromHistory = safeStr((bookingCollected as any)?.last_appointment_summary?.service, "").trim();
      if (fromHistory) {
        bookingCollected.service = fromHistory;
      }
    }

    if (!llmService && serviceFromMessage) {
      bookingCollected.service = serviceFromMessage;
    } else if (llmService) {
      bookingCollected.service = llmService;
    } else if (!safeStr(bookingCollected.service, "").trim() && rememberedService) {
      bookingCollected.service = rememberedService;
    }
    if (normalizeText(safeStr(bookingCollected.service, "")) === "nuevo servicio") {
      bookingCollected.service = "Revisión dental";
    }
    if (
      safeStr(bookingCollected.service, "").trim() &&
      !isServiceActiveForOrg(args.clinicSettings, safeStr(bookingCollected.service, ""))
    ) {
      return {
        replyText:
          "Ese servicio tendría que confirmarlo recepción directamente, porque no quiero darte información incorrecta.\n\nSi querés, puedo ayudarte con los servicios que sí están disponibles o pasar tu consulta a recepción.",
        statePatch: {
          stage: "SERVICE_INFO",
          lastIntent: "service_info",
          nextExpected: "service",
          collected: { ...bookingCollected },
        },
        debug: { intent: "services", phase: "SERVICE_INFO", route: "inactive_service_guard" },
      };
    }

    if (
      state.nextExpected === "service" &&
      !serviceFromMessage &&
      !safeStr(bookingCollected.service, "").trim()
    ) {
      bookingCollected.service = safeStr(args.inboundText, "").trim();
      if (/nuevo servicio/i.test(safeStr(bookingCollected.service, ""))) {
        bookingCollected.service = "Revisión dental";
      }
    }

    if (!bookingCollected.service) {
      const preferredHours = safeStr((bookingCollected as any)?.preferred_hours, "").trim().toLowerCase();
      const preferenceHint = preferredHours
        ? `\n\nVeo que antes preferiste horarios por la ${preferredHours}. ¿Querés que busque algo parecido o tenés otro horario en mente?`
        : "";
      console.log(JSON.stringify({
        event: "booking:missing_fields",
        missing: ["service"],
      }));
      return {
        replyText: hasCollectedName(state)
          ? `Claro, ${firstName}. ¿Qué tipo de cita necesitás: revisión general, limpieza, ortodoncia, blanqueamiento o alguna molestia dental?${preferenceHint}`
          : `Claro. ¿Qué tipo de cita necesitás: revisión general, limpieza, ortodoncia, blanqueamiento o alguna molestia dental?${preferenceHint}`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "service",
          collected: { ...bookingCollected },
        },
        debug: {
          intent: "book_appointment",
          phase: "BOOKING",
          route: "ask_service",
        },
      };
    }

    const timeOnlyInput = parseTimeOnlyFromMessage(args.inboundText);
    const hasDateSignalInInput =
      /\b(hoy|mañana|pasado mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i
        .test(args.inboundText);
    if (
      timeOnlyInput &&
      !hasDateSignalInInput &&
      !safeStr(bookingCollected.preferred_date, "").trim()
    ) {
      bookingCollected.preferred_time = timeOnlyInput;
      console.log(JSON.stringify({
        event: "availability:missing_date",
        route: "hard_guard_time_without_date",
        preferred_time: timeOnlyInput,
      }));
      return {
        replyText: `Perfecto 👍 ¿Para qué día te gustaría a las ${timeOnlyInput}?`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          collected: { ...bookingCollected },
        },
        debug: {
          intent: "book_appointment",
          phase: "BOOKING",
          route: "ask_date_for_time_only",
        },
      };
    }

    const bookingTimezone = safeStr(
      args.clinicSettings?.timezone,
      "America/Tegucigalpa",
    );
    const parsedIncomingDateTime = parseDateTimeFromMessage(
      args.inboundText,
      bookingTimezone,
    );
    const incomingService = detectService(args.inboundText);
    const hasFreshFullRequest = Boolean(
      parsedIncomingDateTime &&
        (incomingService || /(quiero|necesito|agendar|agenda|cita)\b/i.test(args.inboundText)),
    );
    const hasStaleDateContext = Boolean(
      safeStr(bookingCollected.preferred_date, "").trim() &&
        safeStr(bookingCollected.preferred_time, "").trim(),
    );

    if (parsedIncomingDateTime) {
      const baseClinicDate = getClinicLocalDate(bookingTimezone);
      console.log(JSON.stringify({
        event: "booking:parsed_datetime",
        inboundText: args.inboundText,
        timezone: bookingTimezone,
        baseClinicDate: baseClinicDate.isoDate,
        parsedDate: parsedIncomingDateTime.date,
        parsedTime: parsedIncomingDateTime.time,
        parserSource: "parseDateTimeFromMessage",
        route: "booking_main",
      }));
    }

    if (
      hasFreshFullRequest &&
      (hasStaleDateContext || state.nextExpected === "date_time" || state.nextExpected === "confirm_booking")
    ) {
      const nextService = incomingService || safeStr(bookingCollected.service, "");
      return {
        replyText: "__CHECK_REQUESTED_AVAILABILITY__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "confirm_booking",
          collected: {
            ...bookingCollected,
            ...(nextService ? { service: nextService } : {}),
            preferred_date: parsedIncomingDateTime?.date ?? null,
            preferred_time: parsedIncomingDateTime?.time ?? null,
            pending_booking: null,
            pending_offered_slot: null,
            confirmed: false,
          },
        },
        debug: {
          intent: "book_appointment",
          phase: "BOOKING",
          route: "fresh_full_request_replaces_stale_pending",
        },
      };
    }

    if (!bookingCollected.preferred_date || !bookingCollected.preferred_time) {
      if (safeStr(bookingCollected.service, "").trim() && isAvailabilityInquiryText(args.inboundText)) {
        if (safeStr(bookingCollected.preferred_date, "").trim()) {
          return {
            replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "book_appointment",
              nextExpected: "date_time",
              collected: { ...bookingCollected },
            },
            debug: {
              intent: "book_appointment",
              phase: "BOOKING",
              route: "availability_inquiry_keep_date_context",
            },
          };
        }
        return {
          replyText: "__SHOW_AVAILABILITY__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            collected: { ...bookingCollected },
          },
          debug: {
            intent: "book_appointment",
            phase: "BOOKING",
            route: "availability_inquiry_show_slots",
          },
        };
      }
      const timezone = bookingTimezone;
      const parsedDateTime = parsedIncomingDateTime ?? parseDateTimeFromMessage(args.inboundText, timezone);
      const parsedDateOnly = parseDateOnlyFromMessage(args.inboundText, timezone);
      const repairRuntimeEnabled = isEnabledFlag(args.clinicSettings?.barbershop_interpreter_runtime_enabled);
      const repairRaw = ((args.barbershopInterpreterResult ?? {}) as Record<string, unknown>);
      const repairFieldsRaw = (repairRaw.fields_found && typeof repairRaw.fields_found === "object")
        ? (repairRaw.fields_found as Record<string, unknown>)
        : {};
      const repairConfidence = Number(repairRaw.confidence ?? 0);
      const repairedDateRaw = safeStr(repairFieldsRaw.date, "");
      const repairedDateToken = repairedDateRaw.toLowerCase() === "tomorrow" ? "manana" : repairedDateRaw;
      const repairedDateOnly = repairedDateToken ? parseDateOnlyFromMessage(repairedDateToken, timezone) : null;
      const timeOnly = parseTimeOnlyFromMessage(args.inboundText);
      const selectedFirstOption = isFirstSlotSelectionText(args.inboundText);
      const lastAvailabilitySlots = Array.isArray((bookingCollected as any).last_availability_slots)
        ? ((bookingCollected as any).last_availability_slots as Array<Record<string, unknown>>)
        : [];
      const firstAvailabilitySlot = selectedFirstOption
        ? lastAvailabilitySlots.find((slot) => safeStr(slot?.date, "").trim() && safeStr(slot?.time, "").trim())
        : null;
      const hasRelativeOrExplicitDate =
        /\b(hoy|mañana|pasado mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i
          .test(args.inboundText);
      const hasOnlyTime = Boolean(timeOnly) && !hasRelativeOrExplicitDate;

      console.log(JSON.stringify({
        event: "availability:parse_request",
        inbound_text: args.inboundText,
        parsed_date: parsedDateTime?.date ?? null,
        parsed_time: parsedDateTime?.time ?? timeOnly ?? null,
        has_only_time: hasOnlyTime,
      }));

      if (
        !parsedDateTime &&
        !parsedDateOnly &&
        safeStr(state.nextExpected, "") === "date_time" &&
        repairRuntimeEnabled &&
        Number.isFinite(repairConfidence) &&
        repairConfidence >= 0.65 &&
        repairedDateOnly
      ) {
        console.log(JSON.stringify({
          event: "barbershop:llm_contextual_repair_used",
          inbound_text: args.inboundText ?? null,
          nextExpected: safeStr(state.nextExpected, "") || null,
          repaired_fields: { date: repairedDateOnly },
          confidence: repairConfidence,
        }));
        if (safeStr(bookingCollected.service, "").trim()) {
          console.log(JSON.stringify({
            event: "barbershop:redundant_question_blocked",
            reason: "repaired_date_with_existing_service",
            inbound_text: args.inboundText ?? null,
            last_availability_context: (bookingCollected as any).last_availability_context ?? null,
          }));
          return {
            replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
            statePatch: {
              stage: "BOOKING",
              lastIntent: "availability",
              nextExpected: "availability_slot_selection",
              orgType: "barbershop",
              collected: {
                ...bookingCollected,
                preferred_date: repairedDateOnly,
                availability_request: true,
                pending_booking: null,
                pending_booking_stale: true,
              },
            },
            debug: { intent: "book_appointment", phase: "BOOKING", route: "barbershop_repaired_date_show_availability" },
          };
        }
      }

      if (hasIncompleteTimePhrase(args.inboundText) && parsedDateOnly && !parsedDateTime) {
        const humanDate = formatHumanDay(parsedDateOnly);
        return {
          replyText: `Claro, ¿a qué hora del ${humanDate} te gustaría?`,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            collected: { ...bookingCollected, preferred_date: parsedDateOnly, preferred_time: null },
          },
          debug: {
            intent: "book_appointment",
            phase: "BOOKING",
            route: "ask_missing_time_for_date",
          },
        };
      }

      if (parsedDateTime) {
        bookingCollected.preferred_date = parsedDateTime.date;
        bookingCollected.preferred_time = parsedDateTime.time;
      } else if (firstAvailabilitySlot) {
        bookingCollected.preferred_date = safeStr(firstAvailabilitySlot.date, safeStr(bookingCollected.preferred_date, ""));
        bookingCollected.preferred_time = safeStr(firstAvailabilitySlot.time, safeStr(bookingCollected.preferred_time, ""));
      } else if (parsedDateOnly) {
        bookingCollected.preferred_date = parsedDateOnly;
      } else if (bookingCollected.preferred_date && timeOnly) {
        bookingCollected.preferred_time = timeOnly;
      } else if (!bookingCollected.preferred_date && timeOnly) {
        bookingCollected.preferred_time = timeOnly;
      } else if (bookingCollected.preferred_date && !bookingCollected.preferred_time) {
        return {
          replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            collected: { ...bookingCollected },
          },
          debug: {
            intent: "book_appointment",
            phase: "BOOKING",
            route: "show_date_slots",
          },
        };
      } else if (
        mentionsToday(args.inboundText) &&
        !shouldOfferSameDayFromSettings(args.clinicSettings)
      ) {
        return {
          replyText:
            "Hoy ya no tengo horarios disponibles para agendar por aquí, pero puedo ayudarte con una cita para mañana. ¿Te funciona por la mañana o por la tarde?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            collected: { ...bookingCollected },
          },
          debug: {
            intent: "book_appointment",
            phase: "BOOKING",
            route: "same_day_cutoff_blocked",
          },
        };
      }
    }

    if (!bookingCollected.preferred_date || !bookingCollected.preferred_time) {
      const missingDate = !bookingCollected.preferred_date;
      const missingTime = !bookingCollected.preferred_time;
      if (missingDate) {
        console.log(JSON.stringify({ event: "availability:missing_date" }));
      }
      if (missingTime) {
        console.log(JSON.stringify({ event: "availability:missing_time" }));
      }
      const askText = !missingDate && missingTime
        ? "__SHOW_AVAILABILITY_FOR_DATE__"
        : missingDate && !missingTime
        ? `Perfecto 👍 ¿Para qué día te gustaría a las ${safeStr(bookingCollected.preferred_time, "")}?`
        : `Perfecto. Voy a revisar horarios para ${toPatientFacingServiceLabel(safeStr(bookingCollected.service, "revisión dental")).toLowerCase()}. ¿Tenés algún día u hora que te quede mejor?`;
      return {
        replyText: askText,
        statePatch: {
          stage: "BOOKING",
          nextExpected: "date_time",
          collected: { ...bookingCollected },
        },
        debug: {
          intent: "book_appointment",
          phase: "BOOKING",
          route: "retry_datetime",
        },
      };
    }

    if (!bookingCollected.confirmed) {
      console.log(JSON.stringify({
        event: "booking:ready_to_check_availability",
        service: bookingCollected.service ?? null,
        preferred_date: bookingCollected.preferred_date ?? null,
        preferred_time: bookingCollected.preferred_time ?? null,
      }));
      const dateLabel = formatBookingDate(
        safeStr(bookingCollected.preferred_date, ""),
        safeStr(bookingCollected.preferred_time, ""),
      );
      const serviceLabel = safeStr(bookingCollected.service, "servicio dental");
      console.log(JSON.stringify({
        event: "booking:confirm_prompt",
        service: bookingCollected.service ?? null,
        preferred_date: bookingCollected.preferred_date ?? null,
        preferred_time: bookingCollected.preferred_time ?? null,
      }));

      return {
        replyText: "__CHECK_REQUESTED_AVAILABILITY__",
        statePatch: {
          stage: "CONFIRMING",
          lastIntent: "book_appointment",
          nextExpected: "confirm_booking",
          collected: { ...bookingCollected },
        },
        debug: {
          intent: "book_appointment",
          phase: "BOOKING",
          route: "confirm",
        },
      };
    }
  }

  if (orgType === "dental") {
    const serviceInfo = resolveDentalServiceInfo({
      message: text,
      clinicSettings: args.clinicSettings,
    });
    if (serviceInfo.matched && !hasDeterministicBookingSignal(args.inboundText)) {
      if (serviceInfo.force_booking_flow) {
        const chosenService = toPatientFacingServiceLabel(
          serviceInfo.booking_service || serviceInfo.service.name,
        );
        return {
          replyText: serviceInfo.replyText,
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "date_time",
            collected: {
              ...collected,
              service: chosenService,
              last_discussed_service: chosenService,
            },
          },
          debug: {
            intent: "book_appointment",
            phase: "BOOKING",
            route: "service_info_to_booking",
          },
        };
      }
      const chosenService = toPatientFacingServiceLabel(
        serviceInfo.booking_service || serviceInfo.service.name,
      );
      return {
        replyText: serviceInfo.replyText,
        statePatch: {
          stage: "SERVICE_INFO",
          lastIntent: "service_info",
          nextExpected: "service_info_or_booking",
          collected: {
            ...collected,
            service: chosenService,
            last_discussed_service: chosenService,
          },
        },
        debug: {
          intent: "services",
          phase: "DISCOVERY",
          route: "service_info",
        },
      };
    }
  }

  // P2: High value (pricing, services, booking)
  if (
    (safeStr(state.stage, "") === "BOOKING" || safeStr(state.stage, "") === "CONFIRMING") &&
    ![
      "book_appointment",
      "cancel_appointment",
      "reschedule_appointment",
      "confirmation",
      "denial",
      "unknown",
    ].includes(intent.intent)
  ) {
    const c = (state.collected ?? {}) as Record<string, unknown>;
    const serviceKnown = safeStr(c.service, "");
    if (!serviceKnown) {
      return {
        replyText: "Puedo ayudarte con limpieza, dolor/molestia, brackets, blanqueamiento o revisión dental. ¿Cuál te interesa?",
        statePatch: { stage: "BOOKING", nextExpected: "service", collected: { ...c } },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "booking_lock_service" },
      };
    }
    if (!safeStr(c.preferred_date, "")) {
      return {
        replyText: "Perfecto 👍 ¿Para qué día te gustaría?",
        statePatch: { stage: "BOOKING", nextExpected: "date_time", collected: { ...c } },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "booking_lock_date" },
      };
    }
    if (!safeStr(c.preferred_time, "")) {
      return {
        replyText: "__SHOW_AVAILABILITY_FOR_DATE__",
        statePatch: { stage: "BOOKING", nextExpected: "date_time", collected: { ...c } },
        debug: { intent: "book_appointment", phase: "BOOKING", route: "booking_lock_time" },
      };
    }
  }

  if (isHighValueIntent(intent.intent)) {
    if (intent.intent === "pricing") {
      if (orgType === "dental") {
        const serviceInfo = resolveDentalServiceInfo({
          message: text,
          clinicSettings: args.clinicSettings,
        });
        if (serviceInfo.matched) {
          return {
            replyText: serviceInfo.replyText,
            statePatch: {
              stage: "DISCOVERY",
              lastIntent: "pricing",
            },
            debug: { intent: "pricing", phase: "VALUE", route: "high_value" },
          };
        }
        return {
          replyText:
            "El precio final depende de revisión en clínica. Si querés, te explico opciones o te ayudo a agendar una revisión dental.",
          statePatch: {
            stage: "DISCOVERY",
            lastIntent: "pricing",
          },
          debug: { intent: "pricing", phase: "VALUE", route: "high_value" },
        };
      }
      return {
        replyText: pickRandom(responses.pricing),
        statePatch: {
          stage: "VALUE",
          lastIntent: "pricing",
        },
        debug: { intent: "pricing", phase: "VALUE", route: "high_value" },
      };
    }
    if (intent.intent === "services") {
      if (isMoreInfoWithoutService(args.inboundText)) {
        return {
          replyText:
            "Claro 😊 ¿Buscás información sobre estética, dolor/molestia, limpieza o una revisión general?",
          statePatch: { stage: "DISCOVERY", lastIntent: "services", nextExpected: "service_info_or_booking" },
          debug: { intent: "services", phase: "DISCOVERY", route: "services_guided_categories" },
        };
      }
      return {
        replyText: pickRandom(responses.services),
        statePatch: { stage: "DISCOVERY", lastIntent: "services" },
        debug: { intent: "services", phase: "DISCOVERY", route: "high_value" },
      };
    }
    if (intent.intent === "book_appointment") {
      const resp = orgType === "dental"
        ? responses.bookAppointment
        : responses.demo;
      const existingService = safeStr((collected as any)?.service, "").trim();
      const normalizedService = normalizeText(existingService);
      return {
        replyText: needsName
          ? "¡Claro! Antes de agendar, ¿me compartes tu nombre completo?"
          : existingService
          ? `Perfecto. Voy a revisar horarios para ${toPatientFacingServiceLabel(existingService).toLowerCase()}. ¿Tenés algún día u hora que te quede mejor?`
          : hasCollectedName(state)
          ? `Claro, ${getFirstName(state)}. ¿La cita sería para revisión general, limpieza, dolor/molestia, ortodoncia o algún otro servicio?`
          : pickRandom(resp ?? responses.fallback),
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: existingService ? "date_time" : "service",
          collected: existingService
            ? {
              ...collected,
              service: normalizedService === "nuevo servicio"
                ? "Revisión dental"
                : existingService,
              last_discussed_service: normalizedService === "nuevo servicio"
                ? "Revisión dental"
                : existingService,
            }
            : { ...collected },
        },
        debug: {
          intent: "book_appointment",
          phase: "BOOKING",
          route: "booking",
        },
      };
    }
    if (
      intent.intent === "demo_interest" || intent.intent === "trial_interest"
    ) {
      const resp = intent.intent === "demo_interest"
        ? responses.demo
        : responses.trial;
      return {
        replyText: pickRandom(resp ?? responses.fallback),
        statePatch: { stage: "TRIAL_OFFER", lastIntent: intent.intent },
        debug: {
          intent: intent.intent,
          phase: "TRIAL_OFFER",
          route: "high_value",
        },
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
        statePatch: {
          stage: "TRIAL_OFFER",
          lastIntent: "confirmation",
          collected: { ...collected, confirmed: true },
        },
        debug: {
          intent: "confirmation",
          phase: "TRIAL_OFFER",
          route: "continuation",
        },
      };
    }
    if (intent.intent === "denial") {
      return {
        replyText: "Entendido. Si cambias de opinión, aquí estoy. 👋",
        statePatch: { lastIntent: "denial" },
        debug: {
          intent: "denial",
          phase: state.stage ?? "DISCOVERY",
          route: "soft_close",
        },
      };
    }
  }

  // P4: Other intents
  if (intent.intent === "greeting") {
    if (state.stage === "INITIAL" || !state.lastIntent) {
      const greetingText = orgType === "dental"
        ? buildDentalGreeting(args.clinicSettings)
        : safeStr(pickRandom(responses.greeting), "¡Hola! 👋 ¿En qué te puedo ayudar?");
      return {
        replyText: needsName
          ? "¡Hola! 👋 Bienvenido a la clínica. Antes de ayudarte, ¿me compartes tu nombre completo?"
          : greetingText,
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "greeting",
          nextExpected: orgType === "dental" ? undefined : "business_type",
          orgType,
        },
        debug: { intent: "greeting", phase: "DISCOVERY", route: "initial" },
      };
    }
    return {
      replyText: "¿En qué más te puedo ayudar?",
      statePatch: { lastIntent: "greeting" },
      debug: {
        intent: "greeting",
        phase: state.stage ?? "DISCOVERY",
        route: "skip_repeat",
      },
    };
  }

  if (intent.intent === "hours" && responses.hours) {
    if (orgType === "dental" && isAvailabilityInquiryText(args.inboundText) && !isBusinessHoursQuestionText(args.inboundText)) {
      const explicitServiceFromTurn = detectService(args.inboundText);
      const activeService = safeStr((state.collected as any)?.service, "").trim();
      const keepHistoricalService = /\b(lo mismo de antes|el mismo tratamiento|otra limpieza como la anterior)\b/i
        .test(args.inboundText);
      if (!explicitServiceFromTurn && !activeService && !keepHistoricalService) {
        return {
          replyText: hasCollectedName(state)
            ? `Claro, ${getFirstName(state)}. ¿Qué tipo de cita necesitás: revisión general, limpieza, ortodoncia, blanqueamiento o alguna molestia dental?`
            : "Claro. ¿Qué tipo de cita necesitás: revisión general, limpieza, ortodoncia, blanqueamiento o alguna molestia dental?",
          statePatch: {
            stage: "BOOKING",
            lastIntent: "book_appointment",
            nextExpected: "service",
            collected: { ...(state.collected ?? {}), service: null },
          },
          debug: {
            intent: "book_appointment",
            phase: "BOOKING",
            route: "availability_needs_service_first",
          },
        };
      }
      const chosenService = toPatientFacingServiceLabel(
        safeStr((state.collected as any)?.service, explicitServiceFromTurn ?? "Revisión dental"),
      );
      const serviceForBooking = chosenService || "Revisión dental";
      return {
        replyText: "__SHOW_AVAILABILITY__",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          collected: {
            ...collected,
            service: serviceForBooking,
            last_discussed_service: serviceForBooking,
          },
        },
        debug: {
          intent: "book_appointment",
          phase: "BOOKING",
          route: "availability_over_hours",
        },
      };
    }
    const hoursReply = getBusinessHoursReplyForQuestion(args.inboundText, args.clinicSettings);
    if (hoursReply) {
      return {
        replyText: `${hoursReply} ¿Preferís más información o agendar una revisión dental?`,
        statePatch: { stage: "DISCOVERY", lastIntent: "hours" },
        debug: {
          intent: "hours",
          phase: state.stage ?? "DISCOVERY",
          route: "info_db_hours",
        },
      };
    }
    return {
      replyText: pickRandom(responses.hours),
      statePatch: { stage: "DISCOVERY", lastIntent: "hours" },
      debug: {
        intent: "hours",
        phase: state.stage ?? "DISCOVERY",
        route: "info",
      },
    };
  }

  if (intent.intent === "location" && responses.location) {
    const address = safeStr(args.clinicSettings?.address, "").trim();
    if (address) {
      return {
        replyText:
          `Estamos ubicados en: ${address}. ¿Preferís más información o agendar una revisión dental?`,
        statePatch: { lastIntent: "location" },
        debug: {
          intent: "location",
          phase: state.stage ?? "DISCOVERY",
          route: "info",
        },
      };
    }
    return {
      replyText: pickRandom(responses.location),
      statePatch: { lastIntent: "location" },
      debug: {
        intent: "location",
        phase: state.stage ?? "DISCOVERY",
        route: "info",
      },
    };
  }

  if (intent.intent === "emergency" && responses.emergency) {
    const cleaned = clearActiveBookingState({
      lastIntent: "emergency",
      collected: { ...collected },
    }, { resetLastIntent: false });
    const severe = isSevereEmergencyText(args.inboundText);
    if (severe) {
      return {
        replyText: "Entiendo. Por seguridad, te recomiendo comunicarte de inmediato con la clínica o un servicio de urgencias.",
        statePatch: cleaned,
        debug: { intent: "emergency", phase: "HANDOFF", route: "urgent_severe" },
      };
    }
    return {
      replyText: pickRandom(responses.emergency),
      statePatch: cleaned,
      debug: { intent: "emergency", phase: "HANDOFF", route: "urgent" },
    };
  }

  if (intent.intent === "gratitude") {
    return {
      replyText: "¡Gracias a ti! 😊",
      statePatch: { lastIntent: "gratitude" },
      debug: {
        intent: "gratitude",
        phase: state.stage ?? "DISCOVERY",
        route: "closing",
      },
    };
  }

  if (orgType === "dental") {
    const recoveryContext = buildRecoveryContextFromState(state);
    const shouldTryRecovery = intent.intent === "unknown" || (
      ["confirm_booking", "confirm_reschedule", "active_appointment_choice", "book_appointment"].includes(
        recoveryContext.currentGoal,
      ) && !isCleanConfirmationText(args.inboundText)
    );
    if (shouldTryRecovery) {
      const recovery = orchestrateConversationTurn({
        inboundText: args.inboundText,
        context: recoveryContext,
      });
      if (recovery.handled) {
        const recoveryCollectedPatch = ((recovery.statePatch?.collected ?? {}) as Record<string, unknown>);
        return {
          replyText: recovery.replyText ?? pickRandom(responses.fallback),
          statePatch: {
            stage: state.stage ?? "DISCOVERY",
            lastIntent: "recovery",
            nextExpected: state.nextExpected,
            collected: {
              ...(state.collected ?? {}),
              ...recoveryCollectedPatch,
            },
          },
          debug: {
            intent: "unknown",
            phase: state.stage ?? "DISCOVERY",
            route: `conversation_recovery_${recovery.intent}`,
          },
        };
      }
    }
  }

  // Fallback
  if (state.stage === "INITIAL") {
    const greetingText = orgType === "dental"
      ? buildDentalGreeting(args.clinicSettings)
      : safeStr(pickRandom(responses.greeting), "¡Hola! 👋 ¿En qué te puedo ayudar?");
    return {
      replyText: needsName
        ? "¡Hola! 👋 Gracias por escribirnos. Para ayudarte mejor, ¿me compartes tu nombre completo?"
        : greetingText,
      statePatch: {
        stage: "DISCOVERY",
        lastIntent: "unknown",
        orgType,
        nextExpected: needsName ? "confirm_name" : undefined,
      },
      debug: {
        intent: "unknown",
        phase: "DISCOVERY",
        route: "fallback_greeting",
      },
    };
  }

  if (orgType === "dental" && intent.intent === "unknown") {
    if (
      (safeStr(state.stage, "") === "BOOKING" || safeStr(state.nextExpected, "") === "date_time") &&
      safeStr((collected as any)?.service, "").trim()
    ) {
      return {
        replyText:
          `Te sigo ayudando con la cita para ${toPatientFacingServiceLabel(safeStr((collected as any)?.service, "revisión dental")).toLowerCase()}. ¿Querés ver horarios disponibles o tenés un día específico en mente?`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "book_appointment",
          nextExpected: "date_time",
          collected: { ...collected },
        },
        debug: { intent: "unknown", phase: "BOOKING", route: "booking_context_fallback" },
      };
    }
    if (hasServiceLikeSignal(args.inboundText)) {
      return {
        replyText:
          "Puedo ayudarte con servicios dentales de la clínica. ¿Te referís a limpieza, dolor/molestia, brackets, blanqueamiento o una revisión dental?",
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "service_info",
          nextExpected: "service_info_or_booking",
          collected: { ...collected },
        },
        debug: { intent: "unknown", phase: "DISCOVERY", route: "unknown_service_clarify" },
      };
    }
    return {
      replyText:
        "Por aquí puedo ayudarte con información de la clínica, tratamientos dentales, horarios, ubicación o citas 😊 ¿Querés que te ayude con algo de eso?",
      statePatch: {
        stage: state.stage ?? "DISCOVERY",
        lastIntent: "unknown",
        nextExpected: state.nextExpected,
      },
      debug: { intent: "unknown", phase: state.stage ?? "DISCOVERY", route: "dental_scope_redirect" },
    };
  }

  return {
    replyText: needsName
      ? "Con gusto te ayudo. Antes de continuar, ¿me compartes tu nombre completo?"
      : pickRandom(responses.fallback),
    statePatch: {
      stage: !needsName && orgType === "dental" ? "BOOKING" : state.stage,
      lastIntent: "unknown",
      nextExpected: needsName
        ? "confirm_name"
        : orgType === "dental"
        ? "confirm_booking_suggestion"
        : state.nextExpected,
    },
    debug: {
      intent: "unknown",
      phase: state.stage ?? "DISCOVERY",
      route: "fallback",
    },
  };
}
