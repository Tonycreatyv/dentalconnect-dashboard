import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient"; // IMPORTANT: usa UN solo client
import { useAuth } from "./AuthContext";
import { getDetectedVerticalConfig, type BusinessType } from "../config/verticalConfig";

const ACTIVE_ORG_STORAGE_KEY = "active_org_id";
const SELECTED_ORG_STORAGE_KEY = "selected_organization_id";
const SELECTED_BUSINESS_TYPE_STORAGE_KEY = "selected_business_type";
const PLATFORM_ADMIN_EMAILS = new Set(["joseduran1791@gmail.com"]);
type FrontendBusinessType = BusinessType;

const ORG_TYPE_FALLBACK: Record<string, FrontendBusinessType> = {
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
const ORG_NAME_FALLBACK: Record<string, string> = {
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

export type ClinicProfile = {
  id: string;
  name: string | null;
  domain: string | null;
  organization_id?: string | null;
};

type OrgOption = {
  organization_id: string;
  role?: string | null;
  business_type?: FrontendBusinessType | null;
  name?: string | null;
};

type ClinicContextValue = {
  clinic: ClinicProfile | null;
  clinicId: string | null;
  activeOrgId: string | null;
  activeBusinessType: FrontendBusinessType | null;
  activeOrgName: string | null;
  isAdmin: boolean;
  availableOrgs: OrgOption[];
  loading: boolean;

  // ✅ setters para Settings / onboarding
  setClinic: React.Dispatch<React.SetStateAction<ClinicProfile | null>>;
  setClinicId: (id: string | null) => void;
  setActiveOrgId: (organizationId: string) => Promise<void>;
};

function fallbackBusinessType(organizationId: string): BusinessType {
  const detectedVertical = getDetectedVerticalConfig();
  return ORG_TYPE_FALLBACK[organizationId] ??
    (organizationId.startsWith("barber-") ? "barbershop" : detectedVertical.businessType ?? "dental");
}

function safeOrgName(
  organizationId: string,
  businessType: FrontendBusinessType,
  candidate?: string | null,
): string {
  if (businessType === "referral_hub" && ORG_NAME_FALLBACK[organizationId]) return ORG_NAME_FALLBACK[organizationId];
  if (businessType === "barbershop" && ORG_NAME_FALLBACK[organizationId]) return ORG_NAME_FALLBACK[organizationId];
  const name = String(candidate ?? "").trim();
  if (businessType === "barbershop") {
    if (!name || BARBERSHOP_GENERIC_NAME_RE.test(name)) return ORG_NAME_FALLBACK[organizationId] ?? "Barbería";
    return name;
  }
  return name || ORG_NAME_FALLBACK[organizationId] || "Clínica";
}

const ClinicContext = createContext<ClinicContextValue | undefined>(undefined);

export function ClinicProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const detectedVertical = useMemo(() => getDetectedVerticalConfig(), []);

  const [clinic, setClinic] = useState<ClinicProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [availableOrgs, setAvailableOrgs] = useState<OrgOption[]>([]);
  const [activeBusinessType, setActiveBusinessType] = useState<FrontendBusinessType | null>(null);
  const [activeOrgName, setActiveOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const clinicId = clinic?.id ?? null;
  const activeOrgId = clinic?.organization_id ?? null;

  const setClinicId = (id: string | null) => {
    setClinic((prev) => {
      if (!id) return null;
      if (prev?.id === id) return prev;
      return { id, name: prev?.name ?? null, domain: prev?.domain ?? null, organization_id: prev?.organization_id ?? null };
    });
  };

  async function resolveClinicByOrg(organizationId: string): Promise<ClinicProfile | null> {
    const found = await supabase
      .from("clinics")
      .select("id, name, domain, organization_id")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!found.error && found.data?.id) {
      return {
        id: found.data.id,
        name: found.data.name ?? null,
        domain: found.data.domain ?? null,
        organization_id: found.data.organization_id ?? organizationId,
      };
    }

    const fallbackType = fallbackBusinessType(organizationId);
    const fallbackName = safeOrgName(organizationId, fallbackType, null);
    const created = await supabase
      .from("clinics")
      .insert({ name: fallbackName, organization_id: organizationId })
      .select("id, name, domain, organization_id")
      .maybeSingle();

    if (created.error || !created.data?.id) return null;

    return {
      id: created.data.id,
      name: created.data.name ?? fallbackName,
      domain: created.data.domain ?? null,
      organization_id: created.data.organization_id ?? organizationId,
    };
  }

  const setActiveOrgId = async (organizationId: string) => {
    const org = String(organizationId ?? "").trim();
    if (!org) return;
    const selectedMeta = availableOrgs.find((item) => item.organization_id === org);
    const selectedBusinessType = selectedMeta?.business_type ?? fallbackBusinessType(org);
    if (detectedVertical.businessType && selectedBusinessType !== detectedVertical.businessType) {
      console.warn("[ClinicContext] blocked cross-vertical org selection", {
        organizationId: org,
        selectedBusinessType,
        verticalBusinessType: detectedVertical.businessType,
      });
      return;
    }

    if (import.meta.env.DEV) {
      try {
        localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, org);
      } catch {
        // ignore
      }
    }
    try {
      localStorage.setItem(SELECTED_ORG_STORAGE_KEY, org);
    } catch {
      // ignore
    }

    const clinicForOrg = await resolveClinicByOrg(org);
    if (!clinicForOrg) return;

    setClinic(clinicForOrg);
    setActiveBusinessType(selectedBusinessType);
    setActiveOrgName(safeOrgName(org, selectedBusinessType, selectedMeta?.name ?? clinicForOrg.name ?? null));
    try {
      localStorage.setItem(SELECTED_BUSINESS_TYPE_STORAGE_KEY, selectedBusinessType);
      window.dispatchEvent(new Event("active-org-changed"));
      window.dispatchEvent(new Event("dev-org-changed"));
    } catch {
      // ignore
    }

    if (user?.id) {
      await supabase.from("clinic_users").upsert(
        {
          user_id: user.id,
          clinic_id: clinicForOrg.id,
        },
        { onConflict: "user_id,clinic_id" }
      );
    }
  };

  useEffect(() => {
    let mounted = true;

    async function ensureClinicForUser() {
      if (!user) {
        if (!mounted) return;
        setClinic(null);
        setActiveBusinessType(null);
        setActiveOrgName(null);
        setIsAdmin(false);
        setAvailableOrgs([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const [profileRes, membersRes, rel] = await Promise.all([
        supabase.from("user_profiles").select("is_admin, default_org_id").eq("user_id", user.id).maybeSingle(),
        supabase.from("org_members").select("organization_id, role").eq("user_id", user.id).order("created_at", { ascending: true }),
        supabase
          .from("clinic_users")
          .select("clinic_id, clinics(id, name, domain, organization_id)")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle(),
      ]);

      const profile = (profileRes.data as any) ?? null;
      const normalizedEmail = String(user.email ?? "").trim().toLowerCase();
      const isPlatformAdmin = Boolean(profile?.is_admin) && PLATFORM_ADMIN_EMAILS.has(normalizedEmail);
      const defaultOrgId = String(profile?.default_org_id ?? "").trim();
      const memberRows = Array.isArray(membersRes.data) ? (membersRes.data as any[]) : [];
      const memberOnlyOrgIds = memberRows
        .filter((row) => String(row?.role ?? "").toLowerCase() === "member")
        .map((row) => String(row?.organization_id ?? "").trim())
        .filter(Boolean);
      const memberOrgIds = memberRows.map((row) => String(row?.organization_id ?? "").trim()).filter(Boolean);

      let relOrgId = "";
      if (!rel.error && rel.data?.clinic_id) {
        const c = Array.isArray(rel.data.clinics) ? rel.data.clinics[0] : rel.data.clinics;
        relOrgId = String(c?.organization_id ?? "").trim();
      }

      let storedOrgId = "";
      try {
        storedOrgId =
          localStorage.getItem(SELECTED_ORG_STORAGE_KEY) ??
          localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) ??
          "";
      } catch {
        storedOrgId = "";
      }

      const orgCandidates: string[] = [];
      if (defaultOrgId) orgCandidates.push(defaultOrgId);
      for (const id of memberOrgIds) orgCandidates.push(id);
      if (relOrgId) orgCandidates.push(relOrgId);
      if (isPlatformAdmin) {
        orgCandidates.push(
          "insurance-demo",
          "barber-demo-wimaeil",
          "barber-demo",
          "clinic-demo",
          "creatyv-product",
          "testing-mxp0snq",
          "testing-mnxp0snq",
          "org-359ba3c4",
          "irvin-mazariegos-clinic",
        );
      }
      if ((import.meta.env.DEV || isPlatformAdmin) && detectedVertical.businessType === "barbershop") {
        orgCandidates.push(...PREFERRED_BARBERSHOP_ORGS);
      }
      if ((import.meta.env.DEV || isPlatformAdmin) && detectedVertical.businessType === "referral_hub") {
        orgCandidates.push(...PREFERRED_REFERRAL_HUB_ORGS);
      }
      if ((import.meta.env.DEV || isPlatformAdmin) && detectedVertical.businessType === "dental") {
        orgCandidates.push(...PREFERRED_DENTAL_ORGS);
      }

      const uniqOrgIds = Array.from(new Set(orgCandidates.filter(Boolean)));
      const [orgRowsRes, orgSettingsRes, organizationSettingsRes] = uniqOrgIds.length
        ? await Promise.all([
            supabase.from("organizations").select("id, name").in("id", uniqOrgIds),
            supabase.from("org_settings").select("organization_id, business_type, name").in("organization_id", uniqOrgIds),
            supabase
              .from("organization_settings")
              .select("organization_id, business_type, name, brand_name, display_name")
              .in("organization_id", uniqOrgIds),
          ])
        : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

      const orgRows = Array.isArray((orgRowsRes as any).data) ? ((orgRowsRes as any).data as any[]) : [];
      const orgSettingsRows = Array.isArray((orgSettingsRes as any).data) ? ((orgSettingsRes as any).data as any[]) : [];
      const organizationSettingsRows = Array.isArray((organizationSettingsRes as any).data)
        ? ((organizationSettingsRes as any).data as any[])
        : [];
      const orgNameById = new Map(
        orgRows.map((row) => [String(row?.id ?? "").trim(), String(row?.name ?? "").trim() || null]),
      );
      const orgMetaById = new Map(
        [...orgSettingsRows, ...organizationSettingsRows].map((row) => {
          const id = String(row?.organization_id ?? "").trim();
          const rawBusinessType = String(row?.business_type ?? "").trim().toLowerCase();
          const rowBusinessType = rawBusinessType === "barbershop" || rawBusinessType === "insurance" || rawBusinessType === "referral_hub"
            ? rawBusinessType
            : fallbackBusinessType(id);
          const rawName =
            String(row?.display_name ?? row?.brand_name ?? row?.name ?? "").trim() ||
            orgNameById.get(id) ||
            null;
          return [id, { business_type: rowBusinessType as FrontendBusinessType, name: safeOrgName(id, rowBusinessType as FrontendBusinessType, rawName) }];
        }),
      );
      const allOrgOptions = uniqOrgIds.map((organization_id) => ({
        organization_id,
        role: memberRows.find((row) => String(row?.organization_id ?? "") === organization_id)?.role ?? null,
        business_type: orgMetaById.get(organization_id)?.business_type ?? fallbackBusinessType(organization_id),
        name: orgMetaById.get(organization_id)?.name ?? safeOrgName(organization_id, fallbackBusinessType(organization_id), orgNameById.get(organization_id)),
      }));
      const visibleOrgOptions = detectedVertical.businessType
        ? allOrgOptions.filter((org) => org.business_type === detectedVertical.businessType)
        : allOrgOptions;
      const preferredIds = detectedVertical.businessType === "barbershop"
        ? PREFERRED_BARBERSHOP_ORGS
        : detectedVertical.businessType === "referral_hub"
        ? PREFERRED_REFERRAL_HUB_ORGS
        : PREFERRED_DENTAL_ORGS;
      visibleOrgOptions.sort((a, b) => {
        const ai = preferredIds.indexOf(a.organization_id);
        const bi = preferredIds.indexOf(b.organization_id);
        const ar = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
        const br = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
        if (ar !== br) return ar - br;
        return String(a.name ?? a.organization_id).localeCompare(String(b.name ?? b.organization_id));
      });
      const visibleOrgIds = visibleOrgOptions.map((org) => org.organization_id);
      const resolvedOrgId =
        (storedOrgId && visibleOrgIds.includes(storedOrgId) ? storedOrgId : "") ||
        (defaultOrgId && visibleOrgIds.includes(defaultOrgId) ? defaultOrgId : "") ||
        memberOnlyOrgIds.find((id) => visibleOrgIds.includes(id)) ||
        memberOrgIds.find((id) => visibleOrgIds.includes(id)) ||
        (relOrgId && visibleOrgIds.includes(relOrgId) ? relOrgId : "") ||
        visibleOrgIds[0] ||
        "";

      const clinicForOrg = resolvedOrgId ? await resolveClinicByOrg(resolvedOrgId) : null;

      if (!mounted) return;

      setIsAdmin(isPlatformAdmin);
      setAvailableOrgs(visibleOrgOptions);
      setClinic(clinicForOrg);
      setActiveBusinessType(orgMetaById.get(resolvedOrgId)?.business_type ?? detectedVertical.businessType ?? fallbackBusinessType(resolvedOrgId));
      setActiveOrgName(
        orgMetaById.get(resolvedOrgId)?.name ??
          safeOrgName(resolvedOrgId, fallbackBusinessType(resolvedOrgId), orgNameById.get(resolvedOrgId) ?? clinicForOrg?.name ?? null)
      );
      setLoading(false);
      try {
        if (resolvedOrgId) {
          localStorage.setItem(SELECTED_ORG_STORAGE_KEY, resolvedOrgId);
          localStorage.setItem(SELECTED_BUSINESS_TYPE_STORAGE_KEY, orgMetaById.get(resolvedOrgId)?.business_type ?? detectedVertical.businessType ?? fallbackBusinessType(resolvedOrgId));
          window.dispatchEvent(new Event("active-org-changed"));
          window.dispatchEvent(new Event("dev-org-changed"));
        }
      } catch {
        // ignore
      }

      if (!clinicForOrg) return;

      const link = await supabase.from("clinic_users").upsert(
        {
          user_id: user.id,
          clinic_id: clinicForOrg.id,
        },
        { onConflict: "user_id,clinic_id" }
      );

      if (link.error) {
        console.warn("[ClinicContext] clinic_users link failed", link.error);
      }
    }

    ensureClinicForUser();

    return () => {
      mounted = false;
    };
  }, [user, detectedVertical.businessType]);

  const value = useMemo(
    () => ({
      clinic,
      clinicId,
      activeOrgId,
      activeBusinessType,
      activeOrgName,
      isAdmin,
      availableOrgs,
      loading,
      setClinic,
      setClinicId,
      setActiveOrgId,
    }),
    [clinic, clinicId, activeOrgId, activeBusinessType, activeOrgName, isAdmin, availableOrgs, loading]
  );

  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error("useClinic must be used within ClinicProvider");
  return ctx;
}
