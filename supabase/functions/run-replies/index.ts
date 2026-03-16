// =============================================================================
// RUN-REPLIES - Worker principal de respuestas automáticas
// =============================================================================
// ANTI-STORM: Verifica si ya existe respuesta para el job antes de enviar
// =============================================================================

import { createClient, type SupabaseClient as SupabaseClientBase } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runConversationEngine, maybeHandleNameCapture } from "./conversationEngine.ts";
import { executeToolAction, type ActionExecutionResult } from "./domain/actionExecutor.ts";
import { runLlmTurn } from "./domain/llmTurn.ts";
import { classifyMessage, type ClassifiedIntent } from "./domain/llmClassifier.ts";

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

// =============================================================================
// CONSTANTS & CORS
// =============================================================================

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, x-run-replies-secret",
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

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

function resolveLeadFullName(leadState: Json | null, statePatch?: Json | null) {
  const patchCollectedName = safeStr((statePatch as any)?.collected?.full_name, "").trim();
  const patchName = safeStr((statePatch as any)?.full_name, "").trim();
  const leadName = safeStr((leadState as any)?.full_name, "").trim();
  const stateName = safeStr((leadState as any)?.name, "").trim();
  return patchCollectedName || patchName || leadName || stateName || "";
}

function logEvent(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: nowIso(), event, ...data }));
}

function toErrorStack(err: unknown) {
  if (err instanceof Error) return err.stack ?? err.message;
  return safeStr(err, "");
}

function normalizeSecretValue(raw: string) {
  const v = safeStr(raw, "").trim();
  if (!v) return "";
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
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
  return source.includes("operator") || source.includes("manual") || source.includes("ui_manual") || actor === "human" || role === "operator";
}

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

function mergeCollectedStates(base: Record<string, unknown>, patch: Record<string, unknown>) {
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

export function mergeStatePatches(primary?: Json | null, secondary?: Json | null): Json {
  if (!primary) return secondary && typeof secondary === "object" ? { ...secondary } : {};
  if (!secondary) return primary;
  const primaryCollected = primary.collected && typeof primary.collected === "object" 
    ? { ...primary.collected } 
    : {};
  const secondaryCollected = secondary.collected && typeof secondary.collected === "object" 
    ? { ...secondary.collected } 
    : {};
  return {
    ...primary,
    ...secondary,
    collected: mergeCollectedStates(primaryCollected, secondaryCollected),
  };
}

// =============================================================================
// DATABASE LOADERS
// =============================================================================

async function loadOrgSecretsKV(supabase: SupabaseClientType, organizationId: string) {
  const res = await supabase
    .from("org_settings")
    .select("meta_page_access_token")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const kv: Record<string, string> = {};
  if (!res.error && res.data) {
    kv.META_PAGE_ACCESS_TOKEN = normalizeSecretValue(safeStr((res.data as any)?.meta_page_access_token, ""));
  }
  return kv;
}

async function loadOrgSecretWithFallback(supabase: SupabaseClientType, organizationId: string) {
  const r = await supabase
    .from("org_settings")
    .select("meta_page_id, meta_page_access_token")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (r.error) return null;
  return r.data as Json | null;
}

async function loadProductKnowledge(supabase: SupabaseClientType, organizationId: string) {
  const topics = ["implementation_steps", "pricing_plans", "dashboard_modules", "integrations", "trial_flow"];
  const data = await supabase.from("product_knowledge").select("topic, content").in("topic", topics);
  const map: Record<string, unknown> = {};
  if (!data.error && Array.isArray(data.data)) {
    for (const row of data.data as any[]) {
      const topic = safeStr(row.topic, "");
      if (topic) map[topic] = row.content;
    }
  }
  return map;
}

async function loadClinicKnowledge(supabase: SupabaseClientType, organizationId: string) {
  const topics = ["services", "pricing", "hours", "location", "appointment_policy", "insurance"];
  const data = await supabase.from("clinic_knowledge").select("topic, content").in("topic", topics);
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
  organizationId: string
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
  leadId: string
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

function finalizeOutboxJob(
  supabase: SupabaseClientType,
  jobId: string, 
  updates: Record<string, unknown>
) {
  return supabase
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
}

// =============================================================================
// ANTI-STORM: Check if response already exists
// =============================================================================

async function hasResponseAfterJobCreation(
  supabase: SupabaseClientType,
  leadId: string,
  jobCreatedAt: string
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
  const { supabase, organizationId, leadId, toolCalls, executionId, traceId, jobId } = args;
  
  let finalReply: string | undefined;
  let combinedStatePatch: Json = {};

  for (const toolCall of toolCalls) {
    const toolName = safeStr(toolCall?.name, "");
    const toolPayload = toolCall?.payload ?? {};

    if (!toolName) continue;

    console.log("[run-replies] Executing tool_call:", { toolName, toolPayload, leadId });

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
        console.log("[run-replies] Tool returned replyOverride:", toolName);
      }

      if (result.statePatch) {
        combinedStatePatch = mergeStatePatches(combinedStatePatch, result.statePatch);
      }
    } catch (err) {
      console.error("[run-replies] Tool execution failed:", { toolName, error: err });
    }
  }

  return { reply: finalReply, statePatch: combinedStatePatch };
}

