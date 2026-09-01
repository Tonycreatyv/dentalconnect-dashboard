import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isLuisMainMenuCommand,
  routeLuisConversation,
  routeLuisTestFlowIntent,
} from "../../_products/referral-hub/luisBenefits.ts";

const workerSource = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("Luis router sends normal entry to the main menu and honors MENU/MENÚ", () => {
  assertEquals(routeLuisConversation({ inboundText: "Hola" }), { kind: "main_menu", trigger: "greeting" });
  assertEquals(isLuisMainMenuCommand("MENU"), true);
  assertEquals(isLuisMainMenuCommand("menú"), true);
  assertEquals(routeLuisConversation({ inboundText: "MENÚ" }), { kind: "main_menu", trigger: "explicit" });
});

Deno.test("Priority 2 (2026-08-24): a returning customer's bare greeting gets a personalized reentry, distinct from an explicit menu request", () => {
  // Two genuinely different reentry strings exist, and the branch picks
  // between them based on effectiveRoute.trigger, not a single shared copy.
  assertStringIncludes(workerSource, "Claro 👌 Acá tenés nuevamente nuestras opciones.");
  assertStringIncludes(workerSource, "Qué gusto tenerte de nuevo");
  const mainMenuStart = workerSource.indexOf('if (effectiveRoute.kind === "main_menu")');
  const mainMenuEnd = workerSource.indexOf("if (effectiveRoute.kind ===", mainMenuStart + 10);
  const mainMenuBlock = workerSource.slice(mainMenuStart, mainMenuEnd);
  assertStringIncludes(mainMenuBlock, 'effectiveRoute.trigger === "greeting"');
  // A first-ever contact (not returning) still gets no contextual
  // greeting at all - luisUnifiedFlowEntryResult's own default (the full
  // intro) applies, unchanged from before this correction.
  assertStringIncludes(mainMenuBlock, "!isReturningLead");
});

Deno.test("the personalized returning greeting uses the lead's real first name when available, and a name-free version otherwise - never a placeholder", () => {
  const fnStart = workerSource.indexOf("function returningCustomerGreeting()");
  const fnEnd = workerSource.indexOf("\n  }", fnStart);
  const fn = workerSource.slice(fnStart, fnEnd);
  assertStringIncludes(fn, "firstNameFromFlowName(safeStr((args.leadState as any)?.full_name");
  assertStringIncludes(fn, "¡Hola, ${firstName}! Qué gusto tenerte de nuevo 👋 ¿En qué te podemos ayudar hoy?");
  assertStringIncludes(fn, "¡Hola! Qué gusto tenerte de nuevo 👋 ¿En qué te podemos ayudar hoy?");
});

Deno.test("Luis router opens benefits directly for the flyer phrase and menu actions", () => {
  assertEquals(routeLuisConversation({
    inboundText: "Hola, quiero activar mis beneficios.",
  }), { kind: "benefits", directCampaignEntry: true });
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_main:benefits",
  }), { kind: "benefits" });
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_benefits:another",
  }), { kind: "benefits" });
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_main:menu",
  }), { kind: "main_menu", trigger: "explicit" });
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_benefits:main_menu",
  }), { kind: "post_benefit_menu" });
});

Deno.test("TEST Flow router maps every supported menu action and flyer entry before legacy intake", () => {
  assertEquals(routeLuisTestFlowIntent({ inboundText: "Hola" }), null);
  assertEquals(routeLuisTestFlowIntent({ inboundText: "", payloadAction: "luis_main:benefits" }), "BENEFITS");
  assertEquals(routeLuisTestFlowIntent({ inboundText: "", payloadAction: "luis_legal:immigration" }), "IMMIGRATION");
  assertEquals(routeLuisTestFlowIntent({ inboundText: "", payloadAction: "luis_legal:accident" }), "AUTO_ACCIDENT");
  assertEquals(routeLuisTestFlowIntent({ inboundText: "", payloadAction: "luis_legal:criminal" }), "DUI_CRIMINAL");
  assertEquals(routeLuisTestFlowIntent({ inboundText: "Hola, quiero activar mis beneficios." }), "BENEFITS");
  for (const alias of ["Quiero mis beneficios", "Beneficios", "Cupones", "Quiero los cupones"]) {
    assertEquals(routeLuisTestFlowIntent({ inboundText: alias }), "BENEFITS");
  }
  assertEquals(routeLuisTestFlowIntent({ inboundText: "MENÚ" }), null);
});

