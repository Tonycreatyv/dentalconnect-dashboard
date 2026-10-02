type Json = Record<string, unknown>;

type SupabaseRpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

function value(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

export async function captureFurnitureFlowRequest(args: {
  supabase: SupabaseRpc;
  organizationId: string;
  leadId: string;
  channelUserId: string;
  deliveryKey: string;
  completedAt: string;
  fullName: string;
  postalCode: string;
}): Promise<{ requestId: string; created: boolean }> {
  const intake: Json = {
    source: "whatsapp_flow",
    flow_type: "luis_unified_services",
    flow_version: "v1",
    service_key: "FURNITURE",
    full_name: args.fullName,
    postal_code: args.postalCode,
    completed_at: args.completedAt,
  };
  const result = await args.supabase.rpc("capture_furniture_flow_request", {
    p_organization_id: args.organizationId,
    p_lead_id: args.leadId,
    p_channel_user_id: args.channelUserId,
    p_completion_key: "luis_unified_services:furniture:v1",
    p_delivery_key: args.deliveryKey,
    p_completed_at: args.completedAt,
    p_intake: intake,
  });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (result.error || !row || typeof row !== "object") throw new Error("furniture_flow_request_capture_failed");
  const data = row as Record<string, unknown>;
  const requestId = value(data.request_id);
  if (data.success !== true || !requestId || data.assigned !== false || data.notification_created !== false) {
    throw new Error("furniture_flow_request_capture_invalid_response");
  }
  return { requestId, created: data.created === true };
}
