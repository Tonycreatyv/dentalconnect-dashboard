import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import {
  BENEFIT_MERCHANT_NAME,
  BENEFIT_SERVICE_IDS,
  BENEFIT_STATIC_IMAGE,
  CAMPAIGN_KEY_BY_SERVICE,
  SERVICE_BY_CAMPAIGN_KEY,
  SERVICE_LABELS,
  type LuisServiceId,
} from "./luisCatalog";

export type CampaignDestination = "menu" | LuisServiceId;

export const DESTINATION_LABELS: Record<CampaignDestination, string> = {
  menu: "Menú completo",
  ...SERVICE_LABELS,
};

export function campaignKeyForDestination(destination: CampaignDestination): string | null {
  return destination === "menu" ? null : CAMPAIGN_KEY_BY_SERVICE[destination] ?? null;
}

export type QrCampaign = {
  id: string;
  publicCode: string;
  entryType: "general" | "service" | "campaign" | "location";
  campaignKey: string | null;
  destination: CampaignDestination;
  active: boolean;
  attributionLabel: string | null;
  createdAt: string;
  entriesCount: number;
  requestsCount: number;
  imageUrl: string | null;
  businessLabel: string | null;
};

function destinationFor(campaignKey: string | null, entryType: string): CampaignDestination {
  if (entryType === "general" || !campaignKey) return "menu";
  return SERVICE_BY_CAMPAIGN_KEY[campaignKey] ?? "menu";
}

