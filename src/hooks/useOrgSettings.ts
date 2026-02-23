import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const ORG = "clinic-demo";

export type OrgSettings = {
  organization_id: string;
  name: string | null;
  // si después querés: brand_color, logo_url, etc.
  // brand_color?: string | null;
};

export function useOrgSettings() {
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("org_settings")
      .select("organization_id, name")
      .eq("organization_id", ORG)
      .maybeSingle();

    if (!error && data) setOrg(data as any);
    setLoading(false);
  }

  useEffect(() => {
    load();

    // Realtime: si actualizás settings, que refresque
    const ch = supabase
      .channel(`rt-org-settings-${ORG}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "org_settings",
          filter: `organization_id=eq.${ORG}`,
        },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { org, loading, reload: load };
}