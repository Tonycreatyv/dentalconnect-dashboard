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

async function sendToMeta(args: {
  graphVersion: string;
  pageAccessToken: string;
  recipientId: string;
  text: string;
}) {
  const url = `https://graph.facebook.com/${args.graphVersion}/me/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: args.recipientId },
      message: { text: args.text },
      access_token: args.pageAccessToken,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Meta error: ${res.status} ${JSON.stringify(data)}`);
  return data;
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
      const v = safeStr(row?.value, "");
      if (k) kv[k] = v;
    }
  }
  return kv;
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

    const url = new URL(req.url);
    const body = req.headers.get("content-type")?.includes("application/json")
      ? await req.json().catch(() => ({}))
      : {};

    const organization_id =
      safeStr(body?.organization_id, "") ||
      safeStr(url.searchParams.get("organization_id"), "") ||
      DEFAULT_ORG;

    if (!organization_id) return j(400, { ok: false, error: "missing_organization_id" });

    let pageAccessToken = Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? "";
    let metaPageId = "";
    let metaGraphVersion = DEFAULT_META_GRAPH_VERSION;
    let systemPrompt = defaultSystemPrompt();

    const kvSecrets = await loadOrgSecretsKV(supabase, organization_id);
    pageAccessToken = safeStr(kvSecrets.META_PAGE_ACCESS_TOKEN, pageAccessToken) || pageAccessToken;
    metaPageId = safeStr(kvSecrets.META_PAGE_ID, metaPageId) || metaPageId;
    metaGraphVersion = safeStr(kvSecrets.META_GRAPH_VERSION, metaGraphVersion) || metaGraphVersion;

    const sec = await loadOrgSecretWithFallback(supabase, organization_id);
    if (sec) {
      const token = safeStr((sec as any).meta_page_access_token, "") || safeStr((sec as any).META_PAGE_ACCESS_TOKEN, "");
      if (token) pageAccessToken = safeStr(token, pageAccessToken);
      metaPageId = safeStr((sec as any).meta_page_id, metaPageId);
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
      .from("org_settings")
      .select(
        "name, phone, address, google_maps_url, hours, services, faqs, policies, emergency, system_prompt, meta_page_id, messenger_enabled"
      )
      .eq("organization_id", organization_id)
      .maybeSingle();
    if (!os.error && os.data) {
      const { system_prompt, ...rest } = os.data as any;
      clinicCtx = { ...clinicCtx, ...rest };
      metaPageId = safeStr((os.data as any).meta_page_id, metaPageId);
      if (system_prompt && typeof system_prompt === "string" && system_prompt.trim()) {
        systemPrompt = system_prompt.trim();
      }
    }
    const osCfg = await supabase
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

    const runNow = nowIso();
    const { data: jobs, error: qErr } = await supabase
      .from("reply_outbox")
      .select("*")
      .eq("organization_id", organization_id)
      .in("status", ["pending", "queued"])
      .or(`scheduled_for.lte.${runNow},scheduled_for.is.null`)
      .is("claimed_at", null)
      .is("locked_at", null)
      .order("created_at", { ascending: true })
      .limit(10);

    if (qErr) return j(500, { ok: false, error: qErr.message });
    console.log("[run-replies] poll", { organization_id, pending: jobs?.length ?? 0 });
    if (!jobs?.length) return j(200, { ok: true, claimed: 0, sent: 0, skipped: 0, failures: [], skipped_reasons: [] });

    let claimed = 0;
    let sent = 0;
    let skipped = 0;
    const failures: Array<{ id: string; error: string }> = [];
    const skipped_reasons: Array<{ id: string; reason: string; details?: string }> = [];

    for (const job of jobs) {
      const jobId = safeStr(job.id);
      console.log("[run-replies] job:start", {
        organization_id,
        job_id: jobId,
        inbound_provider_message_id: safeStr(job.inbound_provider_message_id, ""),
        inbound_message_id: safeStr(job.inbound_message_id, ""),
        status: safeStr(job.status, ""),
      });
      const claim = await supabase
        .from("reply_outbox")
        .update({
          status: "processing",
          processing_started_at: nowIso(),
          claimed_at: nowIso(),
          locked_at: nowIso(),
          attempts: (job.attempts ?? 0) + 1,
        })
        .eq("id", jobId)
        .in("status", ["pending", "queued"])
        .or(`scheduled_for.lte.${nowIso()},scheduled_for.is.null`)
        .is("claimed_at", null)
        .is("locked_at", null)
        .select("id")
        .maybeSingle();

      if (claim.error || !claim.data?.id) {
        const reason = claim.error ? "claim_update_error" : "claim_guardrail_not_met";
        const details = claim.error?.message ?? "status/scheduled_for/claimed_at/locked_at";
        console.log("[run-replies] job:claim_skipped", {
          organization_id,
          job_id: jobId,
          reason,
          details,
        });
        skipped_reasons.push({ id: jobId, reason, details });
        skipped++;
        continue;
      }
      claimed++;

      try {
        const channel = normalizeChannel(safeStr(job.channel, "messenger"));
        const recipientId =
          safeStr(job.channel_user_id, "") ||
          safeStr(job.recipient_id, "") ||
          safeStr(job.psid, "");
        const leadId = safeStr(job.lead_id, "");
        const inboundText = clampText(
          safeStr(job.inbound_text, "") ||
            safeStr(job.text, "") ||
            safeStr(job.message_text, "") ||
            ""
        );
        const inboundMessageId =
          safeStr(job.inbound_provider_message_id, "") || safeStr(job.inbound_message_id, "");

        if (!recipientId) throw new Error("missing_recipient_id: channel_user_id/psid");
        if (!inboundText) throw new Error("missing_inbound_text: inbound_text/text/message_text");
        if (!pageAccessToken) throw new Error("missing_token: META_PAGE_ACCESS_TOKEN (org_secrets/env)");
        if (!metaPageId) throw new Error("missing_page_id: META_PAGE_ID/meta_page_id (org_secrets/org_settings)");

        let leadState: Json = {};
        if (leadId) {
          const ld = await supabase.from("leads").select("state").eq("id", leadId).maybeSingle();
          if (!ld.error && ld.data?.state) leadState = (ld.data.state as Json) ?? {};
        }

        if (inboundMessageId && safeStr(leadState?.last_seen_inbound_mid, "") === inboundMessageId) {
          const reason = "deduped_inbound_mid";
          skipped++;
          skipped_reasons.push({ id: jobId, reason });
          await supabase
            .from("reply_outbox")
            .update({ status: "sent", sent_at: nowIso(), claimed_at: nowIso(), locked_at: null, last_error: reason })
            .eq("id", jobId);
          continue;
        }

        let recent: Array<{ role: "user" | "assistant"; content: string }> = [];
        if (leadId) {
          const ms = await supabase
            .from("messages")
            .select("direction, text, body, created_at")
            .eq("lead_id", leadId)
            .order("created_at", { ascending: false })
            .limit(12);
          if (!ms.error && Array.isArray(ms.data)) {
            recent = ms.data
              .map((r: any) => {
                const dir = safeStr(r.direction, "");
                const content = clampText(safeStr(r.text, "") || safeStr(r.body, ""));
                if (!content) return null;
                return { role: dir === "outbound" ? ("assistant" as const) : ("user" as const), content };
              })
              .filter(Boolean)
              .reverse() as Array<{ role: "user" | "assistant"; content: string }>;
            if (recent.length > 8) recent = recent.slice(recent.length - 8);
          }
        }

        const guard = questionGuard(leadState, inboundText);
        const currentSlots: Json =
          leadState?.slots && typeof leadState.slots === "object" ? leadState.slots : {};
        let debugNote: string | null = null;

        let reply = "";
        let intent = "other";
        let questionTag = "";
        let statePatch: Json = {};
        let slotsPatch: Json = {};
        let recommendedPlan: "starter" | "growth" | "pro" | null = null;
        let action: "cta_trial" | "continue" = "continue";

        if (guard) {
          reply = guard.reply;
          intent = guard.intent;
          questionTag = guard.question_tag;
          statePatch = guard.state_patch;
          slotsPatch = guard.slots_patch;
          recommendedPlan = normalizePlan(guard.recommended_plan);
          action = normalizeAction(guard.action);
          debugNote = safeStr(guard.debug, "question_guard_applied");
        } else {
          const userPrompt = buildUserPrompt({
            clinic: clinicCtx,
            leadState,
            recent,
            inboundText: inboundText || "(sin texto)",
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

        const prevTag = safeStr(leadState?.last_bot_question, "");
        const rawTag = normalizeQuestionTag(questionTag);
        questionTag = enforceNoRepeatTag(prevTag, questionTag);
        if (rawTag && rawTag === normalizeQuestionTag(prevTag) && questionTag !== rawTag) {
          debugNote = "question_guard:anti_repeat_advanced";
        }

        slotsPatch = ensureSlotTypes(slotsPatch, currentSlots, inboundText);
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

        if (action === "cta_trial") {
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
          inboundMessageId,
          statePatch,
          slotsPatch,
          questionTag,
        });

        if (leadId) await supabase.from("leads").update({ state: nextState }).eq("id", leadId);

        const outMsgInsert = await supabase
          .from("messages")
          .insert({
            organization_id,
            lead_id: leadId || null,
            channel,
            direction: "outbound",
            text: reply,
            created_at: nowIso(),
          })
          .select("id")
          .maybeSingle();
        const outbound_message_id = outMsgInsert.data?.id ?? null;

        const metaResp = await sendToMeta({
          graphVersion: metaGraphVersion,
          pageAccessToken,
          recipientId,
          text: reply,
        });

        await supabase
          .from("reply_outbox")
          .update({
            status: "sent",
            sent_at: nowIso(),
            outbound_message_id,
            meta_message_id: metaResp?.message_id ?? null,
            claimed_at: nowIso(),
            locked_at: null,
            last_error: debugNote ? `debug:${debugNote}` : null,
          })
          .eq("id", jobId);
        console.log("[run-replies] job:sent", {
          organization_id,
          job_id: jobId,
          outbound_message_id,
          meta_message_id: metaResp?.message_id ?? null,
        });
        sent++;
      } catch (e: any) {
        const msg = safeStr(e?.message, String(e));
        failures.push({ id: safeStr(job.id), error: msg });
        await supabase
          .from("reply_outbox")
          .update({
            status: "failed",
            last_error: msg,
            claimed_at: nowIso(),
            locked_at: null,
            updated_at: nowIso(),
          })
          .eq("id", safeStr(job.id));
        console.log("[run-replies] job:failed", {
          organization_id,
          job_id: safeStr(job.id),
          error: msg,
        });
      }
    }

    return j(200, { ok: true, claimed, sent, skipped, processed: sent, failures, skipped_reasons });
  } catch (e: any) {
    return j(500, { ok: false, error: safeStr(e?.message, String(e)) });
  }
});
