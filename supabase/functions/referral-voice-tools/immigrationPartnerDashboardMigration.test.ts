/// <reference lib="deno.ns" />
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(new URL("../../migrations/20260904000100_immigration_partner_dashboard.sql", import.meta.url));

Deno.test("partner dashboard migration is additive, authenticated, and consent-gated", () => {
  assertStringIncludes(sql, "create table public.referral_partner_memberships");
  assertStringIncludes(sql, "auth.uid()");
  assertStringIncludes(sql, "referral_is_active_partner_member");
  assertStringIncludes(sql, "coalesce(consent->>'status','pending_review')='authorized'");
  assertStringIncludes(sql, "auto_assign_immigration_partner");
  assertStringIncludes(sql, "service_role_required");
  assertStringIncludes(sql, "immigration_partner_unconfigured");
  assertStringIncludes(sql, "partner_update_immigration_assignment");
  assertStringIncludes(sql, "invalid_assignment_transition");
  assertStringIncludes(sql, "revoke all on function public.auto_assign_immigration_partner");
  assert(!/referral_partner_access_tokens\s*\(/i.test(sql));
  assert(!/referral_notification_attempts\s*\(/i.test(sql));
});
