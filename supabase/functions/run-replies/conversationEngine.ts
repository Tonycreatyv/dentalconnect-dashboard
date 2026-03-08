import { normalizeText } from "./domain/normalization.ts";
import { detectIntent, Intent, IntentResult } from "./domain/intents.ts";
import { Stage, StageOrder, getNextStage, enforceMonotonicStage } from "./domain/state.ts";
import { shouldSkipRepeat, repeatFallback, shouldSkipDiscovery } from "./domain/rules.ts";
import { composeResponse } from "./domain/responses.ts";
import { handleObjection } from "./domain/objectionHandler.ts";
import { resolveVertical } from "./domain/verticals.ts";
import { ToolActionExecution } from "./domain/actionExecutor.ts";

export type ConversationState = {
  stage?: Stage;
  phase?: Stage;
  lastIntent?: string;
  collected?: Record<string, unknown>;
};

export type ConversationResult = {
  replyText: string;
  statePatch: Record<string, unknown>;
  debug: { intent: string; stage: Stage };
  toolAction?: ToolActionExecution;
};

export function runConversationEngine(args: {
  organizationId: string;
  inboundText: string;
  leadState: ConversationState | null;
}): ConversationResult | null {
  if (args.organizationId !== "creatyv-product") return null;
  const text = normalizeText(args.inboundText);
  if (!text) return null;
  const intent = detectIntent(text);
  const rawCollected = (args.leadState?.collected as Record<string, unknown>) ?? {};
  const { stage: collectedStage, ...restCollected } = rawCollected;
  const collected = { ...restCollected };
  const currentStage: Stage =
    (args.leadState?.stage as Stage) ??
    (args.leadState?.phase as Stage) ??
    (collectedStage as Stage) ??
    "DISCOVERY";
  const businessTypeCandidate =
    String((args.leadState?.business_type ?? collected.business_type ?? "").trim()) || undefined;
  if (businessTypeCandidate) collected.business_type = businessTypeCandidate;
  const businessType = businessTypeCandidate;
  const vertical = resolveVertical(businessType);
  const context = {
    verticalName: vertical.name,
    verticalFocus: vertical.focus,
    pain: vertical.pain,
    offer: vertical.offer,
    trialFrame: vertical.trialFrame,
    businessTypeAlias: businessType ?? vertical.name,
  };

  const objection = handleObjection(intent.intent, currentStage);
  if (objection) {
    const lastQuestion = collected.last_question as string | undefined;
    if (shouldSkipRepeat(lastQuestion, objection.questionKey, currentStage)) {
      return fallbackForStage(currentStage, intent.intent, context);
    }
    return buildResult(
      objection.replyText,
      currentStage,
      objection.stage,
      objection.questionKey,
      intent,
      collected,
      { [objection.flag]: true },
      intent.intent === "demo_interest" ? { name: "show_demo", payload: { vertical: context.verticalName } } : undefined,
      context
    );
  }

  const storedPain = String(collected.selected_pain ?? "").trim() || undefined;
  const valueContext = buildValueContext(storedPain ?? "more_appointments", context);
  const activationResult = handleActivationIntent(
    currentStage,
    intent,
    collected,
    context,
    valueContext
  );
  if (activationResult) return activationResult;
  const painKey = resolvePainKey(intent.intent, storedPain);
  if (painKey) {
    const now = new Date().toISOString();
    const resolvedValueContext = buildValueContext(painKey, context);
    const responsePayload = composeResponse("VALUE", intent, resolvedValueContext);
    const updatedCollected = {
      ...collected,
      selected_pain: painKey,
      selected_pain_at: now,
    };
    return buildResult(
      responsePayload.replyText,
      currentStage,
      "VALUE",
      responsePayload.questionKey,
      intent,
      updatedCollected,
      {},
      { name: "capture_lead_goal", payload: { goal: painKey } },
      resolvedValueContext
    );
  }

  if (storedPain && shouldSkipDiscovery(collected, currentStage)) {
    const responsePayload = composeResponse("VALUE", intent, valueContext);
    return buildResult(
      responsePayload.replyText,
      currentStage,
      "VALUE",
      responsePayload.questionKey,
      intent,
      collected,
      {},
      undefined,
      valueContext
    );
  }

  const responseContext = currentStage === "VALUE" || currentStage === "ACTIVATION" ? valueContext : context;
  const response = composeResponse(currentStage, intent, responseContext);
  if (shouldSkipRepeat(collected.last_question as string | undefined, response.questionKey, currentStage)) {
    const fallbackText = repeatFallback();
    return buildResult(
      fallbackText,
      currentStage,
      currentStage,
      "repeat_fallback",
      intent,
      collected,
      {},
      undefined,
      context
    );
  }

  const nextStageCandidate = getNextStage(currentStage, intent.intent);
  const stage = enforceMonotonicStage(currentStage, nextStageCandidate);
  const toolAction = resolveToolAction(stage, intent.intent, context, args.inboundText.trim());
  return buildResult(
    response.replyText,
    currentStage,
    stage,
    response.questionKey,
    intent,
    collected,
    {},
    toolAction,
    context
  );
}

