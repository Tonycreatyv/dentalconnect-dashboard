import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import type { PantryDeliveryCoverageConfig } from "../domain/referralHub/pantryDeliveryCoverage.ts";
import {
  getPantryDemoState,
  handlePantryDemoTurn,
  shouldHandlePantryDemo,
} from "../domain/referralHub/pantryDemoRouter.ts";

type LeadState = Record<string, unknown>;
type Turn = ReturnType<typeof handlePantryDemoTurn>;

const AVAILABLE: PantryDeliveryCoverageConfig = {
  availableZipCodes: ["07102"],
  unavailableZipCodes: [],
  fallback: "manual_review",
};
const UNAVAILABLE: PantryDeliveryCoverageConfig = {
  availableZipCodes: [],
  unavailableZipCodes: ["99999"],
  fallback: "manual_review",
};

function turn(leadState: LeadState | null, inboundText = "", payloadAction?: string, coverageConfig?: PantryDeliveryCoverageConfig): Turn {
  return handlePantryDemoTurn({ leadState, inboundText, payloadAction, coverageConfig });
}
function state(result: Turn): LeadState { return result.statePatch as LeadState; }
function pantry(result: Turn) { return getPantryDemoState(state(result)); }
function started(): Turn { return turn(null, "🛒 Cupón $20 super"); }
function selected(packageId: "essential" | "family" | "complete" = "family"): Turn {
  return turn(state(started()), "", `pantry:package:${packageId}`);
}
function atZip(packageId: "essential" | "family" | "complete" = "family"): Turn {
  return turn(state(selected(packageId)), "", "pantry:wanted");
}
function atName(packageId: "essential" | "family" | "complete" = "family"): Turn {
  return turn(state(atZip(packageId)), "07102");
}
function atAddress(packageId: "essential" | "family" | "complete" = "family"): Turn {
  return turn(state(atName(packageId)), "María Demo");
}
function atNotes(packageId: "essential" | "family" | "complete" = "family"): Turn {
  return turn(state(atAddress(packageId)), "123 Demo St, Newark, NJ 07102");
}
function atPayment(packageId: "essential" | "family" | "complete" = "family"): Turn {
  return turn(state(atNotes(packageId)), "No, ninguna");
}

Deno.test("1. QR entrega imagen, código único y reconoce todas las entradas", () => {
  for (const inboundText of ["🛒 Cupón $20 super", "Hola, quiero recibir mi cupón", "Quiero mi cupón", "Cupón supermercado", "Obtener mi cupón"]) {
    assert(shouldHandlePantryDemo({ leadState: null, inboundText }));
    const result = turn(null, inboundText);
    assertEquals(result.outboundPrelude?.[0].imageUrl, "/images/coupon-demo.jpg");
    assertStringIncludes(result.outboundPrelude?.[0].text ?? "", "SUPER20-");
  }
});

Deno.test("2. el mismo lead conserva el mismo cupón al reiniciar", () => {
  const first = started();
  const again = turn(state(first), "Quiero mi cupón");
  assertEquals(pantry(again).coupon?.code, pantry(first).coupon?.code);
});

Deno.test("2a. cupón respaldado por tabla envía URL personal sin código separado y preserva legado", () => {
  const issuedCoupon = { id: "11111111-1111-4111-8111-111111111111", code: "SUPER20-ABCDEF12", publicUrl: "https://referral.creatyv.io/coupon/high-entropy-token", status: "active" as const, issuedAt: "2026-07-15T12:00:00Z", expiresAt: null, wasCreated: true };
  const result = handlePantryDemoTurn({ leadState: state(started()), inboundText: "Quiero mi cupón", issuedCoupon });
  assertEquals(result.outboundPrelude?.length, 2);
  assertEquals(result.outboundPrelude?.[0].imageUrl, undefined);
  assertStringIncludes(result.outboundPrelude?.[0].text ?? "", issuedCoupon.publicUrl);
  assertEquals((result.outboundPrelude ?? []).filter((message) => (message.text ?? "").includes(issuedCoupon.code)).length, 0);
  assertEquals((result.outboundPrelude?.[0].text?.match(/aplica únicamente en compras realizadas en tienda/g) ?? []).length, 1);
  assertEquals(pantry(result).coupon?.source, "database");
  assert(pantry(result).legacy_coupon?.code);
  assertStringIncludes(result.outboundPrelude?.[1].text ?? "", "compras de supermercado");
});

