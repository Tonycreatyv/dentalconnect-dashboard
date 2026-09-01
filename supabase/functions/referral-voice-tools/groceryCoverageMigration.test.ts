import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";

const migrationUrl = new URL(
  "../../migrations/20260802000100_referral_grocery_delivery_coverage.sql",
  import.meta.url,
);
const sql = await Deno.readTextFile(migrationUrl);

Deno.test("grocery coverage migration is isolated and tenant scoped", () => {
  assert(
    sql.includes("create table public.referral_grocery_delivery_coverage"),
  );
  assert(
    sql.includes("unique (organization_id, partner_location_id, postal_code)"),
  );
  assert(sql.includes("referral_validate_grocery_coverage_scope"));
  assert(sql.includes("enable row level security"));
  assert(sql.includes("array['owner', 'admin']"));
  assert(
    sql.includes(
      "grant all on table public.referral_grocery_delivery_coverage to service_role",
    ),
  );
  assert(
    !/\b(drop|truncate|alter\s+table\s+public\.(?!referral_grocery_delivery_coverage))\b/i
      .test(sql),
  );
  assert(!sql.includes("referral_partner_service_rules"));
  assert(!sql.includes("referral_basket_offers"));
});

Deno.test("grocery coverage backfill preserves the six confirmed locations", () => {
  const ids = [
    "014bb610-a915-e0ab-7c2c-a8a492e0c572",
    "5af97871-bb3e-5faf-45c9-701cd8d9a635",
    "7a000c5b-fd26-76f0-8bcd-08eecb72c769",
    "85ea7272-0d41-2d09-b29c-cc5c3320669e",
    "8bad61aa-3010-6cac-4f62-fd7cf16f35e2",
    "8f1737f1-af9b-0630-6d97-011261ee5791",
  ];
  assertEquals(ids.filter((id) => sql.includes(id)).length, 6);
  assertEquals((sql.match(/'luis-gabriel-referral-hub'/g) ?? []).length, 13);
});
