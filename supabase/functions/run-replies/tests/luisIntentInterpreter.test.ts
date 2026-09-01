import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyLuisFlowCompletion,
  interpretLuisIntent,
  isLuisLegalIntakeActive,
  parseLuisBenefitFlowCompletion,
  routeLuisConversation,
} from "../../_products/referral-hub/luisBenefits.ts";

const workerSource = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

// --- GENERAL ENTRY (Part 9: 1-6) -------------------------------------------

for (
  const [text, trigger] of [
    ["Hola", "greeting"],
    ["Buenas", "greeting"],
    ["Necesito ayuda", "explicit"],
    ["Qué servicios tienen", "explicit"],
    ["Tengo una consulta", "explicit"],
    ["asdkjf random text with no signal whatsoever", "explicit"],
  ] as const
) {
  Deno.test(`general entry "${text}" -> unified Flow (main_menu, trigger=${trigger})`, () => {
    assertEquals(routeLuisConversation({ inboundText: text }), { kind: "main_menu", trigger });
  });
}

// --- SPECIFIC INTENT (Part 9: 7-12) ----------------------------------------

Deno.test("immigration phrasing classifies as IMMIGRATION and routes to the existing legal text intake", () => {
  assertEquals(
    interpretLuisIntent({ inboundText: "Necesito ayuda con inmigración" }),
    { kind: "IMMIGRATION" },
  );
  // A confidently classified specific intent now opens the existing,
  // already-functional, non-Meta-Flow legal text intake directly (the same
  // target the "luis legal immigration" payload action already reaches),
  // instead of being discarded down to the generic menu.
  assertEquals(
    routeLuisConversation({ inboundText: "Necesito ayuda con inmigración" }),
    { kind: "legal_prompt", topic: "IMMIGRATION", step: "description" },
  );
});

Deno.test("auto accident phrasing classifies as AUTO_ACCIDENT and routes to the existing legal text intake", () => {
  assertEquals(
    interpretLuisIntent({ inboundText: "Me chocaron ayer" }),
    { kind: "AUTO_ACCIDENT" },
  );
  assertEquals(
    routeLuisConversation({ inboundText: "Me chocaron ayer" }),
    { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "date" },
  );
});

Deno.test("DUI/criminal phrasing classifies as DUI_CRIMINAL and routes to the existing legal text intake", () => {
  assertEquals(
    interpretLuisIntent({ inboundText: "Tengo un DUI" }),
    { kind: "DUI_CRIMINAL" },
  );
  // DUI and general criminal-defense share one CRIMINAL topic, matching the
  // existing legal-intake grouping (immigration stays separate).
  assertEquals(
    routeLuisConversation({ inboundText: "Tengo un DUI" }),
    { kind: "legal_prompt", topic: "CRIMINAL", step: "description" },
  );
});

Deno.test("supermarket coupon phrasing classifies as BENEFITS/SUPERMARKET and its normal-entry route opens the existing standalone Benefits Flow", () => {
  assertEquals(
    interpretLuisIntent({ inboundText: "Quiero un cupón del supermercado" }),
    { kind: "BENEFITS", benefitKey: "SUPERMARKET" },
  );
  // A confidently classified BENEFITS intent now opens the existing
  // standalone Benefits Flow ({kind:"benefits"}, the same target the "luis
  // main benefits" payload action already reaches) instead of the generic
  // menu. requestedBenefitKey is a COPY hint only (2026-08-26: lets the
  // Flow CTA name the specific benefit) - never a screen selector, since
  // neither Flow has a per-benefit pre-selection entry point (verified
  // against Meta's own routing-model rules - see
  // luisBenefitsFlowFallback.test.ts's structural-proof tests) and adding
  // one would mean changing the Flow itself, out of scope. The customer
  // still picks the specific benefit on the very next screen.
  const route = routeLuisConversation({ inboundText: "Quiero un cupón del supermercado" });
  assertEquals(route, { kind: "benefits", requestedBenefitKey: "SUPERMARKET" });
});

Deno.test("'Necesito ayuda con beneficios' (generic, no specific benefit named) asks which benefit instead of guessing", () => {
  assertEquals(
    routeLuisConversation({ inboundText: "Necesito ayuda con beneficios" }),
    { kind: "benefits_clarify" },
  );
});

Deno.test("explicit campaign-trigger routing to the legacy Benefits Flow remains higher priority and unchanged", () => {
  // Item 4: the one approved flyer phrase still opens the legacy standalone
  // Benefits Flow directly - campaign triggers are explicitly exempt from
  // the unified-Flow-only rule, per the approved product architecture.
  assertEquals(
    routeLuisConversation({ inboundText: "Hola, quiero activar mis beneficios." }),
    { kind: "benefits", directCampaignEntry: true },
  );
  // And explicit payload/action routes to the legacy Flow are untouched too.
  assertEquals(
    routeLuisConversation({ inboundText: "", payloadAction: "luis_main:benefits" }),
    { kind: "benefits" },
  );
});

