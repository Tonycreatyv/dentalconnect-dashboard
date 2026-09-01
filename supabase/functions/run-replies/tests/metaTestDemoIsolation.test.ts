import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.223.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const transportSource = await Deno.readTextFile(
  new URL("../domain/referralHub/metaTestTransport.ts", import.meta.url),
);

Deno.test("Meta test demo reads its credential only from the isolated server environment", () => {
  const demoSection = source.slice(
    source.indexOf("function metaTestDemoAccessToken"),
    source.indexOf("type LuisTestFlowIds"),
  );
  assertStringIncludes(demoSection, 'Deno.env.get("META_WHATSAPP_TEST_ACCESS_TOKEN")');
  assertStringIncludes(source, 'Deno.env.get("META_WHATSAPP_TEST_DEMO_ENABLED")');
  assertEquals(transportSource.includes("org_settings"), false);
  assertEquals(demoSection.includes("META_WHATSAPP_TEST_PHONE_NUMBER_ID"), false);
});

Deno.test("Meta test outbound selection hard-binds the explicit test route or exact test phone", () => {
  const guard = source.slice(
    source.indexOf("export function isExplicitMetaTestDemoOutbound"),
    source.indexOf("function isDentalOrganization"),
  );
  assertStringIncludes(guard, "args.testTokenConfigured && isMetaTestTransport");
  assertStringIncludes(transportSource, "META_TEST_DEMO_ORGANIZATION_ID");
  assertStringIncludes(transportSource, 'input.channel === "whatsapp"');
  assertStringIncludes(transportSource, "inbound_phone_number_id");
  assertStringIncludes(transportSource, "whatsapp_route_type");
  assertStringIncludes(transportSource, "META_TEST_DEMO_PHONE_NUMBER_ID");
  assertEquals(guard.includes("DEFAULT_ORG"), false);
});

Deno.test("Meta test transport does not create a demo-only business router", () => {
  assertEquals(source.includes("referralHubSkipProfileOnboarding"), false);
  assertStringIncludes(source, "allowTransientLuisMenuReset: explicitMetaTestDemoContext");
  assertStringIncludes(source, "handleReferralHubProductTurn({");
  assertStringIncludes(source, "selectWhatsAppTransport({");
});

Deno.test("TEST phone Flow routing is isolated, discovers only the TEST WABA, and sends DRAFT CTAs", () => {
  const testFlowSection = source.slice(
    source.indexOf('const META_TEST_DEMO_WABA_ID = "2080644335858568"'),
    source.indexOf("export function isExplicitMetaTestDemoOutbound"),
  );
  assertStringIncludes(testFlowSection, "2161490298097845");
  assertStringIncludes(testFlowSection, "1593418642409687");
  assertStringIncludes(testFlowSection, "1569608901419546");
  assertStringIncludes(testFlowSection, "1081861051024333");
  assertStringIncludes(testFlowSection, "flowMode: \"draft\"");
  assertStringIncludes(testFlowSection, "routeLuisTestFlowIntent(args)");
  assertEquals(testFlowSection.includes("1423647499608507"), false);
  assertEquals(testFlowSection.includes("1287679991091560"), false);
});

Deno.test("Meta test outbound substitutes only the selected test transport", () => {
  const processor = source.slice(
    source.indexOf("const testPhoneNumberId = metaTestDemoPhoneNumberId();"),
    source.indexOf("// 1) pre-send dedupe"),
  );
  assertStringIncludes(processor, "const testTransport = selectWhatsAppTransport");
  assertStringIncludes(processor, "const whatsappAccessToken = testTransport.accessToken");
  assertStringIncludes(processor, "const whatsappPhoneNumberId = testTransport.phoneNumberId");
  assertStringIncludes(processor, "meta_test_transport_credential_missing");
  assertStringIncludes(processor, 'logEvent("meta_test_demo_outbound_selected"');
  assertEquals(processor.includes("configuredWhatsAppAccessToken ="), false);
  assertEquals(processor.includes("configuredWhatsAppPhoneNumberId ="), false);
});

Deno.test("real WhatsApp jobs remain blocked when the canonical integration is disabled", () => {
  const automationGate = source.slice(
    source.indexOf("const channelAutomationEnabled ="),
    source.indexOf("if (!automationEnabled || !channelAutomationEnabled)"),
  );
  assertStringIncludes(
    automationGate,
    "explicitMetaTestDemo || (orgSettings as any)?.whatsapp_enabled !== false",
  );
  assertEquals(automationGate.includes("whatsapp_enabled === true"), false);
});

Deno.test("Referral Hub replies never receive the generic appointment continuation suffix", () => {
  const guard = source.slice(
    source.indexOf("function preventRepeatedReplyLoop"),
    source.indexOf("function capitalizeName"),
  );
  assertStringIncludes(guard, 'stateOrgType === "referral_hub"');
  assertStringIncludes(guard, "if (stateOrgType === \"referral_hub\") return reply;");
});

Deno.test("the inbound recipient reaches the canonical grocery transaction without lead-state coupling", () => {
  const referralDispatch = source.slice(
    source.indexOf("if (normalizedBusinessType === \"referral_hub\")"),
    source.indexOf("const isDentalOrg"),
  );
  const jobDispatch = source.slice(
    source.indexOf("const generated = earlyGeneratedOverride"),
    source.indexOf("const stateBeforeSnapshot"),
  );
  assertStringIncludes(referralDispatch, "channelUserId: args.channelUserId");
  assertStringIncludes(jobDispatch, "channelUserId: effectiveRecipientId");
});
