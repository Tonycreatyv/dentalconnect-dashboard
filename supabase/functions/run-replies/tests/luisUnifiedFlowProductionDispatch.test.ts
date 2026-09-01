import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyLuisFlowCompletion,
  LUIS_BENEFITS,
  luisUnifiedFlowCta,
  parseLuisBenefitFlowCompletion,
  parseLuisLegalFlowCompletion,
  routeLuisConversation,
} from "../../_products/referral-hub/luisBenefits.ts";
import { buildWhatsAppFlowCtaMessage } from "../../_shared/metaMessageAdapter.ts";

const workerSource = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

function sliceFunction(name: string) {
  const start = workerSource.indexOf(`function ${name}`);
  assert(start >= 0, `missing function ${name}`);
  const end = workerSource.indexOf("\nfunction ", start + 1);
  const endAsync = workerSource.indexOf("\nasync function ", start + 1);
  const candidates = [end, endAsync].filter((n) => n >= 0);
  return workerSource.slice(start, Math.min(...candidates));
}

// --- Items 1-2: normal entry and MENU reach the unified Flow CTA ---------

Deno.test("normal entry and MENU dispatch the unified Flow CTA before falling back to the legacy menu", () => {
  // effectiveRoute is route.kind unless a deterministic QR/flyer marker on
  // THIS turn's inboundText resolves to a different route (see
  // luisQrCampaign.ts) - main_menu is still exactly the route kind chosen
  // for both a normal first message (routeLuisConversation's default
  // fallback) and the MENU keyword (isLuisMainMenuCommand), proven
  // unchanged by luisConversationRouter.test.ts.
  const mainMenuBranch = workerSource.indexOf('if (effectiveRoute.kind === "main_menu")');
  assert(mainMenuBranch >= 0);
  // 600 (not the previous 400) - a stale fixed budget from before the
  // returning-customer contextualGreeting ternary was added drifted this
  // slice short of its own target string; widened with real margin instead
  // of tightening it again to the exact current byte count.
  const branchBody = workerSource.slice(mainMenuBranch, mainMenuBranch + 600);
  assertStringIncludes(branchBody, "luisUnifiedFlowEntryResult(");
  assertStringIncludes(branchBody, "args.orgSettings");
  assertStringIncludes(branchBody, "args.leadState");
  assertStringIncludes(branchBody, "luisMainMenuResult(args.leadState,");
});

Deno.test("the return-to-menu action also dispatches the unified Flow CTA", () => {
  const branch = workerSource.indexOf('if (route.kind === "post_benefit_menu")');
  assert(branch >= 0);
  const branchBody = workerSource.slice(branch, branch + 500);
  assertStringIncludes(branchBody, "luisUnifiedFlowEntryResult(args.orgSettings, args.leadState, contextualGreeting)");
  assertStringIncludes(branchBody, "luisMainMenuResult(args.leadState, contextualGreeting)");
});

// --- Items 3-4: canonical config key only, never a TEST Flow ID ----------

Deno.test("the unified Flow CTA reads only the canonical production config key", () => {
  const fn = sliceFunction("luisUnifiedFlowEntryResult");
  assertStringIncludes(fn, "getIntegrationsConfig(orgSettings)");
  assertStringIncludes(fn, "integrations.luis_unified_flow_id");
  assertEquals(fn.includes("TEST_FLOW_ID"), false);
  assertEquals(fn.includes("LUIS_TEST_FLOW_IDS"), false);
  assertEquals(fn.includes("META_TEST_PHONE_NUMBER_ID"), false);
  // General-entry routing (main_menu / post_benefit_menu, asserted above)
  // dispatches through this function, and this function must still build
  // its flowCta from luisUnifiedFlowCta and return it on the result.
  assertStringIncludes(fn, "luisUnifiedFlowCta(");
  assertStringIncludes(fn, "flowCta,");
});

// --- Customer-facing wrapper copy: unified experience, not booking-only --

Deno.test("Luis unified Flow CTA wrapper drops the generic booking header and greets by name", () => {
  const cta = luisUnifiedFlowCta("999999999999");
  assert(cta);
  assertEquals(cta.headerText, "");
  assertEquals(cta.ctaText, "Ver opciones");
  assertStringIncludes(cta.bodyText, "Te saluda Luis Gabriel");
  assertEquals(cta.bodyText.includes("Agendá tu cita"), false);
});

