/// <reference deno-types="https://deno.land/x/types/index.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type Json = Record<string, any>;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, x-run-replies-secret",
};

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function env(name: string, fallback?: string) {
  const v = Deno.env.get(name) ?? fallback;
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function safeStr(x: any, d = ""): string {
  if (typeof x === "string") return x;
  if (x == null) return d;
  return String(x);
}

function nowIso() {
  return new Date().toISOString();
}

function logEvent(event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      ts: nowIso(),
      event,
      ...data,
    })
  );
}

function toErrorStack(err: unknown) {
  if (err instanceof Error) return err.stack ?? err.message;
  return safeStr(err, "");
}

function parseMetaStatus(errorMessage: string) {
  const m = safeStr(errorMessage, "").match(/meta_error:(\d{3}):/i) || safeStr(errorMessage, "").match(/Meta error:\s*(\d{3})/i);
  if (m?.[1]) return Number(m[1]);
  const m2 = safeStr(errorMessage, "").match(/meta_send_failed:(\d{3}):/i);
  return m2?.[1] ? Number(m2[1]) : null;
}

function backoffSeconds(attemptCount: number) {
  const n = Math.max(1, Number(attemptCount) || 1);
  if (n <= 1) return 60;
  if (n === 2) return 5 * 60;
  if (n === 3) return 15 * 60;
  return 60 * 60;
}

function plusSecondsIso(seconds: number) {
  return new Date(Date.now() + Math.max(0, seconds) * 1000).toISOString();
}

function clampText(s: string, max = 900) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function stripUrls(input: string) {
  return safeStr(input, "").replace(/https?:\/\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
}

function normalizeChannel(ch: string) {
  const c = (ch ?? "").toLowerCase();
  if (c.includes("messenger")) return "messenger";
  if (c.includes("instagram")) return "instagram";
  if (c.includes("whatsapp")) return "whatsapp";
  return c || "messenger";
}

async function callLLM(args: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      temperature: args.temperature ?? 0.4,
      max_tokens: args.maxTokens ?? 320,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${JSON.stringify(data)}`);
  return String(data?.choices?.[0]?.message?.content ?? "");
}

function tryParseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    const m =
      text.match(/```json\s*([\s\S]*?)\s*```/i) ||
      text.match(/```\s*([\s\S]*?)\s*```/);
    if (!m?.[1]) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }
}

function parseMaybeJson(text: string): any | null {
  const raw = safeStr(text, "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function sendToMeta(args: {
  graphVersion: string;
  pageAccessToken: string;
  recipientId: string;
  text: string;
}) {
  const url = new URL(`https://graph.facebook.com/${args.graphVersion}/me/messages`);
  url.searchParams.set("access_token", args.pageAccessToken);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: args.recipientId },
      message: { text: args.text },
    }),
  });

  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

