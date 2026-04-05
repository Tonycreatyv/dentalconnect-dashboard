// =============================================================================
// RUN-REPLIES - Worker principal de respuestas automáticas
// Production-grade version: terminal state discipline, anti-storm, idempotency
// =============================================================================

import {
  createClient,
  type SupabaseClient as SupabaseClientBase,
} from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {
  maybeHandleNameCapture,
  runConversationEngine,
} from "./conversationEngine.ts";
import { executeToolAction } from "./domain/actionExecutor.ts";
import { runLlmTurn } from "./domain/llmTurn.ts";
import {
  type ClassifiedIntent,
  classifyMessage,
} from "./domain/llmClassifier.ts";

// =============================================================================
// TYPES
// =============================================================================

type Json = Record<string, unknown>;
type SupabaseClientType = SupabaseClientBase<any, "public", any>;

interface RecentMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface MetaSendResult {
  ok: boolean;
  status: number;
  data: any;
}

interface JobResult {
  status: "sent" | "failed" | "queued" | "dead";
  sentAt?: string | null;
  lastError?: string | null;
  outboundMessageId?: string | null;
  outboundProviderMessageId?: string | null;
}

interface GenerateReplyArgs {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  leadState: Json | null;
  inboundText: string;
  orgSettings: any;
  recentMessages: RecentMessage[];
  productKnowledge: Record<string, unknown>;
  clinicKnowledge: Record<string, unknown>;
  clinicSettings: Record<string, unknown>;
  llmEnabled: boolean;
  isOperatorOutbound: boolean;
  manualText: string;
  executionId: string;
  traceId: string;
  jobId: string;
}

interface GenerateReplyResult {
  reply: string;
  statePatch: Json;
  leadPatch?: Json;
  debugNote: string;
}

interface ProcessJobDeps {
  supabase: SupabaseClientType;
  metaGraphVersion: string;
  pageAccessToken: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  organizationId: string;
  executionId: string;
  workerId: string;
  productKnowledge: Record<string, unknown>;
  clinicKnowledge: Record<string, unknown>;
  clinicSettings: Record<string, unknown>;
  orgSettings: any;
  llmEnabled: boolean;
}

// =============================================================================
// CORS / RESPONSE
// =============================================================================

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

// =============================================================================
// UTILS
// =============================================================================

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

function normalizeSecretValue(raw: string) {
  const v = safeStr(raw, "").trim();
  if (!v) return "";
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1).trim();
  }
  return v;
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

function isOperatorOutboundJob(job: any) {
  const source = safeStr(job?.payload?.source, "").toLowerCase();
  const actor = safeStr(job?.actor, "").toLowerCase();
  const role = safeStr(job?.role, "").toLowerCase();
  return (
    source.includes("operator") ||
    source.includes("manual") ||
    source.includes("ui_manual") ||
    actor === "human" ||
    role === "operator"
  );
}

function logEvent(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: nowIso(), event, ...data }));
}

/**
 * Capitaliza cada palabra: "juan perez" → "Juan Perez"
 * Reutilizado en name capture (LLM, mucho-gusto, name gate).
 */
function capitalizeName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// =============================================================================
// STATE HELPERS
// =============================================================================

function mergeCollectedStates(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  const baseBooking = base.booking && typeof base.booking === "object"
    ? { ...(base.booking as Record<string, unknown>) }
    : {};
  const patchBooking = patch.booking && typeof patch.booking === "object"
    ? { ...(patch.booking as Record<string, unknown>) }
    : {};
  return {
    ...base,
    ...patch,
    booking: { ...baseBooking, ...patchBooking },
  };
}

export function mergeLeadState(existing: Json | null, patch: Json | null) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const baseCollected = base?.collected && typeof base.collected === "object"
    ? { ...base.collected }
    : {};
  const patchCollected = patch?.collected && typeof patch.collected === "object"
    ? { ...patch.collected }
    : {};
  return {
    ...base,
    ...(patch ?? {}),
    collected: mergeCollectedStates(baseCollected, patchCollected),
  };
}

