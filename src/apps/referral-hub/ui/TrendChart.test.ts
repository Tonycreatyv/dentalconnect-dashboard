/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { labeledIndices } from "./trendChartLabels.ts";

Deno.test("day/week buckets (<=7 points) label every bar - already readable at 390px", () => {
  assertEquals(labeledIndices(1).size, 1);
  assertEquals(labeledIndices(7).size, 7);
  assertEquals([...labeledIndices(7)].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
});

Deno.test("month buckets (~30 points) never exceed 6 readable labels", () => {
  const indices = labeledIndices(31);
  assertEquals(indices.size <= 6, true);
  // first and last bar always get a label so the range stays legible
  assertEquals(indices.has(0), true);
  assertEquals(indices.has(30), true);
});

Deno.test("labeled indices are always a valid, in-range, deduplicated subset", () => {
  for (const count of [8, 10, 15, 28, 31, 60]) {
    const indices = labeledIndices(count);
    for (const index of indices) {
      assertEquals(index >= 0 && index < count, true);
    }
    assertEquals(indices.size <= 6, true);
  }
});
