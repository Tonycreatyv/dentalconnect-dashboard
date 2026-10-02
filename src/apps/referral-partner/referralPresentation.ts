// Presentation-only contract for the partner delivery inbox. The API currently
// supplies immigration referrals; this resolver intentionally accepts the
// future legal-service intake shapes without asserting that they are live.

export type ReferralService = "immigration" | "auto_accident" | "dui" | "criminal";

type Intake = Record<string, unknown>;

const SERVICE_LABELS: Record<ReferralService, string> = {
  immigration: "Inmigración",
  auto_accident: "Accidente de auto",
  dui: "DUI",
  criminal: "Criminal",
};

const SERVICE_ALIASES: Record<string, ReferralService> = {
  luis_inmigracion: "immigration",
  immigration: "immigration",
  luis_accidente: "auto_accident",
  luis_dui: "dui",
  luis_criminal: "criminal",
  luis_dui_criminal: "dui",
  auto_accident: "auto_accident",
  accident: "auto_accident",
  dui: "dui",
  criminal: "criminal",
};

const TOPIC_LABELS: Record<string, string> = {
  CITIZENSHIP: "Ciudadanía",
  FAMILY_GREEN_CARD: "Petición familiar / Green Card",
  FAMILY_PETITION: "Petición familiar",
  GREEN_CARD: "Residencia / Green Card",
  GREEN_CARD_RENEWAL: "Renovación de Green Card",
  ASYLUM: "Asilo",
  U_VISA: "Visa U",
  WORK_PERMIT: "Permiso de trabajo",
  CONSULTATION: "Consulta de inmigración",
  IMMIGRATION_COURT: "Corte de inmigración",
  OTHER: "Otro asunto de inmigración",
};

// Keyed exactly by the enum values luis-unified-services-flow.json actually
// emits today (verified field-by-field against the Flow JSON, not against
// the originally-planned contract) — every key here must match a real
// data-source id in the Flow. YES/NO get field-aware phrasing in fieldLabel
// below instead of a bare "Sí"/"No", since the same YES/NO pair means very
// different things across fields (see fieldLabel's YES_LABELS/NO_LABELS).
const VALUE_LABELS: Record<string, string> = {
  // Shared across several fields
  NOT_SURE: "No está seguro/a",
  OTHER: "Otro",
  EXPIRING: "Está por vencer", // green_card_issue, work_permit_status
  EXPIRED: "Está vencida", // green_card_issue, work_permit_status

  // entry_method
  VISA: "Entró con visa",
  PAROLE: "Entró con parole",
  WITHOUT_INSPECTION: "Entró sin inspección",

  // resident_duration
  LESS_THAN_3_YEARS: "Residente por menos de 3 años",
  THREE_TO_FIVE_YEARS: "Residente entre 3 y 5 años",
  MORE_THAN_5_YEARS: "Residente por más de 5 años",

  // arrival_window
  LESS_THAN_ONE_YEAR: "Llegó hace menos de 1 año",
  MORE_THAN_ONE_YEAR: "Llegó hace más de 1 año",

  // petitioner_relationship
  US_CITIZEN_SPOUSE: "Cónyuge ciudadano/a",
  RESIDENT_SPOUSE: "Cónyuge residente",
  PARENT: "Padre o madre",
  ADULT_CHILD: "Hijo/a mayor de edad",

  // green_card_term
  TWO_YEAR: "Green Card de 2 años",
  TEN_YEAR: "Green Card de 10 años",

  // green_card_issue
  LOST_OR_STOLEN: "Perdida o robada",
  DAMAGED: "Dañada",

  // fear_reason
  POLITICAL: "Motivo político",
  RELIGION: "Motivo religioso",
  NATIONALITY: "Motivo de nacionalidad",
  RACE: "Motivo de raza",
  SOCIAL_GROUP: "Pertenencia a un grupo social",

  // work_permit_request_type
  FIRST_APPLICATION: "Primera solicitud",
  RENEWAL: "Renovación",
  REPLACEMENT: "Reemplazo",

  // work_permit_basis
  ASYLUM: "Basado en asilo",
  ADJUSTMENT: "Ajuste de estatus",
  TPS: "TPS",

  // work_permit_status
  VALID: "Vigente",
  NONE: "No tiene permiso actual",

  // chemical_test (DUI) — never YES/NO, always its own enum
  COMPLETED: "Realizó la prueba estatal",
  REFUSED: "Rechazó la prueba estatal",
};

