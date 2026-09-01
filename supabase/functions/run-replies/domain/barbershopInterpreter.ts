/**
 * BarberLine Interpreter Contract
 *
 * This module is interpreter-only:
 * - LLM (or deterministic fallback) interprets message intent/entities.
 * - Engine decides next step.
 * - Tools execute actions.
 * - DB confirms truth.
 *
 * This module MUST NOT:
 * - execute tools
 * - book/cancel/reschedule appointments directly
 * - produce final user-facing transactional confirmation
 */
export type BarbershopInterpretedTurn = {
  intent:
    | "booking_request"
    | "pricing_request"
    | "product_request"
    | "availability_request"
    | "appointment_lookup"
    | "cancel_request"
    | "reschedule_request"
    | "greeting"
    | "unknown";
  fields_found: {
    service: string | null;
    date: string | null;
    time: string | null;
    provider_preference: "specific" | "any" | null;
    provider_name: string | null;
    appointment_for_relation: string | null;
    patient_name: string | null;
  };
  missing_fields: string[];
  next_step:
    | "ask_missing_field"
    | "show_availability"
    | "preconfirm_booking"
    | "lookup_active_appointment"
    | "start_cancel_confirmation"
    | "start_reschedule"
    | "answer_pricing"
    | "answer_product_question"
    | "clarify";
  tool_needed:
    | "none"
    | "check_availability"
    | "get_active_appointment"
    | "create_appointment"
    | "cancel_appointment"
    | "reschedule_appointment"
    | "get_business_info"
    | "get_products";
  reply_strategy: string;
  confidence: number;
  // Backward compatibility fields used by the current engine/runtime routing.
  entities: {
    service_name?: string | null;
    service_reference?: "explicit" | "previous_info" | "generic" | null;
    date_text?: string | null;
    time_text?: string | null;
    preferred_barber?: string | null;
    provider_preference?: "specific" | "any" | null;
    product_category?: string | null;
    product_need?: string | null;
    appointment_reference?: "active" | "previous" | null;
  };
  should_use_previous_info: boolean;
  needs_tool:
    | "get_service_price"
    | "get_products"
    | "check_availability"
    | "book_appointment"
    | "cancel_appointment"
    | "reschedule_appointment"
    | "none";
  user_facing_summary: string;
  semantic?: BarbershopSemanticInterpreterResult;
};

export type BarbershopSemanticIntent =
  | "booking_request"
  | "availability_question"
  | "pricing_question"
  | "pricing_followup"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "confirm"
  | "deny"
  | "location_question"
  | "business_hours_question"
  | "services_question"
  | "out_of_scope"
  | "unknown";

export type BarbershopSemanticInterpreterResult = {
  intent: BarbershopSemanticIntent;
  confidence: number;
  normalized_user_message: string;
  entities: {
    service_name: string | null;
    date_text: string | null;
    time_text: string | null;
    time_block: string | null;
    provider_name: string | null;
    target: string | null;
  };
  reason: string;
};

type LlmProvider = "openai" | "groq" | "none";
type LlmClientFn = (args: {
  provider: Exclude<LlmProvider, "none">;
  apiKey: string;
  model: string;
  systemPrompt: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}) => Promise<unknown>;

const ALLOWED_INTENTS = new Set<BarbershopInterpretedTurn["intent"]>([
  "booking_request",
  "pricing_request",
  "product_request",
  "availability_request",
  "appointment_lookup",
  "cancel_request",
  "reschedule_request",
  "greeting",
  "unknown",
]);

const ALLOWED_TOOLS = new Set<BarbershopInterpretedTurn["needs_tool"]>([
  "get_service_price",
  "get_products",
  "check_availability",
  "book_appointment",
  "cancel_appointment",
  "reschedule_appointment",
  "none",
]);

const ALLOWED_NEXT_STEPS = new Set<BarbershopInterpretedTurn["next_step"]>([
  "ask_missing_field",
  "show_availability",
  "preconfirm_booking",
  "lookup_active_appointment",
  "start_cancel_confirmation",
  "start_reschedule",
  "answer_pricing",
  "answer_product_question",
  "clarify",
]);

const ALLOWED_BRAIN_TOOLS = new Set<BarbershopInterpretedTurn["tool_needed"]>([
  "none",
  "check_availability",
  "get_active_appointment",
  "create_appointment",
  "cancel_appointment",
  "reschedule_appointment",
  "get_business_info",
  "get_products",
]);

