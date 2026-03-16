import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

type ReqBody = {
  organization_id?: string;
  org?: string;
  limit?: number;
  lock_ttl_seconds?: number;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safeStr(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSecret(value: string) {
  const v = safeStr(value, "").trim();
  if (!v) return "";
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function buildFollowupText(reason: string, step: number) {
  const r = safeStr(reason, "lead_silent").toLowerCase();
  if (r.includes("pricing") || r.includes("price")) {
    if (step <= 1) return "Te comparto un seguimiento rápido: si querés, te paso opciones y precios en un mensaje corto para que compares.";
    if (step === 2) return "¿Querés que te deje hoy mismo una propuesta clara con opciones y rango de precio?";
    return "Cierro por ahora para no molestarte. Si querés retomar, te respondo al instante.";
  }
  if (r.includes("appointment") || r.includes("cita") || r.includes("agenda")) {
    if (step <= 1) return "Sigo pendiente para ayudarte con tu cita. Si me compartís día y horario, te ayudo a coordinar.";
    if (step === 2) return "¿Preferís mañana o tarde para agendar? Con eso te dejo opciones rápidas.";
    return "Lo dejo en pausa para no insistir. Cuando quieras, retomamos por aquí.";
  }
  if (step <= 1) return "Paso por aquí por si querés retomar. Estoy disponible para ayudarte con el siguiente paso.";
  if (step === 2) return "¿Te parece si te dejo una recomendación concreta según lo que buscás?";
  return "Cierro este seguimiento para no saturarte. Si querés volver, te respondo por aquí.";
}

async function loadOrgToken(supabase: ReturnType<typeof createClient>, organizationId: string) {
  const kv = await supabase
    .from("org_settings")
    .select("meta_page_access_token")
    .eq("organization_id", organizationId)
    .maybeSingle();

  let token = normalizeSecret(Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? "");
  let graphVersion = safeStr(Deno.env.get("META_GRAPH_VERSION"), "v19.0");

  if (!kv.error && kv.data) {
    const value = normalizeSecret(safeStr((kv.data as any)?.meta_page_access_token, ""));
    if (value.length > 50) token = value;
  }

  return { token, graphVersion };
}

async function sendMeta(args: {
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
  if (!res.ok) throw new Error(`meta_error:${res.status}:${JSON.stringify(data)}`);
  return data;
}

async function sendMessage(args: {
  provider: string;
  graphVersion: string;
  pageAccessToken: string;
  recipientId: string;
  text: string;
}) {
  const provider = safeStr(args.provider, "meta").toLowerCase();
  if (provider === "meta" || provider === "messenger") {
    return await sendMeta({
      graphVersion: args.graphVersion,
      pageAccessToken: args.pageAccessToken,
      recipientId: args.recipientId,
      text: args.text,
    });
  }
  if (provider === "whatsapp") throw new Error("not_implemented:provider_whatsapp");
  if (provider === "instagram") throw new Error("not_implemented:provider_instagram");
  throw new Error(`unsupported_provider:${provider}`);
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

    const expected =
      safeStr(Deno.env.get("RUN_FOLLOWUPS_SECRET"), "") || safeStr(Deno.env.get("FOLLOWUP_RUN_SECRET"), "");
    const provided =
      req.headers.get("x-run-followups-secret") ?? req.headers.get("x-followup-secret") ?? "";
    if (!expected || provided !== expected) return json(401, { ok: false, error: "unauthorized" });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const organizationId = safeStr(body.organization_id, "") || safeStr(body.org, "");
    if (!organizationId) return json(400, { ok: false, error: "missing_organization_id" });

    const limit = Math.max(1, Math.min(Number(body.limit ?? 10) || 10, 50));
    const lockTtlSeconds = Math.max(30, Math.min(Number(body.lock_ttl_seconds ?? 300) || 300, 1800));

    const supabaseUrl = safeStr(Deno.env.get("SUPABASE_URL"), "");
    const serviceKey = safeStr(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "");
    if (!supabaseUrl || !serviceKey) {
      return json(500, { ok: false, error: "missing_supabase_secrets" });
    }

    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const workerId = `run-followups:${crypto.randomUUID()}`;

    const { data: jobs, error: claimErr } = await sb.rpc("claim_followup_outbox_jobs_v2", {
      p_org_id: organizationId,
      p_limit: limit,
      p_lock_owner: workerId,
      p_lock_ttl_seconds: lockTtlSeconds,
    });

    if (claimErr) return json(500, { ok: false, error: `claim_rpc_failed:${claimErr.message}` });

    const claimedJobs = Array.isArray(jobs) ? jobs : [];
    if (!claimedJobs.length) return json(200, { ok: true, claimed: 0, sent: 0, failed: 0, skipped: 0, failures: [] });

    const { token, graphVersion } = await loadOrgToken(sb, organizationId);
    if (!token || token.length <= 50) {
      for (const job of claimedJobs) {
        await sb
          .from("followup_outbox")
          .update({
            status: "failed",
            last_error: "missing_or_invalid_page_token",
            locked_at: null,
            lock_owner: null,
            updated_at: nowIso(),
          })
          .eq("id", safeStr((job as any).id, ""));
      }
      return json(200, {
        ok: true,
        claimed: claimedJobs.length,
        sent: 0,
        failed: claimedJobs.length,
        skipped: 0,
        failures: claimedJobs.map((j: any) => ({ id: j.id, error: "missing_or_invalid_page_token" })),
      });
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const job of claimedJobs as any[]) {
      const jobId = safeStr(job.id, "");
      const leadId = safeStr(job.lead_id, "");
      const channelUserId = safeStr(job.channel_user_id, "");
      const provider = safeStr(job.provider, "meta") || safeStr(job?.payload?.provider, "meta");
      const step = Math.max(1, Number(job.step ?? 1) || 1);
      const maxSteps = Math.max(1, Number(job.max_steps ?? 3) || 3);

      try {
        if (!channelUserId) throw new Error("missing_channel_user_id");

        const hasInboundAfter = await sb
          .from("messages")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("lead_id", leadId)
          .eq("role", "user")
          .gt("created_at", safeStr(job.created_at, "1970-01-01T00:00:00.000Z"))
          .limit(1);

        if (!hasInboundAfter.error && (hasInboundAfter.data?.length ?? 0) > 0) {
          await sb
            .from("followup_outbox")
            .update({
              status: "cancelled",
              last_error: "cancelled:user_replied",
              locked_at: null,
              lock_owner: null,
              updated_at: nowIso(),
            })
            .eq("id", jobId);
          skipped += 1;
          continue;
        }

        if (step > maxSteps) {
          await sb
            .from("followup_outbox")
            .update({
              status: "skipped",
              last_error: "skipped:max_steps_reached",
              locked_at: null,
              lock_owner: null,
              updated_at: nowIso(),
            })
            .eq("id", jobId);
          skipped += 1;
          continue;
        }

        const payload = (job.payload as Json | null) ?? {};
        const text = safeStr(payload.text, "").trim() || safeStr(job.message_text, "").trim() || buildFollowupText(safeStr(job.reason, "lead_silent"), step);
        if (!text) throw new Error("missing_followup_text");

        const providerResp = await sendMessage({
          provider,
          graphVersion,
          pageAccessToken: token,
          recipientId: channelUserId,
          text,
        });

        const outMsg = await sb
          .from("messages")
          .insert({
            organization_id: organizationId,
            lead_id: leadId || null,
            channel: "messenger",
            channel_user_id: channelUserId,
            role: "assistant",
            actor: "bot",
            content: text,
            provider_message_id: (providerResp as any)?.message_id ?? null,
            created_at: nowIso(),
          })
          .select("id")
          .maybeSingle();

        await sb
          .from("followup_outbox")
          .update({
            status: "sent",
            sent_at: nowIso(),
            payload: {
              ...(payload ?? {}),
              sent_message_id: safeStr((providerResp as any)?.message_id, ""),
              ui_message_id: outMsg.data?.id ?? null,
            },
            locked_at: null,
            lock_owner: null,
            updated_at: nowIso(),
          })
          .eq("id", jobId);

        await sb
          .from("leads")
          .update({
            last_message_at: nowIso(),
            last_message_preview: text.slice(0, 140),
            last_bot_reply_at: nowIso(),
          })
          .eq("id", leadId);

        if (step < maxSteps) {
          const nextDue = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          await sb
            .from("followup_outbox")
            .upsert(
              {
                organization_id: organizationId,
                lead_id: leadId,
                channel_user_id: channelUserId,
                provider,
                reason: safeStr(job.reason, "lead_silent"),
                step: step + 1,
                max_steps: maxSteps,
                due_at: nextDue,
                status: "queued",
                payload: {
                  ...(payload ?? {}),
                  source: "auto_followup",
                  provider,
                  step: step + 1,
                },
              },
              {
                onConflict: "organization_id,lead_id,reason,step",
                ignoreDuplicates: true,
              }
            );
        }

        sent += 1;
      } catch (e: any) {
        const error = safeStr(e?.message, String(e));
        failed += 1;
        failures.push({ id: jobId, error });
        await sb
          .from("followup_outbox")
          .update({
            status: "failed",
            last_error: error,
            locked_at: null,
            lock_owner: null,
            updated_at: nowIso(),
          })
          .eq("id", jobId);
      }
    }

    return json(200, {
      ok: true,
      worker_id: workerId,
      claimed: claimedJobs.length,
      sent,
      failed,
      skipped,
      failures,
    });
  } catch (e: any) {
    return json(500, { ok: false, error: safeStr(e?.message, String(e)) });
  }
});
