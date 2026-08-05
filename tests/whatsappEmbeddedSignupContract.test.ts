import {
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
  assertStringIncludes(frontendSource, 'sessionInfoVersion: "3"');
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
      'extras: { setup: {}, featureType: "", sessionInfoVersion: "3" }',
      "response.authResponse.code",
    ]
  ) assertStringIncludes(frontendSource, sdkArgument);
  for (const source of [frontendSource, functionSource]) {
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
  }]);
  assertEquals(attempt.acceptCode("second-code"), false);
  assertEquals(results.length, 1);
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

Deno.test("frontend installs the session listener before opening FB.login", () => {
  const listener = frontendSource.indexOf(
    'window.addEventListener("message", handler)',
  );
  const login = frontendSource.indexOf("window.FB.login");
  assertEquals(listener >= 0 && login > listener, true);
  assertEquals(frontendSource.includes("8_000"), false);
});
