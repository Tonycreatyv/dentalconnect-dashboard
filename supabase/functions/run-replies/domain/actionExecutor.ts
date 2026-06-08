import {
  createClient,
  type SupabaseClient as SupabaseClientBase,
} from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  beginOnboarding,
  bookAppointment,
  captureBusinessType,
  captureLeadGoal,
  createTrialAccount,
  showDemo,
  startTrial,
} from "./tools.ts";
import { syncCalendarEvent } from "./calendar/calendarSync.ts";
import { getAvailableSlots } from "./availability.ts";
import {
  checkSlotAvailability,
  suggestNextAvailableSlots,
} from "./availabilityCore.ts";
import { clearActiveBookingState } from "./bookingStateHygiene.ts";
import {
  consumeBookingHold,
  getActiveBookingHoldById,
} from "./bookingHolds.ts";

type Json = Record<string, unknown>;
type SupabaseClientType = SupabaseClientBase<any, "public", any>;

const nowIso = () => new Date().toISOString();

function isValidUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value ?? "").trim());
}

function formatDentalAppointmentProviderName(
  providerNameRaw: unknown,
  brandNameRaw: unknown,
  organizationId: string,
): string {
  const providerName = String(providerNameRaw ?? "").trim();
  const normalized = providerName.normalize("NFD").replace(
    /[\u0300-\u036f]/g,
    "",
  )
    .toLowerCase().trim();
  if (
    !providerName ||
    normalized === "doctor disponible" ||
    normalized === "cualquiera disponible" ||
    normalized === "doctor demo" ||
    normalized === "doctor_demo"
  ) {
    const brand = String(brandNameRaw ?? "").normalize("NFD").replace(
      /[\u0300-\u036f]/g,
      "",
    ).toLowerCase();
    if (brand.includes("dican") || organizationId === "clinic-demo") {
      return "Equipo DICAN";
    }
    return "Equipo de la clínica";
  }
  return providerName;
}

function isNaiveIsoTimestamp(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/
    .test(String(value ?? "").trim());
}

function logDentalAppointmentWriteFailure(args: {
  operation: string;
  organizationId: string;
  leadId: string;
  appointmentFields: Record<string, unknown>;
  error: unknown;
}) {
  const parts = getSupabaseErrorParts(args.error);
  console.error(
    "[actionExecutor] dental appointment write failed",
    JSON.stringify({
      operation: args.operation,
      organization_id: args.organizationId,
      lead_id: args.leadId,
      provider_id: args.appointmentFields.provider_id ?? null,
      provider_name: args.appointmentFields.provider_name ?? null,
      appointment_date: args.appointmentFields.appointment_date ?? null,
      appointment_time: args.appointmentFields.appointment_time ?? null,
      start_at: args.appointmentFields.start_at ?? null,
      starts_at: args.appointmentFields.starts_at ?? null,
      end_at: args.appointmentFields.end_at ?? null,
      ends_at: args.appointmentFields.ends_at ?? null,
      status: args.appointmentFields.status ?? null,
      reason: args.appointmentFields.reason ?? null,
      title: args.appointmentFields.title ?? null,
      error_code: parts.code ?? null,
      error_message: parts.message ?? null,
      error_details: parts.details ?? null,
      error_hint: parts.hint ?? null,
    }),
  );
}

export type ToolActionName =
  | "show_demo"
  | "start_trial"
  | "begin_onboarding"
  | "capture_business_type"
  | "capture_lead_goal"
  | "book_appointment"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "create_trial_account"
  | "get_clinic_info"; // Nueva herramienta para que la IA pregunte precios/horarios

export type ToolActionExecution = {
  name: ToolActionName;
  payload?: Json;
};

export type ActionExecutionResult = {
  statePatch?: Json;
  event?: { type: string; payload: Json };
  replyOverride?: string;
  booking?: BookingActionResult;
};

export type AppointmentInsertRecord = {
  id: string;
  organization_id: string;
  lead_id: string;
  patient_name: string | null;
  reason: string;
  title: string;
  starts_at: string;
  start_at: string;
  ends_at: string;
  end_at: string;
  appointment_date: string;
  appointment_time: string;
  duration_min: number;
  provider_id?: string | null;
  provider_name?: string | null;
  metadata?: Record<string, unknown> | null;
  status: "pending";
};

export type BookingActionResult =
  | { ok: true; appointment: AppointmentInsertRecord }
  | { ok: false; error: string };

const APPOINTMENT_SELECT_FIELDS =
  "id, organization_id, lead_id, patient_name, reason, title, starts_at, start_at, ends_at, end_at, appointment_date, appointment_time, duration_min, provider_id, provider_name, metadata, status";

const SERVICE_DURATION_MIN: Record<string, number> = {
  "limpieza dental": 45,
  "revision dental": 30,
  "revisión dental": 30,
  "blanqueamiento": 60,
  "ortodoncia": 45,
  "extraccion": 50,
  "extracción": 50,
  "endodoncia": 75,
  "implantes": 60,
  "carillas": 60,
  "corte clasico": 30,
  "corte clásico": 30,
  "corte + barba": 45,
  "corte y barba": 45,
  "barba": 20,
  "cejas": 15,
  "corte nino": 30,
  "corte niño": 30,
};

function resolveServiceDurationMin(service: string, fallback = 60): number {
  const key = String(service ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!key) return fallback;
  for (const [label, minutes] of Object.entries(SERVICE_DURATION_MIN)) {
    if (key.includes(label)) return minutes;
  }
  return fallback;
}

/**
 * Función para obtener el contexto real de la clínica (Precios, Horarios, Info)
 */
async function getClinicContext(
  supabase: SupabaseClientType,
  organizationId: string,
) {
  const { data: org } = await supabase.from("org_settings").select(
    "name, address, phone, specialties, timezone",
  ).eq("organization_id", organizationId).single();
  const { data: services } = await supabase.from("services").select(
    "name, price, duration_min",
  ).eq("organization_id", organizationId);
  const { data: hours } = await supabase.from("business_hours").select(
    "day_of_week, open_time, close_time, is_closed",
  ).eq("organization_id", organizationId);

  const servicesText =
    services?.map((s) => `- ${s.name}: ${s.price} LPS (${s.duration_min} min)`)
      .join("\n") || "No hay servicios listados.";
  const hoursText =
    hours?.map((h) =>
      `Día ${h.day_of_week}: ${
        h.is_closed ? "Cerrado" : `${h.open_time} - ${h.close_time}`
      }`
    ).join("\n") || "Horarios no configurados.";

  return `
    CLÍNICA: ${org?.name || "DentalConnect Clinic"}
    UBICACIÓN: ${org?.address || "No especificada"}
    TELÉFONO: ${org?.phone || "No especificado"}
    SERVICIOS Y PRECIOS:
    ${servicesText}
    HORARIOS DE ATENCIÓN:
    ${hoursText}
  `;
}

async function loadClinicHours(
  supabase: SupabaseClientType,
  organizationId: string,
): Promise<Record<string, unknown> | null> {
  const clinicRes = await supabase
    .from("clinics")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1)
    .maybeSingle();

  const clinicId = clinicRes.data?.id;
  if (!clinicId) return null;

  const settingsRes = await supabase
    .from("clinic_settings")
    .select("hours")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (settingsRes.error) return null;
  const hours = settingsRes.data?.hours;
  return hours && typeof hours === "object"
    ? (hours as Record<string, unknown>)
    : null;
}

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function getSupabaseErrorParts(error: unknown): SupabaseErrorLike {
  if (!error || typeof error !== "object") {
    return { message: String(error ?? "unknown_error") };
  }
  const err = error as Record<string, unknown>;
  return {
    code: typeof err.code === "string" ? err.code : undefined,
    message: typeof err.message === "string" ? err.message : String(error),
    details: typeof err.details === "string" ? err.details : undefined,
    hint: typeof err.hint === "string" ? err.hint : undefined,
  };
}

function formatSupabaseError(error: unknown): string {
  const parts = getSupabaseErrorParts(error);
  return JSON.stringify({
    code: parts.code ?? null,
    message: parts.message ?? "unknown_error",
    details: parts.details ?? null,
    hint: parts.hint ?? null,
  });
}

function isAppointmentConflictError(error: unknown): boolean {
  const parts = getSupabaseErrorParts(error);
  const haystack = [
    parts.code,
    parts.message,
    parts.details,
    parts.hint,
  ].filter(Boolean).join(" ").toLowerCase();
  return parts.code === "23505" ||
    parts.code === "23P01" ||
    haystack.includes("duplicate") ||
    haystack.includes("unique") ||
    haystack.includes("overlap") ||
    haystack.includes("conflict") ||
    haystack.includes("appointments_provider_start_active_idx");
}

function formatSlotAlternatives(slots: Array<Record<string, unknown>>): string {
  return slots
    .slice(0, 3)
    .map((slot) => {
      const time = formatHourLabel(String((slot as any).time ?? ""));
      const providerName = String((slot as any).provider_name ?? "").trim();
      return `${time}${providerName ? ` · ${providerName}` : ""}`;
    })
    .filter((line) => line.trim())
    .join("\n");
}

function toPatientFacingServiceLabel(service: string): string {
  const normalized = safeServiceText(service);
  if (
    normalized.includes("ortodoncia") || normalized.includes("bracket") ||
    normalized.includes("frenillo")
  ) {
    return "Ortodoncia / brackets";
  }
  if (
    normalized.includes("evaluacion") ||
    normalized.includes("valoracion") ||
    normalized.includes("consulta general")
  ) {
    return "Revisión dental";
  }
  return service;
}

function safeServiceText(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatHumanDay(dateValue: string): string {
  if (!dateValue) return "ese día";
  const parsed = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(parsed.valueOf())) return dateValue;
  return parsed.toLocaleDateString("es-HN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatHourLabel(time24: string): string {
  const [hRaw, mRaw] = String(time24 ?? "").split(":");
  const h = Number(hRaw);
  const m = Number(mRaw ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(time24 ?? "");
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDateInTimezoneIso(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const from = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromIso);
  const to = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIso);
  if (!from || !to) return 0;
  const fromMs = Date.UTC(
    Number(from[1]),
    Number(from[2]) - 1,
    Number(from[3]),
  );
  const toMs = Date.UTC(Number(to[1]), Number(to[2]) - 1, Number(to[3]));
  return Math.floor((toMs - fromMs) / 86_400_000);
}

function hasExplicitDentalYearMarker(
  payload: Record<string, unknown>,
  selectedSlot: Record<string, unknown> | null,
): boolean {
  const metadata = payload.metadata && typeof payload.metadata === "object"
    ? payload.metadata as Record<string, unknown>
    : {};
  return Boolean(
    payload.date_year_explicit ||
      payload.appointment_date_year_explicit ||
      payload.explicit_year ||
      selectedSlot?.date_year_explicit ||
      selectedSlot?.appointment_date_year_explicit ||
      selectedSlot?.explicit_year ||
      metadata.date_year_explicit ||
      metadata.appointment_date_year_explicit ||
      metadata.explicit_year,
  );
}

async function validateRequestedDateTimeBookability(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  timezone: string;
  providerId?: string | null;
  providerPreference: "any" | "specific";
}): Promise<{
  canBookRequestedDateTime: boolean;
  reason:
    | "no_services"
    | "no_active_providers"
    | "no_open_hours"
    | "requested_day_closed"
    | "requested_time_outside_hours"
    | "requested_time_in_past"
    | "no_provider_available"
    | null;
  suggestedSlots?: Array<Record<string, unknown>>;
}> {
  const exact = await checkSlotAvailability({
    supabase: args.supabase as any,
    organization_id: args.organizationId,
    business_type: "barbershop",
    service_name: args.serviceName,
    provider_id: args.providerId || undefined,
    provider_preference: args.providerPreference,
    date: args.appointmentDate,
    specific_time: args.appointmentTime,
    timezone: args.timezone,
    max_options: 5,
  });
  if (exact.available) return { canBookRequestedDateTime: true, reason: null };

  const reasonMap: Record<string, any> = {
    no_services: "no_services",
    no_active_providers: "no_active_providers",
    no_open_hours: "no_open_hours",
    closed_day: "requested_day_closed",
    outside_hours: "requested_time_outside_hours",
    past_time: "requested_time_in_past",
    unavailable: "no_provider_available",
    conflict: "no_provider_available",
  };
  const mappedReason = reasonMap[String(exact.reason ?? "")] ??
    "no_provider_available";
  const suggested = (exact.alternatives ?? []).slice(0, 5);
  if (suggested.length > 0) {
    return {
      canBookRequestedDateTime: false,
      reason: mappedReason,
      suggestedSlots: suggested as Array<Record<string, unknown>>,
    };
  }
  const nextSlots = await suggestNextAvailableSlots({
    supabase: args.supabase as any,
    organization_id: args.organizationId,
    business_type: "barbershop",
    service_name: args.serviceName,
    provider_id: args.providerId || undefined,
    provider_preference: args.providerPreference,
    date_from: args.appointmentDate,
    timezone: args.timezone,
    max_options: 5,
  });
  return {
    canBookRequestedDateTime: false,
    reason: mappedReason,
    suggestedSlots: nextSlots as Array<Record<string, unknown>>,
  };
}

