import {
  type IssuedCoupon,
  issueOrGetCoupon,
} from "../run-replies/domain/referralHub/couponService.ts";
import { interpretAccidentDate } from "../run-replies/domain/referralHub/fieldInterpreter.ts";

export const VOICE_SOURCE_ORGANIZATION_ID = "luis-gabriel-referral-hub";
export type ReferralSourceChannel = "voice" | "whatsapp";

export function normalizeSourceChannel(
  value: unknown,
): ReferralSourceChannel | null {
  if (value === undefined) return "voice";
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "voice" || normalized === "whatsapp"
    ? normalized
    : null;
}

export type VoiceField = {
  id: string;
  prompt: string;
  optional?: boolean;
};

type ServiceWorkflow = {
  id: string;
  name: string;
  finalAction:
    | "issue_coupon"
    | "submit_service_request"
    | "create_basket_order";
  fields: VoiceField[];
  summaryTemplate: string;
};

const PROFILE_FIELDS: VoiceField[] = [
  { id: "profile_name", prompt: "¿Cuál es tu nombre completo?" },
  { id: "profile_city", prompt: "¿En qué ciudad vives?" },
];

export const VOICE_SERVICE_WORKFLOWS: readonly ServiceWorkflow[] = [
  {
    id: "luis_compra_super",
    name: "Compras de supermercado",
    finalAction: "create_basket_order",
    fields: [
      { id: "offer_id", prompt: "¿Qué compra prefieres?" },
      { id: "postal_code", prompt: "¿Cuál es el ZIP de entrega?" },
      {
        id: "partner_location_id",
        prompt: "¿Qué supermercado disponible prefieres?",
      },
      { id: "customer_name", prompt: "¿A nombre de quién será el pedido?" },
      { id: "phone", prompt: "¿Cuál es el número de contacto?" },
      { id: "address_line_1", prompt: "¿Cuál es la dirección de entrega?" },
      {
        id: "address_line_2",
        prompt: "¿Apartamento o unidad?",
        optional: true,
      },
      { id: "city", prompt: "¿Cuál es la ciudad?" },
      { id: "state", prompt: "¿Cuál es el estado?" },
      {
        id: "delivery_instructions",
        prompt: "¿Tienes instrucciones de entrega?",
        optional: true,
      },
      {
        id: "payment_preference",
        prompt: "¿Cómo prefieres coordinar el pago?",
      },
    ],
    summaryTemplate:
      "{offer_id} para {customer_name}, entrega en {address_line_1}, {city}, {state} {postal_code}.",
  },
  {
    id: "luis_accidente",
    name: "Accidente de auto",
    finalAction: "submit_service_request",
    fields: [
      ...PROFILE_FIELDS,
      { id: "accident_date", prompt: "¿Qué día ocurrió el accidente?" },
      { id: "accident_city", prompt: "¿En qué ciudad ocurrió?" },
      {
        id: "accident_injuries",
        prompt: "¿Hubo personas lesionadas? Responde sí, no o no estoy seguro.",
      },
      {
        id: "contact_name",
        prompt: "¿Cuál es el nombre completo de contacto?",
      },
      { id: "contact_phone", prompt: "¿Cuál es el número de contacto?" },
    ],
    summaryTemplate:
      "Accidente ocurrido el {accident_date} en {accident_city}; lesiones: {accident_injuries}; contacto: {contact_name}.",
  },
  {
    id: "luis_inmigracion",
    name: "Inmigración",
    finalAction: "submit_service_request",
    fields: [
      ...PROFILE_FIELDS,
      {
        id: "immigration_case",
        prompt: "¿Qué tipo de ayuda migratoria necesitas?",
      },
    ],
    summaryTemplate: "Solicitud de inmigración: {immigration_case}.",
  },
  {
    id: "luis_cupon_medico",
    name: "Cupón médico",
    finalAction: "issue_coupon",
    fields: PROFILE_FIELDS,
    summaryTemplate: "Cupón médico para {profile_name} en {profile_city}.",
  },
  {
    id: "luis_cupon_super",
    name: "Cupón de supermercado",
    finalAction: "issue_coupon",
    fields: PROFILE_FIELDS,
    summaryTemplate:
      "Cupón de supermercado para {profile_name} en {profile_city}.",
  },
  {
    id: "luis_cupon_dental",
    name: "Cupón dental",
    finalAction: "issue_coupon",
    fields: PROFILE_FIELDS,
    summaryTemplate: "Cupón dental para {profile_name} en {profile_city}.",
  },
  {
    id: "luis_eventos",
    name: "Eventos comunitarios",
    finalAction: "submit_service_request",
    fields: PROFILE_FIELDS,
    summaryTemplate:
      "Solicitud de información sobre eventos para {profile_name} en {profile_city}.",
  },
  {
    id: "luis_representante",
    name: "Hablar con asesor",
    finalAction: "submit_service_request",
    fields: PROFILE_FIELDS,
    summaryTemplate: "Solicitud para hablar con un asesor.",
  },
] as const;

