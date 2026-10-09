import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const hardening = await Deno.readTextFile(
  new URL(
    "../../migrations/20260801000200_referral_legacy_rls_hardening.sql",
    import.meta.url,
  ),
);
const manifest = await Deno.readTextFile(
  new URL(
    "../../../docs/product/referral-hub-production-rollout-manifest.md",
    import.meta.url,
  ),
);
const plan = await Deno.readTextFile(
  new URL(
    "../../../docs/product/referral-hub-pilot-deployment-plan.md",
    import.meta.url,
  ),
);

Deno.test("global membership hardening is explicitly deferred from the pilot", () => {
  assertStringIncludes(hardening, "DEFERRED: explicitly excluded");
  assertStringIncludes(manifest, "Deferred and excluded from pilot");
  assertStringIncludes(
    plan,
    "Do **not** apply `20260801000200_referral_legacy_rls_hardening.sql`",
  );
  assertStringIncludes(
    manifest,
    "20260801000100_referral_operations_pilot.sql",
  );
  assertStringIncludes(
    manifest,
    "20260802000100_referral_grocery_delivery_coverage.sql",
  );
});