function normalizeText(input: string): string {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/c\\y/g, "c y")
    .replace(/\bcy\b/g, "c y")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(a: string, b: string): number {
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

function normalizeSemanticText(input: string): string {
  const base = normalizeText(input)
    .replace(/\blatarde\b/g, "la tarde")
    .replace(/\ba\s+la\s+(\d{1,2})\b/g, "a las $1");
  return base.split(/\s+/).map((token) => {
    if (/^cancel[a-z]*$/.test(token) && token.length >= 6) return "cancelarla";
    if (token.length >= 6 && editDistance(token, "cancelar") <= 2) return "cancelar";
    if (token.length >= 8 && editDistance(token, "cancelarla") <= 3) return "cancelarla";
    if (token.length >= 5 && editDistance(token, "mover") <= 1) return "mover";
    if (token.length >= 7 && editDistance(token, "reagendar") <= 2) return "reagendar";
    return token;
  }).join(" ").trim();
}

function findBarberName(input: string): string | null {
  const m = input.match(/\bcon\s+([a-záéíóúñ]{3,})\b/i);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const blocked = new Set(["corte", "barba", "combo", "cita", "barbero", "barberia", "el", "la", "cualquiera"]);
  if (blocked.has(raw)) return null;
  return `${raw.charAt(0).toUpperCase()}${raw.slice(1)}`;
}

function findService(input: string): { service: string | null; ref: "explicit" | "generic" | null } {
  if (/\b(corte y barba|corte con barba|corte \+ barba|combo|fresh con barba y corte|cote y barba|core y barba)\b/.test(input)) {
    return { service: "Corte + barba", ref: "explicit" };
  }
  if (/\b(corte de pelo|corte de cabello|quiero corte|para corte|cortarme|core de pelo|cote de pelo)\b/.test(input)) {
    return { service: "Corte clásico", ref: "explicit" };
  }
  if (/\b(quiero barba|barba)\b/.test(input)) return { service: "Barba", ref: "explicit" };
  if (/\b(cita|agendar|reservar|apuntar)\b/.test(input)) return { service: "Cita barbería", ref: "generic" };
  return { service: null, ref: null };
}

function findDateTime(input: string): { date_text?: string; time_text?: string } {
  const out: { date_text?: string; time_text?: string } = {};
  const dateMatch = input.match(/\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|ahorita)\b/);
  if (dateMatch) out.date_text = dateMatch[1] === "ahorita" ? "hoy" : dateMatch[1];
  const timeNum = input.match(/\b(?:a las|a la|tipo)\s*(\d{1,2})(?::(\d{2}))?\b/);
  if (timeNum) out.time_text = timeNum[1];
  if (!out.time_text && /\btemprano\b/.test(input)) out.time_text = "temprano";
  if (!out.time_text && /\bmas tarde\b/.test(input)) out.time_text = "más tarde";
  return out;
}

function findTimeBlock(input: string): string | null {
  if (/\b(la tarde|por la tarde|en la tarde|mas tarde|tarde)\b/.test(input)) return "afternoon";
  if (/\b(la manana|por la manana|en la manana|temprano)\b/.test(input)) return "morning";
  if (/\b(noche|en la noche|por la noche)\b/.test(input)) return "evening";
  return null;
}

function buildSemanticResult(args: {
  inboundText: string;
  intent: BarbershopSemanticIntent;
  confidence: number;
  normalized: string;
  reason: string;
  service?: string | null;
  date?: string | null;
  time?: string | null;
  timeBlock?: string | null;
  provider?: string | null;
  target?: string | null;
}): BarbershopSemanticInterpreterResult {
  return {
    intent: args.intent,
    confidence: Math.max(0, Math.min(1, args.confidence)),
    normalized_user_message: args.normalized,
    entities: {
      service_name: args.service ?? null,
      date_text: args.date ?? null,
      time_text: args.time ?? null,
      time_block: args.timeBlock ?? null,
      provider_name: args.provider ?? null,
      target: args.target ?? null,
    },
    reason: args.reason,
  };
}

