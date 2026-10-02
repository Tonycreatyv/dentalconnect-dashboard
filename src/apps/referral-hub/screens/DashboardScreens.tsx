import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, MapPin, MessageCircle, Search, Tag, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import Avatar from "../ui/Avatar";
import PageHeader from "../ui/PageHeader";
import FilterTabs from "../ui/FilterTabs";
import SegmentedControl from "../ui/SegmentedControl";
import EmptyState from "../ui/EmptyState";
import { SkeletonRows } from "../ui/Skeleton";
import StatCard from "../ui/StatCard";
import StatusBadge, { type StatusTone } from "../ui/StatusBadge";
import TrendChart from "../ui/TrendChart";
import { PERIOD_LABELS, PERIOD_TABS, type PeriodId } from "../operations/period";
import { CAMPAIGN_KEY_BY_SERVICE, SERVICE_BY_CAMPAIGN_KEY } from "../operations/luisCatalog";
import { filterCouponClaims, SIN_LOCALIDAD_KEY, useCouponDemand } from "../operations/useCouponDemand";
import { useServiceFollowUps } from "../operations/useServiceFollowUps";
import { useHomeClientCount } from "../operations/useHomeClientCount";
import { useQrCampaigns } from "../operations/useQrCampaigns";
import { LEAD_STAGE_LABELS, useLeadsPipeline, type LeadStage } from "../operations/useLeadsPipeline";
import { useClientes } from "../operations/useClientes";
import { legalTopicLabel, useContactDetail } from "../operations/useContactDetail";
import { relativeAge } from "../../../referral/status";
import { immigrationTopicLabel } from "../operations/immigrationInbox";
import { useImmigrationInbox, useLegalOpportunities } from "../operations/useImmigrationInbox";
import { legalOpportunityPresentation, matchesOpportunityServiceFilter, type OpportunityServiceFilter } from "../operations/legalOpportunities";
import { useSilentPolling } from "../../../hooks/useSilentPolling";

function firstNameGreeting(user: { user_metadata?: Record<string, unknown> } | null): string {
  const meta = user?.user_metadata ?? {};
  const raw = (meta.full_name as string | undefined) || (meta.name as string | undefined) || "";
  const first = raw.trim().split(/\s+/)[0];
  return first ? `Hola, ${first}` : "Hola";
}

