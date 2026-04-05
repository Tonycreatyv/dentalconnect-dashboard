import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  
  Calendar,
  KeyRound,
  MessageSquare,
  RefreshCw,
  Shield,
  Users,
  UserPlus,
  Eye,
  ChevronDown,
  ChevronUp,
  Zap,
  Building2,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { Toast, type ToastKind } from "../components/ui/Toast";
import PageHeader from "../components/PageHeader";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface OrgRow {
  organization_id: string;
  brand_name: string | null;
  llm_brain_enabled: boolean;
  messenger_enabled: boolean;
  meta_page_id: string | null;
  plan: string;
}

interface LeadRow {
  id: string;
  full_name: string | null;
  channel: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  created_at: string;
  organization_id: string;
  handoff_to_human: boolean;
}

interface SignupRow {
  id: string;
  name: string;
  created_at: string;
  owner_id: string | null;
}

interface AppointmentRow {
  id: string;
  patient_name: string | null;
  title: string | null;
  status: string;
  start_at: string | null;
  organization_id: string;
  created_at: string;
}

interface Stats {
  totalOrgs: number;
  activeLeadsToday: number;
  messagesToday: number;
  appointmentsToday: number;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function truncate(s: string | null, max = 50) {
  if (!s) return "—";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────

export default function CommandCenter() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);

  const [stats, setStats] = useState<Stats>({ totalOrgs: 0, activeLeadsToday: 0, messagesToday: 0, appointmentsToday: 0 });
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [recentLeads, setRecentLeads] = useState<LeadRow[]>([]);
  const [recentSignups, setRecentSignups] = useState<SignupRow[]>([]);
  const [recentAppointments, setRecentAppointments] = useState<AppointmentRow[]>([]);

  // Quick action states
  const [resetEmail, setResetEmail] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>("overview");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const loadData = useCallback(async () => {
    setRefreshing(true);

    // Orgs
    const orgsRes = await supabase
      .from("org_settings")
      .select("organization_id, brand_name, llm_brain_enabled, messenger_enabled, meta_page_id, plan")
      .order("organization_id");
    if (!orgsRes.error) setOrgs(orgsRes.data as OrgRow[]);

    // Stats: total orgs
    const orgCount = orgsRes.data?.length ?? 0;

    // Recent leads (last 48h, all orgs)
    const leadsRes = await supabase
      .from("leads")
      .select("id, full_name, channel, last_message_preview, last_message_at, created_at, organization_id, handoff_to_human")
      .gte("last_message_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order("last_message_at", { ascending: false })
      .limit(20);
    if (!leadsRes.error) setRecentLeads(leadsRes.data as LeadRow[]);

    // Active leads today
    const activeLeadsRes = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("last_message_at", todayIso);
    const activeLeadsToday = activeLeadsRes.count ?? 0;

    // Messages today
    const msgsRes = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayIso);
    const messagesToday = msgsRes.count ?? 0;

    // Appointments today
    const apptsRes = await supabase
      .from("appointments")
      .select("id, patient_name, title, status, start_at, organization_id, created_at")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10);
    if (!apptsRes.error) setRecentAppointments(apptsRes.data as AppointmentRow[]);

    const appointmentsToday = apptsRes.data?.filter(
      (a: any) => new Date(a.created_at).toISOString() >= todayIso
    ).length ?? 0;

    // Recent signups (organizations created recently)
    const signupsRes = await supabase
      .from("organizations")
      .select("id, name, created_at, owner_id")
      .order("created_at", { ascending: false })
      .limit(10);
    if (!signupsRes.error) setRecentSignups(signupsRes.data as SignupRow[]);

    setStats({ totalOrgs: orgCount, activeLeadsToday, messagesToday, appointmentsToday });
    setLoading(false);
    setRefreshing(false);
  }, [todayIso]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─────────────────────────────────────────────
  // QUICK ACTIONS
  // ─────────────────────────────────────────────

  async function toggleBot(orgId: string, currentState: boolean) {
    const { error } = await supabase
      .from("org_settings")
      .update({ llm_brain_enabled: !currentState })
      .eq("organization_id", orgId);
    if (error) { setToast({ kind: "error", message: `Error: ${error.message}` }); }
    else { setToast({ kind: "success", message: `Bot ${!currentState ? "activado" : "desactivado"} para ${orgId}` }); loadData(); }
  }

  async function toggleMessenger(orgId: string, currentState: boolean) {
    const { error } = await supabase
      .from("org_settings")
      .update({ messenger_enabled: !currentState })
      .eq("organization_id", orgId);
    if (error) { setToast({ kind: "error", message: `Error: ${error.message}` }); }
    else { setToast({ kind: "success", message: `Messenger ${!currentState ? "activado" : "desactivado"} para ${orgId}` }); loadData(); }
  }

  async function handleResetPassword() {
    if (!resetEmail.trim() || !resetNewPassword.trim()) {
      setToast({ kind: "error", message: "Email y contraseña requeridos." });
      return;
    }
    // Note: This requires admin/service_role access.
    // From frontend, we can only reset our own password.
    // For admin password reset, you'd need an Edge Function.
    setToast({ kind: "error", message: "Reset de password de otros usuarios requiere una Edge Function admin. Usa el dashboard de Supabase > Authentication > Users por ahora." });
  }

