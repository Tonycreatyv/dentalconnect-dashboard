import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarPlus, CheckCircle2, ChevronDown, ChevronUp, UserRound } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { SectionCard } from "../components/SectionCard";
import { dedupeByKey } from "../lib/dedupe";
import { messageKey } from "../lib/messages";
import { getLeadDisplayName } from "../lib/leads";
import { useClinic } from "../context/ClinicContext";
import PageHeader from "../components/PageHeader";

const DEFAULT_ORG = "clinic-demo";

type LeadRow = {
  id: string;
  organization_id: string;
  channel_user_id: string | null;
  avatar_url: string | null;
  state: Record<string, any> | null;
  full_name: string | null;
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
  actor: string | null; // "user" | "bot"
  role: string | null;  // "user" | "assistant"
  content: string | null;
  created_at: string;
};

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

  const quickReplies = [
    {
      label: "Precios",
      text: "Con gusto. ¿Qué tratamiento te interesa? Te comparto precios aproximados y opciones de pago.",
    },
    {
      label: "Ubicación",
      text: "Estamos ubicados en el centro de la ciudad. ¿Querés que te envíe la ubicación exacta?",
    },
    {
      label: "Horarios",
      text: "Atendemos de lunes a sábado. ¿Qué día y horario te conviene?",
    },
    {
      label: "Agendar",
      text: "¡Perfecto! Decime el día y la hora que preferís y lo coordinamos.",
    },
    {
      label: "Enviar requisitos",
      text: "Para tu cita solo necesitamos tu nombre completo y un número de contacto. ¿Me los compartís?",
    },
  ];

  async function loadLeads() {
    setLoadingLeads(true);

    const { data, error } = await supabase
      .from("leads")
      .select("id, organization_id, full_name, avatar_url, phone, status, channel, last_channel, channel_user_id, state, last_message_at, last_bot_reply_at, last_message_preview")
      .eq("organization_id", ORG)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && data) {
      setLeads(
        dedupeByKey(data as any, (item) => `${item.organization_id ?? "org"}::${item.id}::${item.channel ?? "channel"}`)
      );
    }
    setLoadingLeads(false);
  }

  async function loadThread(targetLeadId: string) {
    setLoadingThread(true);
    setThreadError(null);
    // eslint-disable-next-line no-console
    console.debug("[Inbox] loadThread", { leadIdParam: leadId, resolvedLeadId: targetLeadId, organization_id: ORG });

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
      // eslint-disable-next-line no-console
      console.debug("[Inbox] messages fetched", { count: normalized.length, organization_id: ORG, lead_id: targetLeadId });
      setThread(dedupeByKey(normalized as any, messageKey));
    }
    setLoadingThread(false);
  }

  useEffect(() => {
    loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!resolvedLeadId) {
      setThread([]);
      return;
    }
    loadThread(resolvedLeadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedLeadId]);

  useEffect(() => {
    const ch = supabase
      .channel(`rt-messages-${ORG}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `organization_id=eq.${ORG}`,
        },
        async (payload) => {
          const newMsg = payload.new as { lead_id?: string | null };
          if (resolvedLeadId && newMsg?.lead_id === resolvedLeadId) {
            const row = payload.new as any;
            setThread((prev) =>
              dedupeByKey(
                [
                  ...prev,
                  {
                    id: String(row.id),
                    organization_id: String(row.organization_id),
                    lead_id: row.lead_id ?? null,
                    actor: row.actor ?? null,
                    role: row.role ?? null,
                    content: row.content ?? "",
                    created_at: row.created_at ?? new Date().toISOString(),
                  } as MsgRow,
                ],
                messageKey
              )
            );
          }
          if (leadsReloadTimeoutRef.current) {
            window.clearTimeout(leadsReloadTimeoutRef.current);
          }
          leadsReloadTimeoutRef.current = window.setTimeout(() => {
            void loadLeads();
            leadsReloadTimeoutRef.current = null;
          }, 250);
        }
      )
      .subscribe();

    return () => {
      if (leadsReloadTimeoutRef.current) {
        window.clearTimeout(leadsReloadTimeoutRef.current);
        leadsReloadTimeoutRef.current = null;
      }
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedLeadId, ORG]);

  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread, loadingThread, resolvedLeadId]);

  async function markAsHandled() {
    if (!resolvedLeadId) return;
    await supabase.from("leads").update({ status: "attended" }).eq("id", resolvedLeadId);
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

      const tokenCheck = await supabase
        .from("org_secrets")
        .select("key")
        .eq("organization_id", ORG)
        .in("key", ["META_PAGE_ACCESS_TOKEN", "PAGE_ACCESS_TOKEN", "META_PAGE_TOKEN"])
        .limit(1);

      if (tokenCheck.error || !tokenCheck.data || tokenCheck.data.length === 0) {
        throw new Error("Falta token de página para esta organización. Revisa Integraciones.");
      }

      const nowIso = new Date().toISOString();
      const { data: msgData, error: msgErr } = await supabase.from("messages").insert([
        {
          organization_id: ORG,
          lead_id: selectedLead.id,
          channel: selectedLead.channel ?? "messenger",
          channel_user_id: selectedLead.channel_user_id,
          actor: "human",
          role: "assistant",
          content: text,
          created_at: nowIso,
        },
      ]).select("id").maybeSingle();

      if (msgErr) throw msgErr;
      const uiMessageId = (msgData as any)?.id ?? null;

      const { error: outboxErr } = await supabase.from("reply_outbox").insert([
        {
          organization_id: ORG,
          lead_id: selectedLead.id,
          channel: selectedLead.channel ?? "messenger",
          channel_user_id: selectedLead.channel_user_id,
          status: "queued",
          scheduled_for: nowIso,
          message_text: text,
          payload: {
            text,
            recipient: { id: selectedLead.channel_user_id },
            recipient_id: selectedLead.channel_user_id,
            source: "ui_manual",
            provider: "meta",
            ui_message_id: uiMessageId,
          },
        },
      ]);

      if (outboxErr) throw outboxErr;

      setComposer("");
      if (composerRef.current) {
        composerRef.current.style.height = "56px";
      }
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

  return (
    <div className="space-y-4 min-w-0 overflow-x-hidden">
      <PageHeader
        title="Inbox"
        subtitle="Conversaciones y respuestas rápidas."
        showBackOnMobile
        backTo="/overview"
      />
      <div className="grid grid-cols-12 gap-4 min-w-0 overflow-x-hidden">
      <div className={["col-span-12 lg:col-span-5 min-w-0", leadId ? "hidden lg:block" : "block"].join(" ")}>
        <SectionCard title="Leads" description="Conversaciones activas." className="lg:min-h-[calc(100vh-190px)]">
          <div className="max-h-[calc(100vh-240px)] overflow-y-auto pr-1 sm:max-h-[calc(100vh-220px)]">
            {loadingLeads ? (
              <div className="text-sm text-slate-700">Cargando…</div>
            ) : leads.length === 0 ? (
              <div className="text-sm text-slate-700">
                Aún no hay conversaciones activas.
              </div>
            ) : (
              <div className="grid gap-2">
                {leads.map((l) => {
                  const active = l.id === resolvedLeadId;
                  const channelLabel = (l.last_channel || l.channel || "messenger").toUpperCase();
                  const lm = l.last_message_at ? new Date(l.last_message_at).getTime() : 0;
                  const lb = l.last_bot_reply_at ? new Date(l.last_bot_reply_at).getTime() : 0;
                  const unread = lm > 0 && lm > lb;
                  const avatarFallback = getLeadDisplayName(l).slice(0, 1).toUpperCase();
                  return (
                    <button
                      key={l.id}
                      onClick={() => navigate(`/inbox/${l.id}`)}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-left transition",
                        "min-w-0 overflow-hidden",
                        active
                          ? "border-[#3CBDB9]/45 bg-[#0894C1]/18"
                          : "border-[#E5E7EB] bg-white hover:bg-white/[0.09]",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <div className="flex min-w-0 items-center gap-3">
                          {l.avatar_url ? (
                            <img
                              src={l.avatar_url}
                              alt={getLeadDisplayName(l)}
                              className="h-10 w-10 shrink-0 rounded-full border border-[#E5E7EB] object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E5E7EB] bg-[#F4F5F7] text-xs font-semibold text-slate-700">
                              {avatarFallback}
                            </div>
                          )}
                          <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {getLeadDisplayName(l)}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {l.last_message_preview || "—"}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="inline-flex rounded-full border border-[#D1D5DB] px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-slate-600">
                              {channelLabel}
                            </span>
                            {unread ? (
                              <span className="inline-flex rounded-full border border-rose-300 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                                NUEVO
                              </span>
                            ) : null}
                          </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-[11px] text-slate-500">
                          {l.last_message_at ? new Date(l.last_message_at).toLocaleString() : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <div className={["col-span-12 lg:col-span-7 min-w-0", leadId ? "block" : "hidden lg:block"].join(" ")}>
        <SectionCard
          title="Conversación"
          description={
            selectedLead ? `Lead: ${getLeadDisplayName(selectedLead)}` : "Seleccioná un lead"
          }
          action={
            selectedLead ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={markAsHandled}
                  className="inline-flex items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-[#F4F5F7]"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Marcar como atendido
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/agenda")}
                  className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <CalendarPlus className="h-4 w-4" />
                  Crear cita
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/patients")}
                  className="inline-flex items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-[#F4F5F7]"
                >
                  <UserRound className="h-4 w-4" />
                  Ver paciente
                </button>
              </div>
            ) : null
          }
        >
          {leadId ? (
            <div className="mb-4 flex items-center gap-2 lg:hidden sticky top-0 z-10 rounded-2xl border border-white/10 bg-black/35 px-2 py-2 backdrop-blur">
              <button
                type="button"
                onClick={() => navigate("/inbox")}
                className="inline-flex items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-[#F4F5F7]"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver
              </button>
              <div className="text-xs text-slate-500 truncate">
                {selectedLead ? getLeadDisplayName(selectedLead) : "Conversación"}
              </div>
            </div>
          ) : null}
          <div ref={threadScrollRef} className="max-h-[calc(100vh-340px)] overflow-y-auto pr-1 sm:max-h-[calc(100vh-300px)]">
            {!leadId ? (
              <div className="text-sm text-slate-700">Elegí un lead de la izquierda.</div>
            ) : loadingThread ? (
              <div className="text-sm text-slate-700">Cargando mensajes…</div>
            ) : threadError ? (
              <div className="text-sm text-rose-300">{threadError}</div>
            ) : thread.length === 0 ? (
              <div className="text-sm text-slate-700">No hay mensajes visibles.</div>
            ) : (
              <div className="grid gap-2">
                {thread.map((m) => {
                  const isUser = (m.actor ?? m.role) === "user";
                  return (
                    <div
                      key={messageKey(m)}
                      className={[
                        "max-w-[78%] rounded-2xl px-4 py-3 text-sm",
                        "break-words whitespace-pre-wrap",
                        isUser
                          ? "ml-auto bg-[#F4F5F7] text-slate-900"
                          : "mr-auto bg-slate-900 text-white",
                      ].join(" ")}
                    >
                      {m.content ?? "—"}
                      <div className="mt-1 text-[11px] opacity-60">
                        {new Date(m.created_at).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {leadId ? (
            <div className="mt-4 rounded-2xl border border-[#E5E7EB] bg-white p-3 sticky bottom-0 z-10">
              <div className="mb-2 rounded-xl border border-[#E5E7EB] bg-[#F4F5F7] p-2">
                <button
                  type="button"
                  onClick={() => setActionsOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-1 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600"
                >
                  Actions
                  {actionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {actionsOpen ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => navigate("/agenda")}
                      className="h-10 rounded-xl border border-[#D1D5DB] bg-white px-3 text-xs font-semibold text-slate-700"
                    >
                      Agendar
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposer("Te confirmo tu cita. ¿Mantenemos este horario?")}
                      className="h-10 rounded-xl border border-[#D1D5DB] bg-white px-3 text-xs font-semibold text-slate-700"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposer("Podemos reagendar sin problema. ¿Qué día y hora te conviene?")}
                      className="h-10 rounded-xl border border-[#D1D5DB] bg-white px-3 text-xs font-semibold text-slate-700"
                    >
                      Reagendar
                    </button>
                    <button
                      type="button"
                      onClick={markAsHandled}
                      className="h-10 rounded-xl border border-[#D1D5DB] bg-white px-3 text-xs font-semibold text-slate-700"
                    >
                      Marcar resuelto
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposer((prev) => `${prev}${prev ? "\n" : ""}Nota interna: `)}
                      className="col-span-2 h-10 rounded-xl border border-[#D1D5DB] bg-white px-3 text-xs font-semibold text-slate-700"
                    >
                      Nota
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="overflow-x-auto pb-1">
                <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                  {quickReplies.map((reply) => (
                    <button
                      key={reply.label}
                      type="button"
                      onClick={() => setComposer(reply.text)}
                      className="rounded-full border border-[#E5E7EB] bg-[#F4F5F7] px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-slate-700 hover:bg-[#F4F5F7]"
                    >
                      {reply.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-end gap-2">
                <textarea
                  ref={composerRef}
                  value={composer}
                  onChange={(e) => {
                    setComposer(e.target.value);
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
                  }}
                  placeholder="Escribí una respuesta…"
                  rows={3}
                  className="min-h-[56px] max-h-[180px] w-full resize-none overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-white px-3 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-500"
                />
                <button
                  onClick={sendReply}
                  disabled={!selectedLead || sending || !composer.trim()}
                  className={[
                    "h-11 shrink-0 rounded-2xl px-4 text-sm font-semibold",
                    sending || !composer.trim()
                      ? "bg-[#F4F5F7] text-slate-500"
                      : "bg-blue-600 text-white hover:bg-blue-700",
                  ].join(" ")}
                >
                  {sending ? "Enviando…" : "Responder"}
                </button>
              </div>
              {sendState === "sent" ? <div className="mt-2 text-xs text-emerald-300">Enviado</div> : null}
              {sendError ? <div className="mt-2 text-xs text-rose-300">{sendError}</div> : null}
              {sendState === "failed" && retryDraft ? (
                <button
                  type="button"
                  onClick={() => {
                    setComposer(retryDraft);
                    setSendError(null);
                    setSendState("idle");
                  }}
                  className="mt-2 text-xs font-semibold text-amber-200 hover:text-amber-100"
                >
                  Reintentar mensaje
                </button>
              ) : null}
            </div>
          ) : null}
        </SectionCard>
      </div>
      </div>
    </div>
  );
}
