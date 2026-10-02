/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const realSource = await Deno.readTextFile(new URL("./realDataSource.ts", import.meta.url));
const routeSource = await Deno.readTextFile(new URL("./dataSource.ts", import.meta.url));
const screensSource = await Deno.readTextFile(new URL("./NegociosScreens.tsx", import.meta.url));
const detailSource = await Deno.readTextFile(new URL("./BusinessDetail.tsx", import.meta.url));
const couponSource = await Deno.readTextFile(new URL("./CouponEditor.tsx", import.meta.url));

Deno.test("production Red always selects the real Supabase data source", () => {
  assertStringIncludes(routeSource, "return realNegociosDataSource");
});

Deno.test("production Red contains no session-only write overlays", () => {
  for (const forbidden of ["localBusinessEdits", "localOnlyBusinesses", "localCouponEdits", "localLocationEdits"]) {
    assertEquals(realSource.includes(forbidden), false);
  }
});

Deno.test("non-persistent campaign creation is not exposed in Red", () => {
  assertStringIncludes(screensSource, "dataSource.capabilities.canCreateCampaign");
});

Deno.test("derived businesses cannot expose the persistent edit drawer", () => {
  assertStringIncludes(detailSource, 'business.id.startsWith("partner:")');
});

Deno.test("coupon association only offers businesses backed by referral_partners", () => {
  assertStringIncludes(couponSource, 'businesses.filter((item) => item.id.startsWith("partner:"))');
});
