import { realNegociosDataSource } from "./realDataSource";
import type { NegociosDataSource } from "./types";

// The operational /negocios view reads real production data by default —
// referral_coupon_campaigns, referral_benefit_campaign_locations (the 3
// real active supermarket locations), and the hardcoded merchant catalog
// that the live WhatsApp send path itself uses. See realDataSource.ts for
// exactly which tables and why. capabilities.canEditBusiness/canEditCoupon
// are honestly false (referral_coupon_campaigns/referral_partners have no
// write RLS today) — edits land in a session-only in-memory overlay so the
// editing UI is real and demonstrable, never claiming server persistence
// that doesn't exist. The in-memory demo/local-prototype adapter
// (demoDataSource.ts) still exists for local UI iteration before the
// canonical-fields migration lands, but is no longer the default and is
// never mixed into this one.
export function getActiveNegociosDataSource(): NegociosDataSource {
  return realNegociosDataSource;
}
