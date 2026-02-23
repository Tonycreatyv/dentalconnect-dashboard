import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarPlus, CheckCircle2, UserRound } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { SectionCard } from "../components/SectionCard";
import { dedupeByKey } from "../lib/dedupe";
import { messageKey } from "../lib/messages";

const ORG = "clinic-demo";

type LeadRow = {
  id: string;
  organization_id: string;
  full_name: string | null;
  phone: string | null;
  status: string | null;
  channel: string | null;
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

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [thread, setThread] = useState<MsgRow[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === leadId) ?? null,
    [leads, leadId]
  );

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
      .select("id, organization_id, full_name, phone, status, channel, last_message_at, last_message_preview")
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

    const { data, error } = await supabase
      .from("messages")
      .select("id, organization_id, lead_id, actor, role, content, created_at")
      .eq("organization_id", ORG)
      .eq("lead_id", targetLeadId)
      .order("created_at", { ascending: true })
      .limit(300);

    if (!error && data) setThread(dedupeByKey(data as any, messageKey));
    setLoadingThread(false);
  }

  useEffect(() => {
    loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!leadId) {
      setThread([]);
      return;
    }
    loadThread(leadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

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
          await loadLeads();
          const newMsg = payload.new as { lead_id?: string | null };
          if (leadId && newMsg?.lead_id === leadId) await loadThread(leadId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function markAsHandled() {
    if (!leadId) return;
    await supabase.from("leads").update({ status: "attended" }).eq("id", leadId);
    await loadLeads();
  }

  async function sendReply() {
    if (!selectedLead) return;
    const text = composer.trim();
    if (!text) return;

    setSending(true);
    try {
      const nowIso = new Date().toISOString();
      const { error: msgErr } = await supabase.from("messages").upsert([
        {
          organization_id: ORG,
          lead_id: selectedLead.id,
          channel: selectedLead.channel ?? "messenger",
          actor: "bot",
          role: "assistant",
          content: text,
          created_at: nowIso,
        },
      ]);

      if (msgErr) throw msgErr;

      const { error: outboxErr } = await supabase.from("reply_outbox").insert([
        {
          organization_id: ORG,
          lead_id: selectedLead.id,
          channel: selectedLead.channel ?? "messenger",
          status: "pending",
          scheduled_for: nowIso,
          message_text: text,
          payload: {
            organization_id: ORG,
            lead_id: selectedLead.id,
            channel: selectedLead.channel ?? "messenger",
            outbound_text: text,
            source: "ui_quick_reply",
          },
        },
      ]);

      if (outboxErr) throw outboxErr;

      setComposer("");
      await loadLeads();
      await loadThread(selectedLead.id);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-4 min-w-0 overflow-x-hidden">
      <div className="col-span-12 lg:col-span-5 min-w-0">
        <SectionCard title="Leads" description="Conversaciones activas.">
          <div className="max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
            {loadingLeads ? (
              <div className="text-sm text-slate-700">Cargando…</div>
            ) : leads.length === 0 ? (
              <div className="text-sm text-slate-700">
                Aún no hay conversaciones activas.
              </div>
            ) : (
              <div className="grid gap-2">
                {leads.map((l) => {
                  const active = l.id === leadId;
                  return (
                    <button
                      key={l.id}
                      onClick={() => navigate(`/inbox/${l.id}`)}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-left transition",
                        "min-w-0 overflow-hidden",
                        active
                          ? "border-blue-200 bg-blue-50"
                          : "border-[#E5E7EB] bg-white hover:bg-[#F4F5F7]",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {l.full_name || "Sin nombre"}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {l.last_message_preview || "—"}
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

      <div className="col-span-12 lg:col-span-7 min-w-0">
        <SectionCard
          title="Conversación"
          description={
            selectedLead ? `Lead: ${selectedLead.full_name ?? selectedLead.id}` : "Seleccioná un lead"
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
                  onClick={() => navigate("/calendar")}
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
          <div className="max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
            {!leadId ? (
              <div className="text-sm text-slate-700">Elegí un lead de la izquierda.</div>
            ) : loadingThread ? (
              <div className="text-sm text-slate-700">Cargando mensajes…</div>
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
            <div className="mt-4 rounded-2xl border border-[#E5E7EB] bg-white p-3">
              <div className="flex flex-wrap gap-2">
                {quickReplies.map((reply) => (
                  <button
                    key={reply.label}
                    type="button"
                    onClick={() => setComposer(reply.text)}
                    className="rounded-full border border-[#E5E7EB] bg-[#F4F5F7] px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-[#F4F5F7]"
                  >
                    {reply.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-end gap-2">
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="Escribí una respuesta…"
                  rows={2}
                  className="w-full resize-none rounded-2xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-500"
                />
                <button
                  onClick={sendReply}
                  disabled={!selectedLead || sending || !composer.trim()}
                  className={[
                    "shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold",
                    sending || !composer.trim()
                      ? "bg-[#F4F5F7] text-slate-500"
                      : "bg-blue-600 text-white hover:bg-blue-700",
                  ].join(" ")}
                >
                  {sending ? "Enviando…" : "Responder"}
                </button>
              </div>
            </div>
          ) : null}
        </SectionCard>
      </div>
    </div>
  );
}
