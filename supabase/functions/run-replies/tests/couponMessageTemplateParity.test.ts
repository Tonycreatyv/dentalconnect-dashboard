import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCouponMessage as denoRender } from "../../_shared/couponMessageTemplate.ts";
import { renderCouponMessage as frontendRender } from "../../../../src/apps/referral-hub/operations/couponMessageTemplate.ts";
import { luisBenefitsActivationText } from "../../_products/referral-hub/luisBenefits.ts";

// Cross-implementation parity: the Deno-side module (consumed by run-replies)
// and the frontend TypeScript port (consumed by the coupon editor's preview)
// must never drift. Deno can execute both files directly regardless of which
// build system they're written for, so this is a real, runnable check - not
// an aspiration.
const FIXTURES: Array<{ name: string; template: string; values: Record<string, string> }> = [
  {
    name: "all placeholders populated",
    template: "Hola {{customer_first_name}}, tu beneficio {{benefit_name}} está listo. Código: {{claim_code}} en {{business_name}}.",
    values: { customer_first_name: "María", benefit_name: "20% de descuento", claim_code: "LG-AB12", business_name: "Médico Urgencias" },
  },
  {
    name: "optional segment present",
    template: "¡Listo{{#customer_first_name}}, {{customer_first_name}}{{/customer_first_name}}! 🎉",
    values: { customer_first_name: "Carlos" },
  },
  {
    name: "optional segment absent",
    template: "¡Listo{{#customer_first_name}}, {{customer_first_name}}{{/customer_first_name}}! 🎉",
    values: {},
  },
  {
    name: "optional segment whitespace-only treated as absent",
    template: "¡Listo{{#customer_first_name}}, {{customer_first_name}}{{/customer_first_name}}! 🎉",
    values: { customer_first_name: "   " },
  },
  {
    name: "no placeholders at all",
    template: "Mensaje fijo sin variables.",
    values: {},
  },
  {
    name: "address placeholder populated",
    template: "Presentalo en {{business_name}}, {{address}}.",
    values: { business_name: "Médico Urgencias", address: "2291 Browns Bridge Rd, Gainesville, GA 30504" },
  },
  {
    name: "address placeholder empty is not an error",
    template: "Presentalo en {{business_name}}.",
    values: { business_name: "Médico Urgencias", address: "" },
  },
];

for (const fixture of FIXTURES) {
  Deno.test(`couponMessageTemplate parity: ${fixture.name}`, () => {
    const deno = denoRender(fixture.template, fixture.values);
    const frontend = frontendRender(fixture.template, fixture.values);
    assertEquals(deno, frontend, "Deno and frontend renderer implementations produced different output");
  });
}

Deno.test("couponMessageTemplate: unknown placeholder is rejected (both implementations)", () => {
  const template = "Hola {{unknown_field}}";
  assertThrows(() => denoRender(template, {}));
  assertThrows(() => frontendRender(template, {}));
});

Deno.test("couponMessageTemplate: unknown block placeholder is rejected (both implementations)", () => {
  const template = "{{#unknown_field}}x{{/unknown_field}}";
  assertThrows(() => denoRender(template, {}));
  assertThrows(() => frontendRender(template, {}));
});

// Medical pilot parity gate: the seeded db-driven template must reproduce
// luisBenefitsActivationText's exact current output for the same fixture
// args, byte-for-byte, when a business name (partnerName) is present - which
// it always will be for any row using delivery_source='db', since a business
// is required to configure db-driven delivery in the first place. The
// partnerName-absent branch of luisBenefitsActivationText ("...con el
// negocio participante.") is legacy-only behavior this template does not
// need to reproduce.
const MEDICAL_SEEDED_TEMPLATE = [
  "¡Listo{{#customer_first_name}}, {{customer_first_name}}{{/customer_first_name}}! 🎉",
  "",
  "Tu beneficio ya está activo.",
  "",
  "{{benefit_name}}",
  "",
  "Código de activación: {{claim_code}}",
  "",
  "Guardá este mensaje y presentá tu beneficio en {{business_name}}.",
].join("\n");

const MEDICAL_FIXTURE_CASES: Array<{ name: string; firstName: string; benefitDisplayName: string; claimCode: string; partnerName: string }> = [
  { name: "typical claim with first name", firstName: "María", benefitDisplayName: "20% de descuento en servicios médicos", claimCode: "LG-9F3A", partnerName: "Médico Urgencias" },
  { name: "empty first name", firstName: "", benefitDisplayName: "20% de descuento en servicios médicos", claimCode: "LG-0000", partnerName: "Médico Urgencias" },
  { name: "multi-word first name uses only first token", firstName: "Ana Lucía Pérez", benefitDisplayName: "20% de descuento en servicios médicos", claimCode: "LG-ZZZZ", partnerName: "Médico Urgencias" },
];

for (const testCase of MEDICAL_FIXTURE_CASES) {
  Deno.test(`medical pilot parity gate: ${testCase.name}`, () => {
    const legacy = luisBenefitsActivationText({
      firstName: testCase.firstName,
      benefitDisplayName: testCase.benefitDisplayName,
      claimCode: testCase.claimCode,
      partnerName: testCase.partnerName,
    });
    const dbDriven = denoRender(MEDICAL_SEEDED_TEMPLATE, {
      customer_first_name: testCase.firstName.trim().split(/\s+/)[0] || "",
      benefit_name: testCase.benefitDisplayName,
      claim_code: testCase.claimCode,
      business_name: testCase.partnerName,
    });
    assertEquals(dbDriven, legacy, "Seeded medical template must byte-for-byte match luisBenefitsActivationText's current output");
  });
}
