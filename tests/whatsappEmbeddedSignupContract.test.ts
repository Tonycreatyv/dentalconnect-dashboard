import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  captureNextMetaSdkRedirect,
  validateMetaSdkRedirectUri,
} from "../src/lib/metaSdkRedirect.ts";

const frontendSource = await Deno.readTextFile(
  new URL("../src/components/WhatsAppConnect.tsx", import.meta.url),
);
const functionSource = await Deno.readTextFile(
  new URL("../supabase/functions/whatsapp-signup/index.ts", import.meta.url),
);

Deno.test("Embedded Signup preserves the Meta SDK redirect contract", () => {
  assertStringIncludes(frontendSource, "captureNextMetaSdkRedirect()");
  assertStringIncludes(
    frontendSource,
    "meta_redirect_uri: input.metaRedirectUri",
  );
  assertStringIncludes(
    functionSource,
    "validateMetaRedirectUri(body.meta_redirect_uri)",
  );
  assertStringIncludes(
    functionSource,
    'tokenUrl.searchParams.set("redirect_uri", redirectUri)',
  );
});

Deno.test("frontend accepts only a bounded dynamic Meta XD redirect", () => {
  const valid =
    "https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46#cb=current-attempt";
  assertEquals(validateMetaSdkRedirectUri(valid), valid);
  for (
    const invalid of [
      "https://example.com/x/connect/xd_arbiter/?version=46#cb=x",
      "https://staticxx.facebook.com/x/connect/xd_arbiter?version=46#cb=x",
      "https://staticxx.facebook.com/wrong/?version=46#cb=x",
      "https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46",
      "https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46&extra=1#cb=x",
      "https://user:pass@staticxx.facebook.com/x/connect/xd_arbiter/?version=46#cb=x",
      `https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46#${
        "x".repeat(2049)
      }`,
    ]
  ) assertEquals(validateMetaSdkRedirectUri(invalid), null);
});

Deno.test("popup capture retains the current attempt URI and restores window.open", async () => {
  const redirect =
    "https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46#cb=attempt-two";
  const popupUrl = `https://www.facebook.com/v21.0/dialog/oauth?redirect_uri=${
    encodeURIComponent(redirect)
  }`;
  const originalWindow = globalThis.window;
  const openCalls: unknown[][] = [];
  const originalOpen = (...args: unknown[]) => {
    openCalls.push(args);
    return { closed: false };
  };
  const fakeWindow = {
    location: { href: "https://referral.creatyv.io/integrations" },
    open: originalOpen,
    setTimeout,
    clearTimeout,
  };
  Object.defineProperty(globalThis, "window", {
    value: fakeWindow,
    configurable: true,
  });
  try {
    const capture = captureNextMetaSdkRedirect(100);
    const popup = fakeWindow.open(popupUrl, "_blank", "width=600");
    await Promise.resolve();
    assert(popup);
    assertEquals(capture.getCaptured(), redirect);
    assertEquals(fakeWindow.open, originalOpen);
    assertEquals(openCalls.length, 1);
  } finally {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
  }
});

Deno.test("popup capture rejects missing redirect and restores defensively", () => {
  const originalWindow = globalThis.window;
  const originalOpen = (() => null) as (...args: unknown[]) => null;
  const fakeWindow = {
    location: { href: "https://referral.creatyv.io/integrations" },
    open: originalOpen,
    setTimeout,
    clearTimeout,
  };
  Object.defineProperty(globalThis, "window", {
    value: fakeWindow,
    configurable: true,
  });
  try {
    const capture = captureNextMetaSdkRedirect(100);
    fakeWindow.open("https://www.facebook.com/v21.0/dialog/oauth", "_blank");
    assertEquals(capture.getCaptured(), null);
    capture.restore();
    assertEquals(fakeWindow.open, originalOpen);
  } finally {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
  }
});

Deno.test("Embedded Signup requests session information version 3 as a string", () => {
  assertStringIncludes(frontendSource, 'sessionInfoVersion: "3"');
  assertEquals(frontendSource.includes("sessionInfoVersion: 3"), false);
  assertEquals(frontendSource.includes("console.log(metaRedirectUri"), false);
  assertEquals(functionSource.includes("console.log(metaRedirectUri"), false);
});
