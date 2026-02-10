// src/pages/ReportsDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, MessageSquare, RefreshCw, Users } from "lucide-react";

import { supabase } from "../lib/supabase";
import { useClinic } from "../context/ClinicContext";
import { LobbyHero } from "../components/LobbyHero";

import { btnGhost, kpiCard, panelHover, panelHeader } from "../lib/ui";

type Kpis = {
  leadsTotal: number;
  messagesToday: number;
  appts7d: number;
  lastActivityISO: string | null;
};

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function plusDaysISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function timeAgo(iso: string | null) {
  if (!iso) return "Sin actividad reciente";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Hace unos segundos";
  if (min < 60) return `Hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  return `Hace ${d} días`;
}

export default function ReportsDashboard() {
  const { clinicId } = useClinic();

  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<Kpis>({
    leadsTotal: 0,
    messagesToday: 0,
    appts7d: 0,
    lastActivityISO: null,
  });
  const [error, setError] = useState<string | null>(null);

  const todayISO = useMemo(() => startOfTodayISO(), []);
  const next7ISO = useMemo(() => plusDaysISO(7), []);

  const load = async () => {
    if (!clinicId) return;

    setLoading(true);
    setError(null);

    try {
      // 1) Leads total
      const leadsRes = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", clinicId);

      if (leadsRes.error) throw new Error(leadsRes.error.message);

      // 2) Mensajes hoy
      const msgsRes = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", clinicId)
        .gte("created_at", todayISO);

      if (msgsRes.error) throw new Error(msgsRes.error.message);

      // 3) Última actividad
      const lastMsgRes = await supabase
        .from("messages")
        .select("created_at")
        .eq("organization_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(1);

      const lastActivityISO =
        (lastMsgRes.data?.[0]?.created_at as string | undefined) ?? null;

      // 4) Citas 7 días (si existe)
      let appts7d = 0;
      try {
        const apptsRes = await supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", clinicId)
          .gte("start_at", todayISO)
          .lte("start_at", next7ISO);

        if (!apptsRes.error) appts7d = apptsRes.count ?? 0;
      } catch {
        appts7d = 0;
      }

      setKpis({
        leadsTotal: leadsRes.count ?? 0,
        messagesToday: msgsRes.count ?? 0,
        appts7d,
        lastActivityISO,
      });
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cargar Overview.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  const statusLabel =
    loading ? "Sincronizando…" : kpis.messagesToday > 0 ? "Hay actividad hoy" : "Sin nuevas entradas";

  const lastActivityLabel = `Última actividad: ${timeAgo(kpis.lastActivityISO)}`;

  return (
    <div className="space-y-4">
      {/* ✅ Quitado el header card "CLINIC Dashboard" duplicado.
          Se queda SOLO este LobbyHero como cabecera principal. */}
      <LobbyHero
        title="DentalConnect Lobby"
        subtitle="Mensajes, citas y leads — todo en un vistazo."
        rightText={clinicId ?? "—"}
        imageSrc="/lobby/waiting-room.webp"
        tone="dark"
        statusLabel={statusLabel}
        lastActivityLabel={lastActivityLabel}
      >
        <Link to="/conversations" className={kpiCard}>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <MessageSquare className="h-4 w-4" />
            MENSAJES HOY
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-100">
            {loading ? "—" : kpis.messagesToday}
          </div>
          <div className="mt-1 text-sm text-slate-400">Entradas de hoy.</div>
        </Link>

        <Link to="/appointments" className={kpiCard}>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <CalendarDays className="h-4 w-4" />
            CITAS 7 DÍAS
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-100">
            {loading ? "—" : kpis.appts7d}
          </div>
          <div className="mt-1 text-sm text-slate-400">Próximas en 7 días.</div>
        </Link>

        <Link to="/patients" className={kpiCard}>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Users className="h-4 w-4" />
            LEADS
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-100">
            {loading ? "—" : kpis.leadsTotal}
          </div>
          <div className="mt-1 text-sm text-slate-400">Total registrados.</div>
        </Link>
      </LobbyHero>

      {error ? (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/20 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className={panelHover}>
        <div className={panelHeader}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-100">Resumen</div>
              <div className="text-sm text-slate-400">Actividad reciente y accesos rápidos.</div>
            </div>

            <button type="button" className={btnGhost} onClick={load} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              {loading ? "Cargando…" : "Refrescar"}
            </button>
          </div>
        </div>

        <div className="px-4 py-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Link to="/conversations" className={kpiCard}>
              <div className="text-xs text-slate-400">CHATS</div>
              <div className="mt-2 text-sm text-slate-200">
                Ver chats y responder por canal.
              </div>
            </Link>

            <Link to="/appointments" className={kpiCard}>
              <div className="text-xs text-slate-400">CITAS</div>
              <div className="mt-2 text-sm text-slate-200">
                Abrir agenda y próximas citas.
              </div>
            </Link>

            <Link to="/settings" className={kpiCard}>
              <div className="text-xs text-slate-400">AJUSTES</div>
              <div className="mt-2 text-sm text-slate-200">
                Configuración de clínica y prompts.
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