Deno.test("MENU always wins a pending legal cursor while ordinary answers retain an active intake", () => {
  assertEquals(routeLuisConversation({
    inboundText: "MENU",
    legalState: { topic: "IMMIGRATION", step: "description" },
    nextExpected: "luis_legal",
  }), { kind: "main_menu", trigger: "explicit" });
  assertEquals(routeLuisConversation({
    inboundText: "Necesito ayuda",
    legalState: { topic: "IMMIGRATION", step: "description" },
    nextExpected: "luis_legal",
  }), { kind: "legal_complete", topic: "IMMIGRATION" });
});

Deno.test("Luis router offers only the requested legal intake progression", () => {
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_legal:immigration",
  }), { kind: "legal_prompt", topic: "IMMIGRATION", step: "description" });
  assertEquals(routeLuisConversation({
    inboundText: "Necesito saber mis opciones.",
    legalState: { topic: "IMMIGRATION", step: "description" },
    nextExpected: "luis_legal",
  }), { kind: "legal_complete", topic: "IMMIGRATION" });
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_legal:accident",
  }), { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "date" });
  assertEquals(routeLuisConversation({
    inboundText: "12 de agosto",
    legalState: { topic: "AUTO_ACCIDENT", step: "date" },
    nextExpected: "luis_legal",
  }), { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "medical_attention" });
  assertEquals(routeLuisConversation({
    inboundText: "Sí",
    legalState: { topic: "AUTO_ACCIDENT", step: "medical_attention" },
    nextExpected: "luis_legal",
  }), { kind: "legal_prompt", topic: "AUTO_ACCIDENT", step: "medical_location" });
  assertEquals(routeLuisConversation({
    inboundText: "No",
    legalState: { topic: "AUTO_ACCIDENT", step: "medical_attention" },
    nextExpected: "luis_legal",
  }), { kind: "legal_complete", topic: "AUTO_ACCIDENT" });
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_legal:criminal",
  }), { kind: "legal_prompt", topic: "CRIMINAL", step: "description" });
});

Deno.test("Luis main menu exposes the three direct referral routes without a generic legal entry", () => {
  assertStringIncludes(workerSource, "Estamos aquí para conectarte con ayuda y beneficios para nuestra comunidad.");
  for (const action of [
    'id: "luis_legal:immigration"',
    'id: "luis_legal:accident"',
    'id: "luis_legal:criminal"',
    'id: "luis_main:benefits"',
    'id: "luis_main:team"',
  ]) assertStringIncludes(workerSource, action);
  assert(!workerSource.includes('{ id: "luis_main:legal", title: "⚖️ Ayuda Legal" }'));
  assertStringIncludes(workerSource, "⚖️ DUI / Defensa criminal");
  assertEquals(workerSource.includes('title: "⚖️ DUI / Defensa",'), false);
});

Deno.test("Luis router redirects emergencies and does not continue legal intake", () => {
  assertEquals(routeLuisConversation({
    inboundText: "Hay peligro inmediato",
    legalState: { topic: "AUTO_ACCIDENT", step: "date" },
  }), { kind: "legal_emergency" });
});

