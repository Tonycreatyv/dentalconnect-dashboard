export type RuntimeNormalizedInbound = {
  text: string;
  payload_action: string | null;
  channel: string;
  message_type: "text" | "button" | "list" | "unknown";
};

export type RuntimeBookingRequest = {
  service: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  provider_name: string | null;
  provider_preference: "any" | "specific" | null;
  patient_name: string | null;
  booking_for_other: boolean;
  missing_fields: string[];
};

export type RuntimeContextResolution = {
  active_flow: string;
  resolved_intent: string;
  booking_request: RuntimeBookingRequest;
  selected_slot: Record<string, unknown> | null;
  pending_booking: Record<string, unknown> | null;
  nextExpected: string | null;
  route_recommendation:
    | "ask_missing_field"
    | "check_availability"
    | "show_availability"
    | "select_slot"
    | "confirm_booking"
    | "fallback";
  has_active_context: boolean;
};

function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function listMissingFields(req: RuntimeBookingRequest): string[] {
  const missing: string[] = [];
  if (!req.service) missing.push("service");
  if (!req.preferred_date) missing.push("date");
  if (!req.preferred_time) missing.push("time");
  return missing;
}

export function normalizeInboundRuntime(args: {
  inboundText: string;
  payloadAction?: string | null;
  channel?: string | null;
}): RuntimeNormalizedInbound {
  const text = safeStr(args.inboundText, "").trim();
  const payload = safeStr(args.payloadAction, "").trim() || null;
  const channel = safeStr(args.channel, "unknown").trim() || "unknown";
  const message_type: RuntimeNormalizedInbound["message_type"] = payload
    ? (/^slot_/i.test(payload) ? "list" : "button")
    : (text ? "text" : "unknown");
  return {
    text,
    payload_action: payload,
    channel,
    message_type,
  };
}

export function mergeConversationContext(args: {
  normalizedInbound: RuntimeNormalizedInbound;
  interpreterResult?: Record<string, unknown> | null;
  leadState?: Record<string, unknown> | null;
  lastBotText?: string | null;
}): RuntimeContextResolution {
  const state = (args.leadState ?? {}) as Record<string, unknown>;
  const collected = ((state.collected ?? {}) as Record<string, unknown>);
  const pendingBookingRequest = ((collected.pending_booking_request ?? {}) as Record<string, unknown>);
  const nextExpected = safeStr(state.nextExpected, "").trim() || null;
  const pendingBooking = ((collected.pending_booking ?? null) as Record<string, unknown> | null);
  const availabilityContext = ((collected.last_availability_context ?? null) as Record<string, unknown> | null);
  const proposedSlot = ((collected.proposed_slot ?? null) as Record<string, unknown> | null);
  const interpreter = (args.interpreterResult ?? {}) as Record<string, unknown>;
  const entities = ((interpreter.entities ?? {}) as Record<string, unknown>);

  const bookingRequest: RuntimeBookingRequest = {
    service: safeStr(
      entities.service,
      safeStr(pendingBookingRequest.service, safeStr(collected.service, "")),
    ).trim() || null,
    preferred_date: safeStr(
      entities.date,
      safeStr(pendingBookingRequest.preferred_date, safeStr(collected.preferred_date, safeStr(availabilityContext?.date, ""))),
    ).trim() || null,
    preferred_time: safeStr(
      entities.time,
      safeStr(pendingBookingRequest.preferred_time, safeStr(collected.preferred_time, "")),
    ).trim() || null,
    provider_name: safeStr(
      entities.provider_name,
      safeStr(pendingBookingRequest.provider_name, safeStr(collected.provider_name, safeStr(collected.preferred_barber, ""))),
    ).trim() || null,
    provider_preference: (() => {
      const raw = safeStr(
        entities.provider_preference,
        safeStr(pendingBookingRequest.provider_preference, safeStr(collected.provider_preference, "")),
      ).trim().toLowerCase();
      if (raw === "any" || raw === "specific") return raw;
      return null;
    })(),
    patient_name: safeStr(
      entities.patient_name,
      safeStr(pendingBookingRequest.patient_name, safeStr(collected.patient_name, "")),
    ).trim() || null,
    booking_for_other: Boolean(
      entities.booking_for_other ??
        pendingBookingRequest.booking_for_other ??
        collected.booking_for_other,
    ),
    missing_fields: [],
  };
  bookingRequest.missing_fields = listMissingFields(bookingRequest);

  const hasActiveContext = Boolean(
    pendingBooking ||
      availabilityContext ||
      proposedSlot ||
      Object.keys(pendingBookingRequest).length > 0 ||
      (nextExpected && [
        "availability_slot_selection",
        "booking_date",
        "availability_service",
        "date_time",
        "barber_preference",
        "confirm_booking",
      ].includes(nextExpected)) ||
      /cual te queda mejor|que dia|que servicio|confirmamos/i.test(safeStr(args.lastBotText, "")),
  );

  const route: RuntimeContextResolution["route_recommendation"] = pendingBooking
    ? "confirm_booking"
    : (nextExpected === "availability_slot_selection" || availabilityContext)
    ? "select_slot"
    : (bookingRequest.service && bookingRequest.preferred_date && bookingRequest.preferred_time)
    ? "check_availability"
    : (bookingRequest.service && bookingRequest.preferred_date && !bookingRequest.preferred_time)
    ? "show_availability"
    : "ask_missing_field";

  return {
    active_flow: hasActiveContext ? "booking" : "none",
    resolved_intent: safeStr(interpreter.intent, "unknown"),
    booking_request: bookingRequest,
    selected_slot: availabilityContext,
    pending_booking: pendingBooking,
    nextExpected,
    route_recommendation: route,
    has_active_context: hasActiveContext,
  };
}
