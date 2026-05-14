export type DentalPlaybookId =
  | "booking"
  | "availability"
  | "pricing"
  | "appointment_lookup"
  | "cancellation"
  | "reschedule"
  | "emergency"
  | "objection_handling"
  | "no_response_followup"
  | "reminder"
  | "human_handoff";

export type DentalPlaybook = {
  id: DentalPlaybookId;
  description: string;
  triggerIntents: string[];
  requiredFields: string[];
  allowedToolActions: string[];
  fallbackBehavior: string;
  handoffConditions: string[];
  successCriteria: string[];
};

export const DENTAL_PLAYBOOKS: DentalPlaybook[] = [
  {
    id: "booking",
    description: "Guía para iniciar y completar agendamiento de cita.",
    triggerIntents: ["book_appointment", "confirm_booking"],
    requiredFields: ["service", "preferred_date", "preferred_time"],
    allowedToolActions: ["check_availability", "create_appointment"],
    fallbackBehavior: "Mantener contexto de cita y pedir dato faltante.",
    handoffConditions: ["paciente solicita humano", "falla repetida de agenda"],
    successCriteria: ["slot confirmado", "resumen compartido"],
  },
  {
    id: "availability",
    description: "Consulta y presentación de horarios disponibles.",
    triggerIntents: ["availability_inquiry", "hours_question"],
    requiredFields: ["service"],
    allowedToolActions: ["check_availability"],
    fallbackBehavior: "Pedir día u hora preferida si falta contexto.",
    handoffConditions: ["agenda no disponible"],
    successCriteria: ["opciones entregadas", "paciente elige slot"],
  },
  {
    id: "pricing",
    description: "Respuestas de precio fijo, desde o variable con evaluación.",
    triggerIntents: ["price_question"],
    requiredFields: ["service_or_evaluation"],
    allowedToolActions: ["read_pricing"],
    fallbackBehavior: "Responder con evaluación como siguiente paso.",
    handoffConditions: ["cotización compleja"],
    successCriteria: ["precio o criterio explicado", "CTA de evaluación"],
  },
  {
    id: "appointment_lookup",
    description: "Búsqueda y confirmación de citas activas.",
    triggerIntents: ["appointment_lookup"],
    requiredFields: ["lead_id"],
    allowedToolActions: ["lookup_appointments"],
    fallbackBehavior: "Informar estado y ofrecer siguiente acción.",
    handoffConditions: ["inconsistencia de datos"],
    successCriteria: ["detalle de cita compartido"],
  },
  {
    id: "cancellation",
    description: "Flujo de cancelación de cita con confirmación explícita.",
    triggerIntents: ["cancel_appointment"],
    requiredFields: ["appointment_id", "confirmation"],
    allowedToolActions: ["lookup_appointments", "cancel_appointment"],
    fallbackBehavior: "Pedir confirmación de cancelación.",
    handoffConditions: ["múltiples citas ambiguas"],
    successCriteria: ["cita cancelada", "mensaje de cierre enviado"],
  },
  {
    id: "reschedule",
    description: "Flujo de cambio de fecha/hora de cita.",
    triggerIntents: ["reschedule_appointment"],
    requiredFields: ["appointment_id", "new_date", "new_time"],
    allowedToolActions: ["lookup_appointments", "check_availability", "reschedule_appointment"],
    fallbackBehavior: "Solicitar nueva preferencia de horario.",
    handoffConditions: ["no hay horarios alternos"],
    successCriteria: ["cita reagendada", "confirmación enviada"],
  },
  {
    id: "emergency",
    description: "Triage inicial y escalación de urgencia dental.",
    triggerIntents: ["emergency", "pain_priority"],
    requiredFields: ["symptoms"],
    allowedToolActions: ["priority_alert", "check_priority_availability"],
    fallbackBehavior: "Priorizar atención inmediata.",
    handoffConditions: ["signos de riesgo", "solicitud explícita de humano"],
    successCriteria: ["caso priorizado", "instrucción segura compartida"],
  },
  {
    id: "objection_handling",
    description: "Manejo de dudas y objeciones en el proceso comercial.",
    triggerIntents: ["objection", "hesitation"],
    requiredFields: ["objection_text"],
    allowedToolActions: ["none"],
    fallbackBehavior: "Responder breve y ofrecer siguiente paso.",
    handoffConditions: ["insatisfacción persistente"],
    successCriteria: ["objeción resuelta", "intención desbloqueada"],
  },
  {
    id: "no_response_followup",
    description: "Seguimiento cuando el paciente deja conversación abierta.",
    triggerIntents: ["followup_pending"],
    requiredFields: ["last_open_context"],
    allowedToolActions: ["send_followup"],
    fallbackBehavior: "Mensaje breve sin presión.",
    handoffConditions: ["solicita baja de mensajes"],
    successCriteria: ["reanudación de conversación"],
  },
  {
    id: "reminder",
    description: "Recordatorios previos a cita.",
    triggerIntents: ["reminder"],
    requiredFields: ["appointment_id", "starts_at"],
    allowedToolActions: ["send_reminder"],
    fallbackBehavior: "Reintentar en ventana permitida.",
    handoffConditions: ["contacto inválido"],
    successCriteria: ["recordatorio entregado"],
  },
  {
    id: "human_handoff",
    description: "Transferencia a personal clínico o recepción humana.",
    triggerIntents: ["human_handoff", "manual_control"],
    requiredFields: ["lead_id", "reason"],
    allowedToolActions: ["notify_staff"],
    fallbackBehavior: "Confirmar transferencia y tiempo estimado.",
    handoffConditions: ["siempre"],
    successCriteria: ["staff notificado", "paciente informado"],
  },
];