export function interpretBarbershopSemanticFallback(args: {
  inboundText: string;
  timezone: string;
  clinicSettings: Record<string, unknown>;
  state: Record<string, unknown>;
  collected: Record<string, unknown>;
  recentMessages?: Array<{ role: string; content: string }>;
}): BarbershopSemanticInterpreterResult {
  const normalized = normalizeSemanticText(args.inboundText);
  if (!normalized) {
    return buildSemanticResult({ inboundText: args.inboundText, normalized, intent: "unknown", confidence: 0.2, reason: "empty_message" });
  }

  const service = findService(normalized);
  const dateTime = findDateTime(normalized);
  const timeBlock = findTimeBlock(normalized);
  const provider = findBarberName(normalized);
  const activeBooking = Boolean((args.collected as Record<string, unknown>)?.activeBookingFlow) ||
    ["select_day", "select_time", "booking_date", "date_time"].includes(String((args.state as Record<string, unknown>)?.nextExpected ?? ""));

  if (/^(confirmar|si|sí|dale|ok|confirmo|listo)$/.test(normalized)) {
    return buildSemanticResult({ inboundText: args.inboundText, normalized, intent: "confirm", confidence: 0.9, reason: "affirmative_confirmation" });
  }
  if (/^(no|mejor no|no cancelar|cancelar no)$/.test(normalized)) {
    return buildSemanticResult({ inboundText: args.inboundText, normalized, intent: "deny", confidence: 0.86, reason: "negative_confirmation" });
  }
  if (/\b(cancelarla|cancelala)\b/.test(normalized) || (/\bcancelar\b/.test(normalized) && /\b(cita|turno|reserva|la|mi)\b/.test(normalized))) {
    return buildSemanticResult({
      inboundText: args.inboundText,
      normalized,
      intent: "cancel_appointment",
      confidence: 0.88,
      reason: "semantic_cancel_request",
      target: "active_appointment",
    });
  }
  if (/\b(reagendar|cambiar|mover|moverla)\b/.test(normalized) && /\b(cita|turno|reserva|la)\b/.test(normalized)) {
    return buildSemanticResult({
      inboundText: args.inboundText,
      normalized,
      intent: "reschedule_appointment",
      confidence: 0.86,
      reason: "semantic_reschedule_request",
      service: service.service,
      date: dateTime.date_text ?? null,
      time: dateTime.time_text ?? null,
      timeBlock,
      provider,
      target: "active_appointment",
    });
  }
  if (/\b(cuanto|precio|precios|vale|cuesta|sale|tarifa)\b/.test(normalized)) {
    return buildSemanticResult({
      inboundText: args.inboundText,
      normalized,
      intent: "pricing_question",
      confidence: 0.87,
      reason: "semantic_pricing_question",
      service: service.service,
    });
  }
  if (/^\by\b/.test(normalized) && service.service) {
    return buildSemanticResult({
      inboundText: args.inboundText,
      normalized,
      intent: "pricing_followup",
      confidence: 0.78,
      reason: "semantic_pricing_followup_candidate",
      service: service.service,
    });
  }
  if (/\b(donde estan|donde quedan|ubicacion|direccion)\b/.test(normalized)) {
    return buildSemanticResult({ inboundText: args.inboundText, normalized, intent: "location_question", confidence: 0.9, reason: "semantic_location_question" });
  }
  if (/\b(horario|horarios|abren|cierran|cuando abren|cuando cierran)\b/.test(normalized)) {
    return buildSemanticResult({ inboundText: args.inboundText, normalized, intent: "business_hours_question", confidence: 0.86, reason: "semantic_business_hours_question" });
  }
  if (/\b(servicios|que ofrecen|lista de precios)\b/.test(normalized)) {
    return buildSemanticResult({ inboundText: args.inboundText, normalized, intent: "services_question", confidence: 0.84, reason: "semantic_services_question" });
  }
  if (/\b(disponible|disponibilidad|cupo|espacio|chance|hay)\b/.test(normalized) || (activeBooking && (dateTime.time_text || timeBlock))) {
    return buildSemanticResult({
      inboundText: args.inboundText,
      normalized,
      intent: dateTime.time_text || timeBlock ? "availability_question" : "booking_request",
      confidence: 0.84,
      reason: "semantic_availability_request",
      service: service.service,
      date: dateTime.date_text ?? null,
      time: dateTime.time_text ?? null,
      timeBlock,
      provider,
    });
  }
  if (service.service || dateTime.date_text || dateTime.time_text) {
    return buildSemanticResult({
      inboundText: args.inboundText,
      normalized,
      intent: "booking_request",
      confidence: 0.78,
      reason: "semantic_booking_entities_present",
      service: service.service,
      date: dateTime.date_text ?? null,
      time: dateTime.time_text ?? null,
      timeBlock,
      provider,
    });
  }
  if (/^(hola|buenas|hey|que tal|q tal)$/.test(normalized)) {
    return buildSemanticResult({ inboundText: args.inboundText, normalized, intent: "unknown", confidence: 0.35, reason: "greeting_only_not_fallback_target" });
  }
  return buildSemanticResult({ inboundText: args.inboundText, normalized, intent: "unknown", confidence: 0.3, reason: "unsupported_or_low_confidence" });
}

