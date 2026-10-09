/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PERIOD_LABELS, periodRange } from "./period.ts";

Deno.test("period: 'today' uses the organization business timezone, not browser-local midnight", () => {
  // At this instant Tegucigalpa is still September 3 while UTC is September 4.
  const { start, end } = periodRange("today", undefined, "America/Tegucigalpa", new Date("2026-09-04T03:00:00.000Z"));
  assertEquals(start.toISOString(), "2026-09-03T06:00:00.000Z");
  assertEquals(end.toISOString(), "2026-09-04T05:59:59.999Z");
});

Deno.test("period: 'all' starts far in the past and ends today - never silently narrower than an all-time card count", () => {
  const { start, end } = periodRange("all");
  const today = periodRange("today");
  assertEquals(start.getUTCFullYear() <= 2020, true);
  assertEquals(end.getTime(), today.end.getTime());
});

Deno.test("period: 'all' range strictly contains 'today'/'week'/'month' ranges", () => {
  const all = periodRange("all");
  for (const id of ["today", "week", "month"] as const) {
    const range = periodRange(id);
    assertEquals(all.start.getTime() <= range.start.getTime(), true);
    assertEquals(all.end.getTime() >= range.end.getTime(), true);
  }
});

Deno.test("PERIOD_LABELS has a human Spanish label for every PeriodId, including 'all'", () => {
  for (const id of ["today", "week", "month", "custom", "all"] as const) {
    assertEquals(typeof PERIOD_LABELS[id], "string");
    assertEquals(PERIOD_LABELS[id].length > 0, true);
  }
  assertEquals(PERIOD_LABELS.all, "Todo el tiempo");
});
