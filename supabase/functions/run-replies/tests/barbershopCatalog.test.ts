import { assertEquals, assert } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  detectBarbershopService,
  getBarbershopServiceById,
} from "../domain/barbershop/index.ts";

Deno.test("detecta corte", () => {
  const result = detectBarbershopService("quiero un corte");
  assertEquals(result.matchedService?.id, "haircut");
});

Deno.test("detecta barba", () => {
  const result = detectBarbershopService("necesito barba");
  assertEquals(result.matchedService?.id, "beard");
});

Deno.test("detecta corte + barba", () => {
  const result = detectBarbershopService("quiero corte y barba");
  assertEquals(result.matchedService?.id, "haircut_beard");
});

Deno.test("detecta cejas", () => {
  const result = detectBarbershopService("solo cejas");
  assertEquals(result.matchedService?.id, "eyebrows");
});

Deno.test("detecta corte niño", () => {
  const result = detectBarbershopService("corte para niño");
  assertEquals(result.matchedService?.id, "kids_haircut");
});

Deno.test("detecta barbero preferido: con Carlos", () => {
  const result = detectBarbershopService("quiero corte con Carlos");
  assertEquals(result.preferredBarber, "Carlos");
});

Deno.test("servicio corte + barba dura 45 min", () => {
  const service = getBarbershopServiceById("haircut_beard");
  assert(service);
  assertEquals(service.durationMinutes, 45);
});

Deno.test("no inventa servicio desconocido", () => {
  const result = detectBarbershopService("quiero depilacion laser");
  assertEquals(result.matchedService, null);
  assertEquals(result.confidence, 0);
});
