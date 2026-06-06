export type BusinessType = "dental" | "barbershop";
export type VerticalId = "dental" | "barberline" | "creatyv";

export type VerticalConfig = {
  id: VerticalId;
  brandName: string;
  businessType: BusinessType | null;
  tagline: string;
  primaryCTA: string;
  dashboardLabel: string;
  theme: {
    accent: string;
    accentSoft: string;
    gradient: string;
  };
  productName: string;
  verticalName: string;
  organizationLabel: string;
  customerLabel: string;
  customersLabel: string;
  providerLabel: string;
  providersLabel: string;
  serviceLabel: string;
  servicesLabel: string;
  agendaTitle: string;
  settingsSubtitle: string;
  defaultServices: Array<{ name: string; price_from?: number | null; currency?: string; duration_min?: number | null; notes?: string }>;
  defaultSpecialties: Array<{ value: string; label: string }>;
  defaultFaqs: Array<{ q: string; a: string }>;
};

export function getVerticalDefaultServices(businessType: string | null | undefined) {
  const cfg = getVerticalConfig(businessType);
  return cfg.defaultServices.map((s) => ({ ...s }));
}

export function getVerticalDefaultSpecialties(businessType: string | null | undefined) {
  const cfg = getVerticalConfig(businessType);
  return cfg.defaultSpecialties.map((s) => ({ ...s }));
}

export function getVerticalDefaultFaqs(businessType: string | null | undefined) {
  const cfg = getVerticalConfig(businessType);
  return cfg.defaultFaqs.map((f) => ({ ...f }));
}

const DENTAL_CONFIG: VerticalConfig = {
  id: "dental",
  brandName: "DentalConnect",
  businessType: "dental",
  tagline: "Sistema operativo para clínicas dentales en WhatsApp.",
  primaryCTA: "Entrar al panel dental",
  dashboardLabel: "Panel DentalConnect",
  theme: {
    accent: "#3CBDB9",
    accentSoft: "rgba(60,189,185,0.18)",
    gradient: "from-[#0894C1] via-[#3CBDB9] to-[#59E0B8]",
  },
  productName: "DentalConnect",
  verticalName: "Clínica Dental",
  organizationLabel: "Clínica",
  customerLabel: "Paciente",
  customersLabel: "Pacientes",
  providerLabel: "Doctor",
  providersLabel: "Doctores",
  serviceLabel: "Servicio dental",
  servicesLabel: "Servicios dentales",
  agendaTitle: "Agenda",
  settingsSubtitle: "Gestiona tu clínica, horarios, servicios e integraciones.",
  defaultServices: [
    { name: "Consulta / valoración", price_from: 400, currency: "HNL", duration_min: 30, notes: "Diagnóstico inicial." },
    { name: "Limpieza dental", price_from: 700, currency: "HNL", duration_min: 45, notes: "Incluye evaluacion." },
    { name: "Blanqueamiento", price_from: 1800, currency: "HNL", duration_min: 60, notes: "Requiere evaluación." },
    { name: "Ortodoncia", price_from: 1200, currency: "HNL", duration_min: 45, notes: "" },
  ],
  defaultSpecialties: [
    { value: "general", label: "Clínica general" },
    { value: "ortho", label: "Ortodoncia" },
    { value: "pediatric", label: "Odontopediatría" },
    { value: "endo", label: "Endodoncia" },
    { value: "implants", label: "Implantes" },
    { value: "aesthetic", label: "Estética dental" },
  ],
  defaultFaqs: [
    { q: "¿Tienen disponibilidad hoy?", a: "Podemos revisar disponibilidad. ¿Qué hora te conviene?" },
    { q: "¿Cuánto cuesta una limpieza?", a: "La limpieza inicia desde L 700." },
    { q: "¿Dónde están ubicados?", a: "Te comparto la ubicación." },
    { q: "¿Atienden urgencias?", a: "Sí. ¿Qué síntomas presentas?" },
  ],
};

