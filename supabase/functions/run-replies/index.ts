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

/** ===== OpenAI (Chat Completions) ===== */
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
      // Forzamos JSON. (Si el modelo no lo soporta, igual parseamos fallback)
      response_format: { type: "json_object" },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`OpenAI error: ${res.status} ${JSON.stringify(data)}`);
  }
  const text = data?.choices?.[0]?.message?.content ?? "";
  return String(text);
}

function tryParseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    const m =
      text.match(/```json\s*([\s\S]*?)\s*```/i) ||
      text.match(/```\s*([\s\S]*?)\s*```/);
    if (m?.[1]) {
      try {
        return JSON.parse(m[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** ===== Meta send ===== */
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

/** ===== Default system prompt (fallback) =====
 *  Nota: si existe org_settings.system_prompt, lo usamos en vez de este.
 */
function defaultSystemPrompt() {
  return `
Eres una recepcionista HUMANA de una clínica dental en Honduras. Hablas español hondureño natural.
Objetivo: ayudar rápido, sin sonar a guion.

Estilo:
- 1 a 3 oraciones, cálidas y claras.
- Nada de “Hola, gracias por escribir…” repetido.
- Si el usuario se enoja o insiste, baja fricción: responde directo.

Reglas:
- NO inventes precios/horarios/ubicación. Usa el contexto de clínica. Si falta, pregunta lo mínimo.
- No te quedes trabado pidiendo lo mismo. Si ya pediste algo y no responde, ofrece 2 opciones concretas.
- Si pregunta por un servicio: responde SI/NO + mini detalle + siguiente paso.
- Si detectas urgencia (dolor fuerte, sangrado, hinchazón): prioriza y ofrece llamada/atención.

Salida: responde SOLO JSON válido con este formato:
{
  "intent": "appointment|pricing|faq|handoff|other",
  "reply": "texto",
  "state_patch": { "any": "json" }
}
`.trim();
}

/** ===== Construye user prompt compacto ===== */
function buildUserPrompt(args: {
  clinic: Json;
  leadState: Json;
  recent: Array<{ role: "user" | "assistant"; content: string }>;
  inboundText: string;
}) {
  const clinic = args.clinic ?? {};
  const services = Array.isArray(clinic.services) ? clinic.services : [];
  const faqs = Array.isArray(clinic.faqs) ? clinic.faqs : [];
  const hours = clinic.hours ?? null;

  return `
CLINIC_CONTEXT (fuente de verdad):
- name: ${safeStr(clinic.name, "Clínica")}
- phone: ${safeStr(clinic.phone, "")}
- address: ${safeStr(clinic.address, "")}
- google_maps_url: ${safeStr(clinic.google_maps_url, "")}
- hours_json: ${JSON.stringify(hours)}
- services_json: ${JSON.stringify(services)}
- faqs_json: ${JSON.stringify(faqs)}
- policies_json: ${JSON.stringify(clinic.policies ?? {})}
- emergency: ${safeStr(clinic.emergency, "")}

LEAD_STATE_JSON (memoria actual):
${JSON.stringify(args.leadState ?? {})}

RECENT_TURNS (últimos 8):
${args.recent.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

INBOUND_MESSAGE:
${args.inboundText}

Tarea:
- Responde natural, sin sonar pre-escrito.
- Si el lead_state.stage es "done" pero el usuario sigue preguntando, responde y reabre flujo si hace falta.
- Devuelve SOLO JSON con intent/reply/state_patch.
`.trim();
}

function mergeStatePatch(prev: Json, patch: Json, inboundMessageId?: string) {
  const next: Json = { ...(prev ?? {}) };

  // aplica patch superficial
  for (const [k, v] of Object.entries(patch ?? {})) {
    next[k] = v;
  }

  // housekeeping
  next.updated_at = nowIso();
  if (inboundMessageId) next.last_inbound_message_id = inboundMessageId;

  // garantizamos asked si no existe
  if (!next.asked || typeof next.asked !== "object") {
    next.asked = { full_name: false, phone: false, availability: false, service: false };
  }

  return next;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ===== AUTH =====
    const expected = env("RUN_REPLIES_SECRET");
    const provided = req.headers.get("x-run-replies-secret") ?? "";
    if (!provided || provided !== expected) {
      return j(401, { ok: false, error: "unauthorized" });
    }

    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
    const OPENAI_API_KEY = env("OPENAI_API_KEY");

    const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
    const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v19.0";
    const DEFAULT_ORG = Deno.env.get("DEFAULT_ORG") ?? "clinic-demo";

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // organization_id puede venir en body o query
    const url = new URL(req.url);
    const body = req.headers.get("content-type")?.includes("application/json")
      ? await req.json().catch(() => ({}))
      : {};

    const organization_id =
      safeStr(body?.organization_id, "") ||
      safeStr(url.searchParams.get("organization_id"), "") ||
      DEFAULT_ORG;

    if (!organization_id) {
      return j(400, {
        ok: false,
        error: "missing_organization_id",
        build: "2026-02-15-natural-flex-v2",
      });
    }

    // ===== Load org prompt + token =====
    let pageAccessToken = Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? "";
    let systemPrompt = defaultSystemPrompt();

    // org_secrets token
    {
      const sec = await supabase
        .from("org_secrets")
        .select("meta_page_access_token")
        .eq("organization_id", organization_id)
        .maybeSingle();

      if (!sec.error && sec.data?.meta_page_access_token) {
        pageAccessToken = sec.data.meta_page_access_token;
      }
    }

    // org_settings prompt + clinic context
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

    {
      // incluimos system_prompt si lo agregaste
      const os = await supabase
        .from("org_settings")
        .select(
          "name, phone, address, google_maps_url, hours, services, faqs, policies, emergency, system_prompt"
        )
        .eq("organization_id", organization_id)
        .maybeSingle();

      if (!os.error && os.data) {
        const { system_prompt, ...rest } = os.data as any;
        clinicCtx = { ...clinicCtx, ...rest };
        if (system_prompt && typeof system_prompt === "string" && system_prompt.trim()) {
          systemPrompt = system_prompt.trim();
        }
      }
    }

    // ===== Claim jobs =====
    const { data: jobs, error: qErr } = await supabase
      .from("reply_outbox")
      .select("*")
      .eq("organization_id", organization_id)
      .in("status", ["pending", "queued"])
      .order("created_at", { ascending: true })
      .limit(10);

    if (qErr) return j(500, { ok: false, error: qErr.message, build: "2026-02-15-natural-flex-v2" });

    if (!jobs?.length) {
      return j(200, {
        ok: true,
        claimed: 0,
        sent: 0,
        skipped: 0,
        failures: [],
        build: "2026-02-15-natural-flex-v2",
      });
    }

    let claimed = 0;
    let sent = 0;
    let skipped = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const job of jobs) {
      const jobId = safeStr(job.id);

      // claim best-effort
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

        const inboundMessageId = safeStr(job.inbound_message_id, "") || safeStr(job.inbound_provider_message_id, "");

        if (!recipientId) throw new Error("Missing recipient id (channel_user_id/psid).");

        // ===== Lead state =====
        let leadState: Json = {};
        if (leadId) {
          const ld = await supabase.from("leads").select("state").eq("id", leadId).maybeSingle();
          if (!ld.error && ld.data?.state) leadState = (ld.data.state as Json) ?? {};
        }

        // ===== recent messages =====
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
                return {
                  role: dir === "outbound" ? ("assistant" as const) : ("user" as const),
                  content,
                };
              })
              .filter(Boolean)
              .reverse() as any;

            if (recent.length > 8) recent = recent.slice(recent.length - 8);
          }
        }

        // ===== LLM =====
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
          temperature: 0.5, // más natural
          maxTokens: 320,
        });

        const parsed = tryParseJson(raw);
        const reply = clampText(safeStr(parsed?.reply, ""), 950);
        const intent = safeStr(parsed?.intent, "other");
        const state_patch =
          parsed?.state_patch && typeof parsed.state_patch === "object" ? (parsed.state_patch as Json) : {};

        if (!reply) {
          throw new Error(`LLM missing reply. raw=${raw.slice(0, 200)}...`);
        }

        // ===== Update lead state =====
        const nextState = mergeStatePatch(
          leadState,
          {
            ...state_patch,
            intent,
            last_bot_step: state_patch?.last_bot_step ?? leadState?.last_bot_step ?? null,
          },
          inboundMessageId
        );

        if (leadId) {
          await supabase.from("leads").update({ state: nextState }).eq("id", leadId);
        }

        // store outbound message
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

        // send to Meta
        if (!pageAccessToken) throw new Error("No Meta page access token configured.");

        const metaResp = await sendToMeta({
          graphVersion: META_GRAPH_VERSION,
          pageAccessToken,
          recipientId,
          text: reply,
        });

        // mark sent
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

    return j(200, {
      ok: true,
      claimed,
      sent,
      skipped,
      failures,
      build: "2026-02-15-natural-flex-v2",
    });
  } catch (e: any) {
    return j(500, { ok: false, error: safeStr(e?.message, String(e)), build: "2026-02-15-natural-flex-v2" });
  }
});