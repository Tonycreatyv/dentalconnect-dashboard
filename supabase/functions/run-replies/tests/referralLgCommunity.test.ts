import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
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
  interactiveList?: {
    sections: Array<{ rows: Array<{ title: string; description?: string }> }>;
  };
  interactiveButtons?: Array<{ id: string; title: string }>;
  debugNote?: string;
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
    debugNote: result.debugNote,
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
  assertEquals(
    result.reply,
    "¡Hola! 👋 Soy el asistente de LG Community Network.\n\nPara comenzar, ¿cuál es tu nombre completo?",
  );
});

Deno.test("2. second question asks for city", async () => {
  const first = await turn(null, "hola");
  const second = await turn(first.statePatch as LeadState, "Luis Gabriel");
  assertEquals(second.reply, "Mucho gusto, Luis. ¿En qué ciudad vives?");
  assert(!second.reply.includes("¡Hola!"));
});

Deno.test("3. confirmation uses the collected name and city and includes privacy disclosure", async () => {
  const result = await profileCompleteState();
  assertStringIncludes(
    result.reply,
    "Perfecto, Luis. ¿En qué podemos ayudarte hoy?",
  );
  assertStringIncludes(result.reply, "Usaremos tus datos únicamente");
  assert(!result.reply.includes("¡Hola!"));
});

Deno.test("4. STOP behavior is respected", async () => {
  const result = await turn(
    await profileCompleteState().then((state) => state.statePatch as LeadState),
    "STOP",
  );
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
    "Compras supermercado",
    "Hablar con asesor",
  ]);
});

Deno.test("6. numeric choices 1-8 route correctly", async () => {
  const state = await profileCompleteState();
  const cases = [
    ["1", "Lamento que estés pasando por esto"],
    ["2", "profesional de confianza"],
    ["3", "No pudimos preparar"],
    ["4", "No pudimos preparar"],
    ["5", "No pudimos preparar"],
    ["6", "eventos comunitarios"],
    ["7", "código postal"],
    ["8", "No pudimos completar la solicitud"],
  ] as const;

  for (const [input, expected] of cases) {
    const result = await turn(state.statePatch as LeadState, input);
    assertStringIncludes(result.reply, expected);
  }
});

Deno.test("7. natural-language intents route correctly", async () => {
  const state = await profileCompleteState();
  const result = await turn(
    state.statePatch as LeadState,
    "necesito ayuda por un accidente",
  );
  assertStringIncludes(result.reply, "Lamento que estés pasando por esto");
});

Deno.test("8. accident flow collects the required fields", async () => {
  const profile = await profileCompleteState();
  const first = await turn(profile.statePatch as LeadState, "1");
  const second = await turn(first.statePatch as LeadState, "2026-07-10");
  const third = await turn(second.statePatch as LeadState, "Miami");
  assertEquals(third.interactiveButtons?.map((button) => button.title), [
    "Sí",
    "No",
    "No estoy seguro",
  ]);
  const fourth = await turn(third.statePatch as LeadState, "No");
  const fifth = await turn(fourth.statePatch as LeadState, "Luis");
  const sixth = await turn(fifth.statePatch as LeadState, "555-1234");
  assertStringIncludes(sixth.reply, "Confirma si deseas enviar");
  assertEquals(sixth.interactiveButtons?.map((button) => button.title), [
    "Enviar solicitud",
    "Cancelar",
  ]);
  const confirmed = await turn(
    sixth.statePatch as LeadState,
    "Enviar solicitud",
    "referral_submit:luis_accidente:yes",
  );
  assertEquals(confirmed.debugNote, "referral_hub:accident_complete");
  assertStringIncludes(confirmed.reply, "No pudimos completar la solicitud");
  assert(!confirmed.reply.includes("te contactará en breve"));
});

Deno.test("22. city typo is a candidate and is not saved until confirmation", async () => {
  const first = await turn(null, "hola");
  const named = await turn(first.statePatch, "Luis Gabriel");
  const candidate = await turn(
    named.statePatch,
    "altnata",
    undefined,
    "luis-gabriel-referral-hub",
    "messenger",
  );
  assertStringIncludes(candidate.reply, "¿Te refieres a Atlanta, Georgia?");
  assertEquals(referralState(candidate.statePatch).profile_city, null);
  assertEquals(candidate.interactiveButtons?.map((button) => button.title), [
    "Sí, Atlanta",
    "Es otra ciudad",
  ]);
  const confirmed = await turn(
    candidate.statePatch,
    "Sí, Atlanta",
    "referral_field_confirm:profile_city:yes",
    "luis-gabriel-referral-hub",
    "messenger",
  );
  assertEquals(referralState(confirmed.statePatch).profile_city, "Atlanta");
});

Deno.test("23. city candidate can be rejected and corrected", async () => {
  const first = await turn(null, "hola");
  const named = await turn(first.statePatch, "Luis Gabriel");
  const candidate = await turn(named.statePatch, "altnata");
  const corrected = await turn(candidate.statePatch, "No, Marietta");
  assertEquals(referralState(corrected.statePatch).profile_city, "Marietta");
});

