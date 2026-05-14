type Json = Record<string, unknown>;
import {
  buildEvaluationPriceResponse,
  buildFixedPriceResponse,
  buildVariablePriceResponse,
  findDentalServiceByText,
  getVariablePriceReason,
  isVariablePriceService,
} from "./dental/index.ts";

export type DentalServiceTemplate = {
  name: string;
  aliases: string[];
  booking_label: string;
  process_summary: string;
  typical_duration: string;
  appointment_duration_min: number;
  price_from?: number | null;
  price_to?: number | null;
  price?: number | null;
  category: string;
  short_description: string;
  requires_evaluation: boolean;
  price_text?: string;
  price_is_variable?: boolean;
  evaluation_price?: number | null;
  evaluation_duration?: string;
  price_reason?: string;
  included_items?: string[];
  payment_options?: string[];
  price_policy: string;
  safety_disclaimer: string;
  booking_allowed?: boolean;
  common_reasons?: string[];
  estimated_duration_min?: number;
  safe_disclaimer?: string;
};

const DEFAULT_TIMEZONE = "America/Tegucigalpa";
const DEFAULT_SAME_DAY_CUTOFF = "15:00";
const DEFAULT_EVALUATION_NAME = "evaluación";
const DEFAULT_EVALUATION_PRICE = 500;
const DEFAULT_EVALUATION_DURATION_MINUTES = 30;
const DEFAULT_CURRENCY = "HNL";