function fallbackForStage(stage: Stage, intentName: string, context: Record<string, string>): ConversationResult {
  const fallback = repeatFallback();
  return buildResult(fallback, stage, stage, "fallback_repeat", { intent: intentName }, {}, {}, undefined, context);
}

function buildResult(
  replyText: string,
  currentStage: Stage,
  nextStage: Stage,
  questionKey: string,
  intent: IntentResult,
  collected: Record<string, unknown>,
  objectionFlags: Record<string, boolean>,
  toolAction: ToolActionExecution | undefined,
  context: Record<string, string>
): ConversationResult {
  const history = Array.isArray(collected.intent_history)
    ? [...(collected.intent_history as string[]), intent.intent]
    : [intent.intent];
  const stageIndex = StageOrder.indexOf(nextStage);
  const trialOffered = stageIndex >= StageOrder.indexOf("TRIAL_OFFER") || (collected.trial_offered as boolean) === true;
  const onboardingStarted = stageIndex >= StageOrder.indexOf("ACTIVATION") || (collected.onboarding_started as boolean) === true;
  const resolvedBusinessType =
    (collected.business_type as string) ?? context.businessTypeAlias ?? context.verticalName;
  return {
    replyText,
    statePatch: {
      stage: nextStage,
      lastIntent: intent.intent,
      business_type: resolvedBusinessType,
      collected: {
        ...collected,
        last_question: questionKey,
        intent_history: history,
        objection_flags: { ...(collected.objection_flags as Record<string, boolean>), ...objectionFlags },
        trial_offered: trialOffered,
        onboarding_started: onboardingStarted,
        business_type: resolvedBusinessType,
        last_offer_type: nextStage,
      },
    },
    debug: { intent: intent.intent, stage: nextStage },
    toolAction,
  };
}

function resolveToolAction(stage: Stage, intent: string, context: Record<string, string>, rawText: string): ToolActionExecution | undefined {
  if (stage === "TRIAL_OFFER" && intent === "trial_interest") {
    return { name: "start_trial", payload: { vertical: context.verticalName } };
  }
  if (stage === "ACTIVATION" && intent === "onboarding_interest") {
    return { name: "begin_onboarding", payload: { vertical: context.verticalName } };
  }
  if (intent === "selected_pain") {
    return { name: "capture_lead_goal", payload: { goal: rawText } };
  }
  if (intent === "services") {
    return { name: "capture_business_type", payload: { businessType: context.verticalName } };
  }
  if (intent === "demo_interest") {
    return { name: "show_demo", payload: { vertical: context.verticalName } };
  }
  return undefined;
}

