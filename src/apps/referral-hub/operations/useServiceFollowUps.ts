import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

export const FOLLOW_UP_SERVICE_IDS = ["luis_accidente", "luis_inmigracion"] as const;

const SERVICE_LABELS: Record<string, string> = {
  luis_accidente: "Accidente / DUI / Criminal",
  luis_inmigracion: "Inmigración",
};

export type FollowUpRequest = {
  id: string;
  lead_id: string;
  service_id: string;
  service_label: string;
  status: string;
  postal_code: string | null;
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
      .from("referral_service_requests")
      .select("id,lead_id,service_id,status,postal_code,created_at,leads(full_name,channel_user_id)")
      .eq("organization_id", resolvedOrgId)
      .in("service_id", FOLLOW_UP_SERVICE_IDS as unknown as string[])
      .eq("status", "qualified")
      .order("created_at", { ascending: false });
    if (result.error) {
      setError("No se pudieron cargar los casos por contactar.");
      setRequests([]);
      setLoading(false);
      return;
    }
    type RequestRow = {
      id: string; lead_id: string; service_id: string; status: string; postal_code: string | null;
      created_at: string; leads: { full_name: string | null; channel_user_id: string | null } | null;
    };
    setRequests(((result.data ?? []) as unknown as RequestRow[]).map((row) => ({
      id: row.id,
      lead_id: row.lead_id,
      service_id: row.service_id,
      service_label: SERVICE_LABELS[row.service_id] || row.service_id,
      status: row.status,
      postal_code: row.postal_code,
      created_at: row.created_at,
      lead_name: row.leads?.full_name || "Cliente",
      channel_user_id: row.leads?.channel_user_id ?? null,
    })));
    setLoading(false);
  }, [resolvedOrgId]);

  useEffect(() => { void load(); }, [load]);

  return { requests, loading, error, load };
}