// YES/NO mean something different on almost every field — a bare "Sí"/"No"
// would be ambiguous or misleading, so every field that actually emits
// YES/NO gets its own phrase here. Fields not listed fall back to the
// generic "Sí"/"No" in fieldLabel below (currently none of the emitted
// fields need that fallback, but new fields shouldn't have to add an entry
// here just to render at all).
const YES_LABELS: Record<string, string> = {
  prior_uscis_petition: "Ha presentado petición antes",
  police_report: "Hubo reporte policial",
  received_medical_attention: "Recibió atención médica",
  law_enforcement_cooperation: "Indica colaboración con autoridades",
  long_absence: "Tuvo ausencia de 6+ meses fuera de EE. UU.",
  citizenship_marriage_basis: "Basado en matrimonio con ciudadano/a",
  prior_related_filing: "Ya presentó un trámite relacionado",
  immigration_court_status: "Tiene proceso activo en corte de inmigración",
  crime_victim: "Fue víctima de un delito en EE. UU.",
  court_date_status: "Tiene fecha de corte",
  currently_detained: "Actualmente detenido/a",
};
const NO_LABELS: Record<string, string> = {
  prior_uscis_petition: "No ha presentado petición",
  police_report: "Sin reporte policial",
  received_medical_attention: "No recibió atención médica",
  law_enforcement_cooperation: "No indicó colaboración con autoridades",
  long_absence: "Sin ausencia de 6+ meses fuera de EE. UU.",
  citizenship_marriage_basis: "No basado en matrimonio",
  prior_related_filing: "No ha presentado un trámite relacionado",
  immigration_court_status: "Sin proceso activo en corte de inmigración",
  crime_victim: "No fue víctima de un delito en EE. UU.",
  court_date_status: "Aún no tiene fecha de corte",
  currently_detained: "Actualmente en libertad",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// A bare "YYYY-MM-DD" (what accident_date/dui_date actually are) parses as
// UTC midnight per the JS Date spec; formatting that in any timezone behind
// UTC would print the WRONG day. Parse date-only strings as local calendar
// dates explicitly instead of handing them to `new Date(raw)`. Shared by
// every date-only field so there is exactly one place this guard lives.
function parseDateOnlyLocal(raw: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

// accident_date/dui_date are the only date-only intake fields — everywhere
// else fieldLabel's generic YES/NO/enum handling applies. Compact form
// ("2 sep 2026") for dense summary lines; formatHumanDate below has the
// long form ("2 de septiembre de 2026") for the standalone labeled fact.
const INCIDENT_DATE_FIELDS = new Set(["accident_date", "dui_date"]);

function formatCompactIncidentDate(raw: string): string | null {
  const date = parseDateOnlyLocal(raw);
  return date ? new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" }).format(date) : null;
}

function label(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return VALUE_LABELS[raw.toUpperCase()] ?? raw;
}

function fieldLabel(field: string, value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (INCIDENT_DATE_FIELDS.has(field)) return formatCompactIncidentDate(raw);
  const upper = raw.toUpperCase();
  if (upper === "YES") return YES_LABELS[field] ?? "Sí";
  if (upper === "NO") return NO_LABELS[field] ?? "No";
  return label(raw);
}

const FIELDS_BY_TOPIC: Record<string, readonly string[]> = {
  CITIZENSHIP: ["resident_duration", "long_absence", "citizenship_marriage_basis"],
  FAMILY_GREEN_CARD: ["petitioner_relationship", "entry_method", "prior_uscis_petition"],
  GREEN_CARD_RENEWAL: ["green_card_term", "green_card_issue", "prior_related_filing"],
  ASYLUM: ["arrival_window", "fear_reason", "immigration_court_status"],
  U_VISA: ["crime_victim", "police_report", "law_enforcement_cooperation"],
  WORK_PERMIT: ["work_permit_request_type", "work_permit_basis", "work_permit_status"],
  AUTO_ACCIDENT: ["accident_date", "received_medical_attention", "police_report"],
  DUI: ["dui_date", "chemical_test", "court_date_status"],
  CRIMINAL: ["criminal_charge", "court_date_status", "currently_detained"],
};

export function resolveReferralService(value: unknown, intake: Intake = {}): ReferralService | null {
  const candidate = text(value) ?? text(intake.service) ?? text(intake.service_id);
  return candidate ? SERVICE_ALIASES[candidate.toLowerCase()] ?? null : null;
}

export function referralServiceLabel(service: ReferralService | null): string {
  return service ? SERVICE_LABELS[service] : "Servicio legal";
}

export function referralTopicLabel(topic: unknown, service: ReferralService | null): string {
  const raw = text(topic);
  if (!raw) return service ? SERVICE_LABELS[service] : "Consulta";
  return TOPIC_LABELS[raw.toUpperCase()] ?? raw;
}

export function buildIntakeSummary(
  intake: Intake,
  topic: unknown,
  // Defaults to false (unchanged behavior: the incident date, now compactly
  // formatted rather than raw, still appears in the summary line). Pass
  // true from a card that already shows the incident date as its own
  // explicitly-labeled fact, so it isn't stated twice.
  options?: { omitIncidentDate?: boolean },
): string | null {
  const topicKey = text(topic)?.toUpperCase() ?? "";
  const omitIncidentDate = options?.omitIncidentDate ?? false;
  const fields = (FIELDS_BY_TOPIC[topicKey] ?? []).filter(
    (field) => !(omitIncidentDate && INCIDENT_DATE_FIELDS.has(field)),
  );
  const values = fields.map((field) => fieldLabel(field, intake[field])).filter((value): value is string => Boolean(value));
  return values.length ? values.join(" · ") : null;
}

export function intakeDescription(intake: Intake): string | null {
  return text(intake.description);
}

// FIELDS_BY_TOPIC's structured-fact lookup needs the same canonical key
// immigration already exposes as intake.topic (e.g. "CITIZENSHIP"). The
// legal branches (AUTO_ACCIDENT/DUI/CRIMINAL) have no sub-topic — their only
// canonical discriminator is intake.intake_type, which is exactly what
// FIELDS_BY_TOPIC.AUTO_ACCIDENT/.DUI/.CRIMINAL are keyed by. Prefer topic
// when present (immigration), fall back to intake_type (legal); never
// invents a value — returns null if neither field is a non-empty string.
export function resolveSummaryTopicKey(intake: Intake): string | null {
  return text(intake.topic) ?? text(intake.intake_type);
}

// AUTO_ACCIDENT/DUI/CRIMINAL have no sub-topic, so their topic label falls
// back to the service label itself — showing both would read as a literal
// duplicate ("DUI · DUI"). Collapses to null (render service label alone)
// only when the two labels are identical; real per-topic immigration labels
// never collide with their own service label this way, so nothing real is
// ever hidden.
export function resolveTopicDisplay(topic: unknown, service: ReferralService | null): string | null {
  const topicLabel = referralTopicLabel(topic, service);
  return topicLabel === referralServiceLabel(service) ? null : topicLabel;
}

// Human-readable field names for the ambiguous-value ("No está seguro/a")
// clauses below, which must always carry their field context rather than a
// bare "No está seguro/a". Falls back to a humanized version of the field
// key itself for any field not listed here, so a new field never renders
// context-free.
const FIELD_DISPLAY_LABEL: Record<string, string> = {
  police_report: "Reporte policial",
  received_medical_attention: "Atención médica",
  resident_duration: "Tiempo como residente",
  long_absence: "Ausencia prolongada",
  citizenship_marriage_basis: "Base de matrimonio",
  petitioner_relationship: "Relación del peticionario",
  entry_method: "Método de entrada",
  prior_uscis_petition: "Petición previa con USCIS",
  green_card_term: "Vigencia de la Green Card",
  green_card_issue: "Situación de la tarjeta",
  prior_related_filing: "Trámite previo relacionado",
  arrival_window: "Tiempo en EE. UU.",
  fear_reason: "Motivo del temor",
  immigration_court_status: "Proceso en corte de inmigración",
  crime_victim: "Víctima de delito",
  law_enforcement_cooperation: "Colaboración con autoridades",
  work_permit_request_type: "Tipo de solicitud de permiso",
  work_permit_basis: "Base del permiso de trabajo",
  work_permit_status: "Situación del permiso actual",
  chemical_test: "Prueba estatal",
  court_date_status: "Fecha de corte",
  currently_detained: "Detención actual",
};

function fieldDisplayLabel(field: string): string {
  return FIELD_DISPLAY_LABEL[field] ?? field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function lowerFirst(value: string): string {
  return value.length ? value[0].toLowerCase() + value.slice(1) : value;
}

// Spanish list join: "a", "a y b", "a, b y c".
function joinSpanishList(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

function formatHumanDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = parseDateOnlyLocal(raw);
  return date ? new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric" }).format(date) : null;
}

// Fields already woven into the opening sentence (accident/DUI date,
// criminal charge) are excluded from the structured-facts pass below so
// they never appear a second time as a raw enum/date fragment.
const OPENING_SENTENCE_FIELDS = new Set(["accident_date", "dui_date", "criminal_charge"]);

// Builds a short narrative paragraph from data already present in intake —
// never invents a fact, and gracefully omits any clause whose source field
// is absent. Ambiguous (NOT_SURE) values are always rendered with their
// field name ("Reporte policial: No está seguro/a") rather than folded into
// the flowing sentence, so the context is never lost.
// AUTO_ACCIDENT/DUI are the only services with a real incident date field —
// keep this mapping next to formatHumanDate so a card can show the date as
// its own explicitly-labeled fact instead of buried inside this narrative.
const INCIDENT_DATE_FIELD_BY_SERVICE: Partial<Record<ReferralService, "accident_date" | "dui_date">> = {
  auto_accident: "accident_date",
  dui: "dui_date",
};

const INCIDENT_DATE_LABEL_BY_SERVICE: Partial<Record<ReferralService, string>> = {
  auto_accident: "Fecha del accidente",
  dui: "Fecha del DUI",
};

// Never fabricates a date: returns null both for services with no incident
// date concept and for a real intake missing the value.
export function resolveIncidentDateFact(
  service: ReferralService | null,
  intake: Intake,
): { label: string; value: string } | null {
  const field = service ? INCIDENT_DATE_FIELD_BY_SERVICE[service] : undefined;
  if (!field) return null;
  const value = formatHumanDate(intake[field]);
  return value ? { label: INCIDENT_DATE_LABEL_BY_SERVICE[service!]!, value } : null;
}

export function buildHumanSummary(args: {
  leadName: string | null | undefined;
  service: ReferralService | null;
  topicKey: string | null;
  intake: Intake;
  consentStatus?: string | null;
  // Defaults to true (unchanged behavior). Pass false when the incident date
  // is already shown as its own explicitly-labeled fact elsewhere on the
  // same card, so it isn't stated twice.
  includeIncidentDate?: boolean;
}): string {
  const name = text(args.leadName) ?? "El cliente";
  const intake = args.intake ?? {};
  const includeIncidentDate = args.includeIncidentDate ?? true;
  const sentences: string[] = [];

  if (args.service === "auto_accident") {
    const date = includeIncidentDate ? formatHumanDate(intake.accident_date) : null;
    sentences.push(`${name} reporta que tuvo un accidente${date ? ` el ${date}` : ""}.`);
  } else if (args.service === "dui") {
    const date = includeIncidentDate ? formatHumanDate(intake.dui_date) : null;
    sentences.push(`${name} reporta un caso de DUI${date ? ` el ${date}` : ""}.`);
  } else if (args.service === "criminal") {
    const charge = text(intake.criminal_charge);
    sentences.push(`${name} reporta un caso criminal${charge ? `: ${charge}` : ""}.`);
  } else if (args.service === "immigration") {
    const topicLabel = referralTopicLabel(args.topicKey, args.service);
    sentences.push(`${name} consulta sobre ${lowerFirst(topicLabel)}.`);
  } else {
    sentences.push(`${name} envió una consulta.`);
  }

  const description = text(intake.description);
  if (description) {
    sentences.push(`Indica que ${description}${/[.!?]$/.test(description) ? "" : "."}`);
  }

  const topicUpper = text(args.topicKey)?.toUpperCase() ?? "";
  const fields = (FIELDS_BY_TOPIC[topicUpper] ?? []).filter((field) => !OPENING_SENTENCE_FIELDS.has(field));
  const clearClauses: string[] = [];
  const ambiguousClauses: string[] = [];
  for (const field of fields) {
    const raw = text(intake[field]);
    if (!raw) continue;
    if (raw.toUpperCase() === "NOT_SURE") {
      ambiguousClauses.push(`${fieldDisplayLabel(field)}: No está seguro/a.`);
      continue;
    }
    const clause = fieldLabel(field, raw);
    if (clause) clearClauses.push(clause);
  }
  if (clearClauses.length) {
    sentences.push(`${joinSpanishList(clearClauses.map((clause, index) => (index === 0 ? clause : lowerFirst(clause))))}.`);
  }
  sentences.push(...ambiguousClauses);

  if (args.consentStatus === "authorized") sentences.push("Autorizó que lo contacten.");
  else if (args.consentStatus === "declined") sentences.push("No autorizó que lo contacten.");

  return sentences.join(" ");
}
