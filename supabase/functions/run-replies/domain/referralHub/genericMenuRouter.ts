import type {
  InteractiveButton,
  WhatsAppInteractiveListSpec,
} from "../../../_shared/metaMessageAdapter.ts";
import { activateHumanTakeoverState } from "../humanTakeover.ts";
import {
  handlePantryDemoTurn,
  isPantryCouponEntry,
  type PantryPreludeMessage,
  shouldHandlePantryDemo,
} from "./pantryDemoRouter.ts";
import { CouponPersistenceError, issueOrGetCoupon } from "./couponService.ts";
import {
  REFERRAL_HUB_CANONICAL_ORGANIZATION_ID,
  REFERRAL_HUB_COUPON_ASSETS,
  type ReferralHubCouponAssetConfig,
} from "../../../_products/referral-hub/config.ts";
import {
  extractReferralQrPublicCode,
  qrLeadAttribution,
  type ResolvedReferralQrEntry,
  resolveReferralQrEntry,
} from "../../../_products/referral-hub/qrEntries.ts";
import { LG_ACCIDENT_HANDOFF_FAILURE } from "./accidentHandoff.ts";
import {
  type FieldInterpretation,
  interpretAccidentDate,
  interpretCity,
} from "./fieldInterpreter.ts";
import {
  continueWhatsAppGrocery,
  groceryStateFromReferral,
  startWhatsAppGrocery,
} from "./whatsappGrocery.ts";

type Json = Record<string, unknown>;

type SupabaseLike = {
  from(table: string): any;
  rpc?(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type ReferralHubServiceType = "intake" | "static_action" | "transfer";

export type ReferralHubObjective = {
  campo: string;
  pregunta: string;
  tipo: "texto" | "opciones";
  opciones?: string[];
  requerido?: boolean;
};

export type ReferralHubServiceConfig = {
  id: string;
  organization_id: string;
  nombre: string;
  icono?: string | null;
  tipo: ReferralHubServiceType;
  menu_orden?: number | null;
  menu_label?: string | null;
  intake_objectives?: ReferralHubObjective[];
  accion_estatica?: Json | null;
  partner_id?: string | null;
  partner?: ReferralHubPartner | null;
  activo?: boolean | null;
};

type ReferralHubPartner = {
  id: string;
  nombre: string;
};

export type ReferralHubTurnResult = {
  reply: string;
  statePatch: Json;
  leadPatch?: Json;
  debugNote: string;
  interactiveButtons?: InteractiveButton[];
  interactiveList?: WhatsAppInteractiveListSpec;
  imageUrl?: string;
  outboundPrelude?: PantryPreludeMessage[];
  outboundMessages?: OutboundMessage[];
  notification?: {
    type: "referral_hub_qualified_lead";
    leadName: string;
    serviceName: string;
    summaryLine: string;
  };
};

export type OutboundMessage =
  | { type: "text"; text: string }
  | { type: "image"; url: string; altText?: string; reusable?: boolean };

export type CouponDeliveryError =
  | "asset_config_missing"
  | "asset_config_inactive"
  | "coupon_delivery_disabled"
  | "coupon_campaign_missing"
  | "image_url_invalid"
  | "coupon_persistence_unavailable"
  | "coupon_issue_failed"
  | "coupon_table_missing"
  | "coupon_rpc_missing"
  | "coupon_campaign_inactive"
  | "coupon_insert_rejected"
  | "coupon_select_failed"
  | "coupon_rls_denied"
  | "coupon_constraint_failed"
  | "coupon_response_invalid";

type ReferralHubState = {
  service_id?: string | null;
  service_label?: string | null;
  current_field?: string | null;
  extracted_data?: Record<string, unknown>;
  awaiting_community_opt_in?: boolean;
  stop_requested?: boolean;
  profile_name?: string | null;
  profile_city?: string | null;
  profile_complete?: boolean;
  food_option?: string | null;
  grocery?: unknown;
  pending_field_confirmation?: {
    field: "profile_city" | "accident_date";
    interpretation: FieldInterpretation;
  } | null;
  profile_edit_field?: "profile_name" | "profile_city" | null;
  last_completion?: {
    service_id: string;
    completed_at: string;
    outcome: string;
  } | null;
};

const BUILT_IN_SERVICE_IDS = {
  accident: "luis_accidente",
  immigration: "luis_inmigracion",
  medicalCoupon: "luis_cupon_medico",
  supermarketCoupon: "luis_cupon_super",
  dentalCoupon: "luis_cupon_dental",
  events: "luis_eventos",
  grocery: "luis_compra_super",
  advisor: "luis_representante",
} as const;

const LG_PRIVACY =
  "Usaremos tus datos únicamente para orientarte y conectarte con recursos disponibles.";

const TEMPORARY_STATIC_ACTION_TEXT: Record<string, string> = {
  luis_cupon_medico:
    "🏥 ¡Ya tenés tu cupón de 20% de descuento en servicios médicos! Un representante de Luis Gabriel te va a contactar pronto con los detalles para usarlo.",
  luis_cupon_super:
    "🛒 ¡Ya tenés tu cupón de $10 para supermercado! Un representante de Luis Gabriel te va a contactar pronto con los detalles para usarlo.",
  luis_eventos:
    "📅 Pronto vamos a compartir el calendario completo de próximos eventos comunitarios. ¡Mantente atento a este WhatsApp!",
  luis_donacion:
    "🍲 Te vamos a compartir las fechas y lugares disponibles de donación de comida. Un representante te contacta pronto con los detalles.",
};

const DEMO_STATIC_ACTION_PARTNERS: Record<string, ReferralHubPartner> = {
  luis_cupon_medico: {
    id: "11111111-1111-4111-8111-111111111103",
    nombre: "[EJEMPLO] Clínica Familiar Hispana",
  },
  luis_cupon_super: {
    id: "11111111-1111-4111-8111-111111111104",
    nombre: "[EJEMPLO] Supermercado La Familia",
  },
  luis_eventos: {
    id: "11111111-1111-4111-8111-111111111105",
    nombre: "[EJEMPLO] Comité Comunitario Unidos",
  },
  luis_donacion: {
    id: "11111111-1111-4111-8111-111111111106",
    nombre: "[EJEMPLO] Banco de Alimentos Atlanta",
  },
};

const REFERRAL_HUB_INITIAL_PROMPT =
  "¡Hola! 👋 Soy el asistente de LG Community Network.\n\nPara comenzar, ¿cuál es tu nombre completo?";
const LG_MENU_PROMPT =
  "¡Hola! 👋 Bienvenido a LG Community.\n\n¿Qué necesitas hoy?\n\nTenemos beneficios y servicios disponibles para ti.";

const REFERRAL_HUB_GENERAL_CLOSING =
  "Gracias por ser parte de nuestra comunidad.\n¡Estamos de tu lado! 💚";

function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function normalizeText(input: unknown): string {
  return safeStr(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function truncateWhatsAppTitle(input: string, max = 24): string {
  return input.trim().slice(0, max);
}

function getReferralState(
  leadState: Json | null | undefined,
): ReferralHubState {
  const collected = (leadState?.collected ?? {}) as Json;
  const referral = (collected.referral_hub ?? {}) as ReferralHubState;
  return referral;
}

function mergeReferralState(
  leadState: Json | null | undefined,
  patch: ReferralHubState,
): Json {
  const collected = (leadState?.collected ?? {}) as Json;
  const current = (collected.referral_hub ?? {}) as ReferralHubState;
  return {
    ...collected,
    referral_hub: {
      ...current,
      ...patch,
    },
  };
}

function serviceLabel(config: ReferralHubServiceConfig): string {
  return safeStr(config.menu_label, safeStr(config.nombre, config.id));
}

function serviceTitle(config: ReferralHubServiceConfig): string {
  return truncateWhatsAppTitle(
    `${safeStr(config.icono)} ${serviceLabel(config)}`.trim(),
  );
}

function serviceActionId(serviceId: string): string {
  return `referral_service:${serviceId}`;
}

function optionActionId(field: string, index: number): string {
  return `referral_field:${field}:${index}`;
}

function optInActionId(value: "yes" | "no"): string {
  return `referral_optin:${value}`;
}

function publicPartnerName(
  partner: ReferralHubPartner | null | undefined,
): string {
  return safeStr(partner?.nombre)
    .replace(/^\s*\[EJEMPLO\]\s*/i, "")
    .trim();
}

function makeRedemptionCode(serviceId: string): string {
  const servicePart = safeStr(serviceId)
    .replace(/^luis_/, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 6)
    .toUpperCase() || "LUIS";
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 6)
    .toUpperCase();
  return `LG-${servicePart}-${randomPart}`;
}

function staticActionMessage(args: {
  config: ReferralHubServiceConfig;
  partnerName: string;
  redemptionCode: string;
}): string {
  const { config, partnerName, redemptionCode } = args;
  if (config.id === "luis_cupon_medico") {
    return `🏥 ¡Ya tenés tu cupón de 20% de descuento!\n📍 Válido en: ${partnerName}\n🎟️ Tu código: ${redemptionCode}\nMostrá este mensaje al llegar.`;
  }
  if (config.id === "luis_cupon_super") {
    return `🛒 ¡Ya tenés tu cupón de $10!\n📍 Válido en: ${partnerName}\n🎟️ Tu código: ${redemptionCode}\nMostrá este mensaje al llegar.`;
  }
  if (config.id === "luis_eventos") {
    return `📅 Anotado. Te vamos a avisar de los próximos eventos de ${partnerName}. 🎟️ Tu código de acceso: ${redemptionCode}`;
  }
  if (config.id === "luis_donacion") {
    return `🍲 Registrado. ${partnerName} te espera.\n🎟️ Tu código: ${redemptionCode}\nPresentalo en el lugar de entrega.`;
  }
  return "";
}

export function buildReferralHubMenuList(
  configs: ReferralHubServiceConfig[],
): WhatsAppInteractiveListSpec {
  return {
    body: "¿En qué podemos ayudarte?",
    buttonText: "Ver opciones",
    sections: [{
      title: "Opciones",
      rows: configs.map((config, index) => ({
        id: serviceActionId(config.id),
        title: serviceTitle(config),
        description: `${index + 1}. ${safeStr(config.nombre)}`.slice(0, 72),
      })),
    }],
  };
}

function buildOptionButtons(
  field: string,
  options: string[],
): InteractiveButton[] {
  return options.slice(0, 3).map((option, index) => ({
    id: optionActionId(field, index),
    title: truncateWhatsAppTitle(option, 20),
  }));
}

function buildOptionList(
  field: string,
  question: string,
  options: string[],
): WhatsAppInteractiveListSpec {
  return {
    body: question,
    buttonText: "Ver opciones",
    sections: [{
      title: "Opciones",
      rows: options.map((option, index) => ({
        id: optionActionId(field, index),
        title: truncateWhatsAppTitle(option),
      })),
    }],
  };
}

function objectiveOptions(objective: ReferralHubObjective): string[] {
  return Array.isArray(objective.opciones)
    ? objective.opciones.map((option) => safeStr(option).trim()).filter(Boolean)
    : [];
}

function nextMissingObjective(
  objectives: ReferralHubObjective[],
  data: Record<string, unknown>,
): ReferralHubObjective | null {
  return objectives.find((objective) =>
    objective.requerido !== false && !safeStr(data[objective.campo]).trim()
  ) ?? null;
}

function questionForObjective(objective: ReferralHubObjective): {
  reply: string;
  interactiveButtons?: InteractiveButton[];
  interactiveList?: WhatsAppInteractiveListSpec;
} {
  const options = objectiveOptions(objective);
  if (objective.tipo === "opciones" && options.length > 3) {
    return {
      reply: objective.pregunta,
      interactiveList: buildOptionList(
        objective.campo,
        objective.pregunta,
        options,
      ),
    };
  }
  if (objective.tipo === "opciones") {
    return {
      reply: objective.pregunta,
      interactiveButtons: buildOptionButtons(objective.campo, options),
    };
  }
  return { reply: objective.pregunta };
}

function extractServiceId(
  inboundText: string,
  payloadAction?: string | null,
): string | null {
  const action = safeStr(payloadAction, safeStr(inboundText)).trim();
  const match = action.match(/^referral_service:(.+)$/);
  return match?.[1] ?? null;
}

function extractOptInValue(
  inboundText: string,
  payloadAction?: string | null,
): "yes" | "no" | null {
  const action = safeStr(payloadAction, safeStr(inboundText)).trim()
    .toLowerCase();
  if (action === optInActionId("yes") || /^(si|sí|yes)$/i.test(action)) {
    return "yes";
  }
  if (action === optInActionId("no") || /^no$/i.test(action)) return "no";
  return null;
}

function resolveOptionAnswer(args: {
  objective: ReferralHubObjective;
  inboundText: string;
  payloadAction?: string | null;
}): string | null {
  const options = objectiveOptions(args.objective);
  const action = safeStr(args.payloadAction, safeStr(args.inboundText)).trim();
  const actionMatch = action.match(
    new RegExp(`^referral_field:${args.objective.campo}:(\\d+)$`),
  );
  if (actionMatch) {
    const index = Number(actionMatch[1]);
    return options[index] ?? null;
  }
  const normalized = normalizeText(args.inboundText);
  return options.find((option) => normalizeText(option) === normalized) ?? null;
}

function findServiceByFreeText(
  configs: ReferralHubServiceConfig[],
  inboundText: string,
): ReferralHubServiceConfig | null {
  const normalized = normalizeText(inboundText);
  if (!normalized) return null;
  const numeric = normalized.match(/^\d+$/)?.[0];
  if (numeric) {
    const index = Number(numeric) - 1;
    return configs[index] ?? null;
  }
  return configs.find((config) => {
    const label = normalizeText(serviceLabel(config));
    const name = normalizeText(config.nombre);
    return label === normalized || name === normalized ||
      label.includes(normalized) || normalized.includes(label);
  }) ?? null;
}

async function classifyMenuWithGroq(args: {
  inboundText: string;
  configs: ReferralHubServiceConfig[];
}): Promise<string | null> {
  const apiKey = safeStr(Deno.env.get("GROQ_API_KEY")).trim();
  if (!apiKey) return null;
  const model = safeStr(Deno.env.get("GROQ_MODEL"), "llama-3.3-70b-versatile");
  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Clasifica el mensaje del usuario a una opción de menú. Devuelve SOLO JSON con service_id y confidence. Si no estás seguro, confidence bajo. No inventes opciones.",
            },
            {
              role: "user",
              content: JSON.stringify({
                message: args.inboundText,
                options: args.configs.map((config) => ({
                  id: config.id,
                  label: serviceLabel(config),
                  nombre: config.nombre,
                  tipo: config.tipo,
                })),
              }),
            },
          ],
        }),
      },
    );
    if (!response.ok) return null;
    const json = await response.json();
    const content = safeStr(json?.choices?.[0]?.message?.content);
    const parsed = JSON.parse(content);
    const serviceId = safeStr(parsed?.service_id).trim();
    const confidence = Number(parsed?.confidence ?? 0);
    if (!serviceId || !Number.isFinite(confidence) || confidence < 0.72) {
      return null;
    }
    return args.configs.some((config) => config.id === serviceId)
      ? serviceId
      : null;
  } catch {
    return null;
  }
}

