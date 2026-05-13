export type ToolName =
  | "check_availability"
  | "book_appointment"
  | "lookup_active_appointment"
  | "reschedule_appointment"
  | "cancel_appointment"
  | "list_services"
  | "get_service_price"
  | "get_business_hours"
  | "get_location"
  | "record_patient_preference"
  | "create_followup"
  | "request_human_takeover";

export type ToolResult = {
  ok: boolean;
  tool: ToolName;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  userSafeMessage?: string;
};

export type ToolContext = {
  organizationId?: string;
  leadId?: string;
};

export type ToolHandler = (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
