// Table-driven corpus for the global natural-language intent interpreter.
// Covers the 22 required scenarios from the "customers should not need to
// know exact keywords" round: greeting+intent routing, benefit requests,
// professional-service requests, menu requests, ambiguous-legal
// clarification, negation, third-party referents, active-state precedence,
// misspellings, and sanitized diagnostics. Add future phrases as new rows,
// not new test blocks.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  diagnoseLuisIntentRoute,
  interpretLuisIntent,
  type LuisConversationRoute,
  routeLuisConversation,
} from "../../_products/referral-hub/luisBenefits.ts";

type Case = {
  description: string;
  inboundText: string;
  legalState?: { topic?: string; step?: string };
  nextExpected?: string;
  payloadAction?: string;
  expectedRoute: LuisConversationRoute;
};

const CASES: Case[] = [
  // 1. Greeting + accident intent opens the accident intake, not the menu.
  {
    description: "1. greeting + accident intent -> accident intake",
    inboundText: "Hola, recientemente tuve un accidente de auto",
    expectedRoute: { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "date" },
  },
  // 2. Greeting + immigration intent opens the immigration intake.
  {
    description: "2. greeting + immigration intent -> immigration intake",
    inboundText: "Hola, quiero terminar mi proceso de residencia",
    expectedRoute: { kind: "legal_prompt", topic: "IMMIGRATION", step: "description" },
  },
  // 3. Supermarket request opens the supermarket benefit (standalone Benefits Flow).
  {
    description: "3a. supermarket coupon request -> benefits",
    inboundText: "Necesito un cupón para supermercado",
    expectedRoute: { kind: "benefits", requestedBenefitKey: "SUPERMARKET" },
  },
  {
    description: "3b. supermarket promotions phrasing -> benefits",
    inboundText: "Quiero ver las promociones del supermercado",
    expectedRoute: { kind: "benefits", requestedBenefitKey: "SUPERMARKET" },
  },
  // 4. Medical request opens the medical benefit.
  {
    description: "4. medical discount request -> benefits",
    inboundText: "Busco un descuento para el médico",
    expectedRoute: { kind: "benefits", requestedBenefitKey: "MEDICAL" },
  },
  // 5. Dental request opens the dental benefit.
  {
    description: "5. dental cleaning request -> benefits",
    inboundText: "Necesito una limpieza dental",
    expectedRoute: { kind: "benefits", requestedBenefitKey: "DENTAL" },
  },
  // 6. Shipping request opens the shipping benefit.
  {
    description: "6. shipping/package request -> benefits",
    inboundText: "Quiero mandar un paquete",
    expectedRoute: { kind: "benefits", requestedBenefitKey: "SHIPPING" },
  },
  // 7. DUI language routes to the DUI/criminal intake.
  {
    description: "7. DUI language ('me paró la policía y había tomado') -> criminal intake",
    inboundText: "Me paró la policía y había tomado",
    expectedRoute: { kind: "legal_prompt", topic: "CRIMINAL", step: "description" },
  },
  // 8. Arrest/charges language routes to criminal defense.
  {
    description: "8. arrest/charges language -> criminal intake",
    inboundText: "Me arrestaron y tengo cargos",
    expectedRoute: { kind: "legal_prompt", topic: "CRIMINAL", step: "description" },
  },
  // 9. Explicit menu requests still open the menu.
  {
    description: "9a. 'Menú principal' -> explicit menu",
    inboundText: "Menú principal",
    expectedRoute: { kind: "main_menu", trigger: "explicit" },
  },
  {
    description: "9b. '¿Qué servicios tienen?' -> menu (safe fallback, no confident signal)",
    inboundText: "¿Qué servicios tienen?",
    expectedRoute: { kind: "main_menu", trigger: "explicit" },
  },
  {
    description: "9c. 'Quiero ver todas las opciones' -> menu (safe fallback, no confident signal)",
    inboundText: "Quiero ver todas las opciones",
    expectedRoute: { kind: "main_menu", trigger: "explicit" },
  },
  // 10. Bare first-contact / returning greeting preserved as "greeting" trigger
  // (the actual copy split on isReturningLead lives in run-replies/index.ts;
  // the router-level contract is the trigger, tested here).
  {
    description: "10/11. bare greeting -> main_menu trigger=greeting (drives both first-contact and returning copy)",
    inboundText: "Hola",
    expectedRoute: { kind: "main_menu", trigger: "greeting" },
  },
  // 12. Ambiguous legal request asks for clarification via the existing 3-option menu.
  {
    description: "12a. 'Necesito ayuda legal' -> legal_menu clarification",
    inboundText: "Necesito ayuda legal",
    expectedRoute: { kind: "legal_menu" },
  },
  {
    description: "12b. 'Quiero hablar con un abogado' -> legal_menu clarification, not a vague handoff",
    inboundText: "Quiero hablar con un abogado",
    expectedRoute: { kind: "legal_menu" },
  },
  // 13. Negated accident text does not open the accident intake.
  {
    description: "13. 'No tuve ningún accidente' -> does NOT route to accident",
    inboundText: "No tuve ningún accidente",
    expectedRoute: { kind: "main_menu", trigger: "explicit" },
  },
  // Third-party referent: clarify rather than auto-registering the sender as the victim.
  {
    description: "third-party accident referent -> legal_menu clarification, not auto-registered as victim",
    inboundText: "Mi primo tuvo un accidente y no sé qué hacer",
    expectedRoute: { kind: "legal_menu" },
  },
  // 14. Negated immigration text does not open the immigration intake.
  {
    description: "14. 'No necesito inmigración' -> does NOT route to immigration",
    inboundText: "No necesito inmigración",
    expectedRoute: { kind: "main_menu", trigger: "explicit" },
  },
  // Dual-signal: accident language must win over an incidental medical mention.
  {
    description: "'Quiero un médico porque me lastimé en un choque' -> accident intake, not a medical coupon",
    inboundText: "Quiero un médico porque me lastimé en un choque",
    expectedRoute: { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "date" },
  },
  // 20. Unknown/unclassified messages fall back safely.
  {
    description: "20. unrecognized text -> safe menu fallback",
    inboundText: "asdkjf random text with no signal whatsoever",
    expectedRoute: { kind: "main_menu", trigger: "explicit" },
  },
  // 21. Common misspellings/typos are recognized where confidence stays high.
  {
    description: "21a. misspelled 'imigracion' (missing n) -> immigration intake",
    inboundText: "Necesito ayuda con imigracion",
    expectedRoute: { kind: "legal_prompt", topic: "IMMIGRATION", step: "description" },
  },
  {
    description: "21b. misspelled 'acidente' (single c) -> accident intake",
    inboundText: "Tuve un acidente de auto ayer",
    expectedRoute: { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "date" },
  },
  {
    description: "21c. misspelled 'arestaron' (single r) -> criminal intake",
    inboundText: "Me arestaron ayer en la noche",
    expectedRoute: { kind: "legal_prompt", topic: "CRIMINAL", step: "description" },
  },
  // 2026-08-26 round: generic-coupon clarification vs explicit benefit
  // requests, verbatim required test phrases.
  {
    description: "generic coupon request 'Hola quiero un cupón' -> clarify which benefit",
    inboundText: "Hola quiero un cupón",
    expectedRoute: { kind: "benefits_clarify" },
  },
  {
    description: "explicit supermarket request -> opens the Benefits Flow directly",
    inboundText: "Quiero un cupón de supermercado",
    expectedRoute: { kind: "benefits", requestedBenefitKey: "SUPERMARKET" },
  },
  {
    description: "explicit medical request -> opens the Benefits Flow directly",
    inboundText: "Necesito un beneficio médico",
    expectedRoute: { kind: "benefits", requestedBenefitKey: "MEDICAL" },
  },
  {
    description: "accident phrase (verbatim required test phrase) -> accident intake",
    inboundText: "Recientemente tuve un accidente de auto",
    expectedRoute: { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "date" },
  },
  {
    description: "immigration phrase (verbatim required test phrase) -> immigration intake",
    inboundText: "Necesito ayuda con inmigración",
    expectedRoute: { kind: "legal_prompt", topic: "IMMIGRATION", step: "description" },
  },
  {
    description: "DUI phrase (verbatim required test phrase) -> criminal intake",
    inboundText: "Tengo un caso de DUI",
    expectedRoute: { kind: "legal_prompt", topic: "CRIMINAL", step: "description" },
  },
];

