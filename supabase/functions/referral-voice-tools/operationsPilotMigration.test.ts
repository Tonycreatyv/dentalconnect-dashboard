import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
const sql = await Deno.readTextFile(
  new URL(
    "../../migrations/20260801000100_referral_operations_pilot.sql",
    import.meta.url,
  ),
);
Deno.test("operational migration separates request assignment notification and event states", () => {
  for (
    const object of [
      "referral_service_requests",
      "referral_assignments",
      "referral_notification_attempts",
      "referral_operational_events",
      "referral_operational_exceptions",
    ]
  ) assertStringIncludes(sql, object);
  assertStringIncludes(sql, "referral_assignments_one_active_request");
  assertStringIncludes(sql, "assign_referral_request");
  assertStringIncludes(sql, "for update of x skip locked");
});
Deno.test("operational migration is additive and tenant protected", () => {
  assertStringIncludes(sql, "referral_is_member");
  assertStringIncludes(sql, "enable row level security");
  assert(!/drop\s+(table|column)/i.test(sql));
  assert(!/delete\s+from/i.test(sql));
  assert(!/truncate/i.test(sql));
});
Deno.test("partner access tokens are hashed, expiring and revocable", () => {
  assertStringIncludes(sql, "token_hash");
  assertStringIncludes(sql, "expires_at");
  assertStringIncludes(sql, "revoked_at");
  assertStringIncludes(
    sql,
    "revoke all on table public.referral_partner_access_tokens",
  );
});

Deno.test("service-role runtime has explicit operational table privileges", () => {
  assertStringIncludes(sql, "public.referral_partner_contacts,");
  assertStringIncludes(sql, "public.referral_partner_access_tokens,");
  assertStringIncludes(sql, "public.referral_internal_notes");
  assertStringIncludes(sql, "to service_role;");
});

Deno.test("operational migration does not replace the canonical basket offer schema", () => {
  assertStringIncludes(sql, "referral_basket_offers remains the canonical");
  assert(
    !/create table(?: if not exists)? public\.[a-z_]*(basket|price)/i.test(sql),
  );
  assert(!sql.includes("references public.referral_basket_offers"));
});

Deno.test("coupon operations are readable only by tenant owner or admin", () => {
  assertStringIncludes(
    sql,
    "grant select on table public.referral_coupon_campaigns,",
  );
  assertStringIncludes(sql, "referral_coupon_campaigns_admin_read");
  assertStringIncludes(sql, "referral_coupon_delivery_events_admin_read");
  assertStringIncludes(
    sql,
    "using(public.referral_is_member(organization_id,array['owner','admin']))",
  );
  assert(!/grant\s+(insert|update|delete|all).*referral_coupon/i.test(sql));
});
