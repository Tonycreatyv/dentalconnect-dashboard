function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const app = await Deno.readTextFile(new URL("../src/apps/referral-hub/App.tsx", import.meta.url));
const detail = await Deno.readTextFile(new URL("../src/apps/referral-hub/pages/ReferralServiceDetail.tsx", import.meta.url));
const core = await Deno.readTextFile(new URL("../src/apps/referral-hub/screens/CoreScreens.tsx", import.meta.url));
const settings = await Deno.readTextFile(new URL("../src/apps/referral-hub/pages/ReferralSettings.tsx", import.meta.url));

Deno.test("service detail is a real tenant-scoped read-only route", () => {
  assert(app.includes('path="services/:serviceId"'), "service detail route missing");
  assert(detail.includes('.from("service_configs")'), "real service query missing");
  assert(detail.includes('.eq("organization_id", resolvedOrgId).eq("id", serviceId)'), "service query is not tenant scoped");
  assert(!/save|edit|mockData/i.test(detail), "detail must remain read-only and mock-free");
});

Deno.test("Inicio uses compact real operational summaries", () => {
  for (const label of ["Conversaciones pendientes", "Requieren intervención", "Automatizaciones activas", "Pedidos activos"]) assert(core.includes(label), `missing summary: ${label}`);
  assert(core.includes("pilot.exceptions.filter"), "real exception alerts missing");
  assert(core.includes("countHumanInterventions"), "real notification failures missing");
});

Deno.test("Trabajo and Red expose the approved tabs", () => {
  for (const label of ["Intervención", "En seguimiento", "Resueltos", "Aliados", "Supermercados"]) assert(core.includes(label), `missing replacement view: ${label}`);
  assert(core.includes('to="/network/stores"'), "supermarket navigation missing");
});

Deno.test("Más routes every visible menu item", () => {
  for (const route of ["/services", "/catalog", "/coupons", "/baskets", "/coverage", "/integrations", "/settings#account"]) assert(settings.includes(route), `missing route: ${route}`);
  assert(settings.includes("signOut"), "working logout missing");
});