export type VoiceLead = {
  id: string;
  state: Record<string, unknown> | null;
  channel: string;
  channel_user_id: string;
  service_id?: string | null;
  handoff_to_human?: boolean | null;
  status?: string | null;
};

export type VoiceLeadInput = {
  organizationId: typeof VOICE_SOURCE_ORGANIZATION_ID;
  sourceChannel: ReferralSourceChannel;
  channelUserId: string;
  serviceId: string;
  state: Record<string, unknown>;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  handoffToHuman?: boolean;
  status?: string;
};

export type VoiceCampaign = {
  service_id: string;
  campaign_key: string;
  display_name: string;
  offer_terms: Record<string, unknown> | null;
  active: boolean;
};

export type VoiceWorkflowDependencies = {
  findVoiceLead: (
    channelUserId: string,
    sourceChannel: ReferralSourceChannel,
  ) => Promise<{
    data: VoiceLead | null;
    error: unknown | null;
  }>;
  saveVoiceLead: (input: VoiceLeadInput) => Promise<{
    data: VoiceLead | null;
    error: unknown | null;
  }>;
  getCampaign: (serviceId: string) => Promise<{
    data: VoiceCampaign | null;
    error: unknown | null;
  }>;
  issueCoupon: (args: {
    organizationId: string;
    leadId: string;
    campaignKey: string;
  }) => Promise<IssuedCoupon>;
};

type IntakeState = {
  conversation_id_hash: string;
  service_id: string;
  fields: Record<string, string>;
  caller_phone?: string;
  submitted_at?: string;
  submission_type?: string;
  handoff_status?: "created";
  handoff_created_at?: string;
};