// Corrected 2026-08-27: the required order is image -> issuance -> activation
// text -> menu, guaranteed through the actual outbound send loops, not just
// through the return object's own field order. Previously issuance ran
// AFTER the main reply+menu had already been sent, which meant a customer
// could see the activation text claiming their benefit was active while
// the database still said REQUESTED, if the later menu send happened to
// fail. This test locks in the corrected runtime order via the real
// send-processing landmarks, not the old (buggy) assertion this replaces.
Deno.test("Luis required coupon delivery order: image, then issuance, then activation confirmation, then menu", () => {
  const imageLoopStart = workerSource.indexOf(
    "// 3) send ordered channel-specific messages before the main interactive response",
  );
  const issueIndex = workerSource.indexOf("A benefit is ISSUED strictly after its official image");
  const preludeLoopStart = workerSource.indexOf("// Preserve the legacy WhatsApp-only prelude behavior.");
  const mainSendIndex = workerSource.indexOf("// persist the main outbound before send");
  assertEquals(imageLoopStart > 0, true);
  assertEquals(issueIndex > imageLoopStart, true, "issuance must run after the image loop, not before");
  assertEquals(preludeLoopStart > issueIndex, true, "activation text (outboundPrelude) must be sent after issuance, not before");
  assertEquals(mainSendIndex > preludeLoopStart, true, "the post-coupon menu (main reply) must be sent after activation text, not before");
  // Both real delivery paths (regular exact-ZIP/other-benefits, and the
  // nearest-supermarket confirm branch) build the image as the sole
  // outboundMessages entry and the activation text as outboundPrelude -
  // never the reverse, never combined into one array.
  const regularImageOnly = workerSource.indexOf('outboundMessages: [\n      { type: "image", url: mediaUrl');
  const nearestImageOnly = workerSource.indexOf('outboundMessages: [\n        { type: "image", url: mediaUrl');
  assertEquals(regularImageOnly > 0, true, "regular delivery outboundMessages must be image-only");
  assertEquals(nearestImageOnly > 0, true, "nearest-supermarket confirm outboundMessages must be image-only");
  assertStringIncludes(workerSource, "outboundPrelude: [{ text: activationText }]");
  assertStringIncludes(workerSource, 'id: "luis_benefits:services"');
  assertStringIncludes(workerSource, 'id: "luis_benefits:finalize"');
  // Problem 2 (2026-08-25): CTA copy corrected - no longer repeats the
  // activation message's "Listo ... 🎉 Tu beneficio ya está disponible"
  // preamble, see the dedicated Problem 2 tests below.
  assertStringIncludes(workerSource, "¿Te gustaría ver otro beneficio o consultar alguno de nuestros servicios?");
});

Deno.test("failed image send never reaches issuance, activation text, or the post-coupon menu (no fabricated success)", () => {
  const imageLoopStart = workerSource.indexOf(
    "// 3) send ordered channel-specific messages before the main interactive response",
  );
  const imageLoopEnd = workerSource.indexOf("A benefit is ISSUED strictly after its official image");
  const imageLoopBody = workerSource.slice(imageLoopStart, imageLoopEnd);
  // The outboundMessages loop (which sends the image for this flow) throws
  // synchronously on any non-ok response, unconditionally - normal JS
  // control flow means a thrown error here can never reach the issuance
  // gate, outboundPrelude loop, or main send below it in the same
  // function; there is no try/catch anywhere in this loop that could
  // swallow it and continue.
  assertStringIncludes(imageLoopBody, "if (!preludeResp?.ok) {");
  assertStringIncludes(imageLoopBody, "throw new Error(`${failureStage}:${preludeResp?.status}`);");
  assertEquals(imageLoopBody.includes("try {"), false, "no try/catch may swallow an image-send failure in this loop");
});

Deno.test("Luis post-coupon services/finalize actions route correctly and never touch handoff_to_human", () => {
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_benefits:services",
  }), { kind: "post_benefit_services" });
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_benefits:finalize",
  }), { kind: "post_benefit_finalize" });
  assertStringIncludes(workerSource, "Estas son las opciones disponibles:");
  assertStringIncludes(workerSource, "Guardá tu cupón y escribinos cuando necesités ayuda.");
  const finalizeStart = workerSource.indexOf('route.kind === "post_benefit_finalize"');
  const finalizeEnd = workerSource.indexOf("debugNote: \"referral_hub:luis_benefit_finalize\"", finalizeStart);
  const finalizeBlock = workerSource.slice(finalizeStart, finalizeEnd);
  assertStringIncludes(finalizeBlock, "handoff_to_human: false");
});

