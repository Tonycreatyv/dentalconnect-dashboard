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

export function periodRange(id: PeriodId, custom?: { start: string; end: string }): { start: Date; end: Date } {
  const now = new Date();
  if (id === "custom" && custom?.start && custom?.end) {
    const start = new Date(`${custom.start}T00:00:00`);
    const end = new Date(`${custom.end}T23:59:59.999`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) return { start, end };
  }
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (id === "all") {
    // No real claim predates this product's existence — 2020-01-01 is a
    // safe, deliberately-early floor, never a guess at a "real" start date.
    return { start: new Date("2020-01-01T00:00:00Z"), end };
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (id === "week") start.setDate(start.getDate() - 6);
  if (id === "month") start.setDate(start.getDate() - 29);
  return { start, end };
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
