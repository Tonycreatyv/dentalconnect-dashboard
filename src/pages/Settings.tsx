// src/pages/Settings.tsx - DARK THEME
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BadgeCheck, CalendarDays, Globe, Instagram, MessageCircle, MessagesSquare, PhoneCall, Check, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { Toggle } from "../components/Toggle";
import { Modal } from "../components/ui/Modal";
import { Toast, type ToastKind } from "../components/ui/Toast";
import { startMetaOAuth } from "../components/integrations/ConnectMessengerButton";
import StatusChip from "../components/ui/StatusChip";
import PageHeader from "../components/PageHeader";

const DEFAULT_ORG = "clinic-demo";

type ServiceItem = { name: string; price_from?: number | null; price_to?: number | null; currency?: string; duration_min?: number | null; notes?: string };
type FaqItem = { q: string; a: string };
type DayHours = { closed: boolean; open?: string; close?: string };
type HoursMap = Record<string, DayHours>;

type ClinicSettingsRow = { clinic_id: string; phone: string | null; address: string | null; google_maps_url: string | null; hours: any; services: ServiceItem[] | null; faqs: FaqItem[] | null; emergency: string | null; policies: any; updated_at: string | null; specialties: any };

type OrgIntegrationState = { meta_page_id: string | null; messenger_enabled: boolean | null; meta_connected_at: string | null; meta_last_error: string | null };

const SPECIALTIES = [
  { value: "general", label: "Clínica general" },
  { value: "ortho", label: "Ortodoncia" },
  { value: "pediatric", label: "Odontopediatría" },
  { value: "endo", label: "Endodoncia" },
  { value: "implants", label: "Implantes" },
  { value: "aesthetic", label: "Estética dental" },
];

const TEMPLATE_SERVICES: ServiceItem[] = [
  { name: "Consulta / valoración", price_from: 400, currency: "HNL", duration_min: 30, notes: "Diagnóstico inicial." },
  { name: "Limpieza dental", price_from: 700, currency: "HNL", duration_min: 45, notes: "Incluye evaluación." },
  { name: "Resina", price_from: 900, currency: "HNL", duration_min: 60, notes: "Varía por tamaño." },
  { name: "Extracción simple", price_from: 900, currency: "HNL", duration_min: 45, notes: "" },
  { name: "Blanqueamiento", price_from: 1800, currency: "HNL", duration_min: 60, notes: "Requiere evaluación." },
];

const TEMPLATE_FAQS: FaqItem[] = [
  { q: "¿Tienen disponibilidad hoy?", a: "Podemos revisar disponibilidad. ¿Qué hora te conviene?" },
  { q: "¿Cuánto cuesta una limpieza?", a: "La limpieza inicia desde L 700." },
  { q: "¿Dónde están ubicados?", a: "Te comparto la ubicación." },
  { q: "¿Atienden urgencias?", a: "Sí. ¿Qué síntomas presentas?" },
];

function defaultHours(): HoursMap {
  return { mon: { closed: false, open: "08:00", close: "17:00" }, tue: { closed: false, open: "08:00", close: "17:00" }, wed: { closed: false, open: "08:00", close: "17:00" }, thu: { closed: false, open: "08:00", close: "17:00" }, fri: { closed: false, open: "08:00", close: "17:00" }, sat: { closed: false, open: "09:00", close: "13:00" }, sun: { closed: true } };
}

