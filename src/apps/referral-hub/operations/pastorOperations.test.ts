/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { countOperationalWorkStatuses } from "./pastorOperations.ts";

Deno.test("operational service counts use assignment work status", () => {
  assertEquals(countOperationalWorkStatuses(["new", "follow_up", "converted", "not_converted"]), { new: 1, followUp: 1, approved: 1, disqualified: 1 });
});

Deno.test("legacy active work states remain follow-up work", () => {
  assertEquals(countOperationalWorkStatuses(["contacted", "appointment_scheduled", "in_progress"]), { new: 0, followUp: 3, approved: 0, disqualified: 0 });
});
