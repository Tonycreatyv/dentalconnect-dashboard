import { AlertTriangle, ArrowLeft, FileCheck2, ImageOff, MessageCircle, Paperclip, Search, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Avatar from "../ui/Avatar";
import EmptyState from "../ui/EmptyState";
import { SkeletonRows } from "../ui/Skeleton";
import StatusBadge from "../ui/StatusBadge";
import { useReferralData } from "../../../referral/useReferralData";
import { useReferralOperations, type FlowResponseRecord, type OperationsMessage } from "../operations/useReferralOperations";
import { describeFlowSubmission, looksLikeUnpersistedCouponImage } from "../operations/flowSubmission";
import { leadName, leadPhone } from "../../../referral/status";
import type { ReferralLead } from "../../../referral/types";

type LeadWithStatus = ReferralLead & { handoff_to_human?: boolean; last_staff_seen_at?: string | null };

const FLOW_COMPLETED_SENTINEL = "__whatsapp_flow_completed__";

function lastMessage(rows: OperationsMessage[]) {
  return rows.length ? rows[rows.length - 1] : undefined;
}
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-US", { dateStyle: "short", timeStyle: "short" }).format(date);
}
function previewText(message: OperationsMessage) {
  if (message.content === FLOW_COMPLETED_SENTINEL) return "Formulario completado";
  if (looksLikeUnpersistedCouponImage(message.content)) return `🖼️ ${message.content}`;
  return message.content || "Mensaje interactivo";
}

