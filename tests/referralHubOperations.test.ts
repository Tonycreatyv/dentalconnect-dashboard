function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));
const app = await read("../src/apps/referral-hub/App.tsx");
const shell = await read("../src/apps/referral-hub/ui/BoltShell.tsx");
const core = await read("../src/apps/referral-hub/screens/CoreScreens.tsx");
const catalog = await read("../src/apps/referral-hub/screens/CatalogScreens.tsx");
const org = await read("../src/apps/referral-hub/organizations/ReferralOrganizationContext.tsx");
const operations = await read("../src/apps/referral-hub/operations/useReferralOperations.ts");
const pilot = await read("../src/apps/referral-hub/operations/useOperationalPilot.ts");
const styles = await read("../src/index.css");

Deno.test("replacement shell exposes Bolt primary navigation", () => {
  for (const label of ["Inicio", "Inbox", "Trabajo", "Pedidos", "Red", "Más"]) assert(shell.includes(`label: "${label}"`), `missing primary destination: ${label}`);
  assert(shell.includes("bolt-rh-bottom"), "mobile bottom navigation missing");
  assert(shell.includes("bolt-rh-sidebar"), "desktop sidebar missing");
});

Deno.test("primary and nested replacement routes are mounted", () => {
  for (const route of ["messages", "messages/:conversationId", "work", "orders", "orders/:orderId", "network", "network/allies", "network/allies/:allyId", "network/stores", "network/stores/:locationId", "more", "services", "services/:serviceId", "baskets", "baskets/:locationId", "coupons", "coverage", "integrations", "settings"]) assert(app.includes(`path="${route}"`), `missing route: ${route}`);
  assert(app.includes("<BoltShell />"), "replacement shell is not mounted");
  assert(!app.includes("ReferralShell"), "legacy shell remains mounted");
});

Deno.test("legacy route names redirect to replacement destinations", () => {
  for (const route of ["attention", "opportunities", "assignments", "partners", "partner-contacts", "supermarkets"]) assert(app.includes(`path="${route}"`), `legacy redirect missing: ${route}`);
  assert(app.includes('to="/work"'), "work redirect missing");
  assert(app.includes('to="/network/allies"'), "ally redirect missing");
  assert(app.includes('to="/network/stores"'), "store redirect missing");
});

Deno.test("real data and write contracts remain connected", () => {
  assert(core.includes("useReferralData()"), "lead adapter missing");
  assert(core.includes("useReferralOperations()"), "messages adapter missing");
  assert(core.includes("ops.sendMessage"), "manual message write missing");
  assert(core.includes("useReferralOrders()"), "orders adapter missing");
  assert(core.includes("data.updateStatus"), "order transition write missing");
  assert(core.includes("useOperationalPilot()"), "operational adapter missing");
  assert(catalog.includes("data.saveDeliveryCoverage"), "coverage save contract missing");
  assert(catalog.includes("data.removeDeliveryCoverage"), "coverage removal contract missing");
  assert(operations.includes('functions.invoke("referral-manual-message"'), "manual message Edge Function contract changed");
  assert(pilot.includes('.eq(\n          "organization_id",\n          resolvedOrgId'), "operational tenant scope missing");
});

Deno.test("tenant enforcement and feature flags remain intact", () => {
  assert(org.includes("REFERRAL_HUB_ORGANIZATION_ID"), "canonical organization enforcement missing");
  for (const flag of ["lg_services_enabled", "lg_grocery_orders_enabled"]) assert(app.includes(flag), `route feature gate missing: ${flag}`);
});

Deno.test("replacement UI contains no Bolt mock imports", () => {
  const visible = `${app}\n${shell}\n${core}\n${catalog}`;
  for (const forbidden of ["mockData", "Math.random", "fakeSave", "ReferralShell", "PilotPages"]) assert(!visible.includes(forbidden), `forbidden replacement dependency: ${forbidden}`);
});

Deno.test("responsive replacement styles define desktop and mobile shells", () => {
  for (const selector of [".bolt-rh-shell", ".bolt-rh-sidebar", ".bolt-rh-bottom", "@media(max-width:767px)"]) assert(styles.includes(selector), `replacement style missing: ${selector}`);
});
