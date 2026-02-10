import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";

type AppointmentRow = {
  id: string;
  organization_id?: string;
  start_at: string | null;          // timestamptz en DB
  end_at?: string | null;
  status?: string | null;           // confirmed/pending/canceled...
  title?: string | null;            // opcional
  patient_name?: string | null;     // opcional si existe
  notes?: string | null;
};

type Props = {
  loading?: boolean;
  appointments: AppointmentRow[];
  onCreate?: () => void;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function formatRange(a: Date, b: Date) {
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const optsA: Intl.DateTimeFormatOptions = sameMonth
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  const optsB: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

  const left = a.toLocaleDateString(undefined, optsA);
  const right = b.toLocaleDateString(undefined, optsB);
  return `${left} — ${right}`;
}

function formatDayLabel(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short" }); // Sun/Mon...
}

function formatDayNum(d: Date) {
  return d.toLocaleDateString(undefined, { day: "numeric" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function statusChip(status?: string | null) {
  const s = (status ?? "pending").toLowerCase();
  if (s === "confirmed" || s === "confirmada") return "border-emerald-700/40 bg-emerald-950/25 text-emerald-200";
  if (s === "canceled" || s === "cancelada") return "border-rose-700/40 bg-rose-950/25 text-rose-200";
  if (s === "done" || s === "completada") return "border-sky-700/40 bg-sky-950/25 text-sky-200";
  return "border-amber-700/40 bg-amber-950/25 text-amber-200";
}

function statusLabel(status?: string | null) {
  const s = (status ?? "pending").toLowerCase();
  if (s === "confirmed" || s === "confirmada") return "Confirmada";
  if (s === "canceled" || s === "cancelada") return "Cancelada";
  if (s === "done" || s === "completada") return "Completada";
  return "Pendiente";
}

export function AppointmentsCalendar({ loading, appointments, onCreate }: Props) {
  // weekStart = domingo para look tipo screenshot; si quieres lunes, cambia el cálculo.
  const today = useMemo(() => startOfDay(new Date()), []);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => new Date().getDay()); // 0..6

  const weekStart = useMemo(() => {
    const base = addDays(today, weekOffset * 7);
    // mover base al domingo de esa semana
    const sunday = addDays(base, -base.getDay());
    return startOfDay(sunday);
  }, [today, weekOffset]);

  const days = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const selectedDate = useMemo(() => days[selectedDayIndex], [days, selectedDayIndex]);

  const apptsByDay = useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    for (const a of appointments) {
      if (!a.start_at) continue;
      const d = startOfDay(new Date(a.start_at));
      const key = d.toISOString();
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    // ordenar por hora
    for (const [k, arr] of map.entries()) {
      arr.sort((x, y) => new Date(x.start_at ?? 0).getTime() - new Date(y.start_at ?? 0).getTime());
      map.set(k, arr);
    }
    return map;
  }, [appointments]);

  const selectedKey = useMemo(() => startOfDay(selectedDate).toISOString(), [selectedDate]);
  const list = apptsByDay.get(selectedKey) ?? [];

  const rangeLabel = useMemo(() => {
    const end = addDays(weekStart, 6);
    return formatRange(weekStart, end);
  }, [weekStart]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/40 backdrop-blur">
      {/* Ambient overlay (suave, no neon) */}
      <div
        className="pointer-events-none absolute inset-0
          bg-[radial-gradient(900px_circle_at_20%_0%,rgba(16,185,129,0.10),transparent_55%),
              radial-gradient(900px_circle_at_80%_20%,rgba(59,130,246,0.10),transparent_55%)]
        "
      />
      <div className="relative">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-slate-400" />
              <div className="truncate text-lg font-semibold text-slate-100">Agenda</div>
            </div>
            <div className="mt-1 text-sm text-slate-400">{rangeLabel}</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 hover:bg-slate-950/60"
              onClick={() => setWeekOffset((x) => x - 1)}
              aria-label="Semana anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 hover:bg-slate-950/60"
              onClick={() => setWeekOffset(0)}
            >
              Hoy
            </button>

            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 hover:bg-slate-950/60"
              onClick={() => setWeekOffset((x) => x + 1)}
              aria-label="Semana siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-950 hover:opacity-95"
              onClick={onCreate}
            >
              <Plus className="h-4 w-4" />
              Crear
            </button>
          </div>
        </div>

        {/* Week strip */}
        <div className="flex items-center gap-2 overflow-x-auto px-4 py-3">
          {days.map((d, idx) => {
            const key = startOfDay(d).toISOString();
            const count = (apptsByDay.get(key) ?? []).length;
            const selected = idx === selectedDayIndex;

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDayIndex(idx)}
                className={[
                  "relative min-w-[72px] rounded-2xl border px-3 py-2 text-left transition",
                  selected
                    ? "border-slate-600 bg-slate-950/70"
                    : "border-slate-800 bg-slate-950/30 hover:bg-slate-950/50 hover:border-slate-700",
                ].join(" ")}
              >
                <div className="text-xs text-slate-400">{formatDayLabel(d).toUpperCase()}</div>
                <div className="mt-1 text-lg font-semibold text-slate-100">{formatDayNum(d)}</div>

                {count > 0 ? (
                  <div className="absolute right-2 top-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-emerald-700/40 bg-emerald-950/25 px-1 text-[11px] font-semibold text-emerald-200">
                    {count}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Selected day list */}
        <div className="border-t border-slate-800 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-400">Día seleccionado</div>
              <div className="text-lg font-semibold text-slate-100">
                {selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
              </div>
            </div>

            <div className="text-xs text-slate-400">
              {loading ? "Cargando…" : list.length ? `${list.length} cita(s)` : "Sin citas"}
            </div>
          </div>

          <div className="mt-4">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-2xl border border-slate-800 bg-slate-950/40 animate-pulse" />
                ))}
              </div>
            ) : list.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/30 px-4 py-6">
                <div className="text-sm font-semibold text-slate-100">Aún no hay citas este día.</div>
                <div className="mt-1 text-sm text-slate-400">Crea una cita o simula una para demo.</div>
                <button
                  type="button"
                  onClick={onCreate}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  <Plus className="h-4 w-4" />
                  Crear cita
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {list.map((a) => {
                  const when = a.start_at ? formatTime(a.start_at) : "—";
                  const title = a.patient_name || a.title || "Cita";
                  const st = statusLabel(a.status);
                  const chip = statusChip(a.status);

                  return (
                    <div
                      key={a.id}
                      className="group rounded-2xl border border-slate-800 bg-slate-950/35 px-4 py-4 transition
                                 hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-950/55"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-1 text-sm font-semibold text-slate-100">
                              {when}
                            </div>
                            <div className="truncate text-sm font-semibold text-slate-100">{title}</div>
                          </div>

                          {a.notes ? (
                            <div className="mt-2 text-sm text-slate-400 line-clamp-2">{a.notes}</div>
                          ) : null}
                        </div>

                        <div className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold ${chip}`}>
                          {st}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
