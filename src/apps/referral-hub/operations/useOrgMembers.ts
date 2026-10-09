import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

export type OrgMemberRole = "owner" | "admin" | "operator" | "member";

export type OrgMember = {
  userId: string;
  role: OrgMemberRole;
  createdAt: string;
};

// org_members has no email/name column, and there is no public view/RPC
// exposing auth.users identity for OTHER members today — adding one is a
// migration, out of scope for this round without separate approval. Only
// the CURRENTLY authenticated member's own name/email is resolvable
// client-side (from their own session), so callers must merge that in
// themselves; every other row is real (role, membership date) but
// intentionally has no display name here rather than inventing one.
export function useOrgMembers(organizationId: string) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!organizationId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase
      .from("org_members")
      .select("user_id,role,created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });
    if (loadError) {
      setError("No se pudo cargar el equipo.");
      setMembers([]);
      setLoading(false);
      return;
    }
    setMembers((data ?? []).map((row) => ({
      userId: row.user_id as string,
      role: row.role as OrgMemberRole,
      createdAt: row.created_at as string,
    })));
    setLoading(false);
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  // Sensitive changes are mediated by the database RPC; clients never update
  // org_members directly.
  const setMemberRoleToAdmin = useCallback(async (userId: string) => {
    const { error: updateError } = await supabase.rpc("manage_org_member", {
      p_organization_id: organizationId,
      p_target_user_id: userId,
      p_role: "admin",
      p_active: true,
    });
    if (updateError) return "No se pudo cambiar el rol. Verifica que tengas permisos de propietario.";
    await load();
    return null;
  }, [organizationId, load]);

  return { members, loading, error, setMemberRoleToAdmin };
}
