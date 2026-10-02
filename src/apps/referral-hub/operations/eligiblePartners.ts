export type CaseRoutingContext = {
  city: string | null;
  postalCode: string | null;
  language: string | null;
  specialty: string | null;
};

export type PartnerServiceRule = {
  partnerId: string;
  cities: string[];
  postalCodes: string[];
  languages: string[];
  specialties: string[];
};

function matchesDimension(value: string | null, allowed: readonly string[]): boolean {
  return allowed.length === 0 || (value !== null && allowed.includes(value));
}

export function matchesPartnerServiceRule(
  request: CaseRoutingContext,
  rule: PartnerServiceRule,
): boolean {
  return (
    matchesDimension(request.city, rule.cities)
    && matchesDimension(request.postalCode, rule.postalCodes)
    && matchesDimension(request.language, rule.languages)
    && matchesDimension(request.specialty, rule.specialties)
  );
}

export function eligiblePartnerIds(
  request: CaseRoutingContext,
  rules: readonly PartnerServiceRule[],
  activeContactPartnerIds: ReadonlySet<string>,
): string[] {
  return [...new Set(
    rules
      .filter((rule) => matchesPartnerServiceRule(request, rule))
      .map((rule) => rule.partnerId)
      .filter((partnerId) => activeContactPartnerIds.has(partnerId)),
  )];
}
