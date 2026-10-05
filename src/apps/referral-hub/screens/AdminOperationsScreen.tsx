import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronRight,
  Edit3,
  MessageCircle,
  MoreHorizontal,
  StickyNote,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { relativeAge } from "../../../referral/status";
import { useSilentPolling } from "../../../hooks/useSilentPolling";
import {
  adminOperationalQueueCounts,
  filterAdminOperationalQueue,
  sortAdminOperationalQueue,
  type AdminOperationalQueueId,
} from "../operations/adminOperationalQueue";
import { updateAdminCase } from "../operations/adminCaseActions";
import { legalOpportunityPresentation, matchesOpportunityServiceFilter, type OpportunityServiceFilter } from "../operations/legalOpportunities";
import { useLegalOpportunities, type OperationalOpportunity } from "../operations/useImmigrationInbox";
import EmptyState from "../ui/EmptyState";
import FilterTabs from "../ui/FilterTabs";
import PageHeader from "../ui/PageHeader";
import { SkeletonRows } from "../ui/Skeleton";
import StatusBadge, { type StatusTone } from "../ui/StatusBadge";
import "./adminOperationsOperator.css";

const QUEUE_TABS: Array<{ id: AdminOperationalQueueId; label: string }> = [
  { id: "today", label: "Atender" },
  { id: "unassigned", label: "Sin responsable" },
  { id: "exceptions", label: "Excepciones" },
  { id: "active", label: "Todos" },
];

const SERVICE_TABS: Array<{ id: OpportunityServiceFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "immigration", label: "Inmigración" },
  { id: "auto_accident", label: "Accidentes" },
  { id: "dui", label: "DUI" },
  { id: "criminal", label: "Criminal" },
  { id: "furniture", label: "Muebles" },
  { id: "representative", label: "Equipo" },
];

