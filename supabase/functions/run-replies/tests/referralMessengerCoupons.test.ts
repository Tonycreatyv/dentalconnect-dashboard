import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  REFERRAL_HUB_COUPON_ASSETS,
  type ReferralHubCouponAssetConfig,
} from "../../_products/referral-hub/config.ts";
import { sendViaMetaAdapter } from "../../_shared/metaMessageAdapter.ts";
import {
  handleReferralHubTurn,
  resolveLgCouponDeliveryEnabled,
} from "../domain/referralHub/genericMenuRouter.ts";

Deno.env.delete("REFERRAL_HUB_PUBLIC_BASE_URL");
Deno.env.set("REFERRAL_HUB_ASSET_BASE_URL", "https://referral.creatyv.io");

const urls = {
  luis_cupon_medico: "https://assets.example.test/lg-medical-coupon.png",
  luis_cupon_super: "https://assets.example.test/lg-supermarket-coupon.png",
  luis_cupon_dental: "https://assets.example.test/lg-dental-coupon.png",
};

const assets = Object.fromEntries(Object.entries(urls).map(([serviceId, imageUrl]) => [
  serviceId,
  {
    service_id: serviceId,
    image_url: imageUrl,
    active: true,
    intro_text: serviceId === "luis_cupon_super"
      ? "¡Claro! Aquí tienes tu cupón de supermercado."
      : serviceId === "luis_cupon_medico"
      ? "¡Claro! Aquí tienes tu cupón médico."
      : "¡Claro! Aquí tienes tu cupón dental.",
    instructions: serviceId === "luis_cupon_super"
      ? "Preséntalo al momento de pagar en un comercio participante."
      : "Preséntalo en un comercio participante.",
    campaign_key: serviceId,
  },
])) as unknown as Record<string, ReferralHubCouponAssetConfig>;

const profileState = {
  collected: {
    referral_hub: {
      profile_name: "Luis Gabriel",
      profile_city: "Atlanta",
      profile_complete: true,
    },
  },
};

function supabaseCoupon(code = "LG-COUPON-123") {
  return {
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
    rpc: () => Promise.resolve({
      data: {
        coupon_id: "coupon-id",
        code,
        public_token: "public-token",
        coupon_status: "active",
        issued_at: "2026-07-26T12:00:00Z",
        expires_at: null,
        was_created: true,
      },
      error: null,
    }),
  };
}

function referralState(result: { statePatch: Record<string, unknown> }) {
  return ((result.statePatch.collected as any)?.referral_hub ?? {}) as Record<string, unknown>;
}

async function coupon(serviceId: keyof typeof urls) {
  return await handleReferralHubTurn({
    supabase: supabaseCoupon() as any,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-id",
    leadState: profileState,
    inboundText: serviceId,
    payloadAction: `referral_service:${serviceId}`,
    channel: "messenger",
    couponAssets: assets,
  });
}

Deno.test("supermarket coupon orders intro, native image, then code details", async () => {
  const result = await coupon("luis_cupon_super");
  assertEquals(result.outboundMessages, [
    { type: "text", text: "¡Claro! Aquí tienes tu cupón de supermercado." },
    { type: "image", url: urls.luis_cupon_super, altText: "Imagen del cupón", reusable: true },
  ]);
  assertEquals(result.reply, "Código: LG-COUPON-123\n\nPreséntalo al momento de pagar en un comercio participante.");
  assertEquals(result.interactiveButtons, [
    { id: "referral_menu:services", title: "Ver otros servicios" },
    { id: "referral_handoff:advisor", title: "Hablar con asesor" },
    { id: "referral_menu:main", title: "Menú principal" },
  ]);
  assertEquals((referralState(result) as any).current_field, null);
});

Deno.test("coupon continuation routes to services without reissuing a coupon", async () => {
  let rpcCalls = 0;
  const result = await handleReferralHubTurn({
    supabase: { rpc: () => {
      rpcCalls += 1;
      return Promise.resolve({ data: null, error: null });
    } } as any,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-id",
    leadState: profileState,
    inboundText: "",
    payloadAction: "referral_menu:services",
    channel: "messenger",
  });
  assertEquals(result.reply, "¿En qué podemos ayudarte hoy?");
  assertEquals(rpcCalls, 0);
  assertEquals(result.interactiveButtons?.length, 8);
});