Deno.test("an explicit human request classifies as HANDOFF and routes to the existing human_handoff", () => {
  assertEquals(
    interpretLuisIntent({ inboundText: "Quiero hablar con alguien" }),
    { kind: "HANDOFF" },
  );
  assertEquals(
    routeLuisConversation({ inboundText: "Quiero hablar con alguien" }),
    { kind: "human_handoff" },
  );
  assertEquals(
    interpretLuisIntent({ inboundText: "Necesito hablar con una persona" }),
    { kind: "HANDOFF" },
  );
  assertEquals(
    interpretLuisIntent({ inboundText: "Necesito una persona" }),
    { kind: "HANDOFF" },
  );
});

Deno.test("generic 'necesito ayuda' is NOT classified as HANDOFF", () => {
  assertEquals(interpretLuisIntent({ inboundText: "Necesito ayuda" }), { kind: "GENERAL_ENTRY" });
  assertEquals(routeLuisConversation({ inboundText: "Necesito ayuda" }), { kind: "main_menu", trigger: "explicit" });
});

Deno.test("BENEFITS Flow completion still uses the existing claim lifecycle, untouched by this correction", () => {
  // Item 5: this correction only changed which Flow CTA a normal-language
  // BENEFITS *entry* opens. Completion handling (classify/parse/RPC) was
  // never touched - re-assert the same contract proven in
  // luisUnifiedFlowProductionDispatch.test.ts to keep this explicit here.
  const payload = {
    service_key: "BENEFITS",
    benefit_key: "SUPERMARKET",
    full_name: "Ana López",
    postal_code: "30071",
    email: "",
    marketing_consent: false,
  };
  assertEquals(classifyLuisFlowCompletion(payload), "BENEFITS");
  assertEquals(parseLuisBenefitFlowCompletion(payload)?.benefit_key, "SUPERMARKET");
  assertEquals(parseLuisBenefitFlowCompletion(payload)?.postal_code, "30071");
  assertEquals(
    workerSource.split('args.supabase.rpc("request_referral_benefit_claim"').length - 1,
    1,
  );
});

// --- ACTIVE STATE (Part 9: 13-17) ------------------------------------------

Deno.test("a genuinely active legal description step consumes a real free-text answer", () => {
  assertEquals(
    routeLuisConversation({
      inboundText: "Perdí mi trabajo hace dos semanas y no sé qué opciones tengo",
      legalState: { topic: "IMMIGRATION", step: "description" },
      nextExpected: "luis_legal",
    }),
    { kind: "legal_complete", topic: "IMMIGRATION" },
  );
});

Deno.test("a genuinely active accident intake step consumes a real free-text answer", () => {
  assertEquals(
    routeLuisConversation({
      inboundText: "10 de agosto",
      legalState: { topic: "AUTO_ACCIDENT", step: "date" },
      nextExpected: "luis_legal",
    }),
    { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "medical_attention" },
  );
});

Deno.test("stale legal state + 'Hola' -> unified Flow, not stale completion", () => {
  assertEquals(
    routeLuisConversation({
      inboundText: "Hola",
      legalState: { topic: "IMMIGRATION", step: "description" },
      // nextExpected intentionally omitted/stale - nothing currently expects
      // an answer for this abandoned intake.
    }),
    { kind: "main_menu", trigger: "greeting" },
  );
});

Deno.test("stale legal state + 'Necesito ayuda' -> unified Flow, not stale completion", () => {
  assertEquals(
    routeLuisConversation({
      inboundText: "Necesito ayuda",
      legalState: { topic: "IMMIGRATION", step: "description" },
    }),
    { kind: "main_menu", trigger: "explicit" },
  );
});

Deno.test("stale legal state + a specific new-topic request -> the new intent, not the stale completion", () => {
  // Stale DUI_CRIMINAL intake, but the customer is now clearly asking about
  // immigration instead - must not be swallowed as the old DUI answer, and
  // must open the immigration intake directly rather than falling back to
  // the menu.
  assertEquals(
    routeLuisConversation({
      inboundText: "Necesito ayuda con inmigración",
      legalState: { topic: "CRIMINAL", step: "description" },
    }),
    { kind: "legal_prompt", topic: "IMMIGRATION", step: "description" },
  );
  assertEquals(
    interpretLuisIntent({ inboundText: "Necesito ayuda con inmigración" }),
    { kind: "IMMIGRATION" },
  );
});

Deno.test("isLuisLegalIntakeActive requires both a real pending step and nextExpected pointing at it", () => {
  assertEquals(
    isLuisLegalIntakeActive({
      legalState: { topic: "IMMIGRATION", step: "description" },
      nextExpected: "luis_legal",
    }),
    true,
  );
  assertEquals(
    isLuisLegalIntakeActive({
      legalState: { topic: "IMMIGRATION", step: "description" },
      nextExpected: undefined,
    }),
    false,
  );
  assertEquals(
    isLuisLegalIntakeActive({
      legalState: { topic: "IMMIGRATION", step: "completed" },
      nextExpected: "luis_legal",
    }),
    false,
  );
  assertEquals(isLuisLegalIntakeActive({ legalState: null, nextExpected: "luis_legal" }), false);
});

// --- NAVIGATION / PAYLOAD (Part 9: 18-20) -----------------------------------

