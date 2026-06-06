import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarPlus, CheckCircle2, MessageCircle, Phone, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { dedupeByKey } from "../lib/dedupe";
import { messageKey } from "../lib/messages";
import { resolveFrontendBusinessType, resolveFrontendOrgName, useActiveOrg } from "../hooks/useActiveOrg";
import { useClinic } from "../context/ClinicContext";
import { getVerticalConfig } from "../config/verticalConfig";
import { ChatBubble } from "../components/ChatBubble";
import { MobileChip, MobileConversationRow, MobileEmptyState } from "../components/mobile/MobilePrimitives";

const ORG_OPTIONS = ["clinic-demo", "barber-demo", "barber-demo-wimaeil", "creatyv-product"];
const CHANNEL_OPTIONS = ["all", "messenger", "whatsapp"] as const;
const DEV_DEBUG_UI = false;

function fallbackOrgLabel(organizationId: string): string {
  if (organizationId === "barber-demo") return "BarberLine";
  if (organizationId === "barber-demo-wimaeil") return "Barbería WIMAEIL";
  if (organizationId === "clinic-demo") return "Dental Demo";
  if (organizationId === "creatyv-product") return "Creatyv Product";
  return organizationId;
}

function fallbackOrgBusinessType(organizationId: string): "dental" | "barbershop" {
  return resolveFrontendBusinessType(organizationId);
}

function productLabelForBusinessType(businessType: string | null | undefined): string {
  return businessType === "barbershop" ? "BarberLine" : "DentalConnect";
}

type ChannelFilter = (typeof CHANNEL_OPTIONS)[number];
type MobileLeadFilter = "all" | "attention";

type LeadRow = {
  id: string;
  organization_id: string;
  channel_user_id: string | null;
  avatar_url: string | null;
  state: Record<string, any> | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
  channel: string | null;
  last_channel: string | null;
  last_bot_reply_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  handoff_to_human: boolean | null;
  latest_message_content?: string | null;
  latest_message_at?: string | null;
  search_message_match?: boolean;
};

type MsgRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  channel: string | null;
  channel_user_id?: string | null;
  provider_message_id?: string | null;
  actor: string | null;
  role: string | null;
  content: string | null;
  created_at: string;
};

