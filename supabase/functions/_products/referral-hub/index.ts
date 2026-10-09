/**
 * Referral Hub product boundary.
 *
 * Shared workers import this adapter instead of reaching into Referral Hub
 * domain modules directly. Business behavior remains unchanged while the
 * adapter is established and characterized.
 */
export {
  handleReferralHubTurn as handleReferralHubProductTurn,
  type ReferralHubTurnResult,
} from "../../run-replies/domain/referralHub/genericMenuRouter.ts";
