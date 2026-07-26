import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

const FN_BASE = "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1";
const APP_URL = import.meta.env.VITE_PUBLIC_URL || "https://referral.creatyv.io";

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
  const [status, setStatus] = useState<"loading" | "selecting" | "saving" | "error">("loading");
  const [message, setMessage] = useState("Procesando conexión con Facebook...");
  const [pages, setPages] = useState<Array<{ id: string; name: string; access_token: string }>>([]);

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
        const session = await supabase.auth.getSession();
        const accessToken = session.data.session?.access_token;
        if (!accessToken) throw new Error("La sesión expiró. Inicia sesión e inténtalo de nuevo.");
        const r = await fetch(`${FN_BASE}/meta-oauth`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ action: "exchange", code, state, redirectUri }),
        });

        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) {
          throw new Error(String(j?.details ?? j?.error ?? "No se pudo conectar Meta"));
        }

        if (!mounted) return;
        const availablePages = Array.isArray(j?.pages) ? j.pages : [];
        if (availablePages.length === 0) throw new Error("No hay páginas disponibles para seleccionar.");
        setPages(availablePages);
        setStatus("selecting");
        setMessage("Selecciona la página que quieres conectar.");
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

  async function savePage(page: { id: string; name: string; access_token: string }) {
    try {
      if (!state) throw new Error("State inválido.");
      setStatus("saving");
      setMessage(`Conectando ${page.name}...`);
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      if (!accessToken) throw new Error("La sesión expiró. Inicia sesión e inténtalo de nuevo.");
      const r = await fetch(`${FN_BASE}/meta-oauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          action: "save_page",
          state,
          page_id: page.id,
          page_name: page.name,
          page_access_token: page.access_token,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(String(j?.details ?? j?.error ?? "No se pudo conectar Meta"));

      const orgFromState = decodeOrgFromSignedState(state);
        let storedRedirect = "";
        try {
          storedRedirect = localStorage.getItem("dc_post_meta_redirect") ?? "";
          if (storedRedirect) {
            localStorage.removeItem("dc_post_meta_redirect");
          }
        } catch {
          storedRedirect = "";
        }

      if (storedRedirect) {
        const target = new URL(storedRedirect, window.location.origin);
        target.searchParams.set("connected", "1");
        if (orgFromState) target.searchParams.set("org", orgFromState);
        window.location.href = `${target.pathname}${target.search}`;
        return;
      }

        const redirectParams = new URLSearchParams({
          tab: "integraciones",
          connected: "1",
        });
        if (orgFromState) redirectParams.set("org", orgFromState);
      window.location.href = `/settings?${redirectParams.toString()}`;
    } catch (e: any) {
      setStatus("error");
      setMessage(String(e?.message ?? e));
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
        <h1 className="text-xl font-semibold">Conectar Messenger</h1>
        <p className="mt-3 text-white/80">{message}</p>
        {status === "selecting" ? (
          <div className="mt-4 grid gap-2">
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => void savePage(page)}
                className="flex min-h-12 items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
              >
                <span className="font-medium">{page.name}</span>
                <span className="text-xs text-white/45">{page.id}</span>
              </button>
            ))}
          </div>
        ) : null}
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
