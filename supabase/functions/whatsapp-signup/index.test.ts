import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  buildMetaTokenUrl,
  classifyMetaOAuthMessage,
  createLuisBenefitsTestFlow,
  createLuisLegalTestFlows,
  debugLuisStoredWhatsAppToken,
  discoverLuisWhatsAppAssetsDirect,
  discoverLuisWhatsAppAssets,
  inspectWhatsAppActivation,
  inspectLuisTestFlowAccess,
  inspectStoredTestWabaSubscription,
  readLuisCanonicalWabaSubscribedApps,
  registerLuisWhatsAppBusinessPhone,
  resumeLuisBenefitsTestFlow,
  safeMetaReadDiagnostic,
  safeMetaOAuthDiagnostic,
  safeLuisWhatsAppPersistedState,
  signupCompletionMetadata,
  subscribeLuisWabaApp,
  subscribeStoredTestWaba,
  validateCoexistenceSignupAssets,
  validateStoredWhatsAppAssets,
} from "./index.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("signup rejects unauthenticated and unauthorized callers before Meta exchange", () => {
  assertStringIncludes(source, "if (!bearer)");
  assertStringIncludes(source, 'error: "unauthorized"');
  assertStringIncludes(source, "admin.auth.getUser(bearer)");
  assertStringIncludes(source, "organization_membership_required");
  assertStringIncludes(source, "owner_or_admin_required");
  assertStringIncludes(source, "REFERRAL_HUB_ORGANIZATION_ID");
  assertStringIncludes(source, "organization_forbidden");
});

Deno.test("signup requires signed state and explicit replacement confirmation", () => {
  assertStringIncludes(
    source,
    "verifySignupState(state, userId, metaAppSecret)",
  );
  assertStringIncludes(source, "replacement_confirmation_required");
  assertStringIncludes(source, "body.replace_existing !== true");
});

Deno.test("STANDARD signup never enables before its registration guard and webhook success", () => {
  const registration = source.indexOf('error: "registration_failed"');
  const webhook = source.indexOf('error: "webhook_subscription_failed"');
  const persistence = source.indexOf(
    'whatsapp_enabled: connectionState === "connected"',
  );
  assert(registration >= 0 && webhook > registration && persistence > webhook);
  assertEquals(source.includes('pin: "123456"'), false);
  assertEquals(source.includes("SUPABASE_ANON_KEY"), false);
  const successResponse = source.slice(
    source.lastIndexOf("return json(req, 200"),
  );
  assertEquals(successResponse.includes("accessToken"), false);
});

Deno.test("coexistence completion normalization is exact and does not trust client mode", () => {
  assertEquals(signupCompletionMetadata({
    onboarding_event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    onboarding_mode: "STANDARD",
    session_info_version: "3",
    business_app_coexistence_completed: false,
  }), {
    eventName: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    onboardingMode: "COEXISTENCE",
    sessionInfoVersion: "3",
    businessAppCoexistenceCompleted: true,
  });
  assertEquals(signupCompletionMetadata({
    onboarding_event: "FINISH",
    onboarding_mode: "COEXISTENCE",
    business_app_coexistence_completed: true,
  }), {
    eventName: "FINISH",
    onboardingMode: "STANDARD",
    sessionInfoVersion: null,
    businessAppCoexistenceCompleted: false,
  });
});

const coexistenceCompletion = signupCompletionMetadata({
  onboarding_event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  session_info_version: "3",
});

function coexistenceAssetFetch(options: {
  includePhoneInWaba?: boolean;
  wabaAccessFails?: boolean;
  phoneAccessFails?: boolean;
  returnedPhoneId?: string;
  phoneStatus?: string;
  codeVerificationStatus?: string;
  optionalFieldsUnsupported?: boolean;
} = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  let phoneReads = 0;
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    await Promise.resolve();
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/waba-coexistence/phone_numbers")) {
      return options.wabaAccessFails
        ? Response.json({
          error: {
            type: "OAuthException",
            code: 10,
            message: "Permission denied for Bearer SECRET_COEXISTENCE_TOKEN",
          },
        }, { status: 403 })
        : Response.json({
          data: options.includePhoneInWaba === false
            ? [{ id: "phone-foreign" }]
            : [{ id: "phone-coexistence" }],
        });
    }
    if (url.includes("/phone-coexistence?")) {
      phoneReads += 1;
      if (options.phoneAccessFails) {
        return Response.json({
          error: {
            type: "OAuthException",
            code: 190,
            message: "Invalid Bearer SECRET_COEXISTENCE_TOKEN",
          },
        }, { status: 401 });
      }
      if (
        options.optionalFieldsUnsupported && phoneReads === 1 &&
        url.includes("is_on_biz_app")
      ) {
        return Response.json({
          error: {
            type: "OAuthException",
            code: 100,
            message: "Tried accessing nonexisting field (is_on_biz_app)",
          },
        }, { status: 400 });
      }
      return Response.json({
        id: options.returnedPhoneId ?? "phone-coexistence",
        display_phone_number: "+1 770-713-7058",
        verified_name: "Luis Gabriel Productions LLC",
        status: options.phoneStatus ?? "UNAVAILABLE_FOR_STANDARD_REGISTRATION",
        code_verification_status: options.codeVerificationStatus ?? "NOT_VERIFIED",
        ...(!options.optionalFieldsUnsupported
          ? { platform_type: "NOT_APPLICABLE", is_on_biz_app: true }
          : {}),
      });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { calls, fetchFn };
}

async function validateCoexistenceWith(
  fetchFn: typeof fetch,
  completion = coexistenceCompletion,
) {
  return await validateCoexistenceSignupAssets({
    graphVersion: "v21.0",
    accessToken: "SECRET_COEXISTENCE_TOKEN",
    wabaId: "waba-coexistence",
    phoneNumberId: "phone-coexistence",
    completion,
    fetchFn,
  });
}

Deno.test("coexistence accepts exact assets without the STANDARD registration predicate", async () => {
  const fixture = coexistenceAssetFetch({
    phoneStatus: "SOME_COEXISTENCE_STATE",
    codeVerificationStatus: "NOT_VERIFIED",
  });
  const result = await validateCoexistenceWith(fixture.fetchFn as typeof fetch);
  assertEquals(result.ok, true);
  assertEquals(result.phone?.id, "phone-coexistence");
  assertEquals(result.phone?.status, "SOME_COEXISTENCE_STATE");
  assertEquals(result.phone?.code_verification_status, "NOT_VERIFIED");
  assertEquals(result.phone?.platform_type, "NOT_APPLICABLE");
  assertEquals(result.phone?.is_on_biz_app, true);
  assertEquals(result.diagnostics.phone_found_in_waba, "PASS");
  assertEquals(fixture.calls.length, 2);
  assertEquals(fixture.calls.every((call) => call.method === "GET"), true);
  assertEquals(fixture.calls.some((call) => call.url.includes("/register")), false);
  assertEquals(JSON.stringify(result).includes("SECRET_COEXISTENCE_TOKEN"), false);
});

Deno.test("coexistence requires exact phone membership in the exact WABA", async () => {
  const missing = coexistenceAssetFetch({ includePhoneInWaba: false });
  const missingResult = await validateCoexistenceWith(missing.fetchFn as typeof fetch);
  assertEquals(missingResult.ok, false);
  assertEquals(missingResult.error, "coexistence_phone_not_in_waba");
  assertEquals(missingResult.diagnostics.phone_found_in_waba, "FAIL");
  assertEquals(missing.calls.length, 1);

  const wrongPhone = coexistenceAssetFetch({ returnedPhoneId: "phone-foreign" });
  const wrongPhoneResult = await validateCoexistenceWith(
    wrongPhone.fetchFn as typeof fetch,
  );
  assertEquals(wrongPhoneResult.ok, false);
  assertEquals(wrongPhoneResult.error, "coexistence_phone_identity_mismatch");
  assertEquals(wrongPhone.calls.every((call) => call.method === "GET"), true);
});

Deno.test("coexistence requires token access to exact WABA and phone", async () => {
  const deniedWaba = coexistenceAssetFetch({ wabaAccessFails: true });
  const deniedWabaResult = await validateCoexistenceWith(
    deniedWaba.fetchFn as typeof fetch,
  );
  assertEquals(deniedWabaResult.ok, false);
  assertEquals(deniedWabaResult.error, "coexistence_waba_access_failed");
  assertEquals(deniedWabaResult.meta_diagnostic?.http_status, 403);

  const deniedPhone = coexistenceAssetFetch({ phoneAccessFails: true });
  const deniedPhoneResult = await validateCoexistenceWith(
    deniedPhone.fetchFn as typeof fetch,
  );
  assertEquals(deniedPhoneResult.ok, false);
  assertEquals(deniedPhoneResult.error, "coexistence_phone_access_failed");
  assertEquals(deniedPhoneResult.meta_diagnostic?.http_status, 401);
  assertEquals(JSON.stringify(deniedPhoneResult).includes("SECRET_COEXISTENCE_TOKEN"), false);
});

Deno.test("coexistence optional phone fields can fall back without weakening identity", async () => {
  const fixture = coexistenceAssetFetch({ optionalFieldsUnsupported: true });
  const result = await validateCoexistenceWith(fixture.fetchFn as typeof fetch);
  assertEquals(result.ok, true);
  assertEquals(result.diagnostics.optional_phone_fields, "UNAVAILABLE");
  assertEquals(result.phone?.platform_type, null);
  assertEquals(result.phone?.is_on_biz_app, null);
  assertEquals(fixture.calls.length, 3);
  assertEquals(fixture.calls.every((call) => call.method === "GET"), true);
  assertEquals(fixture.calls[2].url.includes("platform_type"), false);
  assertEquals(fixture.calls[2].url.includes("is_on_biz_app"), false);
});

Deno.test("coexistence validator rejects non-coexistence completion before Meta", async () => {
  const fixture = coexistenceAssetFetch();
  const result = await validateCoexistenceWith(
    fixture.fetchFn as typeof fetch,
    signupCompletionMetadata({ onboarding_event: "FINISH" }),
  );
  assertEquals(result.ok, false);
  assertEquals(result.error, "coexistence_completion_invalid");
  assertEquals(fixture.calls.length, 0);
});

Deno.test("exchange isolates coexistence from STANDARD readiness and never registers", () => {
  const exchangeStart = source.indexOf('if (action !== "exchange")');
  const exchange = source.slice(exchangeStart);
  const coexistenceValidation = exchange.indexOf(
    "validateCoexistenceSignupAssets",
  );
  const standardGuard = exchange.indexOf("const registrationReady =");
  const coexistenceSubscription = exchange.indexOf("subscribeLuisWabaApp", standardGuard);
  const persistence = exchange.indexOf('admin.from("org_settings").update({');
  assert(coexistenceValidation > 0);
  assert(standardGuard > coexistenceValidation);
  assert(coexistenceSubscription > standardGuard);
  assert(persistence > coexistenceSubscription);
  assertStringIncludes(
    exchange,
    'completion.eventName ===\n          "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"',
  );
  assertStringIncludes(exchange, 'completion.onboardingMode === "COEXISTENCE"');
  assertStringIncludes(exchange, "completion.businessAppCoexistenceCompleted === true");
  assertStringIncludes(exchange, "phoneData.code_verification_status === \"VERIFIED\"");
  assertStringIncludes(exchange, '["CONNECTED", "PENDING"].includes(');
  assertEquals(exchange.includes(`${encodeURIComponent("phone")}/register`), false);
  assertEquals(exchange.includes("/register"), false);
});

