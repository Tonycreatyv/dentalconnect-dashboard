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
import { issueOrGetCoupon } from "./couponService.ts";
import { REFERRAL_HUB_CANONICAL_ORGANIZATION_ID } from "../../../_products/referral-hub/config.ts";

type Json = Record<string, unknown>;

type SupabaseLike = {
  from(table: string): any;
  rpc?(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
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
  notification?: {
    type: "referral_hub_qualified_lead";
    leadName: string;
    serviceName: string;
    summaryLine: string;
  };
};

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
};

const BUILT_IN_SERVICE_IDS = {
  accident: "luis_accidente",
  immigration: "luis_inmigracion",
  medicalCoupon: "luis_cupon_medico",
  supermarketCoupon: "luis_cupon_super",
  dentalCoupon: "luis_cupon_dental",
  events: "luis_eventos",
  foodSupport: "luis_donacion",
  advisor: "luis_asesor",
} as const;

const LG_DISCLOSURE =
  "LG Community Network funciona como un puente entre la comunidad y recursos o aliados participantes. No prestamos directamente servicios legales, médicos ni financieros.";

const TEMPORARY_STATIC_ACTION_TEXT: Record<string, string> = {
  luis_cupon_medico:
    "🏥 ¡Ya tenés tu cupón de 20% de descuento en servicios médicos! Un representante de Luis Gabriel te va a contactar pronto con los detalles para usarlo.",
  luis_cupon_super:
    "🛒 ¡Ya tenés tu cupón de $20 para supermercado! Un representante de Luis Gabriel te va a contactar pronto con los detalles para usarlo.",
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

const REFERRAL_HUB_GREETING =
  "¡Hola! 👋\nGracias por contactar a LG Community Network.\nEstamos aquí para ayudarte.";
const LG_MESSENGER_MENU_TEXT =
  `${REFERRAL_HUB_GREETING}\n\nTu información es confidencial y solo se utilizará para conectarte con beneficios, recursos y servicios de la comunidad.\n\n¿En qué podemos ayudarte?`;

const REFERRAL_HUB_GENERAL_CLOSING =
  "Gracias por ser parte de nuestra comunidad.\n¡Estamos de tu lado! 💚";

function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
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

function getReferralState(leadState: Json | null | undefined): ReferralHubState {
  const collected = ((leadState?.collected ?? {}) as Json);
  const referral = ((collected.referral_hub ?? {}) as ReferralHubState);
  return referral;
}

function mergeReferralState(
  leadState: Json | null | undefined,
  patch: ReferralHubState,
): Json {
  const collected = ((leadState?.collected ?? {}) as Json);
  const current = ((collected.referral_hub ?? {}) as ReferralHubState);
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
  return truncateWhatsAppTitle(`${safeStr(config.icono)} ${serviceLabel(config)}`.trim());
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

function publicPartnerName(partner: ReferralHubPartner | null | undefined): string {
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
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
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
    return `🛒 ¡Ya tenés tu cupón de $20!\n📍 Válido en: ${partnerName}\n🎟️ Tu código: ${redemptionCode}\nMostrá este mensaje al llegar.`;
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
    body: REFERRAL_HUB_GREETING,
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

function buildOptionButtons(field: string, options: string[]): InteractiveButton[] {
  return options.slice(0, 3).map((option, index) => ({
    id: optionActionId(field, index),
    title: truncateWhatsAppTitle(option, 20),
  }));
}

function buildOptionList(field: string, question: string, options: string[]): WhatsAppInteractiveListSpec {
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
      interactiveList: buildOptionList(objective.campo, objective.pregunta, options),
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

function extractServiceId(inboundText: string, payloadAction?: string | null): string | null {
  const action = safeStr(payloadAction, safeStr(inboundText)).trim();
  const match = action.match(/^referral_service:(.+)$/);
  return match?.[1] ?? null;
}

function extractOptInValue(inboundText: string, payloadAction?: string | null): "yes" | "no" | null {
  const action = safeStr(payloadAction, safeStr(inboundText)).trim().toLowerCase();
  if (action === optInActionId("yes") || /^(si|sí|yes)$/i.test(action)) return "yes";
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
  const actionMatch = action.match(new RegExp(`^referral_field:${args.objective.campo}:(\\d+)$`));
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
    return label === normalized || name === normalized || label.includes(normalized) || normalized.includes(label);
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
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
    });
    if (!response.ok) return null;
    const json = await response.json();
    const content = safeStr(json?.choices?.[0]?.message?.content);
    const parsed = JSON.parse(content);
    const serviceId = safeStr(parsed?.service_id).trim();
    const confidence = Number(parsed?.confidence ?? 0);
    if (!serviceId || !Number.isFinite(confidence) || confidence < 0.72) return null;
    return args.configs.some((config) => config.id === serviceId) ? serviceId : null;
  } catch {
    return null;
  }
}

async function loadServiceConfigs(
  supabase: SupabaseLike,
  organizationId: string,
): Promise<ReferralHubServiceConfig[]> {
  const queryConfigs = (selectClause: string) => supabase
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

  if (error) throw new Error(`referral_hub_configs_load_failed:${error.message}`);
  const configs = ((data ?? []) as ReferralHubServiceConfig[])
    .filter((config) => safeStr(config.id).trim())
    .sort((a, b) => Number(a.menu_orden ?? 999) - Number(b.menu_orden ?? 999))
    .map((config) => ({
      ...config,
      partner: config.partner ?? DEMO_STATIC_ACTION_PARTNERS[config.id] ?? null,
      partner_id: safeStr(config.partner_id).trim() || DEMO_STATIC_ACTION_PARTNERS[config.id]?.id || null,
    }));

  const partnerIds = [...new Set(configs.map((config) => safeStr(config.partner_id).trim()).filter(Boolean))];
  if (partnerIds.length === 0) return configs;

  const { data: partnersData, error: partnersError } = await supabase
    .from("partners")
    .select("id, nombre")
    .in("id", partnerIds);
  if (partnersError) throw new Error(`referral_hub_partners_load_failed:${partnersError.message}`);

  const partnersById = new Map(
    ((partnersData ?? []) as ReferralHubPartner[]).map((partner) => [partner.id, partner]),
  );
  return configs.map((config) => ({
    ...config,
    partner: partnersById.get(safeStr(config.partner_id)) ?? config.partner ?? null,
  }));
}

function buildSummary(config: ReferralHubServiceConfig, data: Record<string, unknown>): string {
  const objectives = Array.isArray(config.intake_objectives) ? config.intake_objectives : [];
  const lines = objectives
    .filter((objective) => safeStr(objective.campo).trim())
    .map((objective) => `${objective.campo}: ${safeStr(data[objective.campo], "No informado")}`);
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

function menuResult(leadState: Json | null, configs: ReferralHubServiceConfig[]): ReferralHubTurnResult {
  return {
    reply: REFERRAL_HUB_GREETING,
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
  const partner = config.partner ?? DEMO_STATIC_ACTION_PARTNERS[config.id] ?? null;
  const partnerName = publicPartnerName(partner);
  const existingReferralState = getReferralState(leadState);
  const existingData = existingReferralState.service_id === config.id
    ? (existingReferralState.extracted_data ?? {})
    : {};
  const redemptionCode = safeStr(existingData.codigo_canje).trim() || makeRedemptionCode(config.id);
  const partnerText = partnerName
    ? staticActionMessage({ config, partnerName, redemptionCode })
    : "";
  const text = partnerText ||
    safeStr((config.accion_estatica as Json | null)?.texto).trim() ||
    TEMPORARY_STATIC_ACTION_TEXT[config.id] ||
    `TODO: Luis Gabriel todavía no pasó el contenido final para "${serviceLabel(config)}".`;
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
    ...(config.partner_id || partner?.id ? { partner_id: config.partner_id ?? partner?.id } : {}),
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
      ...(config.partner_id || partner?.id ? { partner_recomendado: config.partner_id ?? partner?.id } : {}),
      status: "qualified",
    },
    debugNote: "referral_hub:static_action",
  };
}

function transferResult(leadState: Json | null, config: ReferralHubServiceConfig): ReferralHubTurnResult {
  const takeoverState = activateHumanTakeoverState({
    state: leadState,
    source: "human_replied_from_dashboard",
    actor: "referral_hub_transfer",
    pauseMinutes: 240,
  });
  return {
    reply: "Listo. Te vamos a pasar con un representante de Luis Gabriel para que te atienda directamente.",
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
  const objectives = Array.isArray(config.intake_objectives) ? config.intake_objectives : [];
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
    reply: `${confirmationForService(config)}\n\n¿Deseas recibir información sobre eventos, promociones y recursos para nuestra comunidad?`,
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
  const objectives = Array.isArray(args.config.intake_objectives) ? args.config.intake_objectives : [];
  const referralState = getReferralState(args.leadState);
  const data = { ...(referralState.extracted_data ?? {}) };
  const current = objectives.find((objective) => objective.campo === referralState.current_field) ??
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
  if (!nextObjective) return completedIntakeResult(args.leadState, args.config, data);

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

function buildLgMenuList(): WhatsAppInteractiveListSpec {
  return {
    body: `${REFERRAL_HUB_GREETING}\n\nTu información es confidencial y solo se utilizará para conectarte con beneficios, recursos y servicios de la comunidad.\n\nPor favor elige una opción:`,
    buttonText: "Ver opciones",
    sections: [{
      title: "Servicios",
      rows: [
        { id: serviceActionId(BUILT_IN_SERVICE_IDS.accident), title: "Accidentes", description: "Ayuda inmediata" },
        { id: serviceActionId(BUILT_IN_SERVICE_IDS.immigration), title: "Inmigración", description: "Orientación con un profesional" },
        { id: serviceActionId(BUILT_IN_SERVICE_IDS.medicalCoupon), title: "Cupón médico", description: "20% de descuento" },
        { id: serviceActionId(BUILT_IN_SERVICE_IDS.supermarketCoupon), title: "Cupón supermercado", description: "Cupón de $20" },
        { id: serviceActionId(BUILT_IN_SERVICE_IDS.dentalCoupon), title: "Cupón dental", description: "Consulta, limpieza y rayos X" },
        { id: serviceActionId(BUILT_IN_SERVICE_IDS.events), title: "Eventos comunitarios", description: "Próximos eventos" },
        { id: serviceActionId(BUILT_IN_SERVICE_IDS.foodSupport), title: "Comida y apoyo", description: "Donar o recibir apoyo" },
        { id: serviceActionId(BUILT_IN_SERVICE_IDS.advisor), title: "Hablar con asesor", description: "Atención personal" },
      ],
    }],
  };
}

export function buildLgMessengerQuickReplies(): InteractiveButton[] {
  return [
    { id: serviceActionId(BUILT_IN_SERVICE_IDS.accident), title: "Accidentes" },
    { id: serviceActionId(BUILT_IN_SERVICE_IDS.immigration), title: "Inmigración" },
    { id: serviceActionId(BUILT_IN_SERVICE_IDS.medicalCoupon), title: "Cupón médico" },
    { id: serviceActionId(BUILT_IN_SERVICE_IDS.supermarketCoupon), title: "Cupón supermercado" },
    { id: serviceActionId(BUILT_IN_SERVICE_IDS.dentalCoupon), title: "Cupón dental" },
    { id: serviceActionId(BUILT_IN_SERVICE_IDS.events), title: "Eventos" },
    { id: serviceActionId(BUILT_IN_SERVICE_IDS.foodSupport), title: "Comida y apoyo" },
    { id: serviceActionId(BUILT_IN_SERVICE_IDS.advisor), title: "Hablar con asesor" },
  ];
}

function buildLgWelcomeReply(leadState: Json | null): string {
  const referralState = getReferralState(leadState);
  const name = safeStr(referralState.profile_name).trim();
  if (!name) {
    return `${REFERRAL_HUB_GREETING}\n\nPara empezar, ¿cuál es tu nombre completo?`;
  }
  const city = safeStr(referralState.profile_city).trim();
  if (!city) {
    return `${REFERRAL_HUB_GREETING}\n\nGracias, ${name}.\n¿Ciudad donde vive?`;
  }
  return `${REFERRAL_HUB_GREETING}\n\n¡Gracias, ${name}! 🙂\nTe registramos como residente de ${city}.\n\nAhora puedes elegir una opción del menú para continuar.\n\nTu información es confidencial y solo se utilizará para conectarte con beneficios, recursos y servicios de la comunidad.\n\n${LG_DISCLOSURE}`;
}

function shouldResetMenu(input: string): boolean {
  const normalized = normalizeText(input);
  return ["menu", "inicio", "volver al menu", "empezar de nuevo", "servicios"].includes(normalized);
}

function isStopRequest(input: string): boolean {
  const normalized = normalizeText(input);
  return ["stop", "salir", "cancelar mensajes", "no mas mensajes", "no más mensajes"].includes(normalized);
}

function resolveServiceIdFromInput(input: string): string | null {
  const raw = safeStr(input).trim().replace(/^action:/, "");
  if (raw.startsWith("referral_service:")) {
    const serviceId = raw.slice("referral_service:".length);
    return Object.values(BUILT_IN_SERVICE_IDS).includes(serviceId as any) ? serviceId : null;
  }
  const normalized = normalizeText(input);
  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized) - 1;
    const ids = Object.values(BUILT_IN_SERVICE_IDS);
    return ids[index] ?? null;
  }
  if (normalized.includes("accidente")) return BUILT_IN_SERVICE_IDS.accident;
  if (normalized.includes("inmigr") || normalized.includes("migratorio")) return BUILT_IN_SERVICE_IDS.immigration;
  if (normalized.includes("medico") || normalized.includes("descuento medico") || normalized.includes("coupon medico") || normalized.includes("cupon medico")) return BUILT_IN_SERVICE_IDS.medicalCoupon;
  if (normalized.includes("supermerc") || normalized.includes("super") || normalized.includes("cupon supermercado") || normalized.includes("cupon super")) return BUILT_IN_SERVICE_IDS.supermarketCoupon;
  if (normalized.includes("dental") || normalized.includes("dentista") || normalized.includes("rayos x") || normalized.includes("rayosx")) return BUILT_IN_SERVICE_IDS.dentalCoupon;
  if (normalized.includes("evento") || normalized.includes("agenda")) return BUILT_IN_SERVICE_IDS.events;
  if (normalized.includes("donacion") || normalized.includes("donar") || normalized.includes("apoyo") || normalized.includes("comida")) return BUILT_IN_SERVICE_IDS.foodSupport;
  if (normalized.includes("asesor") || normalized.includes("humano") || normalized.includes("persona") || normalized.includes("hablar")) return BUILT_IN_SERVICE_IDS.advisor;
  return null;
}

function buildLgStatePatch(leadState: Json | null, patch: ReferralHubState): Json {
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
      profile_complete: Boolean(referralState.profile_name && referralState.profile_city),
      stop_requested: referralState.stop_requested ?? false,
    }),
    debugNote: "referral_hub:lg_profile",
  };
}

