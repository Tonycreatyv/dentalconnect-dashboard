/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveActivePartnerContext } from "./partnerMembership.ts";

Deno.test("zero active memberships fails closed with 'none'", () => {
  assertEquals(resolveActivePartnerContext([]), { kind: "none" });
});

Deno.test("exactly one active membership resolves to that partner automatically", () => {
  assertEquals(
    resolveActivePartnerContext([{ organization_id: "luis-gabriel-referral-hub", partner_id: "93bafa9c-acae-4606-966c-c79f5c1003f1", role: "partner_admin" }]),
    { kind: "single", organizationId: "luis-gabriel-referral-hub", partnerId: "93bafa9c-acae-4606-966c-c79f5c1003f1", role: "partner_admin" },
  );
});

Deno.test("more than one active membership fails closed with 'multiple' instead of merging", () => {
  const result = resolveActivePartnerContext([
    { organization_id: "luis-gabriel-referral-hub", partner_id: "93bafa9c-acae-4606-966c-c79f5c1003f1", role: "partner_admin" },
    { organization_id: "luis-gabriel-referral-hub", partner_id: "0a5ab0f1-079c-4901-89ab-26d0e698308d", role: "partner_admin" },
  ]);
  assertEquals(result, { kind: "multiple" });
  // Specifically: it must not silently pick the first row and proceed as if
  // that were the only membership — that would be exactly the "merge" this
  // release is meant to prevent.
  assertEquals("partnerId" in result, false);
});

Deno.test("three or more active memberships still fail closed, not just the two-membership case", () => {
  assertEquals(
    resolveActivePartnerContext([
      { organization_id: "luis-gabriel-referral-hub", partner_id: "a", role: "partner_admin" },
      { organization_id: "luis-gabriel-referral-hub", partner_id: "b", role: "partner_agent" },
      { organization_id: "luis-gabriel-referral-hub", partner_id: "c", role: "partner_admin" },
    ]),
    { kind: "multiple" },
  );
});
