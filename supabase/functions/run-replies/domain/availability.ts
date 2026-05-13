type DayHours = { closed: boolean; open?: string; close?: string };
type HoursMap = Record<string, DayHours>;

const DAY_KEYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const JS_DAY_TO_KEY: Record<number, string> = {
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

const JS_DAY_FROM_INDEX: Record<number, string> = {
  0: "domingo",
  1: "lunes",
  2: "martes",
  3: "miercoles",
  4: "jueves",
  5: "viernes",
  6: "sabado",
};

const HOURS_KEY_ALIASES: Record<string, string> = {
  mon: "lunes",
  tue: "martes",
  wed: "miercoles",
  thu: "jueves",
  fri: "viernes",
  sat: "sabado",
  sun: "domingo",
  monday: "lunes",
  tuesday: "martes",
  wednesday: "miercoles",
  thursday: "jueves",
  friday: "viernes",
  saturday: "sabado",
  sunday: "domingo",
  lunes: "lunes",
  martes: "martes",
  miercoles: "miercoles",
  miércoles: "miercoles",
  jueves: "jueves",
  viernes: "viernes",
  sabado: "sabado",
  sábado: "sabado",
  domingo: "domingo",
};

export interface AvailableSlot {
  date: string;
  dayLabel: string;
  time: string;
}

export interface ExactSlotCheckResult {
  available: boolean;
  reason?: "outside_hours" | "after_cutoff" | "past_slot" | "conflict";
}

export interface PatientFriendlySlotSelection {
  slots: AvailableSlot[];
  summarizeAdjacentRange: boolean;
}

function normalizeHours(hours: HoursMap | Record<string, unknown> | null | undefined): HoursMap {
  const normalized: HoursMap = { ...DEFAULT_HOURS };
  const source = hours && typeof hours === "object" ? hours : {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const dayKey = HOURS_KEY_ALIASES[String(rawKey).toLowerCase()];
    if (!dayKey || !rawValue || typeof rawValue !== "object") continue;
    const value = rawValue as Record<string, unknown>;
    normalized[dayKey] = {
      closed: Boolean(value.closed),
      open: typeof value.open === "string" ? value.open : normalized[dayKey]?.open,
      close: typeof value.close === "string" ? value.close : normalized[dayKey]?.close,
    };
  }

  return normalized;
}

function hasHoursConfig(hours: HoursMap | Record<string, unknown> | null | undefined): boolean {
  if (!hours || typeof hours !== "object") return false;
  for (const rawValue of Object.values(hours)) {
    if (!rawValue || typeof rawValue !== "object") continue;
    const value = rawValue as Record<string, unknown>;
    if (typeof value.open === "string" || typeof value.close === "string") return true;
    if (typeof value.closed === "boolean") return true;
  }
  return false;
}

function normalizeTimeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return undefined;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function resolveDayKey(value: unknown): string | null {
  if (typeof value === "number") {
    if (value >= 0 && value <= 6) return JS_DAY_FROM_INDEX[value] ?? null;
    if (value >= 1 && value <= 7) return JS_DAY_FROM_INDEX[value % 7] ?? null;
    return null;
  }
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return resolveDayKey(Number(raw));
  return HOURS_KEY_ALIASES[raw] ?? null;
}

function mapRowsToHours(rows: unknown[]): HoursMap | null {
  const mapped: HoursMap = {};
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const dayKey = resolveDayKey(
      value.day_of_week ?? value.weekday ?? value.day ?? value.day_key,
    );
    if (!dayKey) continue;
    const open = normalizeTimeToken(value.open_time ?? value.open ?? value.opens_at);
    const close = normalizeTimeToken(value.close_time ?? value.close ?? value.closes_at);
    const closed = Boolean(value.is_closed ?? value.closed);
    mapped[dayKey] = {
      closed,
      open: open ?? mapped[dayKey]?.open,
      close: close ?? mapped[dayKey]?.close,
    };
  }
  return Object.keys(mapped).length > 0 ? normalizeHours(mapped) : null;
}

