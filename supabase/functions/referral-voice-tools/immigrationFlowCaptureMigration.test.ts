import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(new URL(
  "../../migrations/20260831000100_capture_immigration_flow_request.sql",
  import.meta.url,
));

Deno.test("Immigration Flow capture is service-role-only, tenant-bound, and lead-bound", () => {
  assertStringIncludes(sql, "capture_immigration_flow_request");
  assertStringIncludes(sql, "coalesce(auth.role(), '') <> 'service_role'");
  assertStringIncludes(sql, "p_organization_id <> 'luis-gabriel-referral-hub'");
  assertStringIncludes(sql, "where id=p_lead_id and organization_id=p_organization_id");
  assertStringIncludes(sql, "referral_conversation_identity_mismatch");
  assertStringIncludes(sql, "grant execute on function public.capture_immigration_flow_request(text,uuid,text,text,text,timestamptz,jsonb) to service_role");
});

Deno.test("Immigration Flow capture creates or updates one prequalified request without assignment or notification", () => {
  assertStringIncludes(sql, "service_id='luis_inmigracion'");
  assertStringIncludes(sql, "status='prequalified'");
  assertStringIncludes(sql, "consent=jsonb_build_object('status','pending_review','captured',false)");
  assertStringIncludes(sql, "insert into public.referral_operational_events");
  assertStringIncludes(sql, "'immigration-flow:' || p_delivery_key");
  assertStringIncludes(sql, "'assigned',false");
  assertStringIncludes(sql, "'notification_created',false");
  assert(!/insert into public\.referral_assignments/i.test(sql));
  assert(!/insert into public\.referral_notification_attempts/i.test(sql));
});
