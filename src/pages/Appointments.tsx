import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useClinic } from "../context/ClinicContext";

const SELECTED_ORG_STORAGE_KEY = "selected_organization_id";
const FALLBACK_ORG_ID = "barber-demo";

type AppointmentRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  patient_name: string | null;
  reason: string | null;
  title: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  starts_at: string | null;
  ends_at: string | null;
  provider_id: string | null;
  provider_name: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StatusFilter = "all" | "confirmed" | "pending" | "cancelled";

function asDate(a: AppointmentRow): Date | null {
  if (a.starts_at) {
    const d = new Date(a.starts_at);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (a.appointment_date) {
    const combined = `${a.appointment_date}T${a.appointment_time ?? "00:00"}:00`;
    const d = new Date(combined);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function statusKey(status: string | null | undefined): "confirmed" | "pending" | "cancelled" {
  const s = String(status ?? "").toLowerCase();
  if (s === "confirmed" || s === "confirmada") return "confirmed";
  if (s === "cancelled" || s === "cancelada" || s === "canceled") return "cancelled";
  return "pending";
}

function statusLabel(status: string | null | undefined): string {
  const k = statusKey(status);
  if (k === "confirmed") return "Confirmada";
  if (k === "cancelled") return "Cancelada";
  return "Pendiente";
}

function statusChipClass(status: string | null | undefined): string {
  const k = statusKey(status);
  if (k === "confirmed") return "border-emerald-800/60 bg-emerald-950/40 text-emerald-200";
  if (k === "cancelled") return "border-rose-800/60 bg-rose-950/40 text-rose-200";
  return "border-amber-800/60 bg-amber-950/40 text-amber-200";
}

function dayKey(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function dateText(d: Date): string {
  return d.toLocaleDateString("es-HN", { weekday: "long", day: "numeric", month: "long" });
}

function timeText(d: Date): string {
  return d.toLocaleTimeString("es-HN", { hour: "numeric", minute: "2-digit" });
}

function serviceText(a: AppointmentRow): string {
  return a.reason || a.title || "Servicio";
}

function clientText(a: AppointmentRow): string {
  return a.patient_name || "Cliente";
}

function barberText(a: AppointmentRow): string {
  return a.provider_name || "Cualquier barbero";
}

export default function Appointments() {
  const { activeOrgId, clinic } = useClinic();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [barberFilter, setBarberFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  useEffect(() => {
    function syncSelectedOrg() {
      try {
        setSelectedOrgId(localStorage.getItem(SELECTED_ORG_STORAGE_KEY) ?? "");
      } catch {
        setSelectedOrgId("");
      }
    }
    syncSelectedOrg();
    window.addEventListener("storage", syncSelectedOrg);
    window.addEventListener("dev-org-changed", syncSelectedOrg);
    return () => {
      window.removeEventListener("storage", syncSelectedOrg);
      window.removeEventListener("dev-org-changed", syncSelectedOrg);
    };
  }, []);

  const effectiveOrgId = useMemo(() => {
    return selectedOrgId || activeOrgId || clinic?.organization_id || FALLBACK_ORG_ID;
  }, [selectedOrgId, activeOrgId, clinic?.organization_id]);

  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("appointments")
        .select("id, organization_id, lead_id, patient_name, reason, title, appointment_date, appointment_time, starts_at, ends_at, provider_id, provider_name, status, created_at, updated_at")
        .eq("organization_id", effectiveOrgId)
        .order("starts_at", { ascending: true, nullsFirst: false })
        .order("appointment_date", { ascending: true, nullsFirst: false });
      if (!mounted) return;
      if (error) {
        setRows([]);
        setError(error.message);
      } else {
        setRows((data as AppointmentRow[]) ?? []);
      }
      setLoading(false);
    }
    run();
    return () => {
      mounted = false;
    };
  }, [effectiveOrgId]);

  const mapped = useMemo(() => {
    return rows
      .map((a) => ({ ...a, derivedDate: asDate(a) }))
      .filter((a) => a.derivedDate !== null) as Array<AppointmentRow & { derivedDate: Date }>;
  }, [rows]);

  const barbers = useMemo(() => {
    const set = new Set<string>();
    for (const a of mapped) set.add(barberText(a));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [mapped]);

  const services = useMemo(() => {
    const set = new Set<string>();
    for (const a of mapped) set.add(serviceText(a));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [mapped]);

  const filtered = useMemo(() => {
    return mapped.filter((a) => {
      if (statusFilter !== "all" && statusKey(a.status) !== statusFilter) return false;
      if (barberFilter !== "all" && barberText(a) !== barberFilter) return false;
      if (serviceFilter !== "all" && serviceText(a) !== serviceFilter) return false;
      const k = dayKey(a.derivedDate);
      if (dateFrom && k < dateFrom) return false;
      if (dateTo && k > dateTo) return false;
      return true;
    });
  }, [mapped, statusFilter, barberFilter, serviceFilter, dateFrom, dateTo]);

  const today = useMemo(() => startOfToday(), []);
  const todayKey = dayKey(today);
  const weekKeys = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => dayKey(addDays(today, i)));
  }, [today]);

  const todayAppointments = useMemo(() => filtered.filter((a) => dayKey(a.derivedDate) === todayKey), [filtered, todayKey]);
  const upcoming = useMemo(() => filtered.filter((a) => weekKeys.includes(dayKey(a.derivedDate))), [filtered, weekKeys]);

  const kpi = useMemo(() => {
    let confirmed = 0;
    let pending = 0;
    let cancelled = 0;
    for (const a of filtered) {
      const k = statusKey(a.status);
      if (k === "confirmed") confirmed += 1;
      if (k === "pending") pending += 1;
      if (k === "cancelled") cancelled += 1;
    }
    return {
      today: todayAppointments.length,
      confirmed,
      pending,
      cancelled,
    };
  }, [filtered, todayAppointments.length]);

  const weeklyByDay = useMemo(() => {
    const map = new Map<string, Array<AppointmentRow & { derivedDate: Date }>>();
    for (const k of weekKeys) map.set(k, []);
    for (const a of upcoming) {
      const k = dayKey(a.derivedDate);
      if (!map.has(k)) continue;
      map.get(k)!.push(a);
    }
    for (const [k, list] of map.entries()) {
      list.sort((a, b) => a.derivedDate.getTime() - b.derivedDate.getTime());
      map.set(k, list);
    }
    return map;
  }, [upcoming, weekKeys]);

  const empty = !loading && !error && filtered.length === 0;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-800 bg-slate-950/70 px-5 py-5 sm:px-6">
        <h1 className="text-2xl font-semibold text-slate-100">BarberLine Appointments</h1>
        <p className="mt-1 text-sm text-slate-400">Citas creadas automáticamente desde WhatsApp</p>
        <p className="mt-2 text-xs font-medium text-emerald-300">Viewing: {effectiveOrgId === "barber-demo" ? "Barbería Demo" : effectiveOrgId}</p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs text-slate-400">Citas hoy</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">{kpi.today}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs text-slate-400">Confirmadas</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-300">{kpi.confirmed}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs text-slate-400">Pendientes</div>
          <div className="mt-1 text-2xl font-semibold text-amber-300">{kpi.pending}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs text-slate-400">Canceladas</div>
          <div className="mt-1 text-2xl font-semibold text-rose-300">{kpi.cancelled}</div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-slate-400">
            Estado
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
            >
              <option value="all">Todos</option>
              <option value="confirmed">Confirmadas</option>
              <option value="pending">Pendientes</option>
              <option value="cancelled">Canceladas</option>
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Barbero
            <select
              value={barberFilter}
              onChange={(e) => setBarberFilter(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
            >
              <option value="all">Todos</option>
              {barbers.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Servicio
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
            >
              <option value="all">Todos</option>
              {services.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Desde
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
            />
          </label>
          <label className="text-xs text-slate-400">
            Hasta
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
            />
          </label>
        </div>
      </section>

      {loading && (
        <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5 text-sm text-slate-300">
          Cargando citas...
        </section>
      )}

      {error && (
        <section className="rounded-3xl border border-rose-800/60 bg-rose-950/40 p-5 text-sm text-rose-200">
          Error cargando citas: {error}
        </section>
      )}

      {empty && (
        <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-300">
          Cuando WhatsApp confirme una cita, aparecerá aquí.
        </section>
      )}

      {!loading && !error && !empty && (
        <>
          <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-slate-100">Citas de hoy</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-slate-400">
                    <th className="px-2 py-2 font-medium">Hora</th>
                    <th className="px-2 py-2 font-medium">Cliente</th>
                    <th className="px-2 py-2 font-medium">Servicio</th>
                    <th className="px-2 py-2 font-medium">Barbero</th>
                    <th className="px-2 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {todayAppointments.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-4 text-slate-500">Sin citas para hoy.</td>
                    </tr>
                  )}
                  {todayAppointments.map((a) => (
                    <tr key={a.id} className="border-b border-slate-900 text-slate-200">
                      <td className="px-2 py-3">{timeText(a.derivedDate)}</td>
                      <td className="px-2 py-3">{clientText(a)}</td>
                      <td className="px-2 py-3">{serviceText(a)}</td>
                      <td className="px-2 py-3">{barberText(a)}</td>
                      <td className="px-2 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${statusChipClass(a.status)}`}>
                          {statusLabel(a.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-slate-100">Próximas citas (7 días)</h2>
            <div className="mt-3 space-y-2">
              {upcoming.length === 0 && <div className="text-sm text-slate-500">No hay próximas citas.</div>}
              {upcoming.map((a) => (
                <div key={a.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-400">{dateText(a.derivedDate)} · {timeText(a.derivedDate)}</div>
                      <div className="mt-1 text-sm font-medium text-slate-100">{clientText(a)} · {serviceText(a)}</div>
                      <div className="mt-1 text-xs text-slate-400">{barberText(a)}</div>
                    </div>
                    <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${statusChipClass(a.status)}`}>
                      {statusLabel(a.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-slate-100">Vista semanal</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
              {weekKeys.map((k) => {
                const date = new Date(`${k}T00:00:00`);
                const list = weeklyByDay.get(k) ?? [];
                return (
                  <div key={k} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      {date.toLocaleDateString("es-HN", { weekday: "short", day: "numeric", month: "short" })}
                    </div>
                    <div className="mt-2 space-y-2">
                      {list.length === 0 && <div className="text-xs text-slate-500">Sin citas</div>}
                      {list.map((a) => (
                        <div key={a.id} className="rounded-xl border border-slate-700 bg-slate-950/70 px-2 py-2">
                          <div className="text-xs text-slate-400">{timeText(a.derivedDate)}</div>
                          <div className="truncate text-sm text-slate-100">{clientText(a)}</div>
                          <div className="truncate text-xs text-slate-400">{serviceText(a)}</div>
                          <div className="mt-1">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${statusChipClass(a.status)}`}>
                              {statusLabel(a.status)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
