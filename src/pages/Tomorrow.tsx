import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  ArrowLeft, CalendarCheck2, Clock, Send, MessageCircle, 
  CheckCircle2, AlertCircle, Sparkles, Users, TrendingUp,
  ChevronRight
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";

const DEFAULT_ORG = "clinic-demo";

type AppointmentRow = {
  id: string;
  lead_id: string | null;
  patient_name: string | null;
  reason: string | null;
  status: string | null;
  start_at: string | null;
  starts_at: string | null;
  phone?: string | null;
};

type Gap = { slot_start: string; slot_end: string; service_type: string };

type Suggestion = {
  id: string;
  type: "confirmation" | "gap" | "promo" | "reminder";
  title: string;
  description: string;
  icon: typeof CheckCircle2;
  color: string;
  action: () => void;
  priority: number;
};

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function appointmentISO(a: AppointmentRow) { return a.start_at ?? a.starts_at ?? null; }
function hourLabel(iso: string) { return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }); }

export default function Tomorrow() {
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const orgId = clinic?.organization_id ?? DEFAULT_ORG;

  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const tomorrowRange = useMemo(() => {
    const base = new Date(Date.now() + 86400000);
    return { start: startOfDay(base), end: endOfDay(base), date: base };
  }, []);

  const tomorrowLabel = useMemo(() => {
    return tomorrowRange.date.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
  }, [tomorrowRange]);

  async function load() {
    setLoading(true);
    const res = await supabase
      .from("appointments")
      .select("id, lead_id, patient_name, reason, status, start_at, starts_at")
      .eq("organization_id", orgId)
      .gte("start_at", tomorrowRange.start.toISOString())
      .lte("start_at", tomorrowRange.end.toISOString())
      .order("start_at", { ascending: true });

    if (!res.error && res.data) setAppointments(res.data as AppointmentRow[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [orgId]);

  // Calculate gaps (available slots)
  const gaps = useMemo(() => {
    const occupiedHours = new Set<number>();
    appointments.forEach(a => {
      const iso = appointmentISO(a);
      if (iso) occupiedHours.add(new Date(iso).getHours());
    });

    const out: Gap[] = [];
    for (let h = 8; h <= 17; h++) {
      if (!occupiedHours.has(h)) {
        const slotStart = new Date(tomorrowRange.start);
        slotStart.setHours(h, 0, 0, 0);
        const slotEnd = new Date(tomorrowRange.start);
        slotEnd.setHours(h + 1, 0, 0, 0);
        out.push({ slot_start: slotStart.toISOString(), slot_end: slotEnd.toISOString(), service_type: "general" });
      }
    }
    return out.slice(0, 5);
  }, [appointments, tomorrowRange.start]);

  // Categorize appointments
  const unconfirmed = appointments.filter(a => !a.status || a.status === "pending" || a.status === "requested");
  const confirmed = appointments.filter(a => a.status === "confirmed");

  // Smart suggestions based on data
  const suggestions = useMemo((): Suggestion[] => {
    const items: Suggestion[] = [];

    // Priority 1: Unconfirmed appointments
    if (unconfirmed.length > 0) {
      items.push({
        id: "send-confirmations",
        type: "confirmation",
        title: `Enviar ${unconfirmed.length} confirmaciones`,
        description: "Reduce no-shows confirmando las citas de mañana",
        icon: CalendarCheck2,
        color: "blue",
        action: async () => {
          // Batch send confirmations
          for (const appt of unconfirmed) {
            await sendConfirmation(appt);
          }
        },
        priority: 1,
      });
    }

    // Priority 2: Fill gaps
    if (gaps.length > 0) {
      items.push({
        id: "fill-gaps",
        type: "gap",
        title: `${gaps.length} huecos disponibles`,
        description: "Ofrece estos horarios a tu lista de espera",
        icon: Clock,
        color: "amber",
        action: () => {/* handled separately */},
        priority: 2,
      });
    }

    // Priority 3: If few appointments, suggest promo
    if (appointments.length < 3) {
      items.push({
        id: "send-promo",
        type: "promo",
        title: "Mañana está tranquilo",
        description: "Envía una promoción de última hora a tus leads",
        icon: Sparkles,
        color: "purple",
        action: () => navigate("/marketing"),
        priority: 3,
      });
    }

    // Priority 4: If many appointments, remind to prepare
    if (appointments.length >= 5) {
      items.push({
        id: "busy-day",
        type: "reminder",
        title: "Día ocupado mañana",
        description: `${appointments.length} citas programadas - prepara tus materiales`,
        icon: AlertCircle,
        color: "emerald",
        action: () => {},
        priority: 4,
      });
    }

    return items.sort((a, b) => a.priority - b.priority).slice(0, 3);
  }, [appointments, unconfirmed, gaps, navigate]);

  async function sendConfirmation(appt: AppointmentRow) {
    if (!appt.lead_id) return;
    setSendingId(appt.id);

    const leadRes = await supabase.from("leads").select("channel, channel_user_id").eq("id", appt.lead_id).maybeSingle();
    const psid = (leadRes.data as any)?.channel_user_id;
    
    if (psid) {
      const time = appt.start_at ? new Date(appt.start_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "";
      const text = `Hola ${appt.patient_name || ""}! 👋 Te recordamos tu cita de mañana a las ${time}. ¿Podemos confirmarte?`;
      
      await supabase.from("reply_outbox").insert({
        organization_id: orgId,
        lead_id: appt.lead_id,
        channel: (leadRes.data as any)?.channel ?? "messenger",
        channel_user_id: psid,
        status: "queued",
        scheduled_for: new Date().toISOString(),
        message_text: text,
        payload: { text, source: "tomorrow_confirmation", provider: "meta" },
      });
    }

    setSendingId(null);
    await load();
  }

  async function offerWaitlist(slot: Gap) {
    setSendingId(slot.slot_start);
    
    const { error } = await supabase.functions.invoke("offer-waitlist", {
      body: { organization_id: orgId, slot },
    });

    setSendingId(null);
    if (!error) await load();
  }

  const colorClasses: Record<string, { bg: string; text: string; border: string }> = {
    blue: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-100" },
    amber: { bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-100" },
    purple: { bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-100" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-100" },
    rose: { bg: "bg-rose-50", text: "text-rose-600", border: "border-rose-100" },
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 safe-area-top">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate("/overview")} className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 transition">
            <ArrowLeft className="h-5 w-5 text-slate-700" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Mañana</h1>
            <p className="text-sm text-slate-500 capitalize">{tomorrowLabel}</p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-100">
            <span className="text-lg font-bold text-blue-600">{appointments.length}</span>
            <span className="text-xs text-blue-700">citas</span>
          </div>
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-100">
            <span className="text-lg font-bold text-emerald-600">{confirmed.length}</span>
            <span className="text-xs text-emerald-700">confirmadas</span>
          </div>
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-100">
            <span className="text-lg font-bold text-amber-600">{gaps.length}</span>
            <span className="text-xs text-amber-700">huecos</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Smart Suggestions */}
        {suggestions.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <h2 className="font-semibold text-slate-900">Sugerencias inteligentes</h2>
            </div>
            <div className="space-y-2">
              {suggestions.map((sug) => {
                const colors = colorClasses[sug.color];
                const Icon = sug.icon;
                return (
                  <button
                    key={sug.id}
                    onClick={sug.action}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl ${colors.bg} border ${colors.border} text-left hover:opacity-90 transition`}
                  >
                    <div className={`flex items-center justify-center w-10 h-10 rounded-lg bg-white ${colors.text}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium ${colors.text}`}>{sug.title}</div>
                      <div className="text-xs text-slate-600">{sug.description}</div>
                    </div>
                    <ChevronRight className={`h-4 w-4 ${colors.text}`} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Unconfirmed Appointments */}
        {unconfirmed.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900">Sin confirmar ({unconfirmed.length})</h2>
              <button
                onClick={async () => {
                  for (const a of unconfirmed) await sendConfirmation(a);
                }}
                className="text-sm text-blue-600 font-medium"
              >
                Enviar todas
              </button>
            </div>
            <div className="space-y-2">
              {unconfirmed.map((appt) => {
                const iso = appointmentISO(appt);
                const time = iso ? hourLabel(iso) : "--:--";
                const isSending = sendingId === appt.id;

                return (
                  <div key={appt.id} className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-100">
                    <div className="text-sm font-bold text-amber-700 w-14">{time}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 truncate">{appt.patient_name || "Paciente"}</div>
                      <div className="text-xs text-slate-500 truncate">{appt.reason || "Consulta"}</div>
                    </div>
                    <button
                      onClick={() => sendConfirmation(appt)}
                      disabled={isSending}
                      className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                      <Send className="h-3 w-3" />
                      {isSending ? "..." : "Enviar"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Available Gaps */}
        {gaps.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <h2 className="font-semibold text-slate-900 mb-3">Huecos disponibles</h2>
            <div className="space-y-2">
              {gaps.map((gap) => {
                const isSending = sendingId === gap.slot_start;
                return (
                  <div key={gap.slot_start} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <span className="font-medium text-slate-900">
                        {hourLabel(gap.slot_start)} - {hourLabel(gap.slot_end)}
                      </span>
                    </div>
                    <button
                      onClick={() => offerWaitlist(gap)}
                      disabled={isSending}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200 disabled:opacity-50 transition"
                    >
                      <Users className="h-3 w-3" />
                      {isSending ? "..." : "Ofrecer"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Confirmed Appointments */}
        {confirmed.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <h2 className="font-semibold text-slate-900 mb-3">Confirmadas ({confirmed.length})</h2>
            <div className="space-y-2">
              {confirmed.map((appt) => {
                const iso = appointmentISO(appt);
                const time = iso ? hourLabel(iso) : "--:--";
                return (
                  <div key={appt.id} className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                    <div className="text-sm font-bold text-emerald-700 w-14">{time}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 truncate">{appt.patient_name || "Paciente"}</div>
                      <div className="text-xs text-slate-500 truncate">{appt.reason || "Consulta"}</div>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Checklist */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h2 className="font-semibold text-slate-900 mb-3">Checklist para mañana</h2>
          <div className="space-y-2">
            {[
              { text: "Confirmar citas pendientes antes de las 6pm", done: unconfirmed.length === 0 },
              { text: "Ofrecer huecos a lista de espera", done: gaps.length === 0 },
              { text: "Preparar materiales para primeras citas", done: false },
              { text: "Revisar historial de pacientes del día", done: false },
            ].map((item, idx) => (
              <div key={idx} className={`flex items-center gap-3 p-3 rounded-xl ${item.done ? "bg-emerald-50 border border-emerald-100" : "bg-slate-50 border border-slate-100"}`}>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${item.done ? "bg-emerald-500 border-emerald-500" : "border-slate-300"}`}>
                  {item.done && <CheckCircle2 className="h-3 w-3 text-white" />}
                </div>
                <span className={`text-sm ${item.done ? "text-emerald-700 line-through" : "text-slate-700"}`}>
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Empty state */}
        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Cargando...</div>
        ) : appointments.length === 0 && gaps.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <CalendarCheck2 className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">Sin citas para mañana</p>
            <p className="text-sm text-slate-500 mt-1">Envía una promoción para llenar tu agenda</p>
            <button
              onClick={() => navigate("/marketing")}
              className="mt-4 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
            >
              Crear promoción
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}