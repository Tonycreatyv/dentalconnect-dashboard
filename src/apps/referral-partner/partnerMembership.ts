// Pure classification of the authenticated user's active partner
// memberships into an explicit Partner Portal context. Kept free of
// React/Supabase so it can be unit tested without mocking network calls —
// same pattern as partnerActions.ts.
//
// referral_partner_memberships has RLS policy
// referral_partner_memberships_self_read: (user_id = auth.uid() AND active),
// so a query against that table already returns only this user's own active
// rows — this module just decides what a Partner Portal session should do
// with however many rows come back.

export type ActivePartnerContext =
  | { kind: "none" }
  | { kind: "multiple" }
  | { kind: "single"; partnerId: string; role: string };

export function resolveActivePartnerContext(
  memberships: readonly { partner_id: string; role: string }[],
): ActivePartnerContext {
  if (memberships.length === 0) return { kind: "none" };
  if (memberships.length > 1) return { kind: "multiple" };
  const [membership] = memberships;
  return { kind: "single", partnerId: membership.partner_id, role: membership.role };
}
