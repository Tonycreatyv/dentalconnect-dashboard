import { buildIntakeSummary, referralServiceLabel, resolveReferralService, resolveSummaryTopicKey, resolveTopicDisplay, type ReferralService } from "../../referral-partner/referralPresentation";

export type OpportunityServiceFilter = "all" | ReferralService;

export function resolveOpportunityService(serviceId: string, intake: Record<string, unknown>): ReferralService | null {
  if (serviceId === "luis_inmigracion") return "immigration";
  // Production's shared luis_accidente rows must use intake_type first;
  // future canonical IDs are handled by referralPresentation aliases.
  if (serviceId === "luis_accidente") return resolveReferralService(intake.intake_type ?? intake.service, intake);
  return resolveReferralService(serviceId, intake);
}

export function legalOpportunityPresentation(serviceId: string, intake: Record<string, unknown>, topic: string | null) {
  const service = resolveOpportunityService(serviceId, intake);
  const summaryKey = resolveSummaryTopicKey(intake) ?? topic;
  return {
    service,
    serviceLabel: referralServiceLabel(service),
    topic: resolveTopicDisplay(topic ?? summaryKey, service),
    summary: buildIntakeSummary(intake, summaryKey),
    description: typeof intake.description === "string" && intake.description.trim() ? intake.description.trim() : null,
  };
}

export function matchesOpportunityServiceFilter(serviceId: string, intake: Record<string, unknown>, filter: OpportunityServiceFilter): boolean {
  return filter === "all" || resolveOpportunityService(serviceId, intake) === filter;
}