const CLAIM_STATUS_LABEL: Record<string, string> = { REQUESTED: "Solicitado", ISSUED: "Enviado", REDEEMED: "Usado" };
const CLAIM_STATUS_TONE: Record<string, StatusTone> = { REQUESTED: "warning", ISSUED: "neutral", REDEEMED: "success" };
const STAGE_TONE: Record<LeadStage, StatusTone> = { nuevo: "neutral", por_contactar: "danger", contactado: "warning", respondio: "neutral", confirmado: "success", cerrado: "success" };

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(date);
}
function formatDateTime(value: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function immigrationOperationalTone(operationalStatus: string): StatusTone {
  if (operationalStatus.includes("Contactado") || operationalStatus.includes("Cita") || operationalStatus.includes("Convertido")) return "success";
  if (operationalStatus.includes("Sin aliado") || operationalStatus.includes("Rechazada")) return "danger";
  return "warning";
}

export function InicioScreen() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodId>("today");
  const demand = useCouponDemand(period);
  const homeClients = useHomeClientCount(period);
  const followUps = useServiceFollowUps();
  const qr = useQrCampaigns();
  const claims = useMemo(() => demand.filterClaims(demand.rawClaims, "", ""), [demand]);
  const totalRequests = claims.length;
  const ranking = useMemo(() => demand.locationRanking(claims), [claims, demand]);
  const topLocation = ranking.find((row) => row.key !== SIN_LOCALIDAD_KEY) ?? null;
  const trendPoints = useMemo(() => demand.trend(claims), [claims, demand]);
  const serviceRanking = useMemo(() => {
    const groups = new Map<string, { label: string; requests: number; serviceId: string }>();
    for (const claim of claims) {
      const key = claim.campaign_label;
      const entry = groups.get(key) ?? { label: key, requests: 0, serviceId: SERVICE_BY_CAMPAIGN_KEY[claim.campaign_key] ?? "" };
      entry.requests += 1;
      groups.set(key, entry);
    }
    return Array.from(groups.values()).sort((a, b) => b.requests - a.requests);
  }, [claims]);
  const recentActivity = useMemo(() => {
    const fromClaims = claims.slice(0, 8).map((claim) => ({
      id: `claim-${claim.id}`,
      text: <><strong>{claim.lead_name}</strong> solicitó {claim.campaign_label}</>,
      leadId: claim.lead_id,
      at: claim.requested_at,
    }));
    const fromFollowUps = followUps.requests.slice(0, 8).map((item) => ({
      id: `followup-${item.id}`,
      text: <><strong>{item.lead_name}</strong> solicitó {item.service_label}</>,
      leadId: item.lead_id,
      at: item.assigned_at,
    }));
    return [...fromClaims, ...fromFollowUps].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 5);
  }, [claims, followUps.requests]);
  const topCampaigns = useMemo(() => qr.campaigns.filter((c) => c.active).sort((a, b) => b.requestsCount - a.requestsCount).slice(0, 6), [qr.campaigns]);
  const loading = demand.loading || homeClients.loading || followUps.loading;
  const failure = demand.error || homeClients.error || followUps.error;

  return (
    <div className="hub-page">
      <div className="hub-inicio-head">
        <h1>{firstNameGreeting(user)}</h1>
        <SegmentedControl segments={PERIOD_TABS.filter((tab) => tab.id !== "custom")} activeId={period} onChange={(id) => setPeriod(id as PeriodId)} />
      </div>
      {loading ? (
        <SkeletonRows count={4} />
      ) : failure ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los datos" description={failure} />
      ) : (
        <>
          <div className="hub-stat-grid">
            <StatCard label="Cupones pedidos" value={totalRequests} to={`/negocios/solicitudes?period=${period}`} />
            <StatCard label="Clientes" value={homeClients.count} to="/clientes" />
            <StatCard label="Por contactar" value={followUps.requests.length} to="/clientes?stage=por_contactar" />
            <StatCard label="Localidad principal" value={topLocation?.label ?? "Sin datos"} sub={topLocation ? `${topLocation.requests} ${topLocation.requests === 1 ? "pedido" : "pedidos"}` : "Sin pedidos en este período"} to={topLocation ? `/negocios/solicitudes?period=${period}&location=${topLocation.key}` : "/negocios"} />
          </div>
          <TrendChart points={trendPoints} />
          {serviceRanking.length > 0 ? (
            <section className="hub-section">
              <div className="hub-section-head"><h2>Solicitudes por servicio</h2></div>
              <div className="hub-ranking">
                {serviceRanking.slice(0, 5).map((row) => (
                  <Link key={row.label} className="hub-ranking-row" to={`/negocios/solicitudes?period=${period}${row.serviceId ? `&service=${row.serviceId}` : ""}`}>
                    <div><strong>{row.label}</strong></div>
                    <span className="hub-ranking-count">{row.requests} {row.requests === 1 ? "solicitud" : "solicitudes"}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          <section className="hub-section">
            <div className="hub-section-head"><h2>Por contactar</h2><Link className="hub-section-link" to="/clientes?stage=por_contactar">Ver todos</Link></div>
            {followUps.requests.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Sin pendientes" description="No hay casos de inmigración o accidente esperando contacto." />
            ) : (
              <div className="hub-list">
                {followUps.requests.slice(0, 5).map((item) => (
                  <Link key={item.id} className="hub-list-row" to={`/clientes/${item.lead_id}`}>
                    <Avatar name={item.lead_name} seed={item.lead_id} />
                    <div><strong>{item.lead_name}</strong><small>{item.service_label} · {relativeAge(item.assigned_at)}</small></div>
                  </Link>
                ))}
              </div>
            )}
          </section>
          <section className="hub-section">
            <div className="hub-section-head"><h2>Cupones por localidad</h2><Link className="hub-section-link" to="/negocios">Ver todos</Link></div>
            {ranking.length === 0 ? (
              <EmptyState icon={MapPin} title="Sin pedidos todavía" description="Los pedidos de cupones aparecerán aquí por localidad." />
            ) : (
              <div className="hub-ranking">
                {ranking.slice(0, 5).map((row, index) => (
                  <Link key={row.key} className="hub-ranking-row" to={`/negocios/solicitudes?period=${period}&location=${row.key}`}>
                    <span className="hub-ranking-rank">{row.key === SIN_LOCALIDAD_KEY ? "—" : index + 1}</span>
                    <div><strong>{row.label}</strong><small>{row.requests} {row.requests === 1 ? "pedido" : "pedidos"} · {row.clients} {row.clients === 1 ? "cliente" : "clientes"}</small></div>
                  </Link>
                ))}
              </div>
            )}
          </section>
          {recentActivity.length > 0 ? (
            <section className="hub-section">
              <div className="hub-section-head"><h2>Actividad reciente</h2></div>
              <div className="hub-list">
                {recentActivity.map((item) => (
                  <Link key={item.id} className="hub-list-row" to={`/clientes/${item.leadId}`}>
                    <span className="hub-activity-dot" aria-hidden="true" />
                    <div><small className="hub-activity-text">{item.text}</small><small>{relativeAge(item.at)}</small></div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          {topCampaigns.length > 0 ? (
            <section className="hub-section">
              <div className="hub-section-head"><h2>Tus campañas</h2><Link className="hub-section-link" to="/campanas">Ver todas</Link></div>
              <div className="hub-carousel">
                {topCampaigns.map((campaign) => (
                  <Link key={campaign.id} className="hub-carousel-card" to={`/campanas/campana/${campaign.id}`}>
                    <div className="hub-carousel-card-head">
                      <span className="hub-carousel-card-icon"><Tag size={18} /></span>
                      <div><strong>{campaign.businessLabel || "Campaña"}</strong><small>Activa</small></div>
                    </div>
                    <div className="hub-carousel-card-foot">
                      <div><span className="hub-carousel-card-value">{campaign.requestsCount}</span><small>SOLICITUDES</small></div>
                      <span className="hub-carousel-card-arrow"><ArrowRight size={16} /></span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

const REQUEST_STATUS_LABEL: Record<string, string> = { REQUESTED: "Solicitado", ISSUED: "Enviado", REDEEMED: "Usado" };
const REQUEST_STATUS_TONE: Record<string, StatusTone> = { REQUESTED: "warning", ISSUED: "success", REDEEMED: "neutral" };

// Real drill-down for Inicio's "Cupones pedidos" card and Negocios/Servicios
// rows — never routes to the unrelated generic Campañas screen. Every row
// here comes from the same useCouponDemand claims the Inicio metrics are
// computed from, so the count and the list can never disagree.
export function CouponRequestsScreen() {
  const [params] = useSearchParams();
  const periodParam = (params.get("period") as PeriodId) || "today";
  const serviceFilter = params.get("service") || "";
  const locationFilter = params.get("location") || "";
  const demand = useCouponDemand(periodParam);
  // Resolve the service filter to the exact campaign_key it maps to (the
  // same canonical mapping realDataSource.ts uses to compute the business
  // card's count) rather than a substring match on campaign_key — a
  // substring match is exactly the "ambiguous slug" matching that could
  // silently drift from the card's real grouping as campaign keys grow.
  const campaignKeyFilter = serviceFilter ? CAMPAIGN_KEY_BY_SERVICE[serviceFilter as keyof typeof CAMPAIGN_KEY_BY_SERVICE] ?? "" : "";
  const claims = useMemo(
    () => filterCouponClaims(demand.rawClaims, locationFilter, campaignKeyFilter),
    [demand.rawClaims, locationFilter, campaignKeyFilter],
  );
  return (
    <div className="hub-page">
      <Link className="hub-back" to="/"><ArrowLeft />Volver</Link>
      <PageHeader
        eyebrow="Negocios"
        title="Cupones pedidos"
        subtitle={PERIOD_LABELS[periodParam]}
        meta={<span className="hub-page-count">{claims.length} {claims.length === 1 ? "pedido" : "pedidos"}</span>}
      />
      {demand.loading ? (
        <SkeletonRows count={5} />
      ) : demand.error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los pedidos" description={demand.error} />
      ) : claims.length === 0 ? (
        <EmptyState icon={Tag} title="Sin pedidos en este período" />
      ) : (
        <div className="hub-list">
          {claims.map((claim) => (
            <Link key={claim.id} className="hub-list-row" to={`/clientes/${claim.lead_id}`} state={{ from: `/negocios/solicitudes?${params.toString()}` }}>
              <Avatar name={claim.lead_name} seed={claim.lead_id} />
              <div>
                <strong>{claim.lead_name}</strong>
                <small>
                  {claim.campaign_label} · ZIP {claim.postal_code}
                  {claim.location_label ? ` · ${claim.location_label}` : claim.location_key === SIN_LOCALIDAD_KEY ? " · Ubicación pendiente" : ""}
                  {" · "}{formatDateTime(claim.requested_at)}
                </small>
              </div>
              <StatusBadge
                tone={claim.location_key === SIN_LOCALIDAD_KEY ? "danger" : (REQUEST_STATUS_TONE[claim.status] ?? "neutral")}
                label={claim.location_key === SIN_LOCALIDAD_KEY ? "Ubicación pendiente" : (REQUEST_STATUS_LABEL[claim.status] ?? claim.status)}
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClientesScreen() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const activeStage = params.get("stage") || "";
  const serviceFilter = params.get("service") || "";
  const campaignFilter = params.get("campaign") || "";
  const { clientes, loading, error, counts } = useClientes();
  const [query, setQuery] = useState("");
  const stages: LeadStage[] = ["nuevo", "por_contactar", "contactado", "respondio", "confirmado", "cerrado"];
  const filtered = useMemo(() => clientes.filter((cliente) => {
    if (activeStage && cliente.stage !== activeStage) return false;
    if (serviceFilter && cliente.serviceId !== serviceFilter) return false;
    if (campaignFilter && cliente.campaignKey !== campaignFilter) return false;
    if (query && !cliente.full_name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [clientes, activeStage, serviceFilter, campaignFilter, query]);
  const hasScopeFilter = Boolean(serviceFilter || campaignFilter);

  return (
    <div className="hub-page">
      <PageHeader eyebrow="Clientes" title="Clientes" meta={<span className="hub-page-count">{filtered.length} {filtered.length === 1 ? "cliente" : "clientes"}</span>} />
      <label className="hub-search"><Search /><span className="sr-only">Buscar cliente</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre…" /></label>
      <FilterTabs
        tabs={[{ id: "", label: "Todos", count: clientes.length }, ...stages.map((stage) => ({ id: stage, label: LEAD_STAGE_LABELS[stage], count: counts[stage] }))]}
        activeId={activeStage}
        onChange={(id) => setParams((current) => { const next = new URLSearchParams(current); if (id) next.set("stage", id); else next.delete("stage"); return next; })}
      />
      {hasScopeFilter ? (
        <div className="hub-scope-banner">
          <span>Filtrado por servicio o campaña — {filtered.length} {filtered.length === 1 ? "cliente" : "clientes"}</span>
          <button type="button" onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.delete("service"); next.delete("campaign"); return next; })}>Quitar filtro</button>
        </div>
      ) : null}
      {loading ? (
        <SkeletonRows count={6} />
      ) : error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los clientes" description={error} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="Sin clientes en esta categoría" />
      ) : (
        <div className="hub-list">
          {filtered.map((cliente) => (
            <Link key={cliente.id} className="hub-list-row" to={`/clientes/${cliente.id}`} state={{ from: `${location.pathname}${location.search}` }}>
              <Avatar name={cliente.full_name} seed={cliente.id} />
              <div>
                <strong>{cliente.full_name}</strong>
                <small>{[cliente.serviceLabel, cliente.postalCode ? `ZIP ${cliente.postalCode}` : null].filter(Boolean).join(" · ") || `Última actividad: ${relativeAge(cliente.last_message_at || cliente.updated_at)}`}</small>
              </div>
              <StatusBadge tone={STAGE_TONE[cliente.stage]} label={LEAD_STAGE_LABELS[cliente.stage]} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Operational center for services that already have a canonical, dedicated
// resolver — today that is only Inmigración (resolveImmigrationOpportunity
// via useImmigrationInbox). Deliberately does not invent a resolver for
// other services (see the UX audit's Annex B): this screen only shows what
// already has a trustworthy operational status.
type OpportunityStatusFilter = "all" | "por_contactar" | "contactado" | "citas" | "cerrados";

function opportunityStatusBucket(operationalStatus: string): Exclude<OpportunityStatusFilter, "all"> {
  if (operationalStatus === "Contactado") return "contactado";
  if (operationalStatus === "Cita programada") return "citas";
  if (operationalStatus === "Convertido" || operationalStatus === "Cerrado sin conversión") return "cerrados";
  return "por_contactar";
}

export function OportunidadesScreen() {
  const opportunities = useLegalOpportunities();
  // Demo-safe live refresh: same load() the "Actualizar" button already
  // uses, called silently every ~2.5s so a new WhatsApp Flow submission
  // shows up without the user touching anything. No new query, no overlap
  // (useSilentPolling), no realtime channel.
  useSilentPolling(() => opportunities.load({ silent: true }), 2500);
  const [serviceFilter, setServiceFilter] = useState<OpportunityServiceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<OpportunityStatusFilter>("all");
  const filtered = useMemo(
    () => opportunities.requests.filter((request) =>
      matchesOpportunityServiceFilter(request.serviceId, request.intake, serviceFilter)
      && (statusFilter === "all" || opportunityStatusBucket(request.operationalStatus) === statusFilter)),
    [opportunities.requests, serviceFilter, statusFilter],
  );
  const counts = useMemo(() => {
    const base = { por_contactar: 0, contactado: 0, citas: 0, cerrados: 0 };
    for (const request of opportunities.requests) base[opportunityStatusBucket(request.operationalStatus)] += 1;
    return base;
  }, [opportunities.requests]);

  return (
    <div className="hub-page hub-page--wide">
      <PageHeader
        eyebrow="Operación"
        title="Operación"
        subtitle="Casos activos, responsables, seguimiento y cierres."
        meta={<span className="hub-page-count">{filtered.length} {filtered.length === 1 ? "caso" : "casos"}</span>}
        actions={<button type="button" className="hub-secondary" onClick={() => void opportunities.load()}>Actualizar</button>}
      />

      <div className="hub-filter-group">
        <span className="hub-filter-group-label">Servicio</span>
        <FilterTabs
          tabs={[{ id: "all", label: "Todas" }, { id: "immigration", label: "Inmigración" }, { id: "auto_accident", label: "Accidentes" }, { id: "dui", label: "DUI" }, { id: "criminal", label: "Criminal" }]}
          activeId={serviceFilter}
          onChange={(id) => setServiceFilter(id as OpportunityServiceFilter)}
        />
      </div>

      <div className="hub-filter-group">
        <span className="hub-filter-group-label">Estado</span>
        <FilterTabs
          tabs={[
            { id: "all", label: "Todos los estados", count: opportunities.requests.length },
            { id: "por_contactar", label: "Por contactar", count: counts.por_contactar },
            { id: "contactado", label: "Contactado", count: counts.contactado },
            { id: "citas", label: "Citas", count: counts.citas },
            { id: "cerrados", label: "Cerrados", count: counts.cerrados },
          ]}
          activeId={statusFilter}
          onChange={(id) => setStatusFilter(id as OpportunityStatusFilter)}
        />
      </div>

      {opportunities.loading ? (
        <SkeletonRows count={4} />
      ) : opportunities.error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar las oportunidades" description={opportunities.error} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="Sin oportunidades en esta categoría" description="Las solicitudes legales enviadas por el Flow aparecerán aquí." />
      ) : (
        <div className="hub-opp-list">
          {filtered.map((request) => {
            const presentation = legalOpportunityPresentation(request.serviceId, request.intake, request.topic);
            return (
            <Link key={request.id} className="hub-opp-card" to={`/operacion/${request.id}`} state={{ from: "/operacion" }}>
              <div className="hub-opp-card-main">
                <Avatar name={request.leadName} seed={request.leadId} />
                <div>
                  <span className="hub-opp-service-tag">{presentation.serviceLabel}</span>
                  <strong>{request.leadName}</strong>
                  {presentation.topic ? <small>{presentation.topic}</small> : null}
                  {presentation.summary ? <small>{presentation.summary}</small> : null}
                  {presentation.description ? <small>{presentation.description}</small> : null}
                </div>
              </div>
              <div className="hub-opp-card-meta">
                <StatusBadge tone={immigrationOperationalTone(request.operationalStatus)} label={request.operationalStatus} />
                <small>{request.assignment?.partnerName ? `Asignado a: ${request.assignment.partnerName}` : "Sin aliado disponible"}</small>
                <small>Última actividad {formatDateTime(request.lastActivityAt)}</small>
              </div>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

const SERVICE_REQUEST_LABEL: Record<string, string> = {
  luis_accidente: "Accidente de auto",
  luis_dui: "DUI",
  luis_criminal: "Defensa criminal",
  luis_inmigracion: "Inmigración",
  luis_representante: "Solicitud de asesor",
  luis_eventos: "Eventos comunitarios",
};

const LEGAL_INTAKE_TITLE: Record<string, string> = {
  IMMIGRATION: "Información de inmigración",
  AUTO_ACCIDENT: "Información del accidente",
  DUI_CRIMINAL: "Información de DUI / criminal",
  DUI: "Información de DUI",
  CRIMINAL: "Información criminal",
};

// Legacy referral_service_requests.status/work_status values, translated —
// "prequalified" is the only value seen in real production data today, but
// every value this product's own logic checks for (useLeadsPipeline.ts) is
// covered so nothing legacy ever renders as a raw English status string.
const LEGACY_REQUEST_STATUS_LABEL: Record<string, string> = {
  new: "Nuevo",
  prequalified: "Precalificado",
  qualified: "Calificado",
  contacted: "Contactado",
  in_progress: "En progreso",
  appointment_scheduled: "Confirmado",
  converted: "Cerrado",
  not_converted: "Cerrado",
  closed: "Cerrado",
};
const LEGACY_REQUEST_STATUS_TONE: Record<string, StatusTone> = {
  new: "neutral",
  prequalified: "warning",
  qualified: "warning",
  contacted: "warning",
  in_progress: "warning",
  appointment_scheduled: "success",
  converted: "success",
  not_converted: "neutral",
  closed: "success",
};

// Item 6: every record in the three sections below carries an explicit
// source tag, so a legacy referral_service_requests row is never mistaken
// for — or silently merged with — a real Unified Services Flow submission,
// even when both happen to describe the same underlying service.
function SourceTag({ source }: { source: "WhatsApp Flow" | "Cupón" | "Sistema anterior" }) {
  return <span className="hub-source-tag">{source}</span>;
}

export function ContactDetailScreen() {
  const { leadId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const detail = useContactDetail(leadId);
  const pipeline = useLeadsPipeline();
  const immigrationInbox = useImmigrationInbox();
  const backTo = (location.state as { from?: string } | null)?.from || "/clientes";

  if (detail.loading) return <div className="hub-page"><Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link><EmptyState icon={Users} title="Cargando contacto…" /></div>;
  if (detail.error || !detail.lead) return <div className="hub-page"><Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link><EmptyState tone="error" icon={AlertTriangle} title="Contacto no encontrado" description={detail.error || "No existe este contacto."} /></div>;

  const lead = detail.lead;
  const consentedCoupon = detail.coupons.find((c) => c.email_marketing_opt_in);
  // Same pipeline computation ClientesScreen and Servicios use — the
  // status badge here can never disagree with what got this lead onto the
  // filtered list the user clicked through from (item 2's consistency
  // requirement extended to the detail screen).
  const pipelineLead = pipeline.leads.find((l) => l.id === lead.id);
  const immigrationRequests = immigrationInbox.requests.filter((request) => request.leadId === lead.id);
  // The "Consultas profesionales" card below is generic across immigration/
  // accident/DUI intake and has no assignment data of its own — hardcoding
  // "Sin asignar" there contradicted the canonical immigration section's
  // real partner. Only immigration has a canonical resolver (see UX audit
  // Annex B), so only immigration gets a corrected value here; accident/DUI
  // keep "Sin asignar" since no canonical partner data exists for them yet.
  const legalIntakePartnerLabel = detail.legalIntake?.intakeType === "IMMIGRATION"
    ? (immigrationRequests[0]?.assignment?.partnerName ? `Asignado a: ${immigrationRequests[0].assignment.partnerName}` : "Sin aliado disponible")
    : "Sin asignar";
  // Once the canonical "Solicitud de inmigración" card below exists for
  // this lead, the generic "Consultas profesionales" card would render the
  // exact same case a second time under a different, less complete label —
  // conceptual duplication even though the technical status no longer
  // conflicts. Immigration gets exactly one primary representation; any
  // other legal-intake type (accident/DUI) still renders here as before,
  // since neither has a canonical resolver of its own.
  const showLegalIntakeCard = Boolean(
    detail.legalIntake && !(detail.legalIntake.intakeType === "IMMIGRATION" && immigrationRequests.length > 0),
  );

  return (
    <div className="hub-page hub-page--wide">
      <Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link>
      <PageHeader
        eyebrow="Cliente"
        title={lead.full_name}
        subtitle={lead.channel === "whatsapp" ? lead.channel_user_id || "Sin WhatsApp" : lead.phone || "Sin teléfono"}
        actions={lead.channel_user_id ? <button type="button" className="hub-primary" onClick={() => navigate(`/messages/${lead.id}`)}><MessageCircle size={16} />Conversación</button> : undefined}
      />
      {/* No global status badge over the client's name — a person can have
          several services at once, each with its own operational status
          (item 4 of the demo-safe scope). The badge lives inside each
          service card below instead. */}
      <dl className="hub-facts">
        <div><dt>Canal</dt><dd>{lead.channel === "whatsapp" ? "WhatsApp" : lead.channel || "—"}</dd></div>
        <div><dt>WhatsApp</dt><dd>{lead.channel === "whatsapp" ? (lead.channel_user_id || "—") : "—"}</dd></div>
        <div><dt>Teléfono</dt><dd>{lead.phone || "—"}</dd></div>
        <div><dt>ZIP más reciente</dt><dd>{detail.coupons[0]?.postal_code || detail.serviceRequests[0]?.postal_code || detail.legalIntake?.postalCode || "—"}</dd></div>
        <div><dt>Primera actividad</dt><dd>{formatDateTime(lead.created_at)}</dd></div>
        <div><dt>Última actividad</dt><dd>{formatDateTime(lead.last_message_at || lead.updated_at)}</dd></div>
        <div><dt>Consentimiento de email</dt><dd>{consentedCoupon ? `Sí (${consentedCoupon.email || "email registrado"})` : "No"}</dd></div>
      </dl>

      <h2 className="hub-section-group-title">Servicios</h2>

      {/* Cupones y beneficios */}
      <section className="hub-section">
        <h2>Cupones y beneficios</h2>
        {detail.coupons.length === 0 ? (
          <EmptyState icon={Tag} title="Sin cupones solicitados" />
        ) : (
          <div className="hub-list">
            {detail.coupons.map((coupon) => (
              <div key={coupon.id} className="hub-list-row">
                <div>
                  <strong>{coupon.campaign_label}</strong>
                  <small>
                    ZIP {coupon.postal_code} · Enviado {formatDate(coupon.requested_at)}
                    {coupon.businessName ? ` · ${coupon.businessName}` : ""}
                  </small>
                </div>
                <div className="hub-list-row-meta">
                  <SourceTag source="Cupón" />
                  <StatusBadge tone={CLAIM_STATUS_TONE[coupon.status] ?? "neutral"} label={CLAIM_STATUS_LABEL[coupon.status] ?? coupon.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Consultas profesionales — the real, canonical Unified Services
          Flow intake (immigration/accident/DUI/criminal defense). Never
          rendered alongside, or as if it were, a legacy service_requests
          row — item 5. Omitted entirely (not just its content) when the
          intake is immigration and the canonical card below already covers
          it, so this section never shows an empty/misleading state for a
          case that does exist, just elsewhere. */}
      {showLegalIntakeCard ? (
        <section className="hub-section">
          <h2>Consultas profesionales</h2>
          <div className="hub-list-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
            <div className="hub-list-row-meta">
              <SourceTag source="WhatsApp Flow" />
              {pipelineLead ? <StatusBadge tone={STAGE_TONE[pipelineLead.stage]} label={LEAD_STAGE_LABELS[pipelineLead.stage]} /> : null}
            </div>
            <strong>{LEGAL_INTAKE_TITLE[detail.legalIntake!.intakeType] || "Información capturada"}</strong>
            <dl className="hub-facts">
              {legalTopicLabel(detail.legalIntake!) ? <div><dt>Tipo de ayuda</dt><dd>{legalTopicLabel(detail.legalIntake!)}</dd></div> : null}
              {detail.legalIntake!.postalCode ? <div><dt>ZIP</dt><dd>{detail.legalIntake!.postalCode}</dd></div> : null}
              <div><dt>Enviado</dt><dd>{formatDateTime(detail.legalIntake!.completedAt)}</dd></div>
              <div><dt>Negocio / aliado</dt><dd>{legalIntakePartnerLabel}</dd></div>
            </dl>
            <div><strong>Qué contó el cliente</strong><br /><small style={{ whiteSpace: "pre-wrap" }}>{detail.legalIntake!.description}</small></div>
          </div>
        </section>
      ) : !detail.legalIntake && immigrationRequests.length === 0 ? (
        <section className="hub-section">
          <h2>Consultas profesionales</h2>
          <EmptyState icon={Users} title="Sin consultas profesionales" description="Este cliente no ha enviado una consulta de inmigración, accidente, DUI o defensa criminal por WhatsApp." />
        </section>
      ) : null}

      <section className="hub-section">
        <h2>Solicitud de inmigración</h2>
        {immigrationInbox.loading ? <SkeletonRows count={1} /> : immigrationInbox.error ? (
          <EmptyState tone="error" icon={AlertTriangle} title="No se pudo cargar la solicitud de inmigración" description={immigrationInbox.error} />
        ) : immigrationRequests.length === 0 ? (
          <EmptyState icon={Users} title="Sin solicitud canónica de inmigración" />
        ) : (
          <div className="hub-list">
            {immigrationRequests.map((request) => (
              <div key={request.id} className="hub-list-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                <div className="hub-list-row-meta">
                  <SourceTag source="WhatsApp Flow" />
                  <StatusBadge tone={immigrationOperationalTone(request.operationalStatus)} label={request.operationalStatus} />
                  <StatusBadge tone={request.consentStatus === "authorized" ? "success" : request.consentStatus === "declined" ? "danger" : "warning"} label={request.consentStatus === "authorized" ? "Consentimiento autorizado" : request.consentStatus === "declined" ? "Consentimiento rechazado" : "Consentimiento pendiente"} />
                </div>
                <strong>Inmigración · {immigrationTopicLabel(request.topic)}</strong>
                <dl className="hub-facts">
                  <div><dt>Enviado</dt><dd>{formatDateTime(request.createdAt)}</dd></div>
                  {request.postalCode ? <div><dt>ZIP</dt><dd>{request.postalCode}</dd></div> : null}
                  <div><dt>Aliado</dt><dd>{request.assignment?.partnerName ? `Asignado a: ${request.assignment.partnerName}` : "Sin aliado disponible"}</dd></div>
                  {request.assignment?.assignedAt ? <div><dt>Fecha de asignación</dt><dd>{formatDateTime(request.assignment.assignedAt)}</dd></div> : null}
                  <div><dt>Última actividad</dt><dd>{formatDateTime(request.lastActivityAt)}</dd></div>
                </dl>
                {request.description ? <div><strong>Qué contó el cliente</strong><br /><small style={{ whiteSpace: "pre-wrap" }}>{request.description}</small></div> : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <h2 className="hub-section-group-title">Actividad</h2>

      {/* Historial anterior — legacy referral_service_requests rows only,
          from the older conversational text menu, explicitly labeled as
          historical so it is never confused with a current Flow
          submission. */}
      <section className="hub-section">
        <h2>Historial anterior</h2>
        {detail.serviceRequests.length === 0 ? (
          <EmptyState icon={Users} title="Sin historial anterior" />
        ) : (
          <div className="hub-list">
            {detail.serviceRequests.map((request) => (
              <div key={request.id} className="hub-list-row">
                <div>
                  {(() => {
                    const presentation = legalOpportunityPresentation(request.service_id, request.intake, typeof request.intake.topic === "string" ? request.intake.topic : null);
                    const isLegal = presentation.service !== null;
                    return <>
                      <strong>{isLegal ? `${presentation.serviceLabel}${presentation.topic ? ` · ${presentation.topic}` : ""}` : SERVICE_REQUEST_LABEL[request.service_id] || request.service_id}</strong>
                      {presentation.summary ? <small>{presentation.summary}</small> : null}
                      {presentation.description ? <small>{presentation.description}</small> : null}
                    </>;
                  })()}
                  <small>
                    Enviado {formatDate(request.created_at)}
                    {request.businessName ? ` · ${request.businessName}` : ""}
                  </small>
                </div>
                <div className="hub-list-row-meta">
                  <SourceTag source="Sistema anterior" />
                  <StatusBadge tone={LEGACY_REQUEST_STATUS_TONE[request.status] ?? "neutral"} label={LEGACY_REQUEST_STATUS_LABEL[request.status] ?? request.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
