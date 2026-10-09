// Pure claim-shape types and filtering logic, split out of
// useCouponDemand.ts so it has zero dependency on supabaseClient/React —
// this is what lets it be unit-tested directly with Deno (supabaseClient.ts
// reads import.meta.env, which Deno's type checker cannot resolve) and
// what guarantees CouponRequestsScreen's drill-down and any business
// card's count computation can share the exact same filter, never two
// independently-reimplemented ones that could silently drift apart.
export const SIN_LOCALIDAD_KEY = "__sin_localidad__";

export type CouponClaimRow = {
  id: string;
  claim_code: string;
  status: "REQUESTED" | "ISSUED" | "REDEEMED";
  postal_code: string;
  requested_at: string;
  lead_id: string;
  lead_name: string;
  channel_user_id: string | null;
  campaign_key: string;
  campaign_label: string;
  location_key: string;
  location_label: string;
};

// An empty string means "no filter on that dimension", matching how URL
// search params behave when the param is absent.
export function filterCouponClaims(claims: CouponClaimRow[], locationKey: string, campaignKey: string): CouponClaimRow[] {
  return claims.filter((claim) => {
    if (campaignKey && claim.campaign_key !== campaignKey) return false;
    if (locationKey && claim.location_key !== locationKey) return false;
    return true;
  });
}
