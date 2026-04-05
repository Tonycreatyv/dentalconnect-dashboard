import type { ConversationState } from "../conversationEngine.ts";

type StatePatch = Record<string, unknown>;

export type OrgSettings = {
  llm_brain_enabled?: boolean;
  system_prompt?: string;
  business_type?: string;
  brand_name?: string;
  [key: string]: unknown;
};

export type RecentMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

export type ToolCall = {
  name:
    | "save_lead_fields"
    | "book_appointment"
    | "send_trial_link"
    | "handoff_to_human"
    | "get_clinic_info"
    | "create_trial_account";
  payload: Record<string, unknown>;
};

export type DecisionMeta = {
  reason: string;
  confidence: number;
};

export type LlmTurnResult = {
  reply: string;
  state_patch: StatePatch;
  tool_calls: ToolCall[];
  decision_meta: DecisionMeta;
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

const DEFAULT_PROMPTS: Record<string, string> = {
  creatyv:
    `Eres el asistente de ventas de Creatyv AI. Tu objetivo es explicar el producto y guiar al prospecto a probar el sistema.

PRODUCTO: Sistema de IA que responde mensajes automáticamente, agenda citas, y da seguimiento a clientes.

REGLAS:
- Español amigable y profesional
- Respuestas cortas (2-3 oraciones máximo)
- Siempre termina con una pregunta o llamado a acción
- Si dicen "sí/ok/dale", continúa el flujo (NO reinicies)
- Si preguntan precio, ofrece demo para cotización

RESPONDE SOLO JSON:
{"reply":"texto","state_patch":{"stage":"...","nextExpected":"..."},"tool_calls":[],"decision_meta":{"reason":"...","confidence":0.9}}`,

  dental:
    `Eres la recepcionista de una clínica dental. Tu objetivo es atender pacientes y ayudarles a agendar citas.

REGLAS:
- Español cálido y profesional
- Respuestas cortas
- NO repitas preguntas ya respondidas
- Si dicen "sí/ok/dale", continúa el flujo
- Para agendar: pide nombre, servicio, día y hora preferidos
- Si es emergencia, prioriza atención rápida

RESPONDE SOLO JSON:
{"reply":"texto","state_patch":{"stage":"...","collected":{"name":"...","service":"..."}},"tool_calls":[],"decision_meta":{"reason":"...","confidence":0.9}}`,

  generic:
    `Eres un asistente virtual amigable. Responde dudas y guía al usuario.

RESPONDE SOLO JSON:
{"reply":"texto","state_patch":{},"tool_calls":[],"decision_meta":{"reason":"...","confidence":0.9}}`,
};

function getSystemPrompt(orgSettings?: OrgSettings): string {
  const sp = orgSettings?.system_prompt;

  if (typeof sp === "string" && sp.length > 100) {
    return sp;
  }

  if (sp && typeof sp === "object") {
    const config = sp as Record<string, unknown>;
    if (Array.isArray(config.rules)) {
      const rulesText = (config.rules as string[]).map((r) => `- ${r}`).join(
        "\n",
      );
      const openingQ = config.opening_question
        ? `\nPregunta de apertura sugerida: ${config.opening_question}`
        : "";

      return `${DEFAULT_PROMPTS.creatyv}\n\nREGLAS ESPECÍFICAS:\n${rulesText}${openingQ}`;
    }
  }

  const bizType = String(orgSettings?.business_type ?? "generic").toLowerCase();
  if (bizType.includes("dental") || bizType.includes("clinic")) {
    return DEFAULT_PROMPTS.dental;
  }
  if (bizType.includes("agency") || bizType.includes("creatyv")) {
    return DEFAULT_PROMPTS.creatyv;
  }
  return DEFAULT_PROMPTS.generic;
}

function buildUserPrompt(args: {
  inboundText: string;
  leadState: ConversationState | null;
  recentMessages?: RecentMessage[];
}): string {
  const history = (args.recentMessages ?? [])
    .slice(-6)
    .map((msg) =>
      `${msg.role === "user" ? "Usuario" : "Asistente"}: ${msg.content}`
    )
    .join("\n");

  const state = args.leadState ?? {};

  return `ESTADO ACTUAL:
- Etapa: ${state.stage || "INITIAL"}
- Último intent: ${state.lastIntent || "ninguno"}
- Esperando: ${state.nextExpected || "nada"}
- Info recolectada: ${JSON.stringify(state.collected || {})}

HISTORIAL RECIENTE:
${history || "(Primera interacción)"}

MENSAJE DEL USUARIO:
"${args.inboundText}"

Responde con JSON válido.`;
}

function tryParseJson(raw: string): LlmTurnResult | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    return {
      reply: String(parsed.reply ?? ""),
      state_patch: (parsed.state_patch ?? {}) as StatePatch,
      tool_calls: Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [],
      decision_meta: {
        reason: String(parsed.decision_meta?.reason ?? "ok"),
        confidence: Number(parsed.decision_meta?.confidence ?? 0.7),
      },
    };
  } catch {
    return null;
  }
}

export async function runLlmTurn(args: {
  organizationId: string;
  inboundText: string;
  leadState: ConversationState | null;
  orgSettings?: OrgSettings;
  recentMessages?: RecentMessage[];
}): Promise<LlmTurnResult | null> {
  if (!OPENAI_API_KEY) {
    console.warn("[llmTurn] Missing OPENAI_API_KEY");
    return null;
  }

  if (args.orgSettings?.llm_brain_enabled !== true) {
    console.log("[llmTurn] LLM disabled for org");
    return null;
  }

  const systemPrompt = getSystemPrompt(args.orgSettings);
  const userPrompt = buildUserPrompt({
    inboundText: args.inboundText,
    leadState: args.leadState,
    recentMessages: args.recentMessages,
  });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[llmTurn] OpenAI error:", res.status, errText);
    return null;
  }

  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string") {
    console.warn("[llmTurn] Missing content");
    return null;
  }

  return tryParseJson(content);
}
