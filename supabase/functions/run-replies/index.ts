import { createClient, type SupabaseClient as SupabaseClientBase } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runConversationEngine, StatePatch, ConversationResult } from "./conversationEngine.ts";
import { executeToolAction, type ActionExecutionResult } from "./domain/actionExecutor.ts";
import { runLlmTurn, validateLlmTurnResult, LlmTurnValidation } from "./domain/llmTurn.ts";

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

export { mergeLeadState, mergeStatePatches };

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

type SupabaseClientType = SupabaseClientBase<any, "public", any>;

async function loadOrgSecretsKV(
  supabase: SupabaseClientType,
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
  supabase: SupabaseClientType,
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
  supabase: SupabaseClientType;
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

async function loadProductKnowledge(
  supabase: SupabaseClientType,
  organizationId: string
) {
  const topics = [
    "implementation_steps",
    "pricing_plans",
    "dashboard_modules",
    "integrations",
    "trial_flow",
  ];
  const data = await supabase
    .from("product_knowledge")
    .select("topic, content")
    .in("topic", topics);
  const map: Record<string, unknown> = {};
  if (!data.error && Array.isArray(data.data)) {
    for (const row of data.data as any[]) {
      const topic = safeStr(row.topic, "");
      if (topic) map[topic] = row.content;
    }
  }
  return map;
}

async function loadClinicKnowledge(
  supabase: SupabaseClientType,
  organizationId: string
) {
  const topics = [
    "services",
    "pricing",
    "hours",
    "location",
    "appointment_policy",
    "insurance",
  ];
  const data = await supabase
    .from("clinic_knowledge")
    .select("topic, content")
    .in("topic", topics);
  const map: Record<string, unknown> = {};
  if (!data.error && Array.isArray(data.data)) {
    for (const row of data.data as any[]) {
      const topic = safeStr(row.topic, "");
      if (topic) map[topic] = row.content;
    }
  }
  return map;
}

function mergeCollectedStates(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const baseBooking = base.booking && typeof base.booking === "object" ? { ...(base.booking as Record<string, unknown>) } : {};
  const patchBooking = patch.booking && typeof patch.booking === "object" ? { ...(patch.booking as Record<string, unknown>) } : {};
  return {
    ...base,
    ...patch,
    booking: {
      ...baseBooking,
      ...patchBooking,
    },
  };
}

function mergeLeadState(existing: Json | null, patch: Json | null) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const baseCollected = base?.collected && typeof base.collected === "object" ? { ...base.collected } : {};
  const patchCollected = patch?.collected && typeof patch.collected === "object" ? { ...patch.collected } : {};
  const merged = {
    ...base,
    ...(patch ?? {}),
    collected: mergeCollectedStates(baseCollected, patchCollected),
  };
  return merged;
}

