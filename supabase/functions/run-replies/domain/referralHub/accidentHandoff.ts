type Json = Record<string, unknown>;

export const LG_ACCIDENT_HANDOFF_SUCCESS =
  "Gracias por la información.\n\nLG Community Network no ofrece asesoría legal directamente. Te conectamos con profesionales o recursos participantes.\n\nUn asesor te contactará en breve para orientarte sobre el siguiente paso.";

export const LG_ACCIDENT_HANDOFF_FAILURE =
  "No pudimos completar la solicitud en este momento. Inténtalo nuevamente o selecciona ‘Hablar con asesor’.";

export const LG_ADVISOR_HANDOFF_SUCCESS =
  "Listo. Un asesor te contactará en breve para orientarte.";

export function buildCreatedAccidentHandoffState(
  statePatch: Json,
  createdAt: string,
): Json {
  const collected = statePatch.collected && typeof statePatch.collected === "object"
    ? { ...(statePatch.collected as Json) }
    : {};
  const referralHub = collected.referral_hub && typeof collected.referral_hub === "object"
    ? { ...(collected.referral_hub as Json) }
    : {};
  return {
    ...statePatch,
    handoff_to_human: true,
    collected: {
      ...collected,
      referral_hub: {
        ...referralHub,
        handoff_status: "created",
        handoff_created_at: createdAt,
      },
    },
  };
}

export function resolveAccidentHandoffOutcome(args: {
  persisted: boolean;
  createdStatePatch: Json;
}): { reply: string; statePatch: Json } {
  return args.persisted
    ? { reply: LG_ACCIDENT_HANDOFF_SUCCESS, statePatch: args.createdStatePatch }
    : { reply: LG_ACCIDENT_HANDOFF_FAILURE, statePatch: {} };
}

export function resolveAdvisorHandoffOutcome(args: {
  persisted: boolean;
  createdStatePatch: Json;
}): { reply: string; statePatch: Json } {
  return args.persisted
    ? { reply: LG_ADVISOR_HANDOFF_SUCCESS, statePatch: args.createdStatePatch }
    : { reply: LG_ACCIDENT_HANDOFF_FAILURE, statePatch: {} };
}