const BARBERSHOP_CONFIG: VerticalConfig = {
  id: "barberline",
  brandName: "BarberLine",
  businessType: "barbershop",
  tagline: "Sistema operativo para barberías que trabajan desde WhatsApp.",
  primaryCTA: "Entrar al panel BarberLine",
  dashboardLabel: "Panel BarberLine",
  theme: {
    accent: "#25D366",
    accentSoft: "rgba(37,211,102,0.16)",
    gradient: "from-[#25D366] via-[#59E0B8] to-[#0894C1]",
  },
  productName: "BarberLine",
  verticalName: "Barbería",
  organizationLabel: "Barbería",
  customerLabel: "Cliente",
  customersLabel: "Clientes",
  providerLabel: "Barbero",
  providersLabel: "Barberos",
  serviceLabel: "Servicio",
  servicesLabel: "Servicios de barbería",
  agendaTitle: "Agenda BarberLine",
  settingsSubtitle: "Gestiona tu barbería, horarios, barberos, servicios e integraciones.",
  defaultServices: [
    { name: "Corte clásico", price_from: 150, currency: "HNL", duration_min: 30, notes: "" },
    { name: "Corte + barba", price_from: 220, currency: "HNL", duration_min: 45, notes: "" },
    { name: "Barba", price_from: 100, currency: "HNL", duration_min: 20, notes: "" },
    { name: "Cejas", price_from: 80, currency: "HNL", duration_min: 15, notes: "" },
  ],
  defaultSpecialties: [
    { value: "corte", label: "Corte" },
    { value: "barba", label: "Barba" },
    { value: "corte_barba", label: "Corte + barba" },
    { value: "cejas", label: "Cejas" },
    { value: "tinte_diseno", label: "Tinte / diseño" },
  ],
  defaultFaqs: [
    { q: "¿Tienen disponibilidad hoy?", a: "Podemos revisar disponibilidad. ¿Qué hora te conviene?" },
    { q: "¿Cuánto cuesta un corte?", a: "El corte clásico inicia desde L 150." },
    { q: "¿Cuánto cuesta corte + barba?", a: "Corte + barba inicia desde L 220." },
    { q: "¿Dónde están ubicados?", a: "Te comparto la ubicación." },
    { q: "¿Atienden por cita o llegada?", a: "Recomendamos cita para asegurar tu espacio." },
  ],
};

const CREATYV_CONFIG: VerticalConfig = {
  ...DENTAL_CONFIG,
  id: "creatyv",
  brandName: "Creatyv",
  businessType: null,
  tagline: "Sistema operativo para negocios locales usando WhatsApp.",
  primaryCTA: "Entrar al panel",
  dashboardLabel: "Panel Creatyv",
  productName: "Creatyv",
  verticalName: "Negocios locales",
  organizationLabel: "Organización",
  settingsSubtitle: "Gestiona organizaciones, integraciones y operación.",
};

export function getVerticalConfig(businessType: string | null | undefined): VerticalConfig {
  return businessType === "barbershop" ? BARBERSHOP_CONFIG : DENTAL_CONFIG;
}

export function getVerticalConfigById(id: VerticalId): VerticalConfig {
  if (id === "barberline") return BARBERSHOP_CONFIG;
  if (id === "creatyv") return CREATYV_CONFIG;
  return DENTAL_CONFIG;
}

export function detectVerticalFromHostname(hostname: string): VerticalConfig {
  const normalized = String(hostname ?? "").trim().toLowerCase();

  // Vertical routing lives here. Hosting should point every product subdomain
  // at the same React bundle; this function decides which experience to load.
  if (normalized.includes("barberline")) return BARBERSHOP_CONFIG;
  if (normalized.includes("dental")) return DENTAL_CONFIG;
  if (normalized === "creatyv.io" || normalized === "www.creatyv.io") {
    return CREATYV_CONFIG;
  }

  return DENTAL_CONFIG;
}

export function getDetectedVerticalConfig(): VerticalConfig {
  if (typeof window === "undefined") return DENTAL_CONFIG;
  return detectVerticalFromHostname(window.location.hostname);
}