async function loadServiceConfigs(
  supabase: SupabaseLike,
  organizationId: string,
): Promise<ReferralHubServiceConfig[]> {
  const queryConfigs = (selectClause: string) =>
    supabase
      .from("service_configs")
      .select(selectClause)
      .eq("organization_id", organizationId)
      .eq("activo", true)
      .order("menu_orden", { ascending: true });

  let { data, error } = await queryConfigs(
    "id, organization_id, nombre, icono, tipo, menu_orden, menu_label, intake_objectives, accion_estatica, partner_id",
  );

  if (error && safeStr(error.message).includes("partner_id")) {
    const fallback = await queryConfigs(
      "id, organization_id, nombre, icono, tipo, menu_orden, menu_label, intake_objectives, accion_estatica",
    );
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    throw new Error(`referral_hub_configs_load_failed:${error.message}`);
  }
  const configs = ((data ?? []) as ReferralHubServiceConfig[])
    .filter((config) => safeStr(config.id).trim())
    .sort((a, b) => Number(a.menu_orden ?? 999) - Number(b.menu_orden ?? 999))
    .map((config) => ({
      ...config,
      partner: config.partner ?? DEMO_STATIC_ACTION_PARTNERS[config.id] ?? null,
      partner_id: safeStr(config.partner_id).trim() ||
        DEMO_STATIC_ACTION_PARTNERS[config.id]?.id || null,
    }));

  const partnerIds = [
    ...new Set(
      configs.map((config) => safeStr(config.partner_id).trim()).filter(
        Boolean,
      ),
    ),
  ];
  if (partnerIds.length === 0) return configs;

  const { data: partnersData, error: partnersError } = await supabase
    .from("partners")
    .select("id, nombre")
    .in("id", partnerIds);
  if (partnersError) {
    throw new Error(
      `referral_hub_partners_load_failed:${partnersError.message}`,
    );
  }

  const partnersById = new Map(
    ((partnersData ?? []) as ReferralHubPartner[]).map((
      partner,
    ) => [partner.id, partner]),
  );
  return configs.map((config) => ({
    ...config,
    partner: partnersById.get(safeStr(config.partner_id)) ?? config.partner ??
      null,
  }));
}

function buildSummary(
  config: ReferralHubServiceConfig,
  data: Record<string, unknown>,
): string {
  const objectives = Array.isArray(config.intake_objectives)
    ? config.intake_objectives
    : [];
  const lines = objectives
    .filter((objective) => safeStr(objective.campo).trim())
    .map((objective) =>
      `${objective.campo}: ${safeStr(data[objective.campo], "No informado")}`
    );
  return [`Servicio: ${serviceLabel(config)}`, ...lines].join("\n");
}

function buildSummaryLine(summary: string): string {
  const lines = safeStr(summary)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(1, 3).join(" · ") || lines[0] || "Solicitud completada.";
}

function confirmationForService(config: ReferralHubServiceConfig): string {
  if (config.id === "luis_accidente") {
    return "Gracias por la información. Luis Gabriel ya recibió tu solicitud y alguien de su equipo la va a revisar. Si tienes una emergencia médica llama inmediatamente al 911.";
  }
  if (config.id === "luis_inmigracion") {
    return "Gracias por la información. Luis Gabriel ya recibió tu solicitud de inmigración y alguien de su equipo la va a revisar.";
  }
  return "Gracias por la información. Luis Gabriel ya recibió tu solicitud y alguien de su equipo la va a revisar.";
}

function communityOptInButtons(): InteractiveButton[] {
  return [
    { id: optInActionId("yes"), title: "Sí" },
    { id: optInActionId("no"), title: "No" },
  ];
}

function menuResult(
  leadState: Json | null,
  configs: ReferralHubServiceConfig[],
): ReferralHubTurnResult {
  return {
    reply: "¿En qué podemos ayudarte?",
    interactiveList: buildReferralHubMenuList(configs),
    statePatch: {
      stage: "DISCOVERY",
      orgType: "referral_hub",
      active_flow: "referral_hub_menu",
      nextExpected: "referral_hub_menu",
      collected: mergeReferralState(leadState, {}),
      lastIntent: "referral_hub_menu",
    },
    debugNote: "referral_hub:menu",
  };
}

function staticActionResult(
  leadState: Json | null,
  config: ReferralHubServiceConfig,
  channelUserId?: string | null,
): ReferralHubTurnResult {
  const partner = config.partner ?? DEMO_STATIC_ACTION_PARTNERS[config.id] ??
    null;
  const partnerName = publicPartnerName(partner);
  const existingReferralState = getReferralState(leadState);
  const existingData = existingReferralState.service_id === config.id
    ? (existingReferralState.extracted_data ?? {})
    : {};
  const redemptionCode = safeStr(existingData.codigo_canje).trim() ||
    makeRedemptionCode(config.id);
  const partnerText = partnerName
    ? staticActionMessage({ config, partnerName, redemptionCode })
    : "";
  const text = partnerText ||
    safeStr((config.accion_estatica as Json | null)?.texto).trim() ||
    TEMPORARY_STATIC_ACTION_TEXT[config.id] ||
    `TODO: Luis Gabriel todavía no pasó el contenido final para "${
      serviceLabel(config)
    }".`;
  const knownName = safeStr(
    leadState?.full_name,
    safeStr(leadState?.first_name, ""),
  ).trim();
  const knownPhone = safeStr(channelUserId).trim();
  const extractedData = {
    service_label: serviceLabel(config),
    accion: "static_action",
    codigo_canje: redemptionCode,
    ...(partnerName ? { partner_nombre: partnerName } : {}),
    ...(config.partner_id || partner?.id
      ? { partner_id: config.partner_id ?? partner?.id }
      : {}),
    ...(knownName ? { nombre: knownName } : {}),
    ...(knownPhone ? { telefono: knownPhone } : {}),
  };
  return {
    reply: text,
    statePatch: {
      stage: "DISCOVERY",
      orgType: "referral_hub",
      active_flow: "referral_hub_menu",
      nextExpected: "referral_hub_menu",
      collected: mergeReferralState(leadState, {
        service_id: config.id,
        service_label: serviceLabel(config),
        extracted_data: extractedData,
      }),
      lastIntent: "referral_hub_static_action",
    },
    leadPatch: {
      service_id: config.id,
      extracted_data: extractedData,
      recomendacion: `static_action:${config.id}`,
      ...(config.partner_id || partner?.id
        ? { partner_recomendado: config.partner_id ?? partner?.id }
        : {}),
      status: "qualified",
    },
    debugNote: "referral_hub:static_action",
  };
}

function transferResult(
  leadState: Json | null,
  config: ReferralHubServiceConfig,
): ReferralHubTurnResult {
  const takeoverState = activateHumanTakeoverState({
    state: leadState,
    source: "human_replied_from_dashboard",
    actor: "referral_hub_transfer",
    pauseMinutes: 240,
  });
  return {
    reply:
      "Listo. Te vamos a pasar con un representante de Luis Gabriel para que te atienda directamente.",
    statePatch: {
      ...takeoverState,
      stage: "HANDOFF",
      orgType: "referral_hub",
      active_flow: "human_takeover",
      collected: mergeReferralState(leadState, {
        service_id: config.id,
        service_label: serviceLabel(config),
        extracted_data: {
          ...(getReferralState(leadState).extracted_data ?? {}),
          prioridad: "alta",
        },
      }),
      lastIntent: "referral_hub_transfer",
      nextExpected: undefined,
    },
    leadPatch: {
      handoff_to_human: true,
      service_id: config.id,
      extracted_data: {
        ...(getReferralState(leadState).extracted_data ?? {}),
        prioridad: "alta",
      },
      recomendacion: "transferir_a_humano",
      updated_at: new Date().toISOString(),
    },
    debugNote: "referral_hub:transfer",
  };
}

function startIntakeResult(
  leadState: Json | null,
  config: ReferralHubServiceConfig,
): ReferralHubTurnResult {
  const objectives = Array.isArray(config.intake_objectives)
    ? config.intake_objectives
    : [];
  const data: Record<string, unknown> = {};
  const nextObjective = nextMissingObjective(objectives, data);
  if (!nextObjective) {
    return completedIntakeResult(leadState, config, data);
  }
  const question = questionForObjective(nextObjective);
  return {
    reply: question.reply,
    interactiveButtons: question.interactiveButtons,
    interactiveList: question.interactiveList,
    statePatch: {
      stage: "DISCOVERY",
      orgType: "referral_hub",
      active_flow: "referral_hub_intake",
      nextExpected: `referral_hub:${nextObjective.campo}`,
      collected: mergeReferralState(leadState, {
        service_id: config.id,
        service_label: serviceLabel(config),
        current_field: nextObjective.campo,
        extracted_data: data,
      }),
      lastIntent: "referral_hub_intake_start",
    },
    leadPatch: {
      service_id: config.id,
      extracted_data: data,
    },
    debugNote: "referral_hub:intake_start",
  };
}

