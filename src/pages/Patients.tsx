// src/pages/Patients.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, PencilLine, User } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { SectionCard } from "../components/SectionCard";
import { EmptyState } from "../components/EmptyState";

type PatientRow = {
  id: string;
  clinic_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
};

type PatientForm = {
  name: string;
  phone: string;
  email: string;
  notes: string;
};

export default function Patients() {
  const { clinicId } = useClinic();
  const navigate = useNavigate();

  const [rows, setRows] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [active, setActive] = useState<PatientRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PatientForm>({
    name: "",
    phone: "",
    email: "",
    notes: "",
  });

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!clinicId) {
        setRows([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { data, error: qError } = await supabase
        .from("patients")
        .select("id, clinic_id, name, phone, email, notes, created_at")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (!mounted) return;
      if (qError) {
        setError("No se pudo cargar pacientes.");
        setRows([]);
      } else if (data) {
        setRows(data as any);
      }
      setLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
  }, [clinicId]);

  function openDrawer(patient: PatientRow) {
    setActive(patient);
    setForm({
      name: patient.name ?? "",
      phone: patient.phone ?? "",
      email: patient.email ?? "",
      notes: patient.notes ?? "",
    });
    setDrawerOpen(true);
    setError(null);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setActive(null);
  }

  async function savePatient() {
    if (!active) return;

    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
    };

    const res = await supabase.from("patients").update(payload).eq("id", active.id);

    setSaving(false);

    if (res.error) {
      setError("No se pudo guardar los cambios.");
      return;
    }

    setRows((prev) => prev.map((p) => (p.id === active.id ? { ...p, ...payload } : p)));
    setDrawerOpen(false);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-slate-900">Pacientes</h2>

      <SectionCard title="Pacientes" description="Lista de pacientes registrados.">
        {loading ? (
          <div className="text-sm text-slate-700">Cargando…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="Sin pacientes" message="Cuando se registren pacientes, aparecerán aquí." />
        ) : (
          <div className="grid gap-2">
            {rows.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => openDrawer(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDrawer(p);
                  }
                }}
                className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 transition hover:bg-[#F4F5F7] focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-slate-500" />
                      <div className="truncate text-sm font-semibold text-slate-900">{p.name || "Sin nombre"}</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-700 truncate">
                      {p.phone || "—"} · {p.email || "sin email"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate("/calendar");
                      }}
                      className="inline-flex items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-[#F4F5F7]"
                    >
                      <CalendarDays className="h-4 w-4" />
                      Ver agenda
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrawer(p);
                      }}
                      className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      <PencilLine className="h-4 w-4" />
                      Editar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-md border-l border-[#E5E7EB] bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900">Editar paciente</div>
                <div className="text-sm text-slate-700">Actualiza datos de contacto.</div>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-2xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-slate-700 hover:bg-[#F4F5F7]"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-6 grid gap-4">
              <div>
                <label className="text-xs font-medium text-slate-700">Nombre</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Teléfono</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Email</label>
                <input
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Notas</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="mt-2 min-h-[120px] w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                />
              </div>

              {error ? <div className="text-sm text-red-600">{error}</div> : null}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => navigate("/calendar")}
                className="inline-flex items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
              >
                <CalendarDays className="h-4 w-4" />
                Ver agenda
              </button>
              <button
                type="button"
                onClick={savePatient}
                disabled={saving}
                className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
