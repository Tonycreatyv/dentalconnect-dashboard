/// <reference lib="deno.unstable" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  ensureConversationState,
  resolveMode,
  stripTestDentalTag,
} from "../_shared/conversationEngine.ts";
import { normalizeWhatsAppInboundMessage } from "../shared/whatsappNormalization.ts";
import { extractMessengerEvents, validateMetaSignature } from "./messenger.ts";
import {
  booleanFlag,
  coexistenceActivationMessageId,
  isDuplicateDatabaseError,
  isPendingCoexistenceActivation,
  isWhatsAppAutomationAllowed,
  resolveExactWhatsAppTenant,
  type WhatsAppOrganizationSettings,
} from "./whatsappActivation.ts";

type Json = Record<string, unknown>;

const TESTDENTAL_TAG = "#testdental";
export const META_TEST_PROBE_PHONE_NUMBER_ID = "1185864697945379";
const META_TEST_DEMO_ORGANIZATION_ID = "luis-gabriel-referral-hub";
const META_TEST_DEMO_ROUTE_TYPE = "meta_test_demo";

function isMetaTestDemoEnabled() {
  return String(Deno.env.get("META_WHATSAPP_TEST_DEMO_ENABLED") ?? "")
    .trim().toLowerCase() === "true";
}

function isExplicitMetaTestDemoPhone(phoneNumberId: unknown) {
  return isMetaTestDemoEnabled() &&
    safeString(phoneNumberId) === META_TEST_PROBE_PHONE_NUMBER_ID;
}

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isBotAutoReplyPaused(): boolean {
  return String(Deno.env.get("BOT_AUTO_REPLY_PAUSED") ?? "").trim()
    .toLowerCase() === "true";
}

function ensureState(state: any): any {
  const s = state && typeof state === "object" ? state : {};
  if (!s.stage) s.stage = "collecting";
  if (!("full_name" in s)) s.full_name = null;
  if (!("collected_name" in s)) s.collected_name = false;
  if (!("service" in s)) s.service = null;
  if (!("phone" in s)) s.phone = null;
  if (!("availability" in s)) s.availability = null;
  if (!("asked" in s)) {
    s.asked = {
      full_name: false,
      service: false,
      phone: false,
      availability: false,
    };
  }
  if (!("last_bot_step" in s)) s.last_bot_step = null;
  if (!("intent" in s)) s.intent = null;
  if (!("last_seen_inbound_message_id" in s)) {
    s.last_seen_inbound_message_id = null;
  }
  return s;
}

function psidSuffix(psid: string) {
  const digits = String(psid ?? "").replace(/\D/g, "");
  if (!digits) return "0000";
  return digits.slice(-4).padStart(4, "0");
}

type InboundEvent = {
  channel: "messenger" | "whatsapp";
  page_id?: string;
  waba_id?: string;
  phone_number_id?: string;
  sender_id: string;
  mid: string;
  text: string;
  payload_action?: string | null;
  flow_response?: Record<string, unknown>;
  timestamp: number;
  sender_name?: string | null;
};

type WhatsAppHumanEchoEvent = {
  channel: "whatsapp";
  waba_id: string;
  phone_number_id: string;
  to: string;
  mid: string;
  text: string;
  timestamp: number;
  source: "smb_message_echoes";
};

export function isMetaTestProbeInbound(event: {
  channel: string;
  phone_number_id?: string;
}) {
  return event.channel === "whatsapp" &&
    event.phone_number_id === META_TEST_PROBE_PHONE_NUMBER_ID &&
    !isExplicitMetaTestDemoPhone(event.phone_number_id);
}

function metaTestProbeObservation(
  event: InboundEvent | WhatsAppHumanEchoEvent,
) {
  const sender = "sender_id" in event
    ? normalizeChannelUserId("whatsapp", event.sender_id)
    : normalizeChannelUserId("whatsapp", event.to);
  return {
    probe: "META_TEST_PROBE",
    received_at: new Date(event.timestamp).toISOString(),
    phone_number_id: event.phone_number_id,
    sender,
    provider_message_id_present: Boolean(event.mid),
    event_type: "sender_id" in event ? "messages" : event.source,
  };
}

function unmappedWhatsAppObservation(args: {
  phoneNumberId: string;
  providerMessageId: string;
  timestamp: number;
  eventType: string;
}) {
  return {
    phone_number_id: args.phoneNumberId || null,
    provider_message_id: args.providerMessageId || null,
    event_type: args.eventType,
    received_at: new Date(args.timestamp).toISOString(),
  };
}

type LeadRoutingDiagnostics = {
  scopedLead: Record<string, any> | null;
  staleLeads: Array<Record<string, unknown>>;
  duplicateCount: number;
};

function normalizePsid(input: unknown) {
  if (typeof input === "string") {
    return input.trim();
  }
  if (typeof input === "number") {
    return String(input).trim();
  }
  return "";
}

function normalizeChannelUserId(
  channel: "messenger" | "whatsapp",
  input: unknown,
) {
  const value = safeString(input);
  if (channel !== "whatsapp") return value;
  return value.replace(/\D/g, "");
}

function isArchivedChannelUserId(input: unknown) {
  return safeString(input).toLowerCase().startsWith("archived_");
}

function chooseLeadForInbound(
  rows: Array<Record<string, any>>,
  defaultOrg: string,
) {
  const sorted = [...rows].sort((a, b) => {
    const aActive = String(a?.status ?? "").toLowerCase() === "active" ? 0 : 1;
    const bActive = String(b?.status ?? "").toLowerCase() === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;

    const aHandoff = a?.handoff_to_human === true ? 1 : 0;
    const bHandoff = b?.handoff_to_human === true ? 1 : 0;
    if (aHandoff !== bHandoff) return aHandoff - bHandoff;

    const aDefaultOrg = safeString(a?.organization_id) === defaultOrg ? 1 : 0;
    const bDefaultOrg = safeString(b?.organization_id) === defaultOrg ? 1 : 0;
    if (aDefaultOrg !== bDefaultOrg) return aDefaultOrg - bDefaultOrg;

    const aUpdated = Date.parse(String(a?.updated_at ?? "")) || 0;
    const bUpdated = Date.parse(String(b?.updated_at ?? "")) || 0;
    return bUpdated - aUpdated;
  });
  return sorted[0] ?? null;
}

