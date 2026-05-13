// =============================================================================
// RUN-REPLIES - Worker principal de respuestas automáticas
// Production-grade version: terminal state discipline, anti-storm, idempotency
// =============================================================================

import {
  createClient,
  type SupabaseClient as SupabaseClientBase,
} from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {
  maybeHandleNameCapture,
  runConversationEngine,
} from "./conversationEngine.ts";
import {
  executeToolAction,
  type BookingActionResult,
  type ToolActionName,
} from "./domain/actionExecutor.ts";
import { runLlmTurn } from "./domain/llmTurn.ts";
import { classifyDentalDeterministic } from "./domain/dental/dentalDeterministicClassifier.ts";
import type { DentalInterpreterResult } from "./domain/interpreter/dentalInterpreterTypes.ts";
import {
  interpretBarbershopTurn,
  type BarbershopInterpretedTurn,
} from "./domain/barbershopInterpreter.ts";
import { shouldCheckDbActiveAppointmentBeforeBooking } from "./domain/activeAppointmentGuard.ts";
import {
  type ClassifiedIntent,
  classifyMessage,
} from "./domain/llmClassifier.ts";
import { detectIntent } from "./domain/intents.ts";
import {
  checkExactSlotAvailability,
  formatSlotsMessage,
  getAvailableSlots,
  selectPatientFriendlySlots,
} from "./domain/availability.ts";
import {
  checkSlotAvailability,
  getAvailableSlotsForDay,
  getAvailabilityDiagnosticsForDay,
  suggestNextAvailableSlots,
} from "./domain/availabilityCore.ts";
import {
  mergeDentalServiceTemplates,
  toPatientFacingServiceLabel,
} from "./domain/serviceInfoHandler.ts";
import { clearActiveBookingState } from "./domain/bookingStateHygiene.ts";
import {
  buildServiceReplyFromKb,
  extractRpcRow,
  isFaqQuestion,
  isPriceQuestion as isKbPriceQuestion,
} from "./domain/kbResolver.ts";
import { formatBookingSuccessCopy } from "./domain/bookingSuccessCopy.ts";
import { normalizeLeadStateForBusinessType } from "./domain/stateNormalization.ts";
import {
  sendViaMetaAdapter,
  type InteractiveButton,
} from "../_shared/metaMessageAdapter.ts";

// =============================================================================
// TYPES
// =============================================================================

type Json = Record<string, unknown>;
type SupabaseClientType = SupabaseClientBase<any, "public", any>;

interface RecentMessage {
  role: "user" | "assistant";
  actor?: "user" | "bot" | "staff" | "operator";
  content: string;
  timestamp: string;
}

interface JobResult {
  status: "sent" | "failed" | "queued" | "dead";
  sentAt?: string | null;
  lastError?: string | null;
  outboundMessageId?: string | null;
  outboundProviderMessageId?: string | null;
}

interface GenerateReplyArgs {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  leadState: Json | null;
  inboundText: string;
  orgSettings: any;
  recentMessages: RecentMessage[];
  productKnowledge: Record<string, unknown>;
  clinicKnowledge: Record<string, unknown>;
  clinicSettings: Record<string, unknown>;
  llmEnabled: boolean;
  isOperatorOutbound: boolean;
  manualText: string;
  executionId: string;
  traceId: string;
  jobId: string;
}

interface GenerateReplyResult {
  reply: string;
  statePatch: Json;
  leadPatch?: Json;
  debugNote: string;
  bookingSuccessAuthorized?: boolean;
}

interface ProcessJobDeps {
  supabase: SupabaseClientType;
  metaGraphVersion: string;
  pageAccessToken: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  organizationId: string;
  executionId: string;
  workerId: string;
  productKnowledge: Record<string, unknown>;
  clinicKnowledge: Record<string, unknown>;
  clinicSettings: Record<string, unknown>;
  orgSettings: any;
  llmEnabled: boolean;
}

// =============================================================================
// CORS / RESPONSE
// =============================================================================

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, x-run-replies-secret",
};

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// =============================================================================
// UTILS
// =============================================================================

function env(name: string, fallback?: string) {
  const v = Deno.env.get(name) ?? fallback;
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function safeStr(x: any, d = ""): string {
  if (typeof x === "string") return x;
  if (x == null) return d;
  return String(x);
}

function isDentalOrganization(organizationId: string): boolean {
  const id = safeStr(organizationId, "").toLowerCase();
  return id.includes("dental") || id.includes("clinic");
}

function isEnabledFlag(value: unknown): boolean {
  const text = safeStr(value, "").trim().toLowerCase();
  if (!text) return false;
  return text === "true" || text === "1" || text === "yes" || text === "on";
}

function nowIso() {
  return new Date().toISOString();
}

function clampText(s: string, max = 900) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function normalizeChannel(ch: string) {
  const c = (ch ?? "").toLowerCase();
  if (c.includes("messenger")) return "messenger";
  if (c.includes("instagram")) return "instagram";
  if (c.includes("whatsapp")) return "whatsapp";
  return c || "messenger";
}

function normalizeSecretValue(raw: string) {
  const v = safeStr(raw, "").trim();
  if (!v) return "";
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function parseMetaStatus(errorMessage: string) {
  const m = safeStr(errorMessage, "").match(/meta_error:(\d{3}):/i) ||
    safeStr(errorMessage, "").match(/Meta error:\s*(\d{3})/i);
  if (m?.[1]) return Number(m[1]);
  const m2 = safeStr(errorMessage, "").match(/meta_send_failed:(\d{3}):/i);
  return m2?.[1] ? Number(m2[1]) : null;
}

function backoffSeconds(attemptCount: number) {
  const n = Math.max(1, Number(attemptCount) || 1);
  if (n <= 1) return 60;
  if (n === 2) return 5 * 60;
  if (n === 3) return 15 * 60;
  return 60 * 60;
}

function plusSecondsIso(seconds: number) {
  return new Date(Date.now() + Math.max(0, seconds) * 1000).toISOString();
}

function isOperatorOutboundJob(job: any) {
  const source = safeStr(job?.payload?.source, "").toLowerCase();
  const actor = safeStr(job?.actor, "").toLowerCase();
  const role = safeStr(job?.role, "").toLowerCase();
  return (
    source.includes("operator") ||
    source.includes("manual") ||
    source.includes("ui_manual") ||
    actor === "human" ||
    role === "operator"
  );
}

function logEvent(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: nowIso(), event, ...data }));
}

const BOOKING_SUCCESS_REPLY =
  "✅ Listo, tu cita quedó agendada.\n\nTe enviaremos un recordatorio antes de tu cita.";
const BOOKING_FAILURE_REPLY =
  "Estoy teniendo un problema para guardar la cita en este momento. Te puedo ayudar a intentarlo de nuevo o pasar tu solicitud a recepción.";
const DEFAULT_TIMEZONE = "America/Tegucigalpa";
const DEFAULT_SAME_DAY_BOOKING_CUTOFF = "15:00";
const DEFAULT_BUFFER_MIN = 10;
const DEFAULT_STALE_OUTBOX_SECONDS = 120;
const DEFAULT_BOOKING_RECOVERY_DELAY_MIN = 20;
const ENABLE_BOOKING_RECOVERY_FOLLOWUP = false;

function normalizeTextForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function loadActiveAppointmentForLead(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
}): Promise<Record<string, unknown> | null> {
  const res = await args.supabase
    .from("appointments")
    .select("id, reason, title, patient_name, appointment_date, appointment_time, starts_at, status")
    .eq("organization_id", args.organizationId)
    .eq("lead_id", args.leadId)
    .in("status", ["pending", "confirmed"])
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (res.error || !res.data?.id) return null;
  return res.data as Record<string, unknown>;
}

async function loadFutureActiveAppointmentsForLead(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  timezone?: string;
}): Promise<Array<Record<string, unknown>>> {
  const timezone = safeStr(args.timezone, DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const todayInTimezone = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const res = await args.supabase
    .from("appointments")
    .select("id, reason, title, patient_name, appointment_date, appointment_time, starts_at, status, provider_id, provider_name")
    .eq("organization_id", args.organizationId)
    .eq("lead_id", args.leadId)
    .in("status", ["pending", "confirmed"])
    .gte("appointment_date", todayInTimezone)
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true })
    .limit(25);
  if (res.error || !Array.isArray(res.data)) return [];
  return res.data as Array<Record<string, unknown>>;
}

function shouldRunBarbershopPreconfirmGate(args: {
  reply: string;
  statePatch: Json;
}): boolean {
  const { reply, statePatch } = args;
  const replyNorm = normalizeTextForMatch(reply);
  const stage = safeStr((statePatch as any)?.stage, "");
  const nextExpected = safeStr((statePatch as any)?.nextExpected, "");
  const collected = (((statePatch as any)?.collected ?? {}) as Record<string, unknown>);
  const pending = ((collected.pending_booking ?? null) as Record<string, unknown> | null);
  return (
    nextExpected === "confirm_booking" ||
    stage === "CONFIRMING" ||
    Boolean(pending) ||
    replyNorm.includes("esta disponible") ||
    replyNorm.includes("confirmamos")
  );
}

function extractRequestedPreconfirmData(statePatch: Json): {
  service: string;
  appointmentDate: string;
  appointmentTime: string;
  providerId: string;
  providerName: string;
} {
  const collected = (((statePatch as any)?.collected ?? {}) as Record<string, unknown>);
  const pending = ((collected.pending_booking ?? null) as Record<string, unknown> | null) ?? {};
  const service = safeStr(
    pending.service,
    safeStr(collected.service, safeStr(pending.reason, safeStr(collected.reason, ""))),
  );
  const appointmentDate = safeStr(
    pending.appointment_date,
    safeStr(collected.preferred_date, safeStr(collected.appointment_date, "")),
  );
  const appointmentTime = safeStr(
    pending.appointment_time,
    safeStr(collected.preferred_time, safeStr(collected.appointment_time, "")),
  );
  const providerId = safeStr(pending.provider_id, safeStr(collected.provider_id, ""));
  const providerName = safeStr(
    pending.provider_name,
    safeStr(pending.preferred_barber, safeStr(collected.provider_name, safeStr(collected.preferred_barber, ""))),
  );
  return { service, appointmentDate, appointmentTime, providerId, providerName };
}

async function validateBarbershopPreconfirm(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  timezone: string;
  reply: string;
  statePatch: Json;
}): Promise<{ reply: string; statePatch: Json; blocked: boolean }> {
  const { supabase, organizationId, leadId, timezone } = args;
  const inputReply = args.reply;
  const inputStatePatch = args.statePatch;
  if (!shouldRunBarbershopPreconfirmGate({ reply: inputReply, statePatch: inputStatePatch })) {
    return { reply: inputReply, statePatch: inputStatePatch, blocked: false };
  }

  const requested = extractRequestedPreconfirmData(inputStatePatch);
  if (!requested.appointmentDate || !requested.appointmentTime || !requested.service) {
    return { reply: inputReply, statePatch: inputStatePatch, blocked: false };
  }
  const inputCollected = (((inputStatePatch as any)?.collected ?? {}) as Record<string, unknown>);
  const allowAdditionalBooking = Boolean(inputCollected.allow_additional_booking);
  const requestedPatientName = toDisplayPersonName(safeStr(inputCollected.patient_name, ""));

  const activeAppointments = await loadFutureActiveAppointmentsForLead({
    supabase,
    organizationId,
    leadId,
    timezone,
  });
  const requestedServiceNorm = normalizeTextForMatch(toPatientFacingServiceLabel(requested.service));
  const exactDuplicate = activeAppointments.find((appt) => {
    const apptDate = safeStr(appt.appointment_date, safeStr(appt.starts_at, "").slice(0, 10));
    const apptTime = safeStr(appt.appointment_time, safeStr(appt.starts_at, "").slice(11, 16));
    const apptService = normalizeTextForMatch(
      toPatientFacingServiceLabel(safeStr(appt.reason, safeStr(appt.title, ""))),
    );
    const appointmentPatientName = toDisplayPersonName(safeStr(appt.patient_name, ""));
    const hasDifferentPatient = Boolean(
      allowAdditionalBooking &&
      requestedPatientName &&
      appointmentPatientName &&
      requestedPatientName.toLowerCase() !== appointmentPatientName.toLowerCase(),
    );
    if (hasDifferentPatient) return false;
    return apptDate === requested.appointmentDate &&
      apptTime === requested.appointmentTime &&
      apptService === requestedServiceNorm;
  });
  const sameDayActive = allowAdditionalBooking ? undefined : activeAppointments.find((appt) => {
    const apptDate = safeStr(appt.appointment_date, safeStr(appt.starts_at, "").slice(0, 10));
    return apptDate === requested.appointmentDate;
  });

  logEvent("barbershop:preconfirm_gate", {
    organization_id: organizationId,
    lead_id: leadId,
    requested_date: requested.appointmentDate,
    requested_time: requested.appointmentTime,
    requested_service: requested.service,
    active_appointments_count: activeAppointments.length,
    exact_duplicate_found: Boolean(exactDuplicate),
    same_day_active_found: Boolean(sameDayActive),
    source: "central_gate",
  });

  const baseCollected = inputCollected;
  if (exactDuplicate) {
    const duplicateService = toPatientFacingServiceLabel(
      safeStr(exactDuplicate.reason, safeStr(exactDuplicate.title, requested.service)),
    );
    const duplicateDate = safeStr(
      exactDuplicate.appointment_date,
      safeStr(exactDuplicate.starts_at, "").slice(0, 10),
    ) || requested.appointmentDate;
    const duplicateTime = safeStr(
      exactDuplicate.appointment_time,
      safeStr(exactDuplicate.starts_at, "").slice(11, 16),
    ) || requested.appointmentTime;
    return {
      reply:
        `Ya tenés esa misma cita: ${formatRequestedDayLabel(duplicateDate)} a las ${formatHourLabel(duplicateTime)} para ${duplicateService}. ¿Querés reagendarla, cancelarla o agendar otra para otra persona?`,
      statePatch: mergeStatePatches(inputStatePatch, {
        stage: "BOOKING",
        nextExpected: "active_appointment_intent_choice",
        collected: {
          ...baseCollected,
          active_appointment: {
            id: safeStr(exactDuplicate.id, ""),
            reason: duplicateService,
            appointment_date: duplicateDate,
            appointment_time: duplicateTime,
            starts_at: safeStr(exactDuplicate.starts_at, `${duplicateDate}T${duplicateTime}:00`),
            status: safeStr(exactDuplicate.status, "confirmed"),
            provider_id: safeStr(exactDuplicate.provider_id, "") || null,
            provider_name: safeStr(exactDuplicate.provider_name, "") || null,
          },
          pending_booking: null,
          pending_booking_stale: true,
        },
      }),
      blocked: true,
    };
  }

  if (sameDayActive) {
    const activeDate = safeStr(
      sameDayActive.appointment_date,
      safeStr(sameDayActive.starts_at, "").slice(0, 10),
    ) || requested.appointmentDate;
    const activeService = toPatientFacingServiceLabel(
      safeStr(sameDayActive.reason, safeStr(sameDayActive.title, requested.service)),
    );
    const activeTime = safeStr(
      sameDayActive.appointment_time,
      safeStr(sameDayActive.starts_at, "").slice(11, 16),
    ) || requested.appointmentTime;
    return {
      reply:
        `Ya tenés una cita activa ese día a las ${formatHourLabel(activeTime)}. ¿Querés agendar otra adicional o preferís cambiar la que ya tenés?`,
      statePatch: mergeStatePatches(inputStatePatch, {
        stage: "BOOKING",
        nextExpected: "active_appointment_intent_choice",
        collected: {
          ...baseCollected,
          active_appointment: {
            id: safeStr(sameDayActive.id, ""),
            reason: activeService,
            appointment_date: activeDate,
            appointment_time: activeTime,
            starts_at: safeStr(sameDayActive.starts_at, `${activeDate}T${activeTime}:00`),
            status: safeStr(sameDayActive.status, "confirmed"),
            provider_id: safeStr(sameDayActive.provider_id, "") || null,
            provider_name: safeStr(sameDayActive.provider_name, "") || null,
          },
          pending_booking: null,
          pending_booking_stale: true,
        },
      }),
      blocked: true,
    };
  }

  return { reply: inputReply, statePatch: inputStatePatch, blocked: false };
}

function hasBookingSuccessClaim(value: string): boolean {
  const t = normalizeTextForMatch(value);
  return (
    t.includes("tu cita ha sido agendada") ||
    t.includes("he agendado tu cita") ||
    t.includes("cita agendada")
  );
}

function isSevereEmergencyText(value: string): boolean {
  const t = normalizeTextForMatch(value);
  const severePatterns = [
    "no puedo respirar",
    "sangrado que no para",
    "accidente fuerte",
    "hinchazon en garganta",
    "muchisima sangre",
  ];
  return severePatterns.some((p) => t.includes(p));
}

