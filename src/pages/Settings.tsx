// src/pages/Settings.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  BadgeCheck,
  CalendarDays,
  Globe,
  Instagram,
  MessageCircle,
  MessagesSquare,
  PhoneCall,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { Toggle } from "../components/Toggle";
import { Modal } from "../components/ui/Modal";
import { Toast, type ToastKind } from "../components/ui/Toast";
import PageHeader from "../components/PageHeader";

const META_APP_ID = import.meta.env.VITE_META_APP_ID as string | undefined;
const GOOGLE_CAL_CONNECT_URL = "";
const PUBLIC_APP_URL =
  ((import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) ??
    (import.meta.env.PUBLIC_APP_URL as string | undefined) ??
    "https://dental.creatyv.io")
    .replace(/\/+$/, "");
const META_REDIRECT_URI = `${PUBLIC_APP_URL}/auth/meta/callback`;

const DEFAULT_ORG = "clinic-demo";

type ServiceItem = {
  name: string;
  price_from?: number | null;
  price_to?: number | null;
  currency?: string;
  duration_min?: number | null;
  notes?: string;
};

type FaqItem = { q: string; a: string };
type DayHours = { closed: boolean; open?: string; close?: string };
type HoursMap = Record<string, DayHours>;

type ClinicSettingsRow = {
  clinic_id: string;
  phone: string | null;
  address: string | null;
  google_maps_url: string | null;
  hours: any | null;
  services: ServiceItem[] | null;
  faqs: FaqItem[] | null;
  emergency: string | null;
  policies: any | null;
  updated_at: string | null;
  specialties: any | null;
};

type IntegrationRequestRow = {
  id: string;
  organization_id: string | null;
  channel: string;
  status: string | null;
  payload: any | null;
  created_at: string | null;
};

type OrgIntegrationState = {
  meta_page_id: string | null;
  messenger_enabled: boolean | null;
  meta_connected_at: string | null;
  meta_last_error: string | null;
};

const SPECIALTIES = [
  { value: "general", label: "Clínica general" },
  { value: "ortho", label: "Ortodoncia (brackets / alineadores)" },
  { value: "pediatric", label: "Odontopediatría (niños)" },
  { value: "endo", label: "Endodoncia (conducto)" },
  { value: "implants", label: "Implantes" },
  { value: "aesthetic", label: "Estética dental" },
];

const currencyDefault = "HNL";

const TEMPLATE_BY_SPECIALTY: Record<
  string,
  {
    services: ServiceItem[];
    faqs: FaqItem[];
    policies: { cancelacion: string; deposito: string };
    emergency: string;
  }
