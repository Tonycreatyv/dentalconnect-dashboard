import {
  bookAppointmentTool,
  cancelAppointmentTool,
  checkAvailabilityTool,
  lookupActiveAppointmentTool,
  rescheduleAppointmentTool,
} from "./appointmentTools.ts";
import {
  getBusinessHoursTool,
  getLocationTool,
  getServicePriceTool,
  listServicesTool,
} from "./clinicTools.ts";
import {
  createFollowupTool,
  recordPatientPreferenceTool,
  requestHumanTakeoverTool,
} from "./patientTools.ts";
import type { ToolContext, ToolHandler, ToolName, ToolResult } from "./toolTypes.ts";

const REGISTRY: Partial<Record<ToolName, ToolHandler>> = {
  check_availability: checkAvailabilityTool,
  book_appointment: bookAppointmentTool,
  lookup_active_appointment: lookupActiveAppointmentTool,
  reschedule_appointment: rescheduleAppointmentTool,
  cancel_appointment: cancelAppointmentTool,
  list_services: listServicesTool,
  get_service_price: getServicePriceTool,
  get_business_hours: getBusinessHoursTool,
  get_location: getLocationTool,
  record_patient_preference: recordPatientPreferenceTool,
  create_followup: createFollowupTool,
  request_human_takeover: requestHumanTakeoverTool,
};

export async function executeTool(
  tool: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const handler = REGISTRY[tool as ToolName];
  if (!handler) {
    return {
      ok: false,
      tool: "request_human_takeover",
      error: {
        code: "unknown_tool",
        message: `Tool not found: ${tool}`,
        retryable: false,
      },
      userSafeMessage: "Voy a pasar esto con recepción para ayudarte mejor.",
    };
  }
  return await handler(input, context);
}
