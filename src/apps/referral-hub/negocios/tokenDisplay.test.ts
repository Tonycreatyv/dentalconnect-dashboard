/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { insertTokenAtCursor, toDisplayText, toStoredText, TOKEN_CHIPS } from "./tokenDisplay.ts";
import { renderCouponMessage } from "../operations/couponMessageTemplate.ts";

Deno.test("toDisplayText/toStoredText round-trip every real chip without loss", () => {
  const stored = "Hola {{customer_first_name}}, tu {{benefit_name}} en {{business_name}} ({{address}}). Código: {{claim_code}}";
  const display = toDisplayText(stored);
  for (const chip of TOKEN_CHIPS) {
    assertEquals(display.includes(`{{${chip.placeholder}}}`), false, `${chip.placeholder} should not remain in braces in the display text`);
  }
  assertEquals(toStoredText(display), stored);
});

Deno.test("insertTokenAtCursor inserts a readable bracket token at the exact cursor position", () => {
  const chip = TOKEN_CHIPS.find((c) => c.id === "business_name")!;
  const result = insertTokenAtCursor({ value: "Hola , bienvenido", selectionStart: 5, selectionEnd: 5, chip });
  assertEquals(result.value, "Hola [Negocio], bienvenido");
  assertEquals(result.cursor, 5 + "[Negocio]".length);
});

Deno.test("insertTokenAtCursor replaces a selection rather than just inserting", () => {
  const chip = TOKEN_CHIPS.find((c) => c.id === "claim_code")!;
  const result = insertTokenAtCursor({ value: "Código: XXXX", selectionStart: 8, selectionEnd: 12, chip });
  assertEquals(result.value, "Código: [Código]");
});

Deno.test("a display-authored template with every chip renders through the real renderer with no unresolved braces", () => {
  const display = "Hola [Nombre del cliente], tu [Beneficio] en [Negocio] ([Dirección]). Código: [Código]";
  const stored = toStoredText(display);
  const rendered = renderCouponMessage(stored, {
    customer_first_name: "Diana",
    benefit_name: "20% de descuento",
    business_name: "Médico Urgencias",
    address: "2291 Browns Bridge Rd",
    claim_code: "LG-9F3A",
  });
  assertEquals(rendered.includes("{{"), false);
  assertEquals(rendered.includes("}}"), false);
  assertEquals(rendered, "Hola Diana, tu 20% de descuento en Médico Urgencias (2291 Browns Bridge Rd). Código: LG-9F3A");
});

Deno.test("never requires the operator to type braces: every starter template is brace-free", async () => {
  const { STARTER_TEMPLATES } = await import("./tokenDisplay.ts");
  for (const starter of STARTER_TEMPLATES) {
    assertEquals(starter.displayText.includes("{{"), false, `${starter.id} should contain no raw placeholder syntax`);
  }
});