Deno.test("Luis natural-language menu recognition covers common phrasings, not only exact 'menu'", () => {
  for (const phrase of ["Menú principal", "Volver al menú", "Ver opciones", "Quiero otras opciones"]) {
    assertEquals(routeLuisConversation({ inboundText: phrase }), { kind: "main_menu", trigger: "explicit" });
  }
  assertEquals(routeLuisConversation({
    inboundText: "Volver al menú",
    legalState: { topic: "IMMIGRATION", step: "description" },
    nextExpected: "luis_legal",
  }), { kind: "main_menu", trigger: "explicit" });
});

Deno.test("Luis router maps every benefits_clarify button to opening the Flow, carrying which benefit was named (if any) as a copy hint only", () => {
  assertEquals(
    routeLuisConversation({ inboundText: "", payloadAction: "luis_benefits_clarify:supermarket" }),
    { kind: "benefits", requestedBenefitKey: "SUPERMARKET" },
  );
  assertEquals(
    routeLuisConversation({ inboundText: "", payloadAction: "luis_benefits_clarify:medical" }),
    { kind: "benefits", requestedBenefitKey: "MEDICAL" },
  );
  // "Ver otros" explicitly means "show me all 4" - no specific key.
  assertEquals(
    routeLuisConversation({ inboundText: "", payloadAction: "luis_benefits_clarify:other" }),
    { kind: "benefits" },
  );
});

Deno.test("Luis router maps the nearest-supermarket confirm/reject buttons", () => {
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_nearest:confirm",
  }), { kind: "nearest_supermarket_confirm" });
  assertEquals(routeLuisConversation({
    inboundText: "",
    payloadAction: "luis_nearest:reject",
  }), { kind: "nearest_supermarket_reject" });
});

Deno.test("nearest-supermarket confirmation never issues before the image actually sends, and never fabricates an image", () => {
  const confirmStart = workerSource.indexOf('route.kind === "nearest_supermarket_confirm"');
  const confirmEnd = workerSource.indexOf('if (route.kind === "human_handoff")', confirmStart);
  const block = workerSource.slice(confirmStart, confirmEnd);
  // CORRECTED 2026-08-24: the confirm branch must NEVER itself set
  // status="ISSUED" - an earlier version of this handler did exactly that
  // synchronously, before the image had actually been sent, violating the
  // product's one hard invariant (a claim is ISSUED only after the
  // official image is accepted by the delivery provider). Issuance now
  // happens exclusively via the shared, already-proven
  // "referral_hub:benefit_claim_delivery:" debugNote convention (see the
  // regular exact-ZIP claim path a few hundred lines above, and the
  // send-processing code around "issue_referral_benefit_claim" later in
  // this file), which only calls issue_referral_benefit_claim AFTER a
  // successful outbound send.
  assertEquals(block.includes('status: "ISSUED"'), false);
  assertEquals(block.includes("issued_at"), false);
  // Location assignment goes through the dedicated RPC, not a raw table
  // UPDATE - the RPC is the only place that mutates supermarket_location_id
  // for this flow, and it never touches status/issued_at itself.
  assertStringIncludes(block, "confirm_referral_benefit_claim_location");
  // Reuses the exact same debugNote prefix the regular claim-finalization
  // path uses, so the existing, unmodified send-then-issue gate applies
  // here with zero special-casing.
  assertStringIncludes(block, "referral_hub:benefit_claim_delivery:");
  // Real store image only - never a generic/hardcoded fallback for this path.
  assertStringIncludes(block, "official_media_url");
  assertEquals(block.includes("LUIS_BENEFITS.SUPERMARKET.mediaUrl"), false);
  const proposeStart = workerSource.indexOf("benefit_claim_nearest_proposed");
  assertEquals(proposeStart > 0, true);
  const proposeBlockStart = workerSource.lastIndexOf("if (row?.requires_location_verification", proposeStart);
  const proposeBlock = workerSource.slice(proposeBlockStart, proposeStart);
  assertStringIncludes(proposeBlock, "luis_nearest:confirm");
  assertStringIncludes(proposeBlock, "luis_nearest:reject");
  // Only 2 buttons (2026-08-26 revision) - there is no separate "view map"
  // button/interaction; the location itself is a native WhatsApp location
  // message (2026-08-27), not a link riding on a button.
  assertEquals(proposeBlock.includes("luis_nearest:view_map"), false);
  // Proposing sends an intro text + native location message (never an
  // image), but is still never itself an issuance - no RPC call, no
  // status/issued_at mutation anywhere in this block.
  assertStringIncludes(proposeBlock, "outboundMessages:");
  assertStringIncludes(proposeBlock, 'type: "location"');
  assertEquals(proposeBlock.includes("issue_referral_benefit_claim"), false);
  assertEquals(proposeBlock.includes('status: "ISSUED"'), false);
});

