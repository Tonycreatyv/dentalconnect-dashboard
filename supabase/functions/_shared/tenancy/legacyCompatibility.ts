/**
 * Temporary compatibility mappings required by existing WhatsApp test-number
 * and App Review paths. New tenant routing must use organization-scoped
 * database configuration instead of adding entries here.
 */
export const LEGACY_DEMO_CONTACT_ROUTES: Readonly<Record<string, string>> = {
  "17812961757": "barber-demo",
  "50433899824": "clinic-demo",
  "50493312928": "barber-demo-wimaeil",
};

export const LEGACY_DEFAULT_ORGANIZATION_ID = "clinic-demo";
