function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export type PendingActionType = "confirm_booking" | "confirm_reschedule" | "confirm_cancel" | "none";

export type PendingAction = {
  type: PendingActionType;
  status: "active" | "stale" | "none";
  createdFromLastBotPreconfirm: boolean;
};

export function getPendingActionFromBarbershopCollected(
  nextExpected: unknown,
  collected: Record<string, unknown>,
): PendingAction {
  const isConfirmBooking = safeStr(nextExpected, "") === "confirm_booking";
  if (!isConfirmBooking) {
    return { type: "none", status: "none", createdFromLastBotPreconfirm: false };
  }
  const hasPendingBooking = Boolean(collected.pending_booking);
  const stale = Boolean(collected.pending_booking_stale);
  const preconfirm = safeStr(collected.last_bot_step, "") === "barbershop_preconfirm";
  return {
    type: "confirm_booking",
    status: hasPendingBooking && !stale ? "active" : "stale",
    createdFromLastBotPreconfirm: preconfirm,
  };
}

export function isPendingActionActive(action: PendingAction): boolean {
  return action.type !== "none" && action.status === "active" && action.createdFromLastBotPreconfirm;
}

export function buildInfoContextCollected(
  collected: Record<string, unknown>,
  infoTopic: string,
): Record<string, unknown> {
  const next = { ...collected };
  delete (next as Record<string, unknown>).service;
  delete (next as Record<string, unknown>).preferred_date;
  delete (next as Record<string, unknown>).preferred_time;
  delete (next as Record<string, unknown>).pending_booking;
  delete (next as Record<string, unknown>).pending_booking_stale;
  delete (next as Record<string, unknown>).last_bot_step;
  return { ...next, last_info_topic: infoTopic };
}

