import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const PUBLIC_APP_URL =
  ((import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) ??
    (import.meta.env.PUBLIC_APP_URL as string | undefined) ??
    "https://dental.creatyv.io")
    .replace(/\/+$/, "");
const META_REDIRECT_URI = `${PUBLIC_APP_URL}/auth/meta/callback`;

export default function MetaCallback() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const code = params.get("code");
  const state = params.get("state");

  useEffect(() => {
    let mounted = true;

    async function completeOauth() {
      if (!code || !state) {
        setError("No se pudo completar la conexión con Meta: faltan parámetros de autenticación.");
        setLoading(false);
        return;
      }

      const res = await supabase.functions.invoke("meta-oauth", {
        body: {
          code,
          state,
          redirectUri: META_REDIRECT_URI,
        },
      });

      if (!mounted) return;

      if (res.error || !res.data?.ok) {
        const details = String(res.data?.details ?? res.error?.message ?? "Error desconocido");
        setError(`No se pudo conectar Messenger. ${details}`);
        setLoading(false);
        return;
      }

      navigate("/settings/integrations?connected=1", { replace: true });
    }

    completeOauth();
    return () => {
      mounted = false;
    };
  }, [code, state, navigate]);

  return (
    <div className="min-h-screen dc-bg">
      <div className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4 py-10">
        <div className="dc-card w-full p-6">
          <h1 className="text-xl font-semibold text-white/95">Conectar Messenger</h1>
          {loading ? <p className="mt-3 text-sm text-white/72">Finalizando conexión con Meta…</p> : null}
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
          {!loading && error ? (
            <button
              type="button"
              onClick={() => navigate("/settings/integrations", { replace: true })}
              className="mt-4 dc-btn-secondary"
            >
              Volver a Integraciones
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
