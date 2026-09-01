import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  handleReferralHubTurn,
} from "../domain/referralHub/genericMenuRouter.ts";

Deno.env.set("REFERRAL_HUB_ASSET_BASE_URL", "https://referral.creatyv.io");

const organizationId = "luis-gabriel-referral-hub";
const profileState = {
  collected: {
    referral_hub: {
      profile_name: "Luis Gabriel",
      profile_city: "Atlanta",
      profile_complete: true,
    },
  },
};
const locationId = "11111111-1111-4111-8111-111111111111";
const offerId = "22222222-2222-4222-8222-222222222222";

function referralState(result: { statePatch: Record<string, unknown> }) {
  return ((result.statePatch.collected as Record<string, unknown>)
    ?.referral_hub ?? {}) as Record<string, unknown>;
}

function couponDatabase(args?: { error?: { message: string } | null }) {
  return {
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
    rpc: () =>
      Promise.resolve({
        data: args?.error ? null : {
          coupon_id: "coupon-id",
          code: "RH-LG-12345",
          public_token: "public-token",
          coupon_status: "active",
          issued_at: "2026-08-08T12:00:00Z",
          expires_at: null,
          was_created: true,
        },
        error: args?.error ?? null,
      }),
  };
}

function groceryDatabase() {
  const rows = (table: string, single: boolean) => {
    if (table === "referral_grocery_delivery_coverage") {
      return {
        data: [{ partner_location_id: locationId, priority: 1 }],
        error: null,
      };
    }
    if (table === "referral_partner_locations") {
      return single
        ? {
          data: { id: locationId, active: true, delivery_enabled: true },
          error: null,
        }
        : { data: [{ id: locationId, name: "Sucursal Centro" }], error: null };
    }
    if (table === "referral_basket_offers") {
      return single
        ? {
          data: {
            id: offerId,
            display_name: "Canasta Esencial",
            partner_location_id: locationId,
            active: true,
          },
          error: null,
        }
        : {
          data: [{
            id: offerId,
            display_name: "Canasta Esencial",
            price_cents: 6900,
            currency: "USD",
          }],
          error: null,
        };
    }
    return { data: null, error: null };
  };
  const from = (table: string) => {
    let single = false;
    const query: Record<string, unknown> & PromiseLike<unknown> = {
      then(resolve, reject) {
        return Promise.resolve(rows(table, single)).then(resolve, reject);
      },
    };
    for (const method of ["select", "eq", "in", "order"]) {
      query[method] = () => query;
    }
    query.maybeSingle = () => {
      single = true;
      return query;
    };
    return query;
  };
  return { from, rpc: () => Promise.resolve({ data: null, error: null }) };
}

Deno.test("grocery entry offers a coupon or prepared baskets without profile intake", async () => {
  const result = await handleReferralHubTurn({
    organizationId,
    leadState: null,
    inboundText: "",
    payloadAction: "referral_service:luis_compra_super",
    channel: "whatsapp",
  });

  assertStringIncludes(result.reply, "Llegaste al lugar correcto");
  assertEquals(result.interactiveButtons, [
    { id: "referral_grocery:coupon", title: "Quiero mi cupón" },
    { id: "referral_grocery:baskets", title: "Ver las canastas" },
  ]);
  assertEquals(result.debugNote, "referral_hub:grocery_entry");
});

Deno.test("Luis reset joins the canonical service menu without generic profile intake", async () => {
  const result = await handleReferralHubTurn({
    organizationId,
    leadState: null,
    inboundText: "demo",
    channel: "whatsapp",
  });

  assertEquals(result.debugNote, "referral_hub:lg_menu");
  assertEquals(
    result.interactiveList?.sections[0].rows[0].id,
    "referral_service:luis_cupon_medico",
  );
  assertStringIncludes(result.reply, "Bienvenido a LG Community");
  assertEquals(referralState(result).current_field, null);
  assert(!result.reply.includes("nombre completo"));
});

Deno.test("demo reset clears only transient referral state and uses the canonical grocery entry", async () => {
  const reset = await handleReferralHubTurn({
    organizationId,
    leadState: {
      collected: {
        referral_hub: {
          profile_name: "Luis Gabriel",
          profile_city: "Atlanta",
          grocery: { step: "zip", idempotencyKey: "demo-grocery" },
          extracted_data: { service: "accidente" },
        },
      },
    },
    inboundText: "reiniciar",
    channel: "whatsapp",
  });
  const grocery = await handleReferralHubTurn({
    organizationId,
    leadState: reset.statePatch,
    inboundText: "",
    payloadAction: "referral_service:luis_compra_super",
    channel: "whatsapp",
  });

  assertEquals(referralState(reset).profile_name, "Luis Gabriel");
  assertEquals(referralState(reset).profile_city, "Atlanta");
  assertEquals(referralState(reset).grocery, null);
  assertEquals(referralState(reset).extracted_data, {});
  assertEquals(grocery.debugNote, "referral_hub:grocery_entry");
  assertEquals(grocery.interactiveButtons?.map((button) => button.title), [
    "Quiero mi cupón",
    "Ver las canastas",
  ]);
});

