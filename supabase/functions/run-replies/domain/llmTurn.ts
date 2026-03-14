import { ConversationState, StatePatch } from "../conversationEngine.ts";

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
  name: "save_lead_fields" | "book_appointment" | "send_trial_link" | "handoff_to_human" | "get_clinic_info" | "create_trial_account";
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

export type LlmTurnValidationError = {
  valid: false;
  errors: string[];
};

export type LlmTurnValidation = {
  result: LlmTurnResult | null;
  validation: LlmTurnValidationError | { valid: true };
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

// System prompts por defecto si no hay uno en org_settings
const DEFAULT_PROMPTS: Record<string, string> = {
  creatyv: `Eres el asistente de ventas de Creatyv AI. Tu objetivo es explicar el producto y guiar al prospecto a probar el sistema.

PRODUCTO: Sistema de IA que responde mensajes automáticamente, agenda citas, y da seguimiento a clientes.

REGLAS:
- Español amigable y profesional
- Respuestas cortas (2-3 oraciones máximo)
- Siempre termina con una pregunta o llamado a acción
- Si dicen "sí/ok/dale", continúa el flujo (NO reinicies)
- Si preguntan precio, ofrece demo para cotización

RESPONDE SOLO JSON:
{"reply":"texto","state_patch":{"stage":"...","nextExpected":"..."},"tool_calls":[],"decision_meta":{"reason":"...","confidence":0.9}}`,

  dental: `Eres la recepcionista de una clínica dental. Tu objetivo es atender pacientes y ayudarles a agendar citas.

REGLAS:
- Español cálido y profesional
- Respuestas cortas
- NO repitas preguntas ya respondidas
- Si dicen "sí/ok/dale", continúa el flujo
- Para agendar: pide nombre, servicio, día y hora preferidos
- Si es emergencia, prioriza atención rápida

RESPONDE SOLO JSON:
{"reply":"texto","state_patch":{"stage":"...","collected":{"name":"...","service":"..."}},"tool_calls":[],"decision_meta":{"reason":"...","confidence":0.9}}`,

  generic: `Eres un asistente virtual amigable. Responde dudas y guía al usuario.

RESPONDE SOLO JSON:
{"reply":"texto","state_patch":{},"tool_calls":[],"decision_meta":{"reason":"...","confidence":0.9}}`
};

function getSystemPrompt(orgSettings?: OrgSettings): string {
  const sp = orgSettings?.system_prompt;

  // Si es string largo (>100 chars), probablemente es un prompt real ya armado
  if (typeof sp === "string" && sp.length > 100) {
    return sp;
  }

  // Si es objeto con "rules", construir prompt desde las reglas
  if (sp && typeof sp === "object") {
    const config = sp as Record<string, unknown>;
    if (Array.isArray(config.rules)) {
      const rulesText = (config.rules as string[]).map((r) => `- ${r}`).join("\n");
      const openingQ = config.opening_question
        ? `\nPregunta de apertura sugerida: ${config.opening_question}`
        : "";

      return `${DEFAULT_PROMPTS.creatyv}\n\nREGLAS ESPECÍFICAS:\n${rulesText}${openingQ}`;
    }
  }

  // Fallback por business_type
  const bizType = String(orgSettings?.business_type ?? "generic").toLowerCase();
  if (bizType.includes("dental") || bizType.includes("clinic")) return DEFAULT_PROMPTS.dental;
  if (bizType.includes("agency") || bizType.includes("creatyv")) return DEFAULT_PROMPTS.creatyv;
  return DEFAULT_PROMPTS.generic;
}

function buildUserPrompt(args: {
  inboundText: string;
  leadState: ConversationState | null;
  recentMessages?: RecentMessage[];
}): string {
  const history = (args.recentMessages ?? [])
    .slice(-6)
    .map((msg) => `${msg.role === "user" ? "Usuario" : "Asistente"}: ${msg.content}`)
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

export async function runLlmTurn(args: {
  organizationId: string;
  inboundText: string;
  leadState: ConversationState | null;
  orgSettings?: OrgSettings;
  recentMessages?: RecentMessage[];
}): Promise<LlmTurnResult | null> {
  // Verificar API key
  if (!OPENAI_API_KEY) {
    console.warn("[llmTurn] Missing OPENAI_API_KEY");
    return null;
  }
  
  // Verificar si LLM está habilitado
  if (args.orgSettings?.llm_brain_enabled !== true) {
    console.log("[llmTurn] LLM not enabled for org:", args.organizationId);
    return null;
  }

  const systemPrompt = getSystemPrompt(args.orgSettings);
  const userPrompt = buildUserPrompt(args);

  console.log("[llmTurn] Calling OpenAI for org:", args.organizationId);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      console.error("[llmTurn] OpenAI error:", response.status);
      return null;
    }

    const json = await response.json();
    const content = String(json?.choices?.[0]?.message?.content ?? "");
    
    // Limpiar markdown si viene con ```json
    const cleaned = content.replace(/```json|```/g, "").trim();
    
    console.log("[llmTurn] Raw response:", cleaned.slice(0, 200));

    const parsed = JSON.parse(cleaned);
    const validation = validateLlmTurnResult(parsed);
    
    if (!validation.validation.valid) {
      console.warn("[llmTurn] Validation failed:", validation.validation.errors);
      return null;
    }

    console.log("[llmTurn] Success! Reply:", validation.result?.reply?.slice(0, 50));
    return validation.result;

  } catch (err) {
    console.error("[llmTurn] Error:", err);
    return null;
  }
}

export function validateLlmTurnResult(payload: unknown): LlmTurnValidation {
  const errors: string[] = [];

  if (typeof payload !== "object" || payload === null) {
    errors.push("payload must be an object");
    return { result: null, validation: { valid: false, errors } };
  }

  const data = payload as Record<string, unknown>;

  // Aceptar tanto "reply" como "response.message"
  let reply = "";
  if (typeof data.reply === "string") {
    reply = data.reply.trim();
  } else if (data.response && typeof data.response === "object") {
    const resp = data.response as Record<string, unknown>;
    if (typeof resp.message === "string") {
      reply = resp.message.trim();
    }
  }

  if (!reply) {
    errors.push("reply must be a non-empty string");
  }

  // state_patch es opcional
  const state_patch = data.state_patch ?? {};

  // tool_calls es opcional - validar nombres permitidos
  const tool_calls = Array.isArray(data.tool_calls) ? data.tool_calls : [];
  const allowed = new Set([
    "save_lead_fields", 
    "book_appointment", 
    "send_trial_link", 
    "handoff_to_human", 
    "get_clinic_info",
    "create_trial_account"
  ]);
  
  for (const call of tool_calls) {
    if (typeof call === "object" && call !== null) {
      const name = String((call as Record<string, unknown>).name ?? "");
      if (name && !allowed.has(name)) {
        console.warn("[llmTurn] Unknown tool call:", name);
      }
    }
  }

  if (errors.length) {
    return { result: null, validation: { valid: false, errors } };
  }

  return {
    result: {
      reply,
      state_patch: state_patch as StatePatch,
      tool_calls: tool_calls as ToolCall[],
      decision_meta: {
        reason: String((data.decision_meta as Record<string, unknown> | undefined)?.reason ?? "llm"),
        confidence: Number((data.decision_meta as Record<string, unknown> | undefined)?.confidence ?? 0.8),
      },
    },
    validation: { valid: true },
  };
}