export const DEFAULT_DENTAL_SERVICE_TEMPLATES: DentalServiceTemplate[] = [
  {
    name: "Limpieza dental",
    aliases: ["limpieza", "limpueza", "profilaxis", "cleaning"],
    booking_label: "Limpieza dental",
    process_summary: "Se realiza limpieza profesional para remover placa y sarro, y dejar tus encías más saludables.",
    typical_duration: "Aproximadamente 45 minutos.",
    appointment_duration_min: 45,
    price_from: null,
    price_to: null,
    category: "preventivo",
    short_description: "Remueve placa y sarro para mantener dientes y encías sanos.",
    common_reasons: ["mantenimiento", "encías inflamadas leves", "prevención"],
    requires_evaluation: false,
    price_policy: "Se confirma según evaluación inicial y estado periodontal.",
    safety_disclaimer: "Esta información es orientativa y no reemplaza una valoración clínica.",
  },
  {
    name: "Blanqueamiento dental",
    aliases: ["blanqueamiento", "whitening", "blanqueo"],
    booking_label: "Blanqueamiento",
    process_summary: "Primero se revisa el estado de tus dientes y luego se define el protocolo adecuado para aclarar el tono.",
    typical_duration: "Entre 45 y 60 minutos por sesión.",
    appointment_duration_min: 60,
    price_from: null,
    price_to: null,
    category: "estético",
    short_description: "Aclara el tono dental con protocolos clínicos supervisados.",
    common_reasons: ["manchas", "estética de sonrisa", "evento especial"],
    requires_evaluation: true,
    price_policy: "El precio depende del protocolo y se confirma en valoración.",
    safety_disclaimer: "No todos los casos aplican al mismo protocolo; requiere evaluación.",
  },
  {
    name: "Ortodoncia / brackets",
    aliases: ["ortodoncia", "brackets", "frenos", "frenillo", "frenillos", "braces"],
    booking_label: "Ortodoncia / brackets",
    process_summary: "Se hace una revisión inicial para evaluar tu mordida y luego se define un plan de ortodoncia personalizado.",
    typical_duration: "En muchos casos entre 1 y 3 años, según el plan indicado.",
    appointment_duration_min: 45,
    price_from: null,
    price_to: null,
    category: "ortopedia/oclusión",
    short_description: "Corrige alineación dental y mordida con plan personalizado.",
    common_reasons: ["apiñamiento", "mordida", "estética funcional"],
    requires_evaluation: true,
    price_policy: "El plan y costo se definen tras diagnóstico y estudio clínico.",
    safety_disclaimer: "El tiempo total de tratamiento varía según cada caso.",
  },
  {
    name: "Extracción",
    aliases: ["extracción", "extraccion", "sacar muela", "muela"],
    booking_label: "Extracción",
    process_summary: "Primero se evalúa la pieza dental para definir si la extracción es la mejor opción.",
    typical_duration: "Aproximadamente 40 a 60 minutos según complejidad.",
    appointment_duration_min: 50,
    price_from: null,
    price_to: null,
    category: "quirúrgico",
    short_description: "Retiro de una pieza dental cuando está clínicamente indicado.",
    common_reasons: ["dolor severo", "pieza fracturada", "muela del juicio"],
    requires_evaluation: true,
    price_policy: "Se confirma según complejidad quirúrgica y diagnóstico.",
    safety_disclaimer: "La indicación depende de valoración clínica y radiográfica.",
  },
  {
    name: "Implantes",
    aliases: ["implante", "implantes", "implant"],
    booking_label: "Implantes",
    process_summary: "Se revisa tu caso para definir si conviene implante u otra alternativa de rehabilitación.",
    typical_duration: "La primera valoración suele durar 45 a 60 minutos.",
    appointment_duration_min: 60,
    price_from: null,
    price_to: null,
    category: "rehabilitación",
    short_description: "Reemplazo de piezas ausentes con planificación funcional y estética.",
    common_reasons: ["pérdida dental", "rehabilitación", "masticación"],
    requires_evaluation: true,
    price_policy: "El costo depende del plan quirúrgico y protésico.",
    safety_disclaimer: "Requiere valoración integral para confirmar viabilidad.",
  },
  {
    name: "Carillas",
    aliases: ["carillas", "carillas dentales", "veneers"],
    booking_label: "Carillas",
    process_summary: "Se evalúan forma, color y sonrisa para definir el diseño más adecuado para vos.",
    typical_duration: "La valoración inicial suele durar 45 a 60 minutos.",
    appointment_duration_min: 60,
    price_from: null,
    price_to: null,
    category: "estético",
    short_description: "Mejora estética de forma y color dental con diseño de sonrisa.",
    common_reasons: ["fracturas leves", "estética", "desgaste"],
    requires_evaluation: true,
    price_policy: "Se define según material y plan estético personalizado.",
    safety_disclaimer: "La indicación depende del estado dental y objetivos del paciente.",
  },
  {
    name: "Endodoncia",
    aliases: ["endodoncia", "root canal", "nervio"],
    booking_label: "Endodoncia",
    process_summary: "Se revisa la pieza para confirmar si requiere tratamiento del nervio y conservar el diente.",
    typical_duration: "Generalmente entre 60 y 90 minutos, según la pieza.",
    appointment_duration_min: 75,
    price_from: null,
    price_to: null,
    category: "restaurador",
    short_description: "Tratamiento del conducto para preservar la pieza dental.",
    common_reasons: ["dolor intenso", "infección pulpar", "sensibilidad persistente"],
    requires_evaluation: true,
    price_policy: "El costo varía por pieza y complejidad clínica.",
    safety_disclaimer: "Se confirma con diagnóstico clínico y radiográfico.",
  },
  {
    name: "Resina / restauración",
    aliases: ["resina", "calza", "restauración", "restauracion", "empaste"],
    booking_label: "Resina / restauración",
    process_summary: "Se evalúa la pieza para restaurarla y recuperar función y estética.",
    typical_duration: "Aproximadamente 30 a 60 minutos según el caso.",
    appointment_duration_min: 45,
    price_from: null,
    price_to: null,
    category: "restaurador",
    short_description: "Restauración estética y funcional para piezas con caries o fracturas leves.",
    common_reasons: ["caries", "pieza quebrada", "restauración"],
    requires_evaluation: true,
    price_policy: "Se define según extensión y diagnóstico clínico.",
    safety_disclaimer: "Requiere valoración para confirmar el plan ideal.",
  },
  {
    name: "Revisión dental",
    aliases: ["valoración", "evaluación", "consulta", "revision", "revisión"],
    booking_label: "Revisión dental",
    process_summary: "Se revisan tus síntomas y se define el siguiente paso de tratamiento de forma clara.",
    typical_duration: "Usualmente entre 25 y 40 minutos.",
    appointment_duration_min: 30,
    price_from: null,
    price_to: null,
    category: "diagnóstico",
    short_description: "Consulta para revisar síntomas y definir plan de tratamiento.",
    common_reasons: ["dolor", "control", "segunda opinión"],
    requires_evaluation: false,
    price_policy: "La consulta de valoración se informa según política de clínica.",
    safety_disclaimer: "No sustituye diagnóstico definitivo sin revisión presencial.",
  },
  {
    name: "Gingivitis / encías sangrantes",
    aliases: ["encía", "encia", "sangrado de encía", "gingivitis"],
    booking_label: "Revisión dental",
    process_summary: "Se evalúa la inflamación y sangrado para definir el manejo más adecuado y prevenir que avance.",
    typical_duration: "La revisión inicial suele durar 30 a 40 minutos.",
    appointment_duration_min: 40,
    price_from: null,
    price_to: null,
    category: "periodoncia",
    short_description: "Evaluación y manejo de inflamación gingival y sangrado de encías.",
    common_reasons: ["sangrado al cepillar", "inflamación", "mal aliento"],
    requires_evaluation: true,
    price_policy: "El plan se define según evaluación periodontal.",
    safety_disclaimer: "No se emite diagnóstico por chat; requiere valoración clínica.",
  },
];

