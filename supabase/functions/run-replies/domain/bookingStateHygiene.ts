function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

const ACTIVE_TOP_LEVEL_KEYS = [
  "booking",
  "pending_booking",
  "pending_offered_slot",
  "pending_requested_slot",
  "pending_reschedule",
  "pending_cancel",
  "active_appointment",
  "appointment",
  "availability",
  "preferred_date",
  "preferred_time",
  "appointment_date",
  "appointment_time",
  "nearest_available_date",
  "nearest_available_time",
  "nearest_available_day_label",
  "confirmed",
  "starts_at",
  "date_label",
  "time_label",
  "service",
  "last_discussed_service",
  "last_cta",
  "preferred_barber",
  "provider_name",
  "pending_booking_stale",
  "last_bot_step",
];

const ACTIVE_COLLECTED_KEYS = [...ACTIVE_TOP_LEVEL_KEYS];

const ACTIVE_NEXT_EXPECTED = new Set([
  "confirm_booking",
  "confirm_offered_slot",
  "confirm_cancel",
  "confirm_cancel_appointment",
  "confirm_reschedule",
  "confirm_reschedule_appointment",
  "change_booking_detail",
  "date_time",
]);

const ACTIVE_LAST_INTENT = new Set([
  "booking_reschedule",
  "booking_cancel",
  "booking_confirm",
  "book_appointment",
]);

export type ClearActiveBookingStateOptions = {
  resetNextExpected?: boolean;
  resetLastIntent?: boolean;
};

export function clearActiveBookingState<T extends Record<string, unknown>>(
  stateLike: T,
  options?: ClearActiveBookingStateOptions,
): T {
  const resetNextExpected = options?.resetNextExpected !== false;
  const resetLastIntent = options?.resetLastIntent !== false;
  const cleaned = { ...stateLike } as Record<string, unknown>;

  for (const key of ACTIVE_TOP_LEVEL_KEYS) {
    if (key in cleaned) cleaned[key] = null;
  }

  const collectedRaw = (cleaned.collected ?? {}) as Record<string, unknown>;
  const collected = { ...collectedRaw };
  for (const key of ACTIVE_COLLECTED_KEYS) {
    if (key in collected) collected[key] = null;
  }
  cleaned.collected = collected;

  if (resetNextExpected) {
    const nextExpected = safeStr(cleaned.nextExpected, "");
    if (ACTIVE_NEXT_EXPECTED.has(nextExpected)) cleaned.nextExpected = undefined;
  }

  if (resetLastIntent) {
    const lastIntent = safeStr(cleaned.lastIntent, "");
    if (ACTIVE_LAST_INTENT.has(lastIntent)) cleaned.lastIntent = undefined;
  }

  return cleaned as T;
}

export function isPendingOfferedSlotFresh(
  pendingOfferedSlot: Record<string, unknown> | null | undefined,
  ttlSeconds = 900,
): boolean {
  if (!pendingOfferedSlot) return false;
  const setAt = safeStr(pendingOfferedSlot.set_at, "");
  if (!setAt) return false;
  const ts = Date.parse(setAt);
  if (!Number.isFinite(ts)) return false;
  const ageMs = Date.now() - ts;
  return ageMs >= 0 && ageMs <= ttlSeconds * 1000;
}
