// Mirrors immigrationFlowRequest.ts, scoped to AUTO_ACCIDENT only — the
// proven missing wiring for the 2026-09 P0 (real completions validated
// but never reached referral_service_requests/referral_assignments).
// DUI_CRIMINAL is deliberately left untouched: current production's
// LuisLegalFlowCompletion still has the combined DUI_CRIMINAL type (no
// sharing_consent, no canonical request), and capture_legal_flow_request
// only accepts p_intake_type in ('AUTO_ACCIDENT','DUI','CRIMINAL') anyway
// — a future 3-way DUI/CRIMINAL split is out of scope here, not this fix.
// captureImmigrationFlowRequest is untouched, this is an additive sibling.
type Json = Record<string, unknown>;

type SupabaseRpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export const LEGAL_ACCIDENT_SERVICE_ID = "luis_accidente";

function completionKey(deliveryKey: string): string {
  return `luis_unified_services:legal:auto_accident:${deliveryKey}:v2`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function captureLegalFlowRequest(args: {
  supabase: SupabaseRpc;
  organizationId: string;
  leadId: string;
  channelUserId: string;
  deliveryKey: string;
  completedAt: string;
  sharingConsent?: string;
  consentVersion?: string | null;
  consentSource?: string | null;
  // Every other completion field (accident_date, participant_role,
  // received_medical_attention, police_report, medical_provider,
  // full_name, description) — passed through verbatim into intake jsonb,
  // additive only.
  fields: Json;
}): Promise<{ requestId: string; created: boolean }> {
  const intake: Json = {
    ...args.fields,
    source: "whatsapp_flow",
    flow_type: "luis_unified_services",
    flow_version: "v1",
    intake_type: "AUTO_ACCIDENT",
    service: "auto_accident",
    completed_at: args.completedAt,
    sharing_consent: ["AUTHORIZED", "DECLINED"].includes(args.sharingConsent ?? "") ? args.sharingConsent : "PENDING",
    consent_version: args.consentVersion ?? null,
    consent_source: args.consentSource ?? null,
  };
  const result = await args.supabase.rpc("capture_legal_flow_request", {
    p_organization_id: args.organizationId,
    p_lead_id: args.leadId,
    p_channel_user_id: args.channelUserId,
    p_intake_type: "AUTO_ACCIDENT",
    p_completion_key: completionKey(args.deliveryKey),
    p_delivery_key: args.deliveryKey,
    p_completed_at: args.completedAt,
    p_intake: intake,
  });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (result.error || !row || typeof row !== "object") {
    throw new Error("legal_flow_request_capture_failed");
  }
  const data = row as Record<string, unknown>;
  const requestId = stringValue(data.request_id);
  if (data.success !== true || !requestId || data.assigned !== false || data.notification_created !== false) {
    throw new Error("legal_flow_request_capture_invalid_response");
  }
  // Same rule as immigration: assignment is server-side and follows only
  // an explicit AUTHORIZED consent. DECLINED and PENDING never assign —
  // capture_legal_flow_request/auto_assign_legal_partner never touch
  // leads.handoff_to_human either way.
  if (args.sharingConsent === "AUTHORIZED") {
    const assignment = await args.supabase.rpc("auto_assign_legal_partner", {
      p_request_id: requestId,
      p_idempotency_key: `legal-partner:${args.deliveryKey}`,
    });
    if (assignment.error) throw new Error("legal_partner_assignment_failed");
  }
  return { requestId, created: data.created === true };
}
