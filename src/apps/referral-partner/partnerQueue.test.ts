/// <reference lib="deno.ns" />
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  combineCustomDateTime,
  computeNextFollowupAt,
  countOverdueFollowUps,
  defaultReminderOptionForReason,
  followUpReasonsForService,
  formatCustomFollowUpPreview,
  formatFollowUpMoment,
  isCustomFollowUpReady,
  isFollowUpOverdue,
  nowTimeInputValue,
  reminderOptionsForReason,
  resolvePartnerQueueStatus,
  sortPartnerQueue,
  todayDateInputValue,
  type QueueItem,
} from "./partnerQueue.ts";

function item(overrides: Partial<QueueItem> & Pick<QueueItem, "id">): QueueItem {
  return {
    status: "accepted",
    workStatus: "new",
    assignedAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    nextFollowupAt: null,
    ...overrides,
  };
}

// --- state mapping ---------------------------------------------------------

Deno.test("resolvePartnerQueueStatus maps the literal work_status='follow_up' to the Seguimiento bucket", () => {
  assertEquals(resolvePartnerQueueStatus({ status: "accepted", workStatus: "follow_up" }), "follow_up");
});

Deno.test("resolvePartnerQueueStatus keeps mapping the old contacted/appointment_scheduled/in_progress values to Seguimiento for backward compatibility", () => {
  assertEquals(resolvePartnerQueueStatus({ status: "accepted", workStatus: "contacted" }), "follow_up");
  assertEquals(resolvePartnerQueueStatus({ status: "accepted", workStatus: "appointment_scheduled" }), "follow_up");
  assertEquals(resolvePartnerQueueStatus({ status: "accepted", workStatus: "in_progress" }), "follow_up");
});

Deno.test("resolvePartnerQueueStatus maps converted to approved (Aprobado) — label/rename untouched", () => {
  assertEquals(resolvePartnerQueueStatus({ status: "accepted", workStatus: "converted" }), "approved");
});

Deno.test("resolvePartnerQueueStatus maps not_converted, and a rejected assignment status, to disqualified (No calificó)", () => {
  assertEquals(resolvePartnerQueueStatus({ status: "accepted", workStatus: "not_converted" }), "disqualified");
  assertEquals(resolvePartnerQueueStatus({ status: "rejected", workStatus: "new" }), "disqualified");
});

Deno.test("resolvePartnerQueueStatus falls back to new for anything else", () => {
  assertEquals(resolvePartnerQueueStatus({ status: "assigned", workStatus: "new" }), "new");
});

// --- follow-up reason configuration by service ------------------------------

Deno.test("followUpReasonsForService gives auto_accident its own missing_police_report reason", () => {
  const ids = followUpReasonsForService("auto_accident").map((r) => r.id);
  assertEquals(ids, ["no_answer", "missing_police_report", "missing_information", "other"]);
});

Deno.test("followUpReasonsForService gives immigration/dui/criminal missing_document instead", () => {
  for (const service of ["immigration", "dui", "criminal"] as const) {
    const ids = followUpReasonsForService(service).map((r) => r.id);
    assertEquals(ids, ["no_answer", "missing_document", "missing_information", "other"]);
  }
});

// --- reminder options / defaults --------------------------------------------

Deno.test("no_answer defaults to 30 min and offers 30m/1h/2h/tomorrow/custom", () => {
  assertEquals(defaultReminderOptionForReason("no_answer"), "30m");
  assertEquals(reminderOptionsForReason("no_answer").map((o) => o.id), ["30m", "1h", "2h", "tomorrow", "custom"]);
});

Deno.test("missing_police_report defaults to no reminder and offers none/tomorrow/3d/7d/custom", () => {
  assertEquals(defaultReminderOptionForReason("missing_police_report"), "none");
  assertEquals(reminderOptionsForReason("missing_police_report").map((o) => o.id), ["none", "tomorrow", "3d", "7d", "custom"]);
  assertEquals(computeNextFollowupAt("none"), null);
});

Deno.test("missing_document/missing_information offer 30m/1h/tomorrow/custom", () => {
  for (const reason of ["missing_document", "missing_information"] as const) {
    assertEquals(reminderOptionsForReason(reason).map((o) => o.id), ["30m", "1h", "tomorrow", "custom"]);
  }
});

Deno.test("other defaults to no reminder and only offers custom otherwise", () => {
  assertEquals(defaultReminderOptionForReason("other"), "none");
  assertEquals(reminderOptionsForReason("other").map((o) => o.id), ["none", "custom"]);
});

// --- next-followup timestamp computation + human preview --------------------

Deno.test("computeNextFollowupAt('30m') is exactly 30 minutes after now", () => {
  const now = new Date("2026-09-02T22:00:00.000Z");
  assertEquals(computeNextFollowupAt("30m", now), "2026-09-02T22:30:00.000Z");
});

Deno.test("computeNextFollowupAt('custom') uses the caller-supplied date, and falls back to null (no reminder) without one", () => {
  const custom = new Date("2026-09-10T15:00:00.000Z");
  assertEquals(computeNextFollowupAt("custom", new Date(), custom), custom.toISOString());
  assertEquals(computeNextFollowupAt("custom", new Date(), null), null);
});

Deno.test("formatFollowUpMoment reads 'Hoy, <time>' for a same-day moment and 'Sin recordatorio' for null", () => {
  const now = new Date(2026, 8, 2, 22, 0, 0);
  const soon = new Date(2026, 8, 2, 22, 53, 0);
  assert(formatFollowUpMoment(soon.toISOString(), now).startsWith("Hoy,"));
  assertEquals(formatFollowUpMoment(null, now), "Sin recordatorio");
});