export default function MessagesWorkspace() {
  const { conversationId } = useParams();
  const data = useReferralData();
  const ops = useReferralOperations();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  const conversations = useMemo(() => data.leads
    .map((lead) => { const rows = ops.byLead.get(lead.id) ?? []; return { lead: lead as LeadWithStatus, latest: lastMessage(rows) }; })
    .filter((item) => item.latest && `${leadName(item.lead)} ${item.latest?.content || ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => +new Date(b.latest!.created_at) - +new Date(a.latest!.created_at)),
    [data.leads, ops.byLead, query]);

  const selectedLead = conversationId ? (data.leads.find((lead) => lead.id === conversationId) as LeadWithStatus | undefined) : undefined;
  const rows = conversationId ? (ops.byLead.get(conversationId) ?? []) : [];
  const latest = lastMessage(rows);
  const loading = ops.loading || data.loading;
  const failure = ops.error || data.error;

  async function send() {
    if (!selectedLead || !draft.trim()) return;
    setSending(true);
    setNotice("");
    const result = await ops.sendMessage({
      leadId: selectedLead.id,
      channel: latest?.channel ?? selectedLead.last_channel ?? "messenger",
      channelUserId: latest?.channel_user_id ?? selectedLead.channel_user_id,
      content: draft,
    });
    setSending(false);
    if (result.ok) { setDraft(""); setNotice("Mensaje en cola de entrega."); }
    else setNotice(result.message ?? "No se pudo enviar.");
  }

  return (
    <div className="hub-messages">
      <aside className={conversationId ? "hub-messages-list is-hidden-mobile" : "hub-messages-list"}>
        <div className="hub-messages-list-header">
          <h1>Mensajes</h1>
          <label className="hub-search">
            <Search size={16} />
            <span className="sr-only">Buscar conversación</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar conversación…" />
          </label>
        </div>
        <div className="hub-messages-list-scroll">
          {loading ? (
            <SkeletonRows count={5} />
          ) : failure ? (
            <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar las conversaciones" description={failure} />
          ) : conversations.length === 0 ? (
            <EmptyState icon={MessageCircle} title="No hay conversaciones" />
          ) : (
            conversations.map(({ lead, latest: latestForRow }) => {
              const inboundLatest = Boolean(latestForRow && (latestForRow.actor === "user" || latestForRow.role === "user"));
              const unread = inboundLatest && (!lead.last_staff_seen_at || new Date(latestForRow!.created_at) > new Date(lead.last_staff_seen_at));
              return (
                <button
                  key={lead.id}
                  type="button"
                  className={lead.id === conversationId ? "hub-messages-list-row is-active" : "hub-messages-list-row"}
                  onClick={() => navigate(`/messages/${lead.id}`)}
                >
                  <Avatar name={leadName(lead)} seed={lead.id} size={34} />
                  <div><strong>{leadName(lead)}</strong><small>{latestForRow ? previewText(latestForRow) : "Mensaje interactivo"}</small></div>
                  {unread ? <span className="hub-unread-dot" aria-label="No leído" /> : <time>{latestForRow ? formatTime(latestForRow.created_at) : ""}</time>}
                </button>
              );
            })
          )}
        </div>
      </aside>
      <section className={conversationId ? "hub-messages-thread" : "hub-messages-thread is-hidden-mobile"}>
        {!conversationId ? (
          <div className="hub-messages-thread-empty"><MessageCircle size={20} /><p>Selecciona una conversación para ver los mensajes.</p></div>
        ) : loading ? (
          <div className="hub-messages-thread-empty">Cargando conversación…</div>
        ) : !selectedLead ? (
          <div className="hub-messages-thread-empty">Esta conversación no existe.</div>
        ) : (
          <>
            <header className="hub-messages-thread-header">
              <button type="button" className="hub-back-mobile" onClick={() => navigate("/messages")} aria-label="Volver a la lista"><ArrowLeft size={18} /></button>
              <Avatar name={leadName(selectedLead)} seed={selectedLead.id} size={34} />
              <div><strong>{leadName(selectedLead)}</strong><small>{leadPhone(selectedLead) || "Sin teléfono"}</small></div>
              <StatusBadge tone={selectedLead.handoff_to_human ? "warning" : "success"} label={selectedLead.handoff_to_human ? "Humano activo" : "Bot activo"} />
            </header>
            <div className="hub-messages-thread-scroll">
              {rows.length === 0 ? (
                <p style={{ color: "var(--hub-muted)", fontSize: ".82rem" }}>Todavía no hay mensajes.</p>
              ) : (
                rows.map((message) => {
                  const inbound = message.actor === "user" || message.role === "user";
                  const flowRecord: FlowResponseRecord | undefined = message.provider_message_id
                    ? ops.flowResponseByProviderMessageId.get(message.provider_message_id)
                    : undefined;

                  if (message.content === FLOW_COMPLETED_SENTINEL) {
                    const submission = flowRecord?.payload ? describeFlowSubmission(flowRecord.payload) : null;
                    return (
                      <article key={message.id} className="hub-flow-event">
                        <FileCheck2 size={15} />
                        <div>
                          <strong>{submission?.title ?? "Formulario completado"}</strong>
                          {submission ? (
                            <ul>
                              {submission.lines.map((line) => <li key={line}>{line}</li>)}
                            </ul>
                          ) : (
                            <p className="hub-flow-event-gap">
                              Detalle no disponible: no se encontró el envío original de reply_outbox para este mensaje.
                            </p>
                          )}
                          <time>{formatTime(message.created_at)}</time>
                        </div>
                      </article>
                    );
                  }

                  if (!inbound && looksLikeUnpersistedCouponImage(message.content)) {
                    return (
                      <article key={message.id} className="outbound hub-image-gap">
                        <ImageOff size={15} />
                        <div>
                          <strong>{message.content}</strong>
                          <p className="hub-flow-event-gap">
                            {message.provider_message_id
                              ? "Imagen aceptada por Meta (esta base de datos no guarda la URL de la imagen enviada, así que no se puede mostrar una vista previa real)."
                              : "No hay confirmación de envío a Meta para esta imagen."}
                          </p>
                          <time>{formatTime(message.created_at)}</time>
                        </div>
                      </article>
                    );
                  }

                  return (
                    <article key={message.id} className={inbound ? undefined : "outbound"}>
                      <p>{message.content || "Mensaje interactivo"}</p>
                      <time>{formatTime(message.created_at)}</time>
                    </article>
                  );
                })
              )}
            </div>
            <p className="hub-flow-event-gap hub-messages-gap-note">
              Los botones interactivos que se envían junto a algunos mensajes no se guardan en esta base de datos, así que no se pueden mostrar aquí para conversaciones pasadas.
            </p>
            {notice ? <p className="hub-messages-notice" role="status">{notice}</p> : null}
            <footer className="hub-messages-composer">
              <button type="button" className="hub-composer-icon-btn" disabled title="Adjuntar imagen — próximamente"><Paperclip size={17} /></button>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={1}
                placeholder="Escribe una respuesta manual…"
                aria-label="Mensaje"
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
              />
              <button type="button" className="hub-composer-send" disabled={sending || !draft.trim()} onClick={() => void send()} aria-label="Enviar"><Send size={17} /></button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
