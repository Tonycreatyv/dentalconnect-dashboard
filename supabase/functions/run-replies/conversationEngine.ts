/// <reference lib="deno.unstable" />

const YES_TERMS = /(si|sí|claro|perfecto|vale|confirmo|adelante|dale|ok|bueno)/i;
const MENU_TERMS = /(servicio|que hac|informaci[oó]n|automatiza|que ofrecen|que hacen)/i;
const CONFUSION_TERMS = /(qu[eé] vendes|qu[eé] sos|no se qu[eé] (eres|sos)|qu[eé] ofrecen|informaci[oó]n del sistema)/i;
const CHANNEL_TERMS: Record<string, RegExp> = {
  whatsapp: /whatsapp/i,
  messenger: /messenger/i,
  instagram: /instagram|ig/i,
};

type Mode = "creatyv_product" | "dental_clinic";
type Phase = "new" | "ask_pain" | "ask_channel" | "ask_volume" | "offer" | "capture_contact" | "done" | "dental_menu";
type State = {
  mode?: Mode;
  phase?: Phase;
  last_bot_question_key?: string;
  last_bot_text?: string;
  collected?: Record<string, any>;
};

export type EngineInput = {
  organizationId: string;
  leadId: string;
  leadState: State | null;
  inboundText: string;
  channel?: string | null;
};

export type EngineOutput = {
  replyText: string;
  nextStatePatch: Record<string, any>;
  debug?: { phase: string; mode: string; intent?: string };
};

const MODE_OVERRIDES: Record<string, Mode> = {
  "creatyv-product": "creatyv_product",
};

function normalizeText(text: string) {
  return String(text ?? "").trim();
}

function mergeCollected(existing: Record<string, any> = {}, patch: Record<string, any> = {}) {
  return { ...existing, ...patch };
}

function avoidRepeat(reply: string, last?: string) {
  const current = reply.trim();
  if (!last) return current;
  if (current === last.trim()) {
    return `${current} ¿Lo ves así o te gustaría otra opción?`;
  }
  return current;
}

function detectChannelPreference(text: string) {
  const normalized = normalizeText(text);
  for (const [key, regex] of Object.entries(CHANNEL_TERMS)) {
    if (regex.test(normalized)) return key;
  }
  return "unknown";
}

function detectVolumeBucket(text: string) {
  const normalized = normalizeText(text).toLowerCase();
  if (normalized.includes("60")) return "60+";
  if (normalized.includes("20")) return "20-60";
  return "0-20";
}

