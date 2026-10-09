import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  CouponPersistenceError,
  issueOrGetCoupon,
} from "../domain/referralHub/couponService.ts";

Deno.env.delete("REFERRAL_HUB_PUBLIC_BASE_URL");
Deno.env.set("REFERRAL_HUB_ASSET_BASE_URL", "https://referral.creatyv.io");

function failingRpc(code: string, message: string) {
  return {
    rpc: () => Promise.resolve({
      data: null,
      error: { code, message },
    }),
  };
}

async function expectReason(
  code: string,
  message: string,
  reason: string,
) {
  const error = await assertRejects(
    () =>
      issueOrGetCoupon({
        supabase: failingRpc(code, message),
        organizationId: "luis-gabriel-referral-hub",
        leadId: "11111111-1111-4111-8111-111111111111",
        campaignKey: "mi_tierra_10",
      }),
    CouponPersistenceError,
  ) as CouponPersistenceError;
  assertEquals(error.reason, reason);
  return error;
}

Deno.test("missing coupon RPC is classified from production-style PGRST202", async () => {
  const error = await expectReason(
    "PGRST202",
    "Could not find the function public.issue_or_get_coupon(p_campaign_key, p_lead_id, p_organization_id) in the schema cache",
    "coupon_rpc_missing",
  );
  assertEquals(error.operation, "rpc");
  assertEquals(error.objectName, "public.issue_or_get_coupon");
  assertEquals(error.databaseCode, "PGRST202");
});

Deno.test("missing coupon table is distinguished", async () => {
  await expectReason(
    "42P01",
    'relation "public.referral_coupon_campaigns" does not exist',
    "coupon_table_missing",
  );
});

Deno.test("missing and inactive campaigns are distinguished", async () => {
  await expectReason("P0002", "coupon_campaign_missing", "coupon_campaign_missing");
  await expectReason("P0001", "coupon_campaign_inactive", "coupon_campaign_inactive");
});

Deno.test("insert rejection, RLS denial, and constraint failure are distinguished", async () => {
  await expectReason("P0001", "coupon_insert_rejected", "coupon_insert_rejected");
  await expectReason("42501", "permission denied for table referral_coupon_issuances", "coupon_rls_denied");
  await expectReason("23505", "duplicate key value violates unique constraint", "coupon_constraint_failed");
});

function successfulRpc(wasCreated: boolean) {
  return {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => {
      assertEquals(name, "issue_or_get_coupon");
      assertEquals(args, {
        p_organization_id: "luis-gabriel-referral-hub",
        p_campaign_key: "mi_tierra_10",
        p_lead_id: "11111111-1111-4111-8111-111111111111",
      });
      return Promise.resolve({
        data: {
          coupon_id: "22222222-2222-4222-8222-222222222222",
          code: "MITIERRA10-ABC123",
          public_token: "33333333-3333-4333-8333-333333333333",
          coupon_status: "active",
          issued_at: "2026-07-27T12:00:00Z",
          expires_at: null,
          was_created: wasCreated,
        },
        error: null,
      });
    },
  };
}

async function successfulCoupon(wasCreated: boolean) {
  return await issueOrGetCoupon({
    supabase: successfulRpc(wasCreated),
    organizationId: "luis-gabriel-referral-hub",
    leadId: "11111111-1111-4111-8111-111111111111",
    campaignKey: "mi_tierra_10",
  });
}

Deno.test("successful idempotent coupon creation uses exact RPC contract", async () => {
  const coupon = await successfulCoupon(true);
  assertEquals(coupon.wasCreated, true);
  assertEquals(coupon.code, "MITIERRA10-ABC123");
});

Deno.test("successful existing coupon retrieval preserves the same coupon", async () => {
  const coupon = await successfulCoupon(false);
  assertEquals(coupon.wasCreated, false);
  assertEquals(coupon.id, "22222222-2222-4222-8222-222222222222");
});

Deno.test("invalid RPC response is not treated as successful issuance", async () => {
  const error = await assertRejects(
    () =>
      issueOrGetCoupon({
        supabase: {
          rpc: () => Promise.resolve({ data: {}, error: null }),
        },
        organizationId: "luis-gabriel-referral-hub",
        leadId: "11111111-1111-4111-8111-111111111111",
      }),
    CouponPersistenceError,
  ) as CouponPersistenceError;
  assertEquals(error.reason, "coupon_response_invalid");
});

Deno.test("migration is isolated, idempotent, and maps exact LG offers", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../../migrations/20260727000100_referral_hub_coupons.sql", import.meta.url),
  );
  assert(migration.includes("referral_coupon_campaigns_org_key_unique"));
  assert(migration.includes("referral_coupon_issuances_idempotency_unique"));
  assert(migration.includes("unique (organization_id, campaign_id, lead_id)"));
  assert(migration.includes("'mi_tierra_10'"));
  assert(migration.includes('"discount_amount":10'));
  assert(migration.includes('"minimum_purchase":100'));
  assert(migration.includes("'medico_urgencias_20'"));
  assert(migration.includes('"discount_percent":20'));
  assert(migration.includes("'dental_now_14_29'"));
  assert(migration.includes('"promotional_price":29'));
  assertEquals(migration.includes("grocery_order"), false);
  assertEquals(migration.includes("delivery_order"), false);
});

Deno.test("migration allows only a lead belonging to the requested organization", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../../migrations/20260727000100_referral_hub_coupons.sql", import.meta.url),
  );
  assert(migration.includes(
    "lead_id uuid not null\n    references public.leads(id) on delete cascade,",
  ));
  assert(migration.includes(
    "where id = p_lead_id\n      and organization_id = p_organization_id",
  ));
  assert(migration.includes("message = 'coupon_lead_not_found'"));
});

Deno.test("nonexistent and cross-organization leads are rejected before issuance", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../../migrations/20260727000100_referral_hub_coupons.sql", import.meta.url),
  );
  const leadGuard = migration.indexOf("if not exists (\n    select 1\n    from public.leads");
  const campaignLookup = migration.indexOf("from public.referral_coupon_campaigns", leadGuard);
  const issuanceInsert = migration.indexOf("insert into public.referral_coupon_issuances", leadGuard);
  assert(leadGuard >= 0);
  assert(campaignLookup > leadGuard);
  assert(issuanceInsert > campaignLookup);
});

Deno.test("lead rejection creates no issuance and idempotency remains unchanged", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../../migrations/20260727000100_referral_hub_coupons.sql", import.meta.url),
  );
  const rejection = migration.indexOf("message = 'coupon_lead_not_found'");
  const firstIssuanceRead = migration.indexOf("from public.referral_coupon_issuances", rejection);
  const issuanceInsert = migration.indexOf("insert into public.referral_coupon_issuances", rejection);
  assert(rejection >= 0);
  assert(firstIssuanceRead > rejection);
  assert(issuanceInsert > rejection);
  assert(migration.includes(
    "unique (organization_id, campaign_id, lead_id)",
  ));
  assert(migration.includes(
    "where organization_id = p_organization_id\n     and campaign_id = v_campaign.id\n     and lead_id = p_lead_id",
  ));
});
