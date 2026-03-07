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
const INTENT_NO_BUSINESS = /(no tengo negocio|no tengo empresa|todaví?a no tengo negocio|soy empleado|no vendo nada)/i;
const INTENT_BUSINESS_TYPE = /(dentista|barber[ií]a|cl[ií]nica|real estate|bienes ra[ií]ces|est[eé]tica|spa|taller)/i;
const INTENT_PRODUCT_DEFINITION = /(qu[eé] haces|qu[eé] vendes|de qu[eé] se trata|c[oó]mo me ayud[áa])/i;
const INTENT_CAPABILITIES = /(qu[eé] m[aá]s hace|qu[eé] puede hacer|qu[eé] incluye)/i;
const INTENT_CONFUSED = /(no s[eé]|todav[ií]a no lo s[eé]|no entend[ií]|expl[ií]came mejor)/i;
const INTENT_NEGATIVE = /^(no|nop|no gracias)$/i;
const INTENT_ASKS_PRICE = /(precio|precios|cuanto cuesta|cu[aá]nto cuesta)/i;
const INTENT_ASKS_INDUSTRY_FIT = /(tamb[ií]en tengo|tambien tengo|bienes ra[ií]ces|real estate|otro negocio|tamb[ií]en aplica|tambien aplica)/i;
const INTENT_ASKS_HUMAN = /(hablar con|con un humano|con alguien)/i;
const INTENT_SMALL_TALK = /(gracias|muy bien|genial|qué tal)/i;
const INTENT_POSITIVE = /(si|sí|claro|perfecto|vale|gracias)/i;

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
  | "SMALL_TALK"
  | "UNKNOWN";

function detectIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (GREETING_RE.test(t)) return "GREETING";
  if (INTENT_NO_BUSINESS.test(t)) return "NO_BUSINESS";
  if (INTENT_ASKS_PRODUCT_DEFINITION.test(t)) return "ASKS_PRODUCT_DEFINITION";
  if (INTENT_CAPABILITIES.test(t)) return "ASKS_CAPABILITIES";
  if (INTENT_ASKS_PRICE.test(t)) return "ASKS_PRICE";
  if (INTENT_ASKS_INDUSTRY_FIT.test(t)) return "ASKS_INDUSTRY_FIT";
  if (INTENT_CONFUSED.test(t)) return "CONFUSED";
  if (/tod[áa]v[ií]a no lo sé/.test(t) || INTENT_CONFUSED.test(t)) return "NOT_SURE";
  if (INTENT_NEGATIVE.test(t)) return "NEGATIVE";
  if (INTENT_BUSINESS_TYPE.test(t)) return "BUSINESS_TYPE";
  if (INTENT_ASKS_HUMAN.test(t)) return "ASKS_HUMAN";
  if (INTENT_SMALL_TALK.test(t)) return "SMALL_TALK";
  if (INTENT_POSITIVE.test(t)) return "POSITIVE";
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
  if (intent === "NO_BUSINESS") {
    const reply = "Entiendo.\n\nCreatyv está pensado sobre todo para negocios que quieren responder mensajes, organizar clientes o automatizar seguimiento.\n\nSi quieres, te puedo explicar rápido en qué tipo de negocios suele funcionar mejor.";
    return buildIntentResponse(reply, phase, phase, "no_business", lastBotText, "no_business");
  }
  if (intent === "ASKS_PRODUCT_DEFINITION") {
    const reply = "Creatyv es un sistema para negocios que ayuda a responder mensajes, organizar leads o citas y hacer seguimiento automático.\n\nLa idea es que no se te vayan oportunidades por responder tarde o por no dar seguimiento.\n\n¿Qué tipo de negocio tenés?";
    return buildIntentResponse(reply, phase, "ask_business_type", "product_definition", lastBotText, "asks_product_definition");
  }
  if (intent === "ASKS_CAPABILITIES") {
    const reply = "Además de responder mensajes, también puede:\n\n• organizar leads o citas\n• hacer seguimiento automático\n• mantener conversaciones más ordenadas\n• ayudarte a que no se te vayan oportunidades por falta de respuesta\n\nSi quieres, te explico cómo se usaría específicamente en tu caso.";
    return buildIntentResponse(reply, phase, phase, "capabilities", lastBotText, "asks_capabilities");
  }
  if (intent === "CONFUSED" || intent === "NOT_SURE") {
    const reply = "No pasa nada.\n\nTe lo resumo simple: normalmente lo usan para responder más rápido, ordenar clientes o no perder seguimiento.\n\n¿Cuál de esas crees que te ayudaría más hoy?";
    return buildIntentResponse(reply, phase, phase, "confused", lastBotText, "confused");
  }
  if (intent === "NEGATIVE") {
    const reply = "Está bien.\n\nSi quieres, te lo puedo resumir en una sola frase o explicarte rápido para qué tipo de negocio sirve.";
    return buildIntentResponse(reply, phase, phase, "negative", lastBotText, "negative");
  }
  if (intent === "ASKS_PRICE") {
    const reply = "El precio depende más que todo de cómo se usaría en tu negocio y qué parte quieres automatizar primero.\n\nSi me dices qué tipo de negocio tenés, te oriento mejor.";
    return buildIntentResponse(reply, phase, phase, "pricing", lastBotText, "asks_pricing");
  }
  if (intent === "ASKS_INDUSTRY_FIT") {
    const reply = "Perfecto, también aplica para ese tipo de negocio.\n\nAhí sirve para responder leads, organizarlos mejor y hacer seguimiento automático para que no se enfríen.\n\n¿En tu caso te interesa más responder más rápido o dar mejor seguimiento?";
    return buildIntentResponse(reply, phase, "ask_pain", "industry_fit", lastBotText, "asks_industry_fit");
  }
  if (intent === "BUSINESS_TYPE") {
    const reply = "Perfecto.\n\nEn negocios como el tuyo, normalmente el problema está en una de estas tres cosas: responder tarde, perder seguimiento o tener los leads desordenados.\n\n¿Qué te gustaría resolver primero?";
    return buildIntentResponse(reply, phase, "ask_pain", "business_type", lastBotText, "business_type");
  }

  if (phase === "new") {
    const reply = CX2_GREETING;
    return {
      replyText: reply,
      nextStatePatch: {
        phase: "ask_business_type",
        last_bot_question_key: "ask_business_type",
        last_bot_text: reply,
        mode: "creatyv_product",
      },
      debug: { phase: "ask_business_type" },
    };
  }


  if (phase === "ask_business_type" && inbound) {
    const reply = "Perfecto.\n\nEn negocios como el tuyo, normalmente el problema está en una de estas tres cosas: responder tarde, perder seguimiento o tener los leads desordenados.\n\n¿Qué te gustaría resolver primero?";
    const replyText = avoidRepeat(reply, lastBotText);
    return {
      replyText,
      nextStatePatch: {
        phase: "ask_pain",
        last_bot_question_key: "ask_pain",
        last_bot_text: replyText,
        mode: "creatyv_product",
      },
      debug: { phase: "ask_pain" },
    };
  }

  if (phase === "ask_pain" && inbound) {
    const reply = "Entiendo.\n\nJusto ahí es donde Creatyv ayuda más: el sistema puede responder, ordenar los contactos y mantener el seguimiento sin que tengas que estar pendiente todo el tiempo.\n\n¿Quieres que te explique cómo se vería aplicado en tu negocio?";
    const replyText = avoidRepeat(reply, lastBotText);
    return {
      replyText,
      nextStatePatch: {
        phase: "offer_explanation",
        last_bot_question_key: "offer_explanation",
        last_bot_text: replyText,
        mode: "creatyv_product",
      },
      debug: { phase: "offer_explanation" },
    };
  }

  if (phase === "ask_channel" && CHANNEL_RE.test(inbound)) {
    const reply = "Perfecto.\n\nPodemos adaptarlo para ese canal y hacer que responda, organice y dé seguimiento automáticamente.\n\n¿Qué tipo de negocio tenés?";
    const replyText = avoidRepeat(reply, lastBotText);
    return {
      replyText,
      nextStatePatch: {
        phase: "ask_business_type",
        last_bot_question_key: "ask_business_type",
        last_bot_text: replyText,
        mode: "creatyv_product",
      },
      debug: { phase: "ask_business_type", intent: "channel" },
    };
  }

  return null;
}