Deno.test("coexistence subscription is verified before persistence and failure cannot write", () => {
  const exchangeStart = source.indexOf('if (action !== "exchange")');
  const exchange = source.slice(exchangeStart);
  const identityValidation = exchange.indexOf("validateCoexistenceSignupAssets");
  const failedIdentityReturn = exchange.indexOf(
    'error: coexistenceValidation.error',
    identityValidation,
  );
  const subscription = exchange.indexOf("subscribeLuisWabaApp", failedIdentityReturn);
  const expectedAppGuard = exchange.indexOf(
    'subscription.expected_app_present !== "PASS"',
    subscription,
  );
  const update = exchange.indexOf('admin.from("org_settings").update({', expectedAppGuard);
  assert(identityValidation > 0);
  assert(failedIdentityReturn > identityValidation);
  assert(subscription > failedIdentityReturn);
  assert(expectedAppGuard > subscription);
  assert(update > expectedAppGuard);
  for (const persisted of [
    "whatsapp_access_token: accessToken",
    "whatsapp_phone_number_id: phoneNumberId",
    "whatsapp_waba_id: wabaId",
    "whatsapp_onboarding_event: completion.eventName",
    "whatsapp_onboarding_mode: completion.onboardingMode",
    "whatsapp_session_info_version: completion.sessionInfoVersion",
    "whatsapp_business_app_coexistence_completed:",
  ]) assertStringIncludes(exchange.slice(update), persisted);
});

Deno.test("coexistence diagnostics are safe and activation remains conservative", () => {
  const exchangeStart = source.indexOf('if (action !== "exchange")');
  const exchange = source.slice(exchangeStart);
  assertStringIncludes(exchange, "coexistence_validation_failed");
  assertStringIncludes(exchange, "normalized_phone_status");
  assertStringIncludes(exchange, "phone_found_in_waba");
  assertStringIncludes(exchange, "subscription_before");
  assertStringIncludes(exchange, "subscription_after");
  assertStringIncludes(exchange, "!coexistenceCompletion &&");
  const telemetryStart = exchange.indexOf("const exchangeTelemetry = {");
  const telemetryEnd = exchange.indexOf("const exchangeFailure", telemetryStart);
  const telemetry = exchange.slice(telemetryStart, telemetryEnd);
  for (const forbidden of [
    "accessToken",
    "metaAppSecret",
    "code:",
    "authorization",
    "cookie",
  ]) assertEquals(telemetry.includes(forbidden), false);
});

Deno.test("signup responses and logs omit credentials", () => {
  assertEquals(source.includes("token exchanged"), false);
  const logCalls =
    source.match(/console\.(?:error|log|warn)\([\s\S]*?\);/g)?.join("\n") ?? "";
  assertEquals(logCalls.includes("metaAppSecret"), false);
  assertEquals(logCalls.includes("tokenUrl"), false);
  assertStringIncludes(source, 'return_to: "/integrations"');
});

Deno.test("token exchange failures keep the safe public 502 contract", () => {
  assertStringIncludes(
    source,
    'return exchangeFailure(502, "token_exchange_failed")',
  );
  assertStringIncludes(source, 'stage: "token_exchange"');
});

Deno.test("exchange completion telemetry contains only safe status fields", () => {
  const telemetryStart = source.indexOf("const exchangeTelemetry = {");
  const telemetryEnd = source.indexOf("const exchangeFailure", telemetryStart);
  const telemetry = source.slice(telemetryStart, telemetryEnd);
  assert(telemetryStart > 0 && telemetryEnd > telemetryStart);
  for (const field of [
    "request_received",
    "authenticated_org",
    "code_present",
    "waba_id_present",
    "phone_number_id_present",
    "meta_code_exchange_attempted",
    "org_settings_write_attempted",
    "org_settings_write_succeeded",
    "whatsapp_enabled_final",
  ]) assertStringIncludes(telemetry, field);
  assertEquals(telemetry.includes("accessToken"), false);
  assertEquals(telemetry.includes("metaAppSecret"), false);
  assertEquals(telemetry.includes("code: code"), false);
  assertStringIncludes(source, '"[whatsapp-signup] exchange_received"');
  assertStringIncludes(source, '"[whatsapp-signup] exchange_persisted"');
});

Deno.test("Meta OAuth diagnostics contain only allowlisted safe metadata", () => {
  const diagnostic = safeMetaOAuthDiagnostic(400, {
    error: {
      message:
        "The authorization code SECRET_CODE has expired and includes SECRET_STATE SECRET_TOKEN SECRET_WABA SECRET_PHONE SECRET_CLIENT",
      type: "OAuthException",
      code: 100,
      error_subcode: 36008,
      fbtrace_id: "SafeTrace_123",
      access_token: "SECRET_TOKEN",
    },
    raw_provider_body: "SECRET_RAW_BODY",
  });
  assertEquals(diagnostic, {
    stage: "token_exchange",
    upstream_status: 400,
    meta_error_type: "OAuthException",
    meta_error_code: 100,
    meta_error_subcode: 36008,
    safe_message_category: "code_expired_or_reused",
    trace_id: "SafeTrace_123",
  });
  const serialized = JSON.stringify(diagnostic);
  for (
    const sensitiveMarker of [
      "SECRET_CODE",
      "SECRET_STATE",
      "SECRET_TOKEN",
      "SECRET_WABA",
      "SECRET_PHONE",
      "SECRET_CLIENT",
      "SECRET_RAW_BODY",
    ]
  ) {
    assertEquals(serialized.includes(sensitiveMarker), false);
  }
});

Deno.test("Meta read diagnostics preserve safe 400 and OAuth metadata", () => {
  const diagnostic = safeMetaReadDiagnostic(400, {
    error: {
      type: "OAuthException",
      code: 190,
      error_subcode: 463,
      message: "Session has expired for token SECRET_TEST_TOKEN at https://graph.facebook.com/?access_token=SECRET_TEST_TOKEN",
    },
  });
  assertEquals(diagnostic.http_status, 400);
  assertEquals(diagnostic.meta_error?.type, "OAuthException");
  assertEquals(diagnostic.meta_error?.code, 190);
  assertEquals(diagnostic.meta_error?.error_subcode, 463);
  assertEquals(diagnostic.meta_error?.message?.includes("SECRET_TEST_TOKEN"), false);
  assertEquals(diagnostic.meta_error?.message?.includes("https://"), false);
  assertEquals(JSON.stringify(diagnostic).includes("Authorization"), false);
});

Deno.test("Meta read diagnostics preserve safe 401 metadata without credentials", () => {
  const diagnostic = safeMetaReadDiagnostic(401, {
    error: {
      type: "OAuthException",
      code: 10,
      message: "Permission denied for Bearer SECRET_TEST_TOKEN",
    },
  });
  assertEquals(diagnostic.classification, "META_HTTP_ERROR");
  assertEquals(diagnostic.http_status, 401);
  assertEquals(diagnostic.meta_error?.code, 10);
  assertEquals(JSON.stringify(diagnostic).includes("SECRET_TEST_TOKEN"), false);
});

Deno.test("Meta read diagnostics redact a six-digit PIN if a provider echoes it", () => {
  const runtimePin = "7".repeat(6);
  const diagnostic = safeMetaReadDiagnostic(400, {
    error: {
      type: "OAuthException",
      code: 100,
      message: `Registration failed for PIN ${runtimePin}`,
    },
  });
  assertEquals(JSON.stringify(diagnostic).includes(runtimePin), false);
  assertEquals(diagnostic.meta_error?.message?.includes("[redacted-pin]"), true);
});

Deno.test("Meta OAuth messages map to safe categories", () => {
  assertEquals(
    classifyMetaOAuthMessage(
      "The redirect_uri does not match the original URI",
    ),
    "redirect_uri_mismatch",
  );
  assertEquals(
    classifyMetaOAuthMessage("Invalid client credentials or app secret"),
    "invalid_client_credentials",
  );
  assertEquals(
    classifyMetaOAuthMessage("This authorization code has already been used"),
    "code_expired_or_reused",
  );
  assertEquals(
    classifyMetaOAuthMessage("Invalid authorization code"),
    "invalid_authorization_code",
  );
  assertEquals(
    classifyMetaOAuthMessage("Configuration ID does not belong to this app"),
    "app_configuration_mismatch",
  );
  assertEquals(
    classifyMetaOAuthMessage("Provider rejected the request"),
    "unknown_meta_oauth_error",
  );
});

Deno.test("unsafe provider metadata is omitted from diagnostics", () => {
  assertEquals(
    safeMetaOAuthDiagnostic(502, {
      error: {
        type: "OAuthException with unsafe spaces",
        code: "not-numeric",
        error_subcode: -1,
        fbtrace_id: "unsafe trace value",
      },
    }),
    {
      stage: "token_exchange",
      upstream_status: 502,
      safe_message_category: "unknown_meta_oauth_error",
    },
  );
});

Deno.test("token exchange uses only the official OAuth parameters", () => {
  const tokenUrl = buildMetaTokenUrl(
    "v21.0",
    "public-app-id",
    "test-secret",
    "code with reserved &=? characters",
  );
  assertEquals([...tokenUrl.searchParams.keys()], [
    "client_id",
    "client_secret",
    "code",
  ]);
  assertEquals(
    tokenUrl.searchParams.get("code"),
    "code with reserved &=? characters",
  );
});

Deno.test("signup has no redirect workaround or static redirect secret", () => {
  assertEquals(source.includes("meta_redirect_uri"), false);
  assertEquals(source.includes("body.redirect_uri"), false);
  assertEquals(source.includes('searchParams.set("redirect_uri"'), false);
  assertEquals(source.includes('env("META_WHATSAPP_REDIRECT_URI")'), false);
});

Deno.test("Luis Benefits test Flow resume action is owner-gated, hard-bound, and rejects client credentials", () => {
  const actionStart = source.indexOf('action === "resume_luis_benefits_test_flow"');
  const actionEnd = source.indexOf('if (action === "validate_test_assets")', actionStart);
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assert(actionStart > source.indexOf("organization_forbidden"));
  assertStringIncludes(action, '"waba_id"');
  assertStringIncludes(action, '"phone_number_id"');
  assertStringIncludes(action, '"flow_id"');
  assertStringIncludes(action, '"access_token"');
  assertStringIncludes(action, 'Deno.env.get("META_WHATSAPP_TEST_ACCESS_TOKEN")');
  assertStringIncludes(action, "resumeLuisBenefitsTestFlow");
  assertStringIncludes(action, "META_TEST_WABA_ID");
  assertStringIncludes(action, "META_TEST_PHONE_NUMBER_ID");
  assertEquals(action.includes("LUIS_WABA_ID"), false);
  assertEquals(action.includes("LUIS_PHONE_NUMBER_ID"), false);
  assertEquals(action.includes(".update("), false);
  assertEquals(action.includes(".insert("), false);
  assertEquals(action.includes("publish"), false);
});

