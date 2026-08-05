import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  buildMetaTokenUrl,
  classifyMetaOAuthMessage,
  safeMetaOAuthDiagnostic,
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

Deno.test("signup never enables before registration and webhook success", () => {
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
    'return json(req, 502, { ok: false, error: "token_exchange_failed" })',
  );
  assertStringIncludes(source, 'stage: "token_exchange"');
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

Deno.test("token exchange uses one safely encoded trusted redirect URI", () => {
  const redirectUri =
    "https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46";
  const tokenUrl = buildMetaTokenUrl(
    "v21.0",
    "public-app-id",
    "test-secret",
    "code with reserved &=? characters",
    redirectUri,
  );
  assertEquals(tokenUrl.searchParams.getAll("redirect_uri"), [redirectUri]);
  assertEquals(
    tokenUrl.searchParams.get("code"),
    "code with reserved &=? characters",
  );
  assertStringIncludes(
    tokenUrl.toString(),
    "redirect_uri=https%3A%2F%2Fstaticxx.facebook.com%2Fx%2Fconnect%2Fxd_arbiter%2F%3Fversion%3D46",
  );
});

Deno.test("caller input cannot override the server redirect URI", () => {
  assertStringIncludes(source, 'env("META_WHATSAPP_REDIRECT_URI")');
  assertStringIncludes(source, "metaWhatsAppRedirectUri");
  assertEquals(source.includes("body.redirect_uri"), false);
  assertEquals(source.includes("body.redirectUri"), false);
  assertStringIncludes(source, '"missing_configuration"');
});
