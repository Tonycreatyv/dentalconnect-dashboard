// Pure helpers for the Immigration Partner Dashboard action bar. Kept free of
// React/Supabase so the RPC sequencing and link-building logic can be unit
// tested without mocking network calls.

export function buildWhatsAppLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export function buildTelLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^0-9+]/g, "");
  return digits ? `tel:${digits}` : null;
}

// Immigration leads arrive over WhatsApp; leads.phone is often unset while
// leads.channel_user_id (the WhatsApp identity) always is. Same fallback
// order the rest of the app already uses (see src/referral/status.ts).
export function resolvePartnerPhone(phone: string | null | undefined, channelUserId: string | null | undefined): string | null {
  const value = (phone || channelUserId || "").trim();
  return value || null;
}

export type PartnerAction = "contacted" | "no_answer" | "pending";

const ACTIONS_REQUIRING_ACCEPTANCE: readonly PartnerAction[] = ["contacted", "no_answer"];

// partner_update_immigration_assignment (20260904000100_immigration_partner_dashboard.sql)
// has no dedicated "pending" work_status — contact-outcome actions are
// 'contacted' | 'no_answer' | 'appointment_scheduled' | 'converted' |
// 'closed_not_converted'. 'note' is the one existing action that records an
// event without asserting a contact outcome, so it is reused for "Pendiente"
// rather than inventing a new status value. This is a documented gap, not a
// silent one: a real "pending" work_status would need a migration (P1).
const RPC_ACTION_BY_PARTNER_ACTION: Record<PartnerAction, string> = {
  contacted: "contacted",
  no_answer: "no_answer",
  pending: "note",
};

export const PENDING_NOTE_TEXT = "Marcado como pendiente por el aliado";

// contacted/no_answer/appointment_scheduled/converted/closed_not_converted
// all require the assignment to already be 'accepted'; 'note' does not. The
// P0 UI has no separate "Aceptar" button, so when the assignment is still
// 'assigned' this plan silently runs 'accept' first, using only existing RPC
// actions — no new semantics, no bypassed precondition.
export function planPartnerActionSteps(action: PartnerAction, assignmentStatus: string): string[] {
  const steps: string[] = [];
  if (ACTIONS_REQUIRING_ACCEPTANCE.includes(action) && assignmentStatus === "assigned") {
    steps.push("accept");
  }
  steps.push(RPC_ACTION_BY_PARTNER_ACTION[action]);
  return steps;
}

// The partner's free-text note (if any) is always attached to the final RPC
// step so it lands in the operational_events audit trail. "Pendiente" falls
// back to a fixed label when the partner leaves the note blank, since that
// action otherwise carries no signal of what happened.
export function resolveActionNote(action: PartnerAction, partnerNote: string | null | undefined): string | null {
  const trimmed = (partnerNote ?? "").trim();
  if (trimmed) return trimmed;
  return action === "pending" ? PENDING_NOTE_TEXT : null;
}
