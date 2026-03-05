/// <reference lib="deno.unstable" />

const TESTDENTAL_TAG = /#testdental/gi;

type Json = Record<string, unknown>;

export type ConversationMode = "creatyv_product" | "dental_clinic";
export type ConversationPhase = "new" | "awaiting_need" | "qualifying" | "closing" | "handoff";
export type ConversationIntent =
  | "pricing"
  | "setup"
  | "channels"
  | "no_leads"
  | "slow_response"
  | "book_demo"
  | "support"
  | "other";

interface ConversationState {
  phase: ConversationPhase;
  mode?: ConversationMode;
  mode_locked?: boolean;
  last_seen_inbound_provider_mid?: string | null;
  last_seen_inbound_mid?: string | null;
  last_bot_question?: string | null;
  last_bot_question_repeat_count?: number;
  slots?: Json;
  [key: string]: unknown;
}

export interface ConversationResult {
  reply: string;
  intent: ConversationIntent;
  questionTag: string;
  phase: ConversationPhase;
  slotsPatch: Json;
  statePatch: Json;
  debug: string;
}

const PHASE_ORDER: ConversationPhase[] = ["new", "awaiting_need", "qualifying", "closing", "handoff"];

const INTENT_KEYWORDS: Record<ConversationIntent, string[]> = {
  pricing: ["precio", "cost", "tarifa", "valor"],
  setup: ["configur", "setup", "instal", "activar"],
  channels: ["mensaj", "whatsapp", "messenger", "instagram", "ig", "canal"],
  no_leads: ["nunca", "sin", "ningun", "perdido", "no entran"],
  slow_response: ["tardo", "demora", "espera", "lento"],
  book_demo: ["demo", "prueba", "trial", "mostrar"],
  support: ["ayuda", "problema", "error", "falla", "support"],
  other: [],
};

const B2B_TEMPLATE: Record<ConversationIntent, { empathy: string; diagnose: string; value: string; cta: string }> = {
  pricing: {
    empathy: "Entiendo que querés pegarle fuerte a los números.",
    diagnose: "Necesito saber cuántos mensajes les llegan para preparar el plan justo.",
    value: "Con DentalConnect podés automatizar esos chats mientras seguís brindando atención humana.",
    cta: "¿Te parece bien agendar un demo hoy para revisar el Trial?",
  },
  setup: {
    empathy: "Sé que poner todo en marcha tiene sus dudas.",
    diagnose: "Contame qué herramientas usan y cómo se conecta su Messenger hoy.",
    value: "Nuestro Trial trae la integración lista y un onboarding guiado.",
    cta: "¿Querés que lo activemos ahora y te muestro el paso a paso?",
  },
  channels: {
    empathy: "Veo que están distribuyendo mensajes por varios canales.",
    diagnose: "¿Qué canal les genera más consultas hoy?",
    value: "Podemos capturar Messenger, WhatsApp e IG con un solo flujo.",
    cta: "¿Les sirve coordinar un demo rápido para ver la automatización?",
  },
  no_leads: {
    empathy: "Es frustrante no tener suficiente flujo de leads.",
    diagnose: "Compartime qué campañas están corriendo ahora.",
    value: "Puedo preparar un embudo con ads click-to-message y guardarlo en el Trial.",
    cta: "¿Lo armamos juntos hoy?",
  },
  slow_response: {
    empathy: "Comprendo lo urgente que es responder rápido.",
    diagnose: "¿Cuánto tardan en contestar un mensaje hoy?",
    value: "DentalConnect responde en segundos y notifica al equipo.",
    cta: "¿Activamos el Trial y lo probamos con un chat real?",
  },
  book_demo: {
    empathy: "Genial que estés listo para ver cómo funciona.",
    diagnose: "¿Querés enfocarte en un caso real o arrancamos con una demo general?",
    value: "La demo te muestra el flujo completo en 20 minutos.",
    cta: "¿Agendamos esa demo?",
  },
  support: {
    empathy: "Lamento el problema que estás viendo.",
    diagnose: "Contame qué parte no está funcionando en este momento.",
    value: "Lo resolvemos y te dejo el Trial listo para seguir conectando Messenger.",
    cta: "¿Te sirve que coordine una llamada corta?",
  },
  other: {
    empathy: "Gracias por escribirme.",
    diagnose: "¿Querés que te cuente cómo arranca el Trial hoy?",
    value: "Con DentalConnect automatizás la recepción y no perdés nada.",
    cta: "¿Te gustaría que te comparta un link para activarlo?",
  },
};

const DENTAL_TEMPLATE = {
  empathy: "¡Hola! Qué alegría recibir tu mensaje.",
  diagnose: "Contame qué servicio necesitás y para cuándo.",
  value: "Si te sirve, te paso los horarios disponibles ahora mismo.",
  cta: "¿Querés que te reserve un turno?",
};

