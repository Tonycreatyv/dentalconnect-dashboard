import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, User } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { SectionCard } from "../components/SectionCard";
import { EmptyState } from "../components/EmptyState";
import { normalizedStartISO } from "../lib/appointments";
import { Toast, type ToastKind } from "../components/ui/Toast";
import PageHeader from "../components/PageHeader";

const DEFAULT_ORG = "clinic-demo";

type AppointmentPatientRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  patient_name: string | null;
  reason: string | null;
  status: string | null;
  notes: string | null;
  created_at: string | null;
  start_at: string | null;
  starts_at: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
};

type PatientSummary = {
  key: string;
  lead_id: string | null;
  name: string;
  lastVisitISO: string | null;
  nextVisitISO: string | null;
  topServices: string[];
  statusLabel: "activo" | "en seguimiento" | "pendiente";
  latestClinicalNote: string | null;
  appointments: AppointmentPatientRow[];
};

function derivePatientKey(row: AppointmentPatientRow) {
  const lead = row.lead_id?.trim();
  if (lead) return `lead:${lead}`;
  return `name:${(row.patient_name ?? "Sin nombre").trim().toLowerCase()}`;
}

function getAppointmentISO(row: AppointmentPatientRow) {
  return normalizedStartISO(row) ?? row.created_at ?? null;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "Sin fecha";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  return d.toLocaleString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Patients() {
  const navigate = useNavigate();
  const { clinic } = useClinic();
  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [rows, setRows] = useState<AppointmentPatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePatient, setActivePatient] = useState<PatientSummary | null>(null);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      const q = await supabase
        .from("appointments")
        .select(
          "id, organization_id, lead_id, patient_name, reason, status, notes, created_at, start_at, starts_at, appointment_date, appointment_time"
        )
        .eq("organization_id", ORG)
        .not("patient_name", "is", null)
        .order("start_at", { ascending: false })
        .limit(600);

      if (!mounted) return;

      if (q.error) {
        const msg = `No se pudo cargar pacientes: ${q.error.message}. Hint: revisa RLS/select en appointments.`;
        setError(msg);
        setToast({ kind: "error", message: msg });
        setRows([]);
      } else {
        setRows((q.data as AppointmentPatientRow[]) ?? []);
      }

      setLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
  }, [ORG]);

  const patients = useMemo(() => {
    const grouped = new Map<string, PatientSummary>();

    for (const row of rows) {
      const key = derivePatientKey(row);
      const iso = getAppointmentISO(row);
      const name = row.patient_name?.trim() || (row.lead_id ? `Paciente ${row.lead_id.slice(-4)}` : "Sin nombre");

      const prev = grouped.get(key);
      if (!prev) {
        grouped.set(key, {
          key,
          lead_id: row.lead_id,
          name,
          lastVisitISO: iso,
          nextVisitISO: null,
          topServices: [],
          statusLabel: "pendiente",
          latestClinicalNote: row.notes?.trim() || null,
          appointments: [row],
        });
        continue;
      }

      prev.appointments.push(row);
      if (!prev.lastVisitISO || (iso && new Date(iso).getTime() > new Date(prev.lastVisitISO).getTime())) {
        prev.lastVisitISO = iso;
      }
      if (row.notes?.trim()) prev.latestClinicalNote = row.notes.trim();
    }

    const now = Date.now();
    for (const patient of grouped.values()) {
      const future = patient.appointments
        .map((a) => getAppointmentISO(a))
        .filter((x): x is string => Boolean(x))
        .filter((iso) => new Date(iso).getTime() > now)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      patient.nextVisitISO = future[0] ?? null;

      const serviceCounts = new Map<string, number>();
      for (const appt of patient.appointments) {
        const service = (appt.reason?.trim() || appt.patient_name?.trim() || "Cita").toLowerCase();
        serviceCounts.set(service, (serviceCounts.get(service) ?? 0) + 1);
      }
      patient.topServices = Array.from(serviceCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([service]) => service.charAt(0).toUpperCase() + service.slice(1));

      if (patient.nextVisitISO) {
        patient.statusLabel = "activo";
      } else {
        const latest = patient.lastVisitISO ? new Date(patient.lastVisitISO).getTime() : 0;
        const daysSince = latest ? (now - latest) / (1000 * 60 * 60 * 24) : 999;
        patient.statusLabel = daysSince <= 45 ? "en seguimiento" : "pendiente";
      }
    }

    return Array.from(grouped.values()).sort((a, b) => {
      const at = a.lastVisitISO ? new Date(a.lastVisitISO).getTime() : 0;
      const bt = b.lastVisitISO ? new Date(b.lastVisitISO).getTime() : 0;
      return bt - at;
    });
  }, [rows]);

  return (
    <div className="space-y-4">
      <PageHeader title="Pacientes" showBackOnMobile backTo="/overview" />

      <SectionCard title="Pacientes" description="Listado generado desde tus citas registradas.">
        {loading ? (
          <div className="text-sm text-white/60">Cargando…</div>
        ) : error ? (
          <div className="text-sm text-rose-400">{error}</div>
        ) : patients.length === 0 ? (
          <EmptyState title="Sin pacientes" message="Cuando registres citas con paciente, aparecerán aquí." />
        ) : (
          <div className="grid gap-2">
            {patients.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setActivePatient(p)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#3CBDB9]/20"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-white/50" />
                      <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                      Última visita: {formatDateTime(p.lastVisitISO)} · {p.appointments.length} cita(s)
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.nextVisitISO ? (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-400">
                        Próxima cita
                      </span>
                    ) : null}
                    <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70">
                      Ver historial
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {activePatient ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-xl p-4">
          <div className="h-[min(90vh,760px)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-white/6 p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-white/95">{activePatient.name}</div>
                <div className="text-sm text-white/72">Historial y contexto del paciente</div>
              </div>
              <button
                type="button"
                onClick={() => setActivePatient(null)}
                className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white/90 hover:bg-white/15"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="text-xs text-white/65">Última visita</div>
                <div className="mt-1 text-sm font-semibold text-white/95">{formatDateTime(activePatient.lastVisitISO)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="text-xs text-white/65">Próxima cita</div>
                <div className="mt-1 text-sm font-semibold text-white/95">{formatDateTime(activePatient.nextVisitISO)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="text-xs text-white/65">Total de citas</div>
                <div className="mt-1 text-sm font-semibold text-white/95">{activePatient.appointments.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="text-xs text-white/65">Estado</div>
                <div className="mt-1 text-sm font-semibold text-white/95 capitalize">{activePatient.statusLabel}</div>
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="text-xs text-white/65">Servicios más comunes</div>
              <div className="mt-1 text-sm text-white/90">
                {activePatient.topServices.length ? activePatient.topServices.join(" · ") : "Sin datos"}
              </div>
            </div>

            {activePatient.latestClinicalNote ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="text-xs text-white/65">Notas clínicas / internas</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-white/90">{activePatient.latestClinicalNote}</div>
              </div>
            ) : null}

            <div className="mt-5 space-y-2">
              {activePatient.appointments
                .slice()
                .sort((a, b) => {
                  const at = getAppointmentISO(a);
                  const bt = getAppointmentISO(b);
                  return (bt ? new Date(bt).getTime() : 0) - (at ? new Date(at).getTime() : 0);
                })
                .map((appt) => {
                  const when = formatDateTime(getAppointmentISO(appt));
                  return (
                    <div key={appt.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                      <div className="text-sm font-semibold text-white/95">{appt.reason?.trim() || "Cita"}</div>
                      <div className="mt-1 text-xs text-white/70">
                        {when} · {appt.status ?? "pending"}
                      </div>
                      {appt.notes?.trim() ? (
                        <div className="mt-2 text-xs text-white/80 whitespace-pre-wrap">{appt.notes}</div>
                      ) : null}
                    </div>
                  );
                })}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setActivePatient(null)}
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/15"
              >
                Cerrar
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/agenda?patient=${encodeURIComponent(activePatient.name)}`)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/15"
                >
                  <CalendarDays className="h-4 w-4" />
                  Ver agenda
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/agenda?createFor=${encodeURIComponent(activePatient.name)}`)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#0894C1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3CBDB9]"
                >
                  Crear cita
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Toast
        open={Boolean(toast)}
        kind={toast?.kind}
        message={toast?.message ?? ""}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