Deno.test("Hola Luis resets stale intake state into the canonical menu without profile questions", async () => {
  const result = await handleReferralHubTurn({
    organizationId,
    leadState: {
      collected: {
        referral_hub: {
          profile_name: "Jose",
          profile_city: "Atlanta",
          profile_complete: true,
          service_id: "luis_accidente",
          service_label: "Accidentes",
          current_field: "confirm_submission",
          extracted_data: { accident_city: "Atlanta", contact_name: "Jose" },
          pending_field_confirmation: {
            field: "accident_date",
            interpretation: { normalizedValue: "2026-08-10" },
          },
        },
      },
    },
    inboundText: "Hola Luis",
    channel: "whatsapp",
    allowTransientLuisMenuReset: true,
  });

  assertEquals(result.debugNote, "referral_hub:lg_menu");
  assertEquals(referralState(result).profile_name, "Jose");
  assertEquals(referralState(result).profile_city, "Atlanta");
  assertEquals(referralState(result).service_id, null);
  assertEquals(referralState(result).current_field, null);
  assertEquals(referralState(result).extracted_data, {});
  assert(!result.reply.includes("¿En qué ciudad vives?"));
  assert(!result.reply.includes("Un coordinador debe revisarla"));

  const grocery = await handleReferralHubTurn({
    organizationId,
    leadState: result.statePatch,
    inboundText: "Supermercado",
    channel: "whatsapp",
    allowTransientLuisMenuReset: true,
  });
  assertEquals(grocery.debugNote, "referral_hub:grocery_entry");
});

Deno.test("Luis menu continuation actions clear stale service state before rendering the menu", async () => {
  const staleState = {
    collected: {
      referral_hub: {
        profile_name: "Jose",
        profile_city: "Atlanta",
        profile_complete: true,
        service_id: "luis_inmigracion",
        service_label: "Inmigración",
        current_field: "confirm_submission",
        extracted_data: { immigration_case: "Consulta" },
      },
    },
  };

  for (
    const payloadAction of ["referral_menu:services", "referral_menu:main"]
  ) {
    const result = await handleReferralHubTurn({
      organizationId,
      leadState: staleState,
      inboundText: "",
      payloadAction,
      channel: "whatsapp",
    });

    assertEquals(result.debugNote, "referral_hub:lg_menu");
    assertEquals(referralState(result).profile_name, "Jose");
    assertEquals(referralState(result).service_id, null);
    assertEquals(referralState(result).current_field, null);
    assertEquals(referralState(result).extracted_data, {});
    assert(!result.reply.includes("Un coordinador debe revisarla"));
  }
});

Deno.test("Luis textual demo reset aliases clear stale state before canonical service selection", async () => {
  const staleState = {
    collected: {
      referral_hub: {
        profile_name: "Jose",
        profile_city: "Atlanta",
        service_id: "luis_accidente",
        current_field: "confirm_submission",
        extracted_data: { contact_name: "Jose" },
      },
    },
  };

  for (const inboundText of ["demo", "Menú principal", "Ver otros servicios"]) {
    const result = await handleReferralHubTurn({
      organizationId,
      leadState: staleState,
      inboundText,
      channel: "whatsapp",
      allowTransientLuisMenuReset: true,
    });

    assertEquals(result.debugNote, "referral_hub:lg_menu");
    assertEquals(referralState(result).profile_name, "Jose");
    assertEquals(referralState(result).service_id, null);
    assertEquals(referralState(result).current_field, null);
  }
});

Deno.test("generic profile intake remains unchanged without explicit demo context", async () => {
  const result = await handleReferralHubTurn({
    organizationId,
    leadState: null,
    inboundText: "un mensaje desconocido",
    channel: "whatsapp",
  });

  assertEquals(result.debugNote, "referral_hub:lg_profile");
  assertStringIncludes(result.reply, "nombre completo");
});

