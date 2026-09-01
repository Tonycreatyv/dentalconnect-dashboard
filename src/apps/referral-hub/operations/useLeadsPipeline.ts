import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { FOLLOW_UP_SERVICE_IDS } from "./useServiceFollowUps";
import { LEGAL_INTAKE_SERVICE_ID, parseLegalIntake, type LegalIntake } from "./legalIntake";
import { deriveStage, LEAD_STAGE_LABELS, type LeadStage } from "./leadStage";
import type { LuisServiceId } from "./luisCatalog";

export { LEAD_STAGE_LABELS, type LeadStage };

export type PipelineLead = {
  id: string;
  full_name: string;
  channel: string | null;
  channel_user_id: string | null;
  phone: string | null;
  created_at: string;
  last_message_at: string | null;
  updated_at: string | null;
  stage: LeadStage;
  // Parsed once here (the leads.state row is already fetched for staging)
  // so useClientes and the client-detail screen never have to re-derive
  // this from a separate query — one computation, every consumer agrees.
  legalIntake: LegalIntake | null;
  legalIntakeServiceId: LuisServiceId | null;
};

export function useLeadsPipeline() {
  const { resolvedOrgId } = useReferralOrganization();
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!resolvedOrgId) {
      setLeads([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [leadsRes, requestsRes, staffMessagesRes] = await Promise.all([
      supabase
        .from("leads")
        .select("id,full_name,first_name,last_name,channel,channel_user_id,phone,created_at,last_message_at,updated_at,last_user_reply_at,handoff_to_human,state")
        .eq("organization_id", resolvedOrgId)
        .order("updated_at", { ascending: false })
        .limit(500),
      supabase
        .from("referral_service_requests")
        .select("id,lead_id,status,created_at,referral_assignments(work_status,assigned_at)")
        .eq("organization_id", resolvedOrgId)
        .in("service_id", FOLLOW_UP_SERVICE_IDS as unknown as string[])
        .order("created_at", { ascending: false }),
      supabase
        .from("messages")
        .select("lead_id,created_at")
        .eq("organization_id", resolvedOrgId)
        .eq("actor", "staff")
        .order("created_at", { ascending: true }),
    ]);
    if (leadsRes.error) {
      setError("No se pudieron cargar los leads.");
      setLeads([]);
      setLoading(false);
      return;
    }
    type RequestRow = { lead_id: string; status: string; referral_assignments: { work_status: string | null; assigned_at: string }[] | null };
    const latestRequestByLead = new Map<string, { status: string; workStatus: string | null }>();
    for (const row of (requestsRes.data ?? []) as unknown as RequestRow[]) {
      if (latestRequestByLead.has(row.lead_id)) continue;
      const assignments = Array.isArray(row.referral_assignments) ? row.referral_assignments : [];
      const workStatus = assignments.length ? assignments[assignments.length - 1]?.work_status ?? null : null;
      latestRequestByLead.set(row.lead_id, { status: row.status, workStatus });
    }
    const earliestStaffOutreachByLead = new Map<string, string>();
    for (const row of (staffMessagesRes.data ?? []) as unknown as { lead_id: string | null; created_at: string }[]) {
      if (!row.lead_id || earliestStaffOutreachByLead.has(row.lead_id)) continue;
      earliestStaffOutreachByLead.set(row.lead_id, row.created_at);
    }
    type LeadRow = {
      id: string; full_name: string | null; first_name: string | null; last_name: string | null;
      channel: string | null; channel_user_id: string | null; phone: string | null;
      created_at: string; last_message_at: string | null; updated_at: string | null; last_user_reply_at: string | null;
      handoff_to_human: boolean; state: unknown;
    };
    const rows: PipelineLead[] = ((leadsRes.data ?? []) as unknown as LeadRow[]).map((row) => {
      const request = latestRequestByLead.get(row.id) ?? null;
      const name = row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Cliente";
      const legalIntake = parseLegalIntake(row.state);
      return {
        id: row.id,
        full_name: name,
        channel: row.channel,
        channel_user_id: row.channel_user_id,
        phone: row.phone,
        created_at: row.created_at,
        last_message_at: row.last_message_at,
        updated_at: row.updated_at,
        legalIntake,
        legalIntakeServiceId: legalIntake ? LEGAL_INTAKE_SERVICE_ID[legalIntake.intakeType] : null,
        stage: deriveStage({
          lastUserReplyAt: row.last_user_reply_at,
          staffOutreachAt: earliestStaffOutreachByLead.get(row.id) ?? null,
          requestStatus: request?.status ?? null,
          workStatus: request?.workStatus ?? null,
          hasCompletedLegalIntake: Boolean(legalIntake),
        }),
      };
    });
    setLeads(rows);
    setLoading(false);
  }, [resolvedOrgId]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const base: Record<LeadStage, number> = { nuevo: 0, por_contactar: 0, contactado: 0, respondio: 0, confirmado: 0, cerrado: 0 };
    for (const lead of leads) base[lead.stage] += 1;
    return base;
  }, [leads]);

  return { leads, counts, loading, error, load };
}
