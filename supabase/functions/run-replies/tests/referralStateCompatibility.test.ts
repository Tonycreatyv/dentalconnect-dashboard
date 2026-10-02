import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { resolveMode } from "../../_shared/conversationEngine.ts";
import { normalizeLeadStateForBusinessType } from "../domain/stateNormalization.ts";

Deno.test("new Referral Hub leads resolve to referral mode", () => {
  assertEquals(resolveMode({
    organizationId: "luis-gabriel-referral-hub",
    orgBusinessType: "referral_hub",
    leadState: {} as never,
  }), "referral_hub");
});

Deno.test("Referral normalization preserves profile, pantry, service, and history", () => {
  const collected = {
    referral_hub: {
      profile_name: "Luis Gabriel",
      profile_city: "Atlanta",
      service_id: "luis_accidente",
      pantry_demo: { active: true },
    },
  };
  const normalized = normalizeLeadStateForBusinessType({
    mode: "dental_clinic",
    collected,
    message_history_marker: "keep",
  }, "referral_hub");
  assertEquals(normalized.mode, "referral_hub");
  assertEquals(normalized.orgType, "referral_hub");
  assertEquals(normalized.collected, collected);
  assertEquals(normalized.message_history_marker, "keep");
});