Deno.test("Luis Benefits test Flow creates only on the test WABA, uploads the approved JSON, and never publishes", async () => {
  const calls: Array<{ url: string; method: string; body?: BodyInit | null }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    if (url.includes("/2080644335858568/flows") && init?.method === "POST") {
      return Response.json({ id: "test-flow-123" });
    }
    if (url.includes("/test-flow-123/assets") && init?.method === "POST") {
      return Response.json({ success: true, validation_errors: [] });
    }
    if (url.includes("/test-flow-123?fields=id,name,status,categories")) {
      return Response.json({
        id: "test-flow-123",
        name: "Luis Benefits TEST",
        status: "DRAFT",
        categories: ["OTHER"],
      });
    }
    return new Response("{}", { status: 404 });
  };
  const result = await createLuisBenefitsTestFlow({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    fetchFn,
  });
  assertEquals(result.test_waba_id, "2080644335858568");
  assertEquals(result.test_phone_number_id, "1185864697945379");
  assertEquals(result.flow_id, "test-flow-123");
  assertEquals(result.flow_status, "DRAFT");
  assertEquals(result.json_uploaded, true);
  assertEquals(result.meta_accepted, true);
  assertEquals(result.validation_errors, []);
  assertEquals(calls.length, 3);
  assertEquals(calls.every((call) => !call.url.includes("1423647499608507")), true);
  assertEquals(calls.every((call) => !call.url.includes("1287679991091560")), true);
  assertEquals(calls.every((call) => !call.url.includes("publish")), true);
  const createBody = calls[0].body as FormData;
  const uploadBody = calls[1].body as FormData;
  assertEquals(createBody.get("name"), "Luis Benefits TEST");
  assertEquals(createBody.get("categories"), '["OTHER"]');
  assertEquals(uploadBody.get("asset_type"), "FLOW_JSON");
  assertEquals(uploadBody.get("name"), "flow.json");
  const file = uploadBody.get("file") as File;
  assertEquals(file.name, "flow.json");
  const flowJson = await file.text();
  assertStringIncludes(flowJson, '"BENEFIT_SELECT"');
  assertStringIncludes(flowJson, '"CUSTOMER_DETAILS"');
  assertStringIncludes(flowJson, '"SUPERMARKET"');
  assertStringIncludes(flowJson, '"SHIPPING"');
  assertEquals(JSON.stringify(result).includes("SECRET_TEST_TOKEN"), false);
});

Deno.test("Luis Benefits test Flow sanitizes Meta validation errors and stops before readback", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.includes("/2080644335858568/flows")) {
      return Response.json({ id: "test-flow-456" });
    }
    return Response.json({
      success: true,
      validation_errors: [{
        error: "INVALID_PROPERTY",
        error_type: "JSON_SCHEMA_ERROR",
        message: "Invalid property with SECRET_TEST_TOKEN",
        line_start: 42,
      }],
    });
  };
  const result = await createLuisBenefitsTestFlow({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    fetchFn,
  });
  assertEquals(result.flow_id, "test-flow-456");
  assertEquals(result.meta_accepted, false);
  assertEquals(result.validation_errors.length, 1);
  assertEquals(result.validation_errors[0].error, "INVALID_PROPERTY");
  assertEquals(result.validation_errors[0].line_start, 42);
  assertEquals(JSON.stringify(result).includes("SECRET_TEST_TOKEN"), false);
  assertEquals(calls.length, 2);
  assertEquals(calls.every((call) => !call.url.includes("?fields=")), true);
  assertEquals(calls.every((call) => !call.url.includes("publish")), true);
});

Deno.test("Luis Benefits test Flow resume reuses only the created test Flow and never creates another", async () => {
  const calls: Array<{ url: string; method: string; body?: BodyInit | null }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    if (url.includes("/2161490298097845/assets") && init?.method === "POST") {
      return Response.json({ success: true, validation_errors: [] });
    }
    if (url.includes("/2161490298097845?fields=id,name,status,categories")) {
      return Response.json({
        id: "2161490298097845",
        name: "Luis Benefits TEST",
        status: "DRAFT",
      });
    }
    return new Response("{}", { status: 404 });
  };
  const result = await resumeLuisBenefitsTestFlow({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    fetchFn,
  });
  assertEquals(result.flow_id, "2161490298097845");
  assertEquals(result.meta_accepted, true);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].url.includes("/2080644335858568/flows"), false);
  assertEquals(calls.every((call) => !call.url.includes("1423647499608507")), true);
  assertEquals(calls.every((call) => !call.url.includes("publish")), true);
  const uploadBody = calls[0].body as FormData;
  assertEquals(uploadBody.get("name"), "flow.json");
  assertEquals(uploadBody.get("asset_type"), "FLOW_JSON");
  const file = uploadBody.get("file") as File;
  assertEquals(file.name, "flow.json");
  assertStringIncludes(await file.text(), '"CUSTOMER_DETAILS"');
  assertEquals(JSON.stringify(result).includes("SECRET_TEST_TOKEN"), false);
});

Deno.test("Luis TEST Flow access inspection is owner-gated, hard-coded, and GET-only", () => {
  const actionStart = source.indexOf('if (action === "inspect_luis_test_flow_access")');
  const actionEnd = source.indexOf('if (action === "validate_test_assets")', actionStart);
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assertStringIncludes(action, 'Deno.env.get("META_WHATSAPP_TEST_ACCESS_TOKEN")');
  assertStringIncludes(action, "inspectLuisTestFlowAccess");
  assertStringIncludes(action, '"flow_id"');
  assertEquals(action.includes("LUIS_WABA_ID"), false);
  assertEquals(action.includes("LUIS_PHONE_NUMBER_ID"), false);
  assertEquals(action.includes(".update("), false);
  assertEquals(action.includes(".insert("), false);
  assertEquals(action.includes("POST"), false);
  assertEquals(action.includes("publish"), false);
});

Deno.test("Luis TEST Flow access inspection returns only allowlisted GET metadata", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.includes("/2080644335858568/flows?")) {
      return Response.json({ data: [{ id: "1593418642409687" }, { id: "2161490298097845" }] });
    }
    if (url.includes("/1593418642409687?fields=id,name,status,categories,validation_errors")) {
      return Response.json({ id: "1593418642409687", name: "Luis Immigration TEST", status: "DRAFT", categories: ["OTHER"], validation_errors: [] });
    }
    if (url.includes("/2161490298097845?fields=id,name,status,categories,validation_errors")) {
      return Response.json({ id: "2161490298097845", name: "Luis Benefits TEST", status: "DRAFT", categories: ["OTHER"], validation_errors: [] });
    }
    if (url.includes("/1593418642409687?fields=health_status")) {
      return Response.json({ health_status: "AVAILABLE", availability: true, whatsapp_business_account: { id: "2080644335858568" } });
    }
    if (url.includes("/2161490298097845?fields=health_status")) {
      return Response.json({ health_status: "AVAILABLE", availability: true, whatsapp_business_account: { id: "2080644335858568" } });
    }
    return new Response("{}", { status: 404 });
  };
  const result = await inspectLuisTestFlowAccess({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    fetchFn,
  });
  assertEquals(result.test_waba_id, "2080644335858568");
  assertEquals(result.test_phone_number_id, "1185864697945379");
  assertEquals(result.flows.map((flow) => flow.id), ["1593418642409687", "2161490298097845"]);
  assertEquals(result.flows.every((flow) => flow.accessible && flow.test_waba_membership === "PASS" && flow.eligible_for_test_draft_send === "PASS"), true);
  assertEquals(result.flows[0].owning_waba_id, "2080644335858568");
  assertEquals(calls.every((call) => call.method === "GET"), true);
  assertEquals(calls.every((call) => !call.url.includes("1423647499608507")), true);
  assertEquals(JSON.stringify(result).includes("SECRET_TEST_TOKEN"), false);
});

Deno.test("Luis TEST Flow access inspection keeps direct Flow errors sanitized", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.includes("/2080644335858568/flows?")) return Response.json({ data: [{ id: "1593418642409687" }] });
    if (url.includes("/2161490298097845?fields=id")) {
      return Response.json({ error: { type: "OAuthException", code: 131005, error_subcode: 99, message: "Access denied SECRET_TEST_TOKEN" } }, { status: 403 });
    }
    if (url.includes("/1593418642409687?fields=id")) {
      return Response.json({ id: "1593418642409687", name: "Luis Immigration TEST", status: "DRAFT" });
    }
    return Response.json({});
  };
  const result = await inspectLuisTestFlowAccess({ graphVersion: "v21.0", accessToken: "SECRET_TEST_TOKEN", fetchFn });
  const benefits = result.flows.find((flow) => flow.id === "2161490298097845");
  assertEquals(benefits?.accessible, false);
  assertEquals(benefits?.meta_diagnostic?.http_status, 403);
  assertEquals(benefits?.meta_diagnostic?.meta_error?.code, 131005);
  assertEquals(JSON.stringify(result).includes("SECRET_TEST_TOKEN"), false);
  assertEquals(calls.every((call) => call.method === "GET"), true);
});

Deno.test("Luis legal test Flow creation is owner-gated, test-bound, and never references Luis assets", () => {
  const actionStart = source.indexOf('if (action === "create_luis_legal_test_flows")');
  const actionEnd = source.indexOf('if (action === "validate_test_assets")', actionStart);
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assertStringIncludes(action, 'Deno.env.get("META_WHATSAPP_TEST_ACCESS_TOKEN")');
  assertStringIncludes(action, "createLuisLegalTestFlows");
  assertStringIncludes(action, "META_TEST_WABA_ID");
  assertStringIncludes(action, "META_TEST_PHONE_NUMBER_ID");
  assertEquals(action.includes("LUIS_WABA_ID"), false);
  assertEquals(action.includes("LUIS_PHONE_NUMBER_ID"), false);
  assertEquals(action.includes("publish"), false);
});

Deno.test("Luis legal test Flows create, upload, and validate sequentially on the test WABA only", async () => {
  const calls: Array<{ url: string; method: string; body?: BodyInit | null }> = [];
  let created = 0;
  const ids = ["legal-flow-immigration", "legal-flow-accident", "legal-flow-criminal"];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    if (url.includes("/2080644335858568/flows?") && init?.method !== "POST") {
      return Response.json({ data: [] });
    }
    if (url.includes("/2080644335858568/flows") && init?.method === "POST") {
      return Response.json({ id: ids[created++] });
    }
    const id = ids.find((candidate) => url.includes(`/${candidate}`));
    if (id && url.includes("/assets") && init?.method === "POST") {
      return Response.json({ success: true, validation_errors: [] });
    }
    if (id && url.includes("?fields=id,name,status,categories")) {
      return Response.json({ id, status: "DRAFT" });
    }
    return new Response("{}", { status: 404 });
  };
  const flows = await createLuisLegalTestFlows({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    fetchFn,
  });
  assertEquals(flows.map((flow) => flow.flow_name), [
    "Luis Immigration TEST",
    "Luis Auto Accident TEST",
    "Luis DUI Criminal TEST",
  ]);
  assertEquals(flows.every((flow) => flow.meta_accepted && flow.flow_status === "DRAFT"), true);
  assertEquals(calls.filter((call) => call.url.includes("/2080644335858568/flows") && call.method === "POST").length, 3);
  assertEquals(calls.every((call) => !call.url.includes("1423647499608507")), true);
  assertEquals(calls.every((call) => !call.url.includes("1287679991091560")), true);
  assertEquals(calls.every((call) => !call.url.includes("publish")), true);
  const uploadBodies = calls.filter((call) => call.url.includes("/assets")).map((call) => call.body as FormData);
  assertEquals(uploadBodies.length, 3);
  for (const body of uploadBodies) {
    assertEquals(body.get("name"), "flow.json");
    assertEquals(body.get("asset_type"), "FLOW_JSON");
    assertStringIncludes(await (body.get("file") as File).text(), '"version":"7.3"');
  }
  assertEquals(JSON.stringify(flows).includes("SECRET_TEST_TOKEN"), false);
});

Deno.test("Luis legal test Flows reuse matching DRAFT assets instead of creating duplicates", async () => {
  const ids = ["existing-immigration", "existing-accident", "existing-criminal"];
  const names = ["Luis Immigration TEST", "Luis Auto Accident TEST", "Luis DUI Criminal TEST"];
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.includes("/2080644335858568/flows?") && init?.method !== "POST") {
      return Response.json({ data: ids.map((id, index) => ({ id, name: names[index], status: "DRAFT" })) });
    }
    const id = ids.find((candidate) => url.includes(`/${candidate}`));
    if (id && url.includes("/assets") && init?.method === "POST") {
      return Response.json({ success: true, validation_errors: [], validation_warnings: [] });
    }
    if (id && url.includes("?fields=id,name,status,categories")) {
      return Response.json({ id, status: "DRAFT" });
    }
    return new Response("{}", { status: 404 });
  };
  const flows = await createLuisLegalTestFlows({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    fetchFn,
  });
  assertEquals(flows.map((flow) => flow.flow_id), ids);
  assertEquals(calls.some((call) => call.url.endsWith("/flows") && call.method === "POST"), false);
});