async function loadHoursFromDb(args: {
  supabase: any;
  organizationId: string;
}): Promise<{ hours: HoursMap; source: "business_hours" | "clinic_hours" | "default" }> {
  const { supabase, organizationId } = args;
  const businessHours = await supabase
    .from("business_hours")
    .select("day_of_week, weekday, day, open_time, close_time, opens_at, closes_at, is_closed, closed")
    .eq("organization_id", organizationId)
    .limit(14);
  if (!businessHours.error && Array.isArray(businessHours.data) && businessHours.data.length > 0) {
    const mapped = mapRowsToHours(businessHours.data as unknown[]);
    if (mapped) return { hours: mapped, source: "business_hours" };
  }

  const clinicHours = await supabase
    .from("clinic_hours")
    .select("day_of_week, weekday, day, open_time, close_time, opens_at, closes_at, is_closed, closed")
    .eq("organization_id", organizationId)
    .limit(14);
  if (!clinicHours.error && Array.isArray(clinicHours.data) && clinicHours.data.length > 0) {
    const mapped = mapRowsToHours(clinicHours.data as unknown[]);
    if (mapped) return { hours: mapped, source: "clinic_hours" };
  }

  console.log(
    JSON.stringify({
      event: "availability:using_default_hours",
      organization_id: organizationId,
      reason: "db_hours_missing_or_unreadable",
    }),
  );
  return { hours: { ...DEFAULT_HOURS }, source: "default" };
}

async function resolveHours(args: {
  supabase: any;
  organizationId: string;
  hours?: HoursMap | Record<string, unknown>;
}): Promise<HoursMap> {
  if (hasHoursConfig(args.hours)) {
    return normalizeHours(args.hours);
  }
  const loaded = await loadHoursFromDb({
    supabase: args.supabase,
    organizationId: args.organizationId,
  });
  return loaded.hours;
}

export async function getAvailableSlots(args: {
  supabase: any;
  organizationId: string;
  hours?: HoursMap | Record<string, unknown>;
  daysAhead?: number;
  slotDurationMin?: number;
  timezone?: string;
  sameDayBookingCutoff?: string;
  bufferMin?: number;
}): Promise<AvailableSlot[]> {
  const {
    supabase,
    organizationId,
    daysAhead = 5,
    slotDurationMin = 30,
    timezone = "America/Tegucigalpa",
    sameDayBookingCutoff = "15:00",
    bufferMin = 10,
  } = args;
  const slots: AvailableSlot[] = [];
  const hours = await resolveHours({
    supabase,
    organizationId,
    hours: args.hours,
  });
  const now = getNowInTimezone(timezone);
  const localToday = formatDateInTimezone(now, timezone);
  const cutoffMinutes = parseHmToMinutes(sameDayBookingCutoff, 15 * 60);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const afterCutoff = nowMinutes >= cutoffMinutes;

  let daysChecked = 0;
  let dayOffset = 0;

  while (daysChecked < daysAhead && dayOffset < 14) {
    const checkDate = new Date(now);
    checkDate.setDate(checkDate.getDate() + dayOffset);
    dayOffset++;

    const dayKey = JS_DAY_TO_KEY[checkDate.getDay()];
    const dayConfig = hours[dayKey];
    if (!dayConfig || dayConfig.closed) continue;

    const openTime = dayConfig.open ?? "08:00";
    const closeTime = dayConfig.close ?? "17:00";
    const dateStr = formatDateInTimezone(checkDate, timezone);
    const isToday = dateStr === localToday;
    if (isToday && afterCutoff) continue;

    const { data: existingAppts } = await supabase
      .from("appointments")
      .select("start_at, starts_at, end_at, ends_at, appointment_time, duration_min, status")
      .eq("organization_id", organizationId)
      .gte("start_at", `${dateStr}T00:00:00`)
      .lte("start_at", `${dateStr}T23:59:59`)
      .neq("status", "cancelled");

    const bookedRanges: Array<{ startMin: number; endMin: number }> = [];
    if (existingAppts) {
      for (const appt of existingAppts) {
        const start = String(appt.start_at ?? appt.starts_at ?? "");
        const end = String(appt.end_at ?? appt.ends_at ?? "");
        const fallbackTime = String(appt.appointment_time ?? "");
        const startMin = start ? parseHmToMinutes(start.slice(11, 16), -1) : parseHmToMinutes(fallbackTime, -1);
        if (startMin < 0) continue;
        const fallbackDuration = Number(appt.duration_min) || slotDurationMin;
        const endMin = end
          ? parseHmToMinutes(end.slice(11, 16), startMin + fallbackDuration)
          : startMin + fallbackDuration;
        bookedRanges.push({ startMin, endMin });
      }
    }

    const [openH, openM] = openTime.split(":").map(Number);
    const [closeH, closeM] = closeTime.split(":").map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;
    const minSameDayStart = isToday
      ? roundUpToStep(nowMinutes + Math.max(0, bufferMin), slotDurationMin)
      : openMinutes;
    const firstSlot = Math.max(openMinutes, minSameDayStart);

    for (let m = firstSlot; m + slotDurationMin <= closeMinutes; m += slotDurationMin) {
      const slotTime = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const slotStart = m;
      const slotEnd = m + slotDurationMin;
      const blocked = bookedRanges.some((range) =>
        slotStart < range.endMin + Math.max(0, bufferMin) &&
        slotEnd > range.startMin - Math.max(0, bufferMin)
      );
      if (blocked) continue;

      const dayIdx = DAY_KEYS.indexOf(dayKey);
      const dayNum = checkDate.getDate();
      const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      const monthLabel = monthNames[checkDate.getMonth()];

      slots.push({
        date: dateStr,
        dayLabel: `${DAY_LABELS[dayIdx]} ${dayNum} ${monthLabel}`,
        time: slotTime,
      });
    }

    daysChecked++;
  }

  return slots;
}

