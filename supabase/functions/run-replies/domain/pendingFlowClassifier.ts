export type ConversationTurnIntent =
  | "clean_confirmation"
  | "clean_rejection"
  | "date_time_change"
  | "service_change"
  | "business_hours_question"
  | "pricing_question"
  | "location_question"
  | "service_info_question"
  | "appointment_lookup"
  | "cancel_request"
  | "reschedule_request"
  | "new_booking_request"
  | "active_appointment_choice"
  | "frustration"
  | "human_handoff"
  | "unknown";

function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalize(text: string): string {
  return safeStr(text, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyPendingFlowMessage(text: string): ConversationTurnIntent {
  const t = normalize(text);

  if (/\b(quiero hablar con alguien|pasame con recepcion|pasame con recepción|quiero una persona)\b/.test(t)) {
    return "human_handoff";
  }
  if (/\b(no entendes|ya te dije|te estoy diciendo|no me estas entendiendo|eso no fue lo que dije)\b/.test(t)) {
    return "frustration";
  }
  if (/\b(donde estan|ubicacion|direccion)\b/.test(t)) return "location_question";
  if (/\b(a que hora abren|horario|estan abiertos|abren los martes)\b/.test(t)) return "business_hours_question";
  if (/\b(cuanto cuesta|precio|cuanto vale)\b/.test(t)) return "pricing_question";

  if (/^(si|ok|dale|me funciona|correcto|esta bien|confirmar)$/.test(t)) {
    const hasDisqualifier = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|a las|quiero|cambiar|precio|horario|donde)\b/.test(t);
    if (!hasDisqualifier) return "clean_confirmation";
  }
  if (/^(no|mejor no|cancelar eso|no quiero)$/.test(t)) return "clean_rejection";

  if (/\b(mejor manana|el viernes a las|a las \d{1,2}|misma fecha pero a las|el lunes|viernes 15)\b/.test(t)) {
    return "date_time_change";
  }
  if (/\b(mejor limpieza|en vez de brackets quiero blanqueamiento|quiero cambiar el servicio|quiero limpieza|quiero brackets)\b/.test(t)) {
    return "service_change";
  }
  if (/\b(que cita tengo|confirmame mi cita|a que hora es mi cita)\b/.test(t)) return "appointment_lookup";
  if (/\b(cancelar cita|quiero cancelar|cancelala)\b/.test(t)) return "cancel_request";
  if (/\b(reagendar|cambiar mi cita|mover mi cita)\b/.test(t)) return "reschedule_request";
  if (/\b(agendar|quiero una cita|necesito cita)\b/.test(t)) return "new_booking_request";
  if (/\b(agregar a esa cita|buscar un horario mas pronto|agendar una cita adicional)\b/.test(t)) return "active_appointment_choice";
  if (/\b(hacen|ofrecen|tienen)\b/.test(t)) return "service_info_question";

  return "unknown";
}