function parseTimeToMinutes(value: string, fallback: number): number {
  const m = safeStr(value, "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return fallback;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return hh * 60 + mm;
}

function nowInTimezone(timezone: string): Date {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
  return Number.isNaN(d.valueOf()) ? new Date() : d;
}

function sameDayBookingAllowed(clinicSettings: Record<string, unknown>): boolean {
  const timezone = safeStr(clinicSettings.timezone, DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const cutoff = safeStr(
    clinicSettings.same_day_booking_cutoff,
    DEFAULT_SAME_DAY_BOOKING_CUTOFF,
  ).trim() || DEFAULT_SAME_DAY_BOOKING_CUTOFF;
  const localNow = nowInTimezone(timezone);
  const nowMin = localNow.getHours() * 60 + localNow.getMinutes();
  const cutoffMin = parseTimeToMinutes(cutoff, 15 * 60);
  return nowMin < cutoffMin;
}

function isLocalToday(dateIso: string, timezone: string): boolean {
  if (!dateIso) return false;
  const today = nowInTimezone(timezone).toISOString().slice(0, 10);
  return dateIso === today;
}

function isBookingInProgress(statePatch: Json): boolean {
  const stage = safeStr((statePatch as any)?.stage, "");
  const nextExpected = safeStr((statePatch as any)?.nextExpected, "");
  return (
    stage === "BOOKING" &&
    [
      "service",
      "date_time",
      "confirm_booking",
      "confirm_booking_suggestion",
    ].includes(nextExpected)
  );
}

function resolveClinicSchedulingConfig(
  clinicSettings: Record<string, unknown>,
) {
  return {
    timezone: safeStr(clinicSettings.timezone, DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE,
    sameDayBookingCutoff: safeStr(
      clinicSettings.same_day_booking_cutoff,
      DEFAULT_SAME_DAY_BOOKING_CUTOFF,
    ).trim() || DEFAULT_SAME_DAY_BOOKING_CUTOFF,
    bufferMin: Math.max(0, Number(clinicSettings.buffer_min) || DEFAULT_BUFFER_MIN),
  };
}

function pickNearestAlternatives(
  slots: Array<{ date: string; time: string; dayLabel: string }>,
  requestedDate: string,
  requestedTime: string,
): Array<{ date: string; time: string; dayLabel: string }> {
  if (!slots.length) return [];
  const requestedMin = parseTimeToMinutes(requestedTime, 0);
  const sameDay = slots
    .filter((s) => s.date === requestedDate)
    .sort((a, b) =>
      Math.abs(parseTimeToMinutes(a.time, 0) - requestedMin) -
      Math.abs(parseTimeToMinutes(b.time, 0) - requestedMin)
    );
  if (sameDay.length >= 2) return sameDay.slice(0, 2);
  const nextDay = [...slots]
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return Math.abs(parseTimeToMinutes(a.time, 0) - requestedMin) -
        Math.abs(parseTimeToMinutes(b.time, 0) - requestedMin);
    });
  return nextDay.slice(0, 2);
}

function formatHourLabel(time24: string): string {
  const [hRaw, mRaw] = time24.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time24;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatRequestedDayLabel(dateIso: string): string {
  if (!dateIso) return "ese día";
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.valueOf())) return dateIso;
  return d.toLocaleDateString("es-HN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).toLowerCase();
}

function formatAppointmentStatus(statusRaw: string): "confirmada" | "pendiente" {
  const status = safeStr(statusRaw, "").toLowerCase();
  return status === "pending" ? "pendiente" : "confirmada";
}

function toDisplayPersonName(rawName: string): string {
  const name = safeStr(rawName, "").trim();
  if (!name) return "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function toLongDayLabel(dayLabel: string): string {
  return dayLabel
    .replace("Lun", "Lunes")
    .replace("Mar", "Martes")
    .replace("Mié", "Miércoles")
    .replace("Jue", "Jueves")
    .replace("Vie", "Viernes")
    .replace("Sáb", "Sábado")
    .replace("Dom", "Domingo");
}

function formatBookingSuccessReply(
  booking?: BookingActionResult,
  businessType?: string,
  preferredBarberFallback?: string,
): string {
  return formatBookingSuccessCopy({
    booking: booking ?? null,
    fallback: BOOKING_SUCCESS_REPLY,
    businessType,
    preferredBarberFallback,
  });
}

function inferBotMessageType(reply: string, statePatch: Json): string {
  const explicit = safeStr((statePatch as any)?.last_bot_message_type, "").trim();
  if (explicit) return explicit;
  const nextExpected = safeStr((statePatch as any)?.nextExpected, "");
  if (nextExpected === "confirm_booking") return "confirm_booking_prompt";
  if (nextExpected === "date_time") return "ask_date_time";
  if (reply.includes("¿")) return "question";
  return "info";
}

function shouldSkipGenericContinuationSuffix(reply: string, statePatch?: Json | null): boolean {
  const normalized = normalizeTextForMatch(reply);
  const nextExpected = safeStr((statePatch as any)?.nextExpected, "");
  if (
    normalized.includes("ya tenes esa misma cita") ||
    normalized.includes("ya tenes una cita activa ese dia")
  ) {
    return true;
  }
  if (
    nextExpected === "confirm_cancel_appointment" ||
    nextExpected === "confirm_reschedule_appointment" ||
    nextExpected === "active_appointment_intent_choice"
  ) {
    return true;
  }
  if (
    normalized.includes("tenes una cita") ||
    normalized.includes("no encontre una cita activa a tu nombre") ||
    normalized.includes("queres cancelarla") ||
    normalized.includes("queres reagendarla") ||
    normalized.includes("queres revisarla, cambiarla o cancelarla")
  ) {
    return true;
  }
  return false;
}

function preventRepeatedReplyLoop(reply: string, leadState: Json | null, statePatch?: Json | null): string {
  const prev = safeStr((leadState as any)?.last_bot_text, "").trim();
  if (!prev) return reply;
  if (prev !== reply.trim()) return reply;
  if (shouldSkipGenericContinuationSuffix(reply, statePatch)) return reply;
  return `${reply}\n\nSi querés, te ayudo a continuar con tu cita.`;
}

/**
 * Capitaliza cada palabra: "juan perez" → "Juan Perez"
 * Reutilizado en name capture (LLM, mucho-gusto, name gate).
 */
function capitalizeName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// =============================================================================
// STATE HELPERS
// =============================================================================

function mergeCollectedStates(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  const baseBooking = base.booking && typeof base.booking === "object"
    ? { ...(base.booking as Record<string, unknown>) }
    : {};
  const patchBooking = patch.booking && typeof patch.booking === "object"
    ? { ...(patch.booking as Record<string, unknown>) }
    : {};
  return {
    ...base,
    ...patch,
    booking: { ...baseBooking, ...patchBooking },
  };
}

export function mergeLeadState(existing: Json | null, patch: Json | null) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const baseCollected = base?.collected && typeof base.collected === "object"
    ? { ...base.collected }
    : {};
  const patchCollected = patch?.collected && typeof patch.collected === "object"
    ? { ...patch.collected }
    : {};
  const baseStage = safeStr((base as any)?.stage, "");
  let patchStage = safeStr((patch as any)?.stage, "");
  const patchLastIntent = safeStr((patch as any)?.lastIntent, "");
  const baseService = safeStr((baseCollected as any)?.service, "").trim();
  const patchService = safeStr((patchCollected as any)?.service, "").trim();

  if (
    patchStage === "DISCOVERY" &&
    patchLastIntent !== "reset_requested" &&
    ["BOOKING", "CONFIRMING", "BOOKED"].includes(baseStage)
  ) {
    patchStage = baseStage;
  }
  if (
    baseStage === "BOOKED" &&
    patchLastIntent !== "reset_requested" &&
    patchStage &&
    patchStage !== "BOOKED" &&
    patchStage !== "CLOSED"
  ) {
    patchStage = "BOOKED";
  }

  const merged: Record<string, unknown> = {
    ...base,
    ...(patch ?? {}),
    collected: mergeCollectedStates(baseCollected, patchCollected),
  };
  if (patchStage) merged.stage = patchStage;
  if (baseService && !patchService) {
    (merged.collected as Record<string, unknown>).service = baseService;
  }
  if (
    safeStr((merged as any)?.nextExpected, "") === "service" &&
    safeStr((merged.collected as any)?.service, "").trim()
  ) {
    merged.nextExpected = "date_time";
  }
  return merged;
}

export function mergeStatePatches(
  primary?: Json | null,
  secondary?: Json | null,
): Json {
  if (!primary) {
    return secondary && typeof secondary === "object" ? { ...secondary } : {};
  }
  if (!secondary) return primary;
  const primaryCollected =
    primary.collected && typeof primary.collected === "object"
      ? { ...primary.collected }
      : {};
  const secondaryCollected =
    secondary.collected && typeof secondary.collected === "object"
      ? { ...secondary.collected }
      : {};
  return {
    ...primary,
    ...secondary,
    collected: mergeCollectedStates(primaryCollected, secondaryCollected),
  };
}

function isBarbershopRuntime(leadState: Json | null, clinicSettings: Record<string, unknown>): boolean {
  const leadType = safeStr((leadState as any)?.orgType, safeStr((leadState as any)?.business_type, ""))
    .toLowerCase();
  const clinicType = safeStr(clinicSettings?.business_type, "").toLowerCase();
  return leadType === "barbershop" || clinicType === "barbershop";
}

function parseBarbershopTimePreference(text: string): "morning" | "afternoon" | "evening" | undefined {
  const n = normalizeTextForMatch(text);
  if (/\b(temprano|en la manana|manana temprano|por la manana)\b/.test(n)) return "morning";
  if (/\b(en la tarde|tarde|mas tarde|más tarde|por la tarde)\b/.test(n)) return "afternoon";
  if (/\b(noche|en la noche|tipo 7|tipo 8|tipo 9|7 pm|8 pm|9 pm)\b/.test(n)) return "evening";
  return undefined;
}

function mapAvailabilityReasonToReply(reason?: string): string {
  if (reason === "past_time") return "Esa hora ya pasó.";
  if (reason === "closed_day" || reason === "outside_hours") return "A esa hora no estamos atendiendo.";
  if (reason === "overlap") return "Ese horario ya está ocupado.";
  return "Ese horario no está disponible.";
}

function formatBarbershopSlotOption(slot: { date?: string | null; time?: string | null }): string {
  const date = safeStr(slot.date, "");
  const time = safeStr(slot.time, "");
  if (!date || !time) return "";
  const day = formatRequestedDayLabel(date);
  return `${day} a las ${formatHourLabel(time)}`;
}

function inferBarberProviderSelection(
  preferredBarberRaw: string,
  barbers: Array<Record<string, unknown>>,
): { providerPreference: "specific" | "any"; providerId?: string; providerName?: string } {
  const preferred = safeStr(preferredBarberRaw, "").trim();
  if (!preferred) return { providerPreference: "any" };
  const normalized = normalizeTextForMatch(preferred);
  if (/\b(cualquiera|con cualquiera|el que este disponible|el que esté disponible|no importa)\b/.test(normalized)) {
    return { providerPreference: "any" };
  }
  const match = barbers.find((barber) => {
    const name = normalizeTextForMatch(safeStr(barber.name, ""));
    const alias = normalizeTextForMatch(safeStr((barber as any).alias, ""));
    return normalized === name || normalized === alias || name.includes(normalized);
  });
  if (match) {
    return {
      providerPreference: "specific",
      providerId: safeStr(match.id, ""),
      providerName: safeStr(match.name, preferred),
    };
  }
  return { providerPreference: "specific", providerName: preferred };
}

function resolveLeadFullName(leadState: Json | null, statePatch?: Json | null) {
  const patchCollectedName = safeStr(
    (statePatch as any)?.collected?.full_name,
    "",
  ).trim();
  const patchCollectedNameAlt = safeStr(
    (statePatch as any)?.collected?.name,
    "",
  ).trim();
  const patchName = safeStr((statePatch as any)?.full_name, "").trim();
  const leadName = safeStr((leadState as any)?.full_name, "").trim();
  const stateName = safeStr((leadState as any)?.name, "").trim();
  return patchCollectedName || patchCollectedNameAlt || patchName || leadName || stateName || "";
}

function buildBookingRetryPatch(
  leadState: Json | null,
  currentStatePatch?: Json | null,
): Json {
  const leadCollected =
    leadState && typeof (leadState as any).collected === "object"
      ? { ...((leadState as any).collected as Record<string, unknown>) }
      : {};
  const patchCollected =
    currentStatePatch && typeof (currentStatePatch as any).collected === "object"
      ? { ...((currentStatePatch as any).collected as Record<string, unknown>) }
      : {};
  return {
    stage: "BOOKING",
    lastIntent: "booking_failed",
    nextExpected: "confirm_booking",
    collected: {
      ...leadCollected,
      ...patchCollected,
      confirmed: false,
    },
  };
}

// =============================================================================
// DATABASE LOADERS
// =============================================================================

async function loadOrgSecretWithFallback(
  supabase: SupabaseClientType,
  organizationId: string,
) {
  const r = await supabase
    .from("org_settings")
    .select(
      "meta_page_id, meta_page_access_token, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_enabled",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (r.error) return null;
  return r.data as Json | null;
}

async function loadProductKnowledge(
  supabase: SupabaseClientType,
  _organizationId: string,
) {
  const topics = [
    "implementation_steps",
    "pricing_plans",
    "dashboard_modules",
    "integrations",
    "trial_flow",
  ];
  const data = await supabase.from("product_knowledge").select("topic, content")
    .in("topic", topics);
  const map: Record<string, unknown> = {};
  if (!data.error && Array.isArray(data.data)) {
    for (const row of data.data as any[]) {
      const topic = safeStr(row.topic, "");
      if (topic) map[topic] = row.content;
    }
  }
  return map;
}

async function loadClinicKnowledge(
  supabase: SupabaseClientType,
  _organizationId: string,
) {
  const topics = [
    "services",
    "pricing",
    "hours",
    "location",
    "appointment_policy",
    "insurance",
  ];
  const data = await supabase.from("clinic_knowledge").select("topic, content")
    .in("topic", topics);
  const map: Record<string, unknown> = {};
  if (!data.error && Array.isArray(data.data)) {
    for (const row of data.data as any[]) {
      const topic = safeStr(row.topic, "");
      if (topic) map[topic] = row.content;
    }
  }
  return map;
}

async function loadClinicSettings(
  supabase: SupabaseClientType,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const clinicRes = await supabase
    .from("clinics")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1)
    .maybeSingle();

  if (!clinicRes.data?.id) return {};

  const settingsRes = await supabase
    .from("clinic_settings")
    .select("hours, services, phone, address")
    .eq("clinic_id", clinicRes.data.id)
    .maybeSingle();

  if (!settingsRes.data) {
    return {
      services: mergeDentalServiceTemplates([]),
    };
  }

  const data = settingsRes.data as Record<string, unknown>;
  const services = mergeDentalServiceTemplates(
    Array.isArray(data.services) ? (data.services as unknown[]) : [],
  );
  return {
    ...data,
    services,
  };
}

async function loadBarbershopSettings(
  supabase: SupabaseClientType,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    barber_services: [],
    barbers: [],
    barber_products: [],
  };
  const [servicesRes, barbersRes, productsRes] = await Promise.all([
    supabase
      .from("barber_services")
      .select("id, name, description, duration_min, price, is_active, sort_order")
      .eq("organization_id", organizationId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("barbers")
      .select("id, name, alias, is_active, default_duration_min")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("barber_products")
      .select("id, name, category, description, price, image_url, stock_status, is_active")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);
  if (!servicesRes.error && Array.isArray(servicesRes.data)) {
    out.barber_services = servicesRes.data;
  }
  if (!barbersRes.error && Array.isArray(barbersRes.data)) {
    out.barbers = barbersRes.data;
  }
  if (!productsRes.error && Array.isArray(productsRes.data)) {
    out.barber_products = productsRes.data;
  }
  return out;
}

async function loadRecentMessages(
  supabase: SupabaseClientType,
  leadId: string,
): Promise<RecentMessage[]> {
  if (!leadId) return [];

  const res = await supabase
    .from("messages")
    .select("role, actor, content, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (res.error || !res.data) return [];

  return (res.data as any[]).reverse().map((m: any) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    actor: (() => {
      const actor = safeStr(m.actor, "").toLowerCase();
      if (actor === "staff") return "staff";
      if (actor === "operator" || actor === "human") return "operator";
      if (actor === "bot") return "bot";
      return "user";
    })(),
    content: String(m.content || ""),
    timestamp: m.created_at,
  }));
}

// =============================================================================
// JOB MANAGEMENT
// =============================================================================

async function claimJobsViaRpc(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  limit: number;
  lockOwner: string;
  lockTtlSeconds: number;
}) {
  const params = {
    p_org_id: args.organizationId,
    p_limit: args.limit,
    p_lock_owner: args.lockOwner,
    p_lock_ttl_seconds: args.lockTtlSeconds,
  };
  const v3 = await args.supabase.rpc("claim_reply_outbox_jobs_v3", params);
  if (!v3.error) return v3;
  const v2 = await args.supabase.rpc("claim_reply_outbox_jobs_v2", params);
  return v2;
}

async function claimManualUiJobs(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  limit: number;
  lockOwner: string;
}) {
  logEvent("manual_outbound:claim_check", {
    organization_id: args.organizationId,
    limit: args.limit,
  });

  const candidateRes = await args.supabase
    .from("reply_outbox")
    .select("*")
    .eq("organization_id", args.organizationId)
    .eq("status", "queued")
    .filter("payload->>source", "eq", "ui_manual")
    .order("created_at", { ascending: true })
    .limit(args.limit);

  if (candidateRes.error) {
    return { data: null, error: candidateRes.error };
  }

  const ids = (candidateRes.data ?? [])
    .map((r: any) => safeStr(r.id, ""))
    .filter(Boolean);

  if (!ids.length) {
    logEvent("manual_outbound:no_jobs", {
      organization_id: args.organizationId,
    });
    return { data: [], error: null };
  }

  const now = nowIso();
  const updateRes = await args.supabase
    .from("reply_outbox")
    .update({
      status: "processing",
      processing_started_at: now,
      claimed_at: now,
      claimed_by: args.lockOwner,
      locked_at: now,
      locked_by: args.lockOwner,
      updated_at: now,
    })
    .in("id", ids)
    .eq("status", "queued")
    .select("*");

  if (updateRes.error) {
    return { data: null, error: updateRes.error };
  }

  logEvent("manual_outbound:claimed", {
    organization_id: args.organizationId,
    requested: ids.length,
    claimed: (updateRes.data ?? []).length,
  });

  return { data: updateRes.data ?? [], error: null };
}

async function finalizeOutboxJob(
  supabase: SupabaseClientType,
  jobId: string,
  updates: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("reply_outbox")
    .update({
      locked_at: null,
      locked_by: null,
      claimed_at: null,
      claimed_by: null,
      processing_started_at: null,
      updated_at: nowIso(),
      ...updates,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`finalize_outbox_failed:${error.message}`);
  }
}

async function hasResponseAfterJobCreation(
  supabase: SupabaseClientType,
  leadId: string,
  jobCreatedAt: string,
): Promise<boolean> {
  if (!leadId || !jobCreatedAt) return false;

  const res = await supabase
    .from("messages")
    .select("id")
    .eq("lead_id", leadId)
    .eq("role", "assistant")
    .gte("created_at", jobCreatedAt)
    .limit(1)
    .maybeSingle();

  return Boolean(res.data?.id);
}

// =============================================================================
// META API
// =============================================================================

function buildInteractiveButtonsForState(statePatch: Json): InteractiveButton[] {
  const nextExpected = safeStr((statePatch as any)?.nextExpected, "");
  const collected = (((statePatch as any)?.collected ?? {}) as Record<string, unknown>);
  const pending = ((collected.pending_booking ?? null) as Record<string, unknown> | null);
  const hasValidPendingBooking = Boolean(
    pending &&
    !Boolean(collected.pending_booking_stale) &&
    safeStr(pending.service, "").trim() &&
    safeStr(pending.appointment_date, "").trim() &&
    safeStr(pending.appointment_time, "").trim(),
  );
  if (
    (nextExpected === "confirm_booking" && hasValidPendingBooking) ||
    nextExpected === "confirm_cancel_appointment" ||
    nextExpected === "confirm_reschedule_appointment"
  ) {
    return [
      { id: "confirm_booking", title: "Confirmar" },
      { id: "reschedule", title: "Reagendar" },
      { id: "cancel", title: "Cancelar" },
    ];
  }
  return [];
}

// =============================================================================
// TOOL EXECUTION
// =============================================================================

