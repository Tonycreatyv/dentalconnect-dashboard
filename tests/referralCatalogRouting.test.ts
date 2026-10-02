function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));
const app = await read("../src/apps/referral-hub/App.tsx");
const core = await read("../src/apps/referral-hub/screens/CoreScreens.tsx");
const catalog = await read("../src/apps/referral-hub/screens/CatalogScreens.tsx");
const services = await read("../src/apps/referral-hub/pages/ReferralServices.tsx");
const serviceDetail = await read("../src/apps/referral-hub/pages/ReferralServiceDetail.tsx");
const settings = await read("../src/apps/referral-hub/pages/ReferralSettings.tsx");
const integrations = await read("../src/pages/referral/ReferralMore.tsx");

Deno.test("Home Pedidos activos targets orders and real records unlock the route", () => {
  assert(core.includes('label:"Pedidos activos"') && core.includes('to:"/orders"'), "Home order destination is incorrect");
  assert(app.includes("features.lg_grocery_orders_enabled || orders.orders.length > 0"), "real order capability fallback missing");
  assert(!app.includes('path="orders" element={features.lg_grocery_orders_enabled'), "orders still redirect solely from feature metadata");
});

Deno.test("explicit catalog back destinations are correct", () => {
  assert(services.includes('to="/more"'), "services list parent missing");
  assert(serviceDetail.includes('to="/services"'), "service detail parent missing");
  assert(catalog.includes('back={`/network/stores/${locationId}`}'), "location basket parent missing");
  assert(catalog.includes('back={`/baskets/${locationId}`}'), "basket detail parent missing");
  assert(catalog.includes('title="Cupones" subtitle="Campañas y entregas" back="/more"'), "coupon parent missing");
  assert(catalog.includes('title="Cobertura" subtitle="Selecciona un supermercado" back="/more"'), "coverage parent missing");
  assert(catalog.includes('back="/coverage"'), "coverage detail parent missing");
  assert(integrations.includes('to="/more"'), "integration parent missing");
  assert(settings.includes('to="/more"'), "settings parent missing");
  assert(core.includes('title="Aliados" subtitle="Red profesional" back="/network"'), "allies parent missing");
  assert(core.includes('back="/network/allies"'), "ally detail parent missing");
});

Deno.test("store workspace has distinct routed sections", () => {
  for (const suffix of ["baskets", "coupons", "coverage", "activity"]) assert(app.includes(`path="network/stores/:locationId/${suffix}"`), `store route missing: ${suffix}`);
  for (const destination of ["`${base}/baskets`", "`${base}/coupons`", "`${base}/coverage`", "`${base}/activity`"]) assert(catalog.includes(destination), `store tab destination missing: ${destination}`);
});

Deno.test("basket rows open scoped details and editing is correctly blocked", () => {
  assert(app.includes('path="baskets/:locationId/:offerId"'), "basket detail route missing");
  assert(catalog.includes('to={`/baskets/${locationId}/${offer.id}`}'), "basket rows are not linked");
  assert(catalog.includes("contents_snapshot"), "basket contents missing");
  assert(catalog.includes("Solo lectura. Los cambios de precio y contenido todavía no están habilitados para esta cuenta."), "missing safe-edit blocker");
  assert(!catalog.includes("updateBasket"), "unsupported basket write added");
});

Deno.test("catalog hub rows use distinct destinations", () => {
  for (const destination of ["/network/stores", "/baskets", "/coupons", "/coverage"]) assert(catalog.includes(`to="${destination}"`), `catalog destination missing: ${destination}`);
  assert(settings.includes('to: "/catalog"'), "Más does not open catalog hub");
});

Deno.test("coupon flow separates definition, campaign and delivery truth", () => {
  assert(app.includes('path="coupons/:couponId"'), "coupon detail route missing");
  for (const label of ["Cupón de supermercado", "Cupón médico", "Cupón dental", "Definiciones, campañas y entregas", "Entregas preparadas", "Entregas confirmadas"]) assert(catalog.includes(label), `coupon concept missing: ${label}`);
  assert(catalog.includes("campaign.campaign_key"), "deliveries are not joined by stable campaign key");
  assert(catalog.includes("Solo lectura. La edición de la imagen y el estado no está habilitada para esta cuenta."), "coupon write blocker missing");
});

Deno.test("modified closure has no inert edit or save controls", () => {
  assert(!/<button[^>]*>\s*(Editar|Guardar)\s*<\/button>/.test(catalog), "unsupported edit/save button rendered");
  assert(catalog.includes("data.saveDeliveryCoverage") && catalog.includes("data.removeDeliveryCoverage"), "coverage controls lack real writes");
});