function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeServiceName(value: string): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function toTemplate(input: unknown): DentalServiceTemplate | null {
  if (typeof input === "string") {
    const name = input.trim();
    if (!name) return null;
    return {
      name,
      category: "general",
      short_description: `Servicio de ${name.toLowerCase()} con evaluación clínica según tu caso.`,
      process_summary: `Primero se realiza una revisión para definir el mejor plan para ${name.toLowerCase()}.`,
      typical_duration: "La duración depende del caso y se confirma en valoración.",
      appointment_duration_min: 30,
      booking_label: name,
      price_from: null,
      price_to: null,
      price: null,
      common_reasons: [],
      estimated_duration_min: 30,
      requires_evaluation: true,
      price_text: "",
      price_is_variable: true,
      evaluation_price: null,
      evaluation_duration: "",
      price_reason: "",
      included_items: [],
      payment_options: [],
      booking_allowed: true,
      price_policy: "Se confirma en valoración clínica.",
      safety_disclaimer: "No se emite diagnóstico por chat; se recomienda valoración.",
      safe_disclaimer: "No se emite diagnóstico por chat; se recomienda valoración.",
      aliases: [name],
    };
  }
  if (!input || typeof input !== "object") return null;
  const row = input as Json;
  const name = safeStr(row.name, "").trim();
  if (!name) return null;
  return {
    name,
    category: safeStr(row.category, "general"),
    short_description: safeStr(
      row.short_description,
      `Servicio de ${name.toLowerCase()} con evaluación clínica según tu caso.`,
    ),
    process_summary: safeStr(
      row.process_summary,
      `Primero se realiza una revisión para definir el mejor plan para ${name.toLowerCase()}.`,
    ),
    typical_duration: safeStr(
      row.typical_duration,
      "La duración depende del caso y se confirma en valoración.",
    ),
    appointment_duration_min: Number(row.appointment_duration_min) ||
      Number(row.estimated_duration_min) || 30,
    booking_label: safeStr(row.booking_label, name),
    price_from: row.price_from == null ? null : Number(row.price_from),
    price_to: row.price_to == null ? null : Number(row.price_to),
    price: row.price == null ? null : Number(row.price),
    common_reasons: Array.isArray(row.common_reasons)
      ? (row.common_reasons as unknown[]).map((v) => safeStr(v, "")).filter(Boolean)
      : [],
    estimated_duration_min: Number(row.estimated_duration_min) || 30,
    requires_evaluation: row.requires_evaluation !== false,
    price_text: safeStr(row.price_text, ""),
    price_is_variable: row.price_is_variable !== false,
    evaluation_price: row.evaluation_price == null ? null : Number(row.evaluation_price),
    evaluation_duration: safeStr(row.evaluation_duration, ""),
    price_reason: safeStr(row.price_reason, ""),
    included_items: Array.isArray(row.included_items)
      ? (row.included_items as unknown[]).map((v) => safeStr(v, "")).filter(Boolean)
      : [],
    payment_options: Array.isArray(row.payment_options)
      ? (row.payment_options as unknown[]).map((v) => safeStr(v, "")).filter(Boolean)
      : [],
    booking_allowed: row.booking_allowed !== false,
    price_policy: safeStr(row.price_policy, "Se confirma en valoración clínica."),
    safety_disclaimer: safeStr(
      row.safety_disclaimer,
      safeStr(
        row.safe_disclaimer,
        "No se emite diagnóstico por chat; se recomienda valoración.",
      ),
    ),
    safe_disclaimer: safeStr(
      row.safe_disclaimer,
      "No se emite diagnóstico por chat; se recomienda valoración.",
    ),
    aliases: Array.isArray(row.aliases)
      ? (row.aliases as unknown[]).map((v) => safeStr(v, "")).filter(Boolean)
      : [name],
  };
}

export function mergeDentalServiceTemplates(
  existingServices?: unknown[],
): DentalServiceTemplate[] {
  const configured = Array.isArray(existingServices)
    ? existingServices.map(toTemplate).filter((v): v is DentalServiceTemplate => Boolean(v))
    : [];

  const merged = new Map<string, DentalServiceTemplate>();
  for (const def of DEFAULT_DENTAL_SERVICE_TEMPLATES) {
    merged.set(normalizeServiceName(def.name), { ...def });
  }
  for (const svc of configured) {
    const key = normalizeServiceName(svc.name);
    const base = merged.get(key);
    if (base) {
      merged.set(key, {
        ...base,
        ...svc,
        aliases: Array.from(
          new Set([...(base.aliases ?? []), ...(svc.aliases ?? []), svc.name]),
        ),
      });
    } else {
      merged.set(key, svc);
    }
  }
  return Array.from(merged.values());
}

function isServiceEnabledForOrg(
  service: DentalServiceTemplate,
  clinicSettings?: Record<string, unknown>,
): boolean {
  const configured = Array.isArray(clinicSettings?.services)
    ? (clinicSettings?.services as unknown[])
    : [];
  if (configured.length === 0) return true;
  const normalizedService = normalizeServiceName(service.name);
  const configuredTemplates = configured
    .map((item) => toTemplate(item))
    .filter((item): item is DentalServiceTemplate => Boolean(item));
  return configuredTemplates.some((item) => {
    if (item.booking_allowed === false) return false;
    const itemName = normalizeServiceName(item.name);
    if (itemName === normalizedService) return true;
    const aliases = [...(item.aliases ?? [])]
      .map((alias) => normalizeServiceName(alias));
    return aliases.some((alias) => alias && normalizedService.includes(alias));
  });
}

const SYMPTOM_KEYWORDS = [
  "me sangra",
  "sangra",
  "encia",
  "encía",
  "gingivitis",
  "inflamacion",
  "inflamación",
];

const TOOTH_PAIN_KEYWORDS = [
  "me duele la muela",
  "duele la muela",
  "dolor de muela",
  "muela",
  "me duele un diente",
  "dolor en diente",
  "me duele",
  "dolor dental",
];

const MISSING_TOOTH_KEYWORDS = [
  "me hace falta un diente",
  "me falta un diente",
  "falta un diente",
  "perdi un diente",
  "perdí un diente",
  "se me cayo un diente",
  "se me cayó un diente",
];

const SEVERE_EMERGENCY_KEYWORDS = [
  "no puedo respirar",
  "sangrado que no para",
  "accidente fuerte",
  "hinchazon en garganta",
  "hinchazón en garganta",
  "muchisima sangre",
  "muchísima sangre",
  "dolor fuerte",
  "me duele mucho",
  "cara inflamada",
  "infeccion",
  "infección",
  "sangrado",
  "me quebre un diente",
  "me quebré un diente",
  "diente quebrado",
  "pus",
  "absceso",
  "no aguanto el dolor",
];