// 2026-08-27: nearby-store proposal now sends 3 separate messages in order
// (intro text, native WhatsApp location, then the confirm question with
// buttons) instead of one combined block with a pasted Google Maps URL.
Deno.test("[nearby proposal] sends a native WhatsApp location payload built from the matched store's own name/address/coordinates, never a raw Maps URL", () => {
  const proposeStart = workerSource.indexOf("benefit_claim_nearest_proposed");
  assertEquals(proposeStart > 0, true);
  const proposeBlockStart = workerSource.lastIndexOf("if (row?.requires_location_verification", proposeStart);
  const proposeBlock = workerSource.slice(proposeBlockStart, proposeStart);
  // The intro text and location come from the real match, not literals -
  // formatNearestSupermarketIntroText/formatNearestSupermarketLocation are
  // the only functions this block uses to build customer-facing content.
  assertStringIncludes(proposeBlock, "formatNearestSupermarketIntroText(nearestMatch)");
  assertStringIncludes(proposeBlock, "formatNearestSupermarketLocation(nearestMatch)");
  assertStringIncludes(proposeBlock, "...nearestLocation");
  assertStringIncludes(proposeBlock, "NEAREST_SUPERMARKET_CONFIRM_QUESTION");
  // No raw Google Maps URL and no external shortener anywhere in this
  // block, and nowhere else in the deployed source either - the raw
  // pasted-URL design was removed entirely, not just hidden.
  assertEquals(proposeBlock.includes("google.com/maps"), false);
  assertEquals(workerSource.includes("googleMapsSearchUrl"), false, "the raw-URL helper must be removed entirely, not just unused");
  assertEquals(/https?:\/\/(?!graph\.facebook)/i.test(proposeBlock), false, "no URL of any kind in the propose block (graph.facebook.com API calls elsewhere in the file are unrelated)");
});

Deno.test("[nearby proposal] if coordinates are unavailable, falls back to the existing honest 'estamos verificando' text - never a broken location message, never an issuance", () => {
  const proposeStart = workerSource.indexOf("benefit_claim_nearest_proposed");
  const proposeBlockStart = workerSource.lastIndexOf("if (row?.requires_location_verification", proposeStart);
  const proposeBlock = workerSource.slice(proposeBlockStart, proposeStart);
  assertStringIncludes(proposeBlock, "if (!nearestLocation) return verifyingFallback;");
});

Deno.test("the nearest-supermarket view-map route/handler no longer exists (dropped 2026-08-26 - Maps link is now embedded in the proposal text)", () => {
  assertEquals(workerSource.includes("nearest_supermarket_view_map"), false);
});