function updateProfileFromInput(
  leadState: Json | null,
  inboundText: string,
  channel: "messenger" | "whatsapp" = "whatsapp",
): ReferralHubTurnResult {
  const referralState = getReferralState(leadState);
  const nextState = {
    ...referralState,
    profile_name: safeStr(referralState.profile_name).trim() || null,
    profile_city: safeStr(referralState.profile_city).trim() || null,
    profile_complete: Boolean(safeStr(referralState.profile_name).trim() && safeStr(referralState.profile_city).trim()),
  };
  const trimmed = safeStr(inboundText).trim();
  if (!nextState.profile_name && trimmed) {
    const updated = { ...nextState, profile_name: trimmed, current_field: "profile_city" };
    return {
      reply: `${REFERRAL_HUB_GREETING}\n\nGracias, ${trimmed}.\n¿Ciudad donde vive?`,
      statePatch: buildLgStatePatch(leadState, updated),
      debugNote: "referral_hub:lg_profile_name",
    };
  }
  if (!nextState.profile_city && trimmed) {
    const updated = { ...nextState, profile_city: trimmed, current_field: null, profile_complete: true };
    return {
      reply: `${REFERRAL_HUB_GREETING}\n\n¡Gracias, ${safeStr(updated.profile_name)}! 🙂\nTe registramos como residente de ${trimmed}.\n\nAhora puedes elegir una opción del menú para continuar.\n\nTu información es confidencial y solo se utilizará para conectarte con beneficios, recursos y servicios de la comunidad.\n\n${LG_DISCLOSURE}`,
      interactiveList: channel === "whatsapp" ? buildLgMenuList() : undefined,
      interactiveButtons: channel === "messenger" ? buildLgMessengerQuickReplies() : undefined,
      statePatch: buildLgStatePatch(leadState, updated),
      debugNote: "referral_hub:lg_profile_city",
    };
  }
  return startLgProfileFlow(leadState);
}

