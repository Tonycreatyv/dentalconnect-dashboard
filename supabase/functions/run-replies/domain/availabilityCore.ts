type ProviderPreference = "specific" | "any";
type TimePreference = "morning" | "afternoon" | "evening" | "specific";

type DayHours = { closed: boolean; open?: string; close?: string };
type HoursMap = Record<string, DayHours>;

const DAY_KEYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const;
const JS_DAY_TO_KEY: Record<number, (typeof DAY_KEYS)[number]> = {
  0: "domingo",
  1: "lunes",
  2: "martes",
  3: "miercoles",
  4: "jueves",
  5: "viernes",
  6: "sabado",
};

const DEFAULT_HOURS: HoursMap = {
  lunes: { closed: false, open: "08:00", close: "17:00" },
  martes: { closed: false, open: "08:00", close: "17:00" },
  miercoles: { closed: false, open: "08:00", close: "17:00" },
  jueves: { closed: false, open: "08:00", close: "17:00" },
  viernes: { closed: false, open: "08:00", close: "17:00" },
  sabado: { closed: false, open: "08:00", close: "12:00" },
  domingo: { closed: true },
};

const DAY_ALIASES: Record<string, string> = {
  sunday: "domingo",
  monday: "lunes",
  tuesday: "martes",
  wednesday: "miercoles",
  thursday: "jueves",
  friday: "viernes",
  saturday: "sabado",
  sun: "domingo",
  mon: "lunes",
  tue: "martes",
  wed: "miercoles",
  thu: "jueves",
  fri: "viernes",
  sat: "sabado",
  domingo: "domingo",
  lunes: "lunes",
  martes: "martes",
  miercoles: "miercoles",
  miércoles: "miercoles",
  jueves: "jueves",
  viernes: "viernes",
  sabado: "sabado",
  sábado: "sabado",
};

type AppointmentRow = {
  provider_id?: string | null;
  provider_name?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  duration_min?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: string | null;
};
type BookingHoldAsAppointment = AppointmentRow & { hold_id?: string | null };

type ProviderRow = { id: string; name: string; active: boolean; services: string[] };
type ServiceRow = { id: string; name: string; duration_min: number };
type ProviderHoursRow = { barber_id: string; day_of_week: string; start_time: string; end_time: string };
type ProviderHoursLoad = { rows: ProviderHoursRow[]; providersWithSchedule: Set<string>; providerClosedDays: Set<string> };
type HoursSource = "barber_hours" | "business_hours" | "default_hours";
type BookingRules = {
  slot_interval_min: number;
  min_notice_min: number;
  time_blocks?: Record<string, unknown>;
  buffer_after_min?: number;
};

const DEFAULT_DENTAL_AVAILABILITY_SERVICES: ServiceRow[] = [
  { id: "limpieza_dental", name: "Limpieza dental", duration_min: 45 },
  { id: "evaluacion_general", name: "Evaluación general", duration_min: 30 },
  { id: "revision_dental", name: "Revisión dental", duration_min: 30 },
  { id: "ortodoncia", name: "Ortodoncia / brackets", duration_min: 45 },
  { id: "blanqueamiento_dental", name: "Blanqueamiento dental", duration_min: 60 },
  { id: "extraccion", name: "Extracción", duration_min: 45 },
  { id: "resina_restauracion", name: "Resina / restauración", duration_min: 45 },
  { id: "endodoncia", name: "Endodoncia", duration_min: 60 },
  { id: "implantes", name: "Implantes", duration_min: 60 },
  { id: "carillas", name: "Carillas", duration_min: 60 },
  { id: "emergencia_dental", name: "Emergencia dental", duration_min: 30 },
];

export type AvailabilitySlotOption = {
  date: string;
  time: string;
  starts_at: string;
  provider_id: string;
  provider_name: string;
  service_key: string;
  service_name: string;
};

export type SlotAvailabilityResult = {
  available: boolean;
  reason?: "past_time" | "closed_day" | "outside_hours" | "overlap";
  slot?: AvailabilitySlotOption;
  alternatives?: AvailabilitySlotOption[];
};

export type AvailabilityDiagnostics = {
  providerHoursCount: number;
  providersCount: number;
  firstSlots: string[];
  sourceUsed: HoursSource;
};

export type AvailabilityInput = {
  supabase: any;
  organization_id: string;
  business_type: string;
  service_id?: string;
  service_name?: string;
  provider_id?: string | null;
  provider_preference?: ProviderPreference;
  date?: string;
  date_from?: string;
  date_to?: string;
  time_preference?: "morning" | "afternoon" | "evening" | "specific";
  specific_time?: string;
  timezone?: string;
  max_options?: number;
};

function parseHm(value: string): number {
  const m = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return -1;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return -1;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return -1;
  return hh * 60 + mm;
}

function hm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function normalizeDay(value: unknown): string | null {
  if (typeof value === "number") {
    if (value >= 0 && value <= 6) return DAY_KEYS[value];
    if (value >= 1 && value <= 7) return DAY_KEYS[value % 7];
    return null;
  }
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return normalizeDay(Number(raw));
  return DAY_ALIASES[raw] ?? null;
}