function metaReadOnlyFetch(options: {
  displayNumber?: string;
  includePhoneInWaba?: boolean;
  includeSubscribedApp?: boolean;
  fail?: boolean;
}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (options.fail) return new Response("{}", { status: 403 });
    if (url.includes("/1185864697945379?")) {
      return Response.json({
        id: "1185864697945379",
        display_phone_number: options.displayNumber ?? "+1 (555) 180-7992",
      });
    }
    if (url.includes("/2080644335858568/phone_numbers")) {
      return Response.json({
        data: options.includePhoneInWaba === false ? [] : [{
          id: "1185864697945379",
          display_phone_number: options.displayNumber ?? "+1 (555) 180-7992",
        }],
      });
    }
    return Response.json({
      data: options.includeSubscribedApp === false
        ? []
        : [{ whatsapp_business_api_data: { id: "2290735921663266" } }],
    });
  };
  return { calls, fetchFn };
}

async function validateWith(
  fetchFn: typeof fetch,
  overrides: Partial<Parameters<typeof validateStoredWhatsAppAssets>[0]> = {},
) {
  return await validateStoredWhatsAppAssets({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    phoneNumberId: "1185864697945379",
    wabaId: "2080644335858568",
    expectedDisplayNumber: "+15551807992",
    expectedAppId: "2290735921663266",
    expectedRecipient: "+17707137058",
    fetchFn,
    ...overrides,
  });
}

Deno.test("test-asset validation is owner-gated, org-bound, and token-safe", () => {
  const validationStart = source.indexOf('if (action === "validate_test_assets")');
  const validationEnd = source.indexOf('if (action === "discover_luis_whatsapp_assets")');
  const validationAction = source.slice(validationStart, validationEnd);
  assert(validationStart > source.indexOf("owner_or_admin_required"));
  assert(validationStart > source.indexOf("organization_forbidden"));
  assertStringIncludes(validationAction, 'select(\n          "whatsapp_access_token",');
  assertStringIncludes(validationAction, 'token_configured: false');
  assertEquals(validationAction.includes(".update("), false);
  assertEquals(validationAction.includes(".insert("), false);
  assertEquals(validationAction.includes(".upsert("), false);
  assertEquals(validationAction.includes("/messages"), false);
});

Deno.test("test-asset validation returns safe read-only success metadata", async () => {
  const { calls, fetchFn } = metaReadOnlyFetch({});
  const validation = await validateWith(fetchFn as typeof fetch);
  assertEquals(validation.token_configured, true);
  assertEquals(validation.phone_id_accessible, true);
  assertEquals(validation.display_number_match, "PASS");
  assertEquals(validation.waba_match, "PASS");
  assertEquals(validation.messaging_asset_accessible, true);
  assertEquals(validation.webhook_status, "PASS");
  assertEquals(validation.app_relationship, "PASS");
  assertEquals(validation.recipient_authorization, "UNKNOWN");
  assertEquals(validation.overall, "PARTIAL");
  assertEquals(JSON.stringify(validation).includes("SECRET_TEST_TOKEN"), false);
  assertEquals(calls.every((call) => call.method === "GET"), true);
  assertEquals(calls.some((call) => call.url.includes("/messages")), false);
});

Deno.test("test-asset validation fails display or WABA mismatches without writes", async () => {
  const display = metaReadOnlyFetch({ displayNumber: "+1 555 180 0000" });
  const displayValidation = await validateWith(display.fetchFn as typeof fetch);
  assertEquals(displayValidation.display_number_match, "FAIL");
  assertEquals(displayValidation.overall, "FAIL");

  const waba = metaReadOnlyFetch({ includePhoneInWaba: false });
  const wabaValidation = await validateWith(waba.fetchFn as typeof fetch);
  assertEquals(wabaValidation.waba_match, "FAIL");
  assertEquals(wabaValidation.messaging_asset_accessible, false);
  assertEquals(wabaValidation.overall, "FAIL");
});

Deno.test("test-asset validation reports Meta failures without inferring a pass", async () => {
  const { fetchFn } = metaReadOnlyFetch({ fail: true });
  const validation = await validateWith(fetchFn as typeof fetch);
  assertEquals(validation.phone_id_accessible, false);
  assertEquals(validation.display_number_match, "UNKNOWN");
  assertEquals(validation.waba_match, "UNKNOWN");
  assertEquals(validation.webhook_status, "UNKNOWN");
  assertEquals(validation.overall, "FAIL");
});

Deno.test("test-asset validation reports network failures safely without writes or sends", async () => {
  const validation = await validateWith((async () => {
    throw new Error("network unavailable SECRET_TEST_TOKEN");
  }) as typeof fetch);
  assertEquals(validation.meta_diagnostics?.phone_id?.classification, "NETWORK_ERROR");
  assertEquals(validation.meta_diagnostics?.waba?.classification, "NETWORK_ERROR");
  assertEquals(validation.meta_diagnostics?.subscription?.classification, "NETWORK_ERROR");
  assertEquals(validation.credential_status, "UNKNOWN");
  assertEquals(JSON.stringify(validation).includes("SECRET_TEST_TOKEN"), false);
});

Deno.test("test-asset validation classifies only explicit Meta token expiry", async () => {
  const validation = await validateWith((async () => Response.json({
    error: {
      type: "OAuthException",
      code: 190,
      error_subcode: 463,
      message: "The access token has expired",
    },
  }, { status: 400 })) as typeof fetch);
  assertEquals(validation.meta_diagnostics?.phone_id?.http_status, 400);
  assertEquals(validation.meta_diagnostics?.phone_id?.meta_error?.code, 190);
  assertEquals(validation.meta_diagnostics?.phone_id?.meta_error?.error_subcode, 463);
  assertEquals(validation.credential_status, "EXPIRED");
});

Deno.test("test-asset validation classifies explicit Meta permission denial only", async () => {
  const validation = await validateWith((async () => Response.json({
    error: {
      type: "OAuthException",
      code: 10,
      message: "Application does not have permission for this operation",
    },
  }, { status: 403 })) as typeof fetch);
  assertEquals(validation.meta_diagnostics?.waba?.http_status, 403);
  assertEquals(validation.meta_diagnostics?.waba?.meta_error?.code, 10);
  assertEquals(validation.credential_status, "PERMISSION_BLOCKED");
});

function luisDiscoveryFetch(options: {
  includeMatch?: boolean;
  appSubscribed?: boolean;
  permissionFailure?: boolean;
  directPhoneFailure?: boolean;
} = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (options.permissionFailure) {
      return Response.json({
        error: {
          type: "OAuthException",
          code: 10,
          error_subcode: 2018001,
          message: "Application does not have permission for this operation",
        },
      }, { status: 403 });
    }
    if (url.includes("/me/businesses")) {
      return Response.json({ data: [{ id: "business-luis", name: "Luis Gabriel Productions LLC" }] });
    }
    if (url.includes("owned_whatsapp_business_accounts")) {
      return Response.json({ data: [{ id: "waba-luis", name: "Luis Gabriel Productions LLC" }] });
    }
    if (url.includes("client_whatsapp_business_accounts")) {
      return Response.json({ data: [] });
    }
    if (url.includes("waba-luis/phone_numbers")) {
      return Response.json({
        data: [
          { id: "unrelated-phone", display_phone_number: "+1 555 000 0000" },
          ...(options.includeMatch === false ? [] : [{
            id: "phone-luis",
            display_phone_number: "+1 770 713 7058",
            verified_name: "Luis Gabriel Productions LLC",
            status: "CONNECTED",
            platform_type: "CLOUD_API",
          }]),
        ],
      });
    }
    if (url.includes("/phone-luis?")) {
      if (options.directPhoneFailure) return new Response("{}", { status: 403 });
      return Response.json({
        id: "phone-luis",
        display_phone_number: "+1 770 713 7058",
        verified_name: "Luis Gabriel Productions LLC",
        status: "CONNECTED",
        platform_type: "CLOUD_API",
      });
    }
    if (url.includes("waba-luis/subscribed_apps")) {
      return Response.json({
        data: options.appSubscribed === false
          ? []
          : [{ whatsapp_business_api_data: { id: "2290735921663266" } }],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { calls, fetchFn };
}

async function discoverLuisWith(fetchFn: typeof fetch) {
  return await discoverLuisWhatsAppAssets({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    expectedDisplayNumber: "+17707137058",
    expectedAppId: "2290735921663266",
    fetchFn,
  });
}

Deno.test("Luis asset discovery is owner-gated, org-bound, and has no writes or sends", () => {
  const actionStart = source.indexOf('if (action === "discover_luis_whatsapp_assets")');
  const actionEnd = source.indexOf('if (action === "discover_luis_whatsapp_assets_direct")', actionStart);
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assert(actionStart > source.indexOf("organization_forbidden"));
  assertStringIncludes(action, 'select(\n          "whatsapp_access_token",');
  assertStringIncludes(action, "discoverLuisWhatsAppAssets");
  assertStringIncludes(action, "token_configured: false");
  assertEquals(action.includes(".update("), false);
  assertEquals(action.includes(".insert("), false);
  assertEquals(action.includes(".upsert("), false);
  assertEquals(action.includes(".delete("), false);
  assertEquals(action.includes("/messages"), false);
  assertEquals(action.includes("SECRET_LUIS_TOKEN"), false);
});

Deno.test("Luis asset discovery returns only the exact 770 asset with GET-only Meta reads", async () => {
  const { calls, fetchFn } = luisDiscoveryFetch();
  const result = await discoverLuisWith(fetchFn as typeof fetch);
  assertEquals(result.found, true);
  assertEquals(result.organization_id, "luis-gabriel-referral-hub");
  assertEquals(result.waba_id, "waba-luis");
  assertEquals(result.phone_number_id, "phone-luis");
  assertEquals(result.display_phone_number, "+1 770 713 7058");
  assertEquals(result.registration_status, "CONNECTED");
  assertEquals(result.platform_type, "CLOUD_API");
  assertEquals(result.creatyv_waba_access, true);
  assertEquals(result.creatyv_phone_access, true);
  assertEquals(result.app_relationship, "PASS");
  assertEquals(result.recovery_capability, "ASSETS_AND_CREDENTIAL_SUFFICIENT");
  assertEquals(calls.every((call) => call.method === "GET"), true);
  assertEquals(calls.some((call) => call.url.includes("/messages")), false);
  const serialized = JSON.stringify(result);
  assertEquals(serialized.includes("unrelated-phone"), false);
  assertEquals(serialized.includes("555 000 0000"), false);
  assertEquals(serialized.includes("SECRET_LUIS_TOKEN"), false);
});

Deno.test("Luis asset discovery keeps found assets unmapped when app access is incomplete", async () => {
  const { calls, fetchFn } = luisDiscoveryFetch({ appSubscribed: false });
  const result = await discoverLuisWith(fetchFn as typeof fetch);
  assertEquals(result.found, true);
  assertEquals(result.app_relationship, "FAIL");
  assertEquals(result.recovery_capability, "ASSETS_FOUND_FRESH_AUTH_REQUIRED");
  assertEquals(calls.every((call) => call.method === "GET"), true);
});

Deno.test("Luis asset discovery safely reports missing credentials, permissions, and no exact number", async () => {
  const actionStart = source.indexOf('if (action === "discover_luis_whatsapp_assets")');
  const actionEnd = source.indexOf('if (action === "diagnose_test_waba_subscription")');
  const action = source.slice(actionStart, actionEnd);
  assertStringIncludes(action, "token_configured: false");

  const permission = luisDiscoveryFetch({ permissionFailure: true });
  const permissionResult = await discoverLuisWith(permission.fetchFn as typeof fetch);
  assertEquals(permissionResult.found, false);
  assertEquals(permissionResult.failure, "META_PERMISSION_BLOCKED");
  assertEquals(permissionResult.meta_diagnostic?.http_status, 403);
  assertEquals(permissionResult.meta_diagnostic?.meta_error?.code, 10);
  assertEquals(JSON.stringify(permissionResult).includes("SECRET_LUIS_TOKEN"), false);
  assertEquals(permission.calls.every((call) => call.method === "GET"), true);

  const missing = luisDiscoveryFetch({ includeMatch: false });
  const missingResult = await discoverLuisWith(missing.fetchFn as typeof fetch);
  assertEquals(missingResult.found, false);
  assertEquals(missingResult.failure, "PHONE_NOT_FOUND");
  assertEquals(JSON.stringify(missingResult).includes("unrelated-phone"), false);
});

Deno.test("Luis subscribed-apps action is authenticated, owner/admin-only, and canonically bound", () => {
  const actionStart = source.indexOf('if (action === "read_luis_waba_subscribed_apps")');
  const actionEnd = source.indexOf(
    'if (action === "discover_luis_whatsapp_assets_direct")',
    actionStart,
  );
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("admin.auth.getUser(bearer)"));
  assert(actionStart > source.indexOf("organization_membership_required"));
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assertStringIncludes(action, 'from("org_settings").select(\n          "whatsapp_access_token"');
  assertStringIncludes(action, '.eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID)');
  assertStringIncludes(action, "metaAppId !== LUIS_META_APP_ID");
  assertStringIncludes(action, "waba_id: LUIS_WABA_ID");
  assertStringIncludes(action, "expected_app_id: LUIS_META_APP_ID");
  assertStringIncludes(action, "readLuisCanonicalWabaSubscribedApps");
  assertEquals(action.includes("body.waba"), false);
  assertEquals(action.includes("body.phone"), false);
  assertEquals(action.includes("WHATSAPP_ACCESS_TOKEN"), false);
  assertEquals(action.includes("META_WHATSAPP_TEST_ACCESS_TOKEN"), false);
  assertEquals(action.includes(".insert("), false);
  assertEquals(action.includes(".update("), false);
  assertEquals(action.includes('method: "POST"'), false);
  assertEquals(action.includes("console."), false);
});

Deno.test("Luis subscribed-apps diagnostic performs one sanitized GET only", async () => {
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  const diagnostic = await readLuisCanonicalWabaSubscribedApps({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: headers.get("authorization"),
      });
      return Response.json({
        data: [
          { whatsapp_business_api_data: { id: "2290735921663266", name: "Creatyv" } },
          { whatsapp_business_api_data: { id: "safe-other-app", name: "Other" } },
          { whatsapp_business_api_data: { name: "missing-id-is-ignored" } },
          { whatsapp_business_api_data: null },
          {},
        ],
      });
    }) as typeof fetch,
  });

  assertEquals(calls, [{
    url:
      "https://graph.facebook.com/v21.0/1423647499608507/subscribed_apps",
    method: "GET",
    authorization: "Bearer SECRET_LUIS_TOKEN",
  }]);
  assertEquals(diagnostic, {
    ok: true,
    organization_id: "luis-gabriel-referral-hub",
    waba_id: "1423647499608507",
    expected_app_id: "2290735921663266",
    meta_http_status: 200,
    subscribed_apps: [
      { app_id: "2290735921663266", name: "Creatyv" },
      { app_id: "safe-other-app", name: "Other" },
    ],
    expected_app_present: "PASS",
  });
  assertEquals(JSON.stringify(diagnostic).includes("SECRET_LUIS_TOKEN"), false);
});

