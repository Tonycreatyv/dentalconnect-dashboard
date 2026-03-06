/// <reference deno-types="https://deno.land/x/types/index.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runConversationEngine } from "./conversationEngine.ts";

type Json = Record<string, unknown>;

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
  const m = safeStr(errorMessage, "").match(/meta_error:(\d{3}):/i) ||
    safeStr(errorMessage, "").match(/Meta error:\s*(\d{3})/i);
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

function normalizeSecretValue(raw: string) {
  const v = safeStr(raw, "").trim();
  if (!v) return "";
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v;
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

function isOperatorOutboundJob(job: any) {
  const source = safeStr(job?.payload?.source, "").toLowerCase();
  const actor = safeStr(job?.actor, "").toLowerCase();
  const role = safeStr(job?.role, "").toLowerCase();
  return source.includes("operator") || source.includes("manual") || actor === "human" || role === "operator";
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
    const isSchemaCache =
      r.error.message.includes("schema cache") && r.error.message.includes("Could not find");
    if (!isSchemaCache) break;
  }

  return null;
}

async function claimJobsViaRpc(args: {
  supabase: ReturnType<typeof createClient>;
  organizationId: string;
  limit: number;
  lockOwner: string;
  lockTtlSeconds: number;
}) {
  const params = {
    p_org_id: args.organizationId,
    p_limit: args.limit,
    p_lock_owner: args.lockOwner,
    p_lock_ttl_seconds: args.lockTtlSeconds,
  };
  const v3 = await args.supabase.rpc("claim_reply_outbox_jobs_v3", params);
  if (!v3.error) return v3;
  const v2 = await args.supabase.rpc("claim_reply_outbox_jobs_v2", params);
  return v2;
}

function mergeLeadState(existing: Json | null, patch: Json | null) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const baseCollected = base?.collected && typeof base.collected === "object" ? { ...base.collected } : {};
  const patchCollected = patch?.collected && typeof patch.collected === "object" ? { ...patch.collected } : {};
  const merged = { ...base, ...(patch ?? {}), collected: { ...baseCollected, ...patchCollected } };
  return merged;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const expected = env("RUN_REPLIES_SECRET");
    const provided = req.headers.get("x-run-replies-secret") ?? "";
    if (!provided || provided !== expected) return j(401, { ok: false, error: "unauthorized" });

    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
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
          safeStr(job.channel_user_id, "") || safeStr(job.recipient_id, "") || safeStr(job.psid, "");
        const leadId = safeStr(job.lead_id, "");
        const inboundProviderMessageId =
          safeStr(job.inbound_provider_message_id, "") ||
          safeStr((job.payload as Json | null)?.inbound_provider_message_id, "") ||
          safeStr(((job.payload as Json | null)?.raw as any)?.message?.mid, "");

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
        const payload = ((job.payload as Json | null) ?? {}) as Json;
        const payloadSource = safeStr(payload.source, "").toLowerCase() || "inbound";
        const operatorOutbound = isOperatorOutboundJob(job) || payloadSource === "ui_manual";
        const manualText = clampText(safeStr(payload.text, ""));

        const inboundTextCandidate = clampText(
          safeStr(job.inbound_text, "") || safeStr(job.text, "") || ""
        );
        let resolvedInboundText = clampText(safeStr(payload.inbound_text, "") || safeStr(payload.text, ""));
        if (!resolvedInboundText && safeStr(job.inbound_message_id, "")) {
          const inboundMsg = await supabase
            .from("messages")
            .select("content")
            .eq("id", safeStr(job.inbound_message_id, ""))
            .maybeSingle();
          if (!inboundMsg.error && inboundMsg.data) {
            resolvedInboundText = clampText(safeStr((inboundMsg.data as any).content, ""));
          }
        }
        if (!resolvedInboundText) resolvedInboundText = inboundTextCandidate || safeStr(job.message_text, "");

        if (!operatorOutbound && !resolvedInboundText) {
          throw new Error("missing_inbound_text: payload.inbound_text/payload.text/messages.content");
        }
        if (!pageAccessToken || pageAccessToken.length <= 50) throw new Error("missing_or_invalid_page_token");

        let leadState: Json | null = null;
        let leadLastSeenInbound = "";
        if (leadId) {
          const ld = await supabase
            .from("leads")
            .select("state,last_seen_inbound_message_id")
            .eq("id", leadId)
            .maybeSingle();
          if (!ld.error && ld.data) {
            leadState = (ld.data as any).state as Json | null;
            leadLastSeenInbound = safeStr((ld.data as any).last_seen_inbound_message_id ?? "", "");
          }
        }

        if (!operatorOutbound && inboundProviderMessageId && leadLastSeenInbound === inboundProviderMessageId) {
          const reason = "duplicate_inbound_mid";
          failures.push({ id: jobId, error: reason });
          skipped++;
          skipped_reasons.push({ id: jobId, reason });
          await supabase
            .from("reply_outbox")
            .update({
              status: "skipped",
              claimed_at: null,
              claimed_by: null,
              locked_at: null,
              locked_by: null,
              last_error: reason,
              updated_at: nowIso(),
            })
            .eq("id", jobId);
          logEvent("run_replies_job_skipped", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id,
            lead_id: leadId,
            job_id: jobId,
            reason,
          });
          continue;
        }

        let reply = "";
        let statePatch: Json = {};
        let debugNote: string | null = null;
        if (operatorOutbound) {
          reply = manualText || resolvedInboundText || "Gracias por escribirnos.";
          debugNote = "operator_outbound";
        } else {
          const engineResult = runConversationEngine({
            organizationId: organization_id,
            leadId,
            leadState,
            inboundText: resolvedInboundText,
            channel,
          });
          reply = clampText(engineResult.replyText ?? "", 950);
          statePatch = engineResult.nextStatePatch ?? {};
          if (engineResult.debug) {
            debugNote = `engine:${safeStr(engineResult.debug.phase, "") || safeStr(engineResult.debug.intent, "") || "reply"}`;
          } else {
            debugNote = "engine";
          }
        }
        if (!reply) reply = "Gracias por escribirnos. Te respondo en un momento.";

        const nextState = mergeLeadState(leadState, { ...statePatch, last_bot_text: reply });
        let outbound_message_id: string | null = null;
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
        const metaResp = await sendToMeta({
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
          await supabase
            .from("leads")
            .update({ last_reply_outbound_mid: String(metaResp.data.message_id) })
            .eq("id", leadId);
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
              state: nextState,
              ...(operatorOutbound || !inboundProviderMessageId
                ? {}
                : { last_seen_inbound_message_id: inboundProviderMessageId }),
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
            status: shouldRetry ? "queued" : terminalDead ? "dead" : "failed",
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
