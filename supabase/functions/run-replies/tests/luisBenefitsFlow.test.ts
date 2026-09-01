import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LUIS_BENEFITS,
  classifyLuisFlowCompletion,
  diagnoseLuisBenefitFlowCompletionFailure,
  luisBenefitsActivationText,
  parseLuisBenefitFlowCompletion,
  parseLuisLegalFlowCompletion,
} from "../../_products/referral-hub/luisBenefits.ts";
import { normalizeWhatsAppInboundMessage } from "../../shared/whatsappNormalization.ts";

Deno.test("Luis benefits completion accepts only the four approved benefits", () => {
  for (const benefit of Object.keys(LUIS_BENEFITS)) {
    const parsed = parseLuisBenefitFlowCompletion({
      benefit_key: benefit,
      full_name: "Luis Cliente",
      postal_code: "30071",
      email: null,
      marketing_consent: false,
    });
    assertEquals(parsed?.benefit_key, benefit);
  }
  assertEquals(parseLuisBenefitFlowCompletion({
    benefit_key: "FURNITURE",
    full_name: "Luis Cliente",
    postal_code: "30071",
    email: null,
    marketing_consent: false,
  }), null);
});

Deno.test("Luis benefits completion requires valid flow fields and explicit email consent", () => {
  const base = {
    benefit_key: "MEDICAL",
    full_name: "Ana López",
    postal_code: "30341",
    email: "ana@example.com",
    marketing_consent: true,
  } as const;
  assertEquals(parseLuisBenefitFlowCompletion(base), base);
  assertEquals(parseLuisBenefitFlowCompletion({ ...base, postal_code: "3034" }), null);
  assertEquals(parseLuisBenefitFlowCompletion({ ...base, email: "wrong" }), null);
  assertEquals(parseLuisBenefitFlowCompletion({ ...base, email: null }), null);
  assertEquals(parseLuisBenefitFlowCompletion({ ...base, marketing_consent: "true" })?.marketing_consent, true);
});

Deno.test("Luis benefits completion canonicalizes Meta OptIn false values without broad coercion", () => {
  const base = {
    benefit_key: "SUPERMARKET",
    full_name: "Ana López",
    postal_code: "30071",
    email: "",
  } as const;
  assertEquals(parseLuisBenefitFlowCompletion({ ...base, marketing_consent: false })?.marketing_consent, false);
  assertEquals(parseLuisBenefitFlowCompletion({ ...base, marketing_consent: "false" })?.marketing_consent, false);
  assertEquals(parseLuisBenefitFlowCompletion(base)?.marketing_consent, false);
  assertEquals(parseLuisBenefitFlowCompletion({ ...base, marketing_consent: "yes" }), null);
});

// Problem 1 (2026-08-25): real production failure, lead 0bb34495-2495-
// 489e-ac09-b43781284772, SUPERMARKET, name "Juliana", ZIP 30096. She was
// rejected with "No pudimos validar tu beneficio" and no claim was ever
// created (confirmed: request_referral_benefit_claim was never reached).
// Her name and ZIP were both genuinely valid; the only previously-known,
// previously-unconfirmed risk for this exact field is a WhatsApp client
// sending postal_code as an unquoted JSON number instead of a string -
// text(value, max) silently treats a number as "" (indistinguishable from
// missing), so a perfectly valid 5-digit ZIP got rejected outright.
Deno.test("Problem 1 fix: a numeric (unquoted) postal_code is now accepted, reproducing and resolving Juliana's exact real failure", () => {
  const julianaSubmission = {
    benefit_key: "SUPERMARKET",
    full_name: "Juliana",
    postal_code: 30096,
    email: null,
    marketing_consent: false,
  };
  const parsed = parseLuisBenefitFlowCompletion(julianaSubmission);
  assertEquals(parsed?.postal_code, "30096");
  assertEquals(parsed?.benefit_key, "SUPERMARKET");
  assertEquals(parsed?.full_name, "Juliana");
});

Deno.test("a numeric postal_code that lost a real leading zero is restored exactly (e.g. Newark 07102 arriving as 7102)", () => {
  const parsed = parseLuisBenefitFlowCompletion({
    benefit_key: "SUPERMARKET",
    full_name: "Cliente",
    postal_code: 7102,
    email: null,
    marketing_consent: false,
  });
  assertEquals(parsed?.postal_code, "07102");
});

Deno.test("an out-of-range numeric postal_code is rejected, not silently coerced into garbage", () => {
  assertEquals(parseLuisBenefitFlowCompletion({
    benefit_key: "SUPERMARKET", full_name: "Cliente", postal_code: 100000, email: null, marketing_consent: false,
  }), null);
  assertEquals(parseLuisBenefitFlowCompletion({
    benefit_key: "SUPERMARKET", full_name: "Cliente", postal_code: -1, email: null, marketing_consent: false,
  }), null);
  assertEquals(parseLuisBenefitFlowCompletion({
    benefit_key: "SUPERMARKET", full_name: "Cliente", postal_code: 123.45, email: null, marketing_consent: false,
  }), null);
});

