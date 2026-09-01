import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("Meta test probe intercepts only the approved WhatsApp phone ID", () => {
  assertStringIncludes(
    source,
    'META_TEST_PROBE_PHONE_NUMBER_ID = "1185864697945379"',
  );
  assertStringIncludes(source, 'return event.channel === "whatsapp" &&');
  assertStringIncludes(
    source,
    "event.phone_number_id === META_TEST_PROBE_PHONE_NUMBER_ID",
  );
  assertEquals(
    source.includes("DEFAULT_ORG === META_TEST_PROBE_PHONE_NUMBER_ID"),
    false,
  );
});

Deno.test("Meta test demo is disabled unless its explicit environment flag is true", () => {
  assertStringIncludes(
    source,
    'Deno.env.get("META_WHATSAPP_TEST_DEMO_ENABLED")',
  );
  assertStringIncludes(
    source,
    'String(Deno.env.get("META_WHATSAPP_TEST_DEMO_ENABLED") ?? "")',
  );
  assertStringIncludes(
    source,
    "safeString(phoneNumberId) === META_TEST_PROBE_PHONE_NUMBER_ID",
  );
  assertStringIncludes(
    source,
    'const META_TEST_DEMO_ORGANIZATION_ID = "luis-gabriel-referral-hub"',
  );
  assertStringIncludes(
    source,
    'const META_TEST_DEMO_ROUTE_TYPE = "meta_test_demo"',
  );
  assertStringIncludes(
    source,
    "!isExplicitMetaTestDemoPhone(event.phone_number_id)",
  );
  assertEquals(source.includes("META_WHATSAPP_TEST_PHONE_NUMBER_ID"), false);
});

Deno.test("enabled Meta test demo has one explicit Luis route and preserves route metadata", () => {
  const resolver = source.slice(
    source.indexOf('} else if (channel === "whatsapp" && phoneNumberId) {'),
    source.indexOf(
      "return {",
      source.indexOf('} else if (channel === "whatsapp" && phoneNumberId) {'),
    ),
  );
  assertStringIncludes(
    resolver,
    "if (isExplicitMetaTestDemoPhone(phoneNumberId)) {",
  );
  assertStringIncludes(
    resolver,
    "organizationId = META_TEST_DEMO_ORGANIZATION_ID;",
  );
  assertStringIncludes(resolver, 'source = "meta_test_demo";');
  assertStringIncludes(resolver, "routeType = META_TEST_DEMO_ROUTE_TYPE;");
  assertStringIncludes(source, "whatsapp_route_type: resolvedOrg.routeType");
  assertStringIncludes(
    source,
    'inbound_phone_number_id: channel === "whatsapp"',
  );
});

Deno.test("Meta test probe returns before DEFAULT_ORG routing or reply processing", () => {
  const guard = source.slice(
    source.indexOf("const inboundEvents = ["),
    source.indexOf("let received = 0;"),
  );
  assertStringIncludes(
    guard,
    "const probeEvents = inboundEvents.filter(isMetaTestProbeInbound)",
  );
  assertStringIncludes(guard, "const events = inboundEvents.filter((event) =>");
  assertStringIncludes(guard, "!isMetaTestProbeInbound(event)");
  assertStringIncludes(
    guard,
    "probe_events: probeEvents.map(metaTestProbeObservation)",
  );
  assertEquals(guard.includes("DEFAULT_ORG"), false);
  assertEquals(guard.includes("reply_outbox"), false);
  assertEquals(guard.includes("run-replies"), false);
  assertEquals(guard.includes("content:"), false);
});

Deno.test("unmapped WhatsApp phone IDs resolve to no organization", () => {
  const resolver = source.slice(
    source.indexOf("async function resolveOrganizationForInbound"),
    source.indexOf("function shouldScheduleFollowup"),
  );
  assertStringIncludes(resolver, "let organizationId: string | null = null;");
  assertStringIncludes(resolver, '"unmapped_whatsapp_phone"');
  assertStringIncludes(resolver, "if (!organizationId) {");
  assertStringIncludes(resolver, 'source = "unmapped_whatsapp_phone";');
  assertEquals(
    resolver.includes('channel === "messenger" ? null : defaultOrg'),
    false,
  );
  assertStringIncludes(
    resolver,
    '.eq("whatsapp_phone_number_id", phoneNumberId)',
  );
  assertStringIncludes(resolver, "resolveExactWhatsAppTenant(");
  assertEquals(
    resolver.includes('"integrations->>whatsapp_phone_number_id"'),
    false,
  );
});

Deno.test("unmapped WhatsApp inbound stops before tenant-scoped side effects", () => {
  const inboundLoopStart = source.indexOf("for (const ev of events)");
  const handlerStart = source.indexOf(
    "const resolvedOrg = await resolveOrganizationForInbound({",
    inboundLoopStart,
  );
  const handlerEnd = source.indexOf(
    "const resolvedOrganizationId = resolvedOrg.organizationId as string;",
  );
  const unmappedGuard = source.slice(handlerStart, handlerEnd);
  assertStringIncludes(
    unmappedGuard,
    'channel === "whatsapp" && !resolvedOrg.organizationId',
  );
  assertStringIncludes(
    unmappedGuard,
    '"[meta-webhook] unmapped_whatsapp_phone"',
  );
  assertStringIncludes(unmappedGuard, "continue;");
  assertEquals(unmappedGuard.includes("reply_outbox"), false);
  assertEquals(unmappedGuard.includes("run-replies"), false);
  assertEquals(unmappedGuard.includes('from("leads")'), false);
  assertEquals(unmappedGuard.includes('from("messages")'), false);
});

Deno.test("unmapped WhatsApp human echoes are also ignored", () => {
  const echoStart = source.indexOf(
    "const organization_id = resolvedOrg.organizationId;",
  );
  const echoEnd = source.indexOf(
    'console.log("[meta-webhook] human_echo_routing"',
    echoStart,
  );
  const echoGuard = source.slice(echoStart, echoEnd);
  assertStringIncludes(echoGuard, '"[meta-webhook] unmapped_whatsapp_phone"');
  assertStringIncludes(echoGuard, "continue;");
  assertEquals(echoGuard.includes('from("leads")'), false);
  assertEquals(echoGuard.includes('from("messages")'), false);
});