const EMPTY_RESULT: BarbershopInterpretedTurn = {
  intent: "unknown",
  fields_found: {
    service: null,
    date: null,
    time: null,
    provider_preference: null,
    provider_name: null,
    appointment_for_relation: null,
    patient_name: null,
  },
  missing_fields: [],
  next_step: "clarify",
  tool_needed: "none",
  reply_strategy: "Pedir aclaracion breve sin inventar datos.",
  confidence: 0.2,
  entities: {},
  should_use_previous_info: false,
  needs_tool: "none",
  user_facing_summary: "Mensaje ambiguo",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getBarbershopInterpreterRuntimeStatus(): {
  provider: LlmProvider;
  model: string;
  has_groq_key: boolean;
  has_openai_key: boolean;
  llm_available: boolean;
} {
  const openAiApiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  const groqApiKey = (Deno.env.get("GROQ_API_KEY") ?? "").trim();
  const forcedProvider = (Deno.env.get("LLM_PROVIDER") ?? "").trim().toLowerCase();
  const openAiModel = Deno.env.get("OPENAI_MODEL_PRODUCT") ??
    Deno.env.get("OPENAI_MODEL") ??
    Deno.env.get("BARBERSHOP_INTERPRETER_OPENAI_MODEL") ??
    "gpt-4o-mini";
  const groqModel = Deno.env.get("GROQ_MODEL") ??
    Deno.env.get("BARBERSHOP_INTERPRETER_GROQ_MODEL") ??
    "llama-3.1-70b-versatile";

  let provider: LlmProvider = "none";
  let model = "";
  if (forcedProvider === "groq") {
    if (groqApiKey) {
      provider = "groq";
      model = groqModel;
    }
  } else if (forcedProvider === "openai") {
    if (openAiApiKey) {
      provider = "openai";
      model = openAiModel;
    }
  } else if (groqApiKey) {
    provider = "groq";
    model = groqModel;
  } else if (openAiApiKey) {
    provider = "openai";
    model = openAiModel;
  }

  return {
    provider,
    model,
    has_groq_key: Boolean(groqApiKey),
    has_openai_key: Boolean(openAiApiKey),
    llm_available: provider !== "none",
  };
}

function chooseLlmProvider(): { provider: LlmProvider; apiKey: string; model: string } {
  const status = getBarbershopInterpreterRuntimeStatus();
  const openAiApiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  const groqApiKey = (Deno.env.get("GROQ_API_KEY") ?? "").trim();
  if (status.provider === "groq") return { provider: "groq", apiKey: groqApiKey, model: status.model };
  if (status.provider === "openai") return { provider: "openai", apiKey: openAiApiKey, model: status.model };
  return { provider: "none", apiKey: "", model: "" };
}

function parseJsonCandidate(input: unknown): unknown {
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (isObject(input) && typeof input.content === "string") {
    try {
      return JSON.parse(input.content);
    } catch {
      return null;
    }
  }
  if (isObject(input) && Array.isArray((input as Record<string, unknown>).choices)) {
    const choices = (input as Record<string, unknown>).choices as Array<Record<string, unknown>>;
    const first = choices[0];
    if (!isObject(first) || !isObject(first.message)) return input;
    const content = String(first.message.content ?? "").trim();
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  return input;
}

function sanitizeInterpretedTurn(raw: unknown): BarbershopInterpretedTurn | null {
  if (!isObject(raw)) return null;
  const rawIntent = typeof raw.intent === "string" ? raw.intent : "";
  const mappedIntent = rawIntent === "pricing_question"
    ? "pricing_request"
    : rawIntent === "product_question"
    ? "product_request"
    : rawIntent === "availability_question"
    ? "availability_request"
    : rawIntent === "smalltalk"
    ? "unknown"
    : rawIntent;
  const intent = typeof mappedIntent === "string" && ALLOWED_INTENTS.has(mappedIntent as BarbershopInterpretedTurn["intent"])
    ? mappedIntent as BarbershopInterpretedTurn["intent"]
    : "unknown";

  const needsTool = typeof raw.needs_tool === "string" && ALLOWED_TOOLS.has(raw.needs_tool as BarbershopInterpretedTurn["needs_tool"])
    ? raw.needs_tool as BarbershopInterpretedTurn["needs_tool"]
    : "none";

  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0;

  const entitiesRaw = isObject(raw.entities) ? raw.entities : {};
  const entities: BarbershopInterpretedTurn["entities"] = {
    service_name: typeof entitiesRaw.service_name === "string" ? entitiesRaw.service_name : null,
    service_reference: entitiesRaw.service_reference === "explicit" || entitiesRaw.service_reference === "previous_info" ||
        entitiesRaw.service_reference === "generic"
      ? entitiesRaw.service_reference
      : null,
    date_text: typeof entitiesRaw.date_text === "string" ? entitiesRaw.date_text : null,
    time_text: typeof entitiesRaw.time_text === "string" ? entitiesRaw.time_text : null,
    preferred_barber: typeof entitiesRaw.preferred_barber === "string" ? entitiesRaw.preferred_barber : null,
    provider_preference: entitiesRaw.provider_preference === "specific" || entitiesRaw.provider_preference === "any"
      ? entitiesRaw.provider_preference
      : null,
    product_category: typeof entitiesRaw.product_category === "string" ? entitiesRaw.product_category : null,
    product_need: typeof entitiesRaw.product_need === "string" ? entitiesRaw.product_need : null,
    appointment_reference: entitiesRaw.appointment_reference === "active" || entitiesRaw.appointment_reference === "previous"
      ? entitiesRaw.appointment_reference
      : null,
  };
  const fieldsRaw = isObject(raw.fields_found) ? raw.fields_found : {};
  const fieldsFound: BarbershopInterpretedTurn["fields_found"] = {
    service: typeof fieldsRaw.service === "string" ? fieldsRaw.service : null,
    date: typeof fieldsRaw.date === "string" ? fieldsRaw.date : null,
    time: typeof fieldsRaw.time === "string" ? fieldsRaw.time : null,
    provider_preference: fieldsRaw.provider_preference === "specific" || fieldsRaw.provider_preference === "any"
      ? fieldsRaw.provider_preference
      : null,
    provider_name: typeof fieldsRaw.provider_name === "string" ? fieldsRaw.provider_name : null,
    appointment_for_relation: typeof fieldsRaw.appointment_for_relation === "string" ? fieldsRaw.appointment_for_relation : null,
    patient_name: typeof fieldsRaw.patient_name === "string" ? fieldsRaw.patient_name : null,
  };
  const missingFields = Array.isArray(raw.missing_fields)
    ? raw.missing_fields.filter((x: unknown): x is string => typeof x === "string").slice(0, 8)
    : [];
  const nextStep = typeof raw.next_step === "string" && ALLOWED_NEXT_STEPS.has(raw.next_step as BarbershopInterpretedTurn["next_step"])
    ? raw.next_step as BarbershopInterpretedTurn["next_step"]
    : "clarify";
  const toolNeeded = typeof raw.tool_needed === "string" && ALLOWED_BRAIN_TOOLS.has(raw.tool_needed as BarbershopInterpretedTurn["tool_needed"])
    ? raw.tool_needed as BarbershopInterpretedTurn["tool_needed"]
    : "none";
  const replyStrategy = typeof raw.reply_strategy === "string" && raw.reply_strategy.trim()
    ? raw.reply_strategy
    : "Interpretar y sugerir el siguiente paso sin ejecutar acciones.";

  return {
    intent,
    fields_found: fieldsFound,
    missing_fields: missingFields,
    next_step: nextStep,
    tool_needed: toolNeeded,
    reply_strategy: replyStrategy,
    confidence,
    entities,
    should_use_previous_info: Boolean(raw.should_use_previous_info),
    needs_tool: needsTool,
    user_facing_summary: typeof raw.user_facing_summary === "string" && raw.user_facing_summary.trim()
      ? raw.user_facing_summary
      : "Interpretación segura",
  };
}

async function defaultLlmClient(args: {
  provider: "openai" | "groq";
  apiKey: string;
  model: string;
  systemPrompt: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}): Promise<unknown> {
  const endpoint = args.provider === "groq"
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: args.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: args.systemPrompt },
          { role: "user", content: JSON.stringify(args.payload) },
        ],
      }),
    });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildBarbershopInterpreterPrompt(): string {
  return `You are a barbershop front-desk interpreter.
Return ONLY valid JSON.
Do not diagnose, do not confirm appointments, do not execute tools, do not invent prices/products/availability.
You only infer intent/entities for a downstream engine.

Schema:
{
  "intent": "booking_request|availability_request|pricing_request|appointment_lookup|cancel_request|reschedule_request|product_request|greeting|unknown",
  "fields_found": {
    "service": null,
    "date": null,
    "time": null,
    "provider_preference": "specific|any|null",
    "provider_name": null,
    "appointment_for_relation": null,
    "patient_name": null
  },
  "missing_fields": [],
  "next_step": "ask_missing_field|show_availability|preconfirm_booking|lookup_active_appointment|start_cancel_confirmation|start_reschedule|answer_pricing|answer_product_question|clarify",
  "tool_needed": "none|check_availability|get_active_appointment|create_appointment|cancel_appointment|reschedule_appointment|get_business_info|get_products",
  "reply_strategy": "",
  "confidence": 0.0,
  "entities": {
    "service_name": null,
    "service_reference": "explicit|previous_info|generic|null",
    "date_text": null,
    "time_text": null,
    "preferred_barber": null,
    "provider_preference": "specific|any|null",
    "product_category": null,
    "product_need": null,
    "appointment_reference": "active|previous|null"
  },
  "should_use_previous_info": false,
  "needs_tool": "get_service_price|get_products|check_availability|book_appointment|cancel_appointment|reschedule_appointment|none",
  "user_facing_summary": ""
}`;
}

