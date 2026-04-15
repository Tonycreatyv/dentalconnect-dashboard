import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, Calendar, MessageCircle, Clock3,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  SendHorizonal, CheckCircle2, XCircle,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";

const DEFAULT_ORG = "clinic-demo";

type AppointmentRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  patient_name: string | null;
  title: string | null;
  reason: string | null;
  status: string | null;
  start_at: string | null;
  starts_at: string | null;
  provider_name: string | null;
};

type WeekAppt = {
  id: string;
  start_at: string | null;
  starts_at: string | null;
  status: string | null;
  patient_name: string | null;
  provider_name: string | null;
};

type AlertRow = {
  id: string;
  title: string;
  body: string | null;
  type: string | null;
  status: string | null;
};

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function apptISO(a: { start_at: string | null; starts_at: string | null }) {
  return a.start_at ?? a.starts_at ?? null;
}
function fmtTime(iso: string | null) {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(d: Date) {
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}
function fmtWeekday(d: Date) {
  return d.toLocaleDateString("es", { weekday: "long" });
}
function getMondayOfWeek(d: Date) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0,0,0,0);
  return m;
}

type StatusKey = "confirmed" | "pending" | "cancelled" | "completed";
const STATUS_STYLES: Record<StatusKey, { chip: string; label: string; dot: string; week: string }> = {
  confirmed: { chip: "bg-emerald-400/10 border-emerald-400/30 text-emerald-300", label: "Confirmada", dot: "bg-emerald-400", week: "text-emerald-300" },
  pending:   { chip: "bg-amber-400/10 border-amber-400/30 text-amber-300",       label: "Pendiente",  dot: "bg-amber-400",  week: "text-amber-300"   },
  cancelled: { chip: "bg-rose-400/10 border-rose-400/30 text-rose-300",         label: "Cancelada",  dot: "bg-rose-400",   week: "text-rose-300"    },
  completed: { chip: "bg-sky-400/10 border-sky-400/30 text-sky-300",            label: "Completada", dot: "bg-sky-400",    week: "text-sky-300"     },
};
function getStatus(raw: string | null): StatusKey {
  const s = (raw ?? "pending").toLowerCase();
  return s in STATUS_STYLES ? (s as StatusKey) : "pending";
}

const DOC_COLORS = [
  "bg-blue-500/20 text-blue-300 border-blue-400/30",
  "bg-purple-500/20 text-purple-300 border-purple-400/30",
  "bg-teal-500/20 text-teal-300 border-teal-400/30",
  "bg-pink-500/20 text-pink-300 border-pink-400/30",
];
function docColor(name: string, doctors: string[]) {
  const idx = doctors.indexOf(name);
  return DOC_COLORS[idx % DOC_COLORS.length] ?? DOC_COLORS[0];
}

