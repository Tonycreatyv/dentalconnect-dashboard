import { useEffect, useMemo, useState } from "react";
import { useClinic } from "../context/ClinicContext";
import { getDetectedVerticalConfig } from "../config/verticalConfig";
import { supabase } from "../lib/supabaseClient";

const SELECTED_ORG_STORAGE_KEY = "selected_organization_id";
const SELECTED_BUSINESS_TYPE_STORAGE_KEY = "selected_business_type";

export const ORG_TYPE_FALLBACK: Record<string, "dental" | "barbershop"> = {
  "barber-demo": "barbershop",
  "barber-demo-wimaeil": "barbershop",
  "clinic-demo": "dental",
  "creatyv-product": "dental",
  "testing-mxp0snq": "barbershop",
  "testing-mnxp0snq": "barbershop",
  "org-359ba3c4": "dental",
  "irvin-mazariegos-clinic": "dental",
};
export const ORG_NAME_FALLBACK: Record<string, string> = {
  "barber-demo": "Barbería Premium 504",
  "barber-demo-wimaeil": "Barbería WIMAEIL",
  "clinic-demo": "Dental Demo",
  "creatyv-product": "Creatyv Product",
  "testing-mxp0snq": "Testing Barber Demo",
  "testing-mnxp0snq": "Testing Barber Demo",
  "org-359ba3c4": "Org 359 Test",
  "irvin-mazariegos-clinic": "Irvin Mazariegos Clinic",
};
const BARBERSHOP_GENERIC_NAME_RE = /\b(cl[ií]nica|dentalconnect|dental demo|pacientes?|doctores?|dental)\b/i;

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

function normalizeBusinessType(input: unknown): "dental" | "barbershop" | "" {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "barbershop") return "barbershop";
  if (raw === "dental" || raw === "clinic" || raw.includes("dental")) return "dental";
  return "";
}

function displayNameFromSettings(row: any): string {
  return String(row?.display_name ?? row?.brand_name ?? row?.name ?? "").trim();
}

export function resolveFrontendBusinessType(
  organizationId: string | null | undefined,
  candidate?: string | null,
): "dental" | "barbershop" {
  const orgId = String(organizationId ?? "").trim();
  const normalized = normalizeBusinessType(candidate);
  if (normalized) return normalized;
  const detectedVertical = getDetectedVerticalConfig();
  return ORG_TYPE_FALLBACK[orgId] ??
    (orgId.startsWith("barber-") ? "barbershop" : detectedVertical.businessType ?? "dental");
}

export function resolveFrontendOrgName(
  organizationId: string | null | undefined,
  businessType: "dental" | "barbershop",
  candidate?: string | null,
): string {
  const orgId = String(organizationId ?? "").trim();
  if (businessType === "barbershop" && ORG_NAME_FALLBACK[orgId]) return ORG_NAME_FALLBACK[orgId];

  const name = String(candidate ?? "").trim();
  if (businessType === "barbershop") {
    if (!name || BARBERSHOP_GENERIC_NAME_RE.test(name)) return ORG_NAME_FALLBACK[orgId] ?? "Barbería";
    return name;
  }

  return name || ORG_NAME_FALLBACK[orgId] || "Clínica";
}

export function useActiveOrg() {
  const { clinic, activeOrgId, activeBusinessType, activeOrgName, isAdmin } = useClinic();
  const detectedVertical = useMemo(() => getDetectedVerticalConfig(), []);
  const [override, setOverride] = useState(readDevOverride);
  const [settingsMeta, setSettingsMeta] = useState<{
    organizationId: string;
    businessType: "dental" | "barbershop" | "";
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
    if (isAdmin && override.orgId) return override.orgId;
    return activeOrgId ?? clinic?.organization_id ?? "clinic-demo";
  }, [isAdmin, override.orgId, activeOrgId, clinic?.organization_id]);

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

  const resolvedBusinessType = useMemo<"dental" | "barbershop">(() => {
    const settingsBusinessType = settingsMeta.organizationId === resolvedOrgId ? settingsMeta.businessType : "";
    if (settingsBusinessType) return settingsBusinessType;
    const raw = (isAdmin ? override.businessType : "") || activeBusinessType || "";
    if (raw === "barbershop" || raw === "dental") return raw;
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