async function tryLlmInterpretation(args: {
  inboundText: string;
  timezone: string;
  clinicSettings: Record<string, unknown>;
  state: Record<string, unknown>;
  collected: Record<string, unknown>;
  recentMessages?: Array<{ role: string; content: string }>;
  llmClient?: LlmClientFn;
}): Promise<BarbershopInterpretedTurn | null> {
  const { provider, apiKey, model } = chooseLlmProvider();
  const llmTimeoutMs = Number(Deno.env.get("BARBERSHOP_INTERPRETER_TIMEOUT_MS") ?? "4000");
  const llmConfidenceThreshold = Number(Deno.env.get("BARBERSHOP_INTERPRETER_MIN_CONFIDENCE") ?? "0.7");
  if (provider === "none") return null;
  const llmClient = args.llmClient ?? defaultLlmClient;
  const payload = {
    inbound_text: args.inboundText,
    timezone: args.timezone,
    clinic_settings_summary: {
      business_type: args.clinicSettings?.business_type ?? null,
      services: args.clinicSettings?.barber_services ?? [],
      barbers: args.clinicSettings?.barbers ?? [],
      product_categories: Array.isArray(args.clinicSettings?.barber_products)
        ? (args.clinicSettings.barber_products as Array<Record<string, unknown>>)
          .map((p) => typeof p.category === "string" ? p.category : null)
          .filter(Boolean)
        : [],
    },
    state_summary: args.state ?? {},
    collected_summary: args.collected ?? {},
    recent_messages: args.recentMessages ?? [],
  };
  try {
    const rawResponse = await llmClient({
      provider,
      apiKey,
      model,
      systemPrompt: buildBarbershopInterpreterPrompt(),
      payload,
      timeoutMs: llmTimeoutMs,
    });
    const parsed = parseJsonCandidate(rawResponse);
    const safe = sanitizeInterpretedTurn(parsed);
    if (!safe) return null;
    if (safe.confidence < llmConfidenceThreshold) return null;
    return safe;
  } catch {
    return null;
  }
}