Deno.test("Luis subscribed-apps diagnostic detects the expected app under whatsapp_business_api_data (Meta Support-verified shape)", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const diagnostic = await readLuisCanonicalWabaSubscribedApps({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return Response.json({
        data: [
          {
            whatsapp_business_api_data: {
              category: "Business",
              link: "https://dental.creatyv.io/",
              name: "Creatyv",
              id: "2290735921663266",
            },
          },
        ],
      });
    }) as typeof fetch,
  });
  assertEquals(diagnostic.expected_app_present, "PASS");
  assertEquals(diagnostic.ok, true);
  assertEquals(diagnostic.subscribed_apps, [
    { app_id: "2290735921663266", name: "Creatyv" },
  ]);
  assertEquals(calls.every((call) => call.method === "GET"), true);
  assertEquals(calls.some((call) => call.url.includes("fields=id,name")), false);
});

Deno.test("Luis subscribed-apps diagnostic reports FAIL for an empty subscribed_apps list", async () => {
  const diagnostic = await readLuisCanonicalWabaSubscribedApps({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    fetchFn: (async () => Response.json({ data: [] })) as typeof fetch,
  });
  assertEquals(diagnostic.ok, true);
  assertEquals(diagnostic.subscribed_apps, []);
  assertEquals(diagnostic.expected_app_present, "FAIL");
});

Deno.test("Luis subscribed-apps diagnostic reports FAIL when only a different app is subscribed", async () => {
  const diagnostic = await readLuisCanonicalWabaSubscribedApps({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    fetchFn: (async () =>
      Response.json({
        data: [{
          whatsapp_business_api_data: { id: "999999999999999", name: "Some Other App" },
        }],
      })) as typeof fetch,
  });
  assertEquals(diagnostic.expected_app_present, "FAIL");
  assertEquals(diagnostic.subscribed_apps, [
    { app_id: "999999999999999", name: "Some Other App" },
  ]);
});

Deno.test("Luis subscribed-apps diagnostic fails safely on malformed or missing whatsapp_business_api_data", async () => {
  const diagnostic = await readLuisCanonicalWabaSubscribedApps({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    fetchFn: (async () =>
      Response.json({
        data: [
          {},
          { whatsapp_business_api_data: null },
          { whatsapp_business_api_data: "not-an-object" },
          { whatsapp_business_api_data: 42 },
          { id: "2290735921663266", name: "Top-level shape is ignored" },
          { whatsapp_business_api_data: {} },
        ],
      })) as typeof fetch,
  });
  assertEquals(diagnostic.ok, true);
  assertEquals(diagnostic.subscribed_apps, []);
  assertEquals(diagnostic.expected_app_present, "FAIL");
});

Deno.test("no read-only subscribed_apps diagnostic ever issues a Meta POST", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const track = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return Response.json({
      data: [{ whatsapp_business_api_data: { id: "2290735921663266", name: "Creatyv" } }],
    });
  }) as typeof fetch;

  await readLuisCanonicalWabaSubscribedApps({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    fetchFn: track,
  });
  await discoverLuisWhatsAppAssetsDirect({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    wabaId: "waba-luis",
    phoneNumberId: "phone-luis",
    expectedAppId: "2290735921663266",
    fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("waba-luis/subscribed_apps")) {
        return Response.json({
          data: [{ whatsapp_business_api_data: { id: "2290735921663266" } }],
        });
      }
      if (url.includes("phone-luis?")) {
        return Response.json({ id: "phone-luis", display_phone_number: "+1 770 713 7058" });
      }
      return Response.json({ data: [{ id: "phone-luis" }] });
    }) as typeof fetch,
  });

  assertEquals(calls.length > 0, true);
  assertEquals(calls.every((call) => call.method === "GET"), true);
});

Deno.test("Luis subscribed-apps diagnostic sanitizes Meta failures without mutation", async () => {
  const calls: Array<{ method: string }> = [];
  const diagnostic = await readLuisCanonicalWabaSubscribedApps({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    fetchFn: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET" });
      return Response.json({
        error: {
          type: "OAuthException",
          code: 190,
          message: "Bearer SECRET_LUIS_TOKEN is invalid",
        },
      }, { status: 401 });
    }) as typeof fetch,
  });

  assertEquals(calls, [{ method: "GET" }]);
  assertEquals(diagnostic.ok, false);
  assertEquals(diagnostic.meta_http_status, 401);
  assertEquals(diagnostic.subscribed_apps, []);
  assertEquals(diagnostic.expected_app_present, "UNKNOWN");
  assertEquals(JSON.stringify(diagnostic).includes("SECRET_LUIS_TOKEN"), false);
});

Deno.test("Luis persisted-state action is authenticated, owner/admin-only, hard-bound, and read-only", () => {
  const actionStart = source.indexOf(
    'if (action === "read_luis_whatsapp_persisted_state")',
  );
  const actionEnd = source.indexOf(
    'if (action === "discover_luis_whatsapp_assets_direct")',
    actionStart,
  );
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("admin.auth.getUser(bearer)"));
  assert(actionStart > source.indexOf("organization_membership_required"));
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assertStringIncludes(action, 'from("org_settings").select(');
  assertStringIncludes(
    action,
    'eq("organization_id", REFERRAL_HUB_ORGANIZATION_ID)',
  );
  assertStringIncludes(action, "safeLuisWhatsAppPersistedState");
  for (const forbidden of [
    "whatsapp_access_token",
    "token_fingerprint",
    "authorization_code",
    "pin",
    ".insert(",
    ".update(",
    ".upsert(",
    ".delete(",
    "fetch(",
    "subscribed_apps",
    "/register",
  ]) assertEquals(action.includes(forbidden), false);
});

Deno.test("Luis persisted-state response has the exact safe allowlist and no token leakage", () => {
  const result = safeLuisWhatsAppPersistedState({
    whatsapp_waba_id: "1423647499608507",
    whatsapp_phone_number_id: "1287679991091560",
    whatsapp_enabled: false,
    whatsapp_registered: true,
    whatsapp_webhooks_subscribed: true,
    whatsapp_onboarding_mode: "COEXISTENCE",
    whatsapp_onboarding_event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    whatsapp_session_info_version: "3",
    whatsapp_connected_at: null,
    updated_at: "2026-08-16T12:34:56.000Z",
    whatsapp_access_token: "SECRET_LUIS_TOKEN",
    token_fingerprint: "SECRET_FINGERPRINT",
    unrelated_setting: "SECRET_UNRELATED_VALUE",
  });
  assertEquals(result, {
    ok: true,
    organization_id: "luis-gabriel-referral-hub",
    whatsapp_waba_id: "1423647499608507",
    whatsapp_phone_number_id: "1287679991091560",
    whatsapp_enabled: false,
    whatsapp_registered: true,
    whatsapp_webhooks_subscribed: true,
    whatsapp_onboarding_mode: "COEXISTENCE",
    whatsapp_onboarding_event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    whatsapp_session_info_version: "3",
    whatsapp_connected_at: null,
    updated_at: "2026-08-16T12:34:56.000Z",
  });
  assertEquals(Object.keys(result), [
    "ok",
    "organization_id",
    "whatsapp_waba_id",
    "whatsapp_phone_number_id",
    "whatsapp_enabled",
    "whatsapp_registered",
    "whatsapp_webhooks_subscribed",
    "whatsapp_onboarding_mode",
    "whatsapp_onboarding_event",
    "whatsapp_session_info_version",
    "whatsapp_connected_at",
    "updated_at",
  ]);
  const serialized = JSON.stringify(result);
  for (const secret of [
    "SECRET_LUIS_TOKEN",
    "SECRET_FINGERPRINT",
    "SECRET_UNRELATED_VALUE",
  ]) assertEquals(serialized.includes(secret), false);
});