function respondB2B(phase: Phase, state: State, inbound: string): EngineOutput {
  const collected = mergeCollected(state.collected ?? {});
  const valueLine =
    "Con Creatyv respondemos mensajes, agendamos citas y damos seguimiento automático para que no se pierdan clientes.";
  const greetingGuard = /^\s*(hola|buenas|buenos (d[ií]as|d[ií]as)|buenas tardes|buenas noches|qué tal)\b/i;

  if (phase !== "new" && greetingGuard.test(inbound)) {
    const repeatQuestion = state.last_bot_text || "¿Qué te duele más hoy?";
    return {
      replyText: `${avoidRepeat("¡Dale! Seguimos 😊", repeatQuestion)} ${repeatQuestion}`.trim(),
      nextStatePatch: {
        phase,
        last_bot_text: repeatQuestion,
        last_bot_question_key: state.last_bot_question_key,
        collected,
        mode: "creatyv_product",
      },
      debug: { phase, mode: "creatyv_product", intent: "greeting_guard" },
    };
  }
  switch (phase) {
    case "new":
      return {
        replyText: avoidRepeat(
          "¡Hola! 👋 Soy Jose de Creatyv. Hacemos software para negocios de servicios que responde mensajes, agenda citas y da seguimiento automático para que no se pierdan clientes. Para orientarte rápido: ¿qué tipo de negocio tenés?",
          state.last_bot_text
        ),
        nextStatePatch: {
          phase: "ask_pain",
          last_bot_question_key: "ask_business",
          last_bot_text: "¿qué tipo de negocio tenés?",
          collected,
          mode: "creatyv_product",
        },
        debug: { phase: "ask_pain", mode: "creatyv_product" },
      };
    case "ask_pain":
      if (CONFUSION_TERMS.test(inbound) || MENU_TERMS.test(inbound)) {
        const menu = "Te explico rápido lo que hacemos:\n1) Responder mensajes (WhatsApp/Messenger/IG)\n2) Agendar citas y recordatorios\n3) Seguimiento automático y panel de leads\n¿Qué te interesa más hoy: 1, 2 o 3?";
        return {
          replyText: avoidRepeat(`${valueLine} ${menu}`, state.last_bot_text),
          nextStatePatch: {
            phase: "ask_pain",
            last_bot_question_key: "menu_interest",
            last_bot_text: menu,
            collected,
            mode: "creatyv_product",
          },
          debug: { phase: "ask_pain", mode: "creatyv_product", intent: "menu" },
        };
      }
      const painQuestion = "Perfecto. ¿Qué te duele más hoy? 1) Te escriben y no respondés a tiempo 2) No te escriben suficiente 3) La agenda es un desorden 4) Se te van los seguimientos";
      return {
        replyText: avoidRepeat(`${valueLine} ${painQuestion}`, state.last_bot_text),
        nextStatePatch: {
          phase: "ask_channel",
          last_bot_question_key: "ask_pain",
          last_bot_text: "¿Qué te duele más hoy?",
          collected,
          mode: "creatyv_product",
        },
        debug: { phase: "ask_channel", mode: "creatyv_product" },
      };
    case "ask_channel":
      collected.channel_pref = detectChannelPreference(inbound);
      return {
        replyText: avoidRepeat(`${valueLine} ¿Por dónde te entran más mensajes ahora: WhatsApp, Messenger o Instagram?`, state.last_bot_text),
        nextStatePatch: {
          phase: "ask_volume",
          last_bot_question_key: "ask_channel",
          last_bot_text: "¿Por dónde te entran más mensajes ahora?",
          collected,
          mode: "creatyv_product",
        },
        debug: { phase: "ask_volume", mode: "creatyv_product" },
      };
    case "ask_volume":
      collected.volume_bucket = detectVolumeBucket(inbound);
      return {
        replyText: avoidRepeat(`${valueLine} Aprox. ¿cuántos mensajes reciben al día? 0–20 / 20–60 / 60+`, state.last_bot_text),
        nextStatePatch: {
          phase: "offer",
          last_bot_question_key: "ask_volume",
          last_bot_text: "¿Cuántos mensajes reciben al día?",
          collected,
          mode: "creatyv_product",
        },
        debug: { phase: "offer", mode: "creatyv_product" },
      };
    case "offer":
      return {
        replyText: avoidRepeat(
          `${valueLine} Listo. Con eso ya sé qué recomendarte. Podemos dejarte respuestas automáticas + agenda + followups y todo queda organizado. ¿Querés que te arme una demo? (sí/no)`,
          state.last_bot_text
        ),
        nextStatePatch: {
          phase: "capture_contact",
          last_bot_question_key: "offer_demo",
          last_bot_text: "¿Querés que te arme una demo?",
          collected,
          mode: "creatyv_product",
        },
        debug: { phase: "capture_contact", mode: "creatyv_product" },
      };
    case "capture_contact":
      if (YES_TERMS.test(inbound)) {
        return {
          replyText: avoidRepeat(
            "Excelente ✅ Pasame: 1) Nombre del negocio 2) Tu nombre 3) Tu WhatsApp y te dejo el demo listo.",
            state.last_bot_text
          ),
        nextStatePatch: {
          phase: "done",
          last_bot_question_key: "capture_contact",
          last_bot_text: "Pasame el nombre del negocio...",
          collected,
          mode: "creatyv_product",
        },
          debug: { phase: "done", mode: "creatyv_product" },
        };
      }
      return {
        replyText: avoidRepeat(
          "Perfecto. Decime qué te gustaría lograr (más citas, responder rápido o seguimiento) y te digo la mejor opción.",
          state.last_bot_text
        ),
        nextStatePatch: {
          phase: "ask_pain",
          last_bot_question_key: "reopen_goal",
          last_bot_text: "Decime qué te gustaría lograr...",
          collected,
          mode: "creatyv_product",
        },
        debug: { phase: "ask_pain", mode: "creatyv_product" },
      };
    default:
      return {
        replyText: avoidRepeat(
          "Perfecto. ¿Querés que te arme un demo o lo armamos juntos en vivo?",
          state.last_bot_text
        ),
        nextStatePatch: {
          phase: "offer",
          last_bot_question_key: "offer_demo",
          last_bot_text: "¿Querés que te arme un demo?",
          collected,
          mode: "creatyv_product",
        },
        debug: { phase: "offer", mode: "creatyv_product" },
      };
  }
}

function buildDentalFlow(state: State, inbound: string): EngineOutput {
  const collected = mergeCollected(state.collected ?? {});
  const phase = mapPhase(state.phase);
  switch (phase) {
    case "new":
      return {
        replyText: avoidRepeat(
          "Hola 👋 Bienvenido/a a la clínica. ¿Te gustaría: 1) agendar cita, 2) horarios/ubicación o 3) info de tratamientos?",
          state.last_bot_text
        ),
        nextStatePatch: {
          phase: "ask_pain",
          last_bot_question_key: "dental_menu",
          last_bot_text: "¿Te gustaría: 1) agendar cita...?",
          collected,
          mode: "dental_clinic",
        },
        debug: { phase: "ask_pain", mode: "dental_clinic" },
      };
    default:
      return {
        replyText: avoidRepeat(
          "Listo, pasame el día y horario que preferís y te confirmo si hay cupo.",
          state.last_bot_text
        ),
        nextStatePatch: {
          phase: "offer",
          last_bot_question_key: "dental_standard",
          last_bot_text: "Listo, pasame el día y horario...",
          collected,
          mode: "dental_clinic",
        },
        debug: { phase: "offer", mode: "dental_clinic" },
      };
  }
}

function mapPhase(input?: Phase): Phase {
  if (!input) return "new";
  return input;
}

function resolveMode(input: EngineInput) {
  if (input.leadState?.mode) return input.leadState.mode;
  return MODE_OVERRIDES[input.organizationId] ?? "dental_clinic";
}

export function runConversationEngine(input: EngineInput): EngineOutput {
  const inbound = normalizeText(input.inboundText);
  const state = input.leadState ?? {};
  const mode = resolveMode(input);
  if (mode === "creatyv_product") {
    return respondB2B(mapPhase(state.phase), state, inbound);
  }
  return buildDentalFlow(state, inbound);
}
