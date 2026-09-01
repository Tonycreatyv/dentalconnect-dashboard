import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const flows = await Promise.all([
  "luis-immigration-flow.json",
  "luis-auto-accident-flow.json",
  "luis-dui-criminal-flow.json",
].map(async (name) => JSON.parse(await Deno.readTextFile(
  new URL(`../../_products/referral-hub/${name}`, import.meta.url),
))));

Deno.test("Luis legal test Flows stay static, two-screen, and non-documentary", () => {
  for (const flow of flows) {
    const source = JSON.stringify(flow).toLowerCase();
    assertEquals(flow.version, "7.3");
    assertEquals(flow.screens.length, 2);
    assertEquals(source.includes("data_exchange"), false);
    assertEquals(source.includes("endpoint_uri"), false);
    for (const forbidden of ["social security", "passport", "a-number", "driver's license", "medical records", "evidence uploads", "photos"]) {
      assertEquals(source.includes(forbidden), false);
    }
  }
});

Deno.test("Luis legal test Flows preserve their approved completion contracts", () => {
  const expected = [
    ["intake_type", "topic", "full_name", "postal_code", "description"],
    ["intake_type", "full_name", "accident_date", "participation", "received_medical_attention", "medical_provider", "description"],
    ["intake_type", "topic", "full_name", "postal_code", "description"],
  ];
  for (const [index, flow] of flows.entries()) {
    const footer = flow.screens[1].layout.children.find((child: any) =>
      child?.["on-click-action"]?.name === "complete"
    );
    assert(footer);
    assertEquals(Object.keys(footer["on-click-action"].payload), expected[index]);
  }
});

Deno.test("Luis legal Flow copy is distinct, minimal, and has no irrelevant intake warnings", () => {
  const [immigration, accident, criminal] = flows.map((flow) => JSON.stringify(flow));
  assert(immigration.includes("Ayuda de inmigración"));
  assert(immigration.includes("Residencia / Green Card"));
  assert(immigration.includes('"label":"Tu situación"'));
  assert(immigration.includes('"label":"ZIP / código postal"'));
  assertEquals(immigration.includes("Breve descripción de la situación"), false);
  assertEquals(immigration.includes("ZIP / código postal — opcional"), false);
  assertEquals(immigration.toLowerCase().includes("social security"), false);
  assertEquals(immigration.toLowerCase().includes("documentos"), false);
  assert(accident.includes("Tu participación"));
  assert(accident.includes("Si hay una emergencia inmediata o alguien está en peligro, llama al 911."));
  assert(criminal.includes("Citación / corte"));
  assertEquals(criminal.includes('"title":"⚖️ DUI / Defensa"'), false);
});