async function findWhatsAppLeadRoutingDiagnostics(args: {
  supabase: any;
  channelUserId: string;
  rawChannelUserId?: string;
  selectedOrganizationId: string;
  defaultOrg: string;
}): Promise<LeadRoutingDiagnostics> {
  const channelUserId = normalizeChannelUserId("whatsapp", args.channelUserId);
  if (!channelUserId) {
    return { scopedLead: null, staleLeads: [], duplicateCount: 0 };
  }

  const res = await args.supabase
    .from("leads")
    .select(
      "id, organization_id, state, full_name, channel, channel_user_id, status, handoff_to_human, updated_at",
    )
    .eq("channel", "whatsapp")
    .eq("channel_user_id", channelUserId)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (res.error) throw res.error;

  const rows = (Array.isArray(res.data) ? res.data : [])
    .filter((row: Record<string, any>) =>
      !isArchivedChannelUserId(row?.channel_user_id)
    );
  const selectedOrgRows = rows.filter((row: Record<string, any>) =>
    safeString(row?.organization_id) === args.selectedOrganizationId
  );
  const scopedLead = chooseLeadForInbound(selectedOrgRows, args.defaultOrg);
  const staleLeads = rows
    .filter((row: Record<string, any>) =>
      safeString(row?.organization_id) !== args.selectedOrganizationId
    )
    .map((row: Record<string, any>) => ({
      id: row?.id,
      organization_id: row?.organization_id,
      status: row?.status,
      handoff_to_human: row?.handoff_to_human,
      state_org_type: (row?.state && typeof row.state === "object")
        ? safeString(row.state.orgType ?? row.state.business_type)
        : "",
      updated_at: row?.updated_at,
    }))
    .filter((row: Record<string, unknown>) => row.id);

  if (staleLeads.length > 0) {
    console.log("[meta-webhook] stale_whatsapp_leads_detected", {
      inbound_from: args.rawChannelUserId ?? args.channelUserId,
      channel_user_id: channelUserId,
      selected_organization_id: args.selectedOrganizationId,
      stale_lead_count: staleLeads.length,
      stale_leads: staleLeads,
    });
  }

  return { scopedLead, staleLeads, duplicateCount: rows.length };
}

function collectTesterPsids(target: Set<string>, raw: unknown) {
  if (!raw) return;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const normalized = normalizePsid(item);
      if (normalized) target.add(normalized);
    }
    return;
  }
  const asString = String(raw).trim();
  if (!asString) return;
  try {
    const parsed = JSON.parse(asString);
    if (Array.isArray(parsed)) {
      collectTesterPsids(target, parsed);
      return;
    }
  } catch {
    // fall back to comma/space split
  }
  for (const chunk of asString.split(/[\\s,]+/)) {
    const normalized = chunk.trim();
    if (normalized) target.add(normalized);
  }
}

function extractWhatsAppTextEvents(body: any): InboundEvent[] {
  const events: InboundEvent[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const wabaId = safeString(entry?.id);
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (String(change?.field ?? "") !== "messages") continue;
      const value = change?.value ?? {};
      const metadata = value?.metadata ?? {};
      const phoneNumberId = safeString(metadata?.phone_number_id);
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      for (const msg of messages) {
        const senderId = normalizeChannelUserId("whatsapp", msg?.from);
        const mid = safeString(msg?.id);
        const normalized = normalizeWhatsAppInboundMessage(msg);
        const text = normalized?.content ?? "";
        const payloadAction = normalized?.payload_action ?? null;
        if (!senderId || !mid || !text) continue;
        const contact = contacts.find((item: any) =>
          normalizeChannelUserId("whatsapp", item?.wa_id) === senderId
        ) ?? contacts[0];
        events.push({
          channel: "whatsapp",
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          sender_id: senderId,
          mid,
          text,
          payload_action: payloadAction,
          ...(normalized?.flow_response
            ? { flow_response: normalized.flow_response }
            : {}),
          timestamp: Number(
            msg?.timestamp ? Number(msg.timestamp) * 1000 : Date.now(),
          ),
          sender_name: safeString(contact?.profile?.name) || null,
        });
      }
    }
  }

  return events;
}

function extractWhatsAppHumanEchoEvents(body: any): WhatsAppHumanEchoEvent[] {
  const events: WhatsAppHumanEchoEvent[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const wabaId = safeString(entry?.id);
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (String(change?.field ?? "") !== "messages") continue;
      const value = change?.value ?? {};
      const metadata = value?.metadata ?? {};
      const phoneNumberId = safeString(metadata?.phone_number_id);
      const echoes = Array.isArray(value?.smb_message_echoes)
        ? value.smb_message_echoes
        : [];
      for (const echo of echoes) {
        const to = normalizeChannelUserId(
          "whatsapp",
          echo?.to?.[0]?.wa_id || echo?.to || echo?.recipient_id,
        );
        const mid = safeString(echo?.id || echo?.message_id);
        const text = safeString(
          echo?.text?.body || echo?.message?.text || echo?.content,
        );
        if (!to || !mid || !text) continue;
        events.push({
          channel: "whatsapp",
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          to,
          mid,
          text,
          timestamp: Number(
            echo?.timestamp ? Number(echo.timestamp) * 1000 : Date.now(),
          ),
          source: "smb_message_echoes",
        });
      }
    }
  }
  return events;
}

function parseCsvSet(input: string) {
  const out = new Set<string>();
  for (const raw of String(input ?? "").split(",")) {
    const value = raw.trim();
    if (value) out.add(value);
  }
  return out;
}

function safeString(input: unknown) {
  if (typeof input === "string") return input.trim();
  if (typeof input === "number") return String(input).trim();
  return "";
}

import {
  LEGACY_DEFAULT_ORGANIZATION_ID,
  LEGACY_DEMO_CONTACT_ROUTES,
} from "../_shared/tenancy/legacyCompatibility.ts";

function parseDemoContactRoutes(input: string): Record<string, string> {
  const routes: Record<string, string> = { ...LEGACY_DEMO_CONTACT_ROUTES };
  const raw = String(input ?? "").trim();
  if (!raw) return routes;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [channelUserId, organizationId] of Object.entries(parsed)) {
        const normalizedChannelUserId = normalizeChannelUserId(
          "whatsapp",
          channelUserId,
        );
        const normalizedOrg = safeString(organizationId);
        if (normalizedChannelUserId && normalizedOrg) {
          routes[normalizedChannelUserId] = normalizedOrg;
        }
      }
      return routes;
    }
  } catch {
    // fall back to comma separated contact:organization pairs
  }
  for (const chunk of raw.split(",")) {
    const [channelUserId, organizationId] = chunk.split(":");
    const normalizedChannelUserId = normalizeChannelUserId(
      "whatsapp",
      channelUserId,
    );
    const normalizedOrg = safeString(organizationId);
    if (normalizedChannelUserId && normalizedOrg) {
      routes[normalizedChannelUserId] = normalizedOrg;
    }
  }
  return routes;
}