async function executeToolCalls(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  leadState: Json | null;
  toolCalls: any[];
  executionId: string;
  traceId: string;
  jobId: string;
}): Promise<{ reply?: string; statePatch?: Json; booking?: BookingActionResult }> {
  const {
    supabase,
    organizationId,
    leadId,
    leadState,
    toolCalls,
    executionId,
    traceId,
    jobId,
  } = args;

  let finalReply: string | undefined;
  let combinedStatePatch: Json = {};
  let bookingResult: BookingActionResult | undefined;

  for (const toolCall of toolCalls) {
    const toolName = safeStr(toolCall?.name, "");
    const toolPayload = toolCall?.payload ?? {};
    if (!toolName) continue;

    try {
      if (toolName === "book_appointment") {
        logEvent("booking:executing_action", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          payload: toolPayload,
        });
      }

      const result = await executeToolAction({
        supabase,
        organizationId,
        leadId,
        action: { name: toolName as any, payload: toolPayload },
      });

      if (result.event) {
        logEvent("run_replies_tool_executed", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          tool_name: toolName,
          event_type: result.event.type,
        });
      }

      if (result.replyOverride) {
        finalReply = result.replyOverride;
      }

      if (result.statePatch) {
        combinedStatePatch = mergeStatePatches(
          combinedStatePatch,
          result.statePatch,
        );
      }

      if (toolName === "book_appointment" && result.booking) {
        bookingResult = result.booking;
        if (result.booking.ok) {
          logEvent("booking:success_reply_authorized", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id: organizationId,
            lead_id: leadId,
            job_id: jobId,
            appointment_id: result.booking.appointment.id,
          });
          const preferredBarberFallback = safeStr(
            ((result.booking as any)?.appointment ?? {})?.preferred_barber,
            safeStr(
              (((combinedStatePatch as any)?.collected ?? {}) as any)?.preferred_barber,
              safeStr((((leadState as any)?.collected ?? {}) as any)?.preferred_barber, ""),
            ),
          );
          finalReply = formatBookingSuccessReply(
            result.booking,
            safeStr((leadState as any)?.orgType, safeStr((leadState as any)?.business_type, "")),
            preferredBarberFallback,
          );
          combinedStatePatch = mergeStatePatches(
            combinedStatePatch,
            clearActiveBookingState({
              stage: "BOOKED",
              lastIntent: "booking_confirmed",
              nextExpected: undefined,
              pending_booking: null,
              pending_offered_slot: null,
              pending_reschedule: null,
              booking: {
                completed: true,
              },
              last_confirmed_appointment: {
                appointment_id: safeStr(result.booking.appointment.id, ""),
                service: safeStr(
                  result.booking.appointment.reason,
                  safeStr(result.booking.appointment.title, "Revisión dental"),
                ),
                preferred_barber: safeStr(
                  (result.booking.appointment as any).preferred_barber,
                  safeStr((result.booking.appointment as any).provider_name, ""),
                ),
                starts_at: safeStr(
                  result.booking.appointment.starts_at,
                  `${safeStr(result.booking.appointment.appointment_date, "")}T${safeStr(result.booking.appointment.appointment_time, "00:00")}:00`,
                ),
                status: "confirmed",
              },
              collected: {
                ...(((combinedStatePatch as any)?.collected ?? {}) as Record<string, unknown>),
                pending_booking: null,
                confirmed: true,
                booking: {
                  completed: true,
                },
              },
            }),
          );
        } else {
          const bookingError = safeStr(result.booking.error, "booking_action_failed");
          if (
            bookingError.includes("insert_failed") ||
            bookingError.includes("update_failed") ||
            bookingError.includes("lookup_failed") ||
            bookingError.includes("unexpected_error") ||
            bookingError.includes("missing_or_invalid")
          ) {
            logEvent("booking:insert_failed", {
              execution_id: executionId,
              trace_id: traceId,
              organization_id: organizationId,
              lead_id: leadId,
              job_id: jobId,
              error: bookingError,
            });
            finalReply = BOOKING_FAILURE_REPLY;
            combinedStatePatch = mergeStatePatches(
              combinedStatePatch,
              buildBookingRetryPatch(leadState, combinedStatePatch),
            );
          } else {
            finalReply = result.replyOverride
              ? clampText(result.replyOverride, 950)
              : BOOKING_FAILURE_REPLY;
            combinedStatePatch = mergeStatePatches(
              combinedStatePatch,
              buildBookingRetryPatch(leadState, combinedStatePatch),
            );
          }
          logEvent("booking:success_reply_blocked_no_insert", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id: organizationId,
            lead_id: leadId,
            job_id: jobId,
            error: bookingError,
          });
        }
      } else if (toolName === "book_appointment") {
        logEvent("booking:success_reply_blocked_no_insert", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          error: "missing_booking_result",
        });
        finalReply = BOOKING_FAILURE_REPLY;
        combinedStatePatch = mergeStatePatches(
          combinedStatePatch,
          buildBookingRetryPatch(leadState, combinedStatePatch),
        );
      }
    } catch (err) {
      console.error("[run-replies] tool execution failed", { toolName, err });
      if (toolName === "book_appointment") {
        logEvent("booking:insert_failed", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          error: safeStr((err as any)?.message ?? err, "tool_execution_failed"),
        });
        logEvent("booking:success_reply_blocked_no_insert", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          error: safeStr((err as any)?.message ?? err, "tool_execution_failed"),
        });
        finalReply = BOOKING_FAILURE_REPLY;
        combinedStatePatch = mergeStatePatches(
          combinedStatePatch,
          buildBookingRetryPatch(leadState, combinedStatePatch),
        );
      }
    }
  }

  return { reply: finalReply, statePatch: combinedStatePatch, booking: bookingResult };
}

