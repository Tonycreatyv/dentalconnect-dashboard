// src/components/CalendarBoard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, Clock, PencilLine, Plus } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { dedupeByKey } from "../lib/dedupe";
import { appointmentKey, normalizedStartISO } from "../lib/appointments";
import { addDays, buildLocalISO, startOfWeekSunday, toEndOfDay, toStartOfDay } from "../lib/time";

const DEFAULT_ORG = "clinic-demo";

type ApptRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  start_at: string | null;
  starts_at: string | null;
  status: string | null;
  title: string | null;
  notes: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  patient_name: string | null;
  reason: string | null;
};

type ViewMode = "month" | "week" | "day";

type ModalMode = "create" | "edit";

type ApptForm = {
  title: string;
  notes: string;
  status: string;
  date: string;
  time: string;
  patient_name: string;
  reason: string;
};

function fmtDayLabel(d: Date) {
  return d.toLocaleDateString("es", { weekday: "short" }).toUpperCase();
}

function fmtDayNum(d: Date) {
  return d.getDate();
}

function fmtRangeLabel(a: Date, b: Date) {
  const left = a.toLocaleDateString("es", { day: "2-digit", month: "short" });
  const right = b.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
  return `${left} — ${right}`;
}

function fmtTimeFromISO(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function toDateInput(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function toTimeInput(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function normalizeStatus(statusRaw: string | null | undefined) {
  const s = (statusRaw ?? "pending").trim().toLowerCase();
  if (s === "booked") return "confirmed";
  if (s === "canceled") return "cancelled";
  if (s === "done" || s === "attended" || s === "finished") return "completed";
  if (s === "noshow" || s === "no-show" || s === "no show") return "no_show";
  return s;
}

function statusBadge(statusRaw: string | null | undefined) {
  const s = normalizeStatus(statusRaw);

  if (s === "confirmed") {
    return {
      label: "CONFIRMADA",
      className: "border-[#E5E7EB] bg-[#F4F5F7] text-blue-700",
      dot: "bg-blue-600",
    };
  }
  if (s === "cancelled") {
    return {
      label: "CANCELADA",
      className: "border-[#E5E7EB] bg-[#F4F5F7] text-slate-700",
      dot: "bg-slate-400",
    };
  }
  if (s === "no_show") {
    return {
      label: "NO-SHOW",
      className: "border-[#E5E7EB] bg-[#F4F5F7] text-slate-700",
      dot: "bg-slate-400",
    };
  }
  if (s === "completed") {
    return {
      label: "ATENDIDA",
      className: "border-[#E5E7EB] bg-[#F4F5F7] text-blue-700",
      dot: "bg-blue-600",
    };
  }
  if (s === "requested") {
    return {
      label: "SOLICITADA",
      className: "border-[#E5E7EB] bg-[#F4F5F7] text-slate-700",
      dot: "bg-slate-400",
    };
  }

  return {
    label: "PENDIENTE",
    className: "border-[#E5E7EB] bg-[#F4F5F7] text-slate-700",
    dot: "bg-slate-400",
  };
}

function monthGrid(selected: Date) {
  const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const last = new Date(selected.getFullYear(), selected.getMonth() + 1, 0);

  const start = startOfWeekSunday(first);
  const end = addDays(startOfWeekSunday(addDays(last, 7)), 6);

  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(new Date(d));
  return { first, last, days };
}

const STATUS_OPTIONS = [
  { value: "pending", label: "Pendiente" },
  { value: "confirmed", label: "Confirmada" },
  { value: "completed", label: "Atendida" },
  { value: "cancelled", label: "Cancelada" },
  { value: "no_show", label: "No-show" },
  { value: "requested", label: "Solicitada" },
];

function AppointmentModal({
  open,
  mode,
  form,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  mode: ModalMode;
  form: ApptForm;
  onChange: (next: ApptForm) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-xl rounded-3xl border border-[#E5E7EB] bg-white p-6 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              {mode === "create" ? "Nueva cita" : "Editar cita"}
            </div>
            <div className="text-sm text-slate-700">Actualiza detalles del paciente y la cita.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#E5E7EB] bg-[#F4F5F7] px-3 py-2 text-xs text-slate-700 hover:bg-[#F4F5F7]"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-700">Paciente</label>
              <input
                value={form.patient_name}
                onChange={(e) => onChange({ ...form, patient_name: e.target.value })}
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
                placeholder="Nombre del paciente"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Motivo</label>
              <input
                value={form.reason}
                onChange={(e) => onChange({ ...form, reason: e.target.value })}
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
                placeholder="Ej: limpieza, control, urgencia"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Título</label>
            <input
              value={form.title}
              onChange={(e) => onChange({ ...form, title: e.target.value })}
              className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
              placeholder="Ej: Evaluación, Limpieza, Control"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-slate-700">Fecha</label>
              <input
                value={form.date}
                readOnly
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 text-sm text-slate-700"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Hora</label>
              <input
                type="time"
                value={form.time}
                onChange={(e) => onChange({ ...form, time: e.target.value })}
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Estado</label>
              <select
                value={form.status}
                onChange={(e) => onChange({ ...form, status: e.target.value })}
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Notas</label>
            <textarea
              value={form.notes}
              onChange={(e) => onChange({ ...form, notes: e.target.value })}
              className="mt-2 min-h-[110px] w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-300"
              placeholder="Detalles clínicos o preferencias del paciente"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            disabled={saving}
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CalendarBoard() {
  const { clinic } = useClinic();
  const [searchParams] = useSearchParams();

  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [view, setView] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 1024 ? "day" : "week"
  );
  const [selected, setSelected] = useState<Date>(toStartOfDay(new Date()));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("edit");
  const [activeAppt, setActiveAppt] = useState<ApptRow | null>(null);
  const [form, setForm] = useState<ApptForm>({
    title: "",
    notes: "",
    status: "pending",
    date: toStartOfDay(new Date()).toISOString().slice(0, 10),
    time: "09:00",
    patient_name: "",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const viewParam = searchParams.get("view") as ViewMode | null;
    const dateParam = searchParams.get("date");

    if (viewParam && ["month", "week", "day"].includes(viewParam)) {
      setView(viewParam);
    }

    if (dateParam === "today") {
      setSelected(toStartOfDay(new Date()));
    } else if (dateParam && !isNaN(new Date(dateParam).getTime())) {
      setSelected(toStartOfDay(new Date(dateParam)));
    }
  }, [searchParams]);

  function handleTouchStart(e: React.TouchEvent) {
    if (view !== "day") return;
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (view !== "day") return;
    if (touchStartX.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? null;
    if (endX === null) return;
    const delta = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 60) return;
    if (delta < 0) {
      setSelected((prev) => addDays(prev, 1));
    } else {
      setSelected((prev) => addDays(prev, -1));
    }
  }

  const week = useMemo(() => {
    const start = startOfWeekSunday(selected);
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, [selected]);

  const month = useMemo(() => monthGrid(selected), [selected]);

  const rangeStart = useMemo(() => {
    if (view === "day") return toStartOfDay(selected);
    if (view === "week") return toStartOfDay(week[0]);
    return toStartOfDay(month.days[0]);
  }, [view, selected, week, month]);

  const rangeEnd = useMemo(() => {
    if (view === "day") return toEndOfDay(selected);
    if (view === "week") return toEndOfDay(week[6]);
    return toEndOfDay(month.days[month.days.length - 1]);
  }, [view, selected, week, month]);

  const rangeStartISO = useMemo(() => rangeStart.toISOString(), [rangeStart]);
  const rangeEndISO = useMemo(() => rangeEnd.toISOString(), [rangeEnd]);

  async function load() {
    setBusy(true);
    setError(null);

    const q = await supabase
      .from("appointments")
      .select(
        "id, organization_id, lead_id, start_at, starts_at, status, title, notes, appointment_date, appointment_time, patient_name, reason"
      )
      .eq("organization_id", ORG)
      .or(`start_at.gte.${rangeStartISO},starts_at.gte.${rangeStartISO}`)
      .or(`start_at.lte.${rangeEndISO},starts_at.lte.${rangeEndISO}`)
      .order("start_at", { ascending: true });

    if (q.error) {
      setError("No se pudo cargar la agenda.");
      setAppts([]);
      setBusy(false);
      return;
    }

    const rows = ((q.data as any) ?? []) as ApptRow[];
    const normalizedRows = rows.map((r) => ({
      ...r,
      start_at: normalizedStartISO(r),
    }));

    const deduped = dedupeByKey(normalizedRows, appointmentKey);

    const sorted = deduped
      .map((r) => ({ ...r }))
      .sort((a, b) => {
        const ai = normalizedStartISO(a);
        const bi = normalizedStartISO(b);
        return (ai ? new Date(ai).getTime() : 0) - (bi ? new Date(bi).getTime() : 0);
      });

    setAppts(sorted);
    setBusy(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, rangeStartISO, rangeEndISO, ORG]);

  function openEdit(a: ApptRow) {
    const iso = normalizedStartISO(a) ?? new Date().toISOString();
    setModalMode("edit");
    setActiveAppt(a);
    setForm({
      title: a.title?.trim() || a.reason?.trim() || "",
      notes: a.notes?.trim() || "",
      status: normalizeStatus(a.status),
      date: toDateInput(iso),
      time: toTimeInput(iso),
      patient_name: a.patient_name?.trim() || "",
      reason: a.reason?.trim() || "",
    });
    setModalOpen(true);
  }

  function openCreate() {
    const dateStr = toStartOfDay(selected).toISOString().slice(0, 10);
    setModalMode("create");
    setActiveAppt(null);
    setForm({
      title: "",
      notes: "",
      status: "pending",
      date: dateStr,
      time: "09:00",
      patient_name: "",
      reason: "",
    });
    setModalOpen(true);
  }

  async function saveAppointment() {
    const startISO = buildLocalISO(form.date, form.time);
    if (!startISO) return;

    setSaving(true);

    if (modalMode === "create") {
      const ins = await supabase.from("appointments").upsert({
        organization_id: ORG,
        start_at: startISO,
        status: form.status,
        title: form.title.trim() || null,
        notes: form.notes.trim() || null,
        appointment_date: form.date,
        appointment_time: form.time,
        patient_name: form.patient_name.trim() || null,
        reason: form.reason.trim() || null,
      });

      setSaving(false);
      if (ins.error) return;
      setModalOpen(false);
      await load();
      return;
    }

    if (!activeAppt) {
      setSaving(false);
      return;
    }

    const payload: Record<string, any> = {
      start_at: startISO,
      status: form.status,
      title: form.title.trim() || null,
      notes: form.notes.trim() || null,
      appointment_date: form.date,
      appointment_time: form.time,
      patient_name: form.patient_name.trim() || null,
      reason: form.reason.trim() || null,
    };

    if (activeAppt.starts_at) payload.starts_at = startISO;

    const upd = await supabase.from("appointments").update(payload).eq("id", activeAppt.id);
    setSaving(false);

    if (upd.error) return;

    setModalOpen(false);
    await load();
  }

  const dayAppts = useMemo(() => {
    const start = toStartOfDay(selected).getTime();
    const end = addDays(toStartOfDay(selected), 1).getTime();
    return appts.filter((a) => {
      const iso = normalizedStartISO(a);
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= start && t < end;
    });
  }, [appts, selected]);

  const countByDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of appts) {
      const iso = normalizedStartISO(a);
      if (!iso) continue;
      const d = toStartOfDay(new Date(iso));
      const k = d.toISOString().slice(0, 10);
      map[k] = (map[k] ?? 0) + 1;
    }
    return map;
  }, [appts]);

  return (
    <div className="space-y-4 min-w-0 overflow-x-hidden">
      <div>
        <h2 className="text-3xl font-semibold text-slate-900">Agenda</h2>
        <p className="text-sm text-slate-700">
          Vista por Mes / Semana / Día con estados claros y edición rápida.
        </p>
      </div>

      {error ? (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-4 text-sm text-slate-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="flex flex-col gap-3 px-6 py-4 border-b border-[#E5E7EB] md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-slate-900 font-semibold">Agenda</div>
            <div className="text-sm text-slate-700">{fmtRangeLabel(rangeStart, rangeEnd)}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] p-1">
              {(["month", "week", "day"] as ViewMode[]).map((k) => {
                const active = view === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setView(k)}
                    className={[
                      "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                      active ? "bg-[#F4F5F7] text-slate-900" : "text-slate-700 hover:bg-[#F4F5F7] hover:text-slate-900",
                    ].join(" ")}
                  >
                    {k === "month" ? "Mes" : k === "week" ? "Semana" : "Día"}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setSelected(toStartOfDay(new Date()))}
              className="inline-flex items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
            >
              <CalendarDays className="h-4 w-4" />
              Hoy
            </button>

            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Nueva cita
            </button>
          </div>
        </div>

        {view === "month" ? (
          <div className="px-6 py-6">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-slate-900">
                {selected.toLocaleDateString("es", { month: "long", year: "numeric" })}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(toStartOfDay(new Date(selected.getFullYear(), selected.getMonth() - 1, 1)))}
                  className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(toStartOfDay(new Date(selected.getFullYear(), selected.getMonth() + 1, 1)))}
                  className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
                >
                  →
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-2">
              {["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"].map((d) => (
                <div key={d} className="text-xs tracking-[0.18em] text-slate-500 text-center">
                  {d}
                </div>
              ))}

              {month.days.map((d) => {
                const active = toStartOfDay(d).getTime() === toStartOfDay(selected).getTime();
                const inMonth = d.getMonth() === selected.getMonth();
                const k = toStartOfDay(d).toISOString().slice(0, 10);
                const c = countByDay[k] ?? 0;

                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => {
                      setSelected(toStartOfDay(d));
                      setView("day");
                    }}
                    className={[
                      "rounded-2xl border p-3 text-left transition min-h-[86px]",
                      active ? "border-[#E5E7EB] bg-[#F4F5F7]" : "border-[#E5E7EB] bg-[#F4F5F7] hover:bg-[#F4F5F7]",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between">
                      <div className={["text-sm font-semibold", inMonth ? "text-slate-900" : "text-slate-500"].join(" ")}>
                        {d.getDate()}
                      </div>
                      {c > 0 ? (
                        <div className="rounded-full border border-[#E5E7EB] bg-[#F4F5F7] px-2 py-0.5 text-[11px] text-slate-700">
                          {c}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{c > 0 ? `${c} cita(s)` : "—"}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {view === "week" ? (
          <>
            <div className="px-6 py-4 border-b border-[#E5E7EB]">
              <div className="flex gap-3 overflow-x-auto pb-1">
                {week.map((d) => {
                  const active = toStartOfDay(d).getTime() === toStartOfDay(selected).getTime();
                  const k = toStartOfDay(d).toISOString().slice(0, 10);
                  const c = countByDay[k] ?? 0;

                  return (
                    <button
                      key={d.toISOString()}
                      onClick={() => setSelected(toStartOfDay(d))}
                      className={[
                        "min-w-[92px] rounded-2xl border px-4 py-3 text-left transition",
                        active ? "border-[#E5E7EB] bg-[#F4F5F7]" : "border-[#E5E7EB] bg-[#F4F5F7] hover:bg-[#F4F5F7]",
                      ].join(" ")}
                    >
                      <div className="text-[11px] tracking-[0.18em] uppercase text-slate-700">{fmtDayLabel(d)}</div>
                      <div className="mt-1 flex items-center justify-between">
                        <div className="text-lg font-semibold text-slate-900">{fmtDayNum(d)}</div>
                        {c > 0 ? (
                          <div className="rounded-full border border-[#E5E7EB] bg-[#F4F5F7] px-2 py-0.5 text-[11px] text-slate-700">
                            {c}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-6 py-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Día seleccionado</div>
                  <div className="text-lg font-semibold text-slate-900">
                    {selected.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "short" })}
                  </div>
                </div>
                <div className="text-sm text-slate-700">{dayAppts.length} cita(s)</div>
              </div>

              <div className="mt-4 space-y-3">
                {busy ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-20 rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] animate-pulse" />
                    ))}
                  </div>
                ) : dayAppts.length === 0 ? (
                  <div className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] p-6">
                    <div className="text-slate-900 font-semibold">No hay citas este día.</div>
                    <div className="mt-1 text-sm text-slate-700">Crea una cita para comenzar la agenda.</div>
                    <button
                      type="button"
                      onClick={openCreate}
                      className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      <Plus className="h-4 w-4" />
                      Crear cita
                    </button>
                  </div>
                ) : (
                  dayAppts.map((a) => {
                    const badge = statusBadge(a.status);
                    const iso = normalizedStartISO(a);
                    const time = iso ? fmtTimeFromISO(iso) : "—";
                    const patient = a.patient_name?.trim() ? a.patient_name : null;
                    const title = a.title?.trim() ? a.title : a.reason?.trim() ? a.reason : "Cita";
                    const subtitle = patient ? `Paciente: ${patient}` : a.lead_id ? `Lead: ${a.lead_id}` : "Sin paciente";

                    return (
                      <button
                        key={appointmentKey(a)}
                        type="button"
                        onClick={() => openEdit(a)}
                        className="w-full rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-5 py-4 text-left transition hover:bg-[#F4F5F7] focus:outline-none focus:ring-2 focus:ring-blue-200"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">{title}</div>
                            <div className="mt-1 text-xs text-slate-700 truncate">{subtitle}</div>
                          </div>

                          <div className="shrink-0 text-right">
                            <div className="inline-flex items-center gap-2 text-xs text-slate-700">
                              <Clock className="h-3.5 w-3.5" />
                              {time}
                            </div>
                            <div
                              className={[
                                "mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.18em] uppercase",
                                badge.className,
                              ].join(" ")}
                            >
                              <span className={["h-2 w-2 rounded-full", badge.dot].join(" ")} />
                              {badge.label}
                            </div>
                          </div>
                        </div>

                        {a.notes?.trim() ? (
                          <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{a.notes}</div>
                        ) : null}

                        <div className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                          <PencilLine className="h-4 w-4" />
                          Editar cita
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : null}

        {view === "day" ? (
          <div className="px-6 py-6" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500">Día</div>
                <div className="text-lg font-semibold text-slate-900">
                  {selected.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "short" })}
                </div>
              </div>
              <div className="text-sm text-slate-700">{dayAppts.length} cita(s)</div>
            </div>

            <div className="mt-4 space-y-3">
              {busy ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-20 rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] animate-pulse" />
                  ))}
                </div>
              ) : dayAppts.length === 0 ? (
                <div className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] p-6">
                  <div className="text-slate-900 font-semibold">No hay citas este día.</div>
                  <div className="mt-1 text-sm text-slate-700">Crea una cita para comenzar la agenda.</div>
                </div>
              ) : (
                dayAppts.map((a) => {
                  const badge = statusBadge(a.status);
                  const iso = normalizedStartISO(a);
                  const time = iso ? fmtTimeFromISO(iso) : "—";
                  const patient = a.patient_name?.trim() ? a.patient_name : null;
                  const title = a.title?.trim() ? a.title : a.reason?.trim() ? a.reason : "Cita";
                  const subtitle = patient ? `Paciente: ${patient}` : a.lead_id ? `Lead: ${a.lead_id}` : "Sin paciente";

                  return (
                    <button
                      key={appointmentKey(a)}
                      type="button"
                      onClick={() => openEdit(a)}
                      className="w-full rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-5 py-4 text-left transition hover:bg-[#F4F5F7] focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">{title}</div>
                          <div className="mt-1 text-xs text-slate-700 truncate">{subtitle}</div>
                        </div>

                        <div className="shrink-0 text-right">
                          <div className="inline-flex items-center gap-2 text-xs text-slate-700">
                            <Clock className="h-3.5 w-3.5" />
                            {time}
                          </div>
                          <div
                            className={[
                              "mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.18em] uppercase",
                              badge.className,
                            ].join(" ")}
                          >
                            <span className={["h-2 w-2 rounded-full", badge.dot].join(" ")} />
                            {badge.label}
                          </div>
                        </div>
                      </div>

                      {a.notes?.trim() ? (
                        <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{a.notes}</div>
                      ) : null}

                      <div className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                        <PencilLine className="h-4 w-4" />
                        Editar cita
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>

      <AppointmentModal
        open={modalOpen}
        mode={modalMode}
        form={form}
        onChange={setForm}
        onClose={() => setModalOpen(false)}
        onSave={saveAppointment}
        saving={saving}
      />
    </div>
  );
}
