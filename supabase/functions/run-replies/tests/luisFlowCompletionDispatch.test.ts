import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyAccidentValidationFailure,
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

// P0 (2026-09): ACCIDENT_BASICS' DatePicker submits accident_date as a
// Unix-millisecond-epoch string (Meta's documented DatePicker contract),
// never YYYY-MM-DD directly - the parser previously required YYYY-MM-DD
// outright, so every real AUTO_ACCIDENT submission from the published Flow
// failed with the generic "No pudimos validar tu solicitud..." reply,
// regardless of how the customer reached the Flow (fresh open or reopened
// via "Ver servicios"). This reproduces the exact Flow response shape.
const autoAccidentNfmReplyRealFormat = {
  intake_type: "AUTO_ACCIDENT",
  full_name: "Ana Cliente",
  // 2026-03-05T00:00:00.000Z as Meta's DatePicker actually sends it.
  accident_date: "1772668800000",
  participation: "DRIVER",
  received_medical_attention: "YES",
  medical_provider: "",
  description: "Choque en la interseccion, sin heridos graves.",
};

Deno.test("AUTO_ACCIDENT completion validates the real Meta DatePicker format (Unix-millisecond-epoch string), not just YYYY-MM-DD", () => {
  assertEquals(classifyLuisFlowCompletion(autoAccidentNfmReplyRealFormat), "LEGAL");
  const completion = parseLuisLegalFlowCompletion(autoAccidentNfmReplyRealFormat);
  assert(completion !== null, "a real Meta DatePicker payload must not be rejected as invalid");
  assertEquals(completion?.intake_type, "AUTO_ACCIDENT");
  assertEquals(completion?.intake_type === "AUTO_ACCIDENT" ? completion.accident_date : null, "2026-03-05");
});

Deno.test("AUTO_ACCIDENT completion still accepts an already-YYYY-MM-DD accident_date unchanged", () => {
  const completion = parseLuisLegalFlowCompletion({
    ...autoAccidentNfmReplyRealFormat,
    accident_date: "2026-03-05",
  });
  assertEquals(completion?.intake_type === "AUTO_ACCIDENT" ? completion.accident_date : null, "2026-03-05");
});

// P0 (2026-09, confirmed against a real production row): the currently
// published Flow's real AUTO_ACCIDENT completion payload - captured via
// reply_outbox.payload->'flow_response' key/type inspection ONLY, never
// raw customer values - contains service_key, intake_type, full_name,
// description, accident_date (10-char string, already YYYY-MM-DD -
// the millisecond-epoch hypothesis in the test above was a reasonable
// documented-behavior guess that turned out not to be what's actually
// live), police_report, received_medical_attention, sharing_consent,
// consent_version, consent_source - and critically NEVER participant_role
// or its former alias participation. The real Flow also appears to submit
// every legal intake type's fields together on a shared completion action
// (dui_date/criminal_charge/court_date_status/currently_detained were
// present alongside the accident fields on the same real row), so the
// parser must also tolerate unrelated sibling-intake keys being present.
const autoAccidentNfmReplyConfirmedRealShape = {
  service_key: "ACCIDENT",
  intake_type: "AUTO_ACCIDENT",
  full_name: "Ana Cliente",
  description: "Choque en la interseccion, sin heridos graves.",
  accident_date: "2026-03-05",
  received_medical_attention: "YES",
  police_report: "YES",
  sharing_consent: "AUTHORIZED",
  consent_version: "luis_legal_sharing_v1",
  consent_source: "whatsapp_flow",
  // Sibling-intake fields the real Flow apparently includes on every
  // completion regardless of which type was actually selected - must be
  // harmlessly ignored, never cause a false rejection.
  dui_date: "",
  criminal_charge: "",
  court_date_status: "",
  currently_detained: "",
  postal_code: "",
  chemical_test: "",
};

Deno.test("AUTO_ACCIDENT completion validates the confirmed real production payload shape - no participant_role/participation field at all", () => {
  assertEquals(classifyLuisFlowCompletion(autoAccidentNfmReplyConfirmedRealShape), "LEGAL");
  const completion = parseLuisLegalFlowCompletion(autoAccidentNfmReplyConfirmedRealShape);
  assert(completion !== null, "the confirmed real payload shape must not be rejected as invalid");
  assertEquals(completion?.intake_type, "AUTO_ACCIDENT");
  assertEquals(completion?.intake_type === "AUTO_ACCIDENT" ? completion.accident_date : null, "2026-03-05");
  assertEquals(completion?.intake_type === "AUTO_ACCIDENT" ? completion.participant_role : "unset", null);
});