  async function killLeadBot(leadId: string) {
    const { error } = await supabase
      .from("leads")
      .update({ handoff_to_human: true })
      .eq("id", leadId);
    if (error) { setToast({ kind: "error", message: `Error: ${error.message}` }); }
    else { setToast({ kind: "success", message: "Lead marcado como handoff a humano. El bot no le responderá más." }); loadData(); }
  }

  async function reactivateLeadBot(leadId: string) {
    const { error } = await supabase
      .from("leads")
      .update({ handoff_to_human: false })
      .eq("id", leadId);
    if (error) { setToast({ kind: "error", message: `Error: ${error.message}` }); }
    else { setToast({ kind: "success", message: "Bot reactivado para este lead." }); loadData(); }
  }

  // ─────────────────────────────────────────────
  // SECTION TOGGLE
  // ─────────────────────────────────────────────

  function SectionHeader({ id, title, icon: Icon }: { id: string; title: string; icon: any }) {
    const isOpen = expandedSection === id;
    return (
      <button
        onClick={() => setExpandedSection(isOpen ? null : id)}
        className="w-full flex items-center justify-between py-3 px-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-[#3CBDB9]" />
          <span className="font-semibold text-white">{title}</span>
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4 text-white/50" /> : <ChevronDown className="h-4 w-4 text-white/50" />}
      </button>
    );
  }

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────

  if (loading) return <div className="py-20 text-center text-white/50">Cargando Command Center...</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Command Center"
        subtitle="Monitoreo y control en tiempo real."
        showBackOnMobile
        backTo="/overview"
        action={
          <button
            onClick={loadData}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#3CBDB9] text-[#0B1117] text-sm font-semibold hover:bg-[#3CBDB9]/90"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "..." : "Refresh"}
          </button>
        }
      />

