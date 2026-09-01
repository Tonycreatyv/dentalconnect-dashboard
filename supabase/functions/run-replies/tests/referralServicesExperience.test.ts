import { assert, assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { availableServices, FRONT_SERVICE_LIMIT, GROCERY_CUSTOMER_PREVIEW, isShownFirst, moveService, orderServices } from "../../../../src/apps/referral-hub/pages/serviceExperienceModel.ts";

const services = [
  { id: "three", nombre: "Tres", menu_label: "Tres", menu_orden: 3, activo: true },
  { id: "one", nombre: "Uno", menu_label: "Uno", menu_orden: 1, activo: true },
  { id: "hidden", nombre: "Oculto", menu_label: "Oculto", menu_orden: 2, activo: false },
  { id: "two", nombre: "Dos", menu_label: "Dos", menu_orden: 4, activo: true },
  { id: "four", nombre: "Cuatro", menu_label: "Cuatro", menu_orden: 5, activo: true },
];

Deno.test("service experience maps availability and front services from active and menu order", () => {
  assertEquals(availableServices(services).map(({ id }) => id), ["one", "three", "two", "four"]);
  assert(isShownFirst(services[0], services));
  assertEquals(isShownFirst(services[4], services), false);
  assertEquals(FRONT_SERVICE_LIMIT, 3);
});

Deno.test("service experience reorders through the existing menu order field", () => {
  const reordered = moveService(services, "four", 0);
  assertEquals(orderServices(reordered).map(({ id }) => id), ["four", "one", "hidden", "three", "two"]);
  assertEquals(reordered.map(({ menu_orden }) => menu_orden), [1, 2, 3, 4, 5]);
});

Deno.test("grocery customer preview contains both entry and post-coupon journeys", () => {
  assertEquals(GROCERY_CUSTOMER_PREVIEW.entry.actions, ["Quiero mi cupón", "Ver las canastas"]);
  assert(GROCERY_CUSTOMER_PREVIEW.afterCoupon.message.includes("Ya que vas a comprar…"));
  assertEquals(GROCERY_CUSTOMER_PREVIEW.afterCoupon.actions, ["Sí, ver las canastas", "No, ya tengo mi cupón"]);
});
