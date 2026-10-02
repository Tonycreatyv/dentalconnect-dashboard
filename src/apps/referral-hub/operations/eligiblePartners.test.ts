/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { eligiblePartnerIds, matchesPartnerServiceRule } from "./eligiblePartners.ts";

const base = { city: "Atlanta", postalCode: "30341", language: "es", specialty: "immigration" };

Deno.test("empty routing arrays mean unrestricted, matching the assignment RPC", () => {
  assertEquals(matchesPartnerServiceRule(base, {
    partnerId: "p1", cities: [], postalCodes: [], languages: [], specialties: [],
  }), true);
});

Deno.test("a configured dimension must match the request value", () => {
  assertEquals(matchesPartnerServiceRule(base, {
    partnerId: "p1", cities: ["Norcross"], postalCodes: [], languages: [], specialties: [],
  }), false);
  assertEquals(matchesPartnerServiceRule(base, {
    partnerId: "p1", cities: ["Atlanta"], postalCodes: ["30341"], languages: ["es"], specialties: ["immigration"],
  }), true);
});

Deno.test("eligible partners also require an active compatible contact", () => {
  const rules = [
    { partnerId: "p1", cities: [], postalCodes: [], languages: [], specialties: [] },
    { partnerId: "p2", cities: [], postalCodes: [], languages: [], specialties: [] },
  ];
  assertEquals(eligiblePartnerIds(base, rules, new Set(["p2"])), ["p2"]);
});
