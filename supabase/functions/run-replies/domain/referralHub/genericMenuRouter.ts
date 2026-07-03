import type {
  InteractiveButton,
  WhatsAppInteractiveListSpec,
} from "../../../_shared/metaMessageAdapter.ts";
import { activateHumanTakeoverState } from "../humanTakeover.ts";

type Json = Record<string, unknown>;

type SupabaseLike = {
  from(table: string): any;
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
};

export type ReferralHubTurnResult = {
  reply: string;
  statePatch: Json;
  leadPatch?: Json;
  debugNote: string;
  interactiveButtons?: InteractiveButton[];
  interactiveList?: WhatsAppInteractiveListSpec;
};

type ReferralHubState = {
  service_id?: string | null;
  service_label?: string | null;
  current_field?: string | null;
  extracted_data?: Record<string, unknown>;
  awaiting_community_opt_in?: boolean;
};

// TEMPORAL — reemplazar con el contenido real que dé Luis Gabriel (imagen del cupón, fechas reales de eventos/donación, etc.)
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

const REFERRAL_HUB_GREETING =
  "Hola, soy Luis Gabriel. Gracias por comunicarte conmigo. Durante muchos años he trabajado conectando a nuestra comunidad con abogados, médicos y otros servicios de confianza.\n\n¿En qué puedo ayudarte hoy?";

const REFERRAL_HUB_GENERAL_CLOSING =
  "Gracias por confiar en Luis Gabriel. Mi compromiso siempre ha sido conectar a nuestra comunidad con personas y servicios en los que realmente confío.";

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
  const { data, error } = await supabase
    .from("service_configs")
    .select("id, organization_id, nombre, icono, tipo, menu_orden, menu_label, intake_objectives, accion_estatica")
    .eq("organization_id", organizationId)
    .eq("activo", true)
    .order("menu_orden", { ascending: true });
  if (error) throw new Error(`referral_hub_configs_load_failed:${error.message}`);
  return ((data ?? []) as ReferralHubServiceConfig[])
    .filter((config) => safeStr(config.id).trim())
    .sort((a, b) => Number(a.menu_orden ?? 999) - Number(b.menu_orden ?? 999));
}

function buildSummary(config: ReferralHubServiceConfig, data: Record<string, unknown>): string {
  const objectives = Array.isArray(config.intake_objectives) ? config.intake_objectives : [];
  const lines = objectives
    .filter((objective) => safeStr(objective.campo).trim())
    .map((objective) => `${objective.campo}: ${safeStr(data[objective.campo], "No informado")}`);
  return [`Servicio: ${serviceLabel(config)}`, ...lines].join("\n");
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
  const text = safeStr((config.accion_estatica as Json | null)?.texto).trim() ||
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

export async function handleReferralHubTurn(args: {
  supabase?: SupabaseLike;
  organizationId: string;
  leadState: Json | null;
  inboundText: string;
  payloadAction?: string | null;
  channelUserId?: string | null;
  serviceConfigs?: ReferralHubServiceConfig[];
}): Promise<ReferralHubTurnResult> {
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

  const referralState = getReferralState(args.leadState);
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
