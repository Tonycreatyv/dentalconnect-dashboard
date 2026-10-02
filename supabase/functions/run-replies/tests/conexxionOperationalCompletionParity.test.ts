/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyLuisFlowCompletion,
  parseLuisFurnitureFlowCompletion,
} from "../../_products/referral-hub/luisBenefits.ts";

Deno.test("Furniture completion keeps the production discriminator and ZIP normalization", () => {
  const payload = { service_key: "FURNITURE", full_name: "Ana Lopez", postal_code: "30093" };
  assertEquals(classifyLuisFlowCompletion(payload), "FURNITURE");
  assertEquals(parseLuisFurnitureFlowCompletion(payload), {
    service_key: "FURNITURE",
    full_name: "Ana Lopez",
    postal_code: "30093",
  });
});

Deno.test("Furniture completion accepts a numeric five-digit ZIP without losing it", () => {
  const payload = { service_key: "FURNITURE", full_name: "Ana Lopez", postal_code: 30093 };
  assertEquals(parseLuisFurnitureFlowCompletion(payload)?.postal_code, "30093");
});

Deno.test("operational worker wires Furniture and DUI/Criminal captures without replacing the split legal flow", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertStringIncludes(source, 'captureDuiCriminalFlowRequest');
  assertStringIncludes(source, 'captureFurnitureFlowRequest');
  assertStringIncludes(source, 'completion.intake_type === "DUI_CRIMINAL"');
  assertStringIncludes(source, 'completionKind === "FURNITURE"');
  assertStringIncludes(source, 'buildLuisFurnitureFlowCompletionResult');
  assertStringIncludes(source, 'completion.intake_type === "DUI"');
  assertStringIncludes(source, 'completion.intake_type === "CRIMINAL"');
});
