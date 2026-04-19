import WhatsAppConnect from "../components/WhatsAppConnect";
// src/pages/Settings.tsx - DARK THEME
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BadgeCheck, CalendarDays, Globe, Instagram, Lock, MessageCircle, MessagesSquare, PhoneCall, Check, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { Toggle } from "../components/Toggle";
import { BotKillSwitch } from "../components/BotKillSwitch";
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

type OrgIntegrationState = {
  meta_page_id: string | null;
  messenger_enabled: boolean | null;
  meta_connected_at: string | null;
  meta_last_error: string | null;
  whatsapp_enabled: boolean | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
};

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

type TabKey = "integraciones" | "clinica" | "equipo" | "equipo" | "equipo" | "horario" | "servicios" | "faqs" | "cuenta";

const INTEGRATIONS = [
  { key: "messenger" as const, name: "Messenger", description: "Centraliza mensajes de Facebook.", icon: MessagesSquare },
  { key: "instagram" as const, name: "Instagram", description: "Responde desde Instagram.", icon: Instagram },
  { key: "whatsapp" as const, name: "WhatsApp (Próximamente)", description: "Integración en proceso. Se activa con tu mismo número.", icon: MessageCircle },
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

  const [clinicName, setClinicName] = useState(clinic?.name ?? "Clínica");
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

  const [doctors, setDoctors] = useState<any[]>([]);
  async function fetchDoctors() {
    const { data } = await supabase.from('providers').select('*').eq('organization_id', ORG).eq('role', 'doctor');
    if (data) setDoctors(data);
  }

  const [orgIntegration, setOrgIntegration] = useState<OrgIntegrationState>({
    meta_page_id: null,
    messenger_enabled: false,
    meta_connected_at: null,
    meta_last_error: null,
    whatsapp_enabled: false,
    whatsapp_phone_number_id: null,
    whatsapp_business_account_id: null,
  });
  const [guideOpen, setGuideOpen] = useState<string | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

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
    const res = await supabase
      .from("org_settings")
      .select("meta_page_id, messenger_enabled, meta_connected_at, meta_last_error, whatsapp_enabled, whatsapp_phone_number_id, whatsapp_business_account_id")
      .eq("organization_id", ORG)
      .limit(1);
    if (!res.error && res.data?.[0]) {
      const s = res.data[0] as any;
      setOrgIntegration({
        meta_page_id: s.meta_page_id ?? null,
        messenger_enabled: s.messenger_enabled ?? false,
        meta_connected_at: s.meta_connected_at ?? null,
        meta_last_error: s.meta_last_error ?? null,
        whatsapp_enabled: s.whatsapp_enabled ?? false,
        whatsapp_phone_number_id: s.whatsapp_phone_number_id ?? null,
        whatsapp_business_account_id: s.whatsapp_business_account_id ?? null,
      });
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
  useEffect(() => { if (!loading) setInitialSnapshot((prev) => prev ?? settingsSnapshot); }, [loading, settingsSnapshot]);
  const isDirty = initialSnapshot !== null && initialSnapshot !== settingsSnapshot;

  async function save() {
    if (!isDirty) return;
    setSaving(true);
    const id = await ensureClinic();
    if (!id) { setToast({ kind: "error", message: "No se pudo guardar." }); setSaving(false); return; }
    const payload: ClinicSettingsRow = { clinic_id: id, phone: phone.trim() || null, address: address.trim() || null, google_maps_url: mapsUrl.trim() || null, hours, services, faqs, emergency: emergency.trim() || null, policies: { cancelacion: policiesCancel.trim(), deposito: policiesDeposit.trim() }, specialties, updated_at: new Date().toISOString() };
    const res = await supabase.from("clinic_settings").upsert(payload, { onConflict: "clinic_id" });
    if (res.error) { setToast({ kind: "error", message: "Error al guardar." }); } else { await supabase.from("clinics").update({ name: clinicName.trim() }).eq("id", id); setToast({ kind: "success", message: "Guardado." }); setInitialSnapshot(settingsSnapshot); }
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

  async function savePassword() {
    if (!newPassword.trim()) { setToast({ kind: "error", message: "Ingresa una contraseña." }); return; }
    if (newPassword.length < 8) { setToast({ kind: "error", message: "Mínimo 8 caracteres." }); return; }
    if (newPassword !== confirmPassword) { setToast({ kind: "error", message: "Las contraseñas no coinciden." }); return; }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { setToast({ kind: "error", message: "Error al cambiar contraseña." }); }
    else { setToast({ kind: "success", message: "Contraseña actualizada." }); setNewPassword(""); setConfirmPassword(""); }
    setSavingPassword(false);
  }

  function statusFor(channel: string) {
    if (channel === "google_calendar") return { label: "Próximamente", status: "disconnected" as const, disabled: true };
    if (channel === "messenger") {
      const connected = !!orgIntegration.meta_page_id && orgIntegration.messenger_enabled;
      return { label: connected ? "Conectado" : "No conectado", status: connected ? "connected" as const : "disconnected" as const, disabled: false };
    }
    if (channel === "whatsapp") {
      const connected = !!orgIntegration.whatsapp_phone_number_id && !!orgIntegration.whatsapp_business_account_id && orgIntegration.whatsapp_enabled;
      return { label: connected ? "Conectado" : "No conectado", status: connected ? "connected" as const : "warning" as const, disabled: false };
    }
    return { label: "No conectado", status: "disconnected" as const, disabled: false };
  }

  const tabs = [
    { key: "integraciones" as const, label: "Integraciones" },
    { key: "clinica" as const, label: "Clínica" },
    { key: "horario" as const, label: "Horario" },
    { key: "servicios" as const, label: "Servicios" },
    { key: "equipo" as const, label: "Equipo" },
    { key: "faqs" as const, label: "FAQs" },
    { key: "cuenta" as const, label: "Cuenta" },
  ];

  const renderIntegrations = () => (
    <div className="space-y-4">
      <BotKillSwitch orgId={ORG} />
      {INTEGRATIONS.map((integration) => {
        const status = statusFor(integration.key);
        const Icon = integration.icon;
        const isMessenger = integration.key === "messenger";
        const isWhatsApp = integration.key === "whatsapp";
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
              ) : isWhatsApp && status.status !== "connected" ? (
                <WhatsAppConnect organizationId={ORG} onConnected={() => loadSettings()} />
              ) : isDisabled ? (
                <button onClick={() => setWaitlistOpen(true)} className="px-4 py-2 rounded-xl border border-white/15 text-sm font-medium text-white/80 hover:bg-white/10">Lista de espera</button>
              ) : (
                <button onClick={() => setGuideOpen(integration.key)} className="px-4 py-2 rounded-xl border border-white/15 text-sm font-medium text-white/80 hover:bg-white/10">Ver guía</button>
              )}
            </div>
            {isMessenger && orgIntegration.meta_page_id && (
              <div className="mt-3 text-xs text-white/40">Page: {orgIntegration.meta_page_id.slice(0, 8)}... {orgIntegration.meta_connected_at && `• ${new Date(orgIntegration.meta_connected_at).toLocaleDateString()}`}</div>
            )}
            {isWhatsApp && orgIntegration.whatsapp_phone_number_id && (
              <div className="mt-3 text-xs text-white/40">Phone ID: {orgIntegration.whatsapp_phone_number_id.slice(0, 8)}... {orgIntegration.whatsapp_business_account_id && `• WABA ${orgIntegration.whatsapp_business_account_id.slice(0, 8)}...`}</div>
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

  const renderCuenta = () => (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 border border-white/10">
            <Lock className="h-5 w-5 text-white/70" />
          </div>
          <div>
            <div className="font-semibold text-white">Cambiar contraseña</div>
            <div className="text-sm text-white/50">Actualiza tu contraseña de acceso.</div>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-white/60 mb-2">Nueva contraseña</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-[#3CBDB9]/50" placeholder="Mínimo 8 caracteres" />
        </div>
        <div>
          <label className="block text-xs font-medium text-white/60 mb-2">Confirmar contraseña</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-[#3CBDB9]/50" placeholder="Repite la contraseña" />
        </div>
        <button onClick={savePassword} disabled={savingPassword || !newPassword.trim()} className={`px-4 py-2 rounded-xl text-sm font-semibold ${newPassword.trim() ? "bg-[#3CBDB9] text-[#0B1117] hover:bg-[#3CBDB9]/90" : "bg-white/10 text-white/40"}`}>
          {savingPassword ? "Guardando..." : "Cambiar contraseña"}
        </button>
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
      
        {tab === "equipo" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-medium text-white">Equipo Médico</h3>
                <p className="text-sm text-zinc-400">Doctores, servicios que atienden y horarios.</p>
              </div>
              <button onClick={async () => {
                const name = prompt("Nombre del doctor (ej: Dr. García):");
                if (!name?.trim()) return;
                const { error } = await supabase.from("providers").insert({
                  organization_id: ORG, name: name.trim(), role: "doctor", active: true,
                  services: [], schedule: {"mon":{"open":"08:00","close":"17:00"},"tue":{"open":"08:00","close":"17:00"},"wed":{"open":"08:00","close":"17:00"},"thu":{"open":"08:00","close":"17:00"},"fri":{"open":"08:00","close":"17:00"},"sat":{"closed":true},"sun":{"closed":true}},
                  color: "#" + Math.floor(Math.random()*16777215).toString(16).padStart(6,"0"),
                });
                if (!error) { const { data } = await supabase.from("providers").select("*").eq("organization_id", ORG).eq("role", "doctor"); setDoctors(data || []); }
              }} className="bg-[#3CBDB9] hover:bg-[#35a9a5] text-white px-4 py-2 rounded-xl text-sm font-medium">
                + Agregar Doctor
              </button>
            </div>
            <div className="space-y-4">
              {doctors.length === 0 ? (
                <div className="py-10 text-center border-2 border-dashed border-white/10 rounded-xl">
                  <p className="text-zinc-500">No hay doctores registrados. Agregá uno para empezar.</p>
                </div>
              ) : (
                doctors.map((doc) => {
                  const dayNames: Record<string,string> = {"mon":"Lunes","tue":"Martes","wed":"Miércoles","thu":"Jueves","fri":"Viernes","sat":"Sábado","sun":"Domingo"};
                  const sched = doc.schedule || {};
                  const svcs = Array.isArray(doc.services) ? doc.services : [];
                  return (
                  <div key={doc.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{backgroundColor: doc.color || "#3CBDB9"}} />
                        <h3 className="text-white font-medium text-lg">{doc.name}</h3>
                        <span className="text-xs text-zinc-400 bg-white/5 px-2 py-1 rounded-lg">{doc.specialty || "General"}</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          if (!confirm("¿Eliminar a " + doc.name + "?")) return;
                          await supabase.from("providers").delete().eq("id", doc.id);
                          const { data } = await supabase.from("providers").select("*").eq("organization_id", ORG).eq("role", "doctor");
                          setDoctors(data || []);
                        }} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg border border-red-500/20">Eliminar</button>
                      </div>
                    </div>
                    
                    <div className="mb-4">
                      <div className="text-xs text-zinc-400 mb-2">Servicios que atiende</div>
                      <div className="flex flex-wrap gap-2">
                        {svcs.map((s: string) => (
                          <span key={s} className="text-xs bg-[#3CBDB9]/10 text-[#3CBDB9] px-3 py-1 rounded-full border border-[#3CBDB9]/20 flex items-center gap-1">
                            {s}
                            <button onClick={async () => {
                              const newSvcs = svcs.filter((x: string) => x !== s);
                              await supabase.from("providers").update({ services: newSvcs }).eq("id", doc.id);
                              const { data } = await supabase.from("providers").select("*").eq("organization_id", ORG).eq("role", "doctor");
                              setDoctors(data || []);
                            }} className="ml-1 text-zinc-400 hover:text-red-400">×</button>
                          </span>
                        ))}
                        <button onClick={async () => {
                          const svc = prompt("Nombre del servicio (ej: Blanqueamiento):");
                          if (!svc?.trim()) return;
                          const newSvcs = [...svcs, svc.trim()];
                          await supabase.from("providers").update({ services: newSvcs }).eq("id", doc.id);
                          const { data } = await supabase.from("providers").select("*").eq("organization_id", ORG).eq("role", "doctor");
                          setDoctors(data || []);
                        }} className="text-xs text-zinc-400 hover:text-white px-3 py-1 rounded-full border border-dashed border-white/20">+ Servicio</button>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-zinc-400 mb-2">Horario</div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {Object.entries(dayNames).map(([key, label]) => {
                          const day = sched[key] || { closed: true };
                          const isClosed = !!day.closed;
                          return (
                            <div key={key} className={"rounded-xl border p-2 text-center text-xs " + (isClosed ? "border-white/5 bg-white/[0.02] text-zinc-600" : "border-[#3CBDB9]/20 bg-[#3CBDB9]/5 text-zinc-300")}>
                              <div className="font-medium mb-1">{label}</div>
                              <button onClick={async () => {
                                const newSched = { ...sched };
                                if (isClosed) {
                                  const open = prompt(label + " — Hora de entrada (ej: 08:00):", "08:00");
                                  if (!open) return;
                                  const close = prompt(label + " — Hora de salida (ej: 17:00):", "17:00");
                                  if (!close) return;
                                  newSched[key] = { open, close, closed: false };
                                } else {
                                  const action = prompt("Opciones:\n1 = Cambiar horario\n2 = Marcar como cerrado\n\nEscribe 1 o 2:", "1");
                                  if (action === "2") {
                                    newSched[key] = { closed: true };
                                  } else if (action === "1") {
                                    const open = prompt(label + " — Hora de entrada:", day.open || "08:00");
                                    if (!open) return;
                                    const close = prompt(label + " — Hora de salida:", day.close || "17:00");
                                    if (!close) return;
                                    newSched[key] = { open, close, closed: false };
                                  } else { return; }
                                }
                                await supabase.from("providers").update({ schedule: newSched }).eq("id", doc.id);
                                const { data } = await supabase.from("providers").select("*").eq("organization_id", ORG).eq("role", "doctor");
                                setDoctors(data || []);
                              }} className="cursor-pointer">
                                {isClosed ? "Cerrado" : (day.open + " - " + day.close)}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {tab === "faqs" && renderFaqs()}
      {tab === "cuenta" && renderCuenta()}

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