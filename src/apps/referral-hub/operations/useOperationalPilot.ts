/* eslint-disable @typescript-eslint/no-explicit-any -- adapter rows span multiple production tables */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

export type PilotData = {
  requests: any[];
  assignments: any[];
  notifications: any[];
  exceptions: any[];
  partners: any[];
  contacts: any[];
  locations: any[];
  offers: BasketOfferRecord[];
  events: any[];
  campaigns: any[];
  couponDeliveries: any[];
  rules: any[];
  notes: any[];
  conversationOperations: any[];
  deliveryCoverage: DeliveryCoverageRecord[];
};
export type DeliveryCoverageRecord = {
  id: string;
  organization_id: string;
  partner_location_id: string;
  postal_code: string;
  active: boolean;
  priority: number;
};
export type BasketOfferRecord = {
  id: string;
  organization_id: string;
  partner_location_id: string;
  basket_key: "essential" | "family" | "complete";
  display_name: string;
  price_cents: number;
  currency: string;
  active: boolean;
  contents_snapshot: unknown;
};
const EMPTY: PilotData = {
  requests: [],
  assignments: [],
  notifications: [],
  exceptions: [],
  partners: [],
  contacts: [],
  locations: [],
  offers: [],
  events: [],
  campaigns: [],
  couponDeliveries: [],
  rules: [],
  notes: [],
  conversationOperations: [],
  deliveryCoverage: [],
};

export function useOperationalPilot() {
  const { resolvedOrgId, membershipRole } = useReferralOrganization();
  const [data, setData] = useState<PilotData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [configurationPending, setConfigurationPending] = useState(false);
  const [error, setError] = useState("");
  const [queryErrors, setQueryErrors] = useState<Record<string, string>>({});
  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!resolvedOrgId) {
      setData(EMPTY);
      setError("La organización no está disponible.");
      setLoading(false);
      return;
    }
    if (!options?.silent) setLoading(true);
    setError("");
    const specs = [
      ["requests", "referral_service_requests"],
      ["assignments", "referral_assignments"],
      ["notifications", "referral_notification_attempts"],
      ["exceptions", "referral_operational_exceptions"],
      ["partners", "referral_partners"],
      ["contacts", "referral_partner_contacts"],
      ["locations", "referral_partner_locations"],
      ["offers", "referral_basket_offers"],
      ["events", "referral_operational_events"],
      ["campaigns", "referral_coupon_campaigns"],
      ["couponDeliveries", "referral_coupon_delivery_events"],
      ["rules", "referral_partner_service_rules"],
      ["notes", "referral_internal_notes"],
      ["conversationOperations", "referral_conversation_operations"],
      ["deliveryCoverage", "referral_grocery_delivery_coverage"],
    ] as const;
    const results = await Promise.all(
      specs.map(async ([key, table]) => ({
        key,
        result: await supabase.from(table).select("*").eq(
          "organization_id",
          resolvedOrgId,
        ).limit(500),
      })),
    );
    const next = { ...EMPTY } as PilotData;
    let pending = false;
    const failures: Record<string, string> = {};
    for (const { key, result } of results) {
      if (result.error) {
        failures[key] = result.error.message;
        if (
          /relation .* does not exist|schema cache/i.test(result.error.message)
        ) pending = true;
      } else (next[key] as any[]) = result.data ?? [];
    }
    if (Object.keys(failures).length) {
      console.warn("[Referral Hub] Fallaron fuentes operativas", {
        organizationId: resolvedOrgId,
        sources: Object.keys(failures),
      });
    }
    setData(next);
    setQueryErrors(failures);
    setConfigurationPending(pending);
    setError(Object.keys(failures).length ? "No se pudieron cargar todos los datos operativos." : "");
    if (!options?.silent) setLoading(false);
  }, [resolvedOrgId]);
  useEffect(() => {
    void load();
    const refresh = () => void load({ silent: true });
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const metrics = useMemo(() => ({
    prequalified: data.requests.filter((r) =>
      ["prequalified", "qualified"].includes(r.status)
    ).length,
    awaitingAcceptance: data.assignments.filter((a) =>
      a.status === "assigned"
    ).length,
    failedNotifications: data.notifications.filter((n) =>
      n.status === "failed"
    ).length,
    openExceptions: data.exceptions.filter((e) => e.status === "open").length,
    overdue: data.assignments.filter((a) =>
      a.status === "assigned" && a.acceptance_deadline &&
      +new Date(a.acceptance_deadline) < Date.now()
    ).length,
  }), [data]);
  const saveDeliveryCoverage = useCallback(async (input: {
    partnerLocationId: string;
    postalCode: string;
    priority: number;
    active?: boolean;
  }) => {
    if (!resolvedOrgId) return { error: "Organización no disponible." };
    const postalCode = input.postalCode.trim();
    if (!/^\d{5}$/.test(postalCode)) {
      return { error: "Escribe un ZIP válido de cinco dígitos." };
    }
    const result = await supabase.from("referral_grocery_delivery_coverage")
      .upsert({
        organization_id: resolvedOrgId,
        partner_location_id: input.partnerLocationId,
        postal_code: postalCode,
        priority: input.priority,
        active: input.active ?? true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,partner_location_id,postal_code" });
    if (result.error) return { error: "No se pudo guardar la cobertura." };
    await load();
    return { error: "" };
  }, [load, resolvedOrgId]);
  const removeDeliveryCoverage = useCallback(async (id: string) => {
    const result = await supabase.from("referral_grocery_delivery_coverage")
      .delete().eq("id", id).eq("organization_id", resolvedOrgId);
    if (result.error) return { error: "No se pudo eliminar la cobertura." };
    await load();
    return { error: "" };
  }, [load, resolvedOrgId]);
  return {
    ...data,
    metrics,
    loading,
    configurationPending,
    error,
    queryErrors,
    membershipRole,
    operationalAccessError: membershipRole && !["owner", "admin"].includes(membershipRole)
      ? "Tu membresía no permite consultar la operación administrativa."
      : "",
    load,
    saveDeliveryCoverage,
    removeDeliveryCoverage,
  };
}
