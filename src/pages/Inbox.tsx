import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarPlus, CheckCircle2, ChevronDown, ChevronUp, UserRound, MessageCircle, Phone } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { SectionCard } from "../components/SectionCard";
import { dedupeByKey } from "../lib/dedupe";
import { messageKey } from "../lib/messages";
import { getLeadDisplayName } from "../lib/leads";
import { useClinic } from "../context/ClinicContext";

const DEFAULT_ORG = "clinic-demo";

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
};

type MsgRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  actor: string | null;
  role: string | null;
  content: string | null;
  created_at: string;
};

// Helper: Get best display name (priority: full_name > first+last > state.name > fallback)
function getBestDisplayName(lead: LeadRow): string {
  if (lead.full_name && lead.full_name.trim() && !lead.full_name.startsWith("Usuario ")) {
    return lead.full_name.trim();
  }
  if (lead.first_name) {
    const parts = [lead.first_name, lead.last_name].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  const stateName = lead.state?.name;
  if (stateName && typeof stateName === "string" && stateName.trim() && !stateName.startsWith("Usuario ")) {
    return stateName.trim();
  }
  return getLeadDisplayName(lead);
}

// Helper: Format relative time (5m, 2h, 3d)
function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "ahora";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString("es", { day: "numeric", month: "short" });
}

