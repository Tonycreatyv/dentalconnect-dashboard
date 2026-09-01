import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyLuisFlowCompletion,
  parseLuisBenefitFlowCompletion,
  parseLuisLegalFlowCompletion,
} from "../../_products/referral-hub/luisBenefits.ts";

const immigrationNfmReply = {
  intake_type: "IMMIGRATION",
  topic: "GREEN_CARD",
  full_name: "Ana Cliente",
  postal_code: "30071",
  description: "Necesito orientación sobre residencia.",
  sharing_consent: "AUTHORIZED",
  consent_version: "luis_immigration_sharing_v1",
  consent_source: "whatsapp_flow",
};

const benefitsNfmReply = {
  benefit_key: "SUPERMARKET",
  full_name: "Ana Cliente",
  postal_code: "30071",
  email: "",
  marketing_consent: false,
};

Deno.test("Immigration completion is legal-only and never enters the benefit contract", () => {
  assertEquals(classifyLuisFlowCompletion(immigrationNfmReply), "LEGAL");
  assertEquals(parseLuisBenefitFlowCompletion(immigrationNfmReply), null);
  const completion = parseLuisLegalFlowCompletion(immigrationNfmReply);
  assertEquals(completion?.intake_type, "IMMIGRATION");
  assertEquals(completion?.intake_type === "IMMIGRATION" ? completion.sharing_consent : null, "AUTHORIZED");
});

Deno.test("Benefits completion remains on the claim contract", () => {
  assertEquals(classifyLuisFlowCompletion(benefitsNfmReply), "BENEFITS");
  assertEquals(parseLuisBenefitFlowCompletion(benefitsNfmReply)?.benefit_key, "SUPERMARKET");
  assertEquals(parseLuisLegalFlowCompletion(benefitsNfmReply), null);
});

Deno.test("run-replies dispatches a classified legal completion before benefits validation", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const classification = source.indexOf("const completionKind = classifyLuisFlowCompletion(rawFlowResponse)");
  const benefitsBranch = source.indexOf('if (completionKind === "BENEFITS")', classification);
  const legalBranch = source.indexOf('} else if (completionKind === "LEGAL")', benefitsBranch);
  assert(classification >= 0);
  assert(benefitsBranch > classification);
  assert(legalBranch > benefitsBranch);
  assertStringIncludes(source.slice(legalBranch, legalBranch + 500), "buildLuisLegalFlowCompletionResult");
});

Deno.test("every Unified Flow legal completion stays automated while retaining its completion reply", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const start = source.indexOf("async function buildLuisLegalFlowCompletionResult");
  const end = source.indexOf("function invalidLuisFlowCompletionResult", start);
  const completion = source.slice(start, end);

  assert(start >= 0 && end > start);
  assertStringIncludes(completion, "te dará seguimiento por este mismo WhatsApp");
  assertStringIncludes(completion, "luisLegalPatch(args.leadState, legalIntake)");
  assertStringIncludes(completion, "await recordHumanHandoffEvent({");
  assertStringIncludes(completion, "luis_legal_flow_${completion.intake_type.toLowerCase()}_completed");
  const returnedResult = completion.slice(completion.lastIndexOf("return {"));
  assert(!returnedResult.includes("leadPatch:"));
  assert(!returnedResult.includes("handoff_to_human"));

  for (const intakeType of ["IMMIGRATION", "AUTO_ACCIDENT", "DUI_CRIMINAL"]) {
    assertEquals(classifyLuisFlowCompletion({ intake_type: intakeType }), "LEGAL");
  }
});

Deno.test("only a valid Immigration Flow completion invokes the internal-review capture bridge", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const start = source.indexOf("async function buildLuisLegalFlowCompletionResult");
  const end = source.indexOf("function invalidLuisFlowCompletionResult", start);
  const completion = source.slice(start, end);

  assert(start >= 0 && end > start);
  assertStringIncludes(completion, 'if (completion.intake_type === "IMMIGRATION")');
  assertStringIncludes(completion, "await captureImmigrationFlowRequest({");
  assertStringIncludes(completion, "sharing_consent: completion.sharing_consent");
  assertStringIncludes(completion, 'completion.sharing_consent === "DECLINED"');
  assertStringIncludes(completion, "statePatch: luisLegalPatch(args.leadState, legalIntake)");
  assert(!completion.includes("orchestrateCompletedServiceRequest({"));
});