Deno.test("MENU and MENÚ route to the unified Flow", () => {
  assertEquals(routeLuisConversation({ inboundText: "MENU" }), { kind: "main_menu", trigger: "explicit" });
  assertEquals(routeLuisConversation({ inboundText: "MENÚ" }), { kind: "main_menu", trigger: "explicit" });
});

Deno.test("existing payloadAction routes remain higher priority than any interpreted text", () => {
  // Text that would otherwise classify as HANDOFF must not override an
  // explicit button payload for a completely different action.
  assertEquals(
    routeLuisConversation({
      inboundText: "Quiero hablar con alguien",
      payloadAction: "luis_legal:immigration",
    }),
    { kind: "legal_prompt", topic: "IMMIGRATION", step: "description" },
  );
});

Deno.test("an explicit HANDOFF Flow completion still produces the human handoff, unaffected by the interpreter", () => {
  const handoffBranch = workerSource.indexOf('} else if (completionKind === "HANDOFF")');
  assert(handoffBranch >= 0);
  const branchBody = workerSource.slice(handoffBranch, handoffBranch + 700);
  assert(branchBody.includes("await luisHumanHandoffResult({"));
});

// --- FUTURE-SAFETY (Part 9: 21-25) -----------------------------------------

Deno.test("interpreter result is a closed, typed enum", () => {
  const kinds = new Set([
    interpretLuisIntent({ inboundText: "Hola" }).kind,
    interpretLuisIntent({ inboundText: "Necesito ayuda con inmigración" }).kind,
    interpretLuisIntent({ inboundText: "Me chocaron ayer" }).kind,
    interpretLuisIntent({ inboundText: "Tengo un DUI" }).kind,
    interpretLuisIntent({ inboundText: "Quiero el cupón del supermercado" }).kind,
    interpretLuisIntent({ inboundText: "Quiero hablar con alguien" }).kind,
  ]);
  assertEquals(
    [...kinds].sort(),
    ["AUTO_ACCIDENT", "BENEFITS", "DUI_CRIMINAL", "HANDOFF", "IMMIGRATION", "MENU"].sort(),
  );
});

Deno.test("low-confidence/unrecognized text classifies as GENERAL_ENTRY", () => {
  assertEquals(interpretLuisIntent({ inboundText: "" }), { kind: "GENERAL_ENTRY" });
  assertEquals(interpretLuisIntent({ inboundText: "zzz qwerty 12345" }), { kind: "GENERAL_ENTRY" });
  assertEquals(interpretLuisIntent({ inboundText: null }), { kind: "GENERAL_ENTRY" });
});

Deno.test("no interpreter path performs a DB write, claim, appointment, handoff, or message send", () => {
  const start = workerSource.indexOf("export function interpretLuisIntent");
  assert(start === -1, "interpretLuisIntent must not live in run-replies/index.ts");
  const luisBenefitsSource = Deno.readTextFileSync(
    new URL("../../_products/referral-hub/luisBenefits.ts", import.meta.url),
  );
  const fnStart = luisBenefitsSource.indexOf("export function interpretLuisIntent");
  const fnEnd = luisBenefitsSource.indexOf("\n/**", fnStart + 1);
  const fnBody = luisBenefitsSource.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
  for (
    const forbidden of [
      ".insert(", ".update(", ".upsert(", ".rpc(", "supabase", "fetch(",
      "sendViaMetaAdapter", "recordHumanHandoffEvent",
    ]
  ) {
    assertEquals(fnBody.includes(forbidden), false, `interpretLuisIntent must not reference ${forbidden}`);
  }
});

Deno.test("existing TEST phone isolation remains intact", () => {
  const gated = workerSource.indexOf(
    "const testFlowIds = explicitMetaTestDemoContext ? LUIS_TEST_FLOW_IDS : null;",
  );
  assert(gated >= 0, "LUIS_TEST_FLOW_IDS must stay behind the explicit test-demo gate");
});

Deno.test("existing source Flow hash immutability remains green", async () => {
  const productDir = new URL("../../_products/referral-hub/", import.meta.url);
  const sourceFlowHashes: Record<string, string> = {
    "luis-benefits-flow.json":
      "888d4f5af09fb4c938053afbfb353032d06dd133b6234487a848e1d5b7496269",
    "luis-immigration-flow.json":
      "57cdb97411aaa3ee066cd2a743eba0c7468d6006573a3e187c18760a4aacc81a",
    "luis-auto-accident-flow.json":
      "2f2e3523eeb006f984ff51951b7b62dcef0f4f6a3c6d4eaad069bce2ab44efde",
    "luis-dui-criminal-flow.json":
      "26b52abfb9e0704dbb918d4eebcb97ca34bbadb4dd6153acb0e3b4553b7dc759",
  };
  async function sha256(source: string) {
    const bytes = new TextEncoder().encode(source);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  for (const [name, expectedHash] of Object.entries(sourceFlowHashes)) {
    assertEquals(
      await sha256(await Deno.readTextFile(new URL(name, productDir))),
      expectedHash,
      name,
    );
  }
});
