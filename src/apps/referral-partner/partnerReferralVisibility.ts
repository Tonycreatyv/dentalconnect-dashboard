import { resolveReferralService, type ReferralService } from "./referralPresentation";

export function resolvePartnerReferralService(serviceId: string | null | undefined, intake: Record<string, unknown>): ReferralService | null {
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
  // A shared production luis_accidente ID is deliberately resolved from the
  // legal intake discriminator before its service ID. Canonical future IDs
  // then fall back to the same centralized aliases.
  const discriminator = text(intake.intake_type) ?? text(intake.topic) ?? text(intake.service);
  return resolveReferralService(discriminator, intake) ?? resolveReferralService(serviceId, intake);
}

export function assignedReferralCanRender(row: { id?: string | null; referral_service_requests?: unknown | null }): boolean {
  return Boolean(row.id && row.referral_service_requests);
}
