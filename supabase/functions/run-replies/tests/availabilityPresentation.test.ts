import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  selectPatientFriendlySlots,
  type AvailableSlot,
} from "../domain/availability.ts";

Deno.test("general availability returns varied slots when possible", () => {
  const slots: AvailableSlot[] = [
    { date: "2026-05-06", dayLabel: "Mié 6 may", time: "08:30" },
    { date: "2026-05-06", dayLabel: "Mié 6 may", time: "09:00" },
    { date: "2026-05-07", dayLabel: "Jue 7 may", time: "14:00" },
    { date: "2026-05-08", dayLabel: "Vie 8 may", time: "15:00" },
  ];
  const picks = selectPatientFriendlySlots({ slots, mode: "general", maxOptions: 3 }).slots;
  assertEquals(picks.length, 3);
  assert(picks.some((s) => s.time === "08:30"));
  assert(picks.some((s) => s.time === "14:00"));
  assert(picks.some((s) => s.time === "15:00"));
});

Deno.test("adjacent slots are avoided for general availability", () => {
  const slots: AvailableSlot[] = [
    { date: "2026-05-06", dayLabel: "Mié 6 may", time: "08:00" },
    { date: "2026-05-06", dayLabel: "Mié 6 may", time: "08:30" },
    { date: "2026-05-07", dayLabel: "Jue 7 may", time: "14:00" },
    { date: "2026-05-08", dayLabel: "Vie 8 may", time: "15:00" },
  ];
  const picks = selectPatientFriendlySlots({ slots, mode: "general", maxOptions: 3 }).slots;
  const has800 = picks.some((s) => s.time === "08:00");
  const has830 = picks.some((s) => s.time === "08:30");
  assert(!(has800 && has830));
});

Deno.test("general availability prefers different dates when available", () => {
  const slots: AvailableSlot[] = [
    { date: "2026-05-06", dayLabel: "Mié 6 may", time: "08:00" },
    { date: "2026-05-06", dayLabel: "Mié 6 may", time: "09:30" },
    { date: "2026-05-07", dayLabel: "Jue 7 may", time: "14:00" },
    { date: "2026-05-08", dayLabel: "Vie 8 may", time: "15:00" },
  ];
  const picks = selectPatientFriendlySlots({ slots, mode: "general", maxOptions: 3 }).slots;
  assertEquals(new Set(picks.map((s) => s.date)).size >= 2, true);
});

Deno.test("general availability same-day only is sorted ascending", () => {
  const slots: AvailableSlot[] = [
    { date: "2026-05-06", dayLabel: "Mié 6 may", time: "12:00" },
    { date: "2026-05-06", dayLabel: "Mié 6 may", time: "08:00" },
    { date: "2026-05-06", dayLabel: "Mié 6 may", time: "09:30" },
  ];
  const picks = selectPatientFriendlySlots({ slots, mode: "general", maxOptions: 3 }).slots;
  assertEquals(picks.map((s) => s.time), ["08:00", "09:30", "12:00"]);
});

Deno.test("requested Saturday keeps Saturday in day-specific response", () => {
  const slots: AvailableSlot[] = [
    { date: "2026-05-09", dayLabel: "Sáb 9 may", time: "08:00" },
    { date: "2026-05-09", dayLabel: "Sáb 9 may", time: "10:30" },
    { date: "2026-05-09", dayLabel: "Sáb 9 may", time: "12:00" },
  ];
  const picks = selectPatientFriendlySlots({
    slots,
    mode: "specific_day",
    requestedDate: "2026-05-09",
    maxOptions: 3,
  }).slots;
  assertEquals(new Set(picks.map((s) => s.date)).size, 1);
  assertEquals(picks.length, 3);
});

Deno.test("adjacent slots are allowed/summarized when specific day has only adjacent morning slots", () => {
  const slots: AvailableSlot[] = [
    { date: "2026-05-09", dayLabel: "Sáb 9 may", time: "08:00" },
    { date: "2026-05-09", dayLabel: "Sáb 9 may", time: "08:30" },
    { date: "2026-05-09", dayLabel: "Sáb 9 may", time: "09:00" },
  ];
  const selection = selectPatientFriendlySlots({
    slots,
    mode: "specific_day",
    requestedDate: "2026-05-09",
    maxOptions: 3,
  });
  assert(selection.summarizeAdjacentRange);
  assertEquals(selection.slots.length, 3);
});

Deno.test("specific day picks remain on same day", () => {
  const slots: AvailableSlot[] = [
    { date: "2026-05-09", dayLabel: "Sáb 9 may", time: "08:00" },
    { date: "2026-05-09", dayLabel: "Sáb 9 may", time: "08:30" },
    { date: "2026-05-09", dayLabel: "Sáb 9 may", time: "10:30" },
    { date: "2026-05-09", dayLabel: "Sáb 9 may", time: "12:00" },
  ];
  const picks = selectPatientFriendlySlots({
    slots,
    mode: "specific_day",
    requestedDate: "2026-05-09",
    maxOptions: 3,
  }).slots;
  assertEquals(new Set(picks.map((s) => s.date)).size, 1);
});
