import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Calendar, MessageCircle, Users, TrendingUp, Settings, CheckCircle2, ArrowRight, Sparkles, Clock, AlertCircle, Zap, Target, Gift } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { dedupeByKey } from "../lib/dedupe";
import { SectionCard } from "../components/SectionCard";

const DEFAULT_ORG = "clinic-demo";

type LeadRow = { id: string; full_name: string | null; last_message_at: string | null; last_message_preview: string | null; last_bot_reply_at: string | null; status: string | null };
type ApptRow = { id: string; start_at: string | null; starts_at: string | null; status: string | null; patient_name: string | null; reason: string | null };
type ActionItem = { id: string; type: string; title: string; description: string; icon: typeof CheckCircle2; color: string; action: () => void; completed?: boolean };

function relativeTime(iso?: string | null) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function toStartOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function toEndOfDay(d: Date) { const x = new Date(d); x.setHours(23,59,59,999); return x; }

export default function Overview() {
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notificationCount, setNotificationCount] = useState(0);
  const [hasMessenger, setHasMessenger] = useState(false);
  const [hasServices, setHasServices] = useState(false);
  const [hasHours, setHasHours] = useState(false);

  const todayStart = useMemo(() => toStartOfDay(new Date()), []);
  const todayEnd = useMemo(() => toEndOfDay(new Date()), []);

  async function load() {
    setLoading(true);
    const [leadsRes, apptsRes, orgRes, clinicRes, alertsRes] = await Promise.all([
      supabase.from("leads").select("id, full_name, last_message_at, last_message_preview, last_bot_reply_at, status").eq("organization_id", ORG).order("last_message_at", { ascending: false }).limit(100),
      supabase.from("appointments").select("id, start_at, starts_at, status, patient_name, reason").eq("organization_id", ORG).gte("start_at", todayStart.toISOString()).lte("start_at", todayEnd.toISOString()).order("start_at", { ascending: true }),
      supabase.from("org_settings").select("messenger_enabled, meta_page_id").eq("organization_id", ORG).limit(1),
      supabase.from("clinic_settings").select("services, hours").limit(1),
      supabase.from("alerts").select("id", { count: "exact", head: true }).eq("organization_id", ORG).eq("status", "open"),
    ]);
    if (!leadsRes.error) setLeads(dedupeByKey(leadsRes.data ?? [], (l) => l.id));
    if (!apptsRes.error) setAppts(apptsRes.data ?? []);
    const org = orgRes.data?.[0] as any;
    setHasMessenger(!!org?.meta_page_id && org?.messenger_enabled);
    const cs = clinicRes.data?.[0] as any;
    setHasServices((cs?.services?.length ?? 0) > 0);
    setHasHours(!!cs?.hours);
    setNotificationCount(alertsRes.count ?? 0);
    setLoading(false);
  }

  useEffect(() => { load(); }, [ORG]);

  const pendingReplies = leads.filter(l => { if (!l.last_message_at) return false; const lm = new Date(l.last_message_at).getTime(); const lb = l.last_bot_reply_at ? new Date(l.last_bot_reply_at).getTime() : 0; return lm > lb; }).length;
  const todayAppts = appts.length;
  const confirmedAppts = appts.filter(a => a.status === "confirmed").length;
  const pendingAppts = appts.filter(a => !a.status || a.status === "pending" || a.status === "requested").length;
  const recentLeads = leads.slice(0, 5);

  const actions = useMemo((): ActionItem[] => {
    const items: ActionItem[] = [];
    if (!hasMessenger) items.push({ id: "connect-messenger", type: "onboarding", title: "Conecta Messenger", description: "Recibe mensajes de Facebook", icon: MessageCircle, color: "blue", action: () => navigate("/settings?tab=integraciones") });
    if (!hasServices) items.push({ id: "add-services", type: "onboarding", title: "Agrega tus servicios", description: "El bot podrá responder precios", icon: Settings, color: "purple", action: () => navigate("/settings?tab=servicios") });
    if (!hasHours) items.push({ id: "set-hours", type: "onboarding", title: "Configura tu horario", description: "Para que el bot sugiera disponibilidad", icon: Clock, color: "amber", action: () => navigate("/settings?tab=horario") });
    if (pendingReplies > 0) items.push({ id: "pending-replies", type: "action", title: `${pendingReplies} mensajes sin responder`, description: "Hay leads esperando", icon: AlertCircle, color: "rose", action: () => navigate("/inbox") });
    if (pendingAppts > 0) items.push({ id: "pending-confirmations", type: "action", title: `${pendingAppts} citas por confirmar`, description: "Envía confirmaciones", icon: Calendar, color: "amber", action: () => navigate("/agenda") });
    if (items.length === 0) items.push({ id: "growth-tip", type: "tip", title: "Todo al día ✨", description: "Considera enviar promociones", icon: Sparkles, color: "emerald", action: () => navigate("/marketing"), completed: true });
    return items.slice(0, 3);
  }, [hasMessenger, hasServices, hasHours, pendingReplies, pendingAppts, navigate]);

  const growthOpportunities = useMemo(() => {
    const opps = [];
    const inactiveLeads = leads.filter(l => { if (!l.last_message_at) return false; const daysSince = (Date.now() - new Date(l.last_message_at).getTime()) / 86400000; return daysSince > 7 && daysSince < 30; }).length;
    if (inactiveLeads > 0) opps.push({ id: "reactivate", title: `${inactiveLeads} leads inactivos`, description: "Envía un seguimiento", icon: Target, action: () => navigate("/leads") });
    const completedToday = appts.filter(a => a.status === "completed").length;
    if (completedToday > 0) opps.push({ id: "reviews", title: `${completedToday} pacientes atendidos`, description: "Pide reseñas", icon: Gift, action: () => navigate("/marketing") });
    return opps;
  }, [leads, appts, navigate]);

  const colorClasses: Record<string, { bg: string; text: string; border: string }> = {
    blue: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-400/20" },
    purple: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-400/20" },
    amber: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-400/20" },
    rose: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-400/20" },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-400/20" },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Overview</h1>
          <p className="text-sm text-white/50">{new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <button onClick={() => navigate("/settings?tab=integraciones")} className="relative flex items-center justify-center w-11 h-11 rounded-2xl border border-white/15 bg-white/5 text-white/80 hover:bg-white/10">
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-rose-500 text-[10px] font-bold text-white px-1">{notificationCount > 9 ? "9+" : notificationCount}</span>}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate("/agenda")} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10">
          <div className="flex items-center gap-2 mb-2"><Calendar className="h-4 w-4 text-blue-400" /><span className="text-[10px] text-white/50 uppercase tracking-wide">Citas hoy</span></div>
          <div className="text-2xl font-bold text-white">{todayAppts}</div>
          <div className="text-xs text-white/50 mt-1">{confirmedAppts} confirmadas • {pendingAppts} pendientes</div>
        </button>
        <button onClick={() => navigate("/inbox")} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10">
          <div className="flex items-center gap-2 mb-2"><MessageCircle className="h-4 w-4 text-emerald-400" /><span className="text-[10px] text-white/50 uppercase tracking-wide">Mensajes</span></div>
          <div className="text-2xl font-bold text-white">{pendingReplies}</div>
          <div className="text-xs text-white/50 mt-1">sin responder</div>
        </button>
        <button onClick={() => navigate("/leads")} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10">
          <div className="flex items-center gap-2 mb-2"><Users className="h-4 w-4 text-purple-400" /><span className="text-[10px] text-white/50 uppercase tracking-wide">Leads</span></div>
          <div className="text-2xl font-bold text-white">{leads.length}</div>
          <div className="text-xs text-white/50 mt-1">total contactos</div>
        </button>
        <button onClick={() => navigate("/marketing")} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10">
          <div className="flex items-center gap-2 mb-2"><TrendingUp className="h-4 w-4 text-amber-400" /><span className="text-[10px] text-white/50 uppercase tracking-wide">Conversión</span></div>
          <div className="text-2xl font-bold text-white">{leads.length > 0 ? Math.round((appts.filter(a => a.status === "completed").length / Math.max(leads.length, 1)) * 100) : 0}%</div>
          <div className="text-xs text-white/50 mt-1">lead → cita</div>
        </button>
      </div>

      <SectionCard title="Acciones recomendadas">
        {loading ? <div className="py-4 text-center text-sm text-white/50">Cargando...</div> : (
          <div className="space-y-2">
            {actions.map((action) => {
              const colors = colorClasses[action.color] || colorClasses.blue;
              const Icon = action.icon;
              return (
                <button key={action.id} onClick={action.action} className={`w-full flex items-center gap-3 p-3 rounded-xl ${colors.bg} border ${colors.border} text-left hover:opacity-90`}>
                  <div className={`flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 ${colors.text}`}><Icon className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${colors.text}`}>{action.title}</div>
                    <div className="text-xs text-white/50">{action.description}</div>
                  </div>
                  <ArrowRight className={`h-4 w-4 ${colors.text}`} />
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {growthOpportunities.length > 0 && (
        <SectionCard title="Oportunidades de crecimiento">
          <div className="space-y-2">
            {growthOpportunities.map((opp) => {
              const Icon = opp.icon;
              return (
                <button key={opp.id} onClick={opp.action} className="w-full flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-400/20 text-left hover:opacity-90">
                  <Icon className="h-5 w-5 text-purple-400" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white">{opp.title}</div>
                    <div className="text-xs text-white/50">{opp.description}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-purple-400" />
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Actividad reciente" action={<button onClick={() => navigate("/inbox")} className="text-sm text-[#3CBDB9] font-medium">Ver todo</button>}>
        {recentLeads.length === 0 ? (
          <div className="py-6 text-center">
            <MessageCircle className="h-8 w-8 text-white/20 mx-auto mb-2" />
            <p className="text-sm text-white/50">Sin actividad reciente</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentLeads.map((lead) => (
              <button key={lead.id} onClick={() => navigate(`/inbox/${lead.id}`)} className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 text-left hover:bg-white/10">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 font-semibold text-sm">{(lead.full_name || "?")[0].toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white truncate">{lead.full_name || "Sin nombre"}</div>
                  <div className="text-xs text-white/50 truncate">{lead.last_message_preview || "—"}</div>
                </div>
                <div className="text-xs text-white/40">{relativeTime(lead.last_message_at)}</div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {appts.length > 0 && (
        <SectionCard title="Citas de hoy" action={<button onClick={() => navigate("/agenda")} className="text-sm text-[#3CBDB9] font-medium">Ver agenda</button>}>
          <div className="space-y-2">
            {appts.slice(0, 3).map((appt) => {
              const time = appt.start_at ? new Date(appt.start_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "--:--";
              const isConfirmed = appt.status === "confirmed";
              return (
                <div key={appt.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
                  <div className="text-sm font-bold text-white w-14">{time}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white truncate">{appt.patient_name || "Paciente"}</div>
                    <div className="text-xs text-white/50 truncate">{appt.reason || "Consulta"}</div>
                  </div>
                  {isConfirmed ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <div className="px-2 py-1 rounded-full bg-amber-500/10 border border-amber-400/20 text-amber-300 text-[10px] font-semibold uppercase">Pendiente</div>}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}