const painIntentMap: Record<string, string> = {
  selected_pain: "more_appointments",
  more_appointments: "more_appointments",
  faster_replies: "faster_replies",
  organization: "organization",
  follow_up: "follow_up",
  pain_selection_confirmed: "more_appointments",
  recommendation_request: "more_appointments",
  revenue_question: "more_appointments",
};

function resolvePainKey(intent: string, storedPain?: string): string | undefined {
  const mapped = painIntentMap[intent];
  if (mapped) return mapped;
  if (intent === "product_interest" && storedPain) return storedPain;
  if (!storedPain && intent === "recommendation_request") return "more_appointments";
  return storedPain;
}

const narratives: Record<string, { recommendation: string; reason: string; mapping: string; close: string }> = {
  more_appointments: {
    recommendation: "conseguir más citas",
    reason: "Porque cada mensaje sin responder puede ser una cita perdida y una oportunidad que nunca se concreta.",
    mapping: "Este sistema responde rápido, organiza interesados y automatiza seguimientos para empujar más conversaciones hacia cita.",
    close: "Si querés, podés probarlo con tu clínica y ver cómo convierte mejores mensajes en citas.",
  },
  faster_replies: {
    recommendation: "responder más rápido",
    reason: "Porque cuando un paciente escribe y no recibe respuesta, la conversación se enfría y se pierde la reserva.",
    mapping: "El sistema sostiene la atención inicial, reitera respuestas y alerta cuando necesita seguimiento para que no dependas de contestar manualmente.",
    close: "Si querés, podés probarlo con tu clínica para que los mensajes nunca queden sin contestar.",
  },
  organization: {
    recommendation: "ordenar tus consultas y mensajes",
    reason: "Porque cuando los leads quedan dispersos, pierden continuidad y deja de generarte resultados.",
    mapping: "El asistente centraliza conversaciones, marca prioridades y te ayuda a seguir cada caso sin perder datos.",
    close: "Si querés, podés probarlo con tu clínica y ver cómo mantiene todo más ordenado.",
  },
  follow_up: {
    recommendation: "dar seguimiento consistente",
    reason: "Porque muchos leads se enfrían después del primer contacto y nadie retoma la conversación.",
    mapping: "Este sistema reaviva conversaciones, recuerda seguirups y asegura que cada interesado reciba la continuidad que necesita.",
    close: "Si querés, podés probarlo con tu clínica y dejar el seguimiento en piloto automático.",
  },
};

function buildValueContext(painKey: string, base: Record<string, string>): Record<string, string> {
  const narrative = narratives[painKey] ?? narratives.more_appointments;
  return {
    ...base,
    recommendation: narrative.recommendation,
    reason: narrative.reason,
    mapping: narrative.mapping,
    close: narrative.close,
  };
}

function handleActivationIntent(
  currentStage: Stage,
  intent: IntentResult,
  collected: Record<string, unknown>,
  context: Record<string, string>,
  valueContext: Record<string, string>
): ConversationResult | null {
  const currentIndex = StageOrder.indexOf(currentStage);
  const valueIndex = StageOrder.indexOf("VALUE");
  if (currentIndex < valueIndex) return null;

  const trialIntents = new Set<Intent>(["acceptance", "trial_interest"]);
  const onboardingIntents = new Set<Intent>(["activation_interest", "onboarding_interest"]);
  let toolAction: ToolActionExecution | undefined;
  if (trialIntents.has(intent.intent)) {
    toolAction = { name: "start_trial", payload: { vertical: context.verticalName } };
  } else if (onboardingIntents.has(intent.intent)) {
    toolAction = { name: "begin_onboarding", payload: { vertical: context.verticalName } };
  } else {
    return null;
  }

  const responsePayload = composeResponse("ACTIVATION", intent, valueContext);
  return buildResult(
    responsePayload.replyText,
    currentStage,
    "ACTIVATION",
    responsePayload.questionKey,
    intent,
    collected,
    { acceptance: true },
    toolAction,
    valueContext
  );
}
