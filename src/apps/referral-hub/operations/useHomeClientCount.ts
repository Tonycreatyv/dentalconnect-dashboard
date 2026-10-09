import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { periodRange, type PeriodId } from "./period";
import { uniqueBusinessLeadCount } from "./homeMetrics";

export function useHomeClientCount(period: PeriodId) {
  const { resolvedOrgId, timezone } = useReferralOrganization();
  const range = useMemo(() => periodRange(period, undefined, timezone), [period, timezone]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!resolvedOrgId) {
      setCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [claimsResult, requestsResult] = await Promise.all([
      supabase.from("referral_benefit_claims")
        .select("lead_id")
        .eq("organization_id", resolvedOrgId)
        .gte("requested_at", range.start.toISOString())
        .lte("requested_at", range.end.toISOString()),
      supabase.from("referral_service_requests")
        .select("lead_id")
        .eq("organization_id", resolvedOrgId)
        .gte("created_at", range.start.toISOString())
        .lte("created_at", range.end.toISOString()),
    ]);
    if (claimsResult.error || requestsResult.error) {
      setError("No se pudo cargar el total de clientes.");
      setCount(0);
    } else {
      const claimIds = (claimsResult.data ?? []).map((row) => row.lead_id);
      const requestIds = (requestsResult.data ?? []).map((row) => row.lead_id);
      setCount(uniqueBusinessLeadCount(claimIds, requestIds));
    }
    setLoading(false);
  }, [resolvedOrgId, range.start, range.end]);

  useEffect(() => { void load(); }, [load]);
  return { count, loading, error, load };
}