function completedIntakeResult(
  leadState: Json | null,
  config: ReferralHubServiceConfig,
  data: Record<string, unknown>,
): ReferralHubTurnResult {
  const resumen = buildSummary(config, data);
  const leadName = safeStr(data.nombre, "Sin nombre").trim() || "Sin nombre";
  return {
    reply: `${
      confirmationForService(config)
    }\n\n¿Deseas recibir información sobre eventos, promociones y recursos para nuestra comunidad?`,
    interactiveButtons: communityOptInButtons(),
    statePatch: {
      stage: "QUALIFIED",
      orgType: "referral_hub",
      active_flow: "referral_hub_opt_in",
      nextExpected: "referral_hub_community_opt_in",
      collected: mergeReferralState(leadState, {
        service_id: config.id,
        service_label: serviceLabel(config),
        current_field: null,
        extracted_data: data,
        awaiting_community_opt_in: true,
      }),
      lastIntent: "referral_hub_intake_completed",
    },
    leadPatch: {
      service_id: config.id,
      extracted_data: data,
      resumen_auto: resumen,
      recomendacion: "qualified_referral",
      status: "qualified",
    },
    debugNote: "referral_hub:intake_completed",
    notification: {
      type: "referral_hub_qualified_lead",
      leadName,
      serviceName: serviceLabel(config),
      summaryLine: buildSummaryLine(resumen),
    },
  };
}

function continueIntakeResult(args: {
  leadState: Json | null;
  config: ReferralHubServiceConfig;
  inboundText: string;
  payloadAction?: string | null;
}): ReferralHubTurnResult {
  const objectives = Array.isArray(args.config.intake_objectives)
    ? args.config.intake_objectives
    : [];
  const referralState = getReferralState(args.leadState);
  const data = { ...(referralState.extracted_data ?? {}) };
  const current =
    objectives.find((objective) =>
      objective.campo === referralState.current_field
    ) ??
      nextMissingObjective(objectives, data);
  if (!current) return completedIntakeResult(args.leadState, args.config, data);

  const answer = current.tipo === "opciones"
    ? resolveOptionAnswer({
      objective: current,
      inboundText: args.inboundText,
      payloadAction: args.payloadAction,
    })
    : safeStr(args.inboundText).trim();

  if (!answer) {
    const retry = questionForObjective(current);
    return {
      reply: retry.reply,
      interactiveButtons: retry.interactiveButtons,
      interactiveList: retry.interactiveList,
      statePatch: {
        stage: "DISCOVERY",
        orgType: "referral_hub",
        active_flow: "referral_hub_intake",
        nextExpected: `referral_hub:${current.campo}`,
        collected: mergeReferralState(args.leadState, {
          service_id: args.config.id,
          service_label: serviceLabel(args.config),
          current_field: current.campo,
          extracted_data: data,
        }),
        lastIntent: "referral_hub_retry_field",
      },
      leadPatch: {
        service_id: args.config.id,
        extracted_data: data,
      },
      debugNote: "referral_hub:retry_field",
    };
  }

  data[current.campo] = answer;
  const nextObjective = nextMissingObjective(objectives, data);
  if (!nextObjective) {
    return completedIntakeResult(args.leadState, args.config, data);
  }

  const nextQuestion = questionForObjective(nextObjective);
  return {
    reply: nextQuestion.reply,
    interactiveButtons: nextQuestion.interactiveButtons,
    interactiveList: nextQuestion.interactiveList,
    statePatch: {
      stage: "DISCOVERY",
      orgType: "referral_hub",
      active_flow: "referral_hub_intake",
      nextExpected: `referral_hub:${nextObjective.campo}`,
      collected: mergeReferralState(args.leadState, {
        service_id: args.config.id,
        service_label: serviceLabel(args.config),
        current_field: nextObjective.campo,
        extracted_data: data,
      }),
      lastIntent: "referral_hub_field_captured",
    },
    leadPatch: {
      service_id: args.config.id,
      extracted_data: data,
    },
    debugNote: "referral_hub:field_captured",
  };
}

function optInResult(args: {
  leadState: Json | null;
  value: "yes" | "no";
}): ReferralHubTurnResult {
  const referralState = getReferralState(args.leadState);
  const data = {
    ...(referralState.extracted_data ?? {}),
    recibir_info_comunidad: args.value === "yes",
  };
  return {
    reply: REFERRAL_HUB_GENERAL_CLOSING,
    statePatch: {
      stage: "QUALIFIED",
      orgType: "referral_hub",
      active_flow: "referral_hub_completed",
      nextExpected: undefined,
      collected: mergeReferralState(args.leadState, {
        extracted_data: data,
        awaiting_community_opt_in: false,
      }),
      lastIntent: "referral_hub_community_opt_in",
    },
    leadPatch: {
      extracted_data: data,
      status: "qualified",
    },
    debugNote: "referral_hub:community_opt_in",
  };
}

type CanonicalMenuConfig = Pick<
  ReferralHubServiceConfig,
  "id" | "nombre" | "menu_label" | "menu_orden" | "activo"
>;

const LG_MENU_DESCRIPTIONS: Record<string, string> = {
  [BUILT_IN_SERVICE_IDS.accident]: "Ayuda inmediata",
  [BUILT_IN_SERVICE_IDS.immigration]: "Orientación con un profesional",
  [BUILT_IN_SERVICE_IDS.medicalCoupon]: "20% de descuento",
  [BUILT_IN_SERVICE_IDS.supermarketCoupon]: "Cupón de $10",
  [BUILT_IN_SERVICE_IDS.dentalCoupon]: "Consulta, limpieza y rayos X",
  [BUILT_IN_SERVICE_IDS.events]: "Próximos eventos",
  [BUILT_IN_SERVICE_IDS.grocery]: "Canastas con delivery",
  [BUILT_IN_SERVICE_IDS.advisor]: "Atención personal",
};

const LG_PRIMARY_SERVICE_IDS = [
  BUILT_IN_SERVICE_IDS.medicalCoupon,
  BUILT_IN_SERVICE_IDS.dentalCoupon,
  BUILT_IN_SERVICE_IDS.accident,
  BUILT_IN_SERVICE_IDS.grocery,
];

const LG_PRIMARY_SERVICE_LABELS: Record<string, string> = {
  [BUILT_IN_SERVICE_IDS.medicalCoupon]: "Cupón médico",
  [BUILT_IN_SERVICE_IDS.dentalCoupon]: "Cupón dental",
  [BUILT_IN_SERVICE_IDS.accident]: "Accidentes",
  [BUILT_IN_SERVICE_IDS.grocery]: "Supermercado",
};

function canonicalServiceLabel(config: CanonicalMenuConfig) {
  return truncateWhatsAppTitle(
    LG_PRIMARY_SERVICE_LABELS[config.id] ||
      safeStr(config.menu_label).trim() ||
      safeStr(config.nombre).trim() ||
      serviceLabelFromId(config.id),
  );
}

function canonicalMenuRows(configs: CanonicalMenuConfig[]) {
  return configs.map((config) => ({
    id: serviceActionId(config.id),
    title: canonicalServiceLabel(config),
    description: LG_MENU_DESCRIPTIONS[config.id] ?? "Más información",
  }));
}

function sortCanonicalMenuConfigs(configs: CanonicalMenuConfig[]) {
  return [...configs].sort((left, right) => {
    const leftPriority = LG_PRIMARY_SERVICE_IDS.indexOf(
      left.id as typeof LG_PRIMARY_SERVICE_IDS[number],
    );
    const rightPriority = LG_PRIMARY_SERVICE_IDS.indexOf(
      right.id as typeof LG_PRIMARY_SERVICE_IDS[number],
    );
    if (leftPriority !== -1 || rightPriority !== -1) {
      return (leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority) -
        (rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority);
    }
    const leftOrder = Number.isFinite(Number(left.menu_orden))
      ? Number(left.menu_orden)
      : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(Number(right.menu_orden))
      ? Number(right.menu_orden)
      : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder ||
      canonicalServiceLabel(left).localeCompare(canonicalServiceLabel(right));
  });
}

function additionalMenuConfigs(configs: CanonicalMenuConfig[]) {
  return configs.filter((config) =>
    !LG_PRIMARY_SERVICE_IDS.includes(
      config.id as typeof LG_PRIMARY_SERVICE_IDS[number],
    ) && config.id !== BUILT_IN_SERVICE_IDS.advisor
  );
}

function buildLgMenuList(
  configs?: CanonicalMenuConfig[],
): WhatsAppInteractiveListSpec {
  if (configs) {
    const primary = canonicalMenuRows(
      configs.filter((config) =>
        LG_PRIMARY_SERVICE_IDS.includes(
          config.id as typeof LG_PRIMARY_SERVICE_IDS[number],
        )
      ),
    );
    if (additionalMenuConfigs(configs).length > 0) {
      primary.push({
        id: "referral_menu:more",
        title: "Ver más servicios",
        description: "Más opciones disponibles",
      });
    }
    primary.push({
      id: "referral_handoff:advisor",
      title: "Hablar con asesor",
      description: "Atención personal",
    });
    return {
      body: LG_MENU_PROMPT,
      buttonText: "Ver servicios",
      sections: [{ title: "Servicios", rows: primary }],
    };
  }
  return {
    body: LG_MENU_PROMPT,
    buttonText: "Ver opciones",
    sections: [{
      title: "Servicios",
      rows: [
        {
          id: serviceActionId(BUILT_IN_SERVICE_IDS.medicalCoupon),
          title: "Cupón médico",
          description: "20% de descuento",
        },
        {
          id: serviceActionId(BUILT_IN_SERVICE_IDS.dentalCoupon),
          title: "Cupón dental",
          description: "Consulta, limpieza y rayos X",
        },
        {
          id: serviceActionId(BUILT_IN_SERVICE_IDS.accident),
          title: "Accidentes",
          description: "Ayuda inmediata",
        },
        {
          id: serviceActionId(BUILT_IN_SERVICE_IDS.grocery),
          title: "Supermercado",
          description: "Cupón y canastas con delivery",
        },
        {
          id: serviceActionId(BUILT_IN_SERVICE_IDS.immigration),
          title: "Inmigración",
          description: "Orientación con un profesional",
        },
        {
          id: serviceActionId(BUILT_IN_SERVICE_IDS.supermarketCoupon),
          title: "Cupón supermercado",
          description: "Cupón de $10",
        },
        {
          id: serviceActionId(BUILT_IN_SERVICE_IDS.events),
          title: "Eventos comunitarios",
          description: "Próximos eventos",
        },
        {
          id: "referral_handoff:advisor",
          title: "Hablar con asesor",
          description: "Atención personal",
        },
      ],
    }],
  };
}

function buildLgMoreList(
  configs: CanonicalMenuConfig[],
): WhatsAppInteractiveListSpec {
  return {
    body: "Más servicios disponibles",
    buttonText: "Ver servicios",
    sections: [{
      title: "Más servicios",
      rows: canonicalMenuRows(additionalMenuConfigs(configs)),
    }],
  };
}

export function buildLgMessengerQuickReplies(
  configs?: CanonicalMenuConfig[],
  more = false,
): InteractiveButton[] {
  if (configs) {
    const services = more
      ? additionalMenuConfigs(configs)
      : configs.filter((config) =>
        LG_PRIMARY_SERVICE_IDS.includes(
          config.id as typeof LG_PRIMARY_SERVICE_IDS[number],
        )
      );
    const buttons = services.map((config) => ({
      id: serviceActionId(config.id),
      title: canonicalServiceLabel(config),
    }));
    if (more) return buttons;
    if (additionalMenuConfigs(configs).length > 0) {
      buttons.push({ id: "referral_menu:more", title: "Ver más servicios" });
    }
    buttons.push({
      id: "referral_handoff:advisor",
      title: "Hablar con asesor",
    });
    return buttons;
  }
  return [
    {
      id: serviceActionId(BUILT_IN_SERVICE_IDS.medicalCoupon),
      title: "Cupón médico",
    },
    {
      id: serviceActionId(BUILT_IN_SERVICE_IDS.dentalCoupon),
      title: "Cupón dental",
    },
    { id: serviceActionId(BUILT_IN_SERVICE_IDS.accident), title: "Accidentes" },
    {
      id: serviceActionId(BUILT_IN_SERVICE_IDS.grocery),
      title: "Supermercado",
    },
    { id: "referral_menu:more", title: "Ver más servicios" },
    { id: "referral_handoff:advisor", title: "Hablar con asesor" },
  ];
}

