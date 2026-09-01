import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import { createMetaEmbeddedSignupAttempt } from "../src/lib/metaEmbeddedSignupAttempt.ts";

const frontendSource = await Deno.readTextFile(
  new URL("../src/components/WhatsAppConnect.tsx", import.meta.url),
);
const functionSource = await Deno.readTextFile(
  new URL("../supabase/functions/whatsapp-signup/index.ts", import.meta.url),
);

Deno.test("Embedded Signup follows the official code exchange contract", () => {
  assertStringIncludes(frontendSource, "attempt.acceptEvent");
  assertStringIncludes(frontendSource, "attempt.acceptCode");
  assertStringIncludes(
    frontendSource,
    "sessionInfoVersion: META_EMBEDDED_SIGNUP_SESSION_INFO_VERSION",
  );
  assertEquals(frontendSource.includes("meta_redirect_uri"), false);
  assertEquals(frontendSource.includes("captureNextMetaSdkRedirect"), false);
  assertEquals(
    functionSource.includes('searchParams.set("redirect_uri"'),
    false,
  );
  assertEquals(functionSource.includes("meta_redirect_uri"), false);
  for (
    const sdkArgument of [
      "config_id: FB_CONFIG_ID",
      'response_type: "code"',
      "override_default_response_type: true",
      "state: signupState",
      "META_EMBEDDED_SIGNUP_FEATURE_TYPE",
      'featureType: META_EMBEDDED_SIGNUP_FEATURE_TYPE',
      "response.authResponse.code",
    ]
  ) assertStringIncludes(frontendSource, sdkArgument);
  assertStringIncludes(
    frontendSource,
    'const META_EMBEDDED_SIGNUP_FEATURE_TYPE = "whatsapp_business_app_onboarding"',
  );
  assertStringIncludes(
    frontendSource,
    'META_EMBEDDED_SIGNUP_SESSION_INFO_VERSION = "3"',
  );
  assertEquals(frontendSource.includes("app_only_install"), false);
  for (const source of [frontendSource]) {
    assertEquals(source.includes("console.log("), false);
    assertEquals(source.includes("console.error(code"), false);
    assertEquals(source.includes("console.error(state"), false);
  }
});

Deno.test("attempt pairs callback-first code with the matching finish event once", () => {
  const results: unknown[] = [];
  const attempt = createMetaEmbeddedSignupAttempt((result) =>
    results.push(result)
  );
  assertEquals(attempt.acceptCode("one-time-code"), true);
  assertEquals(results, []);
  assertEquals(
    attempt.acceptEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "waba-1", phone_number_id: "phone-1" },
    }),
    "finish",
  );
  assertEquals(results, [{
    code: "one-time-code",
    wabaId: "waba-1",
    phoneNumberId: "phone-1",
    completion: {
      eventName: "FINISH",
      onboardingMode: "STANDARD",
      sessionInfoVersion: "3",
      businessAppCoexistenceCompleted: false,
    },
  }]);
  assertEquals(attempt.acceptCode("second-code"), false);
  assertEquals(results.length, 1);
});

Deno.test("Business App completion classifies coexistence and preserves canonical assets", () => {
  const results: unknown[] = [];
  const attempt = createMetaEmbeddedSignupAttempt((result) => results.push(result));
  assertEquals(
    attempt.acceptEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      data: { waba_id: "waba-coexist", phone_number_id: "phone-coexist" },
    }),
    "finish",
  );
  assertEquals(attempt.acceptCode("one-time-code"), true);
  assertEquals(results, [{
    code: "one-time-code",
    wabaId: "waba-coexist",
    phoneNumberId: "phone-coexist",
    completion: {
      eventName: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      onboardingMode: "COEXISTENCE",
      sessionInfoVersion: "3",
      businessAppCoexistenceCompleted: true,
    },
  }]);
  assertEquals(JSON.stringify(results).includes("access_token"), false);
  assertEquals(JSON.stringify(results).includes("app_secret"), false);
});

Deno.test("Business App completion is accepted even when Meta's payload omits phone_number_id", () => {
  const results: unknown[] = [];
  const attempt = createMetaEmbeddedSignupAttempt((result) => results.push(result));
  assertEquals(
    attempt.acceptEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      data: { waba_id: "waba-coexist-no-phone" },
    }),
    "finish",
  );
  assertEquals(attempt.acceptCode("one-time-code"), true);
  assertEquals(results, [{
    code: "one-time-code",
    wabaId: "waba-coexist-no-phone",
    phoneNumberId: "",
    completion: {
      eventName: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      onboardingMode: "COEXISTENCE",
      sessionInfoVersion: "3",
      businessAppCoexistenceCompleted: true,
    },
  }]);
});

Deno.test("Business App completion still requires a valid waba_id", () => {
  const results: unknown[] = [];
  const attempt = createMetaEmbeddedSignupAttempt((result) => results.push(result));
  assertEquals(
    attempt.acceptEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      data: {},
    }),
    "invalid_finish",
  );
  assertEquals(results, []);
});

Deno.test("STANDARD FINISH still requires phone_number_id even after the coexistence relaxation", () => {
  const results: unknown[] = [];
  const attempt = createMetaEmbeddedSignupAttempt((result) => results.push(result));
  assertEquals(
    attempt.acceptEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "waba-standard-no-phone" },
    }),
    "invalid_finish",
  );
  assertEquals(attempt.acceptCode("one-time-code"), true);
  assertEquals(results, []);
});

Deno.test("attempt pairs finish-first assets with the matching callback code once", () => {
  const results: unknown[] = [];
  const attempt = createMetaEmbeddedSignupAttempt((result) =>
    results.push(result)
  );
  assertEquals(
    attempt.acceptEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "waba-2", phone_number_id: "phone-2" },
    }),
    "finish",
  );
  assertEquals(results, []);
  assertEquals(attempt.acceptCode("one-time-code"), true);
  assertEquals(results.length, 1);
});