Deno.test("3. leads distintos reciben códigos distintos", () => {
  assertNotEquals(pantry(started()).coupon?.code, pantry(started()).coupon?.code);
});

Deno.test("4. el upsell independiente muestra tres compras y solo cupón", () => {
  const result = started();
  assertEquals(result.outboundPrelude?.length, 2);
  assertEquals(result.outboundPrelude?.[0].imageUrl, "/images/coupon-demo.jpg");
  assertStringIncludes(result.outboundPrelude?.[0].text ?? "", "SUPER20-");
  assertStringIncludes(result.outboundPrelude?.[0].text ?? "", "Guárdalo y muéstralo al momento de realizar tu compra.");
  assertStringIncludes(result.outboundPrelude?.[1].text ?? "", "🛒 También tenemos compras de supermercado ya preparadas");
  assert(!result.outboundPrelude?.slice(1).some((entry) => (entry.text ?? "").includes("SUPER20-")));
  assertEquals(result.reply, "Selecciona una compra:");
  const publicMessages = [...(result.outboundPrelude ?? []).map((entry) => entry.text ?? ""), result.reply, result.interactiveList?.body ?? ""].join("\n");
  assertEquals(publicMessages.match(/Elige una opción para ver qué incluye:/g)?.length ?? 0, 0);
  assertEquals(result.interactiveList?.sections[0].rows.length, 4);
  const rows = result.interactiveList?.sections[0].rows ?? [];
  assert(rows.every((row) => /[🧺👨‍👩‍👧‍👦🏠🎟️]/u.test(row.title)));
  assertStringIncludes(rows[0].description ?? "", "$69 aprox.");
  assertStringIncludes(rows[1].description ?? "", "$169 aprox.");
  assertStringIncludes(rows[2].description ?? "", "$349 aprox.");
});

for (const [number, packageId, name, image, price] of [
  [5, "essential", "Compra Esencial", "/images/shop-essential.jpg", "$69"],
  [6, "family", "Compra Familiar", "/images/shop-family.jpg", "$169"],
  [7, "complete", "Compra Completa", "/images/shop-complete.jpg", "$349"],
] as const) {
  Deno.test(`${number}. ${name} muestra imagen, resumen corto y CTA de detalles`, () => {
    const result = selected(packageId);
    assertEquals(result.imageUrl, undefined);
    assertEquals(result.outboundPrelude?.[0], { imageUrl: image });
    assertStringIncludes(result.outboundPrelude?.[1].text ?? "", name);
    assertStringIncludes(result.outboundPrelude?.[1].text ?? "", price);
    if (packageId === "complete") {
      assertStringIncludes(result.outboundPrelude?.[1].text ?? "", "26 productos en total");
    }
    assert(!(result.outboundPrelude?.[1].text ?? "").includes("• "));
    assertStringIncludes(result.interactiveList?.sections[0].rows[0].title ?? "", "📋");
    assertStringIncludes(result.interactiveList?.sections[0].rows[1].title ?? "", "✅");
    assertStringIncludes(result.interactiveList?.sections[0].rows[2].title ?? "", "🔄");
    assertEquals(pantry(result).coupon_applied, undefined);
  });
}

Deno.test("7a. la lista completa se divide en tres categorías y termina con acciones", () => {
  const packageResult = selected("complete");
  const result = turn(state(packageResult), "Ver todo lo que incluye");
  assertEquals(result.outboundPrelude?.length, 3);
  assertStringIncludes(result.outboundPrelude?.[0].text ?? "", "🥫 *Despensa y básicos*");
  assertStringIncludes(result.outboundPrelude?.[0].text ?? "", "Arroz — 20 lb");
  assertStringIncludes(result.outboundPrelude?.[1].text ?? "", "🥩 *Proteínas y lácteos*");
  assertStringIncludes(result.outboundPrelude?.[1].text ?? "", "Pollo — 10 lb");
  assertStringIncludes(result.outboundPrelude?.[2].text ?? "", "🍎 *Frutas, vegetales y hogar*");
  assertStringIncludes(result.outboundPrelude?.[2].text ?? "", "Papel higiénico — 12 rollos");
  assertStringIncludes(result.outboundPrelude?.[2].text ?? "", "Los productos, marcas y presentaciones pueden variar según disponibilidad.");
  assertEquals(result.interactiveButtons?.map((button) => button.title), ["✅ La quiero", "🔄 Ver otra compra"]);
});