Deno.test("diagnoseLuisBenefitFlowCompletionFailure never leaks raw field values, only which rule failed", () => {
  const julianaLikeButRejectable = {
    benefit_key: "SUPERMARKET",
    full_name: "Juliana",
    postal_code: 30096,
    email: null,
    marketing_consent: true, // consent checked, no email - real rejection path
  };
  const diagnostic = diagnoseLuisBenefitFlowCompletionFailure(julianaLikeButRejectable);
  assertEquals(diagnostic.hasPayload, true);
  assertEquals(diagnostic.benefitKeyValid, true);
  assertEquals(diagnostic.fullNamePresent, true);
  assertEquals(diagnostic.postalCodeValid, true);
  assertEquals(diagnostic.postalCodeRawType, "number");
  assertEquals(diagnostic.marketingConsentRequiresEmailButMissing, true);
  // Sanitized: the diagnostic object itself must never contain the raw
  // name/email/postal_code values anywhere.
  const serialized = JSON.stringify(diagnostic);
  assertEquals(serialized.includes("Juliana"), false);
  assertEquals(serialized.includes("30096"), false);
});

Deno.test("diagnoseLuisBenefitFlowCompletionFailure correctly identifies a missing payload vs a malformed field", () => {
  assertEquals(diagnoseLuisBenefitFlowCompletionFailure(null).hasPayload, false);
  assertEquals(diagnoseLuisBenefitFlowCompletionFailure("not an object").hasPayload, false);
  const badBenefit = diagnoseLuisBenefitFlowCompletionFailure({
    benefit_key: "FURNITURE", full_name: "Cliente", postal_code: "30071", email: null, marketing_consent: false,
  });
  assertEquals(badBenefit.hasPayload, true);
  assertEquals(badBenefit.benefitKeyValid, false);
});

Deno.test("the legal (immigration/accident/DUI) optional postal_code field has the identical numeric-coercion fix applied", () => {
  const parsed = parseLuisLegalFlowCompletion({
    intake_type: "IMMIGRATION",
    topic: "CONSULTATION",
    full_name: "Cliente",
    postal_code: 30345,
    description: "Necesito ayuda con mi caso",
  });
  assertEquals(parsed?.intake_type, "IMMIGRATION");
  assertEquals(parsed && parsed.intake_type === "IMMIGRATION" ? parsed.postal_code : null, "30345");
});

Deno.test("Flow completion is classified by its response contract before validation", () => {
  const immigration = {
    intake_type: "IMMIGRATION",
    topic: "CONSULTATION",
    full_name: "Ana López",
    postal_code: "30071",
    description: "Necesito orientación.",
  };
  const benefit = {
    benefit_key: "SUPERMARKET",
    full_name: "Ana López",
    postal_code: "30071",
    email: "",
    marketing_consent: false,
  };
  assertEquals(classifyLuisFlowCompletion(immigration), "LEGAL");
  assertEquals(parseLuisBenefitFlowCompletion(immigration), null);
  assertEquals(classifyLuisFlowCompletion(benefit), "BENEFITS");
  assertEquals(classifyLuisFlowCompletion({ ...immigration, benefit_key: "SUPERMARKET" }), "UNKNOWN");
});

Deno.test("nfm_reply response_json becomes a normalized Flow completion without breaking buttons", () => {
  const flow = normalizeWhatsAppInboundMessage({
    interactive: {
      nfm_reply: { response_json: JSON.stringify({ benefit_key: "DENTAL" }) },
    },
  });
  assertEquals(flow?.content, "__whatsapp_flow_completed__");
  assertEquals(flow?.payload_action, "whatsapp_flow:complete");
  assertEquals(flow?.flow_response, { benefit_key: "DENTAL" });

  const button = normalizeWhatsAppInboundMessage({
    interactive: { button_reply: { id: "existing_button", title: "Continuar" } },
  });
  assertEquals(button, { content: "Continuar", payload_action: "existing_button" });
});

Deno.test("Luis legal Flow completions accept only the approved non-documentary fields", () => {
  assertEquals(parseLuisLegalFlowCompletion({
    intake_type: "IMMIGRATION",
    topic: "CONSULTATION",
    full_name: "Ana López",
    postal_code: "30071",
    description: "Necesito una consulta.",
  }), {
    intake_type: "IMMIGRATION",
    topic: "CONSULTATION",
    full_name: "Ana López",
    postal_code: "30071",
    description: "Necesito una consulta.",
    sharing_consent: "PENDING",
    consent_version: null,
    consent_source: null,
  });
  const auto = parseLuisLegalFlowCompletion({
    intake_type: "AUTO_ACCIDENT",
    full_name: "Ana López",
    accident_date: "2026-08-14",
    participation: "DRIVER",
    received_medical_attention: "YES",
    medical_provider: "Clínica local",
    description: "Choque leve.",
  });
  assertEquals(auto?.intake_type, "AUTO_ACCIDENT");
  assertEquals(auto && "participant_role" in auto ? auto.participant_role : null, "DRIVER");
  assertEquals(parseLuisLegalFlowCompletion({
    intake_type: "DUI_CRIMINAL",
    topic: "DUI",
    full_name: "Ana López",
    postal_code: null,
    description: "Necesito orientación.",
  })?.intake_type, "DUI_CRIMINAL");
  assertEquals(parseLuisLegalFlowCompletion({
    intake_type: "DUI_CRIMINAL",
    topic: "DUI",
    full_name: "Ana López",
    postal_code: "3007",
    description: "Necesito orientación.",
  }), null);
});

Deno.test("activation copy uses the customer-facing activation-code label", () => {
  const copy = luisBenefitsActivationText({
    firstName: "Ana López",
    benefitDisplayName: "$20 para tu compra de supermercado",
    claimCode: "LG-8F42",
    partnerName: "El Sol Super Market",
  });
  assertStringIncludes(copy, "¡Listo, Ana!");
  assertStringIncludes(copy, "Código de activación: LG-8F42");
  assertStringIncludes(copy, "presentá tu beneficio en El Sol Super Market.");
  assert(!copy.toLowerCase().includes("coupon code"));
});