Deno.test("natural Luis discovery opens the canonical menu before profile intake", async () => {
  for (
    const inboundText of [
      "hola",
      "qué servicios tienen",
      "necesito ayuda",
      "menu",
      "inicio",
      "reiniciar",
      "demo",
      "vengo por el flyer",
      "escaneé el qr",
      "Hola, quiero conocer los servicios",
    ]
  ) {
    const result = await handleReferralHubTurn({
      organizationId,
      leadState: null,
      inboundText,
      channel: "whatsapp",
    });

    assertEquals(result.debugNote, "referral_hub:lg_menu");
    assert(!result.reply.includes("nombre completo"));
    assert(!result.reply.includes("no hay servicios disponibles"));
    assert(!result.reply.includes("continuar con tu cita"));
  }
});

Deno.test("natural Luis service intents enter existing canonical handlers before profile intake", async () => {
  const grocery = await handleReferralHubTurn({
    organizationId,
    leadState: null,
    inboundText: "supermercado",
    channel: "whatsapp",
  });
  const coupon = await handleReferralHubTurn({
    supabase: couponDatabase() as any,
    organizationId,
    leadId: "lead-id",
    leadState: null,
    inboundText: "Quiero mi cupón de supermercado",
    channel: "whatsapp",
  });
  const dentist = await handleReferralHubTurn({
    supabase: couponDatabase() as any,
    organizationId,
    leadId: "lead-id",
    leadState: null,
    inboundText: "necesito dentista",
    channel: "whatsapp",
  });
  const accident = await handleReferralHubTurn({
    organizationId,
    leadState: null,
    inboundText: "tuve un accidente",
    channel: "whatsapp",
  });
  const advisor = await handleReferralHubTurn({
    organizationId,
    leadState: null,
    inboundText: "quiero hablar con alguien",
    channel: "whatsapp",
  });

  assertEquals(grocery.debugNote, "referral_hub:grocery_entry");
  assertEquals(grocery.interactiveButtons?.map((button) => button.title), [
    "Quiero mi cupón",
    "Ver las canastas",
  ]);
  assertEquals(coupon.outboundMessages?.map((message) => message.type), [
    "text",
    "image",
  ]);
  assertStringIncludes(
    (coupon.outboundMessages?.[0] as any).text,
    "Código: RH-LG-12345",
  );
  assertEquals(
    coupon.reply,
    "Ya que vas a comprar… ¿quieres ahorrarte también el viaje?",
  );
  assertEquals(dentist.outboundMessages?.map((message) => message.type), [
    "text",
    "image",
  ]);
  assertEquals(accident.debugNote, "referral_hub:service_accident");
  assertEquals(advisor.debugNote, "referral_hub:advisor_handoff_requested");
  for (const result of [grocery, coupon, dentist, accident, advisor]) {
    assert(!result.reply.includes("nombre completo"));
    assert(!result.reply.includes("continuar con tu cita"));
  }
});

Deno.test("supermarket coupon is prepared before its prepared-basket upsell", async () => {
  const result = await handleReferralHubTurn({
    supabase: couponDatabase() as any,
    organizationId,
    leadId: "lead-id",
    leadState: profileState,
    inboundText: "",
    payloadAction: "referral_grocery:coupon",
    channel: "whatsapp",
  });

  assertEquals(result.outboundMessages?.map((message) => message.type), [
    "text",
    "image",
  ]);
  assertStringIncludes(
    (result.outboundMessages?.[0] as any).text,
    "Código: RH-LG-12345",
  );
  assertEquals(
    result.reply,
    "Ya que vas a comprar… ¿quieres ahorrarte también el viaje?",
  );
  assertEquals(result.interactiveButtons, [
    { id: "referral_grocery:baskets", title: "Sí, ver las canastas" },
    { id: "referral_grocery:coupon_only", title: "No, ya tengo mi cupón" },
  ]);
});

Deno.test("coupon failure does not expose the prepared-basket upsell", async () => {
  const result = await handleReferralHubTurn({
    supabase: couponDatabase({
      error: { message: "coupon campaign not found" },
    }) as any,
    organizationId,
    leadId: "lead-id",
    leadState: profileState,
    inboundText: "",
    payloadAction: "referral_grocery:coupon",
    channel: "whatsapp",
  });

  assertStringIncludes(result.reply, "No pudimos preparar");
  assertEquals(result.outboundMessages, undefined);
  assertEquals(result.interactiveButtons, undefined);
  assertEquals(
    referralState(result).coupon_delivery_error,
    "coupon_campaign_missing",
  );
});

