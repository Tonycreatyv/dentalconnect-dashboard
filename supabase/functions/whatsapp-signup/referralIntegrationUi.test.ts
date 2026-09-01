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
    whatsapp_enabled: false,
    whatsapp_phone_number_id: "phone-id",
    whatsapp_registered: true,
    whatsapp_webhooks_subscribed: true,
    whatsapp_onboarding_event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    whatsapp_onboarding_mode: "COEXISTENCE",
    whatsapp_business_app_coexistence_completed: true,
  }), "onboarded_pending_activation");
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
  assertStringIncludes(signup, "Conectado a Meta");
  assertStringIncludes(signup, "Pendiente de verificar recepción de mensajes");
  assertStringIncludes(signup, "Verificar conexión");
  const pendingUi = signup.slice(
    signup.indexOf('status === "onboarded_pending_activation"'),
    signup.indexOf(': status !== "connected"'),
  );
  assertEquals(pendingUi.includes("Reconectar WhatsApp"), false);
  assertEquals(signup.includes("2017373949"), false);
});

Deno.test("Embedded Signup diagnostics separate backend response from connection refresh", async () => {
  const signup = await Deno.readTextFile(
    new URL("../../../src/components/WhatsAppConnect.tsx", import.meta.url),
  );
  const invokeStart = signup.indexOf('result = await supabase.functions.invoke("whatsapp-signup"');
  const invokeCatch = signup.indexOf("} catch (invokeError)", invokeStart);
  const successDiagnostic = signup.indexOf('backend_result: "SUCCESS"', invokeCatch);
  const statusRefresh = signup.indexOf("refreshedRow = await loadStatus({ preserveStatusOnError: true });", successDiagnostic);
  assert(invokeStart > 0);
  assert(invokeCatch > invokeStart);
  assert(successDiagnostic > invokeCatch);
  assert(statusRefresh > successDiagnostic);
  const refreshDiagnostic = signup.slice(statusRefresh, signup.indexOf("window.history.replaceState", statusRefresh));
  assertEquals(refreshDiagnostic.includes('backend_result: "SUCCESS"'), false);
  assertStringIncludes(refreshDiagnostic, 'connection_refresh_result: refreshedRow === undefined');
  const rejection = signup.slice(invokeCatch, successDiagnostic);
  assertStringIncludes(rejection, 'backend_result: "FAIL"');
  assertStringIncludes(rejection, 'connection_refresh_result: "NOT_ATTEMPTED"');
});

Deno.test("Meta test-asset validation stays owner-gated and sends only approved identifiers", async () => {
  const page = await Deno.readTextFile(
    new URL("../../../src/apps/referral-hub/pages/ReferralIntegrations.tsx", import.meta.url),
  );
  assertStringIncludes(page, "Validate Meta test number");
  assertStringIncludes(page, 'action: "validate_test_assets"');
  assertStringIncludes(page, 'organization_id: REFERRAL_DEMO_ORGANIZATION_ID');
  assertStringIncludes(page, 'const mayValidateMetaTestAssets = canManageWhatsApp');
  assertStringIncludes(page, 'supabase.functions.invoke("whatsapp-signup"');
  assertStringIncludes(page, 'phone_number_id: "1185864697945379"');
  assertStringIncludes(page, 'waba_id: "2080644335858568"');
  assertStringIncludes(page, 'expected_display_number: "+15551807992"');
  assertStringIncludes(page, 'expected_recipient: "+17707137058"');
  assertEquals(page.includes("whatsapp_access_token"), false);
});

Deno.test("test WABA diagnosis and subscription reuse the owner-only validator area", async () => {
  const page = await Deno.readTextFile(
    new URL("../../../src/apps/referral-hub/pages/ReferralIntegrations.tsx", import.meta.url),
  );
  assertStringIncludes(page, "Diagnose test WABA");
  assertStringIncludes(page, 'action: "diagnose_test_waba_subscription"');
  assertStringIncludes(page, "Subscribe test WABA");
  assertStringIncludes(page, 'action: "subscribe_test_waba"');
  assertStringIncludes(page, "metaDiagnostic?.meta_diagnostics");
  assertStringIncludes(page, "diagnostic.meta_error?.message");
  assertStringIncludes(page, "mayValidateMetaTestAssets");
  assertEquals(page.includes("whatsapp_access_token"), false);
});
