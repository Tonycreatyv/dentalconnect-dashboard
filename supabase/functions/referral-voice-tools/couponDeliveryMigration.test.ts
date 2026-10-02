import { assert } from "https://deno.land/std@0.223.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  new URL(
    "../../migrations/20260729000200_referral_coupon_delivery_events.sql",
    import.meta.url,
  ),
);

Deno.test("delivery tracking migration is isolated from coupon issuance", () => {
  assert(sql.includes("public.referral_coupon_delivery_events"));
  assert(sql.includes("conversation_identity_hash"));
  assert(sql.includes("prepared_at"));
  assert(sql.includes("delivered_at timestamptz null"));
  assert(!sql.includes("coupon_code"));
  assert(!sql.includes("public_token"));
  assert(!sql.includes("redeemed_at"));
  assert(!sql.includes("referral_coupon_issuances"));
});

Deno.test("delivery tracking migration is tenant scoped and idempotent", () => {
  assert(sql.includes("references public.organizations(id)"));
  assert(
    sql.includes(
      "referral_coupon_delivery_events_idempotency_unique",
    ),
  );
  assert(
    sql.includes(
      "alter table public.referral_coupon_delivery_events enable row level security",
    ),
  );
  assert(
    sql.includes("revoke all on table public.referral_coupon_delivery_events"),
  );
  assert(
    sql.includes("grant all on table public.referral_coupon_delivery_events"),
  );
});

Deno.test("tracking metadata is PII-minimized and services are allowlisted", () => {
  for (
    const serviceId of [
      "luis_cupon_super",
      "luis_cupon_medico",
      "luis_cupon_dental",
    ]
  ) {
    assert(sql.includes(`'${serviceId}'`));
  }
  assert(!/\bphone\b/i.test(sql));
  assert(!/\bfull_name\b/i.test(sql));
  assert(!/\bconversation_id\s+text\b/i.test(sql));
});
