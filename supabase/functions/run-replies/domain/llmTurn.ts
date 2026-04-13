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

// --- CONFIGURACIÓN DE GROQ 2026 ---
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const DEFAULT_PROMPTS: Record<string, string> = {
  creatyv: `Eres el asistente de ventas de Creatyv AI. RESPONDE SOLO JSON.`,
  dental: `Eres la recepcionista de una clínica dental. RESPONDE SOLO JSON.`,
  generic: `Eres un asistente virtual amigable. RESPONDE SOLO JSON.`,
};

function getSystemPrompt(orgSettings?: OrgSettings): string {
  const sp = orgSettings?.system_prompt;
  if (typeof sp === "string" && sp.trim().length > 0) {
    return sp;
  }
  const bizType = String(orgSettings?.business_type ?? "generic").toLowerCase();
  if (bizType.includes("dental") || bizType.includes("clinic"))
    return DEFAULT_PROMPTS.dental;
  if (bizType.includes("agency") || bizType.includes("creatyv"))
    return DEFAULT_PROMPTS.creatyv;
  return DEFAULT_PROMPTS.generic;
}

// =============================================================================
// CLINIC CONTEXT BUILDER — reads clinic_settings and builds a text block
// =============================================================================

function buildClinicContext(clinicSettings?: Record<string, unknown>): string {
  if (!clinicSettings || Object.keys(clinicSettings).length === 0) return "";

  const parts: string[] = [];

  // Hours
  const hours = clinicSettings.hours as Record<string, any> | undefined;
  if (hours && typeof hours === "object") {
    const dayNames: Record<string, string> = {
      mon: "Lunes",
      tue: "Martes",
      wed: "Miércoles",
      thu: "Jueves",
      fri: "Viernes",
      sat: "Sábado",
      sun: "Domingo",
    };
    const lines: string[] = [];
    for (const [key, label] of Object.entries(dayNames)) {
      const day = hours[key];
      if (!day) continue;
      if (day.closed) {
        lines.push(`- ${label}: CERRADO`);
      } else {
        lines.push(`- ${label}: ${day.open || "08:00"} - ${day.close || "17:00"}`);
      }
    }
    if (lines.length > 0) {
      parts.push(`HORARIO DE LA CLÍNICA:\n${lines.join("\n")}`);
    }
  }

  // Services with prices
  const services = clinicSettings.services as any[] | undefined;
  if (Array.isArray(services) && services.length > 0) {
    const lines: string[] = [];
    for (const svc of services) {
      const name = String(svc.name ?? "").trim();
      if (!name) continue;
      const currency = String(svc.currency ?? "HNL");
      const from = svc.price_from;
      const to = svc.price_to;
      const dur = svc.duration_min;
      const notes = String(svc.notes ?? "").trim();

      let priceStr = "";
      if (from && to) {
        priceStr = `${currency} ${from} - ${currency} ${to}`;
      } else if (from) {
        priceStr = `desde ${currency} ${from}`;
      } else {
        priceStr = "consultar precio";
      }

      let line = `- ${name}: ${priceStr}`;
      if (dur) line += ` (${dur} min)`;
      if (notes) line += `. ${notes}`;
      lines.push(line);
    }
    if (lines.length > 0) {
      parts.push(
        `SERVICIOS Y PRECIOS:\n${lines.join("\n")}\nCuando pregunten precio, SIEMPRE da el rango real de arriba. NUNCA digas "los precios varían, preguntá al doctor".`
      );
    }
  }

  // Phone
  const phone = clinicSettings.phone as string | undefined;
  if (phone && String(phone).trim()) {
    parts.push(`TELÉFONO: ${String(phone).trim()}`);
  }

  // Address
  const address = clinicSettings.address as string | undefined;
  if (address && String(address).trim()) {
    parts.push(`DIRECCIÓN: ${String(address).trim()}`);
  }

  // Emergency
  const emergency = clinicSettings.emergency as string | undefined;
  if (emergency && String(emergency).trim()) {
    parts.push(`EMERGENCIAS: ${String(emergency).trim()}`);
  }

  // Policies
  const policies = clinicSettings.policies as Record<string, string> | undefined;
  if (policies && typeof policies === "object") {
    const pLines: string[] = [];
    for (const [, val] of Object.entries(policies)) {
      if (val) pLines.push(`- ${val}`);
    }
    if (pLines.length > 0) {
      parts.push(`POLÍTICAS:\n${pLines.join("\n")}`);
    }
  }

  // FAQs
  const faqs = clinicSettings.faqs as any[] | undefined;
  if (Array.isArray(faqs) && faqs.length > 0) {
    const fLines: string[] = [];
    for (const faq of faqs) {
      const q = String(faq.q ?? "").trim();
      const a = String(faq.a ?? "").trim();
      if (q && a) fLines.push(`- "${q}" → "${a}"`);
    }
    if (fLines.length > 0) {
      parts.push(`PREGUNTAS FRECUENTES:\n${fLines.join("\n")}`);
    }
  }

  if (parts.length === 0) return "";
  return "\n\nCONTEXTO DE LA CLÍNICA (datos reales, úsalos siempre):\n" + parts.join("\n\n");
}

