import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { useAuth } from "../context/AuthContext";
import type { ReferralAssignmentSyncWarning, ReferralLead, ReferralPartner, ReferralService, ReferralStatus } from "./types";

export function useReferralData() {
  const { resolvedOrgId, resolvedBusinessType } = useActiveOrg();
  const { user } = useAuth();
  const organizationId = resolvedBusinessType === "referral_hub" ? resolvedOrgId : null;
  const [leads, setLeads] = useState<ReferralLead[]>([]);
  const [services, setServices] = useState<Record<string, ReferralService>>({});
  const [partners, setPartners] = useState<Record<string, ReferralPartner>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<ReferralAssignmentSyncWarning | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setLeads([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [leadRes, serviceRes, partnerRes] = await Promise.all([
      supabase.from("leads").select("*").eq("organization_id", organizationId).not("service_id", "is", null).order("created_at", { ascending: false }),
      supabase.from("service_configs").select("id, nombre, menu_label, icono").eq("organization_id", organizationId),
      supabase.from("partners").select("id, nombre, servicios").eq("organization_id", organizationId),
    ]);
    if (leadRes.error) {
      setError("No pudimos cargar los leads. Intenta de nuevo.");
      setLoading(false);
      return;
    }
    setLeads((leadRes.data ?? []) as ReferralLead[]);
    setServices(Object.fromEntries(((serviceRes.data ?? []) as ReferralService[]).map((item) => [item.id, item])));
    setPartners(Object.fromEntries(((partnerRes.data ?? []) as ReferralPartner[]).map((item) => [item.id, item])));
    setLoading(false);
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const updateStatus = useCallback(async (leadId: string, status: ReferralStatus) => {
    if (!organizationId) return { ok: false, message: "La organización no está disponible." };
    const result = await supabase.from("leads").update({ status }).eq("id", leadId).eq("organization_id", organizationId).select("*").maybeSingle();
    if (result.error || !result.data) return { ok: false, message: "No pudimos actualizar el estado." };
    const updated = result.data as ReferralLead;
    setLeads((current) => current.map((lead) => lead.id === leadId ? updated : lead));
    return { ok: true, lead: updated };
  }, [organizationId]);

  const assignPartner = useCallback(async (lead: ReferralLead, partnerId: string) => {
    if (!organizationId || lead.organization_id !== organizationId) return { ok: false, message: "La organización del lead no coincide." };
    const assignment = await supabase.from("lead_assignments").insert({
      lead_id: lead.id,
      partner_id: partnerId,
      organization_id: organizationId,
      asignado_por: user?.id ?? null,
      resumen_enviado: lead.resumen_auto ?? null,
      estado: "assigned",
    }).select("id").maybeSingle();
    if (assignment.error || !assignment.data?.id) return { ok: false, message: "No pudimos asignar el aliado. No se cambió el lead." };
    const assignmentId = String(assignment.data.id);
    const update = await supabase.from("leads").update({ status: "sent_to_partner", partner_recomendado: partnerId }).eq("id", lead.id).eq("organization_id", organizationId).select("*").maybeSingle();
    if (update.error || !update.data) {
      setSyncWarning({ assignmentId, leadId: lead.id, partnerId });
      await load();
      return { ok: false, partial: true, assignmentId, message: "El aliado quedó asignado, pero el estado del lead no se sincronizó." };
    }
    setSyncWarning(null);
    const updated = update.data as ReferralLead;
    setLeads((current) => current.map((item) => item.id === lead.id ? updated : item));
    return { ok: true, lead: updated, assignmentId };
  }, [load, organizationId, user?.id]);

  const retryAssignmentSync = useCallback(async () => {
    if (!organizationId || !syncWarning) return { ok: false, message: "No hay una sincronización pendiente." };
    const update = await supabase.from("leads").update({ status: "sent_to_partner", partner_recomendado: syncWarning.partnerId }).eq("id", syncWarning.leadId).eq("organization_id", organizationId).select("*").maybeSingle();
    if (update.error || !update.data) return { ok: false, message: "La sincronización todavía no pudo completarse." };
    setSyncWarning(null);
    await load();
    return { ok: true };
  }, [load, organizationId, syncWarning]);

  return useMemo(() => ({
    organizationId,
    isReferralMode: resolvedBusinessType === "referral_hub",
    leads, services, partners, loading, error, syncWarning,
    load, updateStatus, assignPartner, retryAssignmentSync,
  }), [organizationId, resolvedBusinessType, leads, services, partners, loading, error, syncWarning, load, updateStatus, assignPartner, retryAssignmentSync]);
}