export function mergeStatePatches(
  primary?: Json | null,
  secondary?: Json | null,
): Json {
  if (!primary) {
    return secondary && typeof secondary === "object" ? { ...secondary } : {};
  }
  if (!secondary) return primary;
  const primaryCollected =
    primary.collected && typeof primary.collected === "object"
      ? { ...primary.collected }
      : {};
  const secondaryCollected =
    secondary.collected && typeof secondary.collected === "object"
      ? { ...secondary.collected }
      : {};
  return {
    ...primary,
    ...secondary,
    collected: mergeCollectedStates(primaryCollected, secondaryCollected),
  };
}

function resolveLeadFullName(leadState: Json | null, statePatch?: Json | null) {
  const patchCollectedName = safeStr(
    (statePatch as any)?.collected?.full_name,
    "",
  ).trim();
  const patchCollectedNameAlt = safeStr(
    (statePatch as any)?.collected?.name,
    "",
  ).trim();
  const patchName = safeStr((statePatch as any)?.full_name, "").trim();
  const leadName = safeStr((leadState as any)?.full_name, "").trim();
  const stateName = safeStr((leadState as any)?.name, "").trim();
  return patchCollectedName || patchCollectedNameAlt || patchName || leadName || stateName || "";
}

// =============================================================================
// DATABASE LOADERS
// =============================================================================

async function loadOrgSecretWithFallback(
  supabase: SupabaseClientType,
  organizationId: string,
) {
  const r = await supabase
    .from("org_settings")
    .select(
      "meta_page_id, meta_page_access_token, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_enabled",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (r.error) return null;
  return r.data as Json | null;
}

async function loadProductKnowledge(
  supabase: SupabaseClientType,
  _organizationId: string,
) {
  const topics = [
    "implementation_steps",
    "pricing_plans",
    "dashboard_modules",
    "integrations",
    "trial_flow",
  ];
  const data = await supabase.from("product_knowledge").select("topic, content")
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
  _organizationId: string,
) {
  const topics = [
    "services",
    "pricing",
    "hours",
    "location",
    "appointment_policy",
    "insurance",
  ];
  const data = await supabase.from("clinic_knowledge").select("topic, content")
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

async function loadClinicSettings(
  supabase: SupabaseClientType,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const clinicRes = await supabase
    .from("clinics")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1)
    .maybeSingle();

  if (!clinicRes.data?.id) return {};

  const settingsRes = await supabase
    .from("clinic_settings")
    .select("hours, services, phone, address")
    .eq("clinic_id", clinicRes.data.id)
    .maybeSingle();

  if (!settingsRes.data) return {};
  return settingsRes.data as Record<string, unknown>;
}

async function loadRecentMessages(
  supabase: SupabaseClientType,
  leadId: string,
): Promise<RecentMessage[]> {
  if (!leadId) return [];

  const res = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (res.error || !res.data) return [];

  return (res.data as any[]).reverse().map((m: any) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || ""),
    timestamp: m.created_at,
  }));
}

// =============================================================================
// JOB MANAGEMENT
// =============================================================================

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

async function finalizeOutboxJob(
  supabase: SupabaseClientType,
  jobId: string,
  updates: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("reply_outbox")
    .update({
      locked_at: null,
      locked_by: null,
      claimed_at: null,
      claimed_by: null,
      processing_started_at: null,
      updated_at: nowIso(),
      ...updates,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`finalize_outbox_failed:${error.message}`);
  }
}

async function hasResponseAfterJobCreation(
  supabase: SupabaseClientType,
  leadId: string,
  jobCreatedAt: string,
): Promise<boolean> {
  if (!leadId || !jobCreatedAt) return false;

  const res = await supabase
    .from("messages")
    .select("id")
    .eq("lead_id", leadId)
    .eq("role", "assistant")
    .gte("created_at", jobCreatedAt)
    .limit(1)
    .maybeSingle();

  return Boolean(res.data?.id);
}

// =============================================================================
// META API
// =============================================================================

async function sendToMeta(args: {
  graphVersion: string;
  pageAccessToken: string;
  recipientId: string;
  text: string;
}): Promise<MetaSendResult> {
  const url = new URL(
    `https://graph.facebook.com/${args.graphVersion}/me/messages`,
  );
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

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function sendToWhatsApp(args: {
  graphVersion: string;
  phoneNumberId: string;
  accessToken: string;
  recipientId: string;
  text: string;
}): Promise<MetaSendResult> {
  const url = new URL(
    `https://graph.facebook.com/${args.graphVersion}/${args.phoneNumberId}/messages`,
  );
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: args.recipientId,
      type: "text",
      text: { body: args.text },
    }),
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// =============================================================================
// TOOL EXECUTION
// =============================================================================

