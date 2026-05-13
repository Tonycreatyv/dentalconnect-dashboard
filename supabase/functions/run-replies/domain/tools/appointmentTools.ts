import type { ToolContext, ToolHandler, ToolResult } from "./toolTypes.ts";

function fail(tool: ToolResult["tool"], message: string, code = "validation_error"): ToolResult {
  return {
    ok: false,
    tool,
    error: { code, message, retryable: false },
    userSafeMessage: message,
  };
}

export const checkAvailabilityTool: ToolHandler = async (input) => {
  const service = String(input.service ?? "").trim();
  if (!service) return fail("check_availability", "Necesito saber qué servicio querés revisar.");
  return { ok: true, tool: "check_availability", data: { slots: input.slots ?? [] } };
};

export const bookAppointmentTool: ToolHandler = async (input, _context: ToolContext) => {
  const service = String(input.service ?? "").trim();
  const date = String(input.appointment_date ?? "").trim();
  const time = String(input.appointment_time ?? "").trim();
  const patientName = String(input.patient_name ?? "").trim();
  if (!service || !date || !time || !patientName) {
    return fail("book_appointment", "Faltan datos para agendar: servicio, fecha, hora o nombre del paciente.");
  }
  return {
    ok: false,
    tool: "book_appointment",
    error: {
      code: "not_executed_in_registry",
      message: "Tool registry does not execute DB writes directly.",
      retryable: false,
    },
    userSafeMessage: "Necesito ejecutar el flujo de agenda para confirmar la cita.",
  };
};

export const lookupActiveAppointmentTool: ToolHandler = async () => ({
  ok: true,
  tool: "lookup_active_appointment",
  data: {},
});

export const rescheduleAppointmentTool: ToolHandler = async (input) => {
  if (!String(input.appointment_id ?? "").trim()) {
    return fail("reschedule_appointment", "Necesito identificar la cita para reagendarla.");
  }
  return { ok: true, tool: "reschedule_appointment", data: input };
};

export const cancelAppointmentTool: ToolHandler = async (input) => {
  if (!String(input.appointment_id ?? "").trim() || input.confirmed !== true) {
    return fail("cancel_appointment", "Para cancelar necesito confirmar qué cita querés cancelar.");
  }
  return { ok: true, tool: "cancel_appointment", data: input };
};