function getDemoSharedPhoneNumberIds(): Set<string> {
  return parseCsvSet(
    [
      Deno.env.get("DEMO_SHARED_WHATSAPP_PHONE_NUMBER_ID") ?? "",
      Deno.env.get("DEMO_WHATSAPP_PHONE_NUMBER_ID") ?? "",
      Deno.env.get("DEMO_SHARED_PHONE_NUMBER_ID") ?? "",
    ].filter(Boolean).join(","),
  );
}

function resolveDemoContactRoute(args: {
  phoneNumberId: string;
  channelUserId: string;
}) {
  const phoneNumberId = safeString(args.phoneNumberId);
  const channelUserId = normalizeChannelUserId("whatsapp", args.channelUserId);
  if (!phoneNumberId || !channelUserId) return null;
  if (!getDemoSharedPhoneNumberIds().has(phoneNumberId)) return null;
  const routes = parseDemoContactRoutes(
    Deno.env.get("DEMO_CONTACT_ROUTES") ?? "",
  );
  const organizationId = safeString(routes[channelUserId]);
  return organizationId ? { organizationId } : null;
}

function promptKeyForBusinessType(input: unknown) {
  const businessType = safeString(input).toLowerCase();
  return businessType === "barbershop" ? "barbershop_v1" : "dental_v1";
}

function summarizeRoutingCandidates(rows: Array<Record<string, any>>) {
  return rows.map((row) => ({
    organization_id: safeString(row?.organization_id),
    business_type: safeString(row?.business_type),
    whatsapp_enabled: booleanFlag(row?.whatsapp_enabled),
    bot_enabled: booleanFlag(row?.bot_enabled),
    updated_at: safeString(row?.updated_at),
  }));
}

async function resolveOrganizationForInbound(args: {
  supabase: any;
  channel: "messenger" | "whatsapp";
  pageId: string;
  phoneNumberId: string;
  wabaId?: string;
  channelUserId?: string;
  defaultOrg: string;
}) {
  const { supabase, channel, pageId, phoneNumberId, defaultOrg } = args;
  let organizationId: string | null = null;
  let businessType = "";
  let source:
    | "demo_contact_route"
    | "meta_test_demo"
    | "org_settings"
    | "messenger_meta_page_id"
    | "default_org"
    | "unmapped_whatsapp_phone" = channel === "whatsapp"
      ? "unmapped_whatsapp_phone"
      : "default_org";
  let routeType: string | null = null;
  let routingCandidates: Array<Record<string, unknown>> = [];
  let whatsappSettings: WhatsAppOrganizationSettings | null = null;
  let whatsappResolution:
    | "resolved"
    | "unmapped"
    | "ambiguous"
    | "phone_mismatch"
    | "waba_mismatch"
    | null = null;

  if (channel === "messenger" && pageId) {
    const orgLookup = await supabase
      .from("org_settings")
      .select("organization_id,business_type")
      .eq("meta_page_id", pageId)
      .eq("messenger_enabled", true)
      .maybeSingle();
    if (!orgLookup.error && orgLookup.data?.organization_id) {
      organizationId = String(orgLookup.data.organization_id);
      businessType = String(orgLookup.data.business_type ?? "").trim();
      source = "messenger_meta_page_id";
    }
  } else if (channel === "whatsapp" && phoneNumberId) {
    if (isExplicitMetaTestDemoPhone(phoneNumberId)) {
      organizationId = META_TEST_DEMO_ORGANIZATION_ID;
      source = "meta_test_demo";
      routeType = META_TEST_DEMO_ROUTE_TYPE;
    } else {
      const orgSettingsLookup = await supabase
        .from("org_settings")
        .select(
          "organization_id,business_type,whatsapp_phone_number_id,whatsapp_waba_id,whatsapp_enabled,bot_enabled,whatsapp_registered,whatsapp_webhooks_subscribed,whatsapp_onboarding_mode,whatsapp_onboarding_event,whatsapp_business_app_coexistence_completed,updated_at",
        )
        .eq("whatsapp_phone_number_id", phoneNumberId)
        .order("updated_at", { ascending: false })
        .limit(20);
      const orgSettingsRows =
        !orgSettingsLookup.error && Array.isArray(orgSettingsLookup.data)
          ? orgSettingsLookup.data
          : [];
      routingCandidates = summarizeRoutingCandidates(orgSettingsRows);
      const exactResolution = resolveExactWhatsAppTenant(
        orgSettingsRows,
        phoneNumberId,
        args.wabaId ?? "",
      );
      whatsappResolution = exactResolution.status;
      if (exactResolution.status === "resolved") {
        const selected = exactResolution.settings;
        organizationId = String(selected.organization_id);
        businessType = String(selected.business_type ?? "").trim();
        whatsappSettings = selected;
        source = "org_settings";
      } else {
        if (exactResolution.status === "ambiguous") {
          console.warn("[meta-webhook] whatsapp_org_routing_ambiguous", {
            phone_number_id: phoneNumberId,
            candidate_count: orgSettingsRows.length,
            candidate_orgs: summarizeRoutingCandidates(orgSettingsRows),
            resolution: "rejected",
          });
        } else if (exactResolution.status === "waba_mismatch") {
          console.warn("[meta-webhook] whatsapp_waba_mismatch", {
            phone_number_id: phoneNumberId,
            inbound_waba_id: args.wabaId ?? null,
            resolution: "rejected",
          });
        }
        const demoRoute = exactResolution.status === "unmapped"
          ? resolveDemoContactRoute({
            phoneNumberId,
            channelUserId: args.channelUserId ?? "",
          })
          : null;
        if (demoRoute?.organizationId) {
          organizationId = demoRoute.organizationId;
          source = "demo_contact_route";
        }
      }
      if (source === "demo_contact_route" && organizationId) {
        const typeLookup = await supabase
          .from("org_settings")
          .select("organization_id,business_type")
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (!typeLookup.error) {
          businessType = String(typeLookup.data?.business_type ?? "").trim();
        }
      }
      if (!organizationId) {
        source = "unmapped_whatsapp_phone";
      }
    }
  }

  return {
    organizationId,
    businessType,
    source,
    routeType,
    routingCandidates,
    whatsappSettings,
    whatsappResolution,
    promptKey: promptKeyForBusinessType(businessType),
  };
}