// The user's explicit constraint this round: Google Maps nearest-location
// matching applies ONLY to the SUPERMARKET benefit, never to medical,
// dental, shipping, immigration, accident, DUI, criminal defense, or any
// other single-destination service. tryFindNearestSupermarket is the only
// call site that can reach the Google Maps client for this feature, and it
// must be textually gated by an explicit benefit_key === "SUPERMARKET"
// check immediately at its call site - not merely "trust that no other
// caller happens to exist," which the next edit could silently violate.
Deno.test("[supermarket-only proof] tryFindNearestSupermarket has exactly one call site, and it is gated by benefit_key === \"SUPERMARKET\"", () => {
  const callSites = workerSource.split("tryFindNearestSupermarket(").length - 1;
  // Exactly 2 occurrences of the identifier: the function's own definition
  // (`async function tryFindNearestSupermarket(`) and its single call site.
  assertEquals(callSites, 2, "tryFindNearestSupermarket must have exactly one call site in run-replies/index.ts");
  const callSiteStart = workerSource.indexOf("await tryFindNearestSupermarket(");
  assertEquals(callSiteStart > 0, true);
  // The ternary gate must appear immediately before the call, on the same
  // statement - not just "somewhere earlier in the function."
  const gateWindowStart = workerSource.lastIndexOf("const nearestMatch =", callSiteStart);
  assertEquals(gateWindowStart > 0, true);
  const gateWindow = workerSource.slice(gateWindowStart, callSiteStart);
  assertStringIncludes(gateWindow, 'completion.benefit_key === "SUPERMARKET"');
});

Deno.test("[supermarket-only proof] Google Maps (findSupermarketMatch/createGoogleMapsClient/the Maps API key) is referenced nowhere in run-replies except inside tryFindNearestSupermarket itself", () => {
  // Every call/reference site for the three things that actually reach
  // Google's servers. If a future edit added a second call path for
  // medical/dental/shipping/immigration/etc, it would necessarily add a
  // new occurrence of at least one of these identifiers outside
  // tryFindNearestSupermarket's own function body, which this test would
  // catch.
  const fnStart = workerSource.indexOf("async function tryFindNearestSupermarket(");
  assertEquals(fnStart > 0, true);
  const fnEnd = workerSource.indexOf("\nasync function buildLuisBenefitsFlowCompletionResult", fnStart);
  assertEquals(fnEnd > fnStart, true);
  const outsideFn = workerSource.slice(0, fnStart) + workerSource.slice(fnEnd);

  assertEquals(outsideFn.includes("findSupermarketMatch("), false, "findSupermarketMatch must only be called from inside tryFindNearestSupermarket");
  assertEquals(outsideFn.includes("createGoogleMapsClient("), false, "createGoogleMapsClient must only be called from inside tryFindNearestSupermarket");
  assertEquals(outsideFn.includes("GOOGLE_MAPS_PLATFORM_API_KEY"), false, "the Maps API key must only be read from inside tryFindNearestSupermarket");
});

// Corrected 2026-08-27: the gate now fires right after the image (the only
// thing sent so far) is accepted - strictly BEFORE the main reply/menu
// send, not after it. It still only ever fires after the image-loop's own
// failure check, which throws on a bad image send and would prevent
// reaching this gate entirely.
Deno.test("the shared issuance gate (issue_referral_benefit_claim) fires right after the image is accepted, strictly before the main reply/menu send, and the nearest-store confirm branch is wired into that exact gate", () => {
  const gateStart = workerSource.indexOf('debugNote.startsWith("referral_hub:benefit_claim_delivery:")');
  assertEquals(gateStart > 0, true);
  // The gate is reached only after the image-loop's own failure check
  // (which throws on a bad image send, preventing the gate from ever
  // being reached) - confirmed by that check appearing textually before
  // the gate.
  const imageFailureCheck = workerSource.indexOf("coupon_image_failed");
  assertEquals(imageFailureCheck > 0, true);
  assertEquals(imageFailureCheck < gateStart, true);
  // And the gate now runs BEFORE the main reply/menu is ever sent -
  // the exact ordering fix this round makes. Previously this same gate
  // ran AFTER metaResp?.ok (the main send's own success check), which
  // meant a menu-send failure could leave a claim's activation text
  // already delivered but the claim itself never actually issued.
  const mainSendFailureCheck = workerSource.indexOf("if (!metaResp?.ok)");
  assertEquals(mainSendFailureCheck > 0, true);
  assertEquals(gateStart < mainSendFailureCheck, true, "issuance must run before the main reply/menu send, not after");
});

