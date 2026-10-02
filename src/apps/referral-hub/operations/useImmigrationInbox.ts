import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { normalizeImmigrationConsent, type ImmigrationInboxRow } from "./immigrationInbox";
import { resolveImmigrationOpportunity, type ImmigrationOpportunity } from "./immigrationOpportunities";
import { LEGAL_SERVICE_IDS } from "./luisCatalog";

type RequestRow = {
  id: string;
  lead_id: string;
  service_id: string;
  postal_code: string | null;
  intake: Record<string, unknown> | null;
  consent: Record<string, unknown> | null;
  intake_complete: boolean;
  status: string;
  case_cycle: number | null;
  created_at: string;
  leads: { full_name: string | null; channel_user_id: string | null } | null;
};

export type OperationalOpportunity = ImmigrationOpportunity & { serviceId: string; intake: Record<string, unknown> };
const IMMIGRATION_SERVICE_IDS = ["luis_inmigracion"];
const LEGAL_OPPORTUNITY_SERVICE_IDS = [...LEGAL_SERVICE_IDS, "luis_muebles"] as const;

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Read-only internal queue for the canonical WhatsApp Immigration Flow.
// The database RLS policy is the access boundary; this org predicate is
// deliberate defense in depth and must stay coupled to the active provider.
function useOperationalOpportunities(serviceIds: readonly string[]) {
  const { resolvedOrgId } = useReferralOrganization();
  const [requests, setRequests] = useState<OperationalOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // silent=true is used by background polling (see useSilentPolling): it
  // never flips the big `loading` skeleton on, and a failed silent refresh
  // leaves whatever is already on screen untouched instead of clearing it.
  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!resolvedOrgId) {
      if (!silent) { setRequests([]); setLoading(false); }
      return;
    }
    if (!silent) { setLoading(true); setError(""); }
    const result = await supabase
      .from("referral_service_requests")
      .select("id,lead_id,service_id,postal_code,intake,consent,intake_complete,status,case_cycle,created_at,leads(full_name,channel_user_id)")
      .eq("organization_id", resolvedOrgId)
      .in("service_id", [...serviceIds])
      .order("created_at", { ascending: false });
    if (result.error) {
      if (!silent) { setRequests([]); setError("No se pudieron cargar los casos operativos."); setLoading(false); }
      return;
    }
    const requestRows = (result.data ?? []) as unknown as RequestRow[];
    const assignmentResult = requestRows.length ? await supabase
      .from("referral_assignments")
      .select("id,request_id,status,work_status,assigned_at,updated_at,partner_id")
      .eq("organization_id", resolvedOrgId)
      .in("request_id", requestRows.map((request) => request.id))
      .order("assigned_at", { ascending: false }) : { data: [], error: null };
    const assignmentRows = (assignmentResult.data ?? []) as Array<{ id:string; request_id:string; status:string; work_status:string; assigned_at:string; updated_at:string; partner_id:string }>;
    const partnerIds = [...new Set(assignmentRows.map((assignment) => assignment.partner_id))];
    const partnerResult = partnerIds.length ? await supabase.from("referral_partners").select("id,name").in("id", partnerIds) : { data: [] as Array<{id:string;name:string}> };
    const partnerNames = new Map(((partnerResult.data ?? []) as Array<{id:string;name:string}>).map((partner) => [partner.id, partner.name]));
    const assignmentByRequest = new Map<string, typeof assignmentRows[number]>();
    for (const assignment of assignmentRows) if (!assignmentByRequest.has(assignment.request_id)) assignmentByRequest.set(assignment.request_id, assignment);
    setRequests(requestRows.map((request) => {
      const intake = request.intake ?? {};
      const consent = request.consent ?? {};
      const inboxRow: ImmigrationInboxRow = {
        id: request.id,
        leadId: request.lead_id,
        leadName: request.leads?.full_name || "Cliente",
        channelUserId: request.leads?.channel_user_id ?? null,
        topic: optionalText(intake.topic),
        description: optionalText(intake.description),
        postalCode: request.postal_code ?? optionalText(intake.postal_code),
        consentStatus: normalizeImmigrationConsent(consent),
        consentVersion: optionalText(consent.version),
        consentCapturedAt: optionalText(consent.captured_at),
        intakeComplete: request.intake_complete === true,
        status: request.status,
        caseCycle: request.case_cycle ?? 1,
        createdAt: request.created_at,
      };
      const assignment = assignmentByRequest.get(request.id);
      return { ...resolveImmigrationOpportunity(inboxRow, assignment ? {
        id: assignment.id, status: assignment.status, workStatus: assignment.work_status,
        assignedAt: assignment.assigned_at, updatedAt: assignment.updated_at,
        partnerName: partnerNames.get(assignment.partner_id) ?? null,
      } : null), serviceId: request.service_id, intake };
    }));
    if (!silent) setLoading(false);
  }, [resolvedOrgId, serviceIds]);

  useEffect(() => { void load(); }, [load]);
  return { requests, loading, error, load };
}

export function useImmigrationInbox() { return useOperationalOpportunities(IMMIGRATION_SERVICE_IDS); }
export function useLegalOpportunities() { return useOperationalOpportunities(LEGAL_OPPORTUNITY_SERVICE_IDS); }
