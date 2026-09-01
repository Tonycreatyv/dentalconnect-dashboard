import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  coexistenceActivationMessageId,
  isDuplicateDatabaseError,
  isPendingCoexistenceActivation,
  isWhatsAppAutomationAllowed,
  resolveExactWhatsAppTenant,
} from "./whatsappActivation.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

const pendingCoexistence = {
  organization_id: "luis-gabriel-referral-hub",
  business_type: "referral_hub",
  whatsapp_phone_number_id: "1291681687354409",
  whatsapp_waba_id: "1020618747258460",
  whatsapp_enabled: false,
  bot_enabled: false,
  whatsapp_registered: true,
  whatsapp_webhooks_subscribed: true,
  whatsapp_onboarding_mode: "COEXISTENCE",
  whatsapp_onboarding_event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  whatsapp_business_app_coexistence_completed: true,
};

Deno.test("disabled coexistence tenant resolves by exact phone and WABA independently of automation", () => {
  const result = resolveExactWhatsAppTenant(
    [pendingCoexistence],
    "1291681687354409",
    "1020618747258460",
  );
  assertEquals(result.status, "resolved");
  assert(isPendingCoexistenceActivation(pendingCoexistence));
  assertEquals(isWhatsAppAutomationAllowed(pendingCoexistence), false);
});

Deno.test("exact WhatsApp tenant resolution fails closed for WABA mismatch", () => {
  assertEquals(
    resolveExactWhatsAppTenant(
      [pendingCoexistence],
      "1291681687354409",
      "wrong-waba",
    ).status,
    "waba_mismatch",
  );
});

Deno.test("exact WhatsApp tenant resolution fails closed for ambiguous and unmapped phones", () => {
  assertEquals(
    resolveExactWhatsAppTenant(
      [pendingCoexistence, { ...pendingCoexistence, organization_id: "other" }],
      "1291681687354409",
      "1020618747258460",
    ).status,
    "ambiguous",
  );
  assertEquals(
    resolveExactWhatsAppTenant(
      [pendingCoexistence],
      "unmapped-phone",
      "1020618747258460",
    ).status,
    "unmapped",
  );
});

Deno.test("coexistence activation invariant rejects incomplete and standard rows", () => {
  assertEquals(
    isPendingCoexistenceActivation({
      ...pendingCoexistence,
      whatsapp_webhooks_subscribed: false,
    }),
    false,
  );
  assertEquals(
    isPendingCoexistenceActivation({
      ...pendingCoexistence,
      whatsapp_onboarding_mode: "STANDARD",
    }),
    false,
  );
  assertEquals(
    isPendingCoexistenceActivation({
      ...pendingCoexistence,
      whatsapp_enabled: true,
    }),
    false,
  );
});

Deno.test("duplicate provider-message database errors are recognized safely", () => {
  assert(isDuplicateDatabaseError({ code: "23505", message: "unique" }));
  assert(isDuplicateDatabaseError({ message: "duplicate key" }));
  assertEquals(isDuplicateDatabaseError({ code: "42501" }), false);
});

Deno.test("coexistence activation message ids are stable, scoped, and valid UUIDv8", async () => {
  const first = await coexistenceActivationMessageId(
    "luis-gabriel-referral-hub",
    "whatsapp",
    "wamid.same",
  );
  const duplicate = await coexistenceActivationMessageId(
    "luis-gabriel-referral-hub",
    "whatsapp",
    "wamid.same",
  );
  const different = await coexistenceActivationMessageId(
    "luis-gabriel-referral-hub",
    "whatsapp",
    "wamid.other",
  );
  assertEquals(first, duplicate);
  assert(first !== different);
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(first),
  );
});

Deno.test("WhatsApp signature verification runs before extraction or tenant writes", () => {
  const signatureGateStart = source.indexOf("const metaObject =");
  const extractionStart = source.indexOf("const echoEvents =");
  const gate = source.slice(signatureGateStart, extractionStart);
  assertStringIncludes(gate, 'metaObject === "page"');
  assertStringIncludes(gate, 'metaObject === "whatsapp_business_account"');
  assertStringIncludes(gate, "validateMetaSignature({");
  assertStringIncludes(
    gate,
    'return json(401, { ok: false, error: "invalid_meta_signature" })',
  );
  assertEquals(gate.includes('.from("leads")'), false);
  assertEquals(gate.includes('.from("messages")'), false);
  assertEquals(gate.includes("reply_outbox"), false);
});

