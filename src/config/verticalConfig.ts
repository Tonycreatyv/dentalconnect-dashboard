export type BusinessType = "dental" | "barbershop";
export type VerticalId = "dental" | "barberline" | "creatyv";

export type VerticalConfig = {
  id: VerticalId;
  brandName: string;
  businessType: BusinessType | null;
  tagline: string;
  primaryCTA: string;
  dashboardLabel: string;
  documentTitle: string;
  emailPlaceholder: string;
  orgSlugFallback: string;
  onboardingOrgQuestion: string;
  onboardingOrgNameLabel: string;
  onboardingOrgInfoCopy: string;
  onboardingMessengerError: string;
  onboardingServicesCopy: string;
  onboardingConnectCopy: string;
  brandPlaceholder: string;
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
  scheduleLabel: string;
  settingsLabel: string;
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
  documentTitle: "DentalConnect - Panel para clínicas dentales",
  emailPlaceholder: "tu@clinica.com",
  orgSlugFallback: "clinica",
  onboardingOrgQuestion: "¿Cómo se llama tu clínica?",
  onboardingOrgNameLabel: "Nombre de la clínica *",
  onboardingOrgInfoCopy: "Esta información aparecerá cuando el bot se comunique con tus pacientes.",
  onboardingMessengerError: "Primero debemos crear la clínica antes de conectar Messenger.",
  onboardingServicesCopy: "Activa los servicios que ofrece tu clínica. Puedes editar duración y precio.",
  onboardingConnectCopy: "Para que el asistente pueda responder mensajes de tus pacientes, necesitamos conectar la página de Facebook de tu clínica.",
  brandPlaceholder: "Ej: Clínica Sonrisa",
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
  scheduleLabel: "Horario",
  settingsLabel: "Ajustes",
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
  tagline: "Panel para barberías que trabajan desde WhatsApp.",
  primaryCTA: "Entrar al panel BarberLine",
  dashboardLabel: "Panel BarberLine",
  documentTitle: "BarberLine - Panel para barberías",
  emailPlaceholder: "contacto@barberia.com",
  orgSlugFallback: "barberia",
  onboardingOrgQuestion: "¿Cómo se llama tu barbería?",
  onboardingOrgNameLabel: "Nombre de la barbería *",
  onboardingOrgInfoCopy: "Esta información aparecerá cuando el bot se comunique con tus clientes.",
  onboardingMessengerError: "Primero debemos crear la barbería antes de conectar Messenger.",
  onboardingServicesCopy: "Activa los servicios que ofrece tu barbería. Puedes editar duración y precio.",
  onboardingConnectCopy: "Para que BarberLine pueda responder mensajes de tus clientes, necesitamos conectar la página de Facebook de tu barbería.",
  brandPlaceholder: "Ej: Barbería Central",
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
  servicesLabel: "Servicios",
  scheduleLabel: "Horarios",
  settingsLabel: "Configuración",
  agendaTitle: "Citas",
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
  documentTitle: "Creatyv - Panel para negocios locales",
  emailPlaceholder: "contacto@negocio.com",
  orgSlugFallback: "negocio",
  onboardingOrgQuestion: "¿Cómo se llama tu negocio?",
  onboardingOrgNameLabel: "Nombre del negocio *",
  onboardingOrgInfoCopy: "Esta información aparecerá cuando el bot se comunique con tus clientes.",
  onboardingMessengerError: "Primero debemos crear el negocio antes de conectar Messenger.",
  onboardingServicesCopy: "Activa los servicios que ofrece tu negocio. Puedes editar duración y precio.",
  onboardingConnectCopy: "Para que el asistente pueda responder mensajes de tus clientes, necesitamos conectar la página de Facebook de tu negocio.",
  brandPlaceholder: "Ej: Mi negocio",
  productName: "Creatyv",
  verticalName: "Negocios locales",
  organizationLabel: "Organización",
  scheduleLabel: "Horarios",
  settingsLabel: "Configuración",
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

export function applyDetectedVerticalDocumentMetadata() {
  if (typeof document === "undefined") return;
  const vertical = getDetectedVerticalConfig();
  document.title = vertical.documentTitle;
  document
    .querySelector('meta[property="og:title"]')
    ?.setAttribute("content", vertical.documentTitle);
  document
    .querySelector('meta[name="twitter:title"]')
    ?.setAttribute("content", vertical.documentTitle);
  document
    .querySelector('meta[property="og:site_name"]')
    ?.setAttribute("content", `${vertical.brandName} by Creatyv`);
  document
    .querySelector('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute("content", vertical.brandName);
}