function normalizeSecretValue(raw: string) {
  const v = safeStr(raw, "").trim();
  if (!v) return "";
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function defaultSystemPrompt() {
  return `
Eres una recepcionista humana de una clínica dental en Honduras. Hablas español natural.
Objetivo: ayudar rápido, sonar cálida y cerrar cita cuando aplica.

Reglas:
- Respuestas cortas (1 a 3 oraciones).
- Máximo 1 pregunta por respuesta.
- Saluda solo si el lead no ha sido saludado (slots.greeted=false).
- Nunca repitas la misma pregunta dos veces seguidas.
- Nunca inventes datos ni números.
- Solo menciona números si vienen del inbound actual o de state.slots del mismo lead.
- Si detectas intención de recordatorios/citas/agendar, usa CTA suave al Trial.
- No incluyas links/URLs en tu reply.

Devuelve SOLO JSON:
{
  "intent": "appointment|pricing|faq|handoff|other",
  "reply": "texto",
  "question_tag": "ask_owner|ask_volume|ask_goal|cta_connect|none",
  "recommended_plan": "starter|growth|pro|null",
  "action": "cta_trial|continue",
  "slots_patch": {},
  "state_patch": {}
}
`.trim();
}

const SYSTEM_PROMPT_CREATYV = `
Eres asesor comercial B2B de DentalConnect.
No hablas como clínica ni recepcionista.
Objetivo: calificar operación, detectar dolor principal y guiar a demo/trial.
Responde corto (1-3 oraciones), una sola pregunta por turno.
Devuelve SOLO JSON válido con el formato esperado.
`.trim();

const SYSTEM_PROMPT_DENTAL = `
Eres recepcionista de clínica dental.
Objetivo: ayudar al paciente y avanzar a agendar.
Responde corto (1-3 oraciones), una sola pregunta por turno.
Devuelve SOLO JSON válido con el formato esperado.
`.trim();

function buildUserPrompt(args: {
  clinic: Json;
  leadState: Json;
  recent: Array<{ role: "user" | "assistant"; content: string }>;
  inboundText: string;
}) {
  return `
CLINIC_CONTEXT:
${JSON.stringify(args.clinic ?? {})}

LEAD_STATE:
${JSON.stringify(args.leadState ?? {})}

RECENT_TURNS:
${args.recent.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

INBOUND:
${args.inboundText}
`.trim();
}

const YES_WORDS = ["si", "sí", "yo", "ambos", "recepcionista", "asistente", "dueño", "owner"];
const RECEPTION_WORDS = ["recepcion", "recepción", "recepcionista", "secretaria", "secretaría"];
const OWNER_WORDS = ["yo", "dueño", "dueno", "owner", "encargado"];
const BOTH_WORDS = ["ambos", "los dos", "yo y recepcion", "yo y la recepcion"];

function norm(s: string) {
  return safeStr(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function looksLikePositiveAnswer(input: string) {
  const t = norm(input);
  return YES_WORDS.some((w) => t.includes(norm(w))) || /(^|[\s.,;:!?])(si|sí)([\s.,;:!?]|$)/.test(t);
}

function extractNumber(input: string): number | null {
  const m = norm(input).match(/\b(\d{1,5})\b/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizePlan(input: unknown): "starter" | "growth" | "pro" | null {
  const p = safeStr(input, "").trim().toLowerCase();
  if (p === "starter" || p === "growth" || p === "pro") return p;
  return null;
}

function normalizeAction(input: unknown): "cta_trial" | "continue" {
  const a = safeStr(input, "").trim().toLowerCase();
  if (a === "cta_trial") return "cta_trial";
  return "continue";
}

function buildTrialUrl(base: string, path: string, plan: string, trialDays: number) {
  const normalizedBase = safeStr(base, "").replace(/\/+$/, "");
  const normalizedPath = safeStr(path, "").startsWith("/") ? safeStr(path, "") : `/${safeStr(path, "")}`;
  return `${normalizedBase}${normalizedPath}?plan=${encodeURIComponent(plan)}&trial=${encodeURIComponent(String(trialDays))}`;
}

function resolveWhoResponds(input: string): string | null {
  const t = norm(input);
  if (RECEPTION_WORDS.some((w) => t.includes(norm(w)))) return "recepcionista";
  if (BOTH_WORDS.some((w) => t.includes(norm(w)))) return "ambos";
  if (OWNER_WORDS.some((w) => t.includes(norm(w)))) return "dueño";
  return null;
}

function deterministicTrialCTA() {
  return "Perfecto. Para activarlo: te paso el link del Trial y luego conectás Messenger en Settings. ¿Seguimos?";
}

function nextStageFromTag(current: string) {
  if (current === "ask_owner") return "qualifying";
  if (current === "ask_volume") return "qualifying";
  if (current === "ask_goal") return "cta";
  return "cta";
}

function nextQuestionTag(current: string) {
  if (current === "ask_owner") return "ask_volume";
  if (current === "ask_volume") return "ask_goal";
  if (current === "ask_goal") return "cta_connect";
  return "cta_connect";
}

function questionGuard(leadState: Json, inboundText: string) {
  const lastTag = safeStr(leadState?.last_bot_question, "");
  if (!lastTag) return null;

  const slots: Json = leadState?.slots && typeof leadState.slots === "object" ? leadState.slots : {};
  const inboundNorm = norm(inboundText);
  const alreadyHasWho = typeof slots?.who_responds === "string" && slots.who_responds.trim().length > 0;
  const hasMessagesPerDay = Number(slots?.messages_per_day ?? 0) > 0;

  if (lastTag === "ask_owner") {
    const who = resolveWhoResponds(inboundText);
    const isPositive = looksLikePositiveAnswer(inboundText);

    if ((isPositive && alreadyHasWho) || who) {
      const nextWho = who || safeStr(slots.who_responds, "");
      return {
        reply: deterministicTrialCTA(),
        question_tag: "cta_trial",
        slots_patch: {
          ...(nextWho ? { who_responds: nextWho, process_owner: nextWho } : {}),
          owner_confirmed: true,
          greeted: true,
        },
        state_patch: { stage: nextStageFromTag(lastTag) },
        intent: "appointment",
        action: "cta_trial",
        recommended_plan: "growth",
        debug: "question_guard:advance_from_ask_owner",
      };
    }
  }

  if (lastTag === "ask_volume") {
    if (hasMessagesPerDay) {
      return {
        reply:
          "Perfecto. Ya con eso te dejo listo el Trial y conectamos Messenger en Settings. ¿Seguimos?",
        question_tag: "cta_trial",
        slots_patch: { greeted: true },
        state_patch: { stage: nextStageFromTag(lastTag) },
        intent: "appointment",
        action: "cta_trial",
        recommended_plan: "growth",
        debug: "question_guard:skip_ask_volume_already_known",
      };
    }

    const n = extractNumber(inboundText);
    if (n !== null) {
      return {
        reply:
          "Excelente. Con eso te puedo dejar el flujo listo hoy. ¿Querés que activemos el Trial ahora?",
        question_tag: "cta_trial",
        slots_patch: { messages_per_day: n, greeted: true },
        state_patch: { stage: nextStageFromTag(lastTag) },
        intent: "appointment",
        action: "cta_trial",
        recommended_plan: "growth",
        debug: "question_guard:captured_messages_per_day",
      };
    }

    if (inboundNorm) {
      return {
        reply:
          "Genial. Para calibrarlo bien, decime un aproximado de mensajes por día y lo activo.",
        question_tag: "ask_volume",
        slots_patch: { greeted: true },
        state_patch: { stage: "discovering" },
        intent: "appointment",
        debug: "question_guard:ask_volume_needs_number",
      };
    }
  }

  return null;
}

function normalizeQuestionTag(tag: string) {
  const t = safeStr(tag, "").trim().toLowerCase();
  if (!t) return "none";
  return t;
}

function enforceNoRepeatTag(prevTag: string, nextTag: string) {
  const p = normalizeQuestionTag(prevTag);
  const n = normalizeQuestionTag(nextTag);
  if (!n || n === "none") return n;
  if (p && p === n) {
    if (n === "cta_trial" || n === "cta_connect") return "cta_trial";
    return nextQuestionTag(n);
  }
  return n;
}

function mergeState(prev: Json, args: {
  inboundMessageId: string;
  statePatch: Json;
  slotsPatch: Json;
  questionTag: string;
}) {
  const next: Json = {};
  const prevSlots = prev?.slots && typeof prev.slots === "object" ? prev.slots : {};
  const incomingStage = safeStr(args.statePatch?.stage, safeStr(prev?.stage, ""));

  next.stage = incomingStage || "discovering";
  next.slots = { ...prevSlots, ...(args.slotsPatch ?? {}) };
  next.last_bot_question = normalizeQuestionTag(args.questionTag || safeStr(prev?.last_bot_question, ""));
  next.last_seen_inbound_mid = args.inboundMessageId || safeStr(prev?.last_seen_inbound_mid, "");
  next.last_seen_inbound_provider_mid =
    args.inboundMessageId || safeStr(prev?.last_seen_inbound_provider_mid, safeStr(prev?.last_seen_inbound_mid, ""));

  return next;
}

function guardGreeting(slots: Json, reply: string) {
  const greeted = Boolean(slots?.greeted);
  if (!greeted) return reply;
  return reply.replace(/^(hola|buenas|buen día|buen dia|qué tal|que tal)[,!\s]*/i, "").trim() || reply;
}

function capOneQuestion(text: string) {
  const t = safeStr(text, "").trim();
  if (!t) return t;
  const firstQ = t.indexOf("?");
  if (firstQ < 0) return t;
  const rest = t.slice(firstQ + 1).replace(/\?/g, ".").trim();
  return `${t.slice(0, firstQ + 1)}${rest ? ` ${rest}` : ""}`.trim();
}

function ensureSlotTypes(slotsPatch: Json, currentSlots: Json, inboundText: string) {
  const next = { ...(slotsPatch ?? {}) };
  if ("messages_per_day" in next) {
    const n = Number(next.messages_per_day);
    if (!Number.isFinite(n) || n <= 0) {
      const extracted = extractNumber(inboundText);
      if (extracted !== null) next.messages_per_day = extracted;
      else if (Number(currentSlots?.messages_per_day ?? 0) > 0) delete next.messages_per_day;
      else delete next.messages_per_day;
    }
  }
  return next;
}

function ctaFromIntent(intent: string) {
  const i = safeStr(intent, "").toLowerCase();
  if (i.includes("appointment") || i.includes("pricing") || i.includes("other")) {
    return {
      tag: "cta_trial",
      text: "Si querés, te paso el link del Trial y lo activamos ahora mismo.",
    };
  }
  return { tag: "none", text: "" };
}

function isOperatorOutboundJob(job: any) {
  const source = safeStr(job?.payload?.source, "").toLowerCase();
  const actor = safeStr(job?.actor, "").toLowerCase();
  const role = safeStr(job?.role, "").toLowerCase();
  return source.includes("operator") || source.includes("manual") || actor === "human" || role === "operator";
}

function containsAny(input: string, words: string[]) {
  const t = safeStr(input, "").toLowerCase();
  return words.some((w) => t.includes(w));
}

function resolveMode(args: {
  organizationId: string;
  leadState: Json;
  inboundText: string;
}) {
  if (args.organizationId === "clinic-demo") return "dental_clinic";
  const existing = safeStr(args.leadState?.mode, "").trim();
  if (existing === "creatyv_product" || existing === "dental_clinic") return existing;
  if (safeStr(args.inboundText, "").toLowerCase().includes("#testdental")) return "dental_clinic";
  return "creatyv_product";
}

function stripTestDentalTag(input: string) {
  return safeStr(input, "").replace(/#testdental/gi, "").trim();
}

function fastPathReply(args: {
  mode: "creatyv_product" | "dental_clinic";
  inboundText: string;
  recentTurns: number;
}) {
  const inbound = safeStr(args.inboundText, "").trim().toLowerCase();
  const lowInbound = [
    "no me escriben",
    "no recibo mensajes",
    "nadie me escribe",
    "no llegan mensajes",
    "no tengo mensajes",
  ].some((k) => inbound.includes(k));

  if (args.mode === "creatyv_product" && lowInbound) {
    return {
      reply:
        "Te propongo un plan rápido: anuncio click-to-message, CTA claro en perfil y oferta simple en historias/comentarios para llevar a DM. ¿Qué presupuesto mensual tenés para anuncios y qué zona/servicio querés priorizar primero?",
      question_tag: "ask_budget_area_service",
      intent: "low_inbound_messages",
    };
  }

  const greeting = /^(hola|buenas|hello|hi|buen dia|buen día|que tal|qué tal)[.!?\s]*$/.test(inbound);
  if (greeting && args.recentTurns <= 1) {
    if (args.mode === "creatyv_product") {
      return {
        reply: "¡Hola! Te ayudo con DentalConnect. ¿Te llegan mensajes por WhatsApp, Messenger o IG y qué se te complica más hoy?",
        question_tag: "ask_channel_pain",
        intent: "intro",
      };
    }
    return {
      reply: "¡Hola! Con gusto te ayudo. ¿Qué servicio dental te interesa y para cuándo lo necesitás?",
      question_tag: "ask_service_date",
      intent: "intro",
    };
  }

  if (args.mode === "creatyv_product" && containsAny(inbound, ["whatsapp", "messenger", "instagram", "ig", "seguimiento", "agendar"])) {
    return {
      reply: "Perfecto, eso lo cubrimos. ¿Cuántos mensajes reciben al día aproximadamente para ajustar el flujo?",
      question_tag: "ask_volume",
      intent: "qualification",
    };
  }

  if (args.mode === "dental_clinic" && containsAny(inbound, ["limpieza", "brackets", "endodoncia", "agendar", "cita"])) {
    return {
      reply: "Excelente. ¿Qué día y horario te conviene para coordinar tu cita?",
      question_tag: "ask_schedule",
      intent: "appointment",
    };
  }

  return null;
}

async function sendMessage(args: {
  channel: string;
  graphVersion: string;
  pageAccessToken: string;
  recipientId: string;
  text: string;
}) {
  const channel = normalizeChannel(args.channel);
  if (channel === "messenger") {
    return await sendToMeta({
      graphVersion: args.graphVersion,
      pageAccessToken: args.pageAccessToken,
      recipientId: args.recipientId,
      text: args.text,
    });
  }
  if (channel === "whatsapp") throw new Error("not_implemented:channel_whatsapp");
  if (channel === "instagram") throw new Error("not_implemented:channel_instagram");
  throw new Error(`unsupported_channel:${channel}`);
}

async function loadOrgSecretWithFallback(
  supabase: ReturnType<typeof createClient>,
  organizationId: string
) {
  const selects = [
    'meta_page_id, meta_page_access_token, "META_PAGE_ACCESS_TOKEN"',
    'meta_page_access_token, "META_PAGE_ACCESS_TOKEN"',
    '"META_PAGE_ACCESS_TOKEN"',
  ];

  for (const sel of selects) {
    const r = await supabase
      .from("org_secrets")
      .select(sel)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!r.error) return r.data as Json | null;

    const isSchemaCache = r.error.message.includes("schema cache") && r.error.message.includes("Could not find");
    if (!isSchemaCache) break;
  }

  return null;
}

async function loadOrgSecretsKV(
  supabase: ReturnType<typeof createClient>,
  organizationId: string
) {
  const keys = ["META_PAGE_ACCESS_TOKEN", "META_PAGE_ID", "META_GRAPH_VERSION"];
  const res = await supabase
    .from("org_secrets")
    .select("key, value")
    .eq("organization_id", organizationId)
    .in("key", keys);

  const kv: Record<string, string> = {};
  if (!res.error && Array.isArray(res.data)) {
    for (const row of res.data as any[]) {
      const k = safeStr(row?.key, "").trim();
      const v = normalizeSecretValue(safeStr(row?.value, ""));
      if (k) kv[k] = v;
    }
  }
  return kv;
}

async function claimJobsViaRpc(args: {
  supabase: ReturnType<typeof createClient>;
  organizationId: string;
  limit: number;
  lockOwner: string;
  lockTtlSeconds: number;
}) {
  const res = await args.supabase.rpc("claim_reply_outbox_jobs_v2", {
    p_org_id: args.organizationId,
    p_limit: args.limit,
    p_lock_owner: args.lockOwner,
    p_lock_ttl_seconds: args.lockTtlSeconds,
  });
  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const expected = env("RUN_REPLIES_SECRET");
    const provided = req.headers.get("x-run-replies-secret") ?? "";
    if (!provided || provided !== expected) return j(401, { ok: false, error: "unauthorized" });

    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
    const OPENAI_API_KEY = env("OPENAI_API_KEY");
    const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
    const DEFAULT_META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v19.0";
    const DEFAULT_ORG = Deno.env.get("DEFAULT_ORG") ?? "clinic-demo";

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const executionId = crypto.randomUUID();
    const workerId = `run-replies:${executionId}`;

    const url = new URL(req.url);
    const body = req.headers.get("content-type")?.includes("application/json")
      ? await req.json().catch(() => ({}))
      : {};

    const organization_id =
      safeStr(body?.organization_id, "") ||
      safeStr(url.searchParams.get("organization_id"), "") ||
      DEFAULT_ORG;

    if (!organization_id) return j(400, { ok: false, error: "missing_organization_id" });

    let pageAccessToken = normalizeSecretValue(Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? "");
    let metaGraphVersion = DEFAULT_META_GRAPH_VERSION;
    let systemPrompt = defaultSystemPrompt();

    const kvSecrets = await loadOrgSecretsKV(supabase, organization_id);
    pageAccessToken = safeStr(kvSecrets.META_PAGE_ACCESS_TOKEN, pageAccessToken) || pageAccessToken;
    metaGraphVersion = safeStr(kvSecrets.META_GRAPH_VERSION, metaGraphVersion) || metaGraphVersion;

    const sec = await loadOrgSecretWithFallback(supabase, organization_id);
    if (sec) {
      const token =
        normalizeSecretValue(safeStr((sec as any).meta_page_access_token, "")) ||
        normalizeSecretValue(safeStr((sec as any).META_PAGE_ACCESS_TOKEN, ""));
      if (token) pageAccessToken = safeStr(token, pageAccessToken);
    }

    let clinicCtx: Json = {
      name: "Clínica",
      phone: "",
      address: "",
      google_maps_url: "",
      hours: null,
      services: [],
      faqs: [],
      policies: {},
      emergency: "",
    };
    let appBaseUrl = Deno.env.get("PUBLIC_APP_URL") ?? "https://dental.creatyv.io";
    let signupPath = "/signup";
    let trialDays = 14;
    const os = await supabase
      .from("organization_settings")
      .select("organization_id, app_base_url, signup_path, trial_days, system_prompt, prompt_format")
      .eq("organization_id", organization_id)
      .maybeSingle();
    const legacyOs = os.data
      ? null
      : await supabase
          .from("org_settings")
          .select(
            "organization_id, brand_name, phone, address, google_maps_url, hours, services, faqs, policies, emergency, system_prompt, app_base_url, signup_path, trial_days"
          )
          .eq("organization_id", organization_id)
          .maybeSingle();
    const settingsData = (os.data ?? legacyOs?.data ?? null) as any;
    if (settingsData) {
      clinicCtx = { ...clinicCtx, ...settingsData };
      const systemPromptRaw = safeStr(settingsData.system_prompt, "");
      const parsedPrompt = parseMaybeJson(systemPromptRaw);
      const promptFromJson = safeStr(parsedPrompt?.prompt, "") || safeStr(parsedPrompt?.system, "");
      const resolvedPrompt = promptFromJson || systemPromptRaw;
      if (resolvedPrompt.trim()) systemPrompt = resolvedPrompt.trim();
      appBaseUrl = safeStr(settingsData.app_base_url, appBaseUrl) || appBaseUrl;
      signupPath = safeStr(settingsData.signup_path, signupPath) || signupPath;
      const td = Number(settingsData.trial_days ?? trialDays);
      if (Number.isFinite(td) && td > 0 && td <= 365) trialDays = td;
    }
    const osCfg = settingsData
      ? { error: null, data: settingsData }
      : await supabase
          .from("org_settings")
          .select("app_base_url, signup_path, trial_days")
          .eq("organization_id", organization_id)
          .maybeSingle();
    if (!osCfg.error && osCfg.data) {
      appBaseUrl = safeStr((osCfg.data as any).app_base_url, appBaseUrl) || appBaseUrl;
      signupPath = safeStr((osCfg.data as any).signup_path, signupPath) || signupPath;
      const td = Number((osCfg.data as any).trial_days ?? trialDays);
      if (Number.isFinite(td) && td > 0 && td <= 365) trialDays = td;
    }

    const limit = Math.max(1, Math.min(Number(body?.limit ?? 10) || 10, 50));
    const lockTtlSeconds = Math.max(30, Math.min(Number(body?.lock_ttl_seconds ?? 60) || 60, 1800));
    const staleLockCutoff = new Date(Date.now() - lockTtlSeconds * 1000).toISOString();
    const reclaimRes = await supabase
      .from("reply_outbox")
      .update({
        status: "queued",
        locked_at: null,
        locked_by: null,
        claimed_at: null,
        claimed_by: null,
        last_error: "reclaimed:processing_ttl_expired",
        updated_at: nowIso(),
      })
      .eq("organization_id", organization_id)
      .eq("status", "processing")
      .lte("locked_at", staleLockCutoff)
      .select("id");
    const reclaimedCount = reclaimRes.error ? 0 : reclaimRes.data?.length ?? 0;
    const claimRes = await claimJobsViaRpc({
      supabase,
      organizationId: organization_id,
      limit,
      lockOwner: workerId,
      lockTtlSeconds,
    });
    if (claimRes.error) {
      return j(500, { ok: false, error: `claim_rpc_failed:${claimRes.error.message}` });
    }
    const jobs = Array.isArray(claimRes.data) ? claimRes.data : [];
    logEvent("run_replies_claimed", {
      execution_id: executionId,
      organization_id,
      claimed: jobs.length,
      reclaimed_processing: reclaimedCount,
      worker_id: workerId,
      lock_ttl_seconds: lockTtlSeconds,
    });
    if (!jobs.length)
      return j(200, {
        ok: true,
        execution_id: executionId,
        org_id: organization_id,
        claimed_count: 0,
        sent_count: 0,
        failed_count: 0,
        skipped_count: 0,
        job_ids: [],
        sample_job_ids: [],
        reclaimed_processing: reclaimedCount,
      });

    let claimed = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const failures: Array<{ id: string; error: string }> = [];
    const skipped_reasons: Array<{ id: string; reason: string; details?: string }> = [];
    const sampleJobIds: string[] = [];

    for (const job of jobs) {
      const jobId = safeStr(job.id);
      sampleJobIds.push(jobId);
      const traceId = safeStr((job.payload as Json | null)?.trace_id, "") || crypto.randomUUID();
      logEvent("run_replies_job_start", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id,
        lead_id: safeStr(job.lead_id, ""),
        job_id: jobId,
        channel: safeStr(job.channel, ""),
        channel_user_id: safeStr(job.channel_user_id, ""),
        inbound_provider_message_id: safeStr(job.inbound_provider_message_id, ""),
        inbound_message_id: safeStr(job.inbound_message_id, ""),
        status: safeStr(job.status, ""),
      });
      logEvent("run_replies_status_transition", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id,
        lead_id: safeStr(job.lead_id, ""),
        job_id: jobId,
        from: safeStr(job.status, ""),
        to: "processing",
      });
      claimed++;

      let currentAttemptCount = Number((job as any).attempt_count ?? 0);
      try {
        const channel = normalizeChannel(safeStr(job.channel, "messenger"));
        if (channel !== "messenger") {
          throw new Error(`unsupported_channel:${channel}`);
        }
        const recipientId =
          safeStr(job.channel_user_id, "") ||
          safeStr(job.recipient_id, "") ||
          safeStr(job.psid, "");
        const leadId = safeStr(job.lead_id, "");
        const inboundText = clampText(
          safeStr(job.inbound_text, "") ||
            safeStr(job.text, "") ||
            ""
        );
        const inboundProviderMessageId = safeStr(job.inbound_provider_message_id, "");

        if (!recipientId) throw new Error("missing_recipient_id: channel_user_id/psid");
        const attemptBump = await supabase
          .from("reply_outbox")
          .update({
            attempt_count: currentAttemptCount + 1,
            updated_at: nowIso(),
          })
          .eq("id", jobId)
          .eq("status", "processing")
          .select("attempt_count")
          .maybeSingle();
        if (!attemptBump.error && attemptBump.data) {
          currentAttemptCount = Number((attemptBump.data as any).attempt_count ?? currentAttemptCount + 1);
        } else {
          currentAttemptCount += 1;
        }
        let resolvedInboundText =
          safeStr(job.message_text, "") ||
          safeStr((job.payload as Json | null)?.text, "") ||
          inboundText;
        if (!resolvedInboundText && safeStr(job.inbound_message_id, "")) {
          const inboundMsg = await supabase
            .from("messages")
            .select("content")
            .eq("id", safeStr(job.inbound_message_id, ""))
            .maybeSingle();
          if (!inboundMsg.error && inboundMsg.data) {
            resolvedInboundText = safeStr((inboundMsg.data as any).content, "");
          }
        }

        if (!resolvedInboundText) throw new Error("missing_inbound_text: inbound_text/message_text/messages.content");
        if (!pageAccessToken || pageAccessToken.length <= 50) throw new Error("missing_or_invalid_page_token");

        let leadState: Json = {};
        let leadLastMessageAt: string | null = null;
        if (leadId) {
          const ld = await supabase.from("leads").select("state,last_message_at").eq("id", leadId).maybeSingle();
          if (!ld.error && ld.data?.state) leadState = (ld.data.state as Json) ?? {};
          if (!ld.error && ld.data?.last_message_at) leadLastMessageAt = safeStr((ld.data as any).last_message_at, "") || null;
        }

        const resetByTopic = /(otro tema|otra cosa|cambiando tema|nuevo tema)/i.test(resolvedInboundText);
        const resetByTime =
          !!leadLastMessageAt &&
          Date.now() - new Date(leadLastMessageAt).getTime() > 12 * 60 * 60 * 1000;
        if (resetByTopic || resetByTime) {
          leadState = {
            ...leadState,
            stage: "intro",
            intent: "new_topic",
            last_question_id: null,
            last_bot_question: null,
            last_bot_question_repeat_count: 0,
          };
        }

        const lastSeenInboundProviderMid =
          safeStr(leadState?.last_seen_inbound_provider_mid, "") || safeStr(leadState?.last_seen_inbound_mid, "");
        if (inboundProviderMessageId && lastSeenInboundProviderMid === inboundProviderMessageId) {
          const reason = "deduped_inbound_mid";
          skipped++;
          skipped_reasons.push({ id: jobId, reason });
          logEvent("run_replies_job_skipped", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id,
            lead_id: leadId,
            job_id: jobId,
            reason,
          });
          failures.push({ id: jobId, error: `skipped:${reason}` });
          await supabase
            .from("reply_outbox")
            .update({
              status: "skipped",
              claimed_at: null,
              claimed_by: null,
              locked_at: null,
              locked_by: null,
              last_error: `skipped:${reason}`,
              updated_at: nowIso(),
            })
            .eq("id", jobId);
          continue;
        }

        let recent: Array<{ role: "user" | "assistant"; content: string }> = [];
        if (leadId) {
          const ms = await supabase
            .from("messages")
            .select("role, content, created_at")
            .eq("lead_id", leadId)
            .order("created_at", { ascending: false })
            .limit(12);
          if (!ms.error && Array.isArray(ms.data)) {
            recent = ms.data
              .map((r: any) => {
                const role = safeStr(r.role, "").toLowerCase();
                const content = clampText(safeStr(r.content, ""));
                if (!content) return null;
                const normalizedRole =
                  role === "assistant" || role === "bot" ? ("assistant" as const) : ("user" as const);
                return { role: normalizedRole, content };
              })
              .filter(Boolean)
              .reverse() as Array<{ role: "user" | "assistant"; content: string }>;
            if (recent.length > 8) recent = recent.slice(recent.length - 8);
          }
        }

        const operatorOutbound = isOperatorOutboundJob(job);
        const guard = operatorOutbound ? null : questionGuard(leadState, resolvedInboundText);
        const currentSlots: Json =
          leadState?.slots && typeof leadState.slots === "object" ? leadState.slots : {};
        let debugNote: string | null = null;
        const mode = resolveMode({
          organizationId: organization_id,
          leadState,
          inboundText: resolvedInboundText,
        }) as "creatyv_product" | "dental_clinic";
        const inboundForAI = stripTestDentalTag(resolvedInboundText);

        let reply = "";
        let intent = "other";
        let questionTag = "";
        let statePatch: Json = {};
        let slotsPatch: Json = {};
        let recommendedPlan: "starter" | "growth" | "pro" | null = null;
        let action: "cta_trial" | "continue" = "continue";

        if (operatorOutbound) {
          reply = clampText(resolvedInboundText, 950);
          intent = "other";
          questionTag = safeStr(leadState?.last_bot_question, "none");
          debugNote = "operator_outbound";
        } else if (guard) {
          reply = guard.reply;
          intent = guard.intent;
          questionTag = guard.question_tag;
          statePatch = guard.state_patch;
          slotsPatch = guard.slots_patch;
          recommendedPlan = normalizePlan(guard.recommended_plan);
          action = normalizeAction(guard.action);
          debugNote = safeStr(guard.debug, "question_guard_applied");
        } else {
          const fast = fastPathReply({
            mode,
            inboundText: inboundForAI,
            recentTurns: recent.length,
          });
          if (fast) {
            reply = fast.reply;
            questionTag = fast.question_tag;
            intent = safeStr((fast as any).intent, "other");
            debugNote = "fast_path";
          }
        }

        if (!operatorOutbound && !reply) {
          systemPrompt = mode === "dental_clinic" ? SYSTEM_PROMPT_DENTAL : SYSTEM_PROMPT_CREATYV;
          const userPrompt = buildUserPrompt({
            clinic: clinicCtx,
            leadState,
            recent,
            inboundText: inboundForAI || "(sin texto)",
          });

          const raw = await callLLM({
            apiKey: OPENAI_API_KEY,
            model: OPENAI_MODEL,
            system: systemPrompt,
            user: userPrompt,
            temperature: 0.5,
            maxTokens: 320,
          });
          const parsed = tryParseJson(raw);
          reply = clampText(safeStr(parsed?.reply, ""), 950);
          intent = safeStr(parsed?.intent, "other");
          questionTag = safeStr(parsed?.question_tag, "");
          recommendedPlan = normalizePlan(parsed?.recommended_plan);
          action = normalizeAction(parsed?.action);
          statePatch = parsed?.state_patch && typeof parsed.state_patch === "object" ? parsed.state_patch : {};
          slotsPatch = parsed?.slots_patch && typeof parsed.slots_patch === "object" ? parsed.slots_patch : {};
          if (!reply) throw new Error(`LLM missing reply. raw=${raw.slice(0, 160)}...`);
        }

        const prevTag = safeStr(leadState?.last_question_id, "") || safeStr(leadState?.last_bot_question, "");
        const rawTag = normalizeQuestionTag(questionTag);
        questionTag = enforceNoRepeatTag(prevTag, questionTag);
        if (rawTag && rawTag === normalizeQuestionTag(prevTag) && questionTag !== rawTag) {
          debugNote = "question_guard:anti_repeat_advanced";
        }

        slotsPatch = ensureSlotTypes(slotsPatch, currentSlots, resolvedInboundText);
        slotsPatch.greeted = true;
        reply = capOneQuestion(
          guardGreeting({ ...currentSlots, ...slotsPatch }, clampText(stripUrls(reply), 950))
        );

        if (!guard && prevTag && normalizeQuestionTag(questionTag) === normalizeQuestionTag(prevTag)) {
          const fallback = ctaFromIntent(intent);
          if (fallback.text) {
            reply = fallback.text;
            questionTag = fallback.tag;
            action = "cta_trial";
            recommendedPlan = recommendedPlan ?? "growth";
            debugNote = "question_guard:forced_cta_on_repeat_tag";
          }
        }

        const nextRepeatCount =
          normalizeQuestionTag(prevTag) === normalizeQuestionTag(questionTag)
            ? Number(leadState?.last_bot_question_repeat_count ?? 0) + 1
            : 0;
        if (!operatorOutbound && nextRepeatCount >= 2) {
          reply = "Para avanzar rápido: ya tengo lo esencial. ¿Querés que lo dejemos activo hoy o prefieres una demo corta primero?";
          questionTag = "cta_connect";
          debugNote = "question_guard:forced_progress_after_repeat";
        }

        if (!operatorOutbound && action === "cta_trial") {
          const plan = recommendedPlan ?? normalizePlan(currentSlots?.recommended_plan) ?? "growth";
          const ctaUrl = buildTrialUrl(appBaseUrl, signupPath, plan, trialDays);
          reply = `Perfecto. Aquí tenés tu prueba gratis de ${trialDays} días: ${ctaUrl}`;
          slotsPatch.recommended_plan = plan;
          slotsPatch.last_cta_url = ctaUrl;
          debugNote = debugNote ?? "cta_trial_url_injected";
        }
        if (!reply) {
          reply = "Perfecto, seguimos. Contame y te ayudo con el siguiente paso.";
        }

        const nextState = mergeState(leadState, {
          inboundMessageId: inboundProviderMessageId,
          statePatch,
          slotsPatch,
          questionTag,
        });
        nextState.last_bot_question_repeat_count = nextRepeatCount;
        nextState.mode = mode;
        nextState.intent = intent;
        nextState.last_question_id = questionTag;
        nextState.last_seen_inbound_mid = inboundProviderMessageId || nextState.last_seen_inbound_mid || null;

        if (leadId && !operatorOutbound) await supabase.from("leads").update({ state: nextState }).eq("id", leadId);

        let outbound_message_id = safeStr((job.payload as Json | null)?.ui_message_id, "") || null;
        if (!operatorOutbound) {
          const outMsgInsert = await supabase
            .from("messages")
            .insert({
              organization_id,
              lead_id: leadId || null,
              channel,
              role: "assistant",
              actor: "bot",
              content: reply,
              provider_message_id: null,
              inbound_message_id: null,
              created_at: nowIso(),
            })
            .select("id")
            .maybeSingle();
          outbound_message_id = outMsgInsert.data?.id ?? null;
        }

        logEvent("run_replies_meta_send_attempt", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id,
          lead_id: leadId,
          job_id: jobId,
          channel,
          endpoint: `https://graph.facebook.com/${metaGraphVersion}/me/messages`,
        });
        const metaResp = await sendMessage({
          channel,
          graphVersion: metaGraphVersion,
          pageAccessToken,
          recipientId,
          text: reply,
        });
        logEvent("run_replies_meta_send_result", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id,
          lead_id: leadId,
          job_id: jobId,
          http_status: metaResp?.status ?? null,
          body_snippet: JSON.stringify(metaResp?.data ?? {}).slice(0, 500),
        });
        if (!metaResp?.ok) {
          throw new Error(`meta_send_failed:${metaResp?.status}:${JSON.stringify(metaResp?.data ?? {})}`);
        }

        await supabase
          .from("reply_outbox")
          .update({
            status: "sent",
            sent_at: nowIso(),
            outbound_message_id,
            meta_message_id: metaResp?.data?.message_id ?? null,
            provider_payload: {
              message_id: metaResp?.data?.message_id ?? null,
              recipient_id: metaResp?.data?.recipient_id ?? null,
              status: metaResp?.status ?? 200,
            },
            locked_at: null,
            locked_by: null,
            claimed_at: null,
            claimed_by: null,
            last_error: debugNote ? `debug:${debugNote}` : null,
            payload: {
              ...((job.payload as Json | null) ?? {}),
              trace_id: traceId,
            },
          })
          .eq("id", jobId);
        if (leadId && metaResp?.data?.message_id) {
          await supabase.from("leads").update({ last_reply_outbound_mid: String(metaResp.data.message_id) }).eq("id", leadId);
        }
        if (outbound_message_id && metaResp?.data?.message_id) {
          await supabase
            .from("messages")
            .update({ provider_message_id: String(metaResp.data.message_id) })
            .eq("id", outbound_message_id);
        }
        if (leadId) {
          await supabase
            .from("leads")
            .update({
              last_message_at: nowIso(),
              last_message_preview: safeStr(reply, "").slice(0, 140),
            })
            .eq("id", leadId);
        }
        logEvent("run_replies_job_sent", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id,
          lead_id: leadId,
          job_id: jobId,
          outbound_message_id,
          meta_message_id: metaResp?.data?.message_id ?? null,
          meta_http_status: metaResp?.status ?? 200,
          meta_response: JSON.stringify(metaResp?.data ?? {}).slice(0, 500),
          channel,
        });
        sent++;
      } catch (e: any) {
        const msg = safeStr(e?.message, String(e));
        const retryableStatus = parseMetaStatus(msg);
        const isRetryable =
          msg.includes("meta_send_failed:429") ||
          msg.includes("meta_send_failed:500") ||
          msg.includes("meta_send_failed:502") ||
          msg.includes("meta_send_failed:503") ||
          msg.includes("fetch failed") ||
          msg.includes("network") ||
          retryableStatus === 429 ||
          (retryableStatus !== null && retryableStatus >= 500);
        const nextAttemptCount = Math.max(1, currentAttemptCount || Number((job as any).attempt_count ?? 1));
        const maxRetries = Number(Deno.env.get("RUN_REPLIES_MAX_RETRIES") ?? 8);
        const delaySec = backoffSeconds(nextAttemptCount);
        const retryAt = plusSecondsIso(delaySec);
        const shouldRetry = isRetryable && nextAttemptCount < maxRetries;
        const terminalDead = nextAttemptCount >= maxRetries;

        failures.push({ id: safeStr(job.id), error: msg });
        failed++;
        await supabase
          .from("reply_outbox")
          .update({
            status: shouldRetry ? "pending" : terminalDead ? "dead" : "failed",
            scheduled_for: shouldRetry ? retryAt : safeStr((job as any).scheduled_for, nowIso()),
            last_error: msg,
            locked_at: null,
            locked_by: null,
            claimed_at: null,
            claimed_by: null,
            updated_at: nowIso(),
            payload: {
              ...(((job as any).payload as Json | null) ?? {}),
              trace_id: traceId,
              retry_backoff_seconds: delaySec,
              retryable: shouldRetry,
            },
          })
          .eq("id", safeStr(job.id));
        logEvent("run_replies_job_failed", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id,
          lead_id: safeStr((job as any).lead_id, ""),
          job_id: safeStr(job.id),
          error: msg,
          stack: toErrorStack(e),
          retryable: shouldRetry,
          terminal_dead: terminalDead,
          retry_at: shouldRetry ? retryAt : null,
        });
        if (terminalDead) {
          await supabase.from("alerts").insert({
            organization_id,
            type: "reply_job_dead",
            severity: "error",
            title: "Reply job moved to dead-letter",
            body: `job ${safeStr(job.id)} reached max attempts`,
            action: {
              job_id: safeStr(job.id),
              lead_id: safeStr((job as any).lead_id, ""),
              attempt_count: nextAttemptCount,
              last_error: msg.slice(0, 500),
            },
            status: "open",
          });
        }
      }
    }

    logEvent("run_replies_summary", {
      execution_id: executionId,
      organization_id,
      worker_id: workerId,
      claimed,
      sent,
      failed,
      skipped,
      failures: failures.length,
    });
    return j(200, {
      ok: true,
      execution_id: executionId,
      org_id: organization_id,
      claimed_count: claimed,
      sent_count: sent,
      failed_count: failed,
      skipped_count: skipped,
      job_ids: sampleJobIds,
      sample_job_ids: sampleJobIds.slice(0, 10),
      reclaimed_processing: reclaimedCount,
      failures,
      skipped_reasons,
    });
  } catch (e: any) {
    return j(500, { ok: false, error: safeStr(e?.message, String(e)) });
  }
});
