import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { automationDisabledOutcome } from "../domain/outboxOutcome.ts";

Deno.test("disabled automation pauses outbox without claiming sent", () => {
  assertEquals(automationDisabledOutcome("messenger", false), {
    updates: { status: "paused", sent_at: null, last_error: "automation_disabled" },
    result: { status: "paused", sentAt: null, lastError: "automation_disabled" },
  });
});

Deno.test("disabled Messenger channel pauses outbox without claiming sent", () => {
  assertEquals(automationDisabledOutcome("messenger", true), {
    updates: { status: "paused", sent_at: null, last_error: "messenger_disabled" },
    result: { status: "paused", sentAt: null, lastError: "messenger_disabled" },
  });
});