async function resolveEngineReply(args: {
  supabase: SupabaseClientType;
  engineResult: any;
  organizationId: string;
  leadId: string;
  inboundText: string;
  leadState: Json | null;
  clinicSettings: Record<string, unknown>;
  executionId: string;
  traceId: string;
  jobId: string;
}): Promise<GenerateReplyResult> {
  const {
    supabase,
    engineResult,
    organizationId,
    leadId,
    inboundText,
    leadState,
    clinicSettings,
    executionId,
    traceId,
    jobId,
  } = args;

  let fallbackReply = clampText(
    safeStr(
      (engineResult as any)?.replyText,
      "Gracias por escribirnos. ¿En qué te puedo ayudar?",
    ),
    950,
  );
  let fallbackStatePatch = ((engineResult as any)?.statePatch ?? {}) as Json;
  let fallbackBookingSuccessAuthorized = false;
  const inboundLower = normalizeTextForMatch(inboundText);
  const leadCollected = ((leadState as any)?.collected ?? {}) as Record<string, unknown>;
  const pendingBooking = (((leadState as any)?.pending_booking ??
    (leadCollected as any)?.pending_booking) ?? null) as Record<string, unknown> | null;

  const isAppointmentLookupQuestion = /\b(tengo cita|tengo cita hoy|que cita tengo|qué cita tengo|que cita teng|q cita tengo|ke cita tengo|k cita tengo|a que hora es mi cita|a qué hora es mi cita|para cuando es mi cita|para cuándo es mi cita|me puede confirmar mi cita|confirmame mi cita|cual es mi cita|cuál es mi cita|cuando tengo cita|cuándo tengo cita|me podes recordar mi cita|me pod[eé]s recordar mi cita|me podes recordar cual es la cita que tengo|me pod[eé]s recordar cual es la cita que tengo|para que fecha quedo mi cita|para qué fecha quedó mi cita|en que fecha quedo mi cita|en qué fecha quedó mi cita|cuando quedo mi cita|cuándo quedó mi cita|para cuando quedo|para cuándo quedó|como quedo mi cita|cómo quedó mi cita|quedo mi cita|quedo agendada mi cita|en que quedo mi cita|en qué quedó mi cita|a que hora quedo mi cita|a qué hora quedó mi cita|para que dia quedo mi cita|para qué día quedó mi cita|que dia quedo mi cita|qué día quedó mi cita|necesito saber si tengo cita|me dejaste la cita|me borraste la cita|para que es mi cita|para qué es mi cita)\b/i
    .test(inboundLower);
  if (isAppointmentLookupQuestion || fallbackReply === "__CHECK_ACTIVE_APPOINTMENT__") {
    const apptRes = await supabase
      .from("appointments")
      .select("id, reason, title, patient_name, appointment_date, appointment_time, starts_at, status")
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .in("status", ["pending", "confirmed"])
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!apptRes.error && apptRes.data?.id) {
      const appt = apptRes.data as Record<string, unknown>;
      const service = toPatientFacingServiceLabel(safeStr(appt.reason, safeStr(appt.title, "Revisión dental")));
      const date = safeStr(appt.appointment_date, safeStr(appt.starts_at, "").slice(0, 10));
      const humanDate = formatRequestedDayLabel(date);
      const time = safeStr(appt.appointment_time, safeStr(appt.starts_at, "").slice(11, 16));
      const statusLabel = formatAppointmentStatus(safeStr(appt.status, "confirmed"));
      const patientName = toDisplayPersonName(safeStr(appt.patient_name, ""));
      const leadFullName = toDisplayPersonName(resolveLeadFullName(leadState, fallbackStatePatch));
      const hasThirdPartyPatient = Boolean(patientName && (!leadFullName || patientName !== leadFullName));
      const asksBrackets = /\b(brackets|frenillos?|ortodoncia)\b/i.test(inboundText);
      if (asksBrackets && !/ortodoncia|bracket/.test(normalizeTextForMatch(service))) {
        fallbackReply = `Veo una cita confirmada hoy a las ${formatHourLabel(time)}, pero está registrada como ${service}, no brackets. ¿Querés que la cambiemos a una revisión de ortodoncia / brackets?`;
      } else if (hasThirdPartyPatient) {
        fallbackReply = `Tenés una cita para ${patientName} ${statusLabel} para ${service} el ${humanDate} a las ${formatHourLabel(time)}.\n\n¿Querés revisarla, cambiarla o cancelarla?`;
      } else {
        fallbackReply = `Tenés una cita ${statusLabel} para ${service} el ${humanDate} a las ${formatHourLabel(time)}.\n\n¿Querés revisarla, cambiarla o cancelarla?`;
      }
    } else {
      fallbackReply = "No encontré una cita activa a tu nombre.\n\nSi querés, puedo ayudarte a revisar horarios disponibles para agendar una.";
    }
    return {
      reply: fallbackReply,
      statePatch: fallbackStatePatch,
      leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
      debugNote: "engine",
      bookingSuccessAuthorized: false,
    };
  }

  if (fallbackReply === "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__") {
    const isBarbershopConversation = safeStr((leadState as any)?.orgType, "").toLowerCase() === "barbershop";
    const timezone = safeStr(clinicSettings?.timezone, DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
    const todayInTimezone = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
    const activeRes = await supabase
      .from("appointments")
      .select("id, reason, title, patient_name, appointment_date, appointment_time, starts_at, status, provider_id, provider_name")
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .in("status", ["pending", "confirmed"])
      .gte("appointment_date", todayInTimezone)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (activeRes.error) {
      fallbackReply = "No pude verificar tu cita en este momento.";
      return {
        reply: fallbackReply,
        statePatch: mergeStatePatches(fallbackStatePatch, {
          nextExpected: undefined,
        }),
        leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
        debugNote: "engine",
        bookingSuccessAuthorized: false,
      };
    }
    const appt = activeRes.data as Record<string, unknown> | null;
    if (!appt?.id) {
      if (pendingBooking) {
        const pService = toPatientFacingServiceLabel(
          safeStr(pendingBooking.service, isBarbershopConversation ? "Cita" : "Revisión dental"),
        );
        const pDate = safeStr(pendingBooking.offered_date, safeStr(pendingBooking.requested_date, ""));
        const pTime = safeStr(pendingBooking.offered_time, safeStr(pendingBooking.requested_time, ""));
        fallbackReply =
          `Todavía no habíamos confirmado la cita, así que no hay nada que cancelar. La opción del ${pDate} a las ${formatHourLabel(pTime)} quedó solo como pendiente. ¿Querés que la descarte o buscamos otro horario?`;
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          pending_booking: {
            ...pendingBooking,
            service: pService,
            status: "pending_confirmation",
          },
        });
      } else {
        fallbackReply = "No encontré una cita activa a tu nombre.";
      }
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        nextExpected: undefined,
      });
    } else {
      const date = safeStr(appt.appointment_date, safeStr(appt.starts_at, "").slice(0, 10));
      const humanDate = formatRequestedDayLabel(date);
      const time = safeStr(appt.appointment_time, safeStr(appt.starts_at, "").slice(11, 16));
      const service = toPatientFacingServiceLabel(
        safeStr(appt.reason, safeStr(appt.title, isBarbershopConversation ? "Cita" : "Revisión dental")),
      );
      const providerName = safeStr(appt.provider_name, "").trim();
      const providerLine = providerName ? ` con ${providerName}` : "";
      const appointmentPatientName = toDisplayPersonName(safeStr(appt.patient_name, ""));
      const leadDisplayName = toDisplayPersonName(resolveLeadFullName(leadState));
      const isThirdPartyAppointment = Boolean(
        appointmentPatientName &&
          leadDisplayName &&
          appointmentPatientName.toLowerCase() !== leadDisplayName.toLowerCase(),
      );
      fallbackReply = isBarbershopConversation
        ? `Tenés una cita para ${service} el ${humanDate} a las ${formatHourLabel(time)}${providerLine}. ¿Querés cancelarla?`
        : (isThirdPartyAppointment
          ? `Encontré la cita de ${appointmentPatientName} para ${service} el ${humanDate} a las ${formatHourLabel(time)}.\n\n¿Confirmás que querés cancelarla?`
          : `Encontré tu cita para ${service} el ${humanDate} a las ${formatHourLabel(time)}.\n\n¿Confirmás que querés cancelarla?`);
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        stage: "BOOKING",
        nextExpected: "confirm_cancel_appointment",
        collected: {
          ...(((fallbackStatePatch as any)?.collected ?? {}) as Record<string, unknown>),
          active_appointment: {
            id: safeStr(appt.id, ""),
            reason: service,
            appointment_date: date,
            appointment_time: time,
            starts_at: safeStr(appt.starts_at, `${date}T${time}:00`),
            status: safeStr(appt.status, "confirmed"),
            provider_id: safeStr(appt.provider_id, "") || null,
            provider_name: providerName || null,
          },
          pending_cancel_appointment: {
            appointment_id: safeStr(appt.id, ""),
            service,
            appointment_date: date,
            appointment_time: time,
            status: "pending_confirmation",
            provider_id: safeStr(appt.provider_id, "") || null,
            provider_name: providerName || null,
          },
          pending_booking: null,
          pending_booking_stale: true,
        },
        pending_booking: null,
      });
    }
  }

  if (fallbackReply === "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__") {
    const preCollected = (fallbackStatePatch?.collected ?? {}) as Record<string, unknown>;
    const preRescheduleDate = safeStr(preCollected.reschedule_date, "");
    const preRescheduleTime = safeStr(preCollected.reschedule_time, "");
    const preRescheduleFromMessage = Boolean(preCollected.reschedule_from_message);
    const activeRes = await supabase
      .from("appointments")
      .select("id, appointment_date, appointment_time, starts_at, reason, title, status")
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .in("status", ["pending", "confirmed"])
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (activeRes.error) {
      fallbackReply = "No pude verificar tu cita en este momento.";
    } else {
      const appt = activeRes.data as Record<string, unknown> | null;
      if (!appt?.id) {
        if (pendingBooking) {
          const pService = toPatientFacingServiceLabel(safeStr(pendingBooking.service, "Revisión dental"));
          const pDate = safeStr(pendingBooking.offered_date, safeStr(pendingBooking.requested_date, ""));
          const pTime = safeStr(pendingBooking.offered_time, safeStr(pendingBooking.requested_time, ""));
          fallbackReply =
            `Claro. Todavía no estaba confirmada; solo teníamos pendiente ${pDate} a las ${formatHourLabel(pTime)} para ${pService}. ¿Qué día u hora preferís revisar?`;
        } else {
          fallbackReply = "No encontré una cita activa con este contacto.";
        }
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          nextExpected: undefined,
        });
      } else {
        const date = safeStr(appt.appointment_date, safeStr(appt.starts_at, "").slice(0, 10));
        const humanDate = formatRequestedDayLabel(date);
        const time = safeStr(appt.appointment_time, safeStr(appt.starts_at, "").slice(11, 16));
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          collected: {
            active_appointment: {
              id: safeStr(appt.id, ""),
              appointment_date: date,
              appointment_time: time,
              starts_at: safeStr(appt.starts_at, `${date}T${time}:00`),
              reason: safeStr(appt.reason, safeStr(appt.title, "Consulta general")),
            },
          },
        });
        if (preRescheduleDate && preRescheduleTime && preRescheduleFromMessage) {
          fallbackReply = "__CHECK_RESCHEDULE_AVAILABILITY__";
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            nextExpected: "confirm_reschedule_appointment",
          });
        } else {
          fallbackReply =
            `Encontré tu cita actual para ${humanDate} a las ${formatHourLabel(time)}. ¿Qué nueva fecha y hora preferís?`;
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            nextExpected: "reschedule_datetime",
          });
        }
      }
    }
  }

  if (fallbackReply === "__CHECK_RESCHEDULE_AVAILABILITY__") {
    const collected = (fallbackStatePatch?.collected ?? {}) as Record<string, unknown>;
    const requestedDate = safeStr(collected.reschedule_date, "");
    const requestedTime = safeStr(collected.reschedule_time, "");
    const activeAppointment = (collected.active_appointment as Record<string, unknown> | undefined) ?? {};
    const activeStartsAt = safeStr(
      activeAppointment.starts_at,
      `${safeStr(activeAppointment.appointment_date, "")}T${safeStr(activeAppointment.appointment_time, "")}:00`,
    );
    const requestedService = toPatientFacingServiceLabel(safeStr(
      collected.service,
      safeStr(activeAppointment.reason, "servicio dental"),
    ));

    logEvent("booking:availability_check", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: organizationId,
      lead_id: leadId,
      job_id: jobId,
      source: "reschedule_availability_preconfirm",
      requested_date: requestedDate,
      requested_time: requestedTime,
    });

    const hours = clinicSettings?.hours;
    const schedulingConfig = resolveClinicSchedulingConfig(clinicSettings);
    if (hours && typeof hours === "object" && requestedDate && requestedTime) {
      const slots = await getAvailableSlots({
        supabase,
        organizationId,
        hours: hours as Record<string, unknown>,
        daysAhead: 14,
        slotDurationMin: 30,
        timezone: schedulingConfig.timezone,
        sameDayBookingCutoff: schedulingConfig.sameDayBookingCutoff,
        bufferMin: schedulingConfig.bufferMin,
      });
      const requestedAvailable = slots.some((slot) =>
        slot.date === requestedDate && slot.time === requestedTime
      );
      if (requestedAvailable) {
        const requestedStartsAt = `${requestedDate}T${requestedTime}:00`;
        if (activeStartsAt && activeStartsAt.slice(0, 16) === requestedStartsAt.slice(0, 16)) {
          const currentDateLabel = new Date(requestedStartsAt).toLocaleDateString("es-HN", {
            weekday: "long",
            day: "numeric",
            month: "long",
          });
          const currentTimeLabel = new Date(requestedStartsAt).toLocaleTimeString("es-HN", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
          fallbackReply =
            `Esa ya es tu cita actual: ${currentDateLabel} a las ${currentTimeLabel}.\n\n¿Querés dejarla así o buscar otro horario?`;
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            nextExpected: "reschedule_datetime",
            pending_reschedule: null,
          });
        } else {
          const dateLabel = new Date(`${requestedDate}T${requestedTime}:00`).toLocaleDateString("es-HN", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }) + ` ${
            new Date(`${requestedDate}T${requestedTime}:00`).toLocaleTimeString("es-HN", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })
          }`;
          fallbackReply =
            `Puedo cambiar tu cita para ${dateLabel}. ¿Confirmamos el cambio?`;
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            nextExpected: "confirm_reschedule_appointment",
            pending_reschedule: {
              appointment_id: safeStr((collected.active_appointment as any)?.id, ""),
              current_starts_at: safeStr(
                (collected.active_appointment as any)?.starts_at,
                `${safeStr((collected.active_appointment as any)?.appointment_date, "")}T${safeStr((collected.active_appointment as any)?.appointment_time, "00:00")}:00`,
              ),
              requested_date: requestedDate,
              requested_time: requestedTime,
              new_starts_at: `${requestedDate}T${requestedTime}:00`,
              status: "pending_confirmation",
            },
          });
        }
      } else {
        const alternatives = pickNearestAlternatives(
          slots,
          requestedDate,
          requestedTime,
        );
        if (alternatives.length > 0) {
          fallbackReply =
            `Ese horario no está disponible. Te ofrezco ${alternatives.map((s) => `${s.dayLabel} a las ${s.time}`).join(" o ")}. ¿Cuál preferís?`;
        } else {
          fallbackReply =
            "Ese horario no está disponible y no encontré espacios cercanos ahora mismo.";
        }
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          nextExpected: "reschedule_datetime",
        });
      }
    } else {
      fallbackReply = "No tengo horarios configurados para reagendar en este momento.";
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        nextExpected: "reschedule_datetime",
      });
    }
  }

  if (fallbackReply === "__CHECK_REQUESTED_AVAILABILITY__") {
    if (isBarbershopRuntime(leadState, clinicSettings)) {
      const collected = (fallbackStatePatch?.collected ?? {}) as Record<string, unknown>;
      const requestedDate = safeStr(collected.preferred_date, "");
      const requestedTime = safeStr(collected.preferred_time, "");
      const preferredBarber = safeStr(collected.preferred_barber, "");
      const providerSelection = inferBarberProviderSelection(
        preferredBarber,
        (Array.isArray((clinicSettings as any)?.barbers) ? (clinicSettings as any).barbers : []) as Array<
          Record<string, unknown>
        >,
      );
      const serviceName = safeStr(collected.service, "Cita barbería");

      if (!requestedDate || !requestedTime) {
        fallbackReply = "Perfecto. Decime qué día y hora querés probar.";
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "date_time",
          collected: {
            ...(collected as Record<string, unknown>),
            pending_booking_stale: true,
          },
        });
        return {
          reply: fallbackReply,
          statePatch: fallbackStatePatch,
          leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
          debugNote: "engine",
          bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
        };
      }

      // Guard 1: avoid duplicate exact appointment / detect same-day active appointment for same lead
      const futureAppointments = await loadFutureActiveAppointmentsForLead({
        supabase,
        organizationId,
        leadId,
        timezone: safeStr(clinicSettings?.timezone, DEFAULT_TIMEZONE),
      });
      const allowAdditionalBooking = Boolean((collected as any)?.allow_additional_booking);
      const requestedPatientName = toDisplayPersonName(safeStr((collected as any)?.patient_name, ""));
      const normalizedRequestedService = normalizeTextForMatch(serviceName);
      const exactDuplicate = futureAppointments.find((appt) => {
        const apptDate = safeStr(appt.appointment_date, safeStr(appt.starts_at, "").slice(0, 10));
        const apptTime = safeStr(appt.appointment_time, safeStr(appt.starts_at, "").slice(11, 16));
        const apptPatientName = toDisplayPersonName(safeStr(appt.patient_name, ""));
        const hasDifferentPatient = Boolean(
          allowAdditionalBooking &&
          requestedPatientName &&
          apptPatientName &&
          requestedPatientName.toLowerCase() !== apptPatientName.toLowerCase(),
        );
        if (hasDifferentPatient) return false;
        const apptService = normalizeTextForMatch(
          toPatientFacingServiceLabel(safeStr(appt.reason, safeStr(appt.title, ""))),
        );
        return apptDate === requestedDate && apptTime === requestedTime && apptService === normalizedRequestedService;
      });
      if (exactDuplicate) {
        fallbackReply =
          `Ya tenés esa misma cita: ${formatRequestedDayLabel(requestedDate)} a las ${formatHourLabel(requestedTime)} para ${serviceName}. ¿Querés reagendarla, cancelarla o agendar otra para otra persona?`;
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "active_appointment_intent_choice",
          collected: {
            ...(collected as Record<string, unknown>),
            pending_booking: null,
            pending_booking_stale: true,
          },
        });
        return {
          reply: fallbackReply,
          statePatch: fallbackStatePatch,
          leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
          debugNote: "engine",
          bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
        };
      }
      const sameDayActive = allowAdditionalBooking ? undefined : futureAppointments.find((appt) => {
        const apptDate = safeStr(appt.appointment_date, safeStr(appt.starts_at, "").slice(0, 10));
        return apptDate === requestedDate;
      });
      if (sameDayActive) {
        const activeService = toPatientFacingServiceLabel(
          safeStr(sameDayActive.reason, safeStr(sameDayActive.title, "Cita")),
        );
        const activeTime = safeStr(
          sameDayActive.appointment_time,
          safeStr(sameDayActive.starts_at, "").slice(11, 16),
        );
        fallbackReply =
          `Ya tenés una cita activa ese día a las ${formatHourLabel(activeTime)}. ¿Querés agendar otra adicional o preferís cambiar la que ya tenés?`;
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "active_appointment_intent_choice",
          collected: {
            ...(collected as Record<string, unknown>),
            active_appointment: {
              id: safeStr(sameDayActive.id, ""),
              reason: activeService,
              appointment_date: requestedDate,
              appointment_time: activeTime,
              starts_at: safeStr(sameDayActive.starts_at, `${requestedDate}T${activeTime}:00`),
              status: safeStr(sameDayActive.status, "confirmed"),
            },
          },
        });
        return {
          reply: fallbackReply,
          statePatch: fallbackStatePatch,
          leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
          debugNote: "engine",
          bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
        };
      }

      const exact = await checkSlotAvailability({
        supabase,
        organization_id: organizationId,
        business_type: "barbershop",
        service_name: serviceName,
        provider_id: providerSelection.providerId,
        provider_preference: providerSelection.providerPreference,
        date: requestedDate,
        specific_time: requestedTime,
        timezone: safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
        max_options: 3,
      });

      if (exact.available) {
        const dateOnly = formatRequestedDayLabel(requestedDate);
        const firstName = safeStr(resolveLeadFullName(leadState, fallbackStatePatch), "").split(/\s+/)[0] ?? "";
        const providerLine = providerSelection.providerPreference === "specific" && (providerSelection.providerName || preferredBarber)
          ? ` con ${providerSelection.providerName || preferredBarber}`
          : "";
        fallbackReply =
          `Perfecto${firstName ? ` ${firstName}` : ""}. ${dateOnly} a las ${formatHourLabel(requestedTime)} está disponible${
            serviceName ? ` para ${serviceName}` : ""
          }${providerLine}. ¿Confirmamos?`;
        const autoAssignedProviderName = safeStr(exact.slot?.provider_name, "").trim();
        const resolvedProviderName = providerSelection.providerPreference === "specific"
          ? (providerSelection.providerName || preferredBarber || null)
          : (autoAssignedProviderName || null);
        const resolvedProviderId = providerSelection.providerPreference === "specific"
          ? (providerSelection.providerId || null)
          : (safeStr(exact.slot?.provider_id, "") || null);
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "CONFIRMING",
          nextExpected: "confirm_booking",
          collected: {
            ...(collected as Record<string, unknown>),
            service: serviceName,
            preferred_date: requestedDate,
            preferred_time: requestedTime,
            preferred_barber: resolvedProviderName,
            provider_name: resolvedProviderName,
            provider_id: resolvedProviderId,
            pending_booking_stale: false,
            last_bot_step: "barbershop_preconfirm",
            last_availability_slots: null,
            pending_booking: {
              service: serviceName,
              appointment_date: requestedDate,
              appointment_time: requestedTime,
              preferred_barber: resolvedProviderName,
              provider_name: resolvedProviderName,
              provider_id: resolvedProviderId,
              status: "pending_confirmation",
              service_source: safeStr(collected.service_source, "explicit"),
            },
          },
        });
      } else {
        // Guard 2: if requested specific barber is occupied, try any available barber at same slot.
        if (providerSelection.providerPreference === "specific") {
          const anyProviderAtSameSlot = await checkSlotAvailability({
            supabase,
            organization_id: organizationId,
            business_type: "barbershop",
            service_name: serviceName,
            provider_preference: "any",
            date: requestedDate,
            specific_time: requestedTime,
            timezone: safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
            max_options: 3,
          });
          if (anyProviderAtSameSlot.available) {
            const altProviderName = safeStr(anyProviderAtSameSlot.slot?.provider_name, "").trim();
            fallbackReply = altProviderName
              ? `${preferredBarber} no está disponible a esa hora, pero ${altProviderName} sí tiene espacio en ese mismo horario. ¿Confirmamos con ${altProviderName}?`
              : `${preferredBarber} no está disponible a esa hora, pero sí tengo otro barbero en ese mismo horario. ¿Confirmamos?`;
            fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
              stage: "CONFIRMING",
              nextExpected: "confirm_booking",
              collected: {
                ...(collected as Record<string, unknown>),
                service: serviceName,
                preferred_date: requestedDate,
                preferred_time: requestedTime,
                preferred_barber: altProviderName || null,
                provider_name: altProviderName || null,
                provider_id: safeStr(anyProviderAtSameSlot.slot?.provider_id, "") || null,
                pending_booking_stale: false,
                last_bot_step: "barbershop_preconfirm",
                pending_booking: {
                  service: serviceName,
                  appointment_date: requestedDate,
                  appointment_time: requestedTime,
                  preferred_barber: altProviderName || null,
                  provider_name: altProviderName || null,
                  provider_id: safeStr(anyProviderAtSameSlot.slot?.provider_id, "") || null,
                  status: "pending_confirmation",
                  service_source: safeStr(collected.service_source, "explicit"),
                },
              },
            });
            return {
              reply: fallbackReply,
              statePatch: fallbackStatePatch,
              leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
              debugNote: "engine",
              bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
            };
          }
        }
        const alternatives = Array.isArray(exact.alternatives) ? exact.alternatives.slice(0, 3) : [];
        const baseReason = mapAvailabilityReasonToReply(exact.reason);
        if (alternatives.length > 0) {
          const options = alternatives.map((slot) => `• ${formatBarbershopSlotOption(slot)}`).join("\n");
          fallbackReply = `${baseReason}\n\nTe puedo ofrecer:\n${options}\n\n¿Cuál te queda mejor?`;
        } else {
          fallbackReply = `${baseReason} Te puedo revisar otro horario para hoy o mañana.`;
        }
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "date_time",
          collected: {
            ...(collected as Record<string, unknown>),
            pending_booking_stale: true,
            pending_booking: null,
            last_availability_slots: alternatives.map((slot) => ({
              date: slot.date,
              time: slot.time,
              provider_id: slot.provider_id ?? null,
              provider_name: slot.provider_name ?? null,
            })),
            last_bot_step: "barbershop_showed_availability",
          },
        });
      }
      return {
        reply: fallbackReply,
        statePatch: fallbackStatePatch,
        leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
        debugNote: "engine",
        bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
      };
    }

    logEvent("booking:availability_check", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: organizationId,
      lead_id: leadId,
      job_id: jobId,
      source: "requested_slot_preconfirm",
    });

    const collected = (fallbackStatePatch?.collected ?? {}) as Record<string, unknown>;
    let requestedDate = safeStr(collected.preferred_date, "");
    const requestedTime = safeStr(collected.preferred_time, "");
    const weekdayMatch = normalizeTextForMatch(inboundText).match(/\b(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/);
    if (weekdayMatch && requestedDate) {
      const map: Record<string, number> = {
        domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6,
      };
      const wanted = map[weekdayMatch[1]] ?? -1;
      if (wanted >= 0) {
        const base = new Date(`${requestedDate}T12:00:00`);
        const baseDow = base.getDay();
        if (baseDow !== wanted) {
          let diff = (wanted - baseDow + 7) % 7;
          if (diff === 0) diff = 7;
          base.setDate(base.getDate() + diff);
          requestedDate = base.toISOString().slice(0, 10);
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            collected: {
              ...(collected as Record<string, unknown>),
              preferred_date: requestedDate,
            },
          });
        }
      }
    }
    if (requestedTime && !requestedDate) {
      fallbackReply = `Perfecto 👍 ¿Para qué día te gustaría a las ${requestedTime}?`;
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        stage: "BOOKING",
        nextExpected: "date_time",
        collected: {
          ...(collected as Record<string, unknown>),
          preferred_time: requestedTime,
        },
      });
      return {
        reply: fallbackReply,
        statePatch: fallbackStatePatch,
        leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
        debugNote: "engine",
        bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
      };
    }
    const requestedService = toPatientFacingServiceLabel(
      safeStr(collected.service, "Revisión dental"),
    );
    const dateLabel = requestedDate && requestedTime
      ? new Date(`${requestedDate}T${requestedTime}:00`).toLocaleDateString("es-HN", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }) + `, ${
        new Date(`${requestedDate}T${requestedTime}:00`).toLocaleTimeString("es-HN", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      }`
      : `${requestedDate} ${requestedTime}`.trim();
    const firstName = safeStr(
      (leadState as any)?.full_name || collected.full_name || (leadState as any)?.name,
      "",
    ).split(/\s+/)[0] ?? "";

    const hours = clinicSettings?.hours;
    const schedulingConfig = resolveClinicSchedulingConfig(clinicSettings);
    if (hours && typeof hours === "object" && requestedDate && requestedTime) {
      if (
        isLocalToday(requestedDate, schedulingConfig.timezone) &&
        !sameDayBookingAllowed(clinicSettings)
      ) {
        fallbackReply =
          "Hoy ya no tengo horarios disponibles para agendar por aquí, pero puedo ayudarte con una cita para mañana. ¿Te funciona por la mañana o por la tarde?";
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          nextExpected: "date_time",
          collected: {
            ...(collected as Record<string, unknown>),
            confirmed: false,
          },
        });
        return {
          reply: fallbackReply,
          statePatch: fallbackStatePatch,
          leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
          debugNote: "engine",
          bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
        };
      }
      const exactCheck = await checkExactSlotAvailability({
        supabase,
        organizationId,
        hours: hours as Record<string, unknown>,
        requestedDate,
        requestedTime,
        durationMin: 30,
        timezone: schedulingConfig.timezone,
        sameDayBookingCutoff: schedulingConfig.sameDayBookingCutoff,
        bufferMin: schedulingConfig.bufferMin,
      });
      logEvent("availability:exact_check", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        requested_date: requestedDate,
        requested_time: requestedTime,
      });
      if (exactCheck.available) {
        logEvent("availability:exact_available", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          requested_date: requestedDate,
          requested_time: requestedTime,
        });
        logEvent("booking:availability_available", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          source: "requested_slot_preconfirm",
          requested_date: requestedDate,
          requested_time: requestedTime,
        });
        const patientNameRaw = safeStr((collected as any)?.patient_name, "");
        const patientName = toDisplayPersonName(patientNameRaw);
        const relation = safeStr((collected as any)?.appointment_for_relation, "").trim().toLowerCase();
        const isThirdPartyAppointment = Boolean(patientName && relation && relation !== "self");
        const dateOnly = requestedDate
          ? new Date(`${requestedDate}T00:00:00`).toLocaleDateString("es-HN", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
          : dateLabel;
        fallbackReply = isThirdPartyAppointment
          ? `Perfecto, la cita sería para ${patientName}.\n\n${dateOnly} a las ${formatHourLabel(requestedTime)} está disponible para ${requestedService}.\n\n¿Confirmamos la cita?`
          : `Perfecto, ${firstName || "te"}. ${dateOnly} a las ${formatHourLabel(requestedTime)} está disponible para ${requestedService}.\n\n¿Confirmamos la cita?`;
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          pending_booking: {
            service: requestedService,
            requested_date: requestedDate,
            requested_time: requestedTime,
            offered_date: requestedDate,
            offered_time: requestedTime,
            starts_at: `${requestedDate}T${requestedTime}:00`,
            status: "pending_confirmation",
          },
          collected: {
            ...(collected as Record<string, unknown>),
            pending_booking: {
              service: requestedService,
              requested_date: requestedDate,
              requested_time: requestedTime,
              offered_date: requestedDate,
              offered_time: requestedTime,
              starts_at: `${requestedDate}T${requestedTime}:00`,
              status: "pending_confirmation",
            },
          },
        });
      } else {
        logEvent("availability:exact_conflict", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          requested_date: requestedDate,
          requested_time: requestedTime,
          reason: exactCheck.reason ?? null,
        });
        const slots = await getAvailableSlots({
          supabase,
          organizationId,
          hours: hours as Record<string, unknown>,
          daysAhead: 14,
          slotDurationMin: 30,
          timezone: schedulingConfig.timezone,
          sameDayBookingCutoff: schedulingConfig.sameDayBookingCutoff,
          bufferMin: schedulingConfig.bufferMin,
        });
        logEvent("booking:availability_conflict", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          source: "requested_slot_preconfirm",
          requested_date: requestedDate,
          requested_time: requestedTime,
          exact_reason: exactCheck.reason ?? null,
        });
        const alternatives = pickNearestAlternatives(
          slots,
          requestedDate,
          requestedTime,
        );
        if (alternatives.length > 0) {
          const near = alternatives[0];
          fallbackReply =
            `Para ${formatRequestedDayLabel(requestedDate)} a las ${formatHourLabel(requestedTime)} no tengo disponibilidad. Lo más cercano que encontré es ${near.dayLabel} a las ${formatHourLabel(near.time)}. ¿Te funciona?`;
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            pending_booking: {
              service: requestedService,
              requested_date: requestedDate,
              requested_time: requestedTime,
              offered_date: near.date,
              offered_time: near.time,
              starts_at: `${near.date}T${near.time}:00`,
              status: "pending_confirmation",
            },
            collected: {
              ...(collected as Record<string, unknown>),
              pending_offered_slot: {
                service: requestedService,
                appointment_date: near.date,
                appointment_time: near.time,
                starts_at: `${near.date}T${near.time}:00`,
                source: "nearest_available_alternative",
                set_at: new Date().toISOString(),
              },
              nearest_available_date: near.date,
              nearest_available_time: near.time,
              nearest_available_day_label: near.dayLabel,
              confirmed: false,
            },
          });
          logEvent("pending_offered_slot:set", {
            execution_id: executionId,
            organization_id: organizationId,
            lead_id: leadId,
            next_expected: "confirm_offered_slot",
            appointment_date: near.date,
            appointment_time: near.time,
            source: "nearest_available_alternative",
          });
        } else {
          fallbackReply =
            "Ese horario no está disponible y no encuentro espacios cercanos ahora mismo. ¿Quieres que te proponga otras fechas o te conecto con recepción?";
        }
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          nextExpected: alternatives.length > 0 ? "confirm_offered_slot" : "date_time",
          collected: alternatives.length > 0
            ? ((fallbackStatePatch?.collected ?? {}) as Record<string, unknown>)
            : {
              ...(collected as Record<string, unknown>),
              confirmed: false,
            },
        });
      }
    } else {
      logEvent("booking:availability_conflict", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        source: "requested_slot_preconfirm_missing_hours",
      });
      fallbackReply =
        "No tengo horarios configurados en este momento. ¿Quieres que te conecte con recepción para agendar?";
    }
  }

  if (fallbackReply === "__SHOW_AVAILABILITY_FOR_DATE__") {
    if (isBarbershopRuntime(leadState, clinicSettings)) {
      const collected = (fallbackStatePatch?.collected ?? {}) as Record<string, unknown>;
      const requestedDate = safeStr(collected.preferred_date, "");
      const serviceName = safeStr(collected.service, "Cita barbería");
      const preferredBarber = safeStr(collected.preferred_barber, "");
      const providerSelection = inferBarberProviderSelection(
        preferredBarber,
        (Array.isArray((clinicSettings as any)?.barbers) ? (clinicSettings as any).barbers : []) as Array<
          Record<string, unknown>
        >,
      );
      const timePreference = parseBarbershopTimePreference(
        safeStr(collected.time_preference, safeStr((engineResult as any)?.replyText, "")) || inboundText,
      );

      let availabilityContextSaved = false;
      if (!requestedDate) {
        fallbackReply = "Claro 🔥 ¿Para qué día querés que te revise horarios?";
      } else {
        const availabilityDiagnostics = await getAvailabilityDiagnosticsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_name: serviceName,
          provider_id: providerSelection.providerId,
          provider_preference: providerSelection.providerPreference,
          date: requestedDate,
          time_preference: timePreference,
          timezone: safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
          max_options: 5,
        });
        const slots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_name: serviceName,
          provider_id: providerSelection.providerId,
          provider_preference: providerSelection.providerPreference,
          date: requestedDate,
          time_preference: timePreference,
          timezone: safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
          max_options: 5,
        });
        const uniqueSlotsByTime = slots.filter((slot, idx, arr) =>
          arr.findIndex((candidate) => safeStr(candidate.time, "") === safeStr(slot.time, "")) === idx
        );
        logEvent("barbershop:availability_resolver", {
          execution_id: executionId,
          organization_id: organizationId,
          date: requestedDate,
          service: serviceName,
          provider_preference: providerSelection.providerPreference,
          provider_id: providerSelection.providerId ?? null,
          provider_hours_count: availabilityDiagnostics.providerHoursCount,
          providers_count: availabilityDiagnostics.providersCount,
          slots_count: slots.length,
          unique_slots_count: uniqueSlotsByTime.length,
          first_slots: availabilityDiagnostics.firstSlots,
          source_used: availabilityDiagnostics.sourceUsed,
        });
        const shownUniqueSlots = uniqueSlotsByTime.slice(0, 5);
        if (slots.length > 0) {
          const label = formatRequestedDayLabel(requestedDate);
          fallbackReply = `Para ${label.toLowerCase()} tengo estos horarios:\n${
            shownUniqueSlots.map((slot) => `• ${formatHourLabel(safeStr(slot.time, ""))}`).join("\n")
          }\n\n¿Cuál te queda mejor?`;
          const availabilityContext = {
            service: serviceName,
            date: requestedDate,
            provider_preference: providerSelection.providerPreference,
            provider_name: providerSelection.providerName,
            preferred_barber: providerSelection.providerName,
            slots: shownUniqueSlots.map((slot) => ({
              time: slot.time,
              starts_at: slot.date && slot.time ? `${slot.date}T${slot.time}:00` : null,
              provider_id: slot.provider_id ?? null,
              provider_name: slot.provider_name ?? null,
            })),
          };
          console.log(JSON.stringify({
            event: "barbershop:availability_context_saved",
            service: serviceName,
            date: requestedDate,
            slots_count: shownUniqueSlots.length,
          }));
          availabilityContextSaved = true;
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            collected: {
              ...(collected as Record<string, unknown>),
              last_availability_slots: shownUniqueSlots.map((slot) => ({
                date: slot.date,
                time: slot.time,
                provider_id: slot.provider_id ?? null,
                provider_name: slot.provider_name ?? null,
              })),
              last_availability_context: availabilityContext,
              last_bot_step: "barbershop_showed_availability",
            },
          });
        } else {
          const nextSlots = await suggestNextAvailableSlots({
            supabase,
            organization_id: organizationId,
            business_type: "barbershop",
            service_name: serviceName,
            provider_id: providerSelection.providerId,
            provider_preference: providerSelection.providerPreference,
            date_from: requestedDate,
            time_preference: timePreference,
            timezone: safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
            max_options: 3,
          });
          if (nextSlots.length > 0) {
            const shownAlternatives = nextSlots.slice(0, 3);
            fallbackReply = `Para ese día no tengo espacios, pero te puedo ofrecer:\n${
              shownAlternatives.map((slot) => `• ${formatBarbershopSlotOption(slot)}`).join("\n")
            }\n\n¿Cuál te queda mejor?`;
            const availabilityContext = {
              service: serviceName,
              date: requestedDate,
              provider_preference: providerSelection.providerPreference,
              provider_name: providerSelection.providerName,
              preferred_barber: providerSelection.providerName,
              slots: shownAlternatives.map((slot) => ({
                time: slot.time,
                starts_at: slot.date && slot.time ? `${slot.date}T${slot.time}:00` : null,
                provider_id: slot.provider_id ?? null,
                provider_name: slot.provider_name ?? null,
              })),
            };
            console.log(JSON.stringify({
              event: "barbershop:availability_context_saved",
              service: serviceName,
              date: requestedDate,
              slots_count: shownAlternatives.length,
            }));
            availabilityContextSaved = true;
            fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
              collected: {
                ...(collected as Record<string, unknown>),
                last_availability_slots: shownAlternatives.map((slot) => ({
                  date: slot.date,
                  time: slot.time,
                  provider_id: slot.provider_id ?? null,
                  provider_name: slot.provider_name ?? null,
                })),
                last_availability_context: availabilityContext,
                last_bot_step: "barbershop_showed_availability",
              },
            });
          } else {
            fallbackReply = "No encontré horarios disponibles para ese día. ¿Querés que revisemos otra fecha?";
          }
        }
      }
      const latestCollectedAfterAvailability = ((fallbackStatePatch?.collected ?? collected) as Record<string, unknown>);
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        stage: "BOOKING",
        nextExpected: availabilityContextSaved ? "availability_slot_selection" : "date_time",
        collected: {
          ...latestCollectedAfterAvailability,
          pending_booking_stale: true,
          pending_booking: null,
        },
      });
      return {
        reply: fallbackReply,
        statePatch: fallbackStatePatch,
        leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
        debugNote: "engine",
        bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
      };
    }

    const collected = (fallbackStatePatch?.collected ?? {}) as Record<string, unknown>;
    const requestedDate = safeStr(collected.preferred_date, "");
    const requestedService = toPatientFacingServiceLabel(
      safeStr(collected.service, "Revisión dental"),
    );
    const hours = clinicSettings?.hours;
    const schedulingConfig = resolveClinicSchedulingConfig(clinicSettings);

    if (!requestedDate) {
      fallbackReply = "Perfecto 👍 ¿Para qué día te gustaría?";
    } else if (hours && typeof hours === "object") {
      const slots = await getAvailableSlots({
        supabase,
        organizationId,
        hours: hours as Record<string, unknown>,
        daysAhead: 14,
        slotDurationMin: 30,
        timezone: schedulingConfig.timezone,
        sameDayBookingCutoff: schedulingConfig.sameDayBookingCutoff,
        bufferMin: schedulingConfig.bufferMin,
      });
      const daySlots = slots.filter((s) => s.date === requestedDate);
      if (daySlots.length > 0) {
        const selection = selectPatientFriendlySlots({
          slots: daySlots,
          mode: "specific_day",
          requestedDate,
          maxOptions: 3,
        });
        const renderedDaySlots = selection.slots;
        logEvent("availability:alternatives_generated", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          requested_date: requestedDate,
          slot_count: renderedDaySlots.length,
        });
        const specificDayLabel = renderedDaySlots[0]?.dayLabel ??
          formatRequestedDayLabel(requestedDate);
        if (selection.summarizeAdjacentRange && renderedDaySlots.length >= 2) {
          const first = renderedDaySlots[0];
          const last = renderedDaySlots[renderedDaySlots.length - 1];
          fallbackReply =
            `Para ${specificDayLabel.toLowerCase()} tengo disponibilidad en la mañana, entre ${formatHourLabel(first.time)} y ${formatHourLabel(last.time)}. ¿Te queda bien ${formatHourLabel(first.time)} o preferís que busque otro día?`;
        } else {
          fallbackReply =
            `Para ${specificDayLabel.toLowerCase()} tengo estos horarios:\n${
              renderedDaySlots.map((slot) => `• ${formatHourLabel(slot.time)}`).join("\n")
            }\n\n¿Cuál te queda mejor?`;
        }
      } else {
        const nextSlot = slots
          .filter((s) => s.date > requestedDate)
          .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0];
        if (nextSlot) {
          const requestedDayLabel = formatRequestedDayLabel(requestedDate);
          fallbackReply =
            `No tengo espacio disponible para ${requestedDayLabel}. El más cercano que encontré es ${nextSlot.dayLabel.toLowerCase()} a las ${formatHourLabel(nextSlot.time)}.\n\n¿Te funciona ese horario o preferís otro día?`;
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            collected: {
              ...(collected as Record<string, unknown>),
              unavailable_requested_date: requestedDate,
              nearest_available_date: nextSlot.date,
              nearest_available_time: nextSlot.time,
              nearest_available_day_label: nextSlot.dayLabel,
            },
          });
        } else {
          fallbackReply =
            "No encontré horarios disponibles para mañana ni espacios cercanos. ¿Preferís otro día?";
        }
      }
    } else {
      fallbackReply = "Perfecto 👍 ¿Para qué día te gustaría?";
    }

    fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        ...(collected as Record<string, unknown>),
      },
    });
  }

  if (fallbackReply === "__SHOW_NEARBY_TIME_ALTERNATIVES__") {
    const collected = (fallbackStatePatch?.collected ?? {}) as Record<string, unknown>;
    const requestedDate = safeStr(collected.preferred_date, "");
    const requestedService = toPatientFacingServiceLabel(
      safeStr(collected.service, "Revisión dental"),
    );
    const anchorTime = safeStr(collected.preferred_time_anchor, safeStr(collected.preferred_time, ""));
    const hours = clinicSettings?.hours;
    const schedulingConfig = resolveClinicSchedulingConfig(clinicSettings);

    if (!requestedDate) {
      fallbackReply = "Perfecto 👍 ¿Para qué día te gustaría?";
    } else if (hours && typeof hours === "object") {
      const slots = await getAvailableSlots({
        supabase,
        organizationId,
        hours: hours as Record<string, unknown>,
        daysAhead: 14,
        slotDurationMin: 30,
        timezone: schedulingConfig.timezone,
        sameDayBookingCutoff: schedulingConfig.sameDayBookingCutoff,
        bufferMin: schedulingConfig.bufferMin,
      });
      const daySlots = slots.filter((s) => s.date === requestedDate);
      const alternatives = anchorTime
        ? pickNearestAlternatives(daySlots, requestedDate, anchorTime)
        : daySlots.slice(0, 2);
      if (alternatives.length > 0) {
        fallbackReply =
          `Claro 👍 Te puedo ofrecer estas opciones cercanas:\n\n• ${formatHourLabel(alternatives[0].time)}${
            alternatives[1] ? `\n• ${formatHourLabel(alternatives[1].time)}` : ""
          }\n\n¿Cuál te queda mejor?`;
      } else {
        fallbackReply =
          `No encontré horarios cercanos para ${requestedService.toLowerCase()} ese día. ¿Querés que busquemos otro día?`;
      }
    } else {
      fallbackReply = "Perfecto 👍 ¿Para qué día te gustaría?";
    }

    fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
      stage: "BOOKING",
      nextExpected: "date_time",
      collected: {
        ...(collected as Record<string, unknown>),
        awaiting_new_time: true,
      },
    });
  }

  if (fallbackReply === "__SHOW_AVAILABILITY__") {
    if (isBarbershopRuntime(leadState, clinicSettings)) {
      const collected = (fallbackStatePatch?.collected ?? {}) as Record<string, unknown>;
      const requestedDate = safeStr(collected.preferred_date, "");
      const serviceName = safeStr(collected.service, "Cita barbería");
      const preferredBarber = safeStr(collected.preferred_barber, "");
      const providerSelection = inferBarberProviderSelection(
        preferredBarber,
        (Array.isArray((clinicSettings as any)?.barbers) ? (clinicSettings as any).barbers : []) as Array<
          Record<string, unknown>
        >,
      );
      const timePreference = parseBarbershopTimePreference(inboundText);

      if (!requestedDate) {
        const today = new Date().toISOString().slice(0, 10);
        const nextSlots = await suggestNextAvailableSlots({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_name: serviceName,
          provider_id: providerSelection.providerId,
          provider_preference: providerSelection.providerPreference,
          date_from: today,
          time_preference: timePreference,
          timezone: safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
          max_options: 5,
        });
        if (nextSlots.length > 0) {
          fallbackReply = `Te puedo ofrecer estos horarios:\n${
            nextSlots.map((slot) => `• ${formatBarbershopSlotOption(slot)}`).join("\n")
          }\n\n¿Cuál te queda mejor?`;
        } else {
          fallbackReply = "Claro 🔥 ¿Para qué día querés que te revise horarios?";
        }
      } else {
        const daySlots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_name: serviceName,
          provider_id: providerSelection.providerId,
          provider_preference: providerSelection.providerPreference,
          date: requestedDate,
          time_preference: timePreference,
          timezone: safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
          max_options: 5,
        });
        if (daySlots.length > 0) {
          const label = formatRequestedDayLabel(requestedDate);
          fallbackReply = `Para ${label.toLowerCase()} tengo estos horarios:\n${
            daySlots.slice(0, 5).map((slot) => `• ${formatHourLabel(safeStr(slot.time, ""))}`).join("\n")
          }\n\n¿Cuál te queda mejor?`;
        } else {
          fallbackReply = "No encontré horarios para ese día. ¿Querés que te revise otra fecha?";
        }
      }
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        stage: "BOOKING",
        nextExpected: "date_time",
        collected: {
          ...(collected as Record<string, unknown>),
          pending_booking_stale: true,
          pending_booking: null,
        },
      });
      return {
        reply: fallbackReply,
        statePatch: fallbackStatePatch,
        leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
        debugNote: "engine",
        bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
      };
    }

    logEvent("booking:availability_check", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: organizationId,
      lead_id: leadId,
      job_id: jobId,
      source: "availability_engine",
    });
    const hours = clinicSettings?.hours;
    const schedulingConfig = resolveClinicSchedulingConfig(clinicSettings);
    if (hours && typeof hours === "object") {
      const slots = await getAvailableSlots({
        supabase,
        organizationId,
        hours: hours as Record<string, unknown>,
        daysAhead: 4,
        slotDurationMin: 30,
        timezone: schedulingConfig.timezone,
        sameDayBookingCutoff: schedulingConfig.sameDayBookingCutoff,
        bufferMin: schedulingConfig.bufferMin,
      });
      if (slots.length > 0) {
        logEvent("booking:availability_available", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          slot_count: slots.length,
          source: "availability_engine",
        });
        const service = toPatientFacingServiceLabel(safeStr(((fallbackStatePatch?.collected ?? {}) as any)?.service, "Revisión dental"));
        const selection = selectPatientFriendlySlots({
          slots,
          mode: "general",
          maxOptions: 3,
        });
        const lines = selection.slots.map((slot) =>
          `• ${toLongDayLabel(slot.dayLabel)} ${formatHourLabel(slot.time)}`
        );
        fallbackReply = clampText(
          `Para ${service} tengo estas opciones:\n${lines.join("\n")}\n\n¿Cuál te queda mejor?`,
          950,
        );
      } else {
        logEvent("booking:availability_conflict", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          source: "availability_engine",
        });
        fallbackReply =
          "No encuentro horarios disponibles cercanos ahora mismo. ¿Quieres que te proponga otras fechas o te conecto con recepción?";
      }
    } else {
      logEvent("booking:availability_conflict", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        source: "availability_engine_missing_hours",
      });
      fallbackReply =
        "No tengo horarios configurados en este momento. ¿Quieres que te conecte con recepción para agendar?";
    }
  }
  const toolAction = (engineResult as any)?.toolAction as
    | { name?: string; payload?: Record<string, unknown> }
    | undefined;
  const allowedToolActionNames = new Set<ToolActionName>([
    "show_demo",
    "start_trial",
    "begin_onboarding",
    "capture_business_type",
    "capture_lead_goal",
    "book_appointment",
    "cancel_appointment",
    "reschedule_appointment",
    "create_trial_account",
    "get_clinic_info",
  ]);

  if (toolAction?.name && leadId) {
    if (!allowedToolActionNames.has(toolAction.name as ToolActionName)) {
      logEvent("invalid_tool_action", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        tool_name: toolAction.name,
      });
      return {
        reply: fallbackReply,
        statePatch: fallbackStatePatch,
        leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
        debugNote: "engine_invalid_tool_action",
        bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
      };
    }
    const validatedToolName = toolAction.name as ToolActionName;

    if (validatedToolName === "book_appointment") {
      logEvent("booking:executing_action", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        payload: toolAction.payload ?? {},
      });
    }

    try {
      const toolExecution = await executeToolAction({
        supabase,
        organizationId,
        leadId,
        action: {
          name: validatedToolName,
          payload: toolAction.payload ?? {},
        },
      });

      if (toolExecution.statePatch) {
        fallbackStatePatch = mergeStatePatches(
          fallbackStatePatch,
          toolExecution.statePatch,
        );
      }

      if (validatedToolName === "book_appointment" && toolExecution.booking) {
        if (toolExecution.booking.ok) {
          logEvent("booking:success_reply_authorized", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id: organizationId,
            lead_id: leadId,
            job_id: jobId,
            appointment_id: toolExecution.booking.appointment.id,
          });
          const preferredBarberFallback = safeStr(
            ((toolExecution.booking as any)?.appointment ?? {})?.preferred_barber,
            safeStr(
              (((fallbackStatePatch as any)?.collected ?? {}) as any)?.preferred_barber,
              safeStr((((leadState as any)?.collected ?? {}) as any)?.preferred_barber, ""),
            ),
          );
          fallbackReply = formatBookingSuccessReply(
            toolExecution.booking,
            safeStr((leadState as any)?.orgType, safeStr((leadState as any)?.business_type, "")),
            preferredBarberFallback,
          );
          fallbackBookingSuccessAuthorized = true;
          fallbackStatePatch = mergeStatePatches(
            fallbackStatePatch,
            clearActiveBookingState({
              stage: "BOOKED",
              lastIntent: "booking_confirmed",
              nextExpected: undefined,
              pending_booking: null,
              pending_offered_slot: null,
              pending_reschedule: null,
              booking: {
                completed: true,
              },
              last_confirmed_appointment: {
                appointment_id: safeStr(toolExecution.booking.appointment.id, ""),
                service: safeStr(
                  toolExecution.booking.appointment.reason,
                  safeStr(toolExecution.booking.appointment.title, "Revisión dental"),
                ),
                preferred_barber: safeStr(
                  (toolExecution.booking.appointment as any).preferred_barber,
                  safeStr((toolExecution.booking.appointment as any).provider_name, ""),
                ),
                starts_at: safeStr(
                  toolExecution.booking.appointment.starts_at,
                  `${safeStr(toolExecution.booking.appointment.appointment_date, "")}T${safeStr(toolExecution.booking.appointment.appointment_time, "00:00")}:00`,
                ),
                status: "confirmed",
              },
              collected: {
                ...(((fallbackStatePatch as any)?.collected ?? {}) as Record<string, unknown>),
                pending_booking: null,
                confirmed: true,
                booking: {
                  completed: true,
                },
              },
            }),
          );
        } else {
          const bookingError = safeStr(
            toolExecution.booking.error,
            "booking_action_failed",
          );
          if (
            bookingError.includes("insert_failed") ||
            bookingError.includes("update_failed") ||
            bookingError.includes("lookup_failed") ||
            bookingError.includes("unexpected_error") ||
            bookingError.includes("missing_or_invalid")
          ) {
            logEvent("booking:insert_failed", {
              execution_id: executionId,
              trace_id: traceId,
              organization_id: organizationId,
              lead_id: leadId,
              job_id: jobId,
              error: bookingError,
            });
            fallbackReply = BOOKING_FAILURE_REPLY;
            fallbackStatePatch = mergeStatePatches(
              fallbackStatePatch,
              buildBookingRetryPatch(leadState, fallbackStatePatch),
            );
          } else {
            fallbackReply = toolExecution.replyOverride
              ? clampText(toolExecution.replyOverride, 950)
              : BOOKING_FAILURE_REPLY;
            fallbackStatePatch = mergeStatePatches(
              fallbackStatePatch,
              buildBookingRetryPatch(leadState, fallbackStatePatch),
            );
          }
          logEvent("booking:success_reply_blocked_no_insert", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id: organizationId,
            lead_id: leadId,
            job_id: jobId,
            error: bookingError,
          });
        }
      } else if (validatedToolName === "book_appointment") {
        logEvent("booking:success_reply_blocked_no_insert", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          error: "missing_booking_result",
        });
        fallbackReply = BOOKING_FAILURE_REPLY;
        fallbackStatePatch = mergeStatePatches(
          fallbackStatePatch,
          buildBookingRetryPatch(leadState, fallbackStatePatch),
        );
      } else if (toolExecution.replyOverride) {
        fallbackReply = clampText(toolExecution.replyOverride, 950);
      }
    } catch (err) {
      console.error("[run-replies] engine tool execution failed", {
        toolName: toolAction.name,
        err,
      });
      if (validatedToolName === "book_appointment") {
        logEvent("booking:insert_failed", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          error: safeStr((err as any)?.message ?? err, "tool_execution_failed"),
        });
        logEvent("booking:success_reply_blocked_no_insert", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          error: safeStr((err as any)?.message ?? err, "tool_execution_failed"),
        });
        fallbackReply = BOOKING_FAILURE_REPLY;
        fallbackStatePatch = mergeStatePatches(
          fallbackStatePatch,
          buildBookingRetryPatch(leadState, fallbackStatePatch),
        );
      }
    }
  }

  return {
    reply: fallbackReply,
    statePatch: fallbackStatePatch,
    leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
    debugNote: safeStr((engineResult as any)?.debugNote, "engine"),
    bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
  };
}

