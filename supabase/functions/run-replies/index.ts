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
  type ActionExecutionResult,
  type BookingActionResult,
  executeToolAction,
  type ToolActionName,
} from "./domain/actionExecutor.ts";
import { runLlmTurn } from "./domain/llmTurn.ts";
import { classifyDentalDeterministic } from "./domain/dental/dentalDeterministicClassifier.ts";
import type { DentalInterpreterResult } from "./domain/interpreter/dentalInterpreterTypes.ts";
import {
  type BarbershopInterpretedTurn,
  getBarbershopInterpreterRuntimeStatus,
  interpretBarbershopTurn,
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
import { normalizeInboundFromPayloadAction } from "../shared/whatsappNormalization.ts";
import {
  checkSlotAvailability,
  getAvailabilityDiagnosticsForDay,
  getAvailableSlotsForDay,
  suggestNextAvailableSlots,
} from "./domain/availabilityCore.ts";
import {
  type BookingHoldRow,
  buildIsoTimestampForHold,
  createBookingHold,
  findActiveBookingHoldForSlot,
} from "./domain/bookingHolds.ts";
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
import { formatBarberLineReply } from "./domain/barberLinePersonality.ts";
import {
  buildBarbershopAvailabilityButtons,
  buildExpandedBarbershopTimeSlotsList,
  formatBarbershopAvailabilityListBody,
} from "./domain/barbershopResponseComposer.ts";
import { normalizeLeadStateForBusinessType } from "./domain/stateNormalization.ts";
import {
  activateHumanTakeoverState,
  isHumanTakeoverActive,
  shouldAllowAutomationDuringTakeover,
} from "./domain/humanTakeover.ts";
import {
  getBusinessTypeForOrg,
  getFaqsForOrg,
  getHoursForOrg,
  getProvidersForOrg,
  getServicesForOrg,
  loadOrganizationSettings,
} from "./domain/organizationSettings.ts";
import {
  buildWhatsAppFlowCtaMessage,
  type InteractiveButton,
  sendViaMetaAdapter,
  type WhatsAppFlowCtaSpec,
  type WhatsAppInteractiveListSpec,
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
  payloadAction?: string | null;
}

interface GenerateReplyResult {
  reply: string;
  statePatch: Json;
  leadPatch?: Json;
  debugNote: string;
  bookingSuccessAuthorized?: boolean;
  flowCta?: WhatsAppFlowCtaSpec;
  interactiveButtons?: InteractiveButton[];
  interactiveList?: WhatsAppInteractiveListSpec;
}

type BarbershopProviderOption = {
  id: string;
  name: string;
  active: boolean;
};

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

function isBotAutoReplyPaused(): boolean {
  return safeStr(Deno.env.get("BOT_AUTO_REPLY_PAUSED"), "").trim()
    .toLowerCase() === "true";
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

function countOpenDays(
  hours: Record<string, unknown> | null | undefined,
): number {
  if (!hours || typeof hours !== "object") return 0;
  return Object.values(hours).filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    const closed = Boolean(item.closed ?? item.is_closed);
    const open = safeStr(item.open ?? item.open_time, "");
    const close = safeStr(item.close ?? item.close_time, "");
    return !closed && Boolean(open) && Boolean(close);
  }).length;
}

function getHoursDayKeyFromDate(dateIso: string): string | null {
  const date = safeStr(dateIso, "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const dayIndex = new Date(`${date}T12:00:00`).getDay();
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return keys[dayIndex] ?? null;
}

function isDateClosedInHours(
  dateIso: string,
  hours: Record<string, unknown> | null | undefined,
): boolean {
  if (!hours || typeof hours !== "object") return false;
  const key = getHoursDayKeyFromDate(dateIso);
  if (!key) return false;
  const entry = (hours as Record<string, unknown>)[key];
  if (!entry || typeof entry !== "object") return false;
  const item = entry as Record<string, unknown>;
  const closed = Boolean(item.closed ?? item.is_closed);
  const open = safeStr(item.open ?? item.open_time, "");
  const close = safeStr(item.close ?? item.close_time, "");
  return closed || !open || !close;
}

function getBarbershopSettingsHealth(clinicSettings: Record<string, unknown>) {
  const services = Array.isArray((clinicSettings as any).services)
    ? (clinicSettings as any).services
    : [];
  const providers = Array.isArray((clinicSettings as any).providers)
    ? (clinicSettings as any).providers
    : (Array.isArray((clinicSettings as any).barbers)
      ? (clinicSettings as any).barbers
      : []);
  const hours =
    (clinicSettings?.hours && typeof clinicSettings.hours === "object")
      ? (clinicSettings.hours as Record<string, unknown>)
      : {};
  const openDays = countOpenDays(hours);
  return {
    servicesCount: services.length,
    providersCount: providers.length,
    hoursOpenDaysCount: openDays,
    hasServices: services.length > 0,
    hasProviders: providers.length > 0,
    hasOpenDays: openDays > 0,
  };
}

function getIntegrationsConfig(
  clinicSettings: Record<string, unknown>,
): Record<string, unknown> {
  const raw = (clinicSettings as any)?.integrations;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function isUsableBookingFlowId(value: string): boolean {
  const id = safeStr(value, "").trim();
  if (!id) return false;
  const lowered = id.toLowerCase();
  if (
    lowered.includes("pending") ||
    lowered.includes("tbd") ||
    lowered.includes("placeholder") ||
    lowered.includes("meta_flow_id")
  ) return false;
  return true;
}

function normalizePayloadActionValue(raw: string): string {
  const v = safeStr(raw, "").trim();
  if (!v) return "";
  return v.replace(/^action:/i, "").trim();
}

function isDentalBusinessTypeValue(raw: string): boolean {
  const value = safeStr(raw, "").toLowerCase();
  return value === "dental" || value === "clinic" || value.includes("dental");
}

function normalizeDentalGuardChoiceActionValue(raw: string): string {
  const value = normalizePayloadActionValue(raw);
  if (!value) return "";
  const text = normalizeTextForMatch(value).replace(/[_-]+/g, " ").replace(
    /\s+/g,
    " ",
  ).trim();
  if (
    value === "additional_booking" ||
    text === "additional booking" ||
    text === "agendar otra cita" ||
    text === "agendar otra" ||
    text === "book another" ||
    text === "another appointment" ||
    /\botra cita\b/.test(text)
  ) {
    return "additional_booking";
  }
  if (
    value === "keep_existing_booking" ||
    text === "keep existing booking" ||
    text === "mantener mi cita" ||
    text === "mantener cita"
  ) {
    return "keep_existing_booking";
  }
  if (
    value === "reschedule_booking" ||
    text === "reschedule booking" ||
    text === "cambiar mi cita" ||
    text === "cambiar cita"
  ) {
    return "reschedule_booking";
  }
  return value;
}

function hasNaturalDateOrTimeSignal(input: string): boolean {
  const t = normalizeTextForMatch(input);
  if (!t) return false;
  if (
    /\b(hoy|manana|mañana|pasado manana|pasado mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/
      .test(t)
  ) {
    return true;
  }
  if (/\b(a las|alas)\s*\d{1,2}\b/.test(t)) return true;
  if (/\b\d{1,2}:\d{2}\b/.test(t)) return true;
  if (/\b\d{1,2}\s*(am|pm)\b/.test(t)) return true;
  return false;
}

type BarberlineCanonicalIntent =
  | "booking_request"
  | "availability_question"
  | "pricing_question"
  | "location_question"
  | "business_hours_question"
  | "services_question"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "out_of_scope"
  | "greeting_only"
  | "unknown";

function resolveBarberlineCanonicalRoute(
  input: string,
  engineResult?: unknown,
): {
  intent: BarberlineCanonicalIntent;
  hasService: boolean;
  hasDateOrTime: boolean;
  isGreetingOnly: boolean;
  missingService: boolean;
} {
  const t = normalizeTextForMatch(input).replace(/[¿?¡!,.;:]+/g, " ").replace(
    /\s+/g,
    " ",
  ).trim();
  const engine = (engineResult && typeof engineResult === "object")
    ? (engineResult as Record<string, unknown>)
    : {};
  const statePatch = (engine.statePatch ?? {}) as Record<string, unknown>;
  const collected = (statePatch.collected ?? {}) as Record<string, unknown>;
  const pending = (collected.pending_booking_request ?? {}) as Record<
    string,
    unknown
  >;
  const debug = (engine.debug ?? {}) as Record<string, unknown>;
  const debugIntent = safeStr(debug.intent, "").toLowerCase();
  const replyText = safeStr(engine.replyText, "");
  const hasGreeting = /\b(hola|hey|buenas|buen dia|buenos dias|que tal)\b/.test(
    t,
  );
  const withoutGreeting = t
    .replace(/\b(hola|hey|buenas|buen dia|buenos dias|que tal)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const isGreetingOnly = hasGreeting && !withoutGreeting;
  const hasDateOrTime = hasNaturalDateOrTimeSignal(input) ||
    Boolean(
      safeStr(collected.preferred_date, safeStr(pending.preferred_date, "")) ||
        safeStr(collected.preferred_time, safeStr(pending.preferred_time, "")),
    );
  const hasService =
    /\b(corte|pelo|cabello|barba|cejas|clasico|clasico|limpieza|facial|corte y barba|corte con barba|corte y limpieza)\b/
      .test(t) ||
    Boolean(
      safeStr(
        collected.service,
        safeStr(pending.service, safeStr((pending as any).service_name, "")),
      ),
    );
  const bookingPhrase =
    /\b(quiero una cita|una cita|quiero agendar|agendar cita|agendar una cita|necesito cita|ocupo cita|quiero reservar|reservar cita|reservar una cita|apartame|apartar|reservar|cita)\b/
      .test(t);
  const availabilityPhrase =
    /\b(disponible|disponibilidad|cupo|espacio|horarios disponibles|tenes espacio|tienes espacio|hay cupo|hay espacio)\b/
      .test(t);
  const pricingPhrase =
    /\b(cuanto|cuánto|precio|precios|vale|cuesta|costo|costó)\b/.test(t);
  const locationPhrase =
    /\b(donde estan|donde quedan|ubicacion|direccion|ubicados|ubicadas)\b/.test(
      t,
    );
  const hoursPhrase =
    /\b(horario|horarios|a que hora abren|cuando abren|a que hora cierran|cuando cierran|abren|cierran)\b/
      .test(t) &&
    !/\b(disponible|disponibles|cupo|espacio)\b/.test(t);
  const servicesPhrase =
    /\b(que servicios|servicios tienen|que ofrecen|lista de precios|que precios tienen)\b/
      .test(t);
  const cancelPhrase =
    /\b(cancelar|cancelarla|cancelala|cancelalal|canselar|cncelar|cancelr|cancelar mi cita)\b/
      .test(t);
  const reschedulePhrase =
    /\b(reagendar|cambiar cita|cambiarla|moverla|mover mi cita|cambiar mi cita)\b/
      .test(t);
  const engineBookingIntent = debugIntent === "book_appointment" ||
    debugIntent === "booking_request" ||
    replyText === "__CHECK_REQUESTED_AVAILABILITY__" ||
    replyText === "__SHOW_AVAILABILITY_FOR_DATE__";

  let intent: BarberlineCanonicalIntent = "unknown";
  if (isGreetingOnly) intent = "greeting_only";
  else if (cancelPhrase) intent = "cancel_appointment";
  else if (reschedulePhrase) intent = "reschedule_appointment";
  else if (pricingPhrase) intent = "pricing_question";
  else if (locationPhrase) intent = "location_question";
  else if (hoursPhrase) intent = "business_hours_question";
  else if (servicesPhrase) intent = "services_question";
  else if (availabilityPhrase) {
    intent = hasService || bookingPhrase || hasDateOrTime
      ? "availability_question"
      : "availability_question";
  } else if (
    bookingPhrase || engineBookingIntent || (hasService && hasDateOrTime)
  ) intent = "booking_request";
  const missingService =
    (intent === "booking_request" || intent === "availability_question") &&
    !hasService;
  return { intent, hasService, hasDateOrTime, isGreetingOnly, missingService };
}

function handleBarberLineRuntimeTurn(args: {
  organizationId: string;
  leadId: string;
  inboundText: string;
  normalizedAction: string;
  engineResult: unknown;
  leadState: Json | null;
  barbershopServices: Array<Record<string, unknown>>;
}): GenerateReplyResult | null {
  const canonicalRoute = resolveBarberlineCanonicalRoute(
    args.inboundText,
    args.engineResult,
  );
  logEvent("barberline_canonical_route_resolved", {
    organization_id: args.organizationId,
    lead_id: args.leadId,
    inbound_text: args.inboundText,
    intent: canonicalRoute.intent,
    has_service: canonicalRoute.hasService,
    has_date_or_time: canonicalRoute.hasDateOrTime,
    missing_service: canonicalRoute.missingService,
    has_payload_action: Boolean(args.normalizedAction),
  });

  if (args.normalizedAction) return null;

  if (canonicalRoute.intent === "greeting_only") {
    logEvent("barberline_main_menu_allowed_greeting_only", {
      organization_id: args.organizationId,
      lead_id: args.leadId,
    });
    return null;
  }

  if (!canonicalRoute.missingService) return null;

  logEvent("barberline_main_menu_blocked_by_intent", {
    organization_id: args.organizationId,
    lead_id: args.leadId,
    intent: canonicalRoute.intent,
  });
  logEvent("barberline_runtime_branch_bypassed_old_menu", {
    organization_id: args.organizationId,
    lead_id: args.leadId,
    bypassed_branch: "booking_interactive_menu",
  });

  return {
    reply: serviceSelectionList(args.barbershopServices)?.body ??
      formatBarbershopServiceSelectionText(args.barbershopServices),
    statePatch: mergeStatePatches(
      ((args.engineResult as any)?.statePatch ?? {}) as Json,
      {
        stage: "BOOKING",
        nextExpected: "service_selection",
        last_bot_step: "booking_service_menu_sent",
        collected: {
          ...(((args.leadState as any)?.collected ?? {}) as Record<
            string,
            unknown
          >),
          ...((((args.engineResult as any)?.statePatch ?? {}) as any)
            ?.collected ?? {}),
          activeBookingFlow: true,
          lastBookingStep: "select_service",
        },
      },
    ),
    leadPatch: {},
    debugNote: "barberline_canonical_missing_service",
    interactiveButtons: serviceSelectionButtons(args.barbershopServices),
    interactiveList: serviceSelectionList(args.barbershopServices),
  };
}

function toServiceActionKey(service: Record<string, unknown>): string {
  const id = safeStr(
    service.key,
    safeStr(service.service_key, safeStr(service.id, "")),
  ).trim();
  if (id) return id;
  return safeStr(service.name, "").trim().toLowerCase().replace(/\s+/g, "_");
}

function resolveServiceFromAction(
  services: Array<Record<string, unknown>>,
  actionValue: string,
): Record<string, unknown> | null {
  const target = normalizePayloadActionValue(actionValue).replace(
    /^select_service:/,
    "",
  );
  if (!target) return null;
  const normalizedTarget = normalizeTextForMatch(target);
  return services.find((s) => toServiceActionKey(s) === target) ??
    services.find((s) =>
      normalizeTextForMatch(toServiceActionKey(s)) === normalizedTarget
    ) ??
    services.find((s) =>
      normalizeTextForMatch(safeStr(s.name, "")) === normalizedTarget
    ) ??
    null;
}

function getBarbershopBrandName(
  clinicSettings: Record<string, unknown>,
  orgSettings?: Record<string, unknown> | null,
): string {
  const location =
    clinicSettings.location && typeof clinicSettings.location === "object"
      ? (clinicSettings.location as Record<string, unknown>)
      : {};
  const configuredBrand = safeStr(
    location.name,
    safeStr(
      clinicSettings.brand_name,
      safeStr(
        clinicSettings.display_name,
        safeStr(
          orgSettings?.brand_name,
          safeStr(orgSettings?.display_name, ""),
        ),
      ),
    ),
  ).trim();
  if (configuredBrand) return configuredBrand;
  return "BarberLine";
}

function getBarbershopProviders(
  clinicSettings: Record<string, unknown>,
): BarbershopProviderOption[] {
  const raw = Array.isArray((clinicSettings as any)?.providers)
    ? ((clinicSettings as any).providers as Array<Record<string, unknown>>)
    : (Array.isArray((clinicSettings as any)?.barbers)
      ? ((clinicSettings as any).barbers as Array<Record<string, unknown>>)
      : []);
  return raw
    .map((provider) => ({
      id: safeStr(
        provider.id,
        safeStr((provider as any).barber_id, safeStr(provider.name, "")),
      ).trim(),
      name: safeStr(provider.name, "").trim(),
      active: provider.active !== false && provider.is_active !== false,
    }))
    .filter((provider) => provider.id && provider.name && provider.active);
}

function formatDurationLabel(minutesRaw: unknown): string {
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "duración por confirmar";
  }
  if (minutes === 60) return "1 hora";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h} h ${m} min` : `${h} horas`;
}

function getServicePrice(service: Record<string, unknown>): string {
  const price = Number(
    service.price_from ?? service.price ?? service.amount ??
      service.price_hnl ?? service.base_price_hnl,
  );
  return Number.isFinite(price) && price > 0
    ? `HNL ${Math.round(price)}`
    : "precio por confirmar";
}

function getServiceBenefitLine(serviceNameRaw: string): string {
  const name = normalizeTextForMatch(serviceNameRaw);
  if (name.includes("barba") && name.includes("corte")) {
    return "El combo completo: corte, barba y detalle.";
  }
  if (name.includes("limpieza") && name.includes("corte")) {
    return "Corte completo con limpieza facial incluida.";
  }
  if (name.includes("limpieza")) {
    return "Para refrescar la piel y salir más fino.";
  }
  if (name.includes("corte")) return "Limpio, fresco y bien perfilado.";
  return "Para salir listo.";
}

function getServiceMenuEmoji(serviceNameRaw: string): string {
  const name = normalizeTextForMatch(serviceNameRaw);
  if (name.includes("barba")) return "🧔";
  if (name.includes("limpieza")) return name.includes("corte") ? "💈" : "✨";
  if (name.includes("corte")) return "✂️";
  return "💈";
}

function formatCustomerAppointmentStatus(statusRaw: unknown): string {
  const status = safeStr(statusRaw, "").toLowerCase();
  return status === "confirmed"
    ? "cita confirmada"
    : "cita pendiente de confirmar";
}

function formatBarbershopPricingList(
  services: Array<Record<string, unknown>>,
  brandName: string,
  activeAppointment?: Record<string, unknown> | null,
): string {
  const activeLine = activeAppointment
    ? (() => {
      const provider = safeStr(
        (activeAppointment as any).provider_name,
        safeStr((activeAppointment as any).preferred_barber, ""),
      );
      const providerLine = provider ? ` con ${provider}` : "";
      return `Ya tenés tu ${
        formatCustomerAppointmentStatus(activeAppointment.status)
      } para ${
        safeStr(
          activeAppointment.reason,
          safeStr(activeAppointment.title, "tu servicio"),
        )
      } el ${
        formatRequestedDayLabel(
          safeStr(
            activeAppointment.appointment_date,
            safeStr(activeAppointment.starts_at, "").slice(0, 10),
          ),
        )
      } a las ${
        formatHourLabel(
          safeStr(
            activeAppointment.appointment_time,
            safeStr(activeAppointment.starts_at, "").slice(11, 16),
          ),
        )
      }${providerLine}.\n\n`;
    })()
    : "";
  const lines = services
    .filter((service) =>
      service.active !== false && service.is_active !== false
    )
    .slice(0, 8)
    .map((service) => {
      const name = safeStr(service.name, "Servicio");
      return `${getServiceMenuEmoji(name)} ${name} — ${
        getServicePrice(service)
      } · ${
        formatDurationLabel(service.duration_min ?? service.durationMinutes)
      }\n${getServiceBenefitLine(name)}`;
    });
  return `${activeLine}Estos son los servicios de ${brandName} 💈\n\n${
    lines.join("\n\n")
  }\n\n¿Querés reservar un espacio?`;
}

function formatBarbershopGreetingCopy(brandName: string): string {
  return `👋 Bienvenido a *${brandName}* 💈\n\nAgendá tu cita en menos de 1 minuto.\n¿Qué querés hacer hoy?`;
}

function formatBarbershopMoreDaysCopy(dateLines: string[]): string {
  return `Te puedo mostrar estos días disponibles:\n\n${
    dateLines.join("\n")
  }\n\nDecime cuál día querés revisar y te muestro horarios.`;
}

function formatBarbershopHandoffCopy(): string {
  return "Listo 💈 Te paso con alguien del equipo.\nEn breve te escriben por aquí.";
}

function formatWimaeilPricingList(
  services: Array<Record<string, unknown>>,
  brandName: string,
): string {
  const lines = services
    .filter((service) =>
      service.active !== false && service.is_active !== false
    )
    .slice(0, 8)
    .map((service) => {
      const name = safeStr(service.name, "Servicio");
      const price = Number(
        service.price_from ?? service.price ?? service.amount ??
          service.price_hnl ?? service.base_price_hnl,
      );
      const priceLabel = Number.isFinite(price) && price > 0
        ? `L${Math.round(price)}`
        : "precio por confirmar";
      return `${getServiceMenuEmoji(name)} ${name} — ${priceLabel}`;
    });
  return `Estos son los servicios disponibles en ${brandName} 💈\n\n${
    lines.join("\n")
  }\n\n¿Querés agendar una cita?`;
}

type DentalGuidedService = {
  id: string;
  name: string;
  duration_min: number;
  price?: string;
  raw: Record<string, unknown>;
};

type DentalGuidedProvider = {
  id: string;
  name: string;
  active: boolean;
};

const DEFAULT_DENTAL_GUIDED_SERVICES: DentalGuidedService[] = [
  {
    id: "limpieza_dental",
    name: "Limpieza dental",
    duration_min: 45,
    raw: { id: "limpieza_dental", name: "Limpieza dental", duration_min: 45 },
  },
  {
    id: "evaluacion_general",
    name: "Evaluación general",
    duration_min: 30,
    raw: {
      id: "evaluacion_general",
      name: "Evaluación general",
      duration_min: 30,
    },
  },
  {
    id: "ortodoncia",
    name: "Ortodoncia",
    duration_min: 45,
    raw: { id: "ortodoncia", name: "Ortodoncia", duration_min: 45 },
  },
  {
    id: "blanqueamiento",
    name: "Blanqueamiento",
    duration_min: 60,
    raw: { id: "blanqueamiento", name: "Blanqueamiento", duration_min: 60 },
  },
  {
    id: "emergencia_dental",
    name: "Emergencia dental",
    duration_min: 30,
    raw: {
      id: "emergencia_dental",
      name: "Emergencia dental",
      duration_min: 30,
    },
  },
];

function getDentalFallbackDurationMin(serviceNameRaw: string): number {
  const name = normalizeTextForMatch(serviceNameRaw);
  if (name.includes("blanqueamiento")) return 60;
  if (
    name.includes("endodoncia") || name.includes("implante") ||
    name.includes("carilla")
  ) return 60;
  if (
    name.includes("limpieza") ||
    name.includes("ortodoncia") ||
    name.includes("bracket") ||
    name.includes("extraccion") ||
    name.includes("extracción") ||
    name.includes("resina") ||
    name.includes("restauracion") ||
    name.includes("restauración")
  ) return 45;
  return 30;
}

function getDentalBufferAfterMin(
  serviceNameRaw: string,
  clinicSettings: Record<string, unknown>,
): number {
  const bookingRules = ((clinicSettings as any)?.booking_rules &&
      typeof (clinicSettings as any).booking_rules === "object")
    ? ((clinicSettings as any).booking_rules as Record<string, unknown>)
    : {};
  const configured = Number(
    bookingRules.buffer_after_min ?? bookingRules.buffer_min ??
      (clinicSettings as any)?.buffer_after_min ??
      (clinicSettings as any)?.buffer_min,
  );
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.round(configured);
  }
  const name = normalizeTextForMatch(serviceNameRaw);
  if (
    name.includes("extraccion") ||
    name.includes("extracción") ||
    name.includes("implante") ||
    name.includes("endodoncia") ||
    name.includes("cirugia") ||
    name.includes("cirugía")
  ) return 15;
  return 10;
}

function withDentalSchedulingBuffer(
  service: DentalGuidedService,
  clinicSettings: Record<string, unknown>,
): DentalGuidedService {
  const bufferAfterMin = getDentalBufferAfterMin(service.name, clinicSettings);
  return {
    ...service,
    duration_min: service.duration_min + bufferAfterMin,
    raw: {
      ...service.raw,
      service_duration_min: service.duration_min,
      duration_min: service.duration_min + bufferAfterMin,
      buffer_after_min: bufferAfterMin,
    },
  };
}

function getDentalBrandName(
  clinicSettings: Record<string, unknown>,
  orgSettings?: Record<string, unknown> | null,
): string {
  return safeStr(
    clinicSettings.brand_name,
    safeStr(
      clinicSettings.display_name,
      safeStr(
        orgSettings?.brand_name,
        safeStr(orgSettings?.display_name, "la clínica"),
      ),
    ),
  ).trim() || "la clínica";
}

function getDentalGuidedServices(
  clinicSettings: Record<string, unknown>,
): DentalGuidedService[] {
  const configured = Array.isArray((clinicSettings as any)?.services)
    ? ((clinicSettings as any).services as Array<Record<string, unknown>>)
    : [];
  const services = configured
    .filter((service) =>
      service && service.active !== false && service.is_active !== false
    )
    .map((service) => {
      const id = toServiceActionKey(service);
      const name = safeStr(
        service.name,
        safeStr((service as any).service_name, id),
      ).trim();
      return {
        id,
        name,
        duration_min: Number(
          service.duration_min ?? service.durationMinutes ??
            service.duration ?? getDentalFallbackDurationMin(name),
        ) || getDentalFallbackDurationMin(name),
        price: getServicePrice(service),
        raw: service,
      };
    })
    .filter((service) => service.id && service.name);
  return services.length ? services : DEFAULT_DENTAL_GUIDED_SERVICES;
}

function getDentalGuidedProviders(
  clinicSettings: Record<string, unknown>,
): DentalGuidedProvider[] {
  const raw = Array.isArray((clinicSettings as any)?.providers)
    ? ((clinicSettings as any).providers as Array<Record<string, unknown>>)
    : (Array.isArray((clinicSettings as any)?.doctors)
      ? ((clinicSettings as any).doctors as Array<Record<string, unknown>>)
      : []);
  const providers = raw
    .map((provider) => ({
      id: safeStr(
        provider.id,
        safeStr((provider as any).provider_id, safeStr(provider.name, "")),
      ).trim(),
      name: safeStr(provider.name, "").trim(),
      active: provider.active !== false && provider.is_active !== false,
    }))
    .filter((provider) => provider.id && provider.name && provider.active);
  return providers.length
    ? providers
    : [{ id: "doctor_demo", name: "Doctor disponible", active: true }];
}

function formatDentalGreetingCopy(brandName: string): string {
  return `👋 Bienvenido a *${brandName}* 🦷\n\nAgendá tu cita en menos de 1 minuto.\n¿Qué necesitás hacer hoy?`;
}

function formatDentalHandoffCopy(): string {
  return "Listo 🦷 Te paso con alguien del equipo.\nEn breve te escriben por aquí.";
}

function dentalGreetingButtons(): InteractiveButton[] {
  return [
    { id: "booking_start", title: "Agendar cita" },
    { id: "view_prices", title: "Servicios" },
    { id: "dental_info", title: "Info clínica" },
  ];
}

function formatDentalHoursInfo(
  brandName: string,
  clinicSettings: Record<string, unknown>,
): string {
  const hours =
    (clinicSettings.hours && typeof clinicSettings.hours === "object")
      ? (clinicSettings.hours as Record<string, unknown>)
      : {};
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const dayNames = [
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
  ];
  const rows = dayKeys.map((key, index) => {
    const entry = getHoursEntry(hours, key);
    const open = safeStr(entry?.open ?? entry?.open_time, "");
    const close = safeStr(entry?.close ?? entry?.close_time, "");
    const closed = !entry || Boolean(entry.closed ?? entry.is_closed) ||
      !open || !close;
    return { name: dayNames[index], closed, open, close };
  });
  const configuredRows = rows.filter((row) => !row.closed);
  const groupedRows: string[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const current = rows[i];
    let end = i;
    while (
      end + 1 < rows.length &&
      rows[end + 1].closed === current.closed &&
      rows[end + 1].open === current.open &&
      rows[end + 1].close === current.close
    ) {
      end += 1;
    }
    const dayLabel = i === end
      ? current.name
      : `${current.name} a ${rows[end].name.toLowerCase()}`;
    groupedRows.push(
      current.closed
        ? `${dayLabel}: cerrado`
        : `${dayLabel}: ${formatHourLabel(current.open)} – ${
          formatHourLabel(current.close)
        }`,
    );
    i = end;
  }
  if (configuredRows.length > 0) {
    return `${brandName} atiende:\n\n${
      groupedRows.join("\n")
    }\n\n¿Querés agendar una cita?`;
  }
  if (normalizeTextForMatch(brandName).includes("dican")) {
    return "DICAN atiende:\n\nLunes a viernes: 8:00 AM – 5:00 PM\nSábado: 9:00 AM – 1:00 PM\nDomingo: cerrado\n\n¿Querés agendar una cita?";
  }
  const brandLabel = brandName;
  return `${brandLabel} atiende:\n\nLunes a viernes: 8:00 AM – 5:00 PM\nSábado: 9:00 AM – 1:00 PM\nDomingo: cerrado\n\n¿Querés agendar una cita?`;
}

function resolveDentalLocationInfo(
  clinicSettings: Record<string, unknown>,
): string {
  return safeStr(
    (clinicSettings as any).location,
    safeStr(
      (clinicSettings as any).address,
      safeStr((clinicSettings as any).public_location, ""),
    ),
  ).trim();
}

function formatDentalProviderDisplayName(
  providerNameRaw: string,
  brandName = "",
): string {
  const providerName = safeStr(providerNameRaw, "").trim();
  const normalized = normalizeTextForMatch(providerName);
  if (
    !providerName ||
    normalized === "doctor disponible" ||
    normalized === "cualquiera disponible"
  ) {
    const brand = safeStr(brandName, "").trim();
    if (normalizeTextForMatch(brand).includes("dican")) return "Equipo DICAN";
    return "Equipo de la clínica";
  }
  return providerName;
}

function getDentalServiceMenuEmoji(serviceNameRaw: string): string {
  const name = normalizeTextForMatch(serviceNameRaw);
  if (name.includes("blanqueamiento")) return "✨";
  if (name.includes("ortodoncia") || name.includes("bracket")) return "😁";
  if (name.includes("implante")) return "🔩";
  if (name.includes("carilla")) return "💎";
  if (name.includes("endodoncia")) return "🧬";
  if (
    name.includes("resina") || name.includes("restauracion") ||
    name.includes("restauración")
  ) return "🩹";
  if (name.includes("gingivitis") || name.includes("encia")) return "🩸";
  if (
    name.includes("revision") || name.includes("revisión") ||
    name.includes("evaluacion") || name.includes("evaluación")
  ) {
    return "👨‍⚕️";
  }
  return "🦷";
}

function formatDentalServiceListIntro(brandName: string): string {
  return `Estos son los servicios disponibles en ${brandName} 🦷\n\nEscogé uno para ver disponibilidad y agendar.`;
}

function dentalServiceSelectionList(
  services: DentalGuidedService[],
  body = "Escogé el motivo de la cita 🦷",
): WhatsAppInteractiveListSpec | undefined {
  if (services.length <= 3) return undefined;
  return {
    body,
    buttonText: "Ver servicios",
    sections: [
      {
        title: "Servicios",
        rows: services.slice(0, 10).map((service) => ({
          id: `select_service:${service.id}`,
          title: `${getDentalServiceMenuEmoji(service.name)} ${service.name}`
            .slice(0, 24),
          description: `${service.price ?? "precio por confirmar"} · ${
            formatDurationLabel(service.duration_min)
          }`.slice(0, 72),
        })),
      },
    ],
  };
}

function dentalServiceButtons(
  services: DentalGuidedService[],
): InteractiveButton[] {
  if (services.length > 3) return [];
  return services.map((service) => ({
    id: `select_service:${service.id}`,
    title: service.name.slice(0, 20),
  }));
}

function dentalProviderSelectionList(
  providers: DentalGuidedProvider[],
): WhatsAppInteractiveListSpec | undefined {
  const rows = [
    ...providers.map((provider) => ({
      id: `select_provider:${provider.id}`,
      title: provider.name.slice(0, 24),
      description: "Doctor",
    })),
    {
      id: "select_provider:any",
      title: "Cualquiera disponible",
      description: "Primer doctor disponible",
    },
  ];
  if (rows.length <= 3) return undefined;
  return {
    body: "¿Tenés doctor preferido?",
    buttonText: "Ver doctores",
    sections: [{ title: "Doctores", rows }],
  };
}

function dentalProviderButtons(
  providers: DentalGuidedProvider[],
): InteractiveButton[] {
  const buttons = [
    ...providers.map((provider) => ({
      id: `select_provider:${provider.id}`,
      title: provider.name.slice(0, 20),
    })),
    { id: "select_provider:any", title: "Cualquiera" },
  ];
  return buttons.length <= 3 ? buttons : [];
}

function dentalDateSelectionList(
  dates: Array<{ date: string; label: string }>,
): WhatsAppInteractiveListSpec | undefined {
  if (!dates.length) return undefined;
  return {
    body: "¿Qué día te queda mejor? 🦷",
    buttonText: "Ver días",
    sections: [
      {
        title: "Días disponibles",
        rows: dates.slice(0, 10).map((date) => ({
          id: `select_date:${date.date}`,
          title: date.label.slice(0, 24),
          description: "Disponible",
        })),
      },
    ],
  };
}

async function dentalDatePreferenceButtons(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  clinicSettings: Record<string, unknown>;
  service: DentalGuidedService;
  providerId?: string | null;
  providerPreference?: "any" | "specific";
  includeKeepExisting?: boolean;
  actionMode?: "booking" | "reschedule";
}): Promise<InteractiveButton[]> {
  const timezone =
    safeStr((args.clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
    DEFAULT_TIMEZONE;
  const today = formatLocalDateForAction(nowInTimezone(timezone));
  const tomorrow = nowInTimezone(timezone);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = formatLocalDateForAction(tomorrow);
  const availabilityBase = {
    supabase: args.supabase,
    organization_id: args.organizationId,
    business_type: "dental",
    service_id: args.service.id,
    service_name: args.service.name,
    provider_id: args.providerPreference === "specific"
      ? args.providerId ?? null
      : null,
    provider_preference: args.providerPreference ?? "any",
    timezone,
    max_options: 1,
  };
  const todayAction = args.actionMode === "reschedule"
    ? "dental_reschedule_date_pref:today"
    : "booking_date_pref:today";
  const tomorrowAction = args.actionMode === "reschedule"
    ? "dental_reschedule_date_pref:tomorrow"
    : "booking_date_pref:tomorrow";
  const otherDateAction = args.actionMode === "reschedule"
    ? "dental_reschedule_change_date"
    : "booking_date_pref:week";
  const todaySlots = await getAvailableSlotsForDay({
    ...availabilityBase,
    date: today,
  });
  const withKeepExisting = (buttons: InteractiveButton[]) =>
    args.includeKeepExisting
      ? [...buttons, { id: "keep_existing_booking", title: "Mantener cita" }]
      : buttons;
  if (todaySlots.length > 0) {
    return withKeepExisting([
      { id: todayAction, title: "Hoy" },
      { id: tomorrowAction, title: "Mañana" },
      { id: otherDateAction, title: "Otra fecha" },
    ]);
  }
  const tomorrowSlots = await getAvailableSlotsForDay({
    ...availabilityBase,
    date: tomorrowIso,
  });
  if (tomorrowSlots.length > 0) {
    return withKeepExisting([
      { id: tomorrowAction, title: "Mañana" },
      { id: otherDateAction, title: "Otra fecha" },
    ]);
  }
  return withKeepExisting([
    { id: otherDateAction, title: "Otra fecha" },
  ]);
}

function isDentalEmergencyText(input: string): boolean {
  const text = normalizeTextForMatch(input);
  return /\b(dolor|dolor fuerte|emergencia|urgencia|muela|cara inflamada|inflamacion|inflamación|sangrado|trauma|golpe|diente quebrado|diente roto|infeccion|infección|absceso|fiebre)\b/
    .test(text);
}

function formatDentalEmergencyEntry(): string {
  return "Entiendo 🦷 Para ayudarte mejor, ¿qué estás sintiendo?\n\nSi tenés inflamación en la cara, fiebre, sangrado fuerte o trauma, contactá a la clínica o buscá atención de emergencia de inmediato.";
}

function dentalEmergencyButtons(): InteractiveButton[] {
  return [
    { id: "dental_triage:dolor_fuerte", title: "Dolor fuerte" },
    { id: "dental_triage:inflamacion", title: "Inflamación" },
    { id: "dental_triage:sangrado", title: "Sangrado" },
    { id: "dental_triage:diente_quebrado", title: "Diente quebrado" },
  ];
}

function formatDentalServicesPricingCopy(
  brandName: string,
  _services: DentalGuidedService[],
): string {
  return formatDentalServiceListIntro(brandName);
}

function resolveDentalServiceFromActionOrText(
  services: DentalGuidedService[],
  value: string,
): DentalGuidedService | null {
  const rawTarget = normalizePayloadActionValue(value).replace(
    /^select_service:/,
    "",
  ).trim();
  const text = normalizeTextForMatch(rawTarget || value);
  if (!text) return null;
  const number = Number(text);
  if (Number.isInteger(number) && number >= 1 && number <= services.length) {
    return services[number - 1];
  }
  const aliases: Record<string, string[]> = {
    limpieza_dental: ["limpieza", "limpieza dental", "profilaxis"],
    emergencia_dental: [
      "dolor",
      "emergencia",
      "urgencia",
      "dolor emergencia",
      "muela",
      "emergencia dental",
    ],
    ortodoncia: ["ortodoncia", "brackets", "frenillos"],
    extraccion: ["extraccion", "extracción", "sacar muela", "extraer"],
    blanqueamiento: ["blanqueamiento", "dientes blancos"],
    evaluacion_general: [
      "evaluacion",
      "evaluación",
      "revision",
      "revisión",
      "consulta",
    ],
  };
  return services.find((service) => {
    const id = normalizeTextForMatch(service.id);
    const name = normalizeTextForMatch(service.name);
    const aliasHits = aliases[service.id]?.some((alias) =>
      text.includes(normalizeTextForMatch(alias))
    ) ?? false;
    return id === text || name === text || name.includes(text) ||
      text.includes(name) || aliasHits || isCloseTextMatch(name, text);
  }) ?? null;
}

function resolveDentalProviderFromActionOrText(
  providers: DentalGuidedProvider[],
  value: string,
): { id: string; name: string; preference: "any" | "specific" } | null {
  const normalized = normalizePayloadActionValue(value).replace(
    /^select_provider:/,
    "",
  ).trim();
  const text = normalizeTextForMatch(normalized || value).trim();
  if (!text) return null;
  if (
    text === "any" ||
    /\b(cualquiera|cualquier|no importa|me da igual|con quien sea|quien sea|disponible|el que este|el que esté|el primero libre)\b/
      .test(text)
  ) {
    return { id: "", name: "Cualquiera disponible", preference: "any" };
  }
  const number = Number(text);
  if (Number.isInteger(number) && number >= 1) {
    if (number <= providers.length) {
      const provider = providers[number - 1];
      return { id: provider.id, name: provider.name, preference: "specific" };
    }
    if (number === providers.length + 1) {
      return { id: "", name: "Cualquiera disponible", preference: "any" };
    }
  }
  const match = providers.find((provider) => {
    const id = normalizeTextForMatch(provider.id);
    const name = normalizeTextForMatch(provider.name);
    return id === text || name === text || name.includes(text) ||
      text.includes(name) || isCloseTextMatch(name, text);
  });
  return match
    ? { id: match.id, name: match.name, preference: "specific" }
    : null;
}

function isReliableDentalPatientName(rawName: string): boolean {
  const name = toDisplayPersonName(rawName);
  if (!name) return false;
  const normalized = normalizeTextForMatch(name);
  if (
    /^(usuario|sin nombre|cliente|paciente|lead|contacto|whatsapp|messenger|facebook|instagram|page|pagina|página)$/i
      .test(normalized)
  ) return false;
  if (
    normalized === "paciente demo" ||
    normalized === "dentalconnect test" ||
    normalized.includes("dentalconnect test") ||
    normalized.includes("demo")
  ) return false;
  if (/^\+?\d[\d\s-]{5,}$/.test(name)) return false;
  return /[a-záéíóúñ]/i.test(name) && name.length >= 3;
}

function resolveReliableDentalPatientName(
  leadState: Json | null,
  collected: Record<string, unknown>,
): string {
  const candidates = [
    safeStr(collected.patient_name, ""),
    safeStr(collected.customer_name, ""),
    resolveLeadFullName(leadState, { collected } as Json),
  ];
  for (const candidate of candidates) {
    if (isReliableDentalPatientName(candidate)) {
      return toDisplayPersonName(candidate);
    }
  }
  return "";
}

function formatDentalConfirmationSummary(
  pendingBooking: Record<string, unknown>,
  _patientName = "",
): string {
  const service = safeStr(
    pendingBooking.service_name,
    safeStr(pendingBooking.service, "Servicio dental"),
  );
  const date = formatRequestedDayLabel(
    safeStr(pendingBooking.appointment_date, ""),
  );
  const time = formatHourLabel(safeStr(pendingBooking.appointment_time, ""));
  const duration = formatDentalDurationLabel(
    pendingBooking.duration_min ?? pendingBooking.effective_duration_min,
  );
  return `Listo 🦷 Te puedo reservar este espacio:

🦷 Servicio: ${service}
📅 Fecha: ${date}
🕚 Hora: ${time}
⏱️ Duración: ${duration}

¿Confirmamos?`;
}

function formatDentalDurationLabel(minutesRaw: unknown): string {
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "duración por confirmar";
  }
  if (minutes === 60) return "1 hora";
  if (minutes < 60) return `${Math.round(minutes)} minutos`;
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  if (!remaining) return hours === 1 ? "1 hora" : `${hours} horas`;
  return `${hours} hora${hours === 1 ? "" : "s"} ${remaining} minutos`;
}

function formatDentalBookingSuccess(booking: BookingActionResult): string {
  if (!booking.ok) return BOOKING_FAILURE_REPLY;
  const appt = booking.appointment;
  const service = safeStr(
    (appt as any).reason,
    safeStr((appt as any).title, "Servicio"),
  );
  const date = safeStr(
    (appt as any).appointment_date,
    safeStr((appt as any).starts_at, "").slice(0, 10),
  );
  const time = safeStr(
    (appt as any).appointment_time,
    safeStr((appt as any).starts_at, "").slice(11, 16),
  );
  const brandName = safeStr(
    (appt as any).brand_name,
    safeStr(((appt as any).metadata ?? {})?.brand_name, "la clínica"),
  );
  return `✅ Cita confirmada 🦷

Te esperamos en ${brandName}:

🦷 Servicio: ${service}
📅 Fecha: ${formatRequestedDayLabel(date)}
🕚 Hora: ${formatHourLabel(time)}

Si necesitás cambiarla o cancelarla, podés escribirnos por aquí.`;
}

async function buildDentalDateOptions(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  clinicSettings: Record<string, unknown>;
  service: DentalGuidedService;
  providerId?: string | null;
  providerPreference?: "any" | "specific";
  limit?: number;
}): Promise<Array<{ date: string; label: string; offset: number }>> {
  const timezone =
    safeStr((args.clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
    DEFAULT_TIMEZONE;
  const nowLocal = nowInTimezone(timezone);
  const bookingRules = ((args.clinicSettings as any)?.booking_rules &&
      typeof (args.clinicSettings as any).booking_rules === "object")
    ? ((args.clinicSettings as any).booking_rules as Record<string, unknown>)
    : {};
  const maxBookingDaysAhead = Math.max(
    1,
    Math.min(14, Number(bookingRules.max_booking_days_ahead ?? 14) || 14),
  );
  const limit = Math.max(1, Math.min(10, Number(args.limit ?? 10) || 10));
  const days: Array<{ date: string; label: string; offset: number }> = [];
  for (
    let offset = 0;
    offset <= maxBookingDaysAhead && days.length < limit;
    offset += 1
  ) {
    const d = new Date(nowLocal);
    d.setDate(d.getDate() + offset);
    const date = formatLocalDateForAction(d);
    const slots = await getAvailableSlotsForDay({
      supabase: args.supabase,
      organization_id: args.organizationId,
      business_type: "dental",
      service_id: args.service.id,
      service_name: args.service.name,
      provider_id: args.providerPreference === "specific"
        ? args.providerId ?? null
        : null,
      provider_preference: args.providerPreference ?? "any",
      date,
      timezone,
      max_options: 1,
    });
    if (slots.length === 0) continue;
    days.push({
      date,
      label: formatDentalAvailableDayLabel(date, offset),
      offset,
    });
  }
  return days;
}

function formatDentalAvailableDayLabel(
  dateIso: string,
  offset: number,
): string {
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.valueOf())) return formatRequestedDayLabel(dateIso);
  const weekday = d.toLocaleDateString("es-HN", { weekday: "short" })
    .replace(".", "")
    .toLowerCase();
  const month = d.toLocaleDateString("es-HN", { month: "short" })
    .replace(".", "")
    .toLowerCase();
  const day = d.getDate();
  if (offset === 0) return `Hoy, ${weekday} ${day} ${month}`;
  if (offset === 1) return `Mañana, ${weekday} ${day} ${month}`;
  const prefix = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${prefix} ${day} ${month}`;
}

async function buildDentalDateOptionsInRange(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  clinicSettings: Record<string, unknown>;
  service: DentalGuidedService;
  startOffset: number;
  endOffset: number;
  providerId?: string | null;
  providerPreference?: "any" | "specific";
  limit?: number;
}): Promise<Array<{ date: string; label: string; offset: number }>> {
  const timezone =
    safeStr((args.clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
    DEFAULT_TIMEZONE;
  const nowLocal = nowInTimezone(timezone);
  const limit = Math.max(1, Math.min(7, Number(args.limit ?? 7) || 7));
  const startOffset = Math.max(0, Math.floor(args.startOffset));
  const endOffset = Math.max(startOffset, Math.floor(args.endOffset));
  const days: Array<{ date: string; label: string; offset: number }> = [];
  for (
    let offset = startOffset;
    offset <= endOffset && days.length < limit;
    offset += 1
  ) {
    const d = new Date(nowLocal);
    d.setDate(d.getDate() + offset);
    const date = formatLocalDateForAction(d);
    const slots = await getAvailableSlotsForDay({
      supabase: args.supabase,
      organization_id: args.organizationId,
      business_type: "dental",
      service_id: args.service.id,
      service_name: args.service.name,
      provider_id: args.providerPreference === "specific"
        ? args.providerId ?? null
        : null,
      provider_preference: args.providerPreference ?? "any",
      date,
      timezone,
      max_options: 1,
    });
    if (slots.length > 0) {
      days.push({ date, label: formatRequestedDayLabel(date), offset });
    }
  }
  return days;
}

function parseDentalFutureRangeFromText(
  input: string,
  nowLocal: Date,
): { startOffset: number; endOffset: number } | null {
  const text = normalizeTextForMatch(input);
  const inDays = text.match(/\ben\s+(\d{1,2})\s+dias\b/);
  if (inDays) {
    const offset = Number(inDays[1]);
    if (Number.isInteger(offset) && offset > 0) {
      return { startOffset: offset, endOffset: offset + 6 };
    }
  }
  if (/\bdentro de dos semanas\b/.test(text)) {
    return { startOffset: 14, endOffset: 20 };
  }
  if (/\b(proxima semana|próxima semana|la otra semana)\b/.test(text)) {
    const todayDay = nowLocal.getDay();
    const daysUntilNextMonday = ((1 - todayDay + 7) % 7) || 7;
    return {
      startOffset: daysUntilNextMonday,
      endOffset: daysUntilNextMonday + 6,
    };
  }
  return null;
}

function getDentalAmbiguousWeekdayOptions(
  input: string,
  nowLocal: Date,
): { weekdayLabel: string; first: string; second: string } | null {
  const text = normalizeTextForMatch(input);
  if (!/\b(proximo|próximo|siguiente)\b/.test(text)) return null;
  const weekdays: Array<[string, number, string]> = [
    ["domingo", 0, "domingo"],
    ["lunes", 1, "lunes"],
    ["martes", 2, "martes"],
    ["miercoles", 3, "miércoles"],
    ["miércoles", 3, "miércoles"],
    ["jueves", 4, "jueves"],
    ["viernes", 5, "viernes"],
    ["sabado", 6, "sábado"],
    ["sábado", 6, "sábado"],
  ];
  const match = weekdays.find(([key]) => new RegExp(`\\b${key}\\b`).test(text));
  if (!match) return null;
  const [, targetDay, label] = match;
  const firstDate = new Date(nowLocal);
  const diff = (targetDay - firstDate.getDay() + 7) % 7 || 7;
  firstDate.setDate(firstDate.getDate() + diff);
  const secondDate = new Date(firstDate);
  secondDate.setDate(secondDate.getDate() + 7);
  return {
    weekdayLabel: label,
    first: formatLocalDateForAction(firstDate),
    second: formatLocalDateForAction(secondDate),
  };
}

function formatDentalShortDateButton(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.valueOf())) {
    return formatRequestedDayLabel(dateIso).slice(0, 20);
  }
  const weekday = d.toLocaleDateString("es-HN", { weekday: "long" });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${d.getDate()}`
    .slice(0, 20);
}

async function findDentalNextAvailableSlots(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  clinicSettings: Record<string, unknown>;
  service: DentalGuidedService;
  requestedDate?: string;
  providerId?: string | null;
  providerPreference?: "any" | "specific";
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const timezone =
    safeStr((args.clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
    DEFAULT_TIMEZONE;
  const bookingRules = ((args.clinicSettings as any)?.booking_rules &&
      typeof (args.clinicSettings as any).booking_rules === "object")
    ? ((args.clinicSettings as any).booking_rules as Record<string, unknown>)
    : {};
  const maxBookingDaysAhead = Math.max(
    7,
    Math.min(14, Number(bookingRules.max_booking_days_ahead ?? 14) || 14),
  );
  const limit = Math.max(1, Math.min(10, Number(args.limit ?? 6) || 6));
  const timezoneNow = nowInTimezone(timezone);
  const base = /^\d{4}-\d{2}-\d{2}$/.test(args.requestedDate ?? "")
    ? new Date(`${args.requestedDate}T12:00:00`)
    : timezoneNow;
  const results: Array<Record<string, unknown>> = [];
  for (
    let offset = args.requestedDate ? 1 : 0;
    offset <= maxBookingDaysAhead && results.length < limit;
    offset += 1
  ) {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    const date = formatLocalDateForAction(d);
    const slots = await getAvailableSlotsForDay({
      supabase: args.supabase,
      organization_id: args.organizationId,
      business_type: "dental",
      service_id: args.service.id,
      service_name: args.service.name,
      provider_id: args.providerPreference === "specific"
        ? args.providerId ?? null
        : null,
      provider_preference: args.providerPreference ?? "any",
      date,
      timezone,
      max_options: Math.max(1, limit - results.length),
    });
    for (const slot of slots) {
      results.push(slot as Record<string, unknown>);
      if (results.length >= limit) break;
    }
  }
  return results;
}

function toDentalOfferedSlot(
  slot: Record<string, unknown>,
  service: DentalGuidedService,
  source: string,
  clinicSettings?: Record<string, unknown>,
): Record<string, unknown> {
  const bufferAfterMin = clinicSettings
    ? getDentalBufferAfterMin(service.name, clinicSettings)
    : 0;
  const serviceDurationMin =
    Number((slot as any).service_duration_min ?? service.duration_min) ||
    service.duration_min;
  return {
    date: safeStr(slot.date, ""),
    time: safeStr(slot.time, ""),
    starts_at: safeStr(slot.starts_at, ""),
    provider_id: safeStr(slot.provider_id, ""),
    provider_name: safeStr(slot.provider_name, ""),
    service_key: service.id,
    service_name: service.name,
    duration_min: serviceDurationMin,
    buffer_after_min: bufferAfterMin,
    effective_duration_min: serviceDurationMin + bufferAfterMin,
    source,
  };
}

function buildDentalPendingBookingFromSlot(args: {
  slot: Record<string, unknown>;
  pending: Record<string, unknown>;
  clinicSettings: Record<string, unknown>;
  fallbackService: DentalGuidedService;
  patientName?: string;
}): Record<string, unknown> {
  const serviceName = safeStr(
    args.slot.service_name,
    safeStr(args.pending.service_name, args.fallbackService.name),
  );
  const durationMin = Number(
    args.slot.duration_min ?? args.pending.duration_min ??
      args.fallbackService.duration_min,
  ) || args.fallbackService.duration_min;
  const bufferAfterMin = Number(
    args.slot.buffer_after_min ?? args.pending.buffer_after_min ??
      getDentalBufferAfterMin(serviceName, args.clinicSettings),
  ) || 0;
  return {
    ...args.pending,
    service: serviceName,
    service_key: safeStr(
      args.slot.service_key,
      safeStr(args.pending.service_key, args.fallbackService.id),
    ),
    service_name: serviceName,
    brand_name: safeStr(
      args.pending.brand_name,
      getDentalBrandName(args.clinicSettings, null),
    ),
    appointment_date: safeStr(args.slot.date, ""),
    appointment_time: safeStr(args.slot.time, ""),
    starts_at: safeStr(args.slot.starts_at, ""),
    provider_id: safeStr(args.slot.provider_id, ""),
    provider_name: safeStr(args.slot.provider_name, "Doctor disponible"),
    duration_min: durationMin,
    buffer_after_min: bufferAfterMin,
    effective_duration_min: Number(
      args.slot.effective_duration_min ?? args.pending.effective_duration_min,
    ) || (durationMin + bufferAfterMin),
    patient_name: args.patientName ?? safeStr(args.pending.patient_name, ""),
    status: "pending_confirmation",
    source: "dental_guided_pending_confirmation",
  };
}

function dentalConfirmationOrNameGate(args: {
  leadState: Json | null;
  collected: Record<string, unknown>;
  pendingBooking: Record<string, unknown>;
  debugNote: string;
}): GenerateReplyResult {
  const patientName = resolveReliableDentalPatientName(args.leadState, {
    ...args.collected,
    ...args.pendingBooking,
  });
  if (!patientName) {
    return {
      reply: "¿A nombre de quién agendamos la cita?",
      statePatch: {
        stage: "BOOKING",
        nextExpected: "patient_name",
        collected: {
          ...args.collected,
          pending_booking: args.pendingBooking,
          lastBookingStep: "name_input",
          expected_step: "name_input",
        },
      },
      leadPatch: {},
      debugNote: `${args.debugNote}_name_gate`,
    };
  }
  const pendingWithName = { ...args.pendingBooking, patient_name: patientName };
  return {
    reply: formatDentalConfirmationSummary(pendingWithName, patientName),
    statePatch: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        ...args.collected,
        patient_name: patientName,
        pending_booking: pendingWithName,
        lastBookingStep: "confirm_booking",
        expected_step: "confirmation",
      },
    },
    leadPatch: {},
    debugNote: args.debugNote,
    interactiveButtons: [
      { id: "confirm_booking", title: "Confirmar" },
      { id: "change_booking_slot", title: "Cambiar hora" },
      { id: "cancel_booking", title: "Cancelar" },
    ],
  };
}

function dentalAlternativeSlotButtons(
  slots: Array<Record<string, unknown>>,
): InteractiveButton[] {
  const buttons = slots.slice(0, 3).map((slot) => ({
    id: `select_slot:${safeStr(slot.date, "")}|${safeStr(slot.time, "")}|${
      safeStr(slot.provider_id, "")
    }`,
    title: formatHourLabel(safeStr(slot.time, "")).slice(0, 20),
  }));
  if (buttons.length <= 1) {
    buttons.push({ id: "booking_date_pref:week", title: "Otra fecha" });
    buttons.push({ id: "talk_to_human", title: "Hablar con recepción" });
  } else if (buttons.length === 2) {
    buttons.push({ id: "booking_date_pref:week", title: "Otra fecha" });
  }
  return buttons.slice(0, 3);
}

function dentalAlternativeSlotsList(
  slots: Array<Record<string, unknown>>,
  body: string,
  _serviceName: string,
): WhatsAppInteractiveListSpec | undefined {
  if (slots.length <= 3) return undefined;
  return {
    title: "Horarios",
    body,
    buttonText: "Ver horarios",
    sections: [
      {
        title: "Próximos horarios",
        rows: slots.slice(0, 10).map((slot) => ({
          id: `select_slot:${safeStr(slot.date, "")}|${
            safeStr(slot.time, "")
          }|${safeStr(slot.provider_id, "")}`,
          title: `${formatRequestedDayLabel(safeStr(slot.date, ""))} ${
            formatHourLabel(safeStr(slot.time, ""))
          }`.slice(0, 24),
        })),
      },
    ],
  };
}

function dentalPeriodButtons(options?: {
  hasMorning?: boolean;
  hasAfternoon?: boolean;
}): InteractiveButton[] {
  const buttons: InteractiveButton[] = [];
  if (options?.hasMorning !== false) {
    buttons.push({ id: "dental_period:morning", title: "Por la mañana" });
  }
  if (options?.hasAfternoon !== false) {
    buttons.push({ id: "dental_period:afternoon", title: "Por la tarde" });
  }
  buttons.push({ id: "booking_date_pref:week", title: "Otra fecha" });
  return buttons;
}

function isDentalPastDate(
  dateIso: string,
  timezone = DEFAULT_TIMEZONE,
): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateIso) &&
    dateIso < formatLocalDateForAction(nowInTimezone(timezone));
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

function hasDentalExplicitYearMarker(
  ...records: Array<Record<string, unknown> | null | undefined>
): boolean {
  return records.some((record) =>
    Boolean(
      record?.date_year_explicit ||
        record?.appointment_date_year_explicit ||
        record?.explicit_year ||
        record?.year_explicit,
    )
  );
}

function isDentalSuspiciousAmbiguousFutureDate(
  dateIso: string,
  timezone = DEFAULT_TIMEZONE,
  dateYearExplicit = false,
): boolean {
  if (dateYearExplicit || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
  const todayIso = formatLocalDateForAction(nowInTimezone(timezone));
  return daysBetweenIsoDates(todayIso, dateIso) > 90;
}

function isDentalInvalidStaleBookingDate(
  dateIso: string,
  timezone = DEFAULT_TIMEZONE,
  dateYearExplicit = false,
): boolean {
  return isDentalPastDate(dateIso, timezone) ||
    isDentalSuspiciousAmbiguousFutureDate(dateIso, timezone, dateYearExplicit);
}

function dentalPastDateRejection(args: {
  collected: Record<string, unknown>;
  service?: DentalGuidedService | null;
  pending?: Record<string, unknown>;
  debugNote: string;
}): GenerateReplyResult {
  const {
    pending_booking: _pendingBooking,
    selected_slot: _selectedSlot,
    pending_offered_slot: _pendingOfferedSlot,
    current_date: _currentDate,
    current_time: _currentTime,
    preferred_date: _preferredDate,
    preferred_time: _preferredTime,
    requested_date: _requestedDate,
    requested_time: _requestedTime,
    last_offered_slots: _lastOfferedSlots,
    last_offered_dates: _lastOfferedDates,
    ...durableCollected
  } = args.collected;
  const pending = args.pending ?? {};
  const service = args.service;
  return {
    reply: "Esa fecha ya pasó. ¿Qué otra fecha te queda mejor?",
    statePatch: {
      stage: "BOOKING",
      nextExpected: "booking_date_preference",
      collected: {
        ...durableCollected,
        activeBookingFlow: true,
        lastBookingStep: "select_day",
        expected_step: "day_selection",
        current_service_key: service?.id ??
          safeStr(
            pending.service_key,
            safeStr(args.collected.current_service_key, ""),
          ),
        current_service_name: service?.name ??
          safeStr(
            pending.service_name,
            safeStr(args.collected.current_service_name, ""),
          ),
        pending_booking: null,
        selected_slot: null,
        pending_offered_slot: null,
        current_date: null,
        current_time: null,
        preferred_date: null,
        preferred_time: null,
        last_offered_slots: null,
        last_offered_dates: null,
      },
    },
    leadPatch: {},
    debugNote: args.debugNote,
    interactiveButtons: [
      { id: "booking_date_pref:today", title: "Hoy" },
      { id: "booking_date_pref:tomorrow", title: "Mañana" },
      { id: "booking_date_pref:week", title: "Otra fecha" },
    ],
  };
}

function formatDentalPeriodSelectorBody(
  dateIso: string,
  timezone = DEFAULT_TIMEZONE,
): string {
  void dateIso;
  void timezone;
  return "Perfecto 🦷 ¿Qué horario preferís?";
}

function getDentalSlotMinute(time: string): number {
  const [hourRaw, minuteRaw] = safeStr(time, "").split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;
  return hour * 60 + minute;
}

function filterDentalSlotsByPeriod(
  slots: Array<Record<string, unknown>>,
  period: "morning" | "afternoon",
): Array<Record<string, unknown>> {
  return slots.filter((slot) => {
    const minutes = getDentalSlotMinute(safeStr(slot.time, ""));
    if (minutes < 0) return false;
    return period === "morning" ? minutes < 12 * 60 : minutes >= 12 * 60;
  });
}

function isDentalChangeHourText(text: string): boolean {
  return /\b(quiero cambiar la hora|cambiar hora|otra hora|otro horario|solo quiero cambiar la hora|solo la hora|cambiar solo hora)\b/
    .test(text);
}

function isDentalKeepSelectedDateText(text: string): boolean {
  return /\b(deja la misma fecha|dejá la misma fecha|dejar la misma fecha|deja la fecha igual|dejá la fecha igual|dejar igual la fecha|misma fecha|la misma fecha|mismo dia|mismo día|el mismo dia|el mismo día|deja igual|dejalo igual)\b/
    .test(text);
}

function parseDentalCurrentTimeSelectionFromText(input: string): string {
  const text = normalizeTextForMatch(input).trim();
  if (
    !/\b(a las|alas|para las)\b/.test(text) &&
    !/^\d{1,2}(?::\d{2})?\s*(am|pm)?$/.test(text)
  ) {
    return "";
  }
  return parseDentalRescheduleTimeFromText(input);
}

function dentalPeriodSlotsList(
  slots: Array<Record<string, unknown>>,
  body: string,
  buttonText = "Ver horarios",
  period?: "morning" | "afternoon",
): WhatsAppInteractiveListSpec | undefined {
  if (!slots.length) return undefined;
  const providerNames = slots
    .map((slot) =>
      formatDentalProviderDisplayName(
        safeStr(slot.provider_name, ""),
        safeStr(slot.brand_name, ""),
      )
    )
    .filter((name) =>
      name &&
      normalizeTextForMatch(name) !== "equipo dican" &&
      normalizeTextForMatch(name) !== "doctor disponible"
    );
  const showProvider =
    new Set(providerNames.map((name) => normalizeTextForMatch(name))).size > 1;
  const toRowTitle = (slot: Record<string, unknown>) => {
    const time = formatHourLabel(safeStr(slot.time, ""));
    const provider = formatDentalProviderDisplayName(
      safeStr(slot.provider_name, ""),
      safeStr(slot.brand_name, ""),
    );
    if (!showProvider || !provider) return time.slice(0, 24);
    return `${time} · ${provider}`.slice(0, 24);
  };
  const toRows = (periodSlots: Array<Record<string, unknown>>) =>
    periodSlots.slice(0, 10).map((slot) => ({
      id: `select_slot:${safeStr(slot.date, "")}|${safeStr(slot.time, "")}|${
        safeStr(slot.provider_id, "")
      }`.slice(0, 200),
      title: toRowTitle(slot),
    }));
  const sections = period
    ? [{
      title: period === "morning" ? "Por la mañana" : "Por la tarde",
      rows: toRows(slots),
    }]
    : (() => {
      const morningRows = toRows(filterDentalSlotsByPeriod(slots, "morning"));
      const remaining = Math.max(0, 10 - morningRows.length);
      const afternoonRows = toRows(
        filterDentalSlotsByPeriod(slots, "afternoon").slice(0, remaining),
      );
      return [
        morningRows.length
          ? { title: "Por la mañana", rows: morningRows }
          : null,
        afternoonRows.length
          ? { title: "Por la tarde", rows: afternoonRows }
          : null,
      ].filter(Boolean) as WhatsAppInteractiveListSpec["sections"];
    })();
  if (!sections.length) return undefined;
  return {
    title: "Horarios",
    body,
    buttonText,
    sections,
  };
}

function formatDentalAvailabilityListBody(
  slots: Array<Record<string, unknown>>,
  brandName = "",
): string {
  const providerNames = slots
    .map((slot) =>
      formatDentalProviderDisplayName(
        safeStr(slot.provider_name, ""),
        brandName || safeStr(slot.brand_name, ""),
      )
    )
    .filter((name) =>
      name &&
      normalizeTextForMatch(name) !== "equipo dican" &&
      normalizeTextForMatch(name) !== "doctor disponible"
    );
  const showProvider =
    new Set(providerNames.map((name) => normalizeTextForMatch(name))).size > 1;
  const row = (slot: Record<string, unknown>) => {
    const time = formatHourLabel(safeStr(slot.time, ""));
    const provider = formatDentalProviderDisplayName(
      safeStr(slot.provider_name, ""),
      brandName || safeStr(slot.brand_name, ""),
    );
    return showProvider && provider ? `• ${time} · ${provider}` : `• ${time}`;
  };
  const section = (
    title: "Por la mañana" | "Por la tarde",
    sectionSlots: Array<Record<string, unknown>>,
  ) =>
    sectionSlots.length
      ? `${title}:\n${sectionSlots.slice(0, 4).map(row).join("\n")}`
      : "";
  const sections = [
    section("Por la mañana", filterDentalSlotsByPeriod(slots, "morning")),
    section("Por la tarde", filterDentalSlotsByPeriod(slots, "afternoon")),
  ].filter(Boolean).join("\n\n");
  return `Estos son algunos horarios disponibles 🦷\n\n${sections}\n\nEscogé una hora para continuar.`;
}

function resolveDentalSelectedDateFromCollected(
  collected: Record<string, unknown>,
): string {
  const pending = ((collected as any)?.pending_booking ?? {}) as Record<
    string,
    unknown
  >;
  return safeStr(
    pending.appointment_date,
    safeStr(
      (collected as any).current_date,
      safeStr((collected as any).preferred_date, ""),
    ),
  );
}

function resolveDentalSelectedServiceFromCollected(
  services: DentalGuidedService[],
  collected: Record<string, unknown>,
): DentalGuidedService | null {
  const pending = ((collected as any)?.pending_booking ?? {}) as Record<
    string,
    unknown
  >;
  const key = safeStr(
    pending.service_key,
    safeStr((collected as any).current_service_key, ""),
  );
  const name = safeStr(
    pending.service_name,
    safeStr(
      (collected as any).current_service_name,
      safeStr(pending.service, ""),
    ),
  );
  return services.find((item) => item.id === key) ??
    services.find((item) =>
      normalizeTextForMatch(item.name) === normalizeTextForMatch(name)
    ) ??
    null;
}

function clearDentalTemporaryChangeState(
  collected: Record<string, unknown>,
): Record<string, unknown> {
  const {
    pending_reschedule: _pendingReschedule,
    pending_booking: _pendingBooking,
    selected_slot: _selectedSlot,
    pending_offered_slot: _pendingOfferedSlot,
    preferred_date: _preferredDate,
    preferred_time: _preferredTime,
    last_offered_slots: _lastOfferedSlots,
    awaiting_new_time: _awaitingNewTime,
    requested_time: _requestedTime,
    requested_date: _requestedDate,
    active_flow: _activeFlow,
    expected_step: _expectedStep,
    lastBookingStep: _lastBookingStep,
    ...durable
  } = collected;
  return {
    ...durable,
    activeBookingFlow: false,
    pending_cancel: null,
    pending_cancel_appointment: null,
  };
}

function resolveDentalRescheduleService(
  services: DentalGuidedService[],
  collected: Record<string, unknown>,
): DentalGuidedService {
  const active = ((collected as any).active_appointment ??
    (collected as any).pending_reschedule ?? {}) as Record<string, unknown>;
  const serviceName = toPatientFacingServiceLabel(
    safeStr(
      (active as any).reason,
      safeStr(
        (active as any).service,
        safeStr((collected as any).service, "Revisión dental"),
      ),
    ),
  );
  return services.find((item) =>
    normalizeTextForMatch(item.name) === normalizeTextForMatch(serviceName)
  ) ?? {
    id: normalizeTextForMatch(serviceName).replace(/\s+/g, "_") ||
      "revision_dental",
    name: serviceName,
    duration_min: Number((active as any).duration_min ?? 60) || 60,
    raw: {},
  };
}

function buildDentalPeriodPending(args: {
  collected: Record<string, unknown>;
  service: DentalGuidedService;
  selectedDate: string;
  providerPreference: "any" | "specific";
  providerId?: string;
  providerName?: string;
  clinicSettings: Record<string, unknown>;
}): Record<string, unknown> {
  const bufferAfterMin = getDentalBufferAfterMin(
    args.service.name,
    args.clinicSettings,
  );
  return {
    ...(((args.collected as any)?.pending_booking ?? {}) as Record<
      string,
      unknown
    >),
    service: args.service.name,
    service_key: args.service.id,
    service_name: args.service.name,
    brand_name: getDentalBrandName(args.clinicSettings, null),
    appointment_date: args.selectedDate,
    date_year_explicit: hasDentalExplicitYearMarker(
      ((args.collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >,
      args.collected,
    ) || undefined,
    provider_id: args.providerPreference === "specific"
      ? args.providerId ?? ""
      : "",
    provider_name: args.providerPreference === "specific"
      ? args.providerName ?? ""
      : "",
    provider_preference: args.providerPreference,
    duration_min: args.service.duration_min,
    buffer_after_min: bufferAfterMin,
    effective_duration_min: args.service.duration_min + bufferAfterMin,
  };
}

async function showDentalAvailableDaysForService(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  clinicSettings: Record<string, unknown>;
  collected: Record<string, unknown>;
  service: DentalGuidedService;
  providerPreference?: "any" | "specific";
  providerId?: string | null;
  providerName?: string | null;
  debugNote: string;
  reply?: string;
}): Promise<GenerateReplyResult> {
  const providerPreference = args.providerPreference ?? "any";
  const days = await buildDentalDateOptions({
    supabase: args.supabase,
    organizationId: args.organizationId,
    clinicSettings: args.clinicSettings,
    service: args.service,
    providerId: providerPreference === "specific"
      ? args.providerId ?? null
      : null,
    providerPreference,
    limit: 10,
  });
  const pending = ((args.collected as any)?.pending_booking ?? {}) as Record<
    string,
    unknown
  >;
  const bufferAfterMin = getDentalBufferAfterMin(
    args.service.name,
    args.clinicSettings,
  );
  const collected = {
    ...args.collected,
    activeBookingFlow: true,
    lastBookingStep: "select_day",
    expected_step: "day_selection",
    current_service_key: args.service.id,
    current_service_name: args.service.name,
    service: args.service.name,
    provider_preference: providerPreference,
    preferred_provider_id: providerPreference === "specific"
      ? args.providerId ?? ""
      : "",
    preferred_provider_name: providerPreference === "specific"
      ? args.providerName ?? ""
      : "",
    pending_booking: {
      ...pending,
      service: args.service.name,
      service_key: args.service.id,
      service_name: args.service.name,
      brand_name: getDentalBrandName(args.clinicSettings, null),
      provider_id: providerPreference === "specific"
        ? args.providerId ?? ""
        : "",
      provider_name: providerPreference === "specific"
        ? args.providerName ?? ""
        : "",
      provider_preference: providerPreference,
      duration_min: args.service.duration_min,
      buffer_after_min: bufferAfterMin,
      effective_duration_min: args.service.duration_min + bufferAfterMin,
    },
    last_offered_dates: days.map((day) => ({
      date: day.date,
      label: day.label,
      source: day.offset === 0
        ? "today"
        : day.offset === 1
        ? "tomorrow"
        : "dental_available_day",
      service_key: args.service.id,
    })),
    last_offered_slots: null,
    available_slots_morning: null,
    available_slots_afternoon: null,
  };
  if (!days.length) {
    return {
      reply:
        "No veo horarios disponibles en los próximos días. Te puedo pasar con recepción para ayudarte.",
      statePatch: {
        stage: "BOOKING",
        nextExpected: "date_selection",
        collected,
      },
      leadPatch: {},
      debugNote: `${args.debugNote}_no_available_days`,
      interactiveButtons: [
        { id: "talk_to_human", title: "Hablar con recepción" },
      ],
    };
  }
  return {
    reply: args.reply ?? "¿Qué día te queda mejor? 🦷",
    statePatch: {
      stage: "BOOKING",
      nextExpected: "date_selection",
      collected,
    },
    leadPatch: {},
    debugNote: args.debugNote,
    interactiveButtons: [],
    interactiveList: dentalDateSelectionList(days),
  };
}

async function showDentalPeriodSelector(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  collected: Record<string, unknown>;
  service: DentalGuidedService;
  selectedDate: string;
  providerPreference: "any" | "specific";
  providerId?: string;
  providerName?: string;
  clinicSettings: Record<string, unknown>;
  debugNote: string;
}): Promise<GenerateReplyResult> {
  const timezone =
    safeStr((args.clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
    DEFAULT_TIMEZONE;
  if (isDentalPastDate(args.selectedDate, timezone)) {
    return dentalPastDateRejection({
      collected: args.collected,
      service: args.service,
      pending: ((args.collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >,
      debugNote: `${args.debugNote}_past_date_rejected`,
    });
  }
  const slots = await getAvailableSlotsForDay({
    supabase: args.supabase,
    organization_id: args.organizationId,
    business_type: "dental",
    service_id: args.service.id,
    service_name: args.service.name,
    provider_id: args.providerPreference === "specific"
      ? args.providerId ?? null
      : null,
    provider_preference: args.providerPreference,
    date: args.selectedDate,
    timezone,
    max_options: 20,
  });
  const morningSlots = filterDentalSlotsByPeriod(
    slots as Array<Record<string, unknown>>,
    "morning",
  );
  const afternoonSlots = filterDentalSlotsByPeriod(
    slots as Array<Record<string, unknown>>,
    "afternoon",
  );
  const isToday =
    args.selectedDate === formatLocalDateForAction(nowInTimezone(timezone));
  if (!morningSlots.length && !afternoonSlots.length) {
    return await showDentalAvailableDaysForService({
      supabase: args.supabase,
      organizationId: args.organizationId,
      clinicSettings: args.clinicSettings,
      collected: args.collected,
      service: args.service,
      providerPreference: args.providerPreference,
      providerId: args.providerId,
      providerName: args.providerName,
      debugNote: isToday
        ? "dental_guided_today_no_future_slots"
        : `${args.debugNote}_no_slots`,
      reply: "Ese día se acaba de llenar. ¿Querés escoger otro día?",
    });
  }
  return await showDentalAllSlotsForDate({
    supabase: args.supabase,
    organizationId: args.organizationId,
    clinicSettings: args.clinicSettings,
    collected: args.collected,
    service: args.service,
    selectedDate: args.selectedDate,
    providerPreference: args.providerPreference,
    providerId: args.providerId,
    providerName: args.providerName,
    debugNote: !morningSlots.length || !afternoonSlots.length
      ? `${args.debugNote}_single_period_hour_list`
      : `${args.debugNote}_grouped_hour_list`,
  });
}

async function showDentalAllSlotsForDate(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  clinicSettings: Record<string, unknown>;
  collected: Record<string, unknown>;
  service: DentalGuidedService;
  selectedDate: string;
  providerPreference: "any" | "specific";
  providerId?: string;
  providerName?: string;
  debugNote: string;
}): Promise<GenerateReplyResult> {
  const timezone =
    safeStr((args.clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
    DEFAULT_TIMEZONE;
  if (isDentalPastDate(args.selectedDate, timezone)) {
    return dentalPastDateRejection({
      collected: args.collected,
      service: args.service,
      pending: ((args.collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >,
      debugNote: `${args.debugNote}_past_date_rejected`,
    });
  }
  const slots = await getAvailableSlotsForDay({
    supabase: args.supabase,
    organization_id: args.organizationId,
    business_type: "dental",
    service_id: args.service.id,
    service_name: args.service.name,
    provider_id: args.providerPreference === "specific"
      ? args.providerId ?? null
      : null,
    provider_preference: args.providerPreference,
    date: args.selectedDate,
    timezone,
    max_options: 20,
  });
  const offeredSlots = (slots as Array<Record<string, unknown>>).map((slot) =>
    toDentalOfferedSlot(
      slot,
      args.service,
      "dental_guided_date_hour_list",
      args.clinicSettings,
    )
  );
  if (!offeredSlots.length) {
    const isToday =
      args.selectedDate === formatLocalDateForAction(nowInTimezone(timezone));
    return await showDentalAvailableDaysForService({
      supabase: args.supabase,
      organizationId: args.organizationId,
      clinicSettings: args.clinicSettings,
      collected: args.collected,
      service: args.service,
      providerPreference: args.providerPreference,
      providerId: args.providerId,
      providerName: args.providerName,
      debugNote: isToday
        ? "dental_current_date_today_no_future_slots"
        : `${args.debugNote}_no_slots`,
      reply: "Ese día se acaba de llenar. ¿Querés escoger otro día?",
    });
  }
  const morningOfferedSlots = filterDentalSlotsByPeriod(
    offeredSlots,
    "morning",
  );
  const afternoonOfferedSlots = filterDentalSlotsByPeriod(
    offeredSlots,
    "afternoon",
  );
  return {
    reply: formatDentalPeriodSelectorBody(args.selectedDate, timezone),
    statePatch: {
      stage: "BOOKING",
      nextExpected: "time_period_selection",
      collected: {
        ...args.collected,
        activeBookingFlow: true,
        lastBookingStep: "select_time_period",
        expected_step: "time_period_selection",
        current_service_key: args.service.id,
        current_service_name: args.service.name,
        current_date: args.selectedDate,
        preferred_date: args.selectedDate,
        provider_preference: args.providerPreference,
        preferred_provider_id: args.providerPreference === "specific"
          ? args.providerId ?? ""
          : "",
        preferred_provider_name: args.providerPreference === "specific"
          ? args.providerName ?? ""
          : "",
        pending_booking: buildDentalPeriodPending(args),
        last_offered_slots: null,
        available_slots_morning: morningOfferedSlots,
        available_slots_afternoon: afternoonOfferedSlots,
      },
    },
    leadPatch: {},
    debugNote: args.debugNote,
    interactiveButtons: dentalPeriodButtons({
      hasMorning: morningOfferedSlots.length > 0,
      hasAfternoon: afternoonOfferedSlots.length > 0,
    }),
  };
}

async function showDentalSlotsForPeriod(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  clinicSettings: Record<string, unknown>;
  collected: Record<string, unknown>;
  service: DentalGuidedService;
  selectedDate: string;
  providerPreference: "any" | "specific";
  providerId?: string;
  providerName?: string;
  period: "morning" | "afternoon";
  debugNote: string;
}): Promise<GenerateReplyResult> {
  const timezone =
    safeStr((args.clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
    DEFAULT_TIMEZONE;
  if (isDentalPastDate(args.selectedDate, timezone)) {
    return dentalPastDateRejection({
      collected: args.collected,
      service: args.service,
      pending: ((args.collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >,
      debugNote: `${args.debugNote}_past_date_rejected`,
    });
  }
  const cachedMorningSlots = Array.isArray(
      (args.collected as any)?.available_slots_morning,
    )
    ? ((args.collected as any).available_slots_morning as Array<
      Record<string, unknown>
    >)
    : [];
  const cachedAfternoonSlots = Array.isArray(
      (args.collected as any)?.available_slots_afternoon,
    )
    ? ((args.collected as any).available_slots_afternoon as Array<
      Record<string, unknown>
    >)
    : [];
  const hasCachedSlots = cachedMorningSlots.length > 0 ||
    cachedAfternoonSlots.length > 0;
  const slots = hasCachedSlots
    ? [...cachedMorningSlots, ...cachedAfternoonSlots]
    : await getAvailableSlotsForDay({
      supabase: args.supabase,
      organization_id: args.organizationId,
      business_type: "dental",
      service_id: args.service.id,
      service_name: args.service.name,
      provider_id: args.providerPreference === "specific"
        ? args.providerId ?? null
        : null,
      provider_preference: args.providerPreference,
      date: args.selectedDate,
      timezone,
      max_options: 20,
    });
  const periodSlots = hasCachedSlots
    ? (args.period === "morning" ? cachedMorningSlots : cachedAfternoonSlots)
    : filterDentalSlotsByPeriod(
      slots as Array<Record<string, unknown>>,
      args.period,
    );
  const oppositePeriod = args.period === "morning" ? "afternoon" : "morning";
  const oppositeSlots = filterDentalSlotsByPeriod(
    slots as Array<Record<string, unknown>>,
    oppositePeriod,
  );
  const periodLabel = args.period === "morning"
    ? "por la mañana"
    : "por la tarde";
  const oppositeTitle = args.period === "morning"
    ? "Por la tarde"
    : "Por la mañana";

  if (!periodSlots.length) {
    const body =
      `No tengo horarios disponibles ${periodLabel} para ese día. ¿Querés ver otro horario?`;
    return {
      reply: body,
      statePatch: {
        stage: "BOOKING",
        nextExpected: "time_period_selection",
        collected: {
          ...args.collected,
          activeBookingFlow: true,
          lastBookingStep: "select_time_period",
          expected_step: "time_period_selection",
          current_service_key: args.service.id,
          current_service_name: args.service.name,
          current_date: args.selectedDate,
          preferred_date: args.selectedDate,
          pending_booking: buildDentalPeriodPending(args),
          available_slots_morning: hasCachedSlots
            ? cachedMorningSlots
            : filterDentalSlotsByPeriod(
              slots as Array<Record<string, unknown>>,
              "morning",
            ).map((slot) =>
              toDentalOfferedSlot(
                slot,
                args.service,
                "dental_guided_period_recovery",
                args.clinicSettings,
              )
            ),
          available_slots_afternoon: hasCachedSlots
            ? cachedAfternoonSlots
            : filterDentalSlotsByPeriod(
              slots as Array<Record<string, unknown>>,
              "afternoon",
            ).map((slot) =>
              toDentalOfferedSlot(
                slot,
                args.service,
                "dental_guided_period_recovery",
                args.clinicSettings,
              )
            ),
        },
      },
      leadPatch: {},
      debugNote: `${args.debugNote}_empty`,
      interactiveButtons: [
        ...(oppositeSlots.length
          ? [{
            id: `dental_period:${oppositePeriod}`,
            title: oppositeTitle,
          }]
          : []),
        { id: "booking_date_pref:week", title: "Otra fecha" },
      ].slice(0, 3),
    };
  }

  const offeredSlots = periodSlots.map((slot) =>
    toDentalOfferedSlot(
      slot,
      args.service,
      args.period === "morning"
        ? "dental_guided_morning_slots"
        : "dental_guided_afternoon_slots",
      args.clinicSettings,
    )
  );
  const visibleSlots = offeredSlots.slice(0, 10);
  const body = `${
    args.period === "morning"
      ? "Horarios por la mañana"
      : "Horarios por la tarde"
  } 🦷\nEscogé una hora para continuar.${
    offeredSlots.length > 10
      ? "\n\nTe muestro los primeros horarios disponibles."
      : ""
  }`;
  return {
    reply: body,
    statePatch: {
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        ...args.collected,
        activeBookingFlow: true,
        lastBookingStep: "select_time",
        expected_step: "slot_selection",
        current_service_key: args.service.id,
        current_service_name: args.service.name,
        current_date: args.selectedDate,
        preferred_date: args.selectedDate,
        provider_preference: args.providerPreference,
        preferred_provider_id: args.providerPreference === "specific"
          ? args.providerId ?? ""
          : "",
        preferred_provider_name: args.providerPreference === "specific"
          ? args.providerName ?? ""
          : "",
        pending_booking: buildDentalPeriodPending(args),
        last_offered_slots: visibleSlots,
        available_slots_morning: hasCachedSlots
          ? cachedMorningSlots
          : filterDentalSlotsByPeriod(
            slots as Array<Record<string, unknown>>,
            "morning",
          ),
        available_slots_afternoon: hasCachedSlots
          ? cachedAfternoonSlots
          : filterDentalSlotsByPeriod(
            slots as Array<Record<string, unknown>>,
            "afternoon",
          ),
      },
    },
    leadPatch: {},
    debugNote: args.debugNote,
    interactiveButtons: [],
    interactiveList: dentalPeriodSlotsList(
      visibleSlots,
      body,
      "Ver horarios",
      args.period,
    ),
  };
}

async function showDentalSlotsForSelection(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  leadState: Json | null;
  clinicSettings: Record<string, unknown>;
  collected: Record<string, unknown>;
  service: DentalGuidedService;
  selectedDate: string;
  providerPreference: "any" | "specific";
  providerId?: string;
  providerName?: string;
  debugNote: string;
}): Promise<GenerateReplyResult> {
  const timezone =
    safeStr((args.clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
    DEFAULT_TIMEZONE;
  if (isDentalPastDate(args.selectedDate, timezone)) {
    return dentalPastDateRejection({
      collected: args.collected,
      service: args.service,
      pending: ((args.collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >,
      debugNote: `${args.debugNote}_past_date_rejected`,
    });
  }
  const bookingRules = ((args.clinicSettings as any)?.booking_rules &&
      typeof (args.clinicSettings as any).booking_rules === "object")
    ? ((args.clinicSettings as any).booking_rules as Record<string, unknown>)
    : {};
  const maxVisibleSlots = Math.max(
    1,
    Math.min(5, Number(bookingRules.max_visible_slots ?? 3) || 3),
  );
  const slots = await getAvailableSlotsForDay({
    supabase: args.supabase,
    organization_id: args.organizationId,
    business_type: "dental",
    service_id: args.service.id,
    service_name: args.service.name,
    provider_id: args.providerPreference === "specific"
      ? args.providerId ?? null
      : null,
    provider_preference: args.providerPreference,
    date: args.selectedDate,
    timezone,
    max_options: 10,
  });
  if (!slots.length) {
    const alternatives = await findDentalNextAvailableSlots({
      supabase: args.supabase,
      organizationId: args.organizationId,
      clinicSettings: args.clinicSettings,
      service: args.service,
      requestedDate: args.selectedDate,
      providerId: args.providerPreference === "specific"
        ? args.providerId ?? null
        : null,
      providerPreference: args.providerPreference,
      limit: 6,
    });
    if (alternatives.length > 0) {
      const body = `No encontré cupos para ${
        formatRequestedDayLabel(args.selectedDate)
      }, pero tengo estas opciones:`;
      const offeredSlots = alternatives.map((slot) =>
        toDentalOfferedSlot(
          slot,
          args.service,
          "dental_guided_recovery",
          args.clinicSettings,
        )
      );
      return {
        reply: body,
        statePatch: {
          stage: "BOOKING",
          nextExpected: "availability_slot_selection",
          collected: {
            ...args.collected,
            activeBookingFlow: true,
            lastBookingStep: "select_time",
            expected_step: "slot_selection",
            current_service_key: args.service.id,
            current_service_name: args.service.name,
            current_date: args.selectedDate,
            preferred_date: args.selectedDate,
            provider_preference: args.providerPreference,
            preferred_provider_id: args.providerPreference === "specific"
              ? args.providerId ?? ""
              : "",
            preferred_provider_name: args.providerPreference === "specific"
              ? args.providerName ?? ""
              : "",
            pending_booking: {
              ...(((args.collected as any)?.pending_booking ?? {}) as Record<
                string,
                unknown
              >),
              service: args.service.name,
              service_key: args.service.id,
              service_name: args.service.name,
              provider_id: args.providerPreference === "specific"
                ? args.providerId ?? ""
                : "",
              provider_name: args.providerPreference === "specific"
                ? args.providerName ?? ""
                : "",
              provider_preference: args.providerPreference,
              duration_min: args.service.duration_min,
              buffer_after_min: getDentalBufferAfterMin(
                args.service.name,
                args.clinicSettings,
              ),
              effective_duration_min: args.service.duration_min +
                getDentalBufferAfterMin(args.service.name, args.clinicSettings),
            },
            last_offered_slots: offeredSlots,
          },
        },
        leadPatch: {},
        debugNote: "dental_guided_next_available_recovery",
        interactiveButtons: dentalAlternativeSlotButtons(alternatives),
        interactiveList: dentalAlternativeSlotsList(
          alternatives,
          body,
          args.service.name,
        ),
      };
    }
    return {
      reply:
        "No encontré horarios disponibles por ahora. Te puedo pasar con recepción para revisar manualmente.",
      statePatch: {
        stage: "BOOKING",
        nextExpected: "date_selection",
        collected: {
          ...args.collected,
          current_service_key: args.service.id,
          current_service_name: args.service.name,
          current_date: args.selectedDate,
          preferred_date: args.selectedDate,
          lastBookingStep: "select_day",
          expected_step: "day_selection",
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_no_slots",
      interactiveButtons: [
        { id: "talk_to_human", title: "Hablar con recepción" },
        { id: "booking_date_pref:week", title: "Otra fecha" },
      ],
    };
  }
  const offeredSlots = slots.map((slot) =>
    toDentalOfferedSlot(
      slot as Record<string, unknown>,
      args.service,
      "dental_guided",
      args.clinicSettings,
    )
  );
  const shown = slots.slice(0, maxVisibleSlots);
  const body = offeredSlots.length > 3
    ? formatDentalAvailabilityListBody(
      offeredSlots,
      getDentalBrandName(args.clinicSettings, null),
    )
    : `Estos horarios están disponibles 🦷\n\n${
      shown.map((slot) => `• ${formatHourLabel(safeStr(slot.time, ""))}`)
        .join("\n")
    }\n\nEscogé una hora para continuar.`;
  const bufferAfterMin = getDentalBufferAfterMin(
    args.service.name,
    args.clinicSettings,
  );
  return {
    reply: body,
    statePatch: {
      stage: "BOOKING",
      nextExpected: "availability_slot_selection",
      collected: {
        ...args.collected,
        activeBookingFlow: true,
        lastBookingStep: "select_time",
        expected_step: "slot_selection",
        current_service_key: args.service.id,
        current_service_name: args.service.name,
        current_date: args.selectedDate,
        preferred_date: args.selectedDate,
        provider_preference: args.providerPreference,
        preferred_provider_id: args.providerPreference === "specific"
          ? args.providerId ?? ""
          : "",
        preferred_provider_name: args.providerPreference === "specific"
          ? args.providerName ?? ""
          : "",
        pending_booking: {
          ...(((args.collected as any)?.pending_booking ?? {}) as Record<
            string,
            unknown
          >),
          service: args.service.name,
          service_key: args.service.id,
          service_name: args.service.name,
          appointment_date: args.selectedDate,
          provider_id: args.providerPreference === "specific"
            ? args.providerId ?? ""
            : "",
          provider_name: args.providerPreference === "specific"
            ? args.providerName ?? ""
            : "",
          provider_preference: args.providerPreference,
          duration_min: args.service.duration_min,
          buffer_after_min: bufferAfterMin,
          effective_duration_min: args.service.duration_min + bufferAfterMin,
        },
        last_offered_slots: offeredSlots,
      },
    },
    leadPatch: {},
    debugNote: args.debugNote,
    interactiveButtons: shown.length <= 3
      ? shown.map((slot) => ({
        id: `select_slot:${safeStr(slot.date, "")}|${safeStr(slot.time, "")}|${
          safeStr(slot.provider_id, "")
        }`,
        title: formatHourLabel(safeStr(slot.time, "")).slice(0, 20),
      }))
      : [],
    interactiveList: dentalPeriodSlotsList(offeredSlots, body),
  };
}

async function handleDentalDirectBookingRequest(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  leadState: Json | null;
  clinicSettings: Record<string, unknown>;
  collected: Record<string, unknown>;
  services: DentalGuidedService[];
  providers: DentalGuidedProvider[];
  inboundText: string;
  nowLocal: Date;
}): Promise<GenerateReplyResult | null> {
  const text = normalizeTextForMatch(args.inboundText);
  const requestedService = resolveDentalServiceFromActionOrText(
    args.services,
    args.inboundText,
  ) ??
    (isDentalEmergencyText(args.inboundText)
      ? (resolveDentalServiceFromActionOrText(args.services, "emergencia") ??
        resolveDentalServiceFromActionOrText(args.services, "revision") ??
        resolveDentalServiceFromActionOrText(args.services, "consulta"))
      : null);
  const hasBookingLanguage =
    /\b(cita|agendar|reservar|consulta|necesito|quiero|para)\b/.test(text) ||
    isDentalEmergencyText(args.inboundText);
  const ambiguousWeekday = getDentalAmbiguousWeekdayOptions(
    args.inboundText,
    args.nowLocal,
  );
  const requestedDateResult = ambiguousWeekday
    ? { date: "", yearExplicit: false }
    : parseDentalDateFromTextWithMetadata(args.inboundText, args.nowLocal);
  const requestedDate = requestedDateResult.date;
  const requestedTime = parseDentalExplicitTimeFromText(args.inboundText);
  const futureRange = parseDentalFutureRangeFromText(
    args.inboundText,
    args.nowLocal,
  );
  const hasTemporalSignal = Boolean(requestedDate || requestedTime) ||
    /\b(temprano|por la manana|por la mañana|en la manana|en la mañana)\b/
      .test(text);
  if (!hasBookingLanguage && !hasTemporalSignal) return null;
  const timezone =
    safeStr((args.clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
    DEFAULT_TIMEZONE;
  if (requestedDate && isDentalPastDate(requestedDate, timezone)) {
    return dentalPastDateRejection({
      collected: args.collected,
      service: requestedService,
      pending: ((args.collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >,
      debugNote: "dental_direct_booking_past_date_rejected",
    });
  }

  if (requestedService && ambiguousWeekday) {
    return {
      reply: `¿Te referís a ${
        formatRequestedDayLabel(ambiguousWeekday.first)
      } o ${formatRequestedDayLabel(ambiguousWeekday.second)}?`,
      statePatch: {
        stage: "BOOKING",
        nextExpected: "date_selection",
        collected: {
          ...args.collected,
          activeBookingFlow: true,
          lastBookingStep: "select_day",
          expected_step: "day_selection",
          current_service_key: requestedService.id,
          current_service_name: requestedService.name,
          pending_booking: {
            ...(((args.collected as any)?.pending_booking ?? {}) as Record<
              string,
              unknown
            >),
            service: requestedService.name,
            service_key: requestedService.id,
            service_name: requestedService.name,
            requested_time: requestedTime,
          },
          last_offered_dates: [
            {
              date: ambiguousWeekday.first,
              label: formatRequestedDayLabel(ambiguousWeekday.first),
              source: "dental_weekday_clarification",
            },
            {
              date: ambiguousWeekday.second,
              label: formatRequestedDayLabel(ambiguousWeekday.second),
              source: "dental_weekday_clarification",
            },
          ],
        },
      },
      leadPatch: {},
      debugNote: "dental_direct_booking_weekday_clarification",
      interactiveButtons: [
        {
          id: `select_date:${ambiguousWeekday.first}`,
          title: formatDentalShortDateButton(ambiguousWeekday.first),
        },
        {
          id: `select_date:${ambiguousWeekday.second}`,
          title: formatDentalShortDateButton(ambiguousWeekday.second),
        },
        { id: "booking_date_pref:week", title: "Otra fecha" },
      ],
    };
  }

  if (requestedService && futureRange) {
    const days = await buildDentalDateOptionsInRange({
      supabase: args.supabase,
      organizationId: args.organizationId,
      clinicSettings: args.clinicSettings,
      service: requestedService,
      startOffset: futureRange.startOffset,
      endOffset: futureRange.endOffset,
      limit: 7,
    });
    return {
      reply: days.length
        ? "Tengo estas fechas disponibles esa semana 🦷"
        : "No encontré fechas disponibles esa semana. ¿Querés revisar otra fecha?",
      statePatch: {
        stage: "BOOKING",
        nextExpected: "date_selection",
        collected: {
          ...args.collected,
          activeBookingFlow: true,
          lastBookingStep: "select_day",
          expected_step: "day_selection",
          current_service_key: requestedService.id,
          current_service_name: requestedService.name,
          pending_booking: {
            ...(((args.collected as any)?.pending_booking ?? {}) as Record<
              string,
              unknown
            >),
            service: requestedService.name,
            service_key: requestedService.id,
            service_name: requestedService.name,
          },
          last_offered_dates: days.map((day) => ({
            date: day.date,
            label: day.label,
            source: "dental_future_range",
          })),
        },
      },
      leadPatch: {},
      debugNote: "dental_direct_booking_future_range_dates",
      interactiveList: dentalDateSelectionList(days),
      interactiveButtons: days.length ? [] : [
        { id: "booking_date_pref:week", title: "Otra fecha" },
        { id: "talk_to_human", title: "Hablar con recepción" },
      ],
    };
  }

  if (!requestedService && (requestedDate || requestedTime)) {
    const list = dentalServiceSelectionList(
      args.services,
      "Perfecto 🦷 ¿Qué servicio necesitás?",
    );
    return {
      reply: list?.body ?? "Perfecto 🦷 ¿Qué servicio necesitás?",
      statePatch: {
        stage: "BOOKING",
        nextExpected: "service_selection",
        collected: {
          ...args.collected,
          activeBookingFlow: true,
          lastBookingStep: "select_service",
          expected_step: "service_selection",
          pending_booking: {
            ...(((args.collected as any)?.pending_booking ?? {}) as Record<
              string,
              unknown
            >),
            appointment_date: requestedDate || safeStr(
              (args.collected as any)?.pending_booking?.appointment_date,
              "",
            ),
            date_year_explicit: requestedDateResult.yearExplicit || undefined,
            appointment_time: requestedTime || safeStr(
              (args.collected as any)?.pending_booking?.appointment_time,
              "",
            ),
            requested_time: requestedTime || safeStr(
              (args.collected as any)?.pending_booking?.requested_time,
              "",
            ),
          },
        },
      },
      leadPatch: {},
      debugNote: "dental_direct_booking_missing_service_preserved_datetime",
      interactiveButtons: dentalServiceButtons(args.services),
      interactiveList: list,
    };
  }
  if (!requestedService) return null;

  const bufferAfterMin = getDentalBufferAfterMin(
    requestedService.name,
    args.clinicSettings,
  );
  const basePending = {
    ...(((args.collected as any)?.pending_booking ?? {}) as Record<
      string,
      unknown
    >),
    service: requestedService.name,
    service_key: requestedService.id,
    service_name: requestedService.name,
    brand_name: getDentalBrandName(args.clinicSettings, null),
    date_year_explicit: requestedDateResult.yearExplicit || undefined,
    duration_min: requestedService.duration_min,
    buffer_after_min: bufferAfterMin,
    effective_duration_min: requestedService.duration_min + bufferAfterMin,
  };

  if (!requestedDate) {
    return await showDentalAvailableDaysForService({
      supabase: args.supabase,
      organizationId: args.organizationId,
      clinicSettings: args.clinicSettings,
      collected: {
        ...args.collected,
        pending_booking: basePending,
      },
      service: requestedService,
      providerPreference: "any",
      debugNote: "dental_direct_booking_missing_date",
    });
  }

  const provider = args.providers.length <= 1 ? args.providers[0] : null;
  if (!requestedTime) {
    if (provider) {
      return await showDentalPeriodSelector({
        supabase: args.supabase,
        organizationId: args.organizationId,
        collected: {
          ...args.collected,
          date_year_explicit: requestedDateResult.yearExplicit || undefined,
          pending_booking: {
            ...basePending,
            appointment_date: requestedDate,
          },
        },
        service: requestedService,
        selectedDate: requestedDate,
        providerPreference: "specific",
        providerId: provider.id,
        providerName: provider.name,
        clinicSettings: args.clinicSettings,
        debugNote: "dental_direct_booking_date_only_period_selector",
      });
    }
    return await showDentalPeriodSelector({
      supabase: args.supabase,
      organizationId: args.organizationId,
      collected: {
        ...args.collected,
        date_year_explicit: requestedDateResult.yearExplicit || undefined,
        pending_booking: {
          ...basePending,
          appointment_date: requestedDate,
        },
      },
      service: requestedService,
      selectedDate: requestedDate,
      providerPreference: "any",
      clinicSettings: args.clinicSettings,
      debugNote: "dental_direct_booking_date_only_period_selector",
    });
  }

  const slots = await getAvailableSlotsForDay({
    supabase: args.supabase,
    organization_id: args.organizationId,
    business_type: "dental",
    service_id: requestedService.id,
    service_name: requestedService.name,
    provider_id: provider?.id ?? null,
    provider_preference: provider ? "specific" : "any",
    date: requestedDate,
    time_preference: "specific",
    specific_time: requestedTime,
    timezone,
    max_options: 10,
  });
  const exactSlot = slots.find((slot) =>
    safeStr(slot.time, "") === requestedTime
  );
  if (exactSlot) {
    const offered = toDentalOfferedSlot(
      exactSlot as Record<string, unknown>,
      requestedService,
      "dental_direct_booking_exact",
      args.clinicSettings,
    );
    const pendingBooking = buildDentalPendingBookingFromSlot({
      slot: offered,
      pending: basePending,
      clinicSettings: args.clinicSettings,
      fallbackService: requestedService,
    });
    return dentalConfirmationOrNameGate({
      leadState: args.leadState,
      collected: {
        ...args.collected,
        activeBookingFlow: true,
        current_service_key: requestedService.id,
        current_service_name: requestedService.name,
        current_date: requestedDate,
        preferred_date: requestedDate,
        date_year_explicit: requestedDateResult.yearExplicit || undefined,
        last_offered_slots: [offered],
      },
      pendingBooking,
      debugNote: "dental_direct_booking_confirmation",
    });
  }

  const alternatives = await getAvailableSlotsForDay({
    supabase: args.supabase,
    organization_id: args.organizationId,
    business_type: "dental",
    service_id: requestedService.id,
    service_name: requestedService.name,
    provider_id: provider?.id ?? null,
    provider_preference: provider ? "specific" : "any",
    date: requestedDate,
    timezone:
      safeStr((args.clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
      DEFAULT_TIMEZONE,
    max_options: 10,
  });
  const offeredSlots = alternatives.map((slot) =>
    toDentalOfferedSlot(
      slot as Record<string, unknown>,
      requestedService,
      "dental_direct_booking_alternative",
      args.clinicSettings,
    )
  );
  const body = alternatives.length
    ? `Para ${formatRequestedDayLabel(requestedDate)} a las *${
      formatHourLabel(requestedTime)
    }* no tengo disponibilidad, pero tengo estas opciones:`
    : `Para ${formatRequestedDayLabel(requestedDate)} a las *${
      formatHourLabel(requestedTime)
    }* no tengo disponibilidad. ¿Querés revisar otra fecha?`;
  return {
    reply: body,
    statePatch: {
      stage: "BOOKING",
      nextExpected: alternatives.length
        ? "availability_slot_selection"
        : "date_selection",
      collected: {
        ...args.collected,
        activeBookingFlow: true,
        lastBookingStep: alternatives.length ? "select_time" : "select_day",
        expected_step: alternatives.length ? "slot_selection" : "day_selection",
        current_service_key: requestedService.id,
        current_service_name: requestedService.name,
        current_date: requestedDate,
        preferred_date: requestedDate,
        date_year_explicit: requestedDateResult.yearExplicit || undefined,
        pending_booking: {
          ...basePending,
          appointment_date: requestedDate,
          requested_time: requestedTime,
        },
        last_offered_slots: offeredSlots,
      },
    },
    leadPatch: {},
    debugNote: alternatives.length
      ? "dental_direct_booking_alternatives"
      : "dental_direct_booking_no_slots",
    interactiveButtons: alternatives.length
      ? dentalAlternativeSlotButtons(
        alternatives as Array<Record<string, unknown>>,
      )
      : [{ id: "booking_date_pref:week", title: "Otra fecha" }],
    interactiveList: alternatives.length
      ? dentalAlternativeSlotsList(
        alternatives as Array<Record<string, unknown>>,
        body,
        requestedService.name,
      )
      : undefined,
  };
}

async function handleDentalGuidedRuntimeTurn(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  inboundText: string;
  normalizedAction: string;
  leadState: Json | null;
  clinicSettings: Record<string, unknown>;
  orgSettings: Record<string, unknown> | null;
}): Promise<GenerateReplyResult | null> {
  const {
    supabase,
    organizationId,
    leadId,
    inboundText,
    leadState,
    clinicSettings,
    orgSettings,
  } = args;
  const brandName = getDentalBrandName(clinicSettings, orgSettings);
  const services = getDentalGuidedServices(clinicSettings);
  const providers = getDentalGuidedProviders(clinicSettings);
  const collected = ((leadState as any)?.collected ?? {}) as Record<
    string,
    unknown
  >;
  const pending = ((collected as any)?.pending_booking ?? {}) as Record<
    string,
    unknown
  >;
  const timezone =
    safeStr((clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
    DEFAULT_TIMEZONE;
  const nowLocal = nowInTimezone(timezone);
  let normalizedAction = normalizeDentalGuardChoiceActionValue(
    args.normalizedAction,
  );
  const text = normalizeTextForMatch(inboundText);
  const expected = safeStr(
    (leadState as any)?.nextExpected,
    safeStr((collected as any)?.expected_step, ""),
  );

  if (!normalizedAction) {
    if (expected === "service_selection") {
      const service = resolveDentalServiceFromActionOrText(
        services,
        inboundText,
      );
      if (service) normalizedAction = `select_service:${service.id}`;
    } else if (
      expected === "booking_date_preference" || expected === "date_selection"
    ) {
      const ambiguousWeekday = getDentalAmbiguousWeekdayOptions(
        inboundText,
        nowLocal,
      );
      if (ambiguousWeekday) {
        normalizedAction =
          `dental_weekday_clarify:${ambiguousWeekday.first}|${ambiguousWeekday.second}`;
      }
      const futureRange = !normalizedAction
        ? parseDentalFutureRangeFromText(inboundText, nowLocal)
        : null;
      if (futureRange) {
        normalizedAction =
          `dental_date_range:${futureRange.startOffset}|${futureRange.endOffset}`;
      }
      if (!normalizedAction) {
        normalizedAction = resolveGuidedDateActionFromText(
          inboundText,
          Array.isArray((collected as any).last_offered_dates)
            ? ((collected as any).last_offered_dates as any[])
            : [],
          nowLocal,
        );
      }
      if (!normalizedAction) {
        const parsedDateResult = parseDentalDateFromTextWithMetadata(
          inboundText,
          nowLocal,
        );
        const parsedDate = parsedDateResult.date;
        const parsedTime = parseDentalExplicitTimeFromText(inboundText);
        if (parsedDate && parsedTime) {
          normalizedAction = parsedDateResult.yearExplicit
            ? `dental_date_time_explicit_year:${parsedDate}|${parsedTime}`
            : `dental_date_time:${parsedDate}|${parsedTime}`;
        } else if (parsedDate) {
          normalizedAction = parsedDateResult.yearExplicit
            ? `select_date_explicit_year:${parsedDate}`
            : `select_date:${parsedDate}`;
        }
      }
    } else if (expected === "provider_selection") {
      const provider = resolveDentalProviderFromActionOrText(
        providers,
        inboundText,
      );
      if (provider) {
        normalizedAction = `select_provider:${
          provider.preference === "any" ? "any" : provider.id
        }`;
      }
    } else if (
      expected === "dental_time_period" || expected === "time_period_selection"
    ) {
      if (isDentalChangeHourText(text) || isDentalKeepSelectedDateText(text)) {
        normalizedAction = "dental_show_current_date_hours";
      } else {
        const parsedTime = parseDentalCurrentTimeSelectionFromText(inboundText);
        if (parsedTime && resolveDentalSelectedDateFromCollected(collected)) {
          normalizedAction = `dental_current_date_time:${parsedTime}`;
        }
      }
      if (!normalizedAction) {
        if (
          /\b(por la manana|por la mañana|manana|mañana|temprano)\b/.test(text)
        ) {
          normalizedAction = "dental_period:morning";
        } else if (/\b(por la tarde|tarde|despues|después)\b/.test(text)) {
          normalizedAction = "dental_period:afternoon";
        } else if (
          /\b(otra fecha|otro dia|otra fecha|cambiar dia|cambiar día)\b/.test(
            text,
          )
        ) {
          normalizedAction = "booking_date_pref:week";
        }
      }
    } else if (expected === "dental_cancel_recovery") {
      if (
        isAffirmativeDentalText(inboundText) ||
        /\b(buscar|otro horario|otra hora|horario)\b/.test(text)
      ) {
        normalizedAction = "dental_recovery:search_other_time";
      } else if (/\b(nueva cita|empezar|otra cita|agendar)\b/.test(text)) {
        normalizedAction = "booking_start";
      }
    } else if (expected === "active_appointment_intent_choice") {
      normalizedAction = resolveGuidedConflictActionFromText(inboundText);
    } else if (expected === "confirm_cancel_appointment") {
      if (
        normalizedAction === "confirm_cancel_appointment" ||
        /\b(confirmar cancelacion|confirmar cancelación)\b/.test(text) ||
        isAffirmativeDentalText(inboundText)
      ) {
        normalizedAction = "confirm_cancel_appointment";
      } else if (
        normalizedAction === "keep_existing_booking" ||
        /\b(mantener|mantener cita|dejarla igual|no cancelar)\b/.test(text)
      ) {
        normalizedAction = "keep_existing_booking";
      } else if (
        normalizedAction === "reschedule_booking" ||
        normalizedAction === "change_booking_slot" ||
        /\b(cambiar hora|cambiarla|reagendar|mover)\b/.test(text)
      ) {
        normalizedAction = "dental_reschedule_show_hours";
      }
    } else if (expected === "confirm_reschedule_appointment") {
      if (
        normalizedAction === "confirm_reschedule_appointment" ||
        /\b(confirmar cambio|confirmar)\b/.test(text) ||
        isAffirmativeDentalText(inboundText)
      ) {
        normalizedAction = "confirm_reschedule_appointment";
      } else if (
        normalizedAction === "change_booking_slot" ||
        /\b(cambiar hora|otra hora|otro horario)\b/.test(text)
      ) {
        normalizedAction = "dental_reschedule_show_hours";
      } else if (
        normalizedAction === "cancel_booking" ||
        /\b(cancelar|mejor no|no confirmar)\b/.test(text)
      ) {
        normalizedAction = "keep_existing_booking";
      }
    } else if (
      expected === "reschedule_datetime" ||
      expected === "reschedule_new_datetime"
    ) {
      if (
        normalizedAction === "change_booking_slot" ||
        normalizedAction === "dental_reschedule_show_hours" ||
        /\b(ver horarios|horarios|mostrar horarios)\b/.test(text)
      ) {
        normalizedAction = "dental_reschedule_show_hours";
      } else if (
        normalizedAction === "dental_reschedule_change_date" ||
        /\b(cambiar dia|cambiar día|cambiar fecha|otra fecha|otro dia|otro día)\b/
          .test(text)
      ) {
        normalizedAction = "dental_reschedule_change_date";
      } else if (
        normalizedAction === "keep_existing_booking" ||
        normalizedAction === "cancel_booking" ||
        /\b(no hacer cambios|cancelar cambio|cancelar|dejarla igual|dejar igual|mantener|no)\b/
          .test(text)
      ) {
        normalizedAction = "keep_existing_booking";
      } else if (
        /\b(solo la hora|solo quiero cambiar la hora|cambiar solo hora|misma fecha|mismo dia|mismo día|la misma fecha)\b/
          .test(text) &&
        !parseDentalRescheduleTimeFromText(inboundText)
      ) {
        normalizedAction = "dental_reschedule_show_hours";
      }
      const activeAppointment = ((collected as any).active_appointment ??
        (collected as any).pending_reschedule ?? {}) as Record<string, unknown>;
      const parsedDate = parseDentalRescheduleDateFromText(
        inboundText,
        nowLocal,
        activeAppointment,
      );
      const parsedTime = parseDentalRescheduleTimeFromText(inboundText);
      if (!normalizedAction && (parsedDate || parsedTime)) {
        normalizedAction =
          `dental_reschedule_datetime:${parsedDate}|${parsedTime}`;
      }
    } else if (expected === "reschedule_date_preference") {
      if (normalizedAction === "dental_reschedule_change_date") {
        // Keep explicit action as-is.
      } else {
        const parsedDate = parseDentalDateFromText(inboundText, nowLocal);
        if (parsedDate) {
          normalizedAction = `dental_reschedule_date:${parsedDate}`;
        }
      }
    } else if (expected === "availability_slot_selection") {
      if (isDentalChangeHourText(text) || isDentalKeepSelectedDateText(text)) {
        normalizedAction = "dental_show_current_date_hours";
      }
      if (!normalizedAction) {
        normalizedAction = resolveGuidedSlotActionFromText(
          inboundText,
          Array.isArray((collected as any).last_offered_slots)
            ? ((collected as any).last_offered_slots as any[])
            : [],
          true,
        );
      }
      if (!normalizedAction) {
        const parsedTime = parseDentalCurrentTimeSelectionFromText(inboundText);
        if (parsedTime && resolveDentalSelectedDateFromCollected(collected)) {
          normalizedAction = `dental_current_date_time:${parsedTime}`;
        }
      }
      if (!normalizedAction) {
        const parsedDateResult = parseDentalDateFromTextWithMetadata(
          inboundText,
          nowLocal,
        );
        const parsedDate = parsedDateResult.date;
        if (parsedDate && !parseDentalExplicitTimeFromText(inboundText)) {
          normalizedAction = parsedDateResult.yearExplicit
            ? `select_date_explicit_year:${parsedDate}`
            : `select_date:${parsedDate}`;
        }
      }
      if (!normalizedAction && isAffirmativeDentalText(inboundText)) {
        const offeredSlots =
          Array.isArray((collected as any).last_offered_slots)
            ? ((collected as any).last_offered_slots as any[])
            : [];
        const first = offeredSlots[0];
        if (first) {
          normalizedAction = `select_slot:${safeStr(first.date, "")}|${
            safeStr(first.time, "")
          }|${safeStr(first.provider_id, "")}`;
        }
      }
    } else if (expected === "confirm_booking") {
      normalizedAction = resolveGuidedConfirmationActionFromText(inboundText);
    }
  }

  if (normalizedAction.startsWith("select_active_appointment:")) {
    const appointmentId = normalizePayloadActionValue(normalizedAction)
      .replace(/^select_active_appointment:/, "")
      .trim();
    const options =
      Array.isArray((collected as any).active_appointments_options)
        ? ((collected as any).active_appointments_options as Array<
          Record<string, unknown>
        >)
        : [];
    const selected = options.find((appointment) =>
      safeStr(appointment.id, "") === appointmentId
    );
    if (!selected?.id) return null;
    return {
      reply: "¿Qué querés hacer?",
      statePatch: {
        stage: "BOOKING",
        nextExpected: "active_appointment_intent_choice",
        collected: {
          ...collected,
          active_appointment: selected,
        },
      },
      leadPatch: {},
      debugNote: "dental_active_appointment_selected",
      interactiveButtons: dentalAppointmentReviewButtons(),
    };
  }

  if (
    !normalizedAction &&
    /\b(hola|buenas|buenos dias|buen dia|buenas tardes|menu|menú|inicio)\b/
      .test(text) &&
    !/\b(cita|agendar|precio|servicio|dolor|emergencia|horario|ubicacion|ubicación)\b/
      .test(text)
  ) {
    return {
      reply: formatDentalGreetingCopy(brandName),
      statePatch: {
        stage: "DISCOVERY",
        lastIntent: "greeting",
        nextExpected: "dental_menu",
      },
      leadPatch: {},
      debugNote: "dental_guided_greeting",
      interactiveButtons: dentalGreetingButtons(),
    };
  }

  if (
    normalizedAction === "dental_info" ||
    /\b(info clinica|info clínica|informacion clinica|información clínica|datos de la clinica|datos de la clínica)\b/
      .test(text)
  ) {
    return {
      reply: "Claro 🦷 ¿Qué querés consultar?",
      statePatch: {
        stage: "DISCOVERY",
        lastIntent: "clinic_info",
        nextExpected: "dental_info_menu",
        collected: { ...collected, activeBookingFlow: false },
      },
      leadPatch: {},
      debugNote: "dental_guided_clinic_info_menu",
      interactiveButtons: [
        { id: "dental_hours", title: "Horarios" },
        { id: "dental_location", title: "Ubicación" },
        { id: "talk_to_human", title: "Hablar con recepción" },
      ],
    };
  }

  if (
    normalizedAction === "dental_hours" ||
    (expected === "dental_info_menu" && /\b(horario|horarios)\b/.test(text)) ||
    (!normalizedAction &&
      /\b(horario|horarios|abren|atienden|atiende)\b/.test(text))
  ) {
    return {
      reply: formatDentalHoursInfo(brandName, clinicSettings),
      statePatch: {
        stage: "SERVICE_INFO",
        lastIntent: "business_hours_question",
        nextExpected: "dental_menu",
        collected: { ...collected, activeBookingFlow: false },
      },
      leadPatch: {},
      debugNote: "dental_guided_hours_info",
      interactiveButtons: [
        { id: "booking_start", title: "Agendar cita" },
        { id: "view_prices", title: "Servicios" },
      ],
    };
  }

  if (
    normalizedAction === "dental_location" ||
    (expected === "dental_info_menu" &&
      /\b(ubicacion|ubicación|direccion|dirección|donde estan|dónde están)\b/
        .test(text)) ||
    (!normalizedAction &&
      /\b(ubicacion|ubicación|direccion|dirección|donde estan|dónde están)\b/
        .test(text))
  ) {
    const location = resolveDentalLocationInfo(clinicSettings);
    if (location) {
      return {
        reply: `📍 Estamos en ${location}.\n\n¿Querés agendar una cita?`,
        statePatch: {
          stage: "SERVICE_INFO",
          lastIntent: "location_question",
          nextExpected: "dental_menu",
          collected: { ...collected, activeBookingFlow: false },
        },
        leadPatch: {},
        debugNote: "dental_guided_location_info",
        interactiveButtons: [
          { id: "booking_start", title: "Agendar cita" },
          { id: "view_prices", title: "Servicios" },
        ],
      };
    }
    return {
      reply:
        "Por ahora no tengo la ubicación configurada. Puedo pasarte con recepción para confirmarla.",
      statePatch: {
        stage: "SERVICE_INFO",
        lastIntent: "location_question",
        nextExpected: "dental_menu",
        collected: { ...collected, activeBookingFlow: false },
      },
      leadPatch: {},
      debugNote: "dental_guided_location_missing",
      interactiveButtons: [
        { id: "talk_to_human", title: "Hablar con recepción" },
        { id: "booking_start", title: "Agendar cita" },
      ],
    };
  }

  if (
    normalizedAction === "talk_to_human" ||
    normalizedAction === "human_handoff" ||
    /\b(hablar con alguien|recepcion|recepción|asesor|persona|pasame con alguien|pásame con alguien|pasame con recepcion|pásame con recepción)\b/
      .test(text)
  ) {
    await recordHumanHandoffEvent({
      supabase,
      organizationId,
      leadId,
      channel: safeStr(
        (leadState as any)?.channel,
        safeStr((leadState as any)?.last_channel, ""),
      ),
      messagePreview: inboundText,
    });
    return {
      reply: formatDentalHandoffCopy(),
      statePatch: {
        stage: "HANDOFF",
        lastIntent: "human_handoff",
        nextExpected: undefined,
        collected: { ...collected, activeBookingFlow: false },
      },
      leadPatch: { handoff_to_human: true, updated_at: nowIso() },
      debugNote: "dental_guided_handoff_requested",
    };
  }

  if (normalizedAction === "additional_booking") {
    return buildDentalAdditionalBookingServicePickerResult({
      clinicSettings,
      collected,
    });
  }

  if (
    normalizedAction === "booking_start" ||
    /\b(agendar cita|quiero agendar|necesito una cita|necesito cita|quiero cita|agendar|reservar)\b/
      .test(text)
  ) {
    const allowAdditionalBooking = Boolean(
      (collected as any).allow_additional_booking,
    );
    if (!allowAdditionalBooking) {
      const active = await loadActiveAppointmentForLead({
        supabase,
        organizationId,
        leadId,
      }) as Record<string, unknown> | null;
      if (active?.id) {
        const activeState = buildDentalActiveAppointmentState(
          active,
          "Revisión dental",
          brandName,
        );
        return {
          reply: formatDentalActiveAppointmentGuardReply(activeState),
          statePatch: {
            ...dentalAttemptedBookingTopLevelClearPatch(),
            stage: "BOOKING",
            lastIntent: "active_appointment_guard",
            nextExpected: "active_appointment_intent_choice",
            collected: clearDentalAttemptedBookingState(collected, {
              activeBookingFlow: false,
              active_appointment: activeState,
            }),
          },
          leadPatch: {},
          debugNote: "dental_guided_booking_start_active_appointment_guard",
          interactiveButtons: [
            { id: "reschedule_booking", title: "Cambiar mi cita" },
            { id: "additional_booking", title: "Agendar otra cita" },
            { id: "keep_existing_booking", title: "Mantener mi cita" },
          ],
        };
      }
    }
  }

  if (normalizedAction === "dental_show_current_date_hours") {
    const service = resolveDentalSelectedServiceFromCollected(
      services,
      collected,
    );
    const selectedDate = resolveDentalSelectedDateFromCollected(collected);
    if (!service) {
      const reply = "Perfecto 🦷 ¿Qué servicio necesitás?";
      return {
        reply,
        statePatch: {
          stage: "BOOKING",
          nextExpected: "service_selection",
          collected: {
            ...collected,
            activeBookingFlow: true,
            lastBookingStep: "select_service",
            expected_step: "service_selection",
          },
        },
        leadPatch: {},
        debugNote: "dental_current_date_hours_missing_service",
        interactiveList: dentalServiceSelectionList(services, reply),
      };
    }
    if (!selectedDate) {
      return await showDentalAvailableDaysForService({
        supabase,
        organizationId,
        clinicSettings,
        collected,
        service,
        providerPreference: "any",
        debugNote: "dental_current_date_hours_missing_date",
      });
    }
    const providerPreference = safeStr(
        (collected as any).provider_preference,
        safeStr((pending as any).provider_preference, "any"),
      ) === "specific"
      ? "specific"
      : "any";
    return await showDentalAllSlotsForDate({
      supabase,
      organizationId,
      clinicSettings,
      collected,
      service,
      selectedDate,
      providerPreference,
      providerId: safeStr(
        (collected as any).preferred_provider_id,
        safeStr((pending as any).provider_id, ""),
      ),
      providerName: safeStr(
        (collected as any).preferred_provider_name,
        safeStr((pending as any).provider_name, ""),
      ),
      debugNote: "dental_current_date_hour_list",
    });
  }

  if (
    normalizedAction.startsWith("dental_current_date_time:") ||
    normalizedAction.startsWith("dental_date_time:") ||
    normalizedAction.startsWith("dental_date_time_explicit_year:")
  ) {
    const dateTimeYearExplicit = normalizedAction.startsWith(
      "dental_date_time_explicit_year:",
    );
    const explicitDateTime = normalizedAction.startsWith("dental_date_time:") ||
        dateTimeYearExplicit
      ? normalizedAction.replace(
        dateTimeYearExplicit
          ? "dental_date_time_explicit_year:"
          : "dental_date_time:",
        "",
      ).split("|")
      : null;
    const requestedTime = explicitDateTime
      ? safeStr(explicitDateTime[1], "")
      : normalizedAction.replace("dental_current_date_time:", "");
    const service = resolveDentalSelectedServiceFromCollected(
      services,
      collected,
    );
    const selectedDate = explicitDateTime
      ? safeStr(explicitDateTime[0], "")
      : resolveDentalSelectedDateFromCollected(collected);
    if (!service || !selectedDate || !requestedTime) {
      return null;
    }
    const dateAwareCollected = dateTimeYearExplicit
      ? {
        ...collected,
        date_year_explicit: true,
        pending_booking: {
          ...pending,
          appointment_date: selectedDate,
          date_year_explicit: true,
        },
      }
      : collected;
    const providerPreference = safeStr(
        (collected as any).provider_preference,
        safeStr((pending as any).provider_preference, "any"),
      ) === "specific"
      ? "specific"
      : "any";
    const slots = await getAvailableSlotsForDay({
      supabase,
      organization_id: organizationId,
      business_type: "dental",
      service_id: service.id,
      service_name: service.name,
      provider_id: providerPreference === "specific"
        ? safeStr((pending as any).provider_id, "") || null
        : null,
      provider_preference: providerPreference,
      date: selectedDate,
      timezone,
      max_options: 20,
    });
    const exact = (slots as Array<Record<string, unknown>>).find((slot) =>
      safeStr(slot.time, "") === requestedTime
    );
    if (exact) {
      const futureAppointments = await loadFutureActiveAppointmentsForLead({
        supabase,
        organizationId,
        leadId,
        timezone,
      });
      if (futureAppointments.length > 0) {
        const active = futureAppointments[0];
        const activeDate = safeStr(
          active.appointment_date,
          safeStr(active.starts_at, "").slice(0, 10),
        );
        const activeTime = safeStr(
          active.appointment_time,
          safeStr(active.starts_at, "").slice(11, 16),
        );
        return {
          reply: `Ya tenés una cita confirmada para ${
            formatRequestedDayLabel(activeDate)
          } a las ${formatHourLabel(activeTime)} 🦷\n\n¿Qué querés hacer?`,
          statePatch: {
            stage: "BOOKING",
            nextExpected: "active_appointment_intent_choice",
            collected: {
              ...collected,
              active_appointment: {
                id: safeStr(active.id, ""),
                appointment_date: activeDate,
                appointment_time: activeTime,
                starts_at: safeStr(
                  active.starts_at,
                  `${activeDate}T${activeTime}:00`,
                ),
                reason: safeStr(
                  active.reason,
                  safeStr(active.title, "Cita dental"),
                ),
              },
            },
          },
          leadPatch: {},
          debugNote: "dental_current_date_time_active_appointment_conflict",
          interactiveButtons: [
            { id: "reschedule_booking", title: "Cambiar mi cita" },
            { id: "additional_booking", title: "Agendar otra cita" },
            { id: "keep_existing_booking", title: "Mantener mi cita" },
          ],
        };
      }
      const offered = toDentalOfferedSlot(
        exact,
        service,
        "dental_current_date_time_selection",
        clinicSettings,
      );
      const pendingBooking = buildDentalPendingBookingFromSlot({
        slot: offered,
        pending: dateTimeYearExplicit
          ? { ...pending, date_year_explicit: true }
          : pending,
        clinicSettings,
        fallbackService: service,
      });
      return dentalConfirmationOrNameGate({
        leadState,
        collected: dateAwareCollected,
        pendingBooking,
        debugNote: "dental_current_date_time_confirmation",
      });
    }
    const alternatives = pickNearestAlternatives(
      (slots as Array<Record<string, unknown>>).map((slot) => ({
        ...slot,
        date: safeStr(slot.date, ""),
        time: safeStr(slot.time, ""),
        dayLabel: safeStr(
          (slot as any).dayLabel,
          formatRequestedDayLabel(safeStr(slot.date, "")),
        ),
      })),
      selectedDate,
      requestedTime,
    );
    const offeredSlots = alternatives.map((slot) =>
      toDentalOfferedSlot(
        slot,
        service,
        "dental_current_date_time_alternative",
        clinicSettings,
      )
    );
    const body = alternatives.length
      ? `Para *${formatRequestedDayLabel(selectedDate)}* a las *${
        formatHourLabel(requestedTime)
      }* no tengo disponibilidad, pero tengo estas opciones:`
      : `Para *${formatRequestedDayLabel(selectedDate)}* a las *${
        formatHourLabel(requestedTime)
      }* no tengo disponibilidad.`;
    return {
      reply: body,
      statePatch: {
        stage: "BOOKING",
        nextExpected: "availability_slot_selection",
        collected: {
          ...collected,
          activeBookingFlow: true,
          lastBookingStep: "select_time",
          expected_step: "slot_selection",
          current_service_key: service.id,
          current_service_name: service.name,
          current_date: selectedDate,
          preferred_date: selectedDate,
          pending_booking: buildDentalPeriodPending({
            collected,
            service,
            selectedDate,
            providerPreference,
            providerId: safeStr((pending as any).provider_id, ""),
            providerName: safeStr((pending as any).provider_name, ""),
            clinicSettings,
          }),
          last_offered_slots: offeredSlots,
        },
      },
      leadPatch: {},
      debugNote: alternatives.length
        ? "dental_current_date_time_alternatives"
        : "dental_current_date_time_unavailable",
      interactiveButtons: alternatives.length
        ? dentalAlternativeSlotButtons(offeredSlots)
        : [{ id: "booking_date_pref:week", title: "Otra fecha" }],
      interactiveList: alternatives.length
        ? dentalPeriodSlotsList(offeredSlots, body)
        : undefined,
    };
  }

  if (
    normalizedAction === "keep_existing_booking" ||
    (normalizedAction === "cancel_booking" &&
      (expected === "reschedule_datetime" ||
        expected === "confirm_reschedule_appointment"))
  ) {
    const isRescheduleNoChange = expected === "reschedule_datetime" ||
      expected === "reschedule_new_datetime" ||
      expected === "confirm_reschedule_appointment" ||
      safeStr((collected as any).active_flow, "") === "reschedule";
    return {
      reply: isRescheduleNoChange
        ? "Perfecto, dejamos tu cita igual 🦷"
        : "Perfecto, mantenemos tu cita 🦷",
      statePatch: {
        stage: "BOOKED",
        active_flow: undefined,
        lastIntent: "keep_existing_booking",
        nextExpected: undefined,
        collected: clearDentalTemporaryChangeState(collected),
      },
      leadPatch: {},
      debugNote: "dental_guided_keep_existing_appointment",
    };
  }

  if (normalizedAction === "cancel") {
    const active = ((collected as any).active_appointment ??
      await loadActiveAppointmentForLead({
        supabase,
        organizationId,
        leadId,
      })) as
        | Record<string, unknown>
        | null;
    if (!active?.id) {
      return {
        reply:
          "No encontré una cita activa para este contacto. Si querés, puedo ayudarte a agendar una.",
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "cancel_appointment",
          nextExpected: "dental_menu",
          collected: { ...collected, activeBookingFlow: false },
        },
        leadPatch: {},
        debugNote: "dental_guided_cancel_no_active_appointment",
        interactiveButtons: dentalNoActiveAppointmentButtons(),
      };
    }
    const activeState = buildDentalActiveAppointmentState(
      active,
      "Revisión dental",
      brandName,
    );
    const service = safeStr(activeState.reason, "servicio dental");
    const date = safeStr(activeState.appointment_date, "");
    const time = safeStr(activeState.appointment_time, "");
    const pendingCancel = {
      appointment_id: safeStr(activeState.id, ""),
      service,
      appointment_date: date,
      appointment_time: time,
      starts_at: safeStr(activeState.starts_at, `${date}T${time}:00`),
      provider_id: safeStr(activeState.provider_id, "") || null,
      provider_name: safeStr(activeState.provider_name, "Equipo DICAN"),
      patient_name: safeStr(activeState.patient_name, ""),
      status: "pending_confirmation",
    };
    return {
      reply: `Encontré tu cita:\n\nServicio: *${service}*\nFecha: *${
        formatRequestedDayLabel(date)
      }*\nHora: *${formatHourLabel(time)}*\n\n¿Seguro que querés cancelarla?`,
      statePatch: {
        stage: "BOOKING",
        lastIntent: "cancel_appointment",
        nextExpected: "confirm_cancel_appointment",
        collected: {
          ...collected,
          activeBookingFlow: true,
          active_appointment: activeState,
          pending_cancel: pendingCancel,
          pending_cancel_appointment: pendingCancel,
          pending_booking: null,
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_cancel_confirmation",
      interactiveButtons: dentalCancelConfirmationButtons(),
    };
  }

  if (normalizedAction === "confirm_cancel_appointment") {
    const pendingCancel = ((collected as any).pending_cancel ??
      (collected as any).pending_cancel_appointment ?? {}) as Record<
        string,
        unknown
      >;
    const appointmentId = safeStr(
      pendingCancel.appointment_id,
      safeStr(((collected as any).active_appointment as any)?.id, ""),
    );
    if (!appointmentId) {
      return {
        reply:
          "No encontré una cita activa para este contacto. Si querés, puedo ayudarte a agendar una.",
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "cancel_appointment",
          nextExpected: "dental_menu",
          collected: { ...collected, activeBookingFlow: false },
        },
        leadPatch: {},
        debugNote: "dental_guided_confirm_cancel_missing_appointment",
        interactiveButtons: dentalNoActiveAppointmentButtons(),
      };
    }
    const result = await executeToolAction({
      supabase,
      organizationId,
      leadId,
      action: {
        name: "cancel_appointment",
        payload: {
          appointment_id: appointmentId,
          business_type: "dental",
        },
      },
    });
    if (result.statePatch) {
      const service = safeStr(pendingCancel.service, "servicio dental");
      const date = safeStr(pendingCancel.appointment_date, "");
      const time = safeStr(pendingCancel.appointment_time, "");
      const patientName = resolveReliableDentalPatientName(leadState, {
        ...collected,
        patient_name: safeStr(
          pendingCancel.patient_name,
          safeStr(
            ((collected as any).active_appointment as any)?.patient_name,
            "",
          ),
        ),
      });
      return {
        reply: `✅ Cita cancelada\n\nTu cita de *${service}*${
          patientName ? ` a nombre de *${patientName}*` : ""
        } para *${formatRequestedDayLabel(date)}* a las *${
          formatHourLabel(time)
        }* fue cancelada.\n\nCuando querás, puedo ayudarte a agendar otra.`,
        statePatch: mergeStatePatches(result.statePatch, {
          stage: "DISCOVERY",
          lastIntent: "cancel_appointment",
          nextExpected: "dental_menu",
          collected: {
            activeBookingFlow: false,
            active_appointment: null,
            pending_cancel: null,
            pending_cancel_appointment: null,
            pending_reschedule: null,
          },
        }),
        leadPatch: {},
        debugNote: "dental_guided_cancel_confirmed",
        interactiveButtons: dentalPostCancelButtons(),
      };
    }
    return {
      reply:
        "No pude cancelar la cita en este momento. Te puedo pasar con recepción para revisarlo manualmente.",
      statePatch: {
        stage: "BOOKING",
        lastIntent: "cancel_appointment",
        nextExpected: "confirm_cancel_appointment",
        collected,
      },
      leadPatch: {},
      debugNote: "dental_guided_cancel_failed",
      interactiveButtons: dentalCancelConfirmationButtons(),
    };
  }

  if (
    normalizedAction === "reschedule_booking" &&
    (expected === "confirm_cancel_appointment" ||
      expected === "reschedule_datetime" ||
      expected === "confirm_reschedule_appointment")
  ) {
    normalizedAction = "dental_reschedule_show_hours";
  }

  if (normalizedAction === "reschedule_booking") {
    const active = ((collected as any).active_appointment ??
      await loadActiveAppointmentForLead({
        supabase,
        organizationId,
        leadId,
      })) as
        | Record<string, unknown>
        | null;
    if (!active?.id) {
      return {
        reply:
          "No encontré una cita activa para este contacto. Si querés, puedo ayudarte a agendar una.",
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "reschedule_appointment",
          nextExpected: "dental_menu",
          collected: { ...collected, activeBookingFlow: false },
        },
        leadPatch: {},
        debugNote: "dental_guided_reschedule_no_active_appointment",
        interactiveButtons: dentalNoActiveAppointmentButtons(),
      };
    }
    const activeState = buildDentalActiveAppointmentState(
      active,
      "Revisión dental",
      brandName,
    );
    const service = safeStr(activeState.reason, "servicio dental");
    const date = safeStr(activeState.appointment_date, "");
    const time = safeStr(activeState.appointment_time, "");
    const pendingReschedule = {
      appointment_id: safeStr(activeState.id, ""),
      service,
      current_date: date,
      current_time: time,
      current_starts_at: safeStr(activeState.starts_at, `${date}T${time}:00`),
      provider_id: safeStr(activeState.provider_id, "") || null,
      provider_name: safeStr(activeState.provider_name, "Equipo DICAN"),
      patient_name: safeStr(activeState.patient_name, ""),
      duration_min: Number(activeState.duration_min ?? 60) || 60,
      status: "awaiting_new_datetime",
    };
    return {
      reply:
        `Claro 🦷 ¿Qué querés cambiar de tu cita?\n\nServicio: *${service}*\nFecha actual: *${
          formatRequestedDayLabel(date)
        }*\nHora actual: *${formatHourLabel(time)}*`,
      statePatch: {
        stage: "BOOKING",
        active_flow: "reschedule",
        lastIntent: "reschedule_appointment",
        nextExpected: "reschedule_datetime",
        collected: {
          ...collected,
          activeBookingFlow: true,
          service,
          active_appointment: activeState,
          pending_reschedule: pendingReschedule,
          pending_booking: null,
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_reschedule_prompt",
      interactiveButtons: dentalRescheduleChoiceButtons(),
    };
  }

  if (
    normalizedAction === "dental_reschedule_same_day" ||
    (normalizedAction === "change_booking_slot" &&
      (expected === "reschedule_datetime" ||
        expected === "confirm_cancel_appointment" ||
        expected === "confirm_reschedule_appointment" ||
        expected === "active_appointment_intent_choice"))
  ) {
    normalizedAction = "dental_reschedule_show_hours";
  }

  if (
    normalizedAction === "dental_reschedule_same_day" ||
    (normalizedAction === "change_booking_slot" &&
      (expected === "reschedule_datetime" ||
        expected === "confirm_cancel_appointment" ||
        expected === "confirm_reschedule_appointment" ||
        expected === "active_appointment_intent_choice"))
  ) {
    const active = ((collected as any).active_appointment ??
      (collected as any).pending_reschedule ?? {}) as Record<string, unknown>;
    const date = safeStr(
      active.appointment_date,
      safeStr(active.current_date, ""),
    );
    if (!date) {
      return {
        reply: "Claro 🦷 ¿Para qué día querés moverla?",
        statePatch: {
          stage: "BOOKING",
          active_flow: "reschedule",
          lastIntent: "reschedule_appointment",
          nextExpected: "reschedule_date_preference",
          collected,
        },
        leadPatch: {},
        debugNote: "dental_guided_reschedule_same_day_missing_date",
        interactiveButtons: await dentalDatePreferenceButtons({
          supabase,
          organizationId,
          clinicSettings,
          service: resolveDentalRescheduleService(services, collected),
          providerPreference: "any",
          includeKeepExisting: true,
          actionMode: "reschedule",
        }),
      };
    }
    return {
      reply: `Perfecto 🦷 Mantengo el mismo día: *${
        formatRequestedDayLabel(date)
      }*.\n\n¿Qué querés hacer?`,
      statePatch: {
        stage: "BOOKING",
        active_flow: "reschedule",
        lastIntent: "reschedule_appointment",
        nextExpected: "reschedule_datetime",
        collected: {
          ...collected,
          activeBookingFlow: true,
          pending_reschedule: {
            ...(((collected as any).pending_reschedule ?? {}) as Record<
              string,
              unknown
            >),
            current_date: date,
            requested_date: date,
            status: "awaiting_new_time",
          },
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_reschedule_same_day_options",
      interactiveButtons: dentalSameDayRescheduleButtons(),
    };
  }

  if (normalizedAction === "dental_reschedule_show_hours") {
    const active = ((collected as any).active_appointment ??
      (collected as any).pending_reschedule ?? {}) as Record<string, unknown>;
    const date = safeStr(
      ((collected as any).pending_reschedule as any)?.requested_date,
      safeStr(active.appointment_date, safeStr(active.current_date, "")),
    );
    const service = resolveDentalRescheduleService(services, collected);
    if (!date) {
      return {
        reply: "Claro 🦷 ¿Para qué día querés moverla?",
        statePatch: {
          stage: "BOOKING",
          active_flow: "reschedule",
          lastIntent: "reschedule_appointment",
          nextExpected: "reschedule_date_preference",
          collected,
        },
        leadPatch: {},
        debugNote: "dental_guided_reschedule_hours_missing_date",
        interactiveButtons: await dentalDatePreferenceButtons({
          supabase,
          organizationId,
          clinicSettings,
          service,
          providerPreference: "any",
          includeKeepExisting: true,
          actionMode: "reschedule",
        }),
      };
    }
    const slots = await getAvailableSlotsForDay({
      supabase,
      organization_id: organizationId,
      business_type: "dental",
      service_id: service.id,
      service_name: service.name,
      provider_id: null,
      provider_preference: "any",
      date,
      timezone,
      max_options: 20,
    });
    const currentTime = safeStr(
      active.appointment_time,
      safeStr(active.current_time, ""),
    );
    const available = (slots as Array<Record<string, unknown>>).filter((slot) =>
      safeStr(slot.time, "") !== currentTime
    );
    const body = `Perfecto 🦷 Mantengo tu cita para *${
      formatRequestedDayLabel(date)
    }*.\n\nEscogé la nueva hora:`;
    return {
      reply: body,
      statePatch: {
        stage: "BOOKING",
        active_flow: "reschedule",
        lastIntent: "reschedule_appointment",
        nextExpected: "reschedule_datetime",
        collected: {
          ...collected,
          activeBookingFlow: true,
          active_appointment: active,
          pending_reschedule: {
            ...(((collected as any).pending_reschedule ?? {}) as Record<
              string,
              unknown
            >),
            service: service.name,
            current_date: date,
            requested_date: date,
            status: "awaiting_new_time",
          },
          last_offered_slots: available.map((slot) => ({
            ...slot,
            source: "dental_reschedule_time_list",
          })),
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_reschedule_hours_list",
      interactiveList: dentalRescheduleHoursList(available, body),
      interactiveButtons: available.length <= 3
        ? available.slice(0, 3).map((slot) => ({
          id: `dental_reschedule_time:${safeStr(slot.date, "")}|${
            safeStr(slot.time, "")
          }|${safeStr(slot.provider_id, "")}`,
          title: formatHourLabel(safeStr(slot.time, "")).slice(0, 20),
        }))
        : [],
    };
  }

  if (normalizedAction.startsWith("dental_reschedule_date_pref:")) {
    const pref = normalizedAction.replace("dental_reschedule_date_pref:", "");
    if (pref === "today" || pref === "tomorrow") {
      const d = new Date(nowLocal);
      if (pref === "tomorrow") d.setDate(d.getDate() + 1);
      if (pref === "today") {
        const active = ((collected as any).active_appointment ??
          (collected as any).pending_reschedule ?? {}) as Record<
            string,
            unknown
          >;
        const service = resolveDentalRescheduleService(services, collected);
        const todayIso = formatLocalDateForAction(d);
        const todaySlots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "dental",
          service_id: service.id,
          service_name: service.name,
          provider_id: null,
          provider_preference: "any",
          date: todayIso,
          timezone,
          max_options: 1,
        });
        if (!todaySlots.length) {
          return {
            reply:
              "Ya no tengo horarios disponibles para hoy 🦷\n\n¿Querés revisar mañana u otra fecha?",
            statePatch: {
              stage: "BOOKING",
              active_flow: "reschedule",
              lastIntent: "reschedule_appointment",
              nextExpected: "reschedule_date_preference",
              collected: {
                ...collected,
                activeBookingFlow: true,
              },
            },
            leadPatch: {},
            debugNote: "dental_reschedule_today_no_future_slots",
            interactiveButtons: [
              { id: "dental_reschedule_date_pref:tomorrow", title: "Mañana" },
              { id: "dental_reschedule_change_date", title: "Otra fecha" },
              { id: "keep_existing_booking", title: "Mantener cita" },
            ],
          };
        }
      }
      normalizedAction = `dental_reschedule_date:${
        formatLocalDateForAction(d)
      }`;
    } else {
      normalizedAction = "dental_reschedule_change_date";
    }
  }

  if (normalizedAction.startsWith("dental_reschedule_date:")) {
    const date = normalizedAction.replace("dental_reschedule_date:", "");
    return {
      reply: `Perfecto 🦷 Muevo la cita para *${
        formatRequestedDayLabel(date)
      }*.\n\n¿Qué querés hacer?`,
      statePatch: {
        stage: "BOOKING",
        active_flow: "reschedule",
        lastIntent: "reschedule_appointment",
        nextExpected: "reschedule_datetime",
        collected: {
          ...collected,
          activeBookingFlow: true,
          pending_reschedule: {
            ...(((collected as any).pending_reschedule ?? {}) as Record<
              string,
              unknown
            >),
            requested_date: date,
            status: "awaiting_new_time",
          },
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_reschedule_date_selected",
      interactiveButtons: dentalSameDayRescheduleButtons(),
    };
  }

  if (normalizedAction === "dental_reschedule_change_date") {
    if (expected === "reschedule_date_preference") {
      return {
        reply:
          "Escribime la fecha que preferís, por ejemplo: mañana, viernes o lunes.",
        statePatch: {
          stage: "BOOKING",
          active_flow: "reschedule",
          lastIntent: "reschedule_appointment",
          nextExpected: "reschedule_date_preference",
          collected,
        },
        leadPatch: {},
        debugNote: "dental_guided_reschedule_other_date_text_prompt",
      };
    }
    return {
      reply: "Claro 🦷 ¿Para qué día querés moverla?",
      statePatch: {
        stage: "BOOKING",
        active_flow: "reschedule",
        lastIntent: "reschedule_appointment",
        nextExpected: "reschedule_date_preference",
        collected,
      },
      leadPatch: {},
      debugNote: "dental_guided_reschedule_change_date_prompt",
      interactiveButtons: await dentalDatePreferenceButtons({
        supabase,
        organizationId,
        clinicSettings,
        service: resolveDentalRescheduleService(services, collected),
        providerPreference: "any",
        includeKeepExisting: true,
        actionMode: "reschedule",
      }),
    };
  }

  if (normalizedAction.startsWith("dental_reschedule_time:")) {
    const [date = "", time = ""] = normalizedAction
      .replace("dental_reschedule_time:", "")
      .split("|");
    normalizedAction = `dental_reschedule_datetime:${date}|${time}`;
  }

  if (normalizedAction.startsWith("dental_reschedule_datetime:")) {
    const [requestedDateRaw = "", requestedTimeRaw = ""] = normalizedAction
      .replace("dental_reschedule_datetime:", "")
      .split("|");
    const active = ((collected as any).active_appointment ??
      (collected as any).pending_reschedule ?? {}) as Record<string, unknown>;
    const activeDate = safeStr(
      active.appointment_date,
      safeStr(active.current_date, ""),
    );
    const activeTime = safeStr(
      active.appointment_time,
      safeStr(active.current_time, ""),
    );
    const requestedDate = safeStr(requestedDateRaw, activeDate);
    const requestedTime = safeStr(requestedTimeRaw, "");
    if (!requestedDate || !requestedTime) {
      if (activeDate) {
        return {
          reply: `Perfecto 🦷 Mantengo el mismo día: *${
            formatRequestedDayLabel(activeDate)
          }*.\n\n¿Qué querés hacer?`,
          statePatch: {
            stage: "BOOKING",
            active_flow: "reschedule",
            lastIntent: "reschedule_appointment",
            nextExpected: "reschedule_datetime",
            collected: {
              ...collected,
              activeBookingFlow: true,
              pending_reschedule: {
                ...(((collected as any).pending_reschedule ?? {}) as Record<
                  string,
                  unknown
                >),
                current_date: activeDate,
                requested_date: activeDate,
                status: "awaiting_new_time",
              },
            },
          },
          leadPatch: {},
          debugNote:
            "dental_guided_reschedule_missing_datetime_same_day_options",
          interactiveButtons: dentalSameDayRescheduleButtons(),
        };
      }
      return {
        reply: "Claro 🦷 ¿Para qué día querés moverla?",
        statePatch: {
          stage: "BOOKING",
          active_flow: "reschedule",
          lastIntent: "reschedule_appointment",
          nextExpected: "reschedule_date_preference",
          collected,
        },
        leadPatch: {},
        debugNote: "dental_guided_reschedule_missing_datetime",
        interactiveButtons: await dentalDatePreferenceButtons({
          supabase,
          organizationId,
          clinicSettings,
          service: resolveDentalRescheduleService(services, collected),
          providerPreference: "any",
          includeKeepExisting: true,
          actionMode: "reschedule",
        }),
      };
    }
    const serviceName = toPatientFacingServiceLabel(
      safeStr(
        (active as any).reason,
        safeStr((collected as any).service, "Revisión dental"),
      ),
    );
    const service = services.find((item) =>
      normalizeTextForMatch(item.name) === normalizeTextForMatch(serviceName)
    ) ?? {
      id: normalizeTextForMatch(serviceName).replace(/\s+/g, "_") ||
        "revision_dental",
      name: serviceName,
      duration_min: Number((active as any).duration_min ?? 60) || 60,
      price: null,
      active: true,
    };
    const slots = await getAvailableSlotsForDay({
      supabase,
      organization_id: organizationId,
      business_type: "dental",
      service_id: service.id,
      service_name: service.name,
      provider_id: null,
      provider_preference: "any",
      date: requestedDate,
      timezone,
      max_options: 20,
    });
    const exact = (slots as Array<Record<string, unknown>>).find((slot) =>
      safeStr(slot.time, "") === requestedTime
    );
    if (
      !exact && activeDate === requestedDate && activeTime === requestedTime
    ) {
      return {
        reply: `Esa ya es tu cita actual: ${
          formatRequestedDayLabel(activeDate)
        } a las ${
          formatHourLabel(activeTime)
        }.\n\n¿Querés dejarla así o buscar otro horario?`,
        statePatch: {
          stage: "BOOKING",
          active_flow: "reschedule",
          lastIntent: "reschedule_appointment",
          nextExpected: "reschedule_datetime",
          collected,
        },
        leadPatch: {},
        debugNote: "dental_guided_reschedule_same_time",
      };
    }
    if (!exact) {
      const alternatives = pickNearestAlternatives(
        (slots as Array<Record<string, unknown>>).map((slot) => ({
          date: safeStr(slot.date, ""),
          time: safeStr(slot.time, ""),
          dayLabel: formatRequestedDayLabel(safeStr(slot.date, "")),
        })),
        requestedDate,
        requestedTime,
      ).filter((slot) =>
        slot.date === requestedDate
      ).slice(0, 3);
      const altLines = alternatives.length
        ? alternatives.map((slot) => formatHourLabel(slot.time)).join("\n")
        : "";
      return {
        reply: alternatives.length
          ? `Ese horario no está disponible, pero tengo:\n${altLines}\n\n¿Cuál te queda mejor?`
          : "Ese horario no está disponible para ese día. ¿Querés revisar otra hora?",
        statePatch: {
          stage: "BOOKING",
          active_flow: "reschedule",
          lastIntent: "reschedule_appointment",
          nextExpected: "reschedule_datetime",
          collected: {
            ...collected,
            active_appointment: active,
            pending_reschedule: {
              ...(((collected as any).pending_reschedule ?? {}) as Record<
                string,
                unknown
              >),
              appointment_id: safeStr(active.id, ""),
              service: service.name,
              current_date: activeDate,
              current_time: activeTime,
              requested_date: requestedDate,
              requested_time: requestedTime,
              status: "awaiting_new_datetime",
            },
            last_offered_slots: alternatives.map((slot) => ({
              date: slot.date,
              time: slot.time,
              provider_id: "",
              service_name: service.name,
              source: "dental_reschedule_alternative",
            })),
          },
        },
        leadPatch: {},
        debugNote: "dental_guided_reschedule_time_unavailable",
        interactiveButtons: dentalSameDayRescheduleButtons(),
      };
    }
    const providerName = formatDentalProviderDisplayName(
      safeStr(
        exact.provider_name,
        safeStr((active as any).provider_name, "Doctor disponible"),
      ),
      brandName,
    );
    const pendingReschedule = {
      appointment_id: safeStr((active as any).id, ""),
      service: service.name,
      current_date: activeDate,
      current_time: activeTime,
      current_starts_at: safeStr(
        (active as any).starts_at,
        `${activeDate}T${activeTime}:00`,
      ),
      requested_date: requestedDate,
      requested_time: requestedTime,
      new_starts_at: safeStr(
        exact.starts_at,
        `${requestedDate}T${requestedTime}:00`,
      ),
      provider_id: safeStr(exact.provider_id, "") || null,
      provider_name: providerName,
      patient_name: safeStr((active as any).patient_name, ""),
      duration_min: Number(exact.duration_min ?? service.duration_min) ||
        service.duration_min,
      status: "pending_confirmation",
    };
    return {
      reply: `Perfecto 🦷 Puedo cambiar tu cita para ${
        formatRequestedDayLabel(requestedDate)
      } a las ${formatHourLabel(requestedTime)}.\n\n¿Confirmamos el cambio?`,
      statePatch: {
        stage: "BOOKING",
        active_flow: "reschedule",
        lastIntent: "reschedule_appointment",
        nextExpected: "confirm_reschedule_appointment",
        collected: {
          ...collected,
          activeBookingFlow: true,
          active_appointment: active,
          service: service.name,
          reschedule_date: requestedDate,
          reschedule_time: requestedTime,
          pending_reschedule: pendingReschedule,
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_reschedule_confirmation",
      interactiveButtons: dentalRescheduleConfirmationButtons(),
    };
  }

  if (normalizedAction === "confirm_reschedule_appointment") {
    const pendingReschedule =
      ((collected as any).pending_reschedule ?? {}) as Record<string, unknown>;
    const appointmentId = safeStr(pendingReschedule.appointment_id, "");
    const appointmentDate = safeStr(
      pendingReschedule.requested_date,
      safeStr((collected as any).reschedule_date, ""),
    );
    const appointmentTime = safeStr(
      pendingReschedule.requested_time,
      safeStr((collected as any).reschedule_time, ""),
    );
    if (!appointmentId || !appointmentDate || !appointmentTime) {
      return {
        reply: "No tengo completo el cambio. Decime qué hora querés revisar.",
        statePatch: {
          stage: "BOOKING",
          active_flow: "reschedule",
          lastIntent: "reschedule_appointment",
          nextExpected: "reschedule_datetime",
          collected,
        },
        leadPatch: {},
        debugNote: "dental_guided_confirm_reschedule_missing_context",
        interactiveButtons: dentalSameDayRescheduleButtons(),
      };
    }
    const result = await executeToolAction({
      supabase,
      organizationId,
      leadId,
      action: {
        name: "reschedule_appointment",
        payload: {
          appointment_id: appointmentId,
          appointment_date: appointmentDate,
          appointment_time: appointmentTime,
          starts_at: safeStr(pendingReschedule.new_starts_at, ""),
          reason: safeStr(pendingReschedule.service, "Servicio dental"),
          provider_id: safeStr(pendingReschedule.provider_id, ""),
          provider_name: safeStr(
            pendingReschedule.provider_name,
            "Equipo DICAN",
          ),
          patient_name: safeStr(
            pendingReschedule.patient_name,
            safeStr(
              ((collected as any).active_appointment as any)?.patient_name,
              "",
            ),
          ),
          duration_min: Number(pendingReschedule.duration_min ?? 60) || 60,
          business_type: "dental",
          brand_name: brandName,
        },
      },
    });
    if (result.statePatch && result.replyOverride) {
      return {
        reply: result.replyOverride,
        statePatch: result.statePatch,
        leadPatch: {},
        debugNote: "dental_guided_reschedule_confirmed",
      };
    }
    return {
      reply:
        "No pude cambiar la cita en este momento. Te puedo pasar con recepción para revisarlo manualmente.",
      statePatch: {
        stage: "BOOKING",
        active_flow: "reschedule",
        lastIntent: "reschedule_appointment",
        nextExpected: "confirm_reschedule_appointment",
        collected,
      },
      leadPatch: {},
      debugNote: "dental_guided_reschedule_failed",
      interactiveButtons: dentalRescheduleConfirmationButtons(),
    };
  }

  if (normalizedAction === "dental_recovery:search_other_time") {
    const service = services.find((item) =>
      item.id ===
        safeStr(
          pending.service_key,
          safeStr((collected as any).current_service_key, ""),
        )
    ) ??
      services.find((item) =>
        normalizeTextForMatch(item.name) ===
          normalizeTextForMatch(
            safeStr(
              pending.service_name,
              safeStr((collected as any).current_service_name, ""),
            ),
          )
      ) ??
      null;
    const selectedDate = safeStr(
      pending.appointment_date,
      safeStr(
        (collected as any).current_date,
        safeStr((collected as any).preferred_date, ""),
      ),
    );
    if (service && selectedDate) {
      return await showDentalPeriodSelector({
        supabase,
        organizationId,
        collected,
        service,
        selectedDate,
        providerPreference: safeStr(pending.provider_preference, "") ===
              "specific" || safeStr(pending.provider_id, "")
          ? "specific"
          : "any",
        providerId: safeStr(pending.provider_id, ""),
        providerName: safeStr(pending.provider_name, ""),
        clinicSettings,
        debugNote: "dental_cancel_recovery_period_selector",
      });
    }
    if (service) {
      return await showDentalAvailableDaysForService({
        supabase,
        organizationId,
        clinicSettings,
        collected: {
          ...collected,
          pending_booking: pending,
        },
        service,
        providerPreference: "any",
        debugNote: "dental_cancel_recovery_date_prompt",
      });
    }
    const list = dentalServiceSelectionList(services);
    return {
      reply: list?.body ?? "Escogé el motivo de la cita 🦷",
      statePatch: {
        stage: "BOOKING",
        nextExpected: "service_selection",
        collected: {
          ...collected,
          activeBookingFlow: true,
          lastBookingStep: "select_service",
          expected_step: "service_selection",
        },
      },
      leadPatch: {},
      debugNote: "dental_cancel_recovery_service_picker",
      interactiveButtons: dentalServiceButtons(services),
      interactiveList: list,
    };
  }

  if (!normalizedAction || normalizedAction === "booking_start") {
    const directBooking = await handleDentalDirectBookingRequest({
      supabase,
      organizationId,
      leadId,
      leadState,
      clinicSettings,
      collected,
      services,
      providers,
      inboundText,
      nowLocal,
    });
    if (directBooking) return directBooking;
  }

  if (
    isDentalEmergencyText(inboundText) ||
    normalizedAction.startsWith("dental_triage:")
  ) {
    return {
      reply: formatDentalEmergencyEntry(),
      statePatch: {
        stage: "TRIAGE",
        lastIntent: "dental_emergency_triage",
        nextExpected: "dental_symptom_detail",
        collected: {
          ...collected,
          activeBookingFlow: false,
          dental_triage: {
            source: normalizedAction || "text",
            message: inboundText,
          },
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_emergency_triage",
      interactiveButtons: dentalEmergencyButtons(),
    };
  }

  if (
    normalizedAction === "view_prices" ||
    /\b(precio|precios|servicio|servicios|cuanto cuesta|cuánto cuesta|cuesta|vale)\b/
      .test(text)
  ) {
    const reply = formatDentalServicesPricingCopy(brandName, services);
    const list = dentalServiceSelectionList(services, reply);
    return {
      reply,
      statePatch: {
        stage: "SERVICE_INFO",
        lastIntent: "pricing",
        nextExpected: "service_info_or_booking",
        collected: clearDentalAttemptedBookingState(collected),
      },
      leadPatch: {},
      debugNote: "dental_guided_services_pricing",
      interactiveButtons: list ? [] : [
        { id: "booking_start", title: "Agendar cita" },
        { id: "talk_to_human", title: "Hablar con recepción" },
      ],
      interactiveList: list,
    };
  }

  if (
    normalizedAction === "booking_start" ||
    /\b(agendar cita|quiero cita|una cita|necesito cita|agendar|reservar)\b/
      .test(text)
  ) {
    const list = dentalServiceSelectionList(services);
    return {
      reply: list?.body ??
        `Escogé el motivo de la cita 🦷\n${
          services.map((service, index) => `${index + 1}. ${service.name}`)
            .join("\n")
        }`,
      statePatch: {
        stage: "BOOKING",
        nextExpected: "service_selection",
        collected: {
          ...collected,
          activeBookingFlow: true,
          lastBookingStep: "select_service",
          expected_step: "service_selection",
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_service_selection",
      interactiveButtons: dentalServiceButtons(services),
      interactiveList: list,
    };
  }

  if (normalizedAction.startsWith("select_service:")) {
    const selectedService = resolveDentalServiceFromActionOrText(
      services,
      normalizedAction,
    );
    if (!selectedService) return null;
    const allowAdditionalBooking = Boolean(
      (collected as any).allow_additional_booking,
    );
    if (!allowAdditionalBooking) {
      const active = await loadActiveAppointmentForLead({
        supabase,
        organizationId,
        leadId,
      }) as Record<string, unknown> | null;
      if (active?.id) {
        const activeState = buildDentalActiveAppointmentState(
          active,
          selectedService.name,
          brandName,
        );
        return {
          reply: formatDentalActiveAppointmentGuardReply(activeState),
          statePatch: {
            ...dentalAttemptedBookingTopLevelClearPatch(),
            stage: "BOOKING",
            lastIntent: "active_appointment_guard",
            nextExpected: "active_appointment_intent_choice",
            collected: clearDentalAttemptedBookingState(collected, {
              activeBookingFlow: false,
              active_appointment: activeState,
            }),
          },
          leadPatch: {},
          debugNote: "dental_guided_service_selection_active_appointment_guard",
          interactiveButtons: [
            { id: "reschedule_booking", title: "Cambiar mi cita" },
            { id: "additional_booking", title: "Agendar otra cita" },
            { id: "keep_existing_booking", title: "Mantener mi cita" },
          ],
        };
      }
    }
    if (isDentalEmergencyText(selectedService.name)) {
      return {
        reply: formatDentalEmergencyEntry(),
        statePatch: {
          stage: "TRIAGE",
          lastIntent: "dental_emergency_triage",
          nextExpected: "dental_symptom_detail",
          collected: {
            ...collected,
            service: selectedService.name,
            service_key: selectedService.id,
          },
        },
        leadPatch: {},
        debugNote: "dental_guided_service_emergency_triage",
        interactiveButtons: dentalEmergencyButtons(),
      };
    }
    const preservedDate = safeStr(pending.appointment_date, "");
    const preservedTime = safeStr(
      pending.appointment_time,
      safeStr(pending.requested_time, ""),
    );
    if (preservedDate && preservedTime) {
      const provider = providers.length <= 1 ? providers[0] : null;
      const slots = await getAvailableSlotsForDay({
        supabase,
        organization_id: organizationId,
        business_type: "dental",
        service_id: selectedService.id,
        service_name: selectedService.name,
        provider_id: provider?.id ?? null,
        provider_preference: provider ? "specific" : "any",
        date: preservedDate,
        time_preference: "specific",
        specific_time: preservedTime,
        timezone,
        max_options: 10,
      });
      const exactSlot = slots.find((slot) =>
        safeStr(slot.time, "") === preservedTime
      );
      const bufferAfterMin = getDentalBufferAfterMin(
        selectedService.name,
        clinicSettings,
      );
      const basePending = {
        ...pending,
        service: selectedService.name,
        service_key: selectedService.id,
        service_name: selectedService.name,
        brand_name: brandName,
        appointment_date: preservedDate,
        appointment_time: preservedTime,
        duration_min: selectedService.duration_min,
        buffer_after_min: bufferAfterMin,
        effective_duration_min: selectedService.duration_min + bufferAfterMin,
      };
      if (exactSlot) {
        const offered = toDentalOfferedSlot(
          exactSlot as Record<string, unknown>,
          selectedService,
          "dental_direct_preserved_exact",
          clinicSettings,
        );
        const pendingBooking = buildDentalPendingBookingFromSlot({
          slot: offered,
          pending: basePending,
          clinicSettings,
          fallbackService: selectedService,
        });
        return dentalConfirmationOrNameGate({
          leadState,
          collected: {
            ...collected,
            activeBookingFlow: true,
            current_service_key: selectedService.id,
            current_service_name: selectedService.name,
            current_date: preservedDate,
            preferred_date: preservedDate,
            last_offered_slots: [offered],
          },
          pendingBooking: { ...pendingBooking, brand_name: brandName },
          debugNote: "dental_direct_preserved_confirmation",
        });
      }
      const alternatives = await getAvailableSlotsForDay({
        supabase,
        organization_id: organizationId,
        business_type: "dental",
        service_id: selectedService.id,
        service_name: selectedService.name,
        provider_id: provider?.id ?? null,
        provider_preference: provider ? "specific" : "any",
        date: preservedDate,
        timezone,
        max_options: 10,
      });
      const offeredSlots = alternatives.map((slot) =>
        toDentalOfferedSlot(
          slot as Record<string, unknown>,
          selectedService,
          "dental_direct_preserved_alternative",
          clinicSettings,
        )
      );
      const body = `Para ${formatRequestedDayLabel(preservedDate)} a las *${
        formatHourLabel(preservedTime)
      }* no tengo disponibilidad, pero tengo estas opciones:`;
      return {
        reply: body,
        statePatch: {
          stage: "BOOKING",
          nextExpected: alternatives.length
            ? "availability_slot_selection"
            : "date_selection",
          collected: {
            ...collected,
            activeBookingFlow: true,
            lastBookingStep: alternatives.length ? "select_time" : "select_day",
            expected_step: alternatives.length
              ? "slot_selection"
              : "day_selection",
            current_service_key: selectedService.id,
            current_service_name: selectedService.name,
            current_date: preservedDate,
            preferred_date: preservedDate,
            pending_booking: {
              ...basePending,
              requested_time: preservedTime,
            },
            last_offered_slots: offeredSlots,
          },
        },
        leadPatch: {},
        debugNote: alternatives.length
          ? "dental_direct_preserved_alternatives"
          : "dental_direct_preserved_no_slots",
        interactiveButtons: alternatives.length
          ? dentalAlternativeSlotButtons(
            alternatives as Array<Record<string, unknown>>,
          )
          : [{ id: "booking_date_pref:week", title: "Otra fecha" }],
        interactiveList: alternatives.length
          ? dentalAlternativeSlotsList(
            alternatives as Array<Record<string, unknown>>,
            body,
            selectedService.name,
          )
          : undefined,
      };
    }
    if (preservedDate) {
      const provider = providers.length <= 1 ? providers[0] : null;
      if (provider) {
        return await showDentalPeriodSelector({
          supabase,
          organizationId,
          collected,
          service: selectedService,
          selectedDate: preservedDate,
          providerPreference: "specific",
          providerId: provider.id,
          providerName: provider.name,
          clinicSettings,
          debugNote: "dental_direct_preserved_period_selector",
        });
      }
    }
    return await showDentalAvailableDaysForService({
      supabase,
      organizationId,
      clinicSettings,
      collected,
      service: selectedService,
      providerPreference: "any",
      debugNote: "dental_guided_date_prompt",
    });
  }

  if (
    normalizedAction.startsWith("booking_date_pref:") ||
    normalizedAction.startsWith("select_date:") ||
    normalizedAction.startsWith("select_date_explicit_year:") ||
    normalizedAction.startsWith("dental_weekday_clarify:") ||
    normalizedAction.startsWith("dental_date_range:")
  ) {
    const service = services.find((item) =>
      item.id ===
        safeStr(
          pending.service_key,
          safeStr((collected as any).current_service_key, ""),
        )
    ) ??
      services.find((item) =>
        normalizeTextForMatch(item.name) ===
          normalizeTextForMatch(
            safeStr(
              pending.service_name,
              safeStr((collected as any).current_service_name, ""),
            ),
          )
      ) ??
      null;
    if (!service) {
      const list = dentalServiceSelectionList(services);
      return {
        reply: list?.body ?? "Escogé el motivo de la cita 🦷",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "service_selection",
          collected: { ...collected, expected_step: "service_selection" },
        },
        leadPatch: {},
        debugNote: "dental_guided_date_missing_service",
        interactiveButtons: dentalServiceButtons(services),
        interactiveList: list,
      };
    }
    if (normalizedAction.startsWith("dental_weekday_clarify:")) {
      const [first = "", second = ""] = normalizedAction
        .replace("dental_weekday_clarify:", "")
        .split("|");
      return {
        reply: `¿Te referís a ${formatRequestedDayLabel(first)} o ${
          formatRequestedDayLabel(second)
        }?`,
        statePatch: {
          stage: "BOOKING",
          nextExpected: "date_selection",
          collected: {
            ...collected,
            activeBookingFlow: true,
            lastBookingStep: "select_day",
            expected_step: "day_selection",
            current_service_key: service.id,
            current_service_name: service.name,
            pending_booking: {
              ...pending,
              service: service.name,
              service_key: service.id,
              service_name: service.name,
              duration_min: service.duration_min,
              buffer_after_min: getDentalBufferAfterMin(
                service.name,
                clinicSettings,
              ),
              effective_duration_min: service.duration_min +
                getDentalBufferAfterMin(service.name, clinicSettings),
            },
            last_offered_dates: [
              {
                date: first,
                label: formatRequestedDayLabel(first),
                source: "dental_weekday_clarification",
              },
              {
                date: second,
                label: formatRequestedDayLabel(second),
                source: "dental_weekday_clarification",
              },
            ],
          },
        },
        leadPatch: {},
        debugNote: "dental_guided_weekday_clarification",
        interactiveButtons: [
          {
            id: `select_date:${first}`,
            title: formatDentalShortDateButton(first),
          },
          {
            id: `select_date:${second}`,
            title: formatDentalShortDateButton(second),
          },
          { id: "booking_date_pref:week", title: "Otra fecha" },
        ],
      };
    }
    if (normalizedAction.startsWith("dental_date_range:")) {
      const [startRaw = "", endRaw = ""] = normalizedAction
        .replace("dental_date_range:", "")
        .split("|");
      const days = await buildDentalDateOptionsInRange({
        supabase,
        organizationId,
        clinicSettings,
        service,
        startOffset: Number(startRaw),
        endOffset: Number(endRaw),
        limit: 7,
      });
      return {
        reply: days.length
          ? "Tengo estas fechas disponibles esa semana 🦷"
          : "No encontré fechas disponibles esa semana. Te puedo pasar con recepción para revisar manualmente.",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "date_selection",
          collected: {
            ...collected,
            activeBookingFlow: true,
            lastBookingStep: "select_day",
            expected_step: "day_selection",
            current_service_key: service.id,
            current_service_name: service.name,
            pending_booking: {
              ...pending,
              service: service.name,
              service_key: service.id,
              service_name: service.name,
              duration_min: service.duration_min,
              buffer_after_min: getDentalBufferAfterMin(
                service.name,
                clinicSettings,
              ),
              effective_duration_min: service.duration_min +
                getDentalBufferAfterMin(service.name, clinicSettings),
            },
            last_offered_dates: days.map((day) => ({
              date: day.date,
              label: day.label,
              source: "dental_future_range",
            })),
          },
        },
        leadPatch: {},
        debugNote: days.length
          ? "dental_guided_future_range_dates"
          : "dental_guided_future_range_no_dates",
        interactiveButtons: days.length ? [] : [
          { id: "booking_date_pref:week", title: "Otra fecha" },
          { id: "talk_to_human", title: "Hablar con recepción" },
        ],
        interactiveList: days.length
          ? dentalDateSelectionList(days)
          : undefined,
      };
    }
    if (normalizedAction === "booking_date_pref:week") {
      return {
        reply:
          "Escribime la fecha que preferís, por ejemplo: mañana, viernes o lunes.",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "date_selection",
          collected: {
            ...collected,
            activeBookingFlow: true,
            lastBookingStep: "select_day",
            expected_step: "day_selection",
            current_service_key: service.id,
            current_service_name: service.name,
          },
        },
        leadPatch: {},
        debugNote: "dental_guided_free_text_date_prompt",
      };
    }
    let selectedDate = "";
    if (normalizedAction === "booking_date_pref:today") {
      const todayIso = formatLocalDateForAction(nowLocal);
      const todaySlots = await getAvailableSlotsForDay({
        supabase,
        organization_id: organizationId,
        business_type: "dental",
        service_id: service.id,
        service_name: service.name,
        provider_id: null,
        provider_preference: "any",
        date: todayIso,
        timezone,
        max_options: 1,
      });
      if (!todaySlots.length) {
        return {
          reply:
            "Ya no tengo horarios disponibles para hoy 🦷\n\n¿Querés revisar mañana u otra fecha?",
          statePatch: {
            stage: "BOOKING",
            nextExpected: "booking_date_preference",
            collected: {
              ...collected,
              activeBookingFlow: true,
              lastBookingStep: "select_day",
              expected_step: "day_selection",
              current_service_key: service.id,
              current_service_name: service.name,
              pending_booking: {
                ...pending,
                service: service.name,
                service_key: service.id,
                service_name: service.name,
                duration_min: service.duration_min,
                buffer_after_min: getDentalBufferAfterMin(
                  service.name,
                  clinicSettings,
                ),
                effective_duration_min: service.duration_min +
                  getDentalBufferAfterMin(service.name, clinicSettings),
              },
            },
          },
          leadPatch: {},
          debugNote: "dental_guided_today_no_future_slots_from_action",
          interactiveButtons: [
            { id: "booking_date_pref:tomorrow", title: "Mañana" },
            { id: "booking_date_pref:week", title: "Otra fecha" },
          ],
        };
      }
      selectedDate = formatLocalDateForAction(nowLocal);
    }
    if (normalizedAction === "booking_date_pref:tomorrow") {
      const d = new Date(nowLocal);
      d.setDate(d.getDate() + 1);
      selectedDate = formatLocalDateForAction(d);
    }
    const selectedDateYearExplicit = normalizedAction.startsWith(
      "select_date_explicit_year:",
    );
    if (
      normalizedAction.startsWith("select_date:") ||
      selectedDateYearExplicit
    ) {
      selectedDate = parseDateFromAction(normalizedAction);
    }
    if (!selectedDate) {
      return null;
    }
    if (isDentalPastDate(selectedDate, timezone)) {
      return dentalPastDateRejection({
        collected,
        service,
        pending,
        debugNote: "dental_guided_past_date_rejected",
      });
    }
    const dateAwareCollected = selectedDateYearExplicit
      ? {
        ...collected,
        date_year_explicit: true,
        pending_booking: {
          ...pending,
          appointment_date: selectedDate,
          date_year_explicit: true,
        },
      }
      : collected;
    if (providers.length <= 1) {
      const provider = providers[0];
      return await showDentalPeriodSelector({
        supabase,
        organizationId,
        collected: dateAwareCollected,
        service,
        selectedDate,
        providerPreference: provider ? "specific" : "any",
        providerId: provider?.id,
        providerName: provider?.name,
        clinicSettings,
        debugNote: "dental_guided_slots_single_provider",
      });
    }
    return await showDentalPeriodSelector({
      supabase,
      organizationId,
      collected: dateAwareCollected,
      service,
      selectedDate,
      providerPreference: "any",
      clinicSettings,
      debugNote: "dental_guided_slots_any_provider",
    });
  }

  if (normalizedAction.startsWith("select_provider:")) {
    const service = services.find((item) =>
      item.id ===
        safeStr(
          pending.service_key,
          safeStr((collected as any).current_service_key, ""),
        )
    ) ?? null;
    const selectedDate = safeStr(
      pending.appointment_date,
      safeStr(
        (collected as any).current_date,
        safeStr((collected as any).preferred_date, ""),
      ),
    );
    const provider = resolveDentalProviderFromActionOrText(
      providers,
      normalizedAction,
    );
    if (!service || !selectedDate || !provider) {
      return null;
    }
    if (
      isDentalInvalidStaleBookingDate(
        selectedDate,
        timezone,
        hasDentalExplicitYearMarker(pending, collected),
      )
    ) {
      return dentalPastDateRejection({
        collected,
        service,
        pending,
        debugNote: "dental_guided_provider_past_date_rejected",
      });
    }
    return await showDentalPeriodSelector({
      supabase,
      organizationId,
      collected,
      service,
      selectedDate,
      providerPreference: provider.preference,
      providerId: provider.id,
      providerName: provider.name,
      clinicSettings,
      debugNote: provider.preference === "any"
        ? "dental_guided_slots_any_provider"
        : "dental_guided_slots_specific_provider",
    });
  }

  if (normalizedAction.startsWith("dental_period:")) {
    const period = normalizedAction.endsWith(":morning")
      ? "morning"
      : normalizedAction.endsWith(":afternoon")
      ? "afternoon"
      : "";
    const service = services.find((item) =>
      item.id ===
        safeStr(
          pending.service_key,
          safeStr((collected as any).current_service_key, ""),
        )
    ) ?? null;
    const selectedDate = safeStr(
      pending.appointment_date,
      safeStr(
        (collected as any).current_date,
        safeStr((collected as any).preferred_date, ""),
      ),
    );
    if (!period || !service || !selectedDate) return null;
    if (
      isDentalInvalidStaleBookingDate(
        selectedDate,
        timezone,
        hasDentalExplicitYearMarker(pending, collected),
      )
    ) {
      return dentalPastDateRejection({
        collected,
        service,
        pending,
        debugNote: "dental_guided_period_past_date_rejected",
      });
    }
    return await showDentalSlotsForPeriod({
      supabase,
      organizationId,
      clinicSettings,
      collected,
      service,
      selectedDate,
      providerPreference: safeStr(pending.provider_preference, "") ===
            "specific" || safeStr(pending.provider_id, "")
        ? "specific"
        : "any",
      providerId: safeStr(pending.provider_id, ""),
      providerName: safeStr(pending.provider_name, ""),
      period: period as "morning" | "afternoon",
      debugNote: period === "morning"
        ? "dental_guided_morning_slots"
        : "dental_guided_afternoon_slots",
    });
  }

  if (
    normalizedAction.startsWith("select_time:") ||
    normalizedAction.startsWith("select_slot:")
  ) {
    const selected = parseTimeFromAction(normalizedAction);
    const offeredSlots = Array.isArray((collected as any)?.last_offered_slots)
      ? ((collected as any).last_offered_slots as any[])
      : [];
    const match = offeredSlots.find((slot: any) =>
      safeStr(slot.date, "") === selected.date &&
      safeStr(slot.time, "") === selected.time &&
      safeStr(slot.provider_id, "") === selected.providerId
    );
    if (!match) return null;
    if (
      isDentalInvalidStaleBookingDate(
        selected.date,
        timezone,
        hasDentalExplicitYearMarker(
          match as Record<string, unknown>,
          pending,
          collected,
        ),
      )
    ) {
      return dentalPastDateRejection({
        collected,
        service: services.find((item) =>
          item.id ===
            safeStr(match.service_key, safeStr(pending.service_key, ""))
        ) ?? null,
        pending,
        debugNote: "dental_guided_slot_past_date_rejected",
      });
    }
    const currentFlow = (collected as any).current_flow;
    const allowAdditionalBooking = Boolean(
      (collected as any).allow_additional_booking ||
        currentFlow?.type === "additional_booking" ||
        currentFlow?.allow_active_appointment_bypass === true,
    );
    const futureAppointments = allowAdditionalBooking
      ? []
      : await loadFutureActiveAppointmentsForLead({
        supabase,
        organizationId,
        leadId,
        timezone,
      });
    if (!allowAdditionalBooking && futureAppointments.length > 0) {
      const active = futureAppointments[0];
      const date = safeStr(
        active.appointment_date,
        safeStr(active.starts_at, "").slice(0, 10),
      );
      const time = safeStr(
        active.appointment_time,
        safeStr(active.starts_at, "").slice(11, 16),
      );
      return {
        reply: `Ya tenés una cita confirmada para ${
          formatRequestedDayLabel(date)
        } a las ${formatHourLabel(time)} 🦷\n\n¿Qué querés hacer?`,
        statePatch: {
          stage: "BOOKING",
          nextExpected: "active_appointment_intent_choice",
          collected: {
            ...collected,
            active_appointment: {
              id: safeStr(active.id, ""),
              appointment_date: date,
              appointment_time: time,
              starts_at: safeStr(active.starts_at, `${date}T${time}:00`),
              reason: safeStr(
                active.reason,
                safeStr(active.title, "Cita dental"),
              ),
            },
          },
        },
        leadPatch: {},
        debugNote: "dental_guided_active_appointment_conflict",
        interactiveButtons: [
          { id: "reschedule_booking", title: "Cambiar mi cita" },
          { id: "additional_booking", title: "Agendar otra cita" },
          { id: "keep_existing_booking", title: "Mantener mi cita" },
        ],
      };
    }
    const nextPending = {
      ...pending,
      service: safeStr(
        match.service_name,
        safeStr(pending.service_name, "Servicio"),
      ),
      service_key: safeStr(match.service_key, safeStr(pending.service_key, "")),
      service_name: safeStr(
        match.service_name,
        safeStr(pending.service_name, "Servicio"),
      ),
      brand_name: brandName,
      appointment_date: safeStr(match.date, ""),
      date_year_explicit: hasDentalExplicitYearMarker(
        match as Record<string, unknown>,
        pending,
        collected,
      ) || undefined,
      appointment_time: safeStr(match.time, ""),
      starts_at: safeStr(match.starts_at, ""),
      provider_id: safeStr(match.provider_id, ""),
      provider_name: safeStr(match.provider_name, ""),
      duration_min: Number(match.duration_min ?? pending.duration_min ?? 30) ||
        30,
      buffer_after_min: Number(
        match.buffer_after_min ?? pending.buffer_after_min ??
          getDentalBufferAfterMin(
            safeStr(match.service_name, safeStr(pending.service_name, "")),
            clinicSettings,
          ),
      ) || 0,
      effective_duration_min: Number(
        match.effective_duration_min ?? pending.effective_duration_min,
      ) || ((Number(match.duration_min ?? pending.duration_min ?? 30) || 30) +
        (Number(match.buffer_after_min ?? pending.buffer_after_min) || 0)),
      status: "pending_confirmation",
    };
    const patientName = resolveReliableDentalPatientName(leadState, {
      ...collected,
      ...nextPending,
    });
    if (!patientName) {
      return {
        reply: "¿A nombre de quién agendamos la cita?",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "patient_name",
          collected: {
            ...collected,
            pending_booking: nextPending,
            lastBookingStep: "name_input",
            expected_step: "name_input",
          },
        },
        leadPatch: {},
        debugNote: "dental_guided_name_gate",
      };
    }
    const pendingWithName = { ...nextPending, patient_name: patientName };
    return {
      reply: formatDentalConfirmationSummary(pendingWithName, patientName),
      statePatch: {
        stage: "CONFIRMING",
        nextExpected: "confirm_booking",
        collected: {
          ...collected,
          patient_name: patientName,
          pending_booking: pendingWithName,
          lastBookingStep: "confirm_booking",
          expected_step: "confirmation",
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_confirmation",
      interactiveButtons: [
        { id: "confirm_booking", title: "Confirmar" },
        { id: "change_booking_slot", title: "Cambiar hora" },
        { id: "cancel_booking", title: "Cancelar" },
      ],
    };
  }

  if (
    (expected === "patient_name" || expected === "name_input") &&
    inboundText.trim().length >= 3
  ) {
    if (
      isDentalInvalidStaleBookingDate(
        safeStr(pending.appointment_date, ""),
        timezone,
        hasDentalExplicitYearMarker(pending, collected),
      )
    ) {
      return dentalPastDateRejection({
        collected,
        service: resolveDentalSelectedServiceFromCollected(services, collected),
        pending,
        debugNote: "dental_guided_name_gate_past_date_rejected",
      });
    }
    const patientName = toDisplayPersonName(inboundText);
    const pendingWithName = { ...pending, patient_name: patientName };
    return {
      reply: formatDentalConfirmationSummary(pendingWithName, patientName),
      statePatch: {
        stage: "CONFIRMING",
        nextExpected: "confirm_booking",
        collected: {
          ...collected,
          patient_name: patientName,
          pending_booking: pendingWithName,
          lastBookingStep: "confirm_booking",
          expected_step: "confirmation",
        },
      },
      leadPatch: {
        full_name: patientName,
        first_name: patientName.split(/\s+/)[0] ?? patientName,
      },
      debugNote: "dental_guided_name_captured",
      interactiveButtons: [
        { id: "confirm_booking", title: "Confirmar" },
        { id: "change_booking_slot", title: "Cambiar hora" },
        { id: "cancel_booking", title: "Cancelar" },
      ],
    };
  }

  if (
    safeStr((leadState as any)?.nextExpected, "") === "confirm_booking" &&
    (normalizedAction === "change_booking_slot" ||
      /\b(cambiar hora|otra hora|cambiar horario)\b/.test(text))
  ) {
    const service = services.find((item) =>
      item.id ===
        safeStr(
          pending.service_key,
          safeStr((collected as any).current_service_key, ""),
        )
    ) ??
      services.find((item) =>
        normalizeTextForMatch(item.name) ===
          normalizeTextForMatch(
            safeStr(
              pending.service_name,
              safeStr((collected as any).current_service_name, ""),
            ),
          )
      ) ??
      null;
    const selectedDate = safeStr(
      pending.appointment_date,
      safeStr(
        (collected as any).current_date,
        safeStr((collected as any).preferred_date, ""),
      ),
    );
    if (!service || !selectedDate) {
      const days = service
        ? await buildDentalDateOptions({
          supabase,
          organizationId,
          clinicSettings,
          service,
          limit: 7,
        })
        : [];
      return {
        reply: days.length
          ? "Escogé el día que querés revisar 🦷"
          : "Decime qué día querés revisar y te muestro horarios.",
        statePatch: {
          stage: "BOOKING",
          nextExpected: service ? "date_selection" : "service_selection",
          collected: {
            ...collected,
            last_offered_dates: days.map((day) => ({
              date: day.date,
              label: day.label,
              source: "dental_change_time",
              service_key: service?.id,
            })),
            expected_step: service ? "day_selection" : "service_selection",
          },
        },
        leadPatch: {},
        debugNote: "dental_guided_change_time_missing_context",
        interactiveList: service
          ? dentalDateSelectionList(days)
          : dentalServiceSelectionList(services),
        interactiveButtons: service ? [] : dentalServiceButtons(services),
      };
    }
    if (
      isDentalInvalidStaleBookingDate(
        selectedDate,
        timezone,
        hasDentalExplicitYearMarker(pending, collected),
      )
    ) {
      return dentalPastDateRejection({
        collected,
        service,
        pending,
        debugNote: "dental_guided_change_time_past_date_rejected",
      });
    }
    return await showDentalPeriodSelector({
      supabase,
      organizationId,
      collected,
      service,
      selectedDate,
      providerPreference: safeStr(pending.provider_id, "") ? "specific" : "any",
      providerId: safeStr(pending.provider_id, ""),
      providerName: safeStr(pending.provider_name, ""),
      clinicSettings,
      debugNote: "dental_guided_change_time_slots",
    });
  }

  if (
    safeStr((leadState as any)?.nextExpected, "") === "confirm_booking" &&
    (normalizedAction === "cancel_booking" ||
      /\b(cancelar|no confirmar|mejor no|anular)\b/.test(text))
  ) {
    return {
      reply:
        "Listo, no confirmé esa cita 🦷\n\n¿Querés buscar otro horario o empezar una cita nueva?",
      statePatch: {
        stage: "BOOKING",
        lastIntent: "booking_cancelled",
        nextExpected: "dental_cancel_recovery",
        collected: {
          ...collected,
          pending_booking: {
            ...pending,
            appointment_time: null,
            starts_at: null,
            status: "cancelled_pending_recovery",
          },
          pending_offered_slot: null,
          selected_slot: null,
          current_date: safeStr(
            pending.appointment_date,
            safeStr((collected as any).current_date, ""),
          ),
          current_time: null,
          preferred_date: safeStr(
            pending.appointment_date,
            safeStr((collected as any).preferred_date, ""),
          ),
          preferred_time: null,
          lastBookingStep: null,
          expected_step: "dental_cancel_recovery",
          activeBookingFlow: true,
        },
      },
      leadPatch: {},
      debugNote: "dental_guided_booking_cancelled",
      interactiveButtons: [
        {
          id: "dental_recovery:search_other_time",
          title: "Buscar otro horario",
        },
        { id: "booking_start", title: "Nueva cita" },
        { id: "talk_to_human", title: "Hablar con recepción" },
      ],
    };
  }

  if (
    normalizedAction === "confirm_booking" &&
    safeStr((leadState as any)?.nextExpected, "") === "confirm_booking"
  ) {
    if (
      !safeStr(pending.appointment_date, "") ||
      !safeStr(pending.appointment_time, "")
    ) return null;
    if (
      isDentalInvalidStaleBookingDate(
        safeStr(pending.appointment_date, ""),
        timezone,
        hasDentalExplicitYearMarker(pending, collected),
      )
    ) {
      return dentalPastDateRejection({
        collected,
        service: resolveDentalSelectedServiceFromCollected(services, collected),
        pending,
        debugNote: "dental_guided_confirm_past_date_rejected",
      });
    }
    const pendingProviderIdRaw = safeStr(pending.provider_id, "");
    const pendingProviderId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(pendingProviderIdRaw)
        ? pendingProviderIdRaw
        : "";
    const pendingProviderName = formatDentalProviderDisplayName(
      safeStr(pending.provider_name, "Doctor disponible"),
      brandName,
    );
    const currentFlow = (collected as any).current_flow;
    const allowAdditionalBookingConfirmation = Boolean(
      (collected as any).allow_additional_booking ||
        currentFlow?.type === "additional_booking" ||
        currentFlow?.allow_active_appointment_bypass === true,
    );
    const confirmationCollected = allowAdditionalBookingConfirmation
      ? {
        ...collected,
        active_appointment: null,
        pending_reschedule: null,
      }
      : collected;
    console.log(
      "[run-replies] dental confirmar trace",
      JSON.stringify({
        stage: "handler_entered",
        organization_id: organizationId,
        lead_id: leadId,
        provider_id_before: pendingProviderIdRaw || null,
        provider_id_after: pendingProviderId || null,
        provider_name: pendingProviderName,
        appointment_date: safeStr(pending.appointment_date, ""),
        appointment_time: safeStr(pending.appointment_time, ""),
        starts_at: safeStr(pending.starts_at, ""),
        has_pending_booking: Boolean(Object.keys(pending).length),
      }),
    );
    console.log(
      "[run-replies] dental confirmar trace",
      JSON.stringify({
        stage: "before_executeToolAction",
        organization_id: organizationId,
        lead_id: leadId,
        provider_id: pendingProviderId || null,
        provider_name: pendingProviderName,
        appointment_date: safeStr(pending.appointment_date, ""),
        appointment_time: safeStr(pending.appointment_time, ""),
        starts_at: safeStr(pending.starts_at, ""),
      }),
    );
    let result: ActionExecutionResult;
    try {
      result = await executeToolAction({
        supabase,
        organizationId,
        leadId,
        action: {
          name: "book_appointment",
          payload: {
            business_type: "dental",
            allow_additional_booking: allowAdditionalBookingConfirmation,
            service: safeStr(
              pending.service,
              safeStr(pending.service_name, "Servicio dental"),
            ),
            reason: safeStr(
              pending.service,
              safeStr(pending.service_name, "Servicio dental"),
            ),
            appointment_date: safeStr(pending.appointment_date, ""),
            appointment_time: safeStr(pending.appointment_time, ""),
            scheduled_date: safeStr(pending.appointment_date, ""),
            scheduled_time: safeStr(pending.appointment_time, ""),
            starts_at: safeStr(pending.starts_at, ""),
            date_year_explicit: hasDentalExplicitYearMarker(
              pending,
              collected,
            ),
            selected_slot: {
              source: "dental_guided_pending_confirmation",
              date: safeStr(pending.appointment_date, ""),
              time: safeStr(pending.appointment_time, ""),
              starts_at: safeStr(pending.starts_at, ""),
              date_year_explicit: hasDentalExplicitYearMarker(
                pending,
                collected,
              ),
              provider_id: pendingProviderId,
              provider_name: pendingProviderName,
              service_key: safeStr(pending.service_key, ""),
              service_name: safeStr(
                pending.service_name,
                safeStr(pending.service, "Servicio dental"),
              ),
              duration_min: Number(pending.duration_min ?? 30) || 30,
              buffer_after_min: Number(pending.buffer_after_min ?? 0) || 0,
              effective_duration_min: Number(
                pending.effective_duration_min ??
                  ((Number(pending.duration_min ?? 30) || 30) +
                    (Number(pending.buffer_after_min ?? 0) || 0)),
              ) ||
                ((Number(pending.duration_min ?? 30) || 30) +
                  (Number(pending.buffer_after_min ?? 0) || 0)),
            },
            patient_name: safeStr(
              pending.patient_name,
              resolveReliableDentalPatientName(
                leadState,
                confirmationCollected,
              ),
            ),
            patient_phone: safeStr(
              (leadState as any)?.phone,
              safeStr((leadState as any)?.channel_user_id, ""),
            ),
            channel_user_id: safeStr((leadState as any)?.channel_user_id, ""),
            provider_id: pendingProviderId,
            provider_name: pendingProviderName,
            duration_min: Number(pending.duration_min ?? 30) || 30,
            buffer_after_min: Number(pending.buffer_after_min ?? 0) || 0,
            effective_duration_min:
              Number(pending.effective_duration_min ?? 0) ||
              ((Number(pending.duration_min ?? 30) || 30) +
                (Number(pending.buffer_after_min ?? 0) || 0)),
            brand_name: brandName,
            metadata: {
              source: "dental_guided_booking",
              service_key: safeStr(pending.service_key, ""),
              service_name: safeStr(
                pending.service_name,
                safeStr(pending.service, "Servicio dental"),
              ),
              brand_name: brandName,
              appointment_date: safeStr(pending.appointment_date, ""),
              appointment_time: safeStr(pending.appointment_time, ""),
              date_year_explicit: hasDentalExplicitYearMarker(
                pending,
                collected,
              ),
              buffer_after_min: Number(pending.buffer_after_min ?? 0) || 0,
              effective_duration_min:
                Number(pending.effective_duration_min ?? 0) ||
                ((Number(pending.duration_min ?? 30) || 30) +
                  (Number(pending.buffer_after_min ?? 0) || 0)),
              channel_user_id: safeStr((leadState as any)?.channel_user_id, ""),
            },
          },
        },
      });
    } catch (error) {
      console.error(
        "[run-replies] dental confirm failed before actionExecutor",
        JSON.stringify({
          stage: "executeToolAction_exception",
          organization_id: organizationId,
          lead_id: leadId,
          provider_id: pendingProviderId || null,
          provider_name: pendingProviderName,
          appointment_date: safeStr(pending.appointment_date, ""),
          appointment_time: safeStr(pending.appointment_time, ""),
          starts_at: safeStr(pending.starts_at, ""),
          error: safeStr((error as any)?.message ?? error, "unknown_error"),
        }),
      );
      return {
        reply:
          "Tuve un problema guardando la cita. Te paso con recepción para confirmarla manualmente.",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "confirm_booking",
          collected,
        },
        leadPatch: {},
        debugNote: "dental_guided_booking_failed",
      };
    }
    console.log(
      "[run-replies] dental confirmar trace",
      JSON.stringify({
        stage: "after_executeToolAction",
        organization_id: organizationId,
        lead_id: leadId,
        booking_ok: result.booking?.ok ?? null,
        booking_error: result.booking && !result.booking.ok
          ? result.booking.error
          : null,
        has_reply_override: Boolean(result.replyOverride),
      }),
    );
    if (result.booking?.ok) {
      return {
        reply: formatDentalBookingSuccess(result.booking),
        statePatch: clearActiveBookingState({
          stage: "BOOKED",
          lastIntent: "booking_confirmed",
          nextExpected: undefined,
          collected: {
            patient_name: safeStr(
              pending.patient_name,
              safeStr((collected as any).patient_name, ""),
            ),
            confirmed: true,
            activeBookingFlow: false,
            allow_additional_booking: false,
            current_flow: null,
            active_appointment: null,
            pending_reschedule: null,
            pending_booking: null,
            pending_offered_slot: null,
            selected_slot: null,
            current_date: null,
            current_time: null,
            preferred_date: null,
            preferred_time: null,
            last_offered_slots: null,
            last_offered_dates: null,
            lastBookingStep: null,
            expected_step: null,
          },
        }),
        leadPatch: {},
        debugNote: "dental_guided_booking_confirmed",
        bookingSuccessAuthorized: true,
      };
    }
    console.warn(
      "[run-replies] dental confirm failed before actionExecutor",
      JSON.stringify({
        stage: "booking_action_returned_failure",
        organization_id: organizationId,
        lead_id: leadId,
        booking_error: result.booking && !result.booking.ok
          ? result.booking.error
          : null,
        provider_id: pendingProviderId || null,
        provider_name: pendingProviderName,
        appointment_date: safeStr(pending.appointment_date, ""),
        appointment_time: safeStr(pending.appointment_time, ""),
        starts_at: safeStr(pending.starts_at, ""),
      }),
    );
    return {
      reply: result.replyOverride ??
        "Tuve un problema guardando la cita. Te paso con recepción para confirmarla manualmente.",
      statePatch: {
        stage: "BOOKING",
        nextExpected: "confirm_booking",
        collected,
      },
      leadPatch: {},
      debugNote: "dental_guided_booking_failed",
    };
  }

  if (expected === "provider_selection") {
    return {
      reply:
        "Podés escoger un doctor de la lista o elegir cualquiera disponible.",
      statePatch: {
        stage: "BOOKING",
        nextExpected: "provider_selection",
        collected,
      },
      leadPatch: {},
      debugNote: "dental_guided_provider_unknown",
      interactiveButtons: dentalProviderButtons(providers),
      interactiveList: dentalProviderSelectionList(providers),
    };
  }

  return null;
}

function resolveBarbershopPublicLocationFromSettings(
  clinicSettings: Record<string, unknown>,
): string {
  const integrations = (clinicSettings.integrations &&
      typeof clinicSettings.integrations === "object")
    ? (clinicSettings.integrations as Record<string, unknown>)
    : {};
  return safeStr(
    clinicSettings.location,
    safeStr(
      clinicSettings.address,
      safeStr(
        integrations.public_location,
        "Barrio Los Andes, San Pedro Sula, frente al parque principal",
      ),
    ),
  ).trim() || "Barrio Los Andes, San Pedro Sula, frente al parque principal";
}

function formatBarbershopActiveAppointmentBrief(
  activeAppointment?: Record<string, unknown> | null,
): string {
  if (!activeAppointment) return "";
  const provider = safeStr(
    (activeAppointment as any).provider_name,
    safeStr((activeAppointment as any).preferred_barber, ""),
  );
  const providerLine = provider ? ` con ${provider}` : "";
  const status = formatCustomerAppointmentStatus(activeAppointment.status);
  const date = safeStr(
    activeAppointment.appointment_date,
    safeStr(activeAppointment.starts_at, "").slice(0, 10),
  );
  const time = safeStr(
    activeAppointment.appointment_time,
    safeStr(activeAppointment.starts_at, "").slice(11, 16),
  );
  if (!date || !time) return "";
  return `\n\nYa tenés tu ${status} para ${
    formatRequestedDayLabel(date)
  } a las ${formatHourLabel(time)}${providerLine}.`;
}

function formatBarbershopLocationFaq(
  clinicSettings: Record<string, unknown>,
  activeAppointment?: Record<string, unknown> | null,
): string {
  return `📍 Estamos en ${
    resolveBarbershopPublicLocationFromSettings(clinicSettings)
  }.${
    formatBarbershopActiveAppointmentBrief(activeAppointment)
  }\n\n¿Querés agendar una cita?`;
}

function getHoursEntry(
  hours: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const aliases: Record<string, string[]> = {
    mon: ["mon", "monday", "lunes", "1"],
    tue: ["tue", "tuesday", "martes", "2"],
    wed: ["wed", "wednesday", "miercoles", "miércoles", "3"],
    thu: ["thu", "thursday", "jueves", "4"],
    fri: ["fri", "friday", "viernes", "5"],
    sat: ["sat", "saturday", "sabado", "sábado", "6"],
    sun: ["sun", "sunday", "domingo", "0", "7"],
  };
  for (const alias of aliases[key] ?? [key]) {
    const entry = hours[alias];
    if (entry && typeof entry === "object") {
      return entry as Record<string, unknown>;
    }
  }
  return null;
}

function formatBarbershopHoursFaq(
  clinicSettings: Record<string, unknown>,
  activeAppointment?: Record<string, unknown> | null,
): string {
  const hours =
    (clinicSettings.hours && typeof clinicSettings.hours === "object")
      ? (clinicSettings.hours as Record<string, unknown>)
      : {};
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const dayNames = [
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
    "domingo",
  ];
  const rows = dayKeys.map((key, index) => {
    const entry = getHoursEntry(hours, key);
    const open = safeStr(entry?.open ?? entry?.open_time, "");
    const close = safeStr(entry?.close ?? entry?.close_time, "");
    const closed = !entry || Boolean(entry.closed ?? entry.is_closed) ||
      !open || !close;
    return { key, name: dayNames[index], closed, open, close };
  });
  const monToSat = rows.slice(0, 6);
  const sunday = rows[6];
  const sameMonToSat = monToSat.every((row) =>
    !row.closed && row.open === monToSat[0].open &&
    row.close === monToSat[0].close
  );
  if (sameMonToSat) {
    const sundayLine = sunday.closed
      ? "Domingo cerrado."
      : `Domingo de ${formatHourLabel(sunday.open)} a ${
        formatHourLabel(sunday.close)
      }.`;
    return `🕘 Atendemos de lunes a sábado de ${
      formatHourLabel(monToSat[0].open)
    } a ${formatHourLabel(monToSat[0].close)}.\n${sundayLine}${
      formatBarbershopActiveAppointmentBrief(activeAppointment)
    }\n\n¿Querés reservar un espacio?`;
  }
  const lines = rows.map((row) =>
    row.closed
      ? `${row.name.charAt(0).toUpperCase()}${row.name.slice(1)}: cerrado`
      : `${row.name.charAt(0).toUpperCase()}${row.name.slice(1)}: ${
        formatHourLabel(row.open)
      } a ${formatHourLabel(row.close)}`
  );
  return `🕘 Horario:\n${lines.join("\n")}${
    formatBarbershopActiveAppointmentBrief(activeAppointment)
  }\n\n¿Querés reservar un espacio?`;
}

function formatBarbershopServicesFaq(
  services: Array<Record<string, unknown>>,
): string {
  const active = services.filter((service) =>
    service.active !== false && service.is_active !== false
  );
  if (active.length === 0) {
    return "Por ahora no tengo servicios configurados para mostrar.\n\n¿Querés hablar con alguien?";
  }
  const lines = active.map((service) => {
    const name = safeStr(service.name, "Servicio");
    return `• ${name} — ${
      formatDurationLabel(service.duration_min ?? service.durationMinutes)
    }`;
  });
  return `Tenemos estos servicios 💈\n\n${
    lines.join("\n")
  }\n\n¿Querés reservar uno?`;
}

function formatBarbershopProvidersFaq(
  providers: BarbershopProviderOption[],
): string {
  if (providers.length === 0) {
    return "Todavía no tengo barberos configurados para mostrar.\n\n¿Querés hablar con alguien?";
  }
  return `Trabajan estos barberos 💈\n\n${
    providers.map((provider) => `• ${provider.name}`).join("\n")
  }\n• Cualquiera disponible\n\n¿Querés agendar con alguno?`;
}

function formatBarbershopServiceSelectionText(
  services: Array<Record<string, unknown>>,
): string {
  const active = services.filter((service) =>
    service.active !== false && service.is_active !== false
  );
  if (active.length <= 3) return "Perfecto 💈 Escogé el servicio:";
  const lines = active.map((service, index) =>
    `${index + 1}. ${safeStr(service.name, "Servicio")}`
  );
  return `Escogé el servicio:\n${lines.join("\n")}`;
}

function serviceSelectionButtons(
  services: Array<Record<string, unknown>>,
): InteractiveButton[] {
  const active = services.filter((service) =>
    service.active !== false && service.is_active !== false
  );
  if (active.length > 3) return [];
  return active.map((service) => ({
    id: `select_service:${toServiceActionKey(service)}`,
    title: safeStr(service.name, "Servicio").slice(0, 20),
  }));
}

function getServiceShortPrice(service: Record<string, unknown>): string {
  const price = Number(
    service.price_from ?? service.price ?? service.amount ??
      service.price_hnl ?? service.base_price_hnl,
  );
  return Number.isFinite(price) && price > 0 ? `L${Math.round(price)}` : "";
}

function formatServiceSelectionDescription(
  service: Record<string, unknown>,
): string {
  const duration = formatDurationLabel(
    service.duration_min ?? service.durationMinutes,
  );
  const price = getServiceShortPrice(service);
  return [price, duration].filter(Boolean).join(" · ") || "Disponible";
}

function serviceSelectionList(
  services: Array<Record<string, unknown>>,
  body = "Perfecto 💈 Escogé el servicio:",
  forceList = false,
): WhatsAppInteractiveListSpec | undefined {
  const active = services.filter((service) =>
    service.active !== false && service.is_active !== false
  );
  if (active.length <= 3 && !forceList) return undefined;
  return {
    body,
    buttonText: "Ver servicios",
    sections: [
      {
        title: "Servicios",
        rows: active.slice(0, 10).map((service) => {
          const name = safeStr(service.name, "Servicio");
          const price = getServiceShortPrice(service);
          return {
            id: `select_service:${toServiceActionKey(service)}`,
            title: `${getServiceMenuEmoji(name)} ${name}${
              price ? ` — ${price}` : ""
            }`.slice(0, 24),
            description: formatServiceSelectionDescription(service),
          };
        }),
      },
    ],
  };
}

function formatProviderSelectionText(
  providers: BarbershopProviderOption[],
): string {
  const names = [
    ...providers.map((provider) => provider.name),
    "Cualquiera disponible",
  ];
  if (names.length <= 3) return "¿Con qué barbero querés?";
  return `¿Con qué barbero querés?\n${
    names.map((name, index) => `${index + 1}. ${name}`).join("\n")
  }`;
}

function providerSelectionButtons(
  providers: BarbershopProviderOption[],
): InteractiveButton[] {
  const options = [
    ...providers.map((provider) => ({
      id: `select_provider:${provider.id}`,
      title: provider.name.slice(0, 20),
    })),
    { id: "select_provider:any", title: "Cualquiera" },
  ];
  return options.length <= 3 ? options : [];
}

function providerSelectionList(
  providers: BarbershopProviderOption[],
): WhatsAppInteractiveListSpec | undefined {
  const options = [
    ...providers.map((provider) => ({
      id: `select_provider:${provider.id}`,
      title: provider.name,
      description: "Barbero",
    })),
    {
      id: "select_provider:any",
      title: "Cualquiera disponible",
      description: "Asignamos el primer espacio libre",
    },
  ];
  if (options.length <= 3) return undefined;
  return {
    body: "¿Con qué barbero querés?",
    buttonText: "Ver barberos",
    sections: [{ title: "Barberos", rows: options }],
  };
}

function resolveProviderFromActionOrText(
  providers: BarbershopProviderOption[],
  value: string,
): { id: string; name: string; preference: "any" | "specific" } | null {
  const normalized = normalizePayloadActionValue(value).replace(
    /^select_provider:/,
    "",
  ).trim();
  const text = normalizeTextForMatch(normalized || value).trim();
  if (!text) return null;
  if (
    text === "any" ||
    /\b(cualquiera|cualquier|cualqueira|cualkiera|cualquiera disponible|cualquiera que tenga espacio|disponible|el que este|el que esté|el que este libre|el que este disponible|quien este|quien esté|quien este disponible|no importa|me da igual|con quien sea|quien sea|primero libre|el primero libre|asigname cualquiera)\b/
      .test(text)
  ) {
    return { id: "", name: "Cualquiera disponible", preference: "any" };
  }
  const number = Number(text);
  if (Number.isInteger(number) && number >= 1) {
    if (number <= providers.length) {
      const provider = providers[number - 1];
      return { id: provider.id, name: provider.name, preference: "specific" };
    }
    if (number === providers.length + 1) {
      return { id: "", name: "Cualquiera disponible", preference: "any" };
    }
  }
  const match = providers.find((provider) => {
    const providerId = normalizeTextForMatch(provider.id);
    const providerName = normalizeTextForMatch(provider.name);
    return providerId === text || providerName === text ||
      providerName.includes(text) || text.includes(providerName) ||
      isCloseTextMatch(providerName, text);
  });
  return match
    ? { id: match.id, name: match.name, preference: "specific" }
    : null;
}

function getLastOfferedBarbershopProviders(
  collected: Record<string, unknown>,
): BarbershopProviderOption[] {
  const offered = Array.isArray((collected as any)?.last_offered_providers)
    ? ((collected as any).last_offered_providers as Array<
      Record<string, unknown>
    >)
    : [];
  return offered
    .map((provider) => ({
      id: safeStr(provider.id, "").trim(),
      name: safeStr(provider.name, "").trim(),
      active: provider.active !== false,
    }))
    .filter((provider) =>
      provider.active &&
      provider.id &&
      provider.name &&
      provider.id !== "any" &&
      !normalizeTextForMatch(provider.name).includes("cualquiera")
    );
}

function resolveProviderOptionsForTurn(
  settingsProviders: BarbershopProviderOption[],
  collected: Record<string, unknown>,
): BarbershopProviderOption[] {
  const merged: BarbershopProviderOption[] = [];
  const seen = new Set<string>();
  const pushProvider = (provider: BarbershopProviderOption) => {
    const id = safeStr(provider.id, "").trim();
    const name = safeStr(provider.name, "").trim();
    if (!id || !name || provider.active === false) return;
    const key = `${id.toLowerCase()}|${normalizeTextForMatch(name)}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ id, name, active: true });
  };
  getLastOfferedBarbershopProviders(collected).forEach(pushProvider);
  settingsProviders.forEach(pushProvider);
  return merged;
}

function resolveBarbershopGuidedExpectedStep(
  leadState: Record<string, unknown> | null | undefined,
): string {
  const collected = ((leadState as any)?.collected ?? {}) as Record<
    string,
    unknown
  >;
  const direct = safeStr((leadState as any)?.nextExpected, "");
  if (direct) return direct;
  const collectedExpected = safeStr(
    (collected as any)?.expected_step,
    safeStr((collected as any)?.nextExpected, ""),
  );
  if (collectedExpected) return collectedExpected;
  const lastBookingStep = safeStr((collected as any)?.lastBookingStep, "");
  if (lastBookingStep === "select_service") return "service_selection";
  if (lastBookingStep === "select_day") return "booking_date_preference";
  if (lastBookingStep === "select_provider") return "provider_selection";
  if (lastBookingStep === "select_time") return "availability_slot_selection";
  const pending = ((collected as any)?.pending_booking ?? {}) as Record<
    string,
    unknown
  >;
  const hasOfferedProviders =
    getLastOfferedBarbershopProviders(collected).length > 0;
  const hasService = Boolean(
    safeStr(
      (collected as any)?.current_service_key,
      safeStr(pending.service_key, ""),
    ),
  );
  const hasDate = Boolean(
    safeStr(
      (collected as any)?.current_date,
      safeStr(
        (collected as any)?.preferred_date,
        safeStr(pending.appointment_date, ""),
      ),
    ),
  );
  const hasSelectedSlot = Boolean((collected as any)?.selected_slot);
  if (hasOfferedProviders && hasService && hasDate && !hasSelectedSlot) {
    return "provider_selection";
  }
  return "";
}

function resolveServiceFromTextSelection(
  services: Array<Record<string, unknown>>,
  value: string,
): Record<string, unknown> | null {
  const text = normalizeTextForMatch(value).trim();
  const number = Number(text);
  const active = services.filter((service) =>
    service.active !== false && service.is_active !== false
  );
  if (Number.isInteger(number) && number >= 1 && number <= active.length) {
    return active[number - 1];
  }
  const serviceAlias = normalizeServiceAliasForMatch(text);
  return active.find((service) =>
    normalizeTextForMatch(safeStr(service.name, "")) === text ||
    normalizeTextForMatch(toServiceActionKey(service)) === text ||
    normalizeTextForMatch(safeStr(service.name, "")).includes(text) ||
    normalizeServiceAliasForMatch(safeStr(service.name, "")) === serviceAlias ||
    normalizeTextForMatch(toServiceActionKey(service)).includes(serviceAlias)
  ) ?? null;
}

function normalizeServiceAliasForMatch(input: string): string {
  const text = normalizeTextForMatch(input).replace(/\s+/g, " ").trim();
  if (/\b(corte y barba|barba y corte|corte con barba)\b/.test(text)) {
    return "corte_barba";
  }
  if (/\b(corte y limpieza|limpieza y corte|corte con limpieza)\b/.test(text)) {
    return "corte_limpieza";
  }
  if (/\b(limpieza facial|facial)\b/.test(text)) return "limpieza_facial";
  if (
    /\b(corte solo|solo corte|corte de pelo|corte cabello|corte)\b/.test(text)
  ) return "corte_solo";
  return text.replace(/\s+/g, "_");
}

function isCloseTextMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array<number>(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length] <= 2;
}

function parseDateFromAction(actionValue: string): string {
  const m = normalizePayloadActionValue(actionValue).match(
    /^select_date(?:_explicit_year)?:(\d{4}-\d{2}-\d{2})$/,
  );
  return m?.[1] ?? "";
}

function dateSelectionList(
  dates: Array<{ date: string; label: string }>,
  body: string,
): WhatsAppInteractiveListSpec | undefined {
  if (dates.length === 0) return undefined;
  return {
    body,
    buttonText: "Ver días",
    sections: [
      {
        title: "Días disponibles",
        rows: dates.slice(0, 10).map((item) => ({
          id: `select_date:${item.date}`,
          title: item.label.slice(0, 24),
          description: "Disponible",
        })),
      },
    ],
  };
}

function barbershopDateSelectionList(
  dates: Array<{ date: string; label: string }>,
  body: string,
): WhatsAppInteractiveListSpec | undefined {
  if (dates.length === 0) return undefined;
  return {
    body,
    buttonText: "Ver días disponibles",
    sections: [
      {
        title: "Días disponibles",
        rows: dates.slice(0, 7).map((item) => ({
          id: `select_date:${item.date}`,
          title: item.label.slice(0, 24),
          description: "Disponible",
        })),
      },
    ],
  };
}

function capitalizeFirst(value: string): string {
  const text = String(value ?? "").trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

function parseTimeFromAction(
  actionValue: string,
): { date: string; time: string; providerId: string } {
  const m = normalizePayloadActionValue(actionValue).match(
    /^select_(?:time|slot):(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|(.+)$/,
  );
  return {
    date: m?.[1] ?? "",
    time: m?.[2] ?? "",
    providerId: m?.[3] ?? "",
  };
}

function timeSlotsList(
  slots: Array<Record<string, unknown>>,
  body: string,
  serviceName = "",
  providerPreference: "any" | "specific" = "any",
  buttonText = "Ver todos los horarios",
): WhatsAppInteractiveListSpec | undefined {
  if (slots.length <= 3) return undefined;
  return {
    body,
    buttonText,
    sections: [
      {
        title: "Horarios",
        rows: slots.slice(0, 10).map((slot) => ({
          id: `select_slot:${safeStr(slot.date, "")}|${
            safeStr(slot.time, "")
          }|${safeStr(slot.provider_id, "")}`,
          title: providerPreference === "any"
            ? `${formatHourLabel(safeStr(slot.time, ""))} · ${
              safeStr(slot.provider_name, "Barbero")
            }`.slice(0, 24)
            : formatHourLabel(safeStr(slot.time, "")).slice(0, 24),
          description: providerPreference === "specific"
            ? `${safeStr(slot.provider_name, "Barbero")} · ${
              serviceName || safeStr(slot.service_name, "Servicio")
            }`.slice(0, 72)
            : `${serviceName || safeStr(slot.service_name, "Servicio")}`.slice(
              0,
              72,
            ),
        })),
      },
    ],
  };
}

function formatBarbershopSlotOptionsBody(args: {
  providerPreference: "any" | "specific";
  providerName?: string;
  lines: string;
  hasMore: boolean;
}): string {
  if (args.providerPreference === "specific") {
    const provider = args.providerName || "tu barbero";
    return args.hasMore
      ? `Estos son algunos horarios disponibles con *${provider}* 💈\n\n${args.lines}\n\nEscogé una hora o mirá más opciones.`
      : `Estos espacios están disponibles con ${provider} 💈\n\n${args.lines}\n\nEscogé el horario que querés reservar.`;
  }
  return args.hasMore
    ? `Estos son algunos horarios disponibles 💈\n\n${args.lines}\n\nEscogé una hora o mirá más opciones.`
    : `Estos espacios están disponibles 💈\n\n${args.lines}\n\nEscogé el horario que querés reservar.`;
}

function toBarbershopOfferedSlot(
  slot: Record<string, unknown>,
  service: Record<string, unknown> | null,
  fallbackServiceName: string,
  source: "today" | "tomorrow" | "date" | "more_hours" | "exact_alternative",
): Record<string, unknown> {
  const serviceName = safeStr(
    slot.service_name,
    safeStr(service?.name, fallbackServiceName),
  );
  return {
    date: safeStr(slot.date, ""),
    time: safeStr(slot.time, ""),
    starts_at: safeStr(slot.starts_at, ""),
    provider_id: safeStr(slot.provider_id, ""),
    provider_name: safeStr(slot.provider_name, ""),
    service_key: safeStr(
      slot.service_key,
      service ? toServiceActionKey(service) : "",
    ),
    service_name: serviceName,
    duration_min: Number(slot.duration_min ?? service?.duration_min ?? 30) ||
      30,
    source,
  };
}

function toBarbershopOfferedDate(
  date: string,
  label: string,
  source: "more_days" | "today" | "tomorrow",
  serviceKey = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = { date, label, source };
  if (serviceKey) out.service_key = serviceKey;
  return out;
}

async function holdSelectedBarbershopSlot(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  timezone: string;
  selectedSlot: Record<string, unknown>;
  serviceName: string;
  serviceId?: string;
}): Promise<
  | { ok: true; selected_slot: Record<string, unknown>; hold: BookingHoldRow }
  | {
    ok: false;
    reason: "active_hold_conflict" | "unavailable" | "hold_failed";
    alternatives: any[];
  }
> {
  const date = safeStr(args.selectedSlot.date, "");
  const time = safeStr(args.selectedSlot.time, "");
  const providerId = safeStr(args.selectedSlot.provider_id, "");
  const startsAt = buildIsoTimestampForHold(
    date,
    time,
    safeStr(args.selectedSlot.starts_at, ""),
    args.timezone,
  );
  if (!date || !time || !providerId || !startsAt) {
    return { ok: false, reason: "unavailable", alternatives: [] };
  }

  const nowIsoValue = nowIso();
  const activeHold = await findActiveBookingHoldForSlot({
    supabase: args.supabase,
    organizationId: args.organizationId,
    providerId,
    startsAt,
    nowIso: nowIsoValue,
  });
  if (activeHold.hold && safeStr(activeHold.hold.lead_id, "") === args.leadId) {
    return {
      ok: true,
      hold: activeHold.hold,
      selected_slot: {
        ...args.selectedSlot,
        starts_at: startsAt,
        ends_at: activeHold.hold.ends_at,
        hold_id: activeHold.hold.id,
        hold_expires_at: activeHold.hold.expires_at,
      },
    };
  }
  if (activeHold.hold) {
    const alternatives = await suggestNextAvailableSlots({
      supabase: args.supabase,
      organization_id: args.organizationId,
      business_type: "barbershop",
      service_id: args.serviceId ?? "",
      service_name: args.serviceName,
      provider_preference: "any",
      date_from: date,
      timezone: args.timezone,
      max_options: 3,
    });
    return { ok: false, reason: "active_hold_conflict", alternatives };
  }

  const exact = await checkSlotAvailability({
    supabase: args.supabase,
    organization_id: args.organizationId,
    business_type: "barbershop",
    service_id: args.serviceId ?? "",
    service_name: args.serviceName,
    provider_id: providerId,
    provider_preference: "specific",
    date,
    specific_time: time,
    timezone: args.timezone,
    max_options: 3,
  });
  if (!exact.available) {
    return {
      ok: false,
      reason: "unavailable",
      alternatives: exact.alternatives ?? [],
    };
  }

  const durationMin = Number(args.selectedSlot.duration_min ?? 30) || 30;
  const hold = await createBookingHold({
    supabase: args.supabase,
    organizationId: args.organizationId,
    leadId: args.leadId,
    providerId,
    providerName: safeStr(args.selectedSlot.provider_name, ""),
    serviceKey: safeStr(args.selectedSlot.service_key, ""),
    serviceName: safeStr(args.selectedSlot.service_name, args.serviceName),
    date,
    time,
    startsAt: safeStr(args.selectedSlot.starts_at, ""),
    durationMin,
    timezone: args.timezone,
    nowIso: nowIsoValue,
    metadata: { source: "barberline_preconfirm_hold" },
  });
  if (!hold.ok) {
    return {
      ok: false,
      reason: hold.reason === "active_hold_conflict"
        ? "active_hold_conflict"
        : "hold_failed",
      alternatives: exact.alternatives ?? [],
    };
  }
  return {
    ok: true,
    hold: hold.hold,
    selected_slot: {
      ...args.selectedSlot,
      starts_at: startsAt,
      ends_at: hold.hold.ends_at,
      hold_id: hold.hold.id,
      hold_expires_at: hold.hold.expires_at,
    },
  };
}

function parseBookingDatePrefFromAction(
  actionValue: string,
): "today" | "tomorrow" | "week" | "" {
  const m = normalizePayloadActionValue(actionValue).match(
    /^booking_date_pref:(today|tomorrow|week)$/,
  );
  return (m?.[1] as "today" | "tomorrow" | "week" | undefined) ?? "";
}

function resolveGuidedDateActionFromText(
  input: string,
  offeredDates: any[],
  nowLocal: Date,
): string {
  const text = normalizeTextForMatch(input).trim();
  if (!text) return "";
  if (
    /\b(ver proximos dias|ver próximos dias|ver proximos días|ver próximos días|proximos dias|próximos dias|proximos días|próximos días|ver mas dias|ver más dias|ver mas días|mas dias|más días|otro dia|otro día|otra fecha)\b/
      .test(text)
  ) {
    return "booking_date_pref:week";
  }
  if (/\bhoy\b/.test(text)) return "booking_date_pref:today";
  if (/\b(manana|mañana)\b/.test(text) && !/\bpasado\b/.test(text)) {
    return "booking_date_pref:tomorrow";
  }
  const plusDays = /\bpasado\s+(manana|mañana)\b/.test(text) ? 2 : 0;
  if (plusDays > 0) {
    const d = new Date(nowLocal);
    d.setDate(d.getDate() + plusDays);
    return `select_date:${formatLocalDateForAction(d)}`;
  }
  const weekdayMap: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
  };
  for (const offered of offeredDates) {
    const label = normalizeTextForMatch(safeStr(offered?.label, ""));
    const date = safeStr(offered?.date, "");
    if (date && label && (text.includes(label) || label.includes(text))) {
      return `select_date:${date}`;
    }
  }
  for (const [weekday, targetDay] of Object.entries(weekdayMap)) {
    if (!new RegExp(`\\b${weekday}\\b`).test(text)) continue;
    const d = new Date(nowLocal);
    const diff = (targetDay - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return `select_date:${formatLocalDateForAction(d)}`;
  }
  return "";
}

function formatLocalDateForAction(date: Date): string {
  return `${date.getFullYear()}-${
    String(date.getMonth() + 1).padStart(2, "0")
  }-${String(date.getDate()).padStart(2, "0")}`;
}

function resolveGuidedSlotActionFromText(
  input: string,
  offeredSlots: any[],
  allowNumbered: boolean,
): string {
  const text = normalizeTextForMatch(input).trim();
  if (!text || !Array.isArray(offeredSlots) || offeredSlots.length === 0) {
    return "";
  }
  const optionMatch = text.match(/\b(?:opcion|opción)\s*(\d{1,2})\b/) ??
    text.match(/\b(primera|primer|segunda|tercera)\s+(?:opcion|opción)?\b/);
  const wordOptionMap: Record<string, number> = {
    primera: 1,
    primer: 1,
    segunda: 2,
    tercera: 3,
  };
  const optionNumber = optionMatch
    ? Number(
      optionMatch[1] ?? wordOptionMap[optionMatch[0]?.split(/\s+/)[0] ?? ""],
    )
    : (/^\d{1,2}$/.test(text) && allowNumbered ? Number(text) : 0);
  if (
    Number.isInteger(optionNumber) && optionNumber >= 1 &&
    optionNumber <= offeredSlots.length
  ) {
    const slot = offeredSlots[optionNumber - 1];
    return `select_slot:${safeStr(slot.date, "")}|${safeStr(slot.time, "")}|${
      safeStr(slot.provider_id, "")
    }`;
  }
  const parsedTime = parseLooseTimeText(text);
  if (!parsedTime) return "";
  const match = offeredSlots.find((slot) =>
    safeStr(slot.time, "") === parsedTime
  );
  return match
    ? `select_slot:${safeStr(match.date, "")}|${safeStr(match.time, "")}|${
      safeStr(match.provider_id, "")
    }`
    : "";
}

function parseLooseTimeText(text: string): string {
  const n = normalizeTextForMatch(text).trim();
  const words: Record<string, number> = {
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
  };
  const word = Object.entries(words).find(([key]) =>
    new RegExp(`\\b${key}\\b`).test(n)
  );
  const numeric = n.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  let hour = word ? word[1] : Number(numeric?.[1] ?? NaN);
  const minute = numeric?.[2] ? Number(numeric[2]) : 0;
  const meridiem = safeStr(numeric?.[3], "");
  if (
    !Number.isFinite(hour) || hour < 1 || hour > 23 || minute < 0 || minute > 59
  ) return "";
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function resolveGuidedConfirmationActionFromText(input: string): string {
  const text = normalizeTextForMatch(input).trim();
  return /\b(confirmar|confirmemos|si|sí|dale|correcto|esta bien|está bien|ok|okay)\b/
      .test(text)
    ? "confirm_booking"
    : "";
}

function isAffirmativeDentalText(input: string): boolean {
  const text = normalizeTextForMatch(input).trim();
  return /\b(ok|okay|si|sí|dale|me sirve|funciona|esta bien|está bien|correcto|perfecto|confirmar|confirmemos)\b/
    .test(text);
}

function resolveGuidedConflictActionFromText(input: string): string {
  const text = normalizeTextForMatch(input).trim();
  if (
    /\b(cambiar|reagendar|reagenda|reagendamela|mover|moverla|cambiar mi cita|cambiar cita)\b/
      .test(
        text,
      )
  ) return "reschedule_booking";
  if (/\b(agendar otra|otra cita|adicional|otra)\b/.test(text)) {
    return "additional_booking";
  }
  if (/\b(mantener|dejarla igual|dejar igual|mantener mi cita)\b/.test(text)) {
    return "keep_existing_booking";
  }
  if (/\b(cancelar|cancelala|cancelarla)\b/.test(text)) return "cancel";
  return "";
}

function dentalCancelConfirmationButtons(): InteractiveButton[] {
  return [
    { id: "confirm_cancel_appointment", title: "Confirmar cancelación" },
    { id: "keep_existing_booking", title: "Mantener cita" },
    { id: "reschedule_booking", title: "Cambiar hora" },
  ];
}

function dentalPostCancelButtons(): InteractiveButton[] {
  return [
    { id: "booking_start", title: "Agendar otra cita" },
    { id: "view_prices", title: "Servicios" },
  ];
}

function dentalRescheduleConfirmationButtons(): InteractiveButton[] {
  return [
    { id: "confirm_reschedule_appointment", title: "Confirmar" },
    { id: "change_booking_slot", title: "Cambiar hora" },
    { id: "cancel_booking", title: "Cancelar" },
  ];
}

function dentalRescheduleChoiceButtons(): InteractiveButton[] {
  return [
    { id: "change_booking_slot", title: "Cambiar hora" },
    { id: "dental_reschedule_change_date", title: "Cambiar día" },
    { id: "keep_existing_booking", title: "Cancelar cambio" },
  ];
}

function dentalSameDayRescheduleButtons(): InteractiveButton[] {
  return [
    { id: "dental_reschedule_show_hours", title: "Ver horarios" },
    { id: "dental_reschedule_change_date", title: "Otra fecha" },
    { id: "keep_existing_booking", title: "No hacer cambios" },
  ];
}

function dentalNoActiveAppointmentButtons(): InteractiveButton[] {
  return [
    { id: "booking_start", title: "Agendar cita" },
    { id: "view_prices", title: "Servicios" },
  ];
}

function clearDentalAttemptedBookingState(
  collected: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...collected,
    activeBookingFlow: false,
    allow_additional_booking: false,
    pending_booking: null,
    pending_reschedule: null,
    selected_slot: null,
    pending_offered_slot: null,
    pending_requested_slot: null,
    current_service_key: "",
    current_service_name: "",
    current_date: "",
    preferred_date: "",
    preferred_time: "",
    requested_date: "",
    requested_time: "",
    selected_date: "",
    selected_time: "",
    selected_service: "",
    service: "",
    service_key: "",
    lastBookingStep: "",
    expected_step: "",
    lastIntent: "",
    nextExpected: undefined,
    last_offered_slots: [],
    last_offered_dates: [],
    last_availability_context: null,
    ...overrides,
  };
}

function dentalAttemptedBookingTopLevelClearPatch(): Record<string, unknown> {
  return {
    pending_booking: null,
    pending_reschedule: null,
    selected_slot: null,
    pending_offered_slot: null,
    pending_requested_slot: null,
    current_service_key: "",
    current_service_name: "",
    current_date: "",
    preferred_date: "",
    preferred_time: "",
    last_offered_slots: [],
    last_offered_dates: [],
    activeBookingFlow: false,
  };
}

function buildDentalAdditionalBookingServicePickerResult(args: {
  clinicSettings: Record<string, unknown>;
  collected: Record<string, unknown>;
  leadPatch?: Json;
  debugNote?: string;
}): GenerateReplyResult {
  const services = getDentalGuidedServices(args.clinicSettings);
  const list = dentalServiceSelectionList(services);
  return {
    reply: list?.body ?? "Escogé el motivo de la cita 🦷",
    statePatch: {
      stage: "BOOKING",
      lastIntent: "additional_booking",
      nextExpected: "service_selection",
      collected: clearDentalAttemptedBookingState(args.collected, {
        activeBookingFlow: true,
        allow_additional_booking: true,
        lastBookingStep: "select_service",
        expected_step: "service_selection",
        pending_booking: null,
        pending_reschedule: null,
      }),
    },
    leadPatch: args.leadPatch ?? {},
    debugNote: args.debugNote ??
      "dental_guided_additional_booking_service_selection",
    interactiveButtons: dentalServiceButtons(services),
    interactiveList: list,
  };
}

export function __testBuildDentalAdditionalBookingServicePickerResult(args: {
  clinicSettings: Record<string, unknown>;
  collected?: Record<string, unknown>;
  leadPatch?: Json;
}): GenerateReplyResult {
  return buildDentalAdditionalBookingServicePickerResult({
    clinicSettings: args.clinicSettings,
    collected: args.collected ?? {},
    leadPatch: args.leadPatch,
    debugNote: "dental_additional_booking_hard_override",
  });
}

function buildDentalActiveAppointmentState(
  appt: Record<string, unknown>,
  fallbackService = "Revisión dental",
  brandName = "la clínica",
): Record<string, unknown> {
  const date = safeStr(
    appt.appointment_date,
    safeStr(appt.starts_at, "").slice(0, 10),
  );
  const time = safeStr(
    appt.appointment_time,
    safeStr(appt.starts_at, "").slice(11, 16),
  );
  const service = toPatientFacingServiceLabel(
    safeStr(appt.reason, safeStr(appt.title, fallbackService)),
  );
  return {
    id: safeStr(appt.id, ""),
    reason: service,
    title: safeStr(appt.title, ""),
    patient_name: safeStr(appt.patient_name, ""),
    appointment_date: date,
    appointment_time: time,
    starts_at: safeStr(appt.starts_at, `${date}T${time}:00`),
    status: safeStr(appt.status, "confirmed"),
    provider_id: safeStr(appt.provider_id, "") || null,
    provider_name: formatDentalProviderDisplayName(
      safeStr(appt.provider_name, "Doctor disponible"),
      brandName,
    ),
    duration_min: Number(appt.duration_min ?? 60) || 60,
  };
}

function formatDentalActiveAppointmentGuardReply(
  active: Record<string, unknown>,
): string {
  const date = safeStr(
    active.appointment_date,
    safeStr(active.starts_at, "").slice(0, 10),
  );
  const time = safeStr(
    active.appointment_time,
    safeStr(active.starts_at, "").slice(11, 16),
  );
  return `Ya tenés una cita confirmada para *${
    formatRequestedDayLabel(date)
  }* a las *${formatHourLabel(time)}* 🦷\n\n¿Qué querés hacer?`;
}

function dentalAppointmentReviewButtons(): InteractiveButton[] {
  return [
    { id: "reschedule_booking", title: "Cambiar mi cita" },
    { id: "cancel", title: "Cancelar" },
    { id: "keep_existing_booking", title: "Mantener cita" },
  ];
}

function formatDentalAppointmentListItem(
  appointment: Record<string, unknown>,
): {
  id: string;
  service: string;
  date: string;
  time: string;
  starts_at: string;
  rowTitle: string;
  rowDescription: string;
  line: string;
} {
  const service = toPatientFacingServiceLabel(
    safeStr(appointment.reason, safeStr(appointment.title, "Cita dental")),
  );
  const date = safeStr(
    appointment.appointment_date,
    safeStr(appointment.starts_at, "").slice(0, 10),
  );
  const time = safeStr(
    appointment.appointment_time,
    safeStr(appointment.starts_at, "").slice(11, 16),
  );
  const humanDate = formatRequestedDayLabel(date);
  const humanTime = formatHourLabel(time);
  return {
    id: safeStr(appointment.id, ""),
    service,
    date,
    time,
    starts_at: safeStr(appointment.starts_at, `${date}T${time}:00`),
    rowTitle: `${service} ${humanTime}`.slice(0, 24),
    rowDescription: humanDate.slice(0, 72),
    line: `${service} — ${humanDate} — ${humanTime}`,
  };
}

function buildDentalMultipleAppointmentsReviewResult(args: {
  appointments: Array<Record<string, unknown>>;
  collected: Record<string, unknown>;
  brandName: string;
}): GenerateReplyResult {
  const appointments = args.appointments
    .map((appointment) => ({
      raw: appointment,
      item: formatDentalAppointmentListItem(appointment),
    }))
    .filter((entry) => entry.item.id);
  const lines = appointments.map((entry, index) =>
    `${index + 1}. ${entry.item.line}`
  ).join("\n");
  const activeOptions = appointments.map((entry) =>
    buildDentalActiveAppointmentState(
      entry.raw,
      "Revisión dental",
      args.brandName,
    )
  );
  const reply =
    `Tenés estas citas confirmadas 🦷\n\n${lines}\n\n¿Cuál querés revisar?`;
  return {
    reply,
    statePatch: {
      stage: "BOOKING",
      nextExpected: "active_appointment_selection",
      collected: {
        ...args.collected,
        active_appointment: null,
        active_appointments_options: activeOptions,
      },
    },
    leadPatch: {},
    debugNote: "dental_multiple_active_appointments_lookup",
    interactiveList: {
      body: reply,
      buttonText: "Elegir cita",
      sections: [
        {
          title: "Citas",
          rows: appointments.slice(0, 10).map((entry) => ({
            id: `select_active_appointment:${entry.item.id}`,
            title: entry.item.rowTitle,
            description: entry.item.rowDescription,
          })),
        },
      ],
    },
  };
}

function parseDentalRescheduleTimeFromText(input: string): string {
  const explicit = parseDentalExplicitTimeFromText(input);
  if (explicit) return explicit;
  const text = normalizeTextForMatch(input).trim();
  const match = text.match(
    /\b(?:para|a|alas|las)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/,
  );
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = safeStr(match[3], "");
  if (
    !Number.isFinite(hour) || !Number.isFinite(minute) || hour < 1 ||
    hour > 23 || minute < 0 || minute > 59
  ) return "";
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseDentalRescheduleDateFromText(
  input: string,
  nowLocal: Date,
  activeAppointment: Record<string, unknown>,
): string {
  const text = normalizeTextForMatch(input);
  const activeDate = safeStr(activeAppointment.appointment_date, "");
  if (
    activeDate &&
    /\b(mismo dia|mismo día|el mismo dia|el mismo día|ese mismo dia|ese mismo día|misma fecha|la misma fecha|deja la misma fecha|dejá la misma fecha|dejar la misma fecha|deja la fecha igual|dejá la fecha igual|dejar igual la fecha|solo cambiala|solo cambiarla|solo que)\b/
      .test(text)
  ) {
    return activeDate;
  }
  return parseDentalDateFromText(input, nowLocal) ||
    (activeDate && /\b(a las|alas|para las|solo)\b/.test(text)
      ? activeDate
      : "");
}

function dentalRescheduleHoursList(
  slots: Array<Record<string, unknown>>,
  body: string,
): WhatsAppInteractiveListSpec | undefined {
  if (!slots.length) return undefined;
  return {
    body,
    buttonText: "Horas disponibles",
    sections: [
      {
        title: "Horas disponibles",
        rows: slots.slice(0, 10).map((slot) => ({
          id: `dental_reschedule_time:${safeStr(slot.date, "")}|${
            safeStr(slot.time, "")
          }|${safeStr(slot.provider_id, "")}`,
          title: formatHourLabel(safeStr(slot.time, "")).slice(0, 24),
        })),
      },
    ],
  };
}

function parseExactTimeFromText(
  input: string,
  timezone: string,
  preferredDate?: string | null,
): { date: string; time: string } | null {
  const n = normalizeTextForMatch(input);
  const timeMatch = n.match(
    /(?:a las|alas)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/,
  );
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] ?? "0");
  const meridiem = safeStr(timeMatch[3], "");
  if (
    !Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 ||
    hour > 23 || minute < 0 || minute > 59
  ) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
  const dateNow = nowInTimezone(timezone);
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
      String(d.getDate()).padStart(2, "0")
    }`;
  let date = safeStr(preferredDate, "").trim();
  if (/\bmanana\b/.test(n)) {
    const d = new Date(dateNow);
    d.setDate(d.getDate() + 1);
    date = fmtDate(d);
  } else if (/\bhoy\b/.test(n)) {
    date = fmtDate(dateNow);
  } else if (!date) {
    return null;
  }
  return {
    date,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function parseDentalExplicitTimeFromText(input: string): string {
  const n = normalizeTextForMatch(input).trim();
  const match =
    n.match(/\b(?:a las|alas)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/) ??
      n.match(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b/) ??
      n.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = safeStr(match[3], "");
  if (
    !Number.isFinite(hour) || !Number.isFinite(minute) || hour < 1 ||
    hour > 23 || minute < 0 || minute > 59
  ) return "";
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  // Dental clinics are daytime businesses; "a las 3" should mean 3 PM, not 3 AM.
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseDentalDateFromTextWithMetadata(
  input: string,
  nowLocal: Date,
): { date: string; yearExplicit: boolean } {
  const guided = resolveGuidedDateActionFromText(input, [], nowLocal);
  const guidedDate = parseDateFromAction(guided);
  if (guidedDate) return { date: guidedDate, yearExplicit: false };
  const n = normalizeTextForMatch(input).trim();
  const monthMap: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };
  const m = n.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/,
  );
  if (!m) return { date: "", yearExplicit: false };
  const day = Number(m[1]);
  const month = monthMap[m[2]];
  const yearExplicit = Boolean(m[3]);
  const year = yearExplicit ? Number(m[3]) : nowLocal.getFullYear();
  if (
    !Number.isInteger(day) || !month || day < 1 || day > 31 ||
    !Number.isInteger(year) || year < 1900 || year > 2200
  ) return { date: "", yearExplicit: false };
  const candidate = new Date(year, month - 1, day, 12, 0, 0);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) return { date: "", yearExplicit: false };
  return { date: formatLocalDateForAction(candidate), yearExplicit };
}

function parseDentalDateFromText(input: string, nowLocal: Date): string {
  return parseDentalDateFromTextWithMetadata(input, nowLocal).date;
}

function shouldUseBookingFlowCta(args: {
  businessType: string;
  engineResult: any;
  clinicSettings: Record<string, unknown>;
}): { enabled: boolean; flowId: string; flowToken: string; reason?: string } {
  const businessType = safeStr(args.businessType, "").trim().toLowerCase();
  if (businessType !== "barbershop") {
    return {
      enabled: false,
      flowId: "",
      flowToken: "",
      reason: "non_barbershop",
    };
  }
  const integrations = getIntegrationsConfig(args.clinicSettings);
  const flowEnabled = Boolean(
    integrations.whatsapp_flow_booking_enabled === true ||
      isEnabledFlag(integrations.whatsapp_flow_booking_enabled),
  );
  if (!flowEnabled) {
    return {
      enabled: false,
      flowId: "",
      flowToken: "",
      reason: "flow_disabled",
    };
  }
  const flowId = safeStr(integrations.booking_flow_id, "").trim();
  if (!isUsableBookingFlowId(flowId)) {
    return {
      enabled: false,
      flowId: "",
      flowToken: "",
      reason: "missing_flow_id",
    };
  }

  const debug = (args.engineResult as any)?.debug ?? {};
  const debugIntent = safeStr(debug.intent, "").toLowerCase();
  const runtimeIntent = safeStr(debug?.barbershop_interpreter?.intent, "")
    .toLowerCase();
  const isBookingIntent = runtimeIntent === "booking_request" ||
    debugIntent === "book_appointment" ||
    debugIntent === "booking_request";
  if (!isBookingIntent) {
    return {
      enabled: false,
      flowId: "",
      flowToken: "",
      reason: "non_booking_intent",
    };
  }
  return {
    enabled: true,
    flowId,
    flowToken: safeStr(integrations.booking_flow_token, "").trim(),
  };
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
  const type = safeStr(job?.payload?.type, "").toLowerCase();
  const actor = safeStr(job?.actor, "").toLowerCase();
  const role = safeStr(job?.role, "").toLowerCase();
  return (
    source.includes("operator") ||
    source.includes("manual") ||
    source.includes("ui_manual") ||
    type.includes("manual_staff_reply") ||
    actor === "human" ||
    role === "operator"
  );
}

function logEvent(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: nowIso(), event, ...data }));
}

async function recordHumanHandoffEvent(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  channel: string;
  messagePreview: string;
}) {
  try {
    const payload = {
      organization_id: args.organizationId,
      lead_id: args.leadId,
      event_type: "human_handoff_requested",
      payload: {
        channel: args.channel || null,
        message_preview: args.messagePreview.slice(0, 240),
        created_at: nowIso(),
      },
    };
    for (const table of ["pipeline_events", "demo_events"]) {
      const res = await args.supabase.from(table).insert(payload);
      if (!res?.error) {
        logEvent("human_handoff_event_recorded", {
          organization_id: args.organizationId,
          lead_id: args.leadId,
          channel: args.channel || null,
          table,
        });
        return true;
      }
      logEvent("human_handoff_event_table_unavailable", {
        organization_id: args.organizationId,
        lead_id: args.leadId,
        table,
        reason: res.error.message,
      });
    }
    logEvent("human_handoff_event_not_recorded", {
      organization_id: args.organizationId,
      lead_id: args.leadId,
      reason: "no_supported_event_table",
    });
    return false;
  } catch (error) {
    logEvent("human_handoff_event_not_recorded", {
      organization_id: args.organizationId,
      lead_id: args.leadId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
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
    .select(
      "id, reason, title, patient_name, appointment_date, appointment_time, starts_at, status, provider_id, provider_name",
    )
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

function isFutureActiveAppointmentForTimezone(
  appointment: Record<string, unknown>,
  timezone: string,
  now = new Date(),
): boolean {
  const startsAt = safeStr(appointment.starts_at, "").trim();
  const startsAtMs = Date.parse(startsAt);
  if (Number.isFinite(startsAtMs)) {
    return startsAtMs > now.getTime();
  }

  const appointmentDate = safeStr(appointment.appointment_date, "").trim();
  const appointmentTime = safeStr(appointment.appointment_time, "").trim();
  if (!appointmentDate) return false;

  const today = now.toLocaleDateString("en-CA", { timeZone: timezone });
  if (appointmentDate > today) return true;
  if (appointmentDate < today) return false;

  const currentTime = now.toLocaleTimeString("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return Boolean(appointmentTime) && appointmentTime > currentTime;
}

function barbershopAppointmentConflictButtons(): InteractiveButton[] {
  return [
    { id: "reschedule_booking", title: "Cambiar mi cita" },
    { id: "additional_booking", title: "Agendar otra cita" },
    { id: "keep_existing_booking", title: "Mantener mi cita" },
  ];
}

function formatBarbershopAppointmentConflictReply(
  appointment: Record<string, unknown>,
): string {
  const date = safeStr(
    appointment.appointment_date,
    safeStr(appointment.starts_at, "").slice(0, 10),
  );
  const time = safeStr(
    appointment.appointment_time,
    safeStr(appointment.starts_at, "").slice(11, 16),
  );
  return `Ya tenés una cita confirmada para ${
    formatRequestedDayLabel(date)
  } a las ${formatHourLabel(time)} 💈\n\n¿Qué querés hacer?`;
}

async function loadFutureActiveAppointmentsForLead(args: {
  supabase: SupabaseClientType;
  organizationId: string;
  leadId: string;
  timezone?: string;
}): Promise<Array<Record<string, unknown>>> {
  const timezone = safeStr(args.timezone, DEFAULT_TIMEZONE).trim() ||
    DEFAULT_TIMEZONE;
  const todayInTimezone = new Date().toLocaleDateString("en-CA", {
    timeZone: timezone,
  });
  const res = await args.supabase
    .from("appointments")
    .select(
      "id, reason, title, patient_name, appointment_date, appointment_time, starts_at, status, provider_id, provider_name",
    )
    .eq("organization_id", args.organizationId)
    .eq("lead_id", args.leadId)
    .in("status", ["pending", "confirmed"])
    .gte("appointment_date", todayInTimezone)
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true })
    .limit(25);
  if (res.error || !Array.isArray(res.data)) return [];
  return (res.data as Array<Record<string, unknown>>)
    .filter((appointment) =>
      isFutureActiveAppointmentForTimezone(appointment, timezone)
    )
    .sort((a, b) => {
      const aStarts = safeStr(
        a.starts_at,
        `${safeStr(a.appointment_date, "")}T${
          safeStr(a.appointment_time, "")
        }:00`,
      );
      const bStarts = safeStr(
        b.starts_at,
        `${safeStr(b.appointment_date, "")}T${
          safeStr(b.appointment_time, "")
        }:00`,
      );
      return aStarts.localeCompare(bStarts);
    });
}

function shouldRunBarbershopPreconfirmGate(args: {
  reply: string;
  statePatch: Json;
}): boolean {
  const { reply, statePatch } = args;
  const replyNorm = normalizeTextForMatch(reply);
  const stage = safeStr((statePatch as any)?.stage, "");
  const nextExpected = safeStr((statePatch as any)?.nextExpected, "");
  const collected = ((statePatch as any)?.collected ?? {}) as Record<
    string,
    unknown
  >;
  const pending = (collected.pending_booking ?? null) as
    | Record<string, unknown>
    | null;
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
  const collected = ((statePatch as any)?.collected ?? {}) as Record<
    string,
    unknown
  >;
  const pending =
    ((collected.pending_booking ?? null) as Record<string, unknown> | null) ??
      {};
  const service = safeStr(
    pending.service,
    safeStr(
      collected.service,
      safeStr(pending.reason, safeStr(collected.reason, "")),
    ),
  );
  const appointmentDate = safeStr(
    pending.appointment_date,
    safeStr(collected.preferred_date, safeStr(collected.appointment_date, "")),
  );
  const appointmentTime = safeStr(
    pending.appointment_time,
    safeStr(collected.preferred_time, safeStr(collected.appointment_time, "")),
  );
  const providerId = safeStr(
    pending.provider_id,
    safeStr(collected.provider_id, ""),
  );
  const providerName = safeStr(
    pending.provider_name,
    safeStr(
      pending.preferred_barber,
      safeStr(collected.provider_name, safeStr(collected.preferred_barber, "")),
    ),
  );
  return {
    service,
    appointmentDate,
    appointmentTime,
    providerId,
    providerName,
  };
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
  if (
    !shouldRunBarbershopPreconfirmGate({
      reply: inputReply,
      statePatch: inputStatePatch,
    })
  ) {
    return { reply: inputReply, statePatch: inputStatePatch, blocked: false };
  }

  const requested = extractRequestedPreconfirmData(inputStatePatch);
  if (
    !requested.appointmentDate || !requested.appointmentTime ||
    !requested.service
  ) {
    return { reply: inputReply, statePatch: inputStatePatch, blocked: false };
  }
  const inputCollected = ((inputStatePatch as any)?.collected ?? {}) as Record<
    string,
    unknown
  >;
  const allowAdditionalBooking = Boolean(
    inputCollected.allow_additional_booking,
  );
  const requestedPatientName = toDisplayPersonName(
    safeStr(inputCollected.patient_name, ""),
  );

  const activeAppointments = await loadFutureActiveAppointmentsForLead({
    supabase,
    organizationId,
    leadId,
    timezone,
  });
  const requestedServiceNorm = normalizeTextForMatch(
    toPatientFacingServiceLabel(requested.service),
  );
  const exactDuplicate = activeAppointments.find((appt) => {
    const apptDate = safeStr(
      appt.appointment_date,
      safeStr(appt.starts_at, "").slice(0, 10),
    );
    const apptTime = safeStr(
      appt.appointment_time,
      safeStr(appt.starts_at, "").slice(11, 16),
    );
    const apptService = normalizeTextForMatch(
      toPatientFacingServiceLabel(
        safeStr(appt.reason, safeStr(appt.title, "")),
      ),
    );
    const appointmentPatientName = toDisplayPersonName(
      safeStr(appt.patient_name, ""),
    );
    const hasDifferentPatient = Boolean(
      allowAdditionalBooking &&
        requestedPatientName &&
        appointmentPatientName &&
        requestedPatientName.toLowerCase() !==
          appointmentPatientName.toLowerCase(),
    );
    if (hasDifferentPatient) return false;
    return apptDate === requested.appointmentDate &&
      apptTime === requested.appointmentTime &&
      apptService === requestedServiceNorm;
  });
  const sameDayActive = allowAdditionalBooking
    ? undefined
    : activeAppointments.find((appt) => {
      const apptDate = safeStr(
        appt.appointment_date,
        safeStr(appt.starts_at, "").slice(0, 10),
      );
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
      safeStr(
        exactDuplicate.reason,
        safeStr(exactDuplicate.title, requested.service),
      ),
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
      reply: formatBarbershopAppointmentConflictReply({
        appointment_date: duplicateDate,
        appointment_time: duplicateTime,
      }),
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
            starts_at: safeStr(
              exactDuplicate.starts_at,
              `${duplicateDate}T${duplicateTime}:00`,
            ),
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
      safeStr(
        sameDayActive.reason,
        safeStr(sameDayActive.title, requested.service),
      ),
    );
    const activeTime = safeStr(
      sameDayActive.appointment_time,
      safeStr(sameDayActive.starts_at, "").slice(11, 16),
    ) || requested.appointmentTime;
    return {
      reply: formatBarbershopAppointmentConflictReply({
        appointment_date: activeDate,
        appointment_time: activeTime,
      }),
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
            starts_at: safeStr(
              sameDayActive.starts_at,
              `${activeDate}T${activeTime}:00`,
            ),
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
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: timezone }),
  );
  return Number.isNaN(d.valueOf()) ? new Date() : d;
}

function sameDayBookingAllowed(
  clinicSettings: Record<string, unknown>,
): boolean {
  const timezone = safeStr(clinicSettings.timezone, DEFAULT_TIMEZONE).trim() ||
    DEFAULT_TIMEZONE;
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
    timezone: safeStr(clinicSettings.timezone, DEFAULT_TIMEZONE).trim() ||
      DEFAULT_TIMEZONE,
    sameDayBookingCutoff: safeStr(
      clinicSettings.same_day_booking_cutoff,
      DEFAULT_SAME_DAY_BOOKING_CUTOFF,
    ).trim() || DEFAULT_SAME_DAY_BOOKING_CUTOFF,
    bufferMin: Math.max(
      0,
      Number(clinicSettings.buffer_min) || DEFAULT_BUFFER_MIN,
    ),
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

function formatRelativeDayLabel(dateIso: string, timezone: string): string {
  if (!dateIso) return "ese día";
  const localNow = nowInTimezone(timezone);
  const todayIso = localNow.toISOString().slice(0, 10);
  const tomorrow = new Date(localNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  const absolute = formatRequestedDayLabel(dateIso);
  if (dateIso === todayIso) return `hoy ${absolute}`;
  if (dateIso === tomorrowIso) return `mañana ${absolute}`;
  return absolute;
}

function isAmbiguousBarbershopServiceRequest(input: string): boolean {
  const t = normalizeTextForMatch(input);
  if (!t) return false;
  const mentionsCorte = /\b(corte|cortarme|cortarme|pelo|cabello)\b/.test(t);
  const hasSpecific = /\b(corte clasico|clasico|corte \+ barba|barba|cejas)\b/
    .test(t);
  return mentionsCorte && !hasSpecific;
}

function formatAppointmentStatus(
  statusRaw: string,
): "confirmada" | "pendiente" {
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
  brandName?: string,
): string {
  return formatBookingSuccessCopy({
    booking: booking ?? null,
    fallback: BOOKING_SUCCESS_REPLY,
    businessType,
    preferredBarberFallback,
    brandName,
  });
}

function inferBotMessageType(reply: string, statePatch: Json): string {
  const explicit = safeStr((statePatch as any)?.last_bot_message_type, "")
    .trim();
  if (explicit) return explicit;
  const nextExpected = safeStr((statePatch as any)?.nextExpected, "");
  if (nextExpected === "confirm_booking") return "confirm_booking_prompt";
  if (nextExpected === "date_time") return "ask_date_time";
  if (reply.includes("¿")) return "question";
  return "info";
}

function shouldSkipGenericContinuationSuffix(
  reply: string,
  statePatch?: Json | null,
): boolean {
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

function preventRepeatedReplyLoop(
  reply: string,
  leadState: Json | null,
  statePatch?: Json | null,
): string {
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

function isBarbershopRuntime(
  leadState: Json | null,
  clinicSettings: Record<string, unknown>,
): boolean {
  const leadType = safeStr(
    (leadState as any)?.orgType,
    safeStr((leadState as any)?.business_type, ""),
  )
    .toLowerCase();
  const clinicType = safeStr(clinicSettings?.business_type, "").toLowerCase();
  return leadType === "barbershop" || clinicType === "barbershop";
}

function parseBarbershopTimePreference(
  text: string,
): "morning" | "afternoon" | "evening" | undefined {
  const n = normalizeTextForMatch(text);
  if (
    /\b(temprano|en la manana|en la mañana|manana temprano|por la manana|por la mañana)\b/
      .test(n)
  ) return "morning";
  if (
    /\b(en la tarde|en latarde|latarde|tarde|mas tarde|más tarde|por la tarde)\b/
      .test(n)
  ) return "afternoon";
  if (/\b(noche|en la noche|tipo 7|tipo 8|tipo 9|7 pm|8 pm|9 pm)\b/.test(n)) {
    return "evening";
  }
  return undefined;
}

function detectActiveBookingTimeBlockFollowup(
  text: string,
): "morning" | "afternoon" | undefined {
  const n = normalizeTextForMatch(text).replace(/\s+/g, " ").trim();
  if (/\b(en la manana|en la mañana|por la manana|por la mañana)\b/.test(n)) {
    return "morning";
  }
  if (
    /\b(en la tarde|en latarde|por la tarde|mas tarde|más tarde|latarde|tarde)\b/
      .test(n)
  ) return "afternoon";
  return undefined;
}

function formatTimeBlockLabel(block: "morning" | "afternoon"): string {
  return block === "morning" ? "la mañana" : "la tarde";
}

function mapAvailabilityReasonToReply(reason?: string): string {
  if (reason === "past_time") return "Esa hora ya pasó.";
  if (reason === "closed_day" || reason === "outside_hours") {
    return "A esa hora no estamos atendiendo.";
  }
  if (reason === "overlap") return "Ese horario ya está ocupado.";
  return "Ese horario no está disponible.";
}

function formatBarbershopSlotOption(
  slot: { date?: string | null; time?: string | null },
): string {
  const date = safeStr(slot.date, "");
  const time = safeStr(slot.time, "");
  if (!date || !time) return "";
  const day = formatRequestedDayLabel(date);
  return `${day} a las ${formatHourLabel(time)}`;
}

function formatBarbershopSlotOptionWithProvider(slot: {
  date?: string | null;
  time?: string | null;
  provider_name?: string | null;
}): string {
  const base = formatBarbershopSlotOption(slot);
  const providerName = safeStr(slot.provider_name, "").trim();
  if (!base) return "";
  return providerName
    ? `${formatHourLabel(safeStr(slot.time, ""))} con ${providerName}`
    : base;
}

function formatAtHourLabel(timeLabel: string): string {
  return /^1:/.test(safeStr(timeLabel, "").trim())
    ? `a la ${timeLabel}`
    : `a las ${timeLabel}`;
}

function buildCompactAvailabilityMessage(args: {
  requestedDate: string;
  slots: Array<
    {
      date?: string | null;
      time?: string | null;
      provider_name?: string | null;
    }
  >;
  reasonPrefix?: string;
}): { text: string; quickOptions: string[]; listOptions: string[] } {
  const dayLabel = formatRequestedDayLabel(args.requestedDate);
  const slots = args.slots
    .filter((slot) =>
      safeStr(slot.date, "").trim() && safeStr(slot.time, "").trim()
    )
    .slice(0, 12);
  const quickOptions = slots.slice(0, 3).map((slot) =>
    formatHourLabel(safeStr(slot.time, ""))
  );
  const listOptions = slots.slice(3).map((slot) =>
    formatHourLabel(safeStr(slot.time, ""))
  );
  const distinctProviders = [
    ...new Set(
      slots.map((slot) => safeStr(slot.provider_name, "").trim()).filter(
        Boolean,
      ),
    ),
  ];
  const reasonPrefix = safeStr(args.reasonPrefix, "").trim();
  const header = reasonPrefix ? `${reasonPrefix}\n\n` : "";
  if (distinctProviders.length === 1) {
    return {
      text: `${header}Próximo disponible:\n${dayLabel}\nBarbero: ${
        distinctProviders[0]
      }\n\n${quickOptions.join(" · ")}\n\n¿Cuál te queda mejor?`,
      quickOptions,
      listOptions,
    };
  }
  const lines = slots.slice(0, 3).map((slot) =>
    `${formatHourLabel(safeStr(slot.time, ""))} · ${
      safeStr(slot.provider_name, "Barbero")
    }`
  );
  return {
    text: `${header}Disponible ${dayLabel}:\n\n${
      lines.join("\n")
    }\n\n¿Cuál te queda mejor?`,
    quickOptions,
    listOptions,
  };
}

function slotHourFromTime(time: string): number {
  const [hRaw] = safeStr(time, "").split(":");
  const h = Number(hRaw);
  return Number.isFinite(h) ? h : -1;
}

function hasMixedDayParts(slots: Array<{ time?: string | null }>): boolean {
  let hasMorning = false;
  let hasAfternoon = false;
  for (const slot of slots) {
    const hour = slotHourFromTime(safeStr(slot.time, ""));
    if (hour >= 0 && hour < 12) hasMorning = true;
    if (hour >= 12) hasAfternoon = true;
    if (hasMorning && hasAfternoon) return true;
  }
  return false;
}

function pickRecommendedBarbershopSlots<T extends { time?: string | null }>(
  slots: T[],
  maxSlots = 5,
): T[] {
  if (slots.length <= maxSlots) return slots;
  const indexes = new Set<number>();
  indexes.add(0);
  indexes.add(slots.length - 1);
  indexes.add(Math.floor(slots.length * 0.25));
  indexes.add(Math.floor(slots.length * 0.5));
  indexes.add(Math.floor(slots.length * 0.75));
  const ordered = [...indexes]
    .filter((idx) => idx >= 0 && idx < slots.length)
    .sort((a, b) => a - b)
    .map((idx) => slots[idx]);
  return ordered.slice(0, maxSlots);
}

function inferBarberProviderSelection(
  preferredBarberRaw: string,
  barbers: Array<Record<string, unknown>>,
): {
  providerPreference: "specific" | "any";
  providerId?: string;
  providerName?: string;
} {
  const preferred = safeStr(preferredBarberRaw, "").trim();
  if (!preferred) return { providerPreference: "any" };
  const normalized = normalizeTextForMatch(preferred);
  if (
    /\b(cualquiera|con cualquiera|el que este disponible|el que esté disponible|no importa)\b/
      .test(normalized)
  ) {
    return { providerPreference: "any" };
  }
  const match = barbers.find((barber) => {
    const name = normalizeTextForMatch(safeStr(barber.name, ""));
    const alias = normalizeTextForMatch(safeStr((barber as any).alias, ""));
    return normalized === name || normalized === alias ||
      name.includes(normalized);
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
  return patchCollectedName || patchCollectedNameAlt || patchName || leadName ||
    stateName || "";
}

function isReliableBarbershopCustomerName(rawName: string): boolean {
  const name = toDisplayPersonName(rawName);
  if (!name) return false;
  const normalized = normalizeTextForMatch(name);
  if (
    /^(usuario|sin nombre|cliente|lead|contacto|whatsapp|messenger|facebook|instagram|premium|barberia|barbería|page|pagina|página)$/i
      .test(normalized)
  ) {
    return false;
  }
  if (/^\+?\d[\d\s-]{5,}$/.test(name)) return false;
  if (!/[a-záéíóúñ]/i.test(name)) return false;
  return name.length >= 3;
}

function resolveReliableBarbershopCustomerName(
  leadState: Json | null,
  collected: Record<string, unknown>,
): string {
  const candidates = [
    safeStr(collected.patient_name, ""),
    safeStr(collected.customer_name, ""),
    safeStr(collected.client_name, ""),
    resolveLeadFullName(leadState, { collected } as Json),
  ];
  for (const candidate of candidates) {
    if (isReliableBarbershopCustomerName(candidate)) {
      return toDisplayPersonName(candidate);
    }
  }
  return "";
}

function formatBarbershopConfirmationSummary(
  pendingBooking: Record<string, unknown>,
  customerName = "",
): string {
  const service = safeStr(
    pendingBooking.service_name,
    safeStr(pendingBooking.service, "Servicio"),
  );
  const provider = safeStr(pendingBooking.provider_name, "Barbero");
  const date = formatRequestedDayLabel(
    safeStr(pendingBooking.appointment_date, ""),
  );
  const time = formatHourLabel(safeStr(pendingBooking.appointment_time, ""));
  const nameLine = customerName ? `\nNombre: *${customerName}*` : "";
  return `Perfecto 💈\n\nServicio: *${service}*\nBarbero: *${provider}*\nFecha: *${date}*\nHora: *${time}*${nameLine}\n\n¿Confirmamos?`;
}

function buildBookingRetryPatch(
  leadState: Json | null,
  currentStatePatch?: Json | null,
): Json {
  const leadCollected =
    leadState && typeof (leadState as any).collected === "object"
      ? { ...((leadState as any).collected as Record<string, unknown>) }
      : {};
  const patchCollected = currentStatePatch &&
      typeof (currentStatePatch as any).collected === "object"
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
      .select(
        "id, name, description, duration_min, price, is_active, sort_order",
      )
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
      .select(
        "id, name, category, description, price, image_url, stock_status, is_active",
      )
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
    .in("status", ["queued", "pending"])
    .order("created_at", { ascending: true })
    .limit(Math.max(args.limit * 5, args.limit));

  if (candidateRes.error) {
    return { data: null, error: candidateRes.error };
  }

  const ids = (candidateRes.data ?? [])
    .filter((r: any) => {
      const payload = (r?.payload ?? {}) as Record<string, unknown>;
      const source = safeStr(payload.source, "").toLowerCase();
      const type = safeStr(payload.type, "").toLowerCase();
      return source === "ui_manual" ||
        source === "manual_staff_reply" ||
        type === "manual_staff_reply";
    })
    .slice(0, args.limit)
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
    .in("status", ["queued", "pending"])
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

function buildInteractiveButtonsForState(
  statePatch: Json,
): InteractiveButton[] {
  const nextExpected = safeStr((statePatch as any)?.nextExpected, "");
  const collected = ((statePatch as any)?.collected ?? {}) as Record<
    string,
    unknown
  >;
  const pending = (collected.pending_booking ?? null) as
    | Record<string, unknown>
    | null;
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
}): Promise<
  { reply?: string; statePatch?: Json; booking?: BookingActionResult }
> {
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
    const toolPayload = {
      ...((toolCall?.payload ?? {}) as Record<string, unknown>),
    };
    if (!toolName) continue;

    try {
      if (toolName === "book_appointment") {
        const collectedForTool =
          ((leadState as any)?.collected ?? {}) as Record<string, unknown>;
        const currentFlow = (collectedForTool as any).current_flow;
        const allowAdditionalBooking = Boolean(
          (collectedForTool as any).allow_additional_booking ||
            currentFlow?.type === "additional_booking" ||
            currentFlow?.allow_active_appointment_bypass === true,
        );
        if (allowAdditionalBooking) {
          delete toolPayload.appointment_id;
          delete toolPayload.active_appointment_id;
          delete toolPayload.pending_reschedule;
        }
      }
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
              (((combinedStatePatch as any)?.collected ?? {}) as any)
                ?.preferred_barber,
              safeStr(
                (((leadState as any)?.collected ?? {}) as any)
                  ?.preferred_barber,
                "",
              ),
            ),
          );
          finalReply = formatBookingSuccessReply(
            result.booking,
            safeStr(
              (leadState as any)?.orgType,
              safeStr((leadState as any)?.business_type, ""),
            ),
            preferredBarberFallback,
            safeStr(
              (toolPayload as any)?.brand_name,
              safeStr((toolPayload as any)?.business_name, ""),
            ),
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
                  safeStr(
                    (result.booking.appointment as any).provider_name,
                    "",
                  ),
                ),
                starts_at: safeStr(
                  result.booking.appointment.starts_at,
                  `${
                    safeStr(result.booking.appointment.appointment_date, "")
                  }T${
                    safeStr(
                      result.booking.appointment.appointment_time,
                      "00:00",
                    )
                  }:00`,
                ),
                status: "confirmed",
              },
              collected: {
                ...(((combinedStatePatch as any)?.collected ?? {}) as Record<
                  string,
                  unknown
                >),
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
            result.booking.error,
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

  return {
    reply: finalReply,
    statePatch: combinedStatePatch,
    booking: bookingResult,
  };
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
  let fallbackInteractiveButtons: InteractiveButton[] | undefined;
  let fallbackDebugNote: string | undefined;
  const inboundLower = normalizeTextForMatch(inboundText);
  const leadCollected = ((leadState as any)?.collected ?? {}) as Record<
    string,
    unknown
  >;
  const pendingBooking = (((leadState as any)?.pending_booking ??
    (leadCollected as any)?.pending_booking) ?? null) as
      | Record<string, unknown>
      | null;

  const isAppointmentLookupQuestion =
    /\b(tengo cita|tengo cita hoy|que cita tengo|qué cita tengo|que cita teng|q cita tengo|ke cita tengo|k cita tengo|a que hora es mi cita|a qué hora es mi cita|para cuando es mi cita|para cuándo es mi cita|me puede confirmar mi cita|confirmame mi cita|cual es mi cita|cuál es mi cita|cuando tengo cita|cuándo tengo cita|me podes recordar mi cita|me pod[eé]s recordar mi cita|me podes recordar cual es la cita que tengo|me pod[eé]s recordar cual es la cita que tengo|para que fecha quedo mi cita|para qué fecha quedó mi cita|en que fecha quedo mi cita|en qué fecha quedó mi cita|cuando quedo mi cita|cuándo quedó mi cita|para cuando quedo|para cuándo quedó|como quedo mi cita|cómo quedó mi cita|quedo mi cita|quedo agendada mi cita|en que quedo mi cita|en qué quedó mi cita|a que hora quedo mi cita|a qué hora quedó mi cita|para que dia quedo mi cita|para qué día quedó mi cita|que dia quedo mi cita|qué día quedó mi cita|necesito saber si tengo cita|me dejaste la cita|me borraste la cita|para que es mi cita|para qué es mi cita)\b/i
      .test(inboundLower);
  if (
    isAppointmentLookupQuestion ||
    fallbackReply === "__CHECK_ACTIVE_APPOINTMENT__"
  ) {
    const isBarbershopConversation = isBarbershopRuntime(
      leadState,
      clinicSettings,
    );
    const dentalAppointments = isBarbershopConversation
      ? []
      : await loadFutureActiveAppointmentsForLead({
        supabase,
        organizationId,
        leadId,
        timezone: safeStr((clinicSettings as any)?.timezone, DEFAULT_TIMEZONE),
      });
    if (!isBarbershopConversation && dentalAppointments.length > 1) {
      return buildDentalMultipleAppointmentsReviewResult({
        appointments: dentalAppointments,
        collected: {
          ...leadCollected,
          ...(((fallbackStatePatch as any)?.collected ?? {}) as Record<
            string,
            unknown
          >),
        },
        brandName: getDentalBrandName(clinicSettings, null),
      });
    }
    const apptRes = isBarbershopConversation
      ? await supabase
        .from("appointments")
        .select(
          "id, reason, title, patient_name, appointment_date, appointment_time, starts_at, status, provider_id, provider_name",
        )
        .eq("organization_id", organizationId)
        .eq("lead_id", leadId)
        .in("status", ["pending", "confirmed"])
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(1)
        .maybeSingle()
      : { error: null, data: dentalAppointments[0] ?? null };
    if (!apptRes.error && apptRes.data?.id) {
      const appt = apptRes.data as Record<string, unknown>;
      const service = toPatientFacingServiceLabel(
        safeStr(appt.reason, safeStr(appt.title, "Revisión dental")),
      );
      const date = safeStr(
        appt.appointment_date,
        safeStr(appt.starts_at, "").slice(0, 10),
      );
      const humanDate = formatRequestedDayLabel(date);
      const time = safeStr(
        appt.appointment_time,
        safeStr(appt.starts_at, "").slice(11, 16),
      );
      const statusLabel = formatAppointmentStatus(
        safeStr(appt.status, "confirmed"),
      );
      const providerName = safeStr(appt.provider_name, "").trim();
      const patientName = toDisplayPersonName(safeStr(appt.patient_name, ""));
      const leadFullName = toDisplayPersonName(
        resolveLeadFullName(leadState, fallbackStatePatch),
      );
      const hasThirdPartyPatient = Boolean(
        patientName && (!leadFullName || patientName !== leadFullName),
      );
      const asksBrackets = /\b(brackets|frenillos?|ortodoncia)\b/i.test(
        inboundText,
      );
      if (isBarbershopConversation) {
        const providerLine = providerName ? ` con ${providerName}` : "";
        fallbackReply = `Tu cita actual es el ${humanDate} a las ${
          formatHourLabel(time)
        } para ${service}${providerLine}.\n\n¿Querés cancelarla o reagendarla?`;
      } else if (
        asksBrackets &&
        !/ortodoncia|bracket/.test(normalizeTextForMatch(service))
      ) {
        fallbackReply = `Veo una cita confirmada hoy a las ${
          formatHourLabel(time)
        }, pero está registrada como ${service}, no brackets. ¿Querés que la cambiemos a una revisión de ortodoncia / brackets?`;
      } else if (hasThirdPartyPatient) {
        fallbackReply =
          `Tenés una cita para ${patientName} ${statusLabel} para ${service} el ${humanDate} a las ${
            formatHourLabel(time)
          }.\n\n¿Querés revisarla, cambiarla o cancelarla?`;
      } else {
        fallbackReply =
          `Tenés una cita ${statusLabel} para ${service} el ${humanDate} a las ${
            formatHourLabel(time)
          }.\n\n¿Querés revisarla, cambiarla o cancelarla?`;
      }
    } else {
      fallbackReply =
        "No encontré una cita vigente a tu nombre.\n\nSi querés, puedo ayudarte a revisar horarios disponibles para agendar una.";
    }
    if (!apptRes.error && apptRes.data?.id) {
      const appt = apptRes.data as Record<string, unknown>;
      const date = safeStr(
        appt.appointment_date,
        safeStr(appt.starts_at, "").slice(0, 10),
      );
      const time = safeStr(
        appt.appointment_time,
        safeStr(appt.starts_at, "").slice(11, 16),
      );
      const service = toPatientFacingServiceLabel(
        safeStr(appt.reason, safeStr(appt.title, "Cita")),
      );
      const activeAppointment = isBarbershopConversation
        ? {
          id: safeStr(appt.id, ""),
          reason: service,
          appointment_date: date,
          appointment_time: time,
          starts_at: safeStr(appt.starts_at, `${date}T${time}:00`),
          status: safeStr(appt.status, "confirmed"),
          provider_id: safeStr(appt.provider_id, "") || null,
          provider_name: safeStr(appt.provider_name, "") || null,
        }
        : buildDentalActiveAppointmentState(
          appt,
          "Revisión dental",
          getDentalBrandName(clinicSettings, null),
        );
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        stage: "BOOKING",
        nextExpected: "active_appointment_intent_choice",
        collected: {
          ...(((fallbackStatePatch as any)?.collected ?? {}) as Record<
            string,
            unknown
          >),
          active_appointment: activeAppointment,
        },
      });
    }
    return {
      reply: fallbackReply,
      statePatch: fallbackStatePatch,
      leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
      debugNote: "engine",
      bookingSuccessAuthorized: false,
      interactiveButtons:
        !apptRes.error && apptRes.data?.id && !isBarbershopConversation
          ? dentalAppointmentReviewButtons()
          : undefined,
    };
  }

  if (fallbackReply === "__CHECK_ACTIVE_APPOINTMENT_FOR_CANCEL__") {
    const isBarbershopConversation =
      safeStr((leadState as any)?.orgType, "").toLowerCase() === "barbershop";
    const timezone =
      safeStr(clinicSettings?.timezone, DEFAULT_TIMEZONE).trim() ||
      DEFAULT_TIMEZONE;
    const todayInTimezone = new Date().toLocaleDateString("en-CA", {
      timeZone: timezone,
    });
    const activeRes = await supabase
      .from("appointments")
      .select(
        "id, reason, title, patient_name, appointment_date, appointment_time, starts_at, status, provider_id, provider_name",
      )
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
          safeStr(
            pendingBooking.service,
            isBarbershopConversation ? "Cita" : "Revisión dental",
          ),
        );
        const pDate = safeStr(
          pendingBooking.offered_date,
          safeStr(pendingBooking.requested_date, ""),
        );
        const pTime = safeStr(
          pendingBooking.offered_time,
          safeStr(pendingBooking.requested_time, ""),
        );
        fallbackReply =
          `Todavía no habíamos confirmado la cita, así que no hay nada que cancelar. La opción del ${pDate} a las ${
            formatHourLabel(pTime)
          } quedó solo como pendiente. ¿Querés que la descarte o buscamos otro horario?`;
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          pending_booking: {
            ...pendingBooking,
            service: pService,
            status: "pending_confirmation",
          },
        });
      } else {
        fallbackReply = isBarbershopConversation
          ? "No encontré una cita vigente para cancelar. ¿Querés agendar una nueva?"
          : "No encontré una cita vigente a tu nombre.";
      }
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        nextExpected: undefined,
      });
    } else {
      const date = safeStr(
        appt.appointment_date,
        safeStr(appt.starts_at, "").slice(0, 10),
      );
      const humanDate = formatRequestedDayLabel(date);
      const time = safeStr(
        appt.appointment_time,
        safeStr(appt.starts_at, "").slice(11, 16),
      );
      const service = toPatientFacingServiceLabel(
        safeStr(
          appt.reason,
          safeStr(
            appt.title,
            isBarbershopConversation ? "Cita" : "Revisión dental",
          ),
        ),
      );
      const providerName = safeStr(appt.provider_name, "").trim();
      const providerLine = providerName ? ` con ${providerName}` : "";
      const appointmentPatientName = toDisplayPersonName(
        safeStr(appt.patient_name, ""),
      );
      const leadDisplayName = toDisplayPersonName(
        resolveLeadFullName(leadState),
      );
      const isThirdPartyAppointment = Boolean(
        appointmentPatientName &&
          leadDisplayName &&
          appointmentPatientName.toLowerCase() !==
            leadDisplayName.toLowerCase(),
      );
      fallbackReply = isBarbershopConversation
        ? `¿Confirmás que querés cancelar tu cita del ${humanDate} ${
          formatAtHourLabel(formatHourLabel(time))
        }?`
        : (isThirdPartyAppointment
          ? `Encontré la cita de ${appointmentPatientName} para ${service} el ${humanDate} a las ${
            formatHourLabel(time)
          }.\n\n¿Confirmás que querés cancelarla?`
          : `Encontré tu cita para ${service} el ${humanDate} a las ${
            formatHourLabel(time)
          }.\n\n¿Confirmás que querés cancelarla?`);
      const pendingCancelAppointment = {
        appointment_id: safeStr(appt.id, ""),
        service,
        appointment_date: date,
        appointment_time: time,
        starts_at: safeStr(appt.starts_at, `${date}T${time}:00`),
        status: "pending_confirmation",
        provider_id: safeStr(appt.provider_id, "") || null,
        provider_name: providerName || null,
      };
      if (isBarbershopConversation) {
        console.log(JSON.stringify({
          event: "cancel_confirmation_requested",
          appointment_id: pendingCancelAppointment.appointment_id || null,
        }));
      }
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        stage: "BOOKING",
        nextExpected: "confirm_cancel_appointment",
        collected: {
          ...(((fallbackStatePatch as any)?.collected ?? {}) as Record<
            string,
            unknown
          >),
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
          pending_cancel: pendingCancelAppointment,
          pending_cancel_appointment: pendingCancelAppointment,
          pending_booking: null,
          pending_booking_stale: true,
        },
        pending_booking: null,
      });
    }
  }

  if (fallbackReply === "__CHECK_ACTIVE_APPOINTMENT_FOR_RESCHEDULE__") {
    const isBarbershopConversation =
      safeStr((leadState as any)?.orgType, "").toLowerCase() === "barbershop";
    const isDentalConversation = organizationId === "clinic-demo" ||
      safeStr((leadState as any)?.orgType, "").toLowerCase() === "dental" ||
      !isBarbershopRuntime(leadState, clinicSettings);
    const preCollected = (fallbackStatePatch?.collected ?? {}) as Record<
      string,
      unknown
    >;
    const preRescheduleDate = safeStr(preCollected.reschedule_date, "");
    const preRescheduleTime = safeStr(preCollected.reschedule_time, "");
    const preRescheduleFromMessage = Boolean(
      preCollected.reschedule_from_message,
    );
    const activeRes = await supabase
      .from("appointments")
      .select(
        "id, appointment_date, appointment_time, starts_at, reason, title, status, provider_id, provider_name",
      )
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .in("status", ["pending", "confirmed"])
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (activeRes.error) {
      fallbackReply = "No pude verificar tu cita en este momento.";
    } else {
      const appt = activeRes.data as Record<string, unknown> | null;
      if (!appt?.id) {
        if (pendingBooking) {
          const pService = toPatientFacingServiceLabel(
            safeStr(pendingBooking.service, "Revisión dental"),
          );
          const pDate = safeStr(
            pendingBooking.offered_date,
            safeStr(pendingBooking.requested_date, ""),
          );
          const pTime = safeStr(
            pendingBooking.offered_time,
            safeStr(pendingBooking.requested_time, ""),
          );
          fallbackReply =
            `Claro. Todavía no estaba confirmada; solo teníamos pendiente ${pDate} a las ${
              formatHourLabel(pTime)
            } para ${pService}. ¿Qué día u hora preferís revisar?`;
        } else {
          fallbackReply = isBarbershopConversation
            ? "Por ahora no veo una cita futura para reagendar. ¿Querés agendar una nueva?"
            : "No encontré una cita vigente con este contacto.";
        }
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          nextExpected: undefined,
        });
      } else {
        const date = safeStr(
          appt.appointment_date,
          safeStr(appt.starts_at, "").slice(0, 10),
        );
        const humanDate = formatRequestedDayLabel(date);
        const time = safeStr(
          appt.appointment_time,
          safeStr(appt.starts_at, "").slice(11, 16),
        );
        const service = toPatientFacingServiceLabel(
          safeStr(
            appt.reason,
            safeStr(
              appt.title,
              isBarbershopConversation ? "Cita barbería" : "Consulta general",
            ),
          ),
        );
        const activeAppointmentState = isDentalConversation
          ? buildDentalActiveAppointmentState(
            {
              ...appt,
              appointment_date: date,
              appointment_time: time,
              reason: service,
            },
            service,
            getDentalBrandName(clinicSettings, null),
          )
          : {
            id: safeStr(appt.id, ""),
            appointment_date: date,
            appointment_time: time,
            starts_at: safeStr(appt.starts_at, `${date}T${time}:00`),
            reason: service,
            provider_id: safeStr(appt.provider_id, "") || null,
            provider_name: safeStr(appt.provider_name, "") || null,
          };
        const pendingRescheduleCurrent = {
          appointment_id: safeStr(appt.id, ""),
          service,
          current_date: date,
          current_time: time,
          current_starts_at: safeStr(appt.starts_at, `${date}T${time}:00`),
          provider_id: safeStr(activeAppointmentState.provider_id, "") || null,
          provider_name: safeStr(activeAppointmentState.provider_name, "") ||
            null,
          status: preRescheduleDate && preRescheduleTime
            ? "pending_availability_check"
            : "awaiting_new_datetime",
          ...(preRescheduleDate ? { requested_date: preRescheduleDate } : {}),
          ...(preRescheduleTime ? { requested_time: preRescheduleTime } : {}),
        };
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          active_flow: "reschedule",
          collected: {
            active_appointment: activeAppointmentState,
            service,
            pending_reschedule: pendingRescheduleCurrent,
          },
        });
        if (
          preRescheduleDate && preRescheduleTime && preRescheduleFromMessage
        ) {
          fallbackReply = "__CHECK_RESCHEDULE_AVAILABILITY__";
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            nextExpected: "confirm_reschedule_appointment",
          });
        } else {
          if (isBarbershopConversation) {
            console.log(JSON.stringify({
              event: "reschedule_requested",
              appointment_id: pendingRescheduleCurrent.appointment_id || null,
            }));
          }
          if (isDentalConversation) {
            fallbackReply =
              `Claro 🦷 ¿Qué querés cambiar de tu cita?\n\nServicio: *${service}*\nFecha actual: *${humanDate}*\nHora actual: *${
                formatHourLabel(time)
              }*`;
          } else {
            fallbackReply = isBarbershopConversation
              ? `Claro, te ayudo a reagendar tu cita de ${service} del ${humanDate} a las ${
                formatHourLabel(time)
              }.\n\n¿Qué nuevo día y hora te interesa?`
              : `Encontré tu cita actual para ${humanDate} a las ${
                formatHourLabel(time)
              }. Decime el nuevo día y hora que querés revisar.`;
          }
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            nextExpected: isBarbershopConversation
              ? "reschedule_new_datetime"
              : "reschedule_datetime",
          });
          if (isDentalConversation) {
            fallbackInteractiveButtons = dentalRescheduleChoiceButtons();
            fallbackDebugNote = "dental_guided_reschedule_prompt_from_fallback";
          }
        }
      }
    }
  }

  if (fallbackReply === "__CHECK_RESCHEDULE_AVAILABILITY__") {
    const collected = (fallbackStatePatch?.collected ?? {}) as Record<
      string,
      unknown
    >;
    const requestedDate = safeStr(collected.reschedule_date, "");
    const requestedTime = safeStr(collected.reschedule_time, "");
    const activeAppointment =
      (collected.active_appointment as Record<string, unknown> | undefined) ??
        {};
    const activeStartsAt = safeStr(
      activeAppointment.starts_at,
      `${safeStr(activeAppointment.appointment_date, "")}T${
        safeStr(activeAppointment.appointment_time, "")
      }:00`,
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
        const requestedSlot = slots.find((slot) =>
          slot.date === requestedDate && slot.time === requestedTime
        ) as Record<string, unknown> | undefined;
        const providerName = safeStr(
          requestedSlot?.provider_name,
          safeStr(requestedSlot?.barber_name, ""),
        );
        const requestedStartsAt = `${requestedDate}T${requestedTime}:00`;
        if (
          activeStartsAt &&
          activeStartsAt.slice(0, 16) === requestedStartsAt.slice(0, 16)
        ) {
          const currentDateLabel = new Date(requestedStartsAt)
            .toLocaleDateString("es-HN", {
              weekday: "long",
              day: "numeric",
              month: "long",
            });
          const currentTimeLabel = new Date(requestedStartsAt)
            .toLocaleTimeString("es-HN", {
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
          const dateOnlyLabel = new Date(`${requestedDate}T${requestedTime}:00`)
            .toLocaleDateString("es-HN", {
              weekday: "long",
              day: "numeric",
              month: "long",
            });
          const timeOnlyLabel = new Date(`${requestedDate}T${requestedTime}:00`)
            .toLocaleTimeString("es-HN", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
          const providerCopy = providerName ? ` con ${providerName}` : "";
          console.log(JSON.stringify({
            event: "reschedule_confirmation_requested",
            appointment_id:
              safeStr((collected.active_appointment as any)?.id, "") || null,
            requested_date: requestedDate,
            requested_time: requestedTime,
            provider_name: providerName || null,
          }));
          fallbackReply =
            `Perfecto 💈\n\nVamos a cambiar tu cita a:\nServicio: ${requestedService}\nBarbero: ${
              providerName || "cualquiera disponible"
            }\nFecha: ${dateOnlyLabel}\nHora: ${timeOnlyLabel}\n\n¿Confirmamos el cambio?`;
          const pendingRescheduleTarget = {
            appointment_id: safeStr(
              (collected.active_appointment as any)?.id,
              "",
            ),
            service: requestedService,
            current_starts_at: safeStr(
              (collected.active_appointment as any)?.starts_at,
              `${
                safeStr(
                  (collected.active_appointment as any)?.appointment_date,
                  "",
                )
              }T${
                safeStr(
                  (collected.active_appointment as any)?.appointment_time,
                  "00:00",
                )
              }:00`,
            ),
            requested_date: requestedDate,
            requested_time: requestedTime,
            new_starts_at: `${requestedDate}T${requestedTime}:00`,
            provider_id: safeStr(requestedSlot?.provider_id, ""),
            provider_name: providerName || null,
            duration_min: Number(requestedSlot?.duration_min ?? 60) || 60,
            provider_copy: providerCopy || null,
            status: "pending_confirmation",
          };
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            nextExpected: "confirm_reschedule_appointment",
            pending_reschedule: pendingRescheduleTarget,
            collected: {
              ...collected,
              pending_reschedule: pendingRescheduleTarget,
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
          fallbackReply = `Ese horario no está disponible. Te ofrezco ${
            alternatives.map((s) => `${s.dayLabel} a las ${s.time}`).join(" o ")
          }. ¿Cuál preferís?`;
        } else {
          fallbackReply =
            "Ese horario no está disponible y no encontré espacios cercanos ahora mismo.";
        }
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          nextExpected: "reschedule_datetime",
        });
      }
    } else {
      fallbackReply =
        "No tengo horarios configurados para reagendar en este momento.";
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        nextExpected: "reschedule_datetime",
      });
    }
  }

  if (fallbackReply === "__CHECK_REQUESTED_AVAILABILITY__") {
    if (isBarbershopRuntime(leadState, clinicSettings)) {
      const settingsHealth = getBarbershopSettingsHealth(clinicSettings);
      logEvent("barbershop:settings_guard", {
        organization_id: organizationId,
        settings_source: (clinicSettings as any).__settings_source ?? "unknown",
        providers_count: settingsHealth.providersCount,
        services_count: settingsHealth.servicesCount,
        hours_open_days_count: settingsHealth.hoursOpenDaysCount,
      });
      if (!settingsHealth.hasServices) {
        fallbackReply =
          "Por ahora no tengo servicios activos configurados para esta barbería.";
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "service",
          collected: {
            ...((fallbackStatePatch?.collected ?? {}) as Record<
              string,
              unknown
            >),
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
      if (!settingsHealth.hasProviders) {
        fallbackReply =
          "Todavía no hay barberos configurados para tomar citas.";
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "service",
          collected: {
            ...((fallbackStatePatch?.collected ?? {}) as Record<
              string,
              unknown
            >),
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
      if (!settingsHealth.hasOpenDays) {
        fallbackReply =
          "Por ahora no tengo horarios activos configurados para esta barbería.";
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "date_time",
          collected: {
            ...((fallbackStatePatch?.collected ?? {}) as Record<
              string,
              unknown
            >),
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
      const preconfirmSourceInboundMessageId = safeStr(
        (leadState as any)?.__inbound_message_id,
        "",
      ).trim();
      const preconfirmSentAt = nowIso();
      const collected = (fallbackStatePatch?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const selectedSlotFromState = ((collected as any).selected_slot ??
        (collected as any)?.pending_booking?.selected_slot ?? null) as
          | Record<string, unknown>
          | null;
      const requestedDate = safeStr(
        selectedSlotFromState?.date,
        safeStr(collected.preferred_date, ""),
      );
      const requestedTime = safeStr(
        selectedSlotFromState?.time,
        safeStr(collected.preferred_time, ""),
      );
      const preferredBarber = safeStr(
        selectedSlotFromState?.provider_name,
        safeStr(collected.preferred_barber, ""),
      );
      const providerSelection = inferBarberProviderSelection(
        preferredBarber,
        (Array.isArray((clinicSettings as any)?.barbers)
          ? (clinicSettings as any).barbers
          : []) as Array<
            Record<string, unknown>
          >,
      );
      const serviceName = safeStr(
        selectedSlotFromState?.service_name,
        safeStr(collected.service, "Cita barbería"),
      );

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

      const hoursObj =
        (clinicSettings?.hours && typeof clinicSettings.hours === "object")
          ? (clinicSettings.hours as Record<string, unknown>)
          : null;
      if (isDateClosedInHours(requestedDate, hoursObj)) {
        logEvent("closed_day_detected_before_availability", {
          organization_id: organizationId,
          lead_id: leadId,
          requested_date: requestedDate,
          service: serviceName,
        });
        const addDays = (dateIso: string, days: number) => {
          const d = new Date(`${dateIso}T12:00:00`);
          d.setDate(d.getDate() + days);
          return d.toISOString().slice(0, 10);
        };
        const nextSlots = await suggestNextAvailableSlots({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_name: serviceName,
          provider_id: providerSelection.providerId,
          provider_preference: providerSelection.providerPreference,
          date_from: addDays(requestedDate, 1),
          date_to: addDays(requestedDate, 8),
          timezone: safeStr(clinicSettings?.timezone, DEFAULT_TIMEZONE),
          max_options: 9,
        });
        const validNextSlots = nextSlots.filter((slot) =>
          safeStr((slot as any).provider_id, "").trim() &&
          safeStr((slot as any).provider_name, "").trim()
        );
        const firstDate = safeStr(validNextSlots[0]?.date, "");
        const shown = validNextSlots.filter((slot) =>
          safeStr(slot.date, "") === firstDate
        ).slice(0, 3);
        const closedLabel = formatRelativeDayLabel(
          requestedDate,
          safeStr(clinicSettings?.timezone, DEFAULT_TIMEZONE),
        );
        const closedSentence = `${closedLabel.charAt(0).toUpperCase()}${
          closedLabel.slice(1)
        } no estamos atendiendo.`;
        if (shown.length > 0) {
          logEvent("closed_day_next_open_options_offered", {
            organization_id: organizationId,
            lead_id: leadId,
            requested_date: requestedDate,
            next_open_date: firstDate,
            options_count: shown.length,
          });
          const lines = shown
            .map((slot) =>
              `${formatHourLabel(safeStr(slot.time, ""))} · ${
                safeStr(slot.provider_name, "Barbero")
              }`
            )
            .join("\n");
          fallbackReply = `${closedSentence}\n\nTe puedo ofrecer el ${
            formatRequestedDayLabel(firstDate)
          }:\n${lines}\n\n¿Cuál te queda mejor?`;
        } else {
          fallbackReply =
            `${closedSentence}\n\n¿Querés que te revise otro día?`;
        }
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: shown.length > 0
            ? "availability_slot_selection"
            : "date_time",
          collected: {
            ...(collected as Record<string, unknown>),
            activeBookingFlow: true,
            lastBookingStep: "select_time",
            current_service_name: serviceName,
            current_date: firstDate || requestedDate,
            preferred_date: firstDate || requestedDate,
            pending_booking: null,
            pending_booking_stale: true,
            last_offered_slots: shown.map((slot) =>
              toBarbershopOfferedSlot(
                slot as Record<string, unknown>,
                null,
                serviceName,
                "exact_alternative",
              )
            ),
            last_availability_slots: shown.map((slot) => ({
              date: slot.date,
              time: slot.time,
              provider_id: slot.provider_id ?? null,
              provider_name: slot.provider_name ?? null,
            })),
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
      const allowAdditionalBooking = Boolean(
        (collected as any)?.allow_additional_booking,
      );
      const requestedPatientName = toDisplayPersonName(
        safeStr((collected as any)?.patient_name, ""),
      );
      const normalizedRequestedService = normalizeTextForMatch(serviceName);
      const activeFutureAppointment = allowAdditionalBooking
        ? null
        : (futureAppointments[0] ?? null);
      if (activeFutureAppointment) {
        const activeDate = safeStr(
          activeFutureAppointment.appointment_date,
          safeStr(activeFutureAppointment.starts_at, "").slice(0, 10),
        );
        const activeTime = safeStr(
          activeFutureAppointment.appointment_time,
          safeStr(activeFutureAppointment.starts_at, "").slice(11, 16),
        );
        const activeService = toPatientFacingServiceLabel(
          safeStr(
            activeFutureAppointment.reason,
            safeStr(activeFutureAppointment.title, serviceName || "Cita"),
          ),
        );
        const activeProviderName = safeStr(
          activeFutureAppointment.provider_name,
          "",
        ).trim();
        const providerPatch = activeProviderName
          ? { provider_name: activeProviderName }
          : {};
        logEvent("active_appointment_guard_triggered", {
          organization_id: organizationId,
          lead_id: leadId,
          active_appointment_id: safeStr(activeFutureAppointment.id, ""),
          requested_date: requestedDate,
          requested_time: requestedTime,
        });
        fallbackReply = formatBarbershopAppointmentConflictReply({
          appointment_date: activeDate,
          appointment_time: activeTime,
        });
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "active_appointment_intent_choice",
          collected: {
            ...(collected as Record<string, unknown>),
            pending_booking: null,
            pending_booking_stale: true,
            active_appointment: {
              id: safeStr(activeFutureAppointment.id, ""),
              reason: activeService,
              appointment_date: activeDate,
              appointment_time: activeTime,
              starts_at: safeStr(
                activeFutureAppointment.starts_at,
                `${activeDate}T${activeTime}:00`,
              ),
              status: safeStr(activeFutureAppointment.status, "confirmed"),
              provider_id: safeStr(activeFutureAppointment.provider_id, "") ||
                null,
              ...providerPatch,
            },
          },
        });
        return {
          reply: fallbackReply,
          statePatch: fallbackStatePatch,
          leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
          debugNote: "engine",
          bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
          interactiveButtons: barbershopAppointmentConflictButtons(),
        };
      }
      const exactDuplicate = futureAppointments.find((appt) => {
        const apptDate = safeStr(
          appt.appointment_date,
          safeStr(appt.starts_at, "").slice(0, 10),
        );
        const apptTime = safeStr(
          appt.appointment_time,
          safeStr(appt.starts_at, "").slice(11, 16),
        );
        const apptPatientName = toDisplayPersonName(
          safeStr(appt.patient_name, ""),
        );
        const hasDifferentPatient = Boolean(
          allowAdditionalBooking &&
            requestedPatientName &&
            apptPatientName &&
            requestedPatientName.toLowerCase() !==
              apptPatientName.toLowerCase(),
        );
        if (hasDifferentPatient) return false;
        const apptService = normalizeTextForMatch(
          toPatientFacingServiceLabel(
            safeStr(appt.reason, safeStr(appt.title, "")),
          ),
        );
        return apptDate === requestedDate && apptTime === requestedTime &&
          apptService === normalizedRequestedService;
      });
      if (exactDuplicate) {
        fallbackReply = formatBarbershopAppointmentConflictReply({
          appointment_date: requestedDate,
          appointment_time: requestedTime,
        });
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
          interactiveButtons: barbershopAppointmentConflictButtons(),
        };
      }
      const sameDayActive = allowAdditionalBooking
        ? undefined
        : futureAppointments.find((appt) => {
          const apptDate = safeStr(
            appt.appointment_date,
            safeStr(appt.starts_at, "").slice(0, 10),
          );
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
        fallbackReply = formatBarbershopAppointmentConflictReply({
          appointment_date: requestedDate,
          appointment_time: activeTime,
        });
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
              starts_at: safeStr(
                sameDayActive.starts_at,
                `${requestedDate}T${activeTime}:00`,
              ),
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
          interactiveButtons: barbershopAppointmentConflictButtons(),
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
      logEvent("booking_requested_exact_time", {
        organization_id: organizationId,
        lead_id: leadId,
        requested_date: requestedDate,
        requested_time: requestedTime,
        service: serviceName,
      });

      if (exact.available) {
        logEvent("booking_exact_time_available", {
          organization_id: organizationId,
          lead_id: leadId,
          requested_date: requestedDate,
          requested_time: requestedTime,
          provider_id: safeStr(exact.slot?.provider_id, ""),
          provider_name: safeStr(exact.slot?.provider_name, ""),
        });
        const dateOnly = formatRequestedDayLabel(requestedDate);
        const firstName =
          safeStr(resolveLeadFullName(leadState, fallbackStatePatch), "").split(
            /\s+/,
          )[0] ?? "";
        fallbackReply = `Perfecto${
          firstName ? ` ${firstName}` : ""
        }. ${dateOnly} a las ${formatHourLabel(requestedTime)} está disponible${
          serviceName ? ` para ${serviceName}` : ""
        }. ¿Confirmamos?`;
        const autoAssignedProviderName = safeStr(exact.slot?.provider_name, "")
          .trim();
        const resolvedProviderName =
          providerSelection.providerPreference === "specific"
            ? (providerSelection.providerName || preferredBarber || null)
            : (autoAssignedProviderName || null);
        const resolvedProviderId =
          providerSelection.providerPreference === "specific"
            ? (providerSelection.providerId || null)
            : (safeStr(exact.slot?.provider_id, "") || null);
        if (!resolvedProviderName || !resolvedProviderId) {
          const alternatives = Array.isArray(exact.alternatives)
            ? exact.alternatives.slice(0, 3)
            : [];
          const options = alternatives
            .map((slot) => formatBarbershopSlotOptionWithProvider(slot))
            .filter(Boolean)
            .join(" · ");
          fallbackReply = options
            ? `Esta hora no está libre, pero tengo: ${options}\n¿Cuál te queda mejor?`
            : "No pude asignar un barbero para esa hora. Te reviso otro horario enseguida.";
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            stage: "BOOKING",
            nextExpected: "date_time",
            collected: {
              ...(collected as Record<string, unknown>),
              pending_booking_stale: true,
              pending_booking: null,
              last_bot_step: "barbershop_missing_provider_assignment",
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
        const providerLine = ` con ${resolvedProviderName}`;
        fallbackReply = `Sí, tengo ${dateOnly.toLowerCase()} a las ${
          formatHourLabel(requestedTime)
        }${providerLine}${
          serviceName ? ` para ${serviceName}` : ""
        }. ¿Confirmamos?`;
        const selectedSlotForHold = selectedSlotFromState ?? {
          service_key: safeStr((collected as any).current_service_key, ""),
          service_name: serviceName,
          date: requestedDate,
          time: requestedTime,
          starts_at: safeStr(
            exact.slot?.starts_at,
            `${requestedDate}T${requestedTime}:00`,
          ),
          provider_id: resolvedProviderId,
          provider_name: resolvedProviderName,
          duration_min: Number((exact.slot as any)?.duration_min ?? 30) || 30,
          source: "availability_check",
        };
        const holdResult = await holdSelectedBarbershopSlot({
          supabase,
          organizationId,
          leadId,
          timezone: safeStr(clinicSettings?.timezone, DEFAULT_TIMEZONE),
          selectedSlot: selectedSlotForHold,
          serviceName,
        });
        if (!holdResult.ok) {
          const alternatives = (holdResult.alternatives ?? []).slice(0, 3);
          const altLines = alternatives
            .map((slot) =>
              `${formatHourLabel(safeStr(slot.time, ""))} · ${
                safeStr(slot.provider_name, "Barbero")
              }`
            )
            .filter(Boolean)
            .join("\n");
          fallbackReply = holdResult.reason === "active_hold_conflict"
            ? `Ese espacio está siendo reservado en este momento.${
              altLines
                ? `\n\nTengo estas opciones cercanas:\n${altLines}\n¿Cuál te queda mejor?`
                : "\n\n¿Querés que te muestre otros horarios?"
            }`
            : `Ese horario ya no está disponible.${
              altLines
                ? `\n\nTengo estas opciones cercanas:\n${altLines}\n¿Cuál te queda mejor?`
                : "\n\n¿Querés que te muestre otros horarios?"
            }`;
          fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
            stage: "BOOKING",
            nextExpected: "availability_slot_selection",
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
        const heldSelectedSlot = holdResult.selected_slot;
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "CONFIRMING",
          nextExpected: "confirm_booking",
          collected: {
            ...(collected as Record<string, unknown>),
            service: serviceName,
            preferred_date: requestedDate,
            preferred_time: requestedTime,
            activeBookingFlow: true,
            lastBookingStep: "confirm_booking",
            current_service_key: safeStr(
              heldSelectedSlot.service_key,
              safeStr((collected as any).current_service_key, ""),
            ),
            current_service_name: serviceName,
            current_date: requestedDate,
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
              selected_slot: heldSelectedSlot,
              hold_id: safeStr(heldSelectedSlot.hold_id, ""),
              status: "pending_confirmation",
              created_from_inbound_message_id:
                preconfirmSourceInboundMessageId || null,
              preconfirm_sent_at: preconfirmSentAt,
              service_source: safeStr(collected.service_source, "explicit"),
            },
            pending_booking_created_from_inbound_message_id:
              preconfirmSourceInboundMessageId || null,
            pending_booking_preconfirm_sent_at: preconfirmSentAt,
          },
        });
      } else {
        logEvent("booking_exact_time_unavailable", {
          organization_id: organizationId,
          lead_id: leadId,
          requested_date: requestedDate,
          requested_time: requestedTime,
          reason: safeStr(exact.reason, ""),
        });
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
            const altProviderName = safeStr(
              anyProviderAtSameSlot.slot?.provider_name,
              "",
            ).trim();
            const altProviderId = safeStr(
              anyProviderAtSameSlot.slot?.provider_id,
              "",
            ).trim();
            const normalizedPreferred = normalizeTextForMatch(preferredBarber);
            const normalizedAlt = normalizeTextForMatch(altProviderName);
            const sameProvider = Boolean(
              (providerSelection.providerId && altProviderId &&
                providerSelection.providerId === altProviderId) ||
                (normalizedPreferred && normalizedAlt &&
                  normalizedPreferred === normalizedAlt),
            );
            if (sameProvider) {
              logEvent("booking_contradictory_provider_copy_prevented", {
                organization_id: organizationId,
                lead_id: leadId,
                preferred_barber: preferredBarber,
                provider_id: altProviderId,
              });
              const firstName =
                safeStr(resolveLeadFullName(leadState, fallbackStatePatch), "")
                  .split(/\s+/)[0] ?? "";
              fallbackReply = `Perfecto${firstName ? ` ${firstName}` : ""}. ${
                formatRequestedDayLabel(requestedDate)
              } a las ${formatHourLabel(requestedTime)} está disponible con ${
                altProviderName || preferredBarber
              }${serviceName ? ` para ${serviceName}` : ""}. ¿Confirmamos?`;
            } else {
              logEvent("booking_provider_same_time_alternative", {
                organization_id: organizationId,
                lead_id: leadId,
                requested_provider: preferredBarber,
                alternative_provider: altProviderName || null,
              });
              fallbackReply = altProviderName
                ? `A esa hora ${preferredBarber} no está disponible, pero ${altProviderName} sí tiene espacio. ¿Confirmamos con ${altProviderName}?`
                : `${preferredBarber} no está disponible a esa hora, pero sí tengo otro barbero en ese mismo horario. ¿Confirmamos?`;
            }
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
                provider_id:
                  safeStr(anyProviderAtSameSlot.slot?.provider_id, "") || null,
                pending_booking_stale: false,
                last_bot_step: "barbershop_preconfirm",
                pending_booking: {
                  service: serviceName,
                  appointment_date: requestedDate,
                  appointment_time: requestedTime,
                  preferred_barber: altProviderName || null,
                  provider_name: altProviderName || null,
                  provider_id:
                    safeStr(anyProviderAtSameSlot.slot?.provider_id, "") ||
                    null,
                  status: "pending_confirmation",
                  created_from_inbound_message_id:
                    preconfirmSourceInboundMessageId || null,
                  preconfirm_sent_at: preconfirmSentAt,
                  service_source: safeStr(collected.service_source, "explicit"),
                },
                pending_booking_created_from_inbound_message_id:
                  preconfirmSourceInboundMessageId || null,
                pending_booking_preconfirm_sent_at: preconfirmSentAt,
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
        const alternatives = Array.isArray(exact.alternatives)
          ? exact.alternatives.slice(0, 3)
          : [];
        const baseReason = mapAvailabilityReasonToReply(exact.reason);
        if (alternatives.length > 0) {
          logEvent("booking_nearest_alternatives_found", {
            organization_id: organizationId,
            lead_id: leadId,
            requested_date: requestedDate,
            requested_time: requestedTime,
            alternatives_count: alternatives.length,
          });
          const options = alternatives
            .map((slot) => formatBarbershopSlotOptionWithProvider(slot))
            .filter(Boolean)
            .join(" · ");
          fallbackReply = options
            ? `${baseReason}, pero tengo: ${options}\n¿Cuál te queda mejor?`
            : `${baseReason} Te puedo revisar otro horario para hoy o mañana.`;
        } else {
          logEvent("booking_no_provider_available_nearest_offered", {
            organization_id: organizationId,
            lead_id: leadId,
            requested_date: requestedDate,
            requested_time: requestedTime,
          });
          fallbackReply =
            `${baseReason} Te puedo revisar otro horario para hoy o mañana.`;
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

    const collected = (fallbackStatePatch?.collected ?? {}) as Record<
      string,
      unknown
    >;
    let requestedDate = safeStr(collected.preferred_date, "");
    const requestedTime = safeStr(collected.preferred_time, "");
    const weekdayMatch = normalizeTextForMatch(inboundText).match(
      /\b(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/,
    );
    if (weekdayMatch && requestedDate) {
      const map: Record<string, number> = {
        domingo: 0,
        lunes: 1,
        martes: 2,
        miercoles: 3,
        miércoles: 3,
        jueves: 4,
        viernes: 5,
        sabado: 6,
        sábado: 6,
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
      fallbackReply =
        `Perfecto 👍 ¿Para qué día te gustaría a las ${requestedTime}?`;
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
      ? new Date(`${requestedDate}T${requestedTime}:00`).toLocaleDateString(
        "es-HN",
        {
          weekday: "long",
          day: "numeric",
          month: "long",
        },
      ) +
        `, ${
          new Date(`${requestedDate}T${requestedTime}:00`).toLocaleTimeString(
            "es-HN",
            {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            },
          )
        }`
      : `${requestedDate} ${requestedTime}`.trim();
    const firstName = safeStr(
      (leadState as any)?.full_name || collected.full_name ||
        (leadState as any)?.name,
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
        const relation = safeStr(
          (collected as any)?.appointment_for_relation,
          "",
        ).trim().toLowerCase();
        const isThirdPartyAppointment = Boolean(
          patientName && relation && relation !== "self",
        );
        const dateOnly = requestedDate
          ? new Date(`${requestedDate}T00:00:00`).toLocaleDateString("es-HN", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
          : dateLabel;
        fallbackReply = isThirdPartyAppointment
          ? `Perfecto, la cita sería para ${patientName}.\n\n${dateOnly} a las ${
            formatHourLabel(requestedTime)
          } está disponible para ${requestedService}.\n\n¿Confirmamos la cita?`
          : `Perfecto, ${firstName || "te"}. ${dateOnly} a las ${
            formatHourLabel(requestedTime)
          } está disponible para ${requestedService}.\n\n¿Confirmamos la cita?`;
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
          fallbackReply = `Para ${
            formatRequestedDayLabel(requestedDate)
          } a las ${
            formatHourLabel(requestedTime)
          } no tengo disponibilidad. Lo más cercano que encontré es ${near.dayLabel} a las ${
            formatHourLabel(near.time)
          }. ¿Te funciona?`;
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
          nextExpected: alternatives.length > 0
            ? "confirm_offered_slot"
            : "date_time",
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
      const settingsHealth = getBarbershopSettingsHealth(clinicSettings);
      if (!settingsHealth.hasServices) {
        fallbackReply =
          "Por ahora no tengo servicios activos configurados para esta barbería.";
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "service",
          collected: {
            ...((fallbackStatePatch?.collected ?? {}) as Record<
              string,
              unknown
            >),
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
      if (!settingsHealth.hasProviders) {
        fallbackReply =
          "Todavía no hay barberos configurados para tomar citas.";
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "service",
          collected: {
            ...((fallbackStatePatch?.collected ?? {}) as Record<
              string,
              unknown
            >),
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
      if (!settingsHealth.hasOpenDays) {
        fallbackReply =
          "Por ahora no tengo horarios activos configurados para esta barbería.";
        fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
          stage: "BOOKING",
          nextExpected: "date_time",
          collected: {
            ...((fallbackStatePatch?.collected ?? {}) as Record<
              string,
              unknown
            >),
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
      const collected = (fallbackStatePatch?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const requestedDate = safeStr(collected.preferred_date, "");
      const serviceName = safeStr(collected.service, "Cita barbería");
      const preferredBarber = safeStr(collected.preferred_barber, "");
      const providerSelection = inferBarberProviderSelection(
        preferredBarber,
        (Array.isArray((clinicSettings as any)?.barbers)
          ? (clinicSettings as any).barbers
          : []) as Array<
            Record<string, unknown>
          >,
      );
      const timePreference = parseBarbershopTimePreference(
        safeStr(
          collected.time_preference,
          safeStr((engineResult as any)?.replyText, ""),
        ) || inboundText,
      );
      if (timePreference) {
        logEvent("availability_time_block_detected", {
          organization_id: organizationId,
          lead_id: leadId,
          block: timePreference,
          requested_date: requestedDate || null,
        });
      }

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
          max_options: 40,
        });
        let slots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_name: serviceName,
          provider_id: providerSelection.providerId,
          provider_preference: providerSelection.providerPreference,
          date: requestedDate,
          time_preference: timePreference,
          timezone: safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
          max_options: 40,
        });
        const localToday = nowInTimezone(
          safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
        ).toISOString().slice(0, 10);
        const localNow = nowInTimezone(
          safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
        );
        const nowMinutes = localNow.getHours() * 60 + localNow.getMinutes();
        if (requestedDate === localToday) {
          const beforeCount = slots.length;
          slots = slots.filter((slot) => {
            const time = safeStr(slot.time, "");
            const m = time.match(/^(\d{1,2}):(\d{2})$/);
            if (!m) return false;
            const slotMin = Number(m[1]) * 60 + Number(m[2]);
            return slotMin > nowMinutes;
          });
          logEvent("availability_today_filters_past_slots", {
            organization_id: organizationId,
            lead_id: leadId,
            requested_date: requestedDate,
            before_count: beforeCount,
            after_count: slots.length,
          });
        }
        const validProviderSlots = slots.filter((slot) =>
          safeStr((slot as any).provider_id, "").trim() &&
          safeStr((slot as any).provider_name, "").trim()
        );
        const uniqueSlotsByTime = validProviderSlots.filter((slot, idx, arr) =>
          arr.findIndex((candidate) =>
            safeStr(candidate.time, "") === safeStr(slot.time, "")
          ) === idx
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
        const pageSize = 3;
        const requestedOffsetRaw = Number(
          (collected as any).availability_shown_offset ?? 0,
        );
        const requestedOffset = Number.isFinite(requestedOffsetRaw)
          ? Math.max(
            0,
            Math.min(uniqueSlotsByTime.length, Math.floor(requestedOffsetRaw)),
          )
          : 0;
        const shownUniqueSlots = uniqueSlotsByTime.slice(
          requestedOffset,
          requestedOffset + pageSize,
        );
        const hasLaterSlotsForRequestedDay =
          uniqueSlotsByTime.length > requestedOffset + shownUniqueSlots.length;
        if (uniqueSlotsByTime.length > 0) {
          const label = formatRequestedDayLabel(requestedDate);
          const compactTimes = shownUniqueSlots.map((slot) =>
            formatHourLabel(safeStr(slot.time, ""))
          ).join(" · ");
          const nearestSlot = uniqueSlotsByTime[0];
          const nearestTimeLabel = formatHourLabel(
            safeStr(nearestSlot?.time, ""),
          );
          const sameAsNearest = shownUniqueSlots.some((slot) =>
            safeStr(slot.time, "") === safeStr(nearestSlot?.time, "")
          );
          const otherSlots = shownUniqueSlots
            .filter((slot) =>
              !sameAsNearest ||
              safeStr(slot.time, "") !== safeStr(nearestSlot?.time, "")
            )
            .map((slot) => formatHourLabel(safeStr(slot.time, "")))
            .join(" · ");
          const laterSlotsHint = hasLaterSlotsForRequestedDay
            ? "\n\nTambién tengo espacios más tarde. Podés decirme otra hora."
            : "";
          if (requestedDate === localToday && nearestTimeLabel) {
            fallbackReply =
              `El espacio más cercano para ${serviceName} es ${label.toLowerCase()} a las ${nearestTimeLabel}.\n\nTambién tengo:\n${
                otherSlots || compactTimes
              }\n\n¿Querés la de ${nearestTimeLabel} o preferís otra hora?${laterSlotsHint}`;
          } else {
            const compact = buildCompactAvailabilityMessage({
              requestedDate,
              slots: shownUniqueSlots as Array<Record<string, unknown>>,
            });
            fallbackReply = `${compact.text}${
              laterSlotsHint || "\n\nSi querés otra hora, decímela y reviso."
            }`;
            fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
              collected: {
                ...((fallbackStatePatch?.collected ?? collected) as Record<
                  string,
                  unknown
                >),
                availability_quick_options: compact.quickOptions,
                availability_list_options: compact.listOptions,
              },
            });
          }
          const availabilityContext = {
            service: serviceName,
            date: requestedDate,
            provider_preference: providerSelection.providerPreference,
            provider_name: providerSelection.providerName,
            preferred_barber: providerSelection.providerName,
            shown_offset: requestedOffset,
            page_size: pageSize,
            slots: uniqueSlotsByTime.map((slot) => ({
              date: slot.date ?? null,
              time: slot.time,
              starts_at: safeStr(
                (slot as any).starts_at,
                slot.date && slot.time ? `${slot.date}T${slot.time}:00` : "",
              ),
              provider_id: slot.provider_id ?? null,
              provider_name: slot.provider_name ?? null,
              service_key: (slot as any).service_key ?? null,
              service_name: (slot as any).service_name ?? null,
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
                starts_at: safeStr(
                  (slot as any).starts_at,
                  slot.date && slot.time ? `${slot.date}T${slot.time}:00` : "",
                ),
                service_key: (slot as any).service_key ?? null,
                service_name: (slot as any).service_name ?? null,
                duration_min: Number((slot as any).duration_min ?? 30) || 30,
                source: "availability_same_day",
              })),
              last_offered_slots: shownUniqueSlots.map((slot) => ({
                date: slot.date,
                time: slot.time,
                starts_at: safeStr(
                  (slot as any).starts_at,
                  slot.date && slot.time ? `${slot.date}T${slot.time}:00` : "",
                ),
                provider_id: slot.provider_id ?? null,
                provider_name: slot.provider_name ?? null,
                service_key: (slot as any).service_key ?? null,
                duration_min: Number((slot as any).duration_min ?? 30) || 30,
                source: "availability_same_day",
              })),
              availability_shown_offset: requestedOffset,
              availability_page_size: pageSize,
              last_availability_context: availabilityContext,
              pending_booking_request: {
                service: serviceName,
                preferred_date: requestedDate,
                preferred_time: null,
                provider_name: providerSelection.providerName || null,
                provider_preference: providerSelection.providerPreference,
                patient_name: safeStr((collected as any)?.patient_name, "") ||
                  null,
                booking_for_other: Boolean(
                  (collected as any)?.booking_for_other,
                ),
                missing_fields: ["time"],
                source: "context_merge",
              },
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
            max_options: 24,
          });
          if (nextSlots.length > 0) {
            const localToday = nowInTimezone(
              safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
            ).toISOString().slice(0, 10);
            const validNextSlots = nextSlots.filter((slot) =>
              safeStr((slot as any).provider_id, "").trim() &&
              safeStr((slot as any).provider_name, "").trim()
            );
            const shownAlternatives = validNextSlots.slice(0, 3);
            const firstAlternativeDate = safeStr(
              shownAlternatives[0]?.date,
              "",
            );
            const hoursObj = (clinicSettings?.hours &&
                typeof clinicSettings.hours === "object")
              ? (clinicSettings.hours as Record<string, unknown>)
              : null;
            const requestedDayClosed = isDateClosedInHours(
              requestedDate,
              hoursObj,
            );
            const requestedDayLabel = formatRequestedDayLabel(requestedDate);
            const compact = buildCompactAvailabilityMessage({
              requestedDate: firstAlternativeDate || requestedDate,
              slots: shownAlternatives as Array<Record<string, unknown>>,
              reasonPrefix: requestedDayClosed
                ? `El ${requestedDayLabel.toLowerCase()} no estamos atendiendo.`
                : (requestedDate === localToday
                  ? "Para hoy no me quedan espacios disponibles."
                  : `Para ${requestedDayLabel.toLowerCase()} no tengo espacios disponibles.`),
            });
            fallbackReply =
              `${compact.text}\n\nSi querés otra hora, decímela y reviso.`;
            const availabilityContext = {
              service: serviceName,
              date: firstAlternativeDate || requestedDate,
              provider_preference: providerSelection.providerPreference,
              provider_name: providerSelection.providerName,
              preferred_barber: providerSelection.providerName,
              slots: validNextSlots.map((slot) => ({
                time: slot.time,
                starts_at: slot.date && slot.time
                  ? `${slot.date}T${slot.time}:00`
                  : null,
                date: slot.date ?? null,
                provider_id: slot.provider_id ?? null,
                provider_name: slot.provider_name ?? null,
                service_key: (slot as any).service_key ?? null,
                service_name: (slot as any).service_name ?? null,
              })),
            };
            console.log(JSON.stringify({
              event: "barbershop:availability_context_saved",
              service: serviceName,
              date: requestedDate,
              slots_count: nextSlots.length,
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
                  starts_at: safeStr(
                    (slot as any).starts_at,
                    slot.date && slot.time
                      ? `${slot.date}T${slot.time}:00`
                      : "",
                  ),
                  service_key: (slot as any).service_key ?? null,
                  service_name: (slot as any).service_name ?? null,
                  duration_min: Number((slot as any).duration_min ?? 30) || 30,
                  source: "availability_alternative_day",
                })),
                last_offered_slots: shownAlternatives.map((slot) => ({
                  date: slot.date,
                  time: slot.time,
                  starts_at: safeStr(
                    (slot as any).starts_at,
                    slot.date && slot.time
                      ? `${slot.date}T${slot.time}:00`
                      : "",
                  ),
                  provider_id: slot.provider_id ?? null,
                  provider_name: slot.provider_name ?? null,
                  service_key: (slot as any).service_key ?? null,
                  duration_min: Number((slot as any).duration_min ?? 30) || 30,
                  source: "availability_alternative_day",
                })),
                last_availability_context: availabilityContext,
                availability_quick_options: compact.quickOptions,
                availability_list_options: compact.listOptions,
                pending_booking_request: {
                  service: serviceName,
                  preferred_date: firstAlternativeDate || requestedDate,
                  preferred_time: null,
                  provider_name: providerSelection.providerName || null,
                  provider_preference: providerSelection.providerPreference,
                  patient_name: safeStr((collected as any)?.patient_name, "") ||
                    null,
                  booking_for_other: Boolean(
                    (collected as any)?.booking_for_other,
                  ),
                  missing_fields: ["time"],
                  source: "context_merge",
                },
                last_bot_step: "barbershop_showed_availability",
              },
            });
          } else {
            fallbackReply =
              "No encontré horarios disponibles para ese día. ¿Querés que revisemos otra fecha?";
          }
        }
      }
      const latestCollectedAfterAvailability =
        (fallbackStatePatch?.collected ?? collected) as Record<string, unknown>;
      fallbackStatePatch = mergeStatePatches(fallbackStatePatch, {
        stage: "BOOKING",
        nextExpected: availabilityContextSaved
          ? "availability_slot_selection"
          : "date_time",
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

    const collected = (fallbackStatePatch?.collected ?? {}) as Record<
      string,
      unknown
    >;
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
            `Para ${specificDayLabel.toLowerCase()} tengo disponibilidad en la mañana, entre ${
              formatHourLabel(first.time)
            } y ${formatHourLabel(last.time)}. ¿Te queda bien ${
              formatHourLabel(first.time)
            } o preferís que busque otro día?`;
        } else {
          fallbackReply =
            `Para ${specificDayLabel.toLowerCase()} tengo estos horarios:\n${
              renderedDaySlots.map((slot) => `• ${formatHourLabel(slot.time)}`)
                .join("\n")
            }\n\n¿Cuál te queda mejor?`;
        }
      } else {
        const nextSlot = slots
          .filter((s) => s.date > requestedDate)
          .sort((a, b) =>
            `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
          )[0];
        if (nextSlot) {
          const requestedDayLabel = formatRequestedDayLabel(requestedDate);
          fallbackReply =
            `No tengo espacio disponible para ${requestedDayLabel}. El más cercano que encontré es ${nextSlot.dayLabel.toLowerCase()} a las ${
              formatHourLabel(nextSlot.time)
            }.\n\n¿Te funciona ese horario o preferís otro día?`;
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
    const collected = (fallbackStatePatch?.collected ?? {}) as Record<
      string,
      unknown
    >;
    const requestedDate = safeStr(collected.preferred_date, "");
    const requestedService = toPatientFacingServiceLabel(
      safeStr(collected.service, "Revisión dental"),
    );
    const anchorTime = safeStr(
      collected.preferred_time_anchor,
      safeStr(collected.preferred_time, ""),
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
      const alternatives = anchorTime
        ? pickNearestAlternatives(daySlots, requestedDate, anchorTime)
        : daySlots.slice(0, 2);
      if (alternatives.length > 0) {
        fallbackReply =
          `Claro 👍 Te puedo ofrecer estas opciones cercanas:\n\n• ${
            formatHourLabel(alternatives[0].time)
          }${
            alternatives[1]
              ? `\n• ${formatHourLabel(alternatives[1].time)}`
              : ""
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
      const collected = (fallbackStatePatch?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const requestedDate = safeStr(collected.preferred_date, "");
      const serviceName = safeStr(collected.service, "Cita barbería");
      const preferredBarber = safeStr(collected.preferred_barber, "");
      const providerSelection = inferBarberProviderSelection(
        preferredBarber,
        (Array.isArray((clinicSettings as any)?.barbers)
          ? (clinicSettings as any).barbers
          : []) as Array<
            Record<string, unknown>
          >,
      );
      const timePreference = parseBarbershopTimePreference(inboundText);
      if (timePreference) {
        logEvent("availability_time_block_detected", {
          organization_id: organizationId,
          lead_id: leadId,
          block: timePreference,
          requested_date: requestedDate || null,
        });
      }

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
            nextSlots.map((slot) => `• ${formatBarbershopSlotOption(slot)}`)
              .join("\n")
          }\n\n¿Cuál te queda mejor?`;
        } else {
          fallbackReply =
            "Claro 🔥 ¿Para qué día querés que te revise horarios?";
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
            daySlots.slice(0, 5).map((slot) =>
              `• ${formatHourLabel(safeStr(slot.time, ""))}`
            ).join("\n")
          }\n\n¿Cuál te queda mejor?`;
        } else {
          fallbackReply =
            "No encontré horarios para ese día. ¿Querés que te revise otra fecha?";
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
        const service = toPatientFacingServiceLabel(
          safeStr(
            ((fallbackStatePatch?.collected ?? {}) as any)?.service,
            "Revisión dental",
          ),
        );
        const selection = selectPatientFriendlySlots({
          slots,
          mode: "general",
          maxOptions: 3,
        });
        const lines = selection.slots.map((slot) =>
          `• ${toLongDayLabel(slot.dayLabel)} ${formatHourLabel(slot.time)}`
        );
        fallbackReply = clampText(
          `Para ${service} tengo estas opciones:\n${
            lines.join("\n")
          }\n\n¿Cuál te queda mejor?`,
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
    const toolPayloadForExecution = {
      ...((toolAction.payload ?? {}) as Record<string, unknown>),
    };
    if (validatedToolName === "book_appointment") {
      const collectedForTool = {
        ...(((leadState as any)?.collected ?? {}) as Record<string, unknown>),
        ...(((fallbackStatePatch as any)?.collected ?? {}) as Record<
          string,
          unknown
        >),
      };
      const currentFlow = (collectedForTool as any).current_flow;
      const allowAdditionalBooking = Boolean(
        (collectedForTool as any).allow_additional_booking ||
          currentFlow?.type === "additional_booking" ||
          currentFlow?.allow_active_appointment_bypass === true,
      );
      if (allowAdditionalBooking) {
        delete toolPayloadForExecution.appointment_id;
        delete toolPayloadForExecution.active_appointment_id;
        delete toolPayloadForExecution.pending_reschedule;
      }
    }

    if (validatedToolName === "book_appointment") {
      logEvent("booking:executing_action", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        payload: toolPayloadForExecution,
      });
    }

    try {
      const toolExecution = await executeToolAction({
        supabase,
        organizationId,
        leadId,
        action: {
          name: validatedToolName,
          payload: toolPayloadForExecution,
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
            ((toolExecution.booking as any)?.appointment ?? {})
              ?.preferred_barber,
            safeStr(
              (((fallbackStatePatch as any)?.collected ?? {}) as any)
                ?.preferred_barber,
              safeStr(
                (((leadState as any)?.collected ?? {}) as any)
                  ?.preferred_barber,
                "",
              ),
            ),
          );
          fallbackReply = formatBookingSuccessReply(
            toolExecution.booking,
            safeStr(
              (leadState as any)?.orgType,
              safeStr((leadState as any)?.business_type, ""),
            ),
            preferredBarberFallback,
            getBarbershopBrandName(clinicSettings),
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
                appointment_id: safeStr(
                  toolExecution.booking.appointment.id,
                  "",
                ),
                service: safeStr(
                  toolExecution.booking.appointment.reason,
                  safeStr(
                    toolExecution.booking.appointment.title,
                    "Revisión dental",
                  ),
                ),
                preferred_barber: safeStr(
                  (toolExecution.booking.appointment as any).preferred_barber,
                  safeStr(
                    (toolExecution.booking.appointment as any).provider_name,
                    "",
                  ),
                ),
                starts_at: safeStr(
                  toolExecution.booking.appointment.starts_at,
                  `${
                    safeStr(
                      toolExecution.booking.appointment.appointment_date,
                      "",
                    )
                  }T${
                    safeStr(
                      toolExecution.booking.appointment.appointment_time,
                      "00:00",
                    )
                  }:00`,
                ),
                status: "confirmed",
              },
              collected: {
                ...(((fallbackStatePatch as any)?.collected ?? {}) as Record<
                  string,
                  unknown
                >),
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
      } else if (validatedToolName === "cancel_appointment") {
        fallbackReply =
          "No pude cancelar la cita en este momento. Intentemos de nuevo.";
      }
    }
  }

  return {
    reply: fallbackReply,
    statePatch: fallbackStatePatch,
    leadPatch: ((engineResult as any)?.leadPatch ?? {}) as Json,
    debugNote: fallbackDebugNote ??
      safeStr((engineResult as any)?.debugNote, "engine"),
    bookingSuccessAuthorized: fallbackBookingSuccessAuthorized,
    interactiveButtons: fallbackInteractiveButtons,
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
  if (
    safeStr((engineResult as any)?.replyText, "") === "__SHOW_AVAILABILITY__"
  ) {
    return true;
  }
  if ((engineResult as any)?.toolAction?.name) return true;
  const nextExpected = safeStr((leadState as any)?.nextExpected, "");
  const collected = ((leadState as any)?.collected ?? {}) as Record<
    string,
    unknown
  >;
  const lastBotText = safeStr((leadState as any)?.last_bot_text, "");
  const hasActiveBookingContext = Boolean(
    nextExpected === "availability_slot_selection" ||
      nextExpected === "booking_date" ||
      nextExpected === "availability_service" ||
      nextExpected === "date_time" ||
      nextExpected === "barber_preference" ||
      nextExpected === "confirm_booking" ||
      collected.last_availability_context ||
      collected.pending_booking_request ||
      collected.proposed_slot ||
      collected.pending_booking ||
      /\bcual te queda mejor\b/i.test(lastBotText),
  );
  if (hasActiveBookingContext) return true;
  if (safeStr((leadState as any)?.stage, "") === "BOOKING") return true;
  if (
    safeStr((leadState as any)?.nextExpected, "").startsWith("confirm_booking")
  ) {
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
  if (
    intent === "unknown" &&
    (route === "fallback" || route === "fallback_greeting")
  ) {
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
    payloadAction,
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
  const normalizedBusinessType = businessType === "barbershop"
    ? "barbershop"
    : isDentalBusinessTypeValue(businessType)
    ? "dental"
    : "generic";
  let effectivePayloadAction = payloadAction ?? null;
  const isDentalOrg = isDentalBusinessTypeValue(businessType);
  if (isDentalOrg) {
    const dentalGuardChoice = normalizeDentalGuardChoiceActionValue(
      safeStr(effectivePayloadAction, ""),
    ) || normalizeDentalGuardChoiceActionValue(inboundText);
    if (dentalGuardChoice === "additional_booking") {
      const dentalGuidedResult = await handleDentalGuidedRuntimeTurn({
        supabase,
        organizationId,
        leadId,
        inboundText,
        normalizedAction: "additional_booking",
        leadState: leadState as Json | null,
        clinicSettings,
        orgSettings,
      });
      if (dentalGuidedResult) {
        logEvent("dental_guided_runtime_route", {
          organization_id: organizationId,
          lead_id: leadId,
          debug_note: dentalGuidedResult.debugNote,
          route_order: "pre_handoff",
        });
        return dentalGuidedResult;
      }
    }
  }
  if (normalizedBusinessType === "barbershop" && !effectivePayloadAction) {
    const collected = ((leadState as any)?.collected ?? {}) as Record<
      string,
      unknown
    >;
    const timeBlock = detectActiveBookingTimeBlockFollowup(inboundText);
    const hasActiveBookingContext = Boolean(
      (collected as any).activeBookingFlow,
    );
    const hasCurrentService = Boolean(
      safeStr((collected as any).current_service_key, "") ||
        safeStr((collected as any).current_service_name, ""),
    );
    const hasCurrentDate = Boolean(
      safeStr(
        (collected as any).current_date,
        safeStr((collected as any).preferred_date, ""),
      ),
    );
    if (
      timeBlock && hasActiveBookingContext && hasCurrentService &&
      hasCurrentDate
    ) {
      effectivePayloadAction = `booking_time_block:${timeBlock}`;
      logEvent("time_block_followup_detected", {
        organization_id: organizationId,
        lead_id: leadId,
        block: timeBlock,
      });
      logEvent("time_block_followup_used_current_context", {
        organization_id: organizationId,
        lead_id: leadId,
        block: timeBlock,
        current_date: safeStr(
          (collected as any).current_date,
          safeStr((collected as any).preferred_date, ""),
        ),
        current_service_key: safeStr(
          (collected as any).current_service_key,
          "",
        ),
        current_service_name: safeStr(
          (collected as any).current_service_name,
          "",
        ),
      });
    }
  }
  const deterministicIntent = detectIntent(inboundText, {
    nextExpected: safeStr((leadState as any)?.nextExpected, "") || undefined,
  });
  const currentStage = safeStr((leadState as any)?.stage, "");
  const nextExpected = safeStr((leadState as any)?.nextExpected, "");
  const bookingLocked =
    ["BOOKING", "CONFIRMING", "BOOKED"].includes(currentStage) ||
    ["service", "date_time", "confirm_booking", "confirm_booking_suggestion"]
      .includes(nextExpected);
  const isDentalActiveAppointmentSelection =
    nextExpected === "active_appointment_selection" ||
    normalizePayloadActionValue(safeStr(effectivePayloadAction, ""))
      .startsWith("select_active_appointment:");

  if (
    !isDentalActiveAppointmentSelection &&
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
        safeStr(
          activeAppt.reason,
          safeStr(activeAppt.title, "Revisión dental"),
        ),
      );
      const date = safeStr(
        activeAppt.appointment_date,
        safeStr(activeAppt.starts_at, "").slice(0, 10),
      );
      const time = safeStr(
        activeAppt.appointment_time,
        safeStr(activeAppt.starts_at, "").slice(11, 16),
      );
      return {
        reply: `Veo que ya tenés una cita confirmada para ${service} el ${
          formatRequestedDayLabel(date)
        } a las ${
          formatHourLabel(time)
        }.\n\n¿Querés agregar esto a esa cita, buscar un horario más pronto o agendar una cita adicional?`,
        statePatch: {
          ...dentalAttemptedBookingTopLevelClearPatch(),
          stage: "BOOKING",
          lastIntent: "appointment_lookup",
          nextExpected: "active_appointment_intent_choice",
          collected: clearDentalAttemptedBookingState(
            ((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >,
            {
              activeBookingFlow: false,
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
          ),
        },
        leadPatch: {},
        debugNote: "db_active_appointment_guard",
        interactiveButtons: [
          { id: "reschedule_booking", title: "Cambiar mi cita" },
          { id: "additional_booking", title: "Agendar otra cita" },
          { id: "keep_existing_booking", title: "Mantener mi cita" },
        ],
      };
    }
  }

  // KB v2 first-pass resolution (safe, non-blocking, does not alter booking orchestration)
  if (isDentalOrg && !bookingLocked && !effectivePayloadAction) {
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
          const row = extractRpcRow(svcRes.data) as
            | Record<string, unknown>
            | null;
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
                lastIntent: deterministicIntent.intent === "pricing" ||
                    isKbPriceQuestion(inboundText)
                  ? "pricing"
                  : "service_info",
                nextExpected: "service_info_or_booking",
                collected: {
                  ...(((leadState as any)?.collected ?? {}) as Record<
                    string,
                    unknown
                  >),
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
          const found = Boolean(
            row && (row.found === true || safeStr((row as any).answer, "")),
          );
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
                safeStr(
                  (row as any).answer,
                  "Gracias por escribirnos. ¿Querés que te ayude con una cita?",
                ),
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
            (((leadState as any)?.collected ?? {}) as Record<string, unknown>)
              ?.service,
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
  const barbershopInterpreterShadowEnabled =
    normalizedBusinessType === "barbershop" &&
    isEnabledFlag(clinicSettings?.barbershop_interpreter_shadow_enabled);
  const barbershopInterpreterRuntimeEnabled =
    normalizedBusinessType === "barbershop" &&
    isEnabledFlag(clinicSettings?.barbershop_interpreter_runtime_enabled);
  const barbershopSemanticFallbackEnabled =
    normalizedBusinessType === "barbershop" &&
    !isEnabledFlag(clinicSettings?.barbershop_semantic_interpreter_disabled);
  const hasInteractivePayloadAction = Boolean(
    safeStr(effectivePayloadAction, "").trim(),
  );
  let barbershopInterpreterError: string | null = null;
  if (
    normalizedBusinessType === "barbershop" &&
    !hasInteractivePayloadAction &&
    (barbershopInterpreterShadowEnabled ||
      barbershopInterpreterRuntimeEnabled || barbershopSemanticFallbackEnabled)
  ) {
    const llmRuntime = getBarbershopInterpreterRuntimeStatus();
    console.log(JSON.stringify({
      event: barbershopSemanticFallbackEnabled &&
          !barbershopInterpreterShadowEnabled &&
          !barbershopInterpreterRuntimeEnabled
        ? "barbershop_semantic_interpreter_called"
        : "barbershop:b4_interpreter_before",
      organization_id: organizationId,
      runtime_enabled: barbershopInterpreterRuntimeEnabled,
      shadow_enabled: barbershopInterpreterShadowEnabled,
      inbound_text: inboundText,
      business_type: normalizedBusinessType,
      llm_provider: llmRuntime.provider,
      has_groq_key: llmRuntime.has_groq_key,
      has_openai_key: llmRuntime.has_openai_key,
      llm_available: llmRuntime.llm_available,
      llm_brain_enabled: llmEnabled,
      barbershop_interpreter_runtime_enabled:
        barbershopInterpreterRuntimeEnabled,
      llm_interpreter_enabled: barbershopInterpreterShadowEnabled ||
        barbershopInterpreterRuntimeEnabled,
      semantic_fallback_enabled: barbershopSemanticFallbackEnabled,
    }));
    try {
      barbershopInterpreterResult = await interpretBarbershopTurn({
        inboundText,
        timezone: safeStr(clinicSettings?.timezone, "America/Tegucigalpa"),
        clinicSettings,
        state: (leadState ?? {}) as Record<string, unknown>,
        collected: (((leadState ?? {}) as Record<string, unknown>).collected ??
          {}) as Record<string, unknown>,
        recentMessages: recentMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        semanticFallbackOnly: barbershopSemanticFallbackEnabled &&
          !barbershopInterpreterShadowEnabled &&
          !barbershopInterpreterRuntimeEnabled,
      });
    } catch (err) {
      barbershopInterpreterResult = null;
      barbershopInterpreterError = err instanceof Error
        ? err.message
        : String(err);
    }
    console.log(JSON.stringify({
      event: barbershopSemanticFallbackEnabled &&
          !barbershopInterpreterShadowEnabled &&
          !barbershopInterpreterRuntimeEnabled
        ? "barbershop_semantic_interpreter_result"
        : "barbershop:b4_interpreter_after",
      organization_id: organizationId,
      inbound_text: inboundText,
      interpreter_called: true,
      interpreter_error: barbershopInterpreterError,
      intent: barbershopInterpreterResult?.intent ?? null,
      confidence: barbershopInterpreterResult?.confidence ?? null,
      fields_found: (barbershopInterpreterResult as unknown as
        | Record<string, unknown>
        | null)?.fields_found ?? null,
      next_step: (barbershopInterpreterResult as unknown as
        | Record<string, unknown>
        | null)?.next_step ?? null,
      tool_needed: (barbershopInterpreterResult as unknown as
        | Record<string, unknown>
        | null)?.tool_needed ?? null,
      used_for_routing: Boolean(
        barbershopInterpreterRuntimeEnabled &&
          barbershopInterpreterResult &&
          Number(barbershopInterpreterResult.confidence ?? 0) >= 0.7,
      ),
      llm_provider: llmRuntime.provider,
      has_groq_key: llmRuntime.has_groq_key,
      has_openai_key: llmRuntime.has_openai_key,
      llm_available: llmRuntime.llm_available,
      llm_brain_enabled: llmEnabled,
      barbershop_interpreter_runtime_enabled:
        barbershopInterpreterRuntimeEnabled,
      semantic_fallback_enabled: barbershopSemanticFallbackEnabled,
      semantic: (barbershopInterpreterResult as any)?.semantic ?? null,
      fallback_reason: barbershopInterpreterError ? "interpreter_error" : null,
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
      final_next_expected: safeStr(
        ((engineResult as any)?.statePatch ?? {})?.nextExpected,
        "",
      ),
      reply_preview: safeStr((engineResult as any)?.replyText, "").slice(
        0,
        120,
      ),
      route,
      source,
    }));
  }

  if (normalizedBusinessType === "dental") {
    const dentalGuidedResult = await handleDentalGuidedRuntimeTurn({
      supabase,
      organizationId,
      leadId,
      inboundText,
      normalizedAction: normalizePayloadActionValue(
        effectivePayloadAction ?? "",
      ),
      leadState: leadState as Json | null,
      clinicSettings,
      orgSettings,
    });
    if (dentalGuidedResult) {
      logEvent("dental_guided_runtime_route", {
        organization_id: organizationId,
        lead_id: leadId,
        debug_note: dentalGuidedResult.debugNote,
      });
      return dentalGuidedResult;
    }
  }

  if (normalizedBusinessType === "barbershop") {
    const barbershopServices = Array.isArray((clinicSettings as any)?.services)
      ? ((clinicSettings as any).services as Array<Record<string, unknown>>)
      : [];
    let normalizedAction = normalizePayloadActionValue(
      effectivePayloadAction ?? "",
    );
    const timezone =
      safeStr((clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
      DEFAULT_TIMEZONE;
    const nowLocal = nowInTimezone(timezone);
    const fmtLocalDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
        String(d.getDate()).padStart(2, "0")
      }`;
    const weekdayShort = (d: Date) =>
      d.toLocaleDateString("es-HN", {
        weekday: "long",
      }).toLowerCase();
    const tomorrowLocal = new Date(nowLocal);
    tomorrowLocal.setDate(tomorrowLocal.getDate() + 1);
    const datePrefButtons: InteractiveButton[] = [
      {
        id: "booking_date_pref:today",
        title: `Hoy ${weekdayShort(nowLocal)}`.slice(0, 20),
      },
      {
        id: "booking_date_pref:tomorrow",
        title: `Mañana ${weekdayShort(tomorrowLocal)}`.slice(0, 20),
      },
      { id: "booking_date_pref:week", title: "Ver próximos días" },
    ];
    const nextDaysButton: InteractiveButton = {
      id: "booking_date_pref:week",
      title: "Ver próximos días",
    };
    const bookingPromptButtons: InteractiveButton[] = [
      { id: "booking_start", title: "Agendar cita" },
      { id: "view_prices", title: "Servicios" },
    ];
    const brandName = getBarbershopBrandName(clinicSettings, orgSettings);
    const isWimaeilTenant = organizationId === "barber-demo-wimaeil";
    const barberlineMenuButtons: InteractiveButton[] = bookingPromptButtons;
    const barberlineHandoffButtons: InteractiveButton[] = isWimaeilTenant
      ? [{ id: "booking_start", title: "Agendar cita" }, {
        id: "talk_to_human",
        title: "Hablar con William",
      }]
      : [{ id: "booking_start", title: "Agendar cita" }, {
        id: "talk_to_human",
        title: "Hablar con alguien",
      }];
    const barberlineGreetingCopy = formatBarbershopGreetingCopy(brandName);
    const barberlineHandoffCopy = isWimaeilTenant
      ? "Claro, le aviso a William para que le responda personalmente 💈"
      : formatBarbershopHandoffCopy();
    const barbershopProviders = getBarbershopProviders(clinicSettings);
    const normalizedInboundText = normalizeTextForMatch(inboundText).trim();
    const buildQuickDateOptions = async (args: {
      serviceId: string;
      serviceName: string;
      providerPreference?: "any" | "specific";
      providerId?: string;
    }): Promise<
      { buttons: InteractiveButton[]; offeredDates: Record<string, unknown>[] }
    > => {
      const bookingRules = ((clinicSettings as any)?.booking_rules &&
          typeof (clinicSettings as any).booking_rules === "object")
        ? ((clinicSettings as any).booking_rules as Record<string, unknown>)
        : {};
      const maxBookingDaysAhead = Math.max(
        1,
        Math.min(60, Number(bookingRules.max_booking_days_ahead ?? 14) || 14),
      );
      const providerPreference = args.providerPreference ?? "any";
      const quickDates: Array<
        {
          date: string;
          label: string;
          source: "today" | "tomorrow" | "more_days";
          offset: number;
        }
      > = [];
      for (let offset = 0; offset <= maxBookingDaysAhead; offset += 1) {
        const date = new Date(nowLocal);
        date.setDate(date.getDate() + offset);
        const dateText = fmtLocalDate(date);
        const slots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_id: args.serviceId,
          service_name: args.serviceName,
          provider_id: providerPreference === "specific"
            ? args.providerId ?? null
            : null,
          provider_preference: providerPreference,
          date: dateText,
          timezone,
          max_options: 1,
        });
        if (slots.length === 0) continue;
        if (offset === 0) {
          quickDates.push({
            date: dateText,
            label: `Hoy ${weekdayShort(nowLocal)}`,
            source: "today",
            offset,
          });
          continue;
        }
        quickDates.push({
          date: dateText,
          label: capitalizeFirst(weekdayShort(date)),
          source: offset === 1 ? "tomorrow" : "more_days",
          offset,
        });
        break;
      }
      const buttons = quickDates.map((item) => ({
        id: item.offset === 0
          ? "booking_date_pref:today"
          : `select_date:${item.date}`,
        title: item.label.slice(0, 20),
      }));
      buttons.push(nextDaysButton);
      const offeredDates = quickDates.map((item) =>
        toBarbershopOfferedDate(
          item.date,
          item.label,
          item.source,
          args.serviceId,
        )
      );
      return {
        buttons: buttons.slice(0, 3),
        offeredDates,
      };
    };
    const buildAvailableDateListOptions = async (args: {
      serviceId: string;
      serviceName: string;
      providerPreference?: "any" | "specific";
      providerId?: string;
    }): Promise<
      {
        dateOptions: Array<{ date: string; label: string }>;
        offeredDates: Record<string, unknown>[];
      }
    > => {
      const bookingRules = ((clinicSettings as any)?.booking_rules &&
          typeof (clinicSettings as any).booking_rules === "object")
        ? ((clinicSettings as any).booking_rules as Record<string, unknown>)
        : {};
      const maxBookingDaysAhead = Math.max(
        1,
        Math.min(60, Number(bookingRules.max_booking_days_ahead ?? 14) || 14),
      );
      const providerPreference = args.providerPreference ?? "any";
      const dateOptions: Array<
        {
          date: string;
          label: string;
          source: "today" | "tomorrow" | "more_days";
        }
      > = [];
      for (
        let offset = 0;
        offset <= maxBookingDaysAhead && dateOptions.length < 7;
        offset += 1
      ) {
        const date = new Date(nowLocal);
        date.setDate(date.getDate() + offset);
        const dateText = fmtLocalDate(date);
        const slots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_id: args.serviceId,
          service_name: args.serviceName,
          provider_id: providerPreference === "specific"
            ? args.providerId ?? null
            : null,
          provider_preference: providerPreference,
          date: dateText,
          timezone,
          max_options: 1,
        });
        if (slots.length === 0) continue;
        dateOptions.push({
          date: dateText,
          label: formatRequestedDayLabel(dateText),
          source: offset === 0
            ? "today"
            : offset === 1
            ? "tomorrow"
            : "more_days",
        });
      }
      const offeredDates = dateOptions.map((item) =>
        toBarbershopOfferedDate(
          item.date,
          item.label,
          item.source,
          args.serviceId,
        )
      );
      return { dateOptions, offeredDates };
    };
    const buildDayPreferenceForService = async (
      selectedService: Record<string, unknown>,
      collected: Record<string, unknown>,
      debugNote: string,
    ): Promise<GenerateReplyResult> => {
      const serviceId = toServiceActionKey(selectedService);
      const serviceName = safeStr(selectedService.name, "");
      const { dateOptions, offeredDates } = await buildAvailableDateListOptions(
        {
          serviceId,
          serviceName,
          providerPreference: "any",
        },
      );
      logEvent("barbershop_state_contract_saved_dates", {
        organization_id: organizationId,
        lead_id: leadId,
        source: "service_selected_day_prompt",
        dates_count: offeredDates.length,
      });
      const listBody = "Listo 💈 Escogé el día que te quede mejor:";
      const fallbackBody = dateOptions.length
        ? `Escogé el día:\n${
          dateOptions.map((item, index) => `${index + 1}. ${item.label}`).join(
            "\n",
          )
        }`
        : "No encontré días disponibles por ahora. ¿Querés hablar con alguien del equipo?";
      return {
        reply: fallbackBody,
        statePatch: {
          stage: "BOOKING",
          nextExpected: "booking_date_preference",
          collected: {
            ...collected,
            activeBookingFlow: true,
            lastBookingStep: "select_day",
            current_service_key: serviceId,
            current_service_name: serviceName,
            last_offered_dates: offeredDates,
            pending_booking: {
              ...(((collected as any)?.pending_booking ?? {}) as Record<
                string,
                unknown
              >),
              service_key: serviceId,
              service_name: serviceName,
              provider_preference: "",
            },
          },
        },
        leadPatch: {},
        debugNote,
        interactiveList: barbershopDateSelectionList(dateOptions, listBody),
      };
    };
    const buildProviderPreferencePrompt = async (
      collected: Record<string, unknown>,
      selectedDate: string,
      serviceId: string,
      serviceName: string,
      debugNote: string,
    ): Promise<GenerateReplyResult> => {
      const availableProviders: BarbershopProviderOption[] = [];
      for (const provider of barbershopProviders) {
        const slots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_id: serviceId,
          service_name: serviceName,
          provider_id: provider.id,
          provider_preference: "specific",
          date: selectedDate,
          timezone,
          max_options: 1,
        });
        if (slots.length > 0) availableProviders.push(provider);
      }
      if (availableProviders.length === 0) {
        return {
          reply:
            "No veo barberos disponibles para ese día 💈\n\nTe puedo mostrar más días o pasarte con alguien del equipo.",
          statePatch: {
            stage: "BOOKING",
            nextExpected: "booking_date_preference",
            collected: {
              ...collected,
              activeBookingFlow: true,
              lastBookingStep: "select_day",
              current_service_key: serviceId,
              current_service_name: serviceName,
              current_date: selectedDate,
              preferred_date: selectedDate,
              last_offered_providers: [],
              pending_booking: {
                ...(((collected as any)?.pending_booking ?? {}) as Record<
                  string,
                  unknown
                >),
                service_key: serviceId,
                service_name: serviceName,
                appointment_date: selectedDate,
              },
            },
          },
          leadPatch: {},
          debugNote: "booking_no_available_providers_for_day",
          interactiveButtons: [
            nextDaysButton,
            { id: "talk_to_human", title: "Hablar con alguien" },
          ],
        };
      }
      if (availableProviders.length === 1) {
        const soloProvider = availableProviders[0];
        const selectedService = barbershopServices.find((s) =>
          toServiceActionKey(s) === serviceId
        ) ??
          barbershopServices.find((s) =>
            normalizeTextForMatch(safeStr((s as any).name, "")) ===
              normalizeTextForMatch(serviceName)
          ) ??
          null;
        const bookingRules = ((clinicSettings as any)?.booking_rules &&
            typeof (clinicSettings as any).booking_rules === "object")
          ? ((clinicSettings as any).booking_rules as Record<string, unknown>)
          : {};
        const maxVisibleSlots = Math.max(
          1,
          Math.min(5, Number(bookingRules.max_visible_slots ?? 3) || 3),
        );
        const slots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_id: serviceId,
          service_name: serviceName,
          provider_id: soloProvider.id,
          provider_preference: "specific",
          date: selectedDate,
          timezone,
          max_options: 40,
        });
        const shown = slots.slice(0, maxVisibleSlots);
        const visibleForList = slots.length > 3 ? slots.slice(0, 10) : shown;
        const useSlotList = slots.length > 3;
        const lines = shown.map((slot) =>
          `• ${formatHourLabel(safeStr(slot.time, ""))}`
        ).join("\n");
        const body = useSlotList
          ? formatBarbershopAvailabilityListBody(
            visibleForList as Array<Record<string, unknown>>,
          )
          : formatBarbershopSlotOptionsBody({
            providerPreference: "specific",
            providerName: soloProvider.name,
            lines,
            hasMore: false,
          });
        const offeredSlots = visibleForList.map((slot) =>
          toBarbershopOfferedSlot(
            slot as Record<string, unknown>,
            selectedService,
            serviceName,
            "date",
          )
        );
        logEvent("barbershop_solo_provider_auto_assigned", {
          organization_id: organizationId,
          lead_id: leadId,
          provider_id: soloProvider.id,
          provider_name: soloProvider.name,
        });
        logEvent("barbershop_state_contract_saved_slots", {
          organization_id: organizationId,
          lead_id: leadId,
          source: "date",
          slots_count: offeredSlots.length,
        });
        return {
          reply: body,
          statePatch: {
            stage: "BOOKING",
            nextExpected: "availability_slot_selection",
            collected: {
              ...collected,
              activeBookingFlow: true,
              lastBookingStep: "select_time",
              expected_step: "slot_selection",
              current_service_key: serviceId,
              current_service_name: serviceName,
              current_date: selectedDate,
              preferred_date: selectedDate,
              preferred_provider_id: soloProvider.id,
              preferred_barber: soloProvider.name,
              provider_preference: "specific",
              last_availability_context: {
                date: selectedDate,
                service: serviceName,
                provider_preference: "specific",
                provider_id: soloProvider.id,
                slots,
              },
              last_offered_slots: offeredSlots,
              last_offered_providers: [
                {
                  id: soloProvider.id,
                  name: soloProvider.name,
                  source: "solo_provider_auto_assigned",
                },
              ],
              pending_booking: {
                ...(((collected as any)?.pending_booking ?? {}) as Record<
                  string,
                  unknown
                >),
                service_key: serviceId,
                service_name: serviceName,
                appointment_date: selectedDate,
                provider_id: soloProvider.id,
                provider_name: soloProvider.name,
                provider_preference: "specific",
              },
            },
          },
          leadPatch: {},
          debugNote: "booking_solo_provider_auto_assigned_slots_for_day",
          interactiveButtons: useSlotList
            ? []
            : buildBarbershopAvailabilityButtons(
              shown as Array<Record<string, unknown>>,
              false,
            ),
          interactiveList: useSlotList
            ? buildExpandedBarbershopTimeSlotsList({
              slots: visibleForList as Array<Record<string, unknown>>,
              body,
              serviceName,
              providerPreference: "specific",
            })
            : undefined,
        };
      }
      const providersList = providerSelectionList(availableProviders);
      return {
        reply: providersList?.body ?? "¿Tenés barbero preferido?",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "provider_selection",
          collected: {
            ...collected,
            activeBookingFlow: true,
            lastBookingStep: "select_provider",
            expected_step: "provider_selection",
            current_service_key: serviceId,
            current_service_name: serviceName,
            current_date: selectedDate,
            preferred_date: selectedDate,
            last_offered_providers: [
              ...availableProviders.map((provider) => ({
                id: provider.id,
                name: provider.name,
                source: "provider_selection",
              })),
              {
                id: "any",
                name: "Cualquiera disponible",
                source: "provider_selection",
              },
            ],
            pending_booking: {
              ...(((collected as any)?.pending_booking ?? {}) as Record<
                string,
                unknown
              >),
              service_key: serviceId,
              service_name: serviceName,
              appointment_date: selectedDate,
            },
          },
        },
        leadPatch: {},
        debugNote,
        interactiveButtons: providerSelectionButtons(availableProviders),
        interactiveList: providersList,
      };
    };
    const greetingOnly = !normalizedAction &&
      /^(hola|buenas|menu|men[uú]|reiniciar|empezar)$/i.test(
        normalizedInboundText,
      );
    if (greetingOnly) {
      return {
        reply: barberlineGreetingCopy,
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "greeting",
          nextExpected: "main_menu_selection",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            activeBookingFlow: false,
          },
        },
        leadPatch: {},
        debugNote: "barberline_guided_greeting_menu",
        interactiveButtons: barberlineMenuButtons,
      };
    }
    const numberedSelectionContexts = new Set([
      "service_selection",
      "provider_selection",
      "date_selection",
      "availability_slot_selection",
    ]);
    const currentCollected = ((leadState as any)?.collected ?? {}) as Record<
      string,
      unknown
    >;
    const nextExpected = resolveBarbershopGuidedExpectedStep(
      leadState as Record<string, unknown>,
    );
    const providerOptionsForTurn = resolveProviderOptionsForTurn(
      barbershopProviders,
      currentCollected,
    );
    const serviceTextSelectionForTurn = !normalizedAction
      ? resolveServiceFromTextSelection(barbershopServices, inboundText)
      : null;
    if (!normalizedAction) {
      const offeredDates =
        Array.isArray((currentCollected as any)?.last_offered_dates)
          ? ((currentCollected as any).last_offered_dates as any[])
          : [];
      const offeredSlots =
        Array.isArray((currentCollected as any)?.last_offered_slots)
          ? ((currentCollected as any).last_offered_slots as any[])
          : [];
      if (nextExpected === "service_selection") {
        const service = serviceTextSelectionForTurn;
        if (service) {
          normalizedAction = `select_service:${toServiceActionKey(service)}`;
        }
      } else if (
        nextExpected === "booking_date_preference" ||
        nextExpected === "date_selection"
      ) {
        normalizedAction = resolveGuidedDateActionFromText(
          inboundText,
          offeredDates,
          nowLocal,
        );
      } else if (nextExpected === "provider_selection") {
        const provider = resolveProviderFromActionOrText(
          providerOptionsForTurn,
          inboundText,
        );
        if (provider) {
          normalizedAction = `select_provider:${
            provider.preference === "any" ? "any" : provider.id
          }`;
        }
      } else if (nextExpected === "availability_slot_selection") {
        normalizedAction = resolveGuidedSlotActionFromText(
          inboundText,
          offeredSlots,
          true,
        );
      } else if (nextExpected === "confirm_booking") {
        normalizedAction = resolveGuidedConfirmationActionFromText(inboundText);
      } else if (
        nextExpected === "active_appointment_intent_choice" ||
        nextExpected === "conflict_resolution"
      ) {
        normalizedAction = resolveGuidedConflictActionFromText(inboundText);
      }
      if (normalizedAction) {
        logEvent("barberline_guided_text_normalized", {
          organization_id: organizationId,
          lead_id: leadId,
          next_expected: nextExpected,
          normalized_action: normalizedAction,
        });
      }
    }
    if (
      !normalizedAction &&
      serviceTextSelectionForTurn &&
      nextExpected === "provider_selection" &&
      isWimaeilTenant
    ) {
      return await buildDayPreferenceForService(
        serviceTextSelectionForTurn,
        currentCollected,
        "booking_text_service_selected_from_provider_context",
      );
    }
    if (!normalizedAction && nextExpected === "provider_selection") {
      return {
        reply:
          "Podés escoger un barbero de la lista o elegir cualquiera disponible.",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "provider_selection",
          collected: {
            ...currentCollected,
            activeBookingFlow: true,
            lastBookingStep: "select_provider",
            expected_step: "provider_selection",
          },
        },
        leadPatch: {},
        debugNote: "booking_provider_selection_clarify",
        interactiveButtons: providerSelectionButtons(providerOptionsForTurn),
        interactiveList: providerSelectionList(providerOptionsForTurn),
      };
    }
    if (
      !normalizedAction && /^\d+$/.test(normalizedInboundText) &&
      !numberedSelectionContexts.has(nextExpected)
    ) {
      return {
        reply:
          "Decime qué querés hacer: agendar cita, ver precios o hablar con alguien.",
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "menu_help",
          nextExpected: "main_menu_selection",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            activeBookingFlow: false,
          },
        },
        leadPatch: {},
        debugNote: "barberline_unmapped_number_guard",
        interactiveButtons: barberlineMenuButtons,
      };
    }
    if (
      !normalizedAction &&
      ["customer_name", "name_input", "patient_name"].includes(nextExpected)
    ) {
      const customerName = toDisplayPersonName(inboundText);
      const collected = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const pending = ((collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >;
      if (
        isReliableBarbershopCustomerName(customerName) &&
        pending.appointment_date && pending.appointment_time
      ) {
        const nextPending = {
          ...pending,
          patient_name: customerName,
          customer_name: customerName,
          client_name: customerName,
        };
        return {
          reply: formatBarbershopConfirmationSummary(nextPending, customerName),
          statePatch: {
            stage: "CONFIRMING",
            nextExpected: "confirm_booking",
            collected: {
              ...collected,
              patient_name: customerName,
              customer_name: customerName,
              client_name: customerName,
              activeBookingFlow: true,
              lastBookingStep: "confirm_booking",
              pending_booking: nextPending,
              pending_booking_stale: false,
            },
          },
          leadPatch: {},
          debugNote: "barberline_name_captured_before_confirmation",
          interactiveButtons: [
            { id: "confirm_booking", title: "Confirmar" },
            { id: "change_booking_slot", title: "Cambiar hora" },
            { id: "talk_to_human", title: "Hablar con alguien" },
          ],
        };
      }
      return {
        reply: "¿A nombre de quién dejamos la cita?",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "customer_name",
          collected: {
            ...collected,
            activeBookingFlow: true,
          },
        },
        leadPatch: {},
        debugNote: "barberline_name_input_invalid",
      };
    }
    if (
      normalizedAction === "talk_to_human" ||
      normalizedAction === "human_handoff" ||
      (isWimaeilTenant &&
        /\b(hablar con william|quiero hablar con william|hablar con alguien|quiero hablar con una persona|humano|atencion humana|atención humana|que me atienda alguien|necesito ayuda)\b/
          .test(normalizedInboundText))
    ) {
      await recordHumanHandoffEvent({
        supabase,
        organizationId,
        leadId,
        channel: safeStr(
          (leadState as any)?.channel,
          safeStr((leadState as any)?.last_channel, ""),
        ),
        messagePreview: inboundText,
      });
      return {
        reply: barberlineHandoffCopy,
        statePatch: {
          stage: "HANDOFF",
          lastIntent: "human_handoff",
          nextExpected: undefined,
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            activeBookingFlow: false,
          },
        },
        leadPatch: { handoff_to_human: true, updated_at: nowIso() },
        debugNote: "barberline_handoff_requested",
      };
    }
    if (normalizedAction === "keep_existing_booking") {
      return {
        reply: "Perfecto, mantenemos tu cita confirmada 💈",
        statePatch: {
          stage: "BOOKED",
          lastIntent: "keep_existing_booking",
          nextExpected: undefined,
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            pending_booking: null,
            pending_booking_stale: true,
            activeBookingFlow: false,
          },
        },
        leadPatch: {},
        debugNote: "barberline_keep_existing_booking",
      };
    }
    if (normalizedAction === "additional_booking") {
      return {
        reply: "¿La otra cita es para vos o para otra persona?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "additional_booking",
          nextExpected: "additional_booking_person",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            activeBookingFlow: true,
            pending_booking: null,
            allow_additional_booking: true,
          },
        },
        leadPatch: {},
        debugNote: "barberline_additional_booking_person_prompt",
        interactiveButtons: [
          { id: "additional_booking_self", title: "Para mí" },
          { id: "additional_booking_other", title: "Para otra persona" },
          { id: "keep_existing_booking", title: "Cancelar" },
        ],
      };
    }
    if (normalizedAction === "additional_booking_other") {
      return {
        reply: "¿A nombre de quién dejamos esa cita?",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "additional_booking_other",
          nextExpected: "patient_name",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            activeBookingFlow: true,
            allow_additional_booking: true,
            booking_for_other: true,
          },
        },
        leadPatch: {},
        debugNote: "barberline_additional_booking_name_prompt",
      };
    }
    if (normalizedAction === "additional_booking_self") {
      const servicesList = serviceSelectionList(
        barbershopServices,
        "Perfecto 💈 Escogé el servicio:",
        true,
      );
      return {
        reply: servicesList?.body ?? "Perfecto 💈 Escogé el servicio:",
        statePatch: {
          stage: "BOOKING",
          lastIntent: "additional_booking_self",
          nextExpected: "service_selection",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            activeBookingFlow: true,
            allow_additional_booking: true,
            booking_for_other: false,
          },
        },
        leadPatch: {},
        debugNote: "barberline_additional_booking_service_prompt",
        interactiveList: servicesList,
        interactiveButtons: servicesList
          ? []
          : serviceSelectionButtons(barbershopServices),
      };
    }
    if (normalizedAction === "reschedule_booking") {
      const activeAppointment = await loadActiveAppointmentForLead({
        supabase,
        organizationId,
        leadId,
      });
      if (!activeAppointment?.id) {
        return {
          reply:
            "Por ahora no veo una cita futura para reagendar. ¿Querés agendar una nueva?",
          statePatch: {
            stage: "DISCOVERY",
            lastIntent: "reschedule_appointment",
            nextExpected: "main_menu_selection",
            collected: {
              ...(((leadState as any)?.collected ?? {}) as Record<
                string,
                unknown
              >),
              pending_booking: null,
              activeBookingFlow: false,
            },
          },
          leadPatch: {},
          debugNote: "barberline_reschedule_no_future_appointment",
          interactiveButtons: [{ id: "booking_start", title: "Agendar cita" }],
        };
      }
      const activeDate = safeStr(
        activeAppointment.appointment_date,
        safeStr(activeAppointment.starts_at, "").slice(0, 10),
      );
      const activeTime = safeStr(
        activeAppointment.appointment_time,
        safeStr(activeAppointment.starts_at, "").slice(11, 16),
      );
      const activeService = toPatientFacingServiceLabel(
        safeStr(
          activeAppointment.reason,
          safeStr(activeAppointment.title, "Cita"),
        ),
      );
      const pendingReschedule = {
        appointment_id: safeStr(activeAppointment.id, ""),
        service: activeService,
        current_date: activeDate,
        current_time: activeTime,
        current_starts_at: safeStr(
          activeAppointment.starts_at,
          `${activeDate}T${activeTime}:00`,
        ),
        status: "awaiting_new_datetime",
      };
      return {
        reply: `Claro, te ayudo a reagendar tu cita de ${activeService} del ${
          formatRequestedDayLabel(activeDate)
        } a las ${
          formatHourLabel(activeTime)
        }.\n\n¿Qué nuevo día y hora te interesa?`,
        statePatch: {
          stage: "BOOKING",
          active_flow: "reschedule",
          lastIntent: "reschedule_appointment",
          nextExpected: "reschedule_new_datetime",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            activeBookingFlow: true,
            pending_booking: null,
            pending_booking_stale: true,
            selected_slot: null,
            service: activeService,
            active_appointment: {
              id: safeStr(activeAppointment.id, ""),
              appointment_date: activeDate,
              appointment_time: activeTime,
              starts_at: safeStr(
                activeAppointment.starts_at,
                `${activeDate}T${activeTime}:00`,
              ),
              reason: activeService,
              provider_id: safeStr(activeAppointment.provider_id, "") || null,
              provider_name: safeStr(activeAppointment.provider_name, "") ||
                null,
            },
            pending_reschedule: pendingReschedule,
          },
        },
        leadPatch: {},
        debugNote: "barberline_reschedule_action_prompt",
      };
    }
    if (normalizedAction === "change_booking_slot") {
      return {
        reply: "Dale 💈 ¿Qué nuevo día te queda mejor?",
        statePatch: {
          stage: "BOOKING",
          nextExpected: "booking_date_preference",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            activeBookingFlow: true,
            lastBookingStep: "select_day",
            pending_booking: null,
            pending_booking_stale: true,
          },
        },
        leadPatch: {},
        debugNote: "barberline_change_time_requested",
        interactiveButtons: datePrefButtons,
      };
    }
    const isPricingText =
      /\b(precio|precios|cuanto|cuánto|cuesta|vale|costo|costos|tarifa|tarifas)\b/
        .test(normalizeTextForMatch(inboundText));
    const isAvailabilityHoursText =
      /\b(disponible|disponibles|cupo|espacio|mañana|manana|hoy|tarde|manana|pasado)\b/
        .test(normalizedInboundText);
    const isLocationFaq = !normalizedAction &&
      /\b(ubicacion|direccion|donde estan|donde quedan|como llego|como llegar|ubicados|ubicadas)\b/
        .test(normalizedInboundText);
    const isHoursFaq = !normalizedAction && !isAvailabilityHoursText &&
      (/^(hora|horario|horarios)$/.test(normalizedInboundText) ||
        /\b(a que hora abren|cuando abren|a que hora cierran|cuando cierran|horario|horarios)\b/
          .test(normalizedInboundText));
    const isServicesFaq = !normalizedAction && !isPricingText &&
      /\b(servicios|que ofrecen|que hacen)\b/.test(normalizedInboundText);
    const isProvidersFaq = !normalizedAction &&
      /\b(barberos|barbero|quien corta|quienes cortan)\b/.test(
        normalizedInboundText,
      );
    if (isLocationFaq || isHoursFaq || isServicesFaq || isProvidersFaq) {
      const futureAppointments = await loadFutureActiveAppointmentsForLead({
        supabase,
        organizationId,
        leadId,
        timezone,
      });
      const activeAppointment = futureAppointments[0] ?? null;
      const reply = isLocationFaq
        ? formatBarbershopLocationFaq(clinicSettings, activeAppointment)
        : isHoursFaq
        ? formatBarbershopHoursFaq(clinicSettings, activeAppointment)
        : isProvidersFaq
        ? formatBarbershopProvidersFaq(barbershopProviders)
        : formatBarbershopServicesFaq(barbershopServices);
      return {
        reply,
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: isLocationFaq
            ? "location"
            : isHoursFaq
            ? "business_hours"
            : isProvidersFaq
            ? "providers"
            : "services",
          lastTopic: isLocationFaq
            ? "location"
            : isHoursFaq
            ? "business_hours"
            : isProvidersFaq
            ? "providers"
            : "services",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            activeBookingFlow: false,
            pending_booking_stale: true,
          },
        },
        leadPatch: {},
        debugNote: isLocationFaq
          ? "barberline_faq_location"
          : isHoursFaq
          ? "barberline_faq_hours"
          : isProvidersFaq
          ? "barberline_faq_providers"
          : "barberline_faq_services",
        interactiveButtons: [
          { id: "booking_start", title: "Agendar cita" },
          { id: "talk_to_human", title: "Hablar con alguien" },
        ],
      };
    }
    if (normalizedAction === "view_prices" && barbershopServices.length > 0) {
      const body =
        `Estos son los servicios disponibles en *${brandName}* 💈\n\nEscogé uno para ver disponibilidad y agendar.`;
      const servicesList = serviceSelectionList(barbershopServices, body, true);
      return {
        reply: servicesList?.body ??
          formatBarbershopServiceSelectionText(barbershopServices),
        statePatch: {
          stage: "BOOKING",
          nextExpected: "service_selection",
          lastIntent: "services",
          lastTopic: "services",
          last_bot_step: "booking_service_menu_sent",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            last_info_topic: "services",
            lastTopic: "services",
            activeBookingFlow: true,
            lastBookingStep: "select_service",
            expected_step: "service_selection",
          },
        },
        leadPatch: {},
        debugNote: "booking_interactive_services_picker",
        interactiveButtons: servicesList
          ? []
          : serviceSelectionButtons(barbershopServices),
        interactiveList: servicesList,
      };
    }
    if ((!normalizedAction && isPricingText) && barbershopServices.length > 0) {
      const futureAppointments = await loadFutureActiveAppointmentsForLead({
        supabase,
        organizationId,
        leadId,
        timezone,
      });
      const activeAppointment = futureAppointments[0] ?? null;
      return {
        reply: isWimaeilTenant
          ? formatWimaeilPricingList(barbershopServices, brandName)
          : formatBarbershopPricingList(
            barbershopServices,
            brandName,
            activeAppointment,
          ),
        statePatch: {
          stage: "DISCOVERY",
          lastIntent: "pricing",
          lastTopic: "pricing",
          nextExpected: "pricing_booking_followup",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            last_info_topic: "pricing",
            lastTopic: "pricing",
            activeBookingFlow: false,
            pending_booking: null,
            pending_booking_stale: true,
          },
        },
        leadPatch: {},
        debugNote: "barberline_guided_pricing_answer",
        interactiveButtons: barberlineHandoffButtons,
      };
    }
    const canonicalBarberLineResponse = handleBarberLineRuntimeTurn({
      organizationId,
      leadId,
      inboundText,
      normalizedAction,
      engineResult,
      leadState,
      barbershopServices,
    });
    if (canonicalBarberLineResponse) return canonicalBarberLineResponse;
    if (normalizedAction === "booking_start") {
      const servicesList = serviceSelectionList(
        barbershopServices,
        "Perfecto 💈 Escogé el servicio:",
        true,
      );
      return {
        reply: servicesList?.body ??
          formatBarbershopServiceSelectionText(barbershopServices),
        statePatch: {
          stage: "BOOKING",
          nextExpected: "service_selection",
          last_bot_step: "booking_service_menu_sent",
          collected: {
            ...(((leadState as any)?.collected ?? {}) as Record<
              string,
              unknown
            >),
            activeBookingFlow: true,
            lastBookingStep: "select_service",
          },
        },
        leadPatch: {},
        debugNote: "booking_interactive_service_menu",
        interactiveButtons: servicesList
          ? []
          : serviceSelectionButtons(barbershopServices),
        interactiveList: servicesList,
      };
    }
    const serviceSelectionFromText = !normalizedAction &&
        safeStr((leadState as any)?.nextExpected, "") === "service_selection"
      ? resolveServiceFromTextSelection(barbershopServices, inboundText)
      : null;
    if (serviceSelectionFromText) {
      const selectedService = serviceSelectionFromText;
      return await buildDayPreferenceForService(
        selectedService,
        ((leadState as any)?.collected ?? {}) as Record<string, unknown>,
        "booking_text_service_selected_day_preference",
      );
    }
    if (normalizedAction.startsWith("select_service:")) {
      const selectedService = resolveServiceFromAction(
        barbershopServices,
        normalizedAction,
      );
      if (selectedService) {
        logEvent("select_service_asks_preference", {
          organization_id: organizationId,
          lead_id: leadId,
          service_name: safeStr(selectedService.name, ""),
        });
        return await buildDayPreferenceForService(
          selectedService,
          ((leadState as any)?.collected ?? {}) as Record<string, unknown>,
          "booking_interactive_day_preference_after_service",
        );
      }
    }
    const providerSelectionFromText = !normalizedAction &&
        ["provider_selection", "booking_date_preference", "date_selection"]
          .includes(
            resolveBarbershopGuidedExpectedStep(
              leadState as Record<string, unknown>,
            ),
          )
      ? resolveProviderFromActionOrText(providerOptionsForTurn, inboundText)
      : null;
    if (
      normalizedAction.startsWith("select_provider:") ||
      providerSelectionFromText
    ) {
      const selectedProvider = providerSelectionFromText ??
        resolveProviderFromActionOrText(
          providerOptionsForTurn,
          normalizedAction,
        );
      const collected = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const pending = ((collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >;
      const serviceKey = safeStr(
        (collected as any).current_service_key,
        safeStr(pending.service_key, ""),
      );
      const serviceName = safeStr(
        (collected as any).current_service_name,
        safeStr(pending.service_name, ""),
      );
      const selectedDate = safeStr(
        (collected as any).current_date,
        safeStr(
          (collected as any).preferred_date,
          safeStr(pending.appointment_date, ""),
        ),
      );
      const selectedService = (
        barbershopServices.find((s) => toServiceActionKey(s) === serviceKey) ??
          barbershopServices.find((s) =>
            normalizeTextForMatch(safeStr((s as any).name, "")) ===
              normalizeTextForMatch(serviceName)
          )
      ) ?? null;
      if (selectedProvider && (selectedService || serviceName)) {
        const serviceId = selectedService
          ? toServiceActionKey(selectedService)
          : serviceKey;
        const providerPreference = selectedProvider.preference;
        const resolvedServiceName = serviceName ||
          safeStr(selectedService?.name, "");
        if (selectedDate) {
          const bookingRules = ((clinicSettings as any)?.booking_rules &&
              typeof (clinicSettings as any).booking_rules === "object")
            ? ((clinicSettings as any).booking_rules as Record<
              string,
              unknown
            >)
            : {};
          const maxVisibleSlots = Math.max(
            1,
            Math.min(5, Number(bookingRules.max_visible_slots ?? 3) || 3),
          );
          const slots = await getAvailableSlotsForDay({
            supabase,
            organization_id: organizationId,
            business_type: "barbershop",
            service_id: serviceId,
            service_name: resolvedServiceName,
            provider_id: providerPreference === "specific"
              ? selectedProvider.id
              : null,
            provider_preference: providerPreference,
            date: selectedDate,
            timezone,
            max_options: 40,
          });
          const shown = slots.slice(0, maxVisibleSlots);
          if (!shown.length) {
            const otherProviderSlots = providerPreference === "specific"
              ? await getAvailableSlotsForDay({
                supabase,
                organization_id: organizationId,
                business_type: "barbershop",
                service_id: serviceId,
                service_name: resolvedServiceName,
                provider_id: null,
                provider_preference: "any",
                date: selectedDate,
                timezone,
                max_options: 10,
              })
              : [];
            const hasOtherProviderSlots = otherProviderSlots.some((slot) =>
              safeStr(slot.provider_id, "") !== selectedProvider.id
            );
            return {
              reply: providerPreference === "specific"
                ? `${selectedProvider.name} no tiene horarios disponibles para ese día 💈\n\nTe puedo mostrar opciones con otro barbero o revisar más días.`
                : `No veo horarios disponibles para ${
                  formatRequestedDayLabel(selectedDate)
                }.\n\n¿Querés ver más días?`,
              statePatch: {
                stage: "BOOKING",
                nextExpected: "provider_selection",
                collected: {
                  ...collected,
                  provider_preference: providerPreference,
                  preferred_provider_id: providerPreference === "specific"
                    ? selectedProvider.id
                    : "",
                  preferred_barber: providerPreference === "specific"
                    ? selectedProvider.name
                    : "",
                  expected_step: "provider_selection",
                  lastBookingStep: "select_provider",
                },
              },
              leadPatch: {},
              debugNote: "booking_provider_no_slots_for_selected_day",
              interactiveButtons: [
                ...(hasOtherProviderSlots
                  ? [{ id: "select_provider:any", title: "Cualquiera" }]
                  : []),
                nextDaysButton,
                { id: "talk_to_human", title: "Hablar con alguien" },
              ].slice(0, 3),
            };
          }
          const visibleForList = slots.length > 3 ? slots.slice(0, 10) : shown;
          const useSlotList = slots.length > 3;
          const lines = providerPreference === "specific"
            ? shown.map((slot) =>
              `• ${formatHourLabel(safeStr(slot.time, ""))}`
            ).join("\n")
            : shown.map((slot) =>
              `• ${formatHourLabel(safeStr(slot.time, ""))} · ${
                safeStr(slot.provider_name, "Barbero")
              }`
            ).join("\n");
          const body = useSlotList
            ? formatBarbershopAvailabilityListBody(
              visibleForList as Array<Record<string, unknown>>,
            )
            : formatBarbershopSlotOptionsBody({
              providerPreference,
              providerName: providerPreference === "specific"
                ? selectedProvider.name
                : undefined,
              lines,
              hasMore: false,
            });
          const offeredSlots = visibleForList.map((slot) =>
            toBarbershopOfferedSlot(
              slot as Record<string, unknown>,
              selectedService,
              resolvedServiceName,
              "date",
            )
          );
          logEvent("barbershop_state_contract_saved_slots", {
            organization_id: organizationId,
            lead_id: leadId,
            source: "date",
            slots_count: offeredSlots.length,
          });
          return {
            reply: body,
            statePatch: {
              stage: "BOOKING",
              nextExpected: "availability_slot_selection",
              collected: {
                ...collected,
                activeBookingFlow: true,
                lastBookingStep: "select_time",
                current_service_key: serviceId,
                current_service_name: resolvedServiceName,
                current_date: selectedDate,
                preferred_date: selectedDate,
                preferred_provider_id: providerPreference === "specific"
                  ? selectedProvider.id
                  : "",
                preferred_barber: providerPreference === "specific"
                  ? selectedProvider.name
                  : "",
                provider_preference: providerPreference,
                availability_shown_offset: 0,
                last_availability_context: {
                  date: selectedDate,
                  service: resolvedServiceName,
                  provider_preference: providerPreference,
                  provider_id: providerPreference === "specific"
                    ? selectedProvider.id
                    : null,
                  slots,
                },
                last_offered_slots: offeredSlots,
                pending_booking: {
                  ...pending,
                  service_key: serviceId,
                  service_name: resolvedServiceName,
                  appointment_date: selectedDate,
                  provider_id: providerPreference === "specific"
                    ? selectedProvider.id
                    : "",
                  provider_name: providerPreference === "specific"
                    ? selectedProvider.name
                    : "",
                  provider_preference: providerPreference,
                },
              },
            },
            leadPatch: {},
            debugNote: providerPreference === "specific"
              ? "booking_provider_specific_slots_for_day"
              : "booking_provider_any_slots_for_day",
            interactiveButtons: useSlotList
              ? []
              : buildBarbershopAvailabilityButtons(
                shown as Array<Record<string, unknown>>,
                false,
              ),
            interactiveList: useSlotList
              ? buildExpandedBarbershopTimeSlotsList({
                slots: visibleForList as Array<Record<string, unknown>>,
                body,
                serviceName: resolvedServiceName,
                providerPreference,
              })
              : undefined,
          };
        }
        const { buttons, offeredDates } = await buildQuickDateOptions({
          serviceId,
          serviceName: serviceName || safeStr(selectedService?.name, ""),
          providerPreference,
          providerId: selectedProvider.id,
        });
        logEvent("barbershop_state_contract_saved_dates", {
          organization_id: organizationId,
          lead_id: leadId,
          source: "quick_date_options_after_provider",
          dates_count: offeredDates.length,
        });
        return {
          reply: "¿Qué día te queda mejor?",
          statePatch: {
            stage: "BOOKING",
            nextExpected: "booking_date_preference",
            collected: {
              ...collected,
              activeBookingFlow: true,
              lastBookingStep: "select_day",
              current_service_key: serviceId,
              current_service_name: serviceName ||
                safeStr(selectedService?.name, ""),
              preferred_provider_id: providerPreference === "specific"
                ? selectedProvider.id
                : "",
              preferred_barber: providerPreference === "specific"
                ? selectedProvider.name
                : "",
              provider_preference: providerPreference,
              last_offered_dates: offeredDates,
              pending_booking: {
                ...pending,
                service_key: serviceId,
                service_name: serviceName || safeStr(selectedService?.name, ""),
                provider_id: providerPreference === "specific"
                  ? selectedProvider.id
                  : "",
                provider_name: providerPreference === "specific"
                  ? selectedProvider.name
                  : "",
                provider_preference: providerPreference,
              },
            },
          },
          leadPatch: {},
          debugNote: "booking_interactive_date_preference_after_provider",
          interactiveButtons: buttons,
        };
      }
    }
    if (normalizedAction.startsWith("booking_date_pref:")) {
      const selectedPref = parseBookingDatePrefFromAction(normalizedAction);
      if (selectedPref === "week") {
        logEvent("booking_more_dates_payload_matched", {
          organization_id: organizationId,
          lead_id: leadId,
          payload_action: normalizedAction,
        });
        logEvent("booking_more_dates_requested", {
          organization_id: organizationId,
          lead_id: leadId,
          source: "payload_action",
        });
        logEvent("more_days_requested", {
          organization_id: organizationId,
          lead_id: leadId,
          source: "payload_action",
        });
      }
      const collected = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const pending = ((collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >;
      const pendingRequest =
        ((collected as any)?.pending_booking_request ?? {}) as Record<
          string,
          unknown
        >;
      const serviceName = safeStr(pending.service_name, "") ||
        safeStr((pendingRequest as any).service_name, "") ||
        safeStr((pendingRequest as any).service, "") ||
        safeStr((collected as any).service, "");
      const serviceKey = safeStr(pending.service_key, "");
      const providerPreference = (safeStr(
          pending.provider_preference,
          safeStr((collected as any).provider_preference, "any"),
        ) === "specific")
        ? "specific"
        : "any";
      const hasProviderPreference = Boolean(
        safeStr(
          pending.provider_preference,
          safeStr((collected as any).provider_preference, ""),
        ).trim() ||
          safeStr(
            pending.provider_id,
            safeStr((collected as any).preferred_provider_id, ""),
          ).trim(),
      );
      const selectedProviderId = safeStr(
        pending.provider_id,
        safeStr((collected as any).preferred_provider_id, ""),
      );
      const selectedService = (
        barbershopServices.find((s) => toServiceActionKey(s) === serviceKey) ??
          barbershopServices.find((s) =>
            normalizeTextForMatch(safeStr((s as any).name, "")) ===
              normalizeTextForMatch(serviceName)
          )
      ) ?? null;
      const serviceId = selectedService
        ? toServiceActionKey(selectedService)
        : "";
      const fmtDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
          String(d.getDate()).padStart(2, "0")
        }`;
      const todayDate = fmtDate(nowLocal);
      const tomorrow = new Date(nowLocal);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = fmtDate(tomorrow);
      const bookingRules = ((clinicSettings as any)?.booking_rules &&
          typeof (clinicSettings as any).booking_rules === "object")
        ? ((clinicSettings as any).booking_rules as Record<string, unknown>)
        : {};
      const maxVisibleSlots = Math.max(
        1,
        Math.min(5, Number(bookingRules.max_visible_slots ?? 3) || 3),
      );
      const maxVisibleDays = Math.max(
        1,
        Math.min(7, Number(bookingRules.max_visible_days ?? 3) || 3),
      );
      const maxBookingDaysAhead = Math.max(
        maxVisibleDays,
        Math.min(60, Number(bookingRules.max_booking_days_ahead ?? 14) || 14),
      );
      const resolvedServiceKey = toServiceActionKey(
        selectedService ?? { id: serviceKey, name: serviceName },
      );

      if (selectedPref && (serviceName || selectedService)) {
        logEvent("booking_more_dates_service_resolved", {
          organization_id: organizationId,
          lead_id: leadId,
          service_name: serviceName || safeStr(selectedService?.name, ""),
        });
        if (selectedPref === "today" || selectedPref === "tomorrow") {
          const selectedDate = selectedPref === "today"
            ? todayDate
            : tomorrowDate;
          if (!hasProviderPreference) {
            return await buildProviderPreferencePrompt(
              collected,
              selectedDate,
              resolvedServiceKey,
              serviceName || safeStr(selectedService?.name, ""),
              "booking_day_selected_provider_preference_prompt",
            );
          }
          const slots = await getAvailableSlotsForDay({
            supabase,
            organization_id: organizationId,
            business_type: "barbershop",
            service_id: serviceId,
            service_name: serviceName || safeStr(selectedService?.name, ""),
            provider_id: providerPreference === "specific"
              ? selectedProviderId
              : null,
            provider_preference: providerPreference,
            date: selectedDate,
            timezone,
            max_options: 5,
          });
          if (selectedPref === "today") {
            logEvent("availability_today_filters_past_slots", {
              organization_id: organizationId,
              lead_id: leadId,
              date: selectedDate,
            });
            logEvent("availability_min_notice_applied", {
              organization_id: organizationId,
              lead_id: leadId,
              date: selectedDate,
            });
          }
          const shown = slots.slice(0, maxVisibleSlots);
          if (!shown.length) {
            const nextSlots = await suggestNextAvailableSlots({
              supabase,
              organization_id: organizationId,
              business_type: "barbershop",
              service_id: serviceId,
              service_name: serviceName || safeStr(selectedService?.name, ""),
              provider_id: providerPreference === "specific"
                ? selectedProviderId
                : null,
              provider_preference: providerPreference,
              date_from: selectedDate,
              date_to: (() => {
                const d = new Date(`${selectedDate}T12:00:00`);
                d.setDate(d.getDate() + 7);
                return fmtDate(d);
              })(),
              timezone,
              max_options: 9,
            });
            const grouped = new Map<string, typeof nextSlots>();
            for (const slot of nextSlots) {
              const arr = grouped.get(slot.date) ?? [];
              if (arr.length < 2) arr.push(slot);
              grouped.set(slot.date, arr);
            }
            const topDays = Array.from(grouped.entries()).slice(0, 3);
            if (!topDays.length) {
              return {
                reply: "No encontré horarios disponibles por ahora.",
                statePatch: {
                  stage: "BOOKING",
                  nextExpected: "booking_date_preference",
                },
                leadPatch: {},
                debugNote: "booking_pref_no_availability",
                interactiveButtons: datePrefButtons,
              };
            }
            logEvent("available_days_grouped", {
              organization_id: organizationId,
              lead_id: leadId,
              days_count: topDays.length,
            });
            const lines = topDays.map(([date, daySlots]) =>
              `${formatRequestedDayLabel(date)}: ${
                daySlots.map((s) => formatHourLabel(s.time)).join(", ")
              }`
            );
            const dateButtons: InteractiveButton[] = topDays.map(([date]) => ({
              id: `select_date:${date}`,
              title: formatRequestedDayLabel(date).slice(0, 20),
            }));
            const offeredDates = topDays.map(([date]) =>
              toBarbershopOfferedDate(
                date,
                formatRequestedDayLabel(date),
                "more_days",
                resolvedServiceKey,
              )
            );
            logEvent("barbershop_state_contract_saved_dates", {
              organization_id: organizationId,
              lead_id: leadId,
              source: "more_days",
              dates_count: offeredDates.length,
            });
            return {
              reply: selectedPref === "today"
                ? `Por hoy ya no tenemos espacios disponibles 💈\nTe puedo mostrar las próximas opciones:\n${
                  lines.join("\n")
                }`
                : `No tengo cupo para mañana. Te puedo ofrecer:\n${
                  lines.join("\n")
                }`,
              statePatch: {
                stage: "BOOKING",
                nextExpected: "date_selection",
                collected: {
                  ...(((leadState as any)?.collected ?? {}) as Record<
                    string,
                    unknown
                  >),
                  activeBookingFlow: true,
                  lastBookingStep: "select_day",
                  current_service_key: resolvedServiceKey,
                  current_service_name: serviceName ||
                    safeStr(selectedService?.name, ""),
                  last_offered_dates: offeredDates,
                },
              },
              leadPatch: {},
              debugNote: "booking_pref_next_days",
              interactiveButtons: dateButtons,
            };
          }
          const uniqueProviders = Array.from(
            new Set(
              shown.map((s) => safeStr(s.provider_name, "").trim()).filter(
                Boolean,
              ),
            ),
          );
          const timeLines = uniqueProviders.length <= 1
            ? shown.map((s) => `• ${formatHourLabel(s.time)}`).join("\n")
            : shown.map((s) =>
              `• ${formatHourLabel(s.time)} · ${s.provider_name}`
            ).join("\n");
          const hasMore = slots.length > shown.length;
          const hasLater = shown.length > 0 &&
            slots.some((s) =>
              parseTimeToMinutes(safeStr(s.time, ""), 0) >
                parseTimeToMinutes(
                  safeStr(shown[shown.length - 1]?.time, ""),
                  0,
                )
            );
          const listSlots = slots.length > 3 ? slots.slice(0, 10) : shown;
          const timeButtons = buildBarbershopAvailabilityButtons(
            shown as Array<Record<string, unknown>>,
            hasMore,
          );
          const body = hasMore
            ? formatBarbershopAvailabilityListBody(
              listSlots as Array<Record<string, unknown>>,
            )
            : formatBarbershopSlotOptionsBody({
              providerPreference: uniqueProviders.length === 1
                ? "specific"
                : "any",
              providerName: uniqueProviders[0],
              lines: timeLines,
              hasMore: false,
            }) + (hasLater ? "\nTambién tengo espacios más tarde." : "");
          const offeredSlots = listSlots.map((slot) =>
            toBarbershopOfferedSlot(
              slot as Record<string, unknown>,
              selectedService,
              serviceName || safeStr(selectedService?.name, ""),
              selectedPref,
            )
          );
          logEvent("barbershop_state_contract_saved_slots", {
            organization_id: organizationId,
            lead_id: leadId,
            source: selectedPref,
            slots_count: offeredSlots.length,
          });
          return {
            reply: body,
            statePatch: {
              stage: "BOOKING",
              nextExpected: "availability_slot_selection",
              collected: {
                ...(((leadState as any)?.collected ?? {}) as Record<
                  string,
                  unknown
                >),
                preferred_date: selectedDate,
                activeBookingFlow: true,
                lastBookingStep: "select_time",
                current_service_key: resolvedServiceKey,
                current_service_name: serviceName ||
                  safeStr(selectedService?.name, ""),
                current_date: selectedDate,
                last_availability_context: {
                  date: selectedDate,
                  service: serviceName || safeStr(selectedService?.name, ""),
                  provider_preference: providerPreference,
                  slots,
                },
                last_offered_slots: offeredSlots,
              },
            },
            leadPatch: {},
            debugNote: "booking_pref_time_menu",
            interactiveButtons: timeButtons,
            interactiveList: hasMore
              ? buildExpandedBarbershopTimeSlotsList({
                slots: listSlots as Array<Record<string, unknown>>,
                body,
                serviceName: serviceName || safeStr(selectedService?.name, ""),
                providerPreference: uniqueProviders.length === 1
                  ? "specific"
                  : "any",
              })
              : undefined,
          };
        }

        const topDays: Array<[string, any[]]> = [];
        const dateListLimit = 7;
        for (
          let offset = 0;
          offset <= maxBookingDaysAhead && topDays.length < dateListLimit;
          offset += 1
        ) {
          const d = new Date(nowLocal);
          d.setDate(d.getDate() + offset);
          const date = fmtDate(d);
          const daySlots = await getAvailableSlotsForDay({
            supabase,
            organization_id: organizationId,
            business_type: "barbershop",
            service_id: serviceId,
            service_name: serviceName || safeStr(selectedService?.name, ""),
            provider_id: providerPreference === "specific"
              ? selectedProviderId
              : null,
            provider_preference: providerPreference,
            date,
            timezone,
            max_options: maxVisibleSlots + 1,
          });
          if (daySlots.length > 0) topDays.push([date, daySlots]);
        }
        if (!topDays.length) {
          return {
            reply: "Esta semana no veo cupos disponibles por ahora.",
            statePatch: {
              stage: "BOOKING",
              nextExpected: "booking_date_preference",
            },
            leadPatch: {},
            debugNote: "booking_pref_week_empty",
            interactiveButtons: [nextDaysButton],
          };
        }
        logEvent("available_days_grouped", {
          organization_id: organizationId,
          lead_id: leadId,
          days_count: topDays.length,
        });
        logEvent("booking_more_dates_options_built", {
          organization_id: organizationId,
          lead_id: leadId,
          days_count: topDays.length,
          max_visible_days: dateListLimit,
        });
        const dateOptions = topDays.map(([date]) => ({
          date,
          label: formatRequestedDayLabel(date),
        }));
        const offeredDates = topDays.map(([date]) =>
          toBarbershopOfferedDate(
            date,
            formatRequestedDayLabel(date),
            "more_days",
            resolvedServiceKey,
          )
        );
        logEvent("barbershop_state_contract_saved_dates", {
          organization_id: organizationId,
          lead_id: leadId,
          source: "more_days",
          dates_count: offeredDates.length,
        });
        const body = "Escogé el día que querés revisar 💈";
        const fallbackBody = `Escogé el día:\n${
          dateOptions.map((item, index) => `${index + 1}. ${item.label}`).join(
            "\n",
          )
        }`;
        return {
          reply: fallbackBody,
          statePatch: {
            stage: "BOOKING",
            nextExpected: "date_selection",
            collected: {
              ...(((leadState as any)?.collected ?? {}) as Record<
                string,
                unknown
              >),
              last_offered_dates: offeredDates,
              activeBookingFlow: true,
              lastBookingStep: "select_day",
              current_service_key: resolvedServiceKey,
              current_service_name: serviceName ||
                safeStr(selectedService?.name, ""),
            },
          },
          leadPatch: {},
          debugNote: "booking_pref_week_days",
          interactiveList: dateSelectionList(dateOptions, body),
        };
      }
      if (selectedPref && !(serviceName || selectedService)) {
        const servicesList = serviceSelectionList(
          barbershopServices,
          "Perfecto 💈 Escogé el servicio:",
          true,
        );
        return {
          reply: servicesList?.body ??
            formatBarbershopServiceSelectionText(barbershopServices),
          statePatch: {
            stage: "BOOKING",
            nextExpected: "service_selection",
          },
          leadPatch: {},
          debugNote: "booking_week_missing_service",
          interactiveButtons: servicesList
            ? []
            : serviceSelectionButtons(barbershopServices),
          interactiveList: servicesList,
        };
      }
    }
    if (normalizedAction.startsWith("select_date:")) {
      const parsedDate = parseDateFromAction(normalizedAction);
      const collected = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const offeredDates = Array.isArray((collected as any)?.last_offered_dates)
        ? ((collected as any).last_offered_dates as any[])
        : [];
      const offeredDate = offeredDates.find((d: any) =>
        safeStr(d.date, "") === parsedDate
      );
      const selectedDate = safeStr(offeredDate?.date, parsedDate);
      const pending = ((collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >;
      const serviceName = safeStr(pending.service_name, "") ||
        safeStr((collected as any).current_service_name, "") ||
        safeStr((collected as any).service, "");
      const serviceKey = safeStr(pending.service_key, "") ||
        safeStr((offeredDate as any)?.service_key, "") ||
        safeStr((collected as any).current_service_key, "");
      const selectedService = (
        barbershopServices.find((s) => toServiceActionKey(s) === serviceKey) ??
          barbershopServices.find((s) =>
            normalizeTextForMatch(safeStr((s as any).name, "")) ===
              normalizeTextForMatch(serviceName)
          )
      ) ?? null;
      const serviceId = selectedService
        ? toServiceActionKey(selectedService)
        : "";
      const providerPreference = (safeStr(
          pending.provider_preference,
          safeStr((collected as any).provider_preference, "any"),
        ) === "specific")
        ? "specific"
        : "any";
      const hasProviderPreference = Boolean(
        safeStr(
          pending.provider_preference,
          safeStr((collected as any).provider_preference, ""),
        ).trim() ||
          safeStr(
            pending.provider_id,
            safeStr((collected as any).preferred_provider_id, ""),
          ).trim(),
      );
      const selectedProviderId = safeStr(
        pending.provider_id,
        safeStr((collected as any).preferred_provider_id, ""),
      );
      if (selectedDate && (serviceName || selectedService)) {
        if (!hasProviderPreference) {
          return await buildProviderPreferencePrompt(
            collected,
            selectedDate,
            toServiceActionKey(
              selectedService ?? { id: serviceKey, name: serviceName },
            ),
            serviceName || safeStr(selectedService?.name, ""),
            "booking_date_selected_provider_preference_prompt",
          );
        }
        const bookingRules = ((clinicSettings as any)?.booking_rules &&
            typeof (clinicSettings as any).booking_rules === "object")
          ? ((clinicSettings as any).booking_rules as Record<string, unknown>)
          : {};
        const maxVisibleSlots = Math.max(
          1,
          Math.min(5, Number(bookingRules.max_visible_slots ?? 3) || 3),
        );
        const slots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_id: serviceId,
          service_name: serviceName || safeStr(selectedService?.name, ""),
          provider_id: providerPreference === "specific"
            ? selectedProviderId
            : null,
          provider_preference: providerPreference,
          date: selectedDate,
          timezone: safeStr(
            (clinicSettings as any)?.timezone,
            DEFAULT_TIMEZONE,
          ),
          max_options: maxVisibleSlots + 1,
        });
        const shown = slots.slice(0, maxVisibleSlots);
        if (!shown.length) {
          return {
            reply: `No tengo horarios para ${
              formatRequestedDayLabel(selectedDate)
            }. Elegí otra fecha.`,
            statePatch: {
              stage: "BOOKING",
              nextExpected: "date_selection",
            },
            leadPatch: {},
            debugNote: "booking_interactive_no_slots_for_date",
            interactiveButtons: barberlineMenuButtons,
          };
        }
        const uniqueProviders = Array.from(
          new Set(
            shown.map((s) => safeStr(s.provider_name, "").trim()).filter(
              Boolean,
            ),
          ),
        );
        const timeLines = uniqueProviders.length <= 1
          ? shown.map((s) => `• ${formatHourLabel(s.time)}`).join("\n")
          : shown.map((s) =>
            `• ${formatHourLabel(s.time)} · ${s.provider_name}`
          ).join("\n");
        const hasMore = slots.length > shown.length;
        const timeButtons = buildBarbershopAvailabilityButtons(
          shown as Array<Record<string, unknown>>,
          hasMore,
        );
        const listSlots = slots.length > 3 ? slots.slice(0, 10) : shown;
        const body = hasMore
          ? formatBarbershopAvailabilityListBody(
            listSlots as Array<Record<string, unknown>>,
          )
          : formatBarbershopSlotOptionsBody({
            providerPreference: uniqueProviders.length === 1
              ? "specific"
              : "any",
            providerName: uniqueProviders[0],
            lines: timeLines,
            hasMore: false,
          });
        const offeredSlots = listSlots.map((slot) =>
          toBarbershopOfferedSlot(
            slot as Record<string, unknown>,
            selectedService,
            serviceName || safeStr(selectedService?.name, ""),
            "date",
          )
        );
        logEvent("barbershop_state_contract_saved_slots", {
          organization_id: organizationId,
          lead_id: leadId,
          source: "date",
          slots_count: offeredSlots.length,
        });
        return {
          reply: body,
          statePatch: {
            stage: "BOOKING",
            nextExpected: "availability_slot_selection",
            collected: {
              ...(((leadState as any)?.collected ?? {}) as Record<
                string,
                unknown
              >),
              preferred_date: selectedDate,
              activeBookingFlow: true,
              lastBookingStep: "select_time",
              current_service_key: toServiceActionKey(
                selectedService ?? { id: serviceKey, name: serviceName },
              ),
              current_service_name: serviceName ||
                safeStr(selectedService?.name, ""),
              current_date: selectedDate,
              last_availability_context: {
                date: selectedDate,
                service: serviceName || safeStr(selectedService?.name, ""),
                provider_preference: providerPreference,
                slots,
              },
              last_offered_slots: offeredSlots,
            },
          },
          leadPatch: {},
          debugNote: "booking_interactive_time_menu",
          interactiveButtons: timeButtons,
          interactiveList: hasMore
            ? buildExpandedBarbershopTimeSlotsList({
              slots: listSlots as Array<Record<string, unknown>>,
              body,
              serviceName: serviceName || safeStr(selectedService?.name, ""),
              providerPreference: uniqueProviders.length === 1
                ? "specific"
                : "any",
            })
            : undefined,
        };
      }
    }
    if (
      normalizedAction.startsWith("select_time:") ||
      normalizedAction.startsWith("select_slot:")
    ) {
      const selected = parseTimeFromAction(normalizedAction);
      const collected = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const offeredSlots = Array.isArray((collected as any)?.last_offered_slots)
        ? ((collected as any).last_offered_slots as any[])
        : [];
      const contextSlots =
        Array.isArray((collected as any)?.last_availability_context?.slots)
          ? ((collected as any).last_availability_context.slots as any[])
          : [];
      const offeredMatch = offeredSlots.find((slot: any) =>
        safeStr(slot.date, "") === selected.date &&
        safeStr(slot.time, "") === selected.time &&
        safeStr(slot.provider_id, "") === selected.providerId
      );
      const match = offeredMatch ??
        contextSlots.find((slot: any) =>
          safeStr(slot.date, "") === selected.date &&
          safeStr(slot.time, "") === selected.time &&
          safeStr(slot.provider_id, "") === selected.providerId
        );
      if (match) {
        if (offeredMatch) {
          logEvent("selected_slot_matched_from_last_offered_slots", {
            organization_id: organizationId,
            lead_id: leadId,
            selected_date: selected.date,
            selected_time: selected.time,
            provider_id: selected.providerId,
          });
        }
        const allowAdditionalBooking = Boolean(
          (collected as any)?.allow_additional_booking,
        );
        const bookingForOther = Boolean(
          (collected as any)?.booking_for_other ||
            (collected as any)?.appointment_for_relation === "other",
        );
        if (!allowAdditionalBooking && !bookingForOther) {
          const futureAppointments = await loadFutureActiveAppointmentsForLead({
            supabase,
            organizationId,
            leadId,
            timezone: safeStr(
              (clinicSettings as any)?.timezone,
              DEFAULT_TIMEZONE,
            ),
          });
          const selectedDate = safeStr(match.date, "");
          const sameDayActive = futureAppointments.find((appt) =>
            safeStr(
              appt.appointment_date,
              safeStr(appt.starts_at, "").slice(0, 10),
            ) === selectedDate
          );
          if (sameDayActive) {
            const activeService = toPatientFacingServiceLabel(
              safeStr(
                (sameDayActive as any).reason,
                safeStr((sameDayActive as any).title, "Cita"),
              ),
            );
            const activeTime = safeStr(
              (sameDayActive as any).appointment_time,
              safeStr((sameDayActive as any).starts_at, "").slice(11, 16),
            );
            logEvent("active_appointment_guard_triggered", {
              organization_id: organizationId,
              lead_id: leadId,
              active_appointment_id: safeStr((sameDayActive as any).id, ""),
            });
            logEvent("duplicate_appointment_prevented", {
              organization_id: organizationId,
              lead_id: leadId,
              selected_date: selectedDate,
              selected_time: safeStr(match.time, ""),
            });
            return {
              reply: formatBarbershopAppointmentConflictReply({
                appointment_date: selectedDate,
                appointment_time: activeTime,
              }),
              statePatch: {
                stage: "BOOKING",
                nextExpected: "active_appointment_intent_choice",
                collected: {
                  ...collected,
                  active_appointment: {
                    id: safeStr((sameDayActive as any).id, ""),
                    reason: activeService,
                    appointment_date: selectedDate,
                    appointment_time: activeTime,
                    starts_at: safeStr(
                      (sameDayActive as any).starts_at,
                      `${selectedDate}T${activeTime}:00`,
                    ),
                    status: safeStr((sameDayActive as any).status, "confirmed"),
                  },
                },
              },
              leadPatch: {},
              debugNote: "booking_interactive_active_appointment_guard",
              interactiveButtons: barbershopAppointmentConflictButtons(),
            };
          }
        }
        const selectedSlot = {
          service_key: safeStr(
            match.service_key,
            safeStr((collected as any)?.pending_booking?.service_key, ""),
          ),
          service_name: safeStr(
            match.service_name,
            safeStr((collected as any)?.pending_booking?.service_name, ""),
          ),
          date: safeStr(match.date, ""),
          time: safeStr(match.time, ""),
          starts_at: safeStr(match.starts_at, ""),
          provider_id: safeStr(match.provider_id, ""),
          provider_name: safeStr(match.provider_name, ""),
          duration_min: Number(match.duration_min ?? 30) || 30,
          source: safeStr(
            match.source,
            offeredMatch ? "last_offered_slots" : "availability_context",
          ),
        };
        const selectedServiceForHold = barbershopServices.find((s) =>
          toServiceActionKey(s) === safeStr(selectedSlot.service_key, "") ||
          normalizeTextForMatch(safeStr(s.name, "")) ===
            normalizeTextForMatch(safeStr(selectedSlot.service_name, ""))
        ) ?? null;
        const holdResult = await holdSelectedBarbershopSlot({
          supabase,
          organizationId,
          leadId,
          timezone,
          selectedSlot,
          serviceName: safeStr(
            selectedSlot.service_name,
            safeStr((collected as any)?.pending_booking?.service_name, ""),
          ),
          serviceId: safeStr(selectedServiceForHold?.id, ""),
        });
        if (!holdResult.ok) {
          const alternatives = (holdResult.alternatives ?? []).slice(0, 3);
          const altLines = alternatives
            .map((slot) =>
              `${formatHourLabel(safeStr(slot.time, ""))} · ${
                safeStr(slot.provider_name, "Barbero")
              }`
            )
            .filter(Boolean)
            .join("\n");
          return {
            reply: holdResult.reason === "active_hold_conflict"
              ? `Ese espacio está siendo reservado en este momento.${
                altLines
                  ? `\n\nTengo estas opciones cercanas:\n${altLines}\n¿Cuál te queda mejor?`
                  : "\n\n¿Querés que te muestre otros horarios?"
              }`
              : `Ese horario ya no está disponible.${
                altLines
                  ? `\n\nTengo estas opciones cercanas:\n${altLines}\n¿Cuál te queda mejor?`
                  : "\n\n¿Querés que te muestre otros horarios?"
              }`,
            statePatch: {
              stage: "BOOKING",
              nextExpected: "availability_slot_selection",
              collected: {
                ...collected,
                pending_booking: null,
                pending_booking_stale: true,
                last_offered_slots: alternatives.map((slot) =>
                  toBarbershopOfferedSlot(
                    slot as Record<string, unknown>,
                    selectedServiceForHold,
                    safeStr(selectedSlot.service_name, ""),
                    "exact_alternative",
                  )
                ),
              },
            },
            leadPatch: {},
            debugNote: "booking_hold_not_created",
          };
        }
        const heldSelectedSlot = holdResult.selected_slot;
        const pendingBooking = {
          service_key: safeStr(heldSelectedSlot.service_key, ""),
          service_name: safeStr(heldSelectedSlot.service_name, ""),
          service: safeStr(
            heldSelectedSlot.service_name,
            safeStr((collected as any)?.pending_booking?.service_name, ""),
          ),
          appointment_date: safeStr(heldSelectedSlot.date, ""),
          appointment_time: safeStr(heldSelectedSlot.time, ""),
          starts_at: safeStr(heldSelectedSlot.starts_at, ""),
          provider_id: safeStr(heldSelectedSlot.provider_id, ""),
          provider_name: safeStr(heldSelectedSlot.provider_name, ""),
          selected_slot: heldSelectedSlot,
          hold_id: safeStr(heldSelectedSlot.hold_id, ""),
          status: "pending_confirmation",
        };
        const customerName = resolveReliableBarbershopCustomerName(leadState, {
          ...collected,
          ...pendingBooking,
        });
        logEvent("booking_selected_slot_saved", {
          organization_id: organizationId,
          lead_id: leadId,
          selected_slot: heldSelectedSlot,
        });
        logEvent("selected_slot_reused", {
          organization_id: organizationId,
          lead_id: leadId,
          selected_slot: heldSelectedSlot,
        });
        if (!customerName) {
          return {
            reply: "¿A nombre de quién dejamos la cita?",
            statePatch: {
              stage: "BOOKING",
              nextExpected: "customer_name",
              collected: {
                ...collected,
                service: pendingBooking.service,
                preferred_date: pendingBooking.appointment_date,
                preferred_time: pendingBooking.appointment_time,
                current_service_key: safeStr(heldSelectedSlot.service_key, ""),
                current_service_name: safeStr(
                  heldSelectedSlot.service_name,
                  "",
                ),
                current_date: safeStr(heldSelectedSlot.date, ""),
                selected_slot: heldSelectedSlot,
                pending_booking: pendingBooking,
                pending_booking_stale: false,
                activeBookingFlow: true,
                lastBookingStep: "name_input",
              },
            },
            leadPatch: {},
            debugNote: "barberline_require_name_before_confirmation",
          };
        }
        const pendingBookingWithName = {
          ...pendingBooking,
          patient_name: customerName,
          customer_name: customerName,
          client_name: customerName,
        };
        return {
          reply: formatBarbershopConfirmationSummary(
            pendingBookingWithName,
            customerName,
          ),
          statePatch: {
            stage: "CONFIRMING",
            nextExpected: "confirm_booking",
            collected: {
              ...collected,
              service: pendingBookingWithName.service,
              preferred_date: pendingBookingWithName.appointment_date,
              preferred_time: pendingBookingWithName.appointment_time,
              current_service_key: safeStr(heldSelectedSlot.service_key, ""),
              current_service_name: safeStr(heldSelectedSlot.service_name, ""),
              current_date: safeStr(heldSelectedSlot.date, ""),
              selected_slot: heldSelectedSlot,
              patient_name: customerName,
              customer_name: customerName,
              client_name: customerName,
              pending_booking: pendingBookingWithName,
              pending_booking_stale: false,
            },
          },
          leadPatch: {},
          debugNote: "booking_interactive_preconfirm",
          interactiveButtons: [
            { id: "confirm_booking", title: "Confirmar" },
            { id: "change_booking_slot", title: "Cambiar hora" },
            { id: "talk_to_human", title: "Hablar con alguien" },
          ],
        };
      }
    }
    if (normalizedAction.startsWith("booking_time_block:")) {
      const blockRaw = normalizePayloadActionValue(normalizedAction).replace(
        /^booking_time_block:/,
        "",
      );
      const block = blockRaw === "morning" || blockRaw === "afternoon"
        ? blockRaw
        : null;
      const collected = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const selectedDate = safeStr(
        (collected as any).current_date,
        safeStr((collected as any).preferred_date, ""),
      );
      const pending = ((collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >;
      const serviceName = safeStr(
        (collected as any).current_service_name,
        safeStr(pending.service_name, safeStr((collected as any).service, "")),
      );
      const serviceKey = safeStr(
        (collected as any).current_service_key,
        safeStr(pending.service_key, ""),
      );
      const selectedService = barbershopServices.find((s) =>
        toServiceActionKey(s) === serviceKey ||
        normalizeTextForMatch(safeStr(s.name, "")) ===
          normalizeTextForMatch(serviceName)
      ) ?? null;
      if (block && selectedDate && (serviceName || selectedService)) {
        const resolvedServiceName = serviceName ||
          safeStr(selectedService?.name, "");
        const blockSlots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_id: safeStr(selectedService?.id, ""),
          service_name: resolvedServiceName,
          provider_preference: "any",
          date: selectedDate,
          time_preference: block,
          timezone,
          max_options: 40,
        });
        const shown = blockSlots.slice(0, 3);
        const blockLabel = formatTimeBlockLabel(block);
        if (shown.length > 0) {
          const lines = shown
            .map((slot) =>
              `${formatHourLabel(safeStr(slot.time, ""))} · ${
                safeStr(slot.provider_name, "Barbero")
              }`
            )
            .join("\n");
          const offeredSlots = shown.map((slot) =>
            toBarbershopOfferedSlot(
              slot as Record<string, unknown>,
              selectedService,
              resolvedServiceName,
              "date",
            )
          );
          logEvent("barbershop_state_contract_saved_slots", {
            organization_id: organizationId,
            lead_id: leadId,
            source: block,
            slots_count: offeredSlots.length,
          });
          return {
            reply: `Disponible ${
              formatRequestedDayLabel(selectedDate).toLowerCase()
            } en ${blockLabel}:\n\n${lines}\n\nTambién podés decirme otra hora.`,
            statePatch: {
              stage: "BOOKING",
              nextExpected: "availability_slot_selection",
              collected: {
                ...collected,
                activeBookingFlow: true,
                lastBookingStep: "select_time",
                current_service_key: toServiceActionKey(
                  selectedService ??
                    { id: serviceKey, name: resolvedServiceName },
                ),
                current_service_name: resolvedServiceName,
                current_date: selectedDate,
                preferred_date: selectedDate,
                last_availability_context: {
                  date: selectedDate,
                  service: resolvedServiceName,
                  provider_preference: "any",
                  time_preference: block,
                  slots: blockSlots,
                },
                last_offered_slots: offeredSlots,
              },
            },
            leadPatch: {},
            debugNote: "booking_time_block_followup",
            interactiveButtons: shown.map((slot) => ({
              id: `select_time:${slot.date}|${slot.time}|${slot.provider_id}`,
              title: formatHourLabel(slot.time).slice(0, 20),
            })),
          };
        }
        logEvent("time_block_followup_no_slots", {
          organization_id: organizationId,
          lead_id: leadId,
          block,
          current_date: selectedDate,
        });
        const alternatives = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_id: safeStr(selectedService?.id, ""),
          service_name: resolvedServiceName,
          provider_preference: "any",
          date: selectedDate,
          timezone,
          max_options: 40,
        });
        const shownAlternatives = alternatives.slice(0, 3);
        const altLines = shownAlternatives
          .map((slot) =>
            `${formatHourLabel(safeStr(slot.time, ""))} · ${
              safeStr(slot.provider_name, "Barbero")
            }`
          )
          .join("\n");
        const offeredSlots = shownAlternatives.map((slot) =>
          toBarbershopOfferedSlot(
            slot as Record<string, unknown>,
            selectedService,
            resolvedServiceName,
            "date",
          )
        );
        return {
          reply: altLines
            ? `No tengo espacios en ${blockLabel} para ${
              formatRequestedDayLabel(selectedDate).toLowerCase()
            }.\n\nTengo estas opciones:\n${altLines}\n\n¿Te sirve una de esas?`
            : `No tengo espacios en ${blockLabel} para ${
              formatRequestedDayLabel(selectedDate).toLowerCase()
            }.\n\n¿Querés que busque otro día?`,
          statePatch: {
            stage: "BOOKING",
            nextExpected: shownAlternatives.length > 0
              ? "availability_slot_selection"
              : "booking_date_preference",
            collected: {
              ...collected,
              activeBookingFlow: true,
              lastBookingStep: "select_time",
              current_service_key: toServiceActionKey(
                selectedService ??
                  { id: serviceKey, name: resolvedServiceName },
              ),
              current_service_name: resolvedServiceName,
              current_date: selectedDate,
              preferred_date: selectedDate,
              last_offered_slots: offeredSlots,
            },
          },
          leadPatch: {},
          debugNote: "booking_time_block_followup_empty",
          interactiveButtons: shownAlternatives.map((slot) => ({
            id: `select_time:${slot.date}|${slot.time}|${slot.provider_id}`,
            title: formatHourLabel(slot.time).slice(0, 20),
          })),
        };
      }
    }
    if (normalizedAction === "booking_more_hours") {
      logEvent("more_hours_requested", {
        organization_id: organizationId,
        lead_id: leadId,
        source: "payload_action",
      });
      const collected = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const selectedDate = safeStr(
        (collected as any).preferred_date,
        safeStr((collected as any).current_date, ""),
      );
      const pending = ((collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >;
      const serviceName = safeStr(
        pending.service_name,
        safeStr(
          (collected as any).current_service_name,
          safeStr(
            (collected as any).current_service_key,
            safeStr((collected as any).service, ""),
          ),
        ),
      );
      const serviceKey = safeStr(
        pending.service_key,
        safeStr((collected as any).current_service_key, ""),
      );
      const providerPreference = (safeStr(
          pending.provider_preference,
          safeStr((collected as any).provider_preference, "any"),
        ) === "specific")
        ? "specific"
        : "any";
      const selectedProviderId = safeStr(
        pending.provider_id,
        safeStr((collected as any).preferred_provider_id, ""),
      );
      const selectedService = barbershopServices.find((s) =>
        toServiceActionKey(s) === serviceKey ||
        normalizeTextForMatch(safeStr(s.name, "")) ===
          normalizeTextForMatch(serviceName)
      ) ?? null;
      if (selectedDate && (serviceName || selectedService)) {
        const allSlots = await getAvailableSlotsForDay({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_id: safeStr(selectedService?.id, ""),
          service_name: serviceName || safeStr(selectedService?.name, ""),
          provider_id: providerPreference === "specific"
            ? selectedProviderId
            : null,
          provider_preference: providerPreference,
          date: selectedDate,
          timezone,
          max_options: 40,
        });
        const shownOffset = Number(
          (collected as any).availability_shown_offset ?? 0,
        );
        const nextOffset = Math.max(0, shownOffset + 2);
        const remainingSlots = allSlots.slice(nextOffset);
        const shown = remainingSlots.slice(0, 6);
        if (!shown.length) {
          return {
            reply:
              "Para ese día ya no tengo más horarios. ¿Querés que te muestre más días?",
            statePatch: {
              stage: "BOOKING",
              nextExpected: "booking_date_preference",
              collected: { ...collected, availability_shown_offset: 0 },
            },
            leadPatch: {},
            debugNote: "booking_more_hours_empty",
            interactiveButtons: datePrefButtons,
          };
        }
        const lines = providerPreference === "specific"
          ? shown.map((s) =>
            `• ${formatHourLabel(s.time)}`
          ).join("\n")
          : shown.map((s) =>
            `• ${formatHourLabel(s.time)} · ${
              safeStr(s.provider_name, "Barbero")
            }`
          ).join("\n");
        const offeredSlots = remainingSlots.slice(0, 10).map((slot) =>
          toBarbershopOfferedSlot(
            slot as Record<string, unknown>,
            selectedService,
            serviceName || safeStr(selectedService?.name, ""),
            "more_hours",
          )
        );
        logEvent("barbershop_state_contract_saved_slots", {
          organization_id: organizationId,
          lead_id: leadId,
          source: "more_hours",
          slots_count: offeredSlots.length,
        });
        return {
          reply: `Tengo estos otros horarios para ${
            formatRequestedDayLabel(selectedDate)
          }:\n\n${lines}\n\nTambién podés decirme otra hora.`,
          statePatch: {
            stage: "BOOKING",
            nextExpected: "availability_slot_selection",
            collected: {
              ...collected,
              availability_shown_offset: nextOffset,
              activeBookingFlow: true,
              lastBookingStep: "select_time",
              current_service_key: toServiceActionKey(
                selectedService ?? { id: serviceKey, name: serviceName },
              ),
              current_service_name: serviceName ||
                safeStr(selectedService?.name, ""),
              current_date: selectedDate,
              provider_preference: providerPreference,
              preferred_provider_id: providerPreference === "specific"
                ? selectedProviderId
                : "",
              last_offered_slots: offeredSlots,
            },
          },
          leadPatch: {},
          debugNote: "booking_more_hours_shown",
          interactiveList: buildExpandedBarbershopTimeSlotsList({
            slots: remainingSlots as Array<Record<string, unknown>>,
            body: `Tengo estos otros horarios para ${
              formatRequestedDayLabel(selectedDate)
            }:\n\n${lines}\n\nEscogé una hora de la lista.`,
            serviceName: serviceName || safeStr(selectedService?.name, ""),
            providerPreference,
          }),
        };
      }
    }
    if (normalizedAction.startsWith("booking_exact_time:")) {
      const collected = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const m = normalizedAction.match(
        /^booking_exact_time:([^|]+)\|(\d{2}:\d{2})$/,
      );
      const requestedDate = safeStr(m?.[1], "");
      const requestedTime = safeStr(m?.[2], "");
      const pending = ((collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >;
      const serviceName = safeStr(
        pending.service_name,
        safeStr(
          (collected as any).current_service_name,
          safeStr(
            (collected as any).current_service_key,
            safeStr((collected as any).service, ""),
          ),
        ),
      );
      const serviceKey = safeStr(
        pending.service_key,
        safeStr((collected as any).current_service_key, ""),
      );
      const selectedService = barbershopServices.find((s) =>
        toServiceActionKey(s) === serviceKey ||
        normalizeTextForMatch(safeStr(s.name, "")) ===
          normalizeTextForMatch(serviceName)
      ) ?? null;
      if (requestedDate && requestedTime && (serviceName || selectedService)) {
        const exact = await checkSlotAvailability({
          supabase,
          organization_id: organizationId,
          business_type: "barbershop",
          service_id: safeStr(selectedService?.id, ""),
          service_name: serviceName || safeStr(selectedService?.name, ""),
          provider_preference: "any",
          date: requestedDate,
          specific_time: requestedTime,
          timezone,
          max_options: 8,
        });
        if (exact.available && exact.slot) {
          logEvent("exact_time_available", {
            organization_id: organizationId,
            lead_id: leadId,
            requested_date: requestedDate,
            requested_time: requestedTime,
          });
          const selectedSlot = exact.slot;
          const selectedSlotContract = {
            service_key: safeStr(selectedSlot.service_key, serviceKey),
            service_name: safeStr(selectedSlot.service_name, serviceName),
            date: requestedDate,
            time: requestedTime,
            starts_at: safeStr(
              selectedSlot.starts_at,
              `${requestedDate}T${requestedTime}:00`,
            ),
            provider_id: safeStr(selectedSlot.provider_id, ""),
            provider_name: safeStr(selectedSlot.provider_name, ""),
            duration_min: Number(
              (selectedSlot as any).duration_min ??
                (selectedService as any)?.duration_min ?? 30,
            ) || 30,
            source: "exact_time",
          };
          const holdResult = await holdSelectedBarbershopSlot({
            supabase,
            organizationId,
            leadId,
            timezone,
            selectedSlot: selectedSlotContract,
            serviceName: serviceName || safeStr(selectedService?.name, ""),
            serviceId: safeStr(selectedService?.id, ""),
          });
          if (!holdResult.ok) {
            const alternatives = (holdResult.alternatives ?? []).slice(0, 3);
            const altLines = alternatives
              .map((slot) =>
                `${formatHourLabel(safeStr(slot.time, ""))} · ${
                  safeStr(slot.provider_name, "Barbero")
                }`
              )
              .filter(Boolean)
              .join("\n");
            return {
              reply: holdResult.reason === "active_hold_conflict"
                ? `Ese espacio está siendo reservado en este momento.${
                  altLines
                    ? `\n\nTengo estas opciones cercanas:\n${altLines}\n¿Cuál te queda mejor?`
                    : "\n\n¿Querés que te muestre otros horarios?"
                }`
                : `Ese horario ya no está disponible.${
                  altLines
                    ? `\n\nTengo estas opciones cercanas:\n${altLines}\n¿Cuál te queda mejor?`
                    : "\n\n¿Querés que te muestre otros horarios?"
                }`,
              statePatch: {
                stage: "BOOKING",
                nextExpected: "availability_slot_selection",
                collected: {
                  ...collected,
                  pending_booking: null,
                  pending_booking_stale: true,
                  last_offered_slots: alternatives.map((slot) =>
                    toBarbershopOfferedSlot(
                      slot as Record<string, unknown>,
                      selectedService,
                      serviceName || safeStr(selectedService?.name, ""),
                      "exact_alternative",
                    )
                  ),
                },
              },
              leadPatch: {},
              debugNote: "booking_exact_time_hold_not_created",
            };
          }
          const heldSelectedSlot = holdResult.selected_slot;
          const pendingBooking = {
            ...pending,
            service_key: safeStr(heldSelectedSlot.service_key, serviceKey),
            service_name: safeStr(heldSelectedSlot.service_name, serviceName),
            service: safeStr(heldSelectedSlot.service_name, serviceName),
            appointment_date: requestedDate,
            appointment_time: requestedTime,
            starts_at: safeStr(
              heldSelectedSlot.starts_at,
              `${requestedDate}T${requestedTime}:00`,
            ),
            provider_id: safeStr(heldSelectedSlot.provider_id, ""),
            provider_name: safeStr(heldSelectedSlot.provider_name, ""),
            selected_slot: heldSelectedSlot,
            hold_id: safeStr(heldSelectedSlot.hold_id, ""),
            status: "pending_confirmation",
          };
          const customerName = resolveReliableBarbershopCustomerName(
            leadState,
            { ...collected, ...pendingBooking },
          );
          if (!customerName) {
            return {
              reply: "¿A nombre de quién dejamos la cita?",
              statePatch: {
                stage: "BOOKING",
                nextExpected: "customer_name",
                collected: {
                  ...collected,
                  preferred_date: requestedDate,
                  preferred_time: requestedTime,
                  activeBookingFlow: true,
                  lastBookingStep: "name_input",
                  current_service_key: safeStr(
                    heldSelectedSlot.service_key,
                    serviceKey,
                  ),
                  current_service_name: safeStr(
                    heldSelectedSlot.service_name,
                    serviceName,
                  ),
                  current_date: requestedDate,
                  selected_slot: heldSelectedSlot,
                  pending_booking_stale: false,
                  pending_booking: pendingBooking,
                },
              },
              leadPatch: {},
              debugNote:
                "barberline_require_name_before_exact_time_confirmation",
            };
          }
          const pendingBookingWithName = {
            ...pendingBooking,
            patient_name: customerName,
            customer_name: customerName,
            client_name: customerName,
          };
          return {
            reply: formatBarbershopConfirmationSummary(
              pendingBookingWithName,
              customerName,
            ),
            statePatch: {
              stage: "CONFIRMING",
              nextExpected: "confirm_booking",
              collected: {
                ...collected,
                preferred_date: requestedDate,
                preferred_time: requestedTime,
                activeBookingFlow: true,
                lastBookingStep: "confirm_booking",
                current_service_key: safeStr(
                  heldSelectedSlot.service_key,
                  serviceKey,
                ),
                current_service_name: safeStr(
                  heldSelectedSlot.service_name,
                  serviceName,
                ),
                current_date: requestedDate,
                selected_slot: heldSelectedSlot,
                pending_booking_stale: false,
                patient_name: customerName,
                customer_name: customerName,
                client_name: customerName,
                pending_booking: pendingBookingWithName,
              },
            },
            leadPatch: {},
            debugNote: "booking_exact_time_preconfirm",
            interactiveButtons: [
              { id: "confirm_booking", title: "Confirmar" },
              { id: "change_booking_slot", title: "Cambiar hora" },
              { id: "talk_to_human", title: "Hablar con alguien" },
            ],
          };
        }
        logEvent("exact_time_unavailable", {
          organization_id: organizationId,
          lead_id: leadId,
          requested_date: requestedDate,
          requested_time: requestedTime,
        });
        const alternatives = Array.isArray(exact.alternatives)
          ? exact.alternatives
          : [];
        const requestedMin = parseTimeToMinutes(requestedTime, 0);
        const near = alternatives
          .slice()
          .sort((a, b) =>
            Math.abs(
              parseTimeToMinutes(safeStr(a.time, ""), 0) - requestedMin,
            ) -
            Math.abs(parseTimeToMinutes(safeStr(b.time, ""), 0) - requestedMin)
          )
          .slice(0, 3);
        const altLines = near.map((s) =>
          `${formatHourLabel(safeStr(s.time, ""))} · ${
            safeStr(s.provider_name, "Barbero")
          }`
        ).join("\n");
        const offeredSlots = near.map((slot) =>
          toBarbershopOfferedSlot(
            slot as Record<string, unknown>,
            selectedService,
            serviceName || safeStr(selectedService?.name, ""),
            "exact_alternative",
          )
        );
        logEvent("barbershop_state_contract_saved_slots", {
          organization_id: organizationId,
          lead_id: leadId,
          source: "exact_alternative",
          slots_count: offeredSlots.length,
        });
        return {
          reply: `A las ${formatHourLabel(requestedTime)} no tengo cupo para ${
            serviceName || safeStr(selectedService?.name, "ese servicio")
          }.\n\nTengo estas opciones cercanas:\n${altLines}\n¿Cuál te queda mejor?`,
          statePatch: {
            stage: "BOOKING",
            nextExpected: "availability_slot_selection",
            collected: {
              ...collected,
              preferred_date: requestedDate,
              preferred_time: requestedTime,
              activeBookingFlow: true,
              lastBookingStep: "select_time",
              current_service_key: toServiceActionKey(
                selectedService ?? { id: serviceKey, name: serviceName },
              ),
              current_service_name: serviceName ||
                safeStr(selectedService?.name, ""),
              current_date: requestedDate,
              last_offered_slots: offeredSlots,
            },
          },
          leadPatch: {},
          debugNote: "booking_exact_time_unavailable",
        };
      }
    }

    const flowDecision = shouldUseBookingFlowCta({
      businessType: normalizedBusinessType,
      engineResult,
      clinicSettings,
    });
    const flowBodyText =
      "Claro 💈 Te ayudo a agendar.\n\nTocá aquí para elegir servicio, fecha y hora.";
    if (flowDecision.enabled) {
      logEvent("booking_flow_cta_requested", {
        organization_id: organizationId,
        lead_id: leadId,
        flow_id: flowDecision.flowId,
      });
      const statePatch = mergeStatePatches(
        ((engineResult as any)?.statePatch ?? {}) as Json,
        {
          stage: "BOOKING",
          nextExpected: "flow_booking_submission",
          last_bot_step: "booking_flow_cta_sent",
          conversation_mode: "flow_active",
          active_flow: "booking",
          flow_started_at: nowIso(),
        },
      );
      logEvent("booking_flow_cta_sent", {
        organization_id: organizationId,
        lead_id: leadId,
        flow_id: flowDecision.flowId,
      });
      return {
        reply: flowBodyText,
        statePatch,
        leadPatch: {},
        debugNote: "booking_flow_cta",
        flowCta: {
          bodyText: flowBodyText,
          ctaText: "Agendar cita",
          flowId: flowDecision.flowId,
          flowToken: flowDecision.flowToken || undefined,
          flowAction: "navigate",
          flowActionPayload: {
            screen: "BOOKING_WELCOME",
            data: {
              organization_id: organizationId,
              lead_id: leadId,
            },
          },
        },
      };
    }
    if (
      flowDecision.reason === "missing_flow_id" ||
      flowDecision.reason === "flow_disabled"
    ) {
      logEvent("booking_flow_missing_config_fallback_chat", {
        organization_id: organizationId,
        lead_id: leadId,
        reason: flowDecision.reason,
      });
      const dbg = (engineResult as any)?.debug ?? {};
      const isBookingIntent = ["book_appointment", "booking_request"].includes(
        safeStr(dbg.intent, "").toLowerCase(),
      ) ||
        safeStr(dbg?.barbershop_interpreter?.intent, "").toLowerCase() ===
          "booking_request";
      const statePatch = ((engineResult as any)?.statePatch ?? {}) as Record<
        string,
        unknown
      >;
      const patchCollected = (statePatch.collected ?? {}) as Record<
        string,
        unknown
      >;
      const contextHasDate = Boolean(
        safeStr(patchCollected.preferred_date, ""),
      );
      const contextHasTime = Boolean(
        safeStr(patchCollected.preferred_time, ""),
      );
      const pendingRequest =
        (patchCollected.pending_booking_request ?? {}) as Record<
          string,
          unknown
        >;
      const pendingHasDate = Boolean(
        safeStr(pendingRequest.preferred_date, ""),
      );
      const pendingHasTime = Boolean(
        safeStr(pendingRequest.preferred_time, ""),
      );
      const inboundHasDateOrTime = hasNaturalDateOrTimeSignal(inboundText);
      const replyToken = safeStr((engineResult as any)?.replyText, "");
      const engineAlreadyHandlingBooking =
        replyToken === "__CHECK_REQUESTED_AVAILABILITY__" ||
        replyToken === "__SHOW_AVAILABILITY_FOR_DATE__" ||
        replyToken === "__SHOW_NEARBY_TIME_ALTERNATIVES__" ||
        replyToken === "__SHOW_AVAILABILITY__";
      const shouldForceBookingMenu = isBookingIntent &&
        !normalizedAction &&
        !inboundHasDateOrTime &&
        !contextHasDate &&
        !contextHasTime &&
        !pendingHasDate &&
        !pendingHasTime &&
        !engineAlreadyHandlingBooking;

      if (shouldForceBookingMenu) {
        if (isAmbiguousBarbershopServiceRequest(inboundText)) {
          const servicesList = serviceSelectionList(
            barbershopServices,
            "Perfecto 💈 Escogé el servicio:",
            true,
          );
          logEvent("booking_service_ambiguous_show_service_menu", {
            organization_id: organizationId,
            lead_id: leadId,
            inbound_text: inboundText,
          });
          return {
            reply: servicesList?.body ?? "Perfecto 💈 Elegí el servicio:",
            statePatch: mergeStatePatches(
              ((engineResult as any)?.statePatch ?? {}) as Json,
              {
                stage: "BOOKING",
                nextExpected: "service_selection",
                last_bot_step: "booking_service_menu_sent",
              },
            ),
            leadPatch: {},
            debugNote: "booking_interactive_ambiguous_service_menu",
            interactiveButtons: servicesList
              ? []
              : serviceSelectionButtons(barbershopServices),
            interactiveList: servicesList,
          };
        }
        const knownService = safeStr(patchCollected.service, "") ||
          safeStr((pendingRequest as any).service_name, "") ||
          safeStr((pendingRequest as any).service, "");
        if (knownService) {
          logEvent("select_service_asks_preference", {
            organization_id: organizationId,
            lead_id: leadId,
            service_name: knownService,
          });
          return {
            reply: "¿Qué día te queda mejor?",
            statePatch: mergeStatePatches(
              ((engineResult as any)?.statePatch ?? {}) as Json,
              {
                stage: "BOOKING",
                nextExpected: "booking_date_preference",
              },
            ),
            leadPatch: {},
            debugNote: "booking_interactive_ask_date_preference_from_intent",
            interactiveButtons: datePrefButtons,
          };
        }
        logEvent("barberline_main_menu_blocked_by_intent", {
          organization_id: organizationId,
          lead_id: leadId,
          intent: "booking_request",
        });
        logEvent("barberline_runtime_branch_bypassed_old_menu", {
          organization_id: organizationId,
          lead_id: leadId,
          bypassed_branch: "booking_interactive_menu",
        });
        const servicesList = serviceSelectionList(
          barbershopServices,
          "Perfecto 💈 Escogé el servicio:",
          true,
        );
        return {
          reply: servicesList?.body ??
            formatBarbershopServiceSelectionText(barbershopServices),
          statePatch: mergeStatePatches(
            ((engineResult as any)?.statePatch ?? {}) as Json,
            {
              stage: "BOOKING",
              nextExpected: "service_selection",
              last_bot_step: "booking_service_menu_sent",
              collected: {
                ...patchCollected,
                activeBookingFlow: true,
                lastBookingStep: "select_service",
              },
            },
          ),
          leadPatch: {},
          debugNote: "booking_interactive_service_menu_from_booking_intent",
          interactiveButtons: servicesList
            ? []
            : serviceSelectionButtons(barbershopServices),
          interactiveList: servicesList,
        };
      }
    }
    if (normalizedAction === "view_prices") {
      const body =
        `Estos son los servicios disponibles en *${brandName}* 💈\n\nEscogé uno para ver disponibilidad y agendar.`;
      const servicesList = serviceSelectionList(barbershopServices, body, true);
      return {
        reply: servicesList?.body ??
          formatBarbershopServiceSelectionText(barbershopServices),
        statePatch: {
          stage: "BOOKING",
          lastIntent: "services",
          nextExpected: "service_selection",
        },
        leadPatch: {},
        debugNote: "booking_interactive_services_picker",
        interactiveButtons: servicesList
          ? []
          : serviceSelectionButtons(barbershopServices),
        interactiveList: servicesList,
      };
    }
    if (normalizedAction === "view_location") {
      return {
        reply: `Estamos en ${
          resolveBarbershopPublicLocationFromSettings(clinicSettings)
        } 💈\n\n¿Querés reservar un espacio?`,
        statePatch: { stage: "DISCOVERY", lastIntent: "location" },
        leadPatch: {},
        debugNote: "booking_interactive_view_location",
        interactiveButtons: [
          { id: "booking_start", title: "Agendar cita" },
          { id: "talk_to_human", title: "Hablar con alguien" },
        ],
      };
    }
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
  logEvent("outbound_message_persisted", {
    organization_id: organizationId,
    lead_id: leadId || null,
    channel,
    channel_user_id: recipientId,
    message_id: outMsgInsert.data?.id ?? null,
    actor,
  });

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
    throw new Error(
      `manual_outbound_message_insert_failed:${ins.error.message}`,
    );
  }
  logEvent("manual_outbound_message_persisted", {
    organization_id: organizationId,
    lead_id: leadId || null,
    channel,
    channel_user_id: recipientId,
    message_id: ins.data?.id ?? null,
  });
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
  inboundMessageId?: string | null;
}): Promise<{ updated: boolean; nextState: Json }> {
  const {
    supabase,
    leadId,
    reply,
    leadState,
    statePatch,
    leadPatch,
    businessType,
    inboundMessageId,
  } = args;
  if (!leadId) return { updated: false, nextState: {} };

  if (leadPatch && Object.keys(leadPatch).length > 0) {
    const leadPatchRes = await supabase
      .from("leads")
      .update(leadPatch)
      .eq("id", leadId);

    if (leadPatchRes.error) {
      throw new Error(`lead_patch_update_failed:${leadPatchRes.error.message}`);
    }
  }

  const resolvedBusinessType = safeStr(
    businessType,
    safeStr(
      (statePatch as any)?.orgType,
      safeStr((leadState as any)?.orgType, ""),
    ),
  );
  const nextState = normalizeLeadStateForBusinessType(
    mergeLeadState(leadState, {
      ...statePatch,
      last_bot_text: reply,
      last_bot_message_type: inferBotMessageType(reply, statePatch),
      ...(safeStr(inboundMessageId, "").trim()
        ? {
          last_processed_inbound_message_id: safeStr(inboundMessageId, "")
            .trim(),
        }
        : {}),
    }),
    resolvedBusinessType,
  );
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
  return { updated: true, nextState };
}

async function activateHumanTakeoverForLead(args: {
  supabase: SupabaseClientType;
  leadId: string;
  source: "human_replied_from_dashboard" | "human_replied_from_whatsapp_app";
  actor: string;
  executionId: string;
  organizationId: string;
}) {
  if (!args.leadId) return;
  const leadRes = await args.supabase
    .from("leads")
    .select("state")
    .eq("id", args.leadId)
    .maybeSingle();
  if (leadRes.error) return;
  const prevState = ((leadRes.data?.state ?? {}) as Record<string, unknown>) ??
    {};
  const nextState = activateHumanTakeoverState({
    state: prevState,
    source: args.source,
    actor: args.actor,
    pauseMinutes: 60,
  });
  const updateRes = await args.supabase
    .from("leads")
    .update({ state: nextState })
    .eq("id", args.leadId);
  if (!updateRes.error) {
    logEvent("human_takeover_activated", {
      execution_id: args.executionId,
      organization_id: args.organizationId,
      lead_id: args.leadId,
      human_takeover_source: args.source,
      bot_paused_until: safeStr((nextState as any).bot_paused_until, ""),
      last_human_actor: safeStr((nextState as any).last_human_actor, ""),
    });
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
    updates.payload = {
      ...originalPayload,
      meta_response: metaResponse ?? null,
    };
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
  const scheduledFor = new Date(Date.now() + delayMin * 60 * 1000)
    .toISOString();
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
      next_expected: safeStr(
        (statePatch as any)?.nextExpected,
        safeStr((leadState as any)?.nextExpected, ""),
      ),
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
  const payloadSource = safeStr((job?.payload as any)?.source, "")
    .toLowerCase();
  const payloadType = safeStr((job?.payload as any)?.type, "").toLowerCase();
  const isManualStaffReply = payloadSource === "manual_staff_reply" ||
    payloadType === "manual_staff_reply";
  const isUiManual = payloadSource === "ui_manual" || isManualStaffReply;
  const channel = normalizeChannel(
    safeStr(
      isUiManual ? (job?.payload as any)?.channel || job.channel : job.channel,
      safeStr(job.channel, "messenger"),
    ),
  );
  const recipientId = safeStr(job.channel_user_id, "") ||
    safeStr(job.recipient_id, "") ||
    safeStr(job.psid, "");
  const payloadRecipientId = safeStr((job.payload as any)?.recipient_id, "");
  const payloadRecipientNested = safeStr(
    (job.payload as any)?.recipient?.id,
    "",
  );
  const effectiveRecipientId = payloadRecipientId || payloadRecipientNested ||
    recipientId;

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
  let inboundPayloadAction = normalizePayloadActionValue(
    safeStr((job?.payload as any)?.payload_action, ""),
  );
  const inboundRawText = safeStr(job?.content, "") ||
    safeStr(job?.payload?.text, "");
  let inboundText = normalizeInboundFromPayloadAction(
    inboundRawText,
    inboundPayloadAction,
  );
  logEvent("conversation_runtime:normalized_inbound", {
    execution_id: executionId,
    organization_id: organizationId,
    lead_id: leadId,
    channel,
    message_type: inboundPayloadAction ? "button_or_list" : "text",
    payload_action: inboundPayloadAction || null,
    inbound_raw_text: inboundRawText,
    inbound_effective_text: inboundText,
  });
  const inboundMessageId = safeStr(
    (job as any)?.message_id,
    safeStr(
      (job?.payload as any)?.inbound_message_id,
      safeStr((job?.payload as any)?.message_id, ""),
    ),
  );
  const inboundMessageCreatedAt = safeStr(
    (job?.payload as any)?.inbound_message_created_at,
    safeStr(job?.created_at, ""),
  );
  const isOperatorOutbound = isOperatorOutboundJob(job);
  const uiMessageId = safeStr((job?.payload as any)?.ui_message_id, "");
  if (inboundPayloadAction) {
    logEvent("whatsapp:payload_action_normalized", {
      execution_id: executionId,
      organization_id: organizationId,
      lead_id: leadId,
      action: inboundPayloadAction,
      inbound_raw_text: inboundRawText,
      inbound_effective_text: inboundText,
    });
  }

  if (isUiManual || isOperatorOutbound) {
    const manualChannel = channel as "messenger" | "whatsapp";
    logEvent("manual_outbound:queued", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: organizationId,
      lead_id: leadId,
      job_id: jobId,
      channel: manualChannel,
      source: payloadSource || null,
      type: payloadType || null,
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
      const manualError = `manual_outbound_failed:${
        safeStr(err?.message, String(err))
      }`;
      logEvent("manual_outbound:send_failed", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        channel: manualChannel,
        error: manualError,
      });
      if (isManualStaffReply) {
        logEvent("manual_staff_reply_failed", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          channel: manualChannel,
          error: manualError,
        });
      }
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
        channel: manualChannel,
        error: manualError,
      });
      if (isManualStaffReply) {
        logEvent("manual_staff_reply_failed", {
          execution_id: executionId,
          trace_id: traceId,
          organization_id: organizationId,
          lead_id: leadId,
          job_id: jobId,
          channel: manualChannel,
          error: manualError,
        });
      }
      throw new Error(manualError);
    }

    const providerMessageId = safeStr(
      manualMetaResp?.data?.message_id ??
        manualMetaResp?.data?.messages?.[0]?.id,
      "",
    ) || null;

    let persistedMessageId: string | null = null;
    const uiUpdated = await markManualMessageSent({
      supabase,
      uiMessageId,
      text: manualText,
      recipientId: effectiveRecipientId,
      originalPayload: (job?.payload ?? {}) as Record<string, unknown>,
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
        channel: manualChannel,
        recipientId: effectiveRecipientId,
        text: manualText,
        originalPayload: (job?.payload ?? {}) as Record<string, unknown>,
        providerMessageId,
        metaResponse: manualMetaResp?.data ?? null,
      });
    }

    const outboxColumns = await getTableColumns(supabase, "reply_outbox");
    const manualUpdates: Record<string, unknown> = {
      status: "sent",
      sent_at: nowIso(),
      last_error: isManualStaffReply
        ? "manual_staff_reply_sent"
        : "manual_outbound_sent",
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
      channel: manualChannel,
      provider_message_id: providerMessageId,
    });
    if (isManualStaffReply) {
      logEvent("manual_staff_reply_sent", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: organizationId,
        lead_id: leadId,
        job_id: jobId,
        channel: manualChannel,
        provider_message_id: providerMessageId,
      });
    }
    await activateHumanTakeoverForLead({
      supabase,
      leadId,
      source: "human_replied_from_dashboard",
      actor: safeStr((job?.payload as any)?.dashboard_user_id, "") ||
        safeStr((job?.payload as any)?.user_id, "") ||
        "dashboard_staff",
      executionId,
      organizationId: effectiveOrganizationId,
    });

    return {
      status: "sent",
      sentAt: nowIso(),
      lastError: isManualStaffReply
        ? "manual_staff_reply_sent"
        : "manual_outbound_sent",
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
      Number(
        Deno.env.get("RUN_REPLIES_STALE_OUTBOX_SECONDS") ??
          DEFAULT_STALE_OUTBOX_SECONDS,
      ) ||
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
  let leadHandoffToHuman = false;
  let earlyGeneratedOverride: GenerateReplyResult | null = null;
  if (leadId) {
    const leadRes = await supabase
      .from("leads")
      .select("state, full_name, first_name, organization_id, handoff_to_human")
      .eq("id", leadId)
      .maybeSingle();

    if (leadRes.error) {
      throw new Error(`lead_load_failed:${leadRes.error.message}`);
    }

    leadState = ((leadRes.data?.state ?? {}) as Json) || {};
    leadHandoffToHuman = (leadRes.data as any)?.handoff_to_human === true;
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
    const processBusinessType = safeStr(
      (orgSettings as any)?.business_type,
      safeStr((leadState as any)?.orgType, ""),
    );
    const isDentalOrClinicDemo =
      isDentalBusinessTypeValue(processBusinessType) ||
      effectiveOrganizationId === "clinic-demo" ||
      organizationId === "clinic-demo";
    const isDentalAdditionalBookingInbound = isDentalOrClinicDemo &&
      normalizeDentalGuardChoiceActionValue(
          inboundPayloadAction || inboundText,
        ) === "additional_booking";
    if (isDentalAdditionalBookingInbound) {
      inboundPayloadAction = "additional_booking";
      leadHandoffToHuman = false;
      const collected = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      earlyGeneratedOverride = buildDentalAdditionalBookingServicePickerResult({
        clinicSettings,
        collected,
        leadPatch: { handoff_to_human: false, updated_at: nowIso() },
        debugNote: "dental_additional_booking_hard_override",
      });
      inboundText = normalizeInboundFromPayloadAction(
        inboundRawText,
        inboundPayloadAction,
      );
      logEvent("dental_additional_booking_pre_handoff_normalized", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: effectiveOrganizationId,
        lead_id: leadId,
        job_id: jobId,
        inbound_raw_text: inboundRawText,
        inbound_effective_text: inboundText,
      });
    }
    if (inboundPayloadAction === "confirm_booking") {
      const collected = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const currentFlow = (collected as any).current_flow;
      const allowAdditionalBookingConfirmation = Boolean(
        (collected as any).allow_additional_booking ||
          currentFlow?.type === "additional_booking" ||
          currentFlow?.allow_active_appointment_bypass === true,
      );
      const pending = ((collected as any)?.pending_booking ?? {}) as Record<
        string,
        unknown
      >;
      const selectedSlot =
        ((pending as any)?.selected_slot ?? (collected as any)?.selected_slot ??
          null) as Record<string, unknown> | null;
      if (selectedSlot) {
        const mergedPending = {
          ...pending,
          service_key: safeStr(
            (selectedSlot as any)?.service_key,
            safeStr((pending as any)?.service_key, ""),
          ),
          service_name: safeStr(
            (selectedSlot as any)?.service_name,
            safeStr((pending as any)?.service_name, ""),
          ),
          service: safeStr(
            (selectedSlot as any)?.service_name,
            safeStr((pending as any)?.service, ""),
          ),
          appointment_date: safeStr(
            (selectedSlot as any)?.date,
            safeStr((pending as any)?.appointment_date, ""),
          ),
          appointment_time: safeStr(
            (selectedSlot as any)?.time,
            safeStr((pending as any)?.appointment_time, ""),
          ),
          starts_at: safeStr(
            (selectedSlot as any)?.starts_at,
            safeStr((pending as any)?.starts_at, ""),
          ),
          provider_id: safeStr(
            (selectedSlot as any)?.provider_id,
            safeStr((pending as any)?.provider_id, ""),
          ),
          provider_name: safeStr(
            (selectedSlot as any)?.provider_name,
            safeStr((pending as any)?.provider_name, ""),
          ),
          selected_slot: selectedSlot,
        };
        leadState = {
          ...(leadState as Record<string, unknown>),
          collected: {
            ...collected,
            ...(allowAdditionalBookingConfirmation
              ? {
                active_appointment: null,
                pending_reschedule: null,
              }
              : {}),
            pending_booking: mergedPending,
          },
        } as Json;
        logEvent("confirm_booking_selected_slot_loaded", {
          organization_id: effectiveOrganizationId,
          lead_id: leadId,
          selected_slot: selectedSlot,
        });
        logEvent("selected_slot_used_for_confirm", {
          organization_id: effectiveOrganizationId,
          lead_id: leadId,
          selected_slot: selectedSlot,
        });
      }
    }

    if (!inboundPayloadAction) {
      const normalizedInboundText = normalizeTextForMatch(inboundText);
      const nextExpected = safeStr((leadState as any)?.nextExpected, "");
      const collectedState = ((leadState as any)?.collected ?? {}) as Record<
        string,
        unknown
      >;
      const lastBookingStep = safeStr(
        (collectedState as any).lastBookingStep,
        "",
      );
      const inBookingFlow = [
        "booking_date_preference",
        "date_selection",
        "booking_menu_selection",
        "availability_slot_selection",
      ].includes(nextExpected) ||
        safeStr((leadState as any)?.stage, "") === "BOOKING" ||
        Boolean((collectedState as any).activeBookingFlow) ||
        ["select_day", "select_time"].includes(lastBookingStep);
      if (
        inBookingFlow && (
          normalizedInboundText === "ver mas horarios" ||
          normalizedInboundText === "horarios disponibles" ||
          normalizedInboundText === "ver horarios disponibles" ||
          normalizedInboundText === "otros horarios" ||
          normalizedInboundText === "mas horarios"
        )
      ) {
        const contextHasDay = Boolean(
          safeStr((collectedState as any).preferred_date, ""),
        );
        const contextHasService = Boolean(
          safeStr((collectedState as any).service, "") ||
            safeStr(
              (collectedState as any)?.pending_booking?.service_name,
              "",
            ) ||
            safeStr(
              (collectedState as any)?.pending_booking_request?.service,
              "",
            ),
        );
        if (contextHasDay && contextHasService) {
          inboundPayloadAction = "booking_more_hours";
          logEvent("more_hours_requested", {
            organization_id: effectiveOrganizationId,
            lead_id: leadId,
            source: "text_alias",
            next_expected: nextExpected,
          });
          inboundText = normalizeInboundFromPayloadAction(
            inboundRawText,
            inboundPayloadAction,
          );
        }
      }
      if (
        inBookingFlow &&
        (
          normalizedInboundText === "ver mas fechas" ||
          normalizedInboundText === "ver mas dias" ||
          normalizedInboundText === "ver proximos dias" ||
          normalizedInboundText === "mas dias" ||
          normalizedInboundText === "proximos dias" ||
          normalizedInboundText === "otros dias" ||
          normalizedInboundText === "ver más días" ||
          normalizedInboundText === "ver próximos días"
        )
      ) {
        logEvent("booking_more_dates_text_matched", {
          organization_id: effectiveOrganizationId,
          lead_id: leadId,
          inbound_text: inboundText,
          next_expected: nextExpected,
        });
        inboundPayloadAction = "booking_date_pref:week";
        inboundText = normalizeInboundFromPayloadAction(
          inboundRawText,
          inboundPayloadAction,
        );
        logEvent("booking_more_dates_requested", {
          organization_id: effectiveOrganizationId,
          lead_id: leadId,
          source: "text_alias",
          next_expected: nextExpected,
        });
        logEvent("more_days_requested", {
          organization_id: effectiveOrganizationId,
          lead_id: leadId,
          source: "text_alias",
          next_expected: nextExpected,
        });
      }
      if (
        !inboundPayloadAction &&
        inBookingFlow &&
        safeStr(
            (orgSettings as any)?.business_type,
            safeStr((leadState as any)?.orgType, ""),
          ).toLowerCase() === "barbershop"
      ) {
        const hasServiceContext = Boolean(
          safeStr((collectedState as any).service, "") ||
            safeStr((collectedState as any).current_service_key, "") ||
            safeStr((collectedState as any).current_service_name, "") ||
            safeStr(
              (collectedState as any)?.pending_booking?.service_name,
              "",
            ) ||
            safeStr(
              (collectedState as any)?.pending_booking_request?.service,
              "",
            ),
        );
        if (
          hasServiceContext && /\b(manana|mañana)\b/.test(normalizedInboundText)
        ) {
          inboundPayloadAction = "booking_date_pref:tomorrow";
          logEvent("booking_date_followup_used_current_service", {
            organization_id: effectiveOrganizationId,
            lead_id: leadId,
            date_preference: "tomorrow",
            next_expected: nextExpected,
          });
          inboundText = normalizeInboundFromPayloadAction(
            inboundRawText,
            inboundPayloadAction,
          );
        } else if (
          hasServiceContext &&
          /\bhoy\b/.test(normalizedInboundText) &&
          !/\b(a las|alas|\d{1,2}(:\d{2})?\s*(am|pm)?)\b/.test(
            normalizedInboundText,
          )
        ) {
          inboundPayloadAction = "booking_date_pref:today";
          logEvent("booking_date_followup_used_current_service", {
            organization_id: effectiveOrganizationId,
            lead_id: leadId,
            date_preference: "today",
            next_expected: nextExpected,
          });
          inboundText = normalizeInboundFromPayloadAction(
            inboundRawText,
            inboundPayloadAction,
          );
        }
      }
      if (!inboundPayloadAction && inBookingFlow) {
        const tz =
          safeStr((clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
          DEFAULT_TIMEZONE;
        const preferredDate = safeStr(
          (collectedState as any).preferred_date,
          safeStr((collectedState as any).current_date, ""),
        );
        const exactParsed = parseExactTimeFromText(
          inboundText,
          tz,
          preferredDate,
        );
        const hasServiceContext = Boolean(
          safeStr((collectedState as any).service, "") ||
            safeStr((collectedState as any).current_service_key, "") ||
            safeStr((collectedState as any).current_service_name, "") ||
            safeStr(
              (collectedState as any)?.pending_booking?.service_name,
              "",
            ) ||
            safeStr(
              (collectedState as any)?.pending_booking_request?.service,
              "",
            ),
        );
        if (exactParsed && hasServiceContext) {
          inboundPayloadAction =
            `booking_exact_time:${exactParsed.date}|${exactParsed.time}`;
          logEvent("exact_time_request_detected", {
            organization_id: effectiveOrganizationId,
            lead_id: leadId,
            requested_date: exactParsed.date,
            requested_time: exactParsed.time,
          });
          if (
            safeStr((collectedState as any).current_service_key, "") ||
            safeStr((collectedState as any).current_service_name, "")
          ) {
            logEvent("current_service_reused_for_time_request", {
              organization_id: effectiveOrganizationId,
              lead_id: leadId,
              current_service_key: safeStr(
                (collectedState as any).current_service_key,
                "",
              ),
              current_service_name: safeStr(
                (collectedState as any).current_service_name,
                "",
              ),
            });
          }
          inboundText = normalizeInboundFromPayloadAction(
            inboundRawText,
            inboundPayloadAction,
          );
        }
      }
      if (
        inBookingFlow &&
        nextExpected === "booking_date_preference" &&
        /\b(mejor buscame una cita para hoy|buscame una cita para hoy|para hoy)\b/
          .test(normalizedInboundText)
      ) {
        inboundPayloadAction = "booking_date_pref:today";
      }
    }

    const automationMode = safeStr((leadState as any)?.automation_mode, "");
    const takeoverActive = isHumanTakeoverActive((leadState as any) ?? null);
    const takeoverPolicy = shouldAllowAutomationDuringTakeover({
      payloadAction: inboundPayloadAction || null,
      payloadSource,
      isOperatorOutbound,
    });
    const allowFlowDuringTakeover = Boolean(
      getIntegrationsConfig(clinicSettings).allow_flow_during_human_takeover ===
          true ||
        isEnabledFlag(
          getIntegrationsConfig(clinicSettings)
            .allow_flow_during_human_takeover,
        ),
    );
    const flowPolicyBlockedByOrg =
      takeoverPolicy.reason === "flow_allowed_during_takeover" &&
      !allowFlowDuringTakeover;
    const allowDentalAdditionalBookingDuringTakeover =
      isDentalAdditionalBookingInbound;
    if (
      takeoverActive && takeoverPolicy.allowed &&
      takeoverPolicy.reason === "flow_allowed_during_takeover"
    ) {
      logEvent("flow_allowed_during_takeover", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: effectiveOrganizationId,
        lead_id: leadId,
        job_id: jobId,
        payload_action: inboundPayloadAction,
        bot_paused_until: safeStr((leadState as any)?.bot_paused_until, ""),
        allow_flow_during_human_takeover: allowFlowDuringTakeover,
      });
    }
    if (
      !allowDentalAdditionalBookingDuringTakeover &&
      (leadHandoffToHuman === true ||
        automationMode === "human_takeover" ||
        (takeoverActive && (!takeoverPolicy.allowed || flowPolicyBlockedByOrg)))
    ) {
      await finalizeOutboxJob(supabase, jobId, {
        status: "sent",
        sent_at: nowIso(),
        last_error: "skipped:human_takeover_active",
      });
      logEvent("bot_reply_skipped_human_takeover", {
        execution_id: executionId,
        trace_id: traceId,
        organization_id: effectiveOrganizationId,
        lead_id: leadId,
        job_id: jobId,
        handoff_to_human: leadHandoffToHuman,
        human_takeover_source: safeStr((leadState as any)?.paused_reason, ""),
        bot_paused_until: safeStr((leadState as any)?.bot_paused_until, ""),
        skip_reason: leadHandoffToHuman
          ? "lead_handoff_to_human_true"
          : flowPolicyBlockedByOrg
          ? "flow_blocked_by_org_setting"
          : (takeoverPolicy.reason ?? "legacy_automation_mode"),
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
  if (
    safeStr(
        (orgSettings as any)?.business_type,
        safeStr((leadState as any)?.orgType, ""),
      ).toLowerCase() === "barbershop" &&
    inboundMessageId &&
    safeStr((leadState as any)?.last_processed_inbound_message_id, "") ===
      inboundMessageId
  ) {
    logEvent("stale_payload_or_duplicate_response_blocked", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: effectiveOrganizationId,
      lead_id: leadId,
      job_id: jobId,
      inbound_message_id: inboundMessageId,
      reason: "inbound_message_already_processed",
    });
    await finalizeOutboxJob(supabase, jobId, {
      status: "sent",
      sent_at: nowIso(),
      last_error: "deduped:inbound_message_already_processed",
    });
    return {
      status: "sent",
      sentAt: nowIso(),
      lastError: "deduped:inbound_message_already_processed",
    };
  }
  leadState = mergeLeadState(leadState, {
    __inbound_message_id: inboundMessageId || null,
    __inbound_message_created_at: inboundMessageCreatedAt || null,
  });

  const generated = earlyGeneratedOverride ?? await generateReply({
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
    payloadAction: inboundPayloadAction || null,
  });
  const stateBeforeSnapshot = {
    stage_before: safeStr((leadState as any)?.stage, ""),
    nextExpected_before: safeStr((leadState as any)?.nextExpected, ""),
    collected_service_before: safeStr(
      (leadState as any)?.collected?.service,
      "",
    ),
    collected_preferred_date_before: safeStr(
      (leadState as any)?.collected?.preferred_date,
      "",
    ),
    last_availability_context_before:
      (leadState as any)?.collected?.last_availability_context ?? null,
    pending_booking_before: (leadState as any)?.collected?.pending_booking ??
      null,
  };

  let reply = clampText(generated.reply, 950);
  let statePatch = generated.statePatch ?? {};
  const leadPatch = generated.leadPatch ?? {};
  const flowCtaSpec = generated.flowCta ?? null;
  const debugNote = safeStr(generated.debugNote, "");
  let bookingSuccessAuthorized = generated.bookingSuccessAuthorized === true;

  const businessType = safeStr((orgSettings as any)?.business_type, "")
    .toLowerCase();
  const leadOrgType = safeStr((leadState as any)?.orgType, "").toLowerCase();
  const isBarbershopOrg = businessType === "barbershop" ||
    leadOrgType === "barbershop";
  if (isBarbershopOrg && !flowCtaSpec) {
    const gateResult = await validateBarbershopPreconfirm({
      supabase,
      organizationId: effectiveOrganizationId,
      leadId,
      timezone: safeStr((clinicSettings as any)?.timezone, DEFAULT_TIMEZONE) ||
        DEFAULT_TIMEZONE,
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

  if (isBarbershopOrg && channel === "whatsapp" && !flowCtaSpec) {
    reply = clampText(
      formatBarberLineReply(
        reply,
        {
          businessType: "barbershop",
          channel,
          inboundText,
          statePatch,
          debugNote,
          bookingSuccessAuthorized,
        },
        ((clinicSettings as any)?.barberline_personality ??
          (orgSettings as any)?.barberline_personality ?? null) as any,
      ),
      950,
    );
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
  const generatedButtons = Array.isArray(generated.interactiveButtons)
    ? generated.interactiveButtons.filter((b) =>
      safeStr((b as any)?.id, "") && safeStr((b as any)?.title, "")
    )
    : [];
  const generatedList = generated.interactiveList?.sections?.length
    ? generated.interactiveList
    : undefined;
  const interactiveButtons = !generatedList && generatedButtons.length > 0
    ? generatedButtons.slice(0, 3)
    : (!generatedList ? buildInteractiveButtonsForState(statePatch) : []);
  let flowCtaPayload: WhatsAppFlowCtaSpec | undefined;
  if (flowCtaSpec && channel === "whatsapp") {
    flowCtaPayload = {
      ...flowCtaSpec,
      flowActionPayload: flowCtaSpec.flowActionPayload ?? {
        screen: "SERVICE",
        data: {
          organization_id: effectiveOrganizationId,
          lead_id: leadId,
        },
      },
    };
    const payloadPreview = buildWhatsAppFlowCtaMessage({
      to: effectiveRecipientId,
      flow_id: flowCtaPayload.flowId,
      flow_token: flowCtaPayload.flowToken,
      cta_text: flowCtaPayload.ctaText,
      body_text: flowCtaPayload.bodyText,
      organization_id: effectiveOrganizationId,
      lead_id: leadId,
    });
    const interactive = (payloadPreview as any)?.interactive ?? {};
    const parameters = (interactive?.action?.parameters ?? {}) as Record<
      string,
      unknown
    >;
    logEvent("flow_payload_built", {
      execution_id: executionId,
      trace_id: traceId,
      organization_id: effectiveOrganizationId,
      lead_id: leadId,
      job_id: jobId,
      phone_number_id: whatsappPhoneNumberId,
      to: effectiveRecipientId,
      interactive_type: safeStr(interactive?.type, ""),
      action_name: safeStr(interactive?.action?.name, ""),
      mode: safeStr(parameters.mode, ""),
      flow_id: safeStr(parameters.flow_id, ""),
      flow_message_version: safeStr(parameters.flow_message_version, ""),
      flow_cta: safeStr(parameters.flow_cta, ""),
      flow_action: safeStr(parameters.flow_action, ""),
      flow_action_payload_screen: safeStr(
        (parameters.flow_action_payload as any)?.screen,
        "",
      ),
    });
  }
  const metaResp = await sendViaMetaAdapter({
    channel: channel as "messenger" | "whatsapp",
    graphVersion: metaGraphVersion,
    recipientId: effectiveRecipientId,
    text: reply,
    buttons: interactiveButtons.length > 0 ? interactiveButtons : undefined,
    interactiveList: channel === "whatsapp" ? generatedList : undefined,
    flowCta: flowCtaPayload,
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
  const leadUpdate = await updateLeadAfterSend({
    supabase,
    leadId,
    reply,
    leadState,
    statePatch,
    leadPatch,
    businessType: safeStr((orgSettings as any)?.business_type, ""),
    inboundMessageId,
  });
  logEvent("barbershop:turn_state_trace", {
    lead_id: leadId,
    organization_id: effectiveOrganizationId,
    inbound_text: inboundText,
    ...stateBeforeSnapshot,
    outbound_text: reply,
    stage_after: safeStr((leadUpdate.nextState as any)?.stage, ""),
    nextExpected_after: safeStr(
      (leadUpdate.nextState as any)?.nextExpected,
      "",
    ),
    collected_service_after: safeStr(
      (leadUpdate.nextState as any)?.collected?.service,
      "",
    ),
    collected_preferred_date_after: safeStr(
      (leadUpdate.nextState as any)?.collected?.preferred_date,
      "",
    ),
    last_availability_context_after:
      (leadUpdate.nextState as any)?.collected?.last_availability_context ??
        null,
    pending_booking_after:
      (leadUpdate.nextState as any)?.collected?.pending_booking ?? null,
    lead_state_update_succeeded: leadUpdate.updated,
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

if (import.meta.main) {
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
      if (isBotAutoReplyPaused()) {
        logEvent("bot_auto_reply_paused_run_replies", {
          execution_id: executionId,
          organization_id,
          reason: "BOT_AUTO_REPLY_PAUSED=true",
        });
        return j(200, {
          ok: true,
          paused: true,
          execution_id: executionId,
          org_id: organization_id,
          claimed_count: 0,
          sent_count: 0,
          failed_count: 0,
          deduped_count: 0,
        });
      }

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
      const llmEnabled = Boolean(orgSettings.llm_brain_enabled);

      const productKnowledge = await loadProductKnowledge(
        supabase,
        organization_id,
      );
      const clinicKnowledge = await loadClinicKnowledge(
        supabase,
        organization_id,
      );
      const clinicSettings = await loadClinicSettings(
        supabase,
        organization_id,
      );
      const canonicalSettings = await loadOrganizationSettings(
        supabase,
        organization_id,
      );
      const businessType = getBusinessTypeForOrg(
        canonicalSettings,
        safeStr(orgSettings.business_type, ""),
      );
      if (!clinicSettings.brand_name) {
        clinicSettings.brand_name = safeStr(orgSettings.brand_name, "");
      }
      clinicSettings.business_type = businessType;

      const canonicalServices = getServicesForOrg(
        canonicalSettings,
        businessType,
      );
      if (canonicalServices.length > 0) {
        clinicSettings.services = canonicalServices;
      } else if (businessType === "barbershop") {
        clinicSettings.services = [];
      }
      const canonicalFaqs = getFaqsForOrg(canonicalSettings);
      if (canonicalFaqs.length > 0) {
        (clinicSettings as any).faqs = canonicalFaqs;
      }
      if (
        canonicalSettings?.location &&
        typeof canonicalSettings.location === "object" &&
        Object.keys(canonicalSettings.location).length > 0
      ) {
        (clinicSettings as any).location = canonicalSettings.location;
      }
      const canonicalHours = getHoursForOrg(canonicalSettings);
      const usedDefaultHours = businessType === "barbershop" &&
        Object.keys(canonicalHours).length === 0;
      if (Object.keys(canonicalHours).length > 0) {
        clinicSettings.hours = canonicalHours;
      } else if (businessType === "barbershop") {
        clinicSettings.hours = {};
      }
      const canonicalProviders = getProvidersForOrg(canonicalSettings);
      const canonicalIntegrations = canonicalSettings?.integrations &&
          typeof canonicalSettings.integrations === "object"
        ? canonicalSettings.integrations as Record<string, unknown>
        : {};
      if (Object.keys(canonicalIntegrations).length > 0) {
        (clinicSettings as any).integrations = canonicalIntegrations;
      }
      let usedDefaultProviders = businessType === "barbershop" &&
        canonicalProviders.length === 0;
      if (canonicalProviders.length > 0) {
        (clinicSettings as any).providers = canonicalProviders;
      } else if (businessType === "barbershop") {
        (clinicSettings as any).providers = [];
      }

      if (businessType === "barbershop") {
        const barbershopSettings = await loadBarbershopSettings(
          supabase,
          organization_id,
        );
        Object.assign(clinicSettings, barbershopSettings);
      }
      if (!clinicSettings.timezone) {
        clinicSettings.timezone = DEFAULT_TIMEZONE;
      }
      if (!clinicSettings.same_day_booking_cutoff) {
        clinicSettings.same_day_booking_cutoff =
          DEFAULT_SAME_DAY_BOOKING_CUTOFF;
      }
      if (!clinicSettings.buffer_min) {
        clinicSettings.buffer_min = DEFAULT_BUFFER_MIN;
      }
      if (!clinicSettings.phone) clinicSettings.phone = "";
      if (!clinicSettings.address) clinicSettings.address = "";
      if (!clinicSettings.clinic_name) {
        clinicSettings.clinic_name = safeStr(orgSettings.brand_name, "");
      }
      // Providers table is the Settings source of truth; organization_settings.providers remains a synced runtime fallback.
      {
        const { data: providersData } = await supabase
          .from("providers")
          .select(
            "id, name, services, schedule, specialty, active, color, calendar_color, role",
          )
          .eq("organization_id", organization_id)
          .eq("active", true)
          .eq("role", "doctor");
        if (providersData && providersData.length > 0) {
          (clinicSettings as any).providers = providersData;
          usedDefaultProviders = false;
        }
      }
      const barbershopHealth = businessType === "barbershop"
        ? getBarbershopSettingsHealth(clinicSettings)
        : null;
      logEvent("organization_settings_resolved", {
        organization_id,
        business_type: businessType,
        settings_source: canonicalSettings
          ? "organization_settings"
          : "fallback",
        service_count: Array.isArray((clinicSettings as any).services)
          ? (clinicSettings as any).services.length
          : 0,
        provider_count: Array.isArray((clinicSettings as any).providers)
          ? (clinicSettings as any).providers.length
          : 0,
        hours_open_days_count: barbershopHealth?.hoursOpenDaysCount ?? null,
        source_of_truth_guard: businessType === "barbershop"
          ? "strict_no_defaults"
          : "dental_default_ok",
        used_default_hours: usedDefaultHours,
        used_default_providers: usedDefaultProviders,
      });
      (clinicSettings as any).__settings_source = canonicalSettings
        ? "organization_settings"
        : "fallback";

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

      const reclaimedCount = reclaimRes.error
        ? 0
        : reclaimRes.data?.length ?? 0;

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

      const manualJobs = Array.isArray(manualClaimRes.data)
        ? manualClaimRes.data
        : [];
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
          const source = safeStr((job?.payload as any)?.source, "")
            .toLowerCase();
          const isManualJob = source.includes("ui_manual") ||
            source.includes("manual");
          const normalizedMsg =
            isManualJob && !msg.startsWith("manual_outbound_failed:")
              ? `manual_outbound_failed:${msg}`
              : msg;
          const retryableStatus = parseMetaStatus(msg);
          const isRetryable = msg.includes("429") ||
            msg.includes("timeout") ||
            msg.includes("network") ||
            retryableStatus === 429 ||
            (retryableStatus !== null && retryableStatus >= 500);

          const maxRetries = 3;
          const shouldRetry = !isManualJob && isRetryable &&
            attemptCount < maxRetries;
          const terminalDead = attemptCount >= maxRetries;

          failures.push({ id: jobId, error: normalizedMsg });
          failed++;

          try {
            const failUpdates: Record<string, unknown> = {
              status: shouldRetry
                ? "queued"
                : isManualJob
                ? "failed"
                : terminalDead
                ? "dead"
                : "failed",
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
}