async function scheduleFollowupBestEffort(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  appointmentId: string;
  startsAt: string;
  appointmentDate: string;
  appointmentTime: string;
  reason: string;
}): Promise<void> {
  const {
    supabase,
    organizationId,
    leadId,
    appointmentId,
    startsAt,
    appointmentDate,
    appointmentTime,
    reason,
  } = args;

  try {
    const leadRes = await supabase
      .from("leads")
      .select("channel_user_id")
      .eq("id", leadId)
      .maybeSingle();

    if (leadRes.error) {
      console.warn(
        JSON.stringify({
          event: "followup:schedule_failed",
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: appointmentId,
          error: formatSupabaseError(leadRes.error),
        }),
      );
      return;
    }

    const channelUserId = String(leadRes.data?.channel_user_id ?? "").trim();
    if (!channelUserId) {
      console.warn(
        JSON.stringify({
          event: "followup:schedule_failed",
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: appointmentId,
          error: "missing_channel_user_id_for_followup",
        }),
      );
      return;
    }

    const startMs = Date.parse(startsAt);
    const nowMs = Date.now();
    let targetReminderMs = nowMs + 5 * 60 * 1000;
    if (Number.isFinite(startMs)) {
      const diffMs = startMs - nowMs;
      if (diffMs > 24 * 60 * 60 * 1000) {
        targetReminderMs = startMs - 24 * 60 * 60 * 1000;
      } else if (diffMs > 2 * 60 * 60 * 1000) {
        targetReminderMs = startMs - 2 * 60 * 60 * 1000;
      } else if (diffMs > 30 * 60 * 1000) {
        targetReminderMs = startMs - 30 * 60 * 1000;
      } else {
        targetReminderMs = Math.max(nowMs + 60_000, startMs - 5 * 60 * 1000);
      }
    }
    const reminderTimeIso = new Date(Math.max(nowMs + 60_000, targetReminderMs))
      .toISOString();
    const patientFacingReason = toPatientFacingServiceLabel(reason);

    const providerPayload = {
      type: "appointment_reminder",
      template_type: "appointment_reminder",
      template_name: "dc_appointment_reminder",
      appointment_id: appointmentId,
      starts_at: startsAt,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      reason,
      step: 1,
    };
    const messageText =
      `⏰ Recordatorio: tienes una cita de ${patientFacingReason} ${appointmentDate} a las ${appointmentTime}. Si necesitas cambiarla, responde a este mensaje.`;

    // Support both legacy and current followup_outbox schemas.
    const columnsRes = await supabase
      .from("information_schema.columns")
      .select("column_name")
      .eq("table_schema", "public")
      .eq("table_name", "followup_outbox");
    const columnNames = new Set(
      (columnsRes.data ?? []).map((row: any) => String(row?.column_name ?? "")),
    );

    const followupInsert: Record<string, unknown> = {};
    const setIfColumn = (column: string, value: unknown) => {
      if (columnNames.has(column)) followupInsert[column] = value;
    };

    setIfColumn("organization_id", organizationId);
    setIfColumn("lead_id", leadId);
    setIfColumn("channel", "whatsapp");
    setIfColumn("channel_user_id", channelUserId);
    setIfColumn("policy", "appointment_reminder");
    setIfColumn("reason", "appointment_reminder");
    setIfColumn("step", 1);
    setIfColumn("max_steps", 1);
    setIfColumn("scheduled_for", reminderTimeIso);
    setIfColumn("due_at", reminderTimeIso);
    setIfColumn("status", "queued");
    setIfColumn("attempts", 0);
    setIfColumn("attempt_count", 0);
    setIfColumn("provider", "whatsapp");
    setIfColumn("provider_payload", providerPayload);
    setIfColumn("payload", providerPayload);
    setIfColumn("message_text", messageText);
    setIfColumn("inbound_message_id", null);
    setIfColumn("updated_at", nowIso());

    console.log(
      JSON.stringify({
        event: "followup:insert_attempt",
        organization_id: organizationId,
        lead_id: leadId,
        appointment_id: appointmentId,
        payload: {
          organization_id: followupInsert.organization_id ?? null,
          lead_id: followupInsert.lead_id ?? null,
          channel: followupInsert.channel ?? null,
          channel_user_id: followupInsert.channel_user_id ?? null,
          policy: followupInsert.policy ?? null,
          reason: followupInsert.reason ?? null,
          step: followupInsert.step ?? null,
          scheduled_for: followupInsert.scheduled_for ?? null,
          due_at: followupInsert.due_at ?? null,
          status: followupInsert.status ?? null,
          attempts: followupInsert.attempts ?? null,
          attempt_count: followupInsert.attempt_count ?? null,
        },
      }),
    );

    const insertRes = await supabase
      .from("followup_outbox")
      .insert(followupInsert)
      .select("id")
      .maybeSingle();

    if (insertRes.error) {
      throw insertRes.error;
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "followup:schedule_failed",
        organization_id: organizationId,
        lead_id: leadId,
        appointment_id: appointmentId,
        error: formatSupabaseError(error),
      }),
    );
  }
}

async function getPublicTableColumns(
  supabase: SupabaseClientType,
  tableName: string,
): Promise<Set<string>> {
  const columnsRes = await supabase
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", tableName);
  return new Set(
    (columnsRes.data ?? []).map((row: any) => String(row?.column_name ?? "")),
  );
}

async function loadLeadReminderTarget(
  supabase: SupabaseClientType,
  leadId: string,
): Promise<{ channel: string; channelUserId: string; customerName: string }> {
  const leadRes = await supabase
    .from("leads")
    .select("channel, channel_user_id, full_name, first_name")
    .eq("id", leadId)
    .maybeSingle();
  const row = (leadRes.data ?? {}) as Record<string, unknown>;
  return {
    channel: String(row.channel ?? "whatsapp").trim().toLowerCase() ||
      "whatsapp",
    channelUserId: String(row.channel_user_id ?? "").trim(),
    customerName: String(row.full_name ?? row.first_name ?? "").trim(),
  };
}

async function loadBarbershopBrandName(
  supabase: SupabaseClientType,
  organizationId: string,
): Promise<string> {
  const orgSettings = await supabase
    .from("organization_settings")
    .select("brand_name, display_name, business_name")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const row = (orgSettings.data ?? {}) as Record<string, unknown>;
  return String(
    row.brand_name ?? row.display_name ?? row.business_name ?? "la barbería",
  ).trim() || "la barbería";
}

async function recordAppointmentEventBestEffort(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  appointmentId: string;
  eventType:
    | "appointment_confirmed"
    | "appointment_rescheduled"
    | "appointment_cancelled";
  payload: Record<string, unknown>;
}) {
  try {
    const insertPayload = {
      organization_id: args.organizationId,
      appointment_id: args.appointmentId,
      event_type: args.eventType,
      payload: {
        lead_id: args.leadId,
        ...args.payload,
      },
    };
    const res = await args.supabase
      .from("appointment_events")
      .upsert(insertPayload, {
        onConflict: "organization_id,appointment_id,event_type",
        ignoreDuplicates: true,
      });
    if (res.error) throw res.error;
    console.log(JSON.stringify({
      event: "appointment_internal_event_recorded",
      organization_id: args.organizationId,
      lead_id: args.leadId,
      appointment_id: args.appointmentId,
      event_type: args.eventType,
    }));
  } catch (error) {
    console.warn(JSON.stringify({
      event: "appointment_internal_event_failed",
      organization_id: args.organizationId,
      lead_id: args.leadId,
      appointment_id: args.appointmentId,
      event_type: args.eventType,
      error: formatSupabaseError(error),
    }));
  }
}

async function cancelBarbershopReminderJobs(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  appointmentId: string;
  reason: "appointment_cancelled" | "appointment_rescheduled";
}) {
  try {
    const res = await args.supabase
      .from("followup_outbox")
      .update({
        status: "cancelled",
        last_error: `cancelled:${args.reason}`,
        updated_at: nowIso(),
      })
      .eq("organization_id", args.organizationId)
      .eq("lead_id", args.leadId)
      .like("reason", `appointment_reminder:${args.appointmentId}:%`)
      .in("status", ["queued", "pending", "scheduled", "processing"]);
    if (res.error) throw res.error;
    console.log(JSON.stringify({
      event: "appointment_reminders_cancelled",
      organization_id: args.organizationId,
      lead_id: args.leadId,
      appointment_id: args.appointmentId,
      reason: args.reason,
    }));
  } catch (error) {
    console.warn(JSON.stringify({
      event: "appointment_reminders_cancel_failed",
      organization_id: args.organizationId,
      lead_id: args.leadId,
      appointment_id: args.appointmentId,
      reason: args.reason,
      error: formatSupabaseError(error),
    }));
  }
}

