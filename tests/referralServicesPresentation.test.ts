function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const source = await Deno.readTextFile(
  new URL("../src/apps/referral-hub/pages/ReferralServices.tsx", import.meta.url),
);

Deno.test("services uses the live production catalog without mock data", () => {
  assert(source.includes('.from("service_configs")'), "service_configs query missing");
  assert(source.includes('.eq("organization_id", resolvedOrgId)'), "tenant filter missing");
  assert(!source.includes("mockData"), "mock data must not be imported");
});

Deno.test("services renders a compact linked list", () => {
  assert(source.includes('aria-label="Catálogo de servicios"'), "service list missing");
  assert(source.includes("divide-y divide-[#1C1F23]"), "compact row separators missing");
  assert(source.includes("to={`/services/${encodeURIComponent(service.id)}`}"), "service detail link missing");
  assert(!source.includes("referral-service-admin"), "old service card grid remains");
  assert(!source.includes("OpsCard"), "old oversized service cards remain");
  assert(source.includes("ChevronRight"), "interactive rows need a chevron");
});

Deno.test("services hides raw implementation metadata", () => {
  for (const label of ["Comportamiento", "Orden", "Intake", "Configurado por el router"]) {
    assert(!source.includes(label), `raw metadata label remains: ${label}`);
  }
  assert(source.includes("Respuesta y acción automática"), "static action label missing");
  assert(source.includes("Transferencia a representante"), "transfer label missing");
  assert(source.includes("Recopila información antes de continuar"), "intake summary missing");
});