function shouldUseDeterministicEngine(args: {
  engineResult: any;
  leadState: Json | null;
}): boolean {
  const { engineResult, leadState } = args;
  if (!engineResult) return false;
  const intent = safeStr((engineResult as any)?.debug?.intent, "unknown");
  const route = safeStr((engineResult as any)?.debug?.route, "");
  if (safeStr((engineResult as any)?.replyText, "") === "__SHOW_AVAILABILITY__") {
    return true;
  }
  if ((engineResult as any)?.toolAction?.name) return true;
  if (safeStr((leadState as any)?.stage, "") === "BOOKING") return true;
  if (safeStr((leadState as any)?.nextExpected, "").startsWith("confirm_booking")) {
    return true;
  }
  const deterministicIntents = new Set([
    "book_appointment",
    "cancel_appointment",
    "reschedule_appointment",
    "services",
    "pricing",
    "hours",
    "location",
    "emergency",
    "human_handoff",
    "gratitude",
    "greeting",
    "provide_service",
    "provide_datetime",
  ]);
  if (deterministicIntents.has(intent)) return true;
  if (intent === "unknown" && (route === "fallback" || route === "fallback_greeting")) {
    return false;
  }
  return intent !== "unknown";
}

// =============================================================================
// REPLY GENERATION
// =============================================================================

