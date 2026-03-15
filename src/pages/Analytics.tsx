import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useClinic } from "../context/ClinicContext";
import { StatCard } from "../components/StatCard";
import { BarChart, type ChartDatum } from "../components/BarChart";
import { SectionCard } from "../components/SectionCard";
import { EmptyState } from "../components/EmptyState";

const Analytics = () => {
  const { clinicId } = useClinic();
  const [messages, setMessages] = useState<{ channel?: string | null; created_at?: string | null }[]>(
    []
  );
  const [appointments, setAppointments] = useState<{ status?: string | null; created_at?: string | null }[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadAnalytics = async () => {
      setLoading(true);
      const messagesQuery = supabase
        .from("conversation_messages")
        .select("channel, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      const appointmentsQuery = supabase
        .from("appointments")
        .select("status, created_at")
        .order("created_at", { ascending: false })
        .limit(300);

      if (clinicId) {
        messagesQuery.eq("clinic_id", clinicId);
        appointmentsQuery.eq("clinic_id", clinicId);
      }

      const [{ data: messagesData }, { data: appointmentsData }] = await Promise.all([
        messagesQuery,
        appointmentsQuery,
      ]);

      if (!mounted) return;
      setMessages(messagesData ?? []);
      setAppointments(appointmentsData ?? []);
      setLoading(false);
    };

    loadAnalytics();

    return () => {
      mounted = false;
    };
  }, [clinicId]);

  const messagesPerDay = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);

    const countsByDay: Record<string, number> = {};
    messages.forEach((message) => {
      if (!message.created_at) return;
      const date = new Date(message.created_at);
      if (date < start) return;
      const key = date.toLocaleDateString();
      countsByDay[key] = (countsByDay[key] ?? 0) + 1;
    });

    return Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = date.toLocaleDateString();
      return {
        label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: countsByDay[key] ?? 0,
      };
    });
  }, [messages]);

  const leadsPerChannel = useMemo(() => {
    const counts: Record<string, number> = {};
    messages.forEach((message) => {
      const channel = message.channel ?? "unknown";
      counts[channel] = (counts[channel] ?? 0) + 1;
    });
    const data = Object.entries(counts).map(([label, value]) => ({ label, value }));
    return data.length ? data : [{ label: "No data", value: 0 }];
  }, [messages]);

  const appointmentStats = useMemo(() => {
    const requested = appointments.filter((appt) => appt.status === "requested").length;
    const confirmed = appointments.filter((appt) => appt.status === "confirmed").length;
    const cancelled = appointments.filter((appt) => appt.status === "cancelled").length;
    const conversionRate = requested ? Math.round((confirmed / requested) * 100) : 0;

    return { requested, confirmed, cancelled, conversionRate };
  }, [appointments]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-100">Analytics</h2>
        <p className="mt-2 text-sm text-white/40">Performance across messaging and scheduling.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Messages" value={messages.length} helper="Last 500 messages" />
        <StatCard label="Leads" value={leadsPerChannel.length} helper="Active channels" />
        <StatCard label="Appointments" value={appointments.length} helper="Last 300 appointments" />
        <StatCard label="Conversion" value={`${appointmentStats.conversionRate}%`} helper="Confirmed vs requested" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <BarChart title="Messages per day" data={messagesPerDay} />
        <BarChart title="Leads per channel" data={leadsPerChannel} />
      </div>

      <SectionCard title="Appointment conversion" description="Requested vs confirmed appointments.">
        {loading ? (
          <p className="text-sm text-white/40">Loading appointment analytics...</p>
        ) : appointments.length === 0 ? (
          <EmptyState title="No appointment data" message="Conversion metrics will appear here." />
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Requested</p>
              <p className="mt-3 text-2xl font-semibold text-slate-100">{appointmentStats.requested}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Confirmed</p>
              <p className="mt-3 text-2xl font-semibold text-slate-100">{appointmentStats.confirmed}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Cancelled</p>
              <p className="mt-3 text-2xl font-semibold text-slate-100">{appointmentStats.cancelled}</p>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default Analytics;
