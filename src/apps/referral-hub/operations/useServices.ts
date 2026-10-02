import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import {
  BENEFIT_MERCHANT_NAME,
  BENEFIT_SERVICE_IDS,
  BENEFIT_STATIC_IMAGE,
  CAMPAIGN_KEY_BY_SERVICE,
  LEGAL_SERVICE_IDS,
  SERVICE_LABELS,
  type LuisServiceId,
} from "./luisCatalog";

export type ServiceSummary = {
  id: LuisServiceId;
  label: string;
  requestCount: number;
  campaignCount: number;
  businesses: string[];
  imageUrl: string | null;
};

export function useServices() {
  const { resolvedOrgId } = useReferralOrganization();
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!resolvedOrgId) {
      setServices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [campaignsRes, claimsRes, locationsRes, requestsRes, qrRes] = await Promise.all([
      supabase.from("referral_coupon_campaigns").select("id,campaign_key,service_id").eq("organization_id", resolvedOrgId),
      supabase.from("referral_benefit_claims").select("campaign_id").eq("organization_id", resolvedOrgId),
      supabase.from("referral_benefit_campaign_locations").select("campaign_id,display_name").eq("organization_id", resolvedOrgId).eq("active", true),
      supabase.from("referral_service_requests").select("service_id").eq("organization_id", resolvedOrgId).in("service_id", LEGAL_SERVICE_IDS),
      supabase.from("referral_qr_entries").select("campaign_key").eq("organization_id", resolvedOrgId).not("campaign_key", "is", null),
    ]);
    if (campaignsRes.error || claimsRes.error || requestsRes.error) {
      setError("No se pudieron cargar los servicios.");
      setServices([]);
      setLoading(false);
      return;
    }
    type CampaignRow = { id: string; campaign_key: string; service_id: string };
    const campaignRows = (campaignsRes.data ?? []) as unknown as CampaignRow[];
    const campaignIdByKey = new Map(campaignRows.map((row) => [row.campaign_key, row.id]));

    const claimCountByCampaignId = new Map<string, number>();
    for (const row of (claimsRes.data ?? []) as unknown as { campaign_id: string }[]) {
      claimCountByCampaignId.set(row.campaign_id, (claimCountByCampaignId.get(row.campaign_id) ?? 0) + 1);
    }
    const requestCountByServiceId = new Map<string, number>();
    for (const row of (requestsRes.data ?? []) as unknown as { service_id: string }[]) {
      requestCountByServiceId.set(row.service_id, (requestCountByServiceId.get(row.service_id) ?? 0) + 1);
    }
    const campaignCountByKey = new Map<string, number>();
    for (const row of (qrRes.data ?? []) as unknown as { campaign_key: string | null }[]) {
      if (!row.campaign_key) continue;
      campaignCountByKey.set(row.campaign_key, (campaignCountByKey.get(row.campaign_key) ?? 0) + 1);
    }
    const supermarketLocationNames = ((locationsRes.data ?? []) as unknown as { display_name: string }[]).map((row) => row.display_name);

    const rows: ServiceSummary[] = [
      ...BENEFIT_SERVICE_IDS.map((serviceId) => {
        const campaignKey = CAMPAIGN_KEY_BY_SERVICE[serviceId]!;
        const campaignId = campaignIdByKey.get(campaignKey);
        const businesses = serviceId === "luis_benefit_supermarket"
          ? supermarketLocationNames
          : BENEFIT_MERCHANT_NAME[serviceId] ? [BENEFIT_MERCHANT_NAME[serviceId]!] : [];
        return {
          id: serviceId,
          label: SERVICE_LABELS[serviceId],
          requestCount: campaignId ? claimCountByCampaignId.get(campaignId) ?? 0 : 0,
          campaignCount: campaignCountByKey.get(campaignKey) ?? 0,
          businesses,
          imageUrl: BENEFIT_STATIC_IMAGE[serviceId] ?? null,
        };
      }),
      ...LEGAL_SERVICE_IDS.map((serviceId) => ({
        id: serviceId,
        label: SERVICE_LABELS[serviceId],
        requestCount: requestCountByServiceId.get(serviceId) ?? 0,
        campaignCount: 0,
        businesses: [],
        imageUrl: null,
      })),
    ];
    setServices(rows);
    setLoading(false);
  }, [resolvedOrgId]);

  useEffect(() => { void load(); }, [load]);

  return { services, loading, error, load };
}
