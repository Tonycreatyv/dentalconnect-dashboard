import {
  REFERRAL_HUB_COUPON_ASSETS,
  type ReferralHubCouponAssetConfig,
} from "../_products/referral-hub/config.ts";
import {
  normalizePhone,
  normalizeSourceChannel,
  VOICE_SOURCE_ORGANIZATION_ID,
  type VoiceCampaign,
  voiceChannelUserId,
} from "./workflow.ts";

type CouponServiceId = ReferralHubCouponAssetConfig["service_id"];

const COUPON_SERVICE_IDS = new Set<CouponServiceId>([
  "luis_cupon_super",
  "luis_cupon_medico",
  "luis_cupon_dental",
]);

const FORBIDDEN_CALLER_FIELDS = [
  "campaign_key",
  "image_url",
  "caption",
  "offer_terms",
  "merchant",
] as const;

export type CouponDeliveryTrackingInput = {
  organizationId: typeof VOICE_SOURCE_ORGANIZATION_ID;
  conversationIdentityHash: string;
  serviceId: CouponServiceId;
  campaignKey: string;
  channel: "whatsapp" | "voice";
  metadata: {
    status: "prepared";
    source: "referral-voice-tools";
  };
};

export type CouponDeliveryDependencies = {
  getCampaign: (serviceId: string) => Promise<{
    data: VoiceCampaign | null;
    error: unknown | null;
  }>;
  saveDeliveryTracking: (
    input: CouponDeliveryTrackingInput,
  ) => Promise<{ saved: boolean; error: unknown | null }>;
};

function text(value: unknown, max = 200): string {
  return typeof value === "string" && value.trim().length <= max
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

function serviceId(value: unknown): CouponServiceId | null {
  const candidate = text(value) as CouponServiceId;
  return COUPON_SERVICE_IDS.has(candidate) ? candidate : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function publicCampaign(campaign: VoiceCampaign) {
  const terms = campaign.offer_terms ?? {};
  const merchant = text(terms.merchant);
  if (campaign.service_id === "luis_cupon_super") {
    const discount = number(terms.discount_amount);
    const minimum = number(terms.minimum_purchase);
    if (!merchant || discount === null || minimum === null) return null;
    return {
      merchantName: merchant,
      offerSummary:
        `$${discount} de descuento en compras de $${minimum} o más.`,
      caption:
        `Aquí tienes tu cupón de ${merchant}. Preséntalo al momento de realizar tu compra.`,
    };
  }
  if (campaign.service_id === "luis_cupon_medico") {
    const discount = number(terms.discount_percent);
    if (!merchant || discount === null) return null;
    return {
      merchantName: merchant,
      offerSummary: `${discount}% de descuento.`,
      caption:
        `Aquí tienes tu cupón de ${merchant}. Preséntalo al momento de tu visita.`,
    };
  }
  if (campaign.service_id === "luis_cupon_dental") {
    const price = number(terms.promotional_price);
    if (!merchant || price === null) return null;
    return {
      merchantName: merchant,
      offerSummary: `Precio promocional de $${price}.`,
      caption:
        `Aquí tienes tu cupón de ${merchant}. Preséntalo al momento de tu visita.`,
    };
  }
  return null;
}

export async function deliverCouponImage(
  body: Record<string, unknown>,
  dependencies: CouponDeliveryDependencies,
) {
  if (body.confirmed !== true) {
    return { error: "confirmation_required", status: 400 };
  }
  for (const field of FORBIDDEN_CALLER_FIELDS) {
    if (field in body) return { error: "invalid_field", status: 400 };
  }
  const fields = body.fields && typeof body.fields === "object" &&
      !Array.isArray(body.fields)
    ? body.fields as Record<string, unknown>
    : {};
  if (
    Object.keys(fields).some((field) =>
      !["profile_name", "profile_city"].includes(field)
    )
  ) {
    return { error: "invalid_field", status: 400 };
  }
  for (const value of Object.values(fields)) {
    if (value !== null && value !== undefined && !text(value)) {
      return { error: "invalid_field", status: 400 };
    }
  }

  const conversationId = text(body.conversation_id);
  if (!conversationId) {
    return { error: "missing_conversation_id", status: 400 };
  }
  const requestedServiceId = serviceId(body.service_id);
  if (!requestedServiceId) {
    return { error: "service_not_found", status: 404 };
  }
  const callerPhone = text(body.caller_phone, 32);
  if (callerPhone && !normalizePhone(callerPhone)) {
    return { error: "invalid_field", status: 400 };
  }
  const channel = normalizeSourceChannel(body.source_channel);
  if (!channel) return { error: "invalid_source_channel", status: 400 };

  const asset = REFERRAL_HUB_COUPON_ASSETS[requestedServiceId];
  if (
    !asset?.active ||
    !/^https:\/\/referral\.creatyv\.io\/images\/coupons\/[^/]+\.jpeg$/i.test(
      asset.image_url,
    )
  ) {
    return { error: "coupon_asset_unavailable", status: 500 };
  }
  const campaignResult = await dependencies.getCampaign(requestedServiceId);
  if (
    campaignResult.error ||
    !campaignResult.data?.active ||
    campaignResult.data.campaign_key !== asset.campaign_key
  ) {
    return { error: "campaign_not_found", status: 404 };
  }
  const campaign = publicCampaign(campaignResult.data);
  if (!campaign) return { error: "campaign_not_found", status: 404 };

  const identity = await voiceChannelUserId(conversationId);
  const tracking = await dependencies.saveDeliveryTracking({
    organizationId: VOICE_SOURCE_ORGANIZATION_ID,
    conversationIdentityHash: identity.slice("voice:".length),
    serviceId: requestedServiceId,
    campaignKey: asset.campaign_key,
    channel,
    metadata: {
      status: "prepared",
      source: "referral-voice-tools",
    },
  });

  return {
    status: 200,
    body: {
      success: true,
      ready_to_deliver: true,
      service_id: requestedServiceId,
      merchant_name: campaign.merchantName,
      offer_summary: campaign.offerSummary,
      image_url: asset.image_url,
      caption: campaign.caption,
      delivery_tracking_saved: tracking.saved && !tracking.error,
      delivery_tracking_status: tracking.saved && !tracking.error
        ? "prepared"
        : "tracking_failed",
      media_delivery_confirmed: false,
    },
  };
}