async function scheduleBarbershopAppointmentReminders(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  appointmentId: string;
  startsAt: string;
  appointmentDate: string;
  appointmentTime: string;
  serviceName: string;
  providerName: string;
  customerName: string;
  channel: string;
  channelUserId: string;
  brandName: string;
}) {
  const startMs = Date.parse(args.startsAt);
  if (!Number.isFinite(startMs)) return;
  if (!args.channelUserId) {
    console.warn(JSON.stringify({
      event: "appointment_reminder_schedule_skipped",
      organization_id: args.organizationId,
      lead_id: args.leadId,
      appointment_id: args.appointmentId,
      reason: "missing_channel_user_id",
    }));
    return;
  }
  const columns = await getPublicTableColumns(args.supabase, "followup_outbox");
  const setIf = (
    target: Record<string, unknown>,
    column: string,
    value: unknown,
  ) => {
    if (columns.has(column)) target[column] = value;
  };
  const reminders: Array<
    { type: "24h" | "2h"; dueAtMs: number; text: string }
  > = [
    {
      type: "24h",
      dueAtMs: startMs - 24 * 60 * 60 * 1000,
      text:
        `Recordatorio 💈\nTenés cita mañana en ${args.brandName}.\n\nServicio: ${args.serviceName}\nHora: ${
          formatHourLabel(args.appointmentTime)
        }\nBarbero: ${args.providerName || "por asignar"}`,
    },
    {
      type: "2h",
      dueAtMs: startMs - 2 * 60 * 60 * 1000,
      text: `Te esperamos hoy a las ${
        formatHourLabel(args.appointmentTime)
      } en ${args.brandName} 💈\n\nServicio: ${args.serviceName}\nBarbero: ${
        args.providerName || "por asignar"
      }`,
    },
  ];
  const nowMs = Date.now();
  for (const reminder of reminders) {
    if (reminder.dueAtMs <= nowMs) {
      console.log(JSON.stringify({
        event: "appointment_reminder_not_scheduled_past_due",
        organization_id: args.organizationId,
        lead_id: args.leadId,
        appointment_id: args.appointmentId,
        reminder_type: reminder.type,
      }));
      continue;
    }
    const dueAt = new Date(reminder.dueAtMs).toISOString();
    const isWhatsApp = args.channel.includes("whatsapp");
    const templateRequired = isWhatsApp;
    const reason =
      `appointment_reminder:${args.appointmentId}:${reminder.type}`;
    const payload = {
      source: `appointment_reminder_${reminder.type}`,
      type: "appointment_reminder",
      reminder_type: reminder.type,
      appointment_id: args.appointmentId,
      appointment_starts_at: args.startsAt,
      starts_at: args.startsAt,
      appointment_date: args.appointmentDate,
      appointment_time: args.appointmentTime,
      service_name: args.serviceName,
      provider_name: args.providerName,
      customer_name: args.customerName,
      business_name: args.brandName,
      brand_name: args.brandName,
      channel: args.channel,
      text: reminder.text,
      template_required: templateRequired,
      template_name: "barber_appointment_reminder",
      language: "es",
      variables: {
        customer_name: args.customerName,
        service_name: args.serviceName,
        date: formatHumanDay(args.appointmentDate),
        time: formatHourLabel(args.appointmentTime),
        provider_name: args.providerName,
        business_name: args.brandName,
      },
    };
    const insert: Record<string, unknown> = {};
    setIf(insert, "organization_id", args.organizationId);
    setIf(insert, "lead_id", args.leadId);
    setIf(
      insert,
      "channel",
      isWhatsApp ? "whatsapp" : (args.channel || "messenger"),
    );
    setIf(insert, "channel_user_id", args.channelUserId);
    setIf(insert, "policy", "appointment_reminder");
    setIf(insert, "reason", reason);
    setIf(insert, "step", 1);
    setIf(insert, "max_steps", 1);
    setIf(insert, "scheduled_for", dueAt);
    setIf(insert, "due_at", dueAt);
    setIf(insert, "status", "queued");
    setIf(insert, "attempts", 0);
    setIf(insert, "attempt_count", 0);
    setIf(insert, "provider", isWhatsApp ? "whatsapp" : "meta");
    setIf(insert, "provider_payload", payload);
    setIf(insert, "payload", payload);
    setIf(insert, "message_text", reminder.text);
    setIf(insert, "updated_at", nowIso());

    const res = await args.supabase
      .from("followup_outbox")
      .upsert(insert, {
        onConflict: "organization_id,lead_id,reason,step",
        ignoreDuplicates: true,
      })
      .select("id")
      .maybeSingle();
    if (res.error) {
      console.warn(JSON.stringify({
        event: "appointment_reminder_schedule_failed",
        organization_id: args.organizationId,
        lead_id: args.leadId,
        appointment_id: args.appointmentId,
        reminder_type: reminder.type,
        error: formatSupabaseError(res.error),
      }));
      continue;
    }
    console.log(JSON.stringify({
      event: "appointment_reminder_scheduled",
      organization_id: args.organizationId,
      lead_id: args.leadId,
      appointment_id: args.appointmentId,
      reminder_type: reminder.type,
      due_at: dueAt,
      template_required: templateRequired,
    }));
  }
}

