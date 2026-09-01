import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import {
  BENEFIT_MERCHANT_NAME,
  BENEFIT_STATIC_IMAGE,
  CAMPAIGN_KEY_BY_SERVICE,
  SERVICE_LABELS,
  type LuisServiceId,
} from "./luisCatalog";

export type Business = {
  id: string;
  kind: "partner" | "merchant" | "supermarket_location";
  name: string;
  serviceLabel: string;
  campaignKey: string | null;
  imageUrl: string | null;
  requestCount: number;
  postalCode: string | null;
  address: string | null;
};

export function useBusinesses() {
  const { resolvedOrgId } = useReferralOrganization();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!resolvedOrgId) {
      setBusinesses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [partnersRes, rulesRes, campaignsRes, claimsRes, locationsRes] = await Promise.all([
      supabase.from("referral_partners").select("id,name,partnership_status,active").eq("organization_id", resolvedOrgId),
      supabase.from("referral_partner_service_rules").select("partner_id,service_id").eq("organization_id", resolvedOrgId).eq("active", true),
      supabase.from("referral_coupon_campaigns").select("id,campaign_key").eq("organization_id", resolvedOrgId),
      supabase.from("referral_benefit_claims").select("campaign_id,supermarket_location_id").eq("organization_id", resolvedOrgId),
      supabase.from("referral_benefit_campaign_locations").select("id,display_name,postal_code,address_text,official_media_url,active,campaign_id")
        .eq("organization_id", resolvedOrgId).eq("active", true),
    ]);
    if (partnersRes.error || locationsRes.error) {
      setError("No se pudieron cargar los negocios.");
      setBusinesses([]);
      setLoading(false);
      return;
    }
    type PartnerRow = { id: string; name: string; partnership_status: string | null; active: boolean | null };
    const partnerRows = (partnersRes.data ?? []) as unknown as PartnerRow[];
    const ruleRows = (rulesRes.data ?? []) as unknown as { partner_id: string; service_id: string }[];
    const campaignRows = (campaignsRes.data ?? []) as unknown as { id: string; campaign_key: string }[];
    const campaignKeyById = new Map(campaignRows.map((row) => [row.id, row.campaign_key]));
    const claimCountByCampaignId = new Map<string, number>();
    const claimCountByLocationId = new Map<string, number>();
    for (const row of (claimsRes.data ?? []) as unknown as { campaign_id: string; supermarket_location_id: string | null }[]) {
      claimCountByCampaignId.set(row.campaign_id, (claimCountByCampaignId.get(row.campaign_id) ?? 0) + 1);
      if (row.supermarket_location_id) {
        claimCountByLocationId.set(row.supermarket_location_id, (claimCountByLocationId.get(row.supermarket_location_id) ?? 0) + 1);
      }
    }

    const partnerBusinesses: Business[] = partnerRows
      .filter((row) => row.active !== false)
      .map((row) => {
        const serviceIds = ruleRows.filter((rule) => rule.partner_id === row.id).map((rule) => rule.service_id);
        return {
          id: `partner:${row.id}`,
          kind: "partner" as const,
          name: row.name || "Aliado",
          serviceLabel: serviceIds.length ? serviceIds.map((id) => humanizeServiceId(id)).join(", ") : "Aliado profesional",
          campaignKey: null,
          imageUrl: null,
          requestCount: 0,
          postalCode: null,
          address: null,
        };
      });

    const merchantBusinesses: Business[] = (["luis_benefit_medical", "luis_benefit_dental", "luis_benefit_shipping"] as LuisServiceId[])
      .filter((serviceId) => BENEFIT_MERCHANT_NAME[serviceId])
      .map((serviceId) => {
        const campaignKey = CAMPAIGN_KEY_BY_SERVICE[serviceId]!;
        const campaignId = [...campaignKeyById.entries()].find(([, key]) => key === campaignKey)?.[0];
        return {
          id: `merchant:${serviceId}`,
          kind: "merchant" as const,
          name: BENEFIT_MERCHANT_NAME[serviceId]!,
          serviceLabel: SERVICE_LABELS[serviceId],
          campaignKey,
          imageUrl: BENEFIT_STATIC_IMAGE[serviceId] ?? null,
          requestCount: campaignId ? claimCountByCampaignId.get(campaignId) ?? 0 : 0,
          postalCode: null,
          address: null,
        };
      });

    const supermarketCampaignKey = CAMPAIGN_KEY_BY_SERVICE.luis_benefit_supermarket!;
    type LocationRow = { id: string; display_name: string; postal_code: string; address_text: string; official_media_url: string; campaign_id: string };
    const supermarketBusinesses: Business[] = ((locationsRes.data ?? []) as unknown as LocationRow[]).map((row) => ({
      id: `location:${row.id}`,
      kind: "supermarket_location" as const,
      name: row.display_name,
      serviceLabel: SERVICE_LABELS.luis_benefit_supermarket,
      campaignKey: supermarketCampaignKey,
      imageUrl: row.official_media_url || null,
      requestCount: claimCountByLocationId.get(row.id) ?? 0,
      postalCode: row.postal_code,
      address: row.address_text,
    }));

    setBusinesses([...merchantBusinesses, ...supermarketBusinesses, ...partnerBusinesses]);
    setLoading(false);
  }, [resolvedOrgId]);

  useEffect(() => { void load(); }, [load]);

  return { businesses, loading, error, load };
}

function humanizeServiceId(value: string): string {
  return SERVICE_LABELS[value as LuisServiceId] ?? value.replace(/^luis_/, "").replace(/_/g, " ");
}
