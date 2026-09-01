// Single source of truth for the real, live Luis service/benefit catalog.
// These are the actual production destinations (the published Unified
// Services Flow + standalone Benefits Flow — see LUIS_BENEFITS in
// supabase/functions/_products/referral-hub/luisBenefits.ts, and the legal
// topics in routeLuisConversation). service_configs (the drag/reorder admin
// screen) is NOT read by the live WhatsApp send path — verified by grep,
// zero references — so it is deliberately not used as the services list here.

export type LuisServiceId =
  | "luis_benefit_medical"
  | "luis_benefit_supermarket"
  | "luis_benefit_dental"
  | "luis_benefit_shipping"
  | "luis_inmigracion"
  | "luis_accidente"
  | "luis_representante";

export const SERVICE_LABELS: Record<LuisServiceId, string> = {
  luis_benefit_medical: "Beneficios médicos",
  luis_benefit_supermarket: "Supermercado",
  luis_benefit_dental: "Dental",
  luis_benefit_shipping: "Envíos",
  luis_inmigracion: "Inmigración",
  luis_accidente: "Accidente de auto / DUI / Defensa criminal",
  luis_representante: "Hablar con nuestro equipo",
};

export const BENEFIT_SERVICE_IDS: LuisServiceId[] = [
  "luis_benefit_medical",
  "luis_benefit_supermarket",
  "luis_benefit_dental",
  "luis_benefit_shipping",
];

export const LEGAL_SERVICE_IDS: LuisServiceId[] = ["luis_inmigracion", "luis_accidente", "luis_representante"];

export const CAMPAIGN_KEY_BY_SERVICE: Partial<Record<LuisServiceId, string>> = {
  luis_benefit_medical: "luis_benefit_medical_20",
  luis_benefit_supermarket: "luis_benefit_supermarket_20",
  luis_benefit_dental: "luis_benefit_dental_29",
  luis_benefit_shipping: "luis_benefit_shipping_20",
};

export const SERVICE_BY_CAMPAIGN_KEY: Record<string, LuisServiceId> = Object.fromEntries(
  Object.entries(CAMPAIGN_KEY_BY_SERVICE).map(([service, key]) => [key as string, service as LuisServiceId]),
);

// Real merchant names, taken directly from the production migration's
// offer_terms.merchant values (not invented). Supermarket has no single
// merchant — it has 3 real locations instead (see referral_benefit_campaign_locations).
export const BENEFIT_MERCHANT_NAME: Partial<Record<LuisServiceId, string>> = {
  luis_benefit_medical: "Médico Urgencias",
  luis_benefit_dental: "Dental Now 14",
  luis_benefit_shipping: "Ultra Cargo",
};

export const BENEFIT_STATIC_IMAGE: Partial<Record<LuisServiceId, string>> = {
  luis_benefit_medical: "/images/coupons/luis/medico-urgencias.jpeg",
  luis_benefit_dental: "/images/coupons/luis/dental-now-14.jpeg",
  luis_benefit_shipping: "/images/coupons/luis/ultra-cargo.jpeg",
};
