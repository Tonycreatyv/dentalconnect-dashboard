import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(new URL(
  "../../migrations/20260903000100_immigration_internal_reconciliation.sql",
  import.meta.url,
));

Deno.test("Immigration reconciliation explicitly requires the audited operational baseline", () => {
  for (const value of [
    "immigration_reconciliation_missing_table",
    "immigration_reconciliation_missing_column",
    "immigration_reconciliation_missing_active_request_index",
    "immigration_reconciliation_missing_event_idempotency_index",
    "immigration_reconciliation_missing_membership_function",
    "immigration_reconciliation_expected_legacy_completion_constraint_missing",
  ]) assertStringIncludes(sql, value);
  assert(!sql.includes("create table if not exists public.referral_service_requests"));
});

Deno.test("Immigration reconciliation preserves existing rows while enabling closed case cycles", () => {
  assertStringIncludes(sql, "add column case_cycle integer");
  assertStringIncludes(sql, "update public.referral_service_requests set case_cycle = 1 where case_cycle is null");
  assertStringIncludes(sql, "referral_service_requests_completion_cycle_unique");
  assertStringIncludes(sql, "unique (organization_id, lead_id, service_id, completion_key, case_cycle)");
  assertStringIncludes(sql, "status in ('new', 'collecting', 'prequalified', 'qualified')");
  assertStringIncludes(sql, "coalesce(max(case_cycle), 0) + 1");
});

Deno.test("Immigration reconciliation captures only canonical service-role Flow completions", () => {
  assertStringIncludes(sql, "coalesce(auth.role(), '') <> 'service_role'");
  assertStringIncludes(sql, "p_organization_id <> 'luis-gabriel-referral-hub'");
  assertStringIncludes(sql, "p_completion_key <> 'luis_unified_services:immigration:v1'");
  assertStringIncludes(sql, "p_intake->>'flow_type' <> 'luis_unified_services'");
  assertStringIncludes(sql, "p_intake->>'flow_version' <> 'v1'");
  assertStringIncludes(sql, "where id = p_lead_id and organization_id = p_organization_id");
  assertStringIncludes(sql, "referral_conversation_identity_mismatch");
  assertStringIncludes(sql, "postal_code = nullif(trim(p_intake->>'postal_code'), '')");
  assertStringIncludes(sql, "'completed_at', p_completed_at");
  assertStringIncludes(sql, "'idempotent_replay', true");
  assertStringIncludes(sql, "'assigned', false");
  assertStringIncludes(sql, "'notification_created', false");
  assert(!/insert into public\.referral_assignments/i.test(sql));
  assert(!/insert into public\.referral_partner_access_tokens/i.test(sql));
  assert(!/insert into public\.referral_notification_attempts/i.test(sql));
});

Deno.test("Immigration reconciliation records every consent state and protects immutable events", () => {
  assertStringIncludes(sql, "when 'AUTHORIZED' then 'authorized'");
  assertStringIncludes(sql, "when 'DECLINED' then 'declined'");
  assertStringIncludes(sql, "else 'pending_review'");
  assertStringIncludes(sql, "referral_reject_operational_event_mutation");
  assertStringIncludes(sql, "before update or delete on public.referral_operational_events");
  assertStringIncludes(sql, "actor_type in ('system', 'service_role', 'user', 'partner', 'provider')");
});

Deno.test("Immigration reconciliation has read-only browser grants and organization-scoped inbox access", () => {
  assertStringIncludes(sql, "revoke all on table public.referral_service_requests from public, anon, authenticated");
  assertStringIncludes(sql, "revoke all on table public.referral_operational_events from public, anon, authenticated");
  assertStringIncludes(sql, "grant select on table public.referral_service_requests to authenticated");
  assertStringIncludes(sql, "referral_requests_internal_read");
  assertStringIncludes(sql, "array['owner', 'admin', 'operator']");
  assertEquals(/grant\s+(?:insert|update|delete|all)\s+on\s+table\s+public\.referral_service_requests\s+to\s+authenticated/i.test(sql), false);
  assertEquals(/grant\s+(?:insert|update|delete|all)\s+on\s+table\s+public\.referral_operational_events\s+to\s+authenticated/i.test(sql), false);
});