Deno.test("activation persists inbound before a conditional one-time enable transition", () => {
  const messageInsert = source.indexOf(
    "const messagePayload: Record<string, unknown> = {",
  );
  const persistenceGuard = source.indexOf(
    "if (!inboundPersisted) {",
    messageInsert + 1,
  );
  const activationUpdate = source.indexOf(
    "const activationUpdate = await supabase",
  );
  const enqueue = source.indexOf("const canEnqueue =", activationUpdate);
  assert(messageInsert > 0);
  assert(persistenceGuard > messageInsert);
  assert(activationUpdate > messageInsert);
  assert(activationUpdate > persistenceGuard);
  assert(enqueue > activationUpdate);
  const guard = source.slice(persistenceGuard, activationUpdate);
  assertStringIncludes(
    guard,
    'throw new Error("coexistence_activation_inbound_not_persisted")',
  );
  const activation = source.slice(activationUpdate, enqueue);
  assertStringIncludes(activation, '.eq("whatsapp_enabled", false)');
  assertStringIncludes(activation, "whatsapp_enabled: true");
  assertStringIncludes(activation, "whatsapp_connected_at: activationTime");
  assertStringIncludes(activation, "reply_suppressed: true");
  assertStringIncludes(activation, "continue;");
  assertEquals(activation.includes("reply_outbox"), false);
  assertEquals(activation.includes("run-replies"), false);
  assertEquals(activation.includes("/register"), false);
});

Deno.test("activation and normal inbound share the canonical production message contract", () => {
  const payload = source.slice(
    source.indexOf("const messagePayload: Record<string, unknown> = {"),
    source.indexOf("const msgInsert = await supabase"),
  );
  for (
    const field of [
      "organization_id",
      "lead_id: lead.id",
      "channel",
      'role: "user"',
      'actor: "user"',
      "content: text",
      "provider_message_id: providerMid",
      "inbound_message_id: providerMid",
      "channel_user_id: senderId",
    ]
  ) {
    assertStringIncludes(payload, field);
  }
  assertStringIncludes(payload, "if (activationProbe) {");
  assertEquals(payload.includes("platform_message_id"), false);
});

Deno.test("activation message idempotency uses canonical inbound fields and the existing primary key", () => {
  const insertion = source.slice(
    source.indexOf("// Activation webhooks can be delivered more than once."),
    source.indexOf("const canEnqueue ="),
  );
  assertStringIncludes(insertion, "provider_message_id: providerMid");
  assertStringIncludes(insertion, "inbound_message_id: providerMid");
  assertStringIncludes(
    insertion,
    "messagePayload.id = await coexistenceActivationMessageId(",
  );
  assertStringIncludes(insertion, "isDuplicateDatabaseError(msgInsert.error)");
  assertStringIncludes(insertion, '.eq("provider_message_id", providerMid)');
  assertStringIncludes(insertion, '.eq("inbound_message_id", providerMid)');
  assertStringIncludes(insertion, '.eq("whatsapp_enabled", false)');
  assertEquals(insertion.includes("platform_message_id"), false);
});

Deno.test("normal WhatsApp automation remains separately gated", () => {
  assert(isWhatsAppAutomationAllowed({
    ...pendingCoexistence,
    whatsapp_enabled: true,
    bot_enabled: true,
  }));
  assertStringIncludes(
    source,
    "isWhatsAppAutomationAllowed(resolvedOrg.whatsappSettings)",
  );
  assertStringIncludes(
    source,
    "const canEnqueue = automationAllowed && !botAutoReplyPaused",
  );
  assertStringIncludes(
    source,
    "RUN_REPLIES_SECRET && automationAllowed && !botAutoReplyPaused",
  );
});
