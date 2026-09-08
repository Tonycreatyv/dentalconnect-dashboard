import { AlertTriangle, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { countOperationalWorkStatuses, type OperationalStatusCounts } from "../operations/pastorOperations";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { SkeletonRows } from "../ui/Skeleton";
import StatusBadge from "../ui/StatusBadge";

const SERVICE_IDS = ["luis_accidente", "luis_inmigracion"] as const;
const SERVICE_LABELS: Record<string, string> = { luis_accidente: "Accidente de auto", luis_inmigracion: "Inmigración" };
const SOURCE_ORGANIZATION = "Luis Gabriel Productions";
const PASTOR_PARTNER_ID = "93bafa9c-acae-4606-966c-c79f5c1003f1";
type Partner = { id: string; name: string; active: boolean; receives_service_requests: boolean };
type RouteRow = { partner_id: string; service_id: string; active: boolean; referral_partners: Partner | null };
type AssignmentRow = { work_status: string | null; referral_service_requests: { service_id: string } | null };
type MembershipRow = { partner_id: string; user_id: string; role: string; active: boolean };

function usePastorOperations() {
  const { resolvedOrgId } = useReferralOrganization();
  const [partners, setPartners] = useState<Partner[]>([]); const [routes, setRoutes] = useState<RouteRow[]>([]); const [assignments, setAssignments] = useState<AssignmentRow[]>([]); const [memberships, setMemberships] = useState<MembershipRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!resolvedOrgId) return;
    setLoading(true); setError("");
    const [partnersResult, routesResult, assignmentsResult, membershipsResult] = await Promise.all([
      supabase.from("referral_partners").select("id,name,active,receives_service_requests").eq("organization_id", resolvedOrgId).eq("active", true).eq("receives_service_requests", true).order("name"),
      supabase.from("referral_partner_service_rules").select("partner_id,service_id,active,referral_partners(id,name,active,receives_service_requests)").eq("organization_id", resolvedOrgId).in("service_id", SERVICE_IDS as unknown as string[]),
      supabase.from("referral_assignments").select("work_status,referral_service_requests!inner(service_id)").eq("organization_id", resolvedOrgId).in("referral_service_requests.service_id", SERVICE_IDS as unknown as string[]),
      supabase.from("referral_partner_memberships").select("partner_id,user_id,role,active").eq("organization_id", resolvedOrgId).eq("active", true),
    ]);
    const failure = [partnersResult, routesResult, assignmentsResult, membershipsResult].find((result) => result.error)?.error;
    if (failure) { setError("No se pudo cargar la operación de servicios y partners."); setLoading(false); return; }
    setPartners((partnersResult.data ?? []) as Partner[]); setRoutes((routesResult.data ?? []) as unknown as RouteRow[]); setAssignments((assignmentsResult.data ?? []) as unknown as AssignmentRow[]); setMemberships((membershipsResult.data ?? []) as MembershipRow[]); setLoading(false);
  }, [resolvedOrgId]);
  useEffect(() => { void load(); }, [load]);
  return { partners, routes, assignments, memberships, loading, error, load };
}

function ServiceCard({ label, destination, counts }: { label: string; destination: string; counts: OperationalStatusCounts }) {
  return <section className="hub-list-row hub-operation-card"><div><strong>{label}</strong><small>Destino: {destination}</small></div><div className="hub-operation-statuses"><StatusBadge tone="warning" label={`${counts.new} Nuevo`} /><StatusBadge tone="warning" label={`${counts.followUp} Seguimiento`} /><StatusBadge tone="success" label={`${counts.approved} Aprobado`} /><StatusBadge tone="danger" label={`${counts.disqualified} No calificó`} /></div></section>;
}

export function AdminServicesScreen() {
  const { routes, assignments, loading, error, load } = usePastorOperations();
  const services = useMemo(() => SERVICE_IDS.map((serviceId) => {
    const route = routes.find((row) => row.service_id === serviceId && row.active && row.referral_partners?.active && row.referral_partners.receives_service_requests);
    return { serviceId, destination: route?.referral_partners?.name ?? "Sin partner activo", counts: countOperationalWorkStatuses(assignments.filter((row) => row.referral_service_requests?.service_id === serviceId).map((row) => row.work_status)) };
  }), [routes, assignments]);
  return <div className="hub-page"><PageHeader eyebrow="Operación" title="Servicios" subtitle="Estado actual de las consultas enviadas a cada partner." actions={<button type="button" className="hub-secondary" onClick={() => void load()}><RefreshCw size={16} />Actualizar</button>} />{loading ? <SkeletonRows count={2} /> : error ? <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los servicios" description={error} /> : <div className="hub-list">{services.map((service) => <ServiceCard key={service.serviceId} label={SERVICE_LABELS[service.serviceId]} destination={service.destination} counts={service.counts} />)}</div>}</div>;
}

export function AdminPartnersScreen() {
  const { partners, routes, memberships, loading, error, load } = usePastorOperations();
  const pastor = partners.find((partner) => partner.id === PASTOR_PARTNER_ID); const pastorRoutes = routes.filter((route) => route.partner_id === PASTOR_PARTNER_ID && route.active); const pastorMembers = memberships.filter((member) => member.partner_id === PASTOR_PARTNER_ID);
  return <div className="hub-page"><PageHeader eyebrow="Red de partners" title="Partners" subtitle="Partners que reciben consultas y las personas autorizadas para trabajarlas." actions={<button type="button" className="hub-secondary" onClick={() => void load()}><RefreshCw size={16} />Actualizar</button>} />{loading ? <SkeletonRows count={2} /> : error ? <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar los partners" description={error} /> : !pastor ? <EmptyState icon={Users} title="Clinica Pastor no está disponible" description="No hay un partner activo configurado para recibir consultas." /> : <section className="hub-section hub-partner-detail"><div className="hub-section-head"><h2>{pastor.name}</h2><StatusBadge tone="success" label="Activo" /></div><dl className="hub-facts"><div><dt>Servicios</dt><dd>{pastorRoutes.map((route) => SERVICE_LABELS[route.service_id]).filter(Boolean).join(", ") || "Sin servicios activos"}</dd></div><div><dt>Organización de origen</dt><dd>{SOURCE_ORGANIZATION}</dd></div><div><dt>Routing</dt><dd>{pastorRoutes.some((route) => route.service_id === "luis_accidente") ? `${SOURCE_ORGANIZATION} → Accidente de auto → ${pastor.name}` : "Sin ruta activa"}</dd></div></dl><div className="hub-partner-users"><div className="hub-section-head"><h3>Usuarios</h3><span className="hub-page-count">{pastorMembers.length} activo{pastorMembers.length === 1 ? "" : "s"}</span></div>{pastorMembers.length === 0 ? <p className="hub-field-hint">Todavía no hay usuarios activos para este partner.</p> : <div className="hub-list">{pastorMembers.map((member, index) => { const isJose = member.user_id === "119ef68a-2b79-43e5-916a-f08897b53889"; return <div key={`${member.partner_id}-${member.user_id}-${index}`} className="hub-list-row"><div><strong>{isJose ? "joseduran1791@gmail.com" : "Usuario autorizado"}</strong><small>{isJose ? "Acceso temporal interno/demo" : "Usuario del partner"} · {member.role === "partner_admin" ? "Administrador del partner" : "Agente del partner"}</small></div><StatusBadge tone="success" label="Activo" /></div>; })}</div>}<p className="hub-field-hint">Próximo paso al incorporar al partner: Usuarios → Invitar usuario → asignar rol → activar acceso.</p></div></section>}</div>;
}
