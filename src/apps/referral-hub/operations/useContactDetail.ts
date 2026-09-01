import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { type LegalIntake, legalTopicLabel, parseLegalIntake } from "./legalIntake";

export { legalTopicLabel };

export type ContactLead = {
  id: string;
  full_name: string;
  channel: string | null;
  channel_user_id: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string | null;
  last_message_at: string | null;
};

export type ContactCoupon = {
  id: string;
  claim_code: string;
  status: "REQUESTED" | "ISSUED" | "REDEEMED";
  postal_code: string;
  requested_at: string;
  campaign_label: string;
  businessName: string | null;
  email: string | null;
  email_marketing_opt_in: boolean;
};

export type ContactServiceRequest = {
  id: string;
  service_id: string;
  status: string;
  postal_code: string | null;
  created_at: string;
  businessName: string | null;
};

// Re-exported for existing callers — the real parsing logic now lives in
// ./legalIntake.ts so it can be shared with realDataSource.ts's service
// counts without a hook-file importing another hook-file.
export type ContactLegalIntake = LegalIntake;

export function useContactDetail(leadId: string | undefined) {
  const { resolvedOrgId } = useReferralOrganization();
  const [lead, setLead] = useState<ContactLead | null>(null);
  const [coupons, setCoupons] = useState<ContactCoupon[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ContactServiceRequest[]>([]);
  const [legalIntake, setLegalIntake] = useState<ContactLegalIntake | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!resolvedOrgId || !leadId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [leadRes, couponsRes, requestsRes] = await Promise.all([
      supabase.from("leads").select("id,full_name,first_name,last_name,channel,channel_user_id,phone,created_at,updated_at,last_message_at,state")
        .eq("id", leadId).eq("organization_id", resolvedOrgId).maybeSingle(),
      supabase.from("referral_benefit_claims").select("id,claim_code,status,postal_code,requested_at,email,email_marketing_opt_in,referral_coupon_campaigns(display_name,business_id)")
        .eq("lead_id", leadId).eq("organization_id", resolvedOrgId).order("requested_at", { ascending: false }),
      supabase.from("referral_service_requests").select("id,service_id,status,postal_code,created_at")
        .eq("lead_id", leadId).eq("organization_id", resolvedOrgId).order("created_at", { ascending: false }),
    ]);
    const requestIds = ((requestsRes.data ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);
    const assignmentsRes = requestIds.length
      ? await supabase.from("referral_assignments").select("request_id,partner_id").in("request_id", requestIds).eq("organization_id", resolvedOrgId)
      : { data: [] as Array<{ request_id: string; partner_id: string }> };
    const businessIds = new Set<string>();
    for (const row of (couponsRes.data ?? []) as unknown as Array<{ referral_coupon_campaigns: { business_id: string | null } | null }>) {
      if (row.referral_coupon_campaigns?.business_id) businessIds.add(row.referral_coupon_campaigns.business_id);
    }
    const assignmentByRequest = new Map<string, string>();
    for (const row of (assignmentsRes.data ?? []) as unknown as Array<{ request_id: string; partner_id: string }>) {
      if (!assignmentByRequest.has(row.request_id)) assignmentByRequest.set(row.request_id, row.partner_id);
      businessIds.add(row.partner_id);
    }
    const partnersRes = businessIds.size
      ? await supabase.from("referral_partners").select("id,name").in("id", [...businessIds])
      : { data: [] as Array<{ id: string; name: string }> };
    const partnerNameById = new Map<string, string>();
    for (const row of (partnersRes.data ?? []) as unknown as Array<{ id: string; name: string }>) {
      partnerNameById.set(row.id, row.name);
    }
    if (leadRes.error || !leadRes.data) {
      setError("No se pudo cargar este contacto.");
      setLoading(false);
      return;
    }
    const row = leadRes.data as unknown as {
      id: string; full_name: string | null; first_name: string | null; last_name: string | null;
      channel: string | null; channel_user_id: string | null; phone: string | null;
      created_at: string; updated_at: string | null; last_message_at: string | null; state: unknown;
    };
    setLead({
      id: row.id,
      full_name: row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Cliente",
      channel: row.channel,
      channel_user_id: row.channel_user_id,
      phone: row.phone,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_message_at: row.last_message_at,
    });
    setLegalIntake(parseLegalIntake(row.state));
    const couponRows = (couponsRes.data ?? []) as unknown as Array<{
      id: string; claim_code: string; status: ContactCoupon["status"]; postal_code: string;
      requested_at: string; email: string | null; email_marketing_opt_in: boolean;
      referral_coupon_campaigns: { display_name: string | null; business_id: string | null } | null;
    }>;
    setCoupons(couponRows.map((item) => ({
      id: item.id,
      claim_code: item.claim_code,
      status: item.status,
      postal_code: item.postal_code,
      requested_at: item.requested_at,
      campaign_label: item.referral_coupon_campaigns?.display_name || "Beneficio",
      businessName: item.referral_coupon_campaigns?.business_id
        ? partnerNameById.get(item.referral_coupon_campaigns.business_id) ?? null
        : null,
      email: item.email,
      email_marketing_opt_in: item.email_marketing_opt_in,
    })));
    const requestRows = (requestsRes.data ?? []) as unknown as Array<{
      id: string; service_id: string; status: string; postal_code: string | null; created_at: string;
    }>;
    setServiceRequests(requestRows.map((item) => ({
      id: item.id,
      service_id: item.service_id,
      status: item.status,
      postal_code: item.postal_code,
      created_at: item.created_at,
      businessName: (() => {
        const partnerId = assignmentByRequest.get(item.id);
        return partnerId ? partnerNameById.get(partnerId) ?? null : null;
      })(),
    })));
    setLoading(false);
  }, [resolvedOrgId, leadId]);

  useEffect(() => { void load(); }, [load]);

  return { lead, coupons, serviceRequests, legalIntake, loading, error };
}
