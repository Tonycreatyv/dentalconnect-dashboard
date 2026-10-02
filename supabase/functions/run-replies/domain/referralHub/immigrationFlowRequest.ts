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
  // Micro-intake V1 structured fields — present only for their matching
  // topic, absent (undefined) for every other topic and for any completion
  // from before this field set existed. All optional/additive: never
  // required, never renamed, never removed.
  resident_duration?: string | null;
  long_absence?: string | null;
  citizenship_marriage_basis?: string | null;
  petitioner_relationship?: string | null;
  entry_method?: string | null;
  prior_uscis_petition?: string | null;
  green_card_term?: string | null;
  green_card_issue?: string | null;
  prior_related_filing?: string | null;
  arrival_window?: string | null;
  fear_reason?: string | null;
  immigration_court_status?: string | null;
  crime_victim?: string | null;
  police_report?: string | null;
  law_enforcement_cooperation?: string | null;
  work_permit_request_type?: string | null;
  work_permit_basis?: string | null;
  work_permit_status?: string | null;
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
    // Micro-intake V1 structured fields — additive, always written (as null
    // when absent) so every intake row has a consistent key set regardless
    // of topic or Flow version.
    resident_duration: args.completion.resident_duration ?? null,
    long_absence: args.completion.long_absence ?? null,
    citizenship_marriage_basis: args.completion.citizenship_marriage_basis ?? null,
    petitioner_relationship: args.completion.petitioner_relationship ?? null,
    entry_method: args.completion.entry_method ?? null,
    prior_uscis_petition: args.completion.prior_uscis_petition ?? null,
    green_card_term: args.completion.green_card_term ?? null,
    green_card_issue: args.completion.green_card_issue ?? null,
    prior_related_filing: args.completion.prior_related_filing ?? null,
    arrival_window: args.completion.arrival_window ?? null,
    fear_reason: args.completion.fear_reason ?? null,
    immigration_court_status: args.completion.immigration_court_status ?? null,
    crime_victim: args.completion.crime_victim ?? null,
    police_report: args.completion.police_report ?? null,
    law_enforcement_cooperation: args.completion.law_enforcement_cooperation ?? null,
    work_permit_request_type: args.completion.work_permit_request_type ?? null,
    work_permit_basis: args.completion.work_permit_basis ?? null,
    work_permit_status: args.completion.work_permit_status ?? null,
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
