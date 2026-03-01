// src/pages/auth/MetaCallback.tsx
import React, { useEffect, useState } from "react";

const SUPABASE_FN_BASE = "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1";
const PUBLIC_APP_URL = import.meta.env.VITE_PUBLIC_APP_URL || "https://dental.creatyv.io";

export default function MetaCallback() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState<string>("Procesando conexión con Facebook...");

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const state = params.get("state");

        if (!code || !state) throw new Error("Falta code o state en el callback");

        const redirectUri = `${PUBLIC_APP_URL}/auth/meta/callback`;

        const r = await fetch(`${SUPABASE_FN_BASE}/meta-oauth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state, redirectUri }),
        });

        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || "No se pudo conectar Meta");

        setStatus("ok");
        setMessage("✅ Conectado. Redirigiendo...");
        window.location.href = "/settings?tab=integraciones&connected=1";
      } catch (e: any) {
        setStatus("error");
        setMessage(String(e?.message ?? e));
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
        <h1 className="text-xl font-semibold">Conectar Messenger</h1>
        <p className="mt-3 text-white/80">{message}</p>
        {status === "error" ? (
          <a
            href="/settings?tab=integraciones"
            className="mt-4 inline-flex rounded-xl border border-white/20 bg-white/5 px-4 py-2 hover:bg-white/10"
          >
            Volver a Integraciones
          </a>
        ) : null}
      </div>
    </div>
  );
}