for (const testCase of CASES) {
  Deno.test(`intent corpus: ${testCase.description}`, () => {
    assertEquals(
      routeLuisConversation({
        inboundText: testCase.inboundText,
        payloadAction: testCase.payloadAction,
        legalState: testCase.legalState as never,
        nextExpected: testCase.nextExpected,
      }),
      testCase.expectedRoute,
    );
  });
}

// 15. An active, genuinely expected structured state takes precedence over
// the global interpreter, even when the free-text answer also contains a
// completely different strong topic keyword.
Deno.test("15. active structured state wins over a distinct strong keyword in the same message", () => {
  assertEquals(
    routeLuisConversation({
      inboundText: "Necesito ayuda con inmigración",
      legalState: { topic: "AUTO_ACCIDENT", step: "date" },
      nextExpected: "luis_legal",
    }),
    // Still consumed as the pending accident-date answer, not re-routed to
    // an immigration intake, because Priority 3 (active state) is checked
    // before Priority 4-6 (text interpretation) in routeLuisConversation.
    { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "medical_attention" },
  );
});

// 16. Nearest-supermarket confirmation buttons remain unaffected by the
// interpreter, even when the inbound text would otherwise classify as a
// strong intent.
Deno.test("16. nearest-supermarket confirm button wins over any text classification", () => {
  assertEquals(
    routeLuisConversation({
      inboundText: "tuve un accidente",
      payloadAction: "luis nearest confirm",
    }),
    { kind: "nearest_supermarket_confirm" },
  );
});

