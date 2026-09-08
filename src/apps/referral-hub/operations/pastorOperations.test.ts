/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { countOperationalWorkStatuses, operationalStatusLabel } from "./pastorOperations.ts";

Deno.test("operational service counts use assignment work status", () => {
  assertEquals(countOperationalWorkStatuses(["new", "follow_up", "converted", "not_converted"]), { new: 1, followUp: 1, approved: 1, disqualified: 1 });
});

Deno.test("legacy active work states remain follow-up work", () => {
  assertEquals(countOperationalWorkStatuses(["contacted", "appointment_scheduled", "in_progress"]), { new: 0, followUp: 3, approved: 0, disqualified: 0 });
});

// The Servicios workspace list renders operationalStatusLabel() per row —
// it must classify every raw work_status identically to how
// countOperationalWorkStatuses buckets the same values for the aggregate
// counts, so a row's badge can never disagree with the count it belongs to.
Deno.test("operationalStatusLabel matches the Nuevo/Seguimiento/Aprobado/No calificó target vocabulary", () => {
  assertEquals(operationalStatusLabel(null), "Nuevo");
  assertEquals(operationalStatusLabel(undefined), "Nuevo");
  assertEquals(operationalStatusLabel("new"), "Nuevo");
  assertEquals(operationalStatusLabel("follow_up"), "Seguimiento");
  assertEquals(operationalStatusLabel("contacted"), "Seguimiento");
  assertEquals(operationalStatusLabel("appointment_scheduled"), "Seguimiento");
  assertEquals(operationalStatusLabel("in_progress"), "Seguimiento");
  assertEquals(operationalStatusLabel("converted"), "Aprobado");
  assertEquals(operationalStatusLabel("not_converted"), "No calificó");
});