async function executeToolCalls(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  toolCalls: any[];
  executionId: string;
  traceId: string;
  jobId: string;
}): Promise<{ reply?: string; statePatch?: Json }> {
  const {
    supabase,
    organizationId,
    leadId,
    toolCalls,
    executionId,
    traceId,
    jobId,
  } = args;

  let finalReply: string | undefined;
  let combinedStatePatch: Json = {};

  for (const toolCall of toolCalls) {
    const toolName = safeStr(toolCall?.name, "");
    const toolPayload = toolCall?.payload ?? {};
    if (!toolName) continue;

    try {
      const result = await executeToolAction({
        supabase,
        organizationId,
        leadId,
        action: { name: toolName as any, payload: toolPayload },
      });

      if (result.event) {
        logEvent("run_replies_tool_executed", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          tool_name: toolName,
          event_type: result.event.type,
        });
      }

      if (result.replyOverride) {
        finalReply = result.replyOverride;
      }

      if (result.statePatch) {
        combinedStatePatch = mergeStatePatches(
          combinedStatePatch,
          result.statePatch,
        );
      }
    } catch (err) {
      console.error("[run-replies] tool execution failed", { toolName, err });
    }
  }

  return { reply: finalReply, statePatch: combinedStatePatch };
}

// =============================================================================
// REPLY GENERATION
// =============================================================================

