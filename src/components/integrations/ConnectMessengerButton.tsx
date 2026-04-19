import { useState } from "react";

const FN_BASE = "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1";
const APP_URL = import.meta.env.VITE_PUBLIC_APP_URL || "https://dental.creatyv.io";
const META_APP_ID = import.meta.env.VITE_META_APP_ID as string | undefined;

export async function startMetaOAuth(organizationId: string) {
  if (!META_APP_ID) throw new Error("Falta VITE_META_APP_ID.");
  if (!organizationId) throw new Error("Falta organization_id.");

  const stateRes = await fetch(`${FN_BASE}/meta-oauth-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organization_id: organizationId }),
  });
  const stateJson = await stateRes.json().catch(() => ({}));
  if (!stateRes.ok || !stateJson?.ok || !stateJson?.state) {
    const errCode = String(stateJson?.error ?? "");
    if (errCode === "missing_META_STATE_SECRET") {
      throw new Error("Configura META_STATE_SECRET en Supabase Secrets");
    }
    throw new Error(String(stateJson?.details ?? stateJson?.error ?? "No se pudo generar state firmado."));
  }

  const signedState = String(stateJson.state);
  if (!signedState.includes(".")) {
    throw new Error("State inválido: firma no encontrada.");
  }

  const redirectUri = `${APP_URL}/auth/meta/callback`;
  const authUrl =
    "https://www.facebook.com/v19.0/dialog/oauth" +
    `?client_id=${encodeURIComponent(META_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(signedState)}` +
    `&response_type=code` +
    `&scope=pages_show_list,pages_messaging,pages_manage_metadata`;

  window.location.href = authUrl;
}

export default function ConnectMessengerButton({
  organizationId,
  className = "",
  onError,
}: {
  organizationId: string;
  className?: string;
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    try {
      setBusy(true);
      await startMetaOAuth(organizationId);
    } catch (e: any) {
      setBusy(false);
      const msg = String(e?.message ?? e);
      onError?.(msg);
    }
  }

  return (
    <button type="button" onClick={onClick} disabled={busy} className={className}>
      {busy ? "Conectando..." : "Conectar"}
    </button>
  );
}
