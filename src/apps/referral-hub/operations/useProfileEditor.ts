import { useCallback, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type MetaUser = { user_metadata?: Record<string, unknown> } | null;

// Canonical name source, shared by the greeting, the account menu, and
// Configuración — never a separate profile table. Only auth.users.
// user_metadata.full_name/.name are ever read for this purpose.
export function profileDisplayName(user: MetaUser): string {
  const meta = user?.user_metadata ?? {};
  const raw = (meta.full_name as string | undefined) || (meta.name as string | undefined) || "";
  return raw.trim();
}

// Additive custom metadata key — no schema change, mirrors full_name's
// existing pattern exactly. Distinct from Supabase's built-in auth.users
// .phone column, which is reserved for phone-based auth/SMS OTP and is not
// what this "contact phone number" field means.
export function profilePhone(user: MetaUser): string {
  const meta = user?.user_metadata ?? {};
  return ((meta.phone as string | undefined) || "").trim();
}

export function useProfileEditor() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const resetStatus = useCallback(() => {
    setError("");
    setSuccess(false);
  }, []);

  // supabase.auth.updateUser persists to auth.users.raw_user_meta_data AND
  // fires a USER_UPDATED auth-state-change event immediately — AuthContext
  // is subscribed to that event, so every consumer of useAuth().user (the
  // greeting, the avatar initials, the account menu, Configuración)
  // re-renders with the new value on its own, with no logout required.
  const saveProfile = useCallback(async (values: { fullName: string; phone?: string }) => {
    const trimmedName = values.fullName.trim();
    if (!trimmedName) {
      setError("Ingresa un nombre.");
      return false;
    }
    setSaving(true);
    setError("");
    setSuccess(false);
    const data: Record<string, unknown> = { full_name: trimmedName };
    if (values.phone !== undefined) data.phone = values.phone.trim() || null;
    const { error: updateError } = await supabase.auth.updateUser({ data });
    setSaving(false);
    if (updateError) {
      setError("No se pudo guardar el perfil. Intenta de nuevo.");
      return false;
    }
    setSuccess(true);
    return true;
  }, []);

  return { saving, error, success, saveProfile, resetStatus };
}
