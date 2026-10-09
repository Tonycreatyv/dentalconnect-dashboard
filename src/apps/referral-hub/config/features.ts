export type LgFeatureFlags = {
  lg_services_enabled: boolean;
  lg_messenger_enabled: boolean;
  lg_whatsapp_enabled: boolean;
  lg_leads_enabled: boolean;
  lg_coupon_delivery_enabled: boolean;
  lg_grocery_orders_enabled: boolean;
  lg_delivery_enabled: boolean;
  lg_events_enabled: boolean;
};

export const DEFAULT_LG_FEATURE_FLAGS: LgFeatureFlags = {
  lg_services_enabled: true,
  lg_messenger_enabled: true,
  lg_whatsapp_enabled: true,
  lg_leads_enabled: true,
  lg_coupon_delivery_enabled: false,
  lg_grocery_orders_enabled: false,
  lg_delivery_enabled: false,
  lg_events_enabled: false,
};

export function resolveLgFeatureFlags(value: unknown): LgFeatureFlags {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_LG_FEATURE_FLAGS).map(([key, fallback]) => [
      key,
      typeof source[key] === "boolean" ? source[key] : fallback,
    ]),
  ) as LgFeatureFlags;
}
