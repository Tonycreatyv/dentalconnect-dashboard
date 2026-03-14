import { assertEquals, assert } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { runLlmTurn, validateLlmTurnResult } from "../domain/llmTurn.ts";

Deno.test("validateLlmTurnResult accepts valid payload", () => {
  const payload = {
    reply: "Test reply",
    state_patch: { stage: "DISCOVERY" },
    tool_calls: [{ name: "send_trial_link", payload: {} }],
    decision_meta: { reason: "test", confidence: 0.5 },
  };
  const validation = validateLlmTurnResult(payload);
  assert(validation.validation.valid);
  assertEquals(validation.result?.reply, "Test reply");
});

Deno.test("validateLlmTurnResult rejects invalid payload", () => {
  const payload = {
    reply: "",
    state_patch: null,
    tool_calls: "not-an-array",
  };
  const validation = validateLlmTurnResult(payload);
  assert(!validation.validation.valid);
  assert(validation.validation.errors.length >= 1);
});

Deno.test("runLlmTurn returns null when disabled", async () => {
  const result = await runLlmTurn({
    organizationId: "creatyv-product",
    inboundText: "hola",
    leadState: null,
    orgSettings: {},
  });
  assertEquals(result, null);
});
