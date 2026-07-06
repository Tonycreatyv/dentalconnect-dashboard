import { useEffect, useMemo, useState } from "react";
import { useClinic } from "../context/ClinicContext";
import { getDetectedVerticalConfig } from "../config/verticalConfig";
import type { BusinessType } from "../config/verticalConfig";
import { supabase } from "../lib/supabaseClient";

const SELECTED_ORG_STORAGE_KEY = "selected_organization_id";
const SELECTED_BUSINESS_TYPE_STORAGE_KEY = "selected_business_type";

export const ORG_TYPE_FALLBACK: Record<string, BusinessType> = {
  "barber-demo": "barbershop",
  "barber-demo-wimaeil": "barbershop",
  "insurance-demo": "referral_hub",
  "clinic-demo": "dental",
  "creatyv-product": "dental",
  "testing-mxp0snq": "barbershop",
  "testing-mnxp0snq": "barbershop",
  "org-359ba3c4": "dental",
  "irvin-mazariegos-clinic": "dental",
};
export const ORG_NAME_FALLBACK: Record<string, string> = {
  "barber-demo": "BarberLine",
  "barber-demo-wimaeil": "Barbería WIMAEIL",
  "insurance-demo": "Luis Gabriel Referral Hub",
  "clinic-demo": "Dental Demo",
  "creatyv-product": "Creatyv Product",
  "testing-mxp0snq": "Testing Barber Demo",
  "testing-mnxp0snq": "Testing Barber Demo",
  "org-359ba3c4": "Org 359 Test",
  "irvin-mazariegos-clinic": "Irvin Mazariegos Clinic",
};
const BARBERSHOP_GENERIC_NAME_RE = /\b(cl[ií]nica|dentalconnect|dental demo|pacientes?|doctores?|dental)\b/i;
const PREFERRED_BARBERSHOP_ORGS = ["barber-demo", "testing-mxp0snq", "testing-mnxp0snq", "barber-demo-wimaeil"];
const PREFERRED_DENTAL_ORGS = ["clinic-demo", "creatyv-product", "org-359ba3c4", "irvin-mazariegos-clinic"];
const PREFERRED_REFERRAL_HUB_ORGS = ["insurance-demo"];

function readDevOverride() {
  try {
    return {
      orgId: String(localStorage.getItem(SELECTED_ORG_STORAGE_KEY) ?? "").trim(),
      businessType: String(localStorage.getItem(SELECTED_BUSINESS_TYPE_STORAGE_KEY) ?? "").trim(),
    };
  } catch {
    return { orgId: "", businessType: "" };
  }
}

function normalizeBusinessType(input: unknown): BusinessType | "" {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "barbershop") return "barbershop";
  if (raw === "insurance") return "insurance";
  if (raw === "referral_hub") return "referral_hub";
  if (raw === "dental" || raw === "clinic" || raw.includes("dental")) return "dental";
  return "";
}

function displayNameFromSettings(row: any): string {
  return String(row?.display_name ?? row?.brand_name ?? row?.name ?? "").trim();
}

export function resolveFrontendBusinessType(
  organizationId: string | null | undefined,
  candidate?: string | null,
): BusinessType {
  const orgId = String(organizationId ?? "").trim();
  const normalized = normalizeBusinessType(candidate);
  if (normalized) return normalized;
  const detectedVertical = getDetectedVerticalConfig();
  return ORG_TYPE_FALLBACK[orgId] ??
    (orgId.startsWith("barber-") ? "barbershop" : detectedVertical.businessType ?? "dental");
}

export function resolveFrontendOrgName(
  organizationId: string | null | undefined,
  businessType: BusinessType,
  candidate?: string | null,
): string {
  const orgId = String(organizationId ?? "").trim();
  if (businessType === "referral_hub" && ORG_NAME_FALLBACK[orgId]) return ORG_NAME_FALLBACK[orgId];
  if (businessType === "barbershop" && ORG_NAME_FALLBACK[orgId]) return ORG_NAME_FALLBACK[orgId];

  const name = String(candidate ?? "").trim();
  if (businessType === "barbershop") {
    if (!name || BARBERSHOP_GENERIC_NAME_RE.test(name)) return ORG_NAME_FALLBACK[orgId] ?? "Barbería";
    return name;
  }

  return name || ORG_NAME_FALLBACK[orgId] || "Clínica";
}

