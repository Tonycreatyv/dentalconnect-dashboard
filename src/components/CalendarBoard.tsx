// src/components/CalendarBoard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronDown, ChevronLeft, Clock, PencilLine, Plus, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { dedupeByKey } from "../lib/dedupe";
import { appointmentKey, normalizedStartISO } from "../lib/appointments";
import { addDays, buildLocalISO, startOfWeekSunday, toEndOfDay, toStartOfDay } from "../lib/time";
import { defaultHours, generateTimeSlots, getDayKey, HoursMap, minutesToSlot, slotToMinutes } from "../lib/availability";
import { Toast, type ToastKind } from "./ui/Toast";
import PageHeader from "./PageHeader";

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
  availableDates,
  availableTimes,
  loadingAvailability,
  busyTimeSet,
  error,
  onChange,
  onClose,
  onSave,
  onDelete,
  onBack,
  saving,
}: {
  open: boolean;
  mode: ModalMode;
  form: ApptForm;
  availableDates: Set<string>;
  availableTimes: string[];
  loadingAvailability: boolean;
  busyTimeSet: Set<string>;
  error: string | null;
  onChange: (next: ApptForm) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onBack: () => void;
  saving: boolean;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const safeDate =
    form.date && !Number.isNaN(new Date(form.date).getTime())
      ? new Date(`${form.date}T00:00:00`)
      : new Date();
  const calendarMonth = useMemo(() => monthGrid(safeDate), [safeDate]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xl sm:items-center sm:px-4">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden border border-white/10 bg-white/10 shadow-[0_24px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:h-auto sm:max-h-[92vh] sm:max-w-xl sm:rounded-3xl">
        <div className="sticky top-0 z-20 border-b border-white/10 bg-black/25 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 backdrop-blur-lg sm:px-6 sm:pt-6 sm:pb-4 sm:border-b-0 sm:bg-transparent sm:backdrop-blur-0">
          <div className="flex items-center justify-between gap-2 md:hidden">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-11 items-center gap-1 rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white/90 hover:bg-white/15"
            >
              <ChevronLeft className="h-4 w-4" />
              Volver
            </button>
            <div className="truncate text-sm font-semibold text-white/95">
              {mode === "create" ? "Nueva cita" : "Editar cita"}
            </div>
            <button
              type="button"
              onClick={onSave}
              className="h-11 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              disabled={saving}
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>

          <div className="hidden items-center justify-between md:flex">
          <div>
            <div className="text-lg font-semibold text-white">
              {mode === "create" ? "Nueva cita" : "Editar cita"}
            </div>
            <div className="text-sm text-white/60">Actualiza detalles del paciente y la cita.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
          >
            Cerrar
          </button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-4 pb-28 pt-3 sm:px-6 sm:pb-24">
          <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-white/80">Paciente</label>
              <input
                value={form.patient_name}
                onChange={(e) => onChange({ ...form, patient_name: e.target.value })}
                className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white outline-none focus:border-[#3CBDB9] focus:ring-4 focus:ring-[#3CBDB9]/20"
                placeholder="Nombre del paciente"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/80">Motivo</label>
              <input
                value={form.reason}
                onChange={(e) => onChange({ ...form, reason: e.target.value })}
                className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white outline-none focus:border-[#3CBDB9] focus:ring-4 focus:ring-[#3CBDB9]/20"
                placeholder="Ej: limpieza, control, urgencia"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-white/80">Título</label>
            <input
              value={form.title}
              onChange={(e) => onChange({ ...form, title: e.target.value })}
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white outline-none focus:border-[#3CBDB9] focus:ring-4 focus:ring-[#3CBDB9]/20"
              placeholder="Ej: Evaluación, Limpieza, Control"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-white/80">Fecha</label>
              <div className="relative mt-2">
                <button
                  type="button"
                  onClick={() => setCalendarOpen((v) => !v)}
                  className="flex h-11 w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white/70"
                >
                  {form.date}
                  <ChevronDown className="h-4 w-4" />
                </button>
                {calendarOpen ? (
                  <div className="absolute left-0 top-[48px] z-[60] w-[290px] rounded-2xl border border-white/15 bg-zinc-900/95 p-3 shadow-2xl backdrop-blur-lg">
                    <div className="mb-2 text-xs font-semibold text-white/90">
                      {new Date(form.date).toLocaleDateString("es", { month: "long", year: "numeric" })}
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-white/55">
                      {["D", "L", "M", "X", "J", "V", "S"].map((d) => (
                        <div key={d}>{d}</div>
                      ))}
                    </div>
                    <div className="mt-1 grid grid-cols-7 gap-1">
                      {calendarMonth.days.map((d) => {
                        const key = toStartOfDay(d).toISOString().slice(0, 10);
                        const selectedDay = key === form.date;
                        const disabled = !availableDates.has(key);
                        const inMonth = d.getMonth() === new Date(form.date).getMonth();
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              onChange({ ...form, date: key, time: "" });
                              setCalendarOpen(false);
                            }}
                            className={[
                              "h-8 rounded-lg text-xs transition",
                              selectedDay ? "bg-blue-600 text-white" : "",
                              !selectedDay && disabled ? "bg-white/5 text-white/35" : "",
                              !selectedDay && !disabled ? "text-white/90 hover:bg-white/10" : "",
                              !inMonth ? "opacity-40" : "",
                            ].join(" ")}
                          >
                            {d.getDate()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-white/80">Hora</label>
              <select
                value={form.time}
                onChange={(e) => onChange({ ...form, time: e.target.value })}
                className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white outline-none focus:border-[#3CBDB9] focus:ring-4 focus:ring-[#3CBDB9]/20"
              >
                <option value="">{loadingAvailability ? "Cargando horarios..." : "Seleccionar hora"}</option>
                {availableTimes.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                    {busyTimeSet.has(slot) ? " (ocupada)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-white/80">Estado</label>
              <select
                value={form.status}
                onChange={(e) => onChange({ ...form, status: e.target.value })}
                className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-[#3CBDB9] focus:ring-4 focus:ring-[#3CBDB9]/20"
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
            <label className="text-xs font-medium text-white/80">Notas</label>
            <textarea
              value={form.notes}
              onChange={(e) => onChange({ ...form, notes: e.target.value })}
              className="mt-2 min-h-[110px] w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-[#3CBDB9] focus:ring-4 focus:ring-[#3CBDB9]/20"
              placeholder="Detalles clínicos o preferencias del paciente"
            />
          </div>
          {error ? (
            <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
          </div>
        </div>

        <div className="border-t border-white/10 bg-black/20 px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))] backdrop-blur-lg md:px-6">
          <div className="grid gap-2 md:flex md:items-center md:justify-between">
            {mode === "edit" ? (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/20 md:justify-start"
                disabled={saving}
              >
                <Trash2 className="h-4 w-4" />
                Borrar cita
              </button>
            ) : (
              <div className="hidden md:block" />
            )}
            <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/70 hover:bg-white/10"
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSave}
                className="h-11 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                disabled={saving}
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CalendarBoard() {
  const navigate = useNavigate();
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
  const [deleting, setDeleting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [hoursMap, setHoursMap] = useState<HoursMap>(defaultHours());
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [busyTimes, setBusyTimes] = useState<Set<string>>(new Set());
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);
  const touchStartX = useRef<number | null>(null);
  const patientFilter = searchParams.get("patient")?.trim() ?? "";
  const createForPatient = searchParams.get("createFor")?.trim() ?? "";

  function goBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/agenda");
  }

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

  function prevPeriod() {
    if (view === "day") {
      setSelected((prev) => addDays(prev, -1));
      return;
    }
    if (view === "week") {
      setSelected((prev) => addDays(prev, -7));
      return;
    }
    setSelected(toStartOfDay(new Date(selected.getFullYear(), selected.getMonth() - 1, 1)));
  }

  function nextPeriod() {
    if (view === "day") {
      setSelected((prev) => addDays(prev, 1));
      return;
    }
    if (view === "week") {
      setSelected((prev) => addDays(prev, 7));
      return;
    }
    setSelected(toStartOfDay(new Date(selected.getFullYear(), selected.getMonth() + 1, 1)));
  }

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

  async function loadOrgAvailabilitySettings() {
    const orgRes = await supabase
      .from("org_settings")
      .select("hours, google_calendar_connected")
      .eq("organization_id", ORG)
      .maybeSingle();

    if (!orgRes.error && orgRes.data) {
      const dbHours = (orgRes.data as any).hours;
      if (dbHours && typeof dbHours === "object") {
        setHoursMap({ ...defaultHours(), ...(dbHours as HoursMap) });
      }
      setGoogleCalendarConnected(Boolean((orgRes.data as any).google_calendar_connected));
    }
  }

  async function getAvailability(date: string) {
    setLoadingAvailability(true);
    const selectedDate = new Date(`${date}T00:00:00`);
    const dayKey = getDayKey(selectedDate);
    const dayHours = hoursMap[dayKey] ?? { closed: false, open: "08:00", close: "17:00" };

    if (dayHours.closed) {
      setAvailableTimes([]);
      setBusyTimes(new Set());
      setLoadingAvailability(false);
      return;
    }

    const open = dayHours.open ?? "08:00";
    const close = dayHours.close ?? "17:00";
    const allSlots = generateTimeSlots(open, close, 15);
    const busy = new Set<string>();

    const dayStart = toStartOfDay(selectedDate).toISOString();
    const dayEnd = toEndOfDay(selectedDate).toISOString();

    const dbMain = await supabase
      .from("appointments")
      .select("id, start_at, starts_at, appointment_date, appointment_time")
      .eq("organization_id", ORG)
      .gte("start_at", dayStart)
      .lte("start_at", dayEnd);

    const dbLegacyStart = await supabase
      .from("appointments")
      .select("id, start_at, starts_at, appointment_date, appointment_time")
      .eq("organization_id", ORG)
      .gte("starts_at", dayStart)
      .lte("starts_at", dayEnd);

    const dbLegacyDate = await supabase
      .from("appointments")
      .select("id, start_at, starts_at, appointment_date, appointment_time")
      .eq("organization_id", ORG)
      .eq("appointment_date", date);

    const rows = dedupeByKey(
      [
        ...((dbMain.data as any[]) ?? []),
        ...((dbLegacyStart.data as any[]) ?? []),
        ...((dbLegacyDate.data as any[]) ?? []),
      ],
      (row) => String(row.id ?? `${row.appointment_date}-${row.appointment_time}`)
    );

    for (const row of rows) {
        if (modalMode === "edit" && activeAppt?.id === row.id) continue;
        const iso =
          row.start_at ??
          row.starts_at ??
          buildLocalISO(row.appointment_date ?? date, row.appointment_time ?? "09:00");
        if (!iso) continue;
        busy.add(toTimeInput(iso));
    }

    if (googleCalendarConnected) {
      const gc = await supabase.functions.invoke("calendar-busy", {
        body: { organization_id: ORG, date },
      });
      if (!gc.error && Array.isArray((gc.data as any)?.busy)) {
        for (const range of (gc.data as any).busy) {
          const start = toTimeInput(range.start);
          const end = toTimeInput(range.end);
          const startM = slotToMinutes(start);
          const endM = slotToMinutes(end);
          for (let m = startM; m < endM; m += 15) busy.add(minutesToSlot(m));
        }
      }
    }

    setBusyTimes(busy);
    setAvailableTimes(allSlots.filter((s) => !busy.has(s)));
    setLoadingAvailability(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, rangeStartISO, rangeEndISO, ORG]);

  useEffect(() => {
    loadOrgAvailabilitySettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ORG]);

  useEffect(() => {
    if (!modalOpen) return;
    if (!form.date) return;
    getAvailability(form.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, form.date, modalMode, activeAppt?.id, googleCalendarConnected, hoursMap, ORG]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

      if (view === "day" && !e.shiftKey) {
        e.preventDefault();
        if (e.key === "ArrowLeft") setSelected((prev) => addDays(prev, -1));
        if (e.key === "ArrowRight") setSelected((prev) => addDays(prev, 1));
      }
      if (view === "week" && e.shiftKey) {
        e.preventDefault();
        if (e.key === "ArrowLeft") setSelected((prev) => addDays(prev, -7));
        if (e.key === "ArrowRight") setSelected((prev) => addDays(prev, 7));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);

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
    setModalError(null);
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
      patient_name: createForPatient,
      reason: "",
    });
    setModalError(null);
    setModalOpen(true);
  }

  async function saveAppointment() {
    setModalError(null);
    if (!form.date || !form.time) {
      setModalError("Fecha y hora son obligatorias.");
      return;
    }
    if (!availableTimes.includes(form.time)) {
      setModalError("La hora seleccionada no está disponible para esa fecha.");
      return;
    }

    const startISO = buildLocalISO(form.date, form.time);
    if (!startISO) return;

    setSaving(true);

    if (modalMode === "create") {
      const payload = {
        organization_id: ORG,
        start_at: startISO,
        status: form.status,
        title: form.title.trim() || null,
        notes: form.notes.trim() || null,
        appointment_date: form.date,
        appointment_time: form.time,
        patient_name: form.patient_name.trim() || null,
        reason: form.reason.trim() || null,
      };
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[agenda:create] payload", payload);
      }
      const ins = await supabase.from("appointments").upsert(payload).select("id").maybeSingle();

      setSaving(false);
      if (ins.error) {
        const msg = `No se pudo guardar la cita: ${ins.error.message}. Hint: revisa permisos RLS o columnas requeridas.`;
        setModalError(msg);
        setToast({ kind: "error", message: msg });
        return;
      }
      setModalOpen(false);
      await load();
      setToast({ kind: "success", message: "Cita creada correctamente." });
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

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[agenda:update] payload", { id: activeAppt.id, organization_id: ORG, ...payload });
    }
    const upd = await supabase
      .from("appointments")
      .update(payload)
      .eq("id", activeAppt.id)
      .eq("organization_id", ORG)
      .select("id")
      .maybeSingle();
    setSaving(false);

    if (upd.error) {
      const msg = `No se pudo actualizar la cita: ${upd.error.message}. Hint: revisa RLS de UPDATE en appointments.`;
      setModalError(msg);
      setToast({ kind: "error", message: msg });
      return;
    }
    if (!upd.data) {
      const msg = "No se actualizó ninguna fila. Hint: verifica id/organization_id o políticas RLS.";
      setModalError(msg);
      setToast({ kind: "error", message: msg });
      return;
    }

    setModalOpen(false);
    await load();
    setToast({ kind: "success", message: "Cita actualizada." });
  }

  async function deleteAppointment() {
    if (!activeAppt?.id) return;
    const confirmed = window.confirm("¿Seguro que quieres borrar esta cita?");
    if (!confirmed) return;

    setDeleting(true);
    const del = await supabase.from("appointments").delete().eq("id", activeAppt.id).eq("organization_id", ORG);
    setDeleting(false);
    if (del.error) {
      const msg = `No se pudo borrar la cita: ${del.error.message}. Hint: revisa RLS para DELETE en appointments.`;
      setModalError(msg);
      setToast({ kind: "error", message: msg });
      return;
    }

    setModalOpen(false);
    await load();
    setToast({ kind: "success", message: "Cita eliminada." });
  }

  async function quickDeleteAppointment(appointmentId: string) {
    const confirmed = window.confirm("¿Eliminar esta cita?");
    if (!confirmed) return;

    const del = await supabase
      .from("appointments")
      .delete()
      .eq("id", appointmentId)
      .eq("organization_id", ORG);

    if (del.error) return;
    await load();
  }

  const dayAppts = useMemo(() => {
    const start = toStartOfDay(selected).getTime();
    const end = addDays(toStartOfDay(selected), 1).getTime();
    return appts.filter((a) => {
      const iso = normalizedStartISO(a);
      if (!iso) return false;
      const t = new Date(iso).getTime();
      if (t < start || t >= end) return false;
      if (!patientFilter) return true;
      const patient = (a.patient_name ?? "").toLowerCase();
      return patient.includes(patientFilter.toLowerCase());
    });
  }, [appts, selected, patientFilter]);

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

  const modalAvailableDates = useMemo(() => {
    const baseDate = new Date(form.date || new Date().toISOString());
    const grid = monthGrid(baseDate).days;
    const set = new Set<string>();
    for (const d of grid) {
      const key = toStartOfDay(d).toISOString().slice(0, 10);
      const dayKey = getDayKey(d);
      const dayCfg = hoursMap[dayKey] ?? { closed: false };
      if (!dayCfg.closed) set.add(key);
    }
    return set;
  }, [form.date, hoursMap]);

  return (
    <div className="space-y-4 min-w-0 overflow-x-hidden">
      <PageHeader
        title="Agenda"
        subtitle="Vista por Mes / Semana / Día con estados claros y edición rápida."
        showBackOnMobile
        backTo="/agenda"
      />

      {error ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
        <div className="flex flex-col gap-3 border-b border-white/10 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-semibold text-white">Agenda</div>
            <div className="text-sm text-white/60">{fmtRangeLabel(rangeStart, rangeEnd)}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
              {(["month", "week", "day"] as ViewMode[]).map((k) => {
                const active = view === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setView(k)}
                    className={[
                      "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                      active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/10 hover:text-white",
                    ].join(" ")}
                  >
                    {k === "month" ? "Mes" : k === "week" ? "Semana" : "Día"}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 rounded-2xl border border-white/20 bg-white/10 p-1">
              <button
                type="button"
                onClick={prevPeriod}
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/15"
                aria-label={
                  view === "week"
                    ? "Semana anterior"
                    : view === "day"
                    ? "Día anterior"
                    : "Mes anterior"
                }
              >
                ←
              </button>
              <button
                type="button"
                onClick={nextPeriod}
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/15"
                aria-label={
                  view === "week"
                    ? "Semana siguiente"
                    : view === "day"
                    ? "Día siguiente"
                    : "Mes siguiente"
                }
              >
                →
              </button>
            </div>

            <button
              type="button"
              onClick={() => setSelected(toStartOfDay(new Date()))}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/10"
            >
              <CalendarDays className="h-4 w-4" />
              Hoy
            </button>

            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#3CBDB9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#35a9a5]"
            >
              <Plus className="h-4 w-4" />
              Nueva cita
            </button>
          </div>
        </div>

        {view === "month" ? (
          <div className="px-6 py-6">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-white">
                {selected.toLocaleDateString("es", { month: "long", year: "numeric" })}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(toStartOfDay(new Date(selected.getFullYear(), selected.getMonth() - 1, 1)))}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/10"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(toStartOfDay(new Date(selected.getFullYear(), selected.getMonth() + 1, 1)))}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/10"
                >
                  →
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-2">
              {["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"].map((d) => (
                <div key={d} className="text-center text-xs tracking-[0.18em] text-white/50">
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
                      active ? "border-white/10 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between">
                      <div className={["text-sm font-semibold", inMonth ? "text-white" : "text-white/40"].join(" ")}>
                        {d.getDate()}
                      </div>
                      {c > 0 ? (
                        <div className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
                          {c}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2 text-xs text-white/50">{c > 0 ? `${c} cita(s)` : "—"}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {view === "week" ? (
          <>
            <div className="border-b border-white/10 px-6 py-4">
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
                        active ? "border-white/10 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10",
                      ].join(" ")}
                    >
                      <div className="text-[11px] tracking-[0.18em] uppercase text-white/70">{fmtDayLabel(d)}</div>
                      <div className="mt-1 flex items-center justify-between">
                        <div className="text-lg font-semibold text-white">{fmtDayNum(d)}</div>
                        {c > 0 ? (
                          <div className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
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
                  <div className="text-xs text-white/50">Día seleccionado</div>
                  <div className="text-lg font-semibold text-white">
                    {selected.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "short" })}
                  </div>
                </div>
                <div className="text-sm text-white/60">{dayAppts.length} cita(s)</div>
              </div>

              <div className="mt-4 space-y-3">
                {busy ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-20 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
                    ))}
                  </div>
                ) : dayAppts.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                    <div className="font-semibold text-white">No hay citas este día.</div>
                    <div className="mt-1 text-sm text-white/60">Crea una cita para comenzar la agenda.</div>
                    <button
                      type="button"
                      onClick={openCreate}
                      className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-[#3CBDB9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#35a9a5]"
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
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#3CBDB9]/20"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{title}</div>
                            <div className="mt-1 truncate text-xs text-white/60">{subtitle}</div>
                          </div>

                          <div className="shrink-0">
                            <div className="flex items-center gap-3">
                              <div className="inline-flex items-center gap-2 text-xs text-white/60">
                                <Clock className="h-3.5 w-3.5" />
                                {time}
                              </div>
                              <div
                                className={[
                                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.18em] uppercase",
                                  badge.className,
                                ].join(" ")}
                              >
                                <span className={["h-2 w-2 rounded-full", badge.dot].join(" ")} />
                                {badge.label}
                              </div>
                            </div>
                          </div>
                        </div>

                        {a.notes?.trim() ? (
                          <div className="mt-3 whitespace-pre-wrap text-sm text-white/60">{a.notes}</div>
                        ) : null}

                        <div className="mt-4 flex items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-2 text-xs font-semibold text-white/70">
                            <PencilLine className="h-4 w-4" />
                            Editar cita
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              quickDeleteAppointment(a.id);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Borrar
                          </button>
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
                <div className="text-xs text-white/50">Día</div>
                <div className="text-lg font-semibold text-white">
                  {selected.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "short" })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelected((prev) => addDays(prev, -1))}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/15"
                  aria-label="Día anterior"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => setSelected((prev) => addDays(prev, 1))}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/15"
                  aria-label="Día siguiente"
                >
                  →
                </button>
                <div className="text-sm text-white/60">{dayAppts.length} cita(s)</div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {busy ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-20 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
                  ))}
                </div>
              ) : dayAppts.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <div className="font-semibold text-white">No hay citas este día.</div>
                  <div className="mt-1 text-sm text-white/60">Crea una cita para comenzar la agenda.</div>
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
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#3CBDB9]/20"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{title}</div>
                          <div className="mt-1 truncate text-xs text-white/60">{subtitle}</div>
                        </div>

                        <div className="shrink-0">
                          <div className="flex items-center gap-3">
                            <div className="inline-flex items-center gap-2 text-xs text-white/60">
                              <Clock className="h-3.5 w-3.5" />
                              {time}
                            </div>
                            <div
                              className={[
                                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.18em] uppercase",
                                badge.className,
                              ].join(" ")}
                            >
                              <span className={["h-2 w-2 rounded-full", badge.dot].join(" ")} />
                              {badge.label}
                            </div>
                          </div>
                        </div>
                      </div>

                      {a.notes?.trim() ? (
                        <div className="mt-3 whitespace-pre-wrap text-sm text-white/60">{a.notes}</div>
                      ) : null}

                      <div className="mt-4 flex items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-2 text-xs font-semibold text-white/70">
                          <PencilLine className="h-4 w-4" />
                          Editar cita
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            quickDeleteAppointment(a.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Borrar
                        </button>
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
        availableDates={modalAvailableDates}
        availableTimes={availableTimes}
        loadingAvailability={loadingAvailability}
        busyTimeSet={busyTimes}
        error={modalError}
        onChange={setForm}
        onClose={() => setModalOpen(false)}
        onSave={saveAppointment}
        onDelete={deleteAppointment}
        onBack={() => setModalOpen(false)}
        saving={saving || deleting}
      />

      <Toast
        open={Boolean(toast)}
        kind={toast?.kind}
        message={toast?.message ?? ""}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
