import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { useLeadsPipeline, type PipelineLead } from "./useLeadsPipeline";
import { SERVICE_BY_CAMPAIGN_KEY, SERVICE_LABELS, type LuisServiceId } from "./luisCatalog";

export type Cliente = PipelineLead & {
  serviceId: LuisServiceId | null;
  serviceLabel: string | null;
  campaignKey: string | null;
  postalCode: string | null;
  couponSummary: string | null;
};

export function useClientes() {
  const { resolvedOrgId } = useReferralOrganization();
  const pipeline = useLeadsPipeline();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loadingAssociations, setLoadingAssociations] = useState(true);

  const loadAssociations = useCallback(async () => {
    if (!resolvedOrgId || pipeline.leads.length === 0) {
      setClientes(pipeline.leads.map((lead) => ({ ...lead, serviceId: null, serviceLabel: null, campaignKey: null, postalCode: null, couponSummary: null })));
      setLoadingAssociations(false);
      return;
    }
    setLoadingAssociations(true);
    const [claimsRes, requestsRes] = await Promise.all([
      supabase.from("referral_benefit_claims")
        .select("lead_id,postal_code,requested_at,referral_coupon_campaigns(campaign_key,display_name,service_id)")
        .eq("organization_id", resolvedOrgId)
        .order("requested_at", { ascending: false }),
      supabase.from("referral_service_requests")
        .select("lead_id,service_id,postal_code,created_at")
        .eq("organization_id", resolvedOrgId)
        .order("created_at", { ascending: false }),
    ]);
    type ClaimRow = { lead_id: string; postal_code: string | null; referral_coupon_campaigns: { campaign_key: string; display_name: string; service_id: string } | null };
    type RequestRow = { lead_id: string; service_id: string; postal_code: string | null };
    const latestClaimByLead = new Map<string, ClaimRow>();
    for (const row of (claimsRes.data ?? []) as unknown as ClaimRow[]) {
      if (!latestClaimByLead.has(row.lead_id)) latestClaimByLead.set(row.lead_id, row);
    }
    const latestRequestByLead = new Map<string, RequestRow>();
    for (const row of (requestsRes.data ?? []) as unknown as RequestRow[]) {
      if (!latestRequestByLead.has(row.lead_id)) latestRequestByLead.set(row.lead_id, row);
    }
    setClientes(pipeline.leads.map((lead) => {
      const claim = latestClaimByLead.get(lead.id);
      const request = latestRequestByLead.get(lead.id);
      const claimServiceId = claim?.referral_coupon_campaigns?.service_id ?? null;
      // Same three sources, same priority order, as loadRealServiceRows in
      // negocios/realDataSource.ts (the Servicios count): a benefit claim,
      // then the canonical Flow-driven legal intake (leads.state.collected.
      // luis_legal_last_completed, already parsed once in useLeadsPipeline),
      // then the legacy referral_service_requests row. Both the count and
      // this list read parseLegalIntake/LEGAL_INTAKE_SERVICE_ID for the
      // professional-service case, so a real immigration/accident/DUI
      // consultation from the live Flow can never show up in the Servicios
      // count while being invisible here.
      const serviceId = (claimServiceId as LuisServiceId | null)
        ?? lead.legalIntakeServiceId
        ?? (request?.service_id as LuisServiceId | null)
        ?? null;
      return {
        ...lead,
        serviceId,
        serviceLabel: serviceId ? SERVICE_LABELS[serviceId] ?? null : null,
        campaignKey: claim?.referral_coupon_campaigns?.campaign_key ?? null,
        postalCode: claim?.postal_code ?? request?.postal_code ?? null,
        couponSummary: claim?.referral_coupon_campaigns?.display_name ?? null,
      };
    }));
    setLoadingAssociations(false);
  }, [resolvedOrgId, pipeline.leads]);

  useEffect(() => { void loadAssociations(); }, [loadAssociations]);

  return {
    clientes,
    loading: pipeline.loading || loadingAssociations,
    error: pipeline.error,
    counts: pipeline.counts,
  };
}

export function serviceIdForCampaignKey(campaignKey: string): LuisServiceId | null {
  return SERVICE_BY_CAMPAIGN_KEY[campaignKey] ?? null;
}