function shouldScheduleFollowup(text: string) {
  const t = String(text ?? "").toLowerCase();
  const keys = [
    "precio",
    "precios",
    "costo",
    "costos",
    "agenda",
    "agendar",
    "cita",
    "horario",
  ];
  return keys.some((k) => t.includes(k));
}

function waitlistDecision(text: string): "accept" | "decline" | null {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  const yes = ["si", "sí", "yes", "ok", "dale", "me interesa", "confirmo"];
  const no = ["no", "nop", "no gracias", "paso", "ahora no"];
  if (yes.some((k) => t === k || t.includes(k))) return "accept";
  if (no.some((k) => t === k || t.includes(k))) return "decline";
  return null;
}

async function fetchMetaProfileDetails(
  args: { pageAccessToken: string; psid: string },
) {
  if (!args.pageAccessToken || !args.psid) return null;
  try {
    const url = new URL(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(args.psid)}`,
    );
    url.searchParams.set(
      "fields",
      "first_name,last_name,profile_pic,locale,timezone,gender",
    );
    url.searchParams.set("access_token", args.pageAccessToken);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) return null;
    const first = String(data?.first_name ?? "").trim() || null;
    const last = String(data?.last_name ?? "").trim() || null;
    const locale = String(data?.locale ?? "").trim() || null;
    const timezone = typeof data?.timezone === "number"
      ? String(data?.timezone)
      : null;
    const gender = String(data?.gender ?? "").trim() || null;
    const profilePic = String(data?.profile_pic ?? "").trim() || null;
    const full = [first, last].filter(Boolean).join(" ").trim() || null;
    if (!first && !last && !profilePic && !full) return null;
    return {
      firstName: first,
      lastName: last,
      fullName: full,
      profilePic,
      locale,
      timezone,
      gender,
    };
  } catch {
    return null;
  }
}

async function resolvePageToken(
  supabase: any,
  organizationId: string,
) {
  const { data } = await supabase
    .from("org_settings")
    .select("meta_page_access_token")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return String(data?.meta_page_access_token ?? "").trim();
}

serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "";
  const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
  const DEFAULT_ORG = Deno.env.get("DEFAULT_ORG") ??
    LEGACY_DEFAULT_ORGANIZATION_ID;
  const RUN_REPLIES_SECRET = Deno.env.get("RUN_REPLIES_SECRET") ?? "";
  const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
  const TESTDENTAL_ALLOWED_PSIDS = parseCsvSet(
    Deno.env.get("TESTDENTAL_ALLOWED_PSIDS") ?? "",
  );
  const botAutoReplyPaused = isBotAutoReplyPaused();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !META_VERIFY_TOKEN) {
    return json(200, { ok: false, error: "missing_env" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === META_VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    if (req.method !== "POST") {
      return json(405, { ok: false, error: "method_not_allowed" });
    }

    const rawBody = await req.text();
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json(400, { ok: false, error: "invalid_json" });
    }
    const metaObject = String(body?.object ?? "");
    if (metaObject === "page" || metaObject === "whatsapp_business_account") {
      const signatureValid = await validateMetaSignature({
        rawBody,
        signatureHeader: req.headers.get("x-hub-signature-256"),
        appSecret: META_APP_SECRET,
      });
      if (!signatureValid) {
        return json(401, { ok: false, error: "invalid_meta_signature" });
      }
    }
    const echoEvents = extractWhatsAppHumanEchoEvents(body);
    const probeEchoEvents = echoEvents.filter(isMetaTestProbeInbound);
    for (const event of probeEchoEvents) {
      console.log(
        "[meta-webhook] meta_test_probe_received",
        metaTestProbeObservation(event),
      );
    }
    const businessEchoEvents = echoEvents.filter((event) =>
      !isMetaTestProbeInbound(event)
    );
    if (businessEchoEvents.length > 0) {
      for (const echo of businessEchoEvents) {
        const resolvedOrg = await resolveOrganizationForInbound({
          supabase,
          channel: "whatsapp",
          pageId: "",
          phoneNumberId: echo.phone_number_id,
          wabaId: echo.waba_id,
          channelUserId: echo.to,
          defaultOrg: DEFAULT_ORG,
        });
        const organization_id = resolvedOrg.organizationId;
        if (!organization_id) {
          console.warn(
            "[meta-webhook] unmapped_whatsapp_phone",
            unmappedWhatsAppObservation({
              phoneNumberId: echo.phone_number_id,
              providerMessageId: echo.mid,
              timestamp: echo.timestamp,
              eventType: echo.source,
            }),
          );
          continue;
        }
        console.log("[meta-webhook] human_echo_routing", {
          phone_number_id: echo.phone_number_id,
          channel_user_id: echo.to,
          candidate_orgs: resolvedOrg.routingCandidates,
          selected_organization_id: organization_id,
          selected_business_type: resolvedOrg.businessType,
          selected_prompt_key: resolvedOrg.promptKey,
          organization_source: resolvedOrg.source,
        });
        const leadRes = await supabase
          .from("leads")
          .select("id,state")
          .eq("organization_id", organization_id)
          .eq("channel", "whatsapp")
          .eq("channel_user_id", echo.to)
          .maybeSingle();
        if (!leadRes.error && leadRes.data?.id) {
          const nowIso = new Date(echo.timestamp).toISOString();
          const pausedUntil = new Date(echo.timestamp + 60 * 60 * 1000)
            .toISOString();
          const prevState =
            leadRes.data.state && typeof leadRes.data.state === "object"
              ? (leadRes.data.state as Record<string, unknown>)
              : {};
          const nextState = {
            ...prevState,
            conversation_mode: "human_active",
            bot_paused_until: pausedUntil,
            paused_reason: "human_replied_from_whatsapp_app",
            last_human_message_at: nowIso,
            last_human_actor: "whatsapp_app",
          };
          await supabase
            .from("leads")
            .update({
              state: nextState,
              last_message_at: nowIso,
              last_message_preview: echo.text.slice(0, 140),
            })
            .eq("id", leadRes.data.id);
          await supabase
            .from("messages")
            .insert({
              organization_id,
              lead_id: leadRes.data.id,
              channel: "whatsapp",
              role: "assistant",
              actor: "human",
              content: echo.text,
              created_at: nowIso,
              provider_message_id: echo.mid,
              channel_user_id: echo.to,
            });
          console.log("[meta-webhook] human_takeover_activated", {
            organization_id,
            lead_id: leadRes.data.id,
            human_takeover_source: "human_replied_from_whatsapp_app",
            bot_paused_until: pausedUntil,
            provider_message_id: echo.mid,
          });
        } else {
          console.log("[meta-webhook] human_echo_detected_no_lead_match", {
            organization_id,
            channel_user_id: echo.to,
            provider_message_id: echo.mid,
            source: echo.source,
          });
        }
      }
    }
    const inboundEvents = [
      ...extractMessengerEvents(body),
      ...extractWhatsAppTextEvents(body),
    ];
    const probeEvents = inboundEvents.filter(isMetaTestProbeInbound);
    for (const event of probeEvents) {
      console.log(
        "[meta-webhook] meta_test_probe_received",
        metaTestProbeObservation(event),
      );
    }
    const events = inboundEvents.filter((event) =>
      !isMetaTestProbeInbound(event)
    );
    if (!events.length) {
      return json(200, {
        ok: true,
        received: 0,
        organization_ids: [],
        probe_events: probeEvents.map(metaTestProbeObservation),
      });
    }

    let received = 0;
    let created_jobs = 0;
    let updated_leads = 0;
    const orgIds = new Set<string>();

    for (const ev of events) {
      received++;

      const channel = ev.channel;
      const pageId = ev.page_id ?? "";
      const phoneNumberId = (ev as InboundEvent).phone_number_id ?? "";
      const wabaId = (ev as InboundEvent).waba_id ?? "";
      const rawSenderId = safeString(ev.sender_id);
      const senderId = normalizeChannelUserId(channel, ev.sender_id);
      const providerMid = ev.mid;
      const traceId = providerMid || crypto.randomUUID();
      const rawText = ev.text;
      const lowerText = rawText.toLowerCase();
      const hasTestdentalTag = lowerText.includes(TESTDENTAL_TAG);
      const hasResetTag = lowerText.includes("#reset");
      const cleanedText = stripTestDentalTag(rawText);
      const text = cleanedText || rawText;
      const payloadAction = safeString((ev as any).payload_action);
      const isoTime = new Date(ev.timestamp).toISOString();

      let organization_id = "";
      let orgBusinessType = "";
      let orgTesterPsids = new Set<string>();
      let organizationSource = "default_org";
      let defaultOrgUsed = false;
      let duplicateLeadCount = 0;
      let staleLeadCount = 0;
      let staleLeads: Array<Record<string, unknown>> = [];
      const resolvedOrg = await resolveOrganizationForInbound({
        supabase,
        channel,
        pageId,
        phoneNumberId,
        wabaId,
        channelUserId: senderId,
        defaultOrg: DEFAULT_ORG,
      });
      if (channel === "messenger" && !resolvedOrg.organizationId) {
        console.warn("[meta-webhook] unknown_messenger_page_rejected", {
          page_id: pageId,
          provider_message_id: providerMid,
        });
        return json(404, { ok: false, error: "unknown_messenger_page" });
      }
      if (channel === "whatsapp" && !resolvedOrg.organizationId) {
        console.warn(
          "[meta-webhook] unmapped_whatsapp_phone",
          unmappedWhatsAppObservation({
            phoneNumberId,
            providerMessageId: providerMid,
            timestamp: ev.timestamp,
            eventType: "messages",
          }),
        );
        continue;
      }
      const resolvedOrganizationId = resolvedOrg.organizationId as string;
      let existingLead: Record<string, any> | null = null;

      organization_id = resolvedOrganizationId;
      orgBusinessType = resolvedOrg.businessType;
      organizationSource = resolvedOrg.source;
      defaultOrgUsed = resolvedOrg.source === "default_org";
      orgIds.add(organization_id);
      const activationProbe = channel === "whatsapp" &&
        isPendingCoexistenceActivation(resolvedOrg.whatsappSettings);
      const automationAllowed = channel !== "whatsapp" ||
        isWhatsAppAutomationAllowed(resolvedOrg.whatsappSettings) ||
        resolvedOrg.source === "meta_test_demo" ||
        resolvedOrg.source === "demo_contact_route";
      if (
        channel === "whatsapp" &&
        !activationProbe &&
        !automationAllowed &&
        !booleanFlag(resolvedOrg.whatsappSettings?.whatsapp_enabled)
      ) {
        console.warn("[meta-webhook] whatsapp_inbound_disabled", {
          organization_id,
          phone_number_id: phoneNumberId,
          waba_id: wabaId || null,
        });
        continue;
      }
      if (channel === "whatsapp") {
        const leadDiagnostics = await findWhatsAppLeadRoutingDiagnostics({
          supabase,
          channelUserId: senderId,
          rawChannelUserId: rawSenderId,
          selectedOrganizationId: organization_id,
          defaultOrg: DEFAULT_ORG,
        });
        existingLead = leadDiagnostics.scopedLead;
        duplicateLeadCount = leadDiagnostics.duplicateCount;
        staleLeads = leadDiagnostics.staleLeads;
        staleLeadCount = staleLeads.length;
      }
      if (!orgBusinessType) {
        const typeRes = await supabase
          .from("org_settings")
          .select("business_type")
          .eq("organization_id", organization_id)
          .maybeSingle();
        if (!typeRes.error) {
          orgBusinessType = String(typeRes.data?.business_type ?? "").trim();
        }
      }
      if (!orgTesterPsids.size) {
        const testerRes = await supabase
          .from("org_settings")
          .select("tester_psids")
          .eq("organization_id", organization_id)
          .maybeSingle();
        if (!testerRes.error) {
          collectTesterPsids(orgTesterPsids, testerRes.data?.tester_psids);
        }
      }
      const isTester = channel === "messenger" && orgTesterPsids.has(senderId);
      console.log("[meta-webhook] inbound", {
        organization_id,
        organization_source: organizationSource,
        whatsapp_route_type: resolvedOrg.routeType,
        default_org: DEFAULT_ORG,
        candidate_orgs: resolvedOrg.routingCandidates,
        selected_business_type: orgBusinessType,
        selected_prompt_key: promptKeyForBusinessType(orgBusinessType),
        page_id: pageId,
        phone_number_id: phoneNumberId,
        inbound_from: rawSenderId,
        normalized_channel_user_id: senderId,
        existing_lead_found_under_selected_org: Boolean(existingLead?.id),
        stale_lead_count: staleLeadCount,
        stale_leads: staleLeads,
        sender_id: senderId,
        channel,
        provider_message_id: providerMid,
        has_testdental_tag: hasTestdentalTag,
        is_tester: isTester,
      });

      if (!existingLead?.id) {
        const { data: scopedLead, error: selErr } = await supabase
          .from("leads")
          .select(
            "id, organization_id, state, full_name, channel, status, handoff_to_human, updated_at",
          )
          .eq("organization_id", organization_id)
          .eq("channel", channel)
          .eq("channel_user_id", senderId)
          .maybeSingle();
        if (selErr) throw selErr;
        existingLead = scopedLead ?? null;
      }

      const nextState = ensureConversationState(
        ensureState(existingLead?.state),
      );
      const existingMode = safeString(nextState.mode);
      const resetTriggered = organization_id === "creatyv-product" &&
        isTester && hasResetTag;
      if (resetTriggered) {
        nextState.mode = "creatyv_product";
        nextState.phase = "new";
        nextState.mode_locked = false;
        nextState.collected = {};
        nextState.slots = {};
        nextState.last_bot_question = null;
        nextState.last_bot_question_key = null;
        nextState.last_bot_text = null;
        nextState.intent = null;
        nextState.last_seen_inbound_provider_mid = null;
        nextState.last_seen_inbound_mid = null;
      }
      const resolvedMode = resolveMode({
        organizationId: organization_id,
        leadState: nextState,
        orgBusinessType,
        hasTestDentalTag: isTester && hasTestdentalTag,
      });
      const shouldActivateDental = organization_id === "creatyv-product" &&
        isTester &&
        hasTestdentalTag &&
        !existingMode &&
        !resetTriggered;
      if (shouldActivateDental) {
        nextState.mode = "dental_clinic";
        nextState.phase = "new";
        nextState.mode_locked = true;
      } else if (organization_id === "creatyv-product") {
        nextState.mode = resolvedMode || "creatyv_product";
        if (nextState.mode === "creatyv_product") {
          nextState.mode_locked = false;
        }
      } else {
        nextState.mode = resolvedMode;
      }
      const existingFullName = String(existingLead?.full_name ?? "").trim();
      const stateName = String(nextState?.name ?? "").trim();
      const existingRealName =
        existingFullName && !existingFullName.startsWith("Usuario ")
          ? existingFullName
          : "";
      const stateRealName = stateName && !stateName.startsWith("Usuario ")
        ? stateName
        : "";
      const hasRealName = Boolean(existingRealName || stateRealName);
      let resolvedName: string | null = existingRealName || stateRealName ||
        null;
      let resolvedFirstName: string | null = null;
      let resolvedLastName: string | null = null;
      let resolvedProfilePic: string | null =
        String(nextState?.profile_pic ?? "").trim() || null;
      let metaProfileLookupAttempted = false;
      let metaProfileLookupSucceeded = false;

      if (!hasRealName && channel === "messenger") {
        metaProfileLookupAttempted = true;
        try {
          const token = await resolvePageToken(supabase, organization_id);
          if (token) {
            const profile = await fetchMetaProfileDetails({
              pageAccessToken: token,
              psid: senderId,
            });
            if (profile?.firstName) resolvedFirstName = profile.firstName;
            if (profile?.lastName) resolvedLastName = profile.lastName;
            if (profile?.fullName) resolvedName = profile.fullName;
            if (profile?.profilePic) resolvedProfilePic = profile.profilePic;
            metaProfileLookupSucceeded = Boolean(
              profile?.fullName || profile?.firstName || profile?.lastName,
            );
          }
        } catch (err) {
          console.warn("[meta-webhook] graph_api_profile_fetch_failed", {
            organization_id,
            psid: senderId,
            error: String((err as any)?.message ?? err),
          });
          metaProfileLookupSucceeded = false;
        }
      }
      if (!resolvedName && channel === "whatsapp") {
        resolvedName = safeString(ev.sender_name) || null;
      }
      const graphGotName = Boolean(
        resolvedName && !resolvedName.startsWith("Usuario "),
      );
      nextState.name = resolvedName;
      nextState.full_name = resolvedName;
      nextState.collected_name = hasRealName || graphGotName;
      nextState.meta_profile_lookup_attempted = metaProfileLookupAttempted;
      nextState.meta_profile_lookup_succeeded = metaProfileLookupSucceeded;
      if (graphGotName) {
        nextState.asked = { ...(nextState.asked ?? {}), full_name: true };
        nextState.collected = {
          ...(nextState.collected ?? {}),
          full_name: resolvedName,
        };
      }
      if (resolvedProfilePic) nextState.profile_pic = resolvedProfilePic;

      const upsertPayload: Record<string, unknown> = {
        organization_id,
        channel,
        last_channel: channel,
        channel_user_id: senderId,
        full_name: resolvedName,
        first_name: resolvedFirstName,
        last_name: resolvedLastName,
        avatar_url: resolvedProfilePic,
        last_message_preview: text.slice(0, 140),
        last_message_at: isoTime,
        state: nextState,
      };
      if (resetTriggered) {
        upsertPayload.last_seen_inbound_message_id = null;
      }
      if (!existingLead?.id) upsertPayload["handoff_to_human"] = false;

      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .upsert(upsertPayload, {
          onConflict: "organization_id,channel,channel_user_id",
        })
        .select("id")
        .single();
      if (leadErr) throw leadErr;
      updated_leads++;
      console.log("[meta-webhook] inbound_lead_routing", {
        channel,
        inbound_from: rawSenderId,
        normalized_channel_user_id: senderId,
        inbound_channel_user_id: senderId,
        selected_lead_id: lead.id,
        selected_organization_id: organization_id,
        organization_source: organizationSource,
        inbound_phone_number_id: phoneNumberId,
        candidate_orgs: resolvedOrg.routingCandidates,
        selected_business_type: orgBusinessType,
        selected_prompt_key: promptKeyForBusinessType(orgBusinessType),
        default_org: DEFAULT_ORG,
        default_org_used: defaultOrgUsed,
        used_existing_lead: Boolean(existingLead?.id),
        existing_lead_found_under_selected_org: Boolean(existingLead?.id),
        stale_lead_count: staleLeadCount,
        stale_leads: staleLeads,
        used_default_org: defaultOrgUsed,
        duplicate_lead_count: duplicateLeadCount,
        duplicate_lead_detected: duplicateLeadCount > 1,
        fallback_default_org_used: defaultOrgUsed,
      });

      const decision = activationProbe || !automationAllowed
        ? null
        : waitlistDecision(text);
      if (decision) {
        const activeHold = await supabase
          .from("slot_holds")
          .select(
            "id, slot_key, slot_start, slot_end, service_type, hold_until, status",
          )
          .eq("organization_id", organization_id)
          .eq("lead_id", lead.id)
          .eq("slot_hold_scope", "lead")
          .eq("status", "held")
          .gt("hold_until", new Date().toISOString())
          .order("hold_until", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!activeHold.error && activeHold.data?.id) {
          const hold = activeHold.data as any;
          if (decision === "accept") {
            const appointmentInsert = await supabase.from("appointments")
              .insert({
                organization_id,
                lead_id: lead.id,
                start_at: hold.slot_start ?? null,
                starts_at: hold.slot_start ?? null,
                status: "confirmed",
                title: hold.service_type ?? "Cita",
                reason: hold.service_type ?? "Servicio",
                patient_name: resolvedName,
              });
            if (!appointmentInsert.error) {
              await supabase
                .from("slot_holds")
                .update({
                  status: "accepted",
                  updated_at: new Date().toISOString(),
                })
                .eq("organization_id", organization_id)
                .eq("id", hold.id);

              await supabase
                .from("slot_holds")
                .update({
                  status: "expired",
                  updated_at: new Date().toISOString(),
                })
                .eq("organization_id", organization_id)
                .eq("slot_key", hold.slot_key)
                .eq("slot_hold_scope", "lead")
                .neq("id", hold.id)
                .in("status", ["held", "accepted"]);

              const otherLeads = await supabase
                .from("slot_holds")
                .select("lead_id")
                .eq("organization_id", organization_id)
                .eq("slot_key", hold.slot_key)
                .eq("slot_hold_scope", "lead");
              const otherLeadIds = (otherLeads.data ?? [])
                .map((r: any) => String(r?.lead_id ?? ""))
                .filter((id) => id && id !== lead.id);
              if (otherLeadIds.length > 0) {
                const leadsRows = await supabase
                  .from("leads")
                  .select("id, channel, channel_user_id")
                  .eq("organization_id", organization_id)
                  .in("id", otherLeadIds);
                const rows = leadsRows.data ?? [];
                if (rows.length > 0 && !botAutoReplyPaused) {
                  await supabase.from("reply_outbox").insert(
                    rows.map((l: any) => ({
                      organization_id,
                      lead_id: l.id,
                      channel: l.channel ?? "messenger",
                      channel_user_id: l.channel_user_id,
                      status: "queued",
                      scheduled_for: new Date().toISOString(),
                      message_text:
                        "Ese turno ya fue tomado. Si querés, te compartimos nuevas opciones.",
                      payload: {
                        source: "waitlist_offer_closed",
                        provider: "meta",
                        text:
                          "Ese turno ya fue tomado. Si querés, te compartimos nuevas opciones.",
                        slot_key: hold.slot_key,
                      },
                    })),
                  );
                } else if (rows.length > 0) {
                  console.log("[bot_auto_reply_paused_webhook]", {
                    organization_id,
                    lead_id: lead.id,
                    skipped: "waitlist_reply_outbox",
                    skipped_count: rows.length,
                  });
                }
              }
            }
          } else if (decision === "decline") {
            await supabase
              .from("slot_holds")
              .update({
                status: "cancelled",
                updated_at: new Date().toISOString(),
              })
              .eq("organization_id", organization_id)
              .eq("id", hold.id);
          }
        }
      }

      if (!activationProbe) {
        const cancelFollowupsRes = await supabase
          .from("followup_outbox")
          .update({
            status: "cancelled",
            lock_owner: null,
            locked_at: null,
            updated_at: new Date().toISOString(),
            last_error: "cancelled:user_replied",
          })
          .eq("organization_id", organization_id)
          .eq("lead_id", lead.id)
          .in("status", ["queued", "processing"]);
        if (cancelFollowupsRes.error) {
          const msg = String(cancelFollowupsRes.error.message ?? "");
          if (!msg.toLowerCase().includes("does not exist")) {
            console.log("[meta-webhook] followup_cancel_warn", {
              organization_id,
              lead_id: lead.id,
              error: msg,
            });
          }
        }
      }

      let insertedMessageId: string | null = null;
      let inboundPersisted = false;

      // Activation webhooks can be delivered more than once. Use the canonical
      // inbound identifiers for lookup and a deterministic existing PK value
      // to make concurrent inserts converge without a schema change.
      if (activationProbe) {
        const existingMessage = await supabase
          .from("messages")
          .select("id")
          .eq("organization_id", organization_id)
          .eq("channel", channel)
          .eq("provider_message_id", providerMid)
          .eq("inbound_message_id", providerMid)
          .limit(1)
          .maybeSingle();
        if (existingMessage.error) throw existingMessage.error;
        insertedMessageId = safeString(existingMessage.data?.id) || null;
        inboundPersisted = Boolean(insertedMessageId);
      }

      if (!inboundPersisted) {
        const messagePayload: Record<string, unknown> = {
          organization_id,
          lead_id: lead.id,
          channel,
          role: "user",
          actor: "user",
          content: text,
          created_at: new Date().toISOString(),
          provider_message_id: providerMid,
          inbound_message_id: providerMid,
          channel_user_id: senderId,
        };
        if (activationProbe) {
          messagePayload.id = await coexistenceActivationMessageId(
            organization_id,
            channel,
            providerMid,
          );
        }

        const msgInsert = await supabase
          .from("messages")
          .insert(messagePayload)
          .select("id")
          .maybeSingle();
        insertedMessageId = safeString(msgInsert.data?.id) || null;
        inboundPersisted = Boolean(insertedMessageId);
        if (
          msgInsert.error && activationProbe &&
          isDuplicateDatabaseError(msgInsert.error)
        ) {
          const existingMessage = await supabase
            .from("messages")
            .select("id")
            .eq("organization_id", organization_id)
            .eq("channel", channel)
            .eq("provider_message_id", providerMid)
            .eq("inbound_message_id", providerMid)
            .limit(1)
            .maybeSingle();
          if (existingMessage.error) throw existingMessage.error;
          insertedMessageId = safeString(existingMessage.data?.id) || null;
          inboundPersisted = Boolean(insertedMessageId);
        } else if (msgInsert.error) {
          console.warn("[meta-webhook] message_insert_failed", {
            organization_id,
            lead_id: lead.id,
            error: String(msgInsert.error.message ?? ""),
          });
        }
      }

      if (activationProbe) {
        if (!inboundPersisted) {
          throw new Error("coexistence_activation_inbound_not_persisted");
        }
        const activationTime = new Date().toISOString();
        const activationUpdate = await supabase
          .from("org_settings")
          .update({
            whatsapp_enabled: true,
            whatsapp_connected_at: activationTime,
          })
          .eq("organization_id", organization_id)
          .eq("whatsapp_phone_number_id", phoneNumberId)
          .eq("whatsapp_waba_id", wabaId)
          .eq("whatsapp_enabled", false)
          .eq(
            "whatsapp_onboarding_event",
            "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          )
          .eq("whatsapp_onboarding_mode", "COEXISTENCE")
          .eq("whatsapp_business_app_coexistence_completed", true)
          .eq("whatsapp_registered", true)
          .eq("whatsapp_webhooks_subscribed", true)
          .select("organization_id,whatsapp_connected_at")
          .maybeSingle();
        if (activationUpdate.error) throw activationUpdate.error;
        if (!activationUpdate.data?.organization_id) {
          const currentActivation = await supabase
            .from("org_settings")
            .select("whatsapp_enabled,whatsapp_connected_at")
            .eq("organization_id", organization_id)
            .eq("whatsapp_phone_number_id", phoneNumberId)
            .eq("whatsapp_waba_id", wabaId)
            .maybeSingle();
          if (
            currentActivation.error ||
            !booleanFlag(currentActivation.data?.whatsapp_enabled) ||
            !safeString(currentActivation.data?.whatsapp_connected_at)
          ) {
            throw currentActivation.error ??
              new Error("coexistence_activation_transition_failed");
          }
        }
        console.log("[meta-webhook] coexistence_activation_probe", {
          organization_id,
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          provider_message_id: providerMid,
          activation_transitioned: Boolean(
            activationUpdate.data?.organization_id,
          ),
          reply_suppressed: true,
        });
        continue;
      }

      const canEnqueue = automationAllowed && !botAutoReplyPaused &&
        Boolean(text && text.trim()) &&
        Boolean(providerMid);
      if (canEnqueue) {
        const outboxPayload = {
          organization_id,
          lead_id: lead.id,
          channel,
          channel_user_id: senderId,
          status: "queued",
          scheduled_for: new Date().toISOString(),
          inbound_provider_message_id: providerMid,
          payload: {
            text,
            payload_action: payloadAction || null,
            ...("flow_response" in ev && ev.flow_response
              ? { flow_response: ev.flow_response }
              : {}),
            channel,
            channel_user_id: senderId,
            organization_id,
            inbound_provider_message_id: providerMid,
            inbound_phone_number_id: channel === "whatsapp"
              ? phoneNumberId || null
              : null,
            whatsapp_route_type: resolvedOrg.routeType,
            trace_id: traceId,
          },
        };
        const outboxInsert = await supabase
          .from("reply_outbox")
          .insert([outboxPayload])
          .select("id")
          .maybeSingle();
        let enqueueStatus: "enqueued" | "duplicate_skip" = "duplicate_skip";
        let enqueuedOutboxId: string | null = null;
        if (outboxInsert.error) {
          const em = String(outboxInsert.error.message ?? "").toLowerCase();
          const code = String((outboxInsert.error as any)?.code ?? "");
          if (!em.includes("duplicate") && code !== "23505") {
            throw outboxInsert.error;
          }
        } else if (outboxInsert.data?.id) {
          created_jobs += 1;
          enqueueStatus = "enqueued";
          enqueuedOutboxId = String(outboxInsert.data.id);
        }
        if (enqueueStatus === "enqueued") {
          console.log("[meta_webhook:inbound_enqueued]", {
            organization_id,
            lead_id: lead.id,
            message_id: insertedMessageId,
            reply_outbox_id: enqueuedOutboxId,
            channel,
            channel_user_id: senderId,
            phone_number_id: phoneNumberId || null,
          });
        }
        console.log("[meta-webhook] enqueue", {
          organization_id,
          sender_id: senderId,
          provider_message_id: providerMid,
          outbox_id: enqueuedOutboxId,
          result: enqueueStatus,
        });
      } else {
        console.log("[meta-webhook] enqueue_skip", {
          organization_id,
          sender_id: senderId,
          provider_message_id: providerMid,
          reason: botAutoReplyPaused
            ? "bot_auto_reply_paused"
            : !providerMid
            ? "missing_mid"
            : "missing_text",
        });
        if (botAutoReplyPaused) {
          console.log("[bot_auto_reply_paused_webhook]", {
            organization_id,
            lead_id: lead.id,
            message_id: insertedMessageId,
            channel,
            channel_user_id: senderId,
            provider_message_id: providerMid,
          });
        }
      }

      if (
        automationAllowed && !botAutoReplyPaused && shouldScheduleFollowup(text)
      ) {
        const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const followupRes = await supabase
          .from("followup_outbox")
          .upsert(
            {
              organization_id,
              lead_id: lead.id,
              channel_user_id: senderId,
              provider: channel === "whatsapp" ? "whatsapp" : "meta",
              reason: "lead_silent",
              step: 1,
              max_steps: 3,
              due_at: dueAt,
              status: "queued",
              payload: {
                provider: "meta",
                source: "auto_followup",
                reason: "lead_silent",
                step: 1,
              },
            },
            {
              onConflict: "organization_id,lead_id,reason,step",
              ignoreDuplicates: true,
            },
          )
          .select("id")
          .maybeSingle();
        if (followupRes.error) {
          const msg = String(followupRes.error.message ?? "");
          if (
            !msg.toLowerCase().includes("duplicate") &&
            !msg.toLowerCase().includes("does not exist")
          ) {
            console.log("[meta-webhook] followup_enqueue_warn", {
              organization_id,
              lead_id: lead.id,
              error: msg,
            });
          }
        } else {
          console.log("[meta-webhook] followup_queued", {
            organization_id,
            lead_id: lead.id,
            followup_id: followupRes.data?.id ?? null,
            due_at: dueAt,
          });
        }
      }
      if (RUN_REPLIES_SECRET && automationAllowed && !botAutoReplyPaused) {
        const RUN_REPLIES_URL = `${SUPABASE_URL}/functions/v1/run-replies`;
        await fetch(RUN_REPLIES_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-run-replies-secret": RUN_REPLIES_SECRET,
          },
          body: JSON.stringify({ organization_id, limit: 5 }),
        });
      } else if (RUN_REPLIES_SECRET && botAutoReplyPaused) {
        console.log("[bot_auto_reply_paused_webhook]", {
          organization_id,
          lead_id: lead.id,
          skipped: "run_replies_trigger",
        });
      }
    }

    return json(200, {
      ok: true,
      organization_ids: Array.from(orgIds),
      received,
      updated_leads,
      created_jobs,
      demo_trigger_enabled: Boolean(RUN_REPLIES_SECRET),
    });
  } catch (err: any) {
    console.error("[meta-webhook] error:", err);
    return json(200, { ok: false, error: String(err?.message ?? err) });
  }
});