function buildLgWelcomeReply(leadState: Json | null): string {
  const referralState = getReferralState(leadState);
  const name = safeStr(referralState.profile_name).trim();
  if (!name) {
    return REFERRAL_HUB_INITIAL_PROMPT;
  }
  const city = safeStr(referralState.profile_city).trim();
  if (!city) {
    return `Mucho gusto, ${firstName(name)}. ¿En qué ciudad vives?`;
  }
  return LG_MENU_PROMPT;
}

function firstName(value: string) {
  return safeStr(value).trim().split(/\s+/)[0] || "mucho gusto";
}

function cityConfirmationButtons(city: string): InteractiveButton[] {
  return [
    {
      id: "referral_field_confirm:profile_city:yes",
      title: `Sí, ${city}`.slice(0, 20),
    },
    { id: "referral_field_confirm:profile_city:no", title: "Es otra ciudad" },
  ];
}

function dateConfirmationButtons(): InteractiveButton[] {
  return [
    { id: "referral_field_confirm:accident_date:yes", title: "Sí, esa fecha" },
    { id: "referral_field_confirm:accident_date:no", title: "Otra fecha" },
  ];
}

function submissionConfirmationButtons(serviceId: string): InteractiveButton[] {
  return [
    { id: `referral_submit:${serviceId}:yes`, title: "Enviar solicitud" },
    { id: `referral_submit:${serviceId}:no`, title: "Cancelar" },
  ];
}

function shouldResetLuisMenu(input: string): boolean {
  const normalized = normalizeText(input);
  return [
    "demo",
    "menu",
    "menu principal",
    "ver otros servicios",
    "inicio",
    "reiniciar",
  ].includes(normalized);
}

function resetLuisMenuState(leadState: Json | null): Json {
  const referralState = getReferralState(leadState);
  return buildLgStatePatch(leadState, {
    ...referralState,
    service_id: null,
    service_label: null,
    current_field: null,
    profile_edit_field: null,
    pending_field_confirmation: null,
    extracted_data: {},
    food_option: null,
    grocery: null,
  });
}

function continuationActions(): InteractiveButton[] {
  return [
    { id: "referral_menu:services", title: "Ver otros servicios" },
    { id: "referral_handoff:advisor", title: "Hablar con asesor" },
    { id: "referral_menu:main", title: "Menú principal" },
  ];
}

function completeLgServiceState(
  leadState: Json | null,
  serviceId: string,
  outcome: string,
  patch: ReferralHubState = {},
): Json {
  return buildLgStatePatch(leadState, {
    ...getReferralState(leadState),
    ...patch,
    service_id: null,
    service_label: null,
    current_field: null,
    pending_field_confirmation: null,
    last_completion: {
      service_id: serviceId,
      completed_at: new Date().toISOString(),
      outcome,
    },
  });
}

function normalizedAction(input: string | null | undefined): string {
  return safeStr(input).trim().replace(/^action:/, "");
}

function isReturningEntry(input: string): boolean {
  return /^(hola|hello|menu|menú|inicio|empezar|start)$/i.test(
    safeStr(input).trim(),
  );
}

function isLuisDiscoveryEntry(input: string): boolean {
  const normalized = normalizeText(input);
  const flyerServiceDiscovery =
    /^(hola[,.!\s]+)?(?:quiero\s+)?(?:conocer|ver)\s+(?:los?\s+)?servicios\b/
      .test(normalized);
  return isReturningEntry(input) || flyerServiceDiscovery || [
    "buenas",
    "buenos dias",
    "buenas tardes",
    "informacion",
    "info",
    "quiero informacion",
    "que servicios tienen",
    "que ofrecen",
    "que hacen",
    "necesito ayuda",
    "me interesa",
    "quiero ver los servicios",
    "vi el flyer",
    "vengo por el flyer",
    "escanee el qr",
    "qr",
  ].includes(normalized);
}

function isLuisNamedGreeting(input: string): boolean {
  return /^(hola|hello|buenas|buenos dias|buenas tardes)[,!\s.]+(luis|conexxion)\b/i
    .test(normalizeText(input));
}

function isStopRequest(input: string): boolean {
  const normalized = normalizeText(input);
  return [
    "stop",
    "salir",
    "cancelar mensajes",
    "no mas mensajes",
    "no más mensajes",
  ].includes(normalized);
}

function resolveServiceIdFromInput(input: string): string | null {
  const raw = safeStr(input).trim().replace(/^action:/, "");
  if (raw.startsWith("referral_service:")) {
    const requestedServiceId = raw.slice("referral_service:".length);
    const serviceId = requestedServiceId === "luis_asesor"
      ? BUILT_IN_SERVICE_IDS.advisor
      : requestedServiceId;
    return Object.values(BUILT_IN_SERVICE_IDS).includes(serviceId as any)
      ? serviceId
      : null;
  }
  if (raw.includes(":")) return null;
  const normalized = normalizeText(input);
  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized) - 1;
    const ids = Object.values(BUILT_IN_SERVICE_IDS);
    return ids[index] ?? null;
  }
  if (normalized.includes("accidente") || normalized.includes("choque")) {
    return BUILT_IN_SERVICE_IDS.accident;
  }
  if (normalized.includes("inmigr") || normalized.includes("migratorio")) {
    return BUILT_IN_SERVICE_IDS.immigration;
  }
  if (
    normalized.includes("medico") || normalized.includes("descuento medico") ||
    normalized.includes("coupon medico") || normalized.includes("cupon medico")
  ) return BUILT_IN_SERVICE_IDS.medicalCoupon;
  if (
    normalized.includes("cupon") &&
    (normalized.includes("supermerc") || normalized.includes("super"))
  ) return BUILT_IN_SERVICE_IDS.supermarketCoupon;
  if (normalized.includes("cupon")) {
    return BUILT_IN_SERVICE_IDS.supermarketCoupon;
  }
  if (
    normalized.includes("supermerc") || normalized === "super" ||
    (normalized.includes("compra") && normalized.includes("comida"))
  ) return BUILT_IN_SERVICE_IDS.grocery;
  if (
    normalized.includes("dental") || normalized.includes("dentista") ||
    normalized.includes("muela") || normalized.includes("rayos x") ||
    normalized.includes("rayosx")
  ) return BUILT_IN_SERVICE_IDS.dentalCoupon;
  if (normalized.includes("evento") || normalized.includes("agenda")) {
    return BUILT_IN_SERVICE_IDS.events;
  }
  if (
    normalized.includes("asesor") || normalized.includes("humano") ||
    normalized.includes("persona") || normalized.includes("hablar") ||
    normalized.includes("abogado")
  ) return BUILT_IN_SERVICE_IDS.advisor;
  return null;
}

function buildLgStatePatch(
  leadState: Json | null,
  patch: ReferralHubState,
): Json {
  return {
    stage: "DISCOVERY",
    orgType: "referral_hub",
    active_flow: "referral_hub_menu",
    nextExpected: "referral_hub_menu",
    collected: mergeReferralState(leadState, patch),
    lastIntent: "referral_hub_lg_menu",
  };
}

function startLgProfileFlow(leadState: Json | null): ReferralHubTurnResult {
  const referralState = getReferralState(leadState);
  const reply = buildLgWelcomeReply(leadState);
  const currentField = !safeStr(referralState.profile_name).trim()
    ? "profile_name"
    : !safeStr(referralState.profile_city).trim()
    ? "profile_city"
    : null;
  return {
    reply,
    statePatch: buildLgStatePatch(leadState, {
      service_id: null,
      service_label: null,
      current_field: currentField,
      extracted_data: { ...(referralState.extracted_data ?? {}) },
      profile_name: referralState.profile_name ?? null,
      profile_city: referralState.profile_city ?? null,
      profile_complete: Boolean(
        referralState.profile_name && referralState.profile_city,
      ),
      stop_requested: referralState.stop_requested ?? false,
      grocery: null,
    }),
    debugNote: "referral_hub:lg_profile",
  };
}

async function updateProfileFromInput(
  leadState: Json | null,
  inboundText: string,
  channel: "messenger" | "whatsapp" = "whatsapp",
  payloadAction?: string | null,
  menuConfigs?: CanonicalMenuConfig[],
): Promise<ReferralHubTurnResult> {
  const referralState = getReferralState(leadState);
  const nextState = {
    ...referralState,
    profile_name: safeStr(referralState.profile_name).trim() || null,
    profile_city: safeStr(referralState.profile_city).trim() || null,
    profile_complete: Boolean(
      safeStr(referralState.profile_name).trim() &&
        safeStr(referralState.profile_city).trim(),
    ),
  };
  const trimmed = safeStr(inboundText).trim();
  if (!nextState.profile_name && trimmed) {
    const profileComplete = Boolean(nextState.profile_city);
    const updated = {
      ...nextState,
      profile_name: trimmed,
      current_field: profileComplete ? null : "profile_city",
      profile_complete: profileComplete,
      profile_edit_field: null,
    };
    return {
      reply: profileComplete
        ? `Listo, ${firstName(trimmed)}. ${LG_MENU_PROMPT}`
        : `Mucho gusto, ${firstName(trimmed)}. ¿En qué ciudad vives?`,
      interactiveList: profileComplete && channel === "whatsapp"
        ? buildLgMenuList(menuConfigs)
        : undefined,
      interactiveButtons: profileComplete && channel === "messenger"
        ? buildLgMessengerQuickReplies(menuConfigs)
        : undefined,
      statePatch: buildLgStatePatch(leadState, updated),
      debugNote: "referral_hub:lg_profile_name",
    };
  }
  if (!nextState.profile_city && trimmed) {
    const pending =
      nextState.pending_field_confirmation?.field === "profile_city"
        ? nextState.pending_field_confirmation
        : null;
    const normalizedAction = normalizeText(payloadAction ?? "");
    const normalizedInbound = normalizeText(trimmed);
    const confirmed = normalizedAction.endsWith(":yes") ||
      /^(si|sí)(,|\s|$)/i.test(trimmed);
    const rejected = normalizedAction.endsWith(":no") ||
      /^(no|es otra ciudad)(,|\s|$)/i.test(trimmed);
    if (pending && confirmed && pending.interpretation.normalizedValue) {
      const city = pending.interpretation.normalizedValue;
      const updated = {
        ...nextState,
        profile_city: city,
        current_field: null,
        profile_complete: true,
        pending_field_confirmation: null,
      };
      return {
        reply: `Perfecto, ${
          firstName(safeStr(updated.profile_name))
        }. ${LG_MENU_PROMPT}\n\n${LG_PRIVACY}`,
        interactiveList: channel === "whatsapp"
          ? buildLgMenuList(menuConfigs)
          : undefined,
        interactiveButtons: channel === "messenger"
          ? buildLgMessengerQuickReplies(menuConfigs)
          : undefined,
        statePatch: buildLgStatePatch(leadState, updated),
        debugNote: "referral_hub:lg_profile_city_confirmed",
      };
    }
    if (pending && rejected) {
      const replacement = trimmed.replace(
        /^(no|es otra ciudad)\s*[,.:;-]?\s*/i,
        "",
      ).trim();
      if (!replacement || normalizedAction.endsWith(":no")) {
        return {
          reply: "Está bien. ¿En qué ciudad vives?",
          statePatch: buildLgStatePatch(leadState, {
            ...nextState,
            current_field: "profile_city",
            pending_field_confirmation: null,
          }),
          debugNote: "referral_hub:lg_profile_city_rejected",
        };
      }
      const replacementResult = await interpretCity(replacement);
      if (
        !replacementResult.normalizedValue ||
        replacementResult.confidence === "low"
      ) {
        return {
          reply: replacementResult.clarificationPrompt ??
            "No pude identificar la ciudad. ¿Puedes escribirla nuevamente?",
          statePatch: buildLgStatePatch(leadState, {
            ...nextState,
            current_field: "profile_city",
            pending_field_confirmation: null,
          }),
          debugNote: "referral_hub:lg_profile_city_retry",
        };
      }
      if (replacementResult.needsConfirmation) {
        return {
          reply: replacementResult.clarificationPrompt ??
            `¿Te refieres a ${replacementResult.normalizedValue}?`,
          interactiveButtons: cityConfirmationButtons(
            replacementResult.normalizedValue,
          ),
          statePatch: buildLgStatePatch(leadState, {
            ...nextState,
            current_field: "profile_city",
            pending_field_confirmation: {
              field: "profile_city",
              interpretation: replacementResult,
            },
          }),
          debugNote: "referral_hub:lg_profile_city_candidate",
        };
      }
      const updated = {
        ...nextState,
        profile_city: replacementResult.normalizedValue,
        current_field: null,
        profile_complete: true,
        pending_field_confirmation: null,
      };
      return {
        reply: `Perfecto, ${
          firstName(safeStr(updated.profile_name))
        }. ${LG_MENU_PROMPT}\n\n${LG_PRIVACY}`,
        interactiveList: channel === "whatsapp"
          ? buildLgMenuList(menuConfigs)
          : undefined,
        interactiveButtons: channel === "messenger"
          ? buildLgMessengerQuickReplies(menuConfigs)
          : undefined,
        statePatch: buildLgStatePatch(leadState, updated),
        debugNote: "referral_hub:lg_profile_city_corrected",
      };
    }
    const interpretation = await interpretCity(trimmed);
    if (
      !interpretation.normalizedValue || interpretation.confidence === "low"
    ) {
      return {
        reply: interpretation.clarificationPrompt ??
          "No pude identificar la ciudad. ¿Puedes escribirla nuevamente?",
        statePatch: buildLgStatePatch(leadState, {
          ...nextState,
          current_field: "profile_city",
          pending_field_confirmation: null,
        }),
        debugNote: "referral_hub:lg_profile_city_retry",
      };
    }
    if (interpretation.needsConfirmation) {
      return {
        reply: interpretation.clarificationPrompt ??
          `¿Te refieres a ${interpretation.normalizedValue}?`,
        interactiveButtons: cityConfirmationButtons(
          interpretation.normalizedValue,
        ),
        statePatch: buildLgStatePatch(leadState, {
          ...nextState,
          current_field: "profile_city",
          pending_field_confirmation: { field: "profile_city", interpretation },
        }),
        debugNote: "referral_hub:lg_profile_city_candidate",
      };
    }
    const updated = {
      ...nextState,
      profile_city: interpretation.normalizedValue,
      current_field: null,
      profile_complete: true,
      pending_field_confirmation: null,
    };
    return {
      reply: `Perfecto, ${
        firstName(safeStr(updated.profile_name))
      }. ${LG_MENU_PROMPT}\n\n${LG_PRIVACY}`,
      interactiveList: channel === "whatsapp"
        ? buildLgMenuList(menuConfigs)
        : undefined,
      interactiveButtons: channel === "messenger"
        ? buildLgMessengerQuickReplies(menuConfigs)
        : undefined,
      statePatch: buildLgStatePatch(leadState, updated),
      debugNote: "referral_hub:lg_profile_city",
    };
  }
  return startLgProfileFlow(leadState);
}