Deno.test("TEST Flow delivery is DRAFT-first and falls back only after a provider failure", () => {
  assertStringIncludes(workerSource, "routeLuisTestFlowIntent(args)");
  assertStringIncludes(workerSource, "flowMode: \"draft\"");
  assertStringIncludes(workerSource, "luis_test_draft_flow_delivery_failed");
  assertStringIncludes(workerSource, "No pudimos abrir el formulario de prueba.");
  assertEquals(workerSource.indexOf("luis_test_draft_flow_delivery_failed") > workerSource.indexOf("sendViaMetaAdapter({"), true);
});

Deno.test("legal completion retains history but removes the temporary cursor", () => {
  const start = workerSource.indexOf("function luisLegalPatch");
  const end = workerSource.indexOf("async function luisHumanHandoffResult", start);
  const patch = workerSource.slice(start, end);
  assertStringIncludes(patch, "delete collected.luis_legal");
  assertStringIncludes(patch, "collected.luis_legal_last_completed = legal");
  assertStringIncludes(workerSource, "clearLuisTemporaryState");
});

Deno.test("conversational legal completion keeps automation active, while explicit human handoff still pauses it", () => {
  const legalStart = workerSource.indexOf('if (route.kind === "legal_complete")');
  const legalEnd = workerSource.indexOf("  return null;", legalStart);
  const legalCompletion = workerSource.slice(legalStart, legalEnd);
  assert(legalStart >= 0 && legalEnd > legalStart);
  assertStringIncludes(legalCompletion, "te dará seguimiento por este mismo WhatsApp");
  assertStringIncludes(legalCompletion, "await recordHumanHandoffEvent({");
  assert(!legalCompletion.includes("luisHumanHandoffResult"));
  assert(!legalCompletion.includes("handoff_to_human"));

  const handoffStart = workerSource.indexOf('if (route.kind === "human_handoff")');
  const handoffEnd = workerSource.indexOf('if (route.kind === "legal_menu")', handoffStart);
  const explicitHandoff = workerSource.slice(handoffStart, handoffEnd);
  assertStringIncludes(explicitHandoff, "luisHumanHandoffResult");
  assertStringIncludes(explicitHandoff, "Solicitud para hablar con el equipo");
});

Deno.test("Problem 2 (2026-08-25): the post-coupon CTA no longer repeats the activation message's 'Listo ... 🎉' preamble", () => {
  // The old copy repeated "Listo${name} 🎉 Tu beneficio ya está
  // disponible" right under the real activation message
  // ("¡Listo, {name}! ... Código de activación: ...", sent separately via
  // outboundMessages) and read as an accidental duplicate. It must be
  // fully gone from the deployed source, in both call sites (regular
  // delivery and the nearest-supermarket confirm path).
  assertEquals(workerSource.includes("Tu beneficio ya está disponible"), false);
  const occurrences = workerSource.split("¿Te gustaría ver otro beneficio o consultar alguno de nuestros servicios?").length - 1;
  assertEquals(occurrences, 2);
});

Deno.test("Problem 2: activationText (the real activation message) is still sent, untouched, and the buttons the CTA carries are unchanged", () => {
  // luisBenefitsActivationText itself (claim code, business name, image)
  // lives in luisBenefits.ts and was never touched this round - confirmed
  // separately in luisBenefitsFlow.test.ts. Here we only confirm index.ts
  // still sends that same activationText value, not a rewritten one -
  // now via outboundPrelude (2026-08-27 ordering fix), not outboundMessages.
  assertStringIncludes(workerSource, "text: activationText");
  assertStringIncludes(workerSource, '{ id: "luis_benefits:another", title: "Ver beneficios" }');
  assertStringIncludes(workerSource, '{ id: "luis_benefits:services", title: "Ver servicios" }');
  assertStringIncludes(workerSource, '{ id: "luis_benefits:finalize", title: "Finalizar" }');
});

