/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { immigrationInboxTotals, immigrationReadinessLabel, normalizeImmigrationConsent, type ImmigrationInboxRow } from "./immigrationInbox.ts";

const row: ImmigrationInboxRow = {
  id: "request-1", leadId: "lead-1", leadName: "Ana", channelUserId: "wa-1",
  topic: "GREEN_CARD", description: "Necesito ayuda", postalCode: "30345",
  consentStatus: "authorized", consentVersion: "luis_immigration_sharing_v1",
  consentCapturedAt: "2026-08-31T12:00:00Z", intakeComplete: true,
  status: "prequalified", caseCycle: 1, createdAt: "2026-08-31T12:00:00Z",
};

Deno.test("Immigration inbox exposes consent and readiness without assignment semantics", () => {
  assertEquals(normalizeImmigrationConsent({ status: "authorized" }), "authorized");
  assertEquals(normalizeImmigrationConsent({ status: "unexpected" }), "pending_review");
  assertEquals(immigrationReadinessLabel(row), "Listo para revisión interna");
  assertEquals(immigrationReadinessLabel({ ...row, consentStatus: "declined" }), "Consentimiento rechazado");
  assertEquals(immigrationInboxTotals([row, { ...row, id: "request-2", consentStatus: "declined" }]), {
    total: 2, authorized: 1, declined: 1, pending: 0, ready: 1,
  });
});