      {/* ── STATS CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Orgs Totales", value: stats.totalOrgs, icon: Building2, color: "text-[#3CBDB9]" },
          { label: "Leads Activos Hoy", value: stats.activeLeadsToday, icon: Users, color: "text-emerald-400" },
          { label: "Mensajes Hoy", value: stats.messagesToday, icon: MessageSquare, color: "text-blue-400" },
          { label: "Citas Hoy", value: stats.appointmentsToday, icon: Calendar, color: "text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <s.icon className={`h-4 w-4 ${s.color}`} />
              <span className="text-xs text-white/50">{s.label}</span>
            </div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── ORGS CONTROL ── */}
      <div className="space-y-2">
        <SectionHeader id="orgs" title="Control de Organizaciones" icon={Shield} />
        {expandedSection === "orgs" && (
          <div className="space-y-2 pl-2">
            {orgs.map((org) => (
              <div key={org.organization_id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-medium text-white">{org.brand_name || org.organization_id}</div>
                    <div className="text-xs text-white/40">{org.organization_id} • {org.plan}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {org.meta_page_id && (
                      <span className="text-xs px-2 py-1 rounded-lg bg-blue-500/20 text-blue-300">FB</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => toggleBot(org.organization_id, org.llm_brain_enabled)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      org.llm_brain_enabled
                        ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                        : "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                    }`}
                  >
                    {org.llm_brain_enabled ? <Bot className="h-3.5 w-3.5" /> : <BotOff className="h-3.5 w-3.5" />}
                    Bot {org.llm_brain_enabled ? "ON" : "OFF"}
                  </button>
                  <button
                    onClick={() => toggleMessenger(org.organization_id, org.messenger_enabled)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      org.messenger_enabled
                        ? "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
                        : "bg-white/10 text-white/50 hover:bg-white/15"
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Messenger {org.messenger_enabled ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── RECENT LEADS ── */}
      <div className="space-y-2">
        <SectionHeader id="leads" title="Leads Recientes (48h)" icon={Activity} />
        {expandedSection === "leads" && (
          <div className="space-y-2 pl-2">
            {recentLeads.length === 0 ? (
              <div className="text-sm text-white/40 p-4">No hay leads recientes.</div>
            ) : (
              recentLeads.map((lead) => (
                <div key={lead.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{lead.full_name || "Sin nombre"}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/50">{lead.channel}</span>
                        <span className="text-xs text-white/30">{lead.organization_id}</span>
                      </div>
                      <div className="text-sm text-white/50 truncate mt-1">{truncate(lead.last_message_preview, 80)}</div>
                      <div className="text-xs text-white/30 mt-1">{timeAgo(lead.last_message_at)}</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {lead.handoff_to_human ? (
                        <button
                          onClick={() => reactivateLeadBot(lead.id)}
                          title="Reactivar bot"
                          className="p-2 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                        >
                          <Bot className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => killLeadBot(lead.id)}
                          title="Kill bot (handoff a humano)"
                          className="p-2 rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30"
                        >
                          <BotOff className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── RECENT SIGNUPS ── */}
      <div className="space-y-2">
        <SectionHeader id="signups" title="Registros Recientes" icon={UserPlus} />
        {expandedSection === "signups" && (
          <div className="space-y-2 pl-2">
            {recentSignups.length === 0 ? (
              <div className="text-sm text-white/40 p-4">No hay registros.</div>
            ) : (
              recentSignups.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3">
                  <div>
                    <div className="font-medium text-white">{s.name}</div>
                    <div className="text-xs text-white/40">{s.id}</div>
                  </div>
                  <div className="text-xs text-white/30">{timeAgo(s.created_at)}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── RECENT APPOINTMENTS ── */}
      <div className="space-y-2">
        <SectionHeader id="appointments" title="Citas Recientes" icon={Calendar} />
        {expandedSection === "appointments" && (
          <div className="space-y-2 pl-2">
            {recentAppointments.length === 0 ? (
              <div className="text-sm text-white/40 p-4">No hay citas recientes.</div>
            ) : (
              recentAppointments.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3">
                  <div>
                    <div className="font-medium text-white">{a.patient_name || "Sin nombre"}</div>
                    <div className="text-xs text-white/40">{a.title || "Cita"} • {a.organization_id}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs px-2 py-0.5 rounded-lg ${
                      a.status === "confirmed" ? "bg-emerald-500/20 text-emerald-300" :
                      a.status === "completed" ? "bg-blue-500/20 text-blue-300" :
                      "bg-white/10 text-white/50"
                    }`}>{a.status}</div>
                    <div className="text-xs text-white/30 mt-1">{timeAgo(a.created_at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── QUICK ACTIONS ── */}
      <div className="space-y-2">
        <SectionHeader id="actions" title="Acciones Rápidas" icon={Zap} />
        {expandedSection === "actions" && (
          <div className="space-y-3 pl-2">
            {/* Emergency Kill All Bots */}
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                <div>
                  <div className="font-semibold text-red-300">Kill Switch — Apagar Todos los Bots</div>
                  <div className="text-xs text-red-300/60">Desactiva LLM en TODAS las organizaciones.</div>
                </div>
              </div>
              <button
                onClick={async () => {
                  if (!window.confirm("¿Seguro? Esto apaga el bot de TODAS las organizaciones.")) return;
                  const { error } = await supabase
                    .from("org_settings")
                    .update({ llm_brain_enabled: false })
                    .neq("organization_id", "");
                  if (error) setToast({ kind: "error", message: error.message });
                  else { setToast({ kind: "success", message: "Todos los bots desactivados." }); loadData(); }
                }}
                className="px-4 py-2 rounded-xl bg-red-500/20 text-red-300 text-sm font-semibold hover:bg-red-500/30"
              >
                Apagar Todo
              </button>
            </div>

            {/* Reset Password Note */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-3 mb-3">
                <KeyRound className="h-5 w-5 text-amber-400" />
                <div>
                  <div className="font-semibold text-white">Reset de Contraseña</div>
                  <div className="text-xs text-white/50">Para resetear la contraseña de un usuario.</div>
                </div>
              </div>
              <div className="space-y-2">
                <input
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="Email del usuario"
                  className="w-full h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-[#3CBDB9]/50"
                />
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  placeholder="Nueva contraseña"
                  className="w-full h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-[#3CBDB9]/50"
                />
                <div className="text-xs text-white/40">
                  Nota: Resetear contraseñas de otros usuarios requiere acceso admin. Usá Supabase Dashboard → Authentication → Users → Reset Password. O pedíle al usuario que use el tab "Cuenta" en Settings.
                </div>
              </div>
            </div>

            {/* Quick SQL Check */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-3 mb-3">
                <Eye className="h-5 w-5 text-[#3CBDB9]" />
                <div>
                  <div className="font-semibold text-white">Verificar Estado del Sistema</div>
                  <div className="text-xs text-white/50">Chequeos rápidos de salud.</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={async () => {
                    const res = await supabase.from("reply_outbox").select("id", { count: "exact", head: true }).eq("status", "queued");
                    setToast({ kind: "success", message: `Reply outbox queued: ${res.count ?? 0} jobs` });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/10 text-sm text-white/70 hover:bg-white/15"
                >
                  Jobs en cola
                </button>
                <button
                  onClick={async () => {
                    const res = await supabase.from("reply_outbox").select("id", { count: "exact", head: true }).eq("status", "failed");
                    setToast({ kind: "success", message: `Reply outbox failed: ${res.count ?? 0} jobs` });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/10 text-sm text-white/70 hover:bg-white/15"
                >
                  Jobs fallidos
                </button>
                <button
                  onClick={async () => {
                    const res = await supabase.from("followup_outbox").select("id", { count: "exact", head: true }).eq("status", "queued");
                    setToast({ kind: "success", message: `Followups queued: ${res.count ?? 0}` });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/10 text-sm text-white/70 hover:bg-white/15"
                >
                  Followups en cola
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Toast open={!!toast} kind={toast?.kind} message={toast?.message ?? ""} onClose={() => setToast(null)} />
    </div>
  );
}