function handleLgMenu(
  leadState: Json | null,
  channel: "messenger" | "whatsapp" = "whatsapp",
  reply = LG_MENU_PROMPT,
  configs?: CanonicalMenuConfig[],
): ReferralHubTurnResult {
  const referralState = getReferralState(leadState);
  return {
    reply,
    interactiveButtons: channel === "messenger"
      ? buildLgMessengerQuickReplies(configs)
      : undefined,
    interactiveList: channel === "whatsapp"
      ? buildLgMenuList(configs)
      : undefined,
    statePatch: buildLgStatePatch(leadState, {
      service_id: null,
      service_label: null,
      current_field: null,
      extracted_data: { ...(referralState.extracted_data ?? {}) },
      profile_name: referralState.profile_name ?? null,
      profile_city: referralState.profile_city ?? null,
      profile_complete: Boolean(
        referralState.profile_name && referralState.profile_city,
      ),
      stop_requested: referralState.stop_requested ?? false,
      grocery: null,
    }),
    debugNote: "referral_hub:lg_menu",
  };
}

function handleLgMoreMenu(
  leadState: Json | null,
  channel: "messenger" | "whatsapp",
  configs: CanonicalMenuConfig[],
): ReferralHubTurnResult {
  const referralState = getReferralState(leadState);
  if (configs.length === 0) {
    return {
      reply:
        "Por el momento no hay servicios disponibles. Intenta nuevamente más tarde.",
      interactiveButtons: continuationActions(),
      statePatch: buildLgStatePatch(leadState, {
        ...referralState,
        current_field: null,
        grocery: null,
      }),
      debugNote: "referral_hub:lg_menu_no_active_services",
    };
  }
  return {
    reply: "Más servicios disponibles",
    interactiveButtons: channel === "messenger"
      ? buildLgMessengerQuickReplies(configs, true)
      : undefined,
    interactiveList: channel === "whatsapp"
      ? buildLgMoreList(configs)
      : undefined,
    statePatch: buildLgStatePatch(leadState, {
      ...referralState,
      current_field: null,
      grocery: null,
    }),
    debugNote: "referral_hub:lg_menu_more",
  };
}

