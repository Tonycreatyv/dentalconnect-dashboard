import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarCheck2, Clock3, Send } from "lucide-react";
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
  reason: string | null;
  status: string | null;
  start_at: string | null;
  starts_at: string | null;
};

type Gap = { slot_start: string; slot_end: string; service_type: string };

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

function hourLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
}

export default function Tomorrow() {
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const orgId = clinic?.organization_id ?? DEFAULT_ORG;

  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [sendingSlot, setSendingSlot] = useState<string | null>(null);

  const tomorrowRange = useMemo(() => {
    const base = new Date(Date.now() + 86400000);
    return {
      start: startOfDay(base),
      end: endOfDay(base),
    };
  }, []);

  async function load() {
    const res = await supabase
      .from("appointments")
      .select("id, organization_id, lead_id, patient_name, reason, status, start_at, starts_at")
      .eq("organization_id", orgId)
      .gte("start_at", tomorrowRange.start.toISOString())
      .lte("start_at", tomorrowRange.end.toISOString())
      .order("start_at", { ascending: true });

    if (!res.error && res.data) setAppointments(res.data as AppointmentRow[]);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const gaps = useMemo(() => {
    const occupiedHours = new Set<number>();
    for (const a of appointments) {
      const iso = appointmentISO(a);
      if (!iso) continue;
      occupiedHours.add(new Date(iso).getHours());
    }
    const out: Gap[] = [];
    for (let h = 8; h <= 17; h += 1) {
      if (occupiedHours.has(h)) continue;
      const slotStart = new Date(tomorrowRange.start);
      slotStart.setHours(h, 0, 0, 0);
      const slotEnd = new Date(tomorrowRange.start);
      slotEnd.setHours(h + 1, 0, 0, 0);
      out.push({ slot_start: slotStart.toISOString(), slot_end: slotEnd.toISOString(), service_type: "general" });
    }
    return out.slice(0, 5);
  }, [appointments, tomorrowRange.start]);

  const unconfirmed = useMemo(
    () => appointments.filter((a) => ["pending", "requested"].includes(String(a.status ?? "").toLowerCase())),
    [appointments]
  );

  async function offerWaitlist(slot: Gap) {
    const preview = await supabase.functions.invoke("offer-waitlist", {
      body: {
        organization_id: orgId,
        preview: true,
        slot,
      },
    });
    const preselected = Number((preview.data as any)?.preselected_count ?? 0);
    const go = window.confirm(
      `Se preseleccionaron ${preselected} candidatos para este hueco. ¿Enviar oferta ahora?`
    );
    if (!go) return;

    setSendingSlot(slot.slot_start);
    const { error } = await supabase.functions.invoke("offer-waitlist", {
      body: {
        organization_id: orgId,
        slot,
      },
    });
    setSendingSlot(null);
    if (!error) {
      await load();
    }
  }

  async function sendConfirmation(appt: AppointmentRow) {
    if (!appt.lead_id) return;
    const text = "Te confirmo tu cita para mañana. ¿Seguimos con ese horario?";
    const leadRes = await supabase
      .from("leads")
      .select("channel, channel_user_id")
      .eq("id", appt.lead_id)
      .maybeSingle();
    const psid = (leadRes.data as any)?.channel_user_id;
    if (!psid) return;

    await supabase.from("reply_outbox").insert({
      organization_id: orgId,
      lead_id: appt.lead_id,
      channel: (leadRes.data as any)?.channel ?? "messenger",
      channel_user_id: psid,
      status: "queued",
      scheduled_for: new Date().toISOString(),
      message_text: text,
      payload: {
        text,
        source: "tomorrow_confirmation",
        provider: "meta",
      },
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mañana"
        subtitle="Huecos, confirmaciones y acciones de 1 tap."
        showBackOnMobile
        backTo="/overview"
      />

      <SectionCard title="Huecos detectados" description="Ofrece turnos a la lista de espera.">
        {gaps.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/65">Sin huecos detectados.</div>
        ) : (
          <div className="grid gap-2">
            {gaps.map((g) => (
              <div key={g.slot_start} className="rounded-2xl border border-white/12 bg-[#0C111C] px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{hourLabel(g.slot_start)} - {hourLabel(g.slot_end)}</div>
                    <div className="text-xs text-white/65">Servicio: {g.service_type}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void offerWaitlist(g)}
                    disabled={sendingSlot === g.slot_start}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-200 disabled:opacity-60"
                  >
                    <Send className="h-4 w-4" />
                    {sendingSlot === g.slot_start ? "Enviando..." : "Ofrecer a 3 (preselección)"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Sin confirmar" description="Envía confirmación en un tap.">
        {unconfirmed.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/65">No hay confirmaciones pendientes.</div>
        ) : (
          <div className="grid gap-2">
            {unconfirmed.map((a) => {
              const iso = appointmentISO(a);
              return (
                <div key={a.id} className="rounded-2xl border border-white/12 bg-[#0C111C] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{a.patient_name || "Paciente"}</div>
                      <div className="text-xs text-white/65">{a.reason || "Cita"}</div>
                      <div className="mt-1 inline-flex items-center gap-1 text-xs text-white/70">
                        <Clock3 className="h-3.5 w-3.5" />
                        {iso ? new Date(iso).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" }) : "--:--"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void sendConfirmation(a)}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 text-xs font-semibold text-sky-200"
                    >
                      <CalendarCheck2 className="h-4 w-4" />
                      Enviar confirmación
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Checklist" description="Operación sugerida para mañana.">
        <div className="grid gap-2 text-sm text-white/80">
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">1. Revisar huecos y priorizar servicios rentables.</div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">2. Enviar confirmaciones pendientes antes de las 6pm.</div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">3. Dejar mensajes listos en Inbox para primeros pacientes.</div>
        </div>
      </SectionCard>

      <button
        type="button"
        onClick={() => navigate("/agenda?view=day")}
        className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white"
      >
        <CalendarCheck2 className="h-4 w-4" />
        Abrir Agenda
      </button>
    </div>
  );
}
