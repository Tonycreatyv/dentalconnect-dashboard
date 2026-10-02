/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isActionableAssignment, isCurrentActionableAssignment, uniqueBusinessLeadCount } from "./homeMetrics.ts";

Deno.test("Home Por contactar includes a prequalified request when its assignment is new", () => {
  assertEquals(isCurrentActionableAssignment({ workStatus: "new", requestStatus: "prequalified" }), true);
});

Deno.test("Home Por contactar includes follow_up assignments", () => {
  assertEquals(isActionableAssignment("follow_up"), true);
});

Deno.test("Home Por contactar excludes converted and not_converted assignments", () => {
  assertEquals(isActionableAssignment("converted"), false);
  assertEquals(isActionableAssignment("not_converted"), false);
});

Deno.test("Home Por contactar never promotes a qualified request whose assignment is closed", () => {
  assertEquals(isCurrentActionableAssignment({ workStatus: "closed", requestStatus: "qualified" }), false);
});

Deno.test("Home Clientes deduplicates a lead with a coupon and service request", () => {
  assertEquals(uniqueBusinessLeadCount(["lead-1"], ["lead-1"]), 1);
});

Deno.test("Home Clientes includes coupon-only and service-only leads, while ignoring null identities", () => {
  assertEquals(uniqueBusinessLeadCount(["coupon-only", null], ["service-only", undefined]), 2);
});