Deno.test("classifyAccidentValidationFailure reports null (no failure) for the confirmed real payload shape", () => {
  assertEquals(classifyAccidentValidationFailure(autoAccidentNfmReplyConfirmedRealShape), null);
});

Deno.test("classifyAccidentValidationFailure never misclassifies an IMMIGRATION or DUI_CRIMINAL rejection as an accident failure", () => {
  assertEquals(classifyAccidentValidationFailure(immigrationNfmReply), null);
  assertEquals(
    classifyAccidentValidationFailure({ intake_type: "DUI_CRIMINAL", full_name: "", description: "" }),
    null,
  );
});

Deno.test("classifyAccidentValidationFailure identifies each missing/invalid required field with the correct code", () => {
  const base = autoAccidentNfmReplyConfirmedRealShape;
  assertEquals(
    classifyAccidentValidationFailure({ ...base, full_name: "" }),
    "ACCIDENT_MISSING_FULL_NAME",
  );
  assertEquals(
    classifyAccidentValidationFailure({ ...base, description: "" }),
    "ACCIDENT_MISSING_DESCRIPTION",
  );
  assertEquals(
    classifyAccidentValidationFailure({ ...base, accident_date: "not-a-date" }),
    "ACCIDENT_INVALID_DATE",
  );
  assertEquals(
    classifyAccidentValidationFailure({ ...base, received_medical_attention: "MAYBE" }),
    "ACCIDENT_INVALID_MEDICAL_ATTENTION",
  );
  assertEquals(
    classifyAccidentValidationFailure({ ...base, police_report: "MAYBE" }),
    "ACCIDENT_INVALID_POLICE_REPORT",
  );
  assertEquals(
    classifyAccidentValidationFailure({ ...base, sharing_consent: "MAYBE" }),
    "ACCIDENT_INVALID_SHARING_CONSENT",
  );
});

Deno.test("the buildLuisLegalFlowCompletionResult null-branch logs the accident diagnostic, matching the existing diagnoseLuisBenefitFlowCompletionFailure pattern", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const fnStart = source.indexOf("async function buildLuisLegalFlowCompletionResult");
  const parseCall = source.indexOf("const completion = parseLuisLegalFlowCompletion(args.rawFlowResponse);", fnStart);
  assert(parseCall > fnStart, "parseLuisLegalFlowCompletion call not found in buildLuisLegalFlowCompletionResult");
  const nullBranchEnd = source.indexOf("return null;\n  }", parseCall) + "return null;\n  }".length;
  const nullBranch = source.slice(parseCall, nullBranchEnd);
  assertStringIncludes(nullBranch, "classifyAccidentValidationFailure(args.rawFlowResponse)");
  assertStringIncludes(nullBranch, 'logEvent("luis_legal_flow_completion_rejected"');
  // Only the leadId (an internal id, not a customer-supplied value), the
  // intake type literal, and the structural failure code are logged - the
  // logEvent call passes no other field from args.rawFlowResponse.
  const logCallStart = nullBranch.indexOf('logEvent("luis_legal_flow_completion_rejected"');
  const logCallEnd = nullBranch.indexOf("});", logCallStart);
  const logCall = nullBranch.slice(logCallStart, logCallEnd);
  assert(!logCall.includes("rawFlowResponse,"), "must never spread/pass the raw Flow response directly into the log call");
  assert(!logCall.includes("full_name"));
  assert(!logCall.includes("description"));
});

Deno.test("AUTO_ACCIDENT completion still rejects a genuinely invalid accident_date", () => {
  // Note: "2026-13-45" is deliberately not in this list - it matches the
  // YYYY-MM-DD *format* the parser has always accepted at face value
  // (no calendar-validity check, before or after this fix), so it passes
  // through unchanged. This preserves exactly the parser's pre-existing
  // behavior for that input shape rather than introducing new validation
  // scope; only the new numeric-epoch path is validated for real epoch
  // sanity here.
  for (const badDate of ["not-a-date", "", "0", "-5", "13/45/2026"]) {
    const completion = parseLuisLegalFlowCompletion({
      ...autoAccidentNfmReplyRealFormat,
      accident_date: badDate,
    });
    assertEquals(completion, null, `accident_date "${badDate}" must still be rejected as invalid`);
  }
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
