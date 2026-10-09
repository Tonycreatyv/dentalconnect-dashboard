export const REFERRAL_HUB_ORG_ID = "luis-gabriel-referral-hub";
export const REFERRAL_HUB_ORG_NAME = "Luis Gabriel Referral Hub";

export const REFERRAL_HUB_LEGACY_ORG_ID = "insurance-demo";
export const REFERRAL_HUB_LEGACY_ORG_NAME = "Seguros Demo · Referral Hub legacy";

export function isReferralHubOrganization(organizationId: string | null | undefined): boolean {
  return organizationId === REFERRAL_HUB_ORG_ID || organizationId === REFERRAL_HUB_LEGACY_ORG_ID;
}

export function isLegacyReferralHubOrganization(organizationId: string | null | undefined): boolean {
  return organizationId === REFERRAL_HUB_LEGACY_ORG_ID;
}

type ReferralHubOrgOption = {
  organization_id: string;
  role?: string | null;
};

export function resolveReferralHubOrganization({
  availableOrgs,
  storedOrgId,
  isAdmin,
}: {
  availableOrgs: ReferralHubOrgOption[];
  storedOrgId?: string | null;
  isAdmin: boolean;
}): string | null {
  const availableIds = new Set(availableOrgs.map((org) => org.organization_id));
  const stored = String(storedOrgId ?? "").trim();

  // The existing admin selector is the only supported override mechanism.
  if (isAdmin && stored && availableIds.has(stored)) return stored;

  const hasCanonicalMembership = availableOrgs.some(
    (org) => org.organization_id === REFERRAL_HUB_ORG_ID && Boolean(org.role),
  );
  if (hasCanonicalMembership || (isAdmin && availableIds.has(REFERRAL_HUB_ORG_ID))) {
    return REFERRAL_HUB_ORG_ID;
  }

  // Never silently fall back to the legacy tenant for new operations.
  if (stored && stored !== REFERRAL_HUB_LEGACY_ORG_ID && availableIds.has(stored)) return stored;
  return null;
}
