import { AlertTriangle, RefreshCw, Users } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PASTOR_PARTNER_ID, SERVICE_IDS, SERVICE_LABELS, SOURCE_ORGANIZATION } from "../operations/pastorOperations";
import { usePastorOperations, useServiceRequestsList } from "../operations/useServiceRouting";
import { PERIOD_TABS, type PeriodId } from "../operations/period";
import Avatar from "../ui/Avatar";
import DropdownFilter from "../ui/DropdownFilter";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { SkeletonRows } from "../ui/Skeleton";
import StatusBadge, { type StatusTone } from "../ui/StatusBadge";

const STATUS_TONE: Record<string, StatusTone> = { Nuevo: "neutral", Seguimiento: "warning", Aprobado: "success", "No calificó": "danger" };

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AdminServicesScreen() {
  const [params, setParams] = useSearchParams();
  const period = (params.get("period") as PeriodId) || "month";
  const servicio = params.get("servicio") || "";
  const partner = params.get("partner") || "";
  const estado = params.get("estado") || "";
  const setParam = (key: string, value: string) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; });
  const { rows, loading, error, load } = useServiceRequestsList(period);

  const partnerOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) if (row.partnerName) seen.add(row.partnerName);
    return [...seen].sort().map((name) => ({ value: name, label: name }));
  }, [rows]);

  const filtered = useMemo(() => rows.filter((row) => {
    if (servicio && row.servicioId !== servicio) return false;
    if (partner && row.partnerName !== partner) return false;
    if (estado && row.statusLabel !== estado) return false;
    return true;
  }), [rows, servicio, partner, estado]);

  return (
    <div className="hub-page">
      <PageHeader
        eyebrow="Operación"
        title="Servicios"
        subtitle="Consultas profesionales enviadas y su estado de atención."
        meta={<span className="hub-page-count">{filtered.length} {filtered.length === 1 ? "solicitud" : "solicitudes"}</span>}
        actions={<button type="button" className="hub-secondary" onClick={() => void load()}><RefreshCw size={16} />Actualizar</button>}
      />
      <div className="hub-filter-row">
        <DropdownFilter label="Servicio" value={servicio} onChange={(value) => setParam("servicio", value)} options={SERVICE_IDS.map((id) => ({ value: id, label: SERVICE_LABELS[id] }))} />
        <DropdownFilter label="Partner" value={partner} onChange={(value) => setParam("partner", value)} options={partnerOptions} />
        <DropdownFilter label="Estado" value={estado} onChange={(value) => setParam("estado", value)} options={["Nuevo", "Seguimiento", "Aprobado", "No calificó"].map((s) => ({ value: s, label: s }))} />
        <DropdownFilter label="Período" value={period} onChange={(value) => setParam("period", value)} options={PERIOD_TABS.filter((tab) => tab.id !== "custom").map((tab) => ({ value: tab.id, label: tab.label }))} />
      </div>
      {loading ? (
        <SkeletonRows count={5} />
      ) : error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los servicios" description={error} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="Sin solicitudes" description="No hay consultas que coincidan con estos filtros." />
      ) : (
        <div className="hub-list">
          {filtered.map((row) => (
            <Link key={row.id} className="hub-list-row" to={`/clientes/${row.clienteId}`}>
              <Avatar name={row.clienteName} seed={row.clienteId} />
              <div>
                <strong>{row.clienteName}</strong>
                <small>{row.servicioLabel} · {row.partnerName ?? "Sin partner activo"} · Recibido {formatDateTime(row.receivedAt)}</small>
              </div>
              <StatusBadge tone={STATUS_TONE[row.statusLabel]} label={row.statusLabel} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminPartnersScreen() {
  const { partners, routes, memberships, loading, error, load } = usePastorOperations();
  const pastor = partners.find((partner) => partner.id === PASTOR_PARTNER_ID);
  const pastorRoutes = routes.filter((route) => route.partner_id === PASTOR_PARTNER_ID && route.active);
  const pastorMembers = memberships.filter((member) => member.partner_id === PASTOR_PARTNER_ID);
  const routedServiceLabel = pastorRoutes.map((route) => SERVICE_LABELS[route.service_id]).filter(Boolean).join(", ") || "Sin servicios activos";
  return (
    <div className="hub-page">
      <PageHeader eyebrow="Red de partners" title="Partners" subtitle="Partners que reciben consultas y las personas autorizadas para trabajarlas." actions={<button type="button" className="hub-secondary" onClick={() => void load()}><RefreshCw size={16} />Actualizar</button>} />
      {loading ? (
        <SkeletonRows count={2} />
      ) : error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los partners" description={error} />
      ) : !pastor ? (
        <EmptyState icon={Users} title="Clínica Pastor no está disponible" description="No hay un partner activo configurado para recibir consultas." />
      ) : (
        <section className="hub-section hub-partner-detail">
          <div className="hub-section-head"><h2>{pastor.name}</h2><StatusBadge tone="success" label="Activo" /></div>
          <dl className="hub-facts">
            <div><dt>Servicio</dt><dd>{routedServiceLabel}</dd></div>
            <div><dt>Fuente</dt><dd>{SOURCE_ORGANIZATION}</dd></div>
            <div><dt>Routing</dt><dd>{pastorRoutes.some((route) => route.service_id === "luis_accidente") ? `${SOURCE_ORGANIZATION} → Accidente de auto → ${pastor.name}` : "Sin ruta activa"}</dd></div>
          </dl>
          <div className="hub-partner-users">
            <div className="hub-section-head"><h3>Usuarios</h3><span className="hub-page-count">{pastorMembers.length} activo{pastorMembers.length === 1 ? "" : "s"}</span></div>
            {pastorMembers.length === 0 ? (
              <p className="hub-field-hint">Todavía no hay usuarios activos para este partner.</p>
            ) : (
              <div className="hub-list">
                {pastorMembers.map((member, index) => {
                  const isJose = member.user_id === "119ef68a-2b79-43e5-916a-f08897b53889";
                  return (
                    <div key={`${member.partner_id}-${member.user_id}-${index}`} className="hub-list-row">
                      <div>
                        <strong>{isJose ? "joseduran1791@gmail.com" : "Usuario autorizado"}</strong>
                        <small>{isJose ? "Acceso temporal interno/demo" : "Usuario del partner"} · {member.role === "partner_admin" ? "Administrador del partner" : "Agente del partner"}</small>
                      </div>
                      <StatusBadge tone="success" label="Activo" />
                    </div>
                  );
                })}
              </div>
            )}
            <p className="hub-field-hint">Próximo paso al incorporar al partner: Usuarios → Invitar usuario → asignar rol → activar acceso.</p>
          </div>
        </section>
      )}
    </div>
  );
}
