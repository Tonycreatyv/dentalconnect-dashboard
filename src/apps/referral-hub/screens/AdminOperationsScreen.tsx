import { AlertTriangle, ArrowRight, Clock3, UserRoundCheck, UserRoundX, Workflow } from "lucide-react";
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
import { legalOpportunityPresentation, matchesOpportunityServiceFilter, type OpportunityServiceFilter } from "../operations/legalOpportunities";
import { useLegalOpportunities } from "../operations/useImmigrationInbox";
import EmptyState from "../ui/EmptyState";
import FilterTabs from "../ui/FilterTabs";
import PageHeader from "../ui/PageHeader";
import { SkeletonRows } from "../ui/Skeleton";
import StatusBadge, { type StatusTone } from "../ui/StatusBadge";

const QUEUE_TABS: Array<{ id: AdminOperationalQueueId; label: string }> = [
  { id: "today", label: "Hoy" },
  { id: "unassigned", label: "Sin responsable" },
  { id: "exceptions", label: "Excepciones" },
  { id: "active", label: "Todos activos" },
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

export default function AdminOperationsScreen() {
  const opportunities = useLegalOpportunities();
  const [queue, setQueue] = useState<AdminOperationalQueueId>("today");
  const [serviceFilter, setServiceFilter] = useState<OpportunityServiceFilter>("all");

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

  if (opportunities.loading) return <div className="hub-page hub-page--wide"><SkeletonRows count={6} /></div>;
  if (opportunities.error) return <div className="hub-page hub-page--wide"><EmptyState tone="error" icon={AlertTriangle} title="No se pudo cargar Operación" description={opportunities.error} /></div>;

  return (
    <div className="hub-page hub-page--wide">
      <PageHeader
        eyebrow="Operación"
        title="Operación"
        subtitle="Lo que necesita acción, responsable o seguimiento."
        meta={<span className="hub-page-count">{visible.length} {visible.length === 1 ? "caso" : "casos"}</span>}
        actions={<button type="button" className="hub-secondary" onClick={() => void opportunities.load()}>Actualizar</button>}
      />

      <div className="hub-stat-grid">
        <button type="button" className="hub-stat-card" onClick={() => setQueue("today")} aria-pressed={queue === "today"}>
          <Clock3 size={18} /><span>Hoy</span><strong>{counts.today}</strong>
        </button>
        <button type="button" className="hub-stat-card" onClick={() => setQueue("unassigned")} aria-pressed={queue === "unassigned"}>
          <UserRoundX size={18} /><span>Sin responsable</span><strong>{counts.unassigned}</strong>
        </button>
        <button type="button" className="hub-stat-card" onClick={() => setQueue("exceptions")} aria-pressed={queue === "exceptions"}>
          <AlertTriangle size={18} /><span>Excepciones</span><strong>{counts.exceptions}</strong>
        </button>
        <button type="button" className="hub-stat-card" onClick={() => setQueue("active")} aria-pressed={queue === "active"}>
          <Workflow size={18} /><span>Todos activos</span><strong>{counts.active}</strong>
        </button>
      </div>

      <div className="hub-filter-group">
        <span className="hub-filter-group-label">Cola</span>
        <FilterTabs
          tabs={QUEUE_TABS.map((tab) => ({ ...tab, count: counts[tab.id] }))}
          activeId={queue}
          onChange={(id) => setQueue(id as AdminOperationalQueueId)}
        />
      </div>

      <div className="hub-filter-group">
        <span className="hub-filter-group-label">Servicio</span>
        <FilterTabs tabs={SERVICE_TABS} activeId={serviceFilter} onChange={(id) => setServiceFilter(id as OpportunityServiceFilter)} />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={UserRoundCheck}
          title={queue === "today" ? "Nada urgente por ahora" : "Sin casos en esta cola"}
          description={queue === "today" ? "Los nuevos casos, seguimientos de hoy y casos sin responsable aparecerán aquí." : undefined}
        />
      ) : (
        <div className="hub-list">
          {visible.map((item) => {
            const presentation = legalOpportunityPresentation(item.serviceId, item.intake, item.topic);
            const nextFollowupAt = item.assignment?.nextFollowupAt ?? null;
            return (
              <Link key={item.id} className="hub-list-row" to={`/operacion/${item.id}`}>
                <div className="hub-list-row-main">
                  <div className="hub-list-row-title">
                    <strong>{item.leadName}</strong>
                    <StatusBadge tone={operationalTone(item.operationalStatus)} label={item.operationalStatus} />
                  </div>
                  <small>{presentation.serviceLabel || item.serviceId}{item.postalCode ? ` · ZIP ${item.postalCode}` : ""}</small>
                  <small>{item.assignment?.partnerName || "Sin responsable"} · recibido {relativeAge(item.createdAt)}</small>
                  <small>Última actividad: {relativeAge(item.lastActivityAt)}</small>
                  <small><strong>Próximo paso:</strong> {item.recommendedAction}{nextFollowupAt ? ` · ${formatDateTime(nextFollowupAt)}` : ""}</small>
                </div>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