async function generateReply(
  args: GenerateReplyArgs,
): Promise<GenerateReplyResult> {
  const {
    supabase,
    organizationId,
    leadId,
    leadState: initialLeadState,
    inboundText: initialInboundText,
    orgSettings,
    recentMessages,
    productKnowledge,
    clinicKnowledge,
    clinicSettings,
    llmEnabled,
    isOperatorOutbound,
    manualText,
    executionId,
    traceId,
    jobId,
  } = args;

  let leadState = initialLeadState;
  let inboundText = initialInboundText;

  if (isOperatorOutbound) {
    return {
      reply: manualText || inboundText || "Gracias por escribirnos.",
      statePatch: {},
      leadPatch: {},
      debugNote: "operator_outbound",
    };
  }

  let classified: ClassifiedIntent | null = null;
  const businessType = safeStr(orgSettings?.business_type, "").toLowerCase();
  const isDentalOrg = businessType === "dental" ||
    businessType === "clinic" ||
    businessType.includes("dental");

  if (isDentalOrg) {
    const services = Array.isArray(clinicSettings?.services)
      ? (clinicSettings.services as any[])
        .map((service: any) => String(service?.name ?? service ?? "").trim())
        .filter(Boolean)
      : [
        "limpieza dental",
        "ortodoncia",
        "blanqueamiento",
        "implantes",
        "extracción",
        "consulta general",
      ];

    const history = (recentMessages ?? []).slice(-6).map((m: any) =>
      String(m.content ?? "")
    );

    classified = await classifyMessage({
      message: inboundText,
      conversationHistory: history,
      currentStage: safeStr((leadState as any)?.stage, "INITIAL"),
      nextExpected: safeStr((leadState as any)?.nextExpected, "") || null,
      collectedData: ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >,
      clinicServices: services,
    });
  }

  if (classified) {
    const existingCollected = ((leadState as any)?.collected ?? {}) as Record<
      string,
      unknown
    >;

    if (classified.service) {
      leadState = mergeLeadState(leadState, {
        collected: {
          ...existingCollected,
          service: classified.service,
        },
      });
    }

    if (classified.date || classified.time) {
      leadState = mergeLeadState(leadState, {
        collected: {
          ...(((leadState as any)?.collected ?? {}) as Record<string, unknown>),
          ...(classified.date ? { preferred_date: classified.date } : {}),
          ...(classified.time ? { preferred_time: classified.time } : {}),
        },
      });
    }

    if (
      classified.is_confirmation &&
      safeStr((leadState as any)?.nextExpected, "") === "confirm_booking"
    ) {
      inboundText = "sí";
    }

    if (
      classified.is_negation &&
      safeStr((leadState as any)?.nextExpected, "") === "confirm_booking"
    ) {
      inboundText = "no";
    }

    if (classified.patient_name && !resolveLeadFullName(leadState)) {
      inboundText = classified.patient_name;
    }

    if (
      classified.intent === "book_appointment" ||
      classified.intent === "provide_service" ||
      classified.intent === "provide_datetime" ||
      classified.service ||
      classified.date ||
      classified.time
    ) {
      if (safeStr((leadState as any)?.stage, "") !== "BOOKING") {
        leadState = mergeLeadState(leadState, { stage: "BOOKING" });
      }
    }

    if (classified.urgency === "emergency") {
      const clinicPhone = safeStr(clinicSettings?.phone, "");
      const emergencyMsg = clinicPhone
        ? `⚠️ Entiendo que es una emergencia. Por favor llama directamente a la clínica: ${clinicPhone}.`
        : "⚠️ Entiendo que es una emergencia. Te recomendamos visitar la clínica o llamar para atención inmediata.";

      return {
        reply: emergencyMsg,
        statePatch: { lastIntent: "emergency" },
        leadPatch: {},
        debugNote: "llm:emergency",
      };
    }
  }

  // ---------------------------------------------------------------
  // NON-LLM PATH: name capture gate (solo cuando LLM está OFF)
  // ---------------------------------------------------------------
  if (!llmEnabled) {
    const nameStep = maybeHandleNameCapture({
      organizationId,
      leadState: leadState as any,
      inboundText,
      channel: safeStr((leadState as any)?.channel, ""),
    });

    if (nameStep?.replyText) {
      const leadPatch: Json = {};
      const capturedFullName = safeStr(
        (nameStep.statePatch as any)?.full_name,
        "",
      ).trim();
      if (capturedFullName && !capturedFullName.startsWith("Usuario ")) {
        leadPatch.full_name = capitalizeName(capturedFullName);
        leadPatch.first_name = String(leadPatch.full_name).split(/\s+/)[0] ??
          String(leadPatch.full_name);
      }

      return {
        reply: clampText(nameStep.replyText, 950),
        statePatch: nameStep.statePatch ?? {},
        leadPatch,
        debugNote: `name_gate:${safeStr(nameStep.debug?.route, "step")}`,
      };
    }
  }

  // ---------------------------------------------------------------
  // LLM PATH
  // ---------------------------------------------------------------
  if (llmEnabled) {
    try {
      const llmResult = await runLlmTurn({
        organizationId,
        inboundText,
        leadState: leadState as any,
        orgSettings,
        recentMessages,
      });

      if (llmResult) {
        let reply = clampText(llmResult.reply, 950);
        let statePatch: Json = llmResult.state_patch ?? {};

        // Execute tool calls if the LLM requested any
        if (llmResult.tool_calls && llmResult.tool_calls.length > 0 && leadId) {
          const toolResult = await executeToolCalls({
            supabase,
            organizationId,
            leadId,
            toolCalls: llmResult.tool_calls,
            executionId,
            traceId,
            jobId,
          });

          if (toolResult.reply) reply = clampText(toolResult.reply, 950);
          if (toolResult.statePatch) {
            statePatch = mergeStatePatches(statePatch, toolResult.statePatch);
          }
        }

        // ---------------------------------------------------------
        // Lead name capture from LLM response
        // ---------------------------------------------------------
        const leadPatch: Json = {};

        // Heuristic: if reply contains "mucho gusto" the inbound is likely a name
        if (reply && reply.toLowerCase().includes("mucho gusto")) {
          const possibleName = String(inboundText ?? "").trim();
          if (
            possibleName &&
            possibleName.length < 40 &&
            possibleName.split(" ").length <= 4
          ) {
            leadPatch.full_name = capitalizeName(possibleName);
            leadPatch.first_name = String(leadPatch.full_name).split(" ")[0];
          }
        }

        // Primary: capture name from LLM state_patch collected fields
        // Runs when the "mucho gusto" heuristic didn't fire
        if (!leadPatch.full_name) {
          const patchedName = resolveLeadFullName(null, statePatch);
          if (patchedName && patchedName.length < 60) {
            leadPatch.full_name = capitalizeName(patchedName);
            leadPatch.first_name = String(leadPatch.full_name).split(" ")[0];
          }
        }

        return {
          reply: reply || "Gracias por escribirnos. ¿En qué te puedo ayudar?",
          statePatch,
          leadPatch,
          debugNote: "llm",
        };
      }
    } catch (err) {
      console.error("[run-replies] LLM turn failed:", err);
    }

    return {
      reply: "Gracias por escribirnos. Dame un momento y ya te respondo.",
      statePatch: {},
      leadPatch: {},
      debugNote: "llm_fallback_safe",
    };
  }

  // ---------------------------------------------------------------
  // CONVERSATION ENGINE FALLBACK (no LLM)
  // ---------------------------------------------------------------
  const engineResult = runConversationEngine({
    organizationId,
    inboundText,
    leadState: leadState as any,
    productKnowledge,
    clinicKnowledge,
    clinicSettings,
    recentMessages,
  } as any);

  const fallbackReply = clampText(
    safeStr(
      (engineResult as any)?.replyText,
      "Gracias por escribirnos. ¿En qué te puedo ayudar?",
    ),
    950,
  );

  return {
    reply: fallbackReply,
    statePatch: ((engineResult as any)?.statePatch ?? {}) as Json,
    leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
    debugNote: safeStr((engineResult as any)?.debugNote, "engine"),
  };
}