function handleLgMenu(
  leadState: Json | null,
  channel: "messenger" | "whatsapp" = "whatsapp",
): ReferralHubTurnResult {
  const referralState = getReferralState(leadState);
  return {
    reply: channel === "messenger"
      ? LG_MESSENGER_MENU_TEXT
      : `${REFERRAL_HUB_GREETING}\n\n${LG_DISCLOSURE}\n\nElige una opción del menú:`,
    interactiveButtons: channel === "messenger" ? buildLgMessengerQuickReplies() : undefined,
    interactiveList: channel === "whatsapp" ? buildLgMenuList() : undefined,
    statePatch: buildLgStatePatch(leadState, {
      service_id: null,
      service_label: null,
      current_field: null,
      extracted_data: { ...(referralState.extracted_data ?? {}) },
      profile_name: referralState.profile_name ?? null,
      profile_city: referralState.profile_city ?? null,
      profile_complete: Boolean(referralState.profile_name && referralState.profile_city),
      stop_requested: referralState.stop_requested ?? false,
    }),
    debugNote: "referral_hub:lg_menu",
  };
}

const TRANSIENT_SERVICE_FIELDS = new Set([
  "service",
  "accident_date",
  "accident_city",
  "police_report",
  "contact_name",
  "contact_phone",
  "immigration_case",
  "food_option",
  "food_donation_details",
  "food_support_details",
]);

