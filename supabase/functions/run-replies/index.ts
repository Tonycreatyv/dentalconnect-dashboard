// supabase/functions/run-replies/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RunPayload = {
  org?: string;
  limit?: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-run-replies-secret",
    },
  });
}

function authOk(req: Request) {
  const expected = Deno.env.get("RUN_REPLIES_SECRET") || "";
  const got = req.headers.get("x-run-replies-secret") || "";
  return expected.length > 0 && got === expected;
}

// =========================
// Router anti-tokens
// =========================
function shouldUseOpenAI(inboundText: string) {
  const t = (inboundText || "").trim().toLowerCase();
  if (!t) return false;

  // normaliza
  const cleaned = t.replace(/[^\p{L}\p{N}\s:]/gu, " ").replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter(Boolean);

  // ultra corto => NO OpenAI
  const shortKey = words.join(" ");
  const cheap = new Set([
    "hola",
    "holi",
    "hols",
    "hey",
    "buenas",
    "buenos dias",
    "buenas noches",
    "ok",
    "oka",
    "dale",
    "listo",
    "gracias",
    "si",
    "sí",
    "no",
    "aja",
    "ajá",
  ]);

  if (words.length <= 2 && (cheap.has(shortKey) || cheap.has(shortKey.replace(" ", "")))) {
    return false;
  }

  // señales claras de intención => SÍ OpenAI
  const intentHints = [
    "cita",
    "agendar",
    "turno",
    "horario",
    "hoy",
    "mañana",
    "martes",
    "miercoles",
    "miércoles",
    "jueves",
    "viernes",
    "sabado",
    "sábado",
    "domingo",
    "am",
    "pm",
    ":",
    "dolor",
    "muela",
    "caries",
    "inflam",
    "sangra",
    "limpieza",
    "extraccion",
    "extracción",
    "brackets",
    "ortodoncia",
    "blanqueamiento",
    "endodoncia",
    "precio",
    "cuanto",
    "cuánto",
    "costo",
    "vale",
  ];

  if (intentHints.some((k) => t.includes(k))) return true;

  // si es mediano/largo, normalmente vale OpenAI
  return cleaned.length >= 25 || words.length >= 5;
}

// =========================
// Plantillas (fallback)
// =========================
function fallbackReplyFromInbound(inboundText: string) {
  const t = (inboundText || "").trim().toLowerCase();
  const cleaned = t.replace(/\s+/g, " ").trim();

  if (!cleaned) return "¡Listo! ✅ ¿Me confirmas tu nombre y teléfono para ayudarte rápido?";

  // Saludos
  if (["hola", "holi", "hols", "hey", "buenas", "buenos dias", "buenas noches"].some((k) => t.includes(k))) {
    return "¡Hola! 👋 ¿Buscas agendar una cita o hacer una consulta? Si es cita: dime tu nombre y el motivo.";
  }

  // Precio / costo
  if (t.includes("precio") || t.includes("cuanto") || t.includes("cuánto") || t.includes("costo") || t.includes("vale")) {
    return "Te ayudo ✅ ¿Qué servicio necesitas (limpieza, extracción, blanqueamiento, ortodoncia) y para qué día lo quieres?";
  }

  // Dolor / urgencia
  if (t.includes("dolor") || t.includes("muela") || t.includes("inflam") || t.includes("sangra")) {
    return "Entiendo ✅ ¿Hace cuánto empezó el dolor y en qué lado es? Si quieres cita, dime 2 horarios (día + hora) y tu teléfono.";
  }

  // Cita explícita
  if (t.includes("cita") || t.includes("agendar") || t.includes("turno") || t.includes("horario")) {
    return "Perfecto ✅ Para agendar necesito: 1) nombre completo 2) teléfono 3) día y hora (o 2 opciones).";
  }

  // Servicio común
  if (t.includes("limpieza")) {
    return "Perfecto ✅ Para tu limpieza: ¿qué día y a qué hora te gustaría? (Si puedes, dime 2 opciones).";
  }
  if (t.includes("blanque")) {
    return "¡Perfecto! ✅ Para blanqueamiento: ¿qué día y hora te queda bien? También dime tu nombre y teléfono.";
  }
  if (t.includes("ortodon") || t.includes("brackets")) {
    return "Perfecto ✅ Para ortodoncia/brackets: ¿es primera evaluación? Dime tu nombre, teléfono y 2 horarios posibles.";
  }

  return "¡Gracias por escribir! ✅ ¿Quieres agendar cita o solo hacer una consulta? Si es cita: nombre + teléfono + día/hora.";
}

