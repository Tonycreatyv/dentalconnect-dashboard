import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  deriveWhatsAppConnectionStatus,
  mayStartWhatsAppEmbeddedSignup,
} from "../../../src/lib/whatsappConnectionState.ts";

Deno.test("canonical WhatsApp state keeps Luis disconnected despite stale integration rows", () => {
  assertEquals(deriveWhatsAppConnectionStatus({
    whatsapp_enabled: false,
    whatsapp_phone_number_id: null,
  }), "disconnected");
  assertEquals(deriveWhatsAppConnectionStatus({
    whatsapp_enabled: false,
    whatsapp_phone_number_id: "phone-id",
    whatsapp_registered: true,
    whatsapp_webhooks_subscribed: true,
  }), "pending_verification");
  assertEquals(deriveWhatsAppConnectionStatus({
    whatsapp_enabled: true,
    whatsapp_phone_number_id: "phone-id",
    whatsapp_registered: true,
    whatsapp_webhooks_subscribed: true,
  }), "connected");
});

Deno.test("only Referral Hub owners and admins may start Embedded Signup", () => {
  assert(mayStartWhatsAppEmbeddedSignup("owner"));
  assert(mayStartWhatsAppEmbeddedSignup("admin"));
  assertEquals(mayStartWhatsAppEmbeddedSignup("member"), false);
  assertEquals(mayStartWhatsAppEmbeddedSignup(""), false);
});

Deno.test("Referral Hub uses canonical WhatsApp signup and keeps Messenger isolated", async () => {
  const page = await Deno.readTextFile(
    new URL("../../../src/apps/referral-hub/pages/ReferralIntegrations.tsx", import.meta.url),
  );
  const signup = await Deno.readTextFile(
    new URL("../../../src/components/WhatsAppConnect.tsx", import.meta.url),
  );
  assertStringIncludes(page, "WhatsAppConnect");
  assertStringIncludes(page, 'eq("provider", "messenger")');
  assertEquals(page.includes('provider: "whatsapp"'), false);
  assertStringIncludes(page, 'const connect = async (provider: "messenger")');
  assertStringIncludes(signup, 'from("org_settings")');
  assertStringIncludes(signup, 'invoke("whatsapp-signup"');
  assertStringIncludes(signup, "window.FB.login");
  assertStringIncludes(signup, "config_id: FB_CONFIG_ID");
  assertStringIncludes(signup, "Reintentar");
  assertEquals(signup.includes("2017373949"), false);
});
