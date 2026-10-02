// Mirrors immigrationFlowRequest.ts exactly, generalized for the three
// legal micro-intake types (AUTO_ACCIDENT/DUI/CRIMINAL), mapped to their
// canonical service IDs by capture_legal_flow_request/
// auto_assign_legal_partner (20260905000100_luis_micro_intake_legal_services.sql).
// Immigration's own capture/assign RPCs and this module are never mixed —
// captureImmigrationFlowRequest is untouched, this is an additive sibling.
type Json = Record<string, unknown>;

type SupabaseRpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export type LegalIntakeType = "AUTO_ACCIDENT" | "DUI" | "CRIMINAL";

// A display discriminator remains in intake for presentation compatibility;
// the server derives case identity from intake_type, never this field.
const SERVICE_BY_INTAKE_TYPE: Record<LegalIntakeType, string> = {
  AUTO_ACCIDENT: "auto_accident",
  DUI: "dui",
  CRIMINAL: "criminal",
};

export const LEGAL_SERVICE_ID_BY_INTAKE_TYPE: Record<LegalIntakeType, string> = {
  AUTO_ACCIDENT: "luis_accidente",
  DUI: "luis_dui",
  CRIMINAL: "luis_criminal",
};

// One canonical completion_key per intake_type — deliberately distinct
// per type (not a single shared "legal" key) so capture_legal_flow_request's
// case_cycle bookkeeping stays coherent per type even though all three
// share one service_id and therefore, per referral_requests_one_active_service,
// can have at most one ACTIVE request among the three at any time (a second,
// different-type completion takes over that same row — see the migration's
// own comment for why this is an accepted, reported V1 limitation).
function completionKeyFor(intakeType: LegalIntakeType): string {
  return `luis_unified_services:legal:${intakeType.toLowerCase()}:v1`;
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
  intakeType: LegalIntakeType;
  completedAt: string;
  sharingConsent?: string;
  consentVersion?: string | null;
  consentSource?: string | null;
  // Every other completion field (topic-specific structured answers,
  // full_name, postal_code, description, accident/dui/criminal fields) —
  // passed through verbatim into intake jsonb, additive only.
  fields: Json;
}): Promise<{ requestId: string; created: boolean }> {
  const intake: Json = {
    ...args.fields,
    source: "whatsapp_flow",
    flow_type: "luis_unified_services",
    flow_version: "v1",
    intake_type: args.intakeType,
    service: SERVICE_BY_INTAKE_TYPE[args.intakeType],
    completed_at: args.completedAt,
    sharing_consent: ["AUTHORIZED", "DECLINED"].includes(args.sharingConsent ?? "") ? args.sharingConsent : "PENDING",
    consent_version: args.consentVersion ?? null,
    consent_source: args.consentSource ?? null,
  };
  const result = await args.supabase.rpc("capture_legal_flow_request", {
    p_organization_id: args.organizationId,
    p_lead_id: args.leadId,
    p_channel_user_id: args.channelUserId,
    p_intake_type: args.intakeType,
    p_completion_key: completionKeyFor(args.intakeType),
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
  // Same rule as immigration: assignment is server-side and follows only an
  // explicit AUTHORIZED consent. DECLINED and PENDING never assign.
  if (args.sharingConsent === "AUTHORIZED") {
    const assignment = await args.supabase.rpc("auto_assign_legal_partner", {
      p_request_id: requestId,
      p_idempotency_key: `legal-partner:${args.deliveryKey}`,
    });
    if (assignment.error) throw new Error("legal_partner_assignment_failed");
  }
  return { requestId, created: data.created === true };
}
