import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient"; // IMPORTANT: usa UN solo client
import { useAuth } from "./AuthContext";

export type ClinicProfile = {
  id: string;
  name: string | null;
  domain: string | null;
  organization_id?: string | null;
};

type ClinicContextValue = {
  clinic: ClinicProfile | null;
  clinicId: string | null;
  loading: boolean;

  // ✅ setters para Settings / onboarding
  setClinic: React.Dispatch<React.SetStateAction<ClinicProfile | null>>;
  setClinicId: (id: string | null) => void;
};

const ClinicContext = createContext<ClinicContextValue | undefined>(undefined);

export function ClinicProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [clinic, setClinic] = useState<ClinicProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const clinicId = clinic?.id ?? null;

  const setClinicId = (id: string | null) => {
    setClinic((prev) => {
      if (!id) return null;
      if (prev?.id === id) return prev;
      return { id, name: prev?.name ?? null, domain: prev?.domain ?? null, organization_id: prev?.organization_id ?? null };
    });
  };

  useEffect(() => {
    let mounted = true;

    async function ensureClinicForUser() {
      if (!user) {
        if (!mounted) return;
        setClinic(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      // 1) buscar vínculo clinic_users
      const rel = await supabase
        .from("clinic_users")
        .select("clinic_id, clinics(id, name, domain, organization_id)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (!rel.error && rel.data?.clinic_id) {
        const c = Array.isArray(rel.data.clinics) ? rel.data.clinics[0] : rel.data.clinics;

        if (!mounted) return;
        setClinic({
          id: c?.id ?? rel.data.clinic_id,
          name: c?.name ?? null,
          domain: c?.domain ?? null,
          organization_id: c?.organization_id ?? null,
        });
        setLoading(false);
        return;
      }

      // 2) auto-onboarding: crear clínica + vínculo
      const created = await supabase
        .from("clinics")
        .insert({ name: "Clínica Sonrisas", organization_id: "clinic-demo" })
        .select("id, name, domain, organization_id")
        .maybeSingle();

      if (created.error || !created.data?.id) {
        if (!mounted) return;
        setClinic(null);
        setLoading(false);
        return;
      }

      const newClinicId = created.data.id;

      const link = await supabase
        .from("clinic_users")
        .insert({ user_id: user.id, clinic_id: newClinicId });

      if (!mounted) return;

      setClinic({
        id: newClinicId,
        name: created.data.name ?? "Clínica Sonrisas",
        domain: created.data.domain ?? null,
        organization_id: created.data.organization_id ?? "clinic-demo",
      });

      // si falló link, igual dejamos clinic para demo (Settings podría fallar por RLS)
      setLoading(false);

      if (link.error) {
        // no tiramos error visible en UI
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
      loading,
      setClinic,
      setClinicId,
    }),
    [clinic, clinicId, loading]
  );

  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error("useClinic must be used within ClinicProvider");
  return ctx;
}