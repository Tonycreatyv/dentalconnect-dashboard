/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PERIOD_LABELS, periodRange } from "./period.ts";

Deno.test("period: 'today' spans only the current calendar day", () => {
  const { start, end } = periodRange("today");
  assertEquals(start.getHours(), 0);
  assertEquals(end.getHours(), 23);
  assertEquals(start.toDateString(), end.toDateString());
});

Deno.test("period: 'all' starts far in the past and ends today - never silently narrower than an all-time card count", () => {
  const { start, end } = periodRange("all");
  const now = new Date();
  assertEquals(start.getUTCFullYear() <= 2020, true);
  assertEquals(end.toDateString(), now.toDateString());
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