> = {
  general: {
    services: [
      {
        name: "Consulta / valoración",
        price_from: 400,
        currency: "HNL",
        duration_min: 30,
        notes: "Diagnóstico inicial + plan recomendado.",
      },
      {
        name: "Limpieza dental",
        price_from: 700,
        currency: "HNL",
        duration_min: 45,
        notes: "Incluye evaluación básica.",
      },
      {
        name: "Resina (restauración)",
        price_from: 900,
        currency: "HNL",
        duration_min: 60,
        notes: "Varía por tamaño.",
      },
      {
        name: "Extracción simple",
        price_from: 900,
        currency: "HNL",
        duration_min: 45,
        notes: "No incluye extracción quirúrgica.",
      },
      {
        name: "Blanqueamiento (sesión)",
        price_from: 1800,
        currency: "HNL",
        duration_min: 60,
        notes: "Recomendamos evaluación previa.",
      },
    ],
    faqs: [
      { q: "¿Tienen disponibilidad hoy?", a: "Sí, podemos revisar disponibilidad. ¿Qué día y hora te conviene?" },
      { q: "¿Cuánto cuesta una limpieza?", a: "La limpieza inicia desde L 700. Puede variar según evaluación." },
      { q: "¿Dónde están ubicados?", a: "Te comparto la ubicación y una referencia. ¿Vienes en carro o en taxi?" },
      { q: "¿Atienden urgencias?", a: "Sí. Para urgencias priorizamos según disponibilidad. ¿Qué síntomas presentas y desde cuándo?" },
    ],
    policies: {
      cancelacion: "Si necesitas reprogramar, avísanos con al menos 2 horas de anticipación.",
      deposito: "En algunos tratamientos se solicita un depósito para reservar el cupo.",
    },
    emergency:
      "Si es una urgencia (dolor fuerte, inflamación o sangrado), cuéntanos síntomas y desde cuándo para priorizarte.",
  },
  ortho: {
    services: [
      {
        name: "Evaluación de ortodoncia",
        price_from: 500,
        currency: "HNL",
        duration_min: 30,
        notes: "Incluye plan y opciones.",
      },
      {
        name: "Brackets metálicos (cuota inicial)",
        price_from: 4500,
        currency: "HNL",
        duration_min: 60,
        notes: "Mensualidad aparte.",
      },
      {
        name: "Control mensual (ortodoncia)",
        price_from: 900,
        currency: "HNL",
        duration_min: 20,
        notes: "Ajuste y seguimiento.",
      },
      {
        name: "Alineadores (evaluación)",
        price_from: 800,
        currency: "HNL",
        duration_min: 30,
        notes: "Escaneo y plan según caso.",
      },
    ],
    faqs: [
      { q: "¿Cuánto dura el tratamiento?", a: "Depende del caso. En promedio 12 a 24 meses. Se confirma tras evaluación." },
      { q: "¿Cuánto cuestan los brackets?", a: "Inician desde L 4,500 + mensualidad desde L 900 (según plan)." },
      { q: "¿Puedo pagar por cuotas?", a: "Sí, tenemos opciones de pago mensual." },
    ],
    policies: {
      cancelacion: "Reprogramaciones con al menos 24 horas para no perder el control.",
      deposito: "Para iniciar el tratamiento se solicita cuota inicial.",
    },
    emergency: "Si se soltó un bracket o te lastima un alambre, agendamos ajuste prioritario.",
  },
  pediatric: {
    services: [
      {
        name: "Consulta infantil",
        price_from: 450,
        currency: "HNL",
        duration_min: 30,
        notes: "Evaluación + recomendaciones.",
      },
      {
        name: "Limpieza infantil",
        price_from: 600,
        currency: "HNL",
        duration_min: 40,
        notes: "Según edad y cooperación.",
      },
      { name: "Sellantes", price_from: 450, currency: "HNL", duration_min: 30, notes: "Prevención de caries." },
      { name: "Fluorización", price_from: 350, currency: "HNL", duration_min: 20, notes: "Prevención y refuerzo." },
    ],
    faqs: [
      { q: "¿Desde qué edad atienden?", a: "Atendemos desde temprana edad. Dime la edad del niño y te guío." },
      { q: "¿Cómo preparo a mi niño?", a: "Explícale con calma y trae su cepillo si pueden." },
    ],
    policies: {
      cancelacion: "Recomendamos reprogramar con anticipación para reservar cupo infantil.",
      deposito: "Tratamientos especiales pueden requerir confirmación previa.",
    },
    emergency: "Si hubo golpe/trauma dental, te damos prioridad. ¿Qué pasó y hace cuánto?",
  },
  endo: {
    services: [
      {
        name: "Valoración endodoncia",
        price_from: 600,
        currency: "HNL",
        duration_min: 30,
        notes: "Se evalúa con radiografía si aplica.",
      },
      {
        name: "Conducto (1 canal)",
        price_from: 2500,
        currency: "HNL",
        duration_min: 90,
        notes: "Depende de complejidad.",
      },
      {
        name: "Conducto (2+ canales)",
        price_from: 3500,
        currency: "HNL",
        duration_min: 120,
        notes: "Varía por pieza.",
      },
    ],
    faqs: [
      { q: "¿Duele un conducto?", a: "Se realiza con anestesia. Puede haber sensibilidad leve después." },
      { q: "¿Cuánto cuesta un conducto?", a: "Inicia desde L 2,500 según pieza y complejidad." },
    ],
    policies: {
      cancelacion: "Reprograma con anticipación (procedimiento largo).",
      deposito: "En procedimientos largos puede solicitarse confirmación.",
    },
    emergency: "Dolor intenso: te orientamos y buscamos cita prioritaria. ¿Qué tan fuerte es el dolor (1–10)?",
  },
  implants: {
    services: [
      {
        name: "Evaluación implantes",
        price_from: 800,
        currency: "HNL",
        duration_min: 45,
        notes: "Plan + opciones según caso.",
      },
      {
        name: "Implante (procedimiento)",
        price_from: 18000,
        currency: "HNL",
        duration_min: 120,
        notes: "Varía por marca y complejidad.",
      },
    ],
    faqs: [
      { q: "¿Cuánto cuesta un implante?", a: "Depende del caso y componentes. Inicia desde L 18,000. Se confirma en evaluación." },
      { q: "¿Cuánto dura el proceso?", a: "Suele ser por fases. Te explicamos el plan tras evaluación." },
    ],
    policies: {
      cancelacion: "Reprograma con anticipación para reservar tiempo clínico.",
      deposito: "Puede requerirse depósito para reservar componentes y fecha.",
    },
    emergency: "Si tienes dolor o inflamación post-procedimiento, te atendemos prioritario.",
  },
  aesthetic: {
    services: [
      {
        name: "Carillas (evaluación)",
        price_from: 800,
        currency: "HNL",
        duration_min: 45,
        notes: "Plan estético según sonrisa.",
      },
      {
        name: "Carilla (por unidad)",
        price_from: 4500,
        currency: "HNL",
        duration_min: 90,
        notes: "Varía por material.",
      },
      {
        name: "Blanqueamiento (sesión)",
        price_from: 1800,
        currency: "HNL",
        duration_min: 60,
        notes: "Con evaluación previa.",
      },
    ],
    faqs: [
      { q: "¿Carillas o blanqueamiento?", a: "Depende de tu objetivo. Te guiamos con evaluación rápida." },
      { q: "¿Cuánto duran las carillas?", a: "Con buen cuidado duran años. Te explicamos mantenimiento." },
    ],
    policies: {
      cancelacion: "Avisar con anticipación para reservar cupo estético.",
      deposito: "Puede requerirse depósito por laboratorio/materiales.",
    },
    emergency: "Si se desprende una carilla o hay sensibilidad fuerte, te damos prioridad.",
  },
};

