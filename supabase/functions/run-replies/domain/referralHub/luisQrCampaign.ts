import {
  qrLeadAttribution,
  type ResolvedReferralQrEntry,
} from "../../../_products/referral-hub/qrEntries.ts";
import type { LuisConversationRoute } from "../../../_products/referral-hub/luisBenefits.ts";

type Json = Record<string, unknown>;

const LUIS_BENEFIT_SERVICE_IDS = new Set([
  "luis_benefit_medical",
  "luis_benefit_supermarket",
  "luis_benefit_dental",
  "luis_benefit_shipping",
]);

/**
 * Maps a resolved QR entry to a deterministic Luis Unified Flow route.
 *
 * There is no verified-safe way to open the Unified Flow directly at a
 * non-entry screen (BENEFIT_SELECT/IMMIGRATION_TOPIC/ACCIDENT_BASICS/
 * CRIMINAL_TOPIC — see routeLuisConversation), so a benefit campaign opens
 * the standalone Benefits Flow at its own entry screen (BENEFIT_SELECT,
 * a one-tap picker of the 4 benefits) instead of the full Unified menu.
 * A general entry opens the full Unified Services Flow. Any other QR entry
 * type/service (not one of the 4 known luis_benefit_* services) returns
 * null so the caller falls through to normal conversation routing.
 */
export function mapQrEntryToLuisRoute(
  entry: ResolvedReferralQrEntry,
): LuisConversationRoute | null {
  // A QR scan is a deep-link entry, never a greeting word - keeps the
  // existing "explicit" reentry behavior, no change from before this field
  // existed.
  if (entry.entryType === "general") return { kind: "main_menu", trigger: "explicit" };
  if (entry.serviceId && LUIS_BENEFIT_SERVICE_IDS.has(entry.serviceId)) {
    return { kind: "benefits", directCampaignEntry: true };
  }
  return null;
}

type OperationalEventsSupabase = {
  from(table: string): {
    insert(value: Json): PromiseLike<{ error: { message?: string } | null }>;
  };
};

/**
 * Records a campaign entry / QR visit. Uses referral_operational_events —
 * confirmed live in production with authenticated owner/admin SELECT access
 * for the dashboard — NOT lead_events, which exists only in local
 * migrations that were never applied to production.
 */
export async function recordLuisQrVisit(args: {
  supabase?: OperationalEventsSupabase;
  organizationId: string;
  leadId?: string;
  entry: ResolvedReferralQrEntry;
}): Promise<void> {
  const leadId = (args.leadId ?? "").trim();
  if (!args.supabase?.from || !leadId) return;
  try {
    const result = await args.supabase.from("referral_operational_events").insert({
      organization_id: args.organizationId,
      aggregate_type: "lead",
      aggregate_id: leadId,
      event_type: "referral_qr_entry_resolved",
      actor_type: "user",
      source: "whatsapp_qr_scan",
      metadata: qrLeadAttribution(args.entry),
    });
    if (result.error) {
      console.warn("[Luis QR campaign] visit event insert failed", {
        reason: result.error.message,
      });
    }
  } catch (error) {
    console.warn("[Luis QR campaign] visit event insert threw", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Merges QR attribution onto a GenerateReplyResult's leadPatch, mirroring
 * genericMenuRouter's withQrAttribution but for the Luis Unified Flow's
 * GenerateReplyResult shape. Always overwrites with THIS turn's entry so a
 * later scan of a different campaign never keeps stale prior attribution.
 */
// Constrained by the real, always-present GenerateReplyResult fields
// (reply/statePatch), not leadPatch alone: TypeScript can only infer T as
// the caller's full literal type when the literal has SOME property that
// overlaps the constraint. Every real result has reply+statePatch, but
// leadPatch is optional and often absent - a constraint of only
// `{ leadPatch?: Json }` gives TS no anchor to infer from when a literal
// omits leadPatch, and it silently falls back to inferring T as the bare
// constraint itself, causing excess-property errors on every OTHER field
// (reply, statePatch, debugNote, ...) at every such call site. Not
// importing GenerateReplyResult itself from index.ts: that would create a
// circular import (index.ts -> this file -> index.ts).
// Return type is `T & { leadPatch: Json }`, not just `T`: the function
// body always sets leadPatch on its output regardless of whether the
// input had one, so the signature must promise that too - declaring `T`
// alone was a second, related bug (a caller reading .leadPatch off a
// result whose input had no leadPatch would fail to type-check, even
// though it is always safely populated by the time this function returns).
export function withLuisQrAttribution<
  T extends { reply: string; statePatch: Json; leadPatch?: Json },
>(result: T, entry: ResolvedReferralQrEntry): T & { leadPatch: Json } {
  const leadPatch = result.leadPatch && typeof result.leadPatch === "object"
    ? result.leadPatch
    : {};
  const extractedData =
    leadPatch.extracted_data && typeof leadPatch.extracted_data === "object"
      ? leadPatch.extracted_data as Json
      : {};
  return {
    ...result,
    leadPatch: {
      ...leadPatch,
      extracted_data: { ...extractedData, qr_entry: qrLeadAttribution(entry) },
      ...(entry.campaignKey ? { source_campaign: entry.campaignKey } : {}),
    },
  };
}