Deno.test("24. low-confidence city is re-asked and not saved", async () => {
  const first = await turn(null, "hola");
  const named = await turn(first.statePatch, "Luis Gabriel");
  const retried = await turn(named.statePatch, "?");
  assertStringIncludes(retried.reply, "No pude identificar la ciudad");
  assertEquals(referralState(retried.statePatch).profile_city, null);
});

Deno.test("25. greeting appears only on the first turn", async () => {
  const first = await turn(null, "hola");
  const named = await turn(first.statePatch, "Luis Gabriel");
  const city = await turn(named.statePatch, "Miami");
  assertEquals(
    [first.reply, named.reply, city.reply].filter((reply) =>
      reply.includes("¡Hola!")
    ).length,
    1,
  );
});

Deno.test("26. accident disclaimer appears near handoff, not service selection", async () => {
  const profile = await profileCompleteState();
  const selected = await turn(profile.statePatch, "1");
  assert(!selected.reply.includes("no ofrece asesoría legal"));
});

Deno.test("9. immigration flow collects a brief case type", async () => {
  const profile = await profileCompleteState();
  const first = await turn(profile.statePatch as LeadState, "2");
  const second = await turn(first.statePatch as LeadState, "Residencia");
  assertStringIncludes(second.reply, "Confirma si deseas enviar");
  const confirmed = await turn(
    second.statePatch as LeadState,
    "Enviar solicitud",
    "referral_submit:luis_inmigracion:yes",
  );
  assertEquals(confirmed.debugNote, "referral_hub:immigration_complete");
  assertStringIncludes(confirmed.reply, "No pudimos completar la solicitud");
});

Deno.test("10. coupon selections preserve their exact service when persistence is unavailable", async () => {
  const profile = await profileCompleteState();
  const medical = await turn(profile.statePatch as LeadState, "3");
  const dental = await turn(profile.statePatch as LeadState, "5");
  assertStringIncludes(medical.reply, "No pudimos preparar");
  assertStringIncludes(dental.reply, "No pudimos preparar");
  assertEquals(referralState(medical.statePatch).service_id, "luis_cupon_medico");
  assertEquals(referralState(dental.statePatch).service_id, "luis_cupon_dental");
  assertEquals(referralState(medical.statePatch).coupon_delivery_error, "coupon_persistence_unavailable");
  assertEquals(referralState(dental.statePatch).coupon_delivery_error, "coupon_persistence_unavailable");
});

Deno.test("11. supermarket coupon has no in-memory grocery fallback", async () => {
  const profile = await profileCompleteState();
  const result = await turn(profile.statePatch as LeadState, "4");
  assertStringIncludes(result.reply, "No pudimos preparar");
  assertEquals(result.interactiveList, undefined);
  assertEquals(referralState(result.statePatch).service_id, "luis_cupon_super");
  assertEquals(referralState(result.statePatch).coupon_delivery_error, "coupon_persistence_unavailable");
});

Deno.test("12. community events do not invent data", async () => {
  const profile = await profileCompleteState();
  const result = await turn(profile.statePatch as LeadState, "6");
  assertStringIncludes(result.reply, "no tenemos eventos publicados");
  assertEquals(result.debugNote, "referral_hub:service_events");
  assertEquals(result.interactiveButtons?.[0], {
    id: "referral_event:follow_up",
    title: "Avisarme",
  });
  const followUp = await turn(
    result.statePatch,
    "Avisarme",
    "referral_event:follow_up",
  );
  assertEquals(followUp.debugNote, "referral_hub:events_followup_requested");
  assertEquals(
    referralState(followUp.statePatch).last_completion.outcome,
    "follow_up_requested",
  );
});

Deno.test("13. grocery flow starts with real ZIP coverage collection", async () => {
  const profile = await profileCompleteState();
  const first = await turn(profile.statePatch as LeadState, "7");
  assertStringIncludes(first.reply, "precios y la cobertura disponibles");
  assertEquals(referralState(first.statePatch).service_id, "luis_compra_super");
});

Deno.test("14. advisor option triggers human takeover", async () => {
  const profile = await profileCompleteState();
  const result = await turn(profile.statePatch as LeadState, "8");
  assertEquals(
    result.reply,
    "No pudimos completar la solicitud en este momento. Inténtalo nuevamente o selecciona ‘Hablar con asesor’.",
  );
  assertEquals(referralState(result.statePatch).service_id, null);
  assertEquals(
    referralState(result.statePatch).last_completion.service_id,
    "luis_representante",
  );
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
          coupon: {
            code: "TEST-COUPON",
            issued_at: "2026-01-01T00:00:00Z",
            active: true,
          },
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
  const result = await turn(
    null,
    "hola",
    undefined,
    "luis-gabriel-referral-hub",
  );
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
  const result = await turn(
    profile.statePatch as LeadState,
    "menu",
    undefined,
    "luis-gabriel-referral-hub",
    "messenger",
  );
  assertEquals(
    result.reply,
    "Hola de nuevo, Luis. ¿En qué podemos ayudarte hoy?",
  );
  assertEquals(result.interactiveList, undefined);
  assertEquals(result.interactiveButtons, [
    { id: "referral_service:luis_accidente", title: "Accidentes" },
    { id: "referral_service:luis_inmigracion", title: "Inmigración" },
    { id: "referral_service:luis_cupon_medico", title: "Cupón médico" },
    { id: "referral_service:luis_cupon_super", title: "Cupón supermercado" },
    { id: "referral_service:luis_cupon_dental", title: "Cupón dental" },
    { id: "referral_service:luis_eventos", title: "Eventos" },
    { id: "referral_service:luis_compra_super", title: "Compras supermercado" },
    { id: "referral_service:luis_representante", title: "Hablar con asesor" },
  ]);
});