const BOOKING_HINTS = [
  "agendar",
  "reservar",
  "cita",
  "turno",
  "mañana",
  "hoy",
  "pasado mañana",
];

const SERVICE_INQUIRY_PATTERNS = [
  /\b(ustedes\s+hacen|hacen|ofrecen|trabajan|realizan)\b/,
];

function isExplicitServiceInquiry(message: string): boolean {
  const normalized = normalizeText(message);
  return SERVICE_INQUIRY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isLikelyBookingRequest(message: string): boolean {
  const normalized = normalizeText(message);
  // Do not treat plain "hoy/mañana" as booking by themselves.
  if (
    normalized.includes("agendar") ||
    normalized.includes("reservar") ||
    normalized.includes("quiero una cita") ||
    normalized.includes("me gustaria una cita") ||
    normalized.includes("me gustaría una cita") ||
    normalized.includes("quiero cita") ||
    normalized.includes("sacar turno")
  ) return true;
  if (
    (normalized.includes("hoy") || normalized.includes("mañana") || normalized.includes("pasado mañana")) &&
    (
      normalized.includes("cita") ||
      normalized.includes("agendar") ||
      normalized.includes("reservar") ||
      /a las\s+\d{1,2}(:\d{2})?/.test(normalized)
    )
  ) return true;
  if (BOOKING_HINTS.some((hint) => normalized.includes(hint)) && normalized.includes("cita")) return true;
  if (/a las\s+\d{1,2}(:\d{2})?/.test(normalized)) return true;
  return false;
}

function findServiceMatch(
  message: string,
  services: DentalServiceTemplate[],
): DentalServiceTemplate | null {
  const catalogMatch = findDentalServiceByText(message);
  if (catalogMatch) {
    const catalogTokens = [catalogMatch.name, ...catalogMatch.aliases]
      .map((token) => normalizeText(token))
      .filter(Boolean);
    const mapped = services.find((service) => {
      const aliases = [service.name, ...(service.aliases ?? [])]
        .map((token) => normalizeText(token))
        .filter(Boolean);
      return aliases.some((alias) =>
        catalogTokens.some((token) => alias.includes(token) || token.includes(alias))
      );
    });
    if (mapped) return mapped;
  }

  const normalized = normalizeText(message);
  for (const service of services) {
    const aliases = [
      service.name,
      ...(service.aliases ?? []),
    ].map((s) => normalizeText(s)).filter(Boolean);
    if (aliases.some((alias) => normalized.includes(alias))) return service;
  }
  return null;
}

function buildHumanServiceText(service: DentalServiceTemplate): string {
  const name = normalizeServiceName(service.name);
  if (name.includes("extraccion")) {
    return "Cuando una muela duele mucho o está dañada, lo mejor es revisarla para definir la mejor solución.";
  }
  if (name.includes("ortodoncia")) {
    return "La ortodoncia ayuda a alinear dientes y mordida para mejorar función y estética.";
  }
  if (name.includes("blanqueamiento")) {
    return "El blanqueamiento ayuda a mejorar el tono de la sonrisa de forma segura en clínica.";
  }
  if (name.includes("implante")) {
    return "Cuando falta un diente, hay opciones para recuperar función y estética, como implantes u otras alternativas.";
  }
  if (name.includes("endodoncia")) {
    return "Cuando hay dolor interno de una pieza, se evalúa si conviene tratarla para conservarla.";
  }
  if (name.includes("carillas")) {
    return "Las carillas ayudan a mejorar forma y apariencia de la sonrisa según tu caso.";
  }
  if (name.includes("limpieza")) {
    return "La limpieza ayuda a mantener dientes y encías sanos y prevenir molestias.";
  }
  return service.short_description;
}

export function toPatientFacingServiceLabel(service: string): string {
  const normalized = normalizeServiceName(service);
  if (normalized.includes("ortodoncia") || normalized.includes("bracket") || normalized.includes("frenillo")) {
    return "Ortodoncia / brackets";
  }
  if (
    normalized.includes("evaluacion") ||
    normalized.includes("valoracion") ||
    normalized.includes("consulta general")
  ) {
    return "Revisión dental";
  }
  return service;
}

export function hasServiceLikeSignal(message: string): boolean {
  const normalized = normalizeText(message);
  return /(frenillos?|brackets?|blanqueamiento|blanqueo|limpieza|dolor|muela|encia|enc[ií]a|implante|diente|carillas?|endodoncia|nervio|resina|calza|restauraci[oó]n|tratamiento)/i
    .test(normalized);
}

function shouldOfferToday(clinicSettings?: Record<string, unknown>): boolean {
  const timezone = safeStr(clinicSettings?.timezone, DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const cutoff = safeStr(clinicSettings?.same_day_booking_cutoff, DEFAULT_SAME_DAY_CUTOFF).trim() || DEFAULT_SAME_DAY_CUTOFF;
  const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
  if (Number.isNaN(nowLocal.valueOf())) return true;
  const m = cutoff.match(/^(\d{1,2}):(\d{2})$/);
  const cutoffMin = m ? Number(m[1]) * 60 + Number(m[2]) : 15 * 60;
  const nowMin = nowLocal.getHours() * 60 + nowLocal.getMinutes();
  return nowMin < cutoffMin;
}

function bookingDayPrompt(clinicSettings?: Record<string, unknown>): string {
  if (shouldOfferToday(clinicSettings)) {
    return "¿Te queda mejor hoy o mañana?";
  }
  return "¿Te queda mejor mañana o por la tarde?";
}

type ServiceInfoResolution =
  | { matched: false }
  | {
    matched: true;
    service: DentalServiceTemplate;
    replyText: string;
    force_booking_flow?: boolean;
    booking_service?: string;
  };

function resolvePriceAnswer(
  service: DentalServiceTemplate,
  clinicSettings?: Record<string, unknown>,
): string {
  const configured = Array.isArray(clinicSettings?.services)
    ? (clinicSettings?.services as Record<string, unknown>[])
    : [];
  const targetNames = [service.name, ...(service.aliases ?? [])].map((v) =>
    normalizeServiceName(String(v))
  );
  const row = configured.find((s) => {
    const name = normalizeServiceName(safeStr(s?.name, ""));
    return name && targetNames.some((n) => name.includes(n) || n.includes(name));
  });
  const evaluationConfig = resolveEvaluationConfig(clinicSettings, row, service.name);

  const catalogService = findDentalServiceByText(service.name);
  const extractEval = () => buildEvaluationPriceResponse({
    evaluationName: evaluationConfig.name,
    evaluationPrice: evaluationConfig.price,
    evaluationDurationMinutes: evaluationConfig.durationMinutes,
    currency: evaluationConfig.currency,
  });

  if (!row) {
    if (catalogService && isVariablePriceService(catalogService.id)) {
      if (catalogService.id === "orthodontics") {
        return `El precio de brackets depende del caso, porque el doctor necesita revisar la posición de los dientes, el tipo de tratamiento y el tiempo estimado.\n\nLa evaluación cuesta ${evaluationConfig.currency} ${evaluationConfig.price} y dura aproximadamente ${evaluationConfig.durationMinutes} minutos. Ahí te dan el costo exacto del plan.`;
      }
      return buildVariablePriceResponse({
        serviceId: catalogService.id,
        serviceName: service.name,
        evaluationPrice: evaluationConfig.price,
        evaluationDurationMinutes: evaluationConfig.durationMinutes,
        currency: evaluationConfig.currency,
      });
    }
    const reason = safeStr(service.price_reason, "") ||
      (catalogService ? getVariablePriceReason(catalogService.id) : "depende de la evaluación clínica del caso.");
    return `El precio de ${service.name.toLowerCase()} depende del caso, porque ${reason} ${extractEval()}`;
  }

  const currency = safeStr(row.currency, evaluationConfig.currency);
  const priceText = safeStr((row as any).price_text, safeStr(service.price_text, ""));
  if (priceText) {
    return `${priceText}\n${extractEval()}`;
  }
  const exact = safeStr((row as any).price, "");
  const from = safeStr((row as any).price_from, "");
  const to = safeStr((row as any).price_to, "");
  if (exact) {
    return buildFixedPriceResponse({
      serviceName: service.name,
      currency,
      exactPrice: Number(exact),
    });
  }
  if (from && to) {
    return `${service.name} cuesta aproximadamente entre ${currency} ${from} y ${currency} ${to}. ¿Querés que revisemos horarios disponibles?`;
  }
  if (from) {
    const n = normalizeServiceName(service.name);
    if (n.includes("limpieza")) {
      return `${service.name} inicia desde ${currency} ${from}. Puede variar si se necesita limpieza profunda o tratamiento de encías.`;
    }
    return buildFixedPriceResponse({
      serviceName: service.name,
      currency,
      fromPrice: Number(from),
      isFrom: true,
    });
  }
  const isVariable = (row as any).price_is_variable !== false && service.price_is_variable !== false;
  if (isVariable) {
    if (catalogService && isVariablePriceService(catalogService.id)) {
      if (catalogService.id === "orthodontics") {
        return `El precio de brackets depende del caso, porque el doctor necesita revisar la posición de los dientes, el tipo de tratamiento y el tiempo estimado.\n\nLa evaluación cuesta ${evaluationConfig.currency} ${evaluationConfig.price} y dura aproximadamente ${evaluationConfig.durationMinutes} minutos. Ahí te dan el costo exacto del plan.`;
      }
      const base = buildVariablePriceResponse({
        serviceId: catalogService.id,
        serviceName: service.name,
        evaluationPrice: evaluationConfig.price,
        evaluationDurationMinutes: evaluationConfig.durationMinutes,
        currency: evaluationConfig.currency,
      });
      const customReason = safeStr((row as any).price_reason, safeStr(service.price_reason, ""));
      if (customReason) {
        return `El precio de ${service.name.toLowerCase()} depende del caso, porque ${customReason} ${extractEval()}`;
      }
      return base;
    }
    const reason = safeStr((row as any).price_reason, safeStr(service.price_reason, "")) || "depende de la evaluación clínica del caso.";
    return `El precio de ${service.name.toLowerCase()} depende del caso, porque ${reason} ${extractEval()}`;
  }
  return `El precio de ${service.name.toLowerCase()} depende del caso. ${extractEval()}`;
}

function resolveEvaluationConfig(
  clinicSettings?: Record<string, unknown>,
  evalRow?: Record<string, unknown>,
  contextServiceName?: string,
): { name: string; price: number; durationMinutes: number; currency: string } {
  const configured = Array.isArray(clinicSettings?.services)
    ? (clinicSettings?.services as Record<string, unknown>[])
    : [];
  const matchedEvalRow = evalRow ?? configured.find((s) => {
    const name = normalizeServiceName(safeStr(s?.name, ""));
    return name.includes("revision dental") || name.includes("valoracion") ||
      name.includes("evaluacion") || name.includes("consulta");
  });
  const name = safeStr(
    clinicSettings?.evaluation_name ?? matchedEvalRow?.evaluation_name,
    DEFAULT_EVALUATION_NAME,
  );
  const priceValue = matchedEvalRow?.evaluation_price ?? matchedEvalRow?.price ?? clinicSettings?.evaluation_price;
  const durationValue = matchedEvalRow?.evaluation_duration_minutes ??
    clinicSettings?.evaluation_duration_minutes ??
    matchedEvalRow?.evaluation_duration;
  const numericPrice = Number(priceValue);
  const price = Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice : DEFAULT_EVALUATION_PRICE;
  const numericDuration = Number(durationValue);
  let fallbackDuration = DEFAULT_EVALUATION_DURATION_MINUTES;
  const context = normalizeServiceName(safeStr(contextServiceName, ""));
  if (
    context.includes("ortodoncia") || context.includes("bracket") || context.includes("frenillo") ||
    context.includes("implante") || context.includes("endodoncia") || context.includes("carilla") ||
    context.includes("corona") || context.includes("periodoncia") || context.includes("limpieza profunda")
  ) {
    fallbackDuration = 45;
  }
  if (context.includes("emergencia") || context.includes("urgencia") || context.includes("dolor")) {
    fallbackDuration = 30;
  }
  const durationMinutes = Number.isFinite(numericDuration) && numericDuration > 0
    ? numericDuration
    : fallbackDuration;
  const currency = safeStr(
    clinicSettings?.currency ?? matchedEvalRow?.currency,
    DEFAULT_CURRENCY,
  );
  return { name, price, durationMinutes, currency };
}

function resolveEvaluationPriceAnswer(
  clinicSettings?: Record<string, unknown>,
  mode: "price_only" | "duration_only" | "full" = "full",
  contextServiceName?: string,
): string {
  const evaluation = resolveEvaluationConfig(clinicSettings, undefined, contextServiceName);
  if (mode === "duration_only") {
    return `La ${evaluation.name} dura aproximadamente ${evaluation.durationMinutes} minutos.`;
  }
  if (mode === "price_only") {
    return `La ${evaluation.name} cuesta ${evaluation.currency} ${evaluation.price}.`;
  }
  return buildEvaluationPriceResponse({
    evaluationName: evaluation.name,
    evaluationPrice: evaluation.price,
    evaluationDurationMinutes: evaluation.durationMinutes,
    currency: evaluation.currency,
  });
}

function resolveEvaluationQuestionMode(normalized: string): "price_only" | "duration_only" | "full" {
  const asksDuration = normalized.includes("cuanto dura la evaluacion") ||
    normalized.includes("cuánto dura la evaluación") ||
    normalized.includes("cuanto dura la consulta") ||
    normalized.includes("cuánto dura la consulta") ||
    normalized.includes("duracion de la evaluacion") ||
    normalized.includes("duración de la evaluación") ||
    normalized.includes("duracion de la consulta") ||
    normalized.includes("duración de la consulta");
  const asksPrice = normalized.includes("cuanto vale la evaluacion") ||
    normalized.includes("cuánto vale la evaluación") ||
    normalized.includes("cuanto cuesta la evaluacion") ||
    normalized.includes("cuánto cuesta la evaluación") ||
    normalized.includes("cuanto vale la consulta") ||
    normalized.includes("cuánto vale la consulta") ||
    normalized.includes("cuanto cuesta la consulta") ||
    normalized.includes("cuánto cuesta la consulta") ||
    normalized.includes("la revision cuesta") ||
    normalized.includes("la revisión cuesta") ||
    normalized.includes("la revision es gratis") ||
    normalized.includes("la revisión es gratis") ||
    normalized.includes("cobran evaluacion") ||
    normalized.includes("cobran evaluación") ||
    normalized.includes("cobran consulta");
  const asksStrictPriceOnly = normalized.includes("la revision cuesta") ||
    normalized.includes("la revisión cuesta") ||
    normalized.includes("la revision es gratis") ||
    normalized.includes("la revisión es gratis") ||
    normalized.includes("cobran evaluacion") ||
    normalized.includes("cobran evaluación") ||
    normalized.includes("cobran consulta");
  if (asksDuration && !asksPrice) return "duration_only";
  if (asksPrice && !asksDuration) return asksStrictPriceOnly ? "price_only" : "full";
  return "full";
}

function isEvaluationQuestion(normalized: string): boolean {
  return /\b(cuanto vale la evaluacion|cuanto cuesta la evaluacion|cuanto vale la consulta|cuanto cuesta la consulta|cuanto dura la evaluacion|cuanto dura la consulta|la revision cuesta|la revision es gratis|cobran evaluacion|cobran consulta|precio de la valoracion|duracion de la evaluacion)\b/i
    .test(normalized);
}

export function resolveDentalServiceInfo(args: {
  message: string;
  clinicSettings?: Record<string, unknown>;
}): ServiceInfoResolution {
  const message = safeStr(args.message, "");
  const normalized = normalizeText(message);
  const hasBasicPriceSignal = normalized.includes("precio") ||
    normalized.includes("costo") ||
    normalized.includes("valor") ||
    normalized.includes("tarifa") ||
    normalized.includes("cuanto cuesta") ||
    normalized.includes("cuánto cuesta") ||
    normalized.includes("cuanto vale") ||
    normalized.includes("cuánto vale") ||
    normalized.includes("cuanto valen") ||
    normalized.includes("cuánto valen");
  const isEvaluationPriceQuestion = isEvaluationQuestion(normalized);
  const evaluationQuestionMode = resolveEvaluationQuestionMode(normalized);
  const asksWhyNoExactPrice =
    normalized.includes("por que no me puede dar precio exacto") ||
    normalized.includes("por qué no me puede dar precio exacto");
  const services = mergeDentalServiceTemplates(
    Array.isArray(args.clinicSettings?.services)
      ? (args.clinicSettings?.services as unknown[])
      : [],
  );
  const explicitServiceInquiry = isExplicitServiceInquiry(message);

  const emergency = SEVERE_EMERGENCY_KEYWORDS.some((k) => normalized.includes(k));
  if (emergency) {
    const clinicOpenNow = args.clinicSettings?.clinic_open_now === true;
    const emergencyService = services.find((s) =>
      normalizeServiceName(s.name).includes("revision")
    ) ?? DEFAULT_DENTAL_SERVICE_TEMPLATES.find((s) => s.name === "Revisión dental")!;
    return {
      matched: true,
      service: emergencyService,
      replyText: clinicOpenNow
        ? "Lamento que estés pasando por eso. Por lo que contás, es mejor que recepción lo revise lo antes posible.\n\nPuedo ayudarte a buscar el espacio más cercano disponible o pasarte con recepción."
        : "Lamento que estés pasando por eso. Por lo que contás, sería mejor buscar atención lo antes posible. Si el dolor, inflamación o sangrado es fuerte, contactá un servicio de urgencias o atención médica cercana.\n\nTambién puedo ayudarte a revisar el primer espacio disponible de la clínica.",
    };
  }

  const toothPainMatch = TOOTH_PAIN_KEYWORDS.some((k) => normalized.includes(k));
  if (toothPainMatch && !explicitServiceInquiry && !hasBasicPriceSignal) {
    const evalService = services.find((s) =>
      normalizeServiceName(s.name).includes("revision")
    ) ?? DEFAULT_DENTAL_SERVICE_TEMPLATES.find((s) =>
      s.name === "Revisión dental"
    )!;
    return {
      matched: true,
      service: evalService,
      force_booking_flow: true,
      booking_service: "Revisión dental",
      replyText: (
        "Entiendo, eso puede ser bastante incómodo 😕\nLo mejor es revisarlo a tiempo para evitar que empeore.\n\nPuedo ayudarte a agendar una valoración rápida.\n\n¿Te queda mejor hoy o mañana?"
      )
        .replace("valoración rápida", "revisión dental rápida")
        .replace("¿Te queda mejor hoy o mañana?", bookingDayPrompt(args.clinicSettings)),
    };
  }

  const missingToothMatch = MISSING_TOOTH_KEYWORDS.some((k) => normalized.includes(k));
  if (missingToothMatch && !explicitServiceInquiry && !hasBasicPriceSignal) {
    const evalService = services.find((s) =>
      normalizeServiceName(s.name).includes("revision")
    ) ?? DEFAULT_DENTAL_SERVICE_TEMPLATES.find((s) =>
      s.name === "Revisión dental"
    )!;
    return {
      matched: true,
      service: evalService,
      force_booking_flow: true,
      booking_service: "Revisión dental",
      replyText: (
        "Entiendo. Cuando falta un diente, lo ideal es revisarlo para definir la mejor opción para vos.\n\nPuedo ayudarte a agendar una valoración rápida.\n\n¿Te queda mejor hoy o mañana?"
      )
        .replace("valoración rápida", "revisión dental rápida")
        .replace("¿Te queda mejor hoy o mañana?", bookingDayPrompt(args.clinicSettings)),
    };
  }

  const symptomMatch = SYMPTOM_KEYWORDS.some((k) => normalized.includes(k));
  if (symptomMatch && !explicitServiceInquiry && !hasBasicPriceSignal) {
    const evalService = services.find((s) =>
      normalizeServiceName(s.name).includes("revision")
    ) ?? DEFAULT_DENTAL_SERVICE_TEMPLATES.find((s) =>
      s.name === "Revisión dental"
    )!;
    return {
      matched: true,
      service: evalService,
      force_booking_flow: true,
      booking_service: "Revisión dental",
      replyText: (
        "Entiendo, eso puede ser incómodo 😕\nLo ideal es revisarlo a tiempo para evitar que empeore.\n\nPuedo ayudarte a agendar una valoración rápida.\n\n¿Te queda mejor hoy o mañana?"
      )
        .replace("valoración rápida", "revisión dental rápida")
        .replace("¿Te queda mejor hoy o mañana?", bookingDayPrompt(args.clinicSettings)),
    };
  }

  const matched = findServiceMatch(message, services);
  if (!matched && (isEvaluationPriceQuestion || asksWhyNoExactPrice)) {
    const evalService = services.find((s) =>
      normalizeServiceName(s.name).includes("revision")
    ) ?? DEFAULT_DENTAL_SERVICE_TEMPLATES.find((s) =>
      s.name === "Revisión dental"
    )!;
    const evaluationLine = resolveEvaluationPriceAnswer(args.clinicSettings, evaluationQuestionMode);
    return {
      matched: true,
      service: evalService,
      booking_service: "Revisión dental",
      replyText: asksWhyNoExactPrice
        ? `Porque sin revisión clínica no se puede confirmar un precio exacto de forma responsable. Cada caso cambia según diagnóstico, complejidad y tratamiento indicado.\n\n${evaluationLine}\n\n¿Querés que revisemos horarios?`
        : `${evaluationLine}\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para la evaluación?`,
    };
  }
  if (!matched) return { matched: false };

  if (!isServiceEnabledForOrg(matched, args.clinicSettings)) {
    return {
      matched: true,
      service: matched,
      booking_service: matched.booking_label,
      replyText:
        "Ese servicio tendría que confirmarlo recepción directamente, porque no quiero darte información incorrecta.\n\nSi querés, puedo ayudarte con los servicios que sí están disponibles o pasar tu consulta a recepción.",
    };
  }

  const isPriceQuestion = normalized.includes("precio") ||
    normalized.includes("costo") ||
    normalized.includes("valor") ||
    normalized.includes("tarifa") ||
    normalized.includes("cuanto cuesta") ||
    normalized.includes("cuánto cuesta") ||
    normalized.includes("cuanto vale") ||
    normalized.includes("cuánto vale") ||
    normalized.includes("cuanto valen") ||
    normalized.includes("cuánto valen");
  const isDurationOrProcessQuestion =
    normalized.includes("duracion") ||
    normalized.includes("duración") ||
    normalized.includes("cuanto dura") ||
    normalized.includes("cuánto dura") ||
    normalized.includes("cuanto tiempo") ||
    normalized.includes("cuánto tiempo") ||
    normalized.includes("proceso") ||
    normalized.includes("como funciona") ||
    normalized.includes("cómo funciona");
  const explanation = buildHumanServiceText(matched);
  const priceLine = isEvaluationPriceQuestion
    ? resolveEvaluationPriceAnswer(args.clinicSettings, evaluationQuestionMode, matched.name)
    : isPriceQuestion
    ? resolvePriceAnswer(matched, args.clinicSettings)
    : matched.requires_evaluation
    ? "Lo ideal es una revisión dental para confirmar la mejor opción."
    : "Te podemos orientar en una revisión breve.";

  return {
    matched: true,
    service: matched,
    booking_service: matched.booking_label,
    replyText: isEvaluationPriceQuestion
      ? `${priceLine}\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para la evaluación?`
      : asksWhyNoExactPrice
      ? `Porque sin revisión clínica no se puede confirmar un precio exacto de forma responsable. Cada caso cambia según diagnóstico, complejidad y tratamiento indicado.\n\n${resolveEvaluationPriceAnswer(args.clinicSettings, "full", matched.name)}\n\n¿Querés que revisemos horarios?`
      : isPriceQuestion
      ? `${priceLine}\n\n${
        normalizeServiceName(matched.name).includes("limpieza")
          ? "¿Tenés alguna otra pregunta o querés que revisemos horarios para una limpieza?"
          : "¿Tenés alguna otra pregunta o querés que revisemos horarios para la evaluación?"
      }`
      : isDurationOrProcessQuestion
      ? `${matched.process_summary}\n\n${matched.typical_duration}\n\nSi querés, te ayudo a agendar esa revisión.`
      : (() => {
        const normalizedName = normalizeServiceName(matched.name);
        if (explicitServiceInquiry && (normalizedName.includes("ortodoncia") || normalizedName.includes("bracket"))) {
          return "Sí, hacemos ortodoncia/brackets. Primero se realiza una evaluación para revisar tu caso, ver la posición de los dientes y definir el tratamiento adecuado.\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para la evaluación?";
        }
        if (explicitServiceInquiry && normalizedName.includes("limpieza")) {
          return "Sí, hacemos limpieza dental. La limpieza ayuda a mantener dientes y encías sanos y prevenir molestias.\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para una limpieza?";
        }
        if (explicitServiceInquiry && normalizedName.includes("extraccion")) {
          return "Sí, realizamos extracciones dentales. Primero el doctor revisa la pieza para confirmar si es una extracción simple, quirúrgica o si hay otra opción de tratamiento.\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para una evaluación?";
        }
        if (normalizedName.includes("ortodoncia") || normalizedName.includes("bracket")) {
          return "Sí, hacemos ortodoncia/brackets. Primero se realiza una evaluación para revisar tu caso, ver la posición de los dientes y definir el tratamiento adecuado.\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para la evaluación?";
        }
        if (normalizedName.includes("limpieza")) {
          return "Sí, hacemos limpieza dental. La limpieza ayuda a mantener dientes y encías sanos y prevenir molestias.\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para una limpieza?";
        }
        if (normalizedName.includes("extraccion")) {
          return "Sí, realizamos extracciones dentales. Primero el doctor revisa la pieza para confirmar si es una extracción simple, quirúrgica o si hay otra opción de tratamiento.\n\n¿Tenés alguna otra pregunta o querés que revisemos horarios para una evaluación?";
        }
        return `${explanation}\n${priceLine}\n\n¿Querés que te ayude a ver horarios para la evaluación?`
          .replace(/\s+/g, " ")
          .trim();
      })(),
  };
}
