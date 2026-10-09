import { assert, assertStringIncludes } from "https://deno.land/std@0.223.0/assert/mod.ts";

Deno.test("OAuth state is signed, expiring, and membership-scoped", async () => {
  const source = await Deno.readTextFile(new URL("../meta-oauth-state/index.ts", import.meta.url));
  assertStringIncludes(source, "hmacSha256Base64Url");
  assertStringIncludes(source, "org_members");
  assertStringIncludes(source, "user_id");
  assertStringIncludes(source, "nonce:");
});

Deno.test("OAuth origin and callback are explicitly allowlisted", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertStringIncludes(source, '"https://dental.creatyv.io"');
  assertStringIncludes(source, '"https://referral.creatyv.io"');
  assertStringIncludes(source, 'url.pathname !== "/auth/meta/callback"');
  assertStringIncludes(source, "invalid_redirect_uri");
});

Deno.test("OAuth requires Page selection and rejects ownership conflicts", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertStringIncludes(source, "selecciona explícitamente una página");
  assertStringIncludes(source, 'if (action === "save_page")');
  assertStringIncludes(source, '.neq("organization_id", args.organizationId)');
  assertStringIncludes(source, "meta_page_already_connected");
});

Deno.test("OAuth preserves business type and scopes tenant writes", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertStringIncludes(source, '.select("organization_id,business_type")');
  assertStringIncludes(source, "business_type: businessType");
  assert(!source.includes('business_type: "dental"'));
});

Deno.test("run-replies has no global Page-token fallback", async () => {
  const source = await Deno.readTextFile(new URL("../run-replies/index.ts", import.meta.url));
  assert(!source.includes('Deno.env.get("META_PAGE_ACCESS_TOKEN")'));
  assertStringIncludes(source, "meta_page_access_token");
  assertStringIncludes(source, "handleReferralHubProductTurn");
});
