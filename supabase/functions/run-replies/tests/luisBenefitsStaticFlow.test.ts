import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("../../_products/referral-hub/luis-benefits-flow.json", import.meta.url),
);
const flow = JSON.parse(source) as { version: string; screens: Array<any>; routing_model: Record<string, string[]> };

Deno.test("Luis benefits Flow is static, has exactly two screens, and exposes all four benefits", () => {
  assertEquals(flow.version, "7.3");
  assertEquals(flow.screens.map((screen) => screen.id), ["BENEFIT_SELECT", "CUSTOMER_DETAILS"]);
  assertEquals(flow.routing_model, { BENEFIT_SELECT: ["CUSTOMER_DETAILS"], CUSTOMER_DETAILS: [] });
  assertEquals(source.includes("data_exchange"), false);
  assertEquals(source.includes("data_channel_uri"), false);
  for (const key of ["SUPERMARKET", "MEDICAL", "DENTAL", "SHIPPING"]) assertStringIncludes(source, `"${key}"`);
  assertStringIncludes(source, "Hola, te saluda Luis Gabriel 👋");
  assertStringIncludes(source, "Tenemos beneficios preparados para ayudarte a ahorrar.");
  assertEquals(source.toLowerCase().includes("phone"), false);
});

Deno.test("Luis benefits Flow completion has only approved customer fields", () => {
  const complete = flow.screens[1].layout.children.find((child: any) =>
    child?.["on-click-action"]?.name === "complete"
  );
  assertEquals(Object.keys(complete["on-click-action"].payload), [
    "benefit_key",
    "full_name",
    "postal_code",
    "email",
    "marketing_consent",
  ]);
  const email = flow.screens[1].layout.children.find((child: any) => child.name === "email");
  const consent = flow.screens[1].layout.children.find((child: any) => child.name === "marketing_consent");
  assertEquals(email.required, false);
  assertEquals(consent.name, "marketing_consent");
});
