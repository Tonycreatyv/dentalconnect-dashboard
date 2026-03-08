import { assertEquals } from "https://deno.land/std@0.223.0/testing/asserts.ts";
import { mergeLeadState, mergeStatePatches } from "../index.ts";
import { runConversationEngine } from "../conversationEngine.ts";

Deno.test("mergeStatePatches preserves existing collected fields", () => {
  const primary = { collected: { foo: "bar", last_question: "q1" }, stage: "DISCOVERY" };
  const secondary = { collected: { bar: "baz", new_flag: true }, stage: "SOLUTION" };
  const merged = mergeStatePatches(primary, secondary);
  assertEquals(merged.stage, "SOLUTION");
  assertEquals(merged.collected?.foo, "bar");
  assertEquals(merged.collected?.bar, "baz");
  assertEquals(merged.collected?.new_flag, true);
});

Deno.test("mergeLeadState keeps last_bot_text when patch adds new fields", () => {
  const existing = { last_bot_text: "Hola", collected: { stage: "DISCOVERY" } };
  const patch = { collected: { trial_offered: true } };
  const merged = mergeLeadState(existing, patch);
  assertEquals(merged.last_bot_text, "Hola");
  assertEquals((merged.collected as any).trial_offered, true);
});

Deno.test("mergeStatePatches handles missing secondary patch", () => {
  const primary = { stage: "DISCOVERY", collected: { foo: "bar" } };
  const merged = mergeStatePatches(primary, undefined);
  assertEquals(merged, primary);
});

Deno.test("conversation engine stage stored at top level", () => {
  const result = runConversationEngine({
    organizationId: "creatyv-product",
    inboundText: "hola",
    leadState: { collected: {} },
  });
  assertEquals(typeof result?.statePatch?.stage, "string");
  assertEquals(result?.statePatch?.collected?.stage, undefined);
});