function normalizeHours(rows: unknown[]): HoursMap {
  const out: HoursMap = { ...DEFAULT_HOURS };
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const day = normalizeDay(r.day_of_week ?? r.weekday ?? r.day);
    if (!day) continue;
    const open = String(r.open_time ?? r.open ?? "").slice(0, 5);
    const close = String(r.close_time ?? r.close ?? "").slice(0, 5);
    const closed = Boolean(r.closed ?? r.is_closed);
    out[day] = { closed, open: open || out[day]?.open, close: close || out[day]?.close };
  }
  return out;
}

function normalizeServiceName(name: string): string {
  const normalized = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/_/g, " ").trim();
  const compact = normalized.replace(/\s+/g, " ");
  const plusCompact = compact.replace(/\s*\+\s*/g, "+");
  if (["corte solo", "solo corte", "corte de pelo", "pelo"].includes(compact)) return "corte_solo";
  if (compact === "corte clasico" || compact === "corte") return "corte";
  if (
    ["corte barba", "corte y barba", "barba y corte", "corte con barba"].includes(compact) ||
    plusCompact === "corte+barba"
  ) return "corte_barba";
  if (["limpieza facial", "limpieza"].includes(compact)) return "limpieza_facial";
  if (
    ["corte limpieza", "corte y limpieza", "corte con limpieza"].includes(compact) ||
    plusCompact === "corte+limpieza"
  ) return "corte_limpieza";
  if (compact === "barba") return "barba";
  if (compact === "cejas") return "cejas";
  return compact;
}

