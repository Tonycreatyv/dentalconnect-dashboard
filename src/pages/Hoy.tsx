import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, Clock3, MessageCircle, SendHorizonal, ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { SectionCard } from "../components/SectionCard";

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
};

type AlertRow = {
  id: string;
  title: string;
  body: string | null;
  type: string | null;
  action: Record<string, any> | null;
  status: string | null;
};

type ActionRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: string | null;
  payload: Record<string, any> | null;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function appointmentISO(a: AppointmentRow) {
  return a.start_at ?? a.starts_at ?? null;
}

function statusChip(statusRaw: string | null) {
  const s = String(statusRaw ?? "pending").toLowerCase();
  if (s === "confirmed") return "border-emerald-400/35 text-emerald-300 bg-emerald-400/10";
  if (s === "cancelled") return "border-rose-400/35 text-rose-300 bg-rose-400/10";
  if (s === "completed") return "border-sky-400/35 text-sky-300 bg-sky-400/10";
  return "border-amber-400/35 text-amber-300 bg-amber-400/10";
}

function statusLabel(statusRaw: string | null) {
  const s = String(statusRaw ?? "pending").toLowerCase();
  if (s === "confirmed") return "Confirmada";
  if (s === "cancelled") return "Cancelada";
  if (s === "completed") return "Completada";
  return "Pendiente";
}