function mergeStatePatches(primary?: Json | null, secondary?: Json | null): Json {
  if (!primary) return secondary && typeof secondary === "object" ? { ...secondary } : {};
  if (!secondary) return primary;
  const primaryCollected = primary.collected && typeof primary.collected === "object" ? { ...primary.collected } : {};
  const secondaryCollected = secondary.collected && typeof secondary.collected === "object" ? { ...secondary.collected } : {};
  return {
    ...primary,
    ...secondary,
    collected: mergeCollectedStates(primaryCollected, secondaryCollected),
  };
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
    const DEFAULT_ORG_ENV = safeStr(Deno.env.get("DEFAULT_ORG"), "");

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const executionId = crypto.randomUUID();
    const workerId = `run-replies:${executionId}`;

    const url = new URL(req.url);
    const body = req.headers.get("content-type")?.includes("application/json")
      ? await req.json().catch(() => ({}))
      : {};

    const organization_id_input =
      safeStr(body?.organization_id, "") ||
      safeStr(url.searchParams.get("organization_id"), "");

    const organization_id = organization_id_input || DEFAULT_ORG_ENV;

    if (!organization_id) {
      console.error(JSON.stringify({
        event: "run_replies_missing_org",
        waterline: "resolution",
        provided_body: organization_id_input,
        default_org: DEFAULT_ORG_ENV,
      }));
      return j(400, { ok: false, error: "missing_organization_id" });
    }

    logEvent("run_replies_org_resolution", {
      organization_id,
      provided: Boolean(organization_id_input),
      default_used: !organization_id_input && Boolean(DEFAULT_ORG_ENV),
    });

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
    const lockTtlSeconds = Math.max(300, Math.min(Number(body?.lock_ttl_seconds ?? 300) || 300, 1800));
    const staleLockCutoff = new Date(Date.now() - lockTtlSeconds * 1000).toISOString();
    const reclaimRes = await supabase
      .from("reply_outbox")
      .update({
        status: "queued",
        processing_started_at: null,
        locked_at: null,
        locked_by: null,
        claimed_at: null,
        claimed_by: null,
        last_error: "reclaimed:processing_ttl_expired",
        updated_at: nowIso(),
      })
      .eq("organization_id", organization_id)
      .eq("status", "processing")
      .lte("processing_started_at", staleLockCutoff)
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
    const productKnowledge = await loadProductKnowledge(supabase, organization_id);
    const clinicKnowledge = await loadClinicKnowledge(supabase, organization_id);
    const orgSettingsRes = await supabase
      .from("org_settings")
      .select("llm_brain_enabled, system_prompt, business_type, brand_name")
      .eq("organization_id", organization_id)
      .maybeSingle();
    const llmEnabled = Boolean((orgSettingsRes.data as any)?.llm_brain_enabled);
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
    const finalizeOutboxJob = (jobId: string, updates: Record<string, unknown>) =>
      supabase
        .from("reply_outbox")
        .update({
          locked_at: null,
          locked_by: null,
          claimed_at: null,
          claimed_by: null,
          processing_started_at: null,
          ...updates,
        })
        .eq("id", jobId);

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
        const inboundMessageId = safeStr(job.inbound_message_id, "");

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
        const jobStatusRow = await supabase
          .from("reply_outbox")
          .select("status, sent_at")
          .eq("id", jobId)
          .maybeSingle();
        if (!jobStatusRow.error && jobStatusRow.data) {
          const statusValue = safeStr((jobStatusRow.data as any).status, "");
          const sentAtValue = safeStr((jobStatusRow.data as any).sent_at, "");
          if (statusValue === "sent" || sentAtValue) {
            console.log("Skipping already sent job", jobId);
            continue;
          }
        }
        const processingStartedAt = nowIso();
        await supabase
          .from("reply_outbox")
          .update({
            status: "processing",
            processing_started_at: processingStartedAt,
            claimed_at: processingStartedAt,
            claimed_by: workerId,
            locked_at: processingStartedAt,
            locked_by: workerId,
            updated_at: processingStartedAt,
          })
          .eq("id", jobId);
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
        let actionExecution: ActionExecutionResult | null = null;
        let engineResult: ConversationResult | null = null;

        // Cargar mensajes recientes para dar contexto al LLM
        let recentMessages: Array<{ role: "user" | "assistant"; content: string; timestamp: string }> = [];
        if (leadId) {
          const recentMsgsRes = await supabase
            .from("messages")
            .select("role, content, created_at")
            .eq("lead_id", leadId)
            .order("created_at", { ascending: false })
            .limit(10);

          if (!recentMsgsRes.error && recentMsgsRes.data) {
            recentMessages = (recentMsgsRes.data as any[])
              .reverse()
              .map((m: any) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: String(m.content || ""),
                timestamp: m.created_at,
              }));
          }
        }

        const orgSettings = (orgSettingsRes.data as any) ?? {};
        console.log("[DEBUG] orgSettings:", JSON.stringify({
          llm_brain_enabled: orgSettings.llm_brain_enabled,
          business_type: orgSettings.business_type,
          has_system_prompt: !!orgSettings.system_prompt,
        }));
        console.log("[DEBUG] llmEnabled:", llmEnabled);
        console.log("[DEBUG] resolvedInboundText:", resolvedInboundText);
        console.log("[DEBUG] recentMessages count:", recentMessages.length);

        const llmContext = {
          organizationId: organization_id,
          inboundText: resolvedInboundText,
          leadState,
          orgSettings: orgSettings,
          recentMessages,
        };

        if (llmEnabled) {
          console.log("[DEBUG] Entering LLM block");
          try {
            console.log("[DEBUG] Calling runLlmTurn...");
            const candidate = await runLlmTurn(llmContext);
            console.log("[DEBUG] runLlmTurn result:", candidate ? "got result" : "null");
            const validation = validateLlmTurnResult(candidate);
            if (validation.validation.valid && validation.result) {
              const llmResult = validation.result;
              const currentStage = (leadState as any)?.stage ?? "INITIAL";
              const nextStage = (llmResult.state_patch.stage as string) ?? currentStage;
              engineResult = {
                replyText: llmResult.reply,
                statePatch: llmResult.state_patch,
                debug: { intent: "llm", stage: nextStage },
                toolAction: undefined,
              };
            } else if (!validation.validation.valid) {
              console.warn("run-replies: llm validation failed", validation.validation.errors);
            }
          } catch (err) {
            console.error("run-replies: llm turn failed", err);
          }
        }
        if (operatorOutbound) {
          reply = manualText || resolvedInboundText || "Gracias por escribirnos.";
          debugNote = "operator_outbound";
        } else {
          if (!engineResult) {
            engineResult = runConversationEngine({
              organizationId: organization_id,
              leadState,
              inboundText: resolvedInboundText,
              knowledge: productKnowledge,
              clinicKnowledge,
            });
          }
          if (engineResult?.replyText) {
            reply = clampText(engineResult.replyText, 950);
            statePatch = engineResult.statePatch ?? {};
            if (engineResult.toolAction && leadId) {
              actionExecution = await executeToolAction({
                supabase,
                organizationId: organization_id,
                leadId,
                action: engineResult.toolAction,
              });
              if (actionExecution.event) {
                logEvent("run_replies_tool_action", {
                  execution_id: executionId,
                  trace_id: traceId,
                  organization_id,
                  lead_id: leadId,
                  job_id: jobId,
                  action: actionExecution.event.type,
                  payload: actionExecution.event.payload,
                });
              }
            }
            debugNote = `engine:${safeStr(engineResult.debug.stage, "") || safeStr(engineResult.debug.intent, "") || "reply"}`;
          } else {
            reply = "Gracias por escribirnos. Te respondo en un momento.";
            statePatch = {};
            debugNote = "fallback";
          }
        }
        if (!reply) reply = "Gracias por escribirnos. Te respondo en un momento.";

        const combinedPatch = mergeStatePatches(statePatch, actionExecution?.statePatch ?? undefined);
        const nextState = mergeLeadState(leadState, { ...combinedPatch, last_bot_text: reply });
        let outbound_message_id: string | null = null;
        const messagePayload = {
          organization_id,
          lead_id: leadId || null,
          channel,
          role: "assistant",
          actor: operatorOutbound ? "operator" : "bot",
          content: operatorOutbound ? manualText || reply : reply,
          created_at: nowIso(),
          inbound_message_id: inboundMessageId || null,
          channel_user_id: recipientId,
        };
        try {
          const outMsgInsert = await supabase
            .from("messages")
            .insert(messagePayload)
            .select("id")
            .maybeSingle();
          outbound_message_id = outMsgInsert.data?.id ?? null;
        } catch (err) {
          console.warn("[run-replies] message_insert_failed", {
            organization_id,
            lead_id: leadId,
            job_id: jobId,
            error: safeStr((err as any)?.message ?? err),
          });
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
        const { data: existingOutbound } = await supabase
          .from("messages")
          .select("id")
          .eq("organization_id", organization_id)
          .eq("lead_id", leadId || null)
          .eq("inbound_message_id", inboundMessageId)
          .eq("role", "assistant")
          .maybeSingle();
        if (existingOutbound?.id) {
          console.log("[DUPLICATE_PREVENTED]", {
            job_id: jobId,
            inbound_message_id: inboundMessageId,
            existing_message_id: existingOutbound.id,
          });
          await finalizeOutboxJob(jobId, {
            status: "sent",
            sent_at: nowIso(),
            updated_at: nowIso(),
            last_error: `duplicate_prevented:existing_outbound:${existingOutbound.id}`,
          });
          continue;
        }
        const metaResp = await sendToMeta({
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
            processing_started_at: null,
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
        await finalizeOutboxJob(safeStr(job.id), {
          status: shouldRetry ? "queued" : terminalDead ? "dead" : "failed",
          scheduled_for: shouldRetry ? retryAt : safeStr((job as any).scheduled_for, nowIso()),
          last_error: msg,
          updated_at: nowIso(),
          payload: {
            ...(((job as any).payload as Json | null) ?? {}),
            trace_id: traceId,
            retry_backoff_seconds: delaySec,
            retryable: shouldRetry,
          },
        });
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