export async function generateReply(
  args: GenerateReplyArgs,
): Promise<GenerateReplyResult> {
  const {
    supabase,
    organizationId,
    leadId,
    leadState: initialLeadState,
    inboundText: initialInboundText,
    orgSettings,
    recentMessages,
    productKnowledge,
    clinicKnowledge,
    clinicSettings,
    llmEnabled,
    isOperatorOutbound,
    manualText,
    executionId,
    traceId,
    jobId,
  } = args;

  let leadState = initialLeadState;
  let inboundText = initialInboundText;

  if (isOperatorOutbound) {
    return {
      reply: manualText || inboundText || "Gracias por escribirnos.",
      statePatch: {},
      leadPatch: {},
      debugNote: "operator_outbound",
    };
  }

  let classified: ClassifiedIntent | null = null;
  const businessType = safeStr(orgSettings?.business_type, "").toLowerCase();
  const normalizedBusinessType =
    businessType === "barbershop"
      ? "barbershop"
      : businessType === "dental" || businessType === "clinic" || businessType.includes("dental")
      ? "dental"
      : "generic";
  const isDentalOrg = businessType === "dental" ||
    businessType === "clinic" ||
    businessType.includes("dental");
  const deterministicIntent = detectIntent(inboundText, {
    nextExpected: safeStr((leadState as any)?.nextExpected, "") || undefined,
  });
  const currentStage = safeStr((leadState as any)?.stage, "");
  const nextExpected = safeStr((leadState as any)?.nextExpected, "");
  const bookingLocked = ["BOOKING", "CONFIRMING", "BOOKED"].includes(currentStage) ||
    ["service", "date_time", "confirm_booking", "confirm_booking_suggestion"].includes(nextExpected);

  if (
    shouldCheckDbActiveAppointmentBeforeBooking({
      organizationId,
      leadState,
      inboundText,
      deterministicIntent: deterministicIntent.intent,
    })
  ) {
    const activeAppt = await loadActiveAppointmentForLead({
      supabase,
      organizationId,
      leadId,
    });
    if (activeAppt) {
      const service = toPatientFacingServiceLabel(
        safeStr(activeAppt.reason, safeStr(activeAppt.title, "Revisión dental")),
      );
      const date = safeStr(activeAppt.appointment_date, safeStr(activeAppt.starts_at, "").slice(0, 10));
      const time = safeStr(activeAppt.appointment_time, safeStr(activeAppt.starts_at, "").slice(11, 16));
      return {
        reply:
          `Veo que ya tenés una cita confirmada para ${service} el ${formatRequestedDayLabel(date)} a las ${formatHourLabel(time)}.\n\n¿Querés agregar esto a esa cita, buscar un horario más pronto o agendar una cita adicional?`,
        statePatch: {
          stage: "BOOKING",
          lastIntent: "appointment_lookup",
          nextExpected: "active_appointment_intent_choice",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<string, unknown>),
            active_appointment: {
              id: safeStr(activeAppt.id, ""),
              reason: service,
              appointment_date: date,
              appointment_time: time,
              starts_at: safeStr(activeAppt.starts_at, `${date}T${time}:00`),
              patient_name: safeStr(activeAppt.patient_name, ""),
              status: safeStr(activeAppt.status, "confirmed"),
            },
          },
        },
        leadPatch: {},
        debugNote: "db_active_appointment_guard",
      };
    }
  }

  // KB v2 first-pass resolution (safe, non-blocking, does not alter booking orchestration)
  if (isDentalOrg && !bookingLocked) {
    const shouldTryServiceKb = deterministicIntent.intent === "services" ||
      deterministicIntent.intent === "pricing" ||
      deterministicIntent.intent === "unknown";
    if (shouldTryServiceKb) {
      try {
        const svcRes = await supabase.rpc("get_service_info", {
          p_org_id: organizationId,
          p_search: inboundText,
        });
        if (svcRes.error) {
          logEvent("kb:service_lookup_failed", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id: organizationId,
            lead_id: leadId,
            job_id: jobId,
            code: (svcRes.error as any)?.code ?? null,
            message: svcRes.error.message,
            details: (svcRes.error as any)?.details ?? null,
            hint: (svcRes.error as any)?.hint ?? null,
          });
        } else {
          const row = extractRpcRow(svcRes.data) as Record<string, unknown> | null;
          const found = Boolean(
            row &&
              (row.found === true ||
                safeStr(row.booking_label, "") ||
                safeStr(row.name, "") ||
                safeStr(row.service_name, "")),
          );
          if (found) {
            const rendered = buildServiceReplyFromKb(row as any, inboundText);
            logEvent("kb:service_lookup_success", {
              execution_id: executionId,
              trace_id: traceId,
              organization_id: organizationId,
              lead_id: leadId,
              job_id: jobId,
              service: rendered.service,
              price_question: isKbPriceQuestion(inboundText),
            });
            return {
              reply: clampText(rendered.reply, 950),
              statePatch: {
                stage: "SERVICE_INFO",
                lastIntent: deterministicIntent.intent === "pricing" || isKbPriceQuestion(inboundText)
                  ? "pricing"
                  : "service_info",
                nextExpected: "service_info_or_booking",
                collected: {
                  ...(((leadState as any)?.collected ?? {}) as Record<string, unknown>),
                  service: rendered.service,
                  last_discussed_service: rendered.service,
                },
              },
              leadPatch: {},
              debugNote: "kb_service",
            };
          }
          logEvent("kb:service_lookup_miss", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id: organizationId,
            lead_id: leadId,
            job_id: jobId,
          });
        }
      } catch (err) {
        logEvent("kb:service_lookup_failed", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          code: (err as any)?.code ?? null,
          message: safeStr((err as any)?.message ?? err, "unexpected_error"),
          details: (err as any)?.details ?? null,
          hint: (err as any)?.hint ?? null,
        });
      }
    }

    if (isFaqQuestion(inboundText)) {
      try {
        const faqRes = await supabase.rpc("get_faq_answer", {
          p_org_id: organizationId,
          p_question: inboundText,
        });
        if (faqRes.error) {
          logEvent("kb:faq_lookup_failed", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id: organizationId,
            lead_id: leadId,
            job_id: jobId,
            code: (faqRes.error as any)?.code ?? null,
            message: faqRes.error.message,
            details: (faqRes.error as any)?.details ?? null,
            hint: (faqRes.error as any)?.hint ?? null,
          });
        } else {
          const row = extractRpcRow(faqRes.data);
          const found = Boolean(row && (row.found === true || safeStr((row as any).answer, "")));
          if (found) {
            logEvent("kb:faq_lookup_success", {
              execution_id: executionId,
              trace_id: traceId,
              organization_id: organizationId,
              lead_id: leadId,
              job_id: jobId,
            });
            return {
              reply: clampText(
                safeStr((row as any).answer, "Gracias por escribirnos. ¿Querés que te ayude con una cita?"),
                950,
              ),
              statePatch: {
                stage: "DISCOVERY",
                lastIntent: "faq",
              },
              leadPatch: {},
              debugNote: "kb_faq",
            };
          }
        }
      } catch (err) {
        logEvent("kb:faq_lookup_failed", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          code: (err as any)?.code ?? null,
          message: safeStr((err as any)?.message ?? err, "unexpected_error"),
          details: (err as any)?.details ?? null,
          hint: (err as any)?.hint ?? null,
        });
      }
    }
  }

  const shouldRunLlmClassifier = isDentalOrg && llmEnabled &&
    deterministicIntent.intent === "unknown";

  if (shouldRunLlmClassifier) {
    const services = Array.isArray(clinicSettings?.services)
      ? (clinicSettings.services as any[])
        .map((service: any) => String(service?.name ?? service ?? "").trim())
        .filter(Boolean)
      : [
        "limpieza dental",
        "ortodoncia",
        "blanqueamiento",
        "implantes",
        "extracción",
        "consulta general",
      ];

    const history = (recentMessages ?? []).slice(-6).map((m: any) =>
      String(m.content ?? "")
    );

    classified = await classifyMessage({
      message: inboundText,
      conversationHistory: history,
      currentStage: safeStr((leadState as any)?.stage, "INITIAL"),
      nextExpected: safeStr((leadState as any)?.nextExpected, "") || null,
      collectedData: ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >,
      clinicServices: services,
    });
  }

  if (classified) {
    const existingCollected = ((leadState as any)?.collected ?? {}) as Record<
      string,
      unknown
    >;

    if (classified.service) {
      leadState = mergeLeadState(leadState, {
        collected: {
          ...existingCollected,
          service: classified.service,
        },
      });
    }

    if (classified.date || classified.time) {
      leadState = mergeLeadState(leadState, {
        collected: {
          ...(((leadState as any)?.collected ?? {}) as Record<string, unknown>),
          ...(classified.date ? { preferred_date: classified.date } : {}),
          ...(classified.time ? { preferred_time: classified.time } : {}),
        },
      });
    }

    if (
      classified.is_confirmation &&
      safeStr((leadState as any)?.nextExpected, "") === "confirm_booking"
    ) {
      logEvent("booking:confirmed", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        source: "classifier",
      });
      inboundText = "sí";
    }

    if (
      classified.is_negation &&
      safeStr((leadState as any)?.nextExpected, "") === "confirm_booking"
    ) {
      inboundText = "no";
    }

    if (classified.patient_name && !resolveLeadFullName(leadState)) {
      inboundText = classified.patient_name;
    }

    if (
      classified.intent === "book_appointment" ||
      classified.intent === "provide_service" ||
      classified.intent === "provide_datetime" ||
      classified.service ||
      classified.date ||
      classified.time
    ) {
      if (safeStr((leadState as any)?.stage, "") !== "BOOKING") {
        leadState = mergeLeadState(leadState, { stage: "BOOKING" });
      }
    }

    if (classified.urgency === "emergency") {
      if (isSevereEmergencyText(inboundText)) {
        const clinicPhone = safeStr(clinicSettings?.phone, "");
        const emergencyMsg = clinicPhone
          ? `Entiendo. Por seguridad, llamá de inmediato a la clínica: ${clinicPhone}.`
          : "Entiendo. Por seguridad, te recomiendo buscar atención inmediata.";

        return {
          reply: emergencyMsg,
          statePatch: { lastIntent: "emergency" },
          leadPatch: {},
          debugNote: "llm:emergency",
        };
      }

      leadState = mergeLeadState(leadState, {
        stage: "BOOKING",
        lastIntent: "book_appointment",
        nextExpected: "date_time",
        collected: {
          ...(((leadState as any)?.collected ?? {}) as Record<string, unknown>),
          service: safeStr(
            (((leadState as any)?.collected ?? {}) as Record<string, unknown>)?.service,
            "Revisión dental",
          ),
        },
      });
    }
  }

  // ---------------------------------------------------------------
  // NON-LLM PATH: name capture gate (solo cuando LLM está OFF)
  // ---------------------------------------------------------------
  if (!llmEnabled) {
    const nameStep = maybeHandleNameCapture({
      organizationId,
      leadState: leadState as any,
      inboundText,
      channel: safeStr((leadState as any)?.channel, ""),
    });

    if (nameStep?.replyText) {
      const leadPatch: Json = {};
      const capturedFullName = safeStr(
        (nameStep.statePatch as any)?.full_name,
        "",
      ).trim();
      if (capturedFullName && !capturedFullName.startsWith("Usuario ")) {
        leadPatch.full_name = capitalizeName(capturedFullName);
        leadPatch.first_name = String(leadPatch.full_name).split(/\s+/)[0] ??
          String(leadPatch.full_name);
      }

      return {
        reply: clampText(nameStep.replyText, 950),
        statePatch: nameStep.statePatch ?? {},
        leadPatch,
        debugNote: `name_gate:${safeStr(nameStep.debug?.route, "step")}`,
      };
    }
  }

  let dentalInterpreterResult: DentalInterpreterResult | null = null;
  if (normalizedBusinessType === "dental") {
    const deterministicResult = classifyDentalDeterministic(inboundText);
    if (deterministicResult.confidence >= 0.75) {
      dentalInterpreterResult = deterministicResult;
    }
  }
  let barbershopInterpreterResult: BarbershopInterpretedTurn | null = null;
  const barbershopInterpreterShadowEnabled = normalizedBusinessType === "barbershop" &&
    isEnabledFlag(clinicSettings?.barbershop_interpreter_shadow_enabled);
  const barbershopInterpreterRuntimeEnabled = normalizedBusinessType === "barbershop" &&
    isEnabledFlag(clinicSettings?.barbershop_interpreter_runtime_enabled);
  let barbershopInterpreterError: string | null = null;
  if (normalizedBusinessType === "barbershop" && (barbershopInterpreterShadowEnabled || barbershopInterpreterRuntimeEnabled)) {
    console.log(JSON.stringify({
      event: "barbershop:b4_interpreter_before",
      organization_id: organizationId,
      runtime_enabled: barbershopInterpreterRuntimeEnabled,
      shadow_enabled: barbershopInterpreterShadowEnabled,
      inbound_text: inboundText,
      business_type: normalizedBusinessType,
      has_openai_key: Boolean(Deno.env.get("OPENAI_API_KEY")),
    }));
    try {
      barbershopInterpreterResult = await interpretBarbershopTurn({
        inboundText,
        timezone: safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
        clinicSettings,
        state: (leadState ?? {}) as Record<string, unknown>,
        collected: (((leadState ?? {}) as Record<string, unknown>).collected ?? {}) as Record<string, unknown>,
        recentMessages: recentMessages.map((m) => ({ role: m.role, content: m.content })),
      });
    } catch (err) {
      barbershopInterpreterResult = null;
      barbershopInterpreterError = err instanceof Error ? err.message : String(err);
    }
    console.log(JSON.stringify({
      event: "barbershop:b4_interpreter_after",
      organization_id: organizationId,
      inbound_text: inboundText,
      interpreter_called: true,
      interpreter_error: barbershopInterpreterError,
      intent: barbershopInterpreterResult?.intent ?? null,
      confidence: barbershopInterpreterResult?.confidence ?? null,
      fields_found: (barbershopInterpreterResult as unknown as Record<string, unknown> | null)?.fields_found ?? null,
      next_step: (barbershopInterpreterResult as unknown as Record<string, unknown> | null)?.next_step ?? null,
      tool_needed: (barbershopInterpreterResult as unknown as Record<string, unknown> | null)?.tool_needed ?? null,
      used_for_routing: Boolean(
        barbershopInterpreterRuntimeEnabled &&
          barbershopInterpreterResult &&
          Number(barbershopInterpreterResult.confidence ?? 0) >= 0.7,
      ),
    }));
  }

  const engineLeadState = {
    ...((leadState ?? {}) as Record<string, unknown>),
    orgType: normalizedBusinessType,
  };

  const engineResult = runConversationEngine({
    organizationId,
    inboundText,
    leadState: engineLeadState as any,
    productKnowledge,
    clinicKnowledge,
    clinicSettings,
    recentMessages,
    dentalInterpreterResult,
    barbershopInterpreterResult,
  } as any);

  if (normalizedBusinessType === "barbershop") {
    const dbg = (engineResult as any)?.debug ?? {};
    const mode = safeStr(dbg?.barbershop_interpreter?.mode, "");
    const route = safeStr(dbg?.route, "");
    const source = mode === "runtime"
      ? "llm_runtime"
      : route.includes("fallback") || route.includes("unknown")
      ? "fallback"
      : "deterministic";
    console.log(JSON.stringify({
      event: "barbershop:b4_final_route",
      inbound_text: inboundText,
      final_intent: safeStr(dbg?.intent, ""),
      final_next_expected: safeStr(((engineResult as any)?.statePatch ?? {})?.nextExpected, ""),
      reply_preview: safeStr((engineResult as any)?.replyText, "").slice(0, 120),
      route,
      source,
    }));
  }

  const useDeterministicFirst = shouldUseDeterministicEngine({
    engineResult,
    leadState: leadState as Json | null,
  });

  if (!llmEnabled || useDeterministicFirst) {
    return await resolveEngineReply({
      supabase,
      engineResult,
      organizationId,
      leadId,
      inboundText,
      leadState: leadState as Json | null,
      clinicSettings,
      executionId,
      traceId,
      jobId,
    });
  }

  // ---------------------------------------------------------------
  // LLM PATH (only weak/unknown routes)
  // ---------------------------------------------------------------
  if (llmEnabled) {
    try {
      const llmResult = await runLlmTurn({
        organizationId,
        inboundText,
        leadState: leadState as any,
        orgSettings,
        recentMessages,
        clinicSettings,
      });

      if (llmResult) {
        let reply = clampText(llmResult.reply, 950);
        let statePatch: Json = llmResult.state_patch ?? {};
        let bookingReplyAuthorized = false;

        // Execute tool calls only for non-booking actions.
        // Booking side-effects must come from deterministic booking orchestration.
        const llmToolCalls = (llmResult.tool_calls ?? []).filter((tc) => {
          const name = safeStr((tc as any)?.name, "");
          return ![
            "book_appointment",
            "cancel_appointment",
            "reschedule_appointment",
          ].includes(name);
        });
        if (
          Array.isArray(llmResult.tool_calls) &&
          llmResult.tool_calls.length !== llmToolCalls.length
        ) {
          logEvent("booking:success_reply_blocked_no_insert", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id: organizationId,
            lead_id: leadId,
            job_id: jobId,
            error: "llm_appointment_tool_blocked",
          });
        }

        if (llmToolCalls.length > 0 && leadId) {
          const toolResult = await executeToolCalls({
            supabase,
            organizationId,
            leadId,
            leadState,
            toolCalls: llmToolCalls,
            executionId,
            traceId,
            jobId,
          });

          if (toolResult.reply) reply = clampText(toolResult.reply, 950);
          if (toolResult.statePatch) {
            statePatch = mergeStatePatches(statePatch, toolResult.statePatch);
          }
          bookingReplyAuthorized = toolResult.booking?.ok === true;
        }

        if (hasBookingSuccessClaim(reply) && !bookingReplyAuthorized) {
          logEvent("booking:success_reply_blocked_no_insert", {
            execution_id: executionId,
            trace_id: traceId,
            organization_id: organizationId,
            lead_id: leadId,
            job_id: jobId,
            error: "llm_reply_without_authorized_insert",
          });
          reply = BOOKING_FAILURE_REPLY;
        }

        // ---------------------------------------------------------
        // Lead name capture from LLM response
        // ---------------------------------------------------------
        const leadPatch: Json = {};

        // Heuristic: if reply contains "mucho gusto" the inbound is likely a name
        if (reply && reply.toLowerCase().includes("mucho gusto")) {
          const possibleName = String(inboundText ?? "").trim();
          if (
            possibleName &&
            possibleName.length < 40 &&
            possibleName.split(" ").length <= 4
          ) {
            leadPatch.full_name = capitalizeName(possibleName);
            leadPatch.first_name = String(leadPatch.full_name).split(" ")[0];
          }
        }

        // Primary: capture name from LLM state_patch collected fields
        // Runs when the "mucho gusto" heuristic didn't fire
        if (!leadPatch.full_name) {
          const patchedName = resolveLeadFullName(null, statePatch);
          if (patchedName && patchedName.length < 60) {
            leadPatch.full_name = capitalizeName(patchedName);
            leadPatch.first_name = String(leadPatch.full_name).split(" ")[0];
          }
        }

        return {
          reply: reply || "Gracias por escribirnos. ¿En qué te puedo ayudar?",
          statePatch,
          leadPatch,
          debugNote: "llm",
          bookingSuccessAuthorized: bookingReplyAuthorized,
        };
      }
    } catch (err) {
      console.error("[run-replies] LLM turn failed:", err);
    }

    return {
      reply: "Gracias por escribirnos. Dame un momento y ya te respondo.",
      statePatch: {},
      leadPatch: {},
      debugNote: "llm_fallback_safe",
    };
  }

  return await resolveEngineReply({
    supabase,
    engineResult,
    organizationId,
    leadId,
    inboundText,
    leadState: leadState as Json | null,
    clinicSettings,
    executionId,
    traceId,
    jobId,
  });
}

