import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Plus, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useClinic } from "../context/ClinicContext";
import { Toggle } from "../components/Toggle";
import { startMetaOAuth } from "../components/integrations/ConnectMessengerButton";

const ONBOARDING_FLAG = "dc_onboarding_in_progress";
const META_REDIRECT_FLAG = "dc_post_meta_redirect";

type HoursDay = { closed: boolean; open?: string; close?: string };
type HoursMap = Record<string, HoursDay>;
type ServiceItem = { name: string; duration_min: number; price: string; active: boolean };

const DEFAULT_HOURS: HoursMap = {
  lunes: { closed: false, open: "08:00", close: "17:00" },
  martes: { closed: false, open: "08:00", close: "17:00" },
  miercoles: { closed: false, open: "08:00", close: "17:00" },
  jueves: { closed: false, open: "08:00", close: "17:00" },
  viernes: { closed: false, open: "08:00", close: "17:00" },
  sabado: { closed: false, open: "08:00", close: "12:00" },
  domingo: { closed: true },
};

const DEFAULT_SERVICES: ServiceItem[] = [
  { name: "Limpieza dental", duration_min: 45, price: "", active: true },
  { name: "Consulta general", duration_min: 30, price: "", active: true },
  { name: "Blanqueamiento", duration_min: 60, price: "", active: true },
  { name: "Ortodoncia consulta", duration_min: 30, price: "", active: true },
  { name: "Extracción simple", duration_min: 45, price: "", active: true },
  { name: "Implante dental", duration_min: 60, price: "", active: false },
  { name: "Endodoncia", duration_min: 60, price: "", active: false },
  { name: "Corona dental", duration_min: 45, price: "", active: false },
  { name: "Caries / Relleno", duration_min: 30, price: "", active: false },
];