function interpretBarbershopTurnStub(args: {
  inboundText: string;
  timezone: string;
  clinicSettings: Record<string, unknown>;
  state: Record<string, unknown>;
  collected: Record<string, unknown>;
  recentMessages?: Array<{ role: string; content: string }>;
}): BarbershopInterpretedTurn {
  const text = normalizeText(args.inboundText);
  if (!text) return EMPTY_RESULT;
  const semantic = interpretBarbershopSemanticFallback(args);
  if (semantic.confidence >= 0.75) {
    if (semantic.intent === "cancel_appointment") {
      return {
        ...EMPTY_RESULT,
        intent: "cancel_request",
        confidence: semantic.confidence,
        next_step: "start_cancel_confirmation",
        tool_needed: "get_active_appointment",
        needs_tool: "cancel_appointment",
        user_facing_summary: "Solicitud semántica de cancelación",
        semantic,
      };
    }
    if (
      semantic.intent === "reschedule_appointment" &&
      !/\b(cambiar|reagendar|me cambias la cita)\b/.test(text)
    ) {
      return {
        ...EMPTY_RESULT,
        intent: "reschedule_request",
        confidence: semantic.confidence,
        next_step: "start_reschedule",
        tool_needed: "get_active_appointment",
        fields_found: {
          ...EMPTY_RESULT.fields_found,
          service: semantic.entities.service_name,
          date: semantic.entities.date_text,
          time: semantic.entities.time_text,
          provider_name: semantic.entities.provider_name,
        },
        entities: {
          service_name: semantic.entities.service_name,
          service_reference: semantic.entities.service_name ? "explicit" : null,
          date_text: semantic.entities.date_text,
          time_text: semantic.entities.time_text ?? semantic.entities.time_block,
          preferred_barber: semantic.entities.provider_name,
          provider_preference: semantic.entities.provider_name ? "specific" : null,
        },
        needs_tool: "reschedule_appointment",
        user_facing_summary: "Solicitud semántica de reagendado",
        semantic,
      };
    }
  }

  if (/^(hola|buenas|que tal|q tal)$/.test(text)) {
    return { ...EMPTY_RESULT, intent: "greeting", confidence: 0.9, user_facing_summary: "Saludo inicial", semantic };
  }
  if (/\b(cambiar|reagendar|me cambias la cita)\b/.test(text)) {
    return {
      ...EMPTY_RESULT,
      intent: "reschedule_request",
      confidence: 0.86,
      next_step: "start_reschedule",
      tool_needed: "get_active_appointment",
      entities: { time_text: /\bmas tarde\b/.test(text) ? "más tarde" : null },
      needs_tool: "reschedule_appointment",
      user_facing_summary: "Solicitud de reagendado",
    };
  }
  if (/\b(cancelar cita|cancelame|cancelar|ya no voy|no voy a poder llegar|no puedo ir|anular)\b/.test(text)) {
    return {
      ...EMPTY_RESULT,
      intent: "cancel_request",
      confidence: 0.85,
      next_step: "start_cancel_confirmation",
      tool_needed: "get_active_appointment",
      needs_tool: "cancel_appointment",
      user_facing_summary: "Solicitud de cancelación",
    };
  }
  if (/\b(que cita tngo|que cita tengo|que hora era mi cita|a que hora era mi cita|mi cita)\b/.test(text)) {
    return {
      ...EMPTY_RESULT,
      intent: "appointment_lookup",
      confidence: 0.9,
      next_step: "lookup_active_appointment",
      tool_needed: "get_active_appointment",
      needs_tool: "none",
      user_facing_summary: "Consulta de cita activa",
    };
  }
  if (/\b(se me hizo tarde|voy tarde|llego en \d+)\b/.test(text)) {
    return {
      ...EMPTY_RESULT,
      intent: "unknown",
      confidence: 0.82,
      next_step: "clarify",
      tool_needed: "none",
      entities: { appointment_reference: "active" },
      user_facing_summary: "Usuario avisa retraso",
    };
  }

  if (/\b(por llegada|solo cita|walk in)\b/.test(text)) {
    return {
      ...EMPTY_RESULT,
      intent: "unknown",
      confidence: 0.78,
      next_step: "clarify",
      tool_needed: "none",
      needs_tool: "none",
      user_facing_summary: "Pregunta sobre modalidad por llegada vs cita",
    };
  }

  if (/\b(cuanto|precio|vale|tarifa|sale)\b/.test(text)) {
    const s = findService(text);
    return {
      ...EMPTY_RESULT,
      intent: "pricing_request",
      confidence: 0.88,
      fields_found: { ...EMPTY_RESULT.fields_found, service: s.service },
      next_step: "answer_pricing",
      tool_needed: "get_business_info",
      entities: { service_name: s.service, service_reference: s.ref },
      needs_tool: "get_service_price",
      user_facing_summary: "Consulta de precio",
    };
  }

  if (/\b(pomada|gel|shampoo|producto|productos|dure todo el dia|fijacion)\b/.test(text)) {
    return {
      ...EMPTY_RESULT,
      intent: "product_request",
      confidence: 0.84,
      next_step: "answer_product_question",
      tool_needed: "get_products",
      entities: {
        product_category: /\bpomada\b/.test(text) ? "Pomadas" : null,
        product_need: /\b(dure todo el dia|fijacion)\b/.test(text) ? "fijación fuerte" : null,
      },
      needs_tool: "get_products",
      user_facing_summary: "Consulta de productos",
    };
  }

  if (
    /\b(chance|espacio|disponible|disponibilidad|cupo|horario|horarios|dia|dias|semana|ahorita|por llegada|solo cita|cuando)\b/.test(text) &&
    !/\b(cita|agendar|reservar)\b/.test(text)
  ) {
    const modeQuestion = /\b(por llegada|solo cita)\b/.test(text);
    return {
      ...EMPTY_RESULT,
      intent: modeQuestion ? "unknown" : "availability_request",
      confidence: 0.76,
      next_step: modeQuestion ? "clarify" : "show_availability",
      tool_needed: modeQuestion ? "none" : "check_availability",
      fields_found: modeQuestion ? { ...EMPTY_RESULT.fields_found } : {
        ...EMPTY_RESULT.fields_found,
        date: findDateTime(text).date_text ?? null,
      },
      entities: modeQuestion ? {} : { ...findDateTime(text) },
      needs_tool: "check_availability",
      user_facing_summary: modeQuestion
        ? "Pregunta si atienden por llegada o por cita"
        : "Pregunta de disponibilidad",
    };
  }

  const asksBooking = /\b(cita|agendar|reservar|ocupo|necesito|apuntar|agendame)\b/.test(text);
  const dateTime = findDateTime(text);
  const barber = findBarberName(text);
  const anyProvider = /\b(cualquiera|el que este libre|el que este disponible|con cualquiera)\b/.test(text);
  const service = findService(text);

  if (asksBooking || service.service || dateTime.date_text || dateTime.time_text || barber || anyProvider) {
    let serviceName = service.service;
    let serviceReference: "explicit" | "previous_info" | "generic" | null = service.ref;
    let shouldUsePreviousInfo = false;
    if (!serviceName && /\b(ese|lo mismo)\b/.test(text)) {
      const previous = String(args.collected?.last_price_service ?? "").trim();
      if (previous) {
        serviceName = previous;
        serviceReference = "previous_info";
        shouldUsePreviousInfo = true;
      }
    }
    if (!serviceName) {
      serviceName = "Cita barbería";
      serviceReference = "generic";
    }
    return {
      ...EMPTY_RESULT,
      intent: "booking_request",
      confidence: 0.83,
      fields_found: {
        ...EMPTY_RESULT.fields_found,
        service: serviceName,
        date: dateTime.date_text ?? null,
        time: dateTime.time_text ?? null,
        provider_preference: barber ? "specific" : anyProvider ? "any" : null,
        provider_name: barber,
      },
      next_step: "preconfirm_booking",
      tool_needed: "check_availability",
      entities: {
        service_name: serviceName,
        service_reference: serviceReference,
        date_text: dateTime.date_text ?? null,
        time_text: dateTime.time_text ?? null,
        preferred_barber: barber,
        provider_preference: barber ? "specific" : anyProvider ? "any" : null,
      },
      should_use_previous_info: shouldUsePreviousInfo,
      needs_tool: "check_availability",
      user_facing_summary: "Solicitud de cita",
    };
  }

  return EMPTY_RESULT;
}

export async function interpretBarbershopTurn(args: {
  inboundText: string;
  timezone: string;
  clinicSettings: Record<string, unknown>;
  state: Record<string, unknown>;
  collected: Record<string, unknown>;
  recentMessages?: Array<{ role: string; content: string }>;
  llmClient?: LlmClientFn;
  semanticFallbackOnly?: boolean;
}): Promise<BarbershopInterpretedTurn> {
  if (args.semanticFallbackOnly) return interpretBarbershopTurnStub(args);
  const llmResult = await tryLlmInterpretation(args);
  if (llmResult) return llmResult;
  return interpretBarbershopTurnStub(args);
}
