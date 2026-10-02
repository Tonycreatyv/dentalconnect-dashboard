export type NormalizedWhatsAppInbound = {
  content: string;
  payload_action: string | null;
  flow_response?: Record<string, unknown>;
};

function safeString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

export function normalizeWhatsAppInboundMessage(msg: any): NormalizedWhatsAppInbound | null {
  const textBody = safeString(msg?.text?.body);
  const buttonText = safeString(msg?.button?.text);
  const buttonPayload = safeString(msg?.button?.payload);
  const interactiveButtonTitle = safeString(msg?.interactive?.button_reply?.title);
  const interactiveButtonId = safeString(msg?.interactive?.button_reply?.id);
  const interactiveListTitle = safeString(msg?.interactive?.list_reply?.title);
  const interactiveListId = safeString(msg?.interactive?.list_reply?.id);
  const flowReply = msg?.interactive?.nfm_reply;
  const hasFlowReply = Boolean(flowReply && typeof flowReply === "object");
  const rawFlowResponse = safeString(flowReply?.response_json);
  let flowResponse: Record<string, unknown> | null = null;
  if (rawFlowResponse) {
    try {
      const parsed = JSON.parse(rawFlowResponse);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        flowResponse = parsed as Record<string, unknown>;
      }
    } catch { /* Flow payload remains invalid and is handled safely downstream. */ }
  }

  const content = textBody || interactiveButtonTitle || interactiveListTitle || buttonText || buttonPayload ||
    (hasFlowReply ? "__whatsapp_flow_completed__" : "");
  if (!content) return null;

  const payload_action = interactiveButtonId || interactiveListId || buttonPayload ||
    (hasFlowReply ? "whatsapp_flow:complete" : null);
  return { content, payload_action, ...(hasFlowReply ? { flow_response: flowResponse ?? {} } : {}) };
}

export function normalizeInboundFromPayloadAction(rawText: string, payloadActionRaw: string): string {
  const action = safeString(payloadActionRaw).toLowerCase();
  if (!action) return rawText;
  if (
    [
      "insurance_closed:quote_other",
      "insurance_closed:advisor",
      "insurance_closed:done",
    ].includes(action)
  ) return action;
  if (["confirm_booking", "confirm", "confirmar", "booking_confirm"].includes(action)) return "Confirmar";
  if (["cancel_booking", "confirm_cancel_appointment", "cancel", "cancelar"].includes(action)) return "Cancelar";
  if (["reschedule_booking", "reschedule", "change_slot", "cambiar_horario"].includes(action)) return "Reagendar";
  if (["third_party_booking", "book_for_other", "additional_booking"].includes(action)) return "quiero una para otra persona";
  if (/^\d{1,2}:\d{2}(\s?(am|pm))?$/.test(action)) return action;
  if (action.startsWith("slot_")) {
    const candidate = action.replace(/^slot_/, "").replace(/_/g, ":");
    if (/^\d{1,2}:\d{2}$/.test(candidate)) return candidate;
  }
  return rawText;
}
