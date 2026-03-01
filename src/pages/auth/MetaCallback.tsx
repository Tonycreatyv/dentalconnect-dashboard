import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const FN_BASE = "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1";
const APP_URL = import.meta.env.VITE_PUBLIC_APP_URL || "https://dental.creatyv.io";

function decodeOrgFromSignedState(state: string | null) {
  try {
    const payloadB64 = String(state ?? "").split(".")[0] ?? "";
    if (!payloadB64) return "";
    const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { org?: string };
    return String(payload?.org ?? "").trim();
  } catch {
    return "";
  }
}

export default function MetaCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [message, setMessage] = useState("Procesando conexión con Facebook...");

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const code = params.get("code");
  const state = params.get("state");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!code || !state) {
          throw new Error("Falta code o state en el callback");
        }
        if (!state.includes(".")) {
          throw new Error("State inválido: firma ausente.");
        }

        const redirectUri = `${APP_URL}/auth/meta/callback`;
        const r = await fetch(`${FN_BASE}/meta-oauth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state, redirectUri }),
        });

        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) {
          throw new Error(String(j?.details ?? j?.error ?? "No se pudo conectar Meta"));
        }

        if (!mounted) return;
        const orgFromState = decodeOrgFromSignedState(state);
        const redirectParams = new URLSearchParams({
          tab: "integraciones",
          connected: "1",
        });
        if (orgFromState) redirectParams.set("org", orgFromState);
        window.location.href = `/settings?${redirectParams.toString()}`;
      } catch (e: any) {
        if (!mounted) return;
        setStatus("error");
        setMessage(String(e?.message ?? e));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [code, state]);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
        <h1 className="text-xl font-semibold">Conectar Messenger</h1>
        <p className="mt-3 text-white/80">{message}</p>
        {status === "error" ? (
          <button
            type="button"
            onClick={() => navigate("/settings?tab=integraciones", { replace: true })}
            className="mt-4 inline-flex rounded-xl border border-white/20 bg-white/5 px-4 py-2 hover:bg-white/10"
          >
            Volver a Integraciones
          </button>
        ) : null}
      </div>
    </div>
  );
}
