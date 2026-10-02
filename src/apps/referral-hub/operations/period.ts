// "all" is intentionally NOT in PERIOD_TABS — it is not a user-facing
// toggle on Inicio's own period selector, only a scope that a drill-down
// link can request explicitly when its origin (a business/location card)
// shows an all-time count with no period concept of its own. See
// BusinessDetail.tsx's drill-down links and CouponRequestsScreen.
export type PeriodId = "today" | "week" | "month" | "custom" | "all";

export const PERIOD_TABS: { id: PeriodId; label: string }[] = [
  { id: "today", label: "Hoy" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
  { id: "custom", label: "Personalizado" },
];

export const PERIOD_LABELS: Record<PeriodId, string> = {
  today: "Hoy",
  week: "Últimos 7 días",
  month: "Últimos 30 días",
  custom: "Personalizado",
  all: "Todo el tiempo",
};

type CalendarDate = { year: number; month: number; day: number };

function safeTimeZone(timeZone?: string): string {
  if (!timeZone) return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }
}

function zonedParts(date: Date, timeZone: string): CalendarDate & { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  // formatToParts has second precision. Compare against the corresponding
  // whole-second instant so an end-of-day .999 millisecond never becomes a
  // one-millisecond timezone offset.
  const wholeSecond = Math.floor(instant.getTime() / 1000) * 1000;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - wholeSecond;
}

function zonedDateTimeToUtc(date: CalendarDate, hour: number, minute: number, second: number, millisecond: number, timeZone: string): Date {
  const localAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second, millisecond);
  let utc = localAsUtc - timezoneOffsetMs(new Date(localAsUtc), timeZone);
  // Recalculate once for DST transitions, where the first candidate can be
  // on the other side of the offset change.
  utc = localAsUtc - timezoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

function addDays(date: CalendarDate, amount: number): CalendarDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day));
  value.setUTCDate(value.getUTCDate() + amount);
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const verified = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return verified.getUTCFullYear() === date.year && verified.getUTCMonth() + 1 === date.month && verified.getUTCDate() === date.day ? date : null;
}

export function periodRange(id: PeriodId, custom?: { start: string; end: string }, timeZone?: string, now = new Date()): { start: Date; end: Date } {
  const zone = safeTimeZone(timeZone);
  if (id === "custom" && custom?.start && custom?.end) {
    const startDate = parseCalendarDate(custom.start);
    const endDate = parseCalendarDate(custom.end);
    if (startDate && endDate) return {
      start: zonedDateTimeToUtc(startDate, 0, 0, 0, 0, zone),
      end: zonedDateTimeToUtc(endDate, 23, 59, 59, 999, zone),
    };
  }
  const today = zonedParts(now, zone);
  const endDate = { year: today.year, month: today.month, day: today.day };
  if (id === "all") {
    // No real claim predates this product's existence — 2020-01-01 is a
    // safe, deliberately-early floor, never a guess at a "real" start date.
    return { start: zonedDateTimeToUtc({ year: 2020, month: 1, day: 1 }, 0, 0, 0, 0, zone), end: zonedDateTimeToUtc(endDate, 23, 59, 59, 999, zone) };
  }
  const startDate = id === "week" ? addDays(endDate, -6) : id === "month" ? addDays(endDate, -29) : endDate;
  return {
    start: zonedDateTimeToUtc(startDate, 0, 0, 0, 0, zone),
    end: zonedDateTimeToUtc(endDate, 23, 59, 59, 999, zone),
  };
}

export function dayKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function dayLabel(key: string): string {
  const date = new Date(`${key}T12:00:00`);
  return new Intl.DateTimeFormat("es-US", { day: "numeric", month: "short" }).format(date);
}

export function buildDayBuckets(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  let guard = 0;
  while (cursor.getTime() <= last.getTime() && guard < 92) {
    keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return keys;
}
