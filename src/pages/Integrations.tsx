// src/pages/Integrations.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, PlugZap, RefreshCw, Home } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useClinic } from "../context/ClinicContext";
import { btnGhost, btnPrimary, panelHover, panelHeader, glowHover } from "../lib/ui";

type IntegrationRow = {
  id: string;
  organization_id: string;
  provider: "whatsapp" | "messenger" | "instagram" | "web";
  status: "connected" | "pending" | "error" | "disconnected";
  connected_at: string | null;
  last_error: string | null;
  updated_at: string | null;
};

const providers = [
  { key: "whatsapp", label: "WhatsApp", desc: "Citas y soporte por WhatsApp Business.", hint: "Cloud API / Embedded Signup" },
  { key: "messenger", label: "Messenger", desc: "Mensajes desde Facebook Page.", hint: "Meta Graph" },
  { key: "instagram", label: "Instagram", desc: "DMs de Instagram (IG Business).", hint: "Meta Graph" },
  { key: "web", label: "Web", desc: "Widget del sitio (chat web).", hint: "Tu widget" },
] as const;

const badge = (s: IntegrationRow["status"]) => {
  if (s === "connected") return "border-emerald-700/40 bg-emerald-950/30 text-emerald-200";
  if (s === "pending") return "border-amber-700/40 bg-amber-950/30 text-amber-200";
  if (s === "error") return "border-rose-700/40 bg-rose-950/30 text-rose-200";
  return "border-slate-800 bg-slate-950/40 text-slate-300";
};

const label = (s: IntegrationRow["status"]) => {
  if (s === "connected") return "Conectado";
  if (s === "pending") return "Pendiente";
  if (s === "error") return "Error";
  return "Desconectado";
};

export default function Integrations() {
  const { clinicId } = useClinic();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const rowMap = useMemo(() => {
    const m = new Map<string, IntegrationRow>();
    rows.forEach((r) => m.set(r.provider, r));
    return m;
  }, [rows]);

  const load = async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);

    try {
      const r = await supabase
        .from("organization_integrations")
        .select("id, organization_id, provider, status, connected_at, last_error, updated_at")
        .eq("organization_id", clinicId);

      if (r.error) throw new Error(r.error.message);

      setRows((r.data as IntegrationRow[]) ?? []);
    } catch (e: any) {
      setRows([]);
      setError(e?.message ?? "No se pudieron cargar Integraciones.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  const connect = async (provider: "whatsapp" | "messenger" | "instagram") => {
    if (!clinicId) return;
    setBusyKey(provider);
    setError(null);

    try {
      const res = await supabase.functions.invoke("integrations-connect", {
        body: { organization_id: clinicId, provider },
      });

      if (res.error) throw new Error(res.error.message);

      const url = (res.data as any)?.url as string | undefined;
      if (!url) throw new Error("La función no devolvió URL de conexión.");

      window.location.href = url;
    } catch (e: any) {
      setError(e?.message ?? "No se pudo iniciar la conexión.");
    } finally {
      setBusyKey(null);
    }
  };

  const refresh = async () => {
    await load();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Integraciones</h1>
          <p className="text-sm text-slate-400">Conecta tus canales para recibir y responder mensajes.</p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/overview" className={btnGhost}>
            <Home className="h-4 w-4" />
            Inicio
          </Link>

          <button type="button" onClick={refresh} className={btnGhost}>
            <RefreshCw className="h-4 w-4" />
            Refrescar
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-900/60 bg-rose-950/20 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {providers.map((p) => {
          const r = rowMap.get(p.key);
          const status = r?.status ?? "disconnected";
          const lastError = r?.last_error ?? null;

          return (
            <div key={p.key} className={panelHover}>
              <div className={panelHeader}>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">{p.hint}</div>
                  <span className={`rounded-full border px-2 py-1 text-[11px] ${badge(status)}`}>
                    {label(status)}
                  </span>
                </div>
              </div>

              <div className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-100">{p.label}</div>
                    <div className="mt-1 text-sm text-slate-400">{p.desc}</div>

                    {lastError ? (
                      <div className="mt-3 rounded-xl border border-rose-900/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-200">
                        {lastError}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-1">
                    {status === "connected" ? (
                      <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-700/40 bg-emerald-950/20 px-3 py-2 text-xs font-semibold text-emerald-200">
                        <CheckCircle2 className="h-4 w-4" />
                        Listo
                      </div>
                    ) : status === "error" ? (
                      <div className="inline-flex items-center gap-2 rounded-xl border border-rose-700/40 bg-rose-950/20 px-3 py-2 text-xs font-semibold text-rose-200">
                        <AlertTriangle className="h-4 w-4" />
                        Revisar
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-slate-300">
                        <PlugZap className="h-4 w-4" />
                        No conectado
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {p.key === "web" ? (
                    <button
                      type="button"
                      className={`${btnGhost} ${glowHover}`}
                      onClick={() => alert("Aquí va el embed/keys del widget web.")}
                    >
                      Ver embed
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={busyKey === p.key || loading}
                      onClick={() => connect(p.key as any)}
                    >
                      <PlugZap className="h-4 w-4" />
                      {busyKey === p.key ? "Conectando…" : "Conectar"}
                    </button>
                  )}

                  <button type="button" className={btnGhost} onClick={refresh}>
                    <RefreshCw className="h-4 w-4" />
                    Estado
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-4 text-sm text-slate-300">
        <div className="font-semibold text-slate-100">Nota</div>
        <div className="mt-1 text-slate-400">
          Para WhatsApp/Messenger/Instagram, la conexión debe pasar por Edge Function (tokens y secretos no se guardan en el navegador).
        </div>
      </div>
    </div>
  );
}