function slugifyClinicName(input: string) {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { clinic, activeOrgId, setActiveOrgId } = useClinic();

  const [step, setStep] = useState(1);
  const totalSteps = 4;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdOrgId, setCreatedOrgId] = useState<string>("");
  const [messengerConnected, setMessengerConnected] = useState(false);

  const [clinicName, setClinicName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [hours, setHours] = useState<HoursMap>(DEFAULT_HOURS);
  const [services, setServices] = useState<ServiceItem[]>(DEFAULT_SERVICES);

  useEffect(() => {
    try {
      localStorage.setItem(ONBOARDING_FLAG, "1");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (searchParams.get("connected") === "1") {
      setMessengerConnected(true);
      setStep(4);
    }
  }, [searchParams]);

  useEffect(() => {
    const orgId = activeOrgId || clinic?.organization_id || createdOrgId;
    if (!orgId) return;
    setCreatedOrgId(orgId);
    void (async () => {
      const res = await supabase
        .from("org_settings")
        .select("brand_name, meta_page_id, messenger_enabled")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!res.error && res.data) {
        if (!clinicName && typeof res.data.brand_name === "string") setClinicName(res.data.brand_name);
        setMessengerConnected(Boolean(res.data.meta_page_id) && Boolean(res.data.messenger_enabled));
      }
    })();
  }, [activeOrgId, clinic?.organization_id, createdOrgId, clinicName]);

  const openDays = useMemo(() => Object.values(hours).filter((day) => !day.closed).length, [hours]);
  const activeServices = useMemo(() => services.filter((service) => service.active), [services]);
  const canProceed = useMemo(() => {
    if (step === 1) return clinicName.trim().length >= 3;
    if (step === 2) return openDays > 0;
    if (step === 3) return activeServices.length > 0;
    return true;
  }, [step, clinicName, openDays, activeServices.length]);

  async function provisionClinic() {
    if (!user) throw new Error("No hay sesión activa.");
    if (createdOrgId) return createdOrgId;

    const now = new Date().toISOString();
    const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const baseSlug = slugifyClinicName(clinicName) || "clinica";
    const orgId = `${baseSlug}-${Date.now().toString(36)}`;

    const orgInsert = await supabase.from("organizations").insert({
      id: orgId,
      name: clinicName.trim(),
    });
    if (orgInsert.error) throw new Error(orgInsert.error.message);

    const orgSettingsInsert = await supabase.from("org_settings").insert({
      organization_id: orgId,
      business_type: "dental",
      brand_name: clinicName.trim(),
      messenger_enabled: false,
      llm_brain_enabled: false,
      plan: "trial",
      is_trial_active: true,
      trial_started_at: now,
      trial_ends_at: trialEnds,
      updated_at: now,
    });
    if (orgSettingsInsert.error) throw new Error(orgSettingsInsert.error.message);

    const clinicInsert = await supabase
      .from("clinics")
      .insert({
        name: clinicName.trim(),
        organization_id: orgId,
      })
      .select("id")
      .single();
    if (clinicInsert.error) throw new Error(clinicInsert.error.message);

    const clinicSettingsInsert = await supabase.from("clinic_settings").insert({
      clinic_id: clinicInsert.data.id,
      phone: phone.trim() || null,
      address: [address.trim(), city.trim()].filter(Boolean).join(", ") || null,
      hours,
      services: activeServices.map((service) => ({
        name: service.name,
        duration_min: service.duration_min,
        price: service.price.trim() || null,
      })),
      updated_at: now,
    });
    if (clinicSettingsInsert.error) throw new Error(clinicSettingsInsert.error.message);

    const profileUpsert = await supabase.from("user_profiles").upsert(
      {
        user_id: user.id,
        is_admin: true,
        default_org_id: orgId,
      },
      { onConflict: "user_id" }
    );
    if (profileUpsert.error) throw new Error(profileUpsert.error.message);

    const orgMemberUpsert = await supabase.from("org_members").upsert(
      {
        organization_id: orgId,
        user_id: user.id,
        role: "owner",
      },
      { onConflict: "organization_id,user_id" }
    );
    if (orgMemberUpsert.error) throw new Error(orgMemberUpsert.error.message);

    const subscriptionUpsert = await supabase.from("subscriptions").upsert(
      {
        organization_id: orgId,
        status: "trialing",
        plan: "pro",
        trial_started_at: now,
        trial_ends_at: trialEnds,
        updated_at: now,
      },
      { onConflict: "organization_id" }
    );
    if (subscriptionUpsert.error) throw new Error(subscriptionUpsert.error.message);

    await setActiveOrgId(orgId);
    setCreatedOrgId(orgId);
    return orgId;
  }

  async function handleNext() {
    if (!canProceed) return;
    setError(null);

    if (step === 3) {
      try {
        setSaving(true);
        await provisionClinic();
        setStep(4);
      } catch (err: any) {
        setError(String(err?.message ?? err));
      } finally {
        setSaving(false);
      }
      return;
    }

    if (step === 4) {
      await finishOnboarding();
      return;
    }

    setStep((prev) => prev + 1);
  }

  async function finishOnboarding() {
    try {
      setSaving(true);
      if (!createdOrgId) {
        await provisionClinic();
      }
      try {
        localStorage.removeItem(ONBOARDING_FLAG);
        localStorage.removeItem(META_REDIRECT_FLAG);
      } catch {
        // ignore
      }
      navigate("/hoy", { replace: true });
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setSaving(false);
    }
  }

  async function connectMessenger() {
    try {
      setError(null);
      const orgId = createdOrgId || activeOrgId;
      if (!orgId) {
        throw new Error("Primero debemos crear la clínica antes de conectar Messenger.");
      }
      localStorage.setItem(META_REDIRECT_FLAG, "/onboarding?connected=1");
      await startMetaOAuth(orgId);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    }
  }

  function updateService(index: number, patch: Partial<ServiceItem>) {
    setServices((prev) => prev.map((service, i) => (i === index ? { ...service, ...patch } : service)));
  }

  function addCustomService() {
    setServices((prev) => [
      ...prev,
      { name: "", duration_min: 30, price: "", active: true },
    ]);
  }

  function removeService(index: number) {
    setServices((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="min-h-screen bg-[#0B1117] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-10">
        <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/30 sm:p-8">
          <div className="text-sm text-white/40 mb-2">Paso {step} de {totalSteps}</div>
          <div className="mb-8 flex gap-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className={`h-1 flex-1 rounded-full ${item <= step ? "bg-[#3CBDB9]" : "bg-white/10"}`} />
            ))}
          </div>

          {step === 1 ? (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-white">¿Cómo se llama tu clínica?</h2>
              <p className="text-white/50 text-sm">Esta información aparecerá cuando el bot se comunique con tus pacientes.</p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm text-white/60">Nombre de la clínica *</label>
                  <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-white/30 focus:border-[#3CBDB9] outline-none" placeholder="Ej: Clínica Dental Sonrisas" />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-white/60">Teléfono</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-white/30 focus:border-[#3CBDB9] outline-none" placeholder="+504 9999-9999" />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-white/60">Dirección</label>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-white/30 focus:border-[#3CBDB9] outline-none" placeholder="Colonia, calle, edificio" />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-white/60">Ciudad</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-white/30 focus:border-[#3CBDB9] outline-none" placeholder="Tegucigalpa, San Pedro Sula, etc." />
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-white">¿Cuál es tu horario de atención?</h2>
              <p className="text-white/50 text-sm">El asistente solo ofrecerá citas dentro de estos horarios.</p>
              <div className="space-y-3">
                {Object.entries(hours).map(([day, config]) => (
                  <div key={day} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                    <Toggle enabled={!config.closed} onChange={(open) => setHours((prev) => ({
                      ...prev,
                      [day]: open
                        ? { closed: false, open: prev[day].open ?? "08:00", close: prev[day].close ?? (day === "sabado" ? "12:00" : "17:00") }
                        : { closed: true },
                    }))} />
                    <span className="w-24 text-sm capitalize text-white">{day}</span>
                    {!config.closed ? (
                      <>
                        <input type="time" value={config.open ?? "08:00"} onChange={(e) => setHours((prev) => ({ ...prev, [day]: { ...prev[day], closed: false, open: e.target.value } }))} className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white" />
                        <span className="text-white/40">a</span>
                        <input type="time" value={config.close ?? "17:00"} onChange={(e) => setHours((prev) => ({ ...prev, [day]: { ...prev[day], closed: false, close: e.target.value } }))} className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white" />
                      </>
                    ) : (
                      <span className="text-sm text-white/30">Cerrado</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-white">¿Qué servicios ofreces?</h2>
                <p className="text-white/50 text-sm">Activa los servicios que ofrece tu clínica. Puedes editar duración y precio.</p>
              </div>
              <div className="space-y-3">
                {services.map((service, index) => (
                  <div key={`${service.name}-${index}`} className={`rounded-xl border p-3 ${service.active ? "border-[#3CBDB9]/30 bg-[#3CBDB9]/10" : "border-white/10 bg-white/5"}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <Toggle enabled={service.active} onChange={(active) => updateService(index, { active })} />
                      <input value={service.name} onChange={(e) => updateService(index, { name: e.target.value })} className={`h-10 min-w-[180px] flex-1 rounded-lg border px-3 text-sm outline-none ${service.active ? "border-[#3CBDB9]/30 bg-white/5 text-white" : "border-white/10 bg-white/5 text-white/50"}`} placeholder="Nombre del servicio" />
                      {service.active ? (
                        <>
                          <input value={service.duration_min} type="number" min={10} onChange={(e) => updateService(index, { duration_min: Number(e.target.value) || 30 })} className="h-10 w-20 rounded-lg border border-white/10 bg-white/5 px-2 text-center text-sm text-white" />
                          <span className="text-xs text-white/40">min</span>
                          <input value={service.price} onChange={(e) => updateService(index, { price: e.target.value })} className="h-10 w-28 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder-white/30" placeholder="Precio" />
                        </>
                      ) : null}
                      {index >= DEFAULT_SERVICES.length ? (
                        <button type="button" onClick={() => removeService(index)} className="rounded-lg border border-rose-400/20 bg-rose-500/10 p-2 text-rose-300 hover:bg-rose-500/20">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addCustomService} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">
                <Plus className="h-4 w-4" />
                Agregar servicio
              </button>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4 text-center">
              <h2 className="text-xl font-semibold text-white">Conecta tu página de Facebook</h2>
              <p className="text-sm text-white/50">
                Para que el asistente pueda responder mensajes de tus pacientes, necesitamos conectar la página de Facebook de tu clínica.
              </p>
              <div className="py-8">
                <button onClick={connectMessenger} className="mx-auto flex items-center gap-2 rounded-xl bg-[#1877F2] px-6 py-3 text-sm font-medium text-white hover:bg-[#1664d9]">
                  <MessageCircle className="h-5 w-5" />
                  Conectar Facebook Messenger
                </button>
              </div>
              <p className="text-xs text-white/30">También puedes hacer esto después desde Configuración.</p>
              <button onClick={finishOnboarding} className="rounded-xl bg-[#3CBDB9] px-6 py-3 text-sm font-semibold text-[#0B1117] hover:bg-[#35a9a5]">
                {messengerConnected ? "Ir al Dashboard" : "Omitir por ahora"}
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="mt-8 flex gap-3">
            {step > 1 ? (
              <button onClick={() => setStep((prev) => prev - 1)} className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/70 hover:bg-white/10">
                Anterior
              </button>
            ) : null}
            <button onClick={handleNext} disabled={!canProceed || saving} className="flex-1 rounded-xl bg-[#3CBDB9] px-5 py-3 text-sm font-semibold text-[#0B1117] hover:bg-[#35a9a5] disabled:opacity-60">
              {saving ? "Guardando..." : step === totalSteps ? "Finalizar" : "Continuar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
