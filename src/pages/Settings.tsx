import WhatsAppConnect from "../components/WhatsAppConnect";
// src/pages/Settings.tsx - DARK THEME
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BadgeCheck, CalendarDays, Globe, Instagram, Lock, MessageCircle, MessagesSquare, PhoneCall, Check, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { useActiveOrg } from "../hooks/useActiveOrg";
import {
  getVerticalConfig,
  getVerticalDefaultServices,
  getVerticalDefaultSpecialties,
  getVerticalDefaultFaqs,
} from "../config/verticalConfig";
import { Toggle } from "../components/Toggle";
import { BotKillSwitch } from "../components/BotKillSwitch";
import { Modal } from "../components/ui/Modal";
import { Toast, type ToastKind } from "../components/ui/Toast";
import { startMetaOAuth } from "../components/integrations/ConnectMessengerButton";
import StatusChip from "../components/ui/StatusChip";
import PageHeader from "../components/PageHeader";
import { MobileAppHeader, MobileSettingsRow, MobileStatusPill } from "../components/mobile/MobilePrimitives";
import {
  BarberLineButton,
  BarberLineCard,
  BarberLineInput,
  BarberLineStatus,
  BarberLineTextarea,
} from "../components/barberline/BarberLineUI";

const DEFAULT_ORG = "clinic-demo";

type ServiceItem = { name: string; price_from?: number | null; price_to?: number | null; currency?: string; duration_min?: number | null; notes?: string; active?: boolean };
type FaqItem = { q: string; a: string };
type DayHours = { closed: boolean; open?: string; close?: string };
type HoursMap = Record<string, DayHours>;

type OrganizationSettingsRow = {
  organization_id: string;
  business_type: string;
  services: ServiceItem[] | null;
  faqs: FaqItem[] | null;
  specialties: string[] | null;
  hours: any;
  providers: any[] | null;
  policies: any;
  location: Record<string, unknown> | null;
  integrations: Record<string, unknown> | null;
  updated_at: string | null;
};

type OrgIntegrationState = {
  meta_page_id: string | null;
  messenger_enabled: boolean | null;
  meta_connected_at: string | null;
  meta_last_error: string | null;
  whatsapp_enabled: boolean | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
};

function defaultHours(): HoursMap {
  return { mon: { closed: false, open: "08:00", close: "17:00" }, tue: { closed: false, open: "08:00", close: "17:00" }, wed: { closed: false, open: "08:00", close: "17:00" }, thu: { closed: false, open: "08:00", close: "17:00" }, fri: { closed: false, open: "08:00", close: "17:00" }, sat: { closed: false, open: "09:00", close: "13:00" }, sun: { closed: true } };
}