Deno.test("formatFollowUpMoment reads 'Mañana, <time>' for tomorrow's computed reminder", () => {
  const now = new Date(2026, 8, 2, 23, 47, 0);
  const tomorrowIso = computeNextFollowupAt("tomorrow", now);
  assert(formatFollowUpMoment(tomorrowIso, now).startsWith("Mañana,"));
});

// --- overdue detection / ordering / counter ---------------------------------

Deno.test("isFollowUpOverdue is true only for a follow_up item whose next_followup_at has passed", () => {
  const now = new Date("2026-09-02T22:00:00.000Z");
  assert(isFollowUpOverdue(item({ id: "a", workStatus: "follow_up", nextFollowupAt: "2026-09-02T21:00:00.000Z" }), now));
  assertEquals(isFollowUpOverdue(item({ id: "b", workStatus: "follow_up", nextFollowupAt: "2026-09-02T23:00:00.000Z" }), now), false);
  // Not follow_up at all → never overdue, regardless of the timestamp.
  assertEquals(isFollowUpOverdue(item({ id: "c", workStatus: "new", nextFollowupAt: "2026-09-01T00:00:00.000Z" }), now), false);
  // No reminder set → never overdue.
  assertEquals(isFollowUpOverdue(item({ id: "d", workStatus: "follow_up", nextFollowupAt: null }), now), false);
});

Deno.test("sortPartnerQueue puts overdue follow-ups at the very top of the queue, ahead of 'new'", () => {
  const now = new Date("2026-09-02T22:00:00.000Z");
  const items = [
    item({ id: "new-1", workStatus: "new", assignedAt: "2026-09-01T00:00:00Z" }),
    item({ id: "followup-not-due", workStatus: "follow_up", nextFollowupAt: "2026-09-03T00:00:00Z" }),
    item({ id: "overdue", workStatus: "follow_up", nextFollowupAt: "2026-09-02T20:00:00Z" }),
  ];
  const sorted = sortPartnerQueue(items, now);
  assertEquals(sorted[0].id, "overdue");
});

Deno.test("sortPartnerQueue never collapses two separate assignments — e.g. two different case cycles for the same lead stay as two distinct entries", () => {
  const items = [
    item({ id: "assignment-cycle-1", workStatus: "not_converted", assignedAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-05T00:00:00Z" }),
    item({ id: "assignment-cycle-2", workStatus: "new", assignedAt: "2026-09-01T00:00:00Z" }),
  ];
  const sorted = sortPartnerQueue(items);
  assertEquals(sorted.map((entry) => entry.id).sort(), ["assignment-cycle-1", "assignment-cycle-2"]);
});

Deno.test("countOverdueFollowUps counts only items that are actually due", () => {
  const now = new Date("2026-09-02T22:00:00.000Z");
  const items = [
    item({ id: "a", workStatus: "follow_up", nextFollowupAt: "2026-09-02T21:00:00Z" }),
    item({ id: "b", workStatus: "follow_up", nextFollowupAt: "2026-09-05T00:00:00Z" }),
    item({ id: "c", workStatus: "new" }),
    item({ id: "d", workStatus: "follow_up", nextFollowupAt: "2026-09-01T00:00:00Z" }),
  ];
  assertEquals(countOverdueFollowUps(items, now), 2);
});

// --- Personalizado: separate Fecha/Hora controls ----------------------------

Deno.test("combineCustomDateTime returns null when either half is missing or malformed — never a fabricated timestamp", () => {
  assertEquals(combineCustomDateTime("", ""), null);
  assertEquals(combineCustomDateTime("2026-09-03", ""), null);
  assertEquals(combineCustomDateTime("", "22:30"), null);
  assertEquals(combineCustomDateTime("not-a-date", "22:30"), null);
});

Deno.test("combineCustomDateTime builds the exact local moment from separate date and time inputs", () => {
  const combined = combineCustomDateTime("2026-09-03", "22:30");
  assert(combined);
  assertEquals(
    [combined.getFullYear(), combined.getMonth(), combined.getDate(), combined.getHours(), combined.getMinutes()],
    [2026, 8, 3, 22, 30],
  );
});

Deno.test("isCustomFollowUpReady is false while incomplete, and false for a moment that has already passed", () => {
  const now = new Date("2026-09-02T22:00:00.000Z");
  assertEquals(isCustomFollowUpReady(null, now), false);
  assertEquals(isCustomFollowUpReady(new Date("2026-09-02T21:00:00.000Z"), now), false);
  assertEquals(isCustomFollowUpReady(new Date("2026-09-02T23:00:00.000Z"), now), true);
});

Deno.test("formatCustomFollowUpPreview reads as an absolute date · time, never a relative 'Hoy,'/'Mañana,' label", () => {
  const preview = formatCustomFollowUpPreview(new Date(2026, 8, 3, 22, 30));
  assert(preview.includes("3"));
  assert(preview.includes("2026"));
  assert(preview.includes("10:30"));
  assert(preview.includes(" · "));
  assert(!preview.startsWith("Hoy"));
  assert(!preview.startsWith("Mañana"));
});

Deno.test("todayDateInputValue/nowTimeInputValue produce the exact <input> min values for a given instant", () => {
  const now = new Date(2026, 8, 3, 9, 5);
  assertEquals(todayDateInputValue(now), "2026-09-03");
  assertEquals(nowTimeInputValue(now), "09:05");
});

Deno.test("a valid Personalizado selection produces the exact absolute ISO timestamp through the same computeNextFollowupAt path save uses", () => {
  const combined = combineCustomDateTime("2026-09-10", "15:00");
  assert(combined);
  assertEquals(computeNextFollowupAt("custom", new Date(), combined), combined.toISOString());
});
