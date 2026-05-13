export type BarbershopTurnIntent =
  | "booking_request"
  | "booking_confirm"
  | "booking_cancel"
  | "booking_reschedule"
  | "pricing_question"
  | "product_question"
  | "availability_question"
  | "barber_preference"
  | "vague_time"
  | "unknown";

function normalizeText(input: string): string {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyBarbershopIntent(args: {
  text: string;
  nextExpected?: string | null;
}): BarbershopTurnIntent {
  const text = normalizeText(args.text);
  if (/^(si|s[ií]|ok|confirmar|dale|claro|correcto)$/.test(text)) return "booking_confirm";
  if (/^(no|cancelar|mejor no)$/.test(text)) return "booking_cancel";
  if (/\b(reagendar|cambiar cita|mover cita|otro horario)\b/.test(text)) return "booking_reschedule";
  if (
    /\b(cuanto cuesta|precio|cuanto vale|y el corte|y la barba|y el combo|tarifa|quiero saber precio|quiero info de precio)\b/
      .test(text)
  ) {
    return "pricing_question";
  }
  if (/\b(producto|productos|pomada|gel|shampoo|aftershave|aceite|kit)\b/.test(text)) {
    return "product_question";
  }
  if (/\b(que horas|que horarios|disponibilidad|ver mas|otra hora|otro dia)\b/.test(text)) {
    return "availability_question";
  }
  if (/\b(cualquiera|con cualquiera|el que este disponible|no importa)\b/.test(text)) {
    return "barber_preference";
  }
  if (/^(tarde|manana|en la tarde|mas tarde|mas temprano)$/.test(text)) return "vague_time";

  if (/^(quiero|quiero saber|quiero info|me interesa)$/.test(text)) return "unknown";

  const hasDateTimeSignal =
    /\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|a las\s+\d{1,2}|:\d{2})\b/.test(text);
  const hasBookingPhrase =
    /\b(quiero cita|quiero una cita|quiero agendar|quiero reservar|necesito cita|ocupo cita)\b/.test(text);
  const hasServicePhrase =
    /\b(quiero corte|quiero barba|quiero corte y barba|quiero combo|corte y barba|corte con barba)\b/.test(text);
  const hasBarberPhrase = /\b(con\s+[a-z]+)\b/.test(text);

  if (hasBookingPhrase || hasServicePhrase || hasDateTimeSignal || hasBarberPhrase) return "booking_request";
  return "unknown";
}