Deno.test("the outer WhatsApp message built from the Luis unified Flow CTA never renders 'Agendá tu cita'", () => {
  const cta = luisUnifiedFlowCta("999999999999");
  assert(cta);
  const message = buildWhatsAppFlowCtaMessage({
    to: "5491100000000",
    flow_id: cta.flowId,
    cta_text: cta.ctaText,
    body_text: cta.bodyText,
    header_text: cta.headerText,
    flow_action: cta.flowAction,
    flow_action_payload: cta.flowActionPayload,
  });
  const interactive = (message as any).interactive;
  // No header override was supplied ("" - not the booking-only default), so
  // the outer message must render without a header at all.
  assertEquals(Object.prototype.hasOwnProperty.call(interactive, "header"), false);
  assertStringIncludes(interactive.body.text, "Te saluda Luis Gabriel");
  assertEquals(interactive.body.text.includes("Agendá tu cita"), false);
  assertEquals(interactive.action.parameters.flow_cta, "Ver opciones");
});

Deno.test("luisUnifiedFlowCta opens SERVICE_SELECT and is null without a configured id", () => {
  assertEquals(luisUnifiedFlowCta(""), null);
  assertEquals(luisUnifiedFlowCta("   "), null);
  const cta = luisUnifiedFlowCta("999999999999");
  assertEquals(cta?.flowId, "999999999999");
  assertEquals(cta?.flowAction, "navigate");
  assertEquals(cta?.flowActionPayload, { screen: "SERVICE_SELECT" });
  // No flowMode is set, so sendViaWhatsApp defaults it to "published" - the
  // same convention luisBenefitsFlowCta uses for real production sends;
  // only the isolated TEST transport ever sets flowMode: "draft".
  assertEquals(Object.prototype.hasOwnProperty.call(cta, "flowMode"), false);
});

Deno.test("no TEST Flow ID constant can reach real Luis transport through the unified CTA", () => {
  // LUIS_TEST_FLOW_IDS is only ever read behind explicitMetaTestDemoContext,
  // and luisUnifiedFlowEntryResult (used by real production routing) never
  // references it - confirmed structurally above. This test additionally
  // proves the one gate that supplies test IDs anywhere in the file.
  const gated = workerSource.indexOf(
    "const testFlowIds = explicitMetaTestDemoContext ? LUIS_TEST_FLOW_IDS : null;",
  );
  assert(gated >= 0, "LUIS_TEST_FLOW_IDS must stay behind the explicit test-demo gate");
});

// --- Items 5-6: BENEFITS / SUPERMARKET preserves postal_code -------------

const unifiedSupermarketCompletion = {
  service_key: "BENEFITS",
  benefit_key: "SUPERMARKET",
  full_name: "Ana López",
  postal_code: "30071",
  email: "",
  marketing_consent: false,
};

Deno.test("BENEFITS completion from the unified Flow classifies and parses correctly", () => {
  assertEquals(classifyLuisFlowCompletion(unifiedSupermarketCompletion), "BENEFITS");
  const parsed = parseLuisBenefitFlowCompletion(unifiedSupermarketCompletion);
  assertEquals(parsed?.benefit_key, "SUPERMARKET");
  assertEquals(parsed?.postal_code, "30071");
});

// Superseded 2026-08-25 (Problem 1, real production failure - lead
// 0bb34495, ZIP 30096): a genuine WhatsApp client DID send postal_code as
// an unquoted JSON number, and the previous "fails closed" behavior here
// silently rejected a perfectly valid ZIP. parseLuisBenefitFlowCompletion
// now accepts and normalizes a numeric postal_code (see
// luisBenefitsFlow.test.ts's "Problem 1 fix" tests for full coverage,
// including leading-zero restoration and out-of-range rejection) - this
// test is updated to match that already-shipped, already-tested behavior
// instead of asserting the old rejection this file never caught up with.
Deno.test("a numeric (non-string) postal_code is accepted and normalized to a string, not rejected", () => {
  const numericCompletion = { ...unifiedSupermarketCompletion, postal_code: 30071 };
  const parsed = parseLuisBenefitFlowCompletion(numericCompletion);
  assertEquals(parsed?.postal_code, "30071");
  assertEquals(typeof parsed?.postal_code, "string");
});

