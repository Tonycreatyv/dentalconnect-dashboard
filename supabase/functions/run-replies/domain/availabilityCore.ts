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

type ProviderRow = { id: string; name: string };
type ServiceRow = { id: string; name: string; duration_min: number };
type ProviderHoursRow = { barber_id: string; day_of_week: string; start_time: string; end_time: string };
type HoursSource = "barber_hours" | "business_hours" | "default_hours";

export type AvailabilitySlotOption = {
  date: string;
  time: string;
  starts_at?: string | null;
  service_key?: string | null;
  service_name?: string | null;
  provider_id?: string | null;
  provider_name?: string | null;
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
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function getNowInTimezone(timezone: string): Date {
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

async function loadServices(supabase: any, organizationId: string): Promise<ServiceRow[]> {
  const res = await supabase
    .from("barber_services")
    .select("id,name,duration_min,is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows.map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
    duration_min: Number(r.duration_min) > 0 ? Number(r.duration_min) : 45,
  }));
}

async function loadProviders(supabase: any, organizationId: string): Promise<ProviderRow[]> {
  const res = await supabase
    .from("barbers")
    .select("id,name,is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows.map((r: any) => ({ id: String(r.id), name: String(r.name ?? "") })).filter((p: ProviderRow) => p.id);
}

async function loadProviderHours(supabase: any, organizationId: string): Promise<ProviderHoursRow[]> {
  const res = await supabase
    .from("barber_hours")
    .select("barber_id,day_of_week,start_time,end_time,is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows
    .map((r: any) => ({
      barber_id: String(r.barber_id ?? ""),
      day_of_week: String(r.day_of_week ?? ""),
      start_time: String(r.start_time ?? "").slice(0, 5),
      end_time: String(r.end_time ?? "").slice(0, 5),
    }))
    .filter((r: ProviderHoursRow) => r.barber_id && r.start_time && r.end_time);
}

async function loadBusinessHoursWithSource(
  supabase: any,
  organizationId: string,
): Promise<{ hours: HoursMap; source: "business_hours" | "default_hours" }> {
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
  return { hours: { ...DEFAULT_HOURS }, source: "default_hours" };
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

function getProviderWindowsForDate(
  date: string,
  providerId: string | null,
  providerHours: ProviderHoursRow[],
  businessHours: HoursMap,
): Array<{ startMin: number; endMin: number }> {
  const dayKey = JS_DAY_TO_KEY[new Date(`${date}T12:00:00`).getDay()];
  const hasAnyProviderHours = providerHours.length > 0;
  if (providerId) {
    const rows = providerHours.filter((r) => r.barber_id === providerId && normalizeDay(r.day_of_week) === dayKey);
    if (rows.length > 0) {
      return rows
        .map((r) => ({ startMin: parseHm(r.start_time), endMin: parseHm(r.end_time) }))
        .filter((w) => w.startMin >= 0 && w.endMin > w.startMin);
    }
    // If provider-hours exist, do not silently fallback to default/business hours for this provider.
    if (hasAnyProviderHours) return [];
  }
  const cfg = businessHours[dayKey];
  if (!cfg || cfg.closed) return [];
  const open = parseHm(cfg.open ?? "08:00");
  const close = parseHm(cfg.close ?? "17:00");
  if (open < 0 || close <= open) return [];
  return [{ startMin: open, endMin: close }];
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

function matchesTimePreference(slotMin: number, pref?: TimePreference, specificTime?: string): boolean {
  if (!pref) return true;
  if (pref === "specific") {
    const want = parseHm(specificTime ?? "");
    return want >= 0 ? slotMin === want : true;
  }
  if (pref === "morning") return slotMin < 12 * 60;
  if (pref === "afternoon") return slotMin >= 12 * 60 && slotMin < 17 * 60;
  if (pref === "evening") return slotMin >= 17 * 60;
  return true;
}

function sortSlots(slots: AvailabilitySlotOption[]): AvailabilitySlotOption[] {
  return slots.sort((a, b) => (a.date.localeCompare(b.date) || parseHm(a.time) - parseHm(b.time)));
}

export async function getAvailableSlotsForDay(input: AvailabilityInput & { date: string }): Promise<AvailabilitySlotOption[]> {
  const isBarbershop = String(input.business_type ?? "").toLowerCase() === "barbershop";
  const slotStepMin = isBarbershop ? 30 : 15;
  const minBarbershopMinute = 9 * 60;
  const timezone = input.timezone || (await loadOrgSettings(input.supabase, input.organization_id)).timezone;
  const services = await loadServices(input.supabase, input.organization_id);
  const providers = await loadProviders(input.supabase, input.organization_id);
  const providerHours = await loadProviderHours(input.supabase, input.organization_id);
  const businessHours = (await loadBusinessHoursWithSource(input.supabase, input.organization_id)).hours;
  const durationMin = resolveDuration(input.service_id, input.service_name, services);
  const appointments = await loadAppointmentsForRange(input.supabase, input.organization_id, input.date, input.date);

  const now = getNowInTimezone(timezone);
  const today = formatDateInTimezone(now, timezone);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const providerCandidates: ProviderRow[] = input.provider_preference === "specific"
    ? providers.filter((p) => p.id === String(input.provider_id ?? ""))
    : providers;
  const withFallback = providerCandidates.length > 0 ? providerCandidates : [{ id: "", name: "" }];

  const results: AvailabilitySlotOption[] = [];
  for (const provider of withFallback) {
    const windows = getProviderWindowsForDate(input.date, provider.id || null, providerHours, businessHours);
    for (const window of windows) {
      for (let m = window.startMin; m + durationMin <= window.endMin; m += slotStepMin) {
        if (isBarbershop && m < minBarbershopMinute) continue;
        if (!matchesTimePreference(m, input.time_preference as TimePreference | undefined, input.specific_time)) continue;
        if (input.date === today && m <= nowMin) continue;
        const slotStart = m;
        const slotEnd = m + durationMin;
        const hasOverlap = appointments.some((appt) => {
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
        results.push({
          date: input.date,
          time: hm(slotStart),
          provider_id: provider.id || null,
          provider_name: provider.name || null,
        });
      }
    }
  }
  const unique = new Map<string, AvailabilitySlotOption>();
  for (const slot of sortSlots(results)) {
    const k = `${slot.date}|${slot.time}`;
    if (!unique.has(k)) unique.set(k, slot);
  }
  const max = Math.max(2, Math.min(5, input.max_options ?? 5));
  return Array.from(unique.values()).slice(0, max);
}

export async function getAvailabilityDiagnosticsForDay(
  input: AvailabilityInput & { date: string },
): Promise<AvailabilityDiagnostics> {
  const providers = await loadProviders(input.supabase, input.organization_id);
  const providerHours = await loadProviderHours(input.supabase, input.organization_id);
  const businessHoursWithSource = await loadBusinessHoursWithSource(input.supabase, input.organization_id);
  const dayKey = JS_DAY_TO_KEY[new Date(`${input.date}T12:00:00`).getDay()];
  const providerCandidates: ProviderRow[] = input.provider_preference === "specific"
    ? providers.filter((p) => p.id === String(input.provider_id ?? ""))
    : providers;
  const candidateIds = new Set((providerCandidates.length > 0 ? providerCandidates : providers).map((p) => p.id));
  const dayProviderHours = providerHours.filter((r) =>
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
    providerHoursCount: providerHours.length,
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
    max_options: 3,
  });
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
  return { available: false, reason: "overlap", alternatives: anySlotSameDay.slice(0, 3) };
}