function getNowInTimezone(timezone: string): Date {
  const localized = new Date().toLocaleString("en-US", { timeZone: timezone });
  const parsed = new Date(localized);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
}

function parseHmToMinutes(value: string, fallback: number): number {
  const m = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return fallback;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return hh * 60 + mm;
}

function roundUpToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.ceil(value / step) * step;
}

export function formatSlotsMessage(slots: AvailableSlot[], maxDays = 3, maxSlotsPerDay = 5): string {
  const grouped: Record<string, AvailableSlot[]> = {};
  for (const slot of slots) {
    if (!grouped[slot.date]) grouped[slot.date] = [];
    grouped[slot.date].push(slot);
  }

  const days = Object.entries(grouped).slice(0, maxDays);
  if (days.length === 0) {
    return "No tenemos disponibilidad esta semana. ¿Te gustaría que te contactemos cuando haya espacio?";
  }

  return days
    .map(([, daySlots]) => {
      const label = daySlots[0].dayLabel;
      const times = daySlots.slice(0, maxSlotsPerDay).map((slot) => slot.time).join(", ");
      return `📅 ${label} — ${times}`;
    })
    .join("\n");
}

function slotMinutes(time: string): number {
  return parseHmToMinutes(time, -1);
}

function isAdjacentSlot(a: AvailableSlot, b: AvailableSlot): boolean {
  if (a.date !== b.date) return false;
  return Math.abs(slotMinutes(a.time) - slotMinutes(b.time)) <= 60;
}

function slotBucket(time: string): "morning" | "afternoon" | "evening" {
  const mins = slotMinutes(time);
  if (mins < 12 * 60) return "morning";
  if (mins < 17 * 60) return "afternoon";
  return "evening";
}