// =============================================================================
// PERSISTENCE HELPERS
// =============================================================================

async function insertOutboundMessage(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  channel: string;
  actor: "bot" | "operator";
  recipientId: string;
  reply: string;
}) {
  const {
    supabase,
    organizationId,
    leadId,
    channel,
    actor,
    recipientId,
    reply,
  } = args;

  const outMsgInsert = await supabase
    .from("messages")
    .insert({
      organization_id: organizationId,
      lead_id: leadId || null,
      channel,
      role: "assistant",
      actor,
      content: reply,
      created_at: nowIso(),
      channel_user_id: recipientId,
    })
    .select("id")
    .maybeSingle();

  if (outMsgInsert.error) {
    throw new Error(
      `outbound_message_insert_failed:${outMsgInsert.error.message}`,
    );
  }

  return outMsgInsert.data?.id ?? null;
}

async function insertManualOutboundMessage(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  channel: string;
  recipientId: string;
  text: string;
  originalPayload: Record<string, unknown>;
  providerMessageId: string | null;
  metaResponse: unknown;
}) {
  const {
    supabase,
    organizationId,
    leadId,
    channel,
    recipientId,
    text,
    originalPayload,
    providerMessageId,
    metaResponse,
  } = args;

  const messageCols = await getTableColumns(supabase, "messages");
  const row: Record<string, unknown> = {
    organization_id: organizationId,
    lead_id: leadId || null,
    channel,
    role: "assistant",
    actor: "staff",
    content: text,
    channel_user_id: recipientId,
    created_at: nowIso(),
    provider_message_id: providerMessageId,
  };
  if (messageCols.has("payload")) {
    row.payload = {
      ...originalPayload,
      meta_response: metaResponse ?? null,
    };
  }
  if (messageCols.has("external_id") && providerMessageId) {
    row.external_id = providerMessageId;
  }

  const ins = await supabase
    .from("messages")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (ins.error) {
    throw new Error(`manual_outbound_message_insert_failed:${ins.error.message}`);
  }
  return safeStr(ins.data?.id, "") || null;
}

async function deleteMessageIfExists(
  supabase: SupabaseClientType,
  messageId: string | null,
) {
  if (!messageId) return;
  await supabase.from("messages").delete().eq("id", messageId);
}

async function updateLeadAfterSend(args: {
  supabase: SupabaseClientType;
  leadId: string;
  reply: string;
  leadState: Json | null;
  statePatch: Json;
  leadPatch?: Json;
  businessType?: string;
}) {
  const { supabase, leadId, reply, leadState, statePatch, leadPatch, businessType } = args;
  if (!leadId) return;

  if (leadPatch && Object.keys(leadPatch).length > 0) {
    const leadPatchRes = await supabase
      .from("leads")
      .update(leadPatch)
      .eq("id", leadId);

    if (leadPatchRes.error) {
      throw new Error(`lead_patch_update_failed:${leadPatchRes.error.message}`);
    }
  }

  const nextState = normalizeLeadStateForBusinessType(mergeLeadState(leadState, {
    ...statePatch,
    last_bot_text: reply,
    last_bot_message_type: inferBotMessageType(reply, statePatch),
  }), safeStr(businessType, ""));
  logEvent("state:transition", {
    lead_id: leadId,
    stage_before: safeStr((leadState as any)?.stage, "INITIAL"),
    stage_after: safeStr((nextState as any)?.stage, "INITIAL"),
    intent_detected: safeStr((statePatch as any)?.lastIntent, ""),
    service_used: safeStr((nextState as any)?.collected?.service, ""),
  });

  const stateRes = await supabase
    .from("leads")
    .update({
      last_message_at: nowIso(),
      last_bot_reply_at: nowIso(),
      last_message_preview: reply.slice(0, 140),
      state: nextState,
    })
    .eq("id", leadId);

  if (stateRes.error) {
    throw new Error(`lead_state_update_failed:${stateRes.error.message}`);
  }
}

async function updateOutboundMessageProviderId(args: {
  supabase: SupabaseClientType;
  outboundMessageId: string | null;
  outboundProviderMessageId: string | null;
}) {
  const { supabase, outboundMessageId, outboundProviderMessageId } = args;
  if (!outboundMessageId || !outboundProviderMessageId) return;

  const res = await supabase
    .from("messages")
    .update({ provider_message_id: outboundProviderMessageId })
    .eq("id", outboundMessageId);

  if (res.error) {
    throw new Error(`message_provider_id_update_failed:${res.error.message}`);
  }
}

async function getTableColumns(
  supabase: SupabaseClientType,
  tableName: string,
): Promise<Set<string>> {
  const res = await supabase
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", tableName);
  return new Set((res.data ?? []).map((r: any) => safeStr(r?.column_name, "")));
}

async function markManualMessageSent(args: {
  supabase: SupabaseClientType;
  uiMessageId: string;
  text: string;
  recipientId: string;
  originalPayload: Record<string, unknown>;
  metaResponse: unknown;
  providerMessageId: string | null;
}) {
  const {
    supabase,
    uiMessageId,
    text,
    recipientId,
    originalPayload,
    metaResponse,
    providerMessageId,
  } = args;
  if (!uiMessageId) return false;
  const updates: Record<string, unknown> = {
    provider_message_id: providerMessageId,
    content: text,
    actor: "staff",
    channel_user_id: recipientId,
  };
  const messageCols = await getTableColumns(supabase, "messages");
  if (messageCols.has("status")) updates.status = "sent";
  if (messageCols.has("sent_at")) updates.sent_at = nowIso();
  if (messageCols.has("last_error")) updates.last_error = null;
  if (messageCols.has("payload")) {
    updates.payload = { ...originalPayload, meta_response: metaResponse ?? null };
  }
  if (messageCols.has("external_id") && providerMessageId) {
    updates.external_id = providerMessageId;
  }

  const res = await supabase
    .from("messages")
    .update(updates)
    .eq("id", uiMessageId);
  return !res.error;
}

async function scheduleBookingRecoveryFollowupBestEffort(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  channel: string;
  channelUserId: string;
  statePatch: Json;
  leadState: Json | null;
  clinicSettings: Record<string, unknown>;
  executionId: string;
  traceId: string;
  jobId: string;
}): Promise<void> {
  const {
    supabase,
    organizationId,
    leadId,
    channel,
    channelUserId,
    statePatch,
    leadState,
    clinicSettings,
    executionId,
    traceId,
    jobId,
  } = args;
  if (!leadId || !channelUserId) return;
  if (!isBookingInProgress(statePatch)) return;

  const delayMin = DEFAULT_BOOKING_RECOVERY_DELAY_MIN;
  const scheduledFor = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
  const bookingCollected = ((statePatch as any)?.collected ??
    (leadState as any)?.collected ??
    {}) as Record<string, unknown>;
  const serviceLabel = toPatientFacingServiceLabel(
    safeStr(bookingCollected.service, "Revisión dental"),
  );
  const recoveryText =
    `Hola 👋 ¿Seguimos con tu cita para la ${serviceLabel.toLowerCase()}? Puedo ayudarte a encontrar un horario.`;
  const providerPayload = {
    type: "booking_recovery",
    template_type: "recovery_20m",
    state_snapshot: {
      service: safeStr(bookingCollected.service, ""),
      preferred_date: safeStr(bookingCollected.preferred_date, ""),
      preferred_time: safeStr(bookingCollected.preferred_time, ""),
      next_expected: safeStr((statePatch as any)?.nextExpected, safeStr((leadState as any)?.nextExpected, "")),
    },
  };

  try {
    const columnsRes = await supabase
      .from("information_schema.columns")
      .select("column_name")
      .eq("table_schema", "public")
      .eq("table_name", "followup_outbox");
    const columns = new Set(
      (columnsRes.data ?? []).map((r: any) => safeStr(r?.column_name, "")),
    );
    const payload: Record<string, unknown> = {};
    const setIf = (column: string, value: unknown) => {
      if (columns.has(column)) payload[column] = value;
    };

    setIf("organization_id", organizationId);
    setIf("lead_id", leadId);
    setIf("channel", channel.includes("whatsapp") ? "whatsapp" : "messenger");
    setIf("channel_user_id", channelUserId);
    setIf("policy", "booking_recovery");
    setIf("reason", "booking_recovery");
    setIf("step", 1);
    setIf("max_steps", 1);
    setIf("scheduled_for", scheduledFor);
    setIf("due_at", scheduledFor);
    setIf("status", "queued");
    setIf("attempts", 0);
    setIf("attempt_count", 0);
    setIf("provider", channel.includes("whatsapp") ? "whatsapp" : "meta");
    setIf("provider_payload", providerPayload);
    setIf("payload", { ...providerPayload, text: recoveryText, channel });
    setIf("message_text", recoveryText);
    setIf("updated_at", nowIso());

    const onConflict = columns.has("reason")
      ? "organization_id,lead_id,reason,step"
      : "organization_id,lead_id,step";

    const upsertRes = await supabase
      .from("followup_outbox")
      .upsert(payload, { onConflict, ignoreDuplicates: true })
      .select("id")
      .maybeSingle();

    if (upsertRes.error) {
      throw upsertRes.error;
    }

    logEvent("followup:booking_recovery_queued", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: organizationId,
      lead_id: leadId,
      job_id: jobId,
      scheduled_for: scheduledFor,
      next_expected: safeStr((statePatch as any)?.nextExpected, ""),
    });
  } catch (error) {
    logEvent("followup:schedule_failed", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: organizationId,
      lead_id: leadId,
      job_id: jobId,
      policy: "booking_recovery",
      error: safeStr((error as any)?.message ?? error, "unknown_error"),
      state_next_expected: safeStr((statePatch as any)?.nextExpected, ""),
      timezone: safeStr(clinicSettings.timezone, DEFAULT_TIMEZONE),
    });
  }
}

// =============================================================================
// JOB PROCESSOR
// =============================================================================