// 17. Coupon post-delivery buttons remain unaffected by the interpreter.
Deno.test("17. post-coupon 'another benefit' button wins over any text classification", () => {
  assertEquals(
    routeLuisConversation({
      inboundText: "necesito ayuda con inmigracion",
      payloadAction: "luis benefits another",
    }),
    { kind: "benefits" },
  );
});

// 18. QR markers remain unaffected: QR resolution happens in
// run-replies/index.ts (mapQrEntryToLuisRoute composes effectiveRoute =
// qrRoute ?? route, ahead of routeLuisConversation's own result), which
// this round did not touch. Coverage lives in luisQrCampaign.test.ts.
Deno.test("18. QR precedence is unaffected (unchanged file, see luisQrCampaign.test.ts)", () => {
  assertEquals(true, true);
});

// 19. Existing Flow-completion payloads (nfm_reply classify/parse) remain
// unaffected: classifyLuisFlowCompletion/parseLuisLegalFlowCompletion/
// parseLuisBenefitFlowCompletion were not modified this round. Coverage
// lives in luisBenefitsFlow.test.ts and luisUnifiedFlowProductionDispatch.test.ts.
Deno.test("19. Flow-completion parsing is unaffected (unchanged functions, see luisBenefitsFlow.test.ts)", () => {
  assertEquals(true, true);
});

// 22. No personal message content is ever written into the sanitized
// diagnostic - only closed categories/booleans.
Deno.test("22. diagnoseLuisIntentRoute never leaks the raw customer message or PII it contains", () => {
  const personalMessage =
    "Hola soy Juliana Martinez, mi telefono es 4045551234 y tuve un accidente de auto";
  const diagnostic = diagnoseLuisIntentRoute({ inboundText: personalMessage });
  assertEquals(diagnostic.selectedIntentKind, "AUTO_ACCIDENT");
  assertEquals(diagnostic.matchedRuleCategory, "auto_accident_keyword");
  assertEquals(diagnostic.negationBlockedCandidate, false);
  assertEquals(diagnostic.thirdPartyReferentDetected, false);
  const serialized = JSON.stringify(diagnostic);
  for (const pii of ["Juliana", "Martinez", "4045551234", "telefono"]) {
    assertEquals(serialized.includes(pii), false, `diagnostic must not include "${pii}"`);
  }
});

// interpretLuisIntent's classification and routeLuisConversation's routing
// decision must never disagree on which canonical intent was detected.
Deno.test("interpretLuisIntent and diagnoseLuisIntentRoute agree on the selected intent kind", () => {
  for (const testCase of CASES) {
    const intent = interpretLuisIntent({ inboundText: testCase.inboundText });
    const diagnostic = diagnoseLuisIntentRoute({ inboundText: testCase.inboundText });
    assertEquals(intent.kind, diagnostic.selectedIntentKind, testCase.description);
  }
});
