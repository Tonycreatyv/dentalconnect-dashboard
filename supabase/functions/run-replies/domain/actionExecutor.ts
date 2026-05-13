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
import { clearActiveBookingState } from "./bookingStateHygiene.ts";

type Json = Record<string, unknown>;
type SupabaseClientType = SupabaseClientBase<any, "public", any>;

const nowIso = () => new Date().toISOString();

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
async function getClinicContext(supabase: SupabaseClientType, organizationId: string) {
  const { data: org } = await supabase.from('org_settings').select('name, address, phone, specialties, timezone').eq('organization_id', organizationId).single();
  const { data: services } = await supabase.from('services').select('name, price, duration_min').eq('organization_id', organizationId);
  const { data: hours } = await supabase.from('business_hours').select('day_of_week, open_time, close_time, is_closed').eq('organization_id', organizationId);

  const servicesText = services?.map(s => `- ${s.name}: ${s.price} LPS (${s.duration_min} min)`).join('\n') || "No hay servicios listados.";
  const hoursText = hours?.map(h => `Día ${h.day_of_week}: ${h.is_closed ? 'Cerrado' : `${h.open_time} - ${h.close_time}`}`).join('\n') || "Horarios no configurados.";

  return `
    CLÍNICA: ${org?.name || 'DentalConnect Clinic'}
    UBICACIÓN: ${org?.address || 'No especificada'}
    TELÉFONO: ${org?.phone || 'No especificado'}
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
    message: typeof err.message === "string"
      ? err.message
      : String(error),
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

function toPatientFacingServiceLabel(service: string): string {
  const normalized = safeServiceText(service);
  if (normalized.includes("ortodoncia") || normalized.includes("bracket") || normalized.includes("frenillo")) {
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
        const sameDayCutoff = String(orgData?.same_day_booking_cutoff ?? "15:00");
        const bufferMin = Number(orgData?.buffer_min) || 10;

        const payload: Record<string, unknown> = action.payload ?? {};
        const appointmentDate = String(payload.appointment_date ?? "").trim();
        const appointmentTime = String(payload.appointment_time ?? "").trim();
        const patientName = String(payload.patient_name ?? "").trim();
        const service = String(payload.service ?? payload.reason ?? "Consulta General").trim();
        const preferredBarber = String(payload.preferred_barber ?? payload.provider_name ?? "").trim();
        const payloadProviderId = String(payload.provider_id ?? "").trim();
        
        const startIso = buildIsoTimestamp(appointmentDate, appointmentTime, String(payload.starts_at ?? ""), orgTimezone);
        const durationMin = Number(payload.duration_min) ||
          resolveServiceDurationMin(service, 60);
        const endIso = buildEndIso(String(payload.ends_at ?? ""), startIso, durationMin);
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
          duration_min: durationMin,
          provider_id: payloadProviderId || null,
          provider_name: preferredBarber || null,
          metadata: {
            ...(typeof payload.metadata === "object" && payload.metadata
              ? (payload.metadata as Record<string, unknown>)
              : {}),
            ...(preferredBarber ? { preferred_barber: preferredBarber } : {}),
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
            status: appointmentFields.status ?? null,
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
          bookingResult = { ok: false, error: `lookup_failed:${formatSupabaseError(existingApptRes.error)}` };
          console.error(JSON.stringify({
            event: "booking:insert_failed",
            operation: "lookup_active",
            organization_id: organizationId,
            lead_id: leadId,
            error: bookingResult.error,
          }));
          break;
        }
        const existingAppt = existingApptRes.data;

        // Hard guard: block duplicate exact appointment for the same lead and warn on same-day active appointment.
        const futureLeadAppointmentsRes = await supabase
          .from("appointments")
          .select("id, reason, title, appointment_date, appointment_time, starts_at, status")
          .eq("organization_id", organizationId)
          .eq("lead_id", leadId)
          .in("status", ["pending", "confirmed"])
          .gte("appointment_date", formatDateInTimezoneIso(new Date(), orgTimezone))
          .order("appointment_date", { ascending: true })
          .order("appointment_time", { ascending: true })
          .limit(25);
        if (futureLeadAppointmentsRes.error) {
          bookingResult = { ok: false, error: `lead_appointments_lookup_failed:${formatSupabaseError(futureLeadAppointmentsRes.error)}` };
          break;
        }
        const futureLeadAppointments = Array.isArray(futureLeadAppointmentsRes.data)
          ? futureLeadAppointmentsRes.data
          : [];
        const normalizeService = (value: string) =>
          value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        const requestedServiceNormalized = normalizeService(service);
        const exactDuplicate = futureLeadAppointments.find((appt: any) => {
          const apptDate = String(appt.appointment_date ?? String(appt.starts_at ?? "").slice(0, 10)).trim();
          const apptTime = String(appt.appointment_time ?? String(appt.starts_at ?? "").slice(11, 16)).trim();
          const apptService = normalizeService(String(appt.reason ?? appt.title ?? ""));
          return apptDate === appointmentDate && apptTime === appointmentTime && apptService === requestedServiceNormalized;
        });
        if (exactDuplicate) {
          bookingResult = { ok: false, error: "duplicate_appointment_exact" };
          replyOverride = `Ya tenés esa misma cita: ${formatHumanDay(appointmentDate)} a las ${formatHourLabel(appointmentTime)} para ${service}. ¿Querés reagendarla, cancelarla o agendar otra para otra persona?`;
          break;
        }
        const sameDayActive = futureLeadAppointments.find((appt: any) => {
          const apptDate = String(appt.appointment_date ?? String(appt.starts_at ?? "").slice(0, 10)).trim();
          return apptDate === appointmentDate;
        });
        if (sameDayActive) {
          bookingResult = { ok: false, error: "existing_active_appointment_same_day" };
          replyOverride = "Ya tenés una cita activa ese día. ¿Querés otra cita adicional o preferís cambiar la que ya tenés?";
          break;
        }

        // Global overlap check for organization, ignoring cancelled appointments.
        let overlapQuery = supabase
          .from("appointments")
          .select("id, starts_at, ends_at, appointment_date, appointment_time, status")
          .eq("organization_id", organizationId)
          .neq("status", "cancelled")
          .lt("starts_at", endIso)
          .gt("ends_at", startIso)
          .limit(1);
        if (existingAppt?.id) {
          overlapQuery = overlapQuery.neq("id", existingAppt.id);
        }
        const overlapRes = await overlapQuery;
        if (overlapRes.error) {
          bookingResult = { ok: false, error: `availability_lookup_failed:${formatSupabaseError(overlapRes.error)}` };
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
              replyOverride =
                `Ese horario ya no está disponible. Te ofrezco ${alternatives.map((s) => `${s.dayLabel} a las ${s.time}`).join(" o ")}.`;
            }
          }
          bookingResult = { ok: false, error: "availability_conflict" };
          if (!replyOverride) {
            replyOverride = "Ese horario ya no está disponible. ¿Quieres que te proponga dos horarios alternativos?";
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

        // Provider selection (non-blocking): choose eligible doctor for requested service/day.
        if (appointmentDate && appointmentTime && startIso) {
          const [reqH, reqM] = appointmentTime.split(":").map(Number);
          const reqMins = reqH * 60 + (reqM || 0);
          const days = ["sun","mon","tue","wed","thu","fri","sat"];
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
            return svcs.some((s: string) => s.toLowerCase() === service.toLowerCase()) && sched && !sched.closed;
          });

          if (eligibleDocs.length > 0) {
            const preferredProvider = String(payload.provider_name ?? payload.preferred_barber ?? "").trim();
            const assignedDoc =
              eligibleDocs.find((d: any) => String(d.name ?? "") === preferredProvider)?.name ??
              (eligibleDocs[0] as any).name;
            appointmentFields.provider_name = assignedDoc;
            appointmentFields.metadata = {
              ...(typeof appointmentFields.metadata === "object" && appointmentFields.metadata
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
            const normalize = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
            const wanted = normalize(String(appointmentFields.provider_name));
            const matched = barbersRes.data.find((b: any) => normalize(String(b?.name ?? "")) === wanted);
            if (matched?.id) {
              appointmentFields.provider_id = String(matched.id);
            }
          }
        }
        let appointmentRow: AppointmentInsertRecord | null = null;
        if (existingAppt?.id) {
          const updateRes = await supabase.from("appointments").update(appointmentFields).eq("id", existingAppt.id).select(
            APPOINTMENT_SELECT_FIELDS,
          ).single();
          if (updateRes.error) {
            bookingResult = { ok: false, error: `update_failed:${formatSupabaseError(updateRes.error)}` };
            console.error(JSON.stringify({
              event: "booking:insert_failed",
              operation: "update_active",
              organization_id: organizationId,
              lead_id: leadId,
              error: bookingResult.error,
            }));
            break;
          }
          appointmentRow = (updateRes.data ?? null) as AppointmentInsertRecord | null;
        } else {
          const insertRes = await supabase.from("appointments").insert({ ...appointmentFields, created_at: now }).select(
            APPOINTMENT_SELECT_FIELDS,
          ).single();
          if (insertRes.error) {
            bookingResult = { ok: false, error: `insert_failed:${formatSupabaseError(insertRes.error)}` };
            console.error(JSON.stringify({
              event: "booking:insert_failed",
              operation: "insert_new",
              organization_id: organizationId,
              lead_id: leadId,
              error: bookingResult.error,
            }));
            break;
          }
          appointmentRow = (insertRes.data ?? null) as AppointmentInsertRecord | null;
        }

        if (!appointmentRow?.id) {
          bookingResult = { ok: false, error: "insert_failed:no_appointment_id" };
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

        if (appointmentRow.id) {
          await syncCalendarEvent({
            organization_id: organizationId,
            title: appointmentFields.title,
            starts_at: startIso,
            ends_at: endIso || startIso,
            patient_name: patientName,
            metadata: { source: "groq_ai_bot", appointment_id: appointmentRow.id }
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
            service: appointmentRow.reason ?? appointmentRow.title ?? "Revisión dental",
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
        const appointmentForRelation = String(payload.appointment_for_relation ?? "").trim() || null;
        bookingResult = {
          ok: true,
          appointment: {
            ...appointmentRow,
            appointment_for_relation: appointmentForRelation,
            preferred_barber: preferredBarber || null,
          } as unknown as AppointmentInsertRecord,
        };

        try {
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
          replyOverride = "No pude cancelar la cita en este momento. Intentemos de nuevo.";
          break;
        }
        const appt = apptRes.data as AppointmentInsertRecord | null;
        if (!appt?.id) {
          replyOverride =
            "No encontré una cita activa a tu nombre.\n\nSi querés, puedo ayudarte a revisar horarios disponibles para agendar una.";
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
          replyOverride = "No pude cancelar la cita en este momento. Intentemos de nuevo.";
          break;
        }

        console.log(JSON.stringify({
          event: "appointment:cancel_success",
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: appt.id,
        }));
        statePatch = clearActiveBookingState({
          stage: "DISCOVERY",
          lastIntent: "cancel_appointment",
          nextExpected: undefined,
          pending_cancel: null,
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
        replyOverride = "✅ Tu cita fue cancelada.\n\nSi querés, también puedo ayudarte a buscar otro horario.";
        break;
      }

      case "reschedule_appointment": {
        const { data: orgData } = await supabase
          .from("org_settings")
          .select("timezone, same_day_booking_cutoff, buffer_min")
          .eq("organization_id", organizationId)
          .single();
        const orgTimezone = orgData?.timezone || "America/Tegucigalpa";
        const sameDayCutoff = String(orgData?.same_day_booking_cutoff ?? "15:00");
        const bufferMin = Number(orgData?.buffer_min) || 10;
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const appointmentId = String(payload.appointment_id ?? "").trim();
        const appointmentDate = String(payload.appointment_date ?? "").trim();
        const appointmentTime = String(payload.appointment_time ?? "").trim();
        const durationMin = Number(payload.duration_min) || 60;
        const startIso = buildIsoTimestamp(
          appointmentDate,
          appointmentTime,
          String(payload.starts_at ?? ""),
          orgTimezone,
        );
        const endIso = buildEndIso(String(payload.ends_at ?? ""), startIso, durationMin);

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
          replyOverride = "No pude entender la nueva fecha/hora. ¿Me la repetís, por favor?";
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
          replyOverride = "No encontré una cita activa con este contacto.";
          break;
        }
        const currentStartsAt = String(activeAppt.starts_at ?? "").trim();
        if (currentStartsAt && currentStartsAt.slice(0, 16) === startIso.slice(0, 16)) {
          const currentService = toPatientFacingServiceLabel(String(
            payload.reason ?? activeAppt.reason ?? activeAppt.title ?? "Revisión dental",
          ));
          const humanDate = formatHumanDay(appointmentDate || startIso.slice(0, 10));
          const humanTime = formatHourLabel(appointmentTime || startIso.slice(11, 16));
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
              replyOverride =
                `Ese horario no está disponible. Te ofrezco ${alternatives.map((s) => `${s.dayLabel} a las ${s.time}`).join(" o ")}.`;
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
          organization_id: organizationId,
          lead_id: leadId,
          appointment_id: String(activeAppt.id),
          starts_at: startIso,
        }));
        const service = toPatientFacingServiceLabel(String(
          payload.reason ?? activeAppt.reason ?? activeAppt.title ?? "Revisión dental",
        ));
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
        const humanDate = formatHumanDay(appointmentDate || startIso.slice(0, 10));
        const humanTime = formatHourLabel(appointmentTime || startIso.slice(11, 16));
        replyOverride = `✅ Tu cita fue reagendada.\n\n🦷 ${service}\n📅 ${humanDate}\n⏰ ${humanTime}`;
        break;
      }

      case "create_trial_account": {
        const email = String(action.payload?.email ?? "").trim().toLowerCase();
        const name = String(action.payload?.name ?? "").trim();
        if (!email.includes("@") || name.length < 2) {
          replyOverride = "Por favor, dime tu nombre y tu correo para prepararte el acceso correctamente. 😊";
          break;
        }
        await supabase.from("leads").upsert({ organization_id: organizationId, email, full_name: name, status: "interested", updated_at: now }, { onConflict: "email" });
        const result = await createTrialAccount({ supabase: supabase as any, organizationId, leadId, email, name, businessType: "dental" });
        if (result.ok) {
          const finalUrl = `https://dental.creatyv.io/signup?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`;
          statePatch = { stage: "SIGNUP_LINK_SENT", collected: { email, signup_url: finalUrl } };
          eventType = "trial_signup_link_sent";
          replyOverride = `¡Excelente, ${name}! He preparado tu acceso de prueba por 14 días. Entra aquí: ${finalUrl} \n\nConfigura tu clínica en 5 minutos. 🚀`;
        }
        break;
      }
      default: break;
    }
  } catch (error) {
    if (action.name === "book_appointment" && !bookingResult) {
      bookingResult = { ok: false, error: `unexpected_error:${formatSupabaseError(error)}` };
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
      await supabase.from("lead_events").insert({ organization_id: organizationId, lead_id: leadId, event_type: eventType, payload: { action: action.name, timestamp: now } });
    } catch (e) { console.warn("Error logueando evento"); }
    return { statePatch, event: { type: eventType, payload: { action: action.name } }, replyOverride, booking: bookingResult };
  }
  return { statePatch, replyOverride, booking: bookingResult };
}

function buildIsoTimestamp(date: string, time: string, override: string, timezone: string): string | null {
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
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  const timeNorm = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const timeWithSec = `${timeNorm}:00`;
  const constructed = `${date}T${timeWithSec}${offset}`;
  const parsed = new Date(constructed);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString();
  }
  return null;
}

function buildEndIso(override: string, startIso: string | null, duration: number): string | null {
  if (override && /^\d{4}-\d{2}-\d{2}T/.test(override)) return override;
  if (!startIso) return null;
  return new Date(new Date(startIso).getTime() + duration * 60000).toISOString();
}