Deno.test("cancel and incomplete finish never trigger exchange", () => {
  const results: unknown[] = [];
  const incomplete = createMetaEmbeddedSignupAttempt((result) =>
    results.push(result)
  );
  assertEquals(incomplete.acceptCode("one-time-code"), true);
  assertEquals(
    incomplete.acceptEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "waba-1" },
    }),
    "invalid_finish",
  );
  assertEquals(results, []);

  const cancelled = createMetaEmbeddedSignupAttempt((result) =>
    results.push(result)
  );
  assertEquals(
    cancelled.acceptEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "CANCEL",
      data: {},
    }),
    "cancel",
  );
  assertEquals(cancelled.acceptCode("late-code"), false);
  assertEquals(results, []);
});

Deno.test("Meta ERROR is tracked without triggering exchange", () => {
  const results: unknown[] = [];
  const attempt = createMetaEmbeddedSignupAttempt((result) =>
    results.push(result)
  );
  assertEquals(
    attempt.acceptEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "ERROR",
      data: {},
    }),
    "error",
  );
  assertEquals(attempt.acceptCode("late-code"), false);
  assertEquals(results, []);
});

Deno.test("unknown completion events never trigger an exchange", () => {
  const results: unknown[] = [];
  const attempt = createMetaEmbeddedSignupAttempt((result) => results.push(result));
  assertEquals(
    attempt.acceptEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_SOMETHING_ELSE",
      data: { waba_id: "waba-ignored", phone_number_id: "phone-ignored" },
    }),
    "ignored",
  );
  assertEquals(attempt.acceptCode("one-time-code"), true);
  assertEquals(results, []);
});

Deno.test("frontend diagnostics retain only safe completion state", () => {
  for (const field of [
    "embedded_signup_opened",
    "fb_login_callback_received",
    "authorization_code_present",
    "embedded_signup_event_received",
    "embedded_signup_event_type",
    "waba_id_present",
    "phone_number_id_present",
    "code_and_finish_available",
    "backend_invocation_started",
    "backend_result",
    "onboarding_mode",
    "business_app_coexistence_completed",
    "connection_refresh_result",
  ]) assertStringIncludes(frontendSource, field);
  assertStringIncludes(frontendSource, "Embedded Signup diagnostics");
  assertStringIncludes(
    frontendSource,
    "refreshedRow = await loadStatus({ preserveStatusOnError: true });",
  );
  assertEquals(frontendSource.includes("authorization_code:"), false);
  assertEquals(frontendSource.includes("access_token:"), false);
  assertEquals(frontendSource.includes("raw postMessage"), false);
  assertEquals(frontendSource.includes("access_token"), false);
});

Deno.test("exchange persists only safe Embedded Signup completion metadata", () => {
  const exchangeStart = functionSource.indexOf("const completion = signupCompletionMetadata(body)");
  const updateStart = functionSource.indexOf(
    'admin.from("org_settings").update({',
    exchangeStart,
  );
  const updateEnd = functionSource.indexOf("}).eq(\"organization_id\"", updateStart);
  const update = functionSource.slice(updateStart, updateEnd);
  assert(exchangeStart > 0 && updateStart > exchangeStart && updateEnd > updateStart);
  for (const field of [
    "whatsapp_onboarding_event",
    "whatsapp_onboarding_mode",
    "whatsapp_session_info_version",
    "whatsapp_business_app_coexistence_completed",
  ]) assertStringIncludes(update, field);
  assertStringIncludes(functionSource, "signupCompletionMetadata(body)");
  assertEquals(update.includes("code:"), false);
  assertEquals(update.includes("appSecret"), false);
  assertEquals(update.includes("metaAppSecret"), false);
});

Deno.test("frontend installs the session listener before opening FB.login", () => {
  const listener = frontendSource.indexOf(
    'window.addEventListener("message", handler)',
  );
  const login = frontendSource.indexOf("window.FB.login");
  assertEquals(listener >= 0 && login > listener, true);
  assertEquals(frontendSource.includes("8_000"), false);
});

Deno.test("coexistence launch payload matches the documented extras contract exactly", () => {
  const loginStart = frontendSource.indexOf("window.FB.login((response) => {");
  assert(loginStart > 0);
  const extrasStart = frontendSource.indexOf("extras: {", loginStart);
  assert(extrasStart > loginStart);
  const loginCallEnd = frontendSource.indexOf("});", extrasStart);
  const loginCall = frontendSource.slice(loginStart, loginCallEnd + 3);

  assertStringIncludes(loginCall, "config_id: FB_CONFIG_ID");
  assertStringIncludes(loginCall, 'response_type: "code"');
  assertStringIncludes(loginCall, "override_default_response_type: true");
  assertStringIncludes(loginCall, "setup: {}");
  assertStringIncludes(loginCall, "featureType: META_EMBEDDED_SIGNUP_FEATURE_TYPE");
  assertStringIncludes(
    loginCall,
    "sessionInfoVersion: META_EMBEDDED_SIGNUP_SESSION_INFO_VERSION",
  );
  // No extras.version and no snake_case feature_type in the coexistence launch call.
  assertEquals(loginCall.includes("version:"), false);
  assertEquals(loginCall.includes("feature_type"), false);
});

Deno.test("local coexistence test environment resolves the new Login Configuration ID", async () => {
  const envLocal = await Deno.readTextFile(
    new URL("../.env.local", import.meta.url),
  );
  assertStringIncludes(
    envLocal,
    "VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID=28583319287919058",
  );
});