export function useActiveOrg() {
  const { clinic, activeOrgId, activeBusinessType, activeOrgName, isAdmin, availableOrgs } = useClinic();
  const detectedVertical = useMemo(() => getDetectedVerticalConfig(), []);
  const [override, setOverride] = useState(readDevOverride);
  const [settingsMeta, setSettingsMeta] = useState<{
    organizationId: string;
    businessType: BusinessType | "";
    name: string;
  }>({ organizationId: "", businessType: "", name: "" });

  useEffect(() => {
    const sync = () => setOverride(readDevOverride());
    window.addEventListener("dev-org-changed", sync);
    window.addEventListener("active-org-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("dev-org-changed", sync);
      window.removeEventListener("active-org-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const resolvedOrgId = useMemo(() => {
    const verticalType = detectedVertical.businessType;
    const matchesVertical = (orgId: string | null | undefined) => {
      if (!verticalType) return Boolean(orgId);
      const id = String(orgId ?? "").trim();
      if (!id) return false;
      const meta = availableOrgs.find((org) => org.organization_id === id);
      const businessType = meta?.business_type ?? resolveFrontendBusinessType(id);
      return businessType === verticalType;
    };
    const preferred = (verticalType === "barbershop"
      ? PREFERRED_BARBERSHOP_ORGS
      : verticalType === "referral_hub"
      ? PREFERRED_REFERRAL_HUB_ORGS
      : PREFERRED_DENTAL_ORGS)
      .find((id) => availableOrgs.some((org) => org.organization_id === id && (!verticalType || org.business_type === verticalType)));
    const firstMatching = availableOrgs.find((org) => !verticalType || org.business_type === verticalType)?.organization_id;
    const fallback = verticalType === "barbershop" ? "barber-demo" : verticalType === "referral_hub" ? "insurance-demo" : "clinic-demo";

    if (isAdmin && matchesVertical(override.orgId)) return override.orgId;
    if (matchesVertical(activeOrgId)) return activeOrgId;
    if (matchesVertical(clinic?.organization_id)) return clinic?.organization_id ?? fallback;
    return preferred || firstMatching || fallback;
  }, [detectedVertical.businessType, isAdmin, override.orgId, activeOrgId, clinic?.organization_id, availableOrgs]);

  useEffect(() => {
    let mounted = true;
    async function loadSettingsMeta() {
      if (!resolvedOrgId) return;

      const orgSettingsRes = await supabase
        .from("organization_settings")
        .select("*")
        .eq("organization_id", resolvedOrgId)
        .maybeSingle();
      let row = !orgSettingsRes.error ? orgSettingsRes.data : null;

      if (!row) {
        const legacyRes = await supabase
          .from("org_settings")
          .select("*")
          .eq("organization_id", resolvedOrgId)
          .maybeSingle();
        row = !legacyRes.error ? legacyRes.data : null;
      }

      if (!mounted) return;
      setSettingsMeta({
        organizationId: resolvedOrgId,
        businessType: normalizeBusinessType((row as any)?.business_type),
        name: displayNameFromSettings(row),
      });
    }
    loadSettingsMeta();
    return () => {
      mounted = false;
    };
  }, [resolvedOrgId]);

  const resolvedBusinessType = useMemo<BusinessType>(() => {
    if (detectedVertical.businessType) return detectedVertical.businessType;
    const settingsBusinessType = settingsMeta.organizationId === resolvedOrgId ? settingsMeta.businessType : "";
    if (settingsBusinessType) return settingsBusinessType;
    const raw = (isAdmin ? override.businessType : "") || activeBusinessType || "";
    if (raw === "barbershop" || raw === "dental" || raw === "insurance" || raw === "referral_hub") return raw;
    if (detectedVertical.businessType) return detectedVertical.businessType;
    return resolveFrontendBusinessType(resolvedOrgId);
  }, [settingsMeta, resolvedOrgId, isAdmin, override.businessType, activeBusinessType, detectedVertical.businessType]);

  const resolvedOrgName = useMemo(() => {
    const settingsName = settingsMeta.organizationId === resolvedOrgId ? settingsMeta.name : "";
    return resolveFrontendOrgName(
      resolvedOrgId,
      resolvedBusinessType,
      settingsName || activeOrgName || clinic?.name || "",
    );
  }, [settingsMeta, resolvedOrgId, resolvedBusinessType, activeOrgName, clinic?.name]);

  return {
    resolvedOrgId,
    resolvedBusinessType,
    resolvedOrgName,
    activeOrgId: resolvedOrgId,
    activeBusinessType: resolvedBusinessType,
    activeOrgName: resolvedOrgName,
  };
}