function StatPill({ value, label, color, onClick }: {
  value: number; label: string; color: string; onClick?: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition hover:opacity-80 ${color}`}>
      <span className="text-lg font-bold">{value}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}

function ApptCard({ appt, doctors, onConfirm, onComplete, onCancel, onMessage }: {
  appt: AppointmentRow;
  doctors: string[];
  onConfirm: (id: string) => void;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  onMessage: (leadId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const status = getStatus(appt.status);
  const st = STATUS_STYLES[status];
  const time = (appt as any).appointment_time || fmtTime(apptISO(appt));
  const docName = appt.provider_name || "Sin asignar";
  const dc = appt.provider_name ? docColor(docName, doctors) : "bg-white/5 text-white/30 border-white/10";

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0C111C] overflow-hidden">
      <button onClick={() => setOpen(p => !p)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition">
        <div className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
        <span className="text-sm font-bold text-white/50 w-12 shrink-0">{time}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{appt.patient_name || "Paciente"}</div>
          <div className="text-xs text-white/40 truncate">{appt.reason || appt.title || "Consulta general"}</div>
        </div>
        <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border hidden sm:inline ${dc}`}>
          {docName}
        </span>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${st.chip}`}>
          {st.label}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-white/30 shrink-0" /> : <ChevronDown className="h-4 w-4 text-white/30 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/[0.06]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3 mb-4">
            {[
              { label: "Paciente", value: appt.patient_name || "—" },
              { label: "Servicio", value: appt.reason || appt.title || "Consulta" },
              { label: "Hora",     value: time },
              { label: "Doctor",   value: docName },
              { label: "Estado",   value: st.label },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-[10px] text-white/30 uppercase tracking-wide mb-0.5">{label}</div>
                <div className="text-sm text-white/85">{value}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {status === "pending" && (
              <button onClick={() => onConfirm(appt.id)}
                className="flex-1 min-w-[100px] h-9 rounded-xl bg-emerald-400/10 border border-emerald-400/30 text-xs font-medium text-emerald-300 hover:bg-emerald-400/20 flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar
              </button>
            )}
            {status === "confirmed" && (
              <button onClick={() => onComplete(appt.id)}
                className="flex-1 min-w-[100px] h-9 rounded-xl bg-sky-400/10 border border-sky-400/30 text-xs font-medium text-sky-300 hover:bg-sky-400/20 flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Completar
              </button>
            )}
            <button onClick={() => onMessage(appt.lead_id)}
              className="flex-1 min-w-[100px] h-9 rounded-xl bg-white/5 border border-white/15 text-xs font-medium text-white/70 hover:bg-white/10 flex items-center justify-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" /> Mensaje
            </button>
            {status !== "cancelled" && status !== "completed" && (
              <button onClick={() => onCancel(appt.id)}
                className="h-9 px-3 rounded-xl bg-rose-500/10 border border-rose-400/30 text-xs font-medium text-rose-300 hover:bg-rose-500/20 flex items-center justify-center gap-1">
                <XCircle className="h-3.5 w-3.5" /> Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WeekCalendar({ weekAppts, selectedDate, onDayClick, docFilter }: {
  weekAppts: WeekAppt[];
  selectedDate: Date;
  onDayClick: (d: Date) => void;
  docFilter: string;
}) {
  const monday = getMondayOfWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const today = startOfDay(new Date());
  const DAY_NAMES = ["Lu","Ma","Mi","Ju","Vi","Sá","Do"];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        <span className="text-xs font-medium text-white/40 uppercase tracking-wide">Esta semana</span>
        <button onClick={() => onDayClick(new Date())} className="text-xs text-[#3CBDB9] hover:underline">
          Ir a hoy
        </button>
      </div>
      <div className="grid grid-cols-7 divide-x divide-white/[0.06]">
        {days.map((day, i) => {
          const isToday    = startOfDay(day).getTime() === today.getTime();
          const isSelected = startOfDay(day).getTime() === startOfDay(selectedDate).getTime();
          const dayStr     = startOfDay(day).toISOString().slice(0, 10);
          const dayAppts   = weekAppts.filter(a => {
            const iso = apptISO(a);
            if (!iso) return false;
            if (iso.slice(0, 10) !== dayStr) return false;
            if (docFilter !== "all" && docFilter !== "unassigned" && a.provider_name !== docFilter) return false;
            if (docFilter === "unassigned" && a.provider_name) return false;
            return true;
          });

          return (
            <button key={i} onClick={() => onDayClick(day)}
              className={`flex flex-col items-center py-2 px-0.5 min-h-[76px] transition hover:bg-white/[0.04] ${isSelected ? "bg-white/[0.06]" : ""}`}>
              <span className="text-[10px] text-white/30 mb-1">{DAY_NAMES[i]}</span>
              <span className={`text-sm font-medium mb-1.5 w-7 h-7 flex items-center justify-center rounded-full ${
                isToday    ? "bg-[#3CBDB9] text-[#0B1117]" :
                isSelected ? "border border-[#3CBDB9]/50 text-[#3CBDB9]" :
                             "text-white/70"
              }`}>
                {day.getDate()}
              </span>
              <div className="flex flex-col gap-0.5 w-full px-0.5">
                {dayAppts.slice(0, 2).map((a, ai) => {
                  const st = STATUS_STYLES[getStatus(a.status)];
                  return (
                    <div key={ai} className={`text-[9px] truncate px-1 py-0.5 rounded bg-white/5 ${st.week}`}>
                      {(a as any).appointment_time || fmtTime(apptISO(a))} {a.patient_name?.split(" ")[0] ?? "—"}
                    </div>
                  );
                })}
                {dayAppts.length > 2 && (
                  <div className="text-[9px] text-white/30 text-center">+{dayAppts.length - 2}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Hoy() {
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const orgId = clinic?.organization_id ?? DEFAULT_ORG;

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [weekAppts, setWeekAppts] = useState<WeekAppt[]>([]);
  const [newMessages, setNewMessages] = useState(0);
  const [pendingOutbox, setPendingOutbox] = useState(0);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [tomorrowCount, setTomorrowCount] = useState(0);
  const [weekCount, setWeekCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [docFilter, setDocFilter] = useState("all");

  const isToday = useMemo(
    () => startOfDay(selectedDate).getTime() === startOfDay(new Date()).getTime(),
    [selectedDate],
  );

  const doctors = useMemo(() => {
    const names = appointments.map(a => a.provider_name).filter((n): n is string => !!n);
    return [...new Set(names)];
  }, [appointments]);

  const filteredAppts = useMemo(() => {
    if (docFilter === "all") return appointments;
    if (docFilter === "unassigned") return appointments.filter(a => !a.provider_name);
    return appointments.filter(a => a.provider_name === docFilter);
  }, [appointments, docFilter]);

  const pendingCount   = appointments.filter(a => getStatus(a.status) === "pending").length;
  const confirmedCount = appointments.filter(a => getStatus(a.status) === "confirmed").length;

  async function load() {
    setLoading(true);
    const todayStart = startOfDay(selectedDate).toISOString();
    const todayEnd   = endOfDay(selectedDate).toISOString();
    const tomorrow   = new Date(selectedDate.getTime() + 86_400_000);
    const monday     = getMondayOfWeek(selectedDate);
    const sunday     = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23,59,59,999);
    const oneDayAgo  = new Date(Date.now() - 86_400_000).toISOString();

    const [apptsRes, weekRes, msgsRes, outboxRes, alertsRes, tmrwRes, weekCountRes] = await Promise.all([
      supabase.from("appointments")
        .select("id, organization_id, lead_id, patient_name, title, reason, status, start_at, starts_at, provider_name, appointment_time")
        .eq("organization_id", orgId)
        .gte("start_at", todayStart).lte("start_at", todayEnd)
        .order("start_at", { ascending: true }),
      supabase.from("appointments")
        .select("id, start_at, starts_at, status, patient_name, provider_name, appointment_time")
        .eq("organization_id", orgId)
        .gte("start_at", monday.toISOString()).lte("start_at", sunday.toISOString())
        .neq("status", "cancelled"),
      supabase.from("messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId).eq("role", "user").gte("created_at", todayStart),
      supabase.from("reply_outbox")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId).in("status", ["queued","pending","processing"])
        .gte("created_at", oneDayAgo),
      supabase.from("alerts")
        .select("id, title, body, type, status")
        .eq("organization_id", orgId).eq("status", "open").neq("type", "daily_digest")
        .order("created_at", { ascending: false }).limit(3),
      supabase.from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .gte("start_at", startOfDay(tomorrow).toISOString())
        .lte("start_at", endOfDay(tomorrow).toISOString()),
      supabase.from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .gte("start_at", monday.toISOString()).lte("start_at", sunday.toISOString())
        .neq("status", "cancelled"),
    ]);

    if (!apptsRes.error) setAppointments(apptsRes.data as AppointmentRow[] ?? []);
    if (!weekRes.error)  setWeekAppts(weekRes.data as WeekAppt[] ?? []);
    setNewMessages(msgsRes.count ?? 0);
    setPendingOutbox(outboxRes.count ?? 0);
    if (!alertsRes.error) setAlerts(alertsRes.data as AlertRow[] ?? []);
    setTomorrowCount(tmrwRes.count ?? 0);
    setWeekCount(weekCountRes.count ?? 0);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [orgId, selectedDate]);

  async function confirmAppointment(id: string) {
    await supabase.from("appointments").update({ status: "confirmed" }).eq("id", id);
    await load();
  }
  async function completeAppointment(id: string) {
    await supabase.from("appointments").update({ status: "completed" }).eq("id", id);
    await load();
  }
  async function cancelAppointment(id: string) {
    if (!window.confirm("¿Cancelar esta cita?")) return;
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);
    await load();
  }

  return (
    <div className="space-y-4">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{clinic?.name ?? "Clínica"}</h1>
          <p className="text-sm text-white/50 capitalize">Hoy · {fmtWeekday(new Date())}</p>
        </div>
        <button onClick={() => navigate("/settings?tab=integraciones")}
          className="relative flex items-center justify-center w-11 h-11 rounded-2xl border border-white/15 bg-white/5 text-white/80 hover:bg-white/10">
          <Bell className="h-5 w-5" />
          {alerts.length > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-rose-500 text-[10px] font-bold text-white px-1">
              {alerts.length}
            </span>
          )}
        </button>
      </div>

      {pendingCount > 0 && (
        <button onClick={() => navigate("/agenda")}
          className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition text-left">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#59E0B8] opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#59E0B8]" />
          </span>
          <span className="text-sm text-white/70">
            {pendingCount} {pendingCount === 1 ? "cita pendiente" : "citas pendientes"} de confirmación hoy
          </span>
          <span className="ml-auto text-xs text-[#59E0B8]">Ver →</span>
        </button>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        <StatPill value={newMessages} label="mensajes"
          color="bg-blue-500/10 border border-blue-400/20 text-blue-400"
          onClick={() => navigate("/inbox")} />
        <StatPill value={pendingOutbox} label="pendientes"
          color="bg-amber-500/10 border border-amber-400/20 text-amber-400"
          onClick={() => navigate("/inbox")} />
        <StatPill value={appointments.length} label="citas hoy"
          color="bg-white/5 border border-white/10 text-white" />
        <StatPill value={weekCount} label="esta semana"
          color="bg-emerald-500/10 border border-emerald-400/20 text-emerald-400"
          onClick={() => navigate("/agenda")} />
      </div>

      <WeekCalendar
        weekAppts={weekAppts}
        selectedDate={selectedDate}
        onDayClick={setSelectedDate}
        docFilter={docFilter}
      />

      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-2">
        <button onClick={() => setSelectedDate(new Date(selectedDate.getTime() - 86_400_000))}
          className="p-2 rounded-xl hover:bg-white/10 text-white/70">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 text-center">
          <button onClick={() => setSelectedDate(new Date())}
            className="text-sm font-semibold text-white hover:text-[#3CBDB9]">
            {fmtDate(selectedDate)}
          </button>
          {!isToday && (
            <button onClick={() => setSelectedDate(new Date())}
              className="ml-2 text-xs text-[#3CBDB9] hover:underline">
              Ir a hoy
            </button>
          )}
        </div>
        <button onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 86_400_000))}
          className="p-2 rounded-xl hover:bg-white/10 text-white/70">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {[
          { key: "all", label: "Todos" },
          ...doctors.map(d => ({ key: d, label: d })),
          { key: "unassigned", label: "Sin asignar" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setDocFilter(key)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition ${
              docFilter === key
                ? "bg-[#3CBDB9]/10 border-[#3CBDB9]/40 text-[#3CBDB9]"
                : "border-white/10 text-white/40 hover:text-white/70 hover:border-white/20"
            }`}>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide">
            {isToday ? "Citas de hoy" : `Citas del ${fmtDate(selectedDate)}`}
          </h2>
          <span className="text-xs text-white/30">
            {confirmedCount} confirmadas · {pendingCount} pendientes
          </span>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-white/40">Cargando...</div>
        ) : filteredAppts.length === 0 ? (
          <div className="py-10 text-center">
            <Calendar className="h-10 w-10 text-white/15 mx-auto mb-3" />
            <p className="text-sm text-white/40">
              {docFilter !== "all" ? "No hay citas para este filtro" : "No hay citas para este día"}
            </p>
            <button onClick={() => navigate("/agenda")}
              className="mt-3 text-sm text-[#3CBDB9] font-medium hover:underline">
              Crear nueva cita
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredAppts.map(a => (
              <ApptCard key={a.id} appt={a} doctors={doctors}
                onConfirm={confirmAppointment}
                onComplete={completeAppointment}
                onCancel={cancelAppointment}
                onMessage={leadId => navigate(leadId ? `/inbox/${leadId}` : "/inbox")}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-white/30" />
          <div>
            <p className="text-sm font-medium text-white/70">Mañana</p>
            <p className="text-xs text-white/40">{tomorrowCount} citas programadas</p>
          </div>
        </div>
        <button onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 86_400_000))}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-xs font-medium text-white/70 hover:bg-white/10">
          <SendHorizonal className="h-3.5 w-3.5" /> Ver
        </button>
      </div>

    </div>
  );
}