function operationalTone(status: string): StatusTone {
  if (status.includes("Sin aliado") || status.includes("Rechazada") || status.includes("espera")) return "danger";
  if (status.includes("Contactado") || status.includes("Cita")) return "success";
  return "warning";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function digits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function isFinal(item: OperationalOpportunity): boolean {
  return ["converted", "not_converted", "closed"].includes(item.assignment?.workStatus ?? "") || item.status === "closed";
}

function urgency(item: OperationalOpportunity): { level: "critical" | "warning" | "normal"; label: string } {
  const followup = item.assignment?.nextFollowupAt ? new Date(item.assignment.nextFollowupAt).getTime() : null;
  if (!item.assignment && item.consentStatus === "authorized") return { level: "critical", label: "Sin responsable" };
  if (["rejected", "expired"].includes(item.assignment?.status ?? "")) return { level: "critical", label: "Reasignación requerida" };
  if (followup && followup < Date.now() && !isFinal(item)) return { level: "critical", label: "Seguimiento vencido" };
  if (["assigned", "pending_assignment"].includes(item.assignment?.status ?? "") && item.assignment?.workStatus !== "contacted") {
    return { level: "warning", label: "Nuevo · falta contacto" };
  }
  if (item.operationalStatus.includes("espera")) return { level: "warning", label: "Requiere revisión" };
  return { level: "normal", label: item.recommendedAction || "En seguimiento" };
}

export default function AdminOperationsScreen() {
  const opportunities = useLegalOpportunities();
  const [queue, setQueue] = useState<AdminOperationalQueueId>("today");
  const [serviceFilter, setServiceFilter] = useState<OpportunityServiceFilter>("all");
  const [sheetItem, setSheetItem] = useState<OperationalOpportunity | null>(null);
  const [followupLocal, setFollowupLocal] = useState("");
  const [noteText, setNoteText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  useSilentPolling(() => opportunities.load({ silent: true }), 2500);

  const serviceScoped = useMemo(
    () => opportunities.requests.filter((item) => matchesOpportunityServiceFilter(item.serviceId, item.intake, serviceFilter)),
    [opportunities.requests, serviceFilter],
  );
  const counts = useMemo(() => adminOperationalQueueCounts(serviceScoped), [serviceScoped]);
  const visible = useMemo(
    () => sortAdminOperationalQueue(filterAdminOperationalQueue(serviceScoped, queue)),
    [serviceScoped, queue],
  );
  const attention = useMemo(() => serviceScoped.filter((item) => !isFinal(item) && urgency(item).level !== "normal"), [serviceScoped]);
  const overdueCount = useMemo(() => serviceScoped.filter((item) => {
    const value = item.assignment?.nextFollowupAt;
    return Boolean(value && new Date(value).getTime() < Date.now() && !isFinal(item));
  }).length, [serviceScoped]);

  async function runAction(item: OperationalOpportunity, action: Parameters<typeof updateAdminCase>[0]["action"], success: string, extra?: Partial<Parameters<typeof updateAdminCase>[0]>) {
    if (busyId) return;
    setBusyId(item.id);
    setActionError("");
    setNotice("");
    const result = await updateAdminCase({ requestId: item.id, action, ...extra });
    setBusyId(null);
    if (result.error) {
      setActionError(result.error.message || "No se pudo guardar el cambio.");
      return;
    }
    setNotice(success);
    await opportunities.load({ silent: true });
  }

  function openSheet(item: OperationalOpportunity) {
    setSheetItem(item);
    setFollowupLocal("");
    setNoteText("");
    setActionError("");
    setNotice("");
  }

  async function saveFollowup() {
    if (!sheetItem || !followupLocal) return;
    const parsed = new Date(followupLocal);
    if (Number.isNaN(parsed.getTime())) {
      setActionError("Selecciona una fecha y hora válida.");
      return;
    }
    await runAction(sheetItem, "follow_up", "Seguimiento guardado.", {
      followUpReason: "other",
      nextFollowupAt: parsed.toISOString(),
    });
  }

  async function saveNote() {
    if (!sheetItem || !noteText.trim()) return;
    await runAction(sheetItem, "note", "Nota agregada.", { note: noteText.trim() });
    setNoteText("");
  }

  async function closeCase(action: "converted" | "closed_not_converted") {
    if (!sheetItem) return;
    const label = action === "converted" ? "convertido" : "sin conversión";
    if (!window.confirm(`¿Cerrar este caso como ${label}?`)) return;
    await runAction(sheetItem, action, action === "converted" ? "Caso cerrado como convertido." : "Caso cerrado sin conversión.");
  }

  if (opportunities.loading) return <div className="hub-page hub-page--wide"><SkeletonRows count={6} /></div>;
  if (opportunities.error) return <div className="hub-page hub-page--wide"><EmptyState tone="error" icon={AlertTriangle} title="No se pudo cargar Operación" description={opportunities.error} /></div>;

  return (
    <div className="hub-page hub-page--wide hub-operator-page">
      <PageHeader
        eyebrow="Operación"
        title="Qué requiere tu atención"
        subtitle="Prioridad primero. Resuelve lo común sin salir de esta pantalla."
        meta={<span className="hub-page-count">{attention.length} requieren atención</span>}
        actions={<button type="button" className="hub-secondary" onClick={() => void opportunities.load()}>Actualizar</button>}
      />

      <section className="hub-operator-summary" aria-label="Resumen operativo">
        <div><strong>{attention.length}</strong><span>requieren atención</span></div>
        <div><strong>{overdueCount}</strong><span>seguimientos vencidos</span></div>
        <div><strong>{counts.unassigned}</strong><span>sin responsable</span></div>
        <div><strong>{counts.exceptions}</strong><span>excepciones</span></div>
      </section>

      <div className="hub-operator-filterbar">
        <FilterTabs
          tabs={QUEUE_TABS.map((tab) => ({ ...tab, count: counts[tab.id] }))}
          activeId={queue}
          onChange={(id) => setQueue(id as AdminOperationalQueueId)}
        />
        <div className="hub-operator-service-filter">
          <FilterTabs tabs={SERVICE_TABS} activeId={serviceFilter} onChange={(id) => setServiceFilter(id as OpportunityServiceFilter)} />
        </div>
      </div>

      {notice ? <div className="hub-operator-toast is-success"><Check size={16} />{notice}</div> : null}
      {actionError ? <div className="hub-operator-toast is-error"><AlertTriangle size={16} />{actionError}</div> : null}

      {visible.length === 0 ? (
        <EmptyState
          icon={UserRoundCheck}
          title={queue === "today" ? "Nada urgente por ahora" : "Sin casos en esta cola"}
          description={queue === "today" ? "Los nuevos casos, seguimientos vencidos y casos sin responsable aparecerán aquí." : undefined}
        />
      ) : (
        <div className="hub-operator-list">
          {visible.map((item) => {
            const presentation = legalOpportunityPresentation(item.serviceId, item.intake, item.topic);
            const nextFollowupAt = item.assignment?.nextFollowupAt ?? null;
            const priority = urgency(item);
            const canManage = Boolean(item.assignment && !isFinal(item));
            return (
              <article key={item.id} className={`hub-operator-card is-${priority.level}`}>
                <div className="hub-operator-card-head">
                  <div>
                    <div className={`hub-operator-priority is-${priority.level}`}>{priority.label}</div>
                    <Link className="hub-operator-name" to={`/operacion/${item.id}`}>{item.leadName}</Link>
                  </div>
                  <StatusBadge tone={operationalTone(item.operationalStatus)} label={item.operationalStatus} />
                </div>

                <div className="hub-operator-facts">
                  <span>{presentation.serviceLabel || item.serviceId}{item.postalCode ? ` · ZIP ${item.postalCode}` : ""}</span>
                  <span>{item.assignment?.partnerName || "Sin responsable"}</span>
                  <span>Recibido {relativeAge(item.createdAt)}</span>
                </div>

                <div className="hub-operator-next">
                  <strong>Próximo paso</strong>
                  <span>{item.recommendedAction}{nextFollowupAt ? ` · ${formatDateTime(nextFollowupAt)}` : ""}</span>
                </div>

                <div className="hub-operator-actions">
                  {canManage && item.assignment?.workStatus !== "contacted" ? (
                    <button type="button" className="hub-operator-primary" disabled={busyId === item.id} onClick={() => void runAction(item, "contacted", "Cliente marcado como contactado.")}>
                      <Check size={16} />Contactado
                    </button>
                  ) : null}
                  <Link className="hub-operator-action" to={`/operacion/${item.id}/editar`}><Edit3 size={16} />Editar</Link>
                  <button type="button" className="hub-operator-action" onClick={() => openSheet(item)}><MoreHorizontal size={18} />Acciones</button>
                  <Link className="hub-operator-open" to={`/operacion/${item.id}`} aria-label={`Abrir caso de ${item.leadName}`}><ChevronRight size={20} /></Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {sheetItem ? (
        <div className="hub-operator-overlay" role="presentation" onClick={() => setSheetItem(null)}>
          <section className="hub-operator-sheet" role="dialog" aria-modal="true" aria-label={`Acciones para ${sheetItem.leadName}`} onClick={(event) => event.stopPropagation()}>
            <div className="hub-operator-sheet-handle" />
            <header>
              <div>
                <small>Gestionar caso</small>
                <h2>{sheetItem.leadName}</h2>
                <p>{legalOpportunityPresentation(sheetItem.serviceId, sheetItem.intake, sheetItem.topic).serviceLabel || sheetItem.serviceId} · {sheetItem.assignment?.partnerName || "Sin responsable"}</p>
              </div>
              <button type="button" className="hub-operator-close" onClick={() => setSheetItem(null)} aria-label="Cerrar"><X size={20} /></button>
            </header>

            <div className="hub-operator-sheet-links">
              {digits(sheetItem.channelUserId) ? <a href={`https://wa.me/${digits(sheetItem.channelUserId)}`} target="_blank" rel="noreferrer"><MessageCircle size={17} />WhatsApp</a> : null}
              <Link to={`/operacion/${sheetItem.id}/editar`}><Edit3 size={17} />Editar caso</Link>
              <Link to={`/operacion/${sheetItem.id}`}>Responsable / detalle<ChevronRight size={17} /></Link>
            </div>

            {sheetItem.assignment && !isFinal(sheetItem) ? (
              <>
                <div className="hub-operator-sheet-section">
                  <label htmlFor="operator-followup"><CalendarClock size={17} />Próximo seguimiento</label>
                  <div className="hub-operator-inline-form">
                    <input id="operator-followup" type="datetime-local" value={followupLocal} onChange={(event) => setFollowupLocal(event.target.value)} />
                    <button type="button" disabled={!followupLocal || busyId === sheetItem.id} onClick={() => void saveFollowup()}>Guardar</button>
                  </div>
                </div>

                <div className="hub-operator-sheet-section">
                  <label htmlFor="operator-note"><StickyNote size={17} />Nota interna</label>
                  <textarea id="operator-note" rows={3} placeholder="Escribe una nota breve…" value={noteText} onChange={(event) => setNoteText(event.target.value)} />
                  <button type="button" className="hub-operator-sheet-save" disabled={!noteText.trim() || busyId === sheetItem.id} onClick={() => void saveNote()}>Agregar nota</button>
                </div>

                <div className="hub-operator-sheet-section">
                  <strong>Cerrar caso</strong>
                  <div className="hub-operator-close-grid">
                    <button type="button" disabled={busyId === sheetItem.id} onClick={() => void closeCase("converted")}>Convertido</button>
                    <button type="button" disabled={busyId === sheetItem.id} onClick={() => void closeCase("closed_not_converted")}>No convertido</button>
                  </div>
                </div>
              </>
            ) : (
              <div className="hub-operator-assignment-needed">
                <AlertTriangle size={18} />
                <div><strong>{isFinal(sheetItem) ? "Caso cerrado" : "Primero asigna un responsable"}</strong><p>{isFinal(sheetItem) ? "Puedes abrir el detalle para revisar el historial." : "Las acciones de gestión se habilitan cuando el caso tiene una asignación activa."}</p></div>
              </div>
            )}

            {notice ? <div className="hub-operator-toast is-success"><Check size={16} />{notice}</div> : null}
            {actionError ? <div className="hub-operator-toast is-error"><AlertTriangle size={16} />{actionError}</div> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
