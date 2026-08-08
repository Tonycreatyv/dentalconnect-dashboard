import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { interpretAccidentDate } from "../domain/referralHub/fieldInterpreter.ts";

Deno.test("relative accident date uses organization timezone and stores ISO", () => {
  const result = interpretAccidentDate("ayer", "America/New_York", new Date("2026-07-26T16:00:00Z"));
  assertEquals(result.normalizedValue, "2026-07-25");
  assertEquals(result.needsConfirmation, false);
});

Deno.test("ambiguous weekday date requires confirmation", () => {
  const result = interpretAccidentDate("viernes", "America/New_York", new Date("2026-07-26T16:00:00Z"));
  assertEquals(result.normalizedValue, "2026-07-24");
  assertEquals(result.needsConfirmation, true);
});