function formatDateHeader(date: Date) {
  return date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

export default function Hoy() {
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const orgId = clinic?.organization_id ?? DEFAULT_ORG;

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [newMessages, setNewMessages] = useState(0);
  const [pending, setPending] = useState(0);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [dailyDigest, setDailyDigest] = useState<AlertRow | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [tomorrowCount, setTomorrowCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [executingActionId, setExecutingActionId] = useState<string | null>(null);

  const dateLabel = useMemo(() => formatDateHeader(selectedDate), [selectedDate]);
  const weekdayLabel = useMemo(() => selectedDate.toLocaleDateString("es", { weekday: "long" }), [selectedDate]);

  async function load() {
    setLoading(true);
    const todayStart = startOfDay(selectedDate).toISOString();
    const todayEnd = endOfDay(selectedDate).toISOString();
    const tomorrowStart = startOfDay(new Date(selectedDate.getTime() + 86400000)).toISOString();

    const [apptsRes, msgsRes, pendingRes, alertsRes, digestRes, actionsRes] = await Promise.all([
      supabase.from("appointments").select("id, organization_id, lead_id, patient_name, title, reason, status, start_at, starts_at")
        .eq("organization_id", orgId).gte("start_at", todayStart).lte("start_at", todayEnd).order("start_at", { ascending: true }),
      supabase.from("messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("role", "user").gte("created_at", todayStart),
      supabase.from("reply_outbox").select("id", { count: "exact", head: true }).eq("organization_id", orgId).in("status", ["queued", "pending", "processing"]),
      supabase.from("alerts").select("id, title, body, type, action, status").eq("organization_id", orgId).eq("status", "open").neq("type", "daily_digest").order("created_at", { ascending: false }).limit(3),
      supabase.from("alerts").select("id, title, body, type, action, status").eq("organization_id", orgId).eq("status", "open").eq("type", "daily_digest").limit(1).maybeSingle(),
      supabase.from("actions").select("id, type, title, description, priority, status, payload").eq("organization_id", orgId).eq("status", "open").order("priority", { ascending: false }).limit(3),
    ]);

    if (!apptsRes.error) setAppointments(apptsRes.data as AppointmentRow[] ?? []);
    setNewMessages(msgsRes.count ?? 0);
    setPending(pendingRes.count ?? 0);
    if (!alertsRes.error) setAlerts(alertsRes.data as AlertRow[] ?? []);
    if (!digestRes.error && digestRes.data) setDailyDigest(digestRes.data as AlertRow);
    if (!actionsRes.error) setActions(actionsRes.data as ActionRow[] ?? []);

    const tomorrow = await supabase.from("appointments").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).gte("start_at", tomorrowStart).lt("start_at", endOfDay(new Date(selectedDate.getTime() + 86400000)).toISOString());
    setTomorrowCount(tomorrow.count ?? 0);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [orgId, selectedDate]);

  async function confirmAppointment(id: string) {
    await supabase.from("appointments").update({ status: "confirmed" }).eq("id", id);
    await load();
  }

  async function cancelAppointment(id: string) {
    if (!window.confirm("¿Cancelar esta cita?")) return;
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);
    await load();
  }

  async function markCompleted(id: string) {
    await supabase.from("appointments").update({ status: "completed" }).eq("id", id);
    await load();
  }

  function actionButtonLabel(type: string) {
    if (type === "messages_unanswered") return "Ver mensajes";
    if (type === "unconfirmed_appointments") return "Enviar confirmación";
    if (type === "request_review") return "Pedir reseña";
    return "Ejecutar";
  }

  async function executeAction(action: ActionRow) {
    setExecutingActionId(action.id);
    await supabase.functions.invoke("execute-action", { body: { organization_id: orgId, action_id: action.id } });
    if (action.type === "messages_unanswered") navigate("/inbox");
    setExecutingActionId(null);
    await load();
  }

  const isToday = startOfDay(selectedDate).getTime() === startOfDay(new Date()).getTime();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{clinic?.name ?? "Clínica"}</h1>
          <p className="text-sm text-white/60 capitalize">Hoy · {weekdayLabel}</p>
        </div>
        <button onClick={() => navigate("/settings?tab=integraciones")} className="relative flex items-center justify-center w-11 h-11 rounded-2xl border border-white/15 bg-white/5 text-white/80 hover:bg-white/10">
          <Bell className="h-5 w-5" />
          {alerts.length > 0 && <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-rose-500 text-[10px] font-bold text-white px-1">{alerts.length}</span>}
        </button>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-2">
        <button onClick={() => setSelectedDate(new Date(selectedDate.getTime() - 86400000))} className="p-2 rounded-xl hover:bg-white/10 text-white/70"><ChevronLeft className="h-5 w-5" /></button>
        <div className="flex-1 text-center">
          <button onClick={() => setSelectedDate(new Date())} className="text-sm font-semibold text-white hover:text-[#3CBDB9]">{dateLabel}</button>
          {!isToday && <button onClick={() => setSelectedDate(new Date())} className="ml-2 text-xs text-[#3CBDB9] hover:underline">Ir a hoy</button>}
        </div>
        <button onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 86400000))} className="p-2 rounded-xl hover:bg-white/10 text-white/70"><ChevronRight className="h-5 w-5" /></button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        <button onClick={() => navigate("/inbox")} className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-400/20">
          <span className="text-lg font-bold text-blue-400">{newMessages}</span>
          <span className="text-xs text-blue-300">mensajes</span>
        </button>
        <button onClick={() => navigate("/inbox")} className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-400/20">
          <span className="text-lg font-bold text-amber-400">{pending}</span>
          <span className="text-xs text-amber-300">pendientes</span>
        </button>
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
          <span className="text-lg font-bold text-white">{appointments.length}</span>
          <span className="text-xs text-white/60">citas hoy</span>
        </div>
      </div>

      {dailyDigest && (
        <div className="rounded-2xl bg-[#0894C1]/15 border border-[#3CBDB9]/30 p-3">
          <p className="text-sm text-white/85"><span className="font-semibold text-[#3CBDB9]">Resumen:</span> {dailyDigest.body}</p>
        </div>
      )}

      {actions.length > 0 && (
        <SectionCard title="Acciones recomendadas">
          <div className="space-y-2">
            {actions.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">{item.title}</div>
                  <div className="text-xs text-white/50 truncate">{item.description}</div>
                </div>
                <button onClick={() => executeAction(item)} disabled={executingActionId === item.id}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-[#3CBDB9] text-[#0B1117] text-xs font-semibold hover:bg-[#3CBDB9]/90 disabled:opacity-50">
                  {executingActionId === item.id ? "..." : actionButtonLabel(item.type)}
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title={isToday ? "Citas de hoy" : `Citas del ${dateLabel}`}>
        {loading ? (
          <div className="py-8 text-center text-sm text-white/50">Cargando...</div>
        ) : appointments.length === 0 ? (
          <div className="py-8 text-center">
            <CalendarDays className="h-10 w-10 text-white/20 mx-auto mb-2" />
            <p className="text-sm text-white/50">No hay citas para este día</p>
            <button onClick={() => navigate("/agenda")} className="mt-3 text-sm text-[#3CBDB9] font-medium hover:underline">Crear nueva cita</button>
          </div>
        ) : (
          <div className="space-y-3">
            {appointments.map((a) => {
              const iso = appointmentISO(a);
              const time = iso ? new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "--:--";
              return (
                <div key={a.id} className="rounded-2xl border border-white/10 bg-[#0C111C] p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Clock3 className="h-4 w-4 text-white/40" />
                        <span className="text-sm font-bold text-white">{time}</span>
                      </div>
                      <div className="text-sm font-medium text-white truncate">{a.patient_name || "Paciente"}</div>
                      <div className="text-xs text-white/50 truncate">{a.reason || a.title || "Consulta general"}</div>
                    </div>
                    <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-semibold uppercase border ${statusChip(a.status)}`}>{statusLabel(a.status)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {a.status !== "confirmed" && a.status !== "completed" && a.status !== "cancelled" && (
                      <button onClick={() => confirmAppointment(a.id)} className="flex-1 min-w-[100px] h-9 rounded-xl bg-emerald-400/10 border border-emerald-400/30 text-xs font-medium text-emerald-300 hover:bg-emerald-400/20">✓ Confirmar</button>
                    )}
                    {a.status === "confirmed" && (
                      <button onClick={() => markCompleted(a.id)} className="flex-1 min-w-[100px] h-9 rounded-xl bg-sky-400/10 border border-sky-400/30 text-xs font-medium text-sky-300 hover:bg-sky-400/20">✓ Completar</button>
                    )}
                    <button onClick={() => navigate(a.lead_id ? `/inbox/${a.lead_id}` : "/inbox")} className="flex-1 min-w-[100px] h-9 rounded-xl bg-white/5 border border-white/15 text-xs font-medium text-white/80 hover:bg-white/10 flex items-center justify-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5" /> Mensaje
                    </button>
                    {a.status !== "cancelled" && a.status !== "completed" && (
                      <button onClick={() => cancelAppointment(a.id)} className="h-9 px-3 rounded-xl bg-rose-500/10 border border-rose-400/30 text-xs font-medium text-rose-300 hover:bg-rose-500/20">Cancelar</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Mañana" description="Vista rápida del siguiente día.">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-white/50">{tomorrowCount} citas programadas</p>
          </div>
          <button onClick={() => navigate("/tomorrow")} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-xs font-medium text-white/80 hover:bg-white/10">
            <SendHorizonal className="h-4 w-4" /> Ver mañana
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
