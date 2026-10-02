import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  type CouponDeliveryDependencies,
  deliverCouponImage,
} from "./couponDelivery.ts";
import type { VoiceCampaign } from "./workflow.ts";

const campaigns = new Map<string, VoiceCampaign>([
  [
    "luis_cupon_super",
    {
      service_id: "luis_cupon_super",
      campaign_key: "mi_tierra_10",
      display_name: "Mi Tierra — cupón $10",
      offer_terms: {
        discount_amount: 10,
        minimum_purchase: 100,
        currency: "USD",
        merchant: "Mi Tierra Supermercados",
      },
      active: true,
    },
  ],
  [
    "luis_cupon_medico",
    {
      service_id: "luis_cupon_medico",
      campaign_key: "medico_urgencias_20",
      display_name: "Médico Urgencias — 20% de descuento",
      offer_terms: {
        discount_percent: 20,
        merchant: "Médico Urgencias",
      },
      active: true,
    },
  ],
  [
    "luis_cupon_dental",
    {
      service_id: "luis_cupon_dental",
      campaign_key: "dental_now_14_29",
      display_name: "Dental Now 14 — promoción $29",
      offer_terms: {
        promotional_price: 29,
        currency: "USD",
        merchant: "Dental Now 14",
      },
      active: true,
    },
  ],
]);

function fake(options: { trackingFails?: boolean } = {}) {
  const trackingKeys = new Set<string>();
  let trackingCalls = 0;
  const dependencies: CouponDeliveryDependencies = {
    getCampaign: (serviceId) =>
      Promise.resolve({
        data: campaigns.get(serviceId) ?? null,
        error: null,
      }),
    saveDeliveryTracking: (input) => {
      trackingCalls += 1;
      const key = [
        input.organizationId,
        input.conversationIdentityHash,
        input.serviceId,
        input.campaignKey,
        input.channel,
      ].join(":");
      trackingKeys.add(key);
      return Promise.resolve(
        options.trackingFails
          ? { saved: false, error: new Error("tracking unavailable") }
          : { saved: true, error: null },
      );
    },
  };
  return {
    dependencies,
    trackingKeys,
    get trackingCalls() {
      return trackingCalls;
    },
  };
}

function request(serviceId: string, overrides: Record<string, unknown> = {}) {
  return {
    action: "deliver_coupon_image",
    organization_id: "luis-gabriel-referral-hub",
    conversation_id: "elevenlabs-coupon-conversation",
    caller_phone: "+14045551212",
    service_id: serviceId,
    fields: { profile_name: "Ana López", profile_city: "Atlanta" },
    confirmed: true,
    source_channel: "whatsapp",
    ...overrides,
  };
}

Deno.test("three coupons return exact approved images and database terms", async () => {
  const expected = {
    luis_cupon_super: {
      image:
        "https://referral.creatyv.io/images/coupons/lg-supermarket-coupon.jpeg",
      merchant: "Mi Tierra Supermercados",
      offer: "$10 de descuento en compras de $100 o más.",
    },
    luis_cupon_medico: {
      image:
        "https://referral.creatyv.io/images/coupons/lg-medical-coupon.jpeg",
      merchant: "Médico Urgencias",
      offer: "20% de descuento.",
    },
    luis_cupon_dental: {
      image: "https://referral.creatyv.io/images/coupons/lg-dental-coupon.jpeg",
      merchant: "Dental Now 14",
      offer: "Precio promocional de $29.",
    },
  };
  for (const [serviceId, approved] of Object.entries(expected)) {
    const result = await deliverCouponImage(
      request(serviceId),
      fake().dependencies,
    );
    assert("body" in result);
    const body = result.body!;
    assertEquals(body.ready_to_deliver, true);
    assertEquals(body.image_url, approved.image);
    assertEquals(body.merchant_name, approved.merchant);
    assertEquals(body.offer_summary, approved.offer);
    assertEquals(body.delivery_tracking_saved, true);
    assertEquals(body.delivery_tracking_status, "prepared");
    assertEquals(body.media_delivery_confirmed, false);
    assert(!("coupon_code" in body));
    assert(!JSON.stringify(body).includes("$20"));
  }
});

Deno.test("confirmation and exact coupon allowlist are required", async () => {
  const unconfirmed = await deliverCouponImage(
    request("luis_cupon_super", { confirmed: false }),
    fake().dependencies,
  );
  assertEquals(unconfirmed.error, "confirmation_required");
  const invalid = await deliverCouponImage(
    request("luis_compra_super"),
    fake().dependencies,
  );
  assertEquals(invalid.error, "service_not_found");
});

Deno.test("campaign must exist, be active and match internal asset mapping", async () => {
  for (
    const campaign of [
      null,
      { ...campaigns.get("luis_cupon_super")!, active: false },
      {
        ...campaigns.get("luis_cupon_super")!,
        campaign_key: "caller-controlled",
      },
    ]
  ) {
    const dependencies = fake().dependencies;
    dependencies.getCampaign = () =>
      Promise.resolve({ data: campaign, error: null });
    const result = await deliverCouponImage(
      request("luis_cupon_super"),
      dependencies,
    );
    assertEquals(result.error, "campaign_not_found");
  }
});

Deno.test("caller cannot supply image, caption, merchant, terms or campaign", async () => {
  for (
    const field of [
      "image_url",
      "caption",
      "merchant",
      "offer_terms",
      "campaign_key",
    ]
  ) {
    const result = await deliverCouponImage(
      request("luis_cupon_super", { [field]: "attacker controlled" }),
      fake().dependencies,
    );
    assertEquals(result.error, "invalid_field");
  }
});

Deno.test("name city and phone remain optional and are never fabricated", async () => {
  const result = await deliverCouponImage(
    request("luis_cupon_medico", {
      caller_phone: undefined,
      fields: {},
    }),
    fake().dependencies,
  );
  assert("body" in result);
  const serialized = JSON.stringify(result.body);
  assert(!serialized.includes("profile_name"));
  assert(!serialized.includes("profile_city"));
  assert(!serialized.includes("caller_phone"));
});

Deno.test("tracking is idempotent and stores only a hashed conversation identity", async () => {
  const state = fake();
  await deliverCouponImage(
    request("luis_cupon_super"),
    state.dependencies,
  );
  await deliverCouponImage(
    request("luis_cupon_super"),
    state.dependencies,
  );
  assertEquals(state.trackingCalls, 2);
  assertEquals(state.trackingKeys.size, 1);
  const serialized = [...state.trackingKeys][0];
  assert(!serialized.includes("elevenlabs-coupon-conversation"));
  assert(/[0-9a-f]{64}/.test(serialized));
});

Deno.test("tracking failure is reported without blocking media preparation", async () => {
  const result = await deliverCouponImage(
    request("luis_cupon_dental"),
    fake({ trackingFails: true }).dependencies,
  );
  assert("body" in result);
  assertEquals(result.body!.ready_to_deliver, true);
  assertEquals(result.body!.delivery_tracking_saved, false);
  assertEquals(result.body!.delivery_tracking_status, "tracking_failed");
  assertEquals(result.body!.media_delivery_confirmed, false);
});

Deno.test("coupon-image path has no issuance, code, token or grocery dependency", async () => {
  const source = await Deno.readTextFile(
    new URL("./couponDelivery.ts", import.meta.url),
  );
  assert(!source.includes("issueOrGetCoupon"));
  assert(!source.includes("issue_or_get_coupon"));
  assert(!source.includes("coupon_code"));
  assert(!source.includes("public_token"));
  assert(!source.includes("create_referral_order"));
  assert(!source.includes("listBasketOffers"));
});