Deno.test("a string postal_code with the real GA ZIP width is preserved exactly, no trimming corruption", () => {
  const parsed = parseLuisBenefitFlowCompletion({ ...unifiedSupermarketCompletion, postal_code: "30071" });
  assertEquals(parsed?.postal_code, "30071");
  assertEquals(parsed?.postal_code.length, 5);
});

Deno.test("SUPERMARKET completion reuses the existing idempotent location resolver, unmodified", () => {
  const fn = sliceFunction("buildLuisBenefitsFlowCompletionResult");
  assertStringIncludes(fn, 'args.supabase.rpc("request_referral_benefit_claim"');
  assertStringIncludes(fn, "p_postal_code: completion.postal_code");
  assertStringIncludes(fn, "requires_location_verification");
  // No random pick or hardcoded fallback ZIP/store name - every location
  // must come from the RPC response or the nearest-supermarket module's own
  // real DB-backed lookup, never a default/guessed literal in this
  // function. The blanket "must never mention nearest" ban this test used
  // to assert is intentionally gone - the nearest-supermarket proposal
  // (tryFindNearestSupermarket, gated to SUPERMARKET only, confirmation-
  // required, never issuing before send - see nearestSupermarket.test.ts
  // and luisConversationRouter.test.ts's "[supermarket-only proof]" tests)
  // was deliberately added here in an earlier round of this same
  // engagement; this test never caught up with that intentional change.
  assertEquals(fn.includes("Math.random"), false);
  assertEquals(fn.includes('"30071"'), false);
  assertEquals(fn.includes("El Sol"), false);
});

// Real production case (2026-08-19): lead 867dace6-d2a9-4ebb-80d2-4ad877316058
// had an ISSUED claim for ZIP 30071/El Sol from 2026-08-15, then resubmitted
// a DIFFERENT, unsupported ZIP (30345) on 2026-08-19. The live RPC's
// existing-claim branch returns requires_location_verification: true for that
// submission, but ALSO returns the OLD claim's official_media_url/
// supermarket_location_id (El Sol) via its `existing_location` join - an
// internally inconsistent response. A tempting "fix" is to trust
// official_media_url over the flag (skip verification whenever a media URL is
// present) - but that would silently mail the customer the WRONG city's
// coupon whenever they submit a different, unsupported ZIP, since the stale
// El Sol data is present precisely in that broken case. That app-layer
// bypass was evaluated and reverted; requires_location_verification must be
// trusted unconditionally until the RPC itself is fixed to null out stale
// location fields when it can't resolve the submitted ZIP (tracked as a
// migration, not applied here).
Deno.test("requires_location_verification unconditionally blocks delivery - no official_media_url bypass", () => {
  const fn = sliceFunction("buildLuisBenefitsFlowCompletionResult");
  assertStringIncludes(fn, "if (row?.requires_location_verification === true) {");
  assertStringIncludes(
    fn,
    'reply: "Estamos verificando cuál de nuestras ubicaciones te corresponde.\\n\\nTe ayudaremos por este mismo WhatsApp.",',
  );
  assertStringIncludes(fn, "debugNote: `referral_hub:benefit_claim_location_verification:${claimId}`");
  // The known-dangerous bypass (skip verification because a media URL is merely
  // present) must never reappear - the RPC can return real media data
  // alongside requires_location_verification: true (the exact production bug),
  // so presence of a media URL is not proof the CURRENT submission resolved.
  assertEquals(fn.includes("resolvedMediaUrl"), false);
  assertEquals(/requires_location_verification === true\s*&&/.test(fn), false);
});

// Documents the live (unfixed) SQL contract gap this app-layer code must keep
// defending against: the existing-claim branch's `existing_location` join is
// keyed on v_claim.supermarket_location_id (the claim's PREVIOUS location),
// not on v_location (this submission's freshly resolved location) - so an
// unsupported-ZIP resubmission on an existing claim returns the old claim's
// media/location fields alongside requires_location_verification: true
// instead of a clean, structured "unresolved" result (nulled location
// fields). A correct fix requires a migration (out of scope here); this test
// only pins that the known-bad formula is still present so nobody assumes
// it was silently fixed.
Deno.test("KNOWN ISSUE: the live reroute migration's existing-claim location fields are not nulled when unresolved", () => {
  const rerouteMigration = Deno.readTextFileSync(
    new URL("../../../migrations/20260814000200_luis_benefit_supermarket_reroute.sql", import.meta.url),
  );
  assertStringIncludes(
    rerouteMigration,
    "v_is_supermarket and (v_location.id is null or v_claim.supermarket_location_id is null)",
  );
  assertStringIncludes(
    rerouteMigration,
    "left join public.referral_benefit_campaign_locations existing_location on existing_location.id = v_claim.supermarket_location_id;",
  );
});

