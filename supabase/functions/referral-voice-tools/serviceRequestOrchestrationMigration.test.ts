import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  new URL(
    "../../migrations/20260801000100_referral_operations_pilot.sql",
    import.meta.url,
  ),
);

Deno.test("operational orchestration is private, service-role-only and tenant-scoped", () => {
  assertStringIncludes(sql, "orchestrate_referral_service_request");
  assertStringIncludes(sql, "coalesce(auth.role(),'') <> 'service_role'");
  assertStringIncludes(sql, "p_organization_id <> 'luis-gabriel-referral-hub'");
  assertStringIncludes(
    sql,
    "revoke all on function public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb) from public,anon,authenticated",
  );
  assertStringIncludes(
    sql,
    "grant execute on function public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb) to service_role",
  );
});

Deno.test("completion contract is exact, confirmed and conversation-bound", () => {
  for (
    const id of [
      "luis_accidente",
      "luis_inmigracion",
      "luis_eventos",
      "luis_representante",
    ]
  ) assertStringIncludes(sql, `'${id}'`);
  for (
    const excluded of [
      "luis_compra_super",
      "luis_cupon_super",
      "luis_cupon_medico",
      "luis_cupon_dental",
    ]
  ) {
    assert(
      !sql.slice(
        sql.indexOf(
          "create or replace function public.orchestrate_referral_service_request",
        ),
      ).includes(`'${excluded}'`),
    );
  }
  assertStringIncludes(sql, "p_completion_outcome <> 'confirmed_intake'");
  assertStringIncludes(sql, "p_completion_outcome <> 'follow_up_requested'");
  assertStringIncludes(sql, "referral_conversation_identity_mismatch");
  assertStringIncludes(sql, "lead_row)->>'channel'");
  assertStringIncludes(sql, "lead_row)->>'channel_user_id'");
});

Deno.test("request, assignment, notification, exception and event writes are idempotent and serialized", () => {
  assertStringIncludes(sql, "completion_key text not null");
  assertStringIncludes(
    sql,
    "unique(organization_id,lead_id,service_id,completion_key)",
  );
  assertStringIncludes(sql, "referral_requests_one_active_service");
  assertStringIncludes(
    sql,
    "status in ('new','collecting','prequalified','qualified')",
  );
  assertStringIncludes(sql, "pg_advisory_xact_lock");
  assertStringIncludes(
    sql,
    "on conflict(organization_id,lead_id,service_id,completion_key) do nothing",
  );
  assertStringIncludes(sql, "referral_assignments_one_active_request");
  assertStringIncludes(
    sql,
    "referral_partner_access_tokens_one_active_assignment",
  );
  assertStringIncludes(sql, "no_eligible_partner");
  assertStringIncludes(sql, "missing_partner_contact");
  assertStringIncludes(sql, "notification_queued");
  assertStringIncludes(sql, "request_prequalified");
});

Deno.test("assignment uses reviewed rules and never Google distance or fabricated partner data", () => {
  const body = sql.slice(
    sql.indexOf(
      "create or replace function public.orchestrate_referral_service_request",
    ),
    sql.indexOf("revoke all on function public.assign_referral_request"),
  );
  for (
    const field of [
      "candidate.cities",
      "candidate.states",
      "candidate.postal_codes",
      "candidate.languages",
      "candidate.specialties",
      "candidate.capacity_limit",
      "candidate.assignment_priority",
      "candidate.assignment_weight",
    "rule_row.acceptance_sla_minutes",
    ]
  ) assertStringIncludes(body, field);
  assert(!/google|distance/i.test(body));
  assert(!/insert into public\.referral_partners/i.test(body));
  assert(!/insert into public\.referral_partner_contacts/i.test(body));
  assert(!/insert into public\.referral_partner_service_rules/i.test(body));
});

Deno.test("partner token is hashed, one-per-assignment and omitted for internal advisor", () => {
  assertStringIncludes(sql, "extensions.gen_random_bytes(32)");
  assertStringIncludes(sql, "extensions.digest(token_plain,'sha256')");
  assertStringIncludes(sql, "if p_service_id <> 'luis_representante'");
  assertStringIncludes(sql, "where revoked_at is null");
  assertEquals((sql.match(/token_hash_value/g) ?? []).length >= 2, true);
});