const INTENT_PHASE: Record<ConversationIntent, ConversationPhase> = {
  pricing: "qualifying",
  setup: "qualifying",
  channels: "awaiting_need",
  no_leads: "awaiting_need",
  slow_response: "awaiting_need",
  book_demo: "closing",
  support: "closing",
  other: "awaiting_need",
};

function safeStr(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export function stripTestDentalTag(input: string) {
  return safeStr(input, "").replace(TESTDENTAL_TAG, "").trim();
}

export function ensureConversationState(state: any): ConversationState {
  const initial: ConversationState = {
    phase: "new",
    mode: undefined,
    mode_locked: false,
    last_bot_question: null,
    last_bot_question_repeat_count: 0,
    slots: state?.slots && typeof state.slots === "object" ? { ...state.slots } : {},
    last_seen_inbound_provider_mid: state?.last_seen_inbound_provider_mid ?? null,
    last_seen_inbound_mid: state?.last_seen_inbound_mid ?? null,
    ...state,
  };
  const phase = safeStr(initial.phase, "");
  initial.phase = PHASE_ORDER.includes(phase as ConversationPhase) ? (phase as ConversationPhase) : "new";
  if (typeof initial.mode_locked !== "boolean") initial.mode_locked = false;
  initial.last_bot_question_repeat_count = Number(initial.last_bot_question_repeat_count ?? 0);
  initial.slots = initial.slots ?? {};
  return initial;
}

export function resolveMode(args: {
  organizationId: string;
  leadState: ConversationState;
  orgBusinessType?: string;
  hasTestDentalTag?: boolean;
}): ConversationMode {
  const normalizedBusiness = safeStr(args.orgBusinessType, "").toLowerCase();
  if (normalizedBusiness === "dental" || normalizedBusiness === "clinic") return "dental_clinic";
  if (args.organizationId === "clinic-demo") return "dental_clinic";
  const existing = args.leadState.mode;
  if (existing === "creatyv_product" || existing === "dental_clinic") return existing;
  if (!args.leadState.mode_locked && args.organizationId === "creatyv-product" && args.hasTestDentalTag) {
    return "dental_clinic";
  }
  if (args.organizationId === "creatyv-product") return "creatyv_product";
  return "dental_clinic";
}

export function determineIntent(text: string): ConversationIntent {
  const normalized = safeStr(text, "").toLowerCase();
  for (const intent of Object.keys(INTENT_KEYWORDS) as ConversationIntent[]) {
    const keywords = INTENT_KEYWORDS[intent];
    if (keywords.some((w) => normalized.includes(w))) return intent;
  }
  return "other";
}

function nextPhase(current: ConversationPhase, intent: ConversationIntent): ConversationPhase {
  const desired = INTENT_PHASE[intent] ?? "awaiting_need";
  const currentIndex = PHASE_ORDER.indexOf(current);
  const desiredIndex = PHASE_ORDER.indexOf(desired);
  return PHASE_ORDER[Math.max(currentIndex, Math.min(desiredIndex, PHASE_ORDER.length - 1))];
}

function composeB2BReply(intent: ConversationIntent): string {
  const template = B2B_TEMPLATE[intent] || B2B_TEMPLATE.other;
  return `${template.empathy} ${template.diagnose} ${template.value} ${template.cta}`;
}

function composeDentalReply(): string {
  return `${DENTAL_TEMPLATE.empathy} ${DENTAL_TEMPLATE.diagnose} ${DENTAL_TEMPLATE.value} ${DENTAL_TEMPLATE.cta}`;
}

export function buildConversationReply(args: {
  mode: ConversationMode;
  inboundText: string;
  leadState: ConversationState;
  previousQuestionTag?: string;
  intentOverride?: ConversationIntent;
}): ConversationResult {
  const intent = args.intentOverride || determineIntent(args.inboundText);
  const phase = nextPhase(args.leadState.phase, intent);
  const questionTag = `ask_${intent}`;
  let reply = args.mode === "creatyv_product" ? composeB2BReply(intent) : composeDentalReply();
  if (args.mode === "creatyv_product" && intent === "other" && args.leadState.phase === "new") {
    reply = "Hola 👋 ¿En qué te puedo ayudar hoy?";
  }
  return {
    reply: reply.trim(),
    intent,
    questionTag,
    phase,
    slotsPatch: {},
    statePatch: { phase },
    debug: `engine:${args.mode}:${intent}`,
  };
}

export const SQL_DEBUG_CHECKLIST = `-- SQL Diagnostics
-- Stuck processing jobs older than TTL
-- SELECT id, status, locked_at FROM reply_outbox WHERE status='processing' AND locked_at < now() - interval '1 minute';
-- Recent queued jobs
-- SELECT id, organization_id, lead_id, status, last_error FROM reply_outbox WHERE organization_id='creatyv-product' ORDER BY created_at DESC LIMIT 20;
-- Dead jobs summary
-- SELECT status, COUNT(*) FROM reply_outbox GROUP BY status ORDER BY status;
`;
