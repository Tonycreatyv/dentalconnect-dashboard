import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(new URL(
  "../../migrations/20260901000100_referral_hub_phase0_access_audit.sql",
  import.meta.url,
));

Deno.test("Phase 0 makes internal and partner identities explicitly tenant-scoped", () => {
  assertStringIncludes(sql, "alter table public.org_members add column if not exists active boolean not null default true");
  assertStringIncludes(sql, "create table if not exists public.referral_partner_memberships");
  assertStringIncludes(sql, "role in ('partner_admin','partner_agent')");
  assertStringIncludes(sql, "foreign key (organization_id, partner_id)");
  assertStringIncludes(sql, "references public.referral_partners(organization_id, id)");
  assertStringIncludes(sql, "and m.active");
});

Deno.test("Phase 0 blocks cross-organization and cross-partner reads in RLS", () => {
  assertStringIncludes(sql, "referral_requests_internal_read");
  assertStringIncludes(sql, "public.referral_is_member(organization_id,array['owner','admin','operator'])");
  assertStringIncludes(sql, "a.request_id=referral_service_requests.id");
  assertStringIncludes(sql, "public.referral_is_partner_member(a.organization_id,a.partner_id,array['partner_admin','partner_agent'])");
  assertStringIncludes(sql, "referral_assignments_partner_read");
  assertStringIncludes(sql, "referral_partner_memberships_partner_admin_read");
  assert(!sql.includes("grant insert, update, delete on table public.referral_partner_memberships to authenticated"));
});

Deno.test("Phase 0 uses controlled partner membership and immutable audit functions", () => {
  assertStringIncludes(sql, "manage_referral_partner_member");
  assertStringIncludes(sql, "partner_membership_admin_denied");
  assertStringIncludes(sql, "referral_reject_operational_event_mutation");
  assertStringIncludes(sql, "before update or delete on public.referral_operational_events");
  assertStringIncludes(sql, "referral_operational_events_are_immutable");
  assertStringIncludes(sql, "append_referral_operational_event");
  assertStringIncludes(sql, "'system','service_role','user','partner','provider'");
  assertStringIncludes(sql, "event_type,'service_role','capture_immigration_flow_request'");
  for (const name of [
    "referral_is_member",
    "referral_is_partner_member",
    "manage_referral_partner_member",
    "referral_reject_operational_event_mutation",
    "append_referral_operational_event",
    "capture_immigration_flow_request",
  ]) {
    const start = sql.indexOf(`function public.${name}`);
    assert(start >= 0);
    assertStringIncludes(sql.slice(start, start + 850), "set search_path=public,pg_temp");
  }
});

Deno.test("Phase 0 preserves Immigration retries and allows a new case cycle only after closure", () => {
  assertStringIncludes(sql, "case_cycle integer not null default 1");
  assertStringIncludes(sql, "referral_service_requests_completion_cycle_unique");
  assertStringIncludes(sql, "idempotency_key='immigration-flow:'||p_delivery_key");
  assertStringIncludes(sql, "status in ('new','collecting','prequalified','qualified')");
  assertStringIncludes(sql, "coalesce(max(case_cycle),0)+1");
  assertStringIncludes(sql, "'idempotent_replay',true");
});
