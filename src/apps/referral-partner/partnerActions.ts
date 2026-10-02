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

// Display-only — never used for wa.me/tel: links, which keep the raw digit
// string. resolvePartnerPhone's value is a raw WhatsApp identity like
// "17707784450" (E.164 without the +); this never renders that to the
// partner, only a readable "(770) 778-4450".
export function formatPhoneForDisplay(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : null;
  if (!local) return phone;
  return digits.length === 11 && digits.startsWith("1")
    ? `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
    : `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

// "pending" is a P0-era UI-only label kept for planPartnerActionSteps/
// resolveActionNote test coverage (see partnerActions.test.ts) — Phase 1B no
// longer renders it as a button (see PartnerDashboard.tsx STAGE_ACTIONS).
// appointment_scheduled/converted/closed_not_converted are the RPC's own
// existing contact-outcome actions (same migration), surfaced here as
// contextual "next step" actions once a case has been contacted — no new
// backend capability, purely exposing what the RPC already accepts.
export type PartnerAction =
  | "contacted"
  | "no_answer"
  | "pending"
  | "appointment_scheduled"
  | "converted"
  | "closed_not_converted";

const ACTIONS_REQUIRING_ACCEPTANCE: readonly PartnerAction[] = [
  "contacted",
  "no_answer",
  "appointment_scheduled",
  "converted",
  "closed_not_converted",
];

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
  appointment_scheduled: "appointment_scheduled",
  converted: "converted",
  closed_not_converted: "closed_not_converted",
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

// 'follow_up' isn't a PartnerAction (it carries a reason + reminder the
// other actions don't), so it gets its own step planner. Same accept-first
// rule as planPartnerActionSteps: the RPC's follow_up branch also requires
// status='accepted'.
export function planFollowUpSteps(assignmentStatus: string): string[] {
  return assignmentStatus === "assigned" ? ["accept", "follow_up"] : ["follow_up"];
}