Deno.test("Luis persisted-state response safely reports an unavailable row", () => {
  assertEquals(safeLuisWhatsAppPersistedState(null, false), {
    ok: false,
    organization_id: "luis-gabriel-referral-hub",
    whatsapp_waba_id: null,
    whatsapp_phone_number_id: null,
    whatsapp_enabled: null,
    whatsapp_registered: null,
    whatsapp_webhooks_subscribed: null,
    whatsapp_onboarding_mode: null,
    whatsapp_onboarding_event: null,
    whatsapp_session_info_version: null,
    whatsapp_connected_at: null,
    updated_at: null,
  });
});

function luisDirectDiscoveryFetch(options: {
  includePhoneInWaba?: boolean;
  appSubscribed?: boolean;
  permissionFailure?: boolean;
} = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (options.permissionFailure) {
      return Response.json({
        error: {
          type: "OAuthException",
          code: 100,
          message: "Missing Permission for Bearer SECRET_LUIS_TOKEN",
        },
      }, { status: 400 });
    }
    if (url.includes("/phone-persisted?")) {
      return Response.json({
        id: "phone-persisted",
        display_phone_number: "+1 770 713 7058",
        verified_name: "Luis Gabriel Productions LLC",
        status: "PENDING",
        code_verification_status: "VERIFIED",
        platform_type: "CLOUD_API",
      });
    }
    if (url.includes("/waba-persisted/phone_numbers")) {
      return Response.json({
        data: options.includePhoneInWaba === false ? [] : [{
          id: "phone-persisted",
          display_phone_number: "+1 770 713 7058",
          verified_name: "Luis Gabriel Productions LLC",
          status: "PENDING",
          code_verification_status: "VERIFIED",
          platform_type: "CLOUD_API",
        }],
      });
    }
    if (url.includes("/waba-persisted/subscribed_apps")) {
      return Response.json({
        data: options.appSubscribed === false ? [] : [{
          whatsapp_business_api_data: {
            id: "2290735921663266",
            name: "Creatyv Referral Hub",
          },
        }],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { calls, fetchFn };
}

async function discoverLuisDirectWith(fetchFn: typeof fetch) {
  return await discoverLuisWhatsAppAssetsDirect({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    wabaId: "waba-persisted",
    phoneNumberId: "phone-persisted",
    expectedAppId: "2290735921663266",
    fetchFn,
  });
}

Deno.test("Luis direct discovery is owner-gated, uses persisted IDs, and has no writes", () => {
  const actionStart = source.indexOf('if (action === "discover_luis_whatsapp_assets_direct")');
  const actionEnd = source.indexOf('if (action === "debug_luis_whatsapp_token")', actionStart);
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assert(actionStart > source.indexOf("organization_forbidden"));
  assertStringIncludes(action, '"whatsapp_access_token,whatsapp_phone_number_id,whatsapp_waba_id"');
  assertStringIncludes(action, "discoverLuisWhatsAppAssetsDirect");
  assertStringIncludes(action, "token_configured: Boolean(accessToken)");
  assertEquals(action.includes(".update("), false);
  assertEquals(action.includes(".insert("), false);
  assertEquals(action.includes(".upsert("), false);
  assertEquals(action.includes(".delete("), false);
  assertEquals(action.includes("/messages"), false);
  assertEquals(action.includes("me/businesses"), false);
});

Deno.test("Luis direct discovery avoids business enumeration and parses persisted phone and WABA assets", async () => {
  const { calls, fetchFn } = luisDirectDiscoveryFetch();
  const result = await discoverLuisDirectWith(fetchFn as typeof fetch);
  assertEquals(result.found, true);
  assertEquals(result.organization_id, "luis-gabriel-referral-hub");
  assertEquals(result.persisted_waba_id, "waba-persisted");
  assertEquals(result.persisted_phone_number_id, "phone-persisted");
  assertEquals(result.expected_app_id, "2290735921663266");
  assertEquals(result.subscribed_apps, [{
    id: "2290735921663266",
    name: "Creatyv Referral Hub",
  }]);
  assertEquals(result.display_phone_number, "+1 770 713 7058");
  assertEquals(result.verified_name, "Luis Gabriel Productions LLC");
  assertEquals(result.registration_status, "PENDING");
  assertEquals(result.code_verification_status, "VERIFIED");
  assertEquals(result.platform_type, "CLOUD_API");
  assertEquals(result.creatyv_phone_access, "PASS");
  assertEquals(result.creatyv_waba_access, "PASS");
  assertEquals(result.phone_found_in_waba, "PASS");
  assertEquals(result.app_relationship, "PASS");
  assertEquals(calls.length, 3);
  assertEquals(calls.every((call) => call.method === "GET"), true);
  assertEquals(calls.some((call) => call.url.includes("/me/businesses")), false);
  assertEquals(calls.some((call) => call.url.includes("/phone-persisted?")), true);
  assertEquals(calls.some((call) => call.url.includes("/waba-persisted/phone_numbers")), true);
  assertEquals(calls.some((call) => call.url.includes("/waba-persisted/subscribed_apps")), true);
  assertEquals(calls.some((call) => call.url.includes("fields=id,name")), false);
  assertEquals(calls.some((call) => call.url.includes("/messages")), false);
  assertEquals(JSON.stringify(result).includes("SECRET_LUIS_TOKEN"), false);
});

Deno.test("Luis direct discovery reports WABA membership and app relationship independently", async () => {
  const membership = luisDirectDiscoveryFetch({ includePhoneInWaba: false });
  const membershipResult = await discoverLuisDirectWith(membership.fetchFn as typeof fetch);
  assertEquals(membershipResult.creatyv_phone_access, "PASS");
  assertEquals(membershipResult.creatyv_waba_access, "PASS");
  assertEquals(membershipResult.phone_found_in_waba, "FAIL");

  const app = luisDirectDiscoveryFetch({ appSubscribed: false });
  const appResult = await discoverLuisDirectWith(app.fetchFn as typeof fetch);
  assertEquals(appResult.phone_found_in_waba, "PASS");
  assertEquals(appResult.app_relationship, "FAIL");
  assertEquals(appResult.subscribed_apps, []);
});

Deno.test("Luis direct discovery sanitizes Meta read failures without writes", async () => {
  const { calls, fetchFn } = luisDirectDiscoveryFetch({ permissionFailure: true });
  const result = await discoverLuisDirectWith(fetchFn as typeof fetch);
  assertEquals(result.found, false);
  assertEquals(result.creatyv_phone_access, "FAIL");
  assertEquals(result.creatyv_waba_access, "FAIL");
  assertEquals(result.phone_found_in_waba, "UNKNOWN");
  assertEquals(result.app_relationship, "UNKNOWN");
  assertEquals(result.credential_status, "PERMISSION_BLOCKED");
  assertEquals(result.meta_diagnostic?.http_status, 400);
  assertEquals(result.meta_diagnostic?.meta_error?.code, 100);
  assertEquals(JSON.stringify(result).includes("SECRET_LUIS_TOKEN"), false);
  assertEquals(calls.length, 3);
  assertEquals(calls.every((call) => call.method === "GET"), true);
});

function luisTokenDebugFetch(options: { fail?: boolean } = {}) {
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (options.fail) {
      return Response.json({
        error: {
          type: "OAuthException",
          code: 10,
          message: "Missing Permission for Bearer SECRET_LUIS_TOKEN",
        },
      }, { status: 403 });
    }
    return Response.json({
      data: {
        is_valid: true,
        app_id: "2290735921663266",
        application: "Creatyv Referral Hub",
        type: "USER",
        issued_at: 1780000000,
        expires_at: 1790000000,
        scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
        granular_scopes: [{
          permission: "whatsapp_business_management",
          target_ids: ["1423647499608507", "1287679991091560"],
        }],
      },
    });
  };
  return { calls, fetchFn };
}

async function debugLuisTokenWith(fetchFn: typeof fetch) {
  return await debugLuisStoredWhatsAppToken({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    appId: "2290735921663266",
    appSecret: "SECRET_META_APP_SECRET",
    expectedWabaId: "1423647499608507",
    expectedPhoneNumberId: "1287679991091560",
    fetchFn,
  });
}

Deno.test("Luis stored-token debug is owner-gated, identity-bound, and has no writes", () => {
  const actionStart = source.indexOf('if (action === "debug_luis_whatsapp_token")');
  const actionEnd = source.indexOf('if (action === "subscribe_luis_waba_app")', actionStart);
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assert(actionStart > source.indexOf("organization_forbidden"));
  assertStringIncludes(action, "LUIS_WABA_ID");
  assertStringIncludes(action, "LUIS_PHONE_NUMBER_ID");
  assertStringIncludes(action, "LUIS_META_APP_ID");
  assertStringIncludes(action, "debugLuisStoredWhatsAppToken");
  assertEquals(action.includes(".update("), false);
  assertEquals(action.includes(".insert("), false);
  assertEquals(action.includes(".upsert("), false);
  assertEquals(action.includes("method: \"POST\""), false);
  assertEquals(action.includes("SECRET_LUIS_TOKEN"), false);
  assertEquals(action.includes("SECRET_META_APP_SECRET"), false);
});

Deno.test("Luis stored-token debug safely parses app, scopes, granular access, and uses only GET", async () => {
  const { calls, fetchFn } = luisTokenDebugFetch();
  const result = await debugLuisTokenWith(fetchFn as typeof fetch);
  assertEquals(result.token_configured, true);
  assertEquals(result.is_valid, true);
  assertEquals(result.app_id, "2290735921663266");
  assertEquals(result.application, "Creatyv Referral Hub");
  assertEquals(result.token_type, "USER");
  assertEquals(result.issued_at, 1780000000);
  assertEquals(result.expires_at, 1790000000);
  assertEquals(result.scopes, ["whatsapp_business_management", "whatsapp_business_messaging"]);
  assertEquals(result.granular_scopes, [{
    permission: "whatsapp_business_management",
    target_ids: ["1423647499608507", "1287679991091560"],
  }]);
  assertEquals(result.token_matches_expected_app, true);
  assertEquals(result.has_whatsapp_business_management, true);
  assertEquals(result.has_whatsapp_business_messaging, true);
  assertEquals(result.waba_1423647499608507_granular_access, "PASS");
  assertEquals(result.phone_1287679991091560_granular_access, "PASS");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, "GET");
  assertEquals(calls[0].url.includes("/debug_token?input_token="), true);
  const serialized = JSON.stringify(result);
  assertEquals(serialized.includes("SECRET_LUIS_TOKEN"), false);
  assertEquals(serialized.includes("SECRET_META_APP_SECRET"), false);
  assertEquals(serialized.includes("Bearer"), false);
});

Deno.test("Luis stored-token debug sanitizes Meta failures without a mutation", async () => {
  const { calls, fetchFn } = luisTokenDebugFetch({ fail: true });
  const result = await debugLuisTokenWith(fetchFn as typeof fetch);
  assertEquals(result.is_valid, null);
  assertEquals(result.token_matches_expected_app, null);
  assertEquals(result.credential_status, "PERMISSION_BLOCKED");
  assertEquals(result.meta_diagnostic?.http_status, 403);
  assertEquals(result.meta_diagnostic?.meta_error?.code, 10);
  assertEquals(JSON.stringify(result).includes("SECRET_LUIS_TOKEN"), false);
  assertEquals(calls.every((call) => call.method === "GET"), true);
});

function luisSubscriptionFetch(options: {
  initiallySubscribed?: boolean;
  postFails?: boolean;
  verifyMissing?: boolean;
} = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  let subscribedAppsReads = 0;
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/waba-luis-subscription/subscribed_apps") && method === "GET") {
      subscribedAppsReads += 1;
      const subscribed = options.initiallySubscribed ||
        (subscribedAppsReads > 1 && !options.verifyMissing);
      return Response.json({
        data: subscribed ? [{
          whatsapp_business_api_data: {
            id: "2290735921663266",
            name: "Creatyv Referral Hub",
          },
        }] : [],
      });
    }
    if (url.includes("/waba-luis-subscription/subscribed_apps") && method === "POST") {
      return options.postFails
        ? Response.json({
          error: {
            type: "OAuthException",
            code: 10,
            message: "Permission denied for Bearer SECRET_LUIS_TOKEN",
          },
        }, { status: 403 })
        : Response.json({ success: true });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { calls, fetchFn };
}

async function subscribeLuisWith(fetchFn: typeof fetch) {
  return await subscribeLuisWabaApp({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    wabaId: "waba-luis-subscription",
    expectedAppId: "2290735921663266",
    fetchFn,
  });
}

Deno.test("Luis WABA subscription action is owner-gated, identity-bound, and has no database writes", () => {
  const actionStart = source.indexOf('if (action === "subscribe_luis_waba_app")');
  const actionEnd = source.indexOf('if (action === "register_whatsapp_business_phone")', actionStart);
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assert(actionStart > source.indexOf("organization_forbidden"));
  assertStringIncludes(action, "LUIS_WABA_ID");
  assertStringIncludes(action, "LUIS_PHONE_NUMBER_ID");
  assertStringIncludes(action, "LUIS_META_APP_ID");
  assertStringIncludes(action, "subscribeLuisWabaApp");
  assertStringIncludes(action, "discoverLuisWhatsAppAssetsDirect");
  assertEquals(action.includes(".update("), false);
  assertEquals(action.includes(".insert("), false);
  assertEquals(action.includes(".upsert("), false);
  assertEquals(action.includes("check_whatsapp_activation"), false);
  assertEquals(action.includes("SECRET_LUIS_TOKEN"), false);
});

Deno.test("Luis WABA subscription posts once then verifies the expected app with GET", async () => {
  const { calls, fetchFn } = luisSubscriptionFetch();
  const result = await subscribeLuisWith(fetchFn as typeof fetch);
  assertEquals(result.operation, "SUBSCRIBED");
  assertEquals(result.post_executed, true);
  assertEquals(result.meta_post_result, "SUCCESS");
  assertEquals(result.meta_post_http_status, 200);
  assertEquals(result.expected_app_present, "PASS");
  assertEquals(result.subscribed_apps, [{
    id: "2290735921663266",
    name: "Creatyv Referral Hub",
  }]);
  assertEquals(calls.length, 3);
  assertEquals(calls.filter((call) => call.method === "POST").length, 1);
  assertEquals(calls.filter((call) => call.method === "GET").length, 2);
  assertEquals(calls.every((call) => call.url.includes("waba-luis-subscription/subscribed_apps")), true);
  assertEquals(JSON.stringify(result).includes("SECRET_LUIS_TOKEN"), false);
});

Deno.test("Luis WABA subscription is idempotent and never posts when already subscribed", async () => {
  const { calls, fetchFn } = luisSubscriptionFetch({ initiallySubscribed: true });
  const result = await subscribeLuisWith(fetchFn as typeof fetch);
  assertEquals(result.operation, "ALREADY_SUBSCRIBED");
  assertEquals(result.post_executed, false);
  assertEquals(result.meta_post_result, "NOT_EXECUTED");
  assertEquals(result.expected_app_present, "PASS");
  assertEquals(calls.length, 1);
  assertEquals(calls.every((call) => call.method === "GET"), true);
});

Deno.test("Luis WABA subscription safely reports rejected or unverified Meta posts", async () => {
  const rejected = luisSubscriptionFetch({ postFails: true });
  const rejectedResult = await subscribeLuisWith(rejected.fetchFn as typeof fetch);
  assertEquals(rejectedResult.operation, "FAILED");
  assertEquals(rejectedResult.post_executed, true);
  assertEquals(rejectedResult.meta_post_result, "FAILED");
  assertEquals(rejectedResult.credential_status, "PERMISSION_BLOCKED");
  assertEquals(JSON.stringify(rejectedResult).includes("SECRET_LUIS_TOKEN"), false);

  const missing = luisSubscriptionFetch({ verifyMissing: true });
  const missingResult = await subscribeLuisWith(missing.fetchFn as typeof fetch);
  assertEquals(missingResult.operation, "FAILED");
  assertEquals(missingResult.meta_post_result, "SUCCESS");
  assertEquals(missingResult.expected_app_present, "FAIL");
});

function activationFetch(options: {
  status?: string;
  returnedPhoneId?: string;
  includeInWaba?: boolean;
  expired?: boolean;
} = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (options.expired) {
      return Response.json({
        error: {
          type: "OAuthException",
          code: 190,
          error_subcode: 463,
          message: "The access token has expired: SECRET_REAL_TOKEN",
        },
      }, { status: 401 });
    }
    if (url.includes("/phone-real?")) {
      return Response.json({
        id: options.returnedPhoneId ?? "phone-real",
        display_phone_number: "+1 770-713-7058",
        status: options.status ?? "PENDING",
      });
    }
    if (url.includes("/waba-real/phone_numbers")) {
      return Response.json({
        data: options.includeInWaba === false ? [] : [{ id: "phone-real" }],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { calls, fetchFn };
}

async function inspectActivationWith(fetchFn: typeof fetch) {
  return await inspectWhatsAppActivation({
    graphVersion: "v21.0",
    accessToken: "SECRET_REAL_TOKEN",
    phoneNumberId: "phone-real",
    wabaId: "waba-real",
    fetchFn,
  });
}

Deno.test("activation check is owner-gated, org-bound, and waits before its only write", () => {
  const actionStart = source.indexOf('if (action === "check_whatsapp_activation")');
  const actionEnd = source.indexOf('if (action === "diagnose_test_waba_subscription")');
  const action = source.slice(actionStart, actionEnd);
  const pendingGuard = action.indexOf("if (!validAsset || !connected)");
  const update = action.indexOf('admin.from("org_settings").update({');
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assert(actionStart > source.indexOf("organization_forbidden"));
  assertStringIncludes(action, '"whatsapp_phone_number_id,whatsapp_waba_id,whatsapp_enabled,whatsapp_access_token"');
  assertStringIncludes(action, "activation_waiting_for_meta");
  assert(pendingGuard >= 0 && update > pendingGuard);
  assertStringIncludes(action, 'whatsapp_enabled: true');
  assertStringIncludes(action, "whatsapp_connected_at");
  assertStringIncludes(action, "if (currentEnabled)");
  assertEquals(action.includes("/messages"), false);
  assertEquals(action.includes("SECRET_REAL_TOKEN"), false);
});

Deno.test("activation check inspects PENDING without a write", async () => {
  const { calls, fetchFn } = activationFetch({ status: "PENDING" });
  const result = await inspectActivationWith(fetchFn as typeof fetch);
  assertEquals(result.phone_access, true);
  assertEquals(result.waba_relationship, "PASS");
  assertEquals(result.meta_status, "PENDING");
  assertEquals(calls.every((call) => call.method === "GET"), true);
  assertEquals(JSON.stringify(result).includes("SECRET_REAL_TOKEN"), false);
});

Deno.test("activation check accepts CONNECTED only with the exact persisted phone and WABA", async () => {
  const connected = activationFetch({ status: "CONNECTED" });
  const result = await inspectActivationWith(connected.fetchFn as typeof fetch);
  assertEquals(result.phone_access, true);
  assertEquals(result.waba_relationship, "PASS");
  assertEquals(result.meta_status, "CONNECTED");
  assertEquals(connected.calls.every((call) => call.method === "GET"), true);

  const wrongPhone = activationFetch({ returnedPhoneId: "phone-other" });
  const wrongPhoneResult = await inspectActivationWith(wrongPhone.fetchFn as typeof fetch);
  assertEquals(wrongPhoneResult.phone_access, false);
  assertEquals(wrongPhoneResult.waba_relationship, "PASS");
});

Deno.test("activation check reports an expired credential safely without writes", async () => {
  const { calls, fetchFn } = activationFetch({ expired: true });
  const result = await inspectActivationWith(fetchFn as typeof fetch);
  assertEquals(result.phone_access, false);
  assertEquals(result.waba_relationship, "UNKNOWN");
  assertEquals(result.credential_status, "EXPIRED");
  assertEquals(result.meta_diagnostic?.http_status, 401);
  assertEquals(result.meta_diagnostic?.meta_error?.code, 190);
  assertEquals(JSON.stringify(result).includes("SECRET_REAL_TOKEN"), false);
  assertEquals(calls.every((call) => call.method === "GET"), true);
});

function luisRegistrationFetch(options: {
  beforeStatus?: string;
  afterStatus?: string;
  verificationStatus?: string;
  postSucceeds?: boolean;
  includeInWaba?: boolean;
  returnedPhoneId?: string;
} = {}) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  let phoneReads = 0;
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : null,
    });
    if (url.includes("/1287679991091560?") && method === "GET") {
      phoneReads += 1;
      return Response.json({
        id: options.returnedPhoneId ?? "1287679991091560",
        display_phone_number: "+1 770-713-7058",
        verified_name: "Luis Gabriel Productions LLC",
        status: phoneReads > 1
          ? options.afterStatus ?? "CONNECTED"
          : options.beforeStatus ?? "PENDING",
        code_verification_status: options.verificationStatus ?? "VERIFIED",
        platform_type: "NOT_APPLICABLE",
      });
    }
    if (url.includes("/1423647499608507/phone_numbers") && method === "GET") {
      return Response.json({
        data: options.includeInWaba === false ? [] : [{ id: "1287679991091560" }],
      });
    }
    if (url.includes("/1287679991091560/register") && method === "POST") {
      return options.postSucceeds === false
        ? Response.json({
          error: {
            type: "OAuthException",
            code: 10,
            message: "Permission denied for Bearer SECRET_LUIS_TOKEN",
          },
        }, { status: 403 })
        : Response.json({ success: true });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { calls, fetchFn };
}

async function registerLuisWith(
  fetchFn: typeof fetch,
  overrides: Partial<{ phoneNumberId: string; wabaId: string; pin: string }> = {},
) {
  return await registerLuisWhatsAppBusinessPhone({
    graphVersion: "v21.0",
    accessToken: "SECRET_LUIS_TOKEN",
    wabaId: overrides.wabaId ?? "1423647499608507",
    phoneNumberId: overrides.phoneNumberId ?? "1287679991091560",
    pin: overrides.pin ?? "7".repeat(6),
    fetchFn,
  });
}

Deno.test("Luis Business App registration action is owner/admin-gated and identity-bound", () => {
  const actionStart = source.indexOf('if (action === "register_whatsapp_business_phone")');
  const actionEnd = source.indexOf('if (action === "check_whatsapp_activation")', actionStart);
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assert(actionStart > source.indexOf("organization_forbidden"));
  assertStringIncludes(action, "registration_client_identity_forbidden");
  assertStringIncludes(action, "registration_pin_invalid");
  assertStringIncludes(action, "LUIS_WABA_ID");
  assertStringIncludes(action, "LUIS_PHONE_NUMBER_ID");
  assertStringIncludes(action, "registerLuisWhatsAppBusinessPhone");
  assertStringIncludes(action, 'whatsapp_enabled: true');
  assertEquals(action.includes("whatsapp_registered: true"), false);
  assertEquals(action.includes('"123456"'), false);
});

Deno.test("Luis Business App registration rejects wrong assets or malformed PIN before Meta calls", async () => {
  const wrongAsset = luisRegistrationFetch();
  const wrongAssetResult = await registerLuisWith(
    wrongAsset.fetchFn as typeof fetch,
    { phoneNumberId: "not-luis" },
  );
  assertEquals(wrongAssetResult.error, "registration_preflight_failed");
  assertEquals(wrongAsset.calls.length, 0);

  const malformedPin = luisRegistrationFetch();
  const malformedPinResult = await registerLuisWith(
    malformedPin.fetchFn as typeof fetch,
    { pin: "not-a-pin" },
  );
  assertEquals(malformedPinResult.error, "registration_preflight_failed");
  assertEquals(malformedPin.calls.length, 0);
});

Deno.test("Luis Business App registration never posts when precheck is CONNECTED", async () => {
  const { calls, fetchFn } = luisRegistrationFetch({ beforeStatus: "CONNECTED" });
  const result = await registerLuisWith(fetchFn as typeof fetch);
  assertEquals(result.already_connected, true);
  assertEquals(result.activation_complete, true);
  assertEquals(result.registration_attempted, false);
  assertEquals(calls.length, 2);
  assertEquals(calls.every((call) => call.method === "GET"), true);
});

Deno.test("Luis Business App registration posts exactly once only for PENDING plus VERIFIED", async () => {
  const { calls, fetchFn } = luisRegistrationFetch();
  const result = await registerLuisWith(fetchFn as typeof fetch);
  assertEquals(result.registration_attempted, true);
  assertEquals(result.registration_accepted, true);
  assertEquals(result.meta_status_before, "PENDING");
  assertEquals(result.meta_status_after, "CONNECTED");
  assertEquals(result.activation_complete, true);
  const postCalls = calls.filter((call) => call.method === "POST");
  assertEquals(postCalls.length, 1);
  assertEquals(postCalls[0].url.endsWith("/1287679991091560/register"), true);
  assertEquals(postCalls[0].body?.includes('"messaging_product":"whatsapp"'), true);
  assertEquals(JSON.stringify(result).includes("SECRET_LUIS_TOKEN"), false);
  assertEquals(JSON.stringify(result).includes("7".repeat(6)), false);

  const notVerified = luisRegistrationFetch({ verificationStatus: "NOT_VERIFIED" });
  const notVerifiedResult = await registerLuisWith(notVerified.fetchFn as typeof fetch);
  assertEquals(notVerifiedResult.error, "registration_preflight_failed");
  assertEquals(notVerified.calls.every((call) => call.method === "GET"), true);
});

Deno.test("Luis Business App registration never enables on rejected or still-PENDING results", async () => {
  const rejected = luisRegistrationFetch({ postSucceeds: false });
  const rejectedResult = await registerLuisWith(rejected.fetchFn as typeof fetch);
  assertEquals(rejectedResult.registration_accepted, false);
  assertEquals(rejectedResult.activation_complete, false);
  assertEquals(rejectedResult.error, "registration_rejected");
  assertEquals(JSON.stringify(rejectedResult).includes("SECRET_LUIS_TOKEN"), false);

  const pending = luisRegistrationFetch({ afterStatus: "PENDING" });
  const pendingResult = await registerLuisWith(pending.fetchFn as typeof fetch);
  assertEquals(pendingResult.registration_accepted, true);
  assertEquals(pendingResult.meta_status_after, "PENDING");
  assertEquals(pendingResult.activation_complete, false);
  assertEquals(pending.calls.filter((call) => call.method === "POST").length, 1);
});

function metaSubscriptionFetch(options: {
  alreadySubscribed?: boolean;
  subscribedAfterPost?: boolean;
  appWebhook?: "PASS" | "MISMATCH" | "MISSING" | "UNKNOWN";
  messagesSubscribed?: boolean;
  postFails?: boolean;
}) {
  const calls: Array<{ url: string; method: string }> = [];
  let posted = false;
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/2080644335858568/subscribed_apps") && method === "GET") {
      return Response.json({
        data: options.alreadySubscribed || (posted && options.subscribedAfterPost !== false)
          ? [{ whatsapp_business_api_data: { id: "2290735921663266" } }]
          : [],
      });
    }
    if (url.includes("/2290735921663266/subscriptions")) {
      if (options.appWebhook === "UNKNOWN") return new Response("{}", { status: 403 });
      if (options.appWebhook === "MISSING") return Response.json({ data: [] });
      return Response.json({
        data: [{
          object: "whatsapp_business_account",
          callback_url: options.appWebhook === "MISMATCH"
            ? "https://invalid.example/webhook"
            : "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1/meta-webhook",
          fields: options.messagesSubscribed === false ? [] : ["messages"],
        }],
      });
    }
    posted = true;
    return options.postFails ? new Response("{}", { status: 400 }) : Response.json({ success: true });
  };
  return { calls, fetchFn };
}