Deno.test("medical and dental coupons select their exact HTTPS images", async () => {
  const medical = await coupon("luis_cupon_medico");
  const dental = await coupon("luis_cupon_dental");
  assertEquals((medical.outboundMessages?.[1] as any).url, urls.luis_cupon_medico);
  assertEquals((dental.outboundMessages?.[1] as any).url, urls.luis_cupon_dental);
  assert(/^https:\/\//.test((medical.outboundMessages?.[1] as any).url));
  assert(/^https:\/\//.test((dental.outboundMessages?.[1] as any).url));
});

Deno.test("production coupon assets are active and map to exact canonical URLs", async () => {
  assertEquals(REFERRAL_HUB_COUPON_ASSETS.luis_cupon_dental, {
    service_id: "luis_cupon_dental",
    image_url: "https://referral.creatyv.io/images/coupons/lg-dental-coupon.jpeg",
    active: true,
    intro_text: "¡Claro! Aquí tienes tu cupón dental.",
    instructions: "Preséntalo en una clínica dental participante.",
    campaign_key: "dental_now_14_29",
  });
  assertEquals(REFERRAL_HUB_COUPON_ASSETS.luis_cupon_medico.image_url,
    "https://referral.creatyv.io/images/coupons/lg-medical-coupon.jpeg");
  assertEquals(REFERRAL_HUB_COUPON_ASSETS.luis_cupon_medico.active, true);
  assertEquals(REFERRAL_HUB_COUPON_ASSETS.luis_cupon_super.image_url,
    "https://referral.creatyv.io/images/coupons/lg-supermarket-coupon.jpeg");
  assertEquals(REFERRAL_HUB_COUPON_ASSETS.luis_cupon_super.active, true);
  assertEquals(REFERRAL_HUB_COUPON_ASSETS.luis_cupon_super.campaign_key,
    "mi_tierra_10");
  assertEquals(REFERRAL_HUB_COUPON_ASSETS.luis_cupon_medico.campaign_key,
    "medico_urgencias_20");
  const configSource = await Deno.readTextFile(
    new URL("../../_products/referral-hub/config.ts", import.meta.url),
  );
  assertEquals(configSource.includes("example.test"), false);
});

Deno.test("empty integrations defaults LG coupon delivery to enabled", () => {
  assertEquals(resolveLgCouponDeliveryEnabled({}), true);
  assertEquals(resolveLgCouponDeliveryEnabled({ lg_features: {} }), true);
  assertEquals(resolveLgCouponDeliveryEnabled(undefined), true);
});

Deno.test("production conditions resolve all exact service IDs with empty integrations", async () => {
  for (const serviceId of [
    "luis_cupon_medico",
    "luis_cupon_super",
    "luis_cupon_dental",
  ] as const) {
    const result = await handleReferralHubTurn({
      supabase: supabaseCoupon(`CODE-${serviceId}`) as any,
      organizationId: "luis-gabriel-referral-hub",
      leadId: "lead-id",
      leadState: profileState,
      inboundText: serviceId,
      payloadAction: `referral_service:${serviceId}`,
      channel: "messenger",
      integrations: {},
    });
    assertEquals(result.debugNote, `referral_hub:persistent_coupon:messenger:${serviceId}`);
    assertEquals(referralState(result).coupon_delivery_error, null);
    assertEquals(result.outboundMessages?.[1], {
      type: "image",
      url: REFERRAL_HUB_COUPON_ASSETS[serviceId].image_url,
      altText: "Imagen del cupón",
      reusable: true,
    });
  }
});

Deno.test("missing asset config has exact internal error", async () => {
  const result = await handleReferralHubTurn({
    supabase: supabaseCoupon() as any,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-id",
    leadState: profileState,
    inboundText: "Cupón médico",
    payloadAction: "referral_service:luis_cupon_medico",
    channel: "messenger",
    couponAssets: {},
  });
  assertStringIncludes(result.reply, "No pudimos preparar la imagen");
  assertEquals(result.outboundMessages, undefined);
  assert(!result.reply.includes("entregado"));
  assertEquals(referralState(result).coupon_delivery_error, "asset_config_missing");
});

Deno.test("disabled feature has exact internal error and does not enable other LG features", async () => {
  const integrations = {
    lg_features: {
      lg_coupon_delivery_enabled: false,
      grocery_orders_enabled: false,
      delivery_enabled: false,
      events_enabled: false,
    },
  };
  assertEquals(resolveLgCouponDeliveryEnabled(integrations), false);
  const result = await handleReferralHubTurn({
    supabase: supabaseCoupon() as any,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-id",
    leadState: profileState,
    inboundText: "Cupón médico",
    payloadAction: "referral_service:luis_cupon_medico",
    channel: "messenger",
    integrations,
  });
  assertEquals(referralState(result).coupon_delivery_error, "coupon_delivery_disabled");
  assertEquals(result.outboundMessages, undefined);
});

Deno.test("inactive config, invalid URL, and missing campaign retain exact errors", async () => {
  const base = REFERRAL_HUB_COUPON_ASSETS.luis_cupon_medico;
  const cases = [
    {
      assets: { luis_cupon_medico: { ...base, active: false } },
      supabase: supabaseCoupon(),
      expected: "asset_config_inactive",
    },
    {
      assets: { luis_cupon_medico: { ...base, image_url: "/local.jpeg" } },
      supabase: supabaseCoupon(),
      expected: "image_url_invalid",
    },
    {
      assets: { luis_cupon_medico: base },
      supabase: {
        rpc: () => Promise.resolve({
          data: null,
          error: { message: "coupon campaign not found" },
        }),
      },
      expected: "coupon_campaign_missing",
    },
  ] as const;
  for (const testCase of cases) {
    const result = await handleReferralHubTurn({
      supabase: testCase.supabase as any,
      organizationId: "luis-gabriel-referral-hub",
      leadId: "lead-id",
      leadState: profileState,
      inboundText: "Cupón médico",
      payloadAction: "referral_service:luis_cupon_medico",
      channel: "messenger",
      couponAssets: testCase.assets as any,
      integrations: {},
    });
    assertEquals(referralState(result).coupon_delivery_error, testCase.expected);
  }
});

Deno.test("WhatsApp coupon uses persistent issuance and prepared delivery tracking", async () => {
  const result = await handleReferralHubTurn({
    supabase: supabaseCoupon("DENTAL-PERSISTENT") as any,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-id",
    leadState: profileState,
    inboundText: "Cupón dental",
    payloadAction: "referral_service:luis_cupon_dental",
    channel: "whatsapp",
    couponAssets: assets,
  });
  assertStringIncludes(result.reply, "DENTAL-PERSISTENT");
  assertEquals(result.debugNote, "referral_hub:persistent_coupon:whatsapp:luis_cupon_dental");
  assertEquals(result.outboundMessages?.[1].type, "image");
});

Deno.test("Messenger image adapter uses native attachment and the supplied tenant token", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody: Record<string, any> = {};
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(new Response(
      JSON.stringify({ message_id: "mid-image" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
  }) as typeof fetch;
  try {
    const result = await sendViaMetaAdapter({
      channel: "messenger",
      graphVersion: "v19.0",
      recipientId: "page-scoped-user",
      imageUrl: urls.luis_cupon_super,
      pageAccessToken: "tenant-page-token",
    });
    assertEquals(result.ok, true);
    assertStringIncludes(capturedUrl, "access_token=tenant-page-token");
    assertEquals(capturedBody, {
      messaging_type: "RESPONSE",
      recipient: { id: "page-scoped-user" },
      message: {
        attachment: {
          type: "image",
          payload: {
            url: urls.luis_cupon_super,
            is_reusable: true,
          },
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("coupon sequence records stage failures and sent only after provider acceptance", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const introIndex = source.indexOf('"coupon_intro_failed"');
  const imageIndex = source.indexOf('"coupon_image_failed"');
  const detailsIndex = source.indexOf("coupon_details_failed");
  const providerSuccessIndex = source.indexOf("const outboundProviderMessageId");
  const sentIndex = source.indexOf('coupon_delivery_status: "sent"');
  assert(introIndex >= 0);
  assert(imageIndex > introIndex);
  assert(detailsIndex > imageIndex);
  assert(providerSuccessIndex > detailsIndex);
  assert(sentIndex > providerSuccessIndex);
  assertEquals(source.includes('coupon_delivery_status: "delivered"'), false);
});

Deno.test("Messenger token loading remains organization-scoped with no global Page-token fallback", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertStringIncludes(source, ".eq(\"organization_id\", organizationId)");
  assertStringIncludes(source, "orgSettings.meta_page_access_token");
  assertEquals(source.includes('Deno.env.get("META_PAGE_ACCESS_TOKEN")'), false);
  assertStringIncludes(source, "integrations:");
});
