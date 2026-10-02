import type { ReferralService } from "./referralPresentation";

export type PartnerQueueStatus = "new" | "follow_up" | "approved" | "disqualified";
export type PartnerStatusFilter = "all" | PartnerQueueStatus;
export type FollowUpReason = "no_answer" | "missing_police_report" | "missing_document" | "missing_information" | "other";

export type QueueItem = {
  id: string;
  status: string;
  workStatus: string;
  assignedAt: string;
  updatedAt: string;
  nextFollowupAt?: string | null;
};

export const QUEUE_STATUS_LABEL: Record<PartnerQueueStatus, string> = {
  new: "Nuevo",
  follow_up: "Seguimiento",
  approved: "Aprobado",
  disqualified: "No calificó",
};

// 'follow_up' is the real, durable work_status the backend now persists
// (20260907000100_partner_follow_up_contract.sql). contacted/
// appointment_scheduled/in_progress are kept mapped to the same UI bucket
// for backward compatibility with any assignment written before that
// migration — none of those three values are removed or reused for
// anything else.
export function resolvePartnerQueueStatus(item: Pick<QueueItem, "status" | "workStatus">): PartnerQueueStatus {
  if (item.workStatus === "converted") return "approved";
  if (item.workStatus === "not_converted") return "disqualified";
  if (["follow_up", "contacted", "appointment_scheduled", "in_progress"].includes(item.workStatus)) return "follow_up";
  return "new";
}

export function isFollowUpOverdue(item: QueueItem, now = new Date()): boolean {
  if (resolvePartnerQueueStatus(item) !== "follow_up" || !item.nextFollowupAt) return false;
  const due = new Date(item.nextFollowupAt);
  return !Number.isNaN(due.getTime()) && due.getTime() <= now.getTime();
}

