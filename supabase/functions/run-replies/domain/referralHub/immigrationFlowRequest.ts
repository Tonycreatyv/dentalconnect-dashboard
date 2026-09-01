type Json = Record<string, unknown>;

type SupabaseRpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export type ImmigrationFlowCompletion = {
  topic: string;
  postal_code: string | null;
  description: string;
  completed_at: string;
  sharing_consent?: string;
  consent_version?: string | null;
  consent_source?: string | null;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function captureImmigrationFlowRequest(args: {
  supabase: SupabaseRpc;
  organizationId: string;
  leadId: string;
  channelUserId: string;
  deliveryKey: string;
  completion: ImmigrationFlowCompletion;
}): Promise<{ requestId: string; created: boolean }> {
  const intake: Json = {
    source: "whatsapp_flow",
    flow_type: "luis_unified_services",
    flow_version: "v1",
    intake_type: "IMMIGRATION",
    topic: args.completion.topic,
    postal_code: args.completion.postal_code,
    description: args.completion.description,
    completed_at: args.completion.completed_at,
    sharing_consent: ["AUTHORIZED", "DECLINED"].includes(args.completion.sharing_consent ?? "") ? args.completion.sharing_consent : "PENDING",
    consent_version: args.completion.consent_version ?? null,
    consent_source: args.completion.consent_source ?? null,
  };
  const result = await args.supabase.rpc("capture_immigration_flow_request", {
    p_organization_id: args.organizationId,
    p_lead_id: args.leadId,
    p_channel_user_id: args.channelUserId,
    // One canonical active Immigration request per lead. This is intentionally
    // stable across Meta retries and later customer resubmissions.
    p_completion_key: "luis_unified_services:immigration:v1",
    p_delivery_key: args.deliveryKey,
    p_completed_at: args.completion.completed_at,
    p_intake: intake,
  });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (result.error || !row || typeof row !== "object") {
    throw new Error("immigration_flow_request_capture_failed");
  }
  const data = row as Record<string, unknown>;
  const requestId = stringValue(data.request_id);
  if (data.success !== true || !requestId || data.assigned !== false || data.notification_created !== false) {
    throw new Error("immigration_flow_request_capture_invalid_response");
  }
  // Assignment is deliberately server-side and follows only an explicit
  // authorization. DECLINED and legacy/pending payloads remain internal.
  if (args.completion.sharing_consent === "AUTHORIZED") {
    const assignment = await args.supabase.rpc("auto_assign_immigration_partner", {
      p_request_id: requestId,
      p_idempotency_key: `immigration-partner:${args.deliveryKey}`,
    });
    if (assignment.error) throw new Error("immigration_partner_assignment_failed");
  }
  return { requestId, created: data.created === true };
}