function workflow(serviceId: unknown): ServiceWorkflow | null {
  const normalized = typeof serviceId === "string" ? serviceId.trim() : "";
  return VOICE_SERVICE_WORKFLOWS.find((item) => item.id === normalized) ?? null;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePhone(value: unknown): string | null {
  const raw = safeString(value);
  if (!raw) return null;
  const leadingPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${leadingPlus ? "+" : "+"}${digits}`;
}

export async function voiceChannelUserId(
  conversationId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(conversationId),
  );
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `voice:${hash}`;
}

function fieldMap(state: Record<string, unknown> | null): IntakeState | null {
  const collected = state?.collected;
  if (!collected || typeof collected !== "object") return null;
  const voice = (collected as Record<string, unknown>).referral_voice;
  if (!voice || typeof voice !== "object") return null;
  return voice as IntakeState;
}

function mergeState(
  state: Record<string, unknown> | null,
  intake: IntakeState,
  sourceChannel: ReferralSourceChannel,
): Record<string, unknown> {
  const collected = state?.collected && typeof state.collected === "object"
    ? state.collected as Record<string, unknown>
    : {};
  return {
    ...(state ?? {}),
    orgType: "referral_hub",
    channel: sourceChannel,
    collected: {
      ...collected,
      referral_voice: intake,
    },
  };
}

function requiredFields(
  definition: ServiceWorkflow,
  fields: Record<string, string>,
): VoiceField[] {
  return definition.fields.filter((field) => !field.optional);
}

function missingFields(
  definition: ServiceWorkflow,
  fields: Record<string, string>,
): VoiceField[] {
  return requiredFields(definition, fields).filter((field) =>
    !safeString(fields[field.id])
  );
}

function normalizeField(
  service: ServiceWorkflow,
  id: string,
  value: unknown,
): string | null {
  if (!service.fields.some((field) => field.id === id)) return null;
  const text = safeString(value).replace(/\s+/g, " ");
  if (!text || text.length > 300) return null;
  if (id === "contact_phone") return normalizePhone(text);
  if (id === "accident_date") {
    const interpreted = interpretAccidentDate(text);
    return interpreted.needsConfirmation ? null : interpreted.normalizedValue;
  }
  if (id === "food_option") {
    const normalized = text.toLowerCase();
    if (normalized.includes("don")) return "donation";
    if (
      normalized.includes("apoyo") || normalized.includes("recib") ||
      normalized.includes("neces")
    ) return "support";
    return null;
  }
  if (id === "accident_injuries") {
    const normalized = text.toLowerCase();
    if (normalized.includes("seguro")) return "no_estoy_seguro";
    if (/^(sí|si|yes)$/.test(normalized)) return "sí";
    if (/^(no)$/.test(normalized)) return "no";
    return null;
  }
  return text;
}

function requirementResponse(
  definition: ServiceWorkflow,
  fields: Record<string, string> = {},
) {
  const required = requiredFields(definition, fields);
  const missing = missingFields(definition, fields);
  return {
    success: true,
    service_id: definition.id,
    name: definition.name,
    required_fields: required.map(({ id, prompt }) => ({ id, prompt })),
    optional_fields: definition.fields
      .filter((field) => field.optional)
      .map(({ id, prompt }) => ({ id, prompt })),
    missing_required_fields: missing.map((field) => field.id),
    next_field: missing[0]
      ? { id: missing[0].id, prompt: missing[0].prompt }
      : null,
    confirmation_summary_template: definition.summaryTemplate,
    supported_final_action: definition.finalAction,
  };
}

export function getServiceRequirements(serviceId: unknown) {
  const definition = workflow(serviceId);
  return definition ? requirementResponse(definition) : null;
}

function names(
  body: Record<string, unknown>,
  fields: Record<string, string>,
) {
  const firstName = safeString(body.first_name) || null;
  const lastName = safeString(body.last_name) || null;
  const fullName = safeString(fields.profile_name) ||
    [firstName, lastName].filter(Boolean).join(" ") || null;
  return { firstName, lastName, fullName };
}

async function loadContext(
  body: Record<string, unknown>,
  dependencies: VoiceWorkflowDependencies,
) {
  const conversationId = safeString(body.conversation_id);
  if (!conversationId || conversationId.length > 200) {
    return { error: "missing_conversation_id" as const };
  }
  const channelUserId = await voiceChannelUserId(conversationId);
  const sourceChannel = normalizeSourceChannel(body.source_channel);
  if (!sourceChannel) return { error: "invalid_source_channel" as const };
  const found = await dependencies.findVoiceLead(channelUserId, sourceChannel);
  if (found.error) return { error: "lead_persistence_failed" as const };
  if (found.data && found.data.channel !== sourceChannel) {
    return { error: "lead_persistence_failed" as const };
  }
  return {
    conversationId,
    conversationHash: channelUserId.slice("voice:".length),
    channelUserId,
    sourceChannel,
    lead: found.data,
  };
}

export async function saveVoiceIntake(
  body: Record<string, unknown>,
  dependencies: VoiceWorkflowDependencies,
) {
  const definition = workflow(body.service_id);
  if (!definition) return { error: "service_not_found", status: 404 };
  const context = await loadContext(body, dependencies);
  if ("error" in context) return { error: context.error, status: 400 };

  const existing = fieldMap(context.lead?.state ?? null);
  const existingFields = existing?.service_id === definition.id
    ? existing.fields
    : {};
  const supplied = body.fields && typeof body.fields === "object" &&
      !Array.isArray(body.fields)
    ? body.fields as Record<string, unknown>
    : {};
  const allowed = new Set(definition.fields.map((field) => field.id));
  for (const key of Object.keys(supplied)) {
    if (!allowed.has(key)) return { error: "invalid_field", status: 400 };
  }

  const nextFields = { ...existingFields };
  for (const [key, value] of Object.entries(supplied)) {
    const normalized = normalizeField(definition, key, value);
    if (!normalized) return { error: "invalid_field", status: 400 };
    nextFields[key] = normalized;
  }
  const callerPhone = safeString(body.caller_phone);
  const normalizedCallerPhone = normalizePhone(callerPhone);
  if (callerPhone && !normalizedCallerPhone) {
    return { error: "invalid_field", status: 400 };
  }

  const intake: IntakeState = {
    conversation_id_hash: context.conversationHash,
    service_id: definition.id,
    fields: nextFields,
    ...(normalizedCallerPhone
      ? { caller_phone: normalizedCallerPhone }
      : existing?.caller_phone
      ? { caller_phone: existing.caller_phone }
      : {}),
    ...(existing?.submitted_at ? { submitted_at: existing.submitted_at } : {}),
    ...(existing?.submission_type
      ? { submission_type: existing.submission_type }
      : {}),
  };
  const person = names(body, nextFields);
  const saved = await dependencies.saveVoiceLead({
    organizationId: VOICE_SOURCE_ORGANIZATION_ID,
    sourceChannel: context.sourceChannel,
    channelUserId: context.channelUserId,
    serviceId: definition.id,
    state: mergeState(
      context.lead?.state ?? null,
      intake,
      context.sourceChannel,
    ),
    ...person,
    status: context.lead?.status ?? "contacted",
    handoffToHuman: context.lead?.handoff_to_human ?? false,
  });
  if (saved.error || !saved.data?.id) {
    return { error: "lead_persistence_failed", status: 500 };
  }
  const requirement = requirementResponse(definition, nextFields);
  return {
    status: 200,
    body: {
      success: true,
      lead_saved: true,
      complete: requirement.missing_required_fields.length === 0,
      service_id: definition.id,
      missing_required_fields: requirement.missing_required_fields,
      next_field: requirement.next_field,
    },
  };
}

export async function submitVoiceRequest(
  body: Record<string, unknown>,
  dependencies: VoiceWorkflowDependencies,
) {
  if (body.confirmed !== true) {
    return { error: "confirmation_required", status: 400 };
  }
  const definition = workflow(body.service_id);
  if (!definition || definition.finalAction !== "submit_service_request") {
    return { error: "service_not_found", status: 404 };
  }
  const context = await loadContext(body, dependencies);
  if ("error" in context) return { error: context.error, status: 400 };
  const intake = fieldMap(context.lead?.state ?? null);
  if (
    !context.lead || !intake || intake.service_id !== definition.id
  ) {
    return { error: "missing_required_fields", status: 400 };
  }
  const missing = missingFields(definition, intake.fields);
  if (missing.length) {
    return {
      status: 400,
      body: {
        success: false,
        error: "missing_required_fields",
        missing_required_fields: missing.map((field) => field.id),
      },
    };
  }
  if (intake.submitted_at && intake.submission_type === "request") {
    return {
      status: 200,
      body: {
        success: true,
        submitted: true,
        service_id: definition.id,
        voice_confirmation: "Tu solicitud fue registrada correctamente.",
      },
    };
  }
  const submittedAt = new Date().toISOString();
  const isHandoff = ["luis_accidente", "luis_representante"].includes(
    definition.id,
  );
  const person = names(body, intake.fields);
  const saved = await dependencies.saveVoiceLead({
    organizationId: VOICE_SOURCE_ORGANIZATION_ID,
    sourceChannel: context.sourceChannel,
    channelUserId: context.channelUserId,
    serviceId: definition.id,
    state: mergeState(context.lead.state, {
      ...intake,
      submitted_at: submittedAt,
      submission_type: "request",
      ...(isHandoff
        ? {
          handoff_status: "created" as const,
          handoff_created_at: submittedAt,
        }
        : {}),
    }, context.sourceChannel),
    ...person,
    status: "qualified",
    handoffToHuman: isHandoff,
  });
  if (saved.error || !saved.data?.id) {
    return { error: "request_submission_failed", status: 500 };
  }
  return {
    status: 200,
    body: {
      success: true,
      submitted: true,
      service_id: definition.id,
      voice_confirmation: "Tu solicitud fue registrada correctamente.",
    },
  };
}

function offerSummary(campaign: VoiceCampaign): string | null {
  const terms = campaign.offer_terms ?? {};
  if (campaign.service_id === "luis_cupon_super") {
    return terms.discount_amount === 10 && terms.minimum_purchase === 100
      ? "$10 de descuento en compras de $100 o más."
      : null;
  }
  if (campaign.service_id === "luis_cupon_medico") {
    return terms.discount_percent === 20 ? "20% de descuento." : null;
  }
  if (campaign.service_id === "luis_cupon_dental") {
    return terms.promotional_price === 29 ? "Precio promocional de $29." : null;
  }
  return null;
}

export async function issueVoiceCoupon(
  body: Record<string, unknown>,
  dependencies: VoiceWorkflowDependencies,
) {
  if (body.confirmed !== true) {
    return { error: "confirmation_required", status: 400 };
  }
  const definition = workflow(body.service_id);
  if (!definition || definition.finalAction !== "issue_coupon") {
    return { error: "service_not_found", status: 404 };
  }
  const savedIntake = await saveVoiceIntake(body, dependencies);
  if ("error" in savedIntake) return savedIntake;
  if (!savedIntake.body.complete) {
    return {
      status: 400,
      body: {
        success: false,
        error: "missing_required_fields",
        missing_required_fields: savedIntake.body.missing_required_fields,
        next_field: savedIntake.body.next_field,
      },
    };
  }
  const context = await loadContext(body, dependencies);
  if ("error" in context || !context.lead?.id) {
    return { error: "lead_persistence_failed", status: 500 };
  }
  const campaignResult = await dependencies.getCampaign(definition.id);
  if (campaignResult.error || !campaignResult.data?.active) {
    return { error: "campaign_not_found", status: 404 };
  }
  const summary = offerSummary(campaignResult.data);
  if (!summary) return { error: "campaign_not_found", status: 404 };
  try {
    const coupon = await dependencies.issueCoupon({
      organizationId: VOICE_SOURCE_ORGANIZATION_ID,
      leadId: context.lead.id,
      campaignKey: campaignResult.data.campaign_key,
    });
    return {
      status: 200,
      body: {
        success: true,
        issued: true,
        service_id: definition.id,
        campaign_name: campaignResult.data.display_name,
        offer_summary: summary,
        coupon_code: coupon.code,
        voice_confirmation:
          `Tu cupón fue creado correctamente. Tu código es ${coupon.code}.`,
      },
    };
  } catch {
    return { error: "coupon_issuance_failed", status: 500 };
  }
}

export { issueOrGetCoupon };