export default function Inbox() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [thread, setThread] = useState<MsgRow[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [retryDraft, setRetryDraft] = useState<string>("");
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const leadsReloadTimeoutRef = useRef<number | null>(null);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === leadId) ?? null,
    [leads, leadId]
  );
  const resolvedLeadId = useMemo(() => {
    if (!leadId) return "";
    const byUuid = leads.find((l) => l.id === leadId);
    if (byUuid) return byUuid.id;
    const byChannelUser = leads.find((l) => l.channel_user_id === leadId);
    return byChannelUser?.id ?? leadId;
  }, [leadId, leads]);

  const selectedLeadState = selectedLead?.state ?? null;
  const selectedCollected = (selectedLeadState?.collected ?? {}) as Record<string, any>;
  const stageLabel = String(selectedLeadState?.stage ?? selectedCollected?.stage ?? "").trim();
  const businessTypeLabel = String(selectedCollected?.business_type ?? "").trim();
  const trialOffered = Boolean(selectedCollected?.trial_offered);
  const onboardingStarted = Boolean(selectedCollected?.onboarding_started);
  const leadMetaChips = [
    stageLabel ? { key: "stage", label: stageLabel } : null,
    businessTypeLabel ? { key: "business", label: businessTypeLabel } : null,
    trialOffered ? { key: "trial", label: "Trial ofrecida" } : null,
    onboardingStarted ? { key: "boarding", label: "Onboarding iniciado" } : null,
  ].filter((chip): chip is { key: string; label: string } => Boolean(chip));

  const quickReplies = [
    { label: "Precios", text: "Con gusto. ¿Qué tratamiento te interesa? Te comparto precios aproximados y opciones de pago." },
    { label: "Ubicación", text: "Estamos ubicados en el centro de la ciudad. ¿Querés que te envíe la ubicación exacta?" },
    { label: "Horarios", text: "Atendemos de lunes a sábado. ¿Qué día y horario te conviene?" },
    { label: "Agendar", text: "¡Perfecto! Decime el día y la hora que preferís y lo coordinamos." },
    { label: "Requisitos", text: "Para tu cita solo necesitamos tu nombre completo y un número de contacto. ¿Me los compartís?" },
  ];

  async function loadLeads() {
    setLoadingLeads(true);
    const { data, error } = await supabase
      .from("leads")
      .select("id, organization_id, full_name, first_name, last_name, avatar_url, phone, status, channel, last_channel, channel_user_id, state, last_message_at, last_bot_reply_at, last_message_preview")
      .eq("organization_id", ORG)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && data) {
      setLeads(dedupeByKey(data as any, (item) => `${item.organization_id ?? "org"}::${item.id}::${item.channel ?? "channel"}`));
    }
    setLoadingLeads(false);
  }

  async function loadThread(targetLeadId: string) {
    setLoadingThread(true);
    setThreadError(null);
    const { data, error } = await supabase
      .from("messages")
      .select("id, organization_id, lead_id, actor, role, content, created_at")
      .eq("organization_id", ORG)
      .eq("lead_id", targetLeadId)
      .order("created_at", { ascending: true })
      .limit(300);

    if (error) {
      setThreadError("No se pudo cargar la conversación.");
      setLoadingThread(false);
      return;
    }
    if (data) {
      const normalized = (data as any[]).map((m) => ({ ...m, content: m.content ?? "" }));
      setThread(dedupeByKey(normalized as any, messageKey));
    }
    setLoadingThread(false);
  }

  useEffect(() => {
    if (ORG) loadLeads();
  }, [ORG]);

  useEffect(() => {
    if (!resolvedLeadId || !ORG) {
      setThread([]);
      return;
    }
    loadThread(resolvedLeadId);
  }, [resolvedLeadId, ORG]);

  useEffect(() => {
    const ch = supabase
      .channel(`rt-messages-${ORG}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `organization_id=eq.${ORG}` }, async (payload) => {
        const newMsg = payload.new as { lead_id?: string | null };
        if (resolvedLeadId && newMsg?.lead_id === resolvedLeadId) {
          const row = payload.new as any;
          setThread((prev) =>
            dedupeByKey([...prev, {
              id: String(row.id),
              organization_id: String(row.organization_id),
              lead_id: row.lead_id ?? null,
              actor: row.actor ?? null,
              role: row.role ?? null,
              content: row.content ?? "",
              created_at: row.created_at ?? new Date().toISOString(),
            } as MsgRow], messageKey)
          );
        }
        if (leadsReloadTimeoutRef.current) window.clearTimeout(leadsReloadTimeoutRef.current);
        leadsReloadTimeoutRef.current = window.setTimeout(() => {
          void loadLeads();
          leadsReloadTimeoutRef.current = null;
        }, 250);
      })
      .subscribe();

    return () => {
      if (leadsReloadTimeoutRef.current) {
        window.clearTimeout(leadsReloadTimeoutRef.current);
        leadsReloadTimeoutRef.current = null;
      }
      supabase.removeChannel(ch);
    };
  }, [resolvedLeadId, ORG]);

  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread, loadingThread, resolvedLeadId]);

  async function markAsHandled(leadIdToMark: string, e?: React.MouseEvent) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    await supabase.from("leads").update({ status: "attended" }).eq("id", leadIdToMark);
    await loadLeads();
  }

  async function sendReply() {
    if (!selectedLead) return;
    const text = composer.trim();
    if (!text) return;

    setSending(true);
    setSendError(null);
    setSendState("sending");
    try {
      if (!selectedLead.channel_user_id) {
        throw new Error("Este lead no tiene PSID/channel_user_id para enviar por Messenger.");
      }
      const kvSecrets = await supabase
        .from("org_secrets")
        .select("key, value")
        .eq("organization_id", ORG)
        .in("key", ["META_PAGE_ACCESS_TOKEN", "PAGE_ACCESS_TOKEN", "META_PAGE_TOKEN"])
        .limit(3);

      const kvToken = Array.isArray(kvSecrets.data)
        ? kvSecrets.data
            .map((row: any) => String(row?.value ?? "").replace(/^['"]|['"]$/g, "").trim())
            .find((value) => value.length > 50) ?? ""
        : "";

      let legacyToken = "";
      if (!kvToken) {
        const legacySecrets = await supabase
          .from("org_secrets")
          .select('meta_page_access_token, "META_PAGE_ACCESS_TOKEN"')
          .eq("organization_id", ORG)
          .maybeSingle();
        if (!legacySecrets.error && legacySecrets.data) {
          legacyToken = String(
            (legacySecrets.data as any)?.meta_page_access_token ??
            (legacySecrets.data as any)?.META_PAGE_ACCESS_TOKEN ??
            ""
          ).replace(/^['"]|['"]$/g, "").trim();
        }
      }

      if (!kvToken && !legacyToken) {
        throw new Error("Falta token de página para esta organización. Revisa Integraciones.");
      }

      const nowIso = new Date().toISOString();
      const { data: msgData, error: msgErr } = await supabase.from("messages").insert([{
        organization_id: ORG,
        lead_id: selectedLead.id,
        channel: selectedLead.channel ?? "messenger",
        channel_user_id: selectedLead.channel_user_id,
        actor: "human",
        role: "assistant",
        content: text,
        created_at: nowIso,
      }]).select("id").maybeSingle();

      if (msgErr) throw msgErr;
      const uiMessageId = (msgData as any)?.id ?? null;

      const { error: outboxErr } = await supabase.from("reply_outbox").insert([{
        organization_id: ORG,
        lead_id: selectedLead.id,
        channel: selectedLead.channel ?? "messenger",
        channel_user_id: selectedLead.channel_user_id,
        status: "queued",
        scheduled_for: nowIso,
        message_text: text,
        payload: { text, recipient: { id: selectedLead.channel_user_id }, recipient_id: selectedLead.channel_user_id, source: "ui_manual", provider: "meta", ui_message_id: uiMessageId },
      }]);

      if (outboxErr) throw outboxErr;
      setComposer("");
      if (composerRef.current) composerRef.current.style.height = "56px";
      setSendState("sent");
      await loadLeads();
      await loadThread(selectedLead.id);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      setSendError(msg);
      setRetryDraft(text);
      setSendState("failed");
    } finally {
      setSending(false);
    }
  }

  // ============ RENDER ============
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#0B1117] lg:h-auto lg:min-h-screen">
      {/* MOBILE HEADER - Only when viewing conversation */}
      {leadId && (
        <div className="safe-area-top flex items-center gap-3 border-b border-white/10 bg-white/5 px-4 py-3 lg:hidden">
          <button onClick={() => navigate("/inbox")} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 transition hover:bg-white/10">
            <ArrowLeft className="h-5 w-5 text-white/80" />
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-3">
            {selectedLead?.avatar_url ? (
              <img src={selectedLead.avatar_url} alt="" className="h-10 w-10 rounded-full border border-white/10 object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-sm font-bold text-white">
                {selectedLead ? getBestDisplayName(selectedLead).slice(0, 1).toUpperCase() : "?"}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold text-white">{selectedLead ? getBestDisplayName(selectedLead) : "Conversación"}</div>
              <div className="truncate text-xs text-white/50">{selectedLead?.phone || selectedLead?.channel?.toUpperCase() || ""}</div>
            </div>
          </div>
          {selectedLead && selectedLead.status !== "attended" && (
            <button onClick={(e) => markAsHandled(selectedLead.id, e)} className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 transition" title="Marcar atendido">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </button>
          )}
        </div>
      )}

      {/* DESKTOP/LIST HEADER */}
      {!leadId && (
        <div className="border-b border-white/10 bg-white/5 px-4 pt-4 pb-2 lg:border-0 lg:bg-transparent">
          <h1 className="text-xl font-bold text-white">Inbox</h1>
          <p className="text-sm text-white/50">Conversaciones activas</p>
        </div>
      )}

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-hidden">
        <div className="grid grid-cols-12 gap-0 lg:gap-4 h-full lg:p-4">
          
          {/* LEFT: LEADS LIST */}
          <div className={["col-span-12 lg:col-span-5 xl:col-span-4 overflow-hidden flex flex-col", leadId ? "hidden lg:flex" : "flex"].join(" ")}>
            <div className="flex-1 overflow-y-auto">
              <div className="p-4 lg:p-0 space-y-2">
                {loadingLeads ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-sm text-white/50">Cargando…</div>
                  </div>
                ) : leads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <MessageCircle className="mb-3 h-12 w-12 text-white/30" />
                    <div className="text-sm font-medium text-white/80">Sin conversaciones</div>
                    <div className="mt-1 text-xs text-white/50">Los mensajes aparecerán aquí</div>
                  </div>
                ) : (
                  leads.map((l) => {
                    const active = l.id === resolvedLeadId;
                    const channelLabel = (l.last_channel || l.channel || "messenger").toUpperCase();
                    const lm = l.last_message_at ? new Date(l.last_message_at).getTime() : 0;
                    const lb = l.last_bot_reply_at ? new Date(l.last_bot_reply_at).getTime() : 0;
                    const unread = lm > 0 && lm > lb;
                    const isAttended = l.status === "attended";
                    const displayName = getBestDisplayName(l);
                    const avatarFallback = displayName.slice(0, 1).toUpperCase();

                    return (
                      <button
                        key={l.id}
                        onClick={() => navigate(`/inbox/${l.id}`)}
                        className={["group relative w-full rounded-2xl border p-3 text-left transition", active ? "border-blue-400/20 bg-blue-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"].join(" ")}
                      >
                        <div className="flex gap-3">
                          {/* Avatar */}
                          <div className="relative shrink-0">
                            {l.avatar_url ? (
                              <img src={l.avatar_url} alt={displayName} className="h-12 w-12 rounded-full border border-white/10 object-cover" />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-sm font-bold text-white">
                                {avatarFallback}
                              </div>
                            )}
                            {unread && <div className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#0B1117] bg-rose-500" />}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 py-0.5">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className={["truncate text-sm font-semibold", unread ? "text-white" : "text-white/80"].join(" ")}>{displayName}</span>
                              <span className="shrink-0 text-[11px] text-white/40">{formatRelativeTime(l.last_message_at)}</span>
                            </div>

                            {/* Preview - 2 lines visible in vertical mobile */}
                            <div className={["text-xs leading-relaxed", unread ? "font-medium text-white/80" : "text-white/50"].join(" ")} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {l.last_message_preview || "Sin mensajes"}
                            </div>

                            {/* Tags */}
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              <span className="inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/50">{channelLabel}</span>
                              {isAttended && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                  <CheckCircle2 className="h-2.5 w-2.5" /> Atendido
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Quick action - mark as handled (visible on hover desktop, always on mobile) */}
                          {!isAttended && (
                            <button
                              onClick={(e) => markAsHandled(l.id, e)}
                              className="shrink-0 self-center rounded-full p-2 opacity-60 transition hover:bg-emerald-500/10 group-hover:opacity-100"
                              title="Marcar como atendido"
                            >
                              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                            </button>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: CONVERSATION */}
          <div className={["col-span-12 lg:col-span-7 xl:col-span-8 flex flex-col overflow-hidden", leadId ? "flex" : "hidden lg:flex"].join(" ")}>
            {!leadId ? (
              <div className="flex flex-1 items-center justify-center bg-white/5 lg:rounded-2xl lg:border lg:border-white/10">
                <div className="text-center py-12">
                  <MessageCircle className="mx-auto mb-4 h-16 w-16 text-white/20" />
                  <div className="text-sm text-white/50">Selecciona una conversación</div>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col overflow-hidden bg-white/5 lg:rounded-2xl lg:border lg:border-white/10">
                {/* Desktop conversation header */}
                <div className="hidden items-center justify-between border-b border-white/10 px-4 py-3 lg:flex">
                  <div className="flex items-center gap-3 min-w-0">
                    {selectedLead?.avatar_url ? (
                      <img src={selectedLead.avatar_url} alt="" className="h-10 w-10 rounded-full border border-white/10 object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-sm font-bold text-white">
                        {selectedLead ? getBestDisplayName(selectedLead).slice(0, 1).toUpperCase() : "?"}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-white">{selectedLead ? getBestDisplayName(selectedLead) : ""}</div>
                      <div className="flex items-center gap-2 text-xs text-white/50">
                        {selectedLead?.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{selectedLead.phone}</span>}
                        <span>{selectedLead?.channel?.toUpperCase() || "MESSENGER"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedLead && selectedLead.status !== "attended" && (
                      <button onClick={(e) => markAsHandled(selectedLead.id, e)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/20">
                        <CheckCircle2 className="h-4 w-4" /> Atendido
                      </button>
                    )}
                    <button onClick={() => navigate("/agenda")} className="inline-flex items-center gap-2 rounded-xl bg-[#3CBDB9] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#35a9a5]">
                      <CalendarPlus className="h-4 w-4" /> Crear cita
                    </button>
                    <button onClick={() => navigate("/patients")} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10">
                      <UserRound className="h-4 w-4" /> Paciente
                    </button>
                  </div>
                </div>

                {/* Meta chips */}
                {leadMetaChips.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-b border-white/10 bg-white/5 px-4 py-2">
                    {leadMetaChips.map((chip) => (
                      <span key={chip.key} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-medium text-white/60">{chip.label}</span>
                    ))}
                  </div>
                )}

                {/* Messages thread */}
                <div ref={threadScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  {loadingThread ? (
                    <div className="flex items-center justify-center py-12"><div className="text-sm text-white/50">Cargando mensajes…</div></div>
                  ) : threadError ? (
                    <div className="text-sm text-rose-500 text-center py-12">{threadError}</div>
                  ) : thread.length === 0 ? (
                    <div className="py-12 text-center text-sm text-white/50">No hay mensajes</div>
                  ) : (
                    thread.map((m) => {
                      const normalizedRole = (m.role ?? "").toLowerCase();
                      const normalizedActor = (m.actor ?? "").toLowerCase();
                      const isInbound = normalizedRole === "user" || normalizedActor === "user";
                      const isBot = normalizedActor === "bot";
                      const isHuman = normalizedActor === "human" || normalizedActor === "operator";

                      return (
                        <div
                          key={messageKey(m)}
                          className={[
                            "max-w-[85%] rounded-2xl px-4 py-3 text-sm break-words whitespace-pre-wrap",
                            isInbound
                              ? "ml-auto bg-blue-600 text-white rounded-br-md"
                              : isHuman
                              ? "mr-auto rounded-bl-md border border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
                              : "mr-auto rounded-bl-md bg-white/10 text-white",
                          ].join(" ")}
                        >
                          {!isInbound && (
                            <div className="text-[10px] font-semibold opacity-70 mb-1 uppercase tracking-wide">
                              {isBot ? "🤖 Bot" : "👤 Tú"}
                            </div>
                          )}
                          {m.content ?? "—"}
                          <div className={["mt-1.5 text-[10px]", isInbound ? "text-white/70" : "text-white/40"].join(" ")}>
                            {new Date(m.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Composer */}
                <div className="border-t border-white/10 bg-white/5 p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
                  {/* Actions toggle */}
                  <div className="mb-2">
                    <button onClick={() => setActionsOpen((v) => !v)} className="flex items-center gap-2 text-xs font-medium text-white/50 transition hover:text-white/80">
                      {actionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      Acciones rápidas
                    </button>
                    {actionsOpen && (
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <button onClick={() => navigate("/agenda")} className="h-9 rounded-xl border border-white/10 bg-white/5 px-2 text-xs font-medium text-white/80 transition hover:bg-white/10">Agendar</button>
                        <button onClick={() => setComposer("Te confirmo tu cita. ¿Mantenemos este horario?")} className="h-9 rounded-xl border border-white/10 bg-white/5 px-2 text-xs font-medium text-white/80 transition hover:bg-white/10">Confirmar</button>
                        <button onClick={() => setComposer("Podemos reagendar sin problema. ¿Qué día y hora te conviene?")} className="h-9 rounded-xl border border-white/10 bg-white/5 px-2 text-xs font-medium text-white/80 transition hover:bg-white/10">Reagendar</button>
                      </div>
                    )}
                  </div>

                  {/* Quick replies */}
                  <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                    {quickReplies.map((reply) => (
                      <button key={reply.label} onClick={() => setComposer(reply.text)} className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10">
                        {reply.label}
                      </button>
                    ))}
                  </div>

                  {/* Input */}
                  <div className="flex items-end gap-2 mt-2">
                    <textarea
                      ref={composerRef}
                      value={composer}
                      onChange={(e) => {
                        setComposer(e.target.value);
                        const el = e.currentTarget;
                        el.style.height = "auto";
                        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                      }}
                      placeholder="Escribe un mensaje…"
                      rows={1}
                      className="flex-1 min-h-[44px] max-h-[120px] resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 transition focus:border-[#3CBDB9] focus:ring-4 focus:ring-[#3CBDB9]/20"
                    />
                    <button
                      onClick={sendReply}
                      disabled={!selectedLead || sending || !composer.trim()}
                      className={["h-11 shrink-0 rounded-2xl px-5 text-sm font-semibold transition", sending || !composer.trim() ? "bg-white/10 text-white/40" : "bg-[#3CBDB9] text-white hover:bg-[#35a9a5]"].join(" ")}
                    >
                      {sending ? "…" : "Enviar"}
                    </button>
                  </div>

                  {/* Status */}
                  {sendState === "sent" && <div className="mt-2 text-xs text-emerald-400">✓ Enviado</div>}
                  {sendError && <div className="mt-2 text-xs text-rose-500">{sendError}</div>}
                  {sendState === "failed" && retryDraft && (
                    <button onClick={() => { setComposer(retryDraft); setSendError(null); setSendState("idle"); }} className="mt-2 text-xs font-medium text-amber-400 hover:text-amber-300">
                      Reintentar
                    </button>
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
