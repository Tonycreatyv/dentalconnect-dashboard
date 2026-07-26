export type NormalizedWhatsAppInbound = {
  content: string;
  payload_action: string | null;
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

  const content = textBody || interactiveButtonTitle || interactiveListTitle || buttonText || buttonPayload;
  if (!content) return null;

  const payload_action = interactiveButtonId || interactiveListId || buttonPayload || null;
  return { content, payload_action };
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
