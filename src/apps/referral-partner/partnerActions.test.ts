/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildTelLink, buildWhatsAppLink, planPartnerActionSteps, resolveActionNote, resolvePartnerPhone } from "./partnerActions.ts";

Deno.test("buildWhatsAppLink strips formatting and keeps only digits", () => {
  assertEquals(buildWhatsAppLink("+1 (555) 123-4567"), "https://wa.me/15551234567");
});

Deno.test("buildWhatsAppLink returns null when there is no phone", () => {
  assertEquals(buildWhatsAppLink(null), null);
  assertEquals(buildWhatsAppLink(""), null);
});

Deno.test("buildTelLink keeps a leading plus for E.164 dialing", () => {
  assertEquals(buildTelLink("+1 (555) 123-4567"), "tel:+15551234567");
});

Deno.test("buildTelLink returns null when there is no phone", () => {
  assertEquals(buildTelLink(undefined), null);
});

Deno.test("resolvePartnerPhone prefers the lead phone over the WhatsApp identity", () => {
  assertEquals(resolvePartnerPhone("+15551234567", "15559876543"), "+15551234567");
});

Deno.test("resolvePartnerPhone falls back to channel_user_id when phone is missing", () => {
  assertEquals(resolvePartnerPhone(null, "15559876543"), "15559876543");
  assertEquals(resolvePartnerPhone(null, null), null);
});

Deno.test("planPartnerActionSteps inserts an accept step before contacted when still only assigned", () => {
  assertEquals(planPartnerActionSteps("contacted", "assigned"), ["accept", "contacted"]);
});

Deno.test("planPartnerActionSteps inserts an accept step before no_answer when still only assigned", () => {
  assertEquals(planPartnerActionSteps("no_answer", "assigned"), ["accept", "no_answer"]);
});

Deno.test("planPartnerActionSteps skips the accept step once already accepted", () => {
  assertEquals(planPartnerActionSteps("contacted", "accepted"), ["contacted"]);
  assertEquals(planPartnerActionSteps("no_answer", "accepted"), ["no_answer"]);
});

Deno.test("planPartnerActionSteps maps pending to the note RPC action and never requires acceptance first", () => {
  assertEquals(planPartnerActionSteps("pending", "assigned"), ["note"]);
  assertEquals(planPartnerActionSteps("pending", "accepted"), ["note"]);
});

Deno.test("resolveActionNote uses the partner's free text when provided", () => {
  assertEquals(resolveActionNote("contacted", "  Llamé y quedamos en vernos  "), "Llamé y quedamos en vernos");
});

Deno.test("resolveActionNote is null for contacted/no_answer when the partner left no note", () => {
  assertEquals(resolveActionNote("contacted", ""), null);
  assertEquals(resolveActionNote("no_answer", null), null);
});

Deno.test("resolveActionNote falls back to a fixed label for pending when blank", () => {
  assertEquals(resolveActionNote("pending", ""), "Marcado como pendiente por el aliado");
  assertEquals(resolveActionNote("pending", "  "), "Marcado como pendiente por el aliado");
});