// --- Items 8-10: MEDICAL / DENTAL / SHIPPING reuse the same claim handler -

for (const key of ["MEDICAL", "DENTAL", "SHIPPING"] as const) {
  Deno.test(`${key} completion from the unified Flow reuses the existing claim handler unchanged`, () => {
    const unifiedPayload = {
      service_key: "BENEFITS",
      benefit_key: key,
      full_name: "Ana López",
      postal_code: "30071",
      email: "",
      marketing_consent: false,
    };
    assertEquals(classifyLuisFlowCompletion(unifiedPayload), "BENEFITS");
    assertEquals(parseLuisBenefitFlowCompletion(unifiedPayload)?.benefit_key, key);
    // Same LUIS_BENEFITS definition (campaign key / partner / asset) the
    // legacy standalone benefits Flow already used - nothing new was added.
    assert(LUIS_BENEFITS[key].campaignKey.startsWith("luis_benefit_"));
    assert(LUIS_BENEFITS[key].mediaUrl?.startsWith("https://"));
  });
}

// --- Items 11-13: legal branches preserve existing intake behavior -------

Deno.test("IMMIGRATION completion from the unified Flow preserves the existing intake contract", () => {
  const payload = {
    service_key: "IMMIGRATION",
    intake_type: "IMMIGRATION",
    topic: "GREEN_CARD",
    full_name: "Ana López",
    postal_code: "30071",
    description: "Necesito orientación sobre residencia.",
  };
  assertEquals(classifyLuisFlowCompletion(payload), "LEGAL");
  assertEquals(parseLuisLegalFlowCompletion(payload)?.intake_type, "IMMIGRATION");
});

Deno.test("AUTO_ACCIDENT completion from the unified Flow preserves the existing intake contract", () => {
  const payload = {
    service_key: "AUTO_ACCIDENT",
    intake_type: "AUTO_ACCIDENT",
    accident_date: "2026-08-14",
    participation: "DRIVER",
    received_medical_attention: "YES",
    full_name: "Ana López",
    medical_provider: "Urgent Care",
    description: "Choque en la 85.",
  };
  assertEquals(classifyLuisFlowCompletion(payload), "LEGAL");
  const parsed = parseLuisLegalFlowCompletion(payload);
  assertEquals(parsed?.intake_type, "AUTO_ACCIDENT");
  if (parsed?.intake_type === "AUTO_ACCIDENT") {
    assertEquals(parsed.participant_role, "DRIVER");
    assertEquals(parsed.received_medical_attention, "YES");
  }
});

Deno.test("DUI_CRIMINAL completion from the unified Flow preserves the existing intake contract", () => {
  const payload = {
    service_key: "DUI_CRIMINAL",
    intake_type: "DUI_CRIMINAL",
    topic: "DUI",
    full_name: "Ana López",
    postal_code: "30071",
    description: "Me detuvieron anoche.",
  };
  assertEquals(classifyLuisFlowCompletion(payload), "LEGAL");
  assertEquals(parseLuisLegalFlowCompletion(payload)?.intake_type, "DUI_CRIMINAL");
});

// --- Item 14: HANDOFF reuses the existing human handoff, not new logic ---

