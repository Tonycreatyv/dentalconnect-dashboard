/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

// referral_assignments RLS deliberately OR's two SELECT policies together —
// referral_assignments_partner_read (partner membership) and
// referral_assignments_member_read (org owner/admin, for Admin's own
// organization-wide views). Partner Portal must not rely on RLS alone to
// scope itself to one partner, or an org owner who is also a partner member
// would see every partner's assignments merged in this UI. These tests read
// the component source directly (this repo's established pattern for
// verifying scoping logic without mocking the Supabase client — see
// src/apps/referral-hub/operations/security.test.ts) rather than mocking
// network calls.
const dashboardSource = await Deno.readTextFile(new URL("./PartnerDashboard.tsx", import.meta.url));

Deno.test("Partner Portal's assignment query is explicitly scoped by partner_id, not left to RLS alone", () => {
  assertStringIncludes(dashboardSource, 'function usePartnerReferrals(partnerId: string)');
  assertStringIncludes(dashboardSource, '.eq("partner_id", partnerId)');
  // The .eq must sit inside the same query chain as the assignments select,
  // not some unrelated call — confirm both appear within one short window.
  const selectIndex = dashboardSource.indexOf('from("referral_assignments")');
  const eqIndex = dashboardSource.indexOf('.eq("partner_id", partnerId)');
  assertEquals(selectIndex > -1 && eqIndex > -1, true);
  assertEquals(eqIndex - selectIndex > 0 && eqIndex - selectIndex < 400, true);
});

Deno.test("partner context is resolved from the caller's own active memberships, not a service-role or admin path", () => {
  assertStringIncludes(dashboardSource, 'function useActivePartnerMembership()');
  assertStringIncludes(dashboardSource, 'from("referral_partner_memberships")');
  assertStringIncludes(dashboardSource, '.eq("active", true)');
  assertEquals(/service_role/i.test(dashboardSource), false);
  assertEquals(/SUPABASE_SERVICE_ROLE/i.test(dashboardSource), false);
});

Deno.test("zero or multiple active memberships fail closed — Routes (and therefore PartnerList/PartnerDetail) only render for a single resolved partner", () => {
  assertStringIncludes(dashboardSource, 'membership.context.kind === "none"');
  assertStringIncludes(dashboardSource, 'membership.context.kind === "multiple"');
  // The Routes block (the only place PartnerList/PartnerDetail are rendered)
  // must be the fallback branch, gated behind both fail-closed checks above —
  // not a sibling that could render regardless of membership.context.kind.
  const noneIndex = dashboardSource.indexOf('membership.context.kind === "none"');
  const multipleIndex = dashboardSource.indexOf('membership.context.kind === "multiple"');
  const routesIndex = dashboardSource.indexOf("<Routes>");
  assertEquals(noneIndex > -1 && multipleIndex > noneIndex && routesIndex > multipleIndex, true);
});

Deno.test("resolved partnerId is threaded into both PartnerList and PartnerDetail — no route renders without it", () => {
  assertStringIncludes(dashboardSource, "<PartnerList partnerId={membership.context.partnerId} />");
  assertStringIncludes(dashboardSource, "<PartnerDetail partnerId={membership.context.partnerId} />");
  assertStringIncludes(dashboardSource, "function PartnerList({ partnerId }: { partnerId: string })");
  assertStringIncludes(dashboardSource, "function PartnerDetail({ partnerId }: { partnerId: string })");
});

Deno.test("the Partner mutation path (partner_update_immigration_assignment) is untouched by this release", () => {
  assertStringIncludes(dashboardSource, 'supabase.rpc("partner_update_immigration_assignment"');
  assertStringIncludes(dashboardSource, 'p_action: "correct_result"');
  assertStringIncludes(dashboardSource, 'p_correction_reason: correctionReason');
  // Exactly the pre-existing three call sites — no fourth call was added and
  // none were removed.
  const rpcCallCount = dashboardSource.split('supabase.rpc("partner_update_immigration_assignment"').length - 1;
  assertEquals(rpcCallCount, 3);
});

Deno.test("'Recibido' still reads assignment.assigned_at, now with the local time alongside the date", () => {
  assertStringIncludes(dashboardSource, "<dt>Recibido</dt><dd>{formatDateTime(opportunity.assignment!.assignedAt)}</dd>");
  assertStringIncludes(dashboardSource, "presentation.incidentDateFact ? <div><dt>{presentation.incidentDateFact.label}</dt><dd>{presentation.incidentDateFact.value}</dd></div> : null");
  // formatDateTime composes the existing date formatter with a time part —
  // no new/duplicate date-formatting logic, no timezone argument added.
  assertStringIncludes(dashboardSource, "function formatDateTime(value: string | null | undefined): string {");
  assertStringIncludes(dashboardSource, "return `${formatDate(value)} · ${time}`;");
  assertEquals(/timeZone/.test(dashboardSource), false);
});

Deno.test("the detail view's 'Información compartida' uses a separate summary that omits the incident date once the explicit fact is shown; the list card keeps its compact date", () => {
  assertStringIncludes(dashboardSource, "sharedInfoSummary: buildIntakeSummary(intake, topicKey, { omitIncidentDate: Boolean(incidentDateFact) })");
  assertStringIncludes(dashboardSource, "<h2>Información compartida</h2><p className=\"partner-context-text\">{presentation.sharedInfoSummary}</p>");
  // The list card (ReferralCard) still reads presentation.summary, unchanged.
  assertStringIncludes(dashboardSource, "summary: buildIntakeSummary(intake, topicKey),");
});

Deno.test("the incident-date fact is never fabricated on the card — buildHumanSummary only suppresses its embedded date when the explicit fact exists", () => {
  assertStringIncludes(dashboardSource, "const incidentDateFact = resolveIncidentDateFact(service, intake);");
  assertStringIncludes(dashboardSource, "includeIncidentDate: !incidentDateFact");
});
