// Pure lead-stage logic, deliberately dependency-free (no supabase client,
// no other module that reaches import.meta.env) so it can be type-checked
// and unit-tested directly under Deno, the same pattern legalIntake.ts
// uses — see useLeadsPipeline.ts, its only real caller.

export type LeadStage = "nuevo" | "por_contactar" | "contactado" | "respondio" | "confirmado" | "cerrado";

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  nuevo: "Nuevo",
  por_contactar: "Por contactar",
  contactado: "Contactado",
  respondio: "Respondió",
  confirmado: "Confirmado",
  cerrado: "Cerrado",
};

const CLOSED_WORK_STATUSES = new Set(["converted", "not_converted", "closed"]);
// "appointment_scheduled" is its own, more specific stage ("Confirmado") —
// it means a concrete appointment exists, not merely that staff reached
// out. "contacted"/"in_progress" stay the generic "Contactado" bucket.
const CONTACTED_WORK_STATUSES = new Set(["contacted", "in_progress"]);
const CONFIRMED_WORK_STATUSES = new Set(["appointment_scheduled"]);

// "Respondió" requires a REAL staff/business outreach event (a manual message with actor='staff')
// followed by an inbound reply — not merely any historical inbound message to the bot.
//
// Every check below is independent and falls through in order of how much
// REAL progress it represents, rather than requestStatus gating everything
// else behind an early return. That distinction matters for a real
// production case (lead 867dace6): it has a completed AUTO_ACCIDENT Flow
// intake AND an unrelated legacy referral_service_requests row for a
// different service ("luis_representante", status "prequalified") with no
// assignment yet. An early "if (requestStatus) {...return 'nuevo'}" branch
// would let that unrelated, unprogressed legacy row silently suppress the
// legal intake's "por_contactar" promotion — exactly the kind of stale
// cross-signal mixing Part 2 item 5 warns against, just showing up in
// stage derivation instead of the client-detail UI.
export function deriveStage(args: {
  lastUserReplyAt: string | null;
  staffOutreachAt: string | null;
  requestStatus: string | null;
  workStatus: string | null;
  hasCompletedLegalIntake: boolean;
}): LeadStage {
  const { lastUserReplyAt, staffOutreachAt, requestStatus, workStatus, hasCompletedLegalIntake } = args;
  if (requestStatus === "closed" || (workStatus && CLOSED_WORK_STATUSES.has(workStatus))) return "cerrado";
  if (workStatus && CONFIRMED_WORK_STATUSES.has(workStatus)) return "confirmado";
  if (workStatus && CONTACTED_WORK_STATUSES.has(workStatus)) return "contactado";
  if (staffOutreachAt && lastUserReplyAt && new Date(lastUserReplyAt) > new Date(staffOutreachAt)) return "respondio";
  if (staffOutreachAt) return "contactado";
  // A newly completed immigration/accident/DUI/criminal-defense intake from
  // the real WhatsApp Flow (no real assignment/outreach progress yet on
  // either signal) must surface as actionable work, not disappear into the
  // generic "Nuevo" bucket alongside leads nobody has followed up with for
  // any reason.
  if (hasCompletedLegalIntake || requestStatus === "qualified") return "por_contactar";
  return "nuevo";
}
