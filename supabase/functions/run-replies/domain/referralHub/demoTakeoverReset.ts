type Json = Record<string, unknown>;

const META_TEST_DEMO_RESET_COMMANDS = new Set([
  "menu",
  "menu principal",
  "demo",
  "inicio",
  "reiniciar",
  "ver otros servicios",
]);

const META_TEST_DEMO_RESET_ACTIONS = new Set([
  "referral_menu:main",
  "referral_menu:services",
]);

function safeString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function normalizeCommand(value: unknown): string {
  return safeString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function metaTestDemoResetAction(
  inboundText: string,
  payloadAction: string | null | undefined,
): string | null {
  const normalizedAction = normalizeCommand(payloadAction).replace(
    /^action:/,
    "",
  );
  if (META_TEST_DEMO_RESET_ACTIONS.has(normalizedAction)) {
    return normalizedAction;
  }

  const normalizedText = normalizeCommand(inboundText);
  return META_TEST_DEMO_RESET_COMMANDS.has(normalizedText)
    ? normalizedText
    : null;
}

export function clearMetaTestDemoTakeoverState(leadState: Json | null): Json {
  const nextState = leadState && typeof leadState === "object"
    ? { ...leadState }
    : {};
  const stateHasHumanTakeover = nextState.handoff_to_human === true ||
    safeString(nextState.conversation_mode) === "human_active" ||
    safeString(nextState.automation_mode) === "human_takeover";
  if (stateHasHumanTakeover) {
    delete nextState.handoff_to_human;
    delete nextState.conversation_mode;
    delete nextState.bot_paused_until;
    delete nextState.paused_reason;
    if (safeString(nextState.automation_mode) === "human_takeover") {
      delete nextState.automation_mode;
    }
  }

  const collected =
    nextState.collected && typeof nextState.collected === "object"
      ? { ...(nextState.collected as Json) }
      : {};
  // Luis legal intake is temporary router state. Completed intake is preserved
  // separately as audit/history and must never be deleted by a test reset.
  delete collected.luis_legal;
  delete collected.luis_legal_draft;
  delete collected.luis_legal_answers;
  delete nextState.pending_intent;
  delete nextState.awaiting_field;
  delete nextState.pending_field;
  delete nextState.active_legal_intake;
  delete nextState.legal_intake;
  if (safeString(nextState.lastIntent).startsWith("luis_legal_")) {
    delete nextState.lastIntent;
  }
  if (safeString(nextState.nextExpected) === "luis_legal") {
    delete nextState.nextExpected;
  }
  const referral = collected.referral_hub &&
      typeof collected.referral_hub === "object"
    ? { ...(collected.referral_hub as Json) }
    : null;
  if (referral) {
    if (safeString(referral.service_id) === "luis_representante") {
      delete referral.service_id;
      delete referral.service_label;
      delete referral.current_field;
    }
    if (safeString(referral.handoff_status) === "created") {
      delete referral.handoff_status;
    }
    const lastCompletion = referral.last_completion &&
        typeof referral.last_completion === "object"
      ? referral.last_completion as Json
      : null;
    if (safeString(lastCompletion?.service_id) === "luis_representante") {
      delete referral.last_completion;
    }
    const extractedData = referral.extracted_data &&
        typeof referral.extracted_data === "object"
      ? { ...(referral.extracted_data as Json) }
      : null;
    if (extractedData && safeString(extractedData.service) === "asesor") {
      delete extractedData.service;
      referral.extracted_data = extractedData;
    }
    collected.referral_hub = referral;
  }
  nextState.collected = collected;

  return nextState;
}