function withoutTransientServiceFields(input: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(input ?? {}).filter(([key]) => !TRANSIENT_SERVICE_FIELDS.has(key)),
  );
}

function stopResult(leadState: Json | null): ReferralHubTurnResult {
  return {
    reply: "Entendido. No seguiremos enviando mensajes promocionales ni de seguimiento. Tu historial se conservará.",
    statePatch: buildLgStatePatch(leadState, {
      service_id: null,
      service_label: null,
      current_field: null,
      extracted_data: { ...(getReferralState(leadState).extracted_data ?? {}) },
      stop_requested: true,
      profile_name: getReferralState(leadState).profile_name ?? null,
      profile_city: getReferralState(leadState).profile_city ?? null,
      profile_complete: Boolean(getReferralState(leadState).profile_name && getReferralState(leadState).profile_city),
      food_option: null,
    }),
    debugNote: "referral_hub:stop",
  };
}

function buildServiceReply(serviceId: string, leadState: Json | null): ReferralHubTurnResult {
  const referralState = getReferralState(leadState);
  const preservedData = withoutTransientServiceFields(referralState.extracted_data);
  const statePatchBase = {
    service_id: serviceId,
    service_label: serviceLabel({ id: serviceId, organization_id: REFERRAL_HUB_CANONICAL_ORGANIZATION_ID, nombre: serviceLabelFromId(serviceId), tipo: "intake" }),
    profile_name: referralState.profile_name ?? null,
    profile_city: referralState.profile_city ?? null,
    profile_complete: Boolean(referralState.profile_name && referralState.profile_city),
    stop_requested: referralState.stop_requested ?? false,
    food_option: referralState.food_option ?? null,
  };

  switch (serviceId) {
    case BUILT_IN_SERVICE_IDS.accident:
      return {
        reply: "Por tu seguridad, te conectaremos con un asesor.\n\n¿Cuál fue la fecha del accidente?",
        statePatch: buildLgStatePatch(leadState, {
          ...statePatchBase,
          current_field: "accident_date",
          extracted_data: { ...preservedData, service: "accidente" },
        }),
        debugNote: "referral_hub:service_accident",
      };
    case BUILT_IN_SERVICE_IDS.immigration:
      return {
        reply: "Te conectaremos con un profesional de confianza que pueda orientarte.\n\nCuéntanos brevemente qué tipo de ayuda migratoria necesitas.",
        statePatch: buildLgStatePatch(leadState, {
          ...statePatchBase,
          current_field: "immigration_case",
          extracted_data: { ...preservedData, service: "inmigracion" },
        }),
        debugNote: "referral_hub:service_immigration",
      };
    case BUILT_IN_SERVICE_IDS.medicalCoupon:
      return {
        reply: "Recibe un 20% de descuento en tu visita a una clínica participante.\n\nLG Community Network conecta a la comunidad con clínicas y beneficios participantes. No prestamos servicios médicos directamente.",
        statePatch: buildLgStatePatch(leadState, {
          ...statePatchBase,
          current_field: null,
          extracted_data: { ...preservedData, service: "coupon_medico" },
        }),
        debugNote: "referral_hub:service_medical_coupon",
      };
    case BUILT_IN_SERVICE_IDS.supermarketCoupon: {
      const pantryResult = handlePantryDemoTurn({
        leadState,
        inboundText: "quiero mi cupón",
        payloadAction: `referral_service:${BUILT_IN_SERVICE_IDS.supermarketCoupon}`,
      });
      return {
        ...pantryResult,
        reply: "Recibe un cupón de $20 para tu próxima compra en un supermercado participante.\n\n" + pantryResult.reply,
        statePatch: {
          ...pantryResult.statePatch,
          collected: mergeReferralState(leadState, {
            ...(getReferralState(leadState)),
            service_id: BUILT_IN_SERVICE_IDS.supermarketCoupon,
            service_label: "Cupón supermercado",
            current_field: null,
            extracted_data: { ...preservedData, service: "coupon_supermercado" },
            profile_name: referralState.profile_name ?? null,
            profile_city: referralState.profile_city ?? null,
            profile_complete: Boolean(referralState.profile_name && referralState.profile_city),
            stop_requested: referralState.stop_requested ?? false,
            food_option: referralState.food_option ?? null,
          }),
        },
        leadPatch: {
          service_id: BUILT_IN_SERVICE_IDS.supermarketCoupon,
          extracted_data: { ...(getReferralState(leadState).extracted_data ?? {}), service: "coupon_supermercado" },
          status: "contacted",
        },
        debugNote: "referral_hub:service_supermarket_coupon",
      };
    }
    case BUILT_IN_SERVICE_IDS.dentalCoupon:
      return {
        reply: "Cupón de clínica dental por $29 que incluye:\n• consulta\n• limpieza\n• rayos X.\n\nOferta sujeta a disponibilidad y a los términos de la clínica participante.",
        statePatch: buildLgStatePatch(leadState, {
          ...statePatchBase,
          current_field: null,
          extracted_data: { ...preservedData, service: "coupon_dental" },
        }),
        debugNote: "referral_hub:service_dental_coupon",
      };
    case BUILT_IN_SERVICE_IDS.events:
      return {
        reply: "Te compartiremos los próximos eventos comunitarios disponibles cerca de tu ciudad.\n\nPor ahora no tenemos eventos publicados para tu ciudad. Podemos avisarte cuando haya uno disponible.",
        statePatch: buildLgStatePatch(leadState, {
          ...statePatchBase,
          current_field: null,
          extracted_data: { ...preservedData, service: "eventos" },
        }),
        debugNote: "referral_hub:service_events",
      };
    case BUILT_IN_SERVICE_IDS.foodSupport:
      return {
        reply: "¿Deseas donar comida o recibir apoyo?",
        statePatch: buildLgStatePatch(leadState, {
          ...statePatchBase,
          current_field: "food_option",
          extracted_data: { ...preservedData, service: "food_support" },
        }),
        debugNote: "referral_hub:service_food",
      };
    case BUILT_IN_SERVICE_IDS.advisor: {
      const takeoverState = activateHumanTakeoverState({
        state: leadState,
        source: "human_replied_from_dashboard",
        actor: "luis_community_advisor",
        pauseMinutes: 240,
      });
      return {
        reply: "Claro. Dejaremos tu solicitud para que un miembro del equipo pueda atenderte personalmente.",
        statePatch: {
          ...takeoverState,
          stage: "HANDOFF",
          orgType: "referral_hub",
          active_flow: "human_takeover",
          collected: mergeReferralState(leadState, {
            ...statePatchBase,
            service_id: BUILT_IN_SERVICE_IDS.advisor,
            service_label: "Hablar con asesor",
            current_field: null,
            extracted_data: { ...preservedData, service: "asesor" },
          }),
          lastIntent: "referral_hub_advisor",
          nextExpected: undefined,
        },
        leadPatch: {
          handoff_to_human: true,
          service_id: BUILT_IN_SERVICE_IDS.advisor,
          extracted_data: { ...(referralState.extracted_data ?? {}), service: "asesor" },
          status: "contacted",
        },
        debugNote: "referral_hub:service_advisor",
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
    case BUILT_IN_SERVICE_IDS.foodSupport:
      return "Comida y apoyo";
    case BUILT_IN_SERVICE_IDS.advisor:
      return "Hablar con asesor";
    default:
      return "Servicio";
  }
}

function continueLgServiceFlow(leadState: Json | null, inboundText: string): ReferralHubTurnResult {
  const referralState = getReferralState(leadState);
  const currentField = safeStr(referralState.current_field).trim();
  const value = safeStr(inboundText).trim();
  const extractedData = { ...(referralState.extracted_data ?? {}) } as Record<string, unknown>;

  if (referralState.service_id === BUILT_IN_SERVICE_IDS.accident) {
    if (currentField === "accident_date") {
      extractedData.accident_date = value;
      return {
        reply: "¿En qué ciudad ocurrió?",
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: "accident_city",
          extracted_data: extractedData,
        }),
        debugNote: "referral_hub:accident_date",
      };
    }
    if (currentField === "accident_city") {
      extractedData.accident_city = value;
      return {
        reply: "¿Hubo reporte policial? Responde sí o no.",
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: "police_report",
          extracted_data: extractedData,
        }),
        debugNote: "referral_hub:accident_city",
      };
    }
    if (currentField === "police_report") {
      extractedData.police_report = /^(si|sí|yes)$/i.test(value) ? "sí" : "no";
      return {
        reply: "¿Cuál es tu nombre completo?",
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: "contact_name",
          extracted_data: extractedData,
        }),
        debugNote: "referral_hub:accident_police",
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
        reply: "Gracias. Tu solicitud recibida. Un asesor se comunicará contigo lo antes posible.",
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: null,
          extracted_data: extractedData,
          service_id: null,
          service_label: null,
        }),
        debugNote: "referral_hub:accident_complete",
      };
    }
  }

  if (referralState.service_id === BUILT_IN_SERVICE_IDS.immigration) {
    extractedData.immigration_case = value;
    return {
      reply: "Gracias. Registramos tu solicitud para que un profesional pueda comunicarse contigo.",
      statePatch: buildLgStatePatch(leadState, {
        ...referralState,
        current_field: null,
        extracted_data: extractedData,
        service_id: null,
        service_label: null,
      }),
      debugNote: "referral_hub:immigration_complete",
    };
  }

  if (referralState.service_id === BUILT_IN_SERVICE_IDS.foodSupport) {
    if (currentField === "food_option") {
      const normalized = normalizeText(value);
      const chosen = normalized.includes("donar") || normalized.includes("quiero donar") ? "donation" : "support";
      extractedData.food_option = chosen;
      if (chosen === "donation") {
        return {
          reply: "Perfecto. Cuéntanos el tipo de donación y la ciudad.",
          statePatch: buildLgStatePatch(leadState, {
            ...referralState,
            current_field: "food_donation_details",
            food_option: chosen,
            extracted_data: extractedData,
          }),
          debugNote: "referral_hub:food_donation",
        };
      }
      return {
        reply: "Claro. Cuéntanos la ciudad y la necesidad breve que tienes.",
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: "food_support_details",
          food_option: chosen,
          extracted_data: extractedData,
        }),
        debugNote: "referral_hub:food_support",
      };
    }
    if (currentField === "food_donation_details") {
      extractedData.food_donation_details = value;
      return {
        reply: "Gracias. Registramos tu solicitud para conectarte con recursos o miembros del equipo cuando haya disponibilidad.",
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: null,
          extracted_data: extractedData,
          service_id: null,
          service_label: null,
        }),
        debugNote: "referral_hub:food_donation_complete",
      };
    }
    if (currentField === "food_support_details") {
      extractedData.food_support_details = value;
      return {
        reply: "Gracias. Registramos tu solicitud para conectarte con recursos o miembros del equipo cuando haya disponibilidad.",
        statePatch: buildLgStatePatch(leadState, {
          ...referralState,
          current_field: null,
          extracted_data: extractedData,
          service_id: null,
          service_label: null,
        }),
        debugNote: "referral_hub:food_support_complete",
      };
    }
  }

  return buildServiceReply(referralState.service_id ?? BUILT_IN_SERVICE_IDS.advisor, leadState);
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
  serviceConfigs?: ReferralHubServiceConfig[];
}): Promise<ReferralHubTurnResult> {
  const isLgTenant = safeStr(args.organizationId).trim() ===
    REFERRAL_HUB_CANONICAL_ORGANIZATION_ID;

  if (shouldHandlePantryDemo({
    leadState: args.leadState,
    inboundText: args.inboundText,
    payloadAction: args.payloadAction,
  }) && !isLgTenant) {
    const issuedCoupon = args.supabase?.rpc && args.leadId && isPantryCouponEntry(args)
      ? await issueOrGetCoupon({ supabase: args.supabase as Parameters<typeof issueOrGetCoupon>[0]["supabase"], organizationId: args.organizationId, leadId: args.leadId })
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
    if (!safeStr(referralState.profile_name).trim() || !safeStr(referralState.profile_city).trim()) {
      if (safeStr(referralState.current_field).trim() === "profile_name") {
        return updateProfileFromInput(args.leadState, args.inboundText, args.channel);
      }
      if (safeStr(referralState.current_field).trim() === "profile_city") {
        return updateProfileFromInput(args.leadState, args.inboundText, args.channel);
      }
      if (!safeStr(referralState.profile_name).trim() && !safeStr(referralState.profile_city).trim()) {
        return startLgProfileFlow(args.leadState);
      }
      if (!safeStr(referralState.profile_city).trim()) {
        return updateProfileFromInput(args.leadState, args.inboundText, args.channel);
      }
    }

    if (shouldResetMenu(args.inboundText)) {
      return handleLgMenu(args.leadState, args.channel);
    }

    const selectedPayloadServiceId = safeStr(args.payloadAction).trim()
      ? resolveServiceIdFromInput(args.payloadAction ?? "")
      : null;
    if (selectedPayloadServiceId) {
      return buildServiceReply(selectedPayloadServiceId, args.leadState);
    }

    if (safeStr(referralState.current_field).trim()) {
      return continueLgServiceFlow(args.leadState, args.inboundText);
    }

    const selectedTextServiceId = resolveServiceIdFromInput(args.inboundText);
    if (selectedTextServiceId) {
      return buildServiceReply(selectedTextServiceId, args.leadState);
    }

    if (normalizeText(args.inboundText).includes("hola") || normalizeText(args.inboundText).includes("menu") || !safeStr(args.inboundText).trim()) {
      return handleLgMenu(args.leadState, args.channel);
    }

    return handleLgMenu(args.leadState, args.channel);
  }

  const configs = args.serviceConfigs ??
    (args.supabase ? await loadServiceConfigs(args.supabase, args.organizationId) : []);
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

  const activeService = configs.find((config) => config.id === referralState.service_id) ?? null;
  if (activeService?.tipo === "intake" && referralState.current_field) {
    return continueIntakeResult({
      leadState: args.leadState,
      config: activeService,
      inboundText: args.inboundText,
      payloadAction: args.payloadAction,
    });
  }

  let selectedServiceId = extractServiceId(args.inboundText, args.payloadAction);
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
    return staticActionResult(args.leadState, selectedService, args.channelUserId);
  }
  if (selectedService.tipo === "transfer") return transferResult(args.leadState, selectedService);
  return startIntakeResult(args.leadState, selectedService);
}
