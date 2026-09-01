import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { buildDayBuckets, dayKey, dayLabel, periodRange, type PeriodId } from "./period";
import { type CouponClaimRow, filterCouponClaims, SIN_LOCALIDAD_KEY } from "./couponClaims";

export { filterCouponClaims, SIN_LOCALIDAD_KEY, type CouponClaimRow };

const SUPERMARKET_CAMPAIGN_KEY = "luis_benefit_supermarket_20";

export type LocationRanking = { key: string; label: string; requests: number; clients: number };

type RawClaimRow = {
  id: string;
  claim_code: string;
  status: CouponClaimRow["status"];
  postal_code: string;
  requested_at: string;
  lead_id: string;
  leads: { full_name: string | null; channel_user_id: string | null } | null;
  referral_coupon_campaigns: { campaign_key: string; display_name: string | null } | null;
  referral_benefit_campaign_locations: { location_key: string; display_name: string | null } | null;
};

export function useCouponDemand(period: PeriodId, customRange?: { start: string; end: string }) {
  const { resolvedOrgId } = useReferralOrganization();
  const [rawClaims, setRawClaims] = useState<CouponClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const range = useMemo(() => periodRange(period, customRange), [period, customRange?.start, customRange?.end]);

  const load = useCallback(async () => {
    if (!resolvedOrgId) {
      setRawClaims([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const result = await supabase
      .from("referral_benefit_claims")
      .select(
        "id,claim_code,status,postal_code,requested_at,lead_id,leads(full_name,channel_user_id),referral_coupon_campaigns(campaign_key,display_name),referral_benefit_campaign_locations(location_key,display_name)",
      )
      .eq("organization_id", resolvedOrgId)
      .gte("requested_at", range.start.toISOString())
      .lte("requested_at", range.end.toISOString())
      .order("requested_at", { ascending: false });
    if (result.error) {
      setError("No se pudieron cargar los cupones pedidos.");
      setRawClaims([]);
      setLoading(false);
      return;
    }
    const rows: CouponClaimRow[] = ((result.data ?? []) as unknown as RawClaimRow[]).map((row) => {
      const campaignKey = row.referral_coupon_campaigns?.campaign_key ?? "desconocido";
      const isSupermarket = campaignKey === SUPERMARKET_CAMPAIGN_KEY;
      const locationLabel = row.referral_benefit_campaign_locations?.display_name;
      return {
        id: row.id,
        claim_code: row.claim_code,
        status: row.status,
        postal_code: row.postal_code,
        requested_at: row.requested_at,
        lead_id: row.lead_id,
        lead_name: row.leads?.full_name || "Cliente",
        channel_user_id: row.leads?.channel_user_id ?? null,
        campaign_key: campaignKey,
        campaign_label: row.referral_coupon_campaigns?.display_name || "Beneficio",
        location_key: isSupermarket ? (row.referral_benefit_campaign_locations?.location_key || SIN_LOCALIDAD_KEY) : "",
        location_label: isSupermarket ? (locationLabel || "Sin localidad") : "",
      };
    });
    setRawClaims(rows);
    setLoading(false);
  }, [resolvedOrgId, range.start, range.end]);

  useEffect(() => { void load(); }, [load]);

  const campaigns = useMemo(() => {
    const seen = new Map<string, string>();
    for (const claim of rawClaims) seen.set(claim.campaign_key, claim.campaign_label);
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }));
  }, [rawClaims]);

  const filterClaims = useCallback(filterCouponClaims, []);

  const locationRanking = useCallback((claims: CouponClaimRow[]): LocationRanking[] => {
    const groups = new Map<string, { label: string; requests: number; clients: Set<string> }>();
    for (const claim of claims) {
      if (claim.campaign_key !== SUPERMARKET_CAMPAIGN_KEY) continue;
      const key = claim.location_key || SIN_LOCALIDAD_KEY;
      const entry = groups.get(key) ?? { label: claim.location_label || "Sin localidad", requests: 0, clients: new Set<string>() };
      entry.requests += 1;
      entry.clients.add(claim.lead_id);
      groups.set(key, entry);
    }
    const rows = Array.from(groups.entries()).map(([key, value]) => ({ key, label: value.label, requests: value.requests, clients: value.clients.size }));
    const known = rows.filter((row) => row.key !== SIN_LOCALIDAD_KEY).sort((a, b) => b.requests - a.requests);
    const unknown = rows.filter((row) => row.key === SIN_LOCALIDAD_KEY);
    return [...known, ...unknown];
  }, []);

  const trend = useCallback((claims: CouponClaimRow[]) => {
    const buckets = buildDayBuckets(range.start, range.end);
    const counts = new Map<string, number>();
    for (const claim of claims) {
      const key = dayKey(claim.requested_at);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return buckets.map((key) => ({ label: dayLabel(key), value: counts.get(key) ?? 0 }));
  }, [range.start, range.end]);

  return { rawClaims, campaigns, loading, error, load, range, filterClaims, locationRanking, trend };
}