// =============================================================================
// USER PROMPT BUILDER
// =============================================================================

function buildUserPrompt(args: {
  inboundText: string;
  leadState: ConversationState | null;
  recentMessages?: RecentMessage[];
  clinicContext?: string;
}): string {
  const history = (args.recentMessages ?? [])
    .slice(-6)
    .map(
      (msg) =>
        `${msg.role === "user" ? "Usuario" : "Asistente"}: ${msg.content}`
    )
    .join("\n");
  const state = args.leadState ?? {};
  const nowDate = new Date();
  const now = nowDate.toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" });
  const dayNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const hoyLocal = new Date(nowDate.toLocaleString("en-US", { timeZone: "America/Tegucigalpa" }));
  const mananaLocal = new Date(hoyLocal.getTime() + 86400000);
  const hoyStr = `${dayNames[hoyLocal.getDay()]} ${hoyLocal.getDate()} de ${hoyLocal.toLocaleString("es-HN", { month: "long", timeZone: "America/Tegucigalpa" })} ${hoyLocal.getFullYear()}`;
  const mananaStr = `${dayNames[mananaLocal.getDay()]} ${mananaLocal.getDate()} de ${mananaLocal.toLocaleString("es-HN", { month: "long", timeZone: "America/Tegucigalpa" })} ${mananaLocal.getFullYear()}`;

  let prompt = `FECHA/HORA ACTUAL: ${now}\nHOY ES: ${hoyStr}\nMAÑANA ES: ${mananaStr}\nESTADO: ${JSON.stringify(state)}\nHISTORIAL:\n${history || "(Primera vez)"}\nMENSAJE: "${args.inboundText}"`;

  if (args.clinicContext) {
    prompt += `\n${args.clinicContext}`;
  }

  prompt += `\nRESPONDE EN JSON VÁLIDO.`;
  return prompt;
}

// =============================================================================
// JSON PARSER
// =============================================================================

function tryParseJson(raw: string): LlmTurnResult | null {
  try {
    const cleanRaw = raw
      .replace(/```json|```/g, "")
      .replace(/\)\s*([,}\]])/g, "}$1")
      .replace(/\)\s*$/g, "}")
      .replace(/(["'\d])\)/g, "$1}")
      .trim();
    const parsed = JSON.parse(cleanRaw);
    return {
      reply: String(parsed.reply ?? ""),
      state_patch: (parsed.state_patch ?? {}) as StatePatch,
      tool_calls: Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [],
      decision_meta: {
        reason: String(parsed.decision_meta?.reason ?? "ok"),
        confidence: Number(parsed.decision_meta?.confidence ?? 0.7),
      },
    };
  } catch (e) {
    console.error(
      "[llmTurn] ERROR DE PARSEO JSON:",
      e.message,
      "RAW CONTENT:",
      raw
    );
    return null;
  }
}

// =============================================================================
// MAIN LLM TURN
// =============================================================================

export async function runLlmTurn(args: {
  organizationId: string;
  inboundText: string;
  leadState: ConversationState | null;
  orgSettings?: OrgSettings;
  recentMessages?: RecentMessage[];
  clinicSettings?: Record<string, unknown>;
  context?: any;
}): Promise<LlmTurnResult | null> {
  try {
    if (!GROQ_API_KEY) {
      console.error("[llmTurn] ERROR: GROQ_API_KEY NO ENCONTRADA EN ENTORNO.");
      return null;
    }

    if (args.orgSettings?.llm_brain_enabled !== true) {
      console.log("[llmTurn] IA deshabilitada en base de datos para esta org.");
      return null;
    }

    const systemPrompt = getSystemPrompt(args.orgSettings);
    const clinicContext = buildClinicContext(args.clinicSettings);
    const userPrompt = buildUserPrompt({
      inboundText: args.inboundText,
      leadState: args.leadState,
      recentMessages: args.recentMessages,
      clinicContext,
    });

    console.log(`[llmTurn] Intentando Groq con modelo: ${GROQ_MODEL}`);

    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Groq API Error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Groq devolvió una respuesta vacía (sin content).");
    }

    return tryParseJson(content);
  } catch (e) {
    console.error("[llmTurn] ERROR CRÍTICO EN FETCH O PARSE:", e.message);
    console.error("[llmTurn] STACK:", e.stack);
    return null;
  }
}