// =========================
// Meta send
// =========================
async function sendToMessenger({
  pageAccessToken,
  graphVersion,
  psid,
  text,
}: {
  pageAccessToken: string;
  graphVersion: string;
  psid: string;
  text: string;
}) {
  const url = `https://graph.facebook.com/${graphVersion}/me/messages`;

  const payload = {
    messaging_type: "RESPONSE",
    recipient: { id: psid },
    message: { text },
    access_token: pageAccessToken,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await resp.text();

  console.log("[run-replies] META_SEND status:", resp.status);
  console.log("[run-replies] META_SEND body:", bodyText);
  console.log("[run-replies] META_SEND psid:", psid);

  if (!resp.ok) {
    throw new Error(`Meta send failed: ${resp.status} ${bodyText}`);
  }

  return bodyText;
}

// =========================
// OpenAI (solo cuando conviene)
// =========================
async function generateReplyText({
  openaiKey,
  inboundText,
}: {
  openaiKey: string | null;
  inboundText: string;
}) {
  // Si no hay key -> plantillas
  if (!openaiKey) return fallbackReplyFromInbound(inboundText);

  // Router anti-tokens
  if (!shouldUseOpenAI(inboundText)) {
    return fallbackReplyFromInbound(inboundText);
  }

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "Eres un asistente de recepción para clínica dental. Responde breve, claro y orientado a agendar. Español hondureño neutro. No inventes precios exactos; pide datos si faltan.",
          },
          { role: "user", content: inboundText || "hola" },
        ],
      }),
    });

    const data = await resp.json().catch(() => null);
    const text =
      data?.choices?.[0]?.message?.content && String(data.choices[0].message.content).trim();

    if (!resp.ok || !text) return fallbackReplyFromInbound(inboundText);
    return text.slice(0, 800);
  } catch {
    return fallbackReplyFromInbound(inboundText);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!authOk(req)) return json({ ok: false, error: "unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const META_PAGE_ACCESS_TOKEN = Deno.env.get("META_PAGE_ACCESS_TOKEN") || "";
  const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v24.0";
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || null;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "missing_supabase_env" }, 500);
  }
  if (!META_PAGE_ACCESS_TOKEN) {
    return json({ ok: false, error: "missing_meta_token" }, 500);
  }

  const body = (await req.json().catch(() => ({}))) as RunPayload;
  const org = (body.org || "").trim();
  const limit = Math.min(Math.max(body.limit || 10, 1), 50);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1) Pick queued + unlocked
  let pick = supabase
    .from("reply_outbox")
    .select(
      "id, organization_id, channel, channel_user_id, inbound_message_id, message_text, attempt_count, provider_payload, created_at"
    )
    .eq("status", "queued")
    .is("locked_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (org) pick = pick.eq("organization_id", org);

  const { data: jobs, error: pickErr } = await pick;
  if (pickErr) return json({ ok: false, error: pickErr.message }, 500);
  if (!jobs || jobs.length === 0) return json({ ok: true, claimed: 0, sent: 0, skipped: 0, failures: [] }, 200);

  // 2) Lock (claim)
  const lockedBy = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const ids = jobs.map((j) => j.id);

  const { error: lockErr } = await supabase
    .from("reply_outbox")
    .update({ locked_at: nowIso, locked_by: lockedBy, last_attempt_at: nowIso })
    .in("id", ids)
    .eq("status", "queued")
    .is("locked_at", null);

  if (lockErr) return json({ ok: false, error: lockErr.message }, 500);

  // Re-fetch: solo lo que realmente quedó bloqueado por este worker
  const { data: lockedJobs, error: refetchErr } = await supabase
    .from("reply_outbox")
    .select("id, organization_id, channel, channel_user_id, inbound_message_id, message_text, attempt_count, provider_payload")
    .eq("locked_by", lockedBy)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (refetchErr) return json({ ok: false, error: refetchErr.message }, 500);
  if (!lockedJobs || lockedJobs.length === 0) {
    return json({ ok: true, claimed: 0, sent: 0, skipped: 0, failures: [] }, 200);
  }

  // 3) Send
  const failures: Array<{ id: string; error: string }> = [];
  let sent = 0;
  let skipped = 0;

  for (const job of lockedJobs) {
    try {
      if (job.channel !== "messenger") {
        await supabase
          .from("reply_outbox")
          .update({
            status: "failed",
            last_error: `unsupported_channel:${job.channel}`,
            locked_at: null,
            locked_by: null,
            attempt_count: (job.attempt_count || 0) + 1,
            updated_at: nowIso,
          })
          .eq("id", job.id);

        failures.push({ id: job.id, error: `unsupported_channel:${job.channel}` });
        continue;
      }

      const psid = String(job.channel_user_id || "").trim();
      if (!psid) {
        await supabase
          .from("reply_outbox")
          .update({
            status: "failed",
            last_error: "missing_channel_user_id(psid)",
            locked_at: null,
            locked_by: null,
            attempt_count: (job.attempt_count || 0) + 1,
            updated_at: nowIso,
          })
          .eq("id", job.id);

        failures.push({ id: job.id, error: "missing_channel_user_id(psid)" });
        continue;
      }

      // ✅ Cooldown anti-storm por PSID (10s) usando leads.last_outbound_at
      const { data: recentLead } = await supabase
        .from("leads")
        .select("last_outbound_at")
        .eq("organization_id", job.organization_id)
        .eq("channel_user_id", psid)
        .maybeSingle();

      if (recentLead?.last_outbound_at) {
        const last = new Date(recentLead.last_outbound_at).getTime();
        if (Date.now() - last < 10_000) {
          await supabase
            .from("reply_outbox")
            .update({
              // tu constraint NO permite "skipped", entonces lo marcamos failed + motivo
              status: "failed",
              last_error: "cooldown_10s",
              locked_at: null,
              locked_by: null,
              updated_at: nowIso,
            })
            .eq("id", job.id);

          skipped += 1;
          continue;
        }
      }

      // texto (si viene null -> generamos)
      let text = job.message_text ? String(job.message_text).trim() : "";

      if (!text) {
        let inboundText = "";
        const inboundId = job.inbound_message_id;

        if (inboundId) {
          const { data: inboundMsg } = await supabase
            .from("messages")
            .select("content")
            .eq("id", inboundId)
            .maybeSingle();

          inboundText = String(inboundMsg?.content || "").trim();
        }

        text = await generateReplyText({ openaiKey: OPENAI_API_KEY, inboundText });

        await supabase
          .from("reply_outbox")
          .update({ message_text: text, updated_at: nowIso })
          .eq("id", job.id);
      }

      if (!text) {
        await supabase
          .from("reply_outbox")
          .update({
            status: "failed",
            last_error: "empty_generated_text",
            locked_at: null,
            locked_by: null,
            attempt_count: (job.attempt_count || 0) + 1,
            updated_at: nowIso,
          })
          .eq("id", job.id);

        failures.push({ id: job.id, error: "empty_generated_text" });
        continue;
      }

      const metaResp = await sendToMessenger({
        pageAccessToken: META_PAGE_ACCESS_TOKEN,
        graphVersion: META_GRAPH_VERSION,
        psid,
        text,
      });

      // ✅ Marca sent
      await supabase
        .from("reply_outbox")
        .update({
          status: "sent",
          sent_at: nowIso,
          last_error: null,
          provider_payload: { ...(job.provider_payload || {}), meta_response: metaResp },
          locked_at: null,
          locked_by: null,
          attempt_count: (job.attempt_count || 0) + 1,
          updated_at: nowIso,
        })
        .eq("id", job.id);

      // ✅ Actualiza last_outbound_at para el cooldown
      await supabase
        .from("leads")
        .update({ last_outbound_at: nowIso, updated_at: nowIso })
        .eq("organization_id", job.organization_id)
        .eq("channel_user_id", psid);

      sent += 1;

      // ✅ DEDUPE: si hay otros queued del MISMO inbound, los anulamos (sin "skipped")
      if (job.inbound_message_id) {
        await supabase
          .from("reply_outbox")
          .update({
            status: "failed",
            last_error: "duplicate_inbound_message_id",
            updated_at: nowIso,
          })
          .eq("status", "queued")
          .eq("inbound_message_id", job.inbound_message_id)
          .neq("id", job.id);

        // no contamos como skipped porque ya se van a ver como failed/duplicate
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log("[run-replies] SEND FAILED job:", job.id, msg);

      await supabase
        .from("reply_outbox")
        .update({
          status: "failed",
          last_error: msg,
          locked_at: null,
          locked_by: null,
          attempt_count: (job.attempt_count || 0) + 1,
          updated_at: nowIso,
        })
        .eq("id", job.id);

      failures.push({ id: job.id, error: msg });
    }
  }

  return json({ ok: true, claimed: lockedJobs.length, sent, skipped, failures }, 200);
});