Deno.test("27. returning complete profile is greeted by name without repeating intake", async () => {
  const profile = await profileCompleteState();
  const result = await turn(
    profile.statePatch,
    "start",
    undefined,
    "luis-gabriel-referral-hub",
    "messenger",
  );
  assertEquals(
    result.reply,
    "Hola de nuevo, Luis. ¿En qué podemos ayudarte hoy?",
  );
  assertEquals(result.interactiveButtons?.length, 8);
  assert(!result.reply.includes("nombre completo"));
  assert(!result.reply.includes("ciudad vives"));
});

Deno.test("28. missing profile field asks only that field", async () => {
  const missingCity = {
    collected: {
      referral_hub: {
        profile_name: "Luis Gabriel",
        profile_city: null,
        profile_complete: false,
      },
    },
  };
  const result = await turn(missingCity, "hola");
  assertStringIncludes(result.reply, "¿En qué ciudad vives?");
  assert(!result.reply.includes("nombre completo"));
});

Deno.test("29. explicit profile edits replace only the selected value", async () => {
  const profile = await profileCompleteState();
  const askName = await turn(
    profile.statePatch,
    "",
    "referral_profile:change_name",
    "luis-gabriel-referral-hub",
    "messenger",
  );
  const changedName = await turn(
    askName.statePatch,
    "María López",
    undefined,
    "luis-gabriel-referral-hub",
    "messenger",
  );
  assertEquals(
    referralState(changedName.statePatch).profile_name,
    "María López",
  );
  assertEquals(referralState(changedName.statePatch).profile_city, "Miami");
  assertEquals(referralState(changedName.statePatch).current_field, null);
});

Deno.test("30. main menu postback uses concise copy and services postback is immediate", async () => {
  const profile = await profileCompleteState();
  const main = await turn(
    profile.statePatch,
    "",
    "referral_menu:main",
    "luis-gabriel-referral-hub",
    "messenger",
  );
  const services = await turn(
    profile.statePatch,
    "",
    "referral_menu:services",
    "luis-gabriel-referral-hub",
    "messenger",
  );
  assertEquals(main.reply, "Claro. ¿En qué podemos ayudarte?");
  assertEquals(services.reply, "¿En qué podemos ayudarte hoy?");
  assertEquals(main.interactiveButtons?.length, 8);
  assertEquals(services.interactiveButtons?.length, 8);
});

Deno.test("31. active coupon lookup is scoped to organization and lead and hides internal fields", async () => {
  const filters: Array<[string, string]> = [];
  const query: any = {
    select: () => query,
    eq: (column: string, value: string) => {
      filters.push([column, value]);
      return query;
    },
    order: () =>
      Promise.resolve({
        data: [{
          code: "LG-SAFE-123",
          status: "active",
          expires_at: "2026-12-31T00:00:00Z",
          referral_coupon_campaigns: { display_name: "Mi Tierra — cupón $10" },
        }],
        error: null,
      }),
  };
  const result = await handleReferralHubTurn({
    supabase: { from: () => query } as any,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-safe",
    leadState: (await profileCompleteState()).statePatch,
    inboundText: "",
    payloadAction: "referral_menu:my_coupons",
    channel: "messenger",
  });
  assertEquals(filters, [
    ["organization_id", "luis-gabriel-referral-hub"],
    ["lead_id", "lead-safe"],
    ["status", "active"],
  ]);
  assertStringIncludes(result.reply, "Mi Tierra — cupón $10");
  assertStringIncludes(result.reply, "LG-SAFE-123");
  assert(!result.reply.includes("public_token"));
  assert(!result.reply.includes("lead-safe"));
});

Deno.test("32. no active coupons uses exact empty-state copy", async () => {
  const query: any = {
    select: () => query,
    eq: () => query,
    order: () => Promise.resolve({ data: [], error: null }),
  };
  const result = await handleReferralHubTurn({
    supabase: { from: () => query } as any,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-safe",
    leadState: (await profileCompleteState()).statePatch,
    inboundText: "",
    payloadAction: "referral_menu:my_coupons",
    channel: "messenger",
  });
  assertEquals(result.reply, "Aún no tienes cupones activos.");
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
  assertEquals(state.service_id, null);
  assertEquals(state.last_completion.service_id, "luis_eventos");
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
