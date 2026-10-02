/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assignedReferralCanRender, resolvePartnerReferralService } from "./partnerReferralVisibility.ts";

Deno.test("partner resolver supports assigned current and future legal services", () => {
  const cases = [
    ["luis_inmigracion", { topic: "FAMILY_GREEN_CARD" }, "immigration"],
    ["luis_accidente", { intake_type: "AUTO_ACCIDENT" }, "auto_accident"],
    ["luis_accidente", { intake_type: "DUI" }, "dui"],
    ["luis_accidente", { intake_type: "CRIMINAL" }, "criminal"],
    ["luis_dui", {}, "dui"],
    ["luis_criminal", {}, "criminal"],
    ["luis_dui_criminal", { topic: "CRIMINAL_CHARGE", intake_type: "DUI_CRIMINAL" }, "criminal"],
    ["luis_muebles", {}, "furniture"],
    ["luis_representante", {}, "representative"],
  ] as const;
  for (const [serviceId, intake, expected] of cases) assertEquals(resolvePartnerReferralService(serviceId, intake), expected);
});

Deno.test("each assignment is independently renderable while unassigned requests are not a partner-list source", () => {
  assertEquals(assignedReferralCanRender({ id: "assignment-1", referral_service_requests: { id: "request-1" } }), true);
  assertEquals(assignedReferralCanRender({ id: "assignment-2", referral_service_requests: { id: "request-2" } }), true);
  assertEquals(assignedReferralCanRender({ id: null, referral_service_requests: { id: "unassigned-request" } }), false);
});


Deno.test("unknown partner services stay neutral instead of becoming immigration", () => {
  assertEquals(resolvePartnerReferralService("future_service", {}), null);
});