Deno.test("8. La quiero pide ZIP antes del nombre", () => {
  const result = atZip("essential");
  assertEquals(pantry(result).current_step, "zip_code");
  assertStringIncludes(result.reply, "código postal");
  assert(!result.reply.includes("¿A nombre de quién"));
});

Deno.test("9. ZIP inválido repite la pregunta sin guardar datos personales", () => {
  const result = turn(state(atZip()), "ABCDE");
  assertEquals(pantry(result).current_step, "zip_code");
  assertEquals(pantry(result).customer?.zip_code, null);
  assertStringIncludes(result.reply, "no parece válido");
});

Deno.test("10. ZIP disponible continúa al nombre y queda marcado", () => {
  const result = turn(state(atZip()), "07102-1234", undefined, AVAILABLE);
  assertEquals(pantry(result).customer?.zip_code, "07102-1234");
  assertEquals(pantry(result).delivery_coverage_status, "available");
  assertEquals(pantry(result).current_step, "name");
  assertStringIncludes(result.reply, "delivery disponible");
});

Deno.test("11. política por defecto deja ZIP válido en revisión manual", () => {
  const result = atName();
  assertEquals(pantry(result).delivery_coverage_status, "manual_review");
  assertEquals(pantry(result).current_step, "name");
  assertStringIncludes(result.reply, "Tu zona está pendiente de confirmación.");
  assertStringIncludes(result.reply, "Un representante verificará la disponibilidad");
});

Deno.test("12. ZIP fuera de cobertura no solicita datos personales", () => {
  const result = turn(state(atZip()), "99999", undefined, UNAVAILABLE);
  assertEquals(pantry(result).delivery_coverage_status, "unavailable");
  assertEquals(pantry(result).current_step, "coverage_unavailable");
  assertEquals(pantry(result).customer?.name, null);
  assertEquals(pantry(result).customer?.address, null);
  assert(!result.reply.includes("¿A nombre de quién"));
  assertEquals(result.interactiveButtons?.length, 3);
});

Deno.test("13. fuera de cobertura solo guarda preferencia de aviso", () => {
  const unavailable = turn(state(atZip()), "99999", undefined, UNAVAILABLE);
  const result = turn(state(unavailable), "Sí, avísenme");
  assertEquals(pantry(result).coverage_notification_requested, true);
  assertEquals(pantry(result).active, false);
  assertEquals(pantry(result).customer?.name, null);
  assertEquals(pantry(result).payment_method, null);
});

Deno.test("14. después de ZIP y nombre pide y guarda dirección", () => {
  const result = atAddress();
  assertEquals(pantry(result).customer?.name, "María Demo");
  assertEquals(pantry(result).customer?.zip_code, "07102");
  assertEquals(pantry(result).current_step, "address");
  assertStringIncludes(result.reply, "dirección completa");
});

Deno.test("15. después de dirección e instrucciones pide pago", () => {
  const result = atPayment();
  assertEquals(pantry(result).customer?.address, "123 Demo St, Newark, NJ 07102");
  assertEquals(pantry(result).current_step, "payment");
  assertStringIncludes(result.reply, "No compartas números de tarjeta");
});

Deno.test("16. resumen muestra precio completo, ZIP y cobertura sin descuento", () => {
  const result = turn(state(atPayment("complete")), "Efectivo al recibir");
  assertStringIncludes(result.reply, "Precio aproximado: $349");
  assertStringIncludes(result.reply, "Código postal: 07102");
  assertStringIncludes(result.reply, "Cobertura: Pendiente de confirmación");
  assert(!result.reply.includes("manual_review"));
  assert(!result.reply.includes("Cupón: -$20"));
  assert(!result.reply.includes("Total aproximado"));
});

