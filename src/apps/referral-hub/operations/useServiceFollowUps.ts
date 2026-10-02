import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { ACTIONABLE_ASSIGNMENT_WORK_STATUSES } from "./homeMetrics";

export const FOLLOW_UP_SERVICE_IDS = ["luis_accidente", "luis_dui", "luis_criminal", "luis_inmigracion"] as const;

const SERVICE_LABELS: Record<string, string> = {
  luis_accidente: "Accidente de auto",
  luis_dui: "DUI",
  luis_criminal: "Defensa criminal",
  luis_inmigracion: "Inmigración",
};

export type FollowUpRequest = {
  id: string;
  request_id: string;
  lead_id: string;
  service_id: string;
  service_label: string;
  work_status: string;
  postal_code: string | null;
  assigned_at: string;
  created_at: string;
  lead_name: string;
  channel_user_id: string | null;
};

export function useServiceFollowUps() {
  const { resolvedOrgId } = useReferralOrganization();
  const [requests, setRequests] = useState<FollowUpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!resolvedOrgId) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const result = await supabase
      .from("referral_assignments")
      .select("id,request_id,work_status,assigned_at,referral_service_requests!inner(id,lead_id,service_id,postal_code,created_at,leads(full_name,channel_user_id))")
      .eq("organization_id", resolvedOrgId)
      .in("work_status", ACTIONABLE_ASSIGNMENT_WORK_STATUSES as unknown as string[])
      .in("referral_service_requests.service_id", FOLLOW_UP_SERVICE_IDS as unknown as string[])
      .order("assigned_at", { ascending: false });
    if (result.error) {
      setError("No se pudieron cargar los casos por contactar.");
      setRequests([]);
      setLoading(false);
      return;
    }
    type AssignmentRow = {
      id: string; request_id: string; work_status: string; assigned_at: string;
      referral_service_requests: {
        id: string; lead_id: string; service_id: string; postal_code: string | null; created_at: string;
        leads: { full_name: string | null; channel_user_id: string | null } | null;
      };
    };
    setRequests(((result.data ?? []) as unknown as AssignmentRow[]).map((row) => ({
      id: row.id,
      request_id: row.request_id,
      lead_id: row.referral_service_requests.lead_id,
      service_id: row.referral_service_requests.service_id,
      service_label: SERVICE_LABELS[row.referral_service_requests.service_id] || row.referral_service_requests.service_id,
      work_status: row.work_status,
      postal_code: row.referral_service_requests.postal_code,
      assigned_at: row.assigned_at,
      created_at: row.referral_service_requests.created_at,
      lead_name: row.referral_service_requests.leads?.full_name || "Cliente",
      channel_user_id: row.referral_service_requests.leads?.channel_user_id ?? null,
    })));
    setLoading(false);
  }, [resolvedOrgId]);

  useEffect(() => { void load(); }, [load]);

  return { requests, loading, error, load };
}
