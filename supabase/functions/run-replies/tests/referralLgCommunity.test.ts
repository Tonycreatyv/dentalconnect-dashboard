import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { handleReferralHubTurn } from "../domain/referralHub/genericMenuRouter.ts";

type LeadState = Record<string, unknown>;

async function turn(
  leadState: LeadState | null,
  inboundText: string,
  payloadAction?: string,
  organizationId = "luis-gabriel-referral-hub",
  channel: "messenger" | "whatsapp" = "whatsapp",
): Promise<{
  reply: string;
  statePatch: LeadState;
  interactiveList?: { sections: Array<{ rows: Array<{ title: string; description?: string }> }> };
  interactiveButtons?: Array<{ id: string; title: string }>;
}> {
  const result = await handleReferralHubTurn({
    organizationId,
    leadState,
    inboundText,
    payloadAction,
    channel,
  });
  return {
    reply: result.reply,
    statePatch: result.statePatch as LeadState,
    interactiveList: result.interactiveList,
    interactiveButtons: result.interactiveButtons,
  };
}

function referralState(state: LeadState): any {
  return (state.collected as any)?.referral_hub ?? {};
}

async function profileCompleteState() {
  const first = await turn(null, "hola");
  const second = await turn(first.statePatch as LeadState, "Luis Gabriel");
  return await turn(second.statePatch as LeadState, "Miami");
}

Deno.test("1. first-time welcome asks for full name", async () => {
  const result = await turn(null, "hola");
  assertStringIncludes(result.reply, "nombre completo");
  assertStringIncludes(result.reply, "LG Community Network");
});

Deno.test("2. second question asks for city", async () => {
  const first = await turn(null, "hola");
  const second = await turn(first.statePatch as LeadState, "Luis Gabriel");
  assertStringIncludes(second.reply, "Ciudad donde vive");
});

Deno.test("3. confirmation uses the collected name and city and includes privacy disclosure", async () => {
  const result = await profileCompleteState();
  assertStringIncludes(result.reply, "Gracias, Luis Gabriel");
  assertStringIncludes(result.reply, "Miami");
  assertStringIncludes(result.reply, "Tu información es confidencial");
  assertStringIncludes(result.reply, "menú");
});

Deno.test("4. STOP behavior is respected", async () => {
  const result = await turn(await profileCompleteState().then((state) => state.statePatch as LeadState), "STOP");
  const state = referralState(result.statePatch);
  assertStringIncludes(result.reply, "No seguiremos enviando");
  assertEquals(state.stop_requested, true);
});

Deno.test("5. the menu contains exactly eight options in the required order", async () => {
  const result = await profileCompleteState();
  const rows = result.interactiveList?.sections[0].rows ?? [];
  assertEquals(rows.length, 8);
  assertEquals(rows.map((row) => row.title), [
    "Accidentes",
    "Inmigración",
    "Cupón médico",
    "Cupón supermercado",
    "Cupón dental",
    "Eventos comunitarios",
    "Comida y apoyo",
    "Hablar con asesor",
  ]);
});

Deno.test("6. numeric choices 1-8 route correctly", async () => {
  const state = await profileCompleteState();
  const cases = [
    ["1", "Por tu seguridad"],
    ["2", "profesional de confianza"],
    ["3", "20% de descuento"],
    ["4", "cupón de $20"],
    ["5", "$29"],
    ["6", "eventos comunitarios"],
    ["7", "donar comida o recibir apoyo"],
    ["8", "miembro del equipo"],
  ] as const;

  for (const [input, expected] of cases) {
    const result = await turn(state.statePatch as LeadState, input);
    assertStringIncludes(result.reply, expected);
  }
});

Deno.test("7. natural-language intents route correctly", async () => {
  const state = await profileCompleteState();
  const result = await turn(state.statePatch as LeadState, "necesito ayuda por un accidente");
  assertStringIncludes(result.reply, "Por tu seguridad");
});

Deno.test("8. accident flow collects the required fields", async () => {
  const profile = await profileCompleteState();
  const first = await turn(profile.statePatch as LeadState, "1");
  const second = await turn(first.statePatch as LeadState, "2026-07-10");
  const third = await turn(second.statePatch as LeadState, "Miami");
  const fourth = await turn(third.statePatch as LeadState, "sí");
  const fifth = await turn(fourth.statePatch as LeadState, "Luis");
  const sixth = await turn(fifth.statePatch as LeadState, "555-1234");
  assertStringIncludes(sixth.reply, "solicitud recibida");
});

Deno.test("9. immigration flow collects a brief case type", async () => {
  const profile = await profileCompleteState();
  const first = await turn(profile.statePatch as LeadState, "2");
  const second = await turn(first.statePatch as LeadState, "Residencia");
  assertStringIncludes(second.reply, "Registramos tu solicitud");
});

Deno.test("10. medical coupon is distinct from the dental coupon", async () => {
  const profile = await profileCompleteState();
  const medical = await turn(profile.statePatch as LeadState, "3");
  const dental = await turn(profile.statePatch as LeadState, "5");
  assertStringIncludes(medical.reply, "20% de descuento");
  assertStringIncludes(dental.reply, "$29");
  assertStringIncludes(dental.reply, "limpieza");
});

Deno.test("11. supermarket coupon uses the existing grocery entry point", async () => {
  const profile = await profileCompleteState();
  const result = await turn(profile.statePatch as LeadState, "4");
  assertStringIncludes(result.reply, "cupón de $20");
  assertEquals(result.interactiveList?.sections[0].rows.length, 4);
});