export function sortPartnerQueue<T extends QueueItem>(items: readonly T[], now = new Date()): T[] {
  return [...items].sort((a, b) => {
    const aStatus = resolvePartnerQueueStatus(a);
    const bStatus = resolvePartnerQueueStatus(b);
    const aOverdue = isFollowUpOverdue(a, now);
    const bOverdue = isFollowUpOverdue(b, now);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    const rank = (status: PartnerQueueStatus) => status === "new" ? 1 : status === "follow_up" ? 2 : 3;
    if (rank(aStatus) !== rank(bStatus)) return rank(aStatus) - rank(bStatus);
    // Untouched leads intentionally rise by oldest assignment first.
    if (aStatus === "new" && bStatus === "new") return new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime();
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

const GENERIC_FOLLOW_UP_REASONS: Array<{ id: FollowUpReason; label: string }> = [
  { id: "no_answer", label: "No respondió" },
  { id: "missing_information", label: "Falta información" },
  { id: "other", label: "Otro" },
];

export function followUpReasonsForService(service: ReferralService | null): Array<{ id: FollowUpReason; label: string }> {
  if (service === "auto_accident") return [
    { id: "no_answer", label: "No respondió" },
    { id: "missing_police_report", label: "Falta reporte policial" },
    ...GENERIC_FOLLOW_UP_REASONS.slice(1),
  ];
  if (service === "immigration" || service === "dui" || service === "criminal") return [
    { id: "no_answer", label: "No respondió" },
    { id: "missing_document", label: "Falta documento" },
    ...GENERIC_FOLLOW_UP_REASONS.slice(1),
  ];
  return GENERIC_FOLLOW_UP_REASONS;
}

export const FOLLOW_UP_REASON_LABEL: Record<FollowUpReason, string> = {
  no_answer: "No respondió",
  missing_police_report: "Falta reporte policial",
  missing_document: "Falta documento",
  missing_information: "Falta información",
  other: "Otro",
};

// 'custom' has no minutesFromNow/dayOffset — the caller supplies an explicit
// date/time for it. Every other option is a pure function of "now", so the
// preview and the persisted value are always computed the same way.
export type ReminderOptionId = "30m" | "1h" | "2h" | "tomorrow" | "3d" | "7d" | "none" | "custom";

export type ReminderOption = { id: ReminderOptionId; label: string };

// First option in each list is always the default, matching the product
// spec (no_answer defaults to 30 min, missing_police_report/other default
// to no reminder).
const REMINDER_OPTIONS_BY_REASON: Record<FollowUpReason, ReminderOption[]> = {
  no_answer: [
    { id: "30m", label: "30 min" },
    { id: "1h", label: "1 hora" },
    { id: "2h", label: "2 horas" },
    { id: "tomorrow", label: "Mañana" },
    { id: "custom", label: "Personalizado" },
  ],
  missing_police_report: [
    { id: "none", label: "Sin recordatorio" },
    { id: "tomorrow", label: "Mañana" },
    { id: "3d", label: "3 días" },
    { id: "7d", label: "7 días" },
    { id: "custom", label: "Personalizado" },
  ],
  missing_document: [
    { id: "30m", label: "30 min" },
    { id: "1h", label: "1 hora" },
    { id: "tomorrow", label: "Mañana" },
    { id: "custom", label: "Personalizado" },
  ],
  missing_information: [
    { id: "30m", label: "30 min" },
    { id: "1h", label: "1 hora" },
    { id: "tomorrow", label: "Mañana" },
    { id: "custom", label: "Personalizado" },
  ],
  other: [
    { id: "none", label: "Sin recordatorio" },
    { id: "custom", label: "Personalizado" },
  ],
};

export function reminderOptionsForReason(reason: FollowUpReason): ReminderOption[] {
  return REMINDER_OPTIONS_BY_REASON[reason];
}

export function defaultReminderOptionForReason(reason: FollowUpReason): ReminderOptionId {
  return REMINDER_OPTIONS_BY_REASON[reason][0].id;
}

// "Mañana"/"3 días"/"7 días" land on a fixed 9:00 local time the next day(s)
// rather than "exactly N*24h from click time", so a partner working at
// 11:47pm still gets a sane morning reminder instead of one at 11:47pm.
function atNineAm(daysFromNow: number, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromNow, 9, 0, 0, 0);
  return d;
}

// Returns an ISO timestamp for the backend, or null for "no reminder".
// 'custom' requires callers to pass customDate; without one it falls back to
// null (no reminder) rather than silently guessing a time.
export function computeNextFollowupAt(optionId: ReminderOptionId, now = new Date(), customDate?: Date | null): string | null {
  switch (optionId) {
    case "30m": return new Date(now.getTime() + 30 * 60_000).toISOString();
    case "1h": return new Date(now.getTime() + 60 * 60_000).toISOString();
    case "2h": return new Date(now.getTime() + 120 * 60_000).toISOString();
    case "tomorrow": return atNineAm(1, now).toISOString();
    case "3d": return atNineAm(3, now).toISOString();
    case "7d": return atNineAm(7, now).toISOString();
    case "none": return null;
    case "custom": return customDate && !Number.isNaN(customDate.getTime()) ? customDate.toISOString() : null;
    default: return null;
  }
}

// Shared by the pre-save preview ("Próximo seguimiento") and the persisted
// display ("Próximo intento") so both always read identically for the same
// moment. Renders in the browser's local timezone.
export function formatFollowUpMoment(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "Sin recordatorio";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Sin recordatorio";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const time = new Intl.DateTimeFormat("es-US", { hour: "numeric", minute: "2-digit" }).format(date);
  if (diffDays === 0) return `Hoy, ${time}`;
  if (diffDays === 1) return `Mañana, ${time}`;
  if (diffDays === -1) return `Ayer, ${time}`;
  return `${new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(date)}, ${time}`;
}

export function countOverdueFollowUps(items: readonly QueueItem[], now = new Date()): number {
  return items.filter((item) => isFollowUpOverdue(item, now)).length;
}

// --- Personalizado: separate Fecha/Hora controls ---------------------------

// Combines a <input type="date"> value ("YYYY-MM-DD") and a
// <input type="time"> value ("HH:MM") into a single local Date. Returns null
// if either half is missing/malformed — the caller must never fabricate a
// timestamp from a partial selection.
export function combineCustomDateTime(dateValue: string, timeValue: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;
  const date = new Date(
    Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Number(timeMatch[1]), Number(timeMatch[2]), 0, 0,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

// A Personalizado selection is only "ready" once it's complete AND not in
// the past — an incomplete or past pick must never silently read as "Sin
// recordatorio" (that phrase is reserved for the intentional no-reminder
// preset) nor silently persist a timestamp that's already elapsed.
export function isCustomFollowUpReady(date: Date | null, now = new Date()): boolean {
  return date !== null && date.getTime() > now.getTime();
}

// Deliberately different shape from formatFollowUpMoment's "Hoy,"/"Mañana,"
// relative labels — a date the partner explicitly picked should always read
// as an absolute date, never a relative one.
export function formatCustomFollowUpPreview(date: Date): string {
  const datePart = new Intl.DateTimeFormat("es-US", { day: "numeric", month: "short", year: "numeric" }).format(date);
  const timePart = new Intl.DateTimeFormat("es-US", { hour: "numeric", minute: "2-digit" }).format(date);
  return `${datePart} · ${timePart}`;
}

// Value for a date input's `min` attribute — today, in local time.
export function todayDateInputValue(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Value for a time input's `min` attribute, used only when the selected
// date is today — otherwise any time of day is valid.
export function nowTimeInputValue(now = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
