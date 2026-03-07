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
const INTENT_OTHER_INDUSTRY = /(también tengo|tambien tengo|bienes raíces|real estate|otro negocio|también aplica|tambien aplica)/i;
const INTENT_CAPABILITIES = /(que más hace|qué más hace|que hace|qué hace|que más)/i;
const INTENT_NOT_SURE = /(no lo se|no lo sé|todavia no lo se|todavía no lo sé|no estoy seguro)/i;
const INTENT_DECLINES_EXPLANATION = /^(no|nop|no gracias)$/i;
const INTENT_PRODUCT_DEFINITION = /(que es|qué es|de que se trata|de qué se trata|qué vendes|que vendes)/i;
const INTENT_PRICING = /(precio|precios|cuanto cuesta|cuánto cuesta)/i;

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
  if (INTENT_OTHER_INDUSTRY.test(lowerInbound)) {
    const reply = "Perfecto, también aplica para ese tipo de negocio.\n\nAhí sirve para responder leads, organizarlos mejor y hacer seguimiento automático para que no se enfríen.\n\n¿En tu caso te interesa más responder más rápido o dar mejor seguimiento?";
    return buildIntentResponse(reply, phase, "ask_pain", "asks_other_industry_fit", lastBotText, "asks_other_industry_fit");
  }
  if (INTENT_CAPABILITIES.test(lowerInbound)) {
    const reply = "Además de responder mensajes, también puede:\n\n• organizar leads o citas\n• hacer seguimiento automático\n• mantener conversaciones más ordenadas\n• ayudarte a que no se te vayan oportunidades por falta de respuesta\n\nSi quieres, te explico cómo se usaría específicamente en tu negocio.";
    return buildIntentResponse(reply, phase, phase, "capabilities", lastBotText, "asks_capabilities");
  }
  if (INTENT_NOT_SURE.test(lowerInbound)) {
    const reply = "No pasa nada. Te lo resumo simple:\n\nnormalmente lo usan para 3 cosas:\n• responder más rápido\n• ordenar clientes o citas\n• no perder seguimiento\n\n¿Cuál de esas crees que te ayudaría más hoy?";
    return buildIntentResponse(reply, phase, phase, "not_sure", lastBotText, "not_sure");
  }
  if (INTENT_DECLINES_EXPLANATION.test(lowerInbound)) {
    const reply = "Está bien.\n\nEntonces te lo dejo corto: Creatyv sirve para responder, organizar y dar seguimiento sin que tengas que estar pendiente todo el tiempo.\n\n¿Quieres que te diga en cuál de esas 3 te ayudaría más según tu negocio?";
    return buildIntentResponse(reply, phase, phase, "declines_explanation", lastBotText, "declines_explanation");
  }
  if (INTENT_PRODUCT_DEFINITION.test(lowerInbound)) {
    const reply = "Creatyv es un sistema para negocios que ayuda a responder mensajes, organizar leads o citas y hacer seguimiento automático.\n\nLa idea es que no se te vayan oportunidades por responder tarde o por no dar seguimiento.\n\n¿Qué tipo de negocio tenés?";
    return buildIntentResponse(reply, phase, "ask_business_type", "product_definition", lastBotText, "asks_product_definition");
  }
  if (INTENT_PRICING.test(lowerInbound)) {
    const reply = "El precio depende más que todo de cómo se usaría en tu negocio y qué parte quieres automatizar primero.\n\nSi me dices qué tipo de negocio tenés, te oriento mejor.";
    return buildIntentResponse(reply, phase, phase, "pricing", lastBotText, "asks_pricing");
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

  if (CONFUSION_RE.test(inbound)) {
    const reply = "Lo que hacemos es esto:\n\n• responder mensajes automáticamente\n• organizar citas o leads\n• hacer seguimiento automático a clientes\n\nEn pocas palabras, ayudamos a que no se te vayan oportunidades por no responder o no dar seguimiento.\n\n¿Tu negocio atiende clientes por WhatsApp, Messenger o Instagram?";
    const replyText = avoidRepeat(reply, lastBotText);
    return {
      replyText,
      nextStatePatch: {
        phase: "ask_channel",
        last_bot_question_key: "ask_channel",
        last_bot_text: replyText,
        mode: "creatyv_product",
      },
      debug: { phase: "ask_channel", intent: "confusion" },
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