function defaultHours(): HoursMap {
  return {
    mon: { closed: false, open: "08:00", close: "17:00" },
    tue: { closed: false, open: "08:00", close: "17:00" },
    wed: { closed: false, open: "08:00", close: "17:00" },
    thu: { closed: false, open: "08:00", close: "17:00" },
    fri: { closed: false, open: "08:00", close: "17:00" },
    sat: { closed: false, open: "09:00", close: "13:00" },
    sun: { closed: true },
  };
}

function uniqueByName(items: ServiceItem[]) {
  const seen = new Set<string>();
  const out: ServiceItem[] = [];
  for (const it of items) {
    const k = (it.name ?? "").trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function uniqueFaq(items: FaqItem[]) {
  const seen = new Set<string>();
  const out: FaqItem[] = [];
  for (const it of items) {
    const k = `${(it.q ?? "").trim().toLowerCase()}::${(it.a ?? "").trim().toLowerCase()}`;
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function mergeTemplates(selected: string[]) {
  const safe = selected.length ? selected : ["general"];
  const services = uniqueByName(safe.flatMap((k) => TEMPLATE_BY_SPECIALTY[k]?.services ?? []));

  const includeGeneralFaq = safe.includes("general") || safe.length === 0;
  const faqSources = [
    ...(includeGeneralFaq ? (TEMPLATE_BY_SPECIALTY.general?.faqs ?? []) : []),
    ...safe.flatMap((k) => TEMPLATE_BY_SPECIALTY[k]?.faqs ?? []),
  ];
  const faqs = uniqueFaq(faqSources);

  const first = safe[0] ?? "general";
  const base = TEMPLATE_BY_SPECIALTY[first] ?? TEMPLATE_BY_SPECIALTY.general;

  return {
    services,
    faqs,
    policies: base.policies,
    emergency: base.emergency,
  };
}

const dayLabels: Record<string, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};

type TabKey = "integraciones" | "clinica" | "horario" | "servicios" | "faqs";

type IntegrationChannel = "messenger" | "instagram" | "whatsapp" | "google_calendar";

const INTEGRATIONS = [
  {
    key: "messenger" as const,
    name: "Messenger",
    description: "Centralizá los mensajes del inbox de Facebook en tu equipo.",
    icon: MessagesSquare,
  },
  {
    key: "instagram" as const,
    name: "Instagram",
    description: "Respondé consultas desde Instagram sin perder clientes potenciales.",
    icon: Instagram,
  },
  {
    key: "whatsapp" as const,
    name: "WhatsApp",
    description: "Conectá tu línea para confirmar y agendar citas rápidamente.",
    icon: MessageCircle,
  },
  {
    key: "google_calendar" as const,
    name: "Google Calendar",
    description: "Sincronizá citas y confirmaciones con tu calendario.",
    icon: CalendarDays,
  },
];

function StatusBadge({ label, tone }: { label: string; tone: "success" | "warning" | "muted" | "info" }) {
  const styles =
    tone === "success"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
      : tone === "warning"
      ? "border-amber-400/40 bg-amber-500/10 text-amber-300"
      : tone === "info"
      ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-300"
      : "border-white/20 bg-white/5 text-white/90";

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${styles}`}>
      {label}
    </span>
  );
}

export default function Settings() {
  const location = useLocation();
  const { clinic, clinicId } = useClinic();

  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [tab, setTab] = useState<TabKey>("integraciones");
  const [openSection, setOpenSection] = useState<TabKey | null>("integraciones");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);

  const [localClinicId, setLocalClinicId] = useState<string | null>(null);

  const [clinicName, setClinicName] = useState("Clínica Sonrisas");

  const [specialties, setSpecialties] = useState<string[]>(["general"]);
  const [useTemplate, setUseTemplate] = useState(true);

  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");

  const [advancedPerDay, setAdvancedPerDay] = useState(false);
  const [hours, setHours] = useState<HoursMap>(defaultHours());

  const [services, setServices] = useState<ServiceItem[]>(mergeTemplates(["general"]).services);
  const [faqs, setFaqs] = useState<FaqItem[]>(mergeTemplates(["general"]).faqs);
  const [emergency, setEmergency] = useState(mergeTemplates(["general"]).emergency);
  const [policiesCancel, setPoliciesCancel] = useState(mergeTemplates(["general"]).policies.cancelacion ?? "");
  const [policiesDeposit, setPoliciesDeposit] = useState(mergeTemplates(["general"]).policies.deposito ?? "");

  const [integrationRequests, setIntegrationRequests] = useState<IntegrationRequestRow[]>([]);
  const [orgIntegration, setOrgIntegration] = useState<OrgIntegrationState>({
    meta_page_id: null,
    messenger_enabled: false,
    meta_connected_at: null,
    meta_last_error: null,
  });

  const [guideOpen, setGuideOpen] = useState<IntegrationChannel | null>(null);
  const [requestOpen, setRequestOpen] = useState<IntegrationChannel | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const connected = params.get("connected");
    const tab = params.get("tab");
    if (tab === "integraciones") setOpenSection("integraciones");
    if (connected === "1") {
      setOpenSection("integraciones");
      setNotice("Messenger se conectó correctamente.");
    }
  }, [location.search]);

  const [requestForm, setRequestForm] = useState({
    business: "",
    phone: "",
    handle: "",
  });

  const [waitlistEmail, setWaitlistEmail] = useState("");

  const showTechnicalDetails = false;

  function toggleSpecialty(value: string) {
    setSpecialties((prev) => {
      const has = prev.includes(value);
      const next = has ? prev.filter((x) => x !== value) : [...prev, value];
      const safe = next.length ? next : ["general"];

      if (useTemplate) {
        const merged = mergeTemplates(safe);
        setServices(merged.services);
        setFaqs(merged.faqs);
        setEmergency(merged.emergency);
        setPoliciesCancel(merged.policies.cancelacion ?? "");
        setPoliciesDeposit(merged.policies.deposito ?? "");
      }
      return safe;
    });
  }

  async function connectMeta() {
    setError(null);
    setNotice(null);

    if (!META_APP_ID) {
      setError("Conexión no disponible. Revisa la configuración de la integración.");
      return;
    }

    const signedStateRes = await supabase.functions.invoke("meta-oauth-state", {
      body: { organization_id: ORG },
    });
    const signedState = String(signedStateRes.data?.state ?? "");
    if (signedStateRes.error || !signedState) {
      setError("No se pudo iniciar la conexión segura con Meta.");
      return;
    }

    const authUrl =
      "https://www.facebook.com/v19.0/dialog/oauth" +
      `?client_id=${META_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging` +
      `&state=${encodeURIComponent(signedState)}`;

    window.location.href = authUrl;
  }

  async function ensureClinic(): Promise<string | null> {
    if (clinicId) return clinicId;
    if (localClinicId) return localClinicId;

    const find = await supabase
      .from("clinics")
      .select("id, name, domain, organization_id")
      .eq("organization_id", DEFAULT_ORG)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (find.data?.id) {
      setLocalClinicId(find.data.id);
      setClinicName(find.data.name ?? "Clínica");
      return find.data.id;
    }

    const created = await supabase
      .from("clinics")
      .insert({ name: clinicName.trim() || "Clínica", domain: null, organization_id: DEFAULT_ORG })
      .select("id, name, domain, organization_id")
      .maybeSingle();

    if (created.error || !created.data?.id) {
      setError("No se pudo crear la clínica. Verifica tus permisos.");
      return null;
    }

    setLocalClinicId(created.data.id);
    setClinicName(created.data.name ?? clinicName);
    return created.data.id;
  }

  async function loadIntegrationRequests() {
    const q = await supabase
      .from("integration_requests")
      .select("id, organization_id, channel, status, payload, created_at")
      .eq("organization_id", ORG)
      .order("created_at", { ascending: false })
      .limit(20);

    if (q.error) {
      setIntegrationRequests([]);
      return;
    }

    setIntegrationRequests((q.data as any) ?? []);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      setNotice(null);

      const id = await ensureClinic();
      if (!mounted) return;

      if (!id) {
        const merged = mergeTemplates(["general"]);
        setServices(merged.services);
        setFaqs(merged.faqs);
        setEmergency(merged.emergency);
        setPoliciesCancel(merged.policies.cancelacion ?? "");
        setPoliciesDeposit(merged.policies.deposito ?? "");
        setLoading(false);
        return;
      }

      const s = await supabase
        .from("clinic_settings")
        .select("clinic_id, phone, address, google_maps_url, hours, services, emergency, policies, updated_at, specialties, faqs")
        .eq("clinic_id", id)
        .maybeSingle();

      if (!mounted) return;

      const settingsRow = (s.data as ClinicSettingsRow) ?? null;

      const dbSpecialtiesRaw = settingsRow?.specialties;
      const dbSpecialties = Array.isArray(dbSpecialtiesRaw) ? (dbSpecialtiesRaw as string[]) : null;

      const initialSpecialties = dbSpecialties?.length ? dbSpecialties : ["general"];
      setSpecialties(initialSpecialties);

      const templateMerged = mergeTemplates(initialSpecialties);

      setPhone(settingsRow?.phone ?? "");
      setAddress(settingsRow?.address ?? "");
      setMapsUrl(settingsRow?.google_maps_url ?? "");

      setHours((settingsRow?.hours as HoursMap) ?? defaultHours());
      setEmergency(settingsRow?.emergency ?? templateMerged.emergency);

      const pol = settingsRow?.policies ?? null;
      setPoliciesCancel(pol?.cancelacion ?? templateMerged.policies.cancelacion ?? "");
      setPoliciesDeposit(pol?.deposito ?? templateMerged.policies.deposito ?? "");

      setServices(settingsRow?.services?.length ? settingsRow.services : templateMerged.services);
      setFaqs(settingsRow?.faqs?.length ? settingsRow.faqs : templateMerged.faqs);

      await loadIntegrationRequests();

      const orgRes = await supabase
        .from("org_settings")
        .select("meta_page_id, messenger_enabled, meta_connected_at, meta_last_error")
        .eq("organization_id", ORG)
        .maybeSingle();

      if (orgRes.data) {
        setOrgIntegration({
          meta_page_id: (orgRes.data as any).meta_page_id ?? null,
          messenger_enabled: (orgRes.data as any).messenger_enabled ?? false,
          meta_connected_at: (orgRes.data as any).meta_connected_at ?? null,
          meta_last_error: (orgRes.data as any).meta_last_error ?? null,
        });
      }

      setLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, ORG]);

  const settingsSnapshot = useMemo(
    () =>
      JSON.stringify({
        clinicName,
        specialties,
        phone,
        address,
        mapsUrl,
        hours,
        services,
        faqs,
        emergency,
        policiesCancel,
        policiesDeposit,
      }),
    [clinicName, specialties, phone, address, mapsUrl, hours, services, faqs, emergency, policiesCancel, policiesDeposit]
  );

  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      setInitialSnapshot(settingsSnapshot);
    }
  }, [loading, settingsSnapshot]);

  const isDirty = useMemo(() => {
    if (!initialSnapshot) return false;
    return initialSnapshot !== settingsSnapshot;
  }, [initialSnapshot, settingsSnapshot]);

  async function save() {
    if (!isDirty) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    const id = await ensureClinic();
    if (!id) {
      setSaving(false);
      return;
    }

    const payload: ClinicSettingsRow = {
      clinic_id: id,
      phone: phone.trim() || null,
      address: address.trim() || null,
      google_maps_url: mapsUrl.trim() || null,
      hours,
      services,
      faqs,
      emergency: emergency.trim() || null,
      policies: {
        cancelacion: policiesCancel.trim() || "",
        deposito: policiesDeposit.trim() || "",
      },
      specialties,
      updated_at: new Date().toISOString(),
    };

    const res = await supabase.from("clinic_settings").upsert(payload, { onConflict: "clinic_id" });
    if (res.error) {
      setError("No se pudo guardar. Intenta nuevamente.");
      setToast({ kind: "error", message: "No se pudieron guardar los cambios." });
      setSaving(false);
      return;
    }

    setNotice("Guardado.");
    setToast({ kind: "success", message: "Cambios guardados correctamente." });
    setInitialSnapshot(settingsSnapshot);
    setSaving(false);
  }

  function statusFor(channel: IntegrationChannel) {
    if (channel === "google_calendar") {
      return { label: "Deshabilitado", tone: "muted" as const, primary: "Unirme a lista de espera", disabled: true };
    }

    if (channel === "messenger") {
      if (orgIntegration.messenger_enabled && orgIntegration.meta_page_id) {
        return { label: "Conectado", tone: "success" as const, primary: "Reconfigurar", disabled: false };
      }
      if (orgIntegration.meta_last_error) {
        return { label: "Requiere acción", tone: "warning" as const, primary: "Revisar", disabled: false };
      }
    }

    const latest = integrationRequests.find((req) => req.channel === channel);

    if (latest?.status === "connected") {
      return { label: "Conectado", tone: "success" as const, primary: "Reconfigurar", disabled: false };
    }

    if (latest?.status === "pending") {
      return { label: "Requiere acción", tone: "warning" as const, primary: "Revisar", disabled: false };
    }

    return { label: "No conectado", tone: "muted" as const, primary: "Conectar", disabled: false };
  }

  async function submitIntegrationRequest(channel: IntegrationChannel) {
    const payload = {
      business_name: requestForm.business.trim(),
      phone: requestForm.phone.trim(),
      handle: requestForm.handle.trim(),
    };

    const res = await supabase.from("integration_requests").insert({
      organization_id: ORG,
      channel,
      payload,
      status: "pending",
    });

    if (res.error) {
      setToast({ kind: "error", message: "No se pudo enviar la solicitud." });
      return;
    }

    setToast({ kind: "success", message: "Solicitud enviada. Te contactaremos." });
    setRequestForm({ business: "", phone: "", handle: "" });
    setRequestOpen(null);
    await loadIntegrationRequests();
  }

  async function submitWaitlist() {
    if (!waitlistEmail.trim()) return;

    const res = await supabase.from("waitlist").insert({
      organization_id: ORG,
      email: waitlistEmail.trim(),
      source: "google_calendar",
      status: "pending",
    });

    if (res.error) {
      setToast({ kind: "error", message: "No se pudo registrar tu email." });
      return;
    }

    setToast({ kind: "success", message: "Te avisaremos cuando esté disponible." });
    setWaitlistEmail("");
    setWaitlistOpen(false);
  }

  const tabs = useMemo(
    () => [
      { key: "integraciones" as const, label: "Integraciones" },
      { key: "clinica" as const, label: "Clínica" },
      { key: "horario" as const, label: "Horario" },
      { key: "servicios" as const, label: "Servicios" },
      { key: "faqs" as const, label: "FAQs y políticas" },
    ],
    []
  );

  const renderIntegrations = () => (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {INTEGRATIONS.map((integration) => {
        const status = statusFor(integration.key);
        const Icon = integration.icon;
        const isDisabled = integration.key === "google_calendar";

        return (
          <div key={integration.key} className="rounded-3xl border border-[#E5E7EB] bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7]">
                  <Icon className="h-5 w-5 text-slate-700" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">{integration.name}</div>
                  <div className="mt-1 text-sm text-slate-700">{integration.description}</div>
                </div>
              </div>

              <StatusBadge label={status.label} tone={status.tone} />
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                disabled={status.disabled}
                onClick={() => {
                  if (integration.key === "messenger") {
                    connectMeta();
                    return;
                  }
                  if (integration.key === "google_calendar") {
                    return;
                  }
                  setRequestOpen(integration.key);
                }}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  status.disabled
                    ? "border border-[#E5E7EB] bg-white text-slate-500"
                    : status.label === "Conectado"
                    ? "border border-emerald-400/40 bg-transparent text-emerald-300/90 hover:border-emerald-300/60"
                    : "border border-white/25 bg-white/5 text-white/90 hover:bg-white/10"
                }`}
              >
                {isDisabled ? "Conectar" : status.primary}
              </button>

              {isDisabled ? (
                <button
                  type="button"
                  onClick={() => setWaitlistOpen(true)}
                  className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
                >
                  Unirme a lista de espera
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setGuideOpen(integration.key)}
                  className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
                >
                  Ver guía
                </button>
              )}
            </div>

            {isDisabled ? (
              <button
                type="button"
                onClick={() => setGuideOpen(integration.key)}
                className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-slate-900"
              >
                Ver guía
              </button>
            ) : null}

            {isDisabled ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-700">
                <BadgeCheck className="h-4 w-4 text-slate-500" />
                Inscribite para recibir acceso prioritario cuando esté disponible.
              </div>
            ) : null}

            {showTechnicalDetails ? (
              <details className="mt-4 rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] p-4 text-xs text-slate-700">
                <summary className="cursor-pointer text-sm text-slate-700">Detalles técnicos</summary>
                <div className="mt-3 space-y-2">
                  <div>Identificador de conexión:</div>
                  <div className="break-all text-slate-500">{META_REDIRECT_URI}</div>
                </div>
              </details>
            ) : null}

            {integration.key === "messenger" && orgIntegration.meta_last_error ? (
              <div className="mt-3 text-xs text-rose-200">
                {orgIntegration.meta_last_error}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const renderClinica = () => (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1 rounded-3xl border border-[#E5E7EB] bg-white p-6">
        <p className="text-[10px] tracking-[0.22em] uppercase text-slate-500">Clínica</p>

        <label className="mt-4 block text-xs font-medium text-slate-700">Nombre de la clínica</label>
        <input
          value={clinicName}
          onChange={(e) => setClinicName(e.target.value)}
          className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:border-blue-300"
          placeholder="Ej: Clínica Sonrisas"
        />
      </div>

      <div className="lg:col-span-2 space-y-6">
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6">
          <p className="text-sm font-semibold text-slate-900">Datos de la clínica</p>
          <p className="mt-1 text-sm text-slate-700">
            Lo más preguntado: teléfono, ubicación, dirección, horarios.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-700">Teléfono</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ej: +504 9999-9999"
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:border-blue-300"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Ubicación (Google Maps)</label>
              <input
                value={mapsUrl}
                onChange={(e) => setMapsUrl(e.target.value)}
                placeholder="Pega el link de Maps"
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:border-blue-300"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-700">Dirección</label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Colonia, calle, referencia, ciudad"
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:border-blue-300"
              />
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6">
          <p className="text-sm font-semibold text-slate-900">Especialidades</p>
          <p className="mt-1 text-sm text-slate-700">Marca todas las que aplica.</p>

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {SPECIALTIES.map((s) => {
              const checked = specialties.includes(s.value);
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleSpecialty(s.value)}
                  className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm transition ${
                    checked
                      ? "border-[#E5E7EB] bg-[#F4F5F7] text-slate-900"
                      : "border-[#E5E7EB] bg-[#F4F5F7] text-slate-700 hover:bg-[#F4F5F7] hover:text-slate-900"
                  }`}
                >
                  <span>{s.label}</span>
                  <span
                    className={`h-5 w-5 rounded-full border flex items-center justify-center ${
                      checked ? "border-[#E5E7EB] bg-[#F4F5F7]" : "border-[#E5E7EB] bg-transparent"
                    }`}
                  >
                    {checked ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Usar plantillas</p>
              <p className="text-xs text-slate-700">Servicios + FAQs precargadas (editable).</p>
            </div>
            <Toggle
              enabled={useTemplate}
              onChange={(v) => {
                setUseTemplate(v);
                if (v) {
                  const merged = mergeTemplates(specialties);
                  setServices(merged.services);
                  setFaqs(merged.faqs);
                  setEmergency(merged.emergency);
                  setPoliciesCancel(merged.policies.cancelacion ?? "");
                  setPoliciesDeposit(merged.policies.deposito ?? "");
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderHorario = () => (
    <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Horario</p>
          <p className="mt-1 text-sm text-slate-700">Configura por día.</p>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Modo avanzado</p>
            <p className="text-xs text-slate-700">Diferente por día.</p>
          </div>
          <Toggle enabled={advancedPerDay} onChange={setAdvancedPerDay} />
        </div>
      </div>

      <div className="space-y-3">
        {Object.entries(dayLabels).map(([k, label]) => {
          const d = hours[k] ?? { closed: true };
          return (
            <div key={k} className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center justify-between md:justify-start md:gap-6">
                  <p className="text-sm font-semibold text-slate-900">{label}</p>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-700">Cerrado</span>
                    <Toggle
                      enabled={!d.closed}
                      onChange={(open) =>
                        setHours((prev) => ({
                          ...prev,
                          [k]: open
                            ? { closed: false, open: d.open ?? "08:00", close: d.close ?? "17:00" }
                            : { closed: true },
                        }))
                      }
                    />
                    <span className="text-xs text-slate-700">Abierto</span>
                  </div>
                </div>

                {!d.closed ? (
                  <div className="grid grid-cols-2 gap-3 md:flex md:items-center">
                    <div>
                      <label className="text-xs text-slate-700">Abre</label>
                      <input
                        type="time"
                        value={d.open ?? "08:00"}
                        onChange={(e) =>
                          setHours((prev) => ({
                            ...prev,
                            [k]: { ...d, closed: false, open: e.target.value },
                          }))
                        }
                        className="mt-1 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-700">Cierra</label>
                      <input
                        type="time"
                        value={d.close ?? "17:00"}
                        onChange={(e) =>
                          setHours((prev) => ({
                            ...prev,
                            [k]: { ...d, closed: false, close: e.target.value },
                          }))
                        }
                        className="mt-1 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-700">Cerrado</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderServicios = () => (
    <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Servicios y precios</p>
          <p className="mt-1 text-sm text-slate-700">Editable por clínica.</p>
        </div>

        <button
          type="button"
          onClick={() =>
            setServices((prev) => [
              ...(prev ?? []),
              {
                name: "Nuevo servicio",
                price_from: null,
                price_to: null,
                currency: currencyDefault,
                duration_min: 30,
                notes: "",
              },
            ])
          }
          className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-[#F4F5F7]"
        >
          + Agregar servicio
        </button>
      </div>

      <div className="space-y-3">
        {services.map((s, idx) => (
          <div key={idx} className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] p-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Nombre</label>
                <input
                  value={s.name}
                  onChange={(e) =>
                    setServices((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                  }
                  className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setServices((prev) => prev.filter((_, i) => i !== idx))}
                  className="h-11 w-full rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-3 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
                >
                  Quitar
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className="text-xs font-medium text-slate-700">Desde</label>
                <input
                  type="number"
                  value={s.price_from ?? ""}
                  onChange={(e) =>
                    setServices((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, price_from: e.target.value ? Number(e.target.value) : null } : x
                      )
                    )
                  }
                  className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Hasta</label>
                <input
                  type="number"
                  value={s.price_to ?? ""}
                  onChange={(e) =>
                    setServices((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, price_to: e.target.value ? Number(e.target.value) : null } : x
                      )
                    )
                  }
                  className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Moneda</label>
                <input
                  value={s.currency ?? currencyDefault}
                  onChange={(e) =>
                    setServices((prev) => prev.map((x, i) => (i === idx ? { ...x, currency: e.target.value } : x)))
                  }
                  className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                  placeholder="HNL"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Duración (min)</label>
                <input
                  type="number"
                  value={s.duration_min ?? 30}
                  onChange={(e) =>
                    setServices((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, duration_min: e.target.value ? Number(e.target.value) : 30 } : x
                      )
                    )
                  }
                  className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                  placeholder="30"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Descripción</label>
              <input
                value={s.notes ?? ""}
                onChange={(e) =>
                  setServices((prev) => prev.map((x, i) => (i === idx ? { ...x, notes: e.target.value } : x)))
                }
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                placeholder="Ej: depende del caso, incluye evaluación…"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderFaqs = () => (
    <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 space-y-6">
      <div>
        <p className="text-sm font-semibold text-slate-900">Respuestas rápidas (FAQs)</p>
        <p className="mt-1 text-sm text-slate-700">Respuestas consistentes sin improvisar.</p>

        <div className="mt-4 space-y-3">
          {faqs.map((f, idx) => (
            <div key={idx} className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] p-4">
              <label className="text-xs font-medium text-slate-700">Pregunta</label>
              <input
                value={f.q}
                onChange={(e) => setFaqs((prev) => prev.map((x, i) => (i === idx ? { ...x, q: e.target.value } : x)))}
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
              />

              <label className="mt-3 block text-xs font-medium text-slate-700">Respuesta</label>
              <input
                value={f.a}
                onChange={(e) => setFaqs((prev) => prev.map((x, i) => (i === idx ? { ...x, a: e.target.value } : x)))}
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
              />

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setFaqs((prev) => prev.filter((_, i) => i !== idx))}
                  className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
                >
                  Quitar
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFaqs((prev) => [...prev, { q: "Nueva pregunta", a: "Nueva respuesta" }])}
          className="mt-4 rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-[#F4F5F7]"
        >
          + Agregar FAQ
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] p-4">
          <label className="text-xs font-medium text-slate-700">Urgencias</label>
          <input
            value={emergency}
            onChange={(e) => setEmergency(e.target.value)}
            className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
          />
        </div>

        <div className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] p-4">
          <label className="text-xs font-medium text-slate-700">Política de cancelación</label>
          <input
            value={policiesCancel}
            onChange={(e) => setPoliciesCancel(e.target.value)}
            className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
          />
        </div>

        <div className="md:col-span-2 rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] p-4">
          <label className="text-xs font-medium text-slate-700">Depósitos (si aplica)</label>
          <input
            value={policiesDeposit}
            onChange={(e) => setPoliciesDeposit(e.target.value)}
            className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
          />
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Configuración" showBackOnMobile backTo="/overview" />
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-6 text-slate-700">
          Cargando...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración"
        subtitle="Gestioná tu clínica, horarios, servicios e integraciones en un solo lugar."
        showBackOnMobile
        backTo="/overview"
        action={
          <button
            type="button"
            onClick={save}
            disabled={saving || !isDirty}
            className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-[#F4F5F7] disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        }
      />

      {notice ? (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-4 text-sm text-slate-700">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-4 text-sm text-slate-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-3 lg:hidden">
        {tabs.map((t) => {
          const open = openSection === t.key;
          return (
            <div key={t.key} className="rounded-3xl border border-[#E5E7EB] bg-white">
              <button
                type="button"
                onClick={() => setOpenSection(open ? null : t.key)}
                className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-slate-900"
              >
                {t.label}
                <span className="text-slate-500">{open ? "−" : "+"}</span>
              </button>
              {open ? (
                <div className="border-t border-[#E5E7EB] p-4">
                  {t.key === "integraciones" && renderIntegrations()}
                  {t.key === "clinica" && renderClinica()}
                  {t.key === "horario" && renderHorario()}
                  {t.key === "servicios" && renderServicios()}
                  {t.key === "faqs" && renderFaqs()}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="hidden lg:flex flex-wrap gap-2 rounded-3xl border border-[#E5E7EB] bg-[#F4F5F7] p-2">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                active ? "bg-[#F4F5F7] text-slate-900" : "text-slate-700 hover:bg-[#F4F5F7] hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="hidden lg:block">
        {tab === "integraciones" && renderIntegrations()}
        {tab === "clinica" && renderClinica()}
        {tab === "horario" && renderHorario()}
        {tab === "servicios" && renderServicios()}
        {tab === "faqs" && renderFaqs()}
      </div>

      <Modal
        open={guideOpen !== null}
        title="Guía de integración"
        description="Pasos simples para conectar tu canal de comunicación."
        onClose={() => setGuideOpen(null)}
        actions={
          <button
            type="button"
            onClick={() => setGuideOpen(null)}
            className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-95"
          >
            Entendido
          </button>
        }
      >
        <div className="space-y-3 text-sm text-slate-700">
          <div className="flex items-start gap-3">
            <Globe className="mt-0.5 h-4 w-4 text-slate-700" />
            <span>Confirma el nombre comercial y los datos de contacto de tu clínica.</span>
          </div>
          <div className="flex items-start gap-3">
            <PhoneCall className="mt-0.5 h-4 w-4 text-slate-700" />
            <span>Ten a mano el canal principal (página o línea) para la validación.</span>
          </div>
          <div className="flex items-start gap-3">
            <BadgeCheck className="mt-0.5 h-4 w-4 text-slate-700" />
            <span>Enviá la solicitud y nuestro equipo te acompañará en la activación.</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={requestOpen !== null}
        title="Conectar canal"
        description="Completá los datos para iniciar la solicitud de conexión."
        onClose={() => setRequestOpen(null)}
        actions={
          <>
            <button
              type="button"
              onClick={() => setRequestOpen(null)}
              className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => requestOpen && submitIntegrationRequest(requestOpen)}
              className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-95"
            >
              Enviar solicitud
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-700">Nombre comercial</label>
            <input
              value={requestForm.business}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, business: e.target.value }))}
              className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">Teléfono de contacto</label>
            <input
              value={requestForm.phone}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, phone: e.target.value }))}
              className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">Página o usuario</label>
            <input
              value={requestForm.handle}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, handle: e.target.value }))}
              className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
              placeholder="Ej: @clinica"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={waitlistOpen}
        title="Lista de espera"
        description="Dejanos tu email para avisarte cuando esté habilitado."
        onClose={() => setWaitlistOpen(false)}
        actions={
          <>
            <button
              type="button"
              onClick={() => setWaitlistOpen(false)}
              className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F4F5F7]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submitWaitlist}
              className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-95"
            >
              Unirme a lista de espera
            </button>
          </>
        }
      >
        <div>
          <label className="text-xs font-medium text-slate-700">Email</label>
          <input
            value={waitlistEmail}
            onChange={(e) => setWaitlistEmail(e.target.value)}
            className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
            placeholder="tu@email.com"
          />
        </div>
      </Modal>

      <Toast
        open={Boolean(toast)}
        kind={toast?.kind}
        message={toast?.message ?? ""}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