Deno.test("17. confirmación registra solo una solicitud demo", () => {
  const summary = turn(state(atPayment()), "", "pantry:pay:card");
  const result = turn(state(summary), "", "pantry:confirm");
  assertEquals(pantry(result).request_confirmed, true);
  assert(pantry(result).confirmed_at);
  assertStringIncludes(result.reply, "Solicitud recibida");
  for (const forbidden of ["Orden confirmada", "Pago recibido", "Delivery confirmado", "Compra enviada"]) assert(!result.reply.includes(forbidden));
});

Deno.test("18. preferencia recurrente solo se guarda", () => {
  const confirmation = turn(state(turn(state(atPayment()), "", "pantry:pay:zelle")), "", "pantry:confirm");
  const interest = turn(state(confirmation), "", "pantry:recurring:yes");
  const result = turn(state(interest), "", "pantry:frequency:monthly");
  assertEquals(pantry(result).recurring_preference, { interested: true, frequency: "monthly" });
  assertStringIncludes(result.reply, "No activa órdenes, cobros ni entregas automáticas");
});

Deno.test("19. Solo quiero mi cupón cierra upsell y Ver compras lo reabre", () => {
  const first = started();
  const couponOnly = turn(state(first), "Solo quiero mi cupón");
  assertEquals(pantry(couponOnly).active, false);
  assertEquals(pantry(couponOnly).coupon?.code, pantry(first).coupon?.code);
  const reopened = turn(state(couponOnly), "Ver compras");
  assertEquals(pantry(reopened).active, true);
  assertEquals(pantry(reopened).coupon?.code, pantry(first).coupon?.code);
  assertEquals(reopened.interactiveList?.sections[0].rows.length, 4);
});

Deno.test("20. cancelar conserva cupón y no modifica coupon_applied legado", () => {
  const first = started();
  const legacy = state(first);
  const referral = ((legacy.collected as any).referral_hub as any);
  referral.pantry_demo.coupon_applied = true;
  const result = turn(legacy, "Cancelar");
  assertEquals(pantry(result).coupon?.code, pantry(first).coupon?.code);
  assertEquals(pantry(result).coupon_applied, true);
  assertEquals(pantry(result).active, false);
});

Deno.test("21. catálogo y router no contienen cálculo de descuento", async () => {
  const catalog = await Deno.readTextFile(new URL("../domain/referralHub/pantryDemoCatalog.ts", import.meta.url));
  const router = await Deno.readTextFile(new URL("../domain/referralHub/pantryDemoRouter.ts", import.meta.url));
  assert(!catalog.includes("discountedPantryTotal"));
  assert(!router.includes("Cupón: -$20"));
  assert(!router.includes("Total aproximado"));
});

Deno.test("22. outbox conserva deduplicación por mensaje entrante", async () => {
  const source = await Deno.readTextFile(new URL("../../meta-webhook/index.ts", import.meta.url));
  assertStringIncludes(source, "inbound_provider_message_id: providerMid");
  assertStringIncludes(source, 'enqueueStatus: "enqueued" | "duplicate_skip"');
  assertStringIncludes(source, 'code !== "23505"');
});

Deno.test("23. ningún valor interno de cobertura se muestra al cliente", () => {
  const results = [
    turn(state(atPayment()), "Efectivo al recibir").reply,
    turn(state(atZip()), "07102", undefined, AVAILABLE).reply,
    turn(state(atZip()), "99999", undefined, UNAVAILABLE).reply,
  ];
  for (const reply of results) {
    assert(!/\b(?:manual_review|available|unavailable)\b/.test(reply));
  }
});

Deno.test("24. run-replies espera cada preludio antes del mensaje interactivo", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const preludeLoop = source.indexOf("for (const prelude of generated.outboundPrelude ?? [])");
  const awaitedPreludeSend = source.indexOf("const preludeResp = await sendViaMetaAdapter", preludeLoop);
  const mainSend = source.indexOf("const metaResp = await sendViaMetaAdapter", awaitedPreludeSend);
  assert(preludeLoop >= 0);
  assert(awaitedPreludeSend > preludeLoop);
  assert(mainSend > awaitedPreludeSend);
});

Deno.test("25. meta adapter envía el texto como caption cuando hay imagen", async () => {
  const source = await Deno.readTextFile(new URL("../../_shared/metaMessageAdapter.ts", import.meta.url));
  assertStringIncludes(source, 'type: "image"');
  assertStringIncludes(source, '{ caption: String(args.text).trim().slice(0, 1024) }');
});