// =============================================================================
// PERSISTENCE HELPERS
// =============================================================================

async function insertOutboundMessage(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  channel: string;
  actor: "bot" | "operator";
  recipientId: string;
  reply: string;
}) {
  const {
    supabase,
    organizationId,
    leadId,
    channel,
    actor,
    recipientId,
    reply,
  } = args;

  const outMsgInsert = await supabase
    .from("messages")
    .insert({
      organization_id: organizationId,
      lead_id: leadId || null,
      channel,
      role: "assistant",
      actor,
      content: reply,
      created_at: nowIso(),
      channel_user_id: recipientId,
    })
    .select("id")
    .maybeSingle();

  if (outMsgInsert.error) {
    throw new Error(
      `outbound_message_insert_failed:${outMsgInsert.error.message}`,
    );
  }

  return outMsgInsert.data?.id ?? null;
}

async function deleteMessageIfExists(
  supabase: SupabaseClientType,
  messageId: string | null,
) {
  if (!messageId) return;
  await supabase.from("messages").delete().eq("id", messageId);
}

async function updateLeadAfterSend(args: {
  supabase: SupabaseClientType;
  leadId: string;
  reply: string;
  leadState: Json | null;
  statePatch: Json;
  leadPatch?: Json;
}) {
  const { supabase, leadId, reply, leadState, statePatch, leadPatch } = args;
  if (!leadId) return;

  if (leadPatch && Object.keys(leadPatch).length > 0) {
    const leadPatchRes = await supabase
      .from("leads")
      .update(leadPatch)
      .eq("id", leadId);

    if (leadPatchRes.error) {
      throw new Error(`lead_patch_update_failed:${leadPatchRes.error.message}`);
    }
  }

  const nextState = mergeLeadState(leadState, {
    ...statePatch,
    last_bot_text: reply,
  });

  const stateRes = await supabase
    .from("leads")
    .update({
      last_message_at: nowIso(),
      last_bot_reply_at: nowIso(),
      last_message_preview: reply.slice(0, 140),
      state: nextState,
    })
    .eq("id", leadId);

  if (stateRes.error) {
    throw new Error(`lead_state_update_failed:${stateRes.error.message}`);
  }
}

async function updateOutboundMessageProviderId(args: {
  supabase: SupabaseClientType;
  outboundMessageId: string | null;
  outboundProviderMessageId: string | null;
}) {
  const { supabase, outboundMessageId, outboundProviderMessageId } = args;
  if (!outboundMessageId || !outboundProviderMessageId) return;

  const res = await supabase
    .from("messages")
    .update({ provider_message_id: outboundProviderMessageId })
    .eq("id", outboundMessageId);

  if (res.error) {
    throw new Error(`message_provider_id_update_failed:${res.error.message}`);
  }
}

