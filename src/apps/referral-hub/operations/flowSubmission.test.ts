/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyFlowSubmission,
  describeFlowSubmission,
  looksLikeUnpersistedCouponImage,
} from "./flowSubmission.ts";

// Fixtures mirror the exact real contract read by run-replies/index.ts
// (parseLuisBenefitFlowCompletion / parseLuisLegalFlowCompletion /
// classifyLuisFlowCompletion in supabase/functions/_products/referral-hub/
// luisBenefits.ts), not invented shapes.

Deno.test("classifies a real BENEFITS flow_response (Diana's supermarket submission shape)", () => {
  const raw = { benefit_key: "SUPERMARKET", full_name: "Diana", postal_code: "30047", email: null, marketing_consent: false };
  assertEquals(classifyFlowSubmission(raw), "BENEFITS");
  const summary = describeFlowSubmission(raw);
  assertEquals(summary?.title, "Formulario completado: beneficio");
  assertStringIncludes(summary!.lines.join("\n"), "Diana");
  assertStringIncludes(summary!.lines.join("\n"), "30047");
  assertStringIncludes(summary!.lines.join("\n"), "$20 para tu compra de supermercado");
});

Deno.test("classifies a real BENEFITS flow_response for medical", () => {
  const raw = { benefit_key: "MEDICAL", full_name: "Diana Meza", postal_code: "30047", email: null, marketing_consent: false };
  const summary = describeFlowSubmission(raw);
  assertStringIncludes(summary!.lines.join("\n"), "20% de descuento en servicios médicos");
});

Deno.test("classifies a real LEGAL/IMMIGRATION flow_response", () => {
  const raw = { intake_type: "IMMIGRATION", topic: "GREEN_CARD", full_name: "Juan Pérez", postal_code: "30047", description: "Necesito ayuda con mi green card" };
  assertEquals(classifyFlowSubmission(raw), "LEGAL");
  const summary = describeFlowSubmission(raw);
  assertEquals(summary?.title, "Formulario completado: consulta legal");
  assertStringIncludes(summary!.lines.join("\n"), "Inmigración");
});

Deno.test("classifies the real HANDOFF completion shape ({service_key: HANDOFF})", () => {
  assertEquals(classifyFlowSubmission({ service_key: "HANDOFF" }), "HANDOFF");
  assertEquals(describeFlowSubmission({ service_key: "HANDOFF" })?.title, "Formulario completado: hablar con el equipo");
});

Deno.test("never fabricates a classification for an ambiguous or empty payload", () => {
  assertEquals(classifyFlowSubmission({}), "UNKNOWN");
  assertEquals(classifyFlowSubmission(null), "UNKNOWN");
  assertEquals(classifyFlowSubmission({ benefit_key: "X", intake_type: "Y" }), "UNKNOWN");
  assertEquals(describeFlowSubmission({}), null);
});

Deno.test("detects the real unpersisted coupon-image alt-text shapes and nothing else", () => {
  assertEquals(looksLikeUnpersistedCouponImage("Beneficio 20% de descuento en servicios médicos"), true);
  assertEquals(looksLikeUnpersistedCouponImage("Imagen del cupón"), true);
  assertEquals(looksLikeUnpersistedCouponImage("Hola, te saluda Luis Gabriel"), false);
  assertEquals(looksLikeUnpersistedCouponImage(""), false);
  assertEquals(looksLikeUnpersistedCouponImage(null), false);
});
