export const receptionistCopy = {
  greeting: "Hola, soy la asistente de la clínica. ¿En qué te puedo ayudar hoy?",
  askService:
    "Claro. ¿Qué tipo de cita necesitás: revisión general, limpieza, ortodoncia, blanqueamiento o alguna molestia dental?",
  askDateTime:
    "Perfecto. ¿Tenés algún día u hora que te quede mejor?",
  showAvailability:
    "Tengo estos espacios disponibles. ¿Cuál te queda mejor?",
  confirmSlot:
    "Ese horario está disponible. ¿Confirmamos la cita?",
  bookingConfirmed:
    "Listo, tu cita quedó confirmada. Si querés, te comparto un resumen.",
  appointmentLookup:
    "Déjame revisar tus citas para confirmarte los detalles.",
  cancelPending:
    "Todavía no estaba confirmada, así que no hay nada que cancelar. ¿Querés descartarla o buscar otro horario?",
  cancelConfirmedAsk:
    "Veo tu cita agendada. ¿Querés que la cancele?",
  cancelConfirmedDone:
    "Listo, tu cita quedó cancelada.",
  rescheduleAsk:
    "Perfecto, te ayudo a cambiarla. ¿Qué día u hora preferís?",
  variablePrice:
    "El costo puede variar según el caso. Con la evaluación te damos el plan y precio exactos.",
  evaluationPrice:
    "La evaluación tiene costo y duración definidos por la clínica. Si querés, te ayudo a agendarla.",
  fallbackWithBookingContext:
    "Te sigo ayudando con tu cita. ¿Querés ver horarios disponibles o tenés un día específico en mente?",
  handoffToStaff:
    "Te conecto con una persona del equipo para ayudarte mejor.",
  emergencyEscalation:
    "Por seguridad, te recomiendo atención prioritaria de inmediato. Si querés, te ayudo a coordinarlo ahora mismo.",
} as const;

export type ReceptionistCopyKey = keyof typeof receptionistCopy;
