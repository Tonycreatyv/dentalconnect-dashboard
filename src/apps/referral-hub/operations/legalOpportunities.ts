import { buildIntakeSummary, referralServiceLabel, resolveReferralService, resolveSummaryTopicKey, resolveTopicDisplay, type ReferralService } from "../../referral-partner/referralPresentation";

export type OpportunityServiceFilter = "all" | ReferralService | "furniture" | "representative";

export function resolveOpportunityService(serviceId: string, intake: Record<string, unknown>): ReferralService | null {
  if (serviceId === "luis_inmigracion") return "immigration";
  // Production's shared luis_accidente rows must use intake_type first;
  // future canonical IDs are handled by referralPresentation aliases.
  if (serviceId === "luis_accidente") return resolveReferralService(intake.intake_type ?? intake.service, intake);
  return resolveReferralService(serviceId, intake);
}

export function legalOpportunityPresentation(serviceId: string, intake: Record<string, unknown>, topic: string | null) {
  if (serviceId === "luis_muebles") {
    return { service: null, serviceLabel: "Muebles", topic: null, summary: null, description: null };
  }
  if (serviceId === "luis_representante") {
    return { service: null, serviceLabel: "Hablar con nuestro equipo", topic: null, summary: null, description: null };
  }
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
  if (filter === "all") return true;
  if (filter === "furniture") return serviceId === "luis_muebles";
  if (filter === "representative") return serviceId === "luis_representante";
  return resolveOpportunityService(serviceId, intake) === filter;
}
