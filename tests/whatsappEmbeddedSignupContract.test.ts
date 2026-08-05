import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";

const frontendSource = await Deno.readTextFile(
  new URL("../src/components/WhatsAppConnect.tsx", import.meta.url),
);
const functionSource = await Deno.readTextFile(
  new URL("../supabase/functions/whatsapp-signup/index.ts", import.meta.url),
);

Deno.test("Embedded Signup preserves the Meta SDK redirect contract", () => {
  assertEquals(frontendSource.includes("redirect_uri:"), false);
  assertEquals(frontendSource.includes("redirectUri:"), false);
  assertStringIncludes(functionSource, 'env("META_WHATSAPP_REDIRECT_URI")');
  assertStringIncludes(
    functionSource,
    'tokenUrl.searchParams.set("redirect_uri", redirectUri)',
  );
});

Deno.test("Embedded Signup requests session information version 3 as a string", () => {
  assertStringIncludes(frontendSource, 'sessionInfoVersion: "3"');
  assertEquals(frontendSource.includes("sessionInfoVersion: 3"), false);
});
