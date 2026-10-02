export const REFERRAL_HUB_BUSINESS_TYPE = "referral_hub" as const;
export const REFERRAL_HUB_CANONICAL_ORGANIZATION_ID =
  "luis-gabriel-referral-hub";

// Promotional creative for the Furniture Flow follow-up. It is deliberately
// separate from benefit/coupon routing.
export const JAMES_FURNITURE = {
  displayName: "James Furniture & Mattress Deals",
  address: "5211 Jimmy Carter Blvd Ste A, Norcross, GA 30093",
  websiteUrl: null as string | null,
  promoImageUrl:
    "https://referral.creatyv.io/images/coupons/luis/james-furniture-downpayment-sept-2026.jpg",
} as const;

export type ReferralHubCouponAssetConfig = {
  service_id: "luis_cupon_medico" | "luis_cupon_super" | "luis_cupon_dental";
  image_url: string;
  active: boolean;
  intro_text: string;
  benefit_text?: string;
  instructions: string;
  campaign_key: string;
};

export const REFERRAL_HUB_COUPON_ASSETS: Record<
  ReferralHubCouponAssetConfig["service_id"],
  ReferralHubCouponAssetConfig
> = {
  luis_cupon_medico: {
    service_id: "luis_cupon_medico",
    image_url:
      "https://referral.creatyv.io/images/coupons/lg-medical-coupon.jpeg",
    active: true,
    intro_text: "Tu beneficio está listo ✅",
    benefit_text: "20% de descuento en servicios médicos participantes.",
    instructions: "Muéstralo al llegar a una clínica participante.",
    campaign_key: "medico_urgencias_20",
  },
  luis_cupon_super: {
    service_id: "luis_cupon_super",
    image_url:
      "https://referral.creatyv.io/images/coupons/lg-supermarket-coupon.jpeg",
    active: true,
    intro_text: "¡Listo! 🎟️ Tu cupón de supermercado está preparado.",
    instructions: "Preséntalo al momento de pagar en un comercio participante.",
    campaign_key: "mi_tierra_10",
  },
  luis_cupon_dental: {
    service_id: "luis_cupon_dental",
    image_url:
      "https://referral.creatyv.io/images/coupons/lg-dental-coupon.jpeg",
    active: true,
    intro_text: "Tu cupón dental está listo ✅",
    instructions: "Preséntalo en una clínica dental participante.",
    campaign_key: "dental_now_14_29",
  },
};