Deno.test("12. community events do not invent data", async () => {
  const profile = await profileCompleteState();
  const result = await turn(profile.statePatch as LeadState, "6");
  assertStringIncludes(result.reply, "no tenemos eventos publicados");
});

Deno.test("13. food-support flow separates donation from requesting support", async () => {
  const profile = await profileCompleteState();
  const first = await turn(profile.statePatch as LeadState, "7");
  const donation = await turn(first.statePatch as LeadState, "Quiero donar");
  const support = await turn(profile.statePatch as LeadState, "7");
  const supportReply = await turn(support.statePatch as LeadState, "Necesito apoyo");
  assertStringIncludes(donation.reply, "tipo de donación");
  assertStringIncludes(supportReply.reply, "necesidad");
});

Deno.test("14. advisor option triggers human takeover", async () => {
  const profile = await profileCompleteState();
  const result = await turn(profile.statePatch as LeadState, "8");
  assertStringIncludes(result.reply, "miembro del equipo");
  assertEquals(referralState(result.statePatch).service_id, "luis_asesor");
});

Deno.test("15. menu reset preserves pantry state", async () => {
  const profile = await profileCompleteState();
  const stateWithPantry = {
    ...profile.statePatch,
    collected: {
      ...(profile.statePatch.collected as LeadState),
      referral_hub: {
        ...referralState(profile.statePatch),
        pantry_demo: {
          active: true,
          coupon: { code: "TEST-COUPON", issued_at: "2026-01-01T00:00:00Z", active: true },
        },
      },
    },
  } as LeadState;
  const reset = await turn(stateWithPantry, "MENU");
  const state = referralState(reset.statePatch);
  assertEquals(state.service_id, null);
  assertEquals(state.pantry_demo?.coupon?.code, "TEST-COUPON");
});

Deno.test("16. insurance-demo is not used automatically", async () => {
  const result = await turn(null, "hola", undefined, "luis-gabriel-referral-hub");
  assert(!result.reply.includes("insurance-demo"));
});

Deno.test("17. the router stays isolated from DentalConnect and BarberLine", async () => {
  const profile = await profileCompleteState();
  const result = await turn(profile.statePatch as LeadState, "8");
  assert(!result.reply.includes("DentalConnect"));
  assert(!result.reply.includes("BarberLine"));
});

Deno.test("18. Messenger menu uses the exact eight LG quick replies", async () => {
  const profile = await profileCompleteState();
  const result = await turn(profile.statePatch as LeadState, "menu", undefined, "luis-gabriel-referral-hub", "messenger");
  assertStringIncludes(result.reply, "¿En qué podemos ayudarte?");
  assertEquals(result.interactiveList, undefined);
  assertEquals(result.interactiveButtons, [
    { id: "referral_service:luis_accidente", title: "Accidentes" },
    { id: "referral_service:luis_inmigracion", title: "Inmigración" },
    { id: "referral_service:luis_cupon_medico", title: "Cupón médico" },
    { id: "referral_service:luis_cupon_super", title: "Cupón supermercado" },
    { id: "referral_service:luis_cupon_dental", title: "Cupón dental" },
    { id: "referral_service:luis_eventos", title: "Eventos" },
    { id: "referral_service:luis_donacion", title: "Comida y apoyo" },
    { id: "referral_service:luis_asesor", title: "Hablar con asesor" },
  ]);
});

async function immigrationInProgressState() {
  const profile = await profileCompleteState();
  return await turn(
    profile.statePatch as LeadState,
    "Inmigración",
    "referral_service:luis_inmigracion",
    "luis-gabriel-referral-hub",
    "messenger",
  );
}

Deno.test("19. Messenger quick reply switches immigration state to Events", async () => {
  const immigration = await immigrationInProgressState();
  const result = await turn(
    immigration.statePatch,
    "Eventos",
    "referral_service:luis_eventos",
    "luis-gabriel-referral-hub",
    "messenger",
  );
  const state = referralState(result.statePatch);
  assertEquals(state.service_id, "luis_eventos");
  assertEquals(state.current_field, null);
  assertStringIncludes(result.reply, "eventos comunitarios");
  assert(!result.reply.includes("migratoria"));
});

Deno.test("20. Messenger quick reply switches immigration state to Medical coupon", async () => {
  const immigration = await immigrationInProgressState();
  const result = await turn(
    immigration.statePatch,
    "Cupón médico",
    "referral_service:luis_cupon_medico",
    "luis-gabriel-referral-hub",
    "messenger",
  );
  const state = referralState(result.statePatch);
  assertEquals(state.service_id, "luis_cupon_medico");
  assertEquals(state.current_field, null);
  assertStringIncludes(result.reply, "20% de descuento");
  assert(!result.reply.includes("migratoria"));
});

Deno.test("21. Messenger quick reply switches immigration state to Supermarket coupon and preserves pantry state", async () => {
  const immigration = await immigrationInProgressState();
  const stateWithPantry = {
    ...immigration.statePatch,
    collected: {
      ...(immigration.statePatch.collected as LeadState),
      referral_hub: {
        ...referralState(immigration.statePatch),
        pantry_demo: { active: true, grocery_order: { id: "order-test" } },
      },
    },
  } as LeadState;
  const result = await turn(
    stateWithPantry,
    "Cupón supermercado",
    "referral_service:luis_cupon_super",
    "luis-gabriel-referral-hub",
    "messenger",
  );
  const state = referralState(result.statePatch);
  assertEquals(state.service_id, "luis_cupon_super");
  assertEquals(state.current_field, null);
  assertEquals(state.pantry_demo?.grocery_order?.id, "order-test");
  assertStringIncludes(result.reply, "cupón de $20");
  assert(!result.reply.includes("migratoria"));
});