async function subscribeWith(fetchFn: typeof fetch) {
  return await subscribeStoredTestWaba({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    wabaId: "2080644335858568",
    expectedAppId: "2290735921663266",
    expectedWebhookUrl: "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1/meta-webhook",
    fetchFn,
  });
}

Deno.test("test WABA subscription is owner-gated, org-bound, token-safe, and write-limited", () => {
  const actionStart = source.indexOf('if (action === "subscribe_test_waba")');
  const actionEnd = source.indexOf('if (action !== "exchange")');
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assert(actionStart > source.indexOf("organization_forbidden"));
  assertStringIncludes(action, 'select(\n          "whatsapp_access_token",');
  assertStringIncludes(action, "subscribeStoredTestWaba");
  assertEquals(action.includes(".update("), false);
  assertEquals(action.includes(".insert("), false);
  assertEquals(action.includes(".upsert("), false);
  assertEquals(action.includes("/messages"), false);
  assertEquals(action.includes("SECRET_TEST_TOKEN"), false);
});

Deno.test("read-only WABA diagnosis is owner-gated, org-bound, and has no Meta mutation", () => {
  const actionStart = source.indexOf('if (action === "diagnose_test_waba_subscription")');
  const actionEnd = source.indexOf('if (action === "subscribe_test_waba")');
  const action = source.slice(actionStart, actionEnd);
  assert(actionStart > source.indexOf("owner_or_admin_required"));
  assert(actionStart > source.indexOf("organization_forbidden"));
  assertStringIncludes(action, "inspectStoredTestWabaSubscription");
  assertEquals(action.includes("subscribeStoredTestWaba"), false);
  assertEquals(action.includes(".update("), false);
  assertEquals(action.includes(".insert("), false);
  assertEquals(action.includes(".upsert("), false);
  assertEquals(action.includes("/messages"), false);
  assertStringIncludes(source, 'const action = text(body.action, 64) || "exchange"');
  assertEquals("diagnose_test_waba_subscription".length > 30, true);
});