Deno.test("coupon and direct basket actions initialize the durable grocery state", async () => {
  const coupon = await handleReferralHubTurn({
    supabase: couponDatabase() as any,
    organizationId,
    leadId: "lead-id",
    leadState: profileState,
    inboundText: "",
    payloadAction: "referral_grocery:coupon",
    channel: "whatsapp",
  });
  const afterCoupon = await handleReferralHubTurn({
    organizationId,
    leadState: coupon.statePatch,
    inboundText: "",
    payloadAction: "referral_grocery:baskets",
    channel: "whatsapp",
  });
  const direct = await handleReferralHubTurn({
    organizationId,
    leadState: profileState,
    inboundText: "",
    payloadAction: "referral_grocery:baskets",
    channel: "whatsapp",
  });

  for (const result of [afterCoupon, direct]) {
    const state = referralState(result);
    assertEquals(result.debugNote, "referral_hub:grocery_zip");
    assertStringIncludes(result.reply, "canastas ya vienen preparadas");
    assertEquals((state.grocery as Record<string, unknown>).step, "zip");
    assertEquals(
      (state.grocery as Record<string, unknown>).customerName,
      "Luis Gabriel",
    );
    assertEquals(state.pantry_demo, undefined);
  }
});

Deno.test("the production router continues durable grocery before generic profile intake", async () => {
  const started = await handleReferralHubTurn({
    organizationId,
    leadState: null,
    inboundText: "",
    payloadAction: "referral_grocery:baskets",
    channel: "whatsapp",
  });
  const zip = await handleReferralHubTurn({
    supabase: groceryDatabase() as any,
    organizationId,
    leadId: "lead-id",
    channelUserId: "+14045551212",
    leadState: started.statePatch,
    inboundText: "30345",
    channel: "whatsapp",
  });

  assertEquals(zip.debugNote, "referral_hub:grocery_offers");
  assertEquals(
    zip.interactiveList?.sections[0].rows[0].id,
    `grocery_offer:${offerId}`,
  );
  assertEquals(
    (referralState(zip).grocery as Record<string, unknown>).step,
    "offer",
  );
  assert(!zip.reply.includes("nombre completo"));
});

Deno.test("coupon upsell keeps ZIP in the durable grocery transaction before profile collection", async () => {
  const coupon = await handleReferralHubTurn({
    supabase: couponDatabase() as any,
    organizationId,
    leadId: "lead-id",
    leadState: {
      collected: { referral_hub: { profile_name: "Jose", profile_city: null } },
    },
    inboundText: "",
    payloadAction: "referral_grocery:coupon",
    channel: "whatsapp",
  });
  const baskets = await handleReferralHubTurn({
    organizationId,
    leadState: coupon.statePatch,
    inboundText: "",
    payloadAction: "referral_grocery:baskets",
    channel: "whatsapp",
  });
  const zip = await handleReferralHubTurn({
    supabase: groceryDatabase() as any,
    organizationId,
    leadId: "lead-id",
    channelUserId: "+14045551212",
    leadState: baskets.statePatch,
    inboundText: "30345",
    channel: "whatsapp",
  });

  assertEquals(zip.debugNote, "referral_hub:grocery_offers");
  assertEquals(
    (referralState(zip).grocery as Record<string, unknown>).step,
    "offer",
  );
  assert(!zip.reply.includes("¿En qué ciudad vives?"));
  assert(!zip.reply.includes("Un coordinador debe revisarla"));
});

Deno.test("canonical Luis supermarket copy matches the $10 campaign and image", async () => {
  const entry = await handleReferralHubTurn({
    organizationId,
    leadState: null,
    inboundText: "Supermercado",
    channel: "whatsapp",
  });
  const coupon = await handleReferralHubTurn({
    supabase: couponDatabase() as any,
    organizationId,
    leadId: "lead-id",
    leadState: entry.statePatch,
    inboundText: "",
    payloadAction: "referral_grocery:coupon",
    channel: "whatsapp",
  });

  assertStringIncludes(entry.reply, "cupón de $10");
  assertEquals(
    (coupon.outboundMessages?.[1] as any).url,
    "https://referral.creatyv.io/images/coupons/lg-supermarket-coupon.jpeg",
  );
  assertEquals(coupon.outboundMessages?.map((message) => message.type), [
    "text",
    "image",
  ]);
  assertStringIncludes(
    (coupon.outboundMessages?.[0] as any).text,
    "Código: RH-LG-12345",
  );
  assertEquals(
    coupon.reply,
    "Ya que vas a comprar… ¿quieres ahorrarte también el viaje?",
  );
});
