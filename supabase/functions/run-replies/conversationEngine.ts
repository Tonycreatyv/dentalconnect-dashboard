/// <reference lib="deno.unstable" />

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
const CONFUSION_RE = /(qué haces|qué vendes|qué haces|qué vend[oé]s|no sé qué (haces|vendes)|cómo me ayudás|cómo me ayudas)/i;
const CHANNEL_RE = /(whatsapp|messenger|instagram)/i;

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

  if (phase === "new") {
    const reply = "Hola 👋\nSoy Creatyv.\n\nAyudamos a negocios a responder mensajes automáticamente, organizar citas o leads y hacer seguimiento para que no se pierdan clientes.\n\n¿Qué tipo de negocio tenés?";
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
