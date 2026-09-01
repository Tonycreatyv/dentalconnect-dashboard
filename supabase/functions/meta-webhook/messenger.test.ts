import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractMessengerEvents,
  resolveMessengerOrganization,
  validateMetaSignature,
} from "./messenger.ts";

Deno.test("Messenger plain text is normalized", () => {
  const [event] = extractMessengerEvents({
    object: "page",
    entry: [{ id: "page-lg", messaging: [{ sender: { id: "psid-1" }, timestamp: 1, message: { mid: "m-1", text: "Hola" } }] }],
  });
  assertEquals(event.text, "Hola");
  assertEquals(event.payload_action, null);
});

Deno.test("Messenger quick reply preserves text and payload", () => {
  const [event] = extractMessengerEvents({
    object: "page",
    entry: [{ id: "page-lg", messaging: [{ sender: { id: "psid-1" }, timestamp: 2, message: {
      mid: "m-2",
      text: "Eventos",
      quick_reply: { payload: "referral_service:luis_eventos" },
    } }] }],
  });
  assertEquals(event.text, "Eventos");
  assertEquals(event.payload_action, "referral_service:luis_eventos");
});

Deno.test("Messenger postback is normalized to payload_action", () => {
  const [event] = extractMessengerEvents({
    object: "page",
    entry: [{ id: "page-lg", messaging: [{ sender: { id: "psid-1" }, timestamp: 3, postback: {
      title: "Cupón médico",
      payload: "referral_service:luis_cupon_medico",
    } }] }],
  });
  assertEquals(event.text, "Cupón médico");
  assertEquals(event.payload_action, "referral_service:luis_cupon_medico");
  assert(event.mid.startsWith("postback:"));
});

Deno.test("unknown Page IDs are not mapped", () => {
  const rows = [{
    organization_id: "luis-gabriel-referral-hub",
    business_type: "referral_hub",
    meta_page_id: "787806717740271",
    messenger_enabled: true,
  }];
  assertEquals(resolveMessengerOrganization(rows, "unknown-page"), null);
});

Deno.test("LG Page maps only to canonical Referral Hub tenant", () => {
  const rows = [{
    organization_id: "luis-gabriel-referral-hub",
    business_type: "referral_hub",
    meta_page_id: "787806717740271",
    messenger_enabled: true,
  }];
  assertEquals(resolveMessengerOrganization(rows, "787806717740271"), {
    organizationId: "luis-gabriel-referral-hub",
    businessType: "referral_hub",
  });
});

Deno.test("DentalConnect and BarberLine mappings remain isolated", () => {
  const rows = [
    { organization_id: "clinic-demo", business_type: "dental", meta_page_id: "dental-page", messenger_enabled: true },
    { organization_id: "barber-demo", business_type: "barbershop", meta_page_id: "barber-page", messenger_enabled: true },
  ];
  assertEquals(resolveMessengerOrganization(rows, "dental-page")?.organizationId, "clinic-demo");
  assertEquals(resolveMessengerOrganization(rows, "barber-page")?.organizationId, "barber-demo");
  assertEquals(resolveMessengerOrganization(rows, "unknown"), null);
});

Deno.test("X-Hub-Signature-256 validation accepts only matching raw body", async () => {
  const rawBody = JSON.stringify({ object: "page", entry: [] });
  const secret = "test-app-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const signature = `sha256=${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  assert(await validateMetaSignature({ rawBody, signatureHeader: signature, appSecret: secret }));
  assertEquals(await validateMetaSignature({ rawBody: `${rawBody} `, signatureHeader: signature, appSecret: secret }), false);
  assertEquals(await validateMetaSignature({ rawBody, signatureHeader: null, appSecret: secret }), false);
  assertEquals(await validateMetaSignature({ rawBody, signatureHeader: "sha256=malformed", appSecret: secret }), false);
  assertEquals(await validateMetaSignature({ rawBody, signatureHeader: signature, appSecret: "" }), false);
});

Deno.test("Messenger adapter sends quick-reply IDs without rewriting the payload", async () => {
  const adapter = await Deno.readTextFile(
    new URL("../_shared/metaMessageAdapter.ts", import.meta.url),
  );
  assert(adapter.includes("payload: b.id"));
  assertEquals(adapter.includes("payload: `action:${b.id}`"), false);
});
