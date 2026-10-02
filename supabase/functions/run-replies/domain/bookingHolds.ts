type SupabaseLike = {
  from(table: string): any;
};

const HOLD_DURATION_MIN = 5;

const TZ_OFFSETS: Record<string, string> = {
  "America/Tegucigalpa": "-06:00",
  "America/Guatemala": "-06:00",
  "America/Costa_Rica": "-06:00",
  "America/Mexico_City": "-06:00",
  "America/Bogota": "-05:00",
  "America/Lima": "-05:00",
  "America/New_York": "-04:00",
  "America/Chicago": "-05:00",
  "America/Denver": "-06:00",
  "America/Los_Angeles": "-07:00",
};

export type BookingHoldRow = {
  id: string;
  organization_id: string;
  lead_id: string;
  provider_id: string;
  provider_name: string | null;
  service_key: string | null;
  service_name: string | null;
  starts_at: string;
  ends_at: string;
  status: "held" | "consumed" | "expired" | "cancelled";
  expires_at: string;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
};

export type BookingHoldCreateResult =
  | { ok: true; hold: BookingHoldRow; reused?: boolean }
  | { ok: false; reason: "active_hold_conflict" | "invalid_slot" | "insert_failed" | "lookup_failed"; hold?: BookingHoldRow | null; error?: unknown };

export function buildIsoTimestampForHold(date: string, time: string, override: string | null | undefined, timezone: string): string | null {
  const rawOverride = String(override ?? "").trim();
  if (rawOverride && /^\d{4}-\d{2}-\d{2}T/.test(rawOverride) && /(?:Z|[+-]\d{2}:\d{2})$/.test(rawOverride)) {
    return rawOverride;
  }
  if (!date || !time) return null;
  const m = String(time).trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2] ?? "0");
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const offset = TZ_OFFSETS[timezone] || "-06:00";
  const constructed = `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${offset}`;
  const parsed = new Date(constructed);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export function addMinutesIso(startIso: string, minutes: number): string | null {
  const start = new Date(startIso);
  if (Number.isNaN(start.valueOf())) return null;
  return new Date(start.getTime() + Math.max(1, minutes) * 60_000).toISOString();
}

export async function cleanupExpiredBookingHolds(
  supabase: SupabaseLike,
  organizationId: string,
  nowIso = new Date().toISOString(),
): Promise<void> {
  try {
    await supabase
      .from("booking_holds")
      .update({ status: "expired", metadata: { expired_by: "run_replies", expired_at: nowIso } })
      .eq("organization_id", organizationId)
      .eq("status", "held")
      .lte("expires_at", nowIso);
  } catch (_err) {
    // Hold table is introduced by migration; callers still rely on final appointment checks.
  }
}

export async function findActiveBookingHoldForSlot(args: {
  supabase: SupabaseLike;
  organizationId: string;
  providerId: string;
  startsAt: string;
  nowIso: string;
}): Promise<{ hold: BookingHoldRow | null; error?: unknown }> {
  try {
    const res = await args.supabase
      .from("booking_holds")
      .select("id, organization_id, lead_id, provider_id, provider_name, service_key, service_name, starts_at, ends_at, status, expires_at, created_at, metadata")
      .eq("organization_id", args.organizationId)
      .eq("provider_id", args.providerId)
      .eq("starts_at", args.startsAt)
      .eq("status", "held")
      .gt("expires_at", args.nowIso)
      .limit(1)
      .maybeSingle();
    if (res?.error) return { hold: null, error: res.error };
    return { hold: (res?.data ?? null) as BookingHoldRow | null };
  } catch (error) {
    return { hold: null, error };
  }
}

export async function createBookingHold(args: {
  supabase: SupabaseLike;
  organizationId: string;
  leadId: string;
  providerId: string;
  providerName?: string | null;
  serviceKey?: string | null;
  serviceName?: string | null;
  date: string;
  time: string;
  startsAt?: string | null;
  durationMin: number;
  timezone: string;
  metadata?: Record<string, unknown>;
  nowIso?: string;
}): Promise<BookingHoldCreateResult> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const startsAt = buildIsoTimestampForHold(args.date, args.time, args.startsAt, args.timezone);
  const endsAt = startsAt ? addMinutesIso(startsAt, args.durationMin) : null;
  if (!args.providerId || !startsAt || !endsAt) return { ok: false, reason: "invalid_slot" };

  await cleanupExpiredBookingHolds(args.supabase, args.organizationId, nowIso);

  const existing = await findActiveBookingHoldForSlot({
    supabase: args.supabase,
    organizationId: args.organizationId,
    providerId: args.providerId,
    startsAt,
    nowIso,
  });
  if (existing.error) return { ok: false, reason: "lookup_failed", error: existing.error };
  if (existing.hold) {
    if (String(existing.hold.lead_id) === String(args.leadId)) return { ok: true, hold: existing.hold, reused: true };
    return { ok: false, reason: "active_hold_conflict", hold: existing.hold };
  }

  const hold: BookingHoldRow = {
    id: crypto.randomUUID(),
    organization_id: args.organizationId,
    lead_id: args.leadId,
    provider_id: args.providerId,
    provider_name: args.providerName ?? null,
    service_key: args.serviceKey ?? null,
    service_name: args.serviceName ?? null,
    starts_at: startsAt,
    ends_at: endsAt,
    status: "held",
    expires_at: new Date(new Date(nowIso).getTime() + HOLD_DURATION_MIN * 60_000).toISOString(),
    metadata: args.metadata ?? {},
  };

  try {
    const res = await args.supabase.from("booking_holds").insert(hold).select(
      "id, organization_id, lead_id, provider_id, provider_name, service_key, service_name, starts_at, ends_at, status, expires_at, created_at, metadata",
    ).single();
    if (res?.error) return { ok: false, reason: "insert_failed", error: res.error };
    return { ok: true, hold: (res?.data ?? hold) as BookingHoldRow };
  } catch (error) {
    return { ok: false, reason: "insert_failed", error };
  }
}

export async function getActiveBookingHoldById(args: {
  supabase: SupabaseLike;
  organizationId: string;
  leadId: string;
  holdId: string;
  nowIso?: string;
}): Promise<BookingHoldRow | null> {
  if (!args.holdId) return null;
  const nowIso = args.nowIso ?? new Date().toISOString();
  try {
    const res = await args.supabase
      .from("booking_holds")
      .select("id, organization_id, lead_id, provider_id, provider_name, service_key, service_name, starts_at, ends_at, status, expires_at, created_at, metadata")
      .eq("id", args.holdId)
      .eq("organization_id", args.organizationId)
      .eq("lead_id", args.leadId)
      .eq("status", "held")
      .gt("expires_at", nowIso)
      .maybeSingle();
    if (res?.error) return null;
    return (res?.data ?? null) as BookingHoldRow | null;
  } catch (_error) {
    return null;
  }
}

export async function consumeBookingHold(args: {
  supabase: SupabaseLike;
  organizationId: string;
  leadId: string;
  holdId: string;
  appointmentId?: string | null;
}): Promise<void> {
  if (!args.holdId) return;
  try {
    await args.supabase
      .from("booking_holds")
      .update({
        status: "consumed",
        metadata: {
          consumed_by: "run_replies",
          consumed_at: new Date().toISOString(),
          appointment_id: args.appointmentId ?? null,
        },
      })
      .eq("id", args.holdId)
      .eq("organization_id", args.organizationId)
      .eq("lead_id", args.leadId)
      .eq("status", "held");
  } catch (_error) {
    // Appointment insert remains source of truth; hold cleanup can be retried operationally.
  }
}
