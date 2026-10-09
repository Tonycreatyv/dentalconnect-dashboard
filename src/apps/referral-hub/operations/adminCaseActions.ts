import { supabase } from "../../../lib/supabaseClient";

function operationId(): string {
  return crypto.randomUUID();
}

export async function assignAdminCase(input: {
  organizationId: string;
  requestId: string;
  partnerId: string;
  hasActiveAssignment: boolean;
}) {
  if (input.hasActiveAssignment) {
    return supabase.rpc("admin_reassign_referral_request", {
      p_request_id: input.requestId,
      p_partner_id: input.partnerId,
      p_reason: "admin_responsible_change",
      p_operation_id: operationId(),
    });
  }
  return supabase.rpc("assign_referral_request", {
    p_organization_id: input.organizationId,
    p_request_id: input.requestId,
    p_idempotency_key: "admin-assign:" + input.requestId + ":" + operationId(),
    p_mode: "manual",
    p_partner_id: input.partnerId,
  });
}

export async function updateAdminCase(input: {
  requestId: string;
  action: "contacted" | "appointment_scheduled" | "converted" | "closed_not_converted" | "follow_up" | "note";
  note?: string | null;
  followUpReason?: "no_answer" | "missing_police_report" | "missing_document" | "missing_information" | "other" | null;
  nextFollowupAt?: string | null;
}) {
  return supabase.rpc("admin_update_referral_assignment", {
    p_request_id: input.requestId,
    p_action: input.action,
    p_note: input.note ?? null,
    p_follow_up_reason: input.followUpReason ?? null,
    p_next_followup_at: input.nextFollowupAt ?? null,
    p_operation_id: operationId(),
  });
}
