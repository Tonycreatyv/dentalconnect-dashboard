export type PantryDeliveryCoverageStatus =
  | "available"
  | "manual_review"
  | "unavailable";

export type PantryDeliveryCoverageConfig = {
  availableZipCodes: readonly string[];
  unavailableZipCodes: readonly string[];
  fallback: PantryDeliveryCoverageStatus;
};

// Demo policy: accept every reasonable US ZIP for manual review until explicit
// delivery areas are approved. Add five-digit ZIPs to either list as coverage
// changes; ZIP+4 values are classified by their first five digits.
export const PANTRY_DELIVERY_COVERAGE: PantryDeliveryCoverageConfig = {
  availableZipCodes: [],
  unavailableZipCodes: [],
  fallback: "manual_review",
};

export function normalizeUsZipCode(value: string): string | null {
  const zip = value.trim();
  return /^\d{5}(?:-\d{4})?$/.test(zip) ? zip : null;
}

export function classifyPantryDeliveryCoverage(
  zipCode: string,
  config: PantryDeliveryCoverageConfig = PANTRY_DELIVERY_COVERAGE,
): PantryDeliveryCoverageStatus {
  const normalized = normalizeUsZipCode(zipCode);
  if (!normalized) return "unavailable";
  const baseZip = normalized.slice(0, 5);
  if (config.availableZipCodes.includes(baseZip)) return "available";
  if (config.unavailableZipCodes.includes(baseZip)) return "unavailable";
  return config.fallback;
}