const dayLabels: Record<string, string> = { mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado", sun: "Domingo" };
const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const BARBERLINE_FALLBACK_SERVICES: ServiceItem[] = [
  { name: "Corte de pelo", price_from: 250, currency: "HNL", duration_min: 30, active: true },
  { name: "Corte y barba", price_from: 400, currency: "HNL", duration_min: 45, active: true },
  { name: "Barba", price_from: 180, currency: "HNL", duration_min: 20, active: true },
  { name: "Limpieza facial", price_from: 350, currency: "HNL", duration_min: 40, active: true },
];

function providerScheduleFromBusinessHours(sourceHours: HoursMap): HoursMap {
  const defaults = defaultHours();
  return dayKeys.reduce((acc, key) => {
    const day = sourceHours[key] ?? defaults[key];
    acc[key] = day?.closed
      ? { closed: true }
      : { closed: false, open: day?.open ?? "09:00", close: day?.close ?? "18:00" };
    return acc;
  }, {} as HoursMap);
}

function normalizeProviderForSave(provider: any, orgId: string, sourceHours: HoursMap) {
  const schedule = provider.schedule && typeof provider.schedule === "object"
    ? provider.schedule
    : providerScheduleFromBusinessHours(sourceHours);
  return {
    id: provider.id,
    organization_id: orgId,
    name: String(provider.name ?? "").trim(),
    role: provider.role ?? "doctor",
    active: provider.active !== false,
    services: Array.isArray(provider.services) ? provider.services : [],
    schedule,
    color: provider.color ?? provider.calendar_color ?? "#3CBDB9",
  };
}

function normalizeForCompare(text: string) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isLikelyDentalCatalog(items: ServiceItem[]): boolean {
  if (!items.length) return false;
  const names = items.map((item) => normalizeForCompare(item.name ?? ""));
  const dentalSignals = ["consulta", "limpieza", "blanqueamiento", "ortodoncia", "resina", "extraccion"];
  return names.some((name) => dentalSignals.some((signal) => name.includes(signal)));
}

function barberDisplayName(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "BarberLine";
  if (/\b(cl[ií]nica|sonrisas|dentalconnect|dental demo|dental)\b/i.test(raw)) return "BarberLine";
  return raw;
}

function barberServiceDisplayLabel(value: string): string {
  const raw = String(value ?? "").trim();
  const map: Record<string, string> = {
    corte: "Corte",
    corte_barba: "Corte y barba",
    corte_solo: "Corte de pelo",
    limpieza_facial: "Limpieza facial",
    corte_limpieza: "Corte y limpieza",
    cejas: "Cejas",
  };
  if (map[raw]) return map[raw];
  if (!raw) return "Servicio";
  if (isLikelyDentalCatalog([{ name: raw }])) return "Servicio BarberLine";
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

type TabKey = "integraciones" | "clinica" | "equipo" | "horario" | "servicios" | "faqs" | "cuenta";

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
  const { resolvedOrgId, resolvedBusinessType } = useActiveOrg();
  const ORG = resolvedOrgId || activeOrgId || clinic?.organization_id || DEFAULT_ORG;
  const vertical = getVerticalConfig(resolvedBusinessType);
  const isBarbershop = resolvedBusinessType === "barbershop";

  const [tab, setTab] = useState<TabKey>("integraciones");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);

  const [clinicName, setClinicName] = useState(clinic?.name ?? vertical.organizationLabel);
  const [specialties, setSpecialties] = useState<string[]>(
    getVerticalDefaultSpecialties(resolvedBusinessType).map((item) => item.value),
  );
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [hours, setHours] = useState<HoursMap>(defaultHours());
  const [services, setServices] = useState<ServiceItem[]>(getVerticalDefaultServices(resolvedBusinessType));
  const [editingServiceIndex, setEditingServiceIndex] = useState<number | null>(null);
  const [faqs, setFaqs] = useState<FaqItem[]>(getVerticalDefaultFaqs(resolvedBusinessType));
  const [emergency, setEmergency] = useState("Si es urgencia, cuéntanos síntomas.");
  const [policiesCancel, setPoliciesCancel] = useState("Avisa con 2 horas de anticipación.");
  const [policiesDeposit, setPoliciesDeposit] = useState(
    resolvedBusinessType === "barbershop" ? "Algunos servicios requieren depósito." : "Algunos tratamientos requieren depósito.",
  );

  const [doctors, setDoctors] = useState<any[]>([]);
  const [deletedProviderIds, setDeletedProviderIds] = useState<string[]>([]);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  async function loadDoctorsForOrg() {
    const { data } = await supabase.from("providers").select("*").eq("organization_id", ORG).eq("role", "doctor");
    return data ?? [];
  }
  async function fetchDoctors() {
    const data = await loadDoctorsForOrg();
    if (data.length > 0) setDoctors(data);
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

  const defaultServices = useMemo(() => getVerticalDefaultServices(resolvedBusinessType), [resolvedBusinessType]);
  const defaultFaqs = useMemo(() => getVerticalDefaultFaqs(resolvedBusinessType), [resolvedBusinessType]);
  const defaultSpecialties = useMemo(
    () => getVerticalDefaultSpecialties(resolvedBusinessType).map((item) => item.value),
    [resolvedBusinessType],
  );

  useEffect(() => {
    setServices(defaultServices);
    setFaqs(defaultFaqs);
    setSpecialties(defaultSpecialties);
    setHours(defaultHours());
    setPhone("");
    setAddress("");
    setMapsUrl("");
    setDoctors([]);
    setDeletedProviderIds([]);
    setEditingProviderId(null);
    setInitialSnapshot(null);
  }, [ORG, resolvedBusinessType, defaultServices, defaultFaqs, defaultSpecialties]);

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

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const s = await supabase
        .from("organization_settings")
        .select("organization_id, business_type, services, faqs, specialties, hours, providers, policies, location, integrations")
        .eq("organization_id", ORG)
        .maybeSingle();
      if (!mounted) return;
      const row = s.data as OrganizationSettingsRow | null;
      const providerRows = await loadDoctorsForOrg();
      if (row) {
        const location = (row.location ?? {}) as Record<string, unknown>;
        setPhone(String(location.phone ?? ""));
        setAddress(String(location.address ?? ""));
        setMapsUrl(String(location.google_maps_url ?? ""));
        setHours((row.hours as HoursMap) ?? defaultHours());
        const pol = row.policies ?? {};
        setPoliciesCancel(pol.cancelacion ?? policiesCancel);
        setPoliciesDeposit(pol.deposito ?? policiesDeposit);
        if (row.services?.length) setServices(row.services);
        else setServices(defaultServices);
        if (row.faqs?.length) setFaqs(row.faqs);
        else setFaqs(defaultFaqs);
        if (Array.isArray(row.specialties) && row.specialties.length) setSpecialties(row.specialties);
        else setSpecialties(defaultSpecialties);
        if (providerRows.length > 0) setDoctors(providerRows);
        else if (Array.isArray(row.providers)) setDoctors(row.providers);
      } else {
        setServices(defaultServices);
        setFaqs(defaultFaqs);
        setSpecialties(defaultSpecialties);
        setDoctors(providerRows);
      }
      await loadOrgIntegration();
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [ORG, resolvedBusinessType, vertical.organizationLabel, defaultServices, defaultFaqs, defaultSpecialties]);

  const showBarbershopCatalogReset = useMemo(() => {
    return resolvedBusinessType === "barbershop" && isLikelyDentalCatalog(services);
  }, [resolvedBusinessType, services]);

  async function resetCurrentVerticalDemoData() {
    const confirmed = window.confirm(`Reset data for ${ORG} (${resolvedBusinessType})?`);
    if (!confirmed) return;
    const servicesDefaults = getVerticalDefaultServices(resolvedBusinessType);
    const faqDefaults = getVerticalDefaultFaqs(resolvedBusinessType);
    const specialtyDefaults = getVerticalDefaultSpecialties(resolvedBusinessType).map((item) => item.value);
    const now = new Date().toISOString();

    if (import.meta.env.DEV) {
      console.log("[settings:reset_demo]", {
        activeOrgId: ORG,
        activeBusinessType: resolvedBusinessType,
        clinicId,
        tableTarget: "organization_settings",
        services: servicesDefaults.map((s) => s.name),
      });
    }
    const payload: OrganizationSettingsRow = {
      organization_id: ORG,
      business_type: resolvedBusinessType,
      hours,
      services: servicesDefaults,
      faqs: faqDefaults,
      providers: doctors,
      policies: { cancelacion: policiesCancel.trim(), deposito: policiesDeposit.trim() },
      specialties: specialtyDefaults,
      location: {
        phone: phone.trim() || null,
        address: address.trim() || null,
        google_maps_url: mapsUrl.trim() || null,
      },
      integrations: {},
      updated_at: now,
    };

    const res = await supabase
      .from("organization_settings")
      .upsert(payload, { onConflict: "organization_id" });
    const upsertErr = res.error;
    if (upsertErr && import.meta.env.DEV) {
      console.error("[settings:reset_demo:organization_settings_error]", {
        activeOrgId: ORG,
        activeBusinessType: resolvedBusinessType,
        code: (upsertErr as any).code ?? null,
        message: upsertErr.message,
        details: (upsertErr as any).details ?? null,
        hint: (upsertErr as any).hint ?? null,
        payload,
      });
    }
    if (upsertErr) {
      setToast({ kind: "error", message: "No se pudo resetear los datos demo de la vertical actual." });
      return;
    }

    setServices(servicesDefaults);
    setFaqs(faqDefaults);
    setSpecialties(specialtyDefaults);
    setHours(defaultHours());
    setDoctors([]);
    const postResetSnapshot = JSON.stringify({
      clinicName,
      specialties: specialtyDefaults,
      phone,
      address,
      mapsUrl,
      hours,
      services: servicesDefaults,
      faqs: faqDefaults,
      emergency,
      policiesCancel,
      policiesDeposit,
    });
    setInitialSnapshot(postResetSnapshot);
    setToast({ kind: "success", message: "Datos demo de la vertical actual aplicados." });
  }

  function updateDoctor(providerId: string, updater: (provider: any) => any) {
    setDoctors((prev) => prev.map((provider) => {
      if (provider.id !== providerId) return provider;
      return updater({ ...provider });
    }));
  }

  function updateDoctorSchedule(providerId: string, dayKey: string, updater: (day: DayHours) => DayHours) {
    updateDoctor(providerId, (provider) => {
      const currentSchedule = provider.schedule && typeof provider.schedule === "object" ? provider.schedule : {};
      const currentDay = (currentSchedule[dayKey] as DayHours | undefined) ?? { closed: true };
      return {
        ...provider,
        schedule: {
          ...currentSchedule,
          [dayKey]: updater({ ...currentDay }),
        },
      };
    });
  }

  const settingsSnapshot = useMemo(() => JSON.stringify({ clinicName, specialties, phone, address, mapsUrl, hours, services, faqs, doctors, emergency, policiesCancel, policiesDeposit }), [clinicName, specialties, phone, address, mapsUrl, hours, services, faqs, doctors, emergency, policiesCancel, policiesDeposit]);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  useEffect(() => { if (!loading) setInitialSnapshot((prev) => prev ?? settingsSnapshot); }, [loading, settingsSnapshot]);
  const isDirty = (initialSnapshot !== null && initialSnapshot !== settingsSnapshot) || deletedProviderIds.length > 0;

  async function save() {
    if (!isDirty) return;
    setSaving(true);
    const normalizedDoctors = doctors.map((provider) => normalizeProviderForSave(provider, ORG, hours));
    let savedDoctors = normalizedDoctors;
    if (deletedProviderIds.length > 0) {
      for (const providerId of deletedProviderIds) {
        const deleteRes = await supabase.from("providers").delete().eq("id", providerId);
        if (deleteRes.error) {
          setToast({ kind: "error", message: `Error al eliminar proveedor: ${deleteRes.error.message}` });
          setSaving(false);
          return;
        }
      }
    }
    if (normalizedDoctors.length > 0) {
      const providerRes = await supabase
        .from("providers")
        .upsert(normalizedDoctors, { onConflict: "id" })
        .select("*");
      if (providerRes.error) {
        setToast({ kind: "error", message: `Error al guardar proveedores: ${providerRes.error.message}` });
        setSaving(false);
        return;
      }
      savedDoctors = providerRes.data?.length ? providerRes.data : normalizedDoctors;
      setDoctors(savedDoctors);
    }
    const payload: OrganizationSettingsRow = {
      organization_id: ORG,
      business_type: resolvedBusinessType,
      services,
      faqs,
      specialties,
      hours,
      providers: savedDoctors,
      policies: { cancelacion: policiesCancel.trim(), deposito: policiesDeposit.trim() },
      location: {
        phone: phone.trim() || null,
        address: address.trim() || null,
        google_maps_url: mapsUrl.trim() || null,
      },
      integrations: {},
      updated_at: new Date().toISOString(),
    };
    if (import.meta.env.DEV) {
      console.log("[settings:save]", {
        activeOrgId: ORG,
        activeBusinessType: resolvedBusinessType,
        clinicId,
        tableTarget: "providers + organization_settings",
        services: services.map((s) => s.name),
        providers: savedDoctors.map((p) => p.name),
      });
    }
    const res = await supabase
      .from("organization_settings")
      .upsert(payload, { onConflict: "organization_id" });
    if (res.error) {
      setToast({ kind: "error", message: `Error al guardar: ${res.error.message}` });
    } else {
      setToast({ kind: "success", message: "Guardado." });
      setDeletedProviderIds([]);
      setInitialSnapshot(JSON.stringify({ clinicName, specialties, phone, address, mapsUrl, hours, services, faqs, doctors: savedDoctors, emergency, policiesCancel, policiesDeposit }));
    }
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

  const tabs = useMemo(() => [
    { key: "integraciones" as const, label: "Integraciones" },
    { key: "clinica" as const, label: vertical.organizationLabel },
    { key: "horario" as const, label: vertical.scheduleLabel },
    { key: "servicios" as const, label: vertical.servicesLabel },
    { key: "equipo" as const, label: vertical.providersLabel },
    { key: "faqs" as const, label: "FAQs" },
    { key: "cuenta" as const, label: "Cuenta" },
  ], [vertical]);

  useEffect(() => {
    const rawTab = new URLSearchParams(location.search).get("tab");
    const requestedTab = (rawTab === "barberos" ? "equipo" : rawTab) as TabKey | null;
    if (requestedTab && tabs.some((item) => item.key === requestedTab)) {
      setTab(requestedTab);
    }
  }, [location.search, tabs]);

  const renderIntegrations = () => (
    <div className={`space-y-4 ${isBarbershop ? "text-[#F0F4F8]" : ""}`}>
      <BotKillSwitch orgId={ORG} />
      {INTEGRATIONS.map((integration) => {
        const status = statusFor(integration.key);
        const Icon = integration.icon;
        const isMessenger = integration.key === "messenger";
        const isWhatsApp = integration.key === "whatsapp";
        const isDisabled = integration.key === "google_calendar";
        return (
          <div key={integration.key} className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 sm:h-10 sm:w-10">
                  <Icon className="h-5 w-5 text-white/70" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-white">{integration.name}</div>
                  <div className="text-sm text-white/50">{integration.description}</div>
                </div>
              </div>
              <StatusChip status={status.status} label={status.label} />
            </div>
            <div className="flex flex-wrap gap-2">
              {isMessenger && status.status === "connected" ? (
                <button onClick={disconnectMessenger} className="min-h-10 rounded-xl border border-white/15 px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 sm:px-4">Desconectar</button>
              ) : isMessenger ? (
                <button onClick={connectMeta} className="min-h-10 rounded-xl bg-[#3CBDB9] px-3 py-2 text-sm font-semibold text-[#0B1117] hover:bg-[#3CBDB9]/90 sm:px-4">Conectar</button>
              ) : isWhatsApp && status.status !== "connected" ? (
                <WhatsAppConnect organizationId={ORG} businessType={resolvedBusinessType} onConnected={() => void loadOrgIntegration()} />
              ) : isDisabled ? (
                <button onClick={() => setWaitlistOpen(true)} className="min-h-10 rounded-xl border border-white/15 px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 sm:px-4">Lista de espera</button>
              ) : (
                <button onClick={() => setGuideOpen(integration.key)} className="min-h-10 rounded-xl border border-white/15 px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 sm:px-4">Ver guía</button>
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

  const renderClinica = () => isBarbershop ? (
    <div className="space-y-4">
      <BarberLineCard className="p-4">
        <div className="mb-4">
          <div className="text-lg font-black text-[#F5F7FA]">Barbería</div>
          <p className="mt-1 text-sm text-[#6F7680]">Datos visibles para el equipo y la operación diaria.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Nombre</label>
            <BarberLineInput value={barberDisplayName(clinicName)} onChange={(e) => setClinicName(e.target.value)} placeholder="Ej: BarberLine Demo" />
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Teléfono</label>
            <BarberLineInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+504 9999-9999" />
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Google Maps URL</label>
            <BarberLineInput value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} placeholder="Pega el link" />
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Dirección</label>
            <BarberLineInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Colonia, calle, ciudad" />
          </div>
        </div>
      </BarberLineCard>
      <BarberLineCard className="p-4">
        <div className="mb-3 text-sm font-black text-[#F5F7FA]">Especialidades</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {getVerticalDefaultSpecialties(resolvedBusinessType).map((s) => {
            const checked = specialties.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setSpecialties(prev => checked ? prev.filter(x => x !== s.value) : [...prev, s.value])}
                className={`flex min-h-11 items-center justify-between rounded-xl border px-3 text-sm font-semibold transition ${checked ? "border-[#18C37E]/25 bg-[#18C37E]/10 text-[#18C37E]" : "border-[#252A30] bg-[#0A0C0F] text-[#8A9299] hover:text-[#F5F7FA]"}`}
              >
                <span>{s.label}</span>
                {checked ? <Check className="h-4 w-4" /> : null}
              </button>
            );
          })}
        </div>
      </BarberLineCard>
    </div>
  ) : (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <label className="block text-xs font-medium text-white/60 mb-2">Nombre de la {vertical.organizationLabel.toLowerCase()}</label>
        <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-[#3CBDB9]/50" placeholder={`Ej: ${vertical.organizationLabel} Demo`} />
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
          {getVerticalDefaultSpecialties(resolvedBusinessType).map((s) => {
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

  const renderHorario = () => isBarbershop ? (
    <BarberLineCard className="p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-lg font-black text-[#F5F7FA]">Horarios</div>
          <p className="mt-1 text-sm text-[#6F7680]">Días y horas de atención para WhatsApp y agenda.</p>
        </div>
        <BarberLineStatus label="Disponibilidad BarberLine" tone="success" />
      </div>
      <div className="mb-4 rounded-2xl border border-[#1E2228] bg-[#0A0C0F] p-3 text-sm text-[#8A9299]">
        Estos horarios se usan para mostrar disponibilidad en BarberLine.
      </div>
      <div className="space-y-2">
        {Object.entries(dayLabels).map(([k, label]) => {
          const d = hours[k] ?? { closed: true };
          return (
            <div key={k} className="grid gap-3 rounded-2xl border border-[#1E2228] bg-[#101317] p-3 md:grid-cols-[220px_1fr] md:items-center">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-bold text-[#F5F7FA]">{label}</span>
                  <div className={`mt-0.5 text-xs font-semibold ${d.closed ? "text-[#6F7680]" : "text-[#18C37E]"}`}>{d.closed ? "Cerrado" : "Abierto"}</div>
                </div>
                <Toggle enabled={!d.closed} onChange={(open) => setHours(prev => ({ ...prev, [k]: open ? { closed: false, open: d.open ?? "08:00", close: d.close ?? "17:00" } : { closed: true } }))} />
              </div>
              {!d.closed ? (
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <label className="min-w-0 text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">
                    Abre
                    <BarberLineInput className="mt-1" type="time" value={d.open ?? "08:00"} onChange={(e) => setHours(prev => ({ ...prev, [k]: { ...d, open: e.target.value } }))} />
                  </label>
                  <span className="text-xs font-bold text-[#4A5260]">a</span>
                  <label className="min-w-0 text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">
                    Cierra
                    <BarberLineInput className="mt-1" type="time" value={d.close ?? "17:00"} onChange={(e) => setHours(prev => ({ ...prev, [k]: { ...d, close: e.target.value } }))} />
                  </label>
                </div>
              ) : (
                <div className="rounded-xl border border-[#1E2228] bg-[#0A0C0F] px-3 py-2 text-sm font-semibold text-[#4A5260]">No se muestran horarios este día.</div>
              )}
            </div>
          );
        })}
      </div>
    </BarberLineCard>
  ) : (
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

  const formatServicePrice = (service: ServiceItem) => {
    const currency = service.currency ?? "HNL";
    const from = service.price_from;
    const to = service.price_to;
    if (from != null && to != null) return `${currency} ${from} - ${to}`;
    if (from != null) return `Desde ${currency} ${from}`;
    if (to != null) return `Hasta ${currency} ${to}`;
    return "Precio no definido";
  };

  const addService = () => {
    const nextIndex = services.length;
    setServices((prev) => [
      ...prev,
      { name: `Nuevo ${vertical.serviceLabel.toLowerCase()}`, price_from: null, currency: "HNL", duration_min: 30, notes: "", active: true } as ServiceItem,
    ]);
    setEditingServiceIndex(nextIndex);
  };

  const renderServiceEditor = (s: ServiceItem, idx: number) => (
    <div className="mt-3 rounded-2xl border border-[#25D366]/20 bg-[#0B1620] p-3">
      <div className="flex gap-2">
        <input value={s.name} onChange={(e) => setServices(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} className="flex-1 h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm" placeholder="Nombre" />
        <button onClick={() => { setServices(prev => prev.filter((_, i) => i !== idx)); setEditingServiceIndex(null); }} className="w-11 h-11 flex items-center justify-center rounded-xl border border-white/10 text-white/50 hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <input type="number" value={s.price_from ?? ""} onChange={(e) => setServices(prev => prev.map((x, i) => i === idx ? { ...x, price_from: e.target.value ? Number(e.target.value) : null } : x))} className="h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm" placeholder="Desde" />
        <input type="number" value={s.price_to ?? ""} onChange={(e) => setServices(prev => prev.map((x, i) => i === idx ? { ...x, price_to: e.target.value ? Number(e.target.value) : null } : x))} className="h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm" placeholder="Hasta" />
        <input type="number" value={s.duration_min ?? 30} onChange={(e) => setServices(prev => prev.map((x, i) => i === idx ? { ...x, duration_min: Number(e.target.value) } : x))} className="h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm" placeholder="Min" />
      </div>
      <input value={s.notes ?? ""} onChange={(e) => setServices(prev => prev.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))} className="mt-2 w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm" placeholder="Notas internas" />
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setServices(prev => prev.map((x, i) => i === idx ? { ...x, active: (x as any).active === false } as ServiceItem : x))}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10"
        >
          {(s as any).active === false ? "Activar" : "Desactivar"}
        </button>
        <button
          type="button"
          onClick={() => setEditingServiceIndex(null)}
          className="rounded-xl border border-[#25D366]/30 bg-[#25D366]/12 px-3 py-2 text-xs font-black text-[#BDF8D1] hover:bg-[#25D366]/18"
        >
          Listo
        </button>
      </div>
    </div>
  );

  const renderServicios = () => (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-black text-white">{vertical.servicesLabel}</div>
          {resolvedBusinessType === "barbershop" ? (
            <div className="mt-1 text-sm text-white/50">Precios, duración y estado de cada servicio.</div>
          ) : null}
        </div>
        <button onClick={addService} className="px-3 py-2 rounded-xl bg-white/10 text-sm font-semibold text-white/85 hover:bg-white/15">+ Agregar</button>
      </div>
      {import.meta.env.DEV && !isBarbershop ? (
        <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100">
          <div className="font-medium">
            {showBarbershopCatalogReset
              ? "Datos heredados de demo. Podés actualizarlos para esta organización."
              : "Podés restaurar los datos demo de la vertical actual."}
          </div>
          <div className="mt-1 text-amber-100/80">
            Reemplaza servicios, FAQs y especialidades por los valores por defecto de la vertical activa.
          </div>
          <button
            type="button"
            onClick={resetCurrentVerticalDemoData}
            className="mt-2 rounded-lg border border-amber-300/40 bg-amber-200/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-200/20"
          >
            Reset current vertical demo data
          </button>
        </div>
      ) : null}
      {import.meta.env.DEV && isBarbershop && showBarbershopCatalogReset ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3 text-sm text-[#A4AAB3]">
          <div className="font-medium text-[#F0F4F8]">Datos heredados de demo. Podés actualizarlos para esta barbería.</div>
          <button
            type="button"
            onClick={resetCurrentVerticalDemoData}
            className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-[#A4AAB3] hover:bg-white/[0.07]"
          >
            Restaurar servicios BarberLine
          </button>
        </div>
      ) : null}
      {resolvedBusinessType === "barbershop" ? (
        <div className="grid gap-3 md:grid-cols-2">
          {(showBarbershopCatalogReset ? BARBERLINE_FALLBACK_SERVICES : services).map((s, idx) => {
            const active = (s as any).active !== false;
            return (
              <div key={idx} className="rounded-2xl border border-white/10 bg-[#0B1620]/70 p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-black text-white">{barberServiceDisplayLabel(s.name) || "Servicio sin nombre"}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/72">{formatServicePrice(s)}</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/72">{s.duration_min ?? 30} min</span>
                      <span className={`rounded-full border px-2.5 py-1 font-bold ${active ? "border-[#25D366]/25 bg-[#25D366]/10 text-[#BDF8D1]" : "border-white/10 bg-white/5 text-white/45"}`}>
                        {active ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (showBarbershopCatalogReset) {
                        setServices(BARBERLINE_FALLBACK_SERVICES);
                        setEditingServiceIndex(idx);
                        return;
                      }
                      setEditingServiceIndex(editingServiceIndex === idx ? null : idx);
                    }}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/75 hover:bg-white/10"
                  >
                    Editar
                  </button>
                </div>
                {editingServiceIndex === idx ? renderServiceEditor(s, idx) : null}
              </div>
            );
          })}
        </div>
      ) : (
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
      )}
    </div>
  );

  const renderFaqs = () => isBarbershop ? (
    <div className="space-y-4">
      <BarberLineCard className="p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black text-[#F5F7FA]">FAQs</div>
            <p className="mt-1 text-sm text-[#6F7680]">Respuestas rápidas para WhatsApp.</p>
          </div>
          <BarberLineButton onClick={() => setFaqs(prev => [...prev, { q: "", a: "" }])}>Agregar</BarberLineButton>
        </div>
        <div className="space-y-3">
          {faqs.map((f, idx) => (
            <div key={idx} className="rounded-2xl border border-[#1E2228] bg-[#0A0C0F] p-3">
              <div className="flex gap-2">
                <BarberLineInput value={f.q} onChange={(e) => setFaqs(prev => prev.map((x, i) => i === idx ? { ...x, q: e.target.value } : x))} placeholder="Pregunta" />
                <button onClick={() => setFaqs(prev => prev.filter((_, i) => i !== idx))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#252A30] text-[#6F7680] hover:bg-white/[0.04]"><X className="h-4 w-4" /></button>
              </div>
              <BarberLineTextarea value={f.a} onChange={(e) => setFaqs(prev => prev.map((x, i) => i === idx ? { ...x, a: e.target.value } : x))} className="mt-2 min-h-[88px]" placeholder="Respuesta" />
            </div>
          ))}
        </div>
      </BarberLineCard>
      <BarberLineCard className="space-y-4 p-4">
        <div className="text-lg font-black text-[#F5F7FA]">Políticas</div>
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Urgencias</label>
          <BarberLineTextarea value={emergency} onChange={(e) => setEmergency(e.target.value)} className="min-h-[72px]" />
        </div>
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Cancelación</label>
          <BarberLineInput value={policiesCancel} onChange={(e) => setPoliciesCancel(e.target.value)} />
        </div>
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Depósitos</label>
          <BarberLineInput value={policiesDeposit} onChange={(e) => setPoliciesDeposit(e.target.value)} />
        </div>
      </BarberLineCard>
    </div>
  ) : (
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

  const renderCuenta = () => isBarbershop ? (
    <BarberLineCard className="space-y-4 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#252A30] bg-[#0A0C0F]">
          <Lock className="h-5 w-5 text-[#8A9299]" />
        </div>
        <div>
          <div className="font-black text-[#F5F7FA]">Cuenta</div>
          <div className="text-sm text-[#6F7680]">Acceso y contraseña del panel.</div>
        </div>
      </div>
      <div>
        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Nueva contraseña</label>
        <BarberLineInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
      </div>
      <div>
        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Confirmar contraseña</label>
        <BarberLineInput type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repite la contraseña" />
      </div>
      <BarberLineButton onClick={savePassword} disabled={savingPassword || !newPassword.trim()}>
        {savingPassword ? "Guardando..." : "Cambiar contraseña"}
      </BarberLineButton>
    </BarberLineCard>
  ) : (
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

  const addProvider = async () => {
    const name = prompt(`Nombre del ${vertical.providerLabel.toLowerCase()} (ej: Alex):`);
    if (!name?.trim()) return;
    const { error } = await supabase.from("providers").insert({
      organization_id: ORG, name: name.trim(), role: "doctor", active: true,
      services: [], schedule: providerScheduleFromBusinessHours(hours),
      color: "#" + Math.floor(Math.random()*16777215).toString(16).padStart(6,"0"),
    });
    if (!error) {
      const { data } = await supabase.from("providers").select("*").eq("organization_id", ORG).eq("role", "doctor");
      setDoctors(data || []);
    }
  };

  const renderEquipo = () => {
    const dayNames: Record<string,string> = {"mon":"Lunes","tue":"Martes","wed":"Miércoles","thu":"Jueves","fri":"Viernes","sat":"Sábado","sun":"Domingo"};
    if (isBarbershop) {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-[#F5F7FA]">Barberos</h3>
              <p className="mt-1 text-sm text-[#6F7680]">Equipo, servicios que atienden y disponibilidad.</p>
            </div>
            <BarberLineButton onClick={addProvider}>Agregar barbero</BarberLineButton>
          </div>
          {doctors.length === 0 ? (
            <BarberLineCard className="p-8 text-center">
              <p className="text-sm font-semibold text-[#A4AAB3]">Todavía no hay barberos registrados.</p>
              <p className="mt-1 text-sm text-[#5A6270]">Agregá el primer barbero para ordenar agenda y servicios.</p>
            </BarberLineCard>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {doctors.map((doc) => {
                const sched = doc.schedule || {};
                const svcs = Array.isArray(doc.services) ? doc.services : [];
                return (
                  <BarberLineCard key={doc.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#252A30] bg-[#0A0C0F]">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: doc.color || "#18C37E" }} />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-base font-black text-[#F5F7FA]">{doc.name}</div>
                          <div className="mt-1 flex items-center gap-2">
                            <BarberLineStatus label={doc.active === false ? "Inactivo" : "Activo"} tone={doc.active === false ? "neutral" : "success"} />
                            <span className="text-xs text-[#5A6270]">{svcs.length} servicios</span>
                          </div>
                        </div>
                      </div>
                      <BarberLineButton
                        variant="secondary"
                        onClick={() => setEditingProviderId(editingProviderId === doc.id ? null : doc.id)}
                      >
                        {editingProviderId === doc.id ? "Cerrar" : "Editar"}
                      </BarberLineButton>
                      <BarberLineButton
                        variant="danger"
                        onClick={() => {
                          if (!confirm("¿Eliminar a " + doc.name + "?")) return;
                          setDeletedProviderIds((prev) => doc.id ? [...prev, doc.id] : prev);
                          setDoctors((prev) => prev.filter((provider) => provider.id !== doc.id));
                        }}
                      >
                        Eliminar
                      </BarberLineButton>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Servicios</div>
                      <div className="flex flex-wrap gap-2">
                        {svcs.map((s: string) => (
                          <span key={s} className="inline-flex items-center gap-2 rounded-full border border-[#18C37E]/20 bg-[#18C37E]/10 px-3 py-1 text-xs font-bold text-[#BDF8D1]">
                            {barberServiceDisplayLabel(s)}
                            <button onClick={() => updateDoctor(doc.id, (provider) => ({ ...provider, services: svcs.filter((x: string) => x !== s) }))} className="text-[#BDF8D1]/50 hover:text-red-300">×</button>
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            const svc = prompt("Nombre del servicio (ej: Corte clásico):");
                            if (!svc?.trim()) return;
                            updateDoctor(doc.id, (provider) => ({ ...provider, services: [...svcs, svc.trim()] }));
                          }}
                          className="rounded-full border border-dashed border-[#252A30] px-3 py-1 text-xs font-bold text-[#6F7680] hover:border-[#18C37E]/30 hover:text-[#F5F7FA]"
                        >
                          + Servicio
                        </button>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-[#4A5260]">Horario</div>
                      {editingProviderId !== doc.id ? (
                        <div className="rounded-xl border border-[#1E2228] bg-[#0A0C0F] p-3 text-sm text-[#8A9299]">
                          {Object.entries(dayNames).filter(([key]) => !(sched[key] || { closed: true }).closed).slice(0, 3).map(([key, label]) => {
                            const day = sched[key] || {};
                            return `${label} ${day.open || "09:00"}-${day.close || "18:00"}`;
                          }).join(" · ") || "Sin horario activo"}
                        </div>
                      ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {Object.entries(dayNames).map(([key, label]) => {
                          const day = sched[key] || { closed: true };
                          const isClosed = !!day.closed;
                          return (
                            <div key={key} className={`rounded-xl border p-2 ${isClosed ? "border-[#1E2228] bg-[#0A0C0F] text-[#4A5260]" : "border-[#18C37E]/20 bg-[#18C37E]/5 text-[#A4AAB3]"}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold">{label}</span>
                                {isClosed ? (
                                  <button onClick={() => updateDoctorSchedule(doc.id, key, () => ({ open: hours[key]?.open ?? "09:00", close: hours[key]?.close ?? "18:00", closed: false }))} className="text-[11px] font-semibold hover:text-[#F5F7FA]">Cerrado</button>
                                ) : (
                                  <button onClick={() => updateDoctorSchedule(doc.id, key, () => ({ closed: true }))} className="text-[11px] font-semibold text-red-300/60 hover:text-red-300">Cerrar</button>
                                )}
                              </div>
                              {!isClosed ? (
                                <div className="mt-2 flex items-center gap-1">
                                  <select value={day.open || "08:00"} onChange={(e) => updateDoctorSchedule(doc.id, key, (currentDay) => ({ ...currentDay, open: e.target.value, closed: false }))} className="min-w-0 flex-1 rounded-lg border border-[#252A30] bg-[#0A0C0F] px-2 py-1 text-[11px] outline-none">
                                    <option value="06:00">06:00</option><option value="07:00">07:00</option><option value="08:00">08:00</option><option value="09:00">09:00</option><option value="10:00">10:00</option><option value="11:00">11:00</option><option value="12:00">12:00</option><option value="13:00">13:00</option><option value="14:00">14:00</option><option value="15:00">15:00</option><option value="16:00">16:00</option><option value="17:00">17:00</option><option value="18:00">18:00</option><option value="19:00">19:00</option><option value="20:00">20:00</option><option value="21:00">21:00</option>
                                  </select>
                                  <span className="text-[#4A5260]">-</span>
                                  <select value={day.close || "17:00"} onChange={(e) => updateDoctorSchedule(doc.id, key, (currentDay) => ({ ...currentDay, close: e.target.value, closed: false }))} className="min-w-0 flex-1 rounded-lg border border-[#252A30] bg-[#0A0C0F] px-2 py-1 text-[11px] outline-none">
                                    <option value="06:00">06:00</option><option value="07:00">07:00</option><option value="08:00">08:00</option><option value="09:00">09:00</option><option value="10:00">10:00</option><option value="11:00">11:00</option><option value="12:00">12:00</option><option value="13:00">13:00</option><option value="14:00">14:00</option><option value="15:00">15:00</option><option value="16:00">16:00</option><option value="17:00">17:00</option><option value="18:00">18:00</option><option value="19:00">19:00</option><option value="20:00">20:00</option><option value="21:00">21:00</option>
                                  </select>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      )}
                    </div>
                  </BarberLineCard>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-medium text-white">{vertical.providersLabel}</h3>
            <p className="text-sm text-zinc-400">{vertical.providersLabel}, servicios que atienden y horarios.</p>
          </div>
          <button onClick={addProvider} className="bg-[#3CBDB9] hover:bg-[#35a9a5] text-white px-4 py-2 rounded-xl text-sm font-medium">
            + Agregar {vertical.providerLabel}
          </button>
        </div>
        <div className="space-y-4">
          {doctors.length === 0 ? (
            <div className="py-10 text-center border-2 border-dashed border-white/10 rounded-xl">
              <p className="text-zinc-500">No hay {vertical.providersLabel.toLowerCase()} registrados. Agrega uno para empezar.</p>
            </div>
          ) : (
            doctors.map((doc) => {
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
                  <button onClick={() => {
                    if (!confirm("¿Eliminar a " + doc.name + "?")) return;
                    setDeletedProviderIds((prev) => doc.id ? [...prev, doc.id] : prev);
                    setDoctors((prev) => prev.filter((provider) => provider.id !== doc.id));
                  }} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg border border-red-500/20">Eliminar</button>
                </div>
                <div className="mb-4">
                  <div className="text-xs text-zinc-400 mb-2">Servicios que atiende</div>
                  <div className="flex flex-wrap gap-2">
                    {svcs.map((s: string) => (
                      <span key={s} className="text-xs bg-[#3CBDB9]/10 text-[#3CBDB9] px-3 py-1 rounded-full border border-[#3CBDB9]/20 flex items-center gap-1">
                        {s}
                        <button onClick={() => updateDoctor(doc.id, (provider) => ({ ...provider, services: svcs.filter((x: string) => x !== s) }))} className="ml-1 text-zinc-400 hover:text-red-400">×</button>
                      </span>
                    ))}
                    <button onClick={() => {
                      const svc = prompt("Nombre del servicio (ej: Blanqueamiento):");
                      if (!svc?.trim()) return;
                      updateDoctor(doc.id, (provider) => ({ ...provider, services: [...svcs, svc.trim()] }));
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
                          {isClosed ? (
                            <button onClick={() => updateDoctorSchedule(doc.id, key, () => ({ open: hours[key]?.open ?? "09:00", close: hours[key]?.close ?? "18:00", closed: false }))} className="cursor-pointer text-zinc-500 hover:text-white">Cerrado</button>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex gap-1 items-center">
                                <select value={day.open || "08:00"} onChange={(e) => updateDoctorSchedule(doc.id, key, (currentDay) => ({ ...currentDay, open: e.target.value, closed: false }))} className="bg-transparent border border-white/10 rounded px-1 py-0.5 text-[10px] outline-none">
                                  <option value="06:00">06:00</option><option value="07:00">07:00</option><option value="08:00">08:00</option><option value="09:00">09:00</option><option value="10:00">10:00</option><option value="11:00">11:00</option><option value="12:00">12:00</option><option value="13:00">13:00</option><option value="14:00">14:00</option><option value="15:00">15:00</option><option value="16:00">16:00</option><option value="17:00">17:00</option><option value="18:00">18:00</option><option value="19:00">19:00</option><option value="20:00">20:00</option><option value="21:00">21:00</option>
                                </select>
                                <span className="text-zinc-500">-</span>
                                <select value={day.close || "17:00"} onChange={(e) => updateDoctorSchedule(doc.id, key, (currentDay) => ({ ...currentDay, close: e.target.value, closed: false }))} className="bg-transparent border border-white/10 rounded px-1 py-0.5 text-[10px] outline-none">
                                  <option value="06:00">06:00</option><option value="07:00">07:00</option><option value="08:00">08:00</option><option value="09:00">09:00</option><option value="10:00">10:00</option><option value="11:00">11:00</option><option value="12:00">12:00</option><option value="13:00">13:00</option><option value="14:00">14:00</option><option value="15:00">15:00</option><option value="16:00">16:00</option><option value="17:00">17:00</option><option value="18:00">18:00</option><option value="19:00">19:00</option><option value="20:00">20:00</option><option value="21:00">21:00</option>
                                </select>
                              </div>
                              <button onClick={() => updateDoctorSchedule(doc.id, key, () => ({ closed: true }))} className="text-[9px] text-red-400/60 hover:text-red-400 cursor-pointer">Cerrar día</button>
                            </div>
                          )}
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
    );
  };

  if (loading) return <div className="py-20 text-center text-white/50">Cargando...</div>;
  function openMobileSettingsTab(nextTab: TabKey) {
    setTab(nextTab);
    setMobileDetailOpen(true);
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-[1.35rem] border border-[#25384A] bg-[#111F2B] p-4 lg:hidden">
        <MobileAppHeader
          title={vertical.settingsLabel}
          subtitle={resolvedBusinessType === "barbershop" ? "Configuración de la barbería" : vertical.settingsSubtitle}
          action={<MobileStatusPill tone="success">Bot activo</MobileStatusPill>}
        />
        <div className="space-y-2">
          <MobileSettingsRow icon={MessageCircle} title="Bot" detail="Estado y pausa manual" onClick={() => openMobileSettingsTab("integraciones")} />
          <MobileSettingsRow icon={Globe} title={resolvedBusinessType === "barbershop" ? "Barbería" : "Clínica"} detail="Perfil, teléfono y ubicación" onClick={() => openMobileSettingsTab("clinica")} />
          <MobileSettingsRow icon={BadgeCheck} title="Servicios" detail="Precios y duración" onClick={() => openMobileSettingsTab("servicios")} />
          <MobileSettingsRow icon={CalendarDays} title={vertical.scheduleLabel} detail="Días y horas de atención" onClick={() => openMobileSettingsTab("horario")} />
          <MobileSettingsRow icon={PhoneCall} title={vertical.providersLabel} detail="Personal y disponibilidad" onClick={() => openMobileSettingsTab("equipo")} />
          <MobileSettingsRow icon={MessagesSquare} title="Canales" detail="WhatsApp y Messenger" onClick={() => openMobileSettingsTab("integraciones")} />
          <MobileSettingsRow icon={Lock} title="Cuenta" detail="Acceso y contraseña" onClick={() => openMobileSettingsTab("cuenta")} />
        </div>
        {mobileDetailOpen ? (
          <div className="rounded-3xl border border-[#25384A] bg-[#162838] p-3">
            <div className="text-sm font-black text-[#F8FAFC]">
              {tabs.find((item) => item.key === tab)?.label ?? "Detalle"}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[#9CAAB8]">
              Abajo tenés el panel de edición. En la siguiente iteración este detalle debe vivir como pantalla móvil propia.
            </p>
            <button onClick={() => setMobileDetailOpen(false)} className="mt-3 min-h-10 rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-xs font-bold text-[#9CAAB8]">
              Cerrar detalle
            </button>
          </div>
        ) : null}
      </section>

      <div className="hidden lg:block">
        {isBarbershop ? (
          <section className="rounded-3xl border border-[#1E2228] bg-[#0E1014] p-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="bl-eyebrow">BARBERÍA · CONFIGURACIÓN</div>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-[#F0F4F8]">Configuración</h1>
                <p className="mt-1 text-sm text-[#5A6270]">{vertical.settingsSubtitle}</p>
              </div>
              <button onClick={save} disabled={saving || !isDirty} className={`min-h-10 rounded-xl px-4 text-sm font-bold transition ${isDirty ? "bg-[#18C37E] text-[#04100B] hover:bg-[#15AE6F]" : "border border-white/[0.08] bg-white/[0.04] text-[#5A6270]"}`}>
                {saving ? "Guardando..." : isDirty ? "Guardar" : "Guardado"}
              </button>
            </div>
          </section>
        ) : (
          <PageHeader title="Configuracion" subtitle={vertical.settingsSubtitle} showBackOnMobile backTo="/overview"
            action={<button onClick={save} disabled={saving || !isDirty} className={`px-4 py-2 rounded-xl text-sm font-semibold ${isDirty ? "bg-[#3CBDB9] text-[#0B1117]" : "bg-white/10 text-white/40"}`}>{saving ? "Guardando..." : isDirty ? "Guardar" : "Guardado"}</button>}
          />
        )}
      </div>

      <div className={`${mobileDetailOpen ? "flex" : "hidden"} -mx-2 gap-2 overflow-x-auto px-2 pb-2 lg:flex`} style={{ scrollbarWidth: "none" }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`min-h-10 shrink-0 rounded-xl px-3 py-2 text-xs font-semibold sm:px-4 sm:text-sm ${isBarbershop ? (tab === t.key ? "border border-[#18C37E]/20 bg-[#18C37E]/10 text-[#18C37E]" : "border border-[#1E2228] bg-[#0E1014] text-[#8A9299] hover:border-white/[0.10] hover:text-[#F0F4F8]") : (tab === t.key ? "bg-white/10 text-white" : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10")}`}>{t.label}</button>
        ))}
      </div>

      <div className={`${mobileDetailOpen ? "block" : "hidden"} lg:block`}>
      {tab === "integraciones" && renderIntegrations()}
      {tab === "clinica" && renderClinica()}
      {tab === "horario" && renderHorario()}
      {tab === "servicios" && renderServicios()}
      {tab === "equipo" && renderEquipo()}
        {tab === "faqs" && renderFaqs()}
      {tab === "cuenta" && renderCuenta()}
      </div>

      <Modal open={guideOpen !== null} title="Guía de integración" description="Pasos para conectar." onClose={() => setGuideOpen(null)} actions={<button onClick={() => setGuideOpen(null)} className="rounded-xl bg-[#3CBDB9] px-4 py-2 text-sm font-medium text-white hover:bg-[#35a9a5]">Entendido</button>}>
        <div className="space-y-3 text-sm text-white/70">
          <div className="flex items-start gap-3"><Globe className="h-4 w-4 mt-0.5" /><span>Confirma los datos de tu {vertical.organizationLabel.toLowerCase()}.</span></div>
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
