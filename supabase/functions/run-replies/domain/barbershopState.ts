function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export type BarbershopBookingContext = {
  service: string | null;
  preferred_barber: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  pending_booking: Record<string, unknown> | null;
  pending_booking_stale: boolean;
  last_booking_step: string | null;
};

export type BarbershopInfoContext = {
  last_info_topic: string | null;
  last_price_service: string | null;
  last_product_category: string | null;
};

export function extractBarbershopBookingContext(
  collected: Record<string, unknown>,
): BarbershopBookingContext {
  return {
    service: safeStr(collected.service, "") || null,
    preferred_barber: safeStr(collected.preferred_barber, "") || null,
    preferred_date: safeStr(collected.preferred_date, "") || null,
    preferred_time: safeStr(collected.preferred_time, "") || null,
    pending_booking: (collected.pending_booking as Record<string, unknown> | null) ?? null,
    pending_booking_stale: Boolean(collected.pending_booking_stale),
    last_booking_step: safeStr(collected.last_bot_step, "") || null,
  };
}

export function extractBarbershopInfoContext(
  collected: Record<string, unknown>,
): BarbershopInfoContext {
  return {
    last_info_topic: safeStr(collected.last_info_topic, "") || null,
    last_price_service: safeStr(collected.last_price_service, "") || null,
    last_product_category: safeStr(collected.last_product_category, "") || null,
  };
}