const dayLabels: Record<string, string> = { mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado", sun: "Domingo" };

type TabKey = "integraciones" | "clinica" | "horario" | "servicios" | "faqs";

const INTEGRATIONS = [
  { key: "messenger" as const, name: "Messenger", description: "Centraliza mensajes de Facebook.", icon: MessagesSquare },
  { key: "instagram" as const, name: "Instagram", description: "Responde desde Instagram.", icon: Instagram },
  { key: "whatsapp" as const, name: "WhatsApp", description: "Conecta para confirmar citas.", icon: MessageCircle },
  { key: "google_calendar" as const, name: "Google Calendar", description: "Sincroniza citas.", icon: CalendarDays },
];

export default function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const { clinic, clinicId, activeOrgId } = useClinic();
  const ORG = activeOrgId ?? clinic?.organization_id ?? DEFAULT_ORG;

  const [tab, setTab] = useState<TabKey>("integraciones");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);
  const [localClinicId, setLocalClinicId] = useState<string | null>(null);

  const [clinicName, setClinicName] = useState("Clínica Sonrisas");
  const [specialties, setSpecialties] = useState<string[]>(["general"]);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [hours, setHours] = useState<HoursMap>(defaultHours());
  const [services, setServices] = useState<ServiceItem[]>(TEMPLATE_SERVICES);
  const [faqs, setFaqs] = useState<FaqItem[]>(TEMPLATE_FAQS);
  const [emergency, setEmergency] = useState("Si es urgencia, cuéntanos síntomas.");
  const [policiesCancel, setPoliciesCancel] = useState("Avisa con 2 horas de anticipación.");
  const [policiesDeposit, setPoliciesDeposit] = useState("Algunos tratamientos requieren depósito.");

  const [orgIntegration, setOrgIntegration] = useState<OrgIntegrationState>({ meta_page_id: null, messenger_enabled: false, meta_connected_at: null, meta_last_error: null });
  const [guideOpen, setGuideOpen] = useState<string | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("connected") === "1") {
      setToast({ kind: "success", message: "Messenger conectado correctamente." });
      void loadOrgIntegration();
      params.delete("connected");
      params.delete("org");
      navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" }, { replace: true });
    }
    if (params.get("tab") === "integraciones") setTab("integraciones");
  }, [location.pathname, location.search, navigate]);

  async function loadOrgIntegration() {
    const res = await supabase.from("org_settings").select("meta_page_id, messenger_enabled, meta_connected_at, meta_last_error").eq("organization_id", ORG).limit(1);
    if (!res.error && res.data?.[0]) {
      const s = res.data[0] as any;
      setOrgIntegration({ meta_page_id: s.meta_page_id ?? null, messenger_enabled: s.messenger_enabled ?? false, meta_connected_at: s.meta_connected_at ?? null, meta_last_error: s.meta_last_error ?? null });
    }
  }

  async function ensureClinic(): Promise<string | null> {
    if (clinicId) return clinicId;
    if (localClinicId) return localClinicId;
    const find = await supabase.from("clinics").select("id, name").eq("organization_id", ORG).limit(1).maybeSingle();
    if (find.data?.id) { setLocalClinicId(find.data.id); setClinicName(find.data.name ?? "Clínica"); return find.data.id; }
    const created = await supabase.from("clinics").insert({ name: clinicName.trim() || "Clínica", organization_id: ORG }).select("id, name").maybeSingle();
    if (created.data?.id) { setLocalClinicId(created.data.id); return created.data.id; }
    return null;
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const id = await ensureClinic();
      if (!mounted || !id) { setLoading(false); return; }
      const s = await supabase.from("clinic_settings").select("*").eq("clinic_id", id).maybeSingle();
      if (!mounted) return;
      const row = s.data as ClinicSettingsRow | null;
      if (row) {
        setPhone(row.phone ?? "");
        setAddress(row.address ?? "");
        setMapsUrl(row.google_maps_url ?? "");
        setHours((row.hours as HoursMap) ?? defaultHours());
        setEmergency(row.emergency ?? emergency);
        const pol = row.policies ?? {};
        setPoliciesCancel(pol.cancelacion ?? policiesCancel);
        setPoliciesDeposit(pol.deposito ?? policiesDeposit);
        if (row.services?.length) setServices(row.services);
        if (row.faqs?.length) setFaqs(row.faqs);
        if (Array.isArray(row.specialties) && row.specialties.length) setSpecialties(row.specialties);
      }
      await loadOrgIntegration();
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [clinicId, ORG]);

  const settingsSnapshot = useMemo(() => JSON.stringify({ clinicName, specialties, phone, address, mapsUrl, hours, services, faqs, emergency, policiesCancel, policiesDeposit }), [clinicName, specialties, phone, address, mapsUrl, hours, services, faqs, emergency, policiesCancel, policiesDeposit]);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  useEffect(() => { if (!loading) setInitialSnapshot(settingsSnapshot); }, [loading, settingsSnapshot]);
  const isDirty = initialSnapshot !== null && initialSnapshot !== settingsSnapshot;

  async function save() {
    if (!isDirty) return;
    setSaving(true);
    const id = await ensureClinic();
    if (!id) { setToast({ kind: "error", message: "No se pudo guardar." }); setSaving(false); return; }
    const payload: ClinicSettingsRow = { clinic_id: id, phone: phone.trim() || null, address: address.trim() || null, google_maps_url: mapsUrl.trim() || null, hours, services, faqs, emergency: emergency.trim() || null, policies: { cancelacion: policiesCancel.trim(), deposito: policiesDeposit.trim() }, specialties, updated_at: new Date().toISOString() };
    const res = await supabase.from("clinic_settings").upsert(payload, { onConflict: "clinic_id" });
    if (res.error) { setToast({ kind: "error", message: "Error al guardar." }); } else { setToast({ kind: "success", message: "Guardado." }); setInitialSnapshot(settingsSnapshot); }
    setSaving(false);
  }

  async function connectMeta() {
    try { await startMetaOAuth(ORG); } catch { setToast({ kind: "error", message: "No se pudo conectar." }); }
  }

  async function disconnectMessenger() {
    if (!window.confirm("¿Desconectar Messenger?")) return;
    await supabase.from("org_settings").update({ messenger_enabled: false, meta_page_id: null, meta_connected_at: null, meta_last_error: null }).eq("organization_id", ORG);
    setToast({ kind: "success", message: "Desconectado." });
    await loadOrgIntegration();
  }

  async function submitWaitlist() {
    if (!waitlistEmail.trim()) return;
    const res = await supabase.from("waitlist").insert({ organization_id: ORG, email: waitlistEmail.trim(), source: "google_calendar", status: "pending" });
    if (res.error) { setToast({ kind: "error", message: "No se pudo registrar." }); } else { setToast({ kind: "success", message: "Te avisaremos." }); setWaitlistEmail(""); setWaitlistOpen(false); }
  }

  function statusFor(channel: string) {
    if (channel === "google_calendar") return { label: "Próximamente", status: "disconnected" as const, disabled: true };
    if (channel === "messenger") {
      const connected = !!orgIntegration.meta_page_id && orgIntegration.messenger_enabled;
      return { label: connected ? "Conectado" : "No conectado", status: connected ? "connected" as const : "disconnected" as const, disabled: false };
    }
    return { label: "No conectado", status: "disconnected" as const, disabled: false };
  }

  const tabs = [
    { key: "integraciones" as const, label: "Integraciones" },
    { key: "clinica" as const, label: "Clínica" },
    { key: "horario" as const, label: "Horario" },
    { key: "servicios" as const, label: "Servicios" },
    { key: "faqs" as const, label: "FAQs" },
  ];

  const renderIntegrations = () => (
    <div className="space-y-4">
      {INTEGRATIONS.map((integration) => {
        const status = statusFor(integration.key);
        const Icon = integration.icon;
        const isMessenger = integration.key === "messenger";
        const isDisabled = integration.key === "google_calendar";
        return (
          <div key={integration.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 border border-white/10">
                  <Icon className="h-5 w-5 text-white/70" />
                </div>
                <div>
                  <div className="font-semibold text-white">{integration.name}</div>
                  <div className="text-sm text-white/50">{integration.description}</div>
                </div>
              </div>
              <StatusChip status={status.status} label={status.label} />
            </div>
            <div className="flex flex-wrap gap-2">
              {isMessenger && status.status === "connected" ? (
                <button onClick={disconnectMessenger} className="px-4 py-2 rounded-xl border border-white/15 text-sm font-medium text-white/80 hover:bg-white/10">Desconectar</button>
              ) : isMessenger ? (
                <button onClick={connectMeta} className="px-4 py-2 rounded-xl bg-[#3CBDB9] text-[#0B1117] text-sm font-semibold hover:bg-[#3CBDB9]/90">Conectar</button>
              ) : isDisabled ? (
                <button onClick={() => setWaitlistOpen(true)} className="px-4 py-2 rounded-xl border border-white/15 text-sm font-medium text-white/80 hover:bg-white/10">Lista de espera</button>
              ) : (
                <button onClick={() => setGuideOpen(integration.key)} className="px-4 py-2 rounded-xl border border-white/15 text-sm font-medium text-white/80 hover:bg-white/10">Ver guía</button>
              )}
            </div>
            {isMessenger && orgIntegration.meta_page_id && (
              <div className="mt-3 text-xs text-white/40">Page: {orgIntegration.meta_page_id.slice(0, 8)}... {orgIntegration.meta_connected_at && `• ${new Date(orgIntegration.meta_connected_at).toLocaleDateString()}`}</div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderClinica = () => (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <label className="block text-xs font-medium text-white/60 mb-2">Nombre de la clínica</label>
        <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-[#3CBDB9]/50" placeholder="Ej: Clínica Sonrisas" />
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-white/60 mb-2">Teléfono</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-[#3CBDB9]/50" placeholder="+504 9999-9999" />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/60 mb-2">Google Maps URL</label>
            <input value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-[#3CBDB9]/50" placeholder="Pega el link" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-white/60 mb-2">Dirección</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-[#3CBDB9]/50" placeholder="Colonia, calle, ciudad" />
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm font-medium text-white mb-3">Especialidades</div>
        <div className="grid grid-cols-2 gap-2">
          {SPECIALTIES.map((s) => {
            const checked = specialties.includes(s.value);
            return (
              <button key={s.value} onClick={() => setSpecialties(prev => checked ? prev.filter(x => x !== s.value) : [...prev, s.value])}
                className={`flex items-center justify-between px-3 py-2 rounded-xl border text-sm ${checked ? "border-[#3CBDB9]/40 bg-[#3CBDB9]/10 text-[#3CBDB9]" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}>
                <span>{s.label}</span>
                {checked && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderHorario = () => (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
      {Object.entries(dayLabels).map(([k, label]) => {
        const d = hours[k] ?? { closed: true };
        return (
          <div key={k} className="flex flex-col md:flex-row md:items-center justify-between gap-3 py-3 border-b border-white/5 last:border-0">
            <div className="flex items-center justify-between md:w-40">
              <span className="font-medium text-white">{label}</span>
              <Toggle enabled={!d.closed} onChange={(open) => setHours(prev => ({ ...prev, [k]: open ? { closed: false, open: d.open ?? "08:00", close: d.close ?? "17:00" } : { closed: true } }))} />
            </div>
            {!d.closed && (
              <div className="flex items-center gap-2">
                <input type="time" value={d.open ?? "08:00"} onChange={(e) => setHours(prev => ({ ...prev, [k]: { ...d, open: e.target.value } }))} className="h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm" />
                <span className="text-white/50">a</span>
                <input type="time" value={d.close ?? "17:00"} onChange={(e) => setHours(prev => ({ ...prev, [k]: { ...d, close: e.target.value } }))} className="h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm" />
              </div>
            )}
            {d.closed && <span className="text-sm text-white/50">Cerrado</span>}
          </div>
        );
      })}
    </div>
  );

  const renderServicios = () => (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-medium text-white">Servicios y precios</div>
        <button onClick={() => setServices(prev => [...prev, { name: "Nuevo servicio", price_from: null, currency: "HNL", duration_min: 30, notes: "" }])} className="px-3 py-1.5 rounded-lg bg-white/10 text-sm font-medium text-white/80 hover:bg-white/15">+ Agregar</button>
      </div>
      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
        {services.map((s, idx) => (
          <div key={idx} className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-3">
            <div className="flex gap-2">
              <input value={s.name} onChange={(e) => setServices(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} className="flex-1 h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm" placeholder="Nombre" />
              <button onClick={() => setServices(prev => prev.filter((_, i) => i !== idx))} className="w-10 h-10 flex items-center justify-center rounded-lg border border-white/10 text-white/50 hover:bg-white/10"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" value={s.price_from ?? ""} onChange={(e) => setServices(prev => prev.map((x, i) => i === idx ? { ...x, price_from: e.target.value ? Number(e.target.value) : null } : x))} className="h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm" placeholder="Desde" />
              <input type="number" value={s.price_to ?? ""} onChange={(e) => setServices(prev => prev.map((x, i) => i === idx ? { ...x, price_to: e.target.value ? Number(e.target.value) : null } : x))} className="h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm" placeholder="Hasta" />
              <input type="number" value={s.duration_min ?? 30} onChange={(e) => setServices(prev => prev.map((x, i) => i === idx ? { ...x, duration_min: Number(e.target.value) } : x))} className="h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm" placeholder="Min" />
            </div>
            <input value={s.notes ?? ""} onChange={(e) => setServices(prev => prev.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))} className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm" placeholder="Notas" />
          </div>
        ))}
      </div>
    </div>
  );

  const renderFaqs = () => (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium text-white">Respuestas rápidas (FAQs)</div>
          <button onClick={() => setFaqs(prev => [...prev, { q: "", a: "" }])} className="px-3 py-1.5 rounded-lg bg-white/10 text-sm font-medium text-white/80 hover:bg-white/15">+ Agregar</button>
        </div>
        <div className="max-h-[400px] overflow-y-auto space-y-3 pr-1">
          {faqs.map((f, idx) => (
            <div key={idx} className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
              <div className="flex gap-2">
                <input value={f.q} onChange={(e) => setFaqs(prev => prev.map((x, i) => i === idx ? { ...x, q: e.target.value } : x))} className="flex-1 h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm" placeholder="Pregunta" />
                <button onClick={() => setFaqs(prev => prev.filter((_, i) => i !== idx))} className="w-10 h-10 flex items-center justify-center rounded-lg border border-white/10 text-white/50 hover:bg-white/10"><X className="h-4 w-4" /></button>
              </div>
              <textarea value={f.a} onChange={(e) => setFaqs(prev => prev.map((x, i) => i === idx ? { ...x, a: e.target.value } : x))} className="w-full min-h-[80px] px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm resize-y" placeholder="Respuesta" />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="font-medium text-white">Políticas</div>
        <div>
          <label className="block text-xs text-white/50 mb-2">Urgencias</label>
          <textarea value={emergency} onChange={(e) => setEmergency(e.target.value)} className="w-full min-h-[60px] px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm resize-y" />
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-2">Cancelación</label>
          <input value={policiesCancel} onChange={(e) => setPoliciesCancel(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm" />
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-2">Depósitos</label>
          <input value={policiesDeposit} onChange={(e) => setPoliciesDeposit(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm" />
        </div>
      </div>
    </div>
  );

  if (loading) return <div className="py-20 text-center text-white/50">Cargando...</div>;

  return (
    <div className="space-y-4">
      <PageHeader title="Configuración" subtitle="Gestiona tu clínica, horarios, servicios e integraciones." showBackOnMobile backTo="/overview"
        action={<button onClick={save} disabled={saving || !isDirty} className={`px-4 py-2 rounded-xl text-sm font-semibold ${isDirty ? "bg-[#3CBDB9] text-[#0B1117]" : "bg-white/10 text-white/40"}`}>{saving ? "Guardando..." : isDirty ? "Guardar" : "Guardado"}</button>}
      />

      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium ${tab === t.key ? "bg-white/10 text-white" : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "integraciones" && renderIntegrations()}
      {tab === "clinica" && renderClinica()}
      {tab === "horario" && renderHorario()}
      {tab === "servicios" && renderServicios()}
      {tab === "faqs" && renderFaqs()}

      <Modal open={guideOpen !== null} title="Guía de integración" description="Pasos para conectar." onClose={() => setGuideOpen(null)} actions={<button onClick={() => setGuideOpen(null)} className="rounded-xl bg-[#3CBDB9] px-4 py-2 text-sm font-medium text-white hover:bg-[#35a9a5]">Entendido</button>}>
        <div className="space-y-3 text-sm text-white/70">
          <div className="flex items-start gap-3"><Globe className="h-4 w-4 mt-0.5" /><span>Confirma los datos de tu clínica.</span></div>
          <div className="flex items-start gap-3"><PhoneCall className="h-4 w-4 mt-0.5" /><span>Ten a mano el canal principal.</span></div>
          <div className="flex items-start gap-3"><BadgeCheck className="h-4 w-4 mt-0.5" /><span>Envía la solicitud.</span></div>
        </div>
      </Modal>

      <Modal open={waitlistOpen} title="Lista de espera" description="Te avisamos cuando esté disponible." onClose={() => setWaitlistOpen(false)} actions={<><button onClick={() => setWaitlistOpen(false)} className="px-4 py-2 rounded-xl border border-white/15 text-sm font-medium text-white/80">Cancelar</button><button onClick={submitWaitlist} className="px-4 py-2 rounded-xl bg-[#3CBDB9] text-[#0B1117] text-sm font-semibold">Unirme</button></>}>
        <input value={waitlistEmail} onChange={(e) => setWaitlistEmail(e.target.value)} className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm" placeholder="tu@email.com" />
      </Modal>

      <Toast open={!!toast} kind={toast?.kind} message={toast?.message ?? ""} onClose={() => setToast(null)} />
    </div>
  );
}
