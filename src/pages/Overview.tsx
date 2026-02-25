import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, CheckCircle2, MessageSquareText, Users, Sparkles } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { SectionCard } from "../components/SectionCard";
import { EmptyState } from "../components/EmptyState";
import { dedupeByKey } from "../lib/dedupe";
import { appointmentKey, normalizedStartISO } from "../lib/appointments";
import { addDays, startOfWeekSunday, toEndOfDay, toStartOfDay } from "../lib/time";

const DEFAULT_ORG = "clinic-demo";

type LeadRow = {
  id: string;
  full_name: string | null;
  channel: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_bot_reply_at: string | null;
  follow_up_due_at: string | null;
  created_at: string | null;
};

type ApptRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  start_at: string | null;
  starts_at: string | null;
  status: string | null;
  title: string | null;
  notes: string | null;
  patient_name: string | null;
  reason: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  created_at: string | null;
};

type PostItemRow = {
  id: string;
  campaign_id: string;
  image_url: string | null;
  scheduled_at: string | null;
  status: string | null;
};

function normalizeStatus(statusRaw: string | null | undefined) {
  const s = (statusRaw ?? "pending").trim().toLowerCase();
  if (s === "booked") return "confirmed";
  if (s === "canceled") return "cancelled";
  if (s === "done" || s === "attended" || s === "finished") return "completed";
  if (s === "noshow" || s === "no-show" || s === "no show") return "no_show";
  return s;
}

function statusLabel(statusRaw: string | null | undefined) {
  const s = normalizeStatus(statusRaw);
  if (s === "confirmed") return "Confirmadas";
  if (s === "cancelled") return "Canceladas";
  if (s === "no_show") return "No-show";
  if (s === "completed") return "Atendidas";
  if (s === "requested") return "Solicitadas";
  return "Pendientes";
}

function StatCard({
  title,
  value,
  hint,
  onClick,
  icon: Icon,
}: {
  title: string;
  value: number;
  hint: string;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-[#E5E7EB] bg-white p-5 text-left hover:bg-[#F4F5F7] transition focus:outline-none focus:ring-2 focus:ring-blue-200"
    >
      <div className="flex items-center justify-between">
        <div className="text-xs tracking-[0.25em] text-slate-500 uppercase">{title}</div>
        <Icon className="h-4 w-4 text-slate-500" />
      </div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value}</div>
      <div className="mt-2 text-sm text-slate-700">{hint}</div>
    </button>
  );
}

