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
Eres una recepcionista HUMANA de una clínica dental en Honduras. Hablas español hondureño natural.
Objetivo: ayudar rápido y cerrar cita cuando aplica.

Reglas:
- 1 a 3 oraciones, claras.
- NO repitas la misma pregunta dos veces seguidas.
- NO inventes datos de clínica.
- Si no hay respuesta clara, ofrece CTA de continuación.

Devuelve SOLO JSON:
{
  "intent": "appointment|pricing|faq|handoff|other",
  "reply": "texto",
  "question_tag": "ask_owner|ask_volume|ask_goal|cta_connect|none",
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

function norm(s: string) {
  return safeStr(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function looksLikePositiveAnswer(input: string) {
  const t = norm(input);
  return YES_WORDS.some((w) => t.includes(norm(w)));
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
  const lastAskedAt = safeStr(leadState?.last_bot_question_at, "");
  const lastAskedAtMs = lastAskedAt ? new Date(lastAskedAt).getTime() : 0;
  const recentlyAsked = lastAskedAtMs > 0 && Date.now() - lastAskedAtMs < 2 * 60 * 1000;

  if (lastTag === "ask_owner" && looksLikePositiveAnswer(inboundText)) {
    const inboundNorm = norm(inboundText);
    const who =
      inboundNorm.includes("recepcion") || inboundNorm.includes("asistente")
        ? "recepcionista"
        : inboundNorm.includes("amb")
        ? "ambos"
        : "dueño";
    return {
      reply:
        "Perfecto, gracias. Para calibrar bien el flujo: ¿cuántos mensajes nuevos reciben por semana?",
      question_tag: "ask_volume",
      slots_patch: { ...slots, who_responds: who, process_owner: who },
      state_patch: { stage: "discovering" },
      intent: "appointment",
    };
  }

  if (lastTag === "ask_volume" && inboundText.trim()) {
    return {
      reply:
        "Excelente. ¿Cuál es el objetivo principal ahora: más citas, resolver preguntas más rápido o seguimiento?",
      question_tag: "ask_goal",
      slots_patch: { ...slots, weekly_message_volume: clampText(inboundText, 80) },
      state_patch: { stage: "discovering" },
      intent: "appointment",
    };
  }

  if (lastTag === "ask_goal" && inboundText.trim()) {
    return {
      reply:
        "Perfecto. Con eso te puedo dejar el embudo listo hoy. Si querés, activo la configuración y empezamos.",
      question_tag: "cta_connect",
      slots_patch: { ...slots, main_goal: clampText(inboundText, 120) },
      state_patch: { stage: "qualifying" },
      intent: "appointment",
    };
  }

  if (recentlyAsked) {
    return {
      reply:
        "Avancemos para no repetirnos. Te propongo continuar con la configuración y dejarlo activo hoy.",
      question_tag: nextQuestionTag(lastTag),
      slots_patch: slots,
      state_patch: { stage: "qualifying" },
      intent: "other",
    };
  }

  return null;
}

function mergeState(prev: Json, args: {
  inboundMessageId: string;
  statePatch: Json;
  slotsPatch: Json;
  intent: string;
  questionTag: string;
}) {
  const next: Json = { ...(prev ?? {}) };
  const currentSlots = next?.slots && typeof next.slots === "object" ? next.slots : {};

  for (const [k, v] of Object.entries(args.statePatch ?? {})) next[k] = v;

  next.slots = { ...currentSlots, ...(args.slotsPatch ?? {}) };
  next.intent = args.intent;
  next.updated_at = nowIso();
  next.last_seen_inbound_mid = args.inboundMessageId || safeStr(next.last_seen_inbound_mid, "");
  next.last_inbound_message_id = args.inboundMessageId || safeStr(next.last_inbound_message_id, "");
  next.last_bot_question = args.questionTag || safeStr(next.last_bot_question, "");
  next.last_bot_question_at = nowIso();

  if (!next.asked || typeof next.asked !== "object") {
    next.asked = { full_name: false, phone: false, availability: false, service: false };
  }

  return next;
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
    const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v19.0";
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
    let systemPrompt = defaultSystemPrompt();

    const sec = await supabase
      .from("org_secrets")
      .select("meta_page_id, meta_page_access_token")
      .eq("organization_id", organization_id)
      .maybeSingle();
    if (!sec.error && sec.data?.meta_page_access_token) {
      pageAccessToken = safeStr(sec.data.meta_page_access_token, pageAccessToken);
      metaPageId = safeStr(sec.data.meta_page_id, "");
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

    const { data: jobs, error: qErr } = await supabase
      .from("reply_outbox")
      .select("*")
      .eq("organization_id", organization_id)
      .in("status", ["pending", "queued"])
      .order("created_at", { ascending: true })
      .limit(10);

    if (qErr) return j(500, { ok: false, error: qErr.message });
    if (!jobs?.length) return j(200, { ok: true, claimed: 0, sent: 0, skipped: 0, failures: [] });

    let claimed = 0;
    let sent = 0;
    let skipped = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const job of jobs) {
      const jobId = safeStr(job.id);
      const claim = await supabase
        .from("reply_outbox")
        .update({
          status: "processing",
          processing_started_at: nowIso(),
          attempts: (job.attempts ?? 0) + 1,
        })
        .eq("id", jobId)
        .in("status", ["pending", "queued"])
        .select("id")
        .maybeSingle();

      if (claim.error || !claim.data?.id) {
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

        if (!recipientId) throw new Error("Missing recipient id (channel_user_id/psid).");

        let leadState: Json = {};
        if (leadId) {
          const ld = await supabase.from("leads").select("state").eq("id", leadId).maybeSingle();
          if (!ld.error && ld.data?.state) leadState = (ld.data.state as Json) ?? {};
        }

        if (inboundMessageId && safeStr(leadState?.last_seen_inbound_mid, "") === inboundMessageId) {
          skipped++;
          await supabase
            .from("reply_outbox")
            .update({ status: "sent", sent_at: nowIso(), last_error: "deduped_inbound_mid" })
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

        let reply = "";
        let intent = "other";
        let questionTag = "";
        let statePatch: Json = {};
        let slotsPatch: Json = {};

        if (guard) {
          reply = guard.reply;
          intent = guard.intent;
          questionTag = guard.question_tag;
          statePatch = guard.state_patch;
          slotsPatch = guard.slots_patch;
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
          statePatch = parsed?.state_patch && typeof parsed.state_patch === "object" ? parsed.state_patch : {};
          slotsPatch = parsed?.slots_patch && typeof parsed.slots_patch === "object" ? parsed.slots_patch : {};
          if (!reply) throw new Error(`LLM missing reply. raw=${raw.slice(0, 160)}...`);
        }

        const prevTag = safeStr(leadState?.last_bot_question, "");
        const prevAskedAt = safeStr(leadState?.last_bot_question_at, "");
        const repeatTooSoon =
          questionTag &&
          prevTag === questionTag &&
          prevAskedAt &&
          Date.now() - new Date(prevAskedAt).getTime() < 2 * 60 * 1000;
        if (repeatTooSoon) {
          questionTag = nextQuestionTag(questionTag);
          reply = "Sigamos para no repetirnos. Te propongo avanzar con la configuración y activarlo hoy.";
        }

        const nextState = mergeState(leadState, {
          inboundMessageId,
          statePatch,
          slotsPatch,
          intent,
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

        if (!pageAccessToken) throw new Error("No Meta page access token configured.");
        if (!metaPageId) throw new Error("No Meta page configured in org_settings.");

        const metaResp = await sendToMeta({
          graphVersion: META_GRAPH_VERSION,
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
            last_error: null,
          })
          .eq("id", jobId);
        sent++;
      } catch (e: any) {
        const msg = safeStr(e?.message, String(e));
        failures.push({ id: safeStr(job.id), error: msg });
        await supabase
          .from("reply_outbox")
          .update({
            status: "error",
            last_error: msg,
            updated_at: nowIso(),
          })
          .eq("id", safeStr(job.id));
      }
    }

    return j(200, { ok: true, claimed, sent, skipped, failures });
  } catch (e: any) {
    return j(500, { ok: false, error: safeStr(e?.message, String(e)) });
  }
});