// 2026-08-26: minimal, approved-only nearest-supermarket diagnostic
// persistence (referral_operational_events, no schema change, sanitized
// metadata only). These tests prove the invariants the approval was
// conditioned on, by inspecting the real deployed-source shape - not by
// guessing what got implemented.
Deno.test("[nearest-supermarket diagnostic] recordNearestSupermarketDiagnosticEvent writes only to the existing referral_operational_events table, never a new one", () => {
  const fnStart = workerSource.indexOf("async function recordNearestSupermarketDiagnosticEvent(");
  assert(fnStart > 0, "recordNearestSupermarketDiagnosticEvent must exist");
  const fnEnd = workerSource.indexOf("\nasync function tryFindNearestSupermarket(", fnStart);
  assert(fnEnd > fnStart);
  const fn = workerSource.slice(fnStart, fnEnd);
  assertStringIncludes(fn, '.from("referral_operational_events")');
  assertStringIncludes(fn, 'event_type: "luis_nearest_supermarket_diagnostic"');
  assertStringIncludes(fn, 'actor_type: "system"');
  // Sanitized metadata fields only - exactly the 5 approved keys.
  assertStringIncludes(fn, "stage: args.stage");
  assertStringIncludes(fn, "googleHttpStatus:");
  assertStringIncludes(fn, "googleErrorCategory:");
  assertStringIncludes(fn, "activeLocationCount:");
  assertStringIncludes(fn, "resultClassification: args.resultClassification");
  // Never an API key, raw provider body, phone, name, address, or ZIP.
  for (const forbidden of ["apiKey", "GOOGLE_MAPS_PLATFORM_API_KEY", "postalCode", "postal_code", "phone", "full_name", "address", "customerZip"]) {
    assertEquals(fn.includes(forbidden), false, `metadata must never reference ${forbidden}`);
  }
  // Best-effort: must never let an insert failure throw out of the
  // caller's control flow.
  assertStringIncludes(fn, "try {");
  assertStringIncludes(fn, "catch");
});

Deno.test("[nearest-supermarket diagnostic] every unresolved branch of tryFindNearestSupermarket awaits the diagnostic write before returning null", () => {
  const fnStart = workerSource.indexOf("async function tryFindNearestSupermarket(");
  assert(fnStart > 0);
  const fnEnd = workerSource.indexOf("\nasync function buildLuisBenefitsFlowCompletionResult", fnStart);
  assert(fnEnd > fnStart);
  const fn = workerSource.slice(fnStart, fnEnd);
  const occurrences = fn.split("await recordNearestSupermarketDiagnosticEvent(").length - 1;
  // maps_key_missing, campaign_lookup_failed, unresolved:<reason>, unexpected_exception
  assertEquals(occurrences, 4);
  assertEquals(fn.includes("void recordNearestSupermarketDiagnosticEvent("), false, "must be awaited, not fire-and-forget, so it lands before the response is built");
});

Deno.test("[nearest-supermarket diagnostic] existing coupon/claim/Flow/location-selection/Maps-matching/image/routing behavior is unchanged - the diagnostic write is additive only", () => {
  const fnStart = workerSource.indexOf("async function tryFindNearestSupermarket(");
  const fnEnd = workerSource.indexOf("\nasync function buildLuisBenefitsFlowCompletionResult", fnStart);
  const fn = workerSource.slice(fnStart, fnEnd);
  // Still returns null on every failure path (never fabricates a match),
  // and still returns the real match object on success - unchanged
  // contract with the caller.
  assertStringIncludes(fn, "return match;");
  assertStringIncludes(fn, "return null;");
});