function SummaryCard({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-4 text-left transition hover:bg-[#F4F5F7] focus:outline-none focus:ring-2 focus:ring-blue-200"
    >
      <div className="text-xs text-slate-500 uppercase tracking-[0.2em]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </button>
  );
}

function relativeTime(iso?: string | null) {
  if (!iso) return "";
  const now = Date.now();
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Math.max(0, now - time);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "justo ahora";
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

export default function Overview() {
  const navigate = useNavigate();
  const { clinic } = useClinic();

  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [showAllMobile, setShowAllMobile] = useState(false);

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [marketingItems, setMarketingItems] = useState<PostItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const todayStart = useMemo(() => toStartOfDay(new Date()), []);
  const todayEnd = useMemo(() => toEndOfDay(new Date()), []);
  const weekStart = useMemo(() => startOfWeekSunday(new Date()), []);
  const weekEnd = useMemo(() => toEndOfDay(addDays(weekStart, 6)), [weekStart]);

  async function load() {
    setLoading(true);
    setErr(null);

    const lq = await supabase
      .from("leads")
      .select(
        "id, full_name, channel, last_message_at, last_message_preview, last_bot_reply_at, follow_up_due_at, created_at"
      )
      .eq("organization_id", ORG)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(300);

    const aq = await supabase
      .from("appointments")
      .select(
        "id, organization_id, lead_id, start_at, starts_at, status, title, notes, appointment_date, appointment_time, patient_name, reason, created_at"
      )
      .eq("organization_id", ORG)
      .order("start_at", { ascending: false, nullsLast: true })
      .limit(500);

    const campaignsRes = await supabase
      .from("post_campaigns")
      .select("id")
      .eq("organization_id", ORG)
      .order("created_at", { ascending: false })
      .limit(10);

    if (lq.error || aq.error) {
      setErr("No se pudo cargar el resumen. Intenta nuevamente.");
      setLeads([]);
      setAppts([]);
      setMarketingItems([]);
      setLoading(false);
      return;
    }

    const leadRows = (lq.data as any) ?? [];
    const apptRows = (aq.data as any) ?? [];

    setLeads(dedupeByKey(leadRows, (item) => item.id));
    setAppts(dedupeByKey(apptRows, appointmentKey));

    const campaignIds = (campaignsRes.data ?? []).map((c: any) => c.id);
    if (campaignIds.length > 0) {
      const itemsRes = await supabase
        .from("post_items")
        .select("id, campaign_id, image_url, scheduled_at, status")
        .in("campaign_id", campaignIds)
        .order("scheduled_at", { ascending: true });
      setMarketingItems(dedupeByKey((itemsRes.data as any) ?? [], (item) => item.id));
    } else {
      setMarketingItems([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ORG]);

  const apptsWeek = useMemo(() => {
    const start = weekStart.getTime();
    const end = weekEnd.getTime();
    return appts.filter((a) => {
      const iso = normalizedStartISO(a);
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= start && t <= end;
    });
  }, [appts, weekStart, weekEnd]);

  const apptsToday = useMemo(() => {
    const start = todayStart.getTime();
    const end = todayEnd.getTime();
    return apptsWeek.filter((a) => {
      const iso = normalizedStartISO(a);
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= start && t <= end;
    });
  }, [apptsWeek, todayStart, todayEnd]);

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    apptsWeek.forEach((a) => {
      const key = normalizeStatus(a.status);
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [apptsWeek]);

  const followupsDueToday = useMemo(() => {
    const start = todayStart.getTime();
    const end = todayEnd.getTime();
    return leads.filter((l) => {
      if (!l.follow_up_due_at) return false;
      const t = new Date(l.follow_up_due_at).getTime();
      return t >= start && t <= end;
    }).length;
  }, [leads, todayStart, todayEnd]);

  const activityStart = useMemo(() => addDays(todayStart, -6), [todayStart]);

  const activeLeads = useMemo(() => {
    const start = activityStart.getTime();
    return leads.filter((l) => {
      if (!l.last_message_at) return false;
      return new Date(l.last_message_at).getTime() >= start;
    }).length;
  }, [leads, activityStart]);

  const pendingReplies = useMemo(() => {
    return leads.filter((l) => l.last_message_at && !l.last_bot_reply_at).length;
  }, [leads]);

  const confirmationsToSend = useMemo(() => {
    return apptsWeek.filter((a) => ["pending", "requested"].includes(normalizeStatus(a.status))).length;
  }, [apptsWeek]);

  const recentLeads = useMemo(() => {
    return leads
      .filter((l) => l.last_message_at)
      .sort(
        (a, b) =>
          (b.last_message_at ? new Date(b.last_message_at).getTime() : 0) -
          (a.last_message_at ? new Date(a.last_message_at).getTime() : 0)
      )
      .slice(0, 3);
  }, [leads]);

  const todayAgenda = useMemo(() => {
    return apptsToday
      .slice()
      .sort((a, b) => {
        const ai = normalizedStartISO(a);
        const bi = normalizedStartISO(b);
        return (ai ? new Date(ai).getTime() : 0) - (bi ? new Date(bi).getTime() : 0);
      })
      .slice(0, 3);
  }, [apptsToday]);

  const nextAppointment = useMemo(() => {
    if (apptsToday.length === 0) return null;
    const sorted = apptsToday
      .slice()
      .sort((a, b) => {
        const ai = normalizedStartISO(a);
        const bi = normalizedStartISO(b);
        return (ai ? new Date(ai).getTime() : 0) - (bi ? new Date(bi).getTime() : 0);
      });
    return sorted[0] ?? null;
  }, [apptsToday]);

  const marketingThisWeek = useMemo(() => {
    const start = weekStart.getTime();
    const end = weekEnd.getTime();
    return marketingItems.filter((item) => {
      if (!item.scheduled_at) return false;
      const t = new Date(item.scheduled_at).getTime();
      return t >= start && t <= end;
    });
  }, [marketingItems, weekStart, weekEnd]);

  const marketingThumbs = useMemo(() => {
    return marketingThisWeek
      .filter((item) => item.image_url)
      .slice(0, 3)
      .map((item) => item.image_url as string);
  }, [marketingThisWeek]);

  const hasAnyData = leads.length > 0 || appts.length > 0;

  return (
    <div className="space-y-6 min-w-0 overflow-x-hidden">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Overview</h2>
        <p className="text-sm text-slate-700">Métricas clave y operaciones del día.</p>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      <div className={["grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4", showAllMobile ? "grid" : "hidden lg:grid"].join(" ")}>
        {loading ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-2xl border border-[#E5E7EB] bg-white animate-pulse" />
          ))
        ) : (
          <>
            <SummaryCard label="Citas hoy" value={apptsToday.length} onClick={() => navigate("/calendar?date=today")} />
            <SummaryCard label="Leads pendientes" value={pendingReplies} onClick={() => navigate("/inbox")} />
            <SummaryCard label="Confirmaciones" value={confirmationsToSend} onClick={() => navigate("/calendar?view=week")} />
            <SummaryCard label="Follow-ups" value={followupsDueToday} onClick={() => navigate("/inbox")} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:hidden">
        <SectionCard title="Hoy" description="Resumen del día.">
          <div className="grid gap-3">
            <div className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3">
              <div className="text-xs text-slate-500 uppercase tracking-[0.2em]">Citas hoy</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{apptsToday.length}</div>
            </div>
            <div className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3">
              <div className="text-xs text-slate-500 uppercase tracking-[0.2em]">Leads pendientes</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{pendingReplies}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/calendar?date=today")}
            className="mt-5 inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            Ver agenda →
          </button>
        </SectionCard>

        <SectionCard title="Próxima cita" description="La siguiente cita confirmada.">
          {nextAppointment ? (
            <div className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-4">
              <div className="text-sm font-semibold text-slate-900 truncate">
                {nextAppointment.title?.trim() || nextAppointment.reason?.trim() || "Cita"}
              </div>
              <div className="mt-1 text-xs text-slate-700 truncate">
                {nextAppointment.patient_name ?? "Paciente"}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {normalizedStartISO(nextAppointment)
                  ? new Date(normalizedStartISO(nextAppointment) as string).toLocaleTimeString("es", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </div>
            </div>
          ) : (
            <EmptyState title="Sin próximas citas" message="Las próximas citas aparecerán aquí." />
          )}
          <button
            type="button"
            onClick={() => navigate("/calendar")}
            className="mt-5 inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            Ver agenda →
          </button>
        </SectionCard>

        <SectionCard title="Actividad reciente" description="Últimos mensajes.">
          {recentLeads.length === 0 ? (
            <EmptyState title="Sin actividad" message="Cuando haya mensajes, aparecerán aquí." />
          ) : (
            <div className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3">
              <div className="text-sm font-semibold text-slate-900 truncate">
                {recentLeads[0]?.full_name ?? "Sin nombre"}
              </div>
              <div className="mt-1 text-xs text-slate-700 truncate">
                {recentLeads[0]?.last_message_preview ?? "—"}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate("/inbox")}
            className="mt-5 inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            Ver mensajes →
          </button>
        </SectionCard>

        {!showAllMobile ? (
          <button
            type="button"
            onClick={() => setShowAllMobile(true)}
            className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm font-semibold text-slate-900"
          >
            Ver más
          </button>
        ) : null}
      </div>

      <div className={["grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3", showAllMobile ? "block" : "hidden lg:grid"].join(" ")}>
        <SectionCard
          title="Estado de citas"
          description="Resumen semanal por estado."
          onClick={() => navigate("/calendar?view=week")}
          className="min-h-[240px]"
        >
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-2xl border border-[#E5E7EB] bg-white animate-pulse" />
              ))}
            </div>
          ) : apptsWeek.length === 0 ? (
            <EmptyState title="Sin citas" message="Cuando se registren citas, aparecerán aquí." />
          ) : (
            <div className="grid gap-2">
              {Object.entries(statusCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([status, count]) => (
                  <div
                    key={status}
                    className="flex items-center justify-between rounded-2xl border border-[#E5E7EB] bg-white px-4 py-2"
                  >
                    <div className="text-sm text-slate-700">{statusLabel(status)}</div>
                    <div className="text-sm font-semibold text-slate-900">{count}</div>
                  </div>
                ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate("/calendar?view=week")}
            className="mt-5 inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            Ver todo →
          </button>
        </SectionCard>

        <SectionCard
          title="Agenda de hoy"
          description="Próximas citas del día."
          onClick={() => navigate("/calendar?date=today")}
          className="min-h-[240px]"
        >
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-2xl border border-[#E5E7EB] bg-white animate-pulse" />
              ))}
            </div>
          ) : todayAgenda.length === 0 ? (
            <EmptyState title="Día sin citas" message="Puedes crear una cita o reprogramar pendientes." />
          ) : (
            <div className="grid gap-2">
              {todayAgenda.map((a) => {
                const iso = normalizedStartISO(a);
                const time = iso
                  ? new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
                  : "—";
                const title = a.title?.trim() || a.reason?.trim() || "Cita";
                const patient = a.patient_name?.trim() || "Paciente";
                return (
                  <div key={appointmentKey(a)} className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">{title}</div>
                        <div className="text-xs text-slate-700 truncate">{patient}</div>
                      </div>
                      <div className="text-xs text-slate-500 shrink-0">{time}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate("/calendar?date=today")}
            className="mt-5 inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            Ver todo →
          </button>
        </SectionCard>

        <SectionCard
          title="Actividad de leads"
          description="Últimos mensajes registrados."
          onClick={() => navigate("/inbox")}
          className="min-h-[240px] flex flex-col"
        >
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-2xl border border-[#E5E7EB] bg-white animate-pulse" />
              ))}
            </div>
          ) : recentLeads.length === 0 ? (
            <EmptyState title="Sin actividad" message="Cuando haya mensajes, aparecerán aquí." />
          ) : (
            <div className="grid gap-2 max-h-[190px] overflow-y-auto pr-1 pb-2">
              {recentLeads.map((l) => (
                <div key={l.id} className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{l.full_name ?? "Sin nombre"}</div>
                      <div className="text-xs text-slate-700 truncate">{l.last_message_preview ?? "—"}</div>
                    </div>
                    <div className="text-[11px] text-slate-500 shrink-0">
                      {relativeTime(l.last_message_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-auto pt-3">
            <button
              type="button"
              onClick={() => navigate("/inbox")}
              className="inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              Ver todo →
            </button>
          </div>
        </SectionCard>
      </div>

      <div className={["grid grid-cols-1", showAllMobile ? "block" : "hidden lg:grid"].join(" ")}>
        <SectionCard title="Marketing IA" description="Resumen semanal de publicaciones." onClick={() => navigate("/marketing")}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-700">
              {marketingThisWeek.length} posts programados esta semana
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <button
                type="button"
                onClick={() => navigate("/marketing")}
                className="text-sm font-semibold text-blue-600 hover:text-blue-700"
              >
                Ver todo →
              </button>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            {marketingThumbs.length > 0 ? (
              marketingThumbs.map((src, idx) => (
                <img
                  key={`${src}-${idx}`}
                  src={src}
                  alt="Preview"
                  className="h-14 w-14 rounded-xl border border-[#E5E7EB] object-cover"
                />
              ))
            ) : (
              [1, 2, 3].map((i) => (
                <div key={i} className="h-14 w-14 rounded-xl border border-[#E5E7EB] bg-[#F4F5F7]" />
              ))
            )}
          </div>
        </SectionCard>
      </div>

      {!loading && !hasAnyData ? (
        <SectionCard
          title="Sin datos"
          description="Conecta tu fuente de citas o crea una nueva para comenzar."
          onClick={() => navigate("/calendar")}
        >
          <EmptyState
            title="Aún no hay actividad"
            message="Las métricas se actualizarán automáticamente cuando lleguen nuevos leads o citas."
          />
        </SectionCard>
      ) : null}
    </div>
  );
}
