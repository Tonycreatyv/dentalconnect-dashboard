function normalizeTextForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function hasActiveAppointmentInState(leadState: Record<string, unknown> | null): boolean {
  const collected = ((leadState as any)?.collected ?? {}) as Record<string, unknown>;
  const active = (collected.active_appointment ?? {}) as Record<string, unknown>;
  return Boolean(safeStr(active.id, "").trim());
}

export function shouldCheckDbActiveAppointmentBeforeBooking(args: {
  organizationId: string;
  leadState: Record<string, unknown> | null;
  inboundText: string;
  deterministicIntent?: string;
}): boolean {
  const orgId = safeStr(args.organizationId, "").toLowerCase();
  const isDentalOrg = orgId.includes("dental") || orgId.includes("clinic");
  if (!isDentalOrg) return false;
  if (hasActiveAppointmentInState(args.leadState)) return false;
  const intent = safeStr(args.deterministicIntent, "");
  if (["cancel_appointment", "reschedule_appointment", "appointment_lookup"].includes(intent)) {
    return false;
  }
  const t = normalizeTextForMatch(args.inboundText);
  const hasSymptomSignal = /\b(duele|dolor|encia|caries|picad|quebrad|inflamad|sangrad|muela|diente)\b/.test(t);
  const hasServiceSignal = /\b(brackets|ortodoncia|limpieza|blanqueamiento|extraccion|revision)\b/.test(t);
  const hasAvailabilitySignal = /\b(horarios|horario|horas|disponibilidad|que horarios|que horas)\b/.test(t);
  return hasSymptomSignal || hasServiceSignal || hasAvailabilitySignal;
}
