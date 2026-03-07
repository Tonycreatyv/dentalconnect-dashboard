/// <reference lib="deno.unstable" />

export const CX2_GREETING = "[CX2]\nHola 👋\nSoy Creatyv.\n¿Qué tipo de negocio tienes?";

type Phase = "new" | "ask_business_type" | "ask_channel" | "ask_pain" | "offer_explanation";
type State = {
  mode?: string;
  phase?: Phase;
  last_bot_text?: string;
  last_bot_question_key?: string;
};

export type EngineInput = {
  organizationId: string;
  leadState: State | null;
  inboundText: string;
};

export type EngineOutput = {
  replyText: string;
  nextStatePatch: Record<string, unknown>;
  debug: { phase: Phase; intent?: string };
};

const GREETING_RE = /^(hola|hey|buenas|buenos días|buen día|qué tal)/i;
const CHANNEL_RE = /(whatsapp|messenger|instagram)/i;

type Intent =
  | "GREETING"
  | "NO_BUSINESS"
  | "BUSINESS_TYPE"
  | "ASKS_PRODUCT_DEFINITION"
  | "ASKS_CAPABILITIES"
  | "ASKS_PRICE"
  | "ASKS_INDUSTRY_FIT"
  | "CONFUSED"
  | "NOT_SURE"
  | "POSITIVE"
  | "NEGATIVE"
  | "ASKS_HUMAN"
  | "CHANNEL_MENTION"
  | "SMALL_TALK"
  | "UNKNOWN";

function norm(text: string) {
  return (text ?? "").trim().toLowerCase();
}

function hasAny(text: string, patterns: string[]) {
  const t = norm(text);
  return patterns.some((pattern) => t.includes(pattern));
}

function detectIntent(inboundText: string): Intent {
  const t = norm(inboundText);
  if (["hola", "holaa", "hey", "buenas", "hello"].includes(t)) return "GREETING";
  if (hasAny(t, ["no tengo negocio", "no tengo empresa", "soy empleado", "no vendo nada"])) return "NO_BUSINESS";
  if (hasAny(t, ["dentista", "clinica", "clínica", "barberia", "barbería", "bienes raíces", "real estate", "joyeria", "joyería", "taller", "spa", "med spa"])) return "BUSINESS_TYPE";
  if (hasAny(t, ["que haces", "qué haces", "qué vendes", "que vendes", "de que se trata", "de qué se trata", "como me ayudas"])) return "ASKS_PRODUCT_DEFINITION";
  if (hasAny(t, ["que mas hace", "qué más hace", "que puede hacer", "qué puede hacer", "que incluye"])) return "ASKS_CAPABILITIES";
  if (hasAny(t, ["precio", "precios", "cuanto cuesta", "cuánto cuesta"])) return "ASKS_PRICE";
  if (hasAny(t, ["tambien tengo", "también tengo", "otro negocio", "aplica para"])) return "ASKS_INDUSTRY_FIT";
  if (hasAny(t, ["no se", "no sé", "todavia no lo se", "todavía no lo sé"])) return "NOT_SURE";
  if (hasAny(t, ["no entendi", "no entendí", "explicame mejor"])) return "CONFUSED";
  if (["si", "sí", "ok", "claro", "dale"].includes(t)) return "POSITIVE";
  if (["no", "nop", "no gracias"].includes(t)) return "NEGATIVE";
  if (hasAny(t, ["humano", "persona", "asesor"])) return "ASKS_HUMAN";
  if (hasAny(t, ["whatsapp", "messenger", "instagram"])) return "CHANNEL_MENTION";
  if (hasAny(t, ["gracias", "muy bien", "genial", "qué tal"])) return "SMALL_TALK";
  return "UNKNOWN";
}

function normalize(text: string) {
  return String(text ?? "").trim();
}

function avoidRepeat(reply: string, last: string) {
  if (!last) return reply;
  if (reply.trim() === last.trim()) {
    return `${reply} ¿Te sirve esta opción?`;
  }
  return reply;
}

function buildIntentResponse(reply: string, currentPhase: Phase, nextPhase: Phase | null, questionKey: string, lastBotText: string, intent: string) {
  const replyText = avoidRepeat(reply, lastBotText);
  return {
    replyText,
    nextStatePatch: {
      phase: nextPhase ?? currentPhase,
      last_bot_question_key: questionKey,
      last_bot_text: replyText,
      mode: "creatyv_product",
    },
    debug: { phase: nextPhase ?? currentPhase, intent },
  };
}

