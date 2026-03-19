import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient"; // IMPORTANT: usa UN solo client
import { useAuth } from "./AuthContext";

const ACTIVE_ORG_STORAGE_KEY = "active_org_id";

export type ClinicProfile = {
  id: string;
  name: string | null;
  domain: string | null;
  organization_id?: string | null;
};

type OrgOption = {
  organization_id: string;
  role?: string | null;
};

type ClinicContextValue = {
  clinic: ClinicProfile | null;
  clinicId: string | null;
  activeOrgId: string | null;
  isAdmin: boolean;
  availableOrgs: OrgOption[];
  loading: boolean;

  // ✅ setters para Settings / onboarding
  setClinic: React.Dispatch<React.SetStateAction<ClinicProfile | null>>;
  setClinicId: (id: string | null) => void;
  setActiveOrgId: (organizationId: string) => Promise<void>;
};

const ClinicContext = createContext<ClinicContextValue | undefined>(undefined);

export function ClinicProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [clinic, setClinic] = useState<ClinicProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [availableOrgs, setAvailableOrgs] = useState<OrgOption[]>([]);
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

    const created = await supabase
      .from("clinics")
      .insert({ name: "Clínica", organization_id: organizationId })
      .select("id, name, domain, organization_id")
      .maybeSingle();

    if (created.error || !created.data?.id) return null;

    return {
      id: created.data.id,
      name: created.data.name ?? "Clínica",
      domain: created.data.domain ?? null,
      organization_id: created.data.organization_id ?? organizationId,
    };
  }

  const setActiveOrgId = async (organizationId: string) => {
    const org = String(organizationId ?? "").trim();
    if (!org) return;

    try {
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, org);
    } catch {
      // ignore
    }

    const clinicForOrg = await resolveClinicByOrg(org);
    if (!clinicForOrg) return;

    setClinic(clinicForOrg);

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
        setIsAdmin(false);
        setAvailableOrgs([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const [profileRes, membersRes, rel] = await Promise.all([
        supabase.from("user_profiles").select("is_admin, default_org_id").eq("id", user.id).maybeSingle(),
        supabase.from("org_members").select("organization_id, role").eq("user_id", user.id).order("created_at", { ascending: true }),
        supabase
          .from("clinic_users")
          .select("clinic_id, clinics(id, name, domain, organization_id)")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle(),
      ]);

      const profile = (profileRes.data as any) ?? null;
      const isAdminUser = Boolean(profile?.is_admin);
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
        storedOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) ?? "";
      } catch {
        storedOrgId = "";
      }

      const orgCandidates: string[] = [];
      if (isAdminUser && defaultOrgId) orgCandidates.push(defaultOrgId);
      for (const id of memberOrgIds) orgCandidates.push(id);
      if (relOrgId) orgCandidates.push(relOrgId);

      const uniqOrgIds = Array.from(new Set(orgCandidates.filter(Boolean)));
      const resolvedOrgId =
        (isAdminUser && defaultOrgId) ||
        (storedOrgId && uniqOrgIds.includes(storedOrgId) ? storedOrgId : "") ||
        memberOnlyOrgIds[0] ||
        memberOrgIds[0] ||
        relOrgId ||
        "";

      const clinicForOrg = resolvedOrgId ? await resolveClinicByOrg(resolvedOrgId) : null;

      if (!mounted) return;

      setIsAdmin(isAdminUser);
      setAvailableOrgs(
        uniqOrgIds.map((organization_id) => ({
          organization_id,
          role: memberRows.find((row) => String(row?.organization_id ?? "") === organization_id)?.role ?? null,
        }))
      );
      setClinic(clinicForOrg);
      setLoading(false);

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
  }, [user]);

  const value = useMemo(
    () => ({
      clinic,
      clinicId,
      activeOrgId,
      isAdmin,
      availableOrgs,
      loading,
      setClinic,
      setClinicId,
      setActiveOrgId,
    }),
    [clinic, clinicId, activeOrgId, isAdmin, availableOrgs, loading]
  );

  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error("useClinic must be used within ClinicProvider");
  return ctx;
}