Deno.test("HANDOFF completion classifies distinctly and dispatches through the existing human handoff", () => {
  assertEquals(classifyLuisFlowCompletion({ service_key: "HANDOFF" }), "HANDOFF");
  // Still UNKNOWN when service_key is missing/wrong, and BENEFITS/LEGAL keep
  // priority when their own discriminator fields are present alongside it.
  assertEquals(classifyLuisFlowCompletion({ service_key: "NOPE" }), "UNKNOWN");
  assertEquals(
    classifyLuisFlowCompletion({ service_key: "HANDOFF", benefit_key: "SUPERMARKET" }),
    "BENEFITS",
  );

  const handoffBranch = workerSource.indexOf('} else if (completionKind === "HANDOFF")');
  assert(handoffBranch >= 0);
  const branchBody = workerSource.slice(handoffBranch, handoffBranch + 700);
  assertStringIncludes(branchBody, "await luisHumanHandoffResult({");
  assertStringIncludes(branchBody, "effectiveOrganizationId === \"luis-gabriel-referral-hub\"");
  // Reuses the same event recorder as every other handoff path - no new
  // handoff implementation was introduced for the unified Flow.
  const handoffFn = sliceFunction("luisHumanHandoffResult");
  assertStringIncludes(handoffFn, "recordHumanHandoffEvent(");
});

// --- Real-world regression: a bare greeting must reopen the menu even over
// a stale pending legal intake (previously it silently completed the stale
// intake instead, producing the legal-handoff reply and never sending the
// unified Flow CTA) ---------------------------------------------------------

const stalePendingLegalState = { topic: "IMMIGRATION" as const, step: "description" as const };

Deno.test("a bare 'Hola' reopens the main menu even with a stale pending legal intake", () => {
  assertEquals(
    routeLuisConversation({ inboundText: "Hola", legalState: stalePendingLegalState }),
    { kind: "main_menu", trigger: "greeting" },
  );
  assertEquals(
    routeLuisConversation({ inboundText: "hola", legalState: stalePendingLegalState }),
    { kind: "main_menu", trigger: "greeting" },
  );
});

Deno.test("MENU still reopens the main menu with a stale pending legal intake (unchanged)", () => {
  assertEquals(
    routeLuisConversation({ inboundText: "MENU", legalState: stalePendingLegalState }),
    { kind: "main_menu", trigger: "explicit" },
  );
});

Deno.test("a real free-text answer that merely starts with 'hola' still completes a genuinely active intake", () => {
  // Only an exact, standalone greeting overrides state - a genuine answer
  // must not be swallowed just because it happens to start the same way.
  // Genuinely active (nextExpected still points at the pending question).
  assertEquals(
    routeLuisConversation({
      inboundText: "Hola, tuve un accidente la semana pasada",
      legalState: stalePendingLegalState,
      nextExpected: "luis_legal",
    }),
    { kind: "legal_complete", topic: "IMMIGRATION" },
  );
});

Deno.test("main_menu reached via the greeting override dispatches the unified Flow CTA, not the legal handoff reply", () => {
  // Structural proof that main_menu (now reachable from a bare greeting even
  // over stale state) routes through the same CTA-first branch as any other
  // main_menu entry - no separate/duplicate code path was introduced.
  const mainMenuBranch = workerSource.indexOf('if (effectiveRoute.kind === "main_menu")');
  const legalCompleteBranch = workerSource.indexOf('if (route.kind === "legal_complete")');
  assert(mainMenuBranch >= 0 && legalCompleteBranch >= 0);
  assert(mainMenuBranch < legalCompleteBranch);
});

Deno.test("an explicit HANDOFF Flow completion still produces the human-handoff response unchanged", () => {
  // Regression guard: fixing the conversational "Hola" bug must not touch
  // the separate, already-correct Flow-completion HANDOFF path from Part 5.
  assertEquals(classifyLuisFlowCompletion({ service_key: "HANDOFF" }), "HANDOFF");
  const handoffBranch = workerSource.indexOf('} else if (completionKind === "HANDOFF")');
  const branchBody = workerSource.slice(handoffBranch, handoffBranch + 700);
  assertStringIncludes(branchBody, "Listo. Un integrante de nuestro equipo te escribirá por este mismo WhatsApp.");
});

// --- Item 15: duplicate completion stays idempotent -----------------------

Deno.test("duplicate BENEFITS completions still route through the single idempotent claim RPC", () => {
  // request_referral_benefit_claim's own uniqueness constraint (organization,
  // campaign, lead) is covered end-to-end in luisBenefitsMigration.test.ts;
  // this proves the unified-flow dispatch path calls that same RPC exactly
  // once per completion, with no parallel/duplicate call site.
  const occurrences = workerSource
    .split('args.supabase.rpc("request_referral_benefit_claim"').length - 1;
  assertEquals(occurrences, 1);
});
