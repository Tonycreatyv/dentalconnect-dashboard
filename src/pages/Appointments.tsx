// src/pages/Appointments.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { AppointmentsCalendar } from "../components/AppointmentsCalendar";

const ORG = "clinic-demo";

type AppointmentRow = {
  id: string;
  organization_id?: string;
  start_at: string | null;
  end_at?: string | null;
  status?: string | null;
  title?: string | null;
  patient_name?: string | null;
  notes?: string | null;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export default function Appointments() {
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // rango: esta semana
  const weekStart = useMemo(() => {
    const today = startOfDay(new Date());
    const sunday = addDays(today, -today.getDay());
    return sunday;
  }, []);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  async function load() {
    setError(null);
    setLoading(true);

    const { data, error } = await supabase
      .from("appointments")
      .select("id, organization_id, start_at, end_at, status, title, patient_name, notes")
      .eq("organization_id", ORG)
      .gte("start_at", weekStart.toISOString())
      .lt("start_at", weekEnd.toISOString())
      .order("start_at", { ascending: true });

    if (error) setError(error.message);
    setAppointments((data as any) ?? []);
    setLoading(false);
  }

  async function createDemo() {
    setError(null);

    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);

    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 30);

    const { error } = await supabase.from("appointments").insert({
      organization_id: ORG,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: "pending",
      title: "Cita (demo)",
      patient_name: "Paciente demo",
      notes: "Confirmar por WhatsApp.",
    });

    if (error) {
      setError(
        `No pude crear cita. ${error.message} — Solución: crear/ajustar tabla appointments en Supabase.`
      );
      return;
    }

    await load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-2xl font-semibold text-white">Agenda</h2>
        <p className="text-sm text-white/60">
          Semana por defecto. Seleccioná un día para ver las citas.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <AppointmentsCalendar
        loading={loading}
        appointments={appointments}
        onCreate={createDemo}
      />
    </div>
  );
}