// =============================================================================
// JOB PROCESSOR
// =============================================================================

async function processSingleJob(
  job: any,
  deps: ProcessJobDeps,
): Promise<JobResult> {
  const {
    supabase,
    metaGraphVersion,
    pageAccessToken,
    whatsappAccessToken,
    whatsappPhoneNumberId,
    organizationId,
    executionId,
    productKnowledge,
    clinicKnowledge,
    clinicSettings,
    orgSettings,
    llmEnabled,
  } = deps;

  const jobId = safeStr(job.id);
  const traceId = safeStr((job.payload as Json | null)?.trace_id, "") ||
    crypto.randomUUID();
  const leadId = safeStr(job.lead_id, "");
  const jobCreatedAt = safeStr(job.created_at, "");
  const channel = normalizeChannel(safeStr(job.channel, "messenger"));
  const recipientId = safeStr(job.channel_user_id, "") ||
    safeStr(job.recipient_id, "") ||
    safeStr(job.psid, "");

  let outboundMessageId: string | null = null;

  if (!["messenger", "whatsapp"].includes(channel)) {
    throw new Error(`unsupported_channel:${channel}`);
  }

  if (!recipientId) {
    throw new Error("missing_recipient_id");
  }

  // 1) pre-send dedupe
  if (leadId && jobCreatedAt && !isOperatorOutboundJob(job)) {
    const alreadyResponded = await hasResponseAfterJobCreation(
      supabase,
      leadId,
      jobCreatedAt,
    );
    if (alreadyResponded) {
      await finalizeOutboxJob(supabase, jobId, {
        status: "sent",
        sent_at: nowIso(),
        last_error: "deduped:response_already_exists",
      });
      return {
        status: "sent",
        sentAt: nowIso(),
        lastError: "deduped:response_already_exists",
      };
    }
  }

  const manualText = safeStr(job?.payload?.text, "");
  const inboundText = safeStr(job?.content, "") ||
    safeStr(job?.payload?.text, "");
  const isOperatorOutbound = isOperatorOutboundJob(job);

  let leadState: Json | null = null;
  if (leadId) {
    const leadRes = await supabase
      .from("leads")
      .select("state, full_name, first_name")
      .eq("id", leadId)
      .maybeSingle();

    if (leadRes.error) {
      throw new Error(`lead_load_failed:${leadRes.error.message}`);
    }

    leadState = ((leadRes.data?.state ?? {}) as Json) || {};
    if (leadRes.data?.full_name && !(leadState as any).full_name) {
      leadState = {
        ...leadState,
        full_name: leadRes.data.full_name,
        first_name: leadRes.data.first_name ?? undefined,
      };
    }
  }

  const recentMessages = leadId
    ? await loadRecentMessages(supabase, leadId)
    : [];

  const generated = await generateReply({
    supabase,
    organizationId,
    leadId,
    leadState,
    inboundText,
    orgSettings,
    recentMessages,
    productKnowledge,
    clinicKnowledge,
    clinicSettings,
    llmEnabled,
    isOperatorOutbound,
    manualText,
    executionId,
    traceId,
    jobId,
  });

  const reply = clampText(generated.reply, 950);
  const statePatch = generated.statePatch ?? {};
  const leadPatch = generated.leadPatch ?? {};
  const debugNote = safeStr(generated.debugNote, "");

  if (!reply) {
    await finalizeOutboxJob(supabase, jobId, {
      status: "failed",
      last_error: "empty_reply_generated",
    });
    return { status: "failed", lastError: "empty_reply_generated" };
  }

  // 2) pre-send race dedupe
  if (leadId && jobCreatedAt && !isOperatorOutbound) {
    const alreadyResponded = await hasResponseAfterJobCreation(
      supabase,
      leadId,
      jobCreatedAt,
    );
    if (alreadyResponded) {
      await finalizeOutboxJob(supabase, jobId, {
        status: "sent",
        sent_at: nowIso(),
        last_error: "deduped:race_condition_caught",
      });
      return {
        status: "sent",
        sentAt: nowIso(),
        lastError: "deduped:race_condition_caught",
      };
    }
  }

  // 3) persist outbound before send
  outboundMessageId = await insertOutboundMessage({
    supabase,
    organizationId,
    leadId,
    channel,
    actor: isOperatorOutbound ? "operator" : "bot",
    recipientId,
    reply,
  });

  // 4) send to provider
  const metaResp = channel === "whatsapp"
    ? await sendToWhatsApp({
      graphVersion: metaGraphVersion,
      phoneNumberId: whatsappPhoneNumberId,
      accessToken: whatsappAccessToken,
      recipientId,
      text: reply,
    })
    : await sendToMeta({
      graphVersion: metaGraphVersion,
      pageAccessToken,
      recipientId,
      text: reply,
    });

  if (!metaResp?.ok) {
    await deleteMessageIfExists(supabase, outboundMessageId);
    throw new Error(
      `meta_send_failed:${metaResp?.status}:${
        JSON.stringify(metaResp?.data ?? {})
      }`,
    );
  }

  const outboundProviderMessageId = safeStr(
    metaResp?.data?.message_id ?? metaResp?.data?.messages?.[0]?.id,
    "",
  ) || null;

  // 5) update lead and message metadata before terminalizing outbox
  await updateLeadAfterSend({
    supabase,
    leadId,
    reply,
    leadState,
    statePatch,
    leadPatch,
  });

  await updateOutboundMessageProviderId({
    supabase,
    outboundMessageId,
    outboundProviderMessageId,
  });

  // 6) terminalize exactly once
  await finalizeOutboxJob(supabase, jobId, {
    status: "sent",
    sent_at: nowIso(),
    outbound_message_id: outboundMessageId,
    meta_message_id: outboundProviderMessageId,
    last_error: debugNote ? `debug:${debugNote}` : null,
  });

  logEvent("run_replies_job_sent", {
    execution_id: executionId,
    trace_id: traceId,
    organization_id: organizationId,
    lead_id: leadId,
    job_id: jobId,
    debug_note: debugNote,
  });

  return {
    status: "sent",
    sentAt: nowIso(),
    lastError: debugNote ? `debug:${debugNote}` : null,
    outboundMessageId,
    outboundProviderMessageId,
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const runRepliesSecret = normalizeSecretValue(env("RUN_REPLIES_SECRET"));
    const providedSecret = normalizeSecretValue(
      req.headers.get("x-run-replies-secret") ?? "",
    );
    if (!providedSecret || providedSecret !== runRepliesSecret) {
      return j(401, { ok: false, error: "unauthorized" });
    }

    const body = await req.json().catch(() => ({}));
    const organization_id = safeStr(
      body?.organization_id,
      safeStr(body?.org_id, ""),
    ).trim();
    if (!organization_id) {
      return j(400, { ok: false, error: "missing_organization_id" });
    }

    const executionId = crypto.randomUUID();
    const workerId = `run-replies:${executionId}`;

    const supabaseUrl = env("SUPABASE_URL");
    const supabaseServiceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const metaGraphVersion = safeStr(
      Deno.env.get("META_GRAPH_VERSION"),
      "v19.0",
    );

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    let pageAccessToken = normalizeSecretValue(
      safeStr(Deno.env.get("META_PAGE_ACCESS_TOKEN"), ""),
    );
    let whatsappAccessToken = normalizeSecretValue(
      safeStr(Deno.env.get("WHATSAPP_ACCESS_TOKEN"), ""),
    );
    let whatsappPhoneNumberId = normalizeSecretValue(
      safeStr(Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"), ""),
    );

    const sec = await loadOrgSecretWithFallback(supabase, organization_id);
    if (sec) {
      const token = normalizeSecretValue(
        safeStr((sec as any).meta_page_access_token, ""),
      );
      const waToken = normalizeSecretValue(
        safeStr((sec as any).whatsapp_access_token, ""),
      );
      const waPhoneNumberId = normalizeSecretValue(
        safeStr((sec as any).whatsapp_phone_number_id, ""),
      );
      if (token) pageAccessToken = token;
      if (waToken) whatsappAccessToken = waToken;
      if (waPhoneNumberId) whatsappPhoneNumberId = waPhoneNumberId;
    }

    const orgSettingsRes = await supabase
      .from("org_settings")
      .select(
        "llm_brain_enabled, system_prompt, business_type, brand_name, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_enabled",
      )
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (orgSettingsRes.error) {
      return j(500, {
        ok: false,
        error: `org_settings_load_failed:${orgSettingsRes.error.message}`,
      });
    }

    const orgSettings = (orgSettingsRes.data as any) ?? {};
    const llmEnabled = Boolean(orgSettings.llm_brain_enabled);

    const productKnowledge = await loadProductKnowledge(
      supabase,
      organization_id,
    );
    const clinicKnowledge = await loadClinicKnowledge(
      supabase,
      organization_id,
    );
    const clinicSettings = await loadClinicSettings(supabase, organization_id);

    const limit = Math.max(1, Math.min(Number(body?.limit ?? 10) || 10, 50));
    const lockTtlSeconds = Math.max(
      300,
      Math.min(Number(body?.lock_ttl_seconds ?? 300) || 300, 1800),
    );
    const staleLockCutoff = new Date(Date.now() - lockTtlSeconds * 1000)
      .toISOString();

    // reclaim stale processing rows
    const reclaimRes = await supabase
      .from("reply_outbox")
      .update({
        status: "failed",
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
      return j(500, {
        ok: false,
        error: `claim_rpc_failed:${claimRes.error.message}`,
      });
    }

    const jobs = Array.isArray(claimRes.data) ? claimRes.data : [];

    logEvent("run_replies_claimed", {
      execution_id: executionId,
      organization_id,
      claimed: jobs.length,
      reclaimed: reclaimedCount,
    });

    if (!jobs.length) {
      return j(200, {
        ok: true,
        execution_id: executionId,
        org_id: organization_id,
        claimed_count: 0,
        sent_count: 0,
        failed_count: 0,
        deduped_count: 0,
      });
    }

    let sent = 0;
    let failed = 0;
    let deduped = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const job of jobs) {
      const jobId = safeStr(job.id);
      const attemptCount = Number((job as any).attempt_count ?? 0) + 1;

      try {
        const result = await processSingleJob(job, {
          supabase,
          metaGraphVersion,
          pageAccessToken,
          whatsappAccessToken,
          whatsappPhoneNumberId,
          organizationId: organization_id,
          executionId,
          workerId,
          productKnowledge,
          clinicKnowledge,
          clinicSettings,
          orgSettings,
          llmEnabled,
        });

        if (result.lastError?.startsWith("deduped:")) {
          deduped++;
          sent++;
        } else if (result.status === "sent") {
          sent++;
        } else {
          failed++;
        }
      } catch (e: any) {
        const msg = safeStr(e?.message, String(e));
        const retryableStatus = parseMetaStatus(msg);
        const isRetryable = msg.includes("429") ||
          msg.includes("timeout") ||
          msg.includes("network") ||
          retryableStatus === 429 ||
          (retryableStatus !== null && retryableStatus >= 500);

        const maxRetries = 3;
        const shouldRetry = isRetryable && attemptCount < maxRetries;
        const terminalDead = attemptCount >= maxRetries;

        failures.push({ id: jobId, error: msg });
        failed++;

        try {
          await finalizeOutboxJob(supabase, jobId, {
            status: shouldRetry ? "queued" : terminalDead ? "dead" : "failed",
            scheduled_for: shouldRetry
              ? plusSecondsIso(backoffSeconds(attemptCount))
              : nowIso(),
            last_error: msg,
          });
        } catch (finalizeErr) {
          console.error("[run-replies] finalize after failure also failed", {
            jobId,
            msg,
            finalizeErr,
          });
        }

        logEvent("run_replies_job_failed", {
          execution_id: executionId,
          organization_id,
          job_id: jobId,
          error: msg,
          should_retry: shouldRetry,
          attempt_count: attemptCount,
        });
      }
    }

    return j(200, {
      ok: true,
      execution_id: executionId,
      org_id: organization_id,
      claimed_count: jobs.length,
      sent_count: sent,
      failed_count: failed,
      deduped_count: deduped,
      failures,
    });
  } catch (err: any) {
    return j(500, {
      ok: false,
      error: safeStr(err?.message, String(err)),
    });
  }
});