function uniqueSlots(slots: AvailableSlot[]): AvailableSlot[] {
  const seen = new Set<string>();
  const out: AvailableSlot[] = [];
  for (const slot of slots) {
    const key = `${slot.date}|${slot.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
  }
  return out;
}

export function selectPatientFriendlySlots(args: {
  slots: AvailableSlot[];
  mode: "general" | "specific_day";
  requestedDate?: string;
  maxOptions?: number;
}): PatientFriendlySlotSelection {
  const maxOptions = Math.max(1, Math.min(3, args.maxOptions ?? 3));
  const ordered = uniqueSlots(args.slots).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return slotMinutes(a.time) - slotMinutes(b.time);
  });

  if (!ordered.length) {
    return { slots: [], summarizeAdjacentRange: false };
  }

  if (args.mode === "specific_day") {
    const daySlots = (args.requestedDate
      ? ordered.filter((s) => s.date === args.requestedDate)
      : ordered
    ).slice();
    if (!daySlots.length) return { slots: [], summarizeAdjacentRange: false };
    if (daySlots.length <= maxOptions) {
      const adjacent = daySlots.length >= 2 &&
        daySlots.every((slot, idx) => idx === 0 || isAdjacentSlot(daySlots[idx - 1], slot));
      const allMorning = daySlots.every((slot) => slotBucket(slot.time) === "morning");
      return { slots: daySlots, summarizeAdjacentRange: adjacent && allMorning };
    }
    const first = daySlots[0];
    const middle = daySlots[Math.floor(daySlots.length / 2)];
    const last = daySlots[daySlots.length - 1];
    return { slots: uniqueSlots([first, middle, last]).slice(0, maxOptions), summarizeAdjacentRange: false };
  }

  const selected: AvailableSlot[] = [];
  const usedDates = new Set<string>();
  const pushIfValid = (slot: AvailableSlot | undefined, allowAdjacent = false) => {
    if (!slot) return;
    if (selected.some((s) => s.date === slot.date && s.time === slot.time)) return;
    if (!allowAdjacent && selected.some((s) => isAdjacentSlot(s, slot))) return;
    selected.push(slot);
    usedDates.add(slot.date);
  };

  const firstByDate = ordered.filter((slot, idx, arr) => idx === arr.findIndex((s) => s.date === slot.date));
  for (const bucket of ["morning", "afternoon", "evening"] as const) {
    pushIfValid(firstByDate.find((slot) => slotBucket(slot.time) === bucket));
    if (selected.length >= maxOptions) return { slots: selected, summarizeAdjacentRange: false };
  }

  for (const slot of firstByDate) {
    pushIfValid(slot);
    if (selected.length >= maxOptions) break;
  }
  if (selected.length >= maxOptions) {
    return {
      slots: selected.sort((a, b) => a.date.localeCompare(b.date) || slotMinutes(a.time) - slotMinutes(b.time)),
      summarizeAdjacentRange: false,
    };
  }

  for (const slot of ordered) {
    const sameDateOnly = usedDates.size <= 1;
    pushIfValid(slot, sameDateOnly);
    if (selected.length >= maxOptions) break;
  }

  if (!selected.length) {
    return { slots: ordered.slice(0, maxOptions), summarizeAdjacentRange: false };
  }
  return {
    slots: selected.sort((a, b) => a.date.localeCompare(b.date) || slotMinutes(a.time) - slotMinutes(b.time)),
    summarizeAdjacentRange: false,
  };
}

export async function checkExactSlotAvailability(args: {
  supabase: any;
  organizationId: string;
  hours?: HoursMap | Record<string, unknown>;
  requestedDate: string;
  requestedTime: string;
  durationMin?: number;
  timezone?: string;
  sameDayBookingCutoff?: string;
  bufferMin?: number;
}): Promise<ExactSlotCheckResult> {
  const {
    supabase,
    organizationId,
    requestedDate,
    requestedTime,
    durationMin = 30,
    timezone = "America/Tegucigalpa",
    sameDayBookingCutoff = "15:00",
    bufferMin = 10,
  } = args;
  const hours = await resolveHours({
    supabase,
    organizationId,
    hours: args.hours,
  });
  const now = getNowInTimezone(timezone);
  const localToday = formatDateInTimezone(now, timezone);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const cutoffMinutes = parseHmToMinutes(sameDayBookingCutoff, 15 * 60);
  const requestedMinutes = parseHmToMinutes(requestedTime, -1);
  if (requestedMinutes < 0) return { available: false, reason: "outside_hours" };

  if (requestedDate === localToday && nowMinutes >= cutoffMinutes) {
    return { available: false, reason: "after_cutoff" };
  }

  if (
    requestedDate === localToday &&
    requestedMinutes < roundUpToStep(nowMinutes + Math.max(0, bufferMin), durationMin)
  ) {
    return { available: false, reason: "past_slot" };
  }

  const reqDateObj = new Date(`${requestedDate}T12:00:00`);
  const dayKey = JS_DAY_TO_KEY[reqDateObj.getDay()];
  const dayConfig = hours[dayKey];
  if (!dayConfig || dayConfig.closed) {
    return { available: false, reason: "outside_hours" };
  }
  const openMinutes = parseHmToMinutes(dayConfig.open ?? "08:00", 8 * 60);
  const closeMinutes = parseHmToMinutes(dayConfig.close ?? "17:00", 17 * 60);
  if (
    requestedMinutes < openMinutes ||
    requestedMinutes + durationMin > closeMinutes
  ) {
    return { available: false, reason: "outside_hours" };
  }

  const requestedStartIso = `${requestedDate}T${requestedTime}:00`;
  const requestedEndDate = new Date(`${requestedDate}T${requestedTime}:00`);
  requestedEndDate.setMinutes(requestedEndDate.getMinutes() + durationMin);
  const requestedEndIso = `${requestedDate}T${String(requestedEndDate.getHours()).padStart(2, "0")}:${
    String(requestedEndDate.getMinutes()).padStart(2, "0")
  }:00`;

  const overlapRes = await supabase
    .from("appointments")
    .select("id")
    .eq("organization_id", organizationId)
    .neq("status", "cancelled")
    .lt("starts_at", requestedEndIso)
    .gt("ends_at", requestedStartIso)
    .limit(1);

  if (overlapRes.error) {
    return { available: false, reason: "conflict" };
  }
  if ((overlapRes.data ?? []).length > 0) {
    return { available: false, reason: "conflict" };
  }
  return { available: true };
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
