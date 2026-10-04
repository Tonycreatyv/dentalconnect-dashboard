/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  adminOperationalQueueCounts,
  filterAdminOperationalQueue,
  isAdminExceptionOpportunity,
  isAdminTodayOpportunity,
  isAdminUnassignedOpportunity,
  sortAdminOperationalQueue,
  type AdminQueueOpportunity,
} from "./adminOperationalQueue.ts";

function item(overrides: Partial<AdminQueueOpportunity> & Pick<AdminQueueOpportunity, "id">): AdminQueueOpportunity {
  return {
    createdAt: "2026-10-04T12:00:00Z",
    intakeComplete: true,
    consentStatus: "authorized",
    operationalStatus: "Pendiente de seguimiento",
    lastActivityAt: "2026-10-04T12:00:00Z",
    assignment: {
      status: "accepted",
      workStatus: "follow_up",
      assignedAt: "2026-10-04T12:00:00Z",
      updatedAt: "2026-10-04T12:00:00Z",
      partnerName: "Clínica Pastor",
      nextFollowupAt: null,
      followUpReason: null,
    },
    ...overrides,
  };
}

Deno.test("Sin responsable includes authorized active cases without an assignment", () => {
  const opportunity = item({ id: "a", assignment: null });
  assertEquals(isAdminUnassignedOpportunity(opportunity), true);
  assertEquals(isAdminTodayOpportunity(opportunity, new Date("2026-10-04T14:00:00Z")), true);
});

Deno.test("Excepciones captures blocked intake/consent states but excludes ordinary unassigned authorized work", () => {
  assertEquals(isAdminExceptionOpportunity(item({ id: "incomplete", intakeComplete: false })), true);
  assertEquals(isAdminExceptionOpportunity(item({ id: "declined", consentStatus: "declined" })), true);
  assertEquals(isAdminExceptionOpportunity(item({ id: "pending", assignment: null, consentStatus: "pending_review" })), true);
  assertEquals(isAdminExceptionOpportunity(item({ id: "unassigned", assignment: null, consentStatus: "authorized" })), false);
});

Deno.test("Hoy includes new assignments and due follow-ups, not future follow-ups", () => {
  const now = new Date("2026-10-04T14:00:00Z");
  const newAssignment = item({ id: "new", assignment: { status: "assigned", workStatus: "new", assignedAt: "2026-10-04T13:00:00Z", updatedAt: "2026-10-04T13:00:00Z", partnerName: "Pastor", nextFollowupAt: null } });
  const due = item({ id: "due", assignment: { status: "accepted", workStatus: "follow_up", assignedAt: "2026-10-02T13:00:00Z", updatedAt: "2026-10-03T13:00:00Z", partnerName: "Pastor", nextFollowupAt: "2026-10-04T18:00:00Z" } });
  const future = item({ id: "future", assignment: { status: "accepted", workStatus: "follow_up", assignedAt: "2026-10-02T13:00:00Z", updatedAt: "2026-10-03T13:00:00Z", partnerName: "Pastor", nextFollowupAt: "2026-10-05T18:00:00Z" } });
  assertEquals(filterAdminOperationalQueue([newAssignment, due, future], "today", now).map((row) => row.id), ["new", "due"]);
});

Deno.test("Todos activos excludes final outcomes and queue counts stay independent", () => {
  const now = new Date("2026-10-04T14:00:00Z");
  const unassigned = item({ id: "unassigned", assignment: null });
  const exception = item({ id: "exception", assignment: null, consentStatus: "pending_review" });
  const active = item({ id: "active", assignment: { status: "accepted", workStatus: "follow_up", assignedAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", partnerName: "Pastor", nextFollowupAt: "2026-10-05T12:00:00Z" } });
  const closed = item({ id: "closed", operationalStatus: "Convertido", assignment: { status: "accepted", workStatus: "converted", assignedAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-04T12:00:00Z", partnerName: "Pastor" } });
  assertEquals(adminOperationalQueueCounts([unassigned, exception, active, closed], now), { today: 1, unassigned: 1, exceptions: 1, active: 3 });
});

Deno.test("Today sorting prioritizes unassigned, then new assignment, then due follow-up", () => {
  const now = new Date("2026-10-04T14:00:00Z");
  const rows = [
    item({ id: "due", assignment: { status: "accepted", workStatus: "follow_up", assignedAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-03T12:00:00Z", partnerName: "Pastor", nextFollowupAt: "2026-10-04T15:00:00Z" } }),
    item({ id: "new", createdAt: "2026-10-04T13:00:00Z", assignment: { status: "assigned", workStatus: "new", assignedAt: "2026-10-04T13:00:00Z", updatedAt: "2026-10-04T13:00:00Z", partnerName: "Pastor" } }),
    item({ id: "unassigned", createdAt: "2026-10-04T13:30:00Z", assignment: null }),
  ];
  assertEquals(sortAdminOperationalQueue(rows, now).map((row) => row.id), ["unassigned", "new", "due"]);
});
