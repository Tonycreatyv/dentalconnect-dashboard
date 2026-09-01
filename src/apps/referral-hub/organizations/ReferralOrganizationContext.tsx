import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { supabase } from "../../../lib/supabaseClient";
import {
  REFERRAL_HUB_BUSINESS_TYPE,
  REFERRAL_HUB_ORGANIZATION_ID,
} from "../config/product";
import {
  DEFAULT_LG_FEATURE_FLAGS,
  resolveLgFeatureFlags,
  type LgFeatureFlags,
} from "../config/features";

type ReferralOrganizationValue = {
  resolvedOrgId: string;
  resolvedOrgName: string;
  resolvedBusinessType: "referral_hub";
  membershipRole: string;
  features: LgFeatureFlags;
  loading: boolean;
  error: string;
};

const ReferralOrganizationContext = createContext<ReferralOrganizationValue | null>(null);

export function ReferralOrganizationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("LG Community Network");
  const [features, setFeatures] = useState(DEFAULT_LG_FEATURE_FLAGS);
  const [membershipRole, setMembershipRole] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) {
        if (active) {
          setError("");
          setMembershipRole("");
          setFeatures(DEFAULT_LG_FEATURE_FLAGS);
          setLoading(false);
        }
        return;
      }
      setError("");
      setLoading(true);
      const membership = await supabase
        .from("org_members")
        .select("organization_id,role")
        .eq("user_id", user.id)
        .eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID)
        .maybeSingle();
      if (membership.error || !membership.data) {
        if (active) {
          setError("Tu cuenta no está asociada a una organización.");
          setLoading(false);
        }
        return;
      }
      setMembershipRole(String(membership.data.role ?? ""));
      const [settings, profile] = await Promise.all([
        supabase
          .from("org_settings")
          .select("organization_id,business_type,brand_name")
          .eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID)
          .eq("business_type", REFERRAL_HUB_BUSINESS_TYPE)
          .maybeSingle(),
        supabase
          .from("organization_settings")
          .select("integrations")
          .eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID)
          .maybeSingle(),
      ]);
      if (!active) return;
      if (settings.error || !settings.data) {
        setError("La organización principal de Conexxion no está configurada.");
      } else {
        setName(settings.data.brand_name || "LG Community Network");
        const integrations = profile.data?.integrations as Record<string, unknown> | null;
        setFeatures(resolveLgFeatureFlags(integrations?.lg_features));
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [user]);

  const value = useMemo<ReferralOrganizationValue>(() => ({
    resolvedOrgId: error ? "" : REFERRAL_HUB_ORGANIZATION_ID,
    resolvedOrgName: name,
    resolvedBusinessType: "referral_hub",
    membershipRole,
    features,
    loading,
    error,
  }), [error, name, features, loading, membershipRole]);

  return (
    <ReferralOrganizationContext.Provider value={value}>
      {children}
    </ReferralOrganizationContext.Provider>
  );
}

export function useReferralOrganization() {
  const value = useContext(ReferralOrganizationContext);
  if (!value) throw new Error("useReferralOrganization requires ReferralOrganizationProvider");
  return value;
}