function serviceAliases(value: string): Set<string> {
  const canonical = normalizeServiceName(value);
  const aliases = new Set<string>([canonical]);
  if (canonical === "corte_solo" || canonical === "corte") {
    aliases.add("corte_solo");
    aliases.add("corte");
    aliases.add("corte clasico");
  }
  if (canonical === "corte_barba") {
    aliases.add("corte_barba");
    aliases.add("corte+barba");
    aliases.add("corte y barba");
    aliases.add("corte barba");
  }
  if (canonical === "limpieza_facial") {
    aliases.add("limpieza_facial");
    aliases.add("limpieza");
    aliases.add("limpieza facial");
  }
  if (canonical === "corte_limpieza") {
    aliases.add("corte_limpieza");
    aliases.add("corte+limpieza");
    aliases.add("corte y limpieza");
    aliases.add("corte limpieza");
  }
  return aliases;
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function getNowInTimezone(timezone: string): Date {
  const testNow = (() => {
    try {
      return Deno.env.get("RUN_REPLIES_TEST_NOW") ?? "";
    } catch (_err) {
      return "";
    }
  })();
  if (testNow) {
    const parsedTestNow = new Date(testNow);
    if (!Number.isNaN(parsedTestNow.valueOf())) {
      const localizedTestNow = parsedTestNow.toLocaleString("en-US", { timeZone: timezone });
      const reparsedTestNow = new Date(localizedTestNow);
      if (!Number.isNaN(reparsedTestNow.valueOf())) return reparsedTestNow;
    }
  }
  const localized = new Date().toLocaleString("en-US", { timeZone: timezone });
  const parsed = new Date(localized);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
}

function formatDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function buildDateRange(dateFrom: string, dateTo: string): string[] {
  const out: string[] = [];
  const start = new Date(`${dateFrom}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return out;
}

async function loadOrgSettings(supabase: any, organizationId: string): Promise<{ timezone: string }> {
  const res = await supabase
    .from("org_settings")
    .select("timezone")
    .eq("organization_id", organizationId)
    .limit(1);
  const timezone = String(res?.data?.[0]?.timezone ?? "America/Tegucigalpa");
  return { timezone };
}

async function loadBookingRules(supabase: any, organizationId: string): Promise<BookingRules> {
  const res = await supabase
    .from("organization_settings")
    .select("booking_rules")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const rules = (res?.data?.booking_rules ?? {}) as Record<string, unknown>;
  const slotInterval = Number(rules.slot_interval_min);
  const minNotice = Number(rules.min_notice_min);
  return {
    slot_interval_min: Number.isFinite(slotInterval) && slotInterval > 0 ? Math.round(slotInterval) : 30,
    min_notice_min: Number.isFinite(minNotice) && minNotice >= 0 ? Math.round(minNotice) : 0,
    buffer_after_min: Number.isFinite(Number(rules.buffer_after_min ?? rules.buffer_min)) &&
        Number(rules.buffer_after_min ?? rules.buffer_min) >= 0
      ? Math.round(Number(rules.buffer_after_min ?? rules.buffer_min))
      : undefined,
    time_blocks: (rules.time_blocks && typeof rules.time_blocks === "object")
      ? (rules.time_blocks as Record<string, unknown>)
      : undefined,
  };
}

function getDentalBufferAfterMin(serviceNameRaw: string, rules: BookingRules | null): number {
  if (Number.isFinite(Number(rules?.buffer_after_min)) && Number(rules?.buffer_after_min) >= 0) {
    return Math.round(Number(rules?.buffer_after_min));
  }
  const name = normalizeServiceName(serviceNameRaw);
  if (
    name.includes("extraccion") ||
    name.includes("implante") ||
    name.includes("endodoncia") ||
    name.includes("cirugia")
  ) return 15;
  return 10;
}

function getDentalFallbackDurationMin(serviceNameRaw: string): number {
  const name = normalizeServiceName(serviceNameRaw);
  if (
    name.includes("blanqueamiento") ||
    name.includes("endodoncia") ||
    name.includes("implante") ||
    name.includes("carilla")
  ) return 60;
  if (
    name.includes("limpieza") ||
    name.includes("ortodoncia") ||
    name.includes("bracket") ||
    name.includes("extraccion") ||
    name.includes("resina") ||
    name.includes("restauracion")
  ) return 45;
  return 30;
}

async function loadOrganizationSettingsRow(supabase: any, organizationId: string): Promise<Record<string, unknown> | null> {
  const res = await supabase
    .from("organization_settings")
    .select("services,providers,hours")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (res?.error || !res?.data) return null;
  return res.data as Record<string, unknown>;
}

async function loadProvidersTableRows(supabase: any, organizationId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const res = await supabase
      .from("providers")
      .select("id,name,active,is_active,services,schedule,color,calendar_color,role")
      .eq("organization_id", organizationId);
    const rows = Array.isArray(res?.data) ? res.data : [];
    return rows.filter((row: Record<string, unknown>) => {
      const role = String(row?.role ?? "").toLowerCase();
      return !role || role === "doctor" || role === "barber" || role === "provider";
    });
  } catch (_error) {
    return [];
  }
}

function normalizeProviderRows(rows: Array<Record<string, unknown>>): ProviderRow[] {
  return rows
    .map((r: any) => ({
      id: String(r?.id ?? ""),
      name: String(r?.name ?? ""),
      active: r?.active !== false && r?.is_active !== false,
      services: Array.isArray(r?.services)
        ? r.services.map((s: unknown) => normalizeServiceName(String(s ?? ""))).filter(Boolean)
        : [],
    }))
    .filter((p: ProviderRow) => p.id && p.name && p.active);
}

function providerHoursFromProviderRows(rows: Array<Record<string, unknown>>): ProviderHoursLoad {
  const normalizedRows: ProviderHoursRow[] = [];
  const providersWithSchedule = new Set<string>();
  const providerClosedDays = new Set<string>();
  for (const provider of rows) {
    if (provider?.active === false || provider?.is_active === false) continue;
    const providerId = String(provider?.id ?? "").trim();
    if (!providerId) continue;
    const schedule = provider?.schedule && typeof provider.schedule === "object"
      ? (provider.schedule as Record<string, unknown>)
      : null;
    if (!schedule) continue;
    providersWithSchedule.add(providerId);
    for (const [dayRaw, windowRaw] of Object.entries(schedule)) {
      const day = normalizeDay(dayRaw);
      if (!day || !windowRaw || typeof windowRaw !== "object") continue;
      const window = windowRaw as Record<string, unknown>;
      const closed = Boolean(window.closed ?? window.is_closed);
      if (closed) {
        providerClosedDays.add(`${providerId}|${day}`);
        continue;
      }
      const open = String(window.open ?? window.open_time ?? "").slice(0, 5);
      const close = String(window.close ?? window.close_time ?? "").slice(0, 5);
      if (!open || !close) continue;
      normalizedRows.push({ barber_id: providerId, day_of_week: day, start_time: open, end_time: close });
    }
  }
  return { rows: normalizedRows, providersWithSchedule, providerClosedDays };
}

async function loadServices(supabase: any, organizationId: string, businessType = ""): Promise<ServiceRow[]> {
  const isDental = String(businessType ?? "").toLowerCase() === "dental";
  const canonical = await loadOrganizationSettingsRow(supabase, organizationId);
  if (canonical) {
    const rows = Array.isArray(canonical.services) ? canonical.services : [];
    const services = rows
      .map((r: any) => ({
        id: String(r?.key ?? r?.service_key ?? r?.id ?? r?.name ?? ""),
        name: String(r?.name ?? ""),
        duration_min: Number(r?.duration_min ?? r?.durationMinutes) > 0
          ? Number(r.duration_min ?? r.durationMinutes)
          : (isDental ? getDentalFallbackDurationMin(String(r?.name ?? "")) : 45),
      }))
      .filter((r: ServiceRow) => r.name);
    return services.length || !isDental ? services : DEFAULT_DENTAL_AVAILABILITY_SERVICES;
  }
  const res = await supabase
    .from("barber_services")
    .select("id,name,duration_min,is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  const rows = Array.isArray(res?.data) ? res.data : [];
  const services = rows.map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
    duration_min: Number(r.duration_min) > 0
      ? Number(r.duration_min)
      : (isDental ? getDentalFallbackDurationMin(String(r.name ?? "")) : 45),
  }));
  return services.length || !isDental ? services : DEFAULT_DENTAL_AVAILABILITY_SERVICES;
}

async function loadProviders(supabase: any, organizationId: string): Promise<ProviderRow[]> {
  const providersTableRows = await loadProvidersTableRows(supabase, organizationId);
  const tableProviders = normalizeProviderRows(providersTableRows);
  if (tableProviders.length > 0) return tableProviders;

  const canonical = await loadOrganizationSettingsRow(supabase, organizationId);
  if (canonical) {
    const rows = Array.isArray(canonical.providers) ? canonical.providers : [];
    return normalizeProviderRows(rows as Array<Record<string, unknown>>);
  }
  const res = await supabase
    .from("barbers")
    .select("id,name,is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows
    .map((r: any) => ({ id: String(r.id), name: String(r.name ?? ""), active: r?.is_active !== false, services: [] }))
    .filter((p: ProviderRow) => p.id && p.active);
}

async function loadProviderHours(supabase: any, organizationId: string): Promise<ProviderHoursLoad> {
  const providersTableRows = await loadProvidersTableRows(supabase, organizationId);
  const tableProviderHours = providerHoursFromProviderRows(providersTableRows);
  if (tableProviderHours.rows.length > 0 || tableProviderHours.providersWithSchedule.size > 0) {
    return tableProviderHours;
  }

  const canonical = await loadOrganizationSettingsRow(supabase, organizationId);
  if (canonical) {
    const providers = Array.isArray(canonical.providers) ? canonical.providers : [];
    const rows: ProviderHoursRow[] = [];
    const providersWithSchedule = new Set<string>();
    const providerClosedDays = new Set<string>();
    for (const provider of providers as Array<Record<string, unknown>>) {
      if (provider?.active === false) continue;
      const providerId = String(provider?.id ?? "").trim();
      if (!providerId) continue;
      const schedule = provider?.schedule && typeof provider.schedule === "object"
        ? (provider.schedule as Record<string, unknown>)
        : null;
      if (!schedule) continue;
      providersWithSchedule.add(providerId);
      for (const [dayRaw, windowRaw] of Object.entries(schedule)) {
        const day = normalizeDay(dayRaw);
        if (!day) continue;
        if (!windowRaw || typeof windowRaw !== "object") continue;
        const window = windowRaw as Record<string, unknown>;
        const closed = Boolean(window.closed ?? window.is_closed);
        if (closed) {
          providerClosedDays.add(`${providerId}|${day}`);
          continue;
        }
        const open = String(window.open ?? window.open_time ?? "").slice(0, 5);
        const close = String(window.close ?? window.close_time ?? "").slice(0, 5);
        if (!open || !close) continue;
        rows.push({
          barber_id: providerId,
          day_of_week: day,
          start_time: open,
          end_time: close,
        });
      }
    }
    if (rows.length > 0 || providersWithSchedule.size > 0) {
      return { rows, providersWithSchedule, providerClosedDays };
    }
  }
  const res = await supabase
    .from("barber_hours")
    .select("barber_id,day_of_week,start_time,end_time,is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  const rows = Array.isArray(res?.data) ? res.data : [];
  const normalizedRows = rows
    .map((r: any) => ({
      barber_id: String(r.barber_id ?? ""),
      day_of_week: String(r.day_of_week ?? ""),
      start_time: String(r.start_time ?? "").slice(0, 5),
      end_time: String(r.end_time ?? "").slice(0, 5),
    }))
    .filter((r: ProviderHoursRow) => r.barber_id && r.start_time && r.end_time);
  return { rows: normalizedRows, providersWithSchedule: new Set<string>(), providerClosedDays: new Set<string>() };
}

async function loadBusinessHoursWithSource(
  supabase: any,
  organizationId: string,
): Promise<{ hours: HoursMap; source: "business_hours" | "default_hours" }> {
  const canonical = await loadOrganizationSettingsRow(supabase, organizationId);
  if (canonical) {
    const rawHours = canonical.hours && typeof canonical.hours === "object"
      ? (canonical.hours as Record<string, unknown>)
      : {};
    const normalized: HoursMap = {};
    for (const [key, value] of Object.entries(rawHours)) {
      const day = normalizeDay(key);
      if (!day) continue;
      const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      const closed = Boolean(v.closed ?? v.is_closed);
      const open = String(v.open ?? v.open_time ?? "").slice(0, 5);
      const close = String(v.close ?? v.close_time ?? "").slice(0, 5);
      normalized[day] = closed ? { closed: true } : { closed: false, open, close };
    }
    return { hours: normalized, source: "business_hours" };
  }
  const business = await supabase
    .from("business_hours")
    .select("day_of_week,weekday,day,open_time,close_time,is_closed,closed")
    .eq("organization_id", organizationId);
  const businessRows = Array.isArray(business?.data) ? business.data : [];
  if (businessRows.length > 0) return { hours: normalizeHours(businessRows), source: "business_hours" };
  const clinic = await supabase
    .from("clinic_hours")
    .select("day_of_week,weekday,day,open_time,close_time,is_closed,closed")
    .eq("organization_id", organizationId);
  const clinicRows = Array.isArray(clinic?.data) ? clinic.data : [];
  if (clinicRows.length > 0) return { hours: normalizeHours(clinicRows), source: "business_hours" };
  return { hours: {}, source: "default_hours" };
}

async function loadAppointmentsForRange(
  supabase: any,
  organizationId: string,
  dateFrom: string,
  dateTo: string,
): Promise<AppointmentRow[]> {
  const res = await supabase
    .from("appointments")
    .select("provider_id,provider_name,appointment_date,appointment_time,duration_min,starts_at,ends_at,status")
    .eq("organization_id", organizationId)
    .gte("appointment_date", dateFrom)
    .lte("appointment_date", dateTo)
    .neq("status", "cancelled");
  return Array.isArray(res?.data) ? res.data : [];
}

async function loadActiveBookingHoldsForRange(
  supabase: any,
  organizationId: string,
  dateFrom: string,
  dateTo: string,
): Promise<BookingHoldAsAppointment[]> {
  try {
    const res = await supabase
      .from("booking_holds")
      .select("id, provider_id, provider_name, service_key, service_name, starts_at, ends_at, status, expires_at")
      .eq("organization_id", organizationId)
      .eq("status", "held")
      .gt("expires_at", new Date().toISOString());
    const rows = Array.isArray(res?.data) ? res.data : [];
    return rows
      .map((row: any) => {
        const startsAt = String(row?.starts_at ?? "");
        const endsAt = String(row?.ends_at ?? "");
        if (!startsAt || !endsAt) return null;
        const date = startsAt.slice(0, 10);
        if (date < dateFrom || date > dateTo) return null;
        return {
          hold_id: String(row?.id ?? ""),
          provider_id: String(row?.provider_id ?? ""),
          provider_name: String(row?.provider_name ?? ""),
          starts_at: startsAt,
          ends_at: endsAt,
          status: "held",
        } as BookingHoldAsAppointment;
      })
      .filter(Boolean) as BookingHoldAsAppointment[];
  } catch (_error) {
    return [];
  }
}

function resolveDuration(serviceId: string | undefined, serviceName: string | undefined, services: ServiceRow[]): number {
  if (serviceId) {
    const byId = services.find((s) => s.id === serviceId);
    if (byId) return byId.duration_min;
  }
  if (serviceName) {
    const target = normalizeServiceName(serviceName);
    const exact = services.find((s) => normalizeServiceName(s.name) === target);
    if (exact) return exact.duration_min;
    const partial = services.find((s) => target.includes(normalizeServiceName(s.name)) || normalizeServiceName(s.name).includes(target));
    if (partial) return partial.duration_min;
  }
  return 45;
}

function resolveServiceContract(
  serviceId: string | undefined,
  serviceName: string | undefined,
  services: ServiceRow[],
): { service_key: string; service_name: string } {
  if (serviceId) {
    const byId = services.find((s) => s.id === serviceId);
    if (byId) return { service_key: byId.id, service_name: byId.name };
  }
  if (serviceName) {
    const target = normalizeServiceName(serviceName);
    const exact = services.find((s) => normalizeServiceName(s.name) === target);
    if (exact) return { service_key: exact.id, service_name: exact.name };
    const partial = services.find((s) => target.includes(normalizeServiceName(s.name)) || normalizeServiceName(s.name).includes(target));
    if (partial) return { service_key: partial.id, service_name: partial.name };
  }
  if (services[0]) return { service_key: services[0].id, service_name: services[0].name };
  return { service_key: "barbershop_appointment", service_name: serviceName || "Cita barbería" };
}

function getProviderWindowsForDate(
  date: string,
  providerId: string | null,
  providerHours: ProviderHoursRow[],
  providersWithSchedule: Set<string>,
  providerClosedDays: Set<string>,
  businessHours: HoursMap,
): Array<{ startMin: number; endMin: number }> {
  const dayKey = JS_DAY_TO_KEY[new Date(`${date}T12:00:00`).getDay()];
  const businessDay = businessHours[dayKey];
  // Business hours are the primary gate. If org is closed or undefined, providers cannot open this day.
  if (!businessDay || businessDay.closed) {
    console.log(JSON.stringify({
      event: "org_closed_blocks_provider_schedule",
      date,
      day: dayKey,
      reason: !businessDay ? "day_not_defined" : "day_closed",
      provider_id: providerId ?? null,
    }));
    return [];
  }

  if (providerId) {
    if (providerClosedDays.has(`${providerId}|${dayKey}`)) return [];
    const rows = providerHours.filter((r) => r.barber_id === providerId && normalizeDay(r.day_of_week) === dayKey);
    if (rows.length > 0) {
      return rows
        .map((r) => ({ startMin: parseHm(r.start_time), endMin: parseHm(r.end_time) }))
        .filter((w) => w.startMin >= 0 && w.endMin > w.startMin);
    }
    // Partial provider schedules inherit org hours for days not explicitly configured.
    if (providersWithSchedule.has(providerId)) {
      console.log(JSON.stringify({
        event: "provider_inherits_org_hours",
        provider_id: providerId,
        day: dayKey,
      }));
    }
  }
  const open = parseHm(businessDay.open ?? "08:00");
  const close = parseHm(businessDay.close ?? "17:00");
  if (open < 0 || close <= open) return [];
  return [{ startMin: open, endMin: close }];
}

function providerSupportsService(provider: ProviderRow, serviceName: string, serviceKey?: string): boolean {
  const targets = new Set<string>([
    ...serviceAliases(serviceName),
    ...(serviceKey ? Array.from(serviceAliases(serviceKey)) : []),
  ]);
  if (targets.size === 0) return true;
  if (!Array.isArray(provider.services) || provider.services.length === 0) return true;
  return provider.services.some((service) => {
    for (const alias of serviceAliases(service)) {
      if (targets.has(alias)) return true;
    }
    return false;
  });
}

function getAppointmentRangeForDate(appt: AppointmentRow, defaultDuration: number): { date: string; startMin: number; endMin: number } | null {
  const date = String(appt.appointment_date ?? "").trim();
  const time = String(appt.appointment_time ?? "").trim();
  if (date && time) {
    const startMin = parseHm(time);
    if (startMin < 0) return null;
    const dur = Number(appt.duration_min) > 0 ? Number(appt.duration_min) : defaultDuration;
    return { date, startMin, endMin: startMin + dur };
  }
  const startsAt = String(appt.starts_at ?? "").trim();
  if (startsAt.length >= 16) {
    const d = startsAt.slice(0, 10);
    const t = startsAt.slice(11, 16);
    const startMin = parseHm(t);
    if (startMin < 0) return null;
    const endAt = String(appt.ends_at ?? "").trim();
    if (endAt.length >= 16) {
      const endMin = parseHm(endAt.slice(11, 16));
      if (endMin > startMin) return { date: d, startMin, endMin };
    }
    const dur = Number(appt.duration_min) > 0 ? Number(appt.duration_min) : defaultDuration;
    return { date: d, startMin, endMin: startMin + dur };
  }
  return null;
}

function getConfiguredTimeBlockRange(
  pref: TimePreference,
  bookingRules: BookingRules | null,
  windowEndMin: number,
): { startMin: number; endMin: number } | null {
  const raw = bookingRules?.time_blocks?.[pref];
  if (raw && typeof raw === "object") {
    const block = raw as Record<string, unknown>;
    const start = parseHm(String(block.start ?? block.open ?? block.from ?? ""));
    const end = parseHm(String(block.end ?? block.close ?? block.to ?? ""));
    if (start >= 0 && end > start) return { startMin: start, endMin: end };
  }
  if (pref === "morning") return { startMin: 0, endMin: 12 * 60 };
  if (pref === "afternoon") return { startMin: 12 * 60, endMin: windowEndMin };
  if (pref === "evening") return { startMin: 17 * 60, endMin: 24 * 60 };
  return null;
}

function matchesTimePreference(
  slotMin: number,
  pref?: TimePreference,
  specificTime?: string,
  bookingRules: BookingRules | null = null,
  windowEndMin = 24 * 60,
): boolean {
  if (!pref) return true;
  if (pref === "specific") {
    const want = parseHm(specificTime ?? "");
    return want >= 0 ? slotMin === want : true;
  }
  const range = getConfiguredTimeBlockRange(pref, bookingRules, windowEndMin);
  if (range) return slotMin >= range.startMin && slotMin < range.endMin;
  return true;
}

function sortSlots(slots: AvailabilitySlotOption[]): AvailabilitySlotOption[] {
  return slots.sort((a, b) => (a.date.localeCompare(b.date) || parseHm(a.time) - parseHm(b.time)));
}

function hasOpenHours(hours: HoursMap): boolean {
  for (const cfg of Object.values(hours)) {
    if (!cfg || cfg.closed) continue;
    const open = parseHm(cfg.open ?? "");
    const close = parseHm(cfg.close ?? "");
    if (open >= 0 && close > open) return true;
  }
  return false;
}

function compareProviderAssignment(
  a: AvailabilitySlotOption,
  b: AvailabilitySlotOption,
  effectiveLoadByProvider: Map<string, number>,
): number {
  const aId = String(a.provider_id ?? "");
  const bId = String(b.provider_id ?? "");
  const aLoad = effectiveLoadByProvider.get(aId) ?? Number.MAX_SAFE_INTEGER;
  const bLoad = effectiveLoadByProvider.get(bId) ?? Number.MAX_SAFE_INTEGER;
  if (aLoad !== bLoad) return aLoad - bLoad;
  const aName = String(a.provider_name ?? "").toLowerCase();
  const bName = String(b.provider_name ?? "").toLowerCase();
  if (aName !== bName) return aName.localeCompare(bName);
  return aId.localeCompare(bId);
}

export async function getAvailableSlotsForDay(input: AvailabilityInput & { date: string }): Promise<AvailabilitySlotOption[]> {
  const isBarbershop = String(input.business_type ?? "").toLowerCase() === "barbershop";
  const bookingRules = await loadBookingRules(input.supabase, input.organization_id);
  const slotStepMin = isBarbershop
    ? Math.max(5, Math.min(120, Number(bookingRules?.slot_interval_min ?? 30)))
    : Math.max(15, Math.min(120, Number(bookingRules?.slot_interval_min ?? 30) || 30));
  const minBarbershopMinute = 9 * 60;
  const timezone = input.timezone || (await loadOrgSettings(input.supabase, input.organization_id)).timezone;
  const services = await loadServices(input.supabase, input.organization_id, input.business_type);
  const loadedProviders = await loadProviders(input.supabase, input.organization_id);
  const providers = !isBarbershop && loadedProviders.length === 0
    ? [{ id: "doctor_demo", name: "Doctor disponible", active: true, services: [] }]
    : loadedProviders;
  const providerHours = await loadProviderHours(input.supabase, input.organization_id);
  const providerHoursRows = providerHours.rows;
  const providersWithSchedule = providerHours.providersWithSchedule;
  const providerClosedDays = providerHours.providerClosedDays;
  const businessHours = (await loadBusinessHoursWithSource(input.supabase, input.organization_id)).hours;
  const hasAnyProviderHours = providerHoursRows.length > 0;
  const canBook = services.length > 0 && providers.length > 0 && (hasOpenHours(businessHours) || hasAnyProviderHours);
  if (!canBook) return [];
  const serviceContract = resolveServiceContract(input.service_id, input.service_name, services);
  const serviceDurationMin = resolveDuration(input.service_id, input.service_name, services);
  const durationMin = isBarbershop
    ? serviceDurationMin
    : serviceDurationMin + getDentalBufferAfterMin(serviceContract.service_name, bookingRules);
  const appointments = await loadAppointmentsForRange(input.supabase, input.organization_id, input.date, input.date);
  const activeHolds = isBarbershop
    ? await loadActiveBookingHoldsForRange(input.supabase, input.organization_id, input.date, input.date)
    : [];
  const blockers = [...appointments, ...activeHolds];
  const dailyLoadByProvider = new Map<string, number>();
  for (const appt of blockers) {
    const providerId = String(appt.provider_id ?? "").trim();
    if (!providerId) continue;
    dailyLoadByProvider.set(providerId, (dailyLoadByProvider.get(providerId) ?? 0) + 1);
  }

  const now = getNowInTimezone(timezone);
  const today = formatDateInTimezone(now, timezone);
  if (input.date < today) return [];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const minNoticeMin = Math.max(0, Number(bookingRules?.min_notice_min ?? 0));
  const todayEarliestAllowedMin = Math.ceil((nowMin + minNoticeMin) / slotStepMin) * slotStepMin;

  const providerCandidates: ProviderRow[] = input.provider_preference === "specific"
    ? providers.filter((p) => p.id === String(input.provider_id ?? ""))
    : providers;
  if (providerCandidates.length === 0) return [];
  const serviceScopedCandidates = providerCandidates.filter((p) =>
    providerSupportsService(p, serviceContract.service_name, serviceContract.service_key)
  );
  if (serviceScopedCandidates.length === 0) return [];

  const results: AvailabilitySlotOption[] = [];
  for (const provider of serviceScopedCandidates) {
    const windows = getProviderWindowsForDate(
      input.date,
      provider.id || null,
      providerHoursRows,
      providersWithSchedule,
      providerClosedDays,
      businessHours,
    );
    for (const window of windows) {
      for (let m = window.startMin; m + durationMin <= window.endMin; m += slotStepMin) {
        if (isBarbershop && m < minBarbershopMinute) continue;
        if (
          !matchesTimePreference(
            m,
            input.time_preference as TimePreference | undefined,
            input.specific_time,
            bookingRules,
            window.endMin,
          )
        ) continue;
        if (input.date === today && m < todayEarliestAllowedMin) continue;
        const slotStart = m;
        const slotEnd = m + durationMin;
        const hasOverlap = blockers.some((appt) => {
          const range = getAppointmentRangeForDate(appt, durationMin);
          if (!range || range.date !== input.date) return false;
          const apptProviderId = String(appt.provider_id ?? "");
          const apptProviderName = String(appt.provider_name ?? "").toLowerCase();
          if (provider.id) {
            const sameProvider = apptProviderId === provider.id ||
              (provider.name && apptProviderName && apptProviderName === provider.name.toLowerCase());
            if (!sameProvider) return false;
          }
          return overlap(slotStart, slotEnd, range.startMin, range.endMin);
        });
        if (hasOverlap) continue;
        const slotTime = hm(slotStart);
        const providerId = String(provider.id ?? "").trim();
        const providerName = String(provider.name ?? "").trim();
        if (!providerId || !providerName) continue;
        results.push({
          date: input.date,
          time: slotTime,
          starts_at: `${input.date}T${slotTime}:00`,
          provider_id: providerId,
          provider_name: providerName,
          service_key: serviceContract.service_key,
          service_name: serviceContract.service_name,
        });
      }
    }
  }
  const unique = new Map<string, AvailabilitySlotOption>();
  const grouped = new Map<string, AvailabilitySlotOption[]>();
  for (const slot of sortSlots(results)) {
    const key = `${slot.date}|${slot.time}`;
    const arr = grouped.get(key) ?? [];
    arr.push(slot);
    grouped.set(key, arr);
  }
  const assignedLoad = new Map<string, number>();
  const orderedKeys = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  for (const key of orderedKeys) {
    const group = grouped.get(key) ?? [];
    if (group.length === 0) continue;
    let selected = group[0];
    if (input.provider_preference === "any" && group.length > 1) {
      const effectiveLoad = new Map<string, number>();
      for (const candidate of group) {
        const id = String(candidate.provider_id ?? "");
        const base = dailyLoadByProvider.get(id) ?? 0;
        const assigned = assignedLoad.get(id) ?? 0;
        effectiveLoad.set(id, base + assigned);
      }
      selected = group
        .slice()
        .sort((a, b) => compareProviderAssignment(a, b, effectiveLoad))[0];
    }
    unique.set(key, selected);
    const selectedId = String(selected.provider_id ?? "");
    if (selectedId) {
      assignedLoad.set(selectedId, (assignedLoad.get(selectedId) ?? 0) + 1);
    }
  }
  const max = Math.max(2, Math.min(50, input.max_options ?? 5));
  return Array.from(unique.values()).slice(0, max);
}

export async function getAvailabilityDiagnosticsForDay(
  input: AvailabilityInput & { date: string },
): Promise<AvailabilityDiagnostics> {
  const providers = await loadProviders(input.supabase, input.organization_id);
  const providerHours = await loadProviderHours(input.supabase, input.organization_id);
  const providerHoursRows = providerHours.rows;
  const businessHoursWithSource = await loadBusinessHoursWithSource(input.supabase, input.organization_id);
  if (providers.length === 0 || (!hasOpenHours(businessHoursWithSource.hours) && providerHoursRows.length === 0)) {
    return {
      providerHoursCount: providerHoursRows.length,
      providersCount: providers.length,
      firstSlots: [],
      sourceUsed: businessHoursWithSource.source,
    };
  }
  const dayKey = JS_DAY_TO_KEY[new Date(`${input.date}T12:00:00`).getDay()];
  const providerCandidates: ProviderRow[] = input.provider_preference === "specific"
    ? providers.filter((p) => p.id === String(input.provider_id ?? ""))
    : providers;
  const candidateIds = new Set((providerCandidates.length > 0 ? providerCandidates : providers).map((p) => p.id));
  const dayProviderHours = providerHoursRows.filter((r) =>
    candidateIds.has(r.barber_id) && normalizeDay(r.day_of_week) === dayKey
  );
  const sourceUsed: HoursSource = dayProviderHours.length > 0
    ? "barber_hours"
    : businessHoursWithSource.source;
  const slots = await getAvailableSlotsForDay({
    ...input,
    max_options: 5,
  });
  return {
    providerHoursCount: providerHoursRows.length,
    providersCount: providerCandidates.length > 0 ? providerCandidates.length : providers.length,
    firstSlots: slots.slice(0, 5).map((slot) => slot.time),
    sourceUsed,
  };
}

export async function suggestNextAvailableSlots(
  input: AvailabilityInput & { date_from: string; date_to?: string },
): Promise<AvailabilitySlotOption[]> {
  const timezone = input.timezone || (await loadOrgSettings(input.supabase, input.organization_id)).timezone;
  const from = input.date_from;
  const to = input.date_to ??
    (() => {
      const d = new Date(`${from}T12:00:00`);
      d.setDate(d.getDate() + 7);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
  const dates = buildDateRange(from, to);
  const out: AvailabilitySlotOption[] = [];
  for (const date of dates) {
    const daySlots = await getAvailableSlotsForDay({
      ...input,
      timezone,
      date,
      max_options: input.max_options ?? 5,
    });
    out.push(...daySlots);
    if (out.length >= (input.max_options ?? 5)) break;
  }
  return sortSlots(out).slice(0, Math.max(2, Math.min(5, input.max_options ?? 5)));
}

export async function checkSlotAvailability(
  input: AvailabilityInput & { date: string; specific_time: string },
): Promise<SlotAvailabilityResult> {
  const timezone = input.timezone || (await loadOrgSettings(input.supabase, input.organization_id)).timezone;
  const targetMin = parseHm(input.specific_time);
  if (targetMin < 0) return { available: false, reason: "outside_hours" };
  const now = getNowInTimezone(timezone);
  const today = formatDateInTimezone(now, timezone);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (input.date < today || (input.date === today && targetMin <= nowMin)) {
    const alternatives = await suggestNextAvailableSlots({
      ...input,
      date_from: input.date === today ? today : input.date,
      time_preference: input.time_preference,
      max_options: 3,
    });
    return { available: false, reason: "past_time", alternatives };
  }

  const daySlots = await getAvailableSlotsForDay({
    ...input,
    date: input.date,
    time_preference: "specific",
    specific_time: input.specific_time,
    max_options: 5,
  });
  const exact = daySlots.find((s) => s.time === input.specific_time);
  if (exact) return { available: true, slot: exact };

  const anySlotSameDay = await getAvailableSlotsForDay({
    ...input,
    date: input.date,
    max_options: 24,
  });
  const futureSameDayByCloseness = anySlotSameDay
    .filter((slot) => {
      if (slot.date !== today) return true;
      const slotMin = parseHm(slot.time);
      return slotMin > nowMin;
    })
    .sort((a, b) => Math.abs(parseHm(a.time) - targetMin) - Math.abs(parseHm(b.time) - targetMin));
  if (String(input.business_type ?? "").toLowerCase() === "barbershop") {
    console.log(JSON.stringify({
      event: "exact_time_alternatives_filtered_future",
      organization_id: input.organization_id,
      requested_date: input.date,
      requested_time: input.specific_time,
      alternatives_count: futureSameDayByCloseness.length,
    }));
    console.log(JSON.stringify({
      event: "exact_time_alternatives_sorted_by_closeness",
      organization_id: input.organization_id,
      requested_date: input.date,
      requested_time: input.specific_time,
      alternatives: futureSameDayByCloseness.slice(0, 3).map((slot) => ({ date: slot.date, time: slot.time, provider_id: slot.provider_id })),
    }));
  }
  if (anySlotSameDay.length === 0) {
    const alt = await suggestNextAvailableSlots({
      ...input,
      date_from: input.date,
      max_options: 3,
    });
    // Distinguish closed/outside from overlap best-effort.
    const dayKey = JS_DAY_TO_KEY[new Date(`${input.date}T12:00:00`).getDay()];
    const businessHours = (await loadBusinessHoursWithSource(input.supabase, input.organization_id)).hours;
    const dayCfg = businessHours[dayKey];
    if (!dayCfg || dayCfg.closed) return { available: false, reason: "closed_day", alternatives: alt };
    const start = parseHm(dayCfg.open ?? "08:00");
    const end = parseHm(dayCfg.close ?? "17:00");
    if (targetMin < start || targetMin >= end) return { available: false, reason: "outside_hours", alternatives: alt };
    return { available: false, reason: "overlap", alternatives: alt };
  }
  if (futureSameDayByCloseness.length > 0) {
    return { available: false, reason: "overlap", alternatives: futureSameDayByCloseness.slice(0, 3) };
  }
  const nextOpenAlternatives = await suggestNextAvailableSlots({
    ...input,
    date_from: input.date,
    max_options: 3,
  });
  return { available: false, reason: "overlap", alternatives: nextOpenAlternatives };
}