// =============================================================================
// REPLY GENERATION
// =============================================================================

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

async function generateReply(args: GenerateReplyArgs): Promise<GenerateReplyResult> {
  const {
    supabase, organizationId, leadId, leadState: initialLeadState, inboundText: initialInboundText,
    orgSettings, recentMessages, productKnowledge, clinicKnowledge, clinicSettings,
    llmEnabled, isOperatorOutbound, manualText,
    executionId, traceId, jobId
  } = args;
  let leadState = initialLeadState;
  let inboundText = initialInboundText;

  // OPERATOR OUTBOUND (manual reply from dashboard)
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
  const isDentalOrg = businessType === "dental" || businessType === "clinic" || businessType.includes("dental");

  if (isDentalOrg) {
    const services = Array.isArray(clinicSettings?.services)
      ? (clinicSettings.services as any[]).map((service: any) => String(service?.name ?? service ?? "").trim()).filter(Boolean)
      : ["limpieza dental", "ortodoncia", "blanqueamiento", "implantes", "extracción", "consulta general"];
    const history = (recentMessages ?? []).slice(-6).map((message: any) => String(message.content ?? ""));

    classified = await classifyMessage({
      message: inboundText,
      conversationHistory: history,
      currentStage: safeStr((leadState as any)?.stage, "INITIAL"),
      nextExpected: safeStr((leadState as any)?.nextExpected, "") || null,
      collectedData: ((leadState as any)?.collected ?? {}) as Record<string, unknown>,
      clinicServices: services,
    });
  }

  if (classified) {
    const existingCollected = (((leadState as any)?.collected ?? {}) as Record<string, unknown>);

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

    if (classified.is_confirmation && safeStr((leadState as any)?.nextExpected, "") === "confirm_booking") {
      inboundText = "sí";
    }

    if (classified.is_negation && safeStr((leadState as any)?.nextExpected, "") === "confirm_booking") {
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
        ? `⚠️ Entiendo que es una emergencia. Por favor llama directamente a la clínica: ${clinicPhone}. Te atenderemos lo antes posible.`
        : "⚠️ Entiendo que es una emergencia. Te recomendamos visitar la clínica directamente o llamar para atención inmediata.";

      return {
        reply: emergencyMsg,
        statePatch: { lastIntent: "emergency" },
        leadPatch: {},
        debugNote: "llm:emergency",
      };
    }
  }

  const nameStep = maybeHandleNameCapture({
    organizationId,
    leadState: leadState as any,
    inboundText,
    channel: safeStr((leadState as any)?.channel, ""),
  });
  if (nameStep?.replyText) {
    const leadPatch: Json = {};
    const capturedFullName = safeStr((nameStep.statePatch as any)?.full_name, "").trim();
    if (capturedFullName && !capturedFullName.startsWith("Usuario ")) {
      leadPatch.full_name = capturedFullName;
      leadPatch.first_name = capturedFullName.split(/\s+/)[0] ?? capturedFullName;
    }
    return {
      reply: clampText(nameStep.replyText, 950),
      statePatch: nameStep.statePatch ?? {},
      leadPatch,
      debugNote: `name_gate:${safeStr(nameStep.debug?.route, "step")}`,
    };
  }

  // LLM MODE (OpenAI)
  if (llmEnabled && !isDentalOrg) {
    console.log("[run-replies] LLM mode enabled, calling runLlmTurn...");

    try {
      const llmResult = await runLlmTurn({
        organizationId,
        inboundText,
        leadState: leadState as any,
        orgSettings,
        recentMessages,
      });

      if (llmResult) {
        console.log("[run-replies] LLM returned result:", {
          hasReply: !!llmResult.reply,
          hasToolCalls: llmResult.tool_calls?.length > 0,
        });

        let reply = clampText(llmResult.reply, 950);
        let statePatch: Json = llmResult.state_patch ?? {};

        if (llmResult.tool_calls && llmResult.tool_calls.length > 0 && leadId) {
          console.log("[run-replies] LLM returned tool_calls:", llmResult.tool_calls);

          const toolResult = await executeToolCalls({
            supabase,
            organizationId,
            leadId,
            toolCalls: llmResult.tool_calls,
            executionId,
            traceId,
            jobId,
          });

          if (toolResult.reply) {
            reply = clampText(toolResult.reply, 950);
          }

          if (toolResult.statePatch) {
            statePatch = mergeStatePatches(statePatch, toolResult.statePatch);
          }
        }

        return {
          reply: reply || "Gracias por escribirnos. ¿En qué te puedo ayudar?",
          statePatch,
          leadPatch: {},
          debugNote: "llm",
        };
      }
    } catch (err) {
      console.error("[run-replies] LLM turn failed:", err);
    }
  }

  // FALLBACK: CONVERSATION ENGINE (deterministic)
  console.log("[run-replies] Using conversation engine fallback...");

  const engineResult = runConversationEngine({
    organizationId,
    leadState,
    inboundText,
    channel: safeStr((leadState as any)?.channel, ""),
    knowledge: productKnowledge,
    clinicKnowledge,
    clinicSettings,
  });

  if (engineResult?.replyText) {
    let reply = clampText(engineResult.replyText, 950);
    let statePatch: Json = engineResult.statePatch ?? {};
    const leadPatch: Json = {};

    const capturedFullName = safeStr((statePatch as any)?.full_name, "").trim();
    if (capturedFullName && !capturedFullName.startsWith("Usuario ")) {
      leadPatch.full_name = capturedFullName;
      leadPatch.first_name = capturedFullName.split(/\s+/)[0] ?? capturedFullName;
    }

    if (engineResult.toolAction && leadId) {
      const result = await executeToolAction({
        supabase,
        organizationId,
        leadId,
        action: engineResult.toolAction,
      });

      if (result.replyOverride) {
        reply = clampText(result.replyOverride, 950);
      }

      if (result.statePatch) {
        statePatch = mergeStatePatches(statePatch, result.statePatch);
      }
    }

    if (reply === "__SHOW_AVAILABILITY__") {
      const hours = (clinicSettings.hours ?? {}) as Record<string, unknown>;
      const { getAvailableSlots, formatSlotsMessage } = await import("./domain/availability.ts");
      const slots = await getAvailableSlots({
        supabase,
        organizationId,
        hours,
      });
      const slotsText = formatSlotsMessage(slots);
      const fullName = resolveLeadFullName(leadState, statePatch);
      const firstName = fullName ? fullName.split(/\s+/)[0] ?? "" : "";
      reply = firstName
        ? `${firstName}, estos son nuestros horarios disponibles:\n\n${slotsText}\n\n¿Qué día y hora te queda mejor?`
        : `Estos son nuestros horarios disponibles:\n\n${slotsText}\n\n¿Qué día y hora te queda mejor?`;
    }

    if (reply === "__BOOK_APPOINTMENT__") {
      const fullName = resolveLeadFullName(leadState, statePatch);
      const firstName = fullName ? fullName.split(/\s+/)[0] ?? "" : "";
      reply = `¡Listo${firstName ? `, ${firstName}` : ""}! Tu cita está confirmada. Te enviaremos un recordatorio 24 horas antes. 😊`;
    }

    return {
      reply,
      statePatch,
      leadPatch,
      debugNote: `engine:${safeStr(engineResult.debug?.stage, "") || safeStr(engineResult.debug?.intent, "") || "reply"}`,
    };
  }

  // FINAL FALLBACK
  return {
    reply: "Gracias por escribirnos. Te respondo en un momento.",
    statePatch: {},
    leadPatch: {},
    debugNote: "fallback",
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // AUTH
    const expected = env("RUN_REPLIES_SECRET");
    const provided = req.headers.get("x-run-replies-secret") ?? "";
    if (!provided || provided !== expected) {
      return j(401, { ok: false, error: "unauthorized" });
    }

    // INIT
    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
    const DEFAULT_META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v19.0";
    const DEFAULT_ORG_ENV = safeStr(Deno.env.get("DEFAULT_ORG"), "");

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const executionId = crypto.randomUUID();
    const workerId = `run-replies:${executionId}`;

    // PARSE REQUEST
    const url = new URL(req.url);
    const body = req.headers.get("content-type")?.includes("application/json")
      ? await req.json().catch(() => ({}))
      : {};

    const organization_id_input = safeStr(body?.organization_id, "") || 
      safeStr(url.searchParams.get("organization_id"), "");
    const organization_id = organization_id_input || DEFAULT_ORG_ENV;

    if (!organization_id) {
      return j(400, { ok: false, error: "missing_organization_id" });
    }

    logEvent("run_replies_start", { execution_id: executionId, organization_id });

    // LOAD SECRETS
    let pageAccessToken = normalizeSecretValue(Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? "");
    let metaGraphVersion = DEFAULT_META_GRAPH_VERSION;

    const kvSecrets = await loadOrgSecretsKV(supabase, organization_id);
    pageAccessToken = safeStr(kvSecrets.META_PAGE_ACCESS_TOKEN, pageAccessToken) || pageAccessToken;
    metaGraphVersion = safeStr(kvSecrets.META_GRAPH_VERSION, metaGraphVersion) || metaGraphVersion;

    const sec = await loadOrgSecretWithFallback(supabase, organization_id);
    if (sec) {
      const token = normalizeSecretValue(safeStr((sec as any).meta_page_access_token, ""));
      if (token) pageAccessToken = safeStr(token, pageAccessToken);
    }

    // LOAD ORG SETTINGS & KNOWLEDGE
    const orgSettingsRes = await supabase
      .from("org_settings")
      .select("llm_brain_enabled, system_prompt, business_type, brand_name")
      .eq("organization_id", organization_id)
      .maybeSingle();

    const orgSettings = (orgSettingsRes.data as any) ?? {};
    const llmEnabled = Boolean(orgSettings.llm_brain_enabled);

    const productKnowledge = await loadProductKnowledge(supabase, organization_id);
    const clinicKnowledge = await loadClinicKnowledge(supabase, organization_id);
    const clinicSettings = await loadClinicSettings(supabase, organization_id);

    // CLAIM JOBS
    const limit = Math.max(1, Math.min(Number(body?.limit ?? 10) || 10, 50));
    const lockTtlSeconds = Math.max(300, Math.min(Number(body?.lock_ttl_seconds ?? 300) || 300, 1800));
    const staleLockCutoff = new Date(Date.now() - lockTtlSeconds * 1000).toISOString();

    // Reclaim stale processing jobs
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

    // Claim new jobs
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
      });
    }

    // PROCESS JOBS
    let sent = 0;
    let failed = 0;
    let deduped = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const job of jobs) {
      const jobId = safeStr(job.id);
      const traceId = safeStr((job.payload as Json | null)?.trace_id, "") || crypto.randomUUID();
      const leadId = safeStr(job.lead_id, "");
      const jobCreatedAt = safeStr(job.created_at, "");

      try {
        // =====================================================================
        // ANTI-STORM: Check if response already exists for this job
        // =====================================================================
        if (leadId && jobCreatedAt && !isOperatorOutboundJob(job)) {
          const alreadyResponded = await hasResponseAfterJobCreation(
            supabase,
            leadId,
            jobCreatedAt
          );

          if (alreadyResponded) {
            console.log("[run-replies] ANTI-STORM: Response already exists, skipping:", {
              jobId,
              leadId,
              jobCreatedAt,
            });
            
            await finalizeOutboxJob(supabase, jobId, {
              status: "sent",
              sent_at: nowIso(),
              last_error: "deduped:response_already_exists",
              updated_at: nowIso(),
            });
            
            deduped++;
            sent++;
            continue;
          }
        }
        // =====================================================================

        // VALIDATE JOB
        const channel = normalizeChannel(safeStr(job.channel, "messenger"));
        if (channel !== "messenger") {
          throw new Error(`unsupported_channel:${channel}`);
        }

        const recipientId = safeStr(job.channel_user_id, "") || 
          safeStr(job.recipient_id, "") || 
          safeStr(job.psid, "");
        
        if (!recipientId) {
          throw new Error("missing_recipient_id");
        }

        if (!pageAccessToken || pageAccessToken.length <= 50) {
          throw new Error("missing_or_invalid_page_token");
        }

        // MARK AS PROCESSING
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
            attempt_count: (job.attempt_count ?? 0) + 1,
          })
          .eq("id", jobId);

        // LOAD CONTEXT
        const payload = ((job.payload as Json | null) ?? {}) as Json;
        const isOperatorOutbound = isOperatorOutboundJob(job);
        const manualText = clampText(safeStr(payload.text, ""));

        // Get inbound text
        let inboundText = clampText(
          safeStr(payload.inbound_text, "") || 
          safeStr(payload.text, "") ||
          safeStr(job.inbound_text, "") || 
          safeStr(job.text, "") ||
          safeStr(job.message_text, "")
        );

        if (!isOperatorOutbound && !inboundText) {
          throw new Error("missing_inbound_text");
        }

        // Load lead state
        let leadState: Json | null = null;
        if (leadId) {
          const ld = await supabase
            .from("leads")
            .select("state, full_name, first_name, last_name, channel")
            .eq("id", leadId)
            .maybeSingle();
          if (!ld.error && ld.data) {
            leadState = (ld.data as any).state as Json | null;
            const leadChannel = safeStr((ld.data as any)?.channel, "");
            if (leadChannel) {
              leadState = mergeLeadState(leadState, { channel: leadChannel });
            }
            const dbFullName = safeStr((ld.data as any)?.full_name, "").trim();
            const dbFirstName = safeStr((ld.data as any)?.first_name, "").trim();
            const dbLastName = safeStr((ld.data as any)?.last_name, "").trim();
            const effectiveName = dbFullName && !dbFullName.startsWith("Usuario ")
              ? dbFullName
              : [dbFirstName, dbLastName].filter(Boolean).join(" ").trim();
            if (effectiveName) {
              leadState = mergeLeadState(leadState, {
                full_name: effectiveName,
                name: effectiveName,
                collected_name: true,
                asked: {
                  ...(((leadState as any)?.asked ?? {}) as Record<string, unknown>),
                  full_name: true,
                },
                collected: {
                  ...(((leadState as any)?.collected ?? {}) as Record<string, unknown>),
                  full_name: effectiveName,
                },
              });
            }
          }
        }

        // Load recent messages
        const recentMessages = await loadRecentMessages(supabase, leadId);

        // GENERATE REPLY
        const { reply, statePatch, leadPatch, debugNote } = await generateReply({
          supabase,
          organizationId: organization_id,
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

        // =====================================================================
        // ANTI-STORM: Double-check before sending (in case of race condition)
        // =====================================================================
        if (leadId && jobCreatedAt && !isOperatorOutbound) {
          const alreadyResponded = await hasResponseAfterJobCreation(
            supabase,
            leadId,
            jobCreatedAt
          );

          if (alreadyResponded) {
            console.log("[run-replies] ANTI-STORM: Race condition caught, skipping send:", {
              jobId,
              leadId,
            });
            
            await finalizeOutboxJob(supabase, jobId, {
              status: "sent",
              sent_at: nowIso(),
              last_error: "deduped:race_condition_caught",
              updated_at: nowIso(),
            });
            
            deduped++;
            sent++;
            continue;
          }
        }
        // =====================================================================

        if (leadId && leadPatch && Object.keys(leadPatch).length > 0) {
          await supabase
            .from("leads")
            .update(leadPatch)
            .eq("id", leadId);
        }

        // SAVE OUTBOUND MESSAGE FIRST (before sending to Meta)
        let outboundMessageId: string | null = null;
        try {
          const outMsgInsert = await supabase
            .from("messages")
            .insert({
              organization_id,
              lead_id: leadId || null,
              channel,
              role: "assistant",
              actor: isOperatorOutbound ? "operator" : "bot",
              content: reply,
              created_at: nowIso(),
              channel_user_id: recipientId,
            })
            .select("id")
            .maybeSingle();
          outboundMessageId = outMsgInsert.data?.id ?? null;
        } catch (err) {
          console.warn("[run-replies] message_insert_failed", err);
        }

        // SEND TO META
        const metaResp = await sendToMeta({
          graphVersion: metaGraphVersion,
          pageAccessToken,
          recipientId,
          text: reply,
        });

        if (!metaResp?.ok) {
          // Delete the message we just saved since send failed
          if (outboundMessageId) {
            await supabase.from("messages").delete().eq("id", outboundMessageId);
          }
          throw new Error(`meta_send_failed:${metaResp?.status}:${JSON.stringify(metaResp?.data ?? {})}`);
        }

        // UPDATE JOB STATUS
        await supabase
          .from("reply_outbox")
          .update({
            status: "sent",
            sent_at: nowIso(),
            outbound_message_id: outboundMessageId,
            meta_message_id: metaResp?.data?.message_id ?? null,
            locked_at: null,
            locked_by: null,
            claimed_at: null,
            claimed_by: null,
            processing_started_at: null,
            last_error: debugNote ? `debug:${debugNote}` : null,
            updated_at: nowIso(),
          })
          .eq("id", jobId);

        // UPDATE LEAD STATE
        if (leadId) {
          const nextState = mergeLeadState(leadState, { 
            ...statePatch, 
            last_bot_text: reply 
          });

          await supabase
            .from("leads")
            .update({
              last_message_at: nowIso(),
              last_bot_reply_at: nowIso(),
              last_message_preview: reply.slice(0, 140),
              state: nextState,
            })
            .eq("id", leadId);
        }

        // UPDATE MESSAGE WITH META ID
        if (outboundMessageId && metaResp?.data?.message_id) {
          await supabase
            .from("messages")
            .update({ provider_message_id: String(metaResp.data.message_id) })
            .eq("id", outboundMessageId);
        }

        logEvent("run_replies_job_sent", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id,
          lead_id: leadId,
          job_id: jobId,
          debug_note: debugNote,
        });

        sent++;

      } catch (e: any) {
        // ERROR HANDLING
        const msg = safeStr(e?.message, String(e));
        const retryableStatus = parseMetaStatus(msg);
        const isRetryable = msg.includes("429") || msg.includes("5") || 
          retryableStatus === 429 || (retryableStatus !== null && retryableStatus >= 500);
        
        const attemptCount = Number((job as any).attempt_count ?? 0) + 1;
        const maxRetries = 3; // Reduced from 8 to prevent storm
        const shouldRetry = isRetryable && attemptCount < maxRetries;
        const terminalDead = attemptCount >= maxRetries;

        failures.push({ id: jobId, error: msg });
        failed++;

        await finalizeOutboxJob(supabase, jobId, {
          status: shouldRetry ? "queued" : terminalDead ? "dead" : "failed",
          scheduled_for: shouldRetry ? plusSecondsIso(backoffSeconds(attemptCount)) : nowIso(),
          last_error: msg,
          updated_at: nowIso(),
        });

        logEvent("run_replies_job_failed", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id,
          lead_id: leadId,
          job_id: jobId,
          error: msg,
          retryable: shouldRetry,
        });
      }
    }

    // RETURN SUMMARY
    logEvent("run_replies_complete", {
      execution_id: executionId,
      organization_id,
      sent,
      failed,
      deduped,
    });

    return j(200, {
      ok: true,
      execution_id: executionId,
      org_id: organization_id,
      claimed_count: jobs.length,
      sent_count: sent,
      failed_count: failed,
      deduped_count: deduped,
      reclaimed_processing: reclaimedCount,
      failures,
    });

  } catch (e: any) {
    return j(500, { ok: false, error: safeStr(e?.message, String(e)) });
  }
});
