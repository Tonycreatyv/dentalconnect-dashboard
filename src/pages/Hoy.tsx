import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, Clock3, MessageCircle, SendHorizonal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import PageHeader from "../components/PageHeader";
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
  severity: string | null;
  created_at: string | null;
};

type ActionRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: string | null;
  payload: Record<string, any> | null;
  created_at: string | null;
};

type GrowthSummary = {
  reviewRequestsToday: number;
  topInterestTopic: string | null;
  topInterestCount: number;
  suggestion: string | null;
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

export default function Hoy() {
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const orgId = clinic?.organization_id ?? DEFAULT_ORG;

  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [newMessages, setNewMessages] = useState(0);
  const [pending, setPending] = useState(0);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [dailyDigest, setDailyDigest] = useState<AlertRow | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [growth, setGrowth] = useState<GrowthSummary>({
    reviewRequestsToday: 0,
    topInterestTopic: null,
    topInterestCount: 0,
    suggestion: null,
  });
  const [offeringAlertId, setOfferingAlertId] = useState<string | null>(null);
  const [executingActionId, setExecutingActionId] = useState<string | null>(null);
  const [tomorrowCount, setTomorrowCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const dateLabel = useMemo(
    () =>
      new Date().toLocaleDateString("es-HN", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      }),
    []
  );

  async function load() {
    setLoading(true);
    await supabase.functions.invoke("run-action-engine", { body: { organization_id: orgId } }).catch(() => null);
    await supabase.functions.invoke("run-growth-loop", { body: { organization_id: orgId } }).catch(() => null);
    const now = new Date();
    const todayStart = startOfDay(now).toISOString();
    const todayEnd = endOfDay(now).toISOString();
    const tomorrowStart = startOfDay(new Date(now.getTime() + 86400000)).toISOString();

    const [apptsRes, msgsRes, pendingRes, alertsRes, digestRes, actionsRes, reviewActionRes, insightRes] = await Promise.all([
      supabase
        .from("appointments")
        .select("id, organization_id, lead_id, patient_name, title, reason, status, start_at, starts_at")
        .eq("organization_id", orgId)
        .gte("start_at", todayStart)
        .lte("start_at", todayEnd)
        .order("start_at", { ascending: true }),
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("role", "user")
        .gte("created_at", todayStart),
      supabase
        .from("reply_outbox")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .in("status", ["queued", "pending", "processing"]),
      supabase
        .from("alerts")
        .select("id, title, body, type, action, status, severity, created_at")
        .eq("organization_id", orgId)
        .eq("status", "open")
        .neq("type", "daily_digest")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("alerts")
        .select("id, title, body, type, action, status, severity, created_at")
        .eq("organization_id", orgId)
        .eq("status", "open")
        .eq("type", "daily_digest")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("actions")
        .select("id, type, title, description, priority, status, payload, created_at")
        .eq("organization_id", orgId)
        .eq("status", "open")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("actions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "open")
        .eq("type", "request_review")
        .gte("created_at", todayStart),
      supabase
        .from("marketing_insights")
        .select("metric_value_json, created_at")
        .eq("organization_id", orgId)
        .eq("metric_key", "service_interest")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!apptsRes.error && apptsRes.data) setAppointments(apptsRes.data as AppointmentRow[]);
    setNewMessages(msgsRes.count ?? 0);
    setPending(pendingRes.count ?? 0);
    if (!alertsRes.error && alertsRes.data) setAlerts((alertsRes.data as AlertRow[]) ?? []);
    if (!digestRes.error && digestRes.data) setDailyDigest(digestRes.data as AlertRow);
    if (!actionsRes.error && actionsRes.data) setActions((actionsRes.data as ActionRow[]) ?? []);
    if ((actionsRes.error?.message ?? "").toLowerCase().includes("does not exist")) setActions([]);
    const insightJson = (insightRes.data as any)?.metric_value_json ?? {};
    setGrowth({
      reviewRequestsToday: reviewActionRes.count ?? 0,
      topInterestTopic: safeString(insightJson?.top_topic),
      topInterestCount: Number(insightJson?.top_count ?? 0),
      suggestion: safeString(insightJson?.suggestion),
    });

    if ((alertsRes.error?.message ?? "").toLowerCase().includes("does not exist")) {
      setAlerts([]);
    }

    const tomorrow = await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("start_at", tomorrowStart)
      .lt("start_at", endOfDay(new Date(now.getTime() + 86400000)).toISOString());

    if (!tomorrow.error && (tomorrow.count ?? 0) === 0 && alerts.length === 0) {
      // no-op: keeps load branch deterministic
    }
    setTomorrowCount(tomorrow.count ?? 0);

    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function confirmAppointment(id: string) {
    await supabase.from("appointments").update({ status: "confirmed" }).eq("id", id).eq("organization_id", orgId);
    await load();
  }

  async function offerFromAlert(alert: AlertRow) {
    const slot = (alert.action ?? {}) as Record<string, any>;
    const preview = await supabase.functions.invoke("offer-waitlist", {
      body: {
        organization_id: orgId,
        preview: true,
        slot: {
          slot_start: slot.slot_start ?? null,
          slot_end: slot.slot_end ?? null,
          service_type: slot.service_type ?? "general",
        },
      },
    });
    const preselected = Number((preview.data as any)?.preselected_count ?? 0);
    const go = window.confirm(
      `Se preseleccionaron ${preselected} candidatos para este hueco. ¿Enviar oferta ahora?`
    );
    if (!go) return;

    setOfferingAlertId(alert.id);
    const { error } = await supabase.functions.invoke("offer-waitlist", {
      body: {
        organization_id: orgId,
        slot: {
          slot_start: slot.slot_start ?? null,
          slot_end: slot.slot_end ?? null,
          service_type: slot.service_type ?? "general",
        },
      },
    });
    if (!error) {
      await supabase
        .from("alerts")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", alert.id)
        .eq("organization_id", orgId);
      await load();
    }
    setOfferingAlertId(null);
  }

  async function cancelOffers(alert: AlertRow) {
    const action = (alert.action ?? {}) as Record<string, any>;
    const go = window.confirm("¿Cancelar ofertas pendientes para este hueco?");
    if (!go) return;
    await supabase.functions.invoke("cancel-waitlist-offers", {
      body: {
        organization_id: orgId,
        slot_start: action.slot_start ?? null,
        slot_key: action.slot_key ?? null,
      },
    });
    await load();
  }

  function slotLabel(alert: AlertRow) {
    const action = (alert.action ?? {}) as Record<string, any>;
    const raw = action.slot_start ? String(action.slot_start) : "";
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("es-HN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function actionButtonLabel(type: string) {
    if (type === "schedule_gaps") return "Offer waitlist";
    if (type === "appointment_cancelled") return "Offer waitlist";
    if (type === "request_review") return "Request review";
    if (type === "messages_unanswered") return "Send followups";
    if (type === "unconfirmed_appointments") return "Send confirmations";
    if (type === "send_recall_message") return "Send recall message";
    if (type === "patient_recall_due") return "Send recall message";
    if (type === "marketing_opportunity") return "Generate suggested post";
    return "Execute";
  }

  function safeString(v: unknown) {
    return typeof v === "string" && v.trim() ? v : null;
  }

  async function executeAction(action: ActionRow) {
    setExecutingActionId(action.id);
    const { error } = await supabase.functions.invoke("execute-action", {
      body: { organization_id: orgId, action_id: action.id },
    });
    if (!error && action.type === "marketing_opportunity") {
      navigate("/marketing");
    }
    setExecutingActionId(null);
    await load();
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Hoy" subtitle="Operación del día en un vistazo." showBackOnMobile backTo="/inbox" />

      <SectionCard>
        {dailyDigest ? (
          <div className="mb-3 rounded-2xl border border-[#3CBDB9]/40 bg-[#0894C1]/14 px-3 py-2 text-xs text-white/85">
            <span className="font-semibold">Resumen diario:</span> {dailyDigest.body}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold text-white">Hoy</div>
            <div className="text-sm text-white/65 capitalize">{dateLabel}</div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/settings?tab=integraciones")}
            className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-white/80"
            aria-label="Alertas"
          >
            <Bell className="h-5 w-5" />
            {alerts.length > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {alerts.length}
              </span>
            ) : null}
          </button>
        </div>
      </SectionCard>

      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => navigate("/agenda?view=day&date=today")} className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3 text-left">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/50">Citas</div>
          <div className="mt-1 text-xl font-semibold text-white">{appointments.length}</div>
        </button>
        <button onClick={() => navigate("/inbox")} className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3 text-left">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/50">Mensajes nuevos</div>
          <div className="mt-1 text-xl font-semibold text-white">{newMessages}</div>
        </button>
        <button onClick={() => navigate("/inbox")} className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3 text-left">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/50">Pendientes</div>
          <div className="mt-1 text-xl font-semibold text-white">{pending}</div>
        </button>
      </div>

      <SectionCard title="Acciones recomendadas" description="Máximo 3 acciones con impacto inmediato.">
        <div className="grid gap-2">
          {actions.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/65">
              Sin acciones urgentes por ahora.
            </div>
          ) : (
            actions.map((item) => (
              <div key={item.id} className="rounded-2xl border border-white/12 bg-white/5 p-3">
                <div className="text-sm font-semibold text-white">{item.title}</div>
                <div className="mt-1 text-xs text-white/70">{item.description ?? "Acción pendiente."}</div>
                <button
                  type="button"
                  onClick={() => void executeAction(item)}
                  disabled={executingActionId === item.id}
                  className="mt-3 inline-flex h-10 items-center rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white"
                >
                  {executingActionId === item.id ? "Ejecutando..." : actionButtonLabel(item.type)}
                </button>
              </div>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard title="Oportunidad de crecimiento" description="Convierte actividad diaria en adquisición.">
        <div className="grid gap-2">
          {growth.reviewRequestsToday > 0 ? (
            <div className="rounded-2xl border border-white/12 bg-white/5 px-3 py-3 text-sm text-white/85">
              {growth.reviewRequestsToday} pacientes satisfechos hoy → solicitar reviews
            </div>
          ) : null}
          {growth.topInterestCount > 0 ? (
            <div className="rounded-2xl border border-white/12 bg-white/5 px-3 py-3 text-sm text-white/85">
              {growth.topInterestCount} personas preguntaron por {growth.topInterestTopic ?? "servicios"} → sugerir promoción
            </div>
          ) : null}
          {!growth.reviewRequestsToday && !growth.topInterestCount ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/65">
              Sin oportunidades nuevas por ahora.
            </div>
          ) : null}
          {growth.suggestion ? (
            <button
              type="button"
              onClick={() => navigate("/marketing")}
              className="inline-flex h-10 items-center rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white"
            >
              Ver sugerencia: {growth.suggestion}
            </button>
          ) : null}
        </div>
      </SectionCard>

      {alerts.length > 0 ? (
        <SectionCard title="Alertas" description="Eventos que requieren acción rápida.">
          <div className="grid gap-2">
            {alerts.map((a) => {
              const isWaitlistReady = a.type === "waitlist_offer_ready";
              const isWaitlistSent = a.type === "waitlist_offer_sent";
              const action = (a.action ?? {}) as Record<string, any>;
              const leadIds = Array.isArray(action.lead_ids) ? action.lead_ids.filter(Boolean) : [];
              const slot = slotLabel(a);
              return (
                <div key={a.id} className="rounded-2xl border border-white/12 bg-[#0C111C] p-3">
                  <div className="text-sm font-semibold text-white">
                    {isWaitlistReady && slot ? `Slot freed ${slot}` : a.title}
                  </div>
                  {isWaitlistSent ? (
                    <div className="mt-1 text-xs text-emerald-300">
                      Offered automatically to {Number(action.sent ?? 0)} patients
                    </div>
                  ) : a.body ? (
                    <div className="mt-1 text-xs text-white/70">{a.body}</div>
                  ) : null}
                  {isWaitlistReady ? (
                    <button
                      type="button"
                      onClick={() => void offerFromAlert(a)}
                      disabled={offeringAlertId === a.id}
                      className="mt-3 inline-flex h-10 items-center rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-200 disabled:opacity-60"
                    >
                      {offeringAlertId === a.id ? "Enviando..." : "Ofrecer a 3 (preselección)"}
                    </button>
                  ) : null}
                  {isWaitlistSent ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(leadIds[0] ? `/inbox/${leadIds[0]}` : "/inbox")}
                        className="inline-flex h-10 items-center rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white"
                      >
                        View chat
                      </button>
                      <button
                        type="button"
                        onClick={() => void cancelOffers(a)}
                        className="inline-flex h-10 items-center rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 text-xs font-semibold text-rose-200"
                      >
                        Cancel offers
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Timeline de hoy" description="Citas y acciones rápidas.">
        {loading ? (
          <div className="text-sm text-white/70">Cargando...</div>
        ) : appointments.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/65">No hay citas para hoy.</div>
        ) : (
          <div className="grid gap-2">
            {appointments.map((a) => {
              const iso = appointmentISO(a);
              const t = iso ? new Date(iso).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" }) : "--:--";
              return (
                <div key={a.id} className="rounded-2xl border border-white/12 bg-[#0C111C] px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-white">
                        <Clock3 className="h-4 w-4 text-white/60" />
                        <span className="font-semibold">{t}</span>
                      </div>
                      <div className="mt-1 truncate text-sm text-white/90">{a.patient_name || a.title || "Paciente"}</div>
                      <div className="truncate text-xs text-white/60">{a.reason || a.title || "Servicio"}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusChip(a.status)}`}>
                      {String(a.status ?? "pendiente")}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void confirmAppointment(a.id)}
                      className="inline-flex h-9 items-center gap-1 rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-200"
                    >
                      <CalendarDays className="h-3.5 w-3.5" />
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(a.lead_id ? `/inbox/${a.lead_id}` : "/inbox")}
                      className="inline-flex h-9 items-center gap-1 rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      Mensaje
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard>
        <div className="rounded-2xl border border-white/12 bg-white/5 p-3">
          <div className="text-sm font-semibold text-white">Mañana</div>
          <div className="mt-1 text-xs text-white/65">
            Mañana: {tomorrowCount} citas • {Math.max(0, 10 - tomorrowCount)} huecos
          </div>
          <button
            type="button"
            onClick={() => navigate("/tomorrow")}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white"
          >
            <SendHorizonal className="h-4 w-4" />
            Ver mañana
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