async function loadCanonicalMenuConfigs(args: {
  supabase?: SupabaseLike;
  organizationId: string;
  serviceConfigs?: ReferralHubServiceConfig[];
}): Promise<CanonicalMenuConfig[] | null> {
  const supportedIds = new Set(Object.values(BUILT_IN_SERVICE_IDS));
  const normalize = (rows: ReferralHubServiceConfig[]) => {
    const supported = rows.filter((config) =>
      config.organization_id === args.organizationId &&
      supportedIds.has(
        config
          .id as typeof BUILT_IN_SERVICE_IDS[keyof typeof BUILT_IN_SERVICE_IDS],
      )
    );
    return sortCanonicalMenuConfigs(
      supported.filter((config) => config.activo !== false),
    );
  };
  if (args.serviceConfigs) return normalize(args.serviceConfigs);
  if (!args.supabase || typeof args.supabase.from !== "function") return null;
  try {
    const { data, error } = await args.supabase.from("service_configs")
      .select("organization_id,id,nombre,menu_label,menu_orden,activo")
      .eq("organization_id", args.organizationId)
      .order("menu_orden", { ascending: true });
    if (error || !Array.isArray(data) || data.length === 0) {
      console.warn("[Referral Hub] Canonical menu configuration unavailable", {
        organizationId: args.organizationId,
        reason: safeStr(error?.message) || "empty",
      });
      return null;
    }
    return normalize(data as ReferralHubServiceConfig[]);
  } catch (error) {
    console.warn("[Referral Hub] Canonical menu configuration unavailable", {
      organizationId: args.organizationId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

const TRANSIENT_SERVICE_FIELDS = new Set([
  "service",
  "accident_date",
  "accident_city",
  "police_report",
  "accident_injuries",
  "contact_name",
  "contact_phone",
  "immigration_case",
  "food_option",
  "food_donation_details",
  "food_support_details",
]);

function withoutTransientServiceFields(
  input: Record<string, unknown> | undefined,
) {
  return Object.fromEntries(
    Object.entries(input ?? {}).filter(([key]) =>
      !TRANSIENT_SERVICE_FIELDS.has(key)
    ),
  );
}

function stopResult(leadState: Json | null): ReferralHubTurnResult {
  return {
    reply:
      "Entendido. No seguiremos enviando mensajes promocionales ni de seguimiento. Tu historial se conservará.",
    statePatch: buildLgStatePatch(leadState, {
      service_id: null,
      service_label: null,
      current_field: null,
      extracted_data: { ...(getReferralState(leadState).extracted_data ?? {}) },
      stop_requested: true,
      profile_name: getReferralState(leadState).profile_name ?? null,
      profile_city: getReferralState(leadState).profile_city ?? null,
      profile_complete: Boolean(
        getReferralState(leadState).profile_name &&
          getReferralState(leadState).profile_city,
      ),
      food_option: null,
    }),
    debugNote: "referral_hub:stop",
  };
}

function couponNextActions(): InteractiveButton[] {
  return continuationActions();
}

function groceryEntryActions(): InteractiveButton[] {
  return [
    { id: "referral_grocery:coupon", title: "Quiero mi cupón" },
    { id: "referral_grocery:baskets", title: "Ver las canastas" },
  ];
}

function groceryCouponUpsellActions(): InteractiveButton[] {
  return [
    { id: "referral_grocery:baskets", title: "Sí, ver las canastas" },
    { id: "referral_grocery:coupon_only", title: "No, ya tengo mi cupón" },
  ];
}

function groceryEntryResult(
  leadState: Json | null,
  serviceId: string = BUILT_IN_SERVICE_IDS.grocery,
): ReferralHubTurnResult {
  const referralState = getReferralState(leadState);
  return {
    reply:
      "¡Hola! 👋 Llegaste al lugar correcto.\n\nPuedes recibir tu cupón de $10 para supermercado o ver nuestras canastas ya preparadas con delivery, con los precios y la cobertura disponibles. Si eliges una canasta, primero te pediremos el código postal.\n\n¿Qué quieres hacer hoy?",
    interactiveButtons: groceryEntryActions(),
    statePatch: buildLgStatePatch(leadState, {
      ...referralState,
      service_id: serviceId,
      service_label: serviceLabelFromId(serviceId),
      current_field: null,
      grocery: null,
    }),
    debugNote: "referral_hub:grocery_entry",
  };
}

function startDurableGroceryResult(
  leadState: Json | null,
): ReferralHubTurnResult {
  const referralState = getReferralState(leadState);
  const qrEntry = referralState.extracted_data?.qr_entry;
  const sourceCampaign = qrEntry && typeof qrEntry === "object"
    ? safeStr((qrEntry as Json).campaign_key).trim()
    : "";
  const turn = startWhatsAppGrocery({
    customerName: referralState.profile_name,
    sourceCampaign,
  });
  return {
    reply: turn.reply,
    interactiveList: turn.interactiveList,
    interactiveButtons: turn.interactiveButtons,
    statePatch: buildLgStatePatch(leadState, {
      ...referralState,
      service_id: BUILT_IN_SERVICE_IDS.grocery,
      service_label: "Compras supermercado",
      current_field: null,
      grocery: turn.grocery,
    }),
    debugNote: turn.debugNote,
  };
}

async function activeCouponsResult(args: {
  supabase?: SupabaseLike;
  organizationId: string;
  leadId?: string;
  leadState: Json | null;
}): Promise<ReferralHubTurnResult> {
  if (!args.supabase?.from || !safeStr(args.leadId).trim()) {
    return {
      reply: "No pudimos consultar tus cupones en este momento.",
      interactiveButtons: continuationActions(),
      statePatch: buildLgStatePatch(
        args.leadState,
        getReferralState(args.leadState),
      ),
      debugNote: "referral_hub:my_coupons_unavailable",
    };
  }
  const result = await args.supabase
    .from("referral_coupon_issuances")
    .select(
      "code,status,expires_at,referral_coupon_campaigns!inner(display_name)",
    )
    .eq("organization_id", args.organizationId)
    .eq("lead_id", safeStr(args.leadId))
    .eq("status", "active")
    .order("issued_at", { ascending: false });
  if (result.error) {
    return {
      reply: "No pudimos consultar tus cupones en este momento.",
      interactiveButtons: continuationActions(),
      statePatch: buildLgStatePatch(
        args.leadState,
        getReferralState(args.leadState),
      ),
      debugNote: "referral_hub:my_coupons_failed",
    };
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  const reply = rows.length === 0
    ? "Aún no tienes cupones activos."
    : `Tus cupones activos:\n\n${
      rows.map((row: any) => {
        const campaign = Array.isArray(row.referral_coupon_campaigns)
          ? row.referral_coupon_campaigns[0]
          : row.referral_coupon_campaigns;
        const expiration = safeStr(row.expires_at).trim()
          ? `\nVence: ${safeStr(row.expires_at).slice(0, 10)}`
          : "";
        return `${safeStr(campaign?.display_name, "Cupón")}\nCódigo: ${
          safeStr(row.code)
        }\nEstado: activo${expiration}`;
      }).join("\n\n")
    }`;
  return {
    reply,
    interactiveButtons: continuationActions(),
    statePatch: buildLgStatePatch(
      args.leadState,
      getReferralState(args.leadState),
    ),
    debugNote: "referral_hub:my_coupons",
  };
}

export function resolveLgCouponDeliveryEnabled(
  integrations: Record<string, unknown> | null | undefined,
): boolean {
  const root = integrations && typeof integrations === "object"
    ? integrations
    : {};
  const lgFeatures = root.lg_features && typeof root.lg_features === "object"
    ? root.lg_features as Record<string, unknown>
    : {};
  const value = lgFeatures.lg_coupon_delivery_enabled ??
    root.lg_coupon_delivery_enabled;
  if (value === false || value === 0) return false;
  if (
    typeof value === "string" &&
    ["false", "0", "off", "disabled"].includes(value.trim().toLowerCase())
  ) {
    return false;
  }
  return true;
}

function failedCouponDeliveryResult(
  leadState: Json | null,
  serviceId: string,
  reason: CouponDeliveryError,
): ReferralHubTurnResult {
  return {
    reply:
      "No pudimos preparar la imagen del cupón en este momento. Inténtalo nuevamente o selecciona ‘Hablar con asesor’.",
    statePatch: buildLgStatePatch(leadState, {
      ...getReferralState(leadState),
      service_id: serviceId,
      current_field: null,
      coupon_delivery_status: "failed",
      coupon_delivery_error: reason,
    } as ReferralHubState),
    debugNote: `referral_hub:coupon_delivery_failed:${reason}`,
  };
}

function classifyCouponIssueError(error: unknown): CouponDeliveryError {
  if (error instanceof CouponPersistenceError) return error.reason;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    message.includes("coupon_issue_empty_result") ||
    /campaign.*(missing|not found|inactive)|no active.*campaign/i.test(message)
  ) {
    return "coupon_campaign_missing";
  }
  return "coupon_issue_failed";
}

async function buildPersistentCouponReply(args: {
  serviceId: ReferralHubCouponAssetConfig["service_id"];
  leadState: Json | null;
  supabase?: SupabaseLike;
  organizationId: string;
  leadId?: string;
  couponAssets: Record<string, ReferralHubCouponAssetConfig>;
  couponDeliveryEnabled: boolean;
  channel: "messenger" | "whatsapp";
  campaignKey?: string;
}): Promise<ReferralHubTurnResult> {
  const asset = args.couponAssets[args.serviceId];
  const campaignKey = safeStr(args.campaignKey).trim() || asset?.campaign_key ||
    "";
  console.log(JSON.stringify({
    event: "referral_hub_coupon_delivery_decision",
    organization_id: args.organizationId,
    service_id: args.serviceId,
    channel: args.channel,
    coupon_delivery_enabled: args.couponDeliveryEnabled,
    config_found: Boolean(asset),
    config_active: asset?.active === true,
    image_url_present: Boolean(safeStr(asset?.image_url).trim()),
  }));
  if (!args.couponDeliveryEnabled) {
    return failedCouponDeliveryResult(
      args.leadState,
      args.serviceId,
      "coupon_delivery_disabled",
    );
  }
  if (!asset) {
    return failedCouponDeliveryResult(
      args.leadState,
      args.serviceId,
      "asset_config_missing",
    );
  }
  if (!asset.active) {
    return failedCouponDeliveryResult(
      args.leadState,
      args.serviceId,
      "asset_config_inactive",
    );
  }
  if (!/^https:\/\//i.test(safeStr(asset.image_url).trim())) {
    return failedCouponDeliveryResult(
      args.leadState,
      args.serviceId,
      "image_url_invalid",
    );
  }
  if (!args.supabase?.rpc || !safeStr(args.leadId).trim()) {
    return failedCouponDeliveryResult(
      args.leadState,
      args.serviceId,
      "coupon_persistence_unavailable",
    );
  }
  try {
    const coupon = await issueOrGetCoupon({
      supabase: args.supabase as Parameters<
        typeof issueOrGetCoupon
      >[0]["supabase"],
      organizationId: args.organizationId,
      leadId: safeStr(args.leadId),
      campaignKey,
    });
    if (!safeStr(coupon.code)) {
      return failedCouponDeliveryResult(
        args.leadState,
        args.serviceId,
        "coupon_campaign_missing",
      );
    }
    if (args.channel === "whatsapp") {
      const identity = await sha256(
        `${args.organizationId}:${safeStr(args.leadId)}`,
      );
      const tracking = await args.supabase.from(
        "referral_coupon_delivery_events",
      ).upsert({
        organization_id: args.organizationId,
        conversation_identity_hash: identity,
        service_id: args.serviceId,
        campaign_key: campaignKey,
        channel: "whatsapp",
        prepared_at: new Date().toISOString(),
        delivered_at: null,
        metadata: { coupon_id: coupon.id, status: "prepared" },
        updated_at: new Date().toISOString(),
      }, {
        onConflict:
          "organization_id,conversation_identity_hash,service_id,campaign_key,channel",
      });
      if (tracking.error) {
        return failedCouponDeliveryResult(
          args.leadState,
          args.serviceId,
          "coupon_issue_failed",
        );
      }
    }
    const referralState = getReferralState(args.leadState);
    const groceryCouponUpsell =
      args.serviceId === BUILT_IN_SERVICE_IDS.supermarketCoupon &&
      args.channel === "whatsapp";
    return {
      reply: groceryCouponUpsell
        ? "Ya que vas a comprar… ¿quieres ahorrarte también el viaje?"
        : "¿Qué quieres hacer ahora?",
      outboundMessages: [
        {
          type: "text",
          text: [
            asset.intro_text,
            asset.benefit_text,
            `Código: ${coupon.code}`,
            asset.instructions,
          ]
            .filter((part): part is string => Boolean(safeStr(part).trim()))
            .join("\n\n"),
        },
        {
          type: "image",
          url: asset.image_url,
          altText: "Imagen del cupón",
          reusable: true,
        },
      ],
      interactiveButtons: groceryCouponUpsell
        ? groceryCouponUpsellActions()
        : couponNextActions(),
      statePatch: buildLgStatePatch(args.leadState, {
        ...referralState,
        service_id: args.serviceId,
        service_label: serviceLabelFromId(args.serviceId),
        current_field: null,
        coupon_delivery_status: "pending",
        coupon_delivery_error: null,
        extracted_data: {
          ...(referralState.extracted_data ?? {}),
          service: args.serviceId,
          coupon_id: coupon.id,
          coupon_code: coupon.code,
        },
      } as ReferralHubState),
      debugNote:
        `referral_hub:persistent_coupon:${args.channel}:${args.serviceId}`,
    };
  } catch (error) {
    if (error instanceof CouponPersistenceError) {
      console.error(JSON.stringify({
        event: "referral_hub_coupon_persistence_failed",
        operation: error.operation,
        database_code: error.databaseCode,
        message: error.sanitizedMessage,
        object_name: error.objectName,
        organization_id: args.organizationId,
        service_id: args.serviceId,
        campaign_key: campaignKey,
      }));
    }
    return failedCouponDeliveryResult(
      args.leadState,
      args.serviceId,
      classifyCouponIssueError(error),
    );
  }
}

async function buildServiceReply(
  serviceId: string,
  leadState: Json | null,
  context?: {
    channel?: "messenger" | "whatsapp";
    supabase?: SupabaseLike;
    organizationId?: string;
    leadId?: string;
    couponAssets?: Record<string, ReferralHubCouponAssetConfig>;
    integrations?: Record<string, unknown>;
    campaignKey?: string;
  },
): Promise<ReferralHubTurnResult> {
  if (
    context?.channel === "whatsapp" &&
    ["luis_cupon_medico", "luis_cupon_super", "luis_cupon_dental"].includes(
      serviceId,
    ) &&
    (!context.supabase?.rpc || !safeStr(context.leadId).trim())
  ) {
    return failedCouponDeliveryResult(
      leadState,
      serviceId as ReferralHubCouponAssetConfig["service_id"],
      "coupon_persistence_unavailable",
    );
  }
  if (
    (context?.channel === "messenger" || context?.channel === "whatsapp") &&
    context.supabase?.rpc &&
    ["luis_cupon_medico", "luis_cupon_super", "luis_cupon_dental"].includes(
      serviceId,
    )
  ) {
    return await buildPersistentCouponReply({
      serviceId: serviceId as ReferralHubCouponAssetConfig["service_id"],
      leadState,
      supabase: context.supabase,
      organizationId: safeStr(context.organizationId),
      leadId: context.leadId,
      couponAssets: context.couponAssets ?? REFERRAL_HUB_COUPON_ASSETS,
      couponDeliveryEnabled: resolveLgCouponDeliveryEnabled(
        context.integrations,
      ),
      channel: context.channel,
      campaignKey: context.campaignKey,
    });
  }
  const referralState = getReferralState(leadState);
  const preservedData = withoutTransientServiceFields(
    referralState.extracted_data,
  );
  const statePatchBase = {
    service_id: serviceId,
    service_label: serviceLabel({
      id: serviceId,
      organization_id: REFERRAL_HUB_CANONICAL_ORGANIZATION_ID,
      nombre: serviceLabelFromId(serviceId),
      tipo: "intake",
    }),
    profile_name: referralState.profile_name ?? null,
    profile_city: referralState.profile_city ?? null,
    profile_complete: Boolean(
      referralState.profile_name && referralState.profile_city,
    ),
    stop_requested: referralState.stop_requested ?? false,
    food_option: referralState.food_option ?? null,
    grocery: null,
  };

  switch (serviceId) {
    case BUILT_IN_SERVICE_IDS.accident:
      return {
        reply:
          "Lamento que estés pasando por esto. Vamos a recopilar algunos datos para conectarte con la persona adecuada.\n\n¿Cuándo ocurrió el accidente?",
        statePatch: buildLgStatePatch(leadState, {
          ...statePatchBase,
          current_field: "accident_date",
          extracted_data: { ...preservedData, service: "accidente" },
        }),
        debugNote: "referral_hub:service_accident",
      };
    case BUILT_IN_SERVICE_IDS.immigration:
      return {
        reply:
          "Te conectaremos con un profesional de confianza que pueda orientarte.\n\nCuéntanos brevemente qué tipo de ayuda migratoria necesitas.",
        statePatch: buildLgStatePatch(leadState, {
          ...statePatchBase,
          current_field: "immigration_case",
          extracted_data: { ...preservedData, service: "inmigracion" },
        }),
        debugNote: "referral_hub:service_immigration",
      };
    case BUILT_IN_SERVICE_IDS.medicalCoupon:
      return {
        reply:
          "Recibe un 20% de descuento en tu visita a una clínica participante.\n\nLG Community Network conecta a la comunidad con clínicas y beneficios participantes. No prestamos servicios médicos directamente.",
        statePatch: buildLgStatePatch(leadState, {
          ...statePatchBase,
          current_field: null,
          extracted_data: { ...preservedData, service: "coupon_medico" },
        }),
        debugNote: "referral_hub:service_medical_coupon",
      };
    case BUILT_IN_SERVICE_IDS.supermarketCoupon:
      return groceryEntryResult(leadState, serviceId);
    case BUILT_IN_SERVICE_IDS.grocery:
      return groceryEntryResult(leadState, serviceId);
    case BUILT_IN_SERVICE_IDS.dentalCoupon:
      return {
        reply:
          "Cupón de clínica dental por $29 que incluye:\n• consulta\n• limpieza\n• rayos X.\n\nOferta sujeta a disponibilidad y a los términos de la clínica participante.",
        statePatch: buildLgStatePatch(leadState, {
          ...statePatchBase,
          current_field: null,
          extracted_data: { ...preservedData, service: "coupon_dental" },
        }),
        debugNote: "referral_hub:service_dental_coupon",
      };
    case BUILT_IN_SERVICE_IDS.events:
      return {
        reply:
          "Te compartiremos los próximos eventos comunitarios disponibles cerca de tu ciudad.\n\nPor ahora no tenemos eventos publicados para tu ciudad. Podemos avisarte cuando haya uno disponible.",
        interactiveButtons: [
          { id: "referral_event:follow_up", title: "Avisarme" },
          { id: "referral_menu:services", title: "Ver servicios" },
        ],
        statePatch: completeLgServiceState(
          leadState,
          serviceId,
          "information_provided",
          {
            ...statePatchBase,
            extracted_data: { ...preservedData, service: "eventos" },
          },
        ),
        debugNote: "referral_hub:service_events",
      };
    case BUILT_IN_SERVICE_IDS.advisor: {
      return {
        reply: LG_ACCIDENT_HANDOFF_FAILURE,
        interactiveButtons: continuationActions(),
        statePatch: completeLgServiceState(
          leadState,
          BUILT_IN_SERVICE_IDS.advisor,
          "handoff_created",
          {
            ...statePatchBase,
            extracted_data: { ...preservedData, service: "asesor" },
          },
        ),
        leadPatch: {
          handoff_to_human: true,
          service_id: BUILT_IN_SERVICE_IDS.advisor,
          extracted_data: {
            ...(referralState.extracted_data ?? {}),
            service: "asesor",
          },
          status: "contacted",
        },
        debugNote: "referral_hub:advisor_handoff_requested",
      };
    }
    default:
      return handleLgMenu(leadState);
  }
}

function serviceLabelFromId(serviceId: string): string {
  switch (serviceId) {
    case BUILT_IN_SERVICE_IDS.accident:
      return "Accidentes";
    case BUILT_IN_SERVICE_IDS.immigration:
      return "Inmigración";
    case BUILT_IN_SERVICE_IDS.medicalCoupon:
      return "Cupón médico";
    case BUILT_IN_SERVICE_IDS.supermarketCoupon:
      return "Cupón supermercado";
    case BUILT_IN_SERVICE_IDS.dentalCoupon:
      return "Cupón dental";
    case BUILT_IN_SERVICE_IDS.events:
      return "Eventos comunitarios";
    case BUILT_IN_SERVICE_IDS.grocery:
      return "Compras supermercado";
    case BUILT_IN_SERVICE_IDS.advisor:
      return "Hablar con asesor";
    default:
      return "Servicio";
  }
}

async function continueLgServiceFlow(
  leadState: Json | null,
  inboundText: string,
  timezone = "America/New_York",
  payloadAction?: string | null,
  menuConfigs?: CanonicalMenuConfig[],
): Promise<ReferralHubTurnResult> {
  const referralState = getReferralState(leadState);
  const currentField = safeStr(referralState.current_field).trim();
  const value = safeStr(inboundText).trim();
  const extractedData = { ...(referralState.extracted_data ?? {}) } as Record<
    string,
    unknown
  >;

  if (currentField === "confirm_submission") {
    const action = normalizedAction(payloadAction);
    const confirmed =
      action === `referral_submit:${referralState.service_id}:yes` ||
      /^(si|sí|enviar|confirmar|enviar solicitud)$/i.test(value);
    const rejected =
      action === `referral_submit:${referralState.service_id}:no` ||
      /^(no|cancelar)$/i.test(value);
    if (!confirmed && !rejected) {
      return {
        reply: "Confirma si deseas enviar esta solicitud.",
        interactiveButtons: submissionConfirmationButtons(
          referralState.service_id ?? "",
        ),
        statePatch: buildLgStatePatch(leadState, referralState),
        debugNote: "referral_hub:submission_confirmation_retry",
      };
    }
    if (rejected) {
      return {
        ...handleLgMenu(leadState, "whatsapp", LG_MENU_PROMPT, menuConfigs),
        reply: "No enviamos la solicitud. ¿En qué más podemos ayudarte?",
        debugNote: "referral_hub:submission_cancelled",
      };
    }
    if (referralState.service_id === BUILT_IN_SERVICE_IDS.accident) {
      return {
        reply: LG_ACCIDENT_HANDOFF_FAILURE,
        interactiveButtons: continuationActions(),
        statePatch: completeLgServiceState(
          leadState,
          BUILT_IN_SERVICE_IDS.accident,
          "handoff_created",
          {
            ...referralState,
            extracted_data: extractedData,
          },
        ),
        debugNote: "referral_hub:accident_complete",
      };
    }
    if (referralState.service_id === BUILT_IN_SERVICE_IDS.immigration) {
      return {
        reply: LG_ACCIDENT_HANDOFF_FAILURE,
        interactiveButtons: continuationActions(),
        statePatch: completeLgServiceState(
          leadState,
          BUILT_IN_SERVICE_IDS.immigration,
          "request_recorded",
          {
            ...referralState,
            extracted_data: extractedData,
          },
        ),
        debugNote: "referral_hub:immigration_complete",
      };
    }
  }

  if (referralState.service_id === BUILT_IN_SERVICE_IDS.accident) {
    if (currentField === "accident_date") {
      const pending =
        referralState.pending_field_confirmation?.field === "accident_date"
          ? referralState.pending_field_confirmation
          : null;
      const normalizedAction = normalizeText(payloadAction ?? "");
      const confirmed = normalizedAction.endsWith(":yes") ||
        /^(si|sí)(,|\s|$)/i.test(value);
      const rejected = normalizedAction.endsWith(":no") ||
        /^(no|otra fecha)(,|\s|$)/i.test(value);
      if (pending && confirmed && pending.interpretation.normalizedValue) {
        extractedData.accident_date = pending.interpretation.normalizedValue;
        return {
          reply: "Entendido. ¿En qué ciudad ocurrió?",
          statePatch: buildLgStatePatch(leadState, {
            ...referralState,
            current_field: "accident_city",
            pending_field_confirmation: null,
            extracted_data: extractedData,
          }),
          debugNote: "referral_hub:accident_date_confirmed",
        };
      }
      if (pending && rejected) {
        return {
          reply: "Está bien. ¿Qué día ocurrió el accidente?",
          statePatch: buildLgStatePatch(leadState, {
            ...referralState,
            current_field: "accident_date",
            pending_field_confirmation: null,
            extracted_data: extractedData,
          }),
          debugNote: "referral_hub:accident_date_rejected",
        };
      }
      const interpreted = interpretAccidentDate(value, timezone);
      if (!interpreted.normalizedValue || interpreted.confidence === "low") {
        return {
          reply: interpreted.clarificationPrompt ??
            "No pude identificar la fecha. ¿Puedes escribirla nuevamente?",
          statePatch: buildLgStatePatch(leadState, {
            ...referralState,
            current_field: "accident_date",
            extracted_data: extractedData,
          }),
          debugNote: "referral_hub:accident_date_retry",
        };
      }
      if (interpreted.needsConfirmation) {
        return {
          reply: interpreted.clarificationPrompt ??
            `¿Te refieres a ${interpreted.normalizedValue}?`,
          interactiveButtons: dateConfirmationButtons(),
          statePatch: buildLgStatePatch(leadState, {
            ...referralState,
            current_field: "accident_date",
            pending_field_confirmation: {
              field: "accident_date",
              interpretation: interpreted,
            },
            extracted_data: extractedData,
          }),
          debugNote: "referral_hub:accident_date_confirm",
        };
      }
      extractedData.accident_date = interpreted.normalizedValue;
      return {
        reply: "Entendido. ¿En qué ciudad ocurrió?",
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: "accident_city",
          pending_field_confirmation: null,
          extracted_data: extractedData,
        }),
        debugNote: "referral_hub:accident_date",
      };
    }
    if (currentField === "accident_city") {
      extractedData.accident_city = value;
      return {
        reply: "¿Hubo personas lesionadas?",
        interactiveButtons: [
          { id: "referral_field:accident_injuries:0", title: "Sí" },
          { id: "referral_field:accident_injuries:1", title: "No" },
          {
            id: "referral_field:accident_injuries:2",
            title: "No estoy seguro",
          },
        ],
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: "accident_injuries",
          extracted_data: extractedData,
        }),
        debugNote: "referral_hub:accident_city",
      };
    }
    if (
      currentField === "accident_injuries" || currentField === "police_report"
    ) {
      extractedData.accident_injuries = /no estoy seguro/i.test(value)
        ? "no_estoy_seguro"
        : /^(si|sí|yes)$/i.test(value)
        ? "sí"
        : "no";
      return {
        reply: "¿Cuál es tu nombre completo?",
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: "contact_name",
          extracted_data: extractedData,
        }),
        debugNote: "referral_hub:accident_injuries",
      };
    }
    if (currentField === "contact_name") {
      extractedData.contact_name = value;
      return {
        reply: "¿Cuál es el número de contacto?",
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: "contact_phone",
          extracted_data: extractedData,
        }),
        debugNote: "referral_hub:accident_name",
      };
    }
    if (currentField === "contact_phone") {
      extractedData.contact_phone = value;
      return {
        reply: `Revisa la información antes de enviarla:\n• Fecha: ${
          safeStr(extractedData.accident_date)
        }\n• Ciudad: ${safeStr(extractedData.accident_city)}\n• Lesionados: ${
          safeStr(extractedData.accident_injuries)
        }\n• Nombre: ${safeStr(extractedData.contact_name)}\n• Teléfono: ${
          safeStr(extractedData.contact_phone)
        }\n\nConfirma si deseas enviar esta solicitud.`,
        interactiveButtons: submissionConfirmationButtons(
          BUILT_IN_SERVICE_IDS.accident,
        ),
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: "confirm_submission",
          extracted_data: extractedData,
        }),
        debugNote: "referral_hub:accident_confirmation",
      };
    }
  }

  if (referralState.service_id === BUILT_IN_SERVICE_IDS.immigration) {
    extractedData.immigration_case = value;
    return {
      reply:
        `Revisa la información antes de enviarla:\n• Tipo de ayuda: ${value}\n\nConfirma si deseas enviar esta solicitud.`,
      interactiveButtons: submissionConfirmationButtons(
        BUILT_IN_SERVICE_IDS.immigration,
      ),
      statePatch: buildLgStatePatch(leadState, {
        ...referralState,
        current_field: "confirm_submission",
        extracted_data: extractedData,
      }),
      debugNote: "referral_hub:immigration_confirmation",
    };
  }

  return await buildServiceReply(
    referralState.service_id ?? BUILT_IN_SERVICE_IDS.advisor,
    leadState,
  );
}