async function processSingleJob(
  job: any,
  deps: ProcessJobDeps,
): Promise<JobResult> {
  const {
    supabase,
    metaGraphVersion,
    pageAccessToken,
    whatsappAccessToken,
    whatsappPhoneNumberId,
    organizationId,
    executionId,
    productKnowledge,
    clinicKnowledge,
    clinicSettings,
    orgSettings,
    llmEnabled,
  } = deps;

  const jobId = safeStr(job.id);
  const traceId = safeStr((job.payload as Json | null)?.trace_id, "") ||
    crypto.randomUUID();
  const leadId = safeStr(job.lead_id, "");
  const jobCreatedAt = safeStr(job.created_at, "");
  const payloadSource = safeStr((job?.payload as any)?.source, "").toLowerCase();
  const isUiManual = payloadSource === "ui_manual";
  const channel = normalizeChannel(
    safeStr(
      isUiManual ? (job?.payload as any)?.channel : job.channel,
      isUiManual ? "whatsapp" : "messenger",
    ),
  );
  const recipientId = safeStr(job.channel_user_id, "") ||
    safeStr(job.recipient_id, "") ||
    safeStr(job.psid, "");
  const payloadRecipientId = safeStr((job.payload as any)?.recipient_id, "");
  const payloadRecipientNested = safeStr((job.payload as any)?.recipient?.id, "");
  const effectiveRecipientId = payloadRecipientId || payloadRecipientNested || recipientId;

  let outboundMessageId: string | null = null;
  let effectiveOrganizationId = organizationId;

  if (!["messenger", "whatsapp"].includes(channel)) {
    throw new Error(`unsupported_channel:${channel}`);
  }

  if (!effectiveRecipientId) {
    throw new Error("missing_recipient_id");
  }

  // 1) pre-send dedupe
  if (leadId && jobCreatedAt && !isOperatorOutboundJob(job)) {
    const alreadyResponded = await hasResponseAfterJobCreation(
      supabase,
      leadId,
      jobCreatedAt,
    );
    if (alreadyResponded) {
      await finalizeOutboxJob(supabase, jobId, {
        status: "sent",
        sent_at: nowIso(),
        last_error: "deduped:response_already_exists",
      });
      return {
        status: "sent",
        sentAt: nowIso(),
        lastError: "deduped:response_already_exists",
      };
    }
  }

  const manualText = safeStr(job?.payload?.text, "");
  const inboundText = safeStr(job?.content, "") ||
    safeStr(job?.payload?.text, "");
  const isOperatorOutbound = isOperatorOutboundJob(job);
  const uiMessageId = safeStr((job?.payload as any)?.ui_message_id, "");

  if (isUiManual || isOperatorOutbound) {
    const manualChannel = "whatsapp";
    logEvent("manual_outbound:queued", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: organizationId,
      lead_id: leadId,
      job_id: jobId,
      channel: manualChannel,
    });
    if (!manualText) {
      throw new Error("manual_outbound_failed:empty_manual_text");
    }
    logEvent("manual_outbound:send_attempt", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: organizationId,
      lead_id: leadId,
      job_id: jobId,
      channel: manualChannel,
      recipient_id: effectiveRecipientId,
    });

    let manualMetaResp: any = null;
    try {
      manualMetaResp = await sendViaMetaAdapter({
        channel: manualChannel as "messenger" | "whatsapp",
        graphVersion: metaGraphVersion,
        recipientId: effectiveRecipientId,
        text: manualText,
        pageAccessToken,
        whatsappAccessToken,
        whatsappPhoneNumberId,
      });
    } catch (err: any) {
      const manualError = `manual_outbound_failed:${safeStr(err?.message, String(err))}`;
      logEvent("manual_outbound:send_failed", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        error: manualError,
      });
      throw new Error(manualError);
    }

    if (!manualMetaResp?.ok) {
      const manualError =
        `manual_outbound_failed:meta_send_failed:${manualMetaResp?.status}:${
          JSON.stringify(manualMetaResp?.data ?? {})
        }`;
      logEvent("manual_outbound:send_failed", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        error: manualError,
      });
      throw new Error(manualError);
    }

    const providerMessageId = safeStr(
      manualMetaResp?.data?.message_id ?? manualMetaResp?.data?.messages?.[0]?.id,
      "",
    ) || null;

    let persistedMessageId: string | null = null;
    const uiUpdated = await markManualMessageSent({
      supabase,
      uiMessageId,
      text: manualText,
      recipientId: effectiveRecipientId,
      originalPayload: ((job?.payload ?? {}) as Record<string, unknown>),
      metaResponse: manualMetaResp?.data ?? null,
      providerMessageId,
    });
    if (uiUpdated) {
      persistedMessageId = uiMessageId;
    } else {
      persistedMessageId = await insertManualOutboundMessage({
        supabase,
        organizationId: effectiveOrganizationId,
        leadId,
        channel: "whatsapp",
        recipientId: effectiveRecipientId,
        text: manualText,
        originalPayload: ((job?.payload ?? {}) as Record<string, unknown>),
        providerMessageId,
        metaResponse: manualMetaResp?.data ?? null,
      });
    }

    const outboxColumns = await getTableColumns(supabase, "reply_outbox");
    const manualUpdates: Record<string, unknown> = {
      status: "sent",
      sent_at: nowIso(),
      last_error: "debug:manual_outbound_sent",
      outbound_message_id: persistedMessageId,
      meta_message_id: providerMessageId,
    };
    if (outboxColumns.has("provider_message_id")) {
      manualUpdates.provider_message_id = providerMessageId;
    }

    await finalizeOutboxJob(supabase, jobId, manualUpdates);

    logEvent("manual_outbound:send_success", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: organizationId,
      lead_id: leadId,
      job_id: jobId,
      provider_message_id: providerMessageId,
    });

    return {
      status: "sent",
      sentAt: nowIso(),
      lastError: "debug:manual_outbound_sent",
      outboundMessageId: persistedMessageId,
      outboundProviderMessageId: providerMessageId,
    };
  }

  const isLiveChatChannel = channel === "whatsapp" || channel === "messenger";
  const isFollowupOrReminder = payloadSource.includes("followup") ||
    payloadSource.includes("reminder");
  if (isLiveChatChannel && !isFollowupOrReminder && jobCreatedAt) {
    const createdTs = Date.parse(jobCreatedAt);
    const staleSeconds = Math.max(
      60,
      Number(Deno.env.get("RUN_REPLIES_STALE_OUTBOX_SECONDS") ?? DEFAULT_STALE_OUTBOX_SECONDS) ||
        DEFAULT_STALE_OUTBOX_SECONDS,
    );
    const staleMs = staleSeconds * 1000;
    const ageMs = Number.isFinite(createdTs) ? Date.now() - createdTs : 0;
    const ageSeconds = Math.max(0, Math.floor(ageMs / 1000));
    if (Number.isFinite(createdTs) && ageMs > staleMs) {
      await finalizeOutboxJob(supabase, jobId, {
        status: "failed",
        sent_at: null,
        last_error: "skipped:stale_outbox_job",
      });
      logEvent("run_replies_skip_stale_job", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: effectiveOrganizationId,
        lead_id: leadId,
        job_id: jobId,
        channel,
        channel_user_id: effectiveRecipientId,
        source: payloadSource,
        created_at: jobCreatedAt,
        age_seconds: ageSeconds,
        threshold_seconds: staleSeconds,
        reason: "stale_outbox_job",
      });
      return {
        status: "failed",
        sentAt: null,
        lastError: "skipped:stale_outbox_job",
      };
    }
  }

  let leadState: Json | null = null;
  if (leadId) {
    const leadRes = await supabase
      .from("leads")
      .select("state, full_name, first_name, organization_id")
      .eq("id", leadId)
      .maybeSingle();

    if (leadRes.error) {
      throw new Error(`lead_load_failed:${leadRes.error.message}`);
    }

    leadState = ((leadRes.data?.state ?? {}) as Json) || {};
    const leadOrganizationId = safeStr(
      (leadRes.data as any)?.organization_id,
      organizationId,
    ).trim();
    if (leadOrganizationId) {
      effectiveOrganizationId = leadOrganizationId;
    }
    if (leadOrganizationId && leadOrganizationId !== organizationId) {
      logEvent("organization_id_mismatch_job_vs_lead", {
        execution_id: executionId,
        trace_id: traceId,
        job_id: jobId,
        lead_id: leadId,
        job_organization_id: organizationId,
        lead_organization_id: leadOrganizationId,
      });
    }
    if (leadRes.data?.full_name && !(leadState as any).full_name) {
      leadState = {
        ...leadState,
        full_name: leadRes.data.full_name,
        first_name: leadRes.data.first_name ?? undefined,
      };
    }

    const automationMode = safeStr((leadState as any)?.automation_mode, "");
    if (automationMode === "human_takeover") {
      await finalizeOutboxJob(supabase, jobId, {
        status: "sent",
        sent_at: nowIso(),
        last_error: "skipped:human_takeover_active",
      });
      logEvent("run_replies_skip_human_takeover", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: effectiveOrganizationId,
        lead_id: leadId,
        job_id: jobId,
      });
      return {
        status: "sent",
        sentAt: nowIso(),
        lastError: "skipped:human_takeover_active",
      };
    }
  }

  const recentMessages = leadId
    ? await loadRecentMessages(supabase, leadId)
    : [];

  const automationEnabled = (orgSettings as any)?.automation_enabled !== false;
  const channelAutomationEnabled = channel === "messenger"
    ? (orgSettings as any)?.messenger_enabled !== false
    : channel === "whatsapp"
    ? (orgSettings as any)?.whatsapp_enabled !== false
    : true;
  if (!automationEnabled || !channelAutomationEnabled) {
    const reason = !automationEnabled
      ? "skipped:automation_disabled"
      : `skipped:${channel}_disabled`;
    await finalizeOutboxJob(supabase, jobId, {
      status: "sent",
      sent_at: nowIso(),
      last_error: reason,
    });
    logEvent("run_replies_skip_automation_disabled", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: effectiveOrganizationId,
      lead_id: leadId,
      job_id: jobId,
      channel,
      reason,
    });
    return {
      status: "sent",
      sentAt: nowIso(),
      lastError: reason,
    };
  }

  leadState = normalizeLeadStateForBusinessType(
    leadState,
    safeStr((orgSettings as any)?.business_type, ""),
  );

  const generated = await generateReply({
    supabase,
    organizationId: effectiveOrganizationId,
    leadId,
    leadState,
    inboundText,
    orgSettings,
    recentMessages,
    productKnowledge,
    clinicKnowledge,
    clinicSettings,
    llmEnabled,
    isOperatorOutbound,
    manualText,
    executionId,
    traceId,
    jobId,
  });

  let reply = clampText(generated.reply, 950);
  let statePatch = generated.statePatch ?? {};
  const leadPatch = generated.leadPatch ?? {};
  const debugNote = safeStr(generated.debugNote, "");
  let bookingSuccessAuthorized = generated.bookingSuccessAuthorized === true;

  const businessType = safeStr((orgSettings as any)?.business_type, "").toLowerCase();
  const leadOrgType = safeStr((leadState as any)?.orgType, "").toLowerCase();
  const isBarbershopOrg = businessType === "barbershop" || leadOrgType === "barbershop";
  if (isBarbershopOrg) {
    const gateResult = await validateBarbershopPreconfirm({
      supabase,
      organizationId: effectiveOrganizationId,
      leadId,
      timezone: safeStr((clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE,
      reply,
      statePatch,
    });
    if (gateResult.blocked) {
      reply = clampText(gateResult.reply, 950);
      statePatch = gateResult.statePatch;
      bookingSuccessAuthorized = false;
    }
  }

  if (hasBookingSuccessClaim(reply) && !bookingSuccessAuthorized) {
    logEvent("booking:success_reply_blocked_no_insert", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: effectiveOrganizationId,
      lead_id: leadId,
      job_id: jobId,
      error: "process_guard_blocked_unauthorized_success_text",
    });
    reply = BOOKING_FAILURE_REPLY;
  }

  reply = preventRepeatedReplyLoop(reply, leadState, statePatch);

  logEvent("response_route", {
    execution_id: executionId,
    trace_id: traceId,
    organization_id: effectiveOrganizationId,
    lead_id: leadId,
    job_id: jobId,
    channel,
    response_route: "booking_v2",
    debug_note: "booking_v2",
  });

  if (!reply) {
    await finalizeOutboxJob(supabase, jobId, {
      status: "failed",
      last_error: "empty_reply_generated",
    });
    return { status: "failed", lastError: "empty_reply_generated" };
  }

  // 2) pre-send race dedupe
  if (leadId && jobCreatedAt && !isOperatorOutbound) {
    const alreadyResponded = await hasResponseAfterJobCreation(
      supabase,
      leadId,
      jobCreatedAt,
    );
    if (alreadyResponded) {
      await finalizeOutboxJob(supabase, jobId, {
        status: "sent",
        sent_at: nowIso(),
        last_error: "deduped:race_condition_caught",
      });
      return {
        status: "sent",
        sentAt: nowIso(),
        lastError: "deduped:race_condition_caught",
      };
    }
  }

  // 3) persist outbound before send
  outboundMessageId = await insertOutboundMessage({
    supabase,
    organizationId: effectiveOrganizationId,
    leadId,
    channel,
    actor: isOperatorOutbound ? "operator" : "bot",
    recipientId: effectiveRecipientId,
    reply,
  });

  // 4) send to provider
  const interactiveButtons = buildInteractiveButtonsForState(statePatch);
  const metaResp = await sendViaMetaAdapter({
    channel: channel as "messenger" | "whatsapp",
    graphVersion: metaGraphVersion,
    recipientId: effectiveRecipientId,
    text: reply,
    buttons: interactiveButtons.length > 0 ? interactiveButtons : undefined,
    pageAccessToken,
    whatsappAccessToken,
    whatsappPhoneNumberId,
  });

  if (!metaResp?.ok) {
    await deleteMessageIfExists(supabase, outboundMessageId);
    throw new Error(
      `meta_send_failed:${metaResp?.status}:${
        JSON.stringify(metaResp?.data ?? {})
      }`,
    );
  }

  const outboundProviderMessageId = safeStr(
    metaResp?.data?.message_id ?? metaResp?.data?.messages?.[0]?.id,
    "",
  ) || null;

  // 5) update lead and message metadata before terminalizing outbox
  await updateLeadAfterSend({
    supabase,
    leadId,
    reply,
    leadState,
    statePatch,
    leadPatch,
    businessType: safeStr((orgSettings as any)?.business_type, ""),
  });

  await updateOutboundMessageProviderId({
    supabase,
    outboundMessageId,
    outboundProviderMessageId,
  });

  if (ENABLE_BOOKING_RECOVERY_FOLLOWUP) {
    await scheduleBookingRecoveryFollowupBestEffort({
      supabase,
      organizationId: effectiveOrganizationId,
      leadId,
      channel,
      channelUserId: effectiveRecipientId,
      statePatch,
      leadState,
      clinicSettings,
      executionId,
      traceId,
      jobId,
    });
  }

  // 6) terminalize exactly once
  await finalizeOutboxJob(supabase, jobId, {
    status: "sent",
    sent_at: nowIso(),
    outbound_message_id: outboundMessageId,
    meta_message_id: outboundProviderMessageId,
    last_error: null,
  });

  logEvent("run_replies_job_sent", {
    execution_id: executionId,
    trace_id: traceId,
    organization_id: effectiveOrganizationId,
    lead_id: leadId,
    job_id: jobId,
    debug_note: debugNote,
  });

  return {
    status: "sent",
    sentAt: nowIso(),
    lastError: null,
    outboundMessageId,
    outboundProviderMessageId,
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const runRepliesSecret = normalizeSecretValue(env("RUN_REPLIES_SECRET"));
    const providedSecret = normalizeSecretValue(
      req.headers.get("x-run-replies-secret") ?? "",
    );
    if (!providedSecret || providedSecret !== runRepliesSecret) {
      return j(401, { ok: false, error: "unauthorized" });
    }

    const body = await req.json().catch(() => ({}));
    const organization_id = safeStr(
      body?.organization_id,
      safeStr(body?.org_id, ""),
    ).trim();
    if (!organization_id) {
      return j(400, { ok: false, error: "missing_organization_id" });
    }

    const executionId = crypto.randomUUID();
    const workerId = `run-replies:${executionId}`;

    const supabaseUrl = env("SUPABASE_URL");
    const supabaseServiceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const metaGraphVersion = safeStr(
      Deno.env.get("META_GRAPH_VERSION"),
      "v19.0",
    );

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    let pageAccessToken = normalizeSecretValue(
      safeStr(Deno.env.get("META_PAGE_ACCESS_TOKEN"), ""),
    );
    let whatsappAccessToken = normalizeSecretValue(
      safeStr(Deno.env.get("WHATSAPP_ACCESS_TOKEN"), ""),
    );
    let whatsappPhoneNumberId = normalizeSecretValue(
      safeStr(Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"), ""),
    );

    const sec = await loadOrgSecretWithFallback(supabase, organization_id);
    if (sec) {
      const token = normalizeSecretValue(
        safeStr((sec as any).meta_page_access_token, ""),
      );
      const waToken = normalizeSecretValue(
        safeStr((sec as any).whatsapp_access_token, ""),
      );
      const waPhoneNumberId = normalizeSecretValue(
        safeStr((sec as any).whatsapp_phone_number_id, ""),
      );
      if (token) pageAccessToken = token;
      if (waToken) whatsappAccessToken = waToken;
      if (waPhoneNumberId) whatsappPhoneNumberId = waPhoneNumberId;
    }

    const orgSettingsRes = await supabase
      .from("org_settings")
      .select(
        "llm_brain_enabled, system_prompt, business_type, brand_name, automation_enabled, messenger_enabled, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_enabled",
      )
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (orgSettingsRes.error) {
      return j(500, {
        ok: false,
        error: `org_settings_load_failed:${orgSettingsRes.error.message}`,
      });
    }

    const orgSettings = (orgSettingsRes.data as any) ?? {};
    let orgOptionalConfig: Record<string, unknown> = {};
    try {
      const optionalRes = await supabase
        .from("org_settings")
        .select(
          "timezone, hours, services, phone, address, same_day_booking_cutoff, buffer_min",
        )
        .eq("organization_id", organization_id)
        .maybeSingle();
      if (!optionalRes.error && optionalRes.data && typeof optionalRes.data === "object") {
        orgOptionalConfig = optionalRes.data as Record<string, unknown>;
      } else if (optionalRes.error) {
        logEvent("org_settings_optional_config_load_warn", {
          organization_id,
          error: optionalRes.error.message,
        });
      }
    } catch (err) {
      logEvent("org_settings_optional_config_load_warn", {
        organization_id,
        error: safeStr((err as any)?.message ?? err, "unknown_error"),
      });
    }
    const llmEnabled = Boolean(orgSettings.llm_brain_enabled);

    const productKnowledge = await loadProductKnowledge(
      supabase,
      organization_id,
    );
    const clinicKnowledge = await loadClinicKnowledge(
      supabase,
      organization_id,
    );
    const clinicSettings = await loadClinicSettings(supabase, organization_id);
    const businessType = safeStr(orgSettings.business_type, "").toLowerCase();
    if (!clinicSettings.brand_name) {
      clinicSettings.brand_name = safeStr(orgSettings.brand_name, "");
    }
    if (!clinicSettings.business_type) {
      clinicSettings.business_type = businessType;
    }
    if (businessType === "barbershop") {
      const barbershopSettings = await loadBarbershopSettings(supabase, organization_id);
      Object.assign(clinicSettings, barbershopSettings);
    }
    if (!clinicSettings.timezone) {
      clinicSettings.timezone = safeStr(orgOptionalConfig.timezone, DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE;
    }
    if (!clinicSettings.same_day_booking_cutoff) {
      clinicSettings.same_day_booking_cutoff = safeStr(
        orgOptionalConfig.same_day_booking_cutoff,
        DEFAULT_SAME_DAY_BOOKING_CUTOFF,
      ) || DEFAULT_SAME_DAY_BOOKING_CUTOFF;
    }
    if (!clinicSettings.buffer_min) {
      clinicSettings.buffer_min = Number(orgOptionalConfig.buffer_min) || DEFAULT_BUFFER_MIN;
    }
    if (!clinicSettings.phone) {
      clinicSettings.phone = safeStr(orgOptionalConfig.phone, "");
    }
    if (!clinicSettings.address) {
      clinicSettings.address = safeStr(orgOptionalConfig.address, "");
    }
    if (!clinicSettings.clinic_name) {
      clinicSettings.clinic_name = safeStr(orgSettings.brand_name, "");
    }
    if (
      (!Array.isArray(clinicSettings.services) || clinicSettings.services.length === 0) &&
      Array.isArray(orgOptionalConfig.services)
    ) {
      clinicSettings.services = mergeDentalServiceTemplates(orgOptionalConfig.services as unknown[]);
    }
    if (
      (!clinicSettings.hours || typeof clinicSettings.hours !== "object") &&
      orgOptionalConfig.hours &&
      typeof orgOptionalConfig.hours === "object"
    ) {
      clinicSettings.hours = orgOptionalConfig.hours;
    }
    // Load providers for auto-assignment
    const { data: providersData } = await supabase
      .from("providers")
      .select("name, services, schedule, specialty, active")
      .eq("organization_id", organization_id)
      .eq("active", true)
      .eq("role", "doctor");
    if (providersData && providersData.length > 0) {
      (clinicSettings as any).providers = providersData;
    }

    const limit = Math.max(1, Math.min(Number(body?.limit ?? 10) || 10, 50));
    const processManualOnly = body?.process_manual === true;
    const lockTtlSeconds = Math.max(
      300,
      Math.min(Number(body?.lock_ttl_seconds ?? 300) || 300, 1800),
    );
    const staleLockCutoff = new Date(Date.now() - lockTtlSeconds * 1000)
      .toISOString();

    // reclaim stale processing rows
    const reclaimRes = await supabase
      .from("reply_outbox")
      .update({
        status: "failed",
        processing_started_at: null,
        locked_at: null,
        locked_by: null,
        claimed_at: null,
        claimed_by: null,
        last_error: "reclaimed:processing_ttl_expired",
        updated_at: nowIso(),
      })
      .eq("organization_id", organization_id)
      .eq("status", "processing")
      .lte("processing_started_at", staleLockCutoff)
      .select("id");

    const reclaimedCount = reclaimRes.error ? 0 : reclaimRes.data?.length ?? 0;

    const manualClaimRes = await claimManualUiJobs({
      supabase,
      organizationId: organization_id,
      limit,
      lockOwner: workerId,
    });
    if (manualClaimRes.error) {
      return j(500, {
        ok: false,
        error: `manual_claim_failed:${manualClaimRes.error.message}`,
      });
    }

    const manualJobs = Array.isArray(manualClaimRes.data) ? manualClaimRes.data : [];
    const remainingLimit = processManualOnly
      ? 0
      : Math.max(0, limit - manualJobs.length);

    let rpcJobs: any[] = [];
    if (remainingLimit > 0) {
      const claimRes = await claimJobsViaRpc({
        supabase,
        organizationId: organization_id,
        limit: remainingLimit,
        lockOwner: workerId,
        lockTtlSeconds,
      });

      if (claimRes.error) {
        return j(500, {
          ok: false,
          error: `claim_rpc_failed:${claimRes.error.message}`,
        });
      }
      rpcJobs = Array.isArray(claimRes.data) ? claimRes.data : [];
    }

    const jobs = [...manualJobs, ...rpcJobs];

    logEvent("run_replies_claimed", {
      execution_id: executionId,
      organization_id,
      claimed: jobs.length,
      manual_claimed: manualJobs.length,
      reclaimed: reclaimedCount,
    });

    if (!jobs.length) {
      return j(200, {
        ok: true,
        execution_id: executionId,
        org_id: organization_id,
        claimed_count: 0,
        sent_count: 0,
        failed_count: 0,
        deduped_count: 0,
      });
    }

    let sent = 0;
    let failed = 0;
    let deduped = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const job of jobs) {
      const jobId = safeStr(job.id);
      const attemptCount = Number((job as any).attempt_count ?? 0) + 1;
      const jobOrgId = safeStr((job as any).organization_id, "");
      if (jobOrgId && jobOrgId !== organization_id) {
        logEvent("organization_id_mismatch_claimed_job", {
          execution_id: executionId,
          claimed_organization_id: organization_id,
          job_organization_id: jobOrgId,
          job_id: jobId,
        });
      }

      try {
        const result = await processSingleJob(job, {
          supabase,
          metaGraphVersion,
          pageAccessToken,
          whatsappAccessToken,
          whatsappPhoneNumberId,
          organizationId: organization_id,
          executionId,
          workerId,
          productKnowledge,
          clinicKnowledge,
          clinicSettings,
          orgSettings,
          llmEnabled,
        });

        if (result.lastError?.startsWith("deduped:")) {
          deduped++;
          sent++;
        } else if (result.status === "sent") {
          sent++;
        } else {
          failed++;
        }
      } catch (e: any) {
        const msg = safeStr(e?.message, String(e));
        const source = safeStr((job?.payload as any)?.source, "").toLowerCase();
        const isManualJob = source.includes("ui_manual") || source.includes("manual");
        const normalizedMsg = isManualJob && !msg.startsWith("manual_outbound_failed:")
          ? `manual_outbound_failed:${msg}`
          : msg;
        const retryableStatus = parseMetaStatus(msg);
        const isRetryable = msg.includes("429") ||
          msg.includes("timeout") ||
          msg.includes("network") ||
          retryableStatus === 429 ||
          (retryableStatus !== null && retryableStatus >= 500);

        const maxRetries = 3;
        const shouldRetry = !isManualJob && isRetryable && attemptCount < maxRetries;
        const terminalDead = attemptCount >= maxRetries;

        failures.push({ id: jobId, error: normalizedMsg });
        failed++;

        try {
          const failUpdates: Record<string, unknown> = {
            status: shouldRetry ? "queued" : isManualJob ? "failed" : terminalDead ? "dead" : "failed",
            scheduled_for: shouldRetry
              ? plusSecondsIso(backoffSeconds(attemptCount))
              : nowIso(),
            last_error: normalizedMsg,
          };
          if (isManualJob) failUpdates.sent_at = null;
          await finalizeOutboxJob(supabase, jobId, failUpdates);
        } catch (finalizeErr) {
          console.error("[run-replies] finalize after failure also failed", {
            jobId,
            msg,
            finalizeErr,
          });
        }

        logEvent("run_replies_job_failed", {
          execution_id: executionId,
          organization_id,
          job_id: jobId,
          error: normalizedMsg,
          should_retry: shouldRetry,
          attempt_count: attemptCount,
        });
      }
    }

    return j(200, {
      ok: true,
      execution_id: executionId,
      org_id: organization_id,
      claimed_count: jobs.length,
      sent_count: sent,
      failed_count: failed,
      deduped_count: deduped,
      failures,
    });
  } catch (err: any) {
    return j(500, {
      ok: false,
      error: safeStr(err?.message, String(err)),
    });
  }
});
