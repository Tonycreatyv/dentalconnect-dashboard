import { assert, assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { createSignupState, mayManageWhatsApp, REFERRAL_HUB_ORGANIZATION_ID, verifySignupState } from "./contract.ts";

Deno.test("signup state is tenant/user bound, signed and expires", async () => {
  const now = 1_800_000_000_000;
  const token = await createSignupState("owner-1", "test-secret", now);
  const valid = await verifySignupState(token, "owner-1", "test-secret", now + 1_000);
  assertEquals(valid?.organizationId, REFERRAL_HUB_ORGANIZATION_ID);
  assert(valid?.nonce);
  assertEquals(await verifySignupState(token, "other-user", "test-secret", now), null);
  assertEquals(await verifySignupState(`${token}x`, "owner-1", "test-secret", now), null);
  assertEquals(await verifySignupState(token, "owner-1", "test-secret", now + 11 * 60_000), null);
});

Deno.test("only owners and admins may manage WhatsApp", () => {
  assert(mayManageWhatsApp("owner"));
  assert(mayManageWhatsApp("admin"));
  assertEquals(mayManageWhatsApp("member"), false);
  assertEquals(mayManageWhatsApp(null), false);
});
