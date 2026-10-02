type Json = Record<string, unknown>;

type SupabaseRpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export const DUI_CRIMINAL_SERVICE_ID = "luis_dui_criminal";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function captureDuiCriminalFlowRequest(args: {
  supabase: SupabaseRpc;
  organizationId: string;
  leadId: string;
  channelUserId: string;
  deliveryKey: string;
  completedAt: string;
  sharingConsent: "AUTHORIZED" | "DECLINED";
  consentVersion: "luis_dui_criminal_sharing_v1";
  consentSource: "whatsapp_flow";
  fields: Json;
}): Promise<{ requestId: string; created: boolean }> {
  const result = await args.supabase.rpc("capture_dui_criminal_flow_request", {
    p_organization_id: args.organizationId,
    p_lead_id: args.leadId,
    p_channel_user_id: args.channelUserId,
    p_intake_type: "DUI_CRIMINAL",
    p_completion_key: `luis_unified_services:dui_criminal:${args.deliveryKey}:v2`,
    p_delivery_key: args.deliveryKey,
    p_completed_at: args.completedAt,
    p_intake: {
      ...args.fields,
      source: "whatsapp_flow",
      flow_type: "luis_unified_services",
      flow_version: "v1",
      intake_type: "DUI_CRIMINAL",
      service: "dui_criminal",
      completed_at: args.completedAt,
      sharing_consent: args.sharingConsent,
      consent_version: args.consentVersion,
      consent_source: args.consentSource,
    },
  });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (result.error || !row || typeof row !== "object") throw new Error("dui_criminal_flow_request_capture_failed");
  const data = row as Record<string, unknown>;
  const requestId = text(data.request_id);
  if (data.success !== true || !requestId || data.assigned !== false || data.notification_created !== false) {
    throw new Error("dui_criminal_flow_request_capture_invalid_response");
  }
  if (args.sharingConsent === "AUTHORIZED") {
    const assignment = await args.supabase.rpc("auto_assign_dui_criminal_partner", {
      p_request_id: requestId,
      p_idempotency_key: `dui-criminal-partner:${args.deliveryKey}`,
    });
    if (assignment.error) throw new Error("dui_criminal_partner_assignment_failed");
  }
  return { requestId, created: data.created === true };
}
