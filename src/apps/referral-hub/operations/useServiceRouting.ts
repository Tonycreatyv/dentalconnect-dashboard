import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { operationalStatusLabel, SERVICE_IDS, SERVICE_LABELS } from "./pastorOperations";
import { periodRange, type PeriodId } from "./period";

export type Partner = { id: string; name: string; active: boolean; receives_service_requests: boolean };
export type RouteRow = { partner_id: string; service_id: string; active: boolean; referral_partners: Partner | null };
export type AssignmentRow = { work_status: string | null; referral_service_requests: { service_id: string } | null };
export type MembershipRow = { partner_id: string; user_id: string; role: string; active: boolean };

export function usePastorOperations() {
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

// Resolves the active canonical destination for a service_id (e.g.
// "luis_accidente" → "Clínica Pastor") straight from the static routing
// table, independent of any single request's per-row assignment. This is
// the same "canonical assignment truth" AdminPartnersScreen already uses,
// exposed for reuse by the client profile page (see ContactDetailScreen).
export function useCanonicalServiceDestinations() {
  const { routes, loading, error } = usePastorOperations();
  const destinationByService = useMemo(() => {
    const map = new Map<string, string>();
    for (const route of routes) {
      if (route.active && route.referral_partners?.active && route.referral_partners.receives_service_requests) {
        map.set(route.service_id, route.referral_partners.name);
      }
    }
    return map;
  }, [routes]);
  return { destinationByService, loading, error };
}

// Row-level Servicios workspace data: Cliente / Servicio / Partner / Estado /
// Recibido, one row per referral_service_requests entry, joined to its most
// recent assignment (if any). Distinct from the per-service aggregate counts
// in pastorOperations.ts — this is what the Servicios list page renders.
export type ServiceRequestRow = {
  id: string;
  clienteId: string;
  clienteName: string;
  servicioId: string;
  servicioLabel: string;
  partnerName: string | null;
  workStatus: string | null;
  statusLabel: ReturnType<typeof operationalStatusLabel>;
  receivedAt: string;
};

type RawRequestRow = {
  id: string;
  lead_id: string;
  service_id: string;
  created_at: string;
  leads: { full_name: string | null } | null;
};
type RawAssignmentRow = { request_id: string; work_status: string | null; partner_id: string | null; assigned_at: string | null };

export function useServiceRequestsList(period: PeriodId) {
  const { resolvedOrgId } = useReferralOrganization();
  const [rows, setRows] = useState<ServiceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const range = useMemo(() => periodRange(period), [period]);

  const load = useCallback(async () => {
    if (!resolvedOrgId) { setRows([]); setLoading(false); return; }
    setLoading(true); setError("");
    const requestsResult = await supabase
      .from("referral_service_requests")
      .select("id,lead_id,service_id,created_at,leads(full_name)")
      .eq("organization_id", resolvedOrgId)
      .in("service_id", SERVICE_IDS as unknown as string[])
      .gte("created_at", range.start.toISOString())
      .lte("created_at", range.end.toISOString())
      .order("created_at", { ascending: false });
    if (requestsResult.error) { setError("No se pudieron cargar los servicios."); setRows([]); setLoading(false); return; }
    const requestRows = (requestsResult.data ?? []) as unknown as RawRequestRow[];
    const requestIds = requestRows.map((row) => row.id);
    const assignmentsResult = requestIds.length
      ? await supabase.from("referral_assignments").select("request_id,work_status,partner_id,assigned_at").eq("organization_id", resolvedOrgId).in("request_id", requestIds).order("assigned_at", { ascending: false })
      : { data: [] as RawAssignmentRow[], error: null };
    if (assignmentsResult.error) { setError("No se pudieron cargar los servicios."); setRows([]); setLoading(false); return; }
    const assignmentRows = (assignmentsResult.data ?? []) as unknown as RawAssignmentRow[];
    const assignmentByRequest = new Map<string, RawAssignmentRow>();
    for (const assignment of assignmentRows) if (!assignmentByRequest.has(assignment.request_id)) assignmentByRequest.set(assignment.request_id, assignment);
    const partnerIds = [...new Set(assignmentRows.map((a) => a.partner_id).filter((id): id is string => Boolean(id)))];
    const partnersResult = partnerIds.length
      ? await supabase.from("referral_partners").select("id,name").in("id", partnerIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const partnerNameById = new Map(((partnersResult.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
    setRows(requestRows.map((request) => {
      const assignment = assignmentByRequest.get(request.id);
      return {
        id: request.id,
        clienteId: request.lead_id,
        clienteName: request.leads?.full_name || "Cliente",
        servicioId: request.service_id,
        servicioLabel: SERVICE_LABELS[request.service_id] || request.service_id,
        partnerName: assignment?.partner_id ? partnerNameById.get(assignment.partner_id) ?? null : null,
        workStatus: assignment?.work_status ?? null,
        statusLabel: operationalStatusLabel(assignment?.work_status),
        receivedAt: request.created_at,
      };
    }));
    setLoading(false);
  }, [resolvedOrgId, range.start, range.end]);

  useEffect(() => { void load(); }, [load]);
  return { rows, loading, error, load };
}
