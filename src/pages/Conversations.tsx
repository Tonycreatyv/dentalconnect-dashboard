// src/pages/Conversations.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  channel_user_id: string | null;
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

export default function Conversations() {
  const { leadId } = useParams();
  const navigate = useNavigate();

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [thread, setThread] = useState<MsgRow[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);

  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);

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

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === leadId) ?? null,
    [leads, leadId]
  );

  async function loadLeads() {
    setLoadingLeads(true);
    setUiError(null);

    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, organization_id, full_name, phone, status, channel, channel_user_id, last_message_at, last_message_preview"
      )
      .eq("organization_id", ORG)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      setUiError(error.message);
      setLeads([]);
    } else {
      setLeads(
        dedupeByKey((data ?? []) as any, (item) => `${item.organization_id ?? "org"}::${item.id}::${item.channel ?? "channel"}`)
      );
    }
    setLoadingLeads(false);
  }

  async function loadThread(targetLeadId: string) {
    setLoadingThread(true);
    setUiError(null);

    const { data, error } = await supabase
      .from("messages")
      .select("id, organization_id, lead_id, actor, role, content, created_at")
      .eq("organization_id", ORG)
      .eq("lead_id", targetLeadId)
      .order("created_at", { ascending: true })
      .limit(250);

    if (error) {
      setUiError(error.message);
      setThread([]);
    } else {
      setThread(dedupeByKey((data ?? []) as any, messageKey));
    }
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
          if (leadId && newMsg?.lead_id === leadId) {
            await loadThread(leadId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function sendReply() {
    if (!selectedLead) return;
    const text = composer.trim();
    if (!text) return;

    setSending(true);
    setUiError(null);

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
          channel_user_id: selectedLead.channel_user_id,
          status: "pending",
          scheduled_for: new Date().toISOString(),
          message_text: text,
          payload: {
            organization_id: ORG,
            lead_id: selectedLead.id,
            channel: selectedLead.channel ?? "messenger",
            channel_user_id: selectedLead.channel_user_id,
            outbound_text: text,
            source: "ui_manual_reply",
          },
        },
      ]);

      if (outboxErr) throw outboxErr;

      setComposer("");
      await loadLeads();
      await loadThread(selectedLead.id);
    } catch (e: any) {
      setUiError(e?.message ?? "Error enviando respuesta.");
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-4 min-w-0 overflow-x-hidden">
      <div className="col-span-12 lg:col-span-5 min-w-0">
        <SectionCard title="Leads" description="Conversaciones activas, actualizadas automáticamente.">
          {uiError ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              {uiError}
            </div>
          ) : null}

          {loadingLeads ? (
            <div className="text-sm text-white/60">Cargando…</div>
          ) : leads.length === 0 ? (
            <div className="text-sm text-white/60">
              No hay leads visibles.
            </div>
          ) : (
            <div className="grid gap-2">
              {leads.map((l) => {
                const active = l.id === leadId;
                return (
                  <button
                    key={l.id}
                    onClick={() => navigate(`/conversations/${l.id}`)}
                    className={[
                      "w-full rounded-2xl border px-4 py-3 text-left transition",
                      active
                        ? "border-blue-400/20 bg-blue-500/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3 min-w-0">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">
                          {l.full_name || "Sin nombre"}
                        </div>
                        <div className="truncate text-xs text-white/50">
                          {l.last_message_preview || "—"}
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] text-white/50">
                        {l.last_message_at ? new Date(l.last_message_at).toLocaleString() : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="col-span-12 lg:col-span-7 min-w-0">
        <SectionCard
          title="Conversación"
          description={
            selectedLead ? `Lead: ${selectedLead.full_name ?? selectedLead.id}` : "Seleccioná un lead"
          }
        >
          {!leadId ? (
            <div className="text-sm text-white/60">Elegí un lead de la izquierda.</div>
          ) : loadingThread ? (
            <div className="text-sm text-white/60">Cargando mensajes…</div>
          ) : (
            <div className="relative overflow-hidden">
              <div className="max-h-[520px] overflow-y-auto pr-1">
                {thread.length === 0 ? (
                  <div className="text-sm text-white/60">
                    No hay mensajes visibles.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {thread.map((m) => {
                      const isUser = (m.actor ?? m.role) === "user";
                      return (
                        <div
                          key={messageKey(m)}
                          className={[
                            "max-w-[78%] rounded-2xl px-4 py-3 text-sm break-words whitespace-pre-wrap",
                            isUser ? "ml-auto bg-white/10 text-white" : "mr-auto bg-[#0894C1] text-white",
                          ].join(" ")}
                        >
                          <div>{m.content}</div>
                          <div className="mt-1 text-[11px] opacity-60">
                            {new Date(m.created_at).toLocaleString()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex flex-wrap gap-2">
                  {quickReplies.map((reply) => (
                    <button
                      key={reply.label}
                      type="button"
                      onClick={() => setComposer(reply.text)}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/70 hover:bg-white/10"
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
                    className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#3CBDB9] focus:ring-4 focus:ring-[#3CBDB9]/20"
                  />
                  <button
                    onClick={sendReply}
                    disabled={!selectedLead || sending || !composer.trim()}
                    className={[
                      "shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold",
                      sending || !composer.trim()
                        ? "bg-white/10 text-white/40"
                        : "bg-[#3CBDB9] text-white hover:bg-[#35a9a5]",
                    ].join(" ")}
                  >
                    {sending ? "Enviando…" : "Responder"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
