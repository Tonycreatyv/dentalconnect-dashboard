import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Live verification (FINAL BENEFIT DELIVERY HOTFIX) traced a real Mableton
// claim and found the server-side send order was already correct — image,
// then confirmation text, then the post-benefit menu — with an explicit
// "2026-08-27 ordering fix" comment already documenting exactly this
// guarantee. The customer-visible reordering some deliveries show is best
// explained by the Mableton PNG's unusually large size (2,996,011 bytes vs
// ~200-300KB for every other coupon image) delaying that one message's
// transfer/render on the recipient's device — not a code ordering bug.
// These are regression tests proving the existing guarantee, not a fix.
const workerSource = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("buildLuisBenefitsFlowCompletionResult puts the coupon image in outboundMessages and the confirmation text in outboundPrelude - the send-order-determining fields, not the main reply", () => {
  const fnStart = workerSource.indexOf("async function buildLuisBenefitsFlowCompletionResult(args: {");
  const fnEnd = workerSource.indexOf("\n// Production regression (2026-08-26", fnStart);
  const fn = workerSource.slice(fnStart, fnEnd);
  assert(fnStart > -1 && fnEnd > fnStart, "buildLuisBenefitsFlowCompletionResult not found");
  assertStringIncludes(fn, "outboundMessages: [\n      { type: \"image\", url: mediaUrl, altText: `Beneficio ${benefit.displayName}` },\n    ],");
  assertStringIncludes(fn, "outboundPrelude: [{ text: activationText }],");
  // The main reply/interactiveButtons is the post-benefit menu itself -
  // "another/services/finalize" - never the coupon or its confirmation.
  assertStringIncludes(fn, '{ id: "luis_benefits:another", title: "Ver beneficios" }');
  assertStringIncludes(fn, '{ id: "luis_benefits:finalize", title: "Finalizar" }');
});

Deno.test("the send pipeline processes outboundMessages (image) strictly before outboundPrelude (confirmation), and both strictly before the main reply+menu send", () => {
  const imageLoopIndex = workerSource.indexOf(
    "for (const [index, message] of (generated.outboundMessages ?? []).entries())",
  );
  const preludeLoopIndex = workerSource.indexOf(
    "for (const prelude of generated.outboundPrelude ?? [])",
  );
  const flowPayloadBuiltIndex = workerSource.indexOf('logEvent("flow_payload_built"', preludeLoopIndex);
  assert(imageLoopIndex > -1, "outboundMessages send loop not found");
  assert(preludeLoopIndex > -1, "outboundPrelude send loop not found");
  assert(flowPayloadBuiltIndex > -1, "main reply send (flow_payload_built) not found after the prelude loop");
  // Textual/execution order in a single synchronous function body: image
  // loop, then prelude loop, then the main reply/menu send.
  assertEquals(imageLoopIndex < preludeLoopIndex, true);
  assertEquals(preludeLoopIndex < flowPayloadBuiltIndex, true);
});

Deno.test("both send loops await each Graph API call before continuing - sequential, never Promise.all/concurrent, so ordering is deterministic", () => {
  const imageLoopStart = workerSource.indexOf(
    "for (const [index, message] of (generated.outboundMessages ?? []).entries())",
  );
  const imageLoopEnd = workerSource.indexOf(
    "for (const prelude of generated.outboundPrelude ?? [])",
    imageLoopStart,
  );
  const imageLoopBody = workerSource.slice(imageLoopStart, imageLoopEnd);
  assertStringIncludes(imageLoopBody, "const preludeResp = await sendViaMetaAdapter({");
  assertEquals(imageLoopBody.includes("Promise.all"), false);

  const preludeLoopStart = imageLoopEnd;
  const preludeLoopEnd = workerSource.indexOf('logEvent("flow_payload_built"', preludeLoopStart);
  const preludeLoopBody = workerSource.slice(preludeLoopStart, preludeLoopEnd);
  assertStringIncludes(preludeLoopBody, "await sendViaMetaAdapter({");
  assertEquals(preludeLoopBody.includes("Promise.all"), false);
});

Deno.test("the benefit claim is issued strictly between the image send and the confirmation/menu sends - never before the image, never after the menu", () => {
  // This is the documented 2026-08-27 ordering fix this repo already
  // shipped: if the image send fails, the claim never gets issued and the
  // customer never sees a confirmation/menu implying an active benefit the
  // database doesn't yet agree with.
  const imageLoopStart = workerSource.indexOf(
    "for (const [index, message] of (generated.outboundMessages ?? []).entries())",
  );
  const issueRpcIndex = workerSource.indexOf('supabase.rpc("issue_referral_benefit_claim"', imageLoopStart);
  const preludeLoopStart = workerSource.indexOf(
    "for (const prelude of generated.outboundPrelude ?? [])",
    imageLoopStart,
  );
  assert(issueRpcIndex > -1, "issue_referral_benefit_claim call not found");
  assertEquals(imageLoopStart < issueRpcIndex, true);
  assertEquals(issueRpcIndex < preludeLoopStart, true);
});