function decideNextAction(intent: Intent, state: State | null) {
  const phase = state?.phase ?? "new";
  switch (intent) {
    case "GREETING":
      return {
        replyText: `Hola 👋\nSoy Creatyv.\n\nAyudamos a negocios a responder mensajes automáticamente, organizar citas o leads y hacer seguimiento para que no se pierdan clientes.\n\n¿Qué tipo de negocio tienes?`,
        nextPhase: "ask_business_type" as Phase,
      };
    case "NO_BUSINESS":
      return {
        replyText: `Entiendo.\n\nCreatyv está pensado para negocios o personas que manejan clientes, pedidos, citas o consultas y quieren automatizar mensajes, organizar contactos y dar seguimiento.\n\nPuede servir tanto para una clínica como para alguien que vende por WhatsApp o Instagram.\n\n¿En tu caso manejas clientes, pedidos o consultas por mensaje?`,
        nextPhase: "ask_business_type" as Phase,
      };
    case "ASKS_PRODUCT_DEFINITION":
      return {
        replyText: `Creatyv es un sistema para negocios que ayuda a responder mensajes, organizar leads o citas y hacer seguimiento automático.\n\nLa idea es que no se te vayan oportunidades por responder tarde o por no dar seguimiento.\n\n¿Qué tipo de negocio tienes?`,
        nextPhase: "ask_business_type" as Phase,
      };
    case "ASKS_CAPABILITIES":
      return {
        replyText: `Además de responder mensajes, también puede:\n\n• organizar leads o citas\n• hacer seguimiento automático\n• mantener conversaciones más ordenadas\n• ayudarte a que no se te vayan oportunidades por falta de respuesta\n\nSi quieres, te explico cómo se usaría específicamente en tu negocio.`,
        nextPhase: phase,
      };
    case "ASKS_PRICE":
      return {
        replyText: `El precio depende más que todo de cómo se usaría en tu negocio y qué parte quieres automatizar primero.\n\nSi me dices qué tipo de negocio tienes, te orientó mejor.`,
        nextPhase: "ask_business_type" as Phase,
      };
    case "NEGATIVE":
      return {
        replyText: `Está bien.\n\nSi quieres, puedo explicarte rápidamente para qué tipo de negocios suele funcionar mejor.`,
        nextPhase: phase,
      };
    case "NOT_SURE":
    case "CONFUSED":
      return {
        replyText: `No pasa nada.\n\nNormalmente lo usan para 3 cosas:\n\n• responder más rápido\n• organizar clientes o citas\n• no perder seguimiento\n\n¿Cuál de esas crees que te ayudaría más hoy?`,
        nextPhase: "ask_pain" as Phase,
      };
    case "ASKS_INDUSTRY_FIT":
      return {
        replyText: `Perfecto, también aplica para ese tipo de negocio.\n\nAhí sirve para responder leads, organizarlos mejor y hacer seguimiento automático para que no se enfríen.\n\n¿En tu caso te interesa más responder más rápido o dar mejor seguimiento?`,
        nextPhase: "ask_pain" as Phase,
      };
    case "BUSINESS_TYPE":
      return {
        replyText: `Perfecto.\n\nEn negocios como el tuyo, normalmente el problema está en una de estas tres cosas: responder tarde, perder seguimiento o tener los leads desordenados.\n\n¿Qué te gustaría resolver primero?`,
        nextPhase: "ask_pain" as Phase,
      };
    default:
      return {
        replyText: phase === "ask_business_type"
          ? "Cuéntame, ¿qué tipo de negocio tienes?"
          : "Perfecto. ¿Qué tipo de negocio tienes?",
        nextPhase: "ask_business_type" as Phase,
      };
  }
}

export function runConversationEngine(input: EngineInput): EngineOutput | null {
  if (input.organizationId !== "creatyv-product") return null;

  const phase = (input.leadState?.phase as Phase) ?? "new";
  const lastBotText = normalize(input.leadState?.last_bot_text ?? "");
  const inbound = normalize(input.inboundText);

  if (!inbound && phase !== "new") return null;

  if (phase !== "new" && GREETING_RE.test(inbound)) {
    const currentQuestion = {
      ask_business_type: "¿Qué tipo de negocio tenés?",
      ask_channel: "¿Tu negocio atiende clientes por WhatsApp, Messenger o Instagram?",
      ask_pain: "¿Qué te gustaría resolver primero?",
      offer_explanation: "¿Querés que te explique cómo se vería aplicado en tu negocio?",
    }[phase] ?? "¿Qué tipo de negocio tenés?";
    const reply = avoidRepeat(`Hola de nuevo 👋 seguimos. ${currentQuestion}`, lastBotText);
    return {
      replyText: reply,
      nextStatePatch: {
        phase,
        last_bot_text: reply,
        last_bot_question_key: input.leadState?.last_bot_question_key ?? "",
        mode: "creatyv_product",
      },
      debug: { phase, intent: "greeting_repeat" },
    };
  }

  const lowerInbound = inbound.toLowerCase();
  const intent = detectIntent(lowerInbound);
  const action = decideNextAction(intent, input.leadState);
  const replyText = avoidRepeat(action.replyText, lastBotText);
  return {
    replyText,
    nextStatePatch: {
      phase: action.nextPhase,
      last_bot_text: replyText,
      last_bot_question_key: intent.toLowerCase(),
      mode: "creatyv_product",
    },
    debug: { phase: action.nextPhase, intent },
  };

  return null;
}