type OutboxStatus = {
  status: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function getBestDisplayName(lead: LeadRow): string {
  if (lead.full_name?.trim() && !lead.full_name.startsWith("Usuario ")) return lead.full_name.trim();
  const parts = [lead.first_name, lead.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  const stateName = lead.state?.name;
  if (stateName && typeof stateName === "string" && stateName.trim() && !stateName.startsWith("Usuario ")) return stateName.trim();
  if (lead.phone) return lead.phone;
  if (lead.channel_user_id) return `Usuario ${lead.channel_user_id.slice(-4)}`;
  return "Sin nombre";
}

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "ahora";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString("es", { day: "numeric", month: "short" });
}

function channelLabel(channel?: string | null): string {
  const normalized = String(channel ?? "messenger").toLowerCase();
  if (normalized === "whatsapp") return "WhatsApp";
  if (normalized === "messenger") return "Messenger";
  return normalized.toUpperCase();
}

function effectiveLeadChannel(lead: Pick<LeadRow, "channel" | "last_channel"> | null): string {
  return String(lead?.channel ?? lead?.last_channel ?? "whatsapp").trim().toLowerCase() || "whatsapp";
}

function getConversationModeLabel(lead: LeadRow | null): "bot_active" | "human_active" | "flow_active" {
  if (lead?.handoff_to_human === true) return "human_active";
  const mode = String(lead?.state?.conversation_mode ?? "").toLowerCase();
  if (mode === "human_active") return "human_active";
  if (mode === "flow_active") return "flow_active";
  return "bot_active";
}

function conversationStatusCopy(mode: ReturnType<typeof getConversationModeLabel>): {
  label: string;
  className: string;
} {
  if (mode === "human_active") {
    return {
      label: "Humano",
      className: "border-amber-400/25 bg-amber-500/10 text-amber-300",
    };
  }
  if (mode === "flow_active") {
    return {
      label: "Flujo",
      className: "border-cyan-400/25 bg-cyan-500/10 text-cyan-300",
    };
  }
  return {
      label: "Bot",
    className: "border-emerald-400/25 bg-emerald-500/10 text-emerald-300",
  };
}

function getSearchText(lead: LeadRow): string {
  return [
    lead.full_name,
    lead.first_name,
    lead.last_name,
    lead.phone,
    lead.channel_user_id,
    lead.latest_message_content,
    lead.last_message_preview,
  ].filter(Boolean).join(" ").toLowerCase();
}

function previewForLead(lead: LeadRow): string {
  return lead.latest_message_content || lead.last_message_preview || "Sin mensajes todavía";
}

const LEAD_SELECT =
  "id, organization_id, full_name, first_name, last_name, avatar_url, phone, status, channel, last_channel, channel_user_id, state, last_message_at, last_bot_reply_at, last_message_preview, handoff_to_human";

function isUuidLike(value: string | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}

export default function Inbox() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const { setActiveOrgId, availableOrgs } = useClinic();
  const { resolvedOrgId, resolvedBusinessType, resolvedOrgName } = useActiveOrg();
  const vertical = getVerticalConfig(resolvedBusinessType);
  const initialOrg = resolvedOrgId || "clinic-demo";

  const [selectedOrg, setSelectedOrg] = useState(initialOrg);
  const inboxIsBarbershop = resolvedBusinessType === "barbershop" || selectedOrg.startsWith("barber-");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [mobileLeadFilter, setMobileLeadFilter] = useState<MobileLeadFilter>("all");
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [directLead, setDirectLead] = useState<LeadRow | null>(null);
  const [thread, setThread] = useState<MsgRow[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [latestOutboxStatus, setLatestOutboxStatus] = useState<OutboxStatus | null>(null);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshingThread, setRefreshingThread] = useState(false);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const leadsReloadTimeoutRef = useRef<number | null>(null);
  const directLeadOrgRef = useRef<string | null>(null);

  const selectedLead = useMemo(() => {
    if (directLead && (directLead.id === leadId || directLead.channel_user_id === leadId)) return directLead;
    return leads.find((l) => l.id === leadId || l.channel_user_id === leadId) ?? null;
  }, [directLead, leads, leadId]);
  const resolvedLeadId = selectedLead?.id ?? leadId ?? "";
  const selectedConversationMode = getConversationModeLabel(selectedLead);

  const orgOptions = useMemo(() => {
    const map = new Map<string, { organizationId: string; label: string; businessType: "dental" | "barbershop" }>();
    for (const org of ORG_OPTIONS) {
      map.set(org, {
        organizationId: org,
        label: fallbackOrgLabel(org),
        businessType: fallbackOrgBusinessType(org),
      });
    }
    for (const org of availableOrgs) {
      const organizationId = String(org.organization_id ?? "").trim();
      if (!organizationId) continue;
      const businessType = org.business_type === "barbershop" ? "barbershop" : fallbackOrgBusinessType(organizationId);
      map.set(organizationId, {
        organizationId,
        label: resolveFrontendOrgName(organizationId, businessType, org.name || fallbackOrgLabel(organizationId)),
        businessType,
      });
    }
    for (const org of [selectedOrg, resolvedOrgId, selectedLead?.organization_id, directLead?.organization_id]) {
      const organizationId = String(org ?? "").trim();
      if (!organizationId || map.has(organizationId)) continue;
      map.set(organizationId, {
        organizationId,
        label: resolveFrontendOrgName(organizationId, fallbackOrgBusinessType(organizationId), fallbackOrgLabel(organizationId)),
        businessType: fallbackOrgBusinessType(organizationId),
      });
    }
    return Array.from(map.values());
  }, [availableOrgs, directLead?.organization_id, resolvedOrgId, selectedLead?.organization_id, selectedOrg]);

  const orgLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of orgOptions) {
      map.set(org.organizationId, org.label);
    }
    return map;
  }, [orgOptions]);

  const filteredLeads = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (channelFilter !== "all" && effectiveLeadChannel(lead) !== channelFilter) return false;
      const unread = new Date(lead.latest_message_at || lead.last_message_at || 0).getTime() > new Date(lead.last_bot_reply_at || 0).getTime();
      const mode = getConversationModeLabel(lead);
      if (mobileLeadFilter === "attention" && !unread && mode !== "human_active") return false;
      if (!needle) return true;
      if (lead.search_message_match) return true;
      return getSearchText(lead).includes(needle);
    });
  }, [leads, channelFilter, mobileLeadFilter, search]);

  const quickReplies = resolvedBusinessType === "dental"
    ? [
        { label: "WhatsApp", text: "Claro, te podemos atender por WhatsApp. ¿Qué consulta dental necesitás?" },
        { label: "Precios", text: "Con gusto. ¿Qué servicio dental querés consultar?" },
        { label: "Agenda", text: "Perfecto. ¿Qué día y hora te queda mejor para coordinar tu cita?" },
        { label: "Seguimiento", text: "Estoy pendiente de tu consulta. ¿Querés que revisemos tu caso ahora?" },
      ]
    : [
        { label: "WhatsApp", text: "Claro. Escribime por WhatsApp y te paso toda la info: " },
        { label: "Precio", text: "Con gusto. Te paso la info y vemos cuál opción te queda mejor." },
        { label: "Agenda", text: "Perfecto. ¿Qué día y hora te queda mejor para coordinar?" },
        { label: "Seguimiento", text: "Estoy pendiente. ¿Querés que lo revisemos ahora?" },
      ];

  async function hydrateDirectLead(routeLeadId: string) {
    const selectedOrgBefore = selectedOrg;
    console.log("[inbox:direct_route_start]", {
      routeLeadId,
      selectedOrgBefore,
    });

    const directRes = await supabase
      .from("leads")
      .select(LEAD_SELECT)
      .eq("id", routeLeadId)
      .maybeSingle();

    if (directRes.error || !directRes.data) {
      console.warn("[inbox:direct_route_lead_missing]", {
        routeLeadId,
        error: directRes.error?.message ?? null,
      });
      return;
    }

    const lead = directRes.data as LeadRow;
    const nextOrg = String(lead.organization_id ?? "").trim();
    const nextChannel = effectiveLeadChannel(lead);
    directLeadOrgRef.current = nextOrg || null;
    setDirectLead(lead);
    setLeads((prev) => dedupeByKey([lead, ...prev], (item) => (item as LeadRow).id) as LeadRow[]);
    if (nextOrg) setSelectedOrg(nextOrg);
    if (nextChannel === "messenger" || nextChannel === "whatsapp") setChannelFilter(nextChannel);
    if (nextOrg) void setActiveOrgId(nextOrg);

    const directMessages = await supabase
      .from("messages")
      .select("id, organization_id, lead_id, channel, channel_user_id, provider_message_id, actor, role, content, created_at")
      .eq("lead_id", routeLeadId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (!directMessages.error) {
      setThread(dedupeByKey(((directMessages.data ?? []) as MsgRow[]).map((m) => ({ ...m, content: m.content ?? "" })), messageKey));
    }

    console.log("[inbox:direct_route_hydrated]", {
      routeLeadId,
      directLeadLoaded: true,
      directLeadOrganizationId: nextOrg,
      selectedOrgBefore,
      selectedOrgAfter: nextOrg || selectedOrgBefore,
      channel: nextChannel || null,
      directMessagesCount: directMessages.data?.length ?? 0,
      messageError: directMessages.error?.message ?? null,
    });
  }

  async function loadLeads() {
    setLoadingLeads(true);
    const needle = search.trim();
    const messageMatchedLeadIds = new Set<string>();
    if (needle) {
      let searchMsgQuery = supabase
        .from("messages")
        .select("lead_id")
        .eq("organization_id", selectedOrg)
        .ilike("content", `%${needle}%`)
        .limit(1000);
      if (channelFilter !== "all") searchMsgQuery = searchMsgQuery.eq("channel", channelFilter);
      const { data: searchMsgData } = await searchMsgQuery;
      for (const row of searchMsgData ?? []) {
        const id = String((row as any)?.lead_id ?? "");
        if (id) messageMatchedLeadIds.add(id);
      }
    }

    let query = supabase
      .from("leads")
      .select(LEAD_SELECT)
      .eq("organization_id", selectedOrg)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (channelFilter !== "all") query = query.or(`channel.eq.${channelFilter},last_channel.eq.${channelFilter}`);
    const { data, error } = await query;
    if (error) {
      console.error("[inbox:load_leads_error]", error.message);
      setLeads([]);
      setLoadingLeads(false);
      return;
    }

    let leadRows = (data ?? []) as any[];
    const missingSearchLeadIds = Array.from(messageMatchedLeadIds).filter(
      (id) => !leadRows.some((lead) => String(lead?.id ?? "") === id),
    );
    if (missingSearchLeadIds.length > 0) {
      let searchLeadQuery = supabase
        .from("leads")
        .select(LEAD_SELECT)
        .eq("organization_id", selectedOrg)
        .in("id", missingSearchLeadIds);
      if (channelFilter !== "all") searchLeadQuery = searchLeadQuery.or(`channel.eq.${channelFilter},last_channel.eq.${channelFilter}`);
      const { data: searchLeadData } = await searchLeadQuery;
      leadRows = [...leadRows, ...((searchLeadData ?? []) as any[])];
    }

    if (isUuidLike(leadId) && !leadRows.some((lead) => String(lead?.id ?? "") === leadId)) {
      const directRes = await supabase
        .from("leads")
        .select(LEAD_SELECT)
        .eq("id", leadId)
        .maybeSingle();
      if (!directRes.error && directRes.data) {
        leadRows = [directRes.data, ...leadRows];
        directLeadOrgRef.current = String((directRes.data as any).organization_id ?? "") || null;
      }
    }

    const baseLeads = dedupeByKey(
      leadRows,
      (item) => `${item.organization_id ?? "org"}::${effectiveLeadChannel(item as LeadRow)}::${item.channel_user_id ?? item.id ?? "lead"}`,
    ) as LeadRow[];
    const leadIds = baseLeads.map((lead) => lead.id);
    let latestByLead = new Map<string, MsgRow>();
    if (leadIds.length > 0) {
      let msgQuery = supabase
        .from("messages")
        .select("id, organization_id, lead_id, channel, channel_user_id, provider_message_id, actor, role, content, created_at")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (channelFilter !== "all") msgQuery = msgQuery.eq("channel", channelFilter);
      const { data: msgData, error: msgError } = await msgQuery;
      if (!msgError && msgData) {
        for (const msg of msgData as MsgRow[]) {
          const key = String(msg.lead_id ?? "");
          if (key && !latestByLead.has(key)) latestByLead.set(key, msg);
        }
      }
    }

    const hydrated = baseLeads.map((lead) => {
      const latest = latestByLead.get(lead.id);
      return {
        ...lead,
        latest_message_content: latest?.content ?? null,
        latest_message_at: latest?.created_at ?? lead.last_message_at,
        search_message_match: messageMatchedLeadIds.has(lead.id),
      };
    }).sort((a, b) => new Date(b.latest_message_at || b.last_message_at || 0).getTime() - new Date(a.latest_message_at || a.last_message_at || 0).getTime());

    setLeads(hydrated);
    if (import.meta.env.DEV) {
      console.log("[inbox:debug_load_leads]", {
        selectedOrg,
        selectedChannel: channelFilter,
        searchTerm: search,
        leadQueryResultIds: leadRows.map((lead) => String(lead?.id ?? "")),
        messageSearchLeadIds: Array.from(messageMatchedLeadIds),
        finalRenderedLeadIds: hydrated.map((lead) => lead.id),
      });
    }
    setLoadingLeads(false);
  }

  async function loadThread(targetLeadId: string) {
    if (!targetLeadId) return;
    setLoadingThread(true);
    setThreadError(null);
    const { data, error } = await supabase
      .from("messages")
      .select("id, organization_id, lead_id, channel, channel_user_id, provider_message_id, actor, role, content, created_at")
      .eq("lead_id", targetLeadId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) {
      setThreadError("No se pudo cargar la conversación.");
      setLoadingThread(false);
      return;
    }
    const normalized = dedupeByKey(((data ?? []) as MsgRow[]).map((m) => ({ ...m, content: m.content ?? "" })), messageKey);
    const newestMessageCreatedAt = normalized.length > 0 ? normalized[normalized.length - 1]?.created_at ?? null : null;
    if (import.meta.env.DEV) {
      console.log("[inbox:messages_refetched]", {
        selectedLeadId: targetLeadId,
        messagesFetchedCount: normalized.length,
        newestMessageCreatedAt,
      });
    }
    setThread(normalized);
    setLoadingThread(false);
  }

  async function loadLatestOutboxStatus(targetLeadId: string) {
    if (!targetLeadId) {
      setLatestOutboxStatus(null);
      return null;
    }
    const { data, error } = await supabase
      .from("reply_outbox")
      .select("status, last_error, created_at, updated_at")
      .eq("lead_id", targetLeadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[inbox:reply_outbox_status_failed]", error.message);
      setLatestOutboxStatus({ status: "unknown", last_error: error.message, created_at: null, updated_at: null });
      return null;
    }
    const status = (data as OutboxStatus | null) ?? null;
    setLatestOutboxStatus(status);
    return status;
  }

  async function refreshSelectedConversation() {
    if (!resolvedLeadId) return;
    setRefreshingThread(true);
    try {
      await Promise.all([
        loadThread(resolvedLeadId),
        loadLatestOutboxStatus(resolvedLeadId),
        loadLeads(),
      ]);
    } finally {
      setRefreshingThread(false);
    }
  }

  useEffect(() => {
    if (isUuidLike(leadId)) {
      void hydrateDirectLead(leadId ?? "");
    } else {
      setDirectLead(null);
    }
  }, [leadId]);

  useEffect(() => {
    void loadLeads();
  }, [selectedOrg, channelFilter, search]);

  useEffect(() => {
    if (isUuidLike(leadId)) return;
    if (resolvedOrgId && selectedOrg !== resolvedOrgId) {
      setSelectedOrg(resolvedOrgId);
      navigate("/inbox");
    }
  }, [resolvedOrgId]);

  useEffect(() => {
    if (!resolvedLeadId) {
      setThread([]);
      setLatestOutboxStatus(null);
      return;
    }
    void loadThread(resolvedLeadId);
    void loadLatestOutboxStatus(resolvedLeadId);
  }, [resolvedLeadId]);

  useEffect(() => {
    if (!resolvedLeadId) return;
    const ch = supabase
      .channel(`rt-inbox-thread-${resolvedLeadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `lead_id=eq.${resolvedLeadId}` }, () => {
        void loadThread(resolvedLeadId);
        if (leadsReloadTimeoutRef.current) window.clearTimeout(leadsReloadTimeoutRef.current);
        leadsReloadTimeoutRef.current = window.setTimeout(() => {
          void loadLeads();
          leadsReloadTimeoutRef.current = null;
        }, 250);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "reply_outbox", filter: `lead_id=eq.${resolvedLeadId}` }, () => {
        void loadLatestOutboxStatus(resolvedLeadId);
      })
      .subscribe();
    return () => {
      if (leadsReloadTimeoutRef.current) window.clearTimeout(leadsReloadTimeoutRef.current);
      supabase.removeChannel(ch);
    };
  }, [resolvedLeadId]);

  useEffect(() => {
    const el = threadScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, loadingThread, resolvedLeadId]);

  async function markAsHandled(leadIdToMark: string, e?: React.MouseEvent) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const leadOrg = leads.find((lead) => lead.id === leadIdToMark)?.organization_id ?? selectedLead?.organization_id ?? selectedOrg;
    await supabase.from("leads").update({ status: "attended", updated_at: new Date().toISOString() }).eq("id", leadIdToMark).eq("organization_id", leadOrg);
    await loadLeads();
  }

  async function patchLeadForHandoff(handoff: boolean) {
    if (!selectedLead) return;
    const nowIso = new Date().toISOString();
    const currentState = (selectedLead.state ?? {}) as Record<string, any>;
    const nextState = {
      ...currentState,
      conversation_mode: handoff ? "human_active" : "bot_active",
      bot_paused_until: handoff ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null,
      paused_reason: handoff ? "human_replied_from_dashboard" : null,
      last_human_message_at: handoff ? nowIso : currentState.last_human_message_at ?? null,
      last_human_actor: handoff ? "dashboard_user" : currentState.last_human_actor ?? null,
      updated_at: nowIso,
    };
    const { error } = await supabase
      .from("leads")
      .update({ handoff_to_human: handoff, state: nextState, conversation_state: nextState, updated_at: nowIso })
      .eq("id", selectedLead.id)
      .eq("organization_id", selectedLead.organization_id);
    if (error) throw error;
    const patchedLead = { ...selectedLead, handoff_to_human: handoff, state: nextState } as LeadRow;
    setDirectLead((prev) => (prev?.id === selectedLead.id ? patchedLead : prev));
    setLeads((prev) => prev.map((lead) => (lead.id === selectedLead.id ? patchedLead : lead)));
    if (!handoff) setSendNotice("Bot reactivado.");
    await Promise.all([
      loadLeads(),
      loadThread(selectedLead.id),
      loadLatestOutboxStatus(selectedLead.id),
    ]);
  }

  async function sendReply() {
    if (!selectedLead) return;
    const text = composer.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    setSendNotice(null);
    const nowIso = new Date().toISOString();
    try {
      const leadChannel = effectiveLeadChannel(selectedLead) === "whatsapp"
        ? "whatsapp"
        : "messenger";
      const channelLabelText = leadChannel === "whatsapp" ? "WhatsApp" : "Messenger";
      const { data: msgData, error: msgErr } = await supabase.from("messages").insert([{
        organization_id: selectedLead.organization_id,
        lead_id: selectedLead.id,
        channel: leadChannel,
        channel_user_id: selectedLead.channel_user_id,
        actor: "staff",
        role: "assistant",
        content: text,
        created_at: nowIso,
      }]).select("id").maybeSingle();
      if (msgErr) throw msgErr;
      const uiMessageId = (msgData as any)?.id ?? null;

      let sentViaOutbox = false;
      if (selectedLead.channel_user_id) {
        const { error: outboxErr } = await supabase.from("reply_outbox").insert([{
          organization_id: selectedLead.organization_id,
          lead_id: selectedLead.id,
          channel: leadChannel,
          channel_user_id: selectedLead.channel_user_id,
          status: "queued",
          scheduled_for: nowIso,
          message_text: text,
          payload: {
            text,
            channel: leadChannel,
            channel_user_id: selectedLead.channel_user_id,
            recipient: { id: selectedLead.channel_user_id },
            recipient_id: selectedLead.channel_user_id,
            source: "manual_staff_reply",
            type: "manual_staff_reply",
            provider: "meta",
            ui_message_id: uiMessageId,
            manual: true,
          },
        }]);
        if (!outboxErr) sentViaOutbox = true;
        if (outboxErr) {
          console.warn("[inbox:manual_outbox_failed]", outboxErr.message);
          throw new Error(`reply_outbox_insert_failed:${outboxErr.message}`);
        }
      }

      await patchLeadForHandoff(true);
      setComposer("");
      if (composerRef.current) composerRef.current.style.height = "56px";
      setSendNotice(
        sentViaOutbox
          ? `Queued for ${channelLabelText} delivery.`
          : `Saved in CRM only. ${channelLabelText} recipient is missing.`,
      );
      await Promise.all([
        loadThread(selectedLead.id),
        loadLatestOutboxStatus(selectedLead.id),
      ]);
      await loadLeads();
    } catch (e: any) {
      setSendError(String(e?.message ?? e));
    } finally {
      setSending(false);
    }
  }

  const selectedName = selectedLead ? getBestDisplayName(selectedLead) : "Conversación";

  return (
    <div className="mobile-bottom-safe flex h-[100dvh] min-w-0 flex-col overflow-hidden bg-[#0B1620] lg:h-auto lg:min-h-screen lg:bg-[#0B1117] lg:pb-0">
      {leadId && (
        <div className="safe-area-top border-b border-[#25384A] bg-[#0B1620]/95 px-4 py-2 backdrop-blur lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => navigate("/inbox")} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#162838] transition hover:bg-[#192B42]">
            <ArrowLeft className="h-4 w-4 text-[#F8FAFC]" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold text-[#F8FAFC]">{selectedName}</div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-[#9CAAB8]">
              {selectedLead ? (
                <>
                  <span className="id-chip"><span>{channelLabel(effectiveLeadChannel(selectedLead))}</span></span>
                  <span className="id-chip"><span>{orgLabelById.get(selectedLead.organization_id) ?? fallbackOrgLabel(selectedLead.organization_id)}</span></span>
                  <span className={["inline-flex min-h-[24px] items-center rounded-full border px-2 text-[10px] font-semibold", conversationStatusCopy(selectedConversationMode).className].join(" ")}>
                    {conversationStatusCopy(selectedConversationMode).label}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <button
            onClick={() => void refreshSelectedConversation()}
            disabled={refreshingThread}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#162838] transition hover:bg-[#192B42] disabled:opacity-50"
            aria-label="Refrescar conversación"
          >
            <RefreshCw className={["h-4 w-4 text-[#F8FAFC]", refreshingThread ? "animate-spin" : ""].join(" ")} />
          </button>
          </div>
          {selectedConversationMode === "human_active" ? (
            <div className="mt-3 flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-2">
              <div className="min-w-0 text-xs font-medium text-amber-200">Bot pausado para esta conversación.</div>
              <button
                onClick={() => void patchLeadForHandoff(false)}
                className="min-h-10 shrink-0 rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 text-xs font-semibold text-sky-200"
              >
                Reactivar Bot
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div className={["border-b border-[#25384A] bg-[#0B1620] px-4 py-3 lg:border-0 lg:bg-transparent lg:px-3", leadId ? "hidden lg:block" : "block"].join(" ")}>
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-black tracking-[-0.03em] text-[#F8FAFC] lg:text-xl lg:text-white">Inbox</h1>
            <p className="text-safe text-xs text-[#9CAAB8] sm:text-sm lg:text-white/50">
              {inboxIsBarbershop
                ? `Mensajes de ${resolvedOrgName || fallbackOrgLabel(selectedOrg)}`
                : "Recepción dental para Messenger y WhatsApp"}
            </p>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-3 lg:w-[720px] max-sm:hidden">
            <label className="text-xs text-white/50">
              Organización
              <select
                value={selectedOrg}
                onChange={(e) => {
                  const nextOrg = e.target.value;
                  setSelectedOrg(nextOrg);
                  void setActiveOrgId(nextOrg);
                  navigate("/inbox");
                }}
                className="mt-1 h-10 w-full truncate rounded-xl border border-white/10 bg-[#111923] px-3 text-xs sm:text-sm text-white outline-none"
              >
                {orgOptions.map((org) => (
                  <option key={org.organizationId} value={org.organizationId}>
                    {org.label} · {productLabelForBusinessType(org.businessType)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/50">
              Canal
              <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value as ChannelFilter)} className="mt-1 h-10 w-full truncate rounded-xl border border-white/10 bg-[#111923] px-3 text-xs sm:text-sm text-white outline-none">
                <option value="all">All</option>
                <option value="messenger">Messenger</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </label>
            <label className="text-xs text-white/50">
              Buscar
              <div className="mt-1 flex h-10 min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-[#111923] px-3">
                <Search className="h-4 w-4 shrink-0 text-white/40" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="9595, nombre, mensaje..." className="min-w-0 flex-1 bg-transparent text-xs sm:text-sm text-white outline-none placeholder:text-white/30" />
              </div>
            </label>
          </div>
          {import.meta.env.DEV && DEV_DEBUG_UI ? (
            <div className="text-safe rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/45">
              activeOrganizationId: {selectedLead?.organization_id ?? selectedOrg ?? resolvedOrgId} / business_type: {resolvedBusinessType} / channel: {selectedLead?.channel ?? channelFilter}
            </div>
          ) : null}
        </div>
        <div className="mt-3 space-y-2 sm:hidden">
          <div className="flex h-11 min-w-0 items-center gap-2 rounded-2xl border border-[#25384A] bg-[#111F2B] px-3">
            <Search className="h-4 w-4 shrink-0 text-[#9CAAB8]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente o mensaje" className="min-w-0 flex-1 bg-transparent text-sm text-[#F8FAFC] outline-none placeholder:text-[#9CAAB8]/70" />
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
            {[
              { key: "all", label: "Todos", kind: "attention" },
              { key: "attention", label: "Atención", kind: "attention" },
              { key: "whatsapp", label: "WhatsApp", kind: "channel" },
              { key: "messenger", label: "Messenger", kind: "channel" },
            ].map((chip) => {
              const active = chip.kind === "channel" ? channelFilter === chip.key : mobileLeadFilter === chip.key && channelFilter === "all";
              return (
                <MobileChip
                  key={`${chip.kind}:${chip.key}`}
                  onClick={() => {
                    if (chip.kind === "channel") {
                      setChannelFilter(chip.key as ChannelFilter);
                      setMobileLeadFilter("all");
                    } else {
                      setChannelFilter("all");
                      setMobileLeadFilter(chip.key as MobileLeadFilter);
                    }
                  }}
                  active={active}
                  tone="success"
                >
                  {chip.label}
                </MobileChip>
              );
            })}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full min-h-0 grid-cols-12 gap-0 lg:gap-4 lg:p-4">
          <div className={["col-span-12 flex min-h-0 flex-col overflow-hidden lg:col-span-5 xl:col-span-4", leadId ? "hidden lg:flex" : "flex"].join(" ")}>
            <div className="flex-1 overflow-y-auto">
              <div className="space-y-2 p-3 pb-4 lg:p-0">
                {loadingLeads ? (
                  <div className="py-12 text-center text-xs text-white/50 sm:text-sm">Cargando…</div>
                ) : filteredLeads.length === 0 ? (
                  <MobileEmptyState
                    icon={MessageCircle}
                    title={leads.length > 0 ? "Sin resultados con estos filtros" : inboxIsBarbershop ? "No hay mensajes nuevos por ahora." : "Sin conversaciones"}
                    description={leads.length > 0 ? "Cambiá el filtro o limpiá la búsqueda." : inboxIsBarbershop ? undefined : "No hay leads para esta organización todavía."}
                  />
                ) : filteredLeads.map((lead) => {
                  const active = lead.id === resolvedLeadId;
                  const unread = new Date(lead.latest_message_at || lead.last_message_at || 0).getTime() > new Date(lead.last_bot_reply_at || 0).getTime();
                  const displayName = getBestDisplayName(lead);
                  const mode = getConversationModeLabel(lead);
                  const status = conversationStatusCopy(mode);
                  return (
                    <MobileConversationRow key={lead.id} onClick={() => navigate(`/inbox/${lead.id}`)} className={["group relative overflow-hidden", active ? "border-[#25D366]/40 bg-[#25D366]/10 ring-1 ring-[#25D366]/15" : ""].join(" ")}>
                      <div className="flex min-w-0 gap-3">
                        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#162838] text-xs font-black text-[#25D366]">
                          {displayName.slice(0, 1).toUpperCase()}
                          {unread && <div className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#0B1620] bg-[#25D366]" />}
                        </div>
                        <div className="min-w-0 flex-1 py-0.5">
                          <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
                            <span className="truncate text-sm font-bold text-[#F8FAFC]">{displayName}</span>
                            <span className="shrink-0 text-[11px] text-[#9CAAB8]">{formatRelativeTime(lead.latest_message_at || lead.last_message_at)}</span>
                          </div>
                          <div className="text-safe text-xs leading-relaxed text-[#9CAAB8]" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{previewForLead(lead)}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="id-chip"><span>{channelLabel(effectiveLeadChannel(lead))}</span></span>
                            <span className="id-chip"><span>{orgLabelById.get(lead.organization_id) ?? fallbackOrgLabel(lead.organization_id)}</span></span>
                            <span className={["inline-flex min-h-[22px] items-center rounded-full border px-2 text-[10px] font-semibold", status.className].join(" ")}>{status.label}</span>
                            {unread && <span className="rounded-full bg-rose-500/12 px-2 py-0.5 text-[10px] font-semibold text-rose-200">Nuevo</span>}
                          </div>
                          {import.meta.env.DEV && DEV_DEBUG_UI ? (
                            <div className="mt-1 truncate text-[10px] text-white/35">
                              {lead.organization_id} / {lead.channel ?? "unknown"} / {lead.id.slice(-6)}
                            </div>
                          ) : null}
                        </div>
                        {lead.status !== "attended" && <button onClick={(e) => markAsHandled(lead.id, e)} className="shrink-0 self-center rounded-full p-2 opacity-60 transition hover:bg-emerald-500/10 group-hover:opacity-100" title="Marcar como atendido"><CheckCircle2 className="h-5 w-5 text-emerald-500" /></button>}
                      </div>
                    </MobileConversationRow>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={["col-span-12 flex min-h-0 flex-col overflow-hidden lg:col-span-7 xl:col-span-8", leadId ? "flex" : "hidden lg:flex"].join(" ")}>
            {!leadId ? (
              <div className="flex flex-1 items-center justify-center bg-white/5 lg:rounded-2xl lg:border lg:border-white/10">
                <div className="py-12 text-center"><MessageCircle className="mx-auto mb-4 h-16 w-16 text-white/20" /><div className="text-xs text-white/50 sm:text-sm">Selecciona una conversación</div></div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white/5 lg:rounded-2xl lg:border lg:border-white/10">
                <div className="hidden min-w-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 lg:flex">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-white">{selectedName}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/50">
                      {selectedLead?.phone && <span className="flex min-w-0 items-center gap-1"><Phone className="h-3 w-3 shrink-0" /><span className="truncate">{selectedLead.phone}</span></span>}
                      <span className="id-chip"><span>{selectedLead ? channelLabel(effectiveLeadChannel(selectedLead)) : "Messenger"}</span></span>
                      <span className="id-chip"><span>{selectedLead ? orgLabelById.get(selectedLead.organization_id) ?? fallbackOrgLabel(selectedLead.organization_id) : ""}</span></span>
                      <span className="id-chip"><span>{selectedLead?.channel_user_id ?? "sin channel_user_id"}</span></span>
                      <span className={["inline-flex items-center gap-1 rounded-full border px-2 py-0.5", conversationStatusCopy(selectedConversationMode).className].join(" ")}><ShieldCheck className="h-3 w-3" />{conversationStatusCopy(selectedConversationMode).label}</span>
                    </div>
                  </div>
                  <div className="flex max-w-[52%] flex-wrap items-center justify-end gap-2">
                    <button
                      onClick={() => void refreshSelectedConversation()}
                      disabled={refreshingThread}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      <RefreshCw className={["h-4 w-4", refreshingThread ? "animate-spin" : ""].join(" ")} />
                      Refrescar
                    </button>
                    {selectedConversationMode === "human_active" ? (
                      <button onClick={() => void patchLeadForHandoff(false)} className="min-h-11 rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20">Reactivar bot</button>
                    ) : (
                      <button onClick={() => void patchLeadForHandoff(true)} className="min-h-11 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20">Tomar conversación</button>
                    )}
                    {selectedLead && selectedLead.status !== "attended" && <button onClick={(e) => markAsHandled(selectedLead.id, e)} className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/20"><CheckCircle2 className="h-4 w-4" /> Atendido</button>}
                    <button onClick={() => navigate("/agenda")} className="inline-flex items-center gap-2 rounded-xl bg-[#3CBDB9] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#35a9a5]"><CalendarPlus className="h-4 w-4" /> Crear cita</button>
                  </div>
                </div>

                {selectedConversationMode === "human_active" ? (
                  <div className="border-b border-amber-400/20 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-200">
                    Bot pausado para esta conversación.
                  </div>
                ) : null}

                <div ref={threadScrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
                  {loadingThread ? <div className="py-12 text-center text-xs text-white/50 sm:text-sm">Cargando mensajes…</div> : threadError ? <div className="py-12 text-center text-sm text-rose-500">{threadError}</div> : thread.length === 0 ? <div className="py-12 text-center text-xs text-white/50 sm:text-sm">{inboxIsBarbershop ? "No hay mensajes nuevos por ahora." : "No hay mensajes"}</div> : thread.map((m) => {
                    const role = String(m.role ?? "").toLowerCase();
                    const actor = String(m.actor ?? "").toLowerCase();
                    const isInbound = role === "user" || actor === "user";
                    const isStaff = actor === "staff" || actor === "human" || actor === "operator";
                    const isBot = actor === "bot" || role === "assistant";
                    return (
                      <ChatBubble
                        key={messageKey(m)}
                        tone={isInbound ? "user" : isStaff ? "staff" : "bot"}
                        label={!isInbound ? (isStaff ? "Staff" : isBot ? "Bot" : "Assistant") : undefined}
                        content={m.content ?? "—"}
                        meta={
                          <>
                          <span className="shrink-0">{new Date(m.created_at).toLocaleString("es", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</span>
                          <span className="shrink-0">{channelLabel(m.channel)}</span>
                          {import.meta.env.DEV && m.provider_message_id ? <span className="max-w-[180px] truncate">provider: {m.provider_message_id}</span> : null}
                          </>
                        }
                      />
                    );
                  })}
                </div>

                <div className="border-t border-white/10 bg-white/5 p-2.5 sm:p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {quickReplies.map((reply) => <button key={reply.label} onClick={() => setComposer(reply.text)} className="min-h-9 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10">{reply.label}</button>)}
                  </div>
                  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
                    <textarea ref={composerRef} value={composer} onChange={(e) => { setComposer(e.target.value); const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }} placeholder="Respuesta manual…" rows={1} className="max-h-[120px] min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 sm:px-4 text-sm text-white outline-none placeholder:text-white/30 transition focus:border-[#3CBDB9] focus:ring-4 focus:ring-[#3CBDB9]/20" />
                    <button onClick={sendReply} disabled={!selectedLead || sending || !composer.trim()} className={["min-h-10 w-full shrink-0 rounded-2xl px-4 sm:min-h-11 sm:px-5 text-sm font-semibold transition sm:w-auto", sending || !composer.trim() ? "bg-white/10 text-white/40" : "bg-[#3CBDB9] text-white hover:bg-[#35a9a5]"].join(" ")}>{sending ? "…" : "Enviar"}</button>
                  </div>
                  {sendNotice && <div className="mt-2 text-xs text-emerald-400">{sendNotice}</div>}
                  {latestOutboxStatus && (
                    <div className="text-safe mt-2 text-xs text-white/45">
                      Último envío: {latestOutboxStatus.status ?? "sin estado"}
                      {latestOutboxStatus.last_error ? ` · ${latestOutboxStatus.last_error}` : ""}
                    </div>
                  )}
                  {sendError && <div className="mt-2 text-xs text-rose-500">{sendError}</div>}
                  {selectedLead && !selectedLead.channel_user_id && (
                    <div className="mt-2 text-xs text-amber-300">
                      Saved in CRM only. {channelLabel(effectiveLeadChannel(selectedLead))} recipient is missing.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