export function useQrCampaigns() {
  const { resolvedOrgId } = useReferralOrganization();
  const [campaigns, setCampaigns] = useState<QrCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!resolvedOrgId) {
      setCampaigns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const entriesRes = await supabase
      .from("referral_qr_entries")
      .select("id,public_code,entry_type,campaign_key,active,attribution_label,created_at")
      .eq("organization_id", resolvedOrgId)
      .order("created_at", { ascending: false });
    if (entriesRes.error) {
      setError("No se pudieron cargar las campañas.");
      setCampaigns([]);
      setLoading(false);
      return;
    }
    type EntryRow = {
      id: string; public_code: string; entry_type: QrCampaign["entryType"];
      campaign_key: string | null; active: boolean; attribution_label: string | null; created_at: string;
    };
    const entryRows = (entriesRes.data ?? []) as unknown as EntryRow[];

    const [visitsRes, claimsRes, locationsRes] = await Promise.all([
      supabase
        .from("referral_operational_events")
        .select("metadata")
        .eq("organization_id", resolvedOrgId)
        .eq("event_type", "referral_qr_entry_resolved"),
      supabase
        .from("referral_benefit_claims")
        .select("lead_id,requested_at,leads(extracted_data)")
        .eq("organization_id", resolvedOrgId),
      supabase
        .from("referral_benefit_campaign_locations")
        .select("id")
        .eq("organization_id", resolvedOrgId)
        .eq("active", true),
    ]);
    const supermarketLocationCount = (locationsRes.data ?? []).length;
    const visitCountByCode = new Map<string, number>();
    if (!visitsRes.error) {
      for (const row of (visitsRes.data ?? []) as unknown as { metadata: Record<string, unknown> | null }[]) {
        const publicCode = typeof row.metadata?.public_code === "string" ? row.metadata.public_code : "";
        if (!publicCode) continue;
        visitCountByCode.set(publicCode, (visitCountByCode.get(publicCode) ?? 0) + 1);
      }
    }
    // Heuristic attribution: a claim is attributable to a QR entry when the
    // lead's CURRENT stored qr_entry context (set on the most recent scan,
    // see luisQrCampaign.ts::withLuisQrAttribution) matches that entry's
    // public_code and the claim was requested at/after the entry existed.
    // This is directional, not a permanent point-in-time record - see the
    // durable migration draft for the precise version.
    const requestCountByCode = new Map<string, number>();
    if (!claimsRes.error) {
      type ClaimRow = { requested_at: string; leads: { extracted_data: Record<string, unknown> | null } | null };
      for (const row of (claimsRes.data ?? []) as unknown as ClaimRow[]) {
        const qrEntry = row.leads?.extracted_data?.qr_entry as { public_code?: string } | undefined;
        const publicCode = qrEntry?.public_code;
        if (!publicCode) continue;
        requestCountByCode.set(publicCode, (requestCountByCode.get(publicCode) ?? 0) + 1);
      }
    }

    setCampaigns(entryRows.map((row) => {
      const destination = destinationFor(row.campaign_key, row.entry_type);
      const isBenefit = (BENEFIT_SERVICE_IDS as string[]).includes(destination);
      const businessLabel = destination === "luis_benefit_supermarket"
        ? `${supermarketLocationCount} ${supermarketLocationCount === 1 ? "ubicación participante" : "ubicaciones participantes"}`
        : isBenefit ? BENEFIT_MERCHANT_NAME[destination as LuisServiceId] ?? null : null;
      return {
        id: row.id,
        publicCode: row.public_code,
        entryType: row.entry_type,
        campaignKey: row.campaign_key,
        destination,
        active: row.active,
        attributionLabel: row.attribution_label,
        createdAt: row.created_at,
        entriesCount: visitCountByCode.get(row.public_code) ?? 0,
        requestsCount: requestCountByCode.get(row.public_code) ?? 0,
        imageUrl: isBenefit ? BENEFIT_STATIC_IMAGE[destination as LuisServiceId] ?? null : null,
        businessLabel,
      };
    }));
    setLoading(false);
  }, [resolvedOrgId]);

  useEffect(() => { void load(); }, [load]);

  const createCampaign = useCallback(async (input: { name: string; destination: CampaignDestination }) => {
    if (!resolvedOrgId) return { ok: false, message: "La organización no está disponible." };
    if (!input.name.trim()) return { ok: false, message: "El nombre de la campaña es obligatorio." };
    setSaving(true);
    const campaignKey = campaignKeyForDestination(input.destination);
    const result = await supabase.from("referral_qr_entries").insert({
      organization_id: resolvedOrgId,
      entry_type: campaignKey ? "campaign" : "general",
      campaign_key: campaignKey,
      attribution_label: input.name.trim(),
      attribution_source: "dashboard_campaign",
      active: true,
    }).select("id").maybeSingle();
    setSaving(false);
    if (result.error || !result.data) return { ok: false, message: "No se pudo crear la campaña." };
    await load();
    return { ok: true };
  }, [resolvedOrgId, load]);

  const setActive = useCallback(async (id: string, active: boolean) => {
    if (!resolvedOrgId) return { ok: false, message: "La organización no está disponible." };
    const result = await supabase.from("referral_qr_entries")
      .update({ active })
      .eq("id", id)
      .eq("organization_id", resolvedOrgId);
    if (result.error) return { ok: false, message: "No se pudo actualizar el estado." };
    await load();
    return { ok: true };
  }, [resolvedOrgId, load]);

  const renameCampaign = useCallback(async (id: string, name: string) => {
    if (!resolvedOrgId || !name.trim()) return { ok: false, message: "El nombre no puede estar vacío." };
    const result = await supabase.from("referral_qr_entries")
      .update({ attribution_label: name.trim() })
      .eq("id", id)
      .eq("organization_id", resolvedOrgId);
    if (result.error) return { ok: false, message: "No se pudo actualizar el nombre." };
    await load();
    return { ok: true };
  }, [resolvedOrgId, load]);

  const totals = useMemo(() => ({
    entries: campaigns.reduce((sum, c) => sum + c.entriesCount, 0),
    requests: campaigns.reduce((sum, c) => sum + c.requestsCount, 0),
  }), [campaigns]);

  return { campaigns, totals, loading, error, saving, load, createCampaign, setActive, renameCampaign };
}