export async function executeToolAction(params: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  action: ToolActionExecution;
}): Promise<ActionExecutionResult> {
  const { supabase, organizationId, leadId, action } = params;
  if (!leadId) return {};
  const now = nowIso();
  let statePatch: Json | undefined;
  let eventType: string | undefined;
  let replyOverride: string | undefined;
  let bookingResult: BookingActionResult | undefined;

  try {
    switch (action.name) {
      case "get_clinic_info": {
        const context = await getClinicContext(supabase, organizationId);
        replyOverride = `Aquí tienes la información oficial: ${context}`;
        break;
      }

      case "book_appointment": {
        const { data: orgData } = await supabase
          .from("org_settings")
          .select("timezone, same_day_booking_cutoff, buffer_min")
          .eq("organization_id", organizationId)
          .single();
        const orgTimezone = orgData?.timezone || "America/Tegucigalpa";
        const sameDayCutoff = String(
          orgData?.same_day_booking_cutoff ?? "15:00",
        );
        const bufferMin = Number(orgData?.buffer_min) || 10;

        const payload: Record<string, unknown> = action.payload ?? {};
        const selectedSlot =
          payload.selected_slot && typeof payload.selected_slot === "object"
            ? (payload.selected_slot as Record<string, unknown>)
            : null;
        const requestedBusinessType = String(
          payload.business_type ?? payload.orgType ?? "",
        ).toLowerCase();
        const isDentalAppointmentWrite = requestedBusinessType === "dental" ||
          organizationId === "clinic-demo";
        const isBarbershopBooking = requestedBusinessType === "barbershop" ||
          (requestedBusinessType !== "dental" && Boolean(
            selectedSlot?.provider_id &&
              (selectedSlot?.service_key || selectedSlot?.service_name),
          ));
        const isDentalGuidedPendingConfirmation =
          requestedBusinessType === "dental" &&
          String(selectedSlot?.source ?? "") ===
            "dental_guided_pending_confirmation";
        const allowAdditionalBooking = Boolean(
          payload.allow_additional_booking,
        );
        if (isDentalAppointmentWrite) {
          console.log(
            "[actionExecutor] dental confirm trace",
            JSON.stringify({
              stage: "book_appointment_entered",
              organization_id: organizationId,
              lead_id: leadId,
              provider_id: selectedSlot?.provider_id ?? payload.provider_id ??
                null,
              provider_name: selectedSlot?.provider_name ??
                payload.provider_name ?? null,
              appointment_date: selectedSlot?.date ??
                payload.appointment_date ?? null,
              appointment_time: selectedSlot?.time ??
                payload.appointment_time ?? null,
              starts_at: selectedSlot?.starts_at ?? payload.starts_at ?? null,
            }),
          );
        }
        console.log(JSON.stringify({
          event: "confirm_booking_started",
          organization_id: organizationId,
          lead_id: leadId,
          is_barbershop_booking: isBarbershopBooking,
          has_selected_slot: Boolean(selectedSlot),
        }));
        if (selectedSlot) {
          console.log(JSON.stringify({
            event: "confirm_booking_selected_slot_loaded",
            organization_id: organizationId,
            lead_id: leadId,
            selected_slot: {
              date: selectedSlot.date ?? null,
              time: selectedSlot.time ?? null,
              starts_at: selectedSlot.starts_at ?? null,
              provider_id: selectedSlot.provider_id ?? null,
              provider_name: selectedSlot.provider_name ?? null,
              service_key: selectedSlot.service_key ?? null,
              service_name: selectedSlot.service_name ?? null,
              hold_id: selectedSlot.hold_id ?? null,
            },
          }));
          console.log(JSON.stringify({
            event: "confirm_booking_selected_slot_state",
            organization_id: organizationId,
            lead_id: leadId,
            selected_slot: {
              date: selectedSlot.date ?? null,
              time: selectedSlot.time ?? null,
              starts_at: selectedSlot.starts_at ?? null,
              ends_at: selectedSlot.ends_at ?? null,
              provider_id: selectedSlot.provider_id ?? null,
              provider_name: selectedSlot.provider_name ?? null,
              service_key: selectedSlot.service_key ?? null,
              service_name: selectedSlot.service_name ?? null,
              hold_id: selectedSlot.hold_id ?? null,
              hold_expires_at: selectedSlot.hold_expires_at ?? null,
            },
          }));
        }
        const appointmentDate = String(
          selectedSlot?.date ?? payload.appointment_date ?? "",
        ).trim();
        const appointmentTime = String(
          selectedSlot?.time ?? payload.appointment_time ?? "",
        ).trim();
        const patientName = String(payload.patient_name ?? "").trim();
        const service = String(
          selectedSlot?.service_name ?? payload.service ?? payload.reason ??
            "Consulta General",
        ).trim();
        const preferredBarberRaw = String(
          selectedSlot?.provider_name ?? payload.preferred_barber ??
            payload.provider_name ?? "",
        ).trim();
        const preferredBarber =
          /\b(cualquiera|cualquier barbero|el que este libre|el que esté libre)\b/i
              .test(preferredBarberRaw)
            ? ""
            : preferredBarberRaw;
        let payloadProviderId = String(
          selectedSlot?.provider_id ?? payload.provider_id ?? "",
        ).trim();
        if (
          isDentalAppointmentWrite && payloadProviderId &&
          !isValidUuid(payloadProviderId)
        ) {
          console.warn(JSON.stringify({
            event: "dental_guided_invalid_provider_id_sanitized",
            organization_id: organizationId,
            lead_id: leadId,
            provider_id: payloadProviderId,
          }));
          payloadProviderId = "";
        }
        if (!payloadProviderId && preferredBarber) {
          const barbersLookup = await supabase
            .from("barbers")
            .select("id, name")
            .eq("organization_id", organizationId)
            .eq("is_active", true);
          if (!barbersLookup.error && Array.isArray(barbersLookup.data)) {
            const normalize = (v: string) =>
              v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
                .trim();
            const target = normalize(preferredBarber);
            const match = barbersLookup.data.find((b: any) =>
              normalize(String(b?.name ?? "")) === target
            );
            if (match?.id) payloadProviderId = String(match.id);
          }
        }
        const providerPreference: "any" | "specific" = payloadProviderId
          ? "specific"
          : "any";

        const rawStartOverride = String(
          selectedSlot?.starts_at ?? payload.starts_at ?? "",
        );
        const startIso = buildIsoTimestamp(
          appointmentDate,
          appointmentTime,
          isDentalAppointmentWrite && isNaiveIsoTimestamp(rawStartOverride)
            ? ""
            : rawStartOverride,
          orgTimezone,
        );
        const actualDurationMin =
          Number(selectedSlot?.duration_min ?? payload.duration_min) ||
          resolveServiceDurationMin(service, 60);
        const bufferAfterMin = Number(
          selectedSlot?.buffer_after_min ?? payload.buffer_after_min ?? 0,
        ) || 0;
        const effectiveDurationMin = Number(
          selectedSlot?.effective_duration_min ??
            payload.effective_duration_min,
        ) || (actualDurationMin + bufferAfterMin);
        const durationMin = isDentalGuidedPendingConfirmation
          ? effectiveDurationMin
          : actualDurationMin;
        const rawEndOverride = String(
          selectedSlot?.ends_at ?? payload.ends_at ?? "",
        );
        const endIso = buildEndIso(
          isDentalAppointmentWrite && isNaiveIsoTimestamp(rawEndOverride)
            ? ""
            : rawEndOverride,
          startIso,
          durationMin,
        );
        if (isDentalAppointmentWrite) {
          console.log(
            "[actionExecutor] dental confirm trace",
            JSON.stringify({
              stage: "normalized_before_checks",
              organization_id: organizationId,
              lead_id: leadId,
              provider_id: payloadProviderId || null,
              provider_name: preferredBarber || null,
              appointment_date: appointmentDate,
              appointment_time: appointmentTime,
              start_at: startIso,
              starts_at: startIso,
              end_at: endIso,
              ends_at: endIso,
            }),
          );
        }
        console.log(JSON.stringify({
          event: "booking:availability_check",
          organization_id: organizationId,
          lead_id: leadId,
          starts_at: startIso,
          ends_at: endIso,
        }));

        if (!startIso) {
          bookingResult = {
            ok: false,
            error: "missing_or_invalid_starts_at",
          };
          console.error(JSON.stringify({
            event: "booking:insert_failed",
            organization_id: organizationId,
            lead_id: leadId,
            error: bookingResult.error,
          }));
          break;
        }
        if (!endIso) {
          bookingResult = {
            ok: false,
            error: "missing_or_invalid_ends_at",
          };
          console.error(JSON.stringify({
            event: "booking:insert_failed",
            organization_id: organizationId,
            lead_id: leadId,
            error: bookingResult.error,
          }));
          break;
        }

        if (!appointmentDate || !appointmentTime) {
          bookingResult = {
            ok: false,
            error: "missing_requested_date_or_time",
          };
          replyOverride =
            "Necesito fecha y hora para confirmar la cita. Decime qué día y hora te queda mejor.";
          break;
        }
        if (
          isDentalAppointmentWrite &&
          appointmentDate < formatDateInTimezoneIso(new Date(), orgTimezone)
        ) {
          bookingResult = {
            ok: false,
            error: "requested_date_in_past",
          };
          replyOverride =
            "Tuve un problema guardando la cita. Te paso con recepción para confirmarla manualmente.";
          console.warn(JSON.stringify({
            event: "booking:past_date_rejected",
            organization_id: organizationId,
            lead_id: leadId,
            appointment_date: appointmentDate,
            timezone: orgTimezone,
          }));
          break;
        }
        if (
          isDentalAppointmentWrite &&
          daysBetweenIsoDates(
              formatDateInTimezoneIso(new Date(), orgTimezone),
              appointmentDate,
            ) > 90 &&
          !hasExplicitDentalYearMarker(payload, selectedSlot)
        ) {
          bookingResult = {
            ok: false,
            error: "requested_date_suspicious_rollover",
          };
          replyOverride =
            "Tuve un problema guardando la cita. Te paso con recepción para confirmarla manualmente.";
          console.warn(JSON.stringify({
            event: "booking:suspicious_future_date_rejected",
            organization_id: organizationId,
            lead_id: leadId,
            appointment_date: appointmentDate,
            timezone: orgTimezone,
          }));
          break;
        }
        if (isBarbershopBooking && !selectedSlot) {
          bookingResult = { ok: false, error: "selected_slot_required" };
          replyOverride =
            "Necesito que elijás un horario disponible antes de confirmar.";
          break;
        }

        const holdId = String(selectedSlot?.hold_id ?? payload.hold_id ?? "")
          .trim();
        let activeHoldValidated = false;
        if (isBarbershopBooking && holdId) {
          const activeHold = await getActiveBookingHoldById({
            supabase,
            organizationId,
            leadId,
            holdId,
          });
          console.log(JSON.stringify({
            event: "confirm_booking_hold_loaded",
            organization_id: organizationId,
            lead_id: leadId,
            hold_id: holdId,
            found: Boolean(activeHold),
            provider_id: activeHold?.provider_id ?? null,
            starts_at: activeHold?.starts_at ?? null,
            expires_at: activeHold?.expires_at ?? null,
            status: activeHold?.status ?? null,
          }));
          if (activeHold) {
            const holdStartMs = Date.parse(String(activeHold.starts_at ?? ""));
            const requestStartMs = Date.parse(startIso);
            const holdMatchesSlot =
              String(activeHold.provider_id ?? "") === payloadProviderId &&
              Number.isFinite(holdStartMs) &&
              Number.isFinite(requestStartMs) &&
              holdStartMs === requestStartMs;
            if (!holdMatchesSlot) {
              console.warn(JSON.stringify({
                event: "confirm_booking_hold_validation_failed",
                organization_id: organizationId,
                lead_id: leadId,
                hold_id: holdId,
                reason: "booking_hold_mismatch",
              }));
              bookingResult = { ok: false, error: "booking_hold_mismatch" };
              replyOverride =
                "Ese espacio ya no coincide con la reserva temporal. Te puedo buscar otro horario.";
              break;
            }
            activeHoldValidated = true;
            console.log(JSON.stringify({
              event: "confirm_booking_hold_valid",
              organization_id: organizationId,
              lead_id: leadId,
              hold_id: holdId,
              provider_id: activeHold.provider_id,
              starts_at: activeHold.starts_at,
              expires_at: activeHold.expires_at,
            }));
            console.log(JSON.stringify({
              event: "confirm_booking_own_hold_ignored_as_conflict",
              organization_id: organizationId,
              lead_id: leadId,
              hold_id: holdId,
              provider_id: activeHold.provider_id,
              starts_at: activeHold.starts_at,
            }));
          } else {
            console.log(JSON.stringify({
              event: "booking_hold_expired_or_missing",
              organization_id: organizationId,
              lead_id: leadId,
              hold_id: holdId,
            }));
            console.warn(JSON.stringify({
              event: "confirm_booking_hold_validation_failed",
              organization_id: organizationId,
              lead_id: leadId,
              hold_id: holdId,
              reason: "expired_or_missing",
            }));
          }
        }

        const requestedGuard = isDentalGuidedPendingConfirmation
          ? {
            canBookRequestedDateTime: true,
            reason: null,
            suggestedSlots: [] as Array<Record<string, unknown>>,
          }
          : activeHoldValidated
          ? {
            canBookRequestedDateTime: true,
            reason: null,
            suggestedSlots: [] as Array<Record<string, unknown>>,
          }
          : await validateRequestedDateTimeBookability({
            supabase,
            organizationId,
            serviceName: service,
            appointmentDate,
            appointmentTime,
            timezone: orgTimezone,
            providerId: payloadProviderId || null,
            providerPreference,
          });
        const nextAvailableDate =
          String((requestedGuard.suggestedSlots ?? [])[0]?.date ?? "").trim() ||
          null;
        console.log(JSON.stringify({
          event: "barbershop:requested_datetime_guard_entered",
          organization_id: organizationId,
          requested_date: appointmentDate,
          requested_day_of_week: new Date(`${appointmentDate}T12:00:00Z`)
            .getUTCDay(),
          requested_time: appointmentTime,
          provider_assignment_result: providerPreference,
          blocked_reason: requestedGuard.reason,
          next_available_date: nextAvailableDate,
        }));
        if (!requestedGuard.canBookRequestedDateTime) {
          const options = (requestedGuard.suggestedSlots ?? [])
            .slice(0, 5)
            .map((slot) => {
              const date = String((slot as any).date ?? "");
              const time = String((slot as any).time ?? "");
              const providerName = String((slot as any).provider_name ?? "")
                .trim();
              return `${formatHourLabel(time)}${
                providerName ? ` con ${providerName}` : ""
              }`;
            })
            .filter(Boolean)
            .join(" · ");
          const dayLabel = formatHumanDay(appointmentDate);
          if (requestedGuard.reason === "requested_day_closed") {
            replyOverride = options
              ? `El ${dayLabel} no estamos atendiendo, pero tengo disponibilidad el ${
                formatHumanDay(
                  String(
                    (requestedGuard.suggestedSlots ?? [])[0]?.date ??
                      appointmentDate,
                  ),
                )
              }:\n${options}\n¿Cuál te queda mejor?`
              : `El ${dayLabel} no estamos atendiendo. ¿Querés que te proponga el próximo día disponible?`;
          } else if (requestedGuard.reason === "requested_time_outside_hours") {
            replyOverride = options
              ? `A esa hora no estamos atendiendo. Para ${dayLabel} tengo:\n${options}\n¿Cuál te queda mejor?`
              : "A esa hora no estamos atendiendo. Decime otro horario y te ayudo a revisarlo.";
          } else {
            replyOverride = options
              ? `Ese horario no está disponible, pero tengo:\n${options}\n¿Cuál te queda mejor?`
              : "Ese horario ya no está disponible. ¿Querés que te proponga otro?";
          }
          bookingResult = {
            ok: false,
            error: `requested_datetime_invalid:${
              requestedGuard.reason ?? "unknown"
            }`,
          };
          break;
        }

        const providerNameForInsert = requestedBusinessType === "dental"
          ? formatDentalAppointmentProviderName(
            preferredBarber ||
              String(selectedSlot?.provider_name ?? payload.provider_name ?? "")
                .trim(),
            payload.brand_name ??
              ((payload.metadata && typeof payload.metadata === "object")
                ? (payload.metadata as Record<string, unknown>).brand_name
                : ""),
            organizationId,
          )
          : (preferredBarber ||
            String(selectedSlot?.provider_name ?? "").trim() || null);
        const appointmentFields: Record<string, any> = {
          organization_id: organizationId,
          lead_id: leadId,
          patient_name: patientName || null,
          reason: service,
          title: String(payload.title ?? `Cita: ${service}`).trim(),
          start_at: startIso,
          starts_at: startIso,
          end_at: endIso,
          ends_at: endIso || startIso,
          duration_min: actualDurationMin,
          provider_id: payloadProviderId || null,
          provider_name: providerNameForInsert,
          metadata: {
            ...(typeof payload.metadata === "object" && payload.metadata
              ? (payload.metadata as Record<string, unknown>)
              : {}),
            ...(preferredBarber ? { preferred_barber: preferredBarber } : {}),
            ...(bufferAfterMin ? { buffer_after_min: bufferAfterMin } : {}),
            ...(effectiveDurationMin !== actualDurationMin
              ? { effective_duration_min: effectiveDurationMin }
              : {}),
          },
          status: "confirmed",
          appointment_date: appointmentDate || startIso.slice(0, 10),
          appointment_time: appointmentTime || startIso.slice(11, 16),
          updated_at: now,
        };
        console.log(JSON.stringify({
          event: "booking:insert_attempt",
          organization_id: organizationId,
          lead_id: leadId,
          payload: {
            organization_id: appointmentFields.organization_id ?? null,
            lead_id: appointmentFields.lead_id ?? null,
            patient_name: appointmentFields.patient_name ?? null,
            reason: appointmentFields.reason ?? null,
            title: appointmentFields.title ?? null,
            starts_at: appointmentFields.starts_at ?? null,
            start_at: appointmentFields.start_at ?? null,
            ends_at: appointmentFields.ends_at ?? null,
            end_at: appointmentFields.end_at ?? null,
            appointment_date: appointmentFields.appointment_date ?? null,
            appointment_time: appointmentFields.appointment_time ?? null,
            duration_min: appointmentFields.duration_min ?? null,
            effective_duration_min: durationMin,
            status: appointmentFields.status ?? null,
          },
        }));
        console.log(JSON.stringify({
          event: "confirm_booking_insert_payload",
          organization_id: organizationId,
          lead_id: leadId,
          payload: {
            organization_id: appointmentFields.organization_id ?? null,
            lead_id: appointmentFields.lead_id ?? null,
            reason: appointmentFields.reason ?? null,
            starts_at: appointmentFields.starts_at ?? null,
            ends_at: appointmentFields.ends_at ?? null,
            appointment_date: appointmentFields.appointment_date ?? null,
            appointment_time: appointmentFields.appointment_time ?? null,
            duration_min: appointmentFields.duration_min ?? null,
            effective_duration_min: durationMin,
            provider_id: appointmentFields.provider_id ?? null,
            provider_name: appointmentFields.provider_name ?? null,
            status: appointmentFields.status ?? null,
            hold_id: holdId || null,
          },
        }));

        const existingApptRes = await supabase
          .from("appointments")
          .select("id")
          .eq("lead_id", leadId)
          .eq("organization_id", organizationId)
          .in("status", ["confirmed", "pending"])
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingApptRes.error) {
          bookingResult = {
            ok: false,
            error: `lookup_failed:${
              formatSupabaseError(existingApptRes.error)
            }`,
          };
          console.error(JSON.stringify({
            event: "booking:insert_failed",
            operation: "lookup_active",
            organization_id: organizationId,
            lead_id: leadId,
            error: bookingResult.error,
          }));
          break;
        }
        const existingAppt = isDentalAppointmentWrite && allowAdditionalBooking
          ? null
          : existingApptRes.data;

        // Hard guard: block duplicate exact appointment for the same lead and warn on same-day active appointment.
        const futureLeadAppointmentsRes = await supabase
          .from("appointments")
          .select(
            "id, reason, title, appointment_date, appointment_time, starts_at, status",
          )
          .eq("organization_id", organizationId)
          .eq("lead_id", leadId)
          .in("status", ["pending", "confirmed"])
          .gte(
            "appointment_date",
            formatDateInTimezoneIso(new Date(), orgTimezone),
          )
          .order("appointment_date", { ascending: true })
          .order("appointment_time", { ascending: true })
          .limit(25);
        if (futureLeadAppointmentsRes.error) {
          bookingResult = {
            ok: false,
            error: `lead_appointments_lookup_failed:${
              formatSupabaseError(futureLeadAppointmentsRes.error)
            }`,
          };
          break;
        }
        const futureLeadAppointments =
          Array.isArray(futureLeadAppointmentsRes.data)
            ? futureLeadAppointmentsRes.data.filter((appt: any) => {
              const startsAtMs = Date.parse(String(appt.starts_at ?? ""));
              if (Number.isFinite(startsAtMs)) return startsAtMs > Date.now();
              const apptDate = String(appt.appointment_date ?? "").trim();
              const apptTime = String(appt.appointment_time ?? "").trim();
              const today = formatDateInTimezoneIso(new Date(), orgTimezone);
              const currentTime = new Date().toLocaleTimeString("en-GB", {
                timeZone: orgTimezone,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });
              return apptDate > today ||
                (apptDate === today && apptTime > currentTime);
            })
            : [];
        const normalizeService = (value: string) =>
          value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
            .trim();
        const requestedServiceNormalized = normalizeService(service);
        const exactDuplicate = futureLeadAppointments.find((appt: any) => {
          const apptDate = String(
            appt.appointment_date ?? String(appt.starts_at ?? "").slice(0, 10),
          ).trim();
          const apptTime = String(
            appt.appointment_time ?? String(appt.starts_at ?? "").slice(11, 16),
          ).trim();
          const apptService = normalizeService(
            String(appt.reason ?? appt.title ?? ""),
          );
          return apptDate === appointmentDate && apptTime === appointmentTime &&
            apptService === requestedServiceNormalized;
        });
        if (exactDuplicate) {
          bookingResult = { ok: false, error: "duplicate_appointment_exact" };
          replyOverride = `Ya tenés una cita confirmada para ${
            formatHumanDay(appointmentDate)
          } a las ${formatHourLabel(appointmentTime)} 💈\n\n¿Qué querés hacer?`;
          break;
        }
        const sameDayActive = futureLeadAppointments.find((appt: any) => {
          const apptDate = String(
            appt.appointment_date ?? String(appt.starts_at ?? "").slice(0, 10),
          ).trim();
          return apptDate === appointmentDate;
        });
        if (sameDayActive) {
          bookingResult = {
            ok: false,
            error: "existing_active_appointment_same_day",
          };
          const activeDate = String(
            sameDayActive.appointment_date ??
              String(sameDayActive.starts_at ?? "").slice(0, 10),
          ).trim();
          const activeTime = String(
            sameDayActive.appointment_time ??
              String(sameDayActive.starts_at ?? "").slice(11, 16),
          ).trim();
          replyOverride = `Ya tenés una cita confirmada para ${
            formatHumanDay(activeDate || appointmentDate)
          } a las ${
            formatHourLabel(activeTime || appointmentTime)
          } 💈\n\n¿Qué querés hacer?`;
          break;
        }

        // Global overlap check for organization, ignoring cancelled appointments.
        console.log(JSON.stringify({
          event: "confirm_booking_conflict_check",
          organization_id: organizationId,
          lead_id: leadId,
          starts_at: startIso,
          ends_at: endIso,
          provider_id: appointmentFields.provider_id ?? null,
          provider_name: appointmentFields.provider_name ?? null,
        }));
        if (isDentalAppointmentWrite) {
          console.log(
            "[actionExecutor] dental confirm trace",
            JSON.stringify({
              stage: "before_conflict_check",
              organization_id: organizationId,
              lead_id: leadId,
              provider_id: appointmentFields.provider_id ?? null,
              provider_name: appointmentFields.provider_name ?? null,
              start_at: startIso,
              starts_at: startIso,
              end_at: endIso,
              ends_at: endIso,
            }),
          );
        }
        let overlapQuery = supabase
          .from("appointments")
          .select(
            "id, starts_at, ends_at, appointment_date, appointment_time, status",
          )
          .eq("organization_id", organizationId)
          .neq("status", "cancelled")
          .lt("starts_at", endIso)
          .gt("ends_at", startIso)
          .limit(1);
        if (appointmentFields.provider_id) {
          overlapQuery = overlapQuery.eq(
            "provider_id",
            String(appointmentFields.provider_id),
          );
        }
        if (existingAppt?.id) {
          overlapQuery = overlapQuery.neq("id", existingAppt.id);
        }
        const overlapRes = await overlapQuery;
        if (isDentalAppointmentWrite) {
          console.log(
            "[actionExecutor] dental confirm trace",
            JSON.stringify({
              stage: "after_conflict_check",
              organization_id: organizationId,
              lead_id: leadId,
              provider_id: appointmentFields.provider_id ?? null,
              provider_name: appointmentFields.provider_name ?? null,
              error: overlapRes.error
                ? formatSupabaseError(overlapRes.error)
                : null,
              conflicts: Array.isArray(overlapRes.data)
                ? overlapRes.data.length
                : 0,
            }),
          );
        }
        if (overlapRes.error) {
          bookingResult = {
            ok: false,
            error: `availability_lookup_failed:${
              formatSupabaseError(overlapRes.error)
            }`,
          };
          console.error(JSON.stringify({
            event: "booking:insert_failed",
            operation: "availability_lookup",
            organization_id: organizationId,
            lead_id: leadId,
            error: bookingResult.error,
          }));
          break;
        }
        if ((overlapRes.data ?? []).length > 0) {
          console.log(JSON.stringify({
            event: "confirm_booking_conflict_found",
            organization_id: organizationId,
            lead_id: leadId,
            starts_at: startIso,
            provider_id: appointmentFields.provider_id ?? null,
          }));
          console.warn(JSON.stringify({
            event: "confirm_booking_conflict_detected",
            organization_id: organizationId,
            lead_id: leadId,
            starts_at: startIso,
            provider_id: appointmentFields.provider_id ?? null,
            reason: "appointment_overlap",
          }));
          console.log(JSON.stringify({
            event: "booking:availability_conflict",
            organization_id: organizationId,
            lead_id: leadId,
            starts_at: startIso,
            ends_at: endIso,
          }));
          const clinicHours = await loadClinicHours(supabase, organizationId);
          if (clinicHours) {
            const slots = await getAvailableSlots({
              supabase: supabase as any,
              organizationId,
              hours: clinicHours,
              daysAhead: 4,
              slotDurationMin: durationMin,
              timezone: orgTimezone,
              sameDayBookingCutoff: sameDayCutoff,
              bufferMin,
            });
            const alternatives = slots.slice(0, 2);
            if (alternatives.length > 0) {
              replyOverride = `Ese horario ya no está disponible. Te ofrezco ${
                alternatives.map((s) => `${s.dayLabel} a las ${s.time}`).join(
                  " o ",
                )
              }.`;
            }
          }
          bookingResult = { ok: false, error: "availability_conflict" };
          if (!replyOverride) {
            replyOverride =
              "Ese horario acaba de ocuparse. Decime otra hora y te ayudo a revisarla.";
          }
          break;
        }
        console.log(JSON.stringify({
          event: "booking:availability_available",
          organization_id: organizationId,
          lead_id: leadId,
          starts_at: startIso,
          ends_at: endIso,
        }));

        // Legacy dental provider selection fallback.
        // For BarberLine, if provider is already present in payload/pending booking, we must preserve it.
        if (
          appointmentDate && appointmentTime && startIso &&
          !appointmentFields.provider_id && !appointmentFields.provider_name
        ) {
          const [reqH, reqM] = appointmentTime.split(":").map(Number);
          const reqMins = reqH * 60 + (reqM || 0);
          const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
          const dateObj = new Date(appointmentDate + "T12:00:00Z");
          const dayKey = days[dateObj.getUTCDay()];

          // Load all doctors who do this service and work this day
          const { data: allProviders } = await supabase
            .from("providers")
            .select("name, services, schedule")
            .eq("organization_id", organizationId)
            .eq("active", true)
            .eq("role", "doctor");

          const eligibleDocs = (allProviders || []).filter((p: any) => {
            const svcs = Array.isArray(p.services) ? p.services : [];
            const sched = p.schedule ? (p.schedule as any)[dayKey] : null;
            return svcs.some((s: string) =>
              s.toLowerCase() === service.toLowerCase()
            ) && sched && !sched.closed;
          });

          if (eligibleDocs.length > 0) {
            const preferredProvider = String(
              payload.provider_name ?? payload.preferred_barber ?? "",
            ).trim();
            const assignedDoc = eligibleDocs.find((d: any) =>
              String(d.name ?? "") === preferredProvider
            )?.name ??
              (eligibleDocs[0] as any).name;
            appointmentFields.provider_name = assignedDoc;
            appointmentFields.metadata = {
              ...(typeof appointmentFields.metadata === "object" &&
                  appointmentFields.metadata
                ? (appointmentFields.metadata as Record<string, unknown>)
                : {}),
              preferred_barber: preferredProvider || assignedDoc,
              assigned_provider: assignedDoc,
            };
            console.log(JSON.stringify({
              event: "availability:provider_selected",
              organization_id: organizationId,
              lead_id: leadId,
              provider_name: assignedDoc,
              requested_time_minutes: reqMins,
            }));
          }
        }

        if (!appointmentFields.provider_id && appointmentFields.provider_name) {
          const barbersRes = await supabase
            .from("barbers")
            .select("id, name")
            .eq("organization_id", organizationId)
            .eq("is_active", true);
          if (!barbersRes.error && Array.isArray(barbersRes.data)) {
            const normalize = (v: string) =>
              v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
                .trim();
            const wanted = normalize(String(appointmentFields.provider_name));
            const matched = barbersRes.data.find((b: any) =>
              normalize(String(b?.name ?? "")) === wanted
            );
            if (matched?.id) {
              appointmentFields.provider_id = String(matched.id);
            }
          }
        }
        if (appointmentFields.provider_id && !activeHoldValidated) {
          if (isDentalGuidedPendingConfirmation) {
            console.log(JSON.stringify({
              event:
                "dental_guided_pending_confirmation_skips_recomputed_provider_validation",
              organization_id: organizationId,
              lead_id: leadId,
              starts_at: startIso,
              provider_id: appointmentFields.provider_id ?? null,
            }));
          } else {
            const providerValidation = await checkSlotAvailability({
              supabase: supabase as any,
              organization_id: organizationId,
              business_type: isBarbershopBooking ? "barbershop" : "dental",
              service_name: String(appointmentFields.reason ?? service),
              provider_id: String(appointmentFields.provider_id),
              provider_preference: "specific",
              date: String(
                appointmentFields.appointment_date ?? appointmentDate,
              ),
              specific_time: String(
                appointmentFields.appointment_time ?? appointmentTime,
              ),
              timezone: orgTimezone,
              max_options: 3,
            });
            if (!providerValidation.available) {
              bookingResult = {
                ok: false,
                error: "provider_assignment_required",
              };
              const alternatives = (providerValidation.alternatives ?? [])
                .slice(
                  0,
                  3,
                );
              replyOverride = alternatives.length > 0
                ? `Ese horario acaba de ocuparse. Te puedo ofrecer estas opciones:\n${
                  alternatives.map((slot: any) =>
                    `${formatHourLabel(String(slot?.time ?? ""))}${
                      slot?.provider_name
                        ? ` · ${String(slot.provider_name)}`
                        : ""
                    }`
                  ).join(" · ")
                }`
                : "Ese horario acaba de ocuparse. Te puedo ofrecer estas opciones.";
              break;
            }
          }
        }
        if (
          isBarbershopBooking &&
          (!appointmentFields.provider_id || !appointmentFields.provider_name)
        ) {
          bookingResult = { ok: false, error: "provider_assignment_required" };
          replyOverride =
            "No pude asignar un barbero para ese horario. ¿Querés que te proponga otras horas disponibles?";
          break;
        }
        if (
          isDentalAppointmentWrite &&
          appointmentFields.provider_id &&
          !isValidUuid(appointmentFields.provider_id)
        ) {
          console.warn(JSON.stringify({
            event: "dental_guided_invalid_provider_id_sanitized",
            operation: "pre_write",
            organization_id: organizationId,
            lead_id: leadId,
            provider_id: appointmentFields.provider_id,
            provider_name: appointmentFields.provider_name ?? null,
          }));
          appointmentFields.provider_id = null;
          appointmentFields.provider_name = formatDentalAppointmentProviderName(
            appointmentFields.provider_name,
            payload.brand_name ??
              ((payload.metadata && typeof payload.metadata === "object")
                ? (payload.metadata as Record<string, unknown>).brand_name
                : ""),
            organizationId,
          );
        }
        if (isDentalAppointmentWrite) {
          const hasNaiveStart =
            isNaiveIsoTimestamp(appointmentFields.start_at) ||
            isNaiveIsoTimestamp(appointmentFields.starts_at) ||
            isNaiveIsoTimestamp(selectedSlot?.starts_at) ||
            isNaiveIsoTimestamp(payload.starts_at);
          const normalizedStartIso = hasNaiveStart
            ? buildIsoTimestamp(
              String(appointmentFields.appointment_date ?? appointmentDate),
              String(appointmentFields.appointment_time ?? appointmentTime),
              "",
              orgTimezone,
            )
            : null;
          if (normalizedStartIso) {
            appointmentFields.start_at = normalizedStartIso;
            appointmentFields.starts_at = normalizedStartIso;
            const normalizedEndIso = buildEndIso(
              "",
              normalizedStartIso,
              durationMin,
            );
            if (normalizedEndIso) {
              appointmentFields.end_at = normalizedEndIso;
              appointmentFields.ends_at = normalizedEndIso;
            }
          }
        }
        if (isDentalAppointmentWrite) {
          console.log(
            "[actionExecutor] dental confirm trace",
            JSON.stringify({
              stage: "before_final_appointment_write",
              operation: existingAppt?.id ? "update_active" : "insert_new",
              organization_id: organizationId,
              lead_id: leadId,
              provider_id: appointmentFields.provider_id ?? null,
              provider_name: appointmentFields.provider_name ?? null,
              appointment_date: appointmentFields.appointment_date ?? null,
              appointment_time: appointmentFields.appointment_time ?? null,
              start_at: appointmentFields.start_at ?? null,
              starts_at: appointmentFields.starts_at ?? null,
              end_at: appointmentFields.end_at ?? null,
              ends_at: appointmentFields.ends_at ?? null,
              status: appointmentFields.status ?? null,
              reason: appointmentFields.reason ?? null,
              title: appointmentFields.title ?? null,
            }),
          );
        }
        let appointmentRow: AppointmentInsertRecord | null = null;
        if (existingAppt?.id) {
          const updateRes = await supabase.from("appointments").update(
            appointmentFields,
          ).eq("id", existingAppt.id).select(
            APPOINTMENT_SELECT_FIELDS,
          ).single();
          if (updateRes.error) {
            bookingResult = {
              ok: false,
              error: `update_failed:${formatSupabaseError(updateRes.error)}`,
            };
            console.error(JSON.stringify({
              event: "booking:insert_failed",
              operation: "update_active",
              organization_id: organizationId,
              lead_id: leadId,
              error: bookingResult.error,
            }));
            if (isDentalAppointmentWrite) {
              logDentalAppointmentWriteFailure({
                operation: "update_active",
                organizationId,
                leadId,
                appointmentFields,
                error: updateRes.error,
              });
            }
            break;
          }
          appointmentRow = (updateRes.data ?? null) as
            | AppointmentInsertRecord
            | null;
        } else {
          const insertRes = await supabase.from("appointments").insert({
            ...appointmentFields,
            created_at: now,
          }).select(
            APPOINTMENT_SELECT_FIELDS,
          ).single();
          if (insertRes.error) {
            const formattedError = formatSupabaseError(insertRes.error);
            const isConflict = isAppointmentConflictError(insertRes.error);
            bookingResult = {
              ok: false,
              error: `${
                isConflict ? "slot_conflict" : "insert_failed"
              }:${formattedError}`,
            };
            console.error(JSON.stringify({
              event: "booking:insert_failed",
              operation: "insert_new",
              organization_id: organizationId,
              lead_id: leadId,
              appointment_date: appointmentFields.appointment_date ?? null,
              appointment_time: appointmentFields.appointment_time ?? null,
              start_at: appointmentFields.start_at ?? null,
              end_at: appointmentFields.end_at ?? null,
              ends_at: appointmentFields.ends_at ?? null,
              provider_id: appointmentFields.provider_id ?? null,
              provider_name: appointmentFields.provider_name ?? null,
              error_code: (insertRes.error as any)?.code ?? null,
              error_message: (insertRes.error as any)?.message ??
                formattedError,
              error: bookingResult.error,
            }));
            console.error(JSON.stringify({
              event: "confirm_booking_db_insert_failed",
              organization_id: organizationId,
              lead_id: leadId,
              appointment_date: appointmentFields.appointment_date ?? null,
              appointment_time: appointmentFields.appointment_time ?? null,
              start_at: appointmentFields.start_at ?? null,
              starts_at: startIso,
              end_at: appointmentFields.end_at ?? null,
              ends_at: appointmentFields.ends_at ?? null,
              provider_id: appointmentFields.provider_id ?? null,
              provider_name: appointmentFields.provider_name ?? null,
              error_code: (insertRes.error as any)?.code ?? null,
              error_message: (insertRes.error as any)?.message ??
                formattedError,
              error: bookingResult.error,
            }));
            console.error(JSON.stringify({
              event: "confirm_booking_insert_error",
              organization_id: organizationId,
              lead_id: leadId,
              appointment_date: appointmentFields.appointment_date ?? null,
              appointment_time: appointmentFields.appointment_time ?? null,
              start_at: appointmentFields.start_at ?? null,
              starts_at: startIso,
              end_at: appointmentFields.end_at ?? null,
              ends_at: appointmentFields.ends_at ?? null,
              provider_id: appointmentFields.provider_id ?? null,
              provider_name: appointmentFields.provider_name ?? null,
              error_code: (insertRes.error as any)?.code ?? null,
              error_message: (insertRes.error as any)?.message ??
                formattedError,
              error: bookingResult.error,
            }));
            if (isDentalAppointmentWrite) {
              logDentalAppointmentWriteFailure({
                operation: "insert_new",
                organizationId,
                leadId,
                appointmentFields,
                error: insertRes.error,
              });
            }
            if (isConflict && isBarbershopBooking) {
              console.warn(JSON.stringify({
                event: "confirm_booking_conflict_detected",
                organization_id: organizationId,
                lead_id: leadId,
                starts_at: startIso,
                provider_id: appointmentFields.provider_id ?? null,
                reason: "db_insert_conflict",
              }));
              const alternatives = await suggestNextAvailableSlots({
                supabase: supabase as any,
                organization_id: organizationId,
                business_type: "barbershop",
                service_name: String(appointmentFields.reason ?? service),
                provider_id: String(appointmentFields.provider_id ?? "") ||
                  undefined,
                provider_preference: "specific",
                date_from: String(
                  appointmentFields.appointment_date ?? appointmentDate,
                ),
                timezone: orgTimezone,
                max_options: 3,
              });
              const formattedAlternatives = formatSlotAlternatives(
                alternatives as Array<Record<string, unknown>>,
              );
              replyOverride = formattedAlternatives
                ? `Ese horario acaba de ocuparse.\n\nTengo estas opciones cercanas:\n${formattedAlternatives}\n\n¿Cuál te queda mejor?`
                : "Ese horario acaba de ocuparse. Decime otra hora y te ayudo a revisarla.";
            }
            break;
          }
          appointmentRow = (insertRes.data ?? null) as
            | AppointmentInsertRecord
            | null;
        }

        if (!appointmentRow?.id) {
          bookingResult = {
            ok: false,
            error: "insert_failed:no_appointment_id",
          };
          console.error(JSON.stringify({
            event: "booking:insert_failed",
            operation: "no_appointment_id",
            organization_id: organizationId,
            lead_id: leadId,
            error: bookingResult.error,
          }));
          break;
        }

        console.log(JSON.stringify({
          event: "booking:insert_success",
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: appointmentRow.id,
          starts_at: appointmentRow.starts_at,
        }));
        if (isBarbershopBooking && holdId) {
          await consumeBookingHold({
            supabase,
            organizationId,
            leadId,
            holdId,
            appointmentId: appointmentRow.id,
          });
        }
        console.log(JSON.stringify({
          event: "confirm_booking_success",
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: appointmentRow.id,
          provider_id: appointmentRow.provider_id ?? null,
          provider_name: appointmentRow.provider_name ?? null,
        }));
        console.log(JSON.stringify({
          event: "confirm_booking_succeeded",
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: appointmentRow.id,
          provider_id: appointmentRow.provider_id ?? null,
          provider_name: appointmentRow.provider_name ?? null,
        }));

        if (appointmentRow.id) {
          await syncCalendarEvent({
            organization_id: organizationId,
            title: appointmentFields.title,
            starts_at: startIso,
            ends_at: endIso || startIso,
            patient_name: patientName,
            metadata: {
              source: "groq_ai_bot",
              appointment_id: appointmentRow.id,
            },
          } as any);
        }

        statePatch = clearActiveBookingState({
          stage: "BOOKED",
          lastIntent: "booking_confirmed",
          nextExpected: undefined,
          pending_booking: null,
          pending_reschedule: null,
          pending_offered_slot: null,
          last_appointment_summary: {
            appointment_id: appointmentRow.id,
            service: appointmentRow.reason ?? appointmentRow.title ??
              "Revisión dental",
            starts_at: appointmentRow.starts_at,
            status: "confirmed",
          },
          collected: {
            booking: {
              completed: true,
              confirmed: true,
              awaiting_confirmation: false,
              date: appointmentDate,
              time: appointmentTime,
            },
          },
        });
        eventType = "appointment_booked";
        const appointmentForRelation =
          String(payload.appointment_for_relation ?? "").trim() || null;
        bookingResult = {
          ok: true,
          appointment: {
            ...appointmentRow,
            appointment_for_relation: appointmentForRelation,
            preferred_barber: preferredBarber || null,
          } as unknown as AppointmentInsertRecord,
        };

        try {
          if (isBarbershopBooking) {
            const leadTarget = await loadLeadReminderTarget(supabase, leadId);
            const brandName = await loadBarbershopBrandName(
              supabase,
              organizationId,
            );
            await recordAppointmentEventBestEffort({
              supabase,
              organizationId,
              leadId,
              appointmentId: appointmentRow.id,
              eventType: "appointment_confirmed",
              payload: {
                channel: leadTarget.channel,
                service_name: appointmentRow.reason,
                provider_name: appointmentRow.provider_name ?? null,
                starts_at: appointmentRow.starts_at,
                appointment_date: appointmentRow.appointment_date,
                appointment_time: appointmentRow.appointment_time,
                customer_name: patientName || leadTarget.customerName || null,
              },
            });
            await scheduleBarbershopAppointmentReminders({
              supabase,
              organizationId,
              leadId,
              appointmentId: appointmentRow.id,
              startsAt: appointmentRow.starts_at,
              appointmentDate: appointmentRow.appointment_date,
              appointmentTime: appointmentRow.appointment_time,
              serviceName: appointmentRow.reason,
              providerName: String(
                appointmentRow.provider_name ?? preferredBarber ?? "",
              ),
              customerName: patientName || leadTarget.customerName,
              channel: leadTarget.channel,
              channelUserId: leadTarget.channelUserId,
              brandName,
            });
          } else {
            await scheduleFollowupBestEffort({
              supabase,
              organizationId,
              leadId,
              appointmentId: appointmentRow.id,
              startsAt: appointmentRow.starts_at,
              appointmentDate: appointmentRow.appointment_date,
              appointmentTime: appointmentRow.appointment_time,
              reason: appointmentRow.reason,
            });
          }
        } catch (followupErr) {
          // Followup must never change booking success status.
          console.warn(JSON.stringify({
            event: "followup:schedule_failed",
            organization_id: organizationId,
            lead_id: leadId,
            appointment_id: appointmentRow.id,
            error: formatSupabaseError(followupErr),
          }));
        }

        break;
      }

      case "cancel_appointment": {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const appointmentId = String(payload.appointment_id ?? "").trim();
        const isBarbershopCancel =
          String(payload.business_type ?? payload.orgType ?? "").trim()
            .toLowerCase() === "barbershop";
        const isDentalCancel =
          String(payload.business_type ?? payload.orgType ?? "").trim()
              .toLowerCase() === "dental" || organizationId === "clinic-demo";
        console.log(JSON.stringify({
          event: "appointment:cancel_requested",
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: appointmentId || null,
        }));

        let query = supabase
          .from("appointments")
          .select(APPOINTMENT_SELECT_FIELDS)
          .eq("organization_id", organizationId)
          .eq("lead_id", leadId)
          .in("status", ["pending", "confirmed"])
          .order("starts_at", { ascending: true })
          .limit(1);
        if (appointmentId) {
          query = query.eq("id", appointmentId);
        }
        const apptRes = await query.maybeSingle();
        if (apptRes.error) {
          const err = formatSupabaseError(apptRes.error);
          console.error(JSON.stringify({
            event: "appointment:cancel_failed",
            organization_id: organizationId,
            lead_id: leadId,
            error: err,
          }));
          replyOverride =
            "No pude cancelar la cita en este momento. Intentemos de nuevo.";
          break;
        }
        const appt = apptRes.data as AppointmentInsertRecord | null;
        if (!appt?.id) {
          replyOverride = isBarbershopCancel
            ? "No encontré una cita futura para cancelar.\n\nSi querés, puedo ayudarte a revisar horarios disponibles para agendar una."
            : "No encontré una cita activa a tu nombre.\n\nSi querés, puedo ayudarte a revisar horarios disponibles para agendar una.";
          break;
        }

        const cancelRes = await supabase
          .from("appointments")
          .update({ status: "cancelled", updated_at: now })
          .eq("id", appt.id)
          .select("id")
          .maybeSingle();
        if (cancelRes.error) {
          const err = formatSupabaseError(cancelRes.error);
          console.error(JSON.stringify({
            event: "appointment:cancel_failed",
            organization_id: organizationId,
            lead_id: leadId,
            appointment_id: appt.id,
            error: err,
          }));
          replyOverride =
            "No pude cancelar la cita en este momento. Intentemos de nuevo.";
          break;
        }

        console.log(JSON.stringify({
          event: "appointment:cancel_success",
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: appt.id,
        }));
        if (isBarbershopCancel) {
          await cancelBarbershopReminderJobs({
            supabase,
            organizationId,
            leadId,
            appointmentId: appt.id,
            reason: "appointment_cancelled",
          });
          await recordAppointmentEventBestEffort({
            supabase,
            organizationId,
            leadId,
            appointmentId: appt.id,
            eventType: "appointment_cancelled",
            payload: {
              service_name: String(appt.reason ?? appt.title ?? ""),
              provider_name: String((appt as any).provider_name ?? ""),
              starts_at: String(appt.starts_at ?? ""),
            },
          });
        }
        statePatch = clearActiveBookingState({
          stage: "DISCOVERY",
          lastIntent: "cancel_appointment",
          nextExpected: undefined,
          pending_cancel: null,
          pending_cancel_appointment: null,
          last_appointment_summary: {
            appointment_id: appt.id,
            service: String(appt.reason ?? appt.title ?? "Revisión dental"),
            starts_at: String(appt.starts_at ?? ""),
            status: "cancelled",
          },
          collected: {
            booking: {
              awaiting_confirmation: false,
            },
          },
        });
        if (isBarbershopCancel) {
          replyOverride =
            "✅ Tu cita fue cancelada.\n\nSi querés, puedo ayudarte a buscar otro horario.";
        } else if (isDentalCancel) {
          const service = toPatientFacingServiceLabel(String(
            appt.reason ?? appt.title ?? "servicio dental",
          ));
          const patientName = String(
            (payload as any).patient_name ?? (appt as any).patient_name ?? "",
          ).trim();
          const date = String(
            (appt as any).appointment_date ??
              String(appt.starts_at ?? "").slice(0, 10),
          );
          const time = String(
            (appt as any).appointment_time ??
              String(appt.starts_at ?? "").slice(11, 16),
          );
          replyOverride = `✅ Cita cancelada\n\nTu cita de *${service}*${
            patientName ? ` a nombre de *${patientName}*` : ""
          } para *${formatHumanDay(date)}* a las *${
            formatHourLabel(time)
          }* fue cancelada.\n\nCuando querás, puedo ayudarte a agendar otra.`;
        } else {
          replyOverride =
            "✅ Tu cita fue cancelada.\n\nSi querés, también puedo ayudarte a buscar otro horario.";
        }
        break;
      }

      case "reschedule_appointment": {
        const { data: orgData } = await supabase
          .from("org_settings")
          .select("timezone, same_day_booking_cutoff, buffer_min")
          .eq("organization_id", organizationId)
          .single();
        const orgTimezone = orgData?.timezone || "America/Tegucigalpa";
        const sameDayCutoff = String(
          orgData?.same_day_booking_cutoff ?? "15:00",
        );
        const bufferMin = Number(orgData?.buffer_min) || 10;
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const isBarbershopReschedule =
          String(payload.business_type ?? payload.orgType ?? "").trim()
            .toLowerCase() === "barbershop";
        const isDentalReschedule =
          String(payload.business_type ?? payload.orgType ?? "").trim()
              .toLowerCase() === "dental" || organizationId === "clinic-demo";
        const appointmentId = String(payload.appointment_id ?? "").trim();
        const appointmentDate = String(payload.appointment_date ?? "").trim();
        const appointmentTime = String(payload.appointment_time ?? "").trim();
        let requestedProviderId = String(payload.provider_id ?? "").trim();
        let requestedProviderName = String(payload.provider_name ?? "")
          .trim();
        if (
          isDentalReschedule && requestedProviderId &&
          !isValidUuid(requestedProviderId)
        ) {
          requestedProviderId = "";
        }
        if (isDentalReschedule) {
          requestedProviderName = formatDentalAppointmentProviderName(
            requestedProviderName || "Doctor disponible",
            payload.brand_name ?? payload.business_name ?? "",
            organizationId,
          );
        }
        const durationMin = Number(payload.duration_min) || 60;
        const startIso = buildIsoTimestamp(
          appointmentDate,
          appointmentTime,
          String(payload.starts_at ?? ""),
          orgTimezone,
        );
        const endIso = buildEndIso(
          String(payload.ends_at ?? ""),
          startIso,
          durationMin,
        );

        console.log(JSON.stringify({
          event: "appointment:reschedule_requested",
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: appointmentId || null,
          appointment_date: appointmentDate || null,
          appointment_time: appointmentTime || null,
        }));

        if (!startIso || !endIso) {
          console.error(JSON.stringify({
            event: "appointment:reschedule_failed",
            organization_id: organizationId,
            lead_id: leadId,
            error: "missing_or_invalid_datetime",
          }));
          replyOverride =
            "No pude entender la nueva fecha/hora. ¿Me la repetís, por favor?";
          break;
        }

        let apptQuery = supabase
          .from("appointments")
          .select("id, reason, title, duration_min, starts_at")
          .eq("organization_id", organizationId)
          .eq("lead_id", leadId)
          .in("status", ["pending", "confirmed"])
          .order("starts_at", { ascending: true })
          .limit(1);
        if (isBarbershopReschedule) {
          apptQuery = apptQuery.gte("starts_at", now);
        }
        if (appointmentId) {
          apptQuery = apptQuery.eq("id", appointmentId);
        }
        const activeRes = await apptQuery.maybeSingle();
        if (activeRes.error) {
          const err = formatSupabaseError(activeRes.error);
          console.error(JSON.stringify({
            event: "appointment:reschedule_failed",
            organization_id: organizationId,
            lead_id: leadId,
            error: err,
          }));
          replyOverride = "No pude reagendar la cita en este momento.";
          break;
        }
        const activeAppt = activeRes.data as Record<string, unknown> | null;
        if (!activeAppt?.id) {
          replyOverride = isBarbershopReschedule
            ? "Por ahora no veo una cita futura para reagendar. ¿Querés agendar una nueva?"
            : "No encontré una cita activa con este contacto.";
          break;
        }
        const currentStartsAt = String(activeAppt.starts_at ?? "").trim();
        if (
          currentStartsAt &&
          currentStartsAt.slice(0, 16) === startIso.slice(0, 16)
        ) {
          const currentService = toPatientFacingServiceLabel(String(
            payload.reason ?? activeAppt.reason ?? activeAppt.title ??
              "Revisión dental",
          ));
          const humanDate = formatHumanDay(
            appointmentDate || startIso.slice(0, 10),
          );
          const humanTime = formatHourLabel(
            appointmentTime || startIso.slice(11, 16),
          );
          replyOverride =
            `Esa ya es tu cita actual: ${humanDate} a las ${humanTime}.\n\n¿Querés dejarla así o buscar otro horario?`;
          statePatch = {
            stage: "BOOKED",
            lastIntent: "reschedule_appointment",
            nextExpected: "reschedule_datetime",
            pending_reschedule: null,
            collected: {
              service: currentService,
            },
          };
          break;
        }

        const overlapRes = await supabase
          .from("appointments")
          .select("id")
          .eq("organization_id", organizationId)
          .neq("status", "cancelled")
          .neq("id", String(activeAppt.id))
          .lt("starts_at", endIso)
          .gt("ends_at", startIso)
          .limit(1);
        if (overlapRes.error) {
          const err = formatSupabaseError(overlapRes.error);
          console.error(JSON.stringify({
            event: "appointment:reschedule_failed",
            organization_id: organizationId,
            lead_id: leadId,
            appointment_id: String(activeAppt.id),
            error: err,
          }));
          replyOverride = "No pude validar disponibilidad para reagendar.";
          break;
        }
        if ((overlapRes.data ?? []).length > 0) {
          const clinicHours = await loadClinicHours(supabase, organizationId);
          if (clinicHours) {
            const slots = await getAvailableSlots({
              supabase: supabase as any,
              organizationId,
              hours: clinicHours,
              daysAhead: 4,
              slotDurationMin: durationMin,
              timezone: orgTimezone,
              sameDayBookingCutoff: sameDayCutoff,
              bufferMin,
            });
            const alternatives = slots.slice(0, 2);
            if (alternatives.length > 0) {
              replyOverride = `Ese horario no está disponible. Te ofrezco ${
                alternatives.map((s) => `${s.dayLabel} a las ${s.time}`).join(
                  " o ",
                )
              }.`;
            }
          }
          if (!replyOverride) {
            replyOverride =
              "Ese horario no está disponible. ¿Querés que te proponga dos alternativas?";
          }
          console.error(JSON.stringify({
            event: "appointment:reschedule_failed",
            organization_id: organizationId,
            lead_id: leadId,
            appointment_id: String(activeAppt.id),
            error: "availability_conflict",
          }));
          break;
        }

        const providerUpdate = {
          ...(requestedProviderId ? { provider_id: requestedProviderId } : {}),
          ...(requestedProviderName
            ? { provider_name: requestedProviderName }
            : {}),
        };
        const updateRes = await supabase
          .from("appointments")
          .update({
            starts_at: startIso,
            start_at: startIso,
            ends_at: endIso,
            end_at: endIso,
            appointment_date: appointmentDate || startIso.slice(0, 10),
            appointment_time: appointmentTime || startIso.slice(11, 16),
            duration_min: durationMin,
            status: "confirmed",
            ...providerUpdate,
            updated_at: now,
          })
          .eq("id", String(activeAppt.id))
          .select("id")
          .maybeSingle();
        if (updateRes.error) {
          const err = formatSupabaseError(updateRes.error);
          console.error(JSON.stringify({
            event: "appointment:reschedule_failed",
            organization_id: organizationId,
            lead_id: leadId,
            appointment_id: String(activeAppt.id),
            error: err,
          }));
          replyOverride = "No pude reagendar la cita en este momento.";
          break;
        }

        console.log(JSON.stringify({
          event: "appointment:reschedule_success",
          ...(isBarbershopReschedule
            ? { safe_event: "reschedule_confirmed" }
            : {}),
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: String(activeAppt.id),
          starts_at: startIso,
        }));
        const service = toPatientFacingServiceLabel(String(
          payload.reason ?? activeAppt.reason ?? activeAppt.title ??
            "Revisión dental",
        ));
        if (isBarbershopReschedule) {
          const leadTarget = await loadLeadReminderTarget(supabase, leadId);
          const brandName = await loadBarbershopBrandName(
            supabase,
            organizationId,
          );
          await cancelBarbershopReminderJobs({
            supabase,
            organizationId,
            leadId,
            appointmentId: String(activeAppt.id),
            reason: "appointment_rescheduled",
          });
          await recordAppointmentEventBestEffort({
            supabase,
            organizationId,
            leadId,
            appointmentId: String(activeAppt.id),
            eventType: "appointment_rescheduled",
            payload: {
              channel: leadTarget.channel,
              service_name: service,
              provider_name: requestedProviderName || null,
              starts_at: startIso,
              appointment_date: appointmentDate || startIso.slice(0, 10),
              appointment_time: appointmentTime || startIso.slice(11, 16),
              previous_starts_at: currentStartsAt || null,
            },
          });
          await scheduleBarbershopAppointmentReminders({
            supabase,
            organizationId,
            leadId,
            appointmentId: String(activeAppt.id),
            startsAt: startIso,
            appointmentDate: appointmentDate || startIso.slice(0, 10),
            appointmentTime: appointmentTime || startIso.slice(11, 16),
            serviceName: service,
            providerName: requestedProviderName,
            customerName: leadTarget.customerName,
            channel: leadTarget.channel,
            channelUserId: leadTarget.channelUserId,
            brandName,
          });
        }
        statePatch = clearActiveBookingState({
          stage: "BOOKED",
          lastIntent: "reschedule_confirmed",
          nextExpected: undefined,
          pending_reschedule: null,
          pending_offered_slot: null,
          last_confirmed_appointment: {
            appointment_id: String(activeAppt.id),
            service,
            starts_at: startIso,
            status: "confirmed",
          },
          collected: {
            confirmed: true,
            service,
            booking: {
              completed: true,
              confirmed: true,
              awaiting_confirmation: false,
              date: appointmentDate || startIso.slice(0, 10),
              time: appointmentTime || startIso.slice(11, 16),
            },
          },
        });
        const humanDate = formatHumanDay(
          appointmentDate || startIso.slice(0, 10),
        );
        const humanTime = formatHourLabel(
          appointmentTime || startIso.slice(11, 16),
        );
        const providerLine = requestedProviderName
          ? `\n✂️ Barbero: *${requestedProviderName}*`
          : "";
        const brandName =
          String(payload.brand_name ?? payload.business_name ?? "la barbería")
            .trim() || "la barbería";
        const patientName = String(
          payload.patient_name ?? (activeAppt as any).patient_name ?? "",
        ).trim();
        replyOverride = isBarbershopReschedule
          ? `✅ Cita reagendada\n\n💈 Servicio: *${service}*\n📅 Nueva fecha: *${humanDate}*\n⏰ Nueva hora: *${humanTime}*${providerLine}\n\nTe esperamos en *${brandName}*.`
          : isDentalReschedule
          ? `✅ Cita reagendada\n\nTu cita de *${service}*${
            patientName ? ` a nombre de *${patientName}*` : ""
          } quedó para *${humanDate}* a la *${humanTime}*.\n\nTe esperamos en *${brandName}*.`
          : `✅ Tu cita fue reagendada.\n\n🦷 ${service}\n📅 ${humanDate}\n⏰ ${humanTime}`;
        break;
      }

      case "create_trial_account": {
        const email = String(action.payload?.email ?? "").trim().toLowerCase();
        const name = String(action.payload?.name ?? "").trim();
        if (!email.includes("@") || name.length < 2) {
          replyOverride =
            "Por favor, dime tu nombre y tu correo para prepararte el acceso correctamente. 😊";
          break;
        }
        await supabase.from("leads").upsert({
          organization_id: organizationId,
          email,
          full_name: name,
          status: "interested",
          updated_at: now,
        }, { onConflict: "email" });
        const result = await createTrialAccount({
          supabase: supabase as any,
          organizationId,
          leadId,
          email,
          name,
          businessType: "dental",
        });
        if (result.ok) {
          const finalUrl = `https://dental.creatyv.io/signup?email=${
            encodeURIComponent(email)
          }&name=${encodeURIComponent(name)}`;
          statePatch = {
            stage: "SIGNUP_LINK_SENT",
            collected: { email, signup_url: finalUrl },
          };
          eventType = "trial_signup_link_sent";
          replyOverride =
            `¡Excelente, ${name}! He preparado tu acceso de prueba por 14 días. Entra aquí: ${finalUrl} \n\nConfigura tu clínica en 5 minutos. 🚀`;
        }
        break;
      }
      default:
        break;
    }
  } catch (error) {
    if (action.name === "book_appointment" && !bookingResult) {
      bookingResult = {
        ok: false,
        error: `unexpected_error:${formatSupabaseError(error)}`,
      };
      console.error(JSON.stringify({
        event: "booking:insert_failed",
        operation: "upsert_exception",
        organization_id: organizationId,
        lead_id: leadId,
        error: bookingResult.error,
      }));
    }
    console.error("[actionExecutor] ERROR:", error);
  }

  if (eventType) {
    try {
      for (const table of ["pipeline_events", "demo_events"]) {
        const res = await supabase.from(table).insert({
          organization_id: organizationId,
          lead_id: leadId,
          event_type: eventType,
          payload: { action: action.name, timestamp: now },
        });
        if (!res?.error) break;
      }
    } catch (e) {
      console.warn("Error logueando evento");
    }
    return {
      statePatch,
      event: { type: eventType, payload: { action: action.name } },
      replyOverride,
      booking: bookingResult,
    };
  }
  return { statePatch, replyOverride, booking: bookingResult };
}

function buildIsoTimestamp(
  date: string,
  time: string,
  override: string,
  timezone: string,
): string | null {
  if (override && /^\d{4}-\d{2}-\d{2}T/.test(override)) return override;
  if (!date || !time) return null;
  const tzOffsets: Record<string, string> = {
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
  const offset = tzOffsets[timezone] || "-06:00";
  const m = time.trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2] ?? "0");
  if (
    !Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 ||
    mm < 0 || mm > 59
  ) {
    return null;
  }
  const timeNorm = `${String(hh).padStart(2, "0")}:${
    String(mm).padStart(2, "0")
  }`;
  const timeWithSec = `${timeNorm}:00`;
  const constructed = `${date}T${timeWithSec}${offset}`;
  const parsed = new Date(constructed);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString();
  }
  return null;
}

function buildEndIso(
  override: string,
  startIso: string | null,
  duration: number,
): string | null {
  if (override && /^\d{4}-\d{2}-\d{2}T/.test(override)) return override;
  if (!startIso) return null;
  return new Date(new Date(startIso).getTime() + duration * 60000)
    .toISOString();
}