function stateWithQrAttribution(
  leadState: Json | null,
  entry: ResolvedReferralQrEntry,
): Json {
  const referralState = getReferralState(leadState);
  return buildLgStatePatch(leadState, {
    ...referralState,
    extracted_data: {
      ...(referralState.extracted_data ?? {}),
      qr_entry: qrLeadAttribution(entry),
    },
  });
}

function withQrAttribution(
  result: ReferralHubTurnResult,
  entry: ResolvedReferralQrEntry,
): ReferralHubTurnResult {
  const leadPatch = result.leadPatch && typeof result.leadPatch === "object"
    ? result.leadPatch
    : {};
  const extractedData =
    leadPatch.extracted_data && typeof leadPatch.extracted_data === "object"
      ? leadPatch.extracted_data as Json
      : {};
  return {
    ...result,
    leadPatch: {
      ...leadPatch,
      extracted_data: { ...extractedData, qr_entry: qrLeadAttribution(entry) },
      ...(entry.campaignKey ? { source_campaign: entry.campaignKey } : {}),
    },
  };
}

async function recordQrAttribution(args: {
  supabase?: SupabaseLike;
  organizationId: string;
  leadId?: string;
  entry: ResolvedReferralQrEntry;
}) {
  if (!args.supabase?.from || !safeStr(args.leadId).trim()) return;
  try {
    const events = args.supabase.from("lead_events");
    if (typeof events?.insert !== "function") return;
    await events.insert({
      organization_id: args.organizationId,
      lead_id: args.leadId,
      event_type: "referral_qr_entry_resolved",
      payload: qrLeadAttribution(args.entry),
    });
  } catch (error) {
    console.warn("[Referral Hub] QR attribution event was not recorded", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function handleReferralHubTurn(args: {
  supabase?: SupabaseLike;
  organizationId: string;
  leadId?: string;
  leadState: Json | null;
  inboundText: string;
  payloadAction?: string | null;
  channelUserId?: string | null;
  channel?: "messenger" | "whatsapp";
  timezone?: string;
  serviceConfigs?: ReferralHubServiceConfig[];
  couponAssets?: Record<string, ReferralHubCouponAssetConfig>;
  integrations?: Record<string, unknown>;
  allowTransientLuisMenuReset?: boolean;
}): Promise<ReferralHubTurnResult> {
  const isLgTenant = safeStr(args.organizationId).trim() ===
    REFERRAL_HUB_CANONICAL_ORGANIZATION_ID;

  if (
    shouldHandlePantryDemo({
      leadState: args.leadState,
      inboundText: args.inboundText,
      payloadAction: args.payloadAction,
    }) && !isLgTenant
  ) {
    const issuedCoupon =
      args.supabase?.rpc && args.leadId && isPantryCouponEntry(args)
        ? await issueOrGetCoupon({
          supabase: args.supabase as Parameters<
            typeof issueOrGetCoupon
          >[0]["supabase"],
          organizationId: args.organizationId,
          leadId: args.leadId,
        })
        : undefined;
    return handlePantryDemoTurn({
      leadState: args.leadState,
      inboundText: args.inboundText,
      payloadAction: args.payloadAction,
      issuedCoupon,
    });
  }

  const referralState = getReferralState(args.leadState);
  if (isStopRequest(args.inboundText)) return stopResult(args.leadState);

  if (isLgTenant) {
    const action = normalizedAction(args.payloadAction);
    const groceryIntent = action || normalizeText(args.inboundText);
    let canonicalMenuConfigs: CanonicalMenuConfig[] | null | undefined;
    const getCanonicalMenuConfigs = async () => {
      if (canonicalMenuConfigs === undefined) {
        canonicalMenuConfigs = await loadCanonicalMenuConfigs(args);
      }
      return canonicalMenuConfigs;
    };
    const canonicalMenu = async (
      reply = LG_MENU_PROMPT,
      leadState = args.leadState,
    ) => {
      const configs = await getCanonicalMenuConfigs();
      return configs?.length === 0
        ? handleLgMoreMenu(leadState, args.channel ?? "whatsapp", configs)
        : handleLgMenu(leadState, args.channel, reply, configs ?? undefined);
    };
    const qrPublicCode = extractReferralQrPublicCode(args.inboundText);
    if (qrPublicCode && args.supabase?.from) {
      const qrEntry = await resolveReferralQrEntry(args.supabase, qrPublicCode);
      if (qrEntry && qrEntry.organizationId === args.organizationId) {
        const qrLeadState = stateWithQrAttribution(args.leadState, qrEntry);
        await recordQrAttribution({
          supabase: args.supabase,
          organizationId: args.organizationId,
          leadId: args.leadId,
          entry: qrEntry,
        });
        const result = qrEntry.serviceId
          ? await buildServiceReply(qrEntry.serviceId, qrLeadState, {
            channel: args.channel,
            supabase: args.supabase,
            organizationId: args.organizationId,
            leadId: args.leadId,
            couponAssets: args.couponAssets,
            integrations: args.integrations,
            campaignKey: qrEntry.campaignKey ?? undefined,
          })
          : await canonicalMenu(LG_MENU_PROMPT, qrLeadState);
        return withQrAttribution(result, qrEntry);
      }
    }
    if (
      shouldResetLuisMenu(args.inboundText) ||
      (args.allowTransientLuisMenuReset &&
        isLuisNamedGreeting(args.inboundText))
    ) {
      return await canonicalMenu(
        LG_MENU_PROMPT,
        resetLuisMenuState(args.leadState),
      );
    }
    if (
      action === "referral_grocery:entry" ||
      action === `referral_service:${BUILT_IN_SERVICE_IDS.grocery}`
    ) {
      return groceryEntryResult(args.leadState);
    }
    if (action === "referral_grocery:coupon") {
      return await buildServiceReply(
        BUILT_IN_SERVICE_IDS.supermarketCoupon,
        args.leadState,
        {
          channel: args.channel,
          supabase: args.supabase,
          organizationId: args.organizationId,
          leadId: args.leadId,
          couponAssets: args.couponAssets,
          integrations: args.integrations,
        },
      );
    }
    if (
      action === "referral_grocery:baskets" ||
      groceryIntent === "ver las canastas"
    ) {
      return startDurableGroceryResult(args.leadState);
    }
    if (action === "referral_grocery:coupon_only") {
      return {
        reply: "Perfecto. Tu cupón queda listo para usar cuando vayas a pagar.",
        interactiveButtons: continuationActions(),
        statePatch: buildLgStatePatch(
          args.leadState,
          getReferralState(args.leadState),
        ),
        debugNote: "referral_hub:grocery_coupon_only",
      };
    }
    if (action === "referral_event:follow_up") {
      return {
        reply: LG_ACCIDENT_HANDOFF_FAILURE,
        interactiveButtons: continuationActions(),
        statePatch: completeLgServiceState(
          args.leadState,
          BUILT_IN_SERVICE_IDS.events,
          "follow_up_requested",
          {
            ...referralState,
            extracted_data: {
              ...(referralState.extracted_data ?? {}),
              service: "eventos",
              event_follow_up: true,
            },
          },
        ),
        debugNote: "referral_hub:events_followup_requested",
      };
    }
    if (action === "referral_menu:services") {
      return await canonicalMenu(
        LG_MENU_PROMPT,
        resetLuisMenuState(args.leadState),
      );
    }
    if (action === "referral_menu:main") {
      return await canonicalMenu(
        "Claro. ¿En qué podemos ayudarte?",
        resetLuisMenuState(args.leadState),
      );
    }
    if (action === "referral_menu:more") {
      const configs = await getCanonicalMenuConfigs();
      return configs
        ? handleLgMoreMenu(args.leadState, args.channel ?? "whatsapp", configs)
        : await canonicalMenu();
    }
    if (action === "referral_menu:my_coupons") {
      return await activeCouponsResult(args);
    }
    if (action === "referral_handoff:advisor") {
      return await buildServiceReply(
        BUILT_IN_SERVICE_IDS.advisor,
        args.leadState,
        {
          channel: args.channel,
          supabase: args.supabase,
          organizationId: args.organizationId,
          leadId: args.leadId,
        },
      );
    }
    if (action === "referral_profile:change_name") {
      return {
        reply: "Claro. ¿Cuál es tu nombre completo?",
        statePatch: buildLgStatePatch(args.leadState, {
          ...referralState,
          profile_name: null,
          profile_complete: false,
          current_field: "profile_name",
          profile_edit_field: "profile_name",
        }),
        debugNote: "referral_hub:change_name",
      };
    }
    if (action === "referral_profile:change_city") {
      return {
        reply: "Claro. ¿En qué ciudad vives?",
        statePatch: buildLgStatePatch(args.leadState, {
          ...referralState,
          profile_city: null,
          profile_complete: false,
          current_field: "profile_city",
          profile_edit_field: "profile_city",
        }),
        debugNote: "referral_hub:change_city",
      };
    }
    const groceryState = groceryStateFromReferral(referralState.grocery);
    if (
      groceryState && groceryState.step !== "complete" &&
      !safeStr(args.payloadAction).includes("referral_service:") &&
      args.channel === "whatsapp" && args.supabase?.rpc && args.leadId &&
      args.channelUserId
    ) {
      const turn = await continueWhatsAppGrocery({
        supabase: args.supabase as SupabaseLike & {
          rpc: NonNullable<SupabaseLike["rpc"]>;
        },
        state: groceryState,
        inboundText: args.inboundText,
        payloadAction: args.payloadAction,
        leadId: args.leadId,
        channelUserId: args.channelUserId,
      });
      return {
        reply: turn.reply,
        interactiveList: turn.interactiveList,
        interactiveButtons: turn.interactiveButtons,
        statePatch: buildLgStatePatch(args.leadState, {
          ...referralState,
          service_id: BUILT_IN_SERVICE_IDS.grocery,
          service_label: "Compras supermercado",
          current_field: null,
          grocery: turn.grocery,
        }),
        debugNote: turn.debugNote,
      };
    }
    const selectedPayloadServiceId = safeStr(args.payloadAction).trim()
      ? resolveServiceIdFromInput(args.payloadAction ?? "")
      : null;
    if (selectedPayloadServiceId) {
      return await buildServiceReply(selectedPayloadServiceId, args.leadState, {
        channel: args.channel,
        supabase: args.supabase,
        organizationId: args.organizationId,
        leadId: args.leadId,
        couponAssets: args.couponAssets,
        integrations: args.integrations,
      });
    }

    const selectedTextServiceId = resolveServiceIdFromInput(args.inboundText);
    if (selectedTextServiceId) {
      return await buildServiceReply(selectedTextServiceId, args.leadState, {
        channel: args.channel,
        supabase: args.supabase,
        organizationId: args.organizationId,
        leadId: args.leadId,
        couponAssets: args.couponAssets,
        integrations: args.integrations,
      });
    }

    if (
      isLuisDiscoveryEntry(args.inboundText) ||
      !safeStr(args.inboundText).trim()
    ) {
      return await canonicalMenu();
    }

    if (safeStr(referralState.current_field).trim()) {
      return continueLgServiceFlow(
        args.leadState,
        args.inboundText,
        args.timezone,
        args.payloadAction,
        (await getCanonicalMenuConfigs()) ?? undefined,
      );
    }

    if (
      !safeStr(referralState.profile_name).trim() ||
      !safeStr(referralState.profile_city).trim()
    ) {
      if (
        safeStr(referralState.current_field).trim() === "profile_name" ||
        safeStr(referralState.current_field).trim() === "profile_city"
      ) {
        return await updateProfileFromInput(
          args.leadState,
          args.inboundText,
          args.channel,
          args.payloadAction,
          (await getCanonicalMenuConfigs()) ?? undefined,
        );
      }
      if (
        !safeStr(referralState.profile_name).trim() &&
        !safeStr(referralState.profile_city).trim()
      ) {
        return startLgProfileFlow(args.leadState);
      }
      if (!safeStr(referralState.profile_city).trim()) {
        return startLgProfileFlow(args.leadState);
      }
    }

    return await canonicalMenu();
  }

  const configs = args.serviceConfigs ??
    (args.supabase
      ? await loadServiceConfigs(args.supabase, args.organizationId)
      : []);
  if (configs.length === 0) {
    return {
      reply: "Todavía no hay opciones configuradas para esta cuenta.",
      statePatch: {
        stage: "DISCOVERY",
        orgType: "referral_hub",
        lastIntent: "referral_hub_no_config",
      },
      debugNote: "referral_hub:no_config",
    };
  }

  const optIn = extractOptInValue(args.inboundText, args.payloadAction);
  if (referralState.awaiting_community_opt_in && optIn) {
    return optInResult({ leadState: args.leadState, value: optIn });
  }

  const activeService =
    configs.find((config) => config.id === referralState.service_id) ?? null;
  if (activeService?.tipo === "intake" && referralState.current_field) {
    return continueIntakeResult({
      leadState: args.leadState,
      config: activeService,
      inboundText: args.inboundText,
      payloadAction: args.payloadAction,
    });
  }

  let selectedServiceId = extractServiceId(
    args.inboundText,
    args.payloadAction,
  );
  let selectedService = selectedServiceId
    ? configs.find((config) => config.id === selectedServiceId) ?? null
    : findServiceByFreeText(configs, args.inboundText);

  if (!selectedService && safeStr(args.inboundText).trim()) {
    selectedServiceId = await classifyMenuWithGroq({
      inboundText: args.inboundText,
      configs,
    });
    selectedService = selectedServiceId
      ? configs.find((config) => config.id === selectedServiceId) ?? null
      : null;
  }

  if (!selectedService) return menuResult(args.leadState, configs);
  if (selectedService.tipo === "static_action") {
    return staticActionResult(
      args.leadState,
      selectedService,
      args.channelUserId,
    );
  }
  if (selectedService.tipo === "transfer") {
    return transferResult(args.leadState, selectedService);
  }
  return startIntakeResult(args.leadState, selectedService);
}