Deno.test("read-only WABA diagnosis reports subscription, callback, and messages safely", async () => {
  const { calls, fetchFn } = metaSubscriptionFetch({
    alreadySubscribed: false,
    appWebhook: "PASS",
    messagesSubscribed: false,
  });
  const result = await inspectStoredTestWabaSubscription({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    wabaId: "2080644335858568",
    expectedAppId: "2290735921663266",
    expectedWebhookUrl: "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1/meta-webhook",
    fetchFn: fetchFn as typeof fetch,
  });
  assertEquals(result.before, "NOT_SUBSCRIBED");
  assertEquals(result.app_webhook_status, "PASS");
  assertEquals(result.callback_url, "MATCH");
  assertEquals(result.messages_subscription, "FAIL");
  assertEquals(calls.every((call) => call.method === "GET"), true);
  assertEquals(JSON.stringify(result).includes("SECRET_TEST_TOKEN"), false);
});

Deno.test("read-only WABA diagnosis preserves a safe subscribed_apps Meta failure", async () => {
  const result = await inspectStoredTestWabaSubscription({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    wabaId: "2080644335858568",
    expectedAppId: "2290735921663266",
    expectedWebhookUrl: "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1/meta-webhook",
    fetchFn: (async () => Response.json({
      error: {
        type: "OAuthException",
        code: 10,
        error_subcode: 2018001,
        message: "Permission denied for Bearer SECRET_TEST_TOKEN",
      },
    }, { status: 403 })) as typeof fetch,
  });
  const diagnostic = result.meta_diagnostics?.subscribed_apps;
  assertEquals(result.status, "FAILED");
  assertEquals(diagnostic?.http_status, 403);
  assertEquals(diagnostic?.meta_error?.type, "OAuthException");
  assertEquals(diagnostic?.meta_error?.code, 10);
  assertEquals(diagnostic?.meta_error?.error_subcode, 2018001);
  assertEquals(JSON.stringify(result).includes("SECRET_TEST_TOKEN"), false);
});

Deno.test("read-only WABA diagnosis keeps app-webhook malformed and network failures separate", async () => {
  const malformed = await inspectStoredTestWabaSubscription({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    wabaId: "2080644335858568",
    expectedAppId: "2290735921663266",
    expectedWebhookUrl: "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1/meta-webhook",
    fetchFn: (async (input: RequestInfo | URL) => String(input).includes("subscribed_apps")
      ? Response.json({ data: [] })
      : new Response("not-json", { status: 200 })) as typeof fetch,
  });
  assertEquals(malformed.meta_diagnostics?.app_webhook?.classification, "INVALID_META_RESPONSE");

  const network = await inspectStoredTestWabaSubscription({
    graphVersion: "v21.0",
    accessToken: "SECRET_TEST_TOKEN",
    wabaId: "2080644335858568",
    expectedAppId: "2290735921663266",
    expectedWebhookUrl: "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1/meta-webhook",
    fetchFn: (async () => { throw new Error("network SECRET_TEST_TOKEN"); }) as typeof fetch,
  });
  assertEquals(network.meta_diagnostics?.subscribed_apps?.classification, "NETWORK_ERROR");
});

Deno.test("test WABA subscription is idempotent when the app is already subscribed", async () => {
  const { calls, fetchFn } = metaSubscriptionFetch({
    alreadySubscribed: true,
    appWebhook: "PASS",
  });
  const result = await subscribeWith(fetchFn as typeof fetch);
  assertEquals(result.before, "SUBSCRIBED");
  assertEquals(result.operation, "ALREADY_SUBSCRIBED");
  assertEquals(result.app_webhook_status, "UNKNOWN");
  assertEquals(result.messages_subscription, "UNKNOWN");
  assertEquals(calls.some((call) => call.method === "POST"), false);
});

Deno.test("test WABA subscription posts only after subscription and app webhook checks pass", async () => {
  const { calls, fetchFn } = metaSubscriptionFetch({ appWebhook: "PASS" });
  const result = await subscribeWith(fetchFn as typeof fetch);
  assertEquals(result.before, "NOT_SUBSCRIBED");
  assertEquals(result.operation, "SUBSCRIBED");
  assertEquals(result.after, "SUBSCRIBED");
  assertEquals(result.app_id_present, "YES");
  assertEquals(result.app_webhook_status, "UNKNOWN");
  assertEquals(result.messages_subscription, "UNKNOWN");
  assertEquals(calls.filter((call) => call.method === "POST").length, 1);
  assertEquals(calls.some((call) => call.url.includes("/messages")), false);
  assertEquals(JSON.stringify(result).includes("SECRET_TEST_TOKEN"), false);
});

Deno.test("test WABA subscription stops safely when post verification fails or Meta rejects", async () => {
  const unverified = metaSubscriptionFetch({ subscribedAfterPost: false });
  const unverifiedResult = await subscribeWith(unverified.fetchFn as typeof fetch);
  assertEquals(unverifiedResult.operation, "FAILED");
  assertEquals(unverifiedResult.after, "NOT_SUBSCRIBED");
  assertEquals(unverifiedResult.app_id_present, "NO");
  assertEquals(unverified.calls.filter((call) => call.method === "POST").length, 1);

  const rejected = metaSubscriptionFetch({ appWebhook: "PASS", postFails: true });
  const rejectedResult = await subscribeWith(rejected.fetchFn as typeof fetch);
  assertEquals(rejectedResult.operation, "FAILED");
  assertEquals(rejectedResult.error, "meta_subscription_rejected");
  assertEquals(rejected.calls.filter((call) => call.method === "POST").length, 1);
});
