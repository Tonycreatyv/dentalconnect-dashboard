/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveBusinessImageUrl } from "./businessImage.ts";
import type { Business, Coupon } from "./types.ts";

function business(overrides: Partial<Business>): Business {
  return {
    id: "merchant:luis_benefit_medical",
    name: "Médico Urgencias",
    categoryServiceId: "luis_benefit_medical",
    categoryLabel: "Beneficios médicos",
    contactName: null,
    phone: null,
    addressText: null,
    postalCode: null,
    imageUrl: null,
    hours: {},
    offersCoupon: true,
    receivesServiceRequests: false,
    active: true,
    requestCount: 0,
    faqs: [],
    ...overrides,
  };
}

function coupon(overrides: Partial<Coupon>): Coupon {
  return {
    id: "coupon-1",
    businessId: "merchant:luis_benefit_medical",
    campaignKey: "luis_benefit_medical_20",
    displayName: "20% de descuento",
    imageUrl: "",
    customerCopy: "",
    termsText: "",
    active: true,
    expiresAt: null,
    deliverySource: "legacy",
    ...overrides,
  };
}

Deno.test("tier 1: an explicit business image always wins", () => {
  const b = business({ imageUrl: "https://example.com/business.jpg" });
  const coupons = [coupon({ businessId: b.id, imageUrl: "https://example.com/coupon.jpg" })];
  assertEquals(resolveBusinessImageUrl(b, coupons), "https://example.com/business.jpg");
});

Deno.test("tier 2: falls back to the real linked coupon's image when no explicit business image", () => {
  const b = business({ imageUrl: null });
  const coupons = [coupon({ businessId: b.id, imageUrl: "https://example.com/coupon.jpg" })];
  assertEquals(resolveBusinessImageUrl(b, coupons), "https://example.com/coupon.jpg");
});

Deno.test("tier 3: no image at all when neither exists - caller renders a neutral placeholder, never a stock photo", () => {
  const b = business({ imageUrl: null, id: "partner:some-id" });
  assertEquals(resolveBusinessImageUrl(b, []), null);
});

Deno.test("never shows one business's linked coupon image on an unrelated business", () => {
  const b = business({ imageUrl: null, id: "merchant:luis_benefit_dental" });
  const coupons = [coupon({ businessId: "merchant:luis_benefit_medical", imageUrl: "https://example.com/medical.jpg" })];
  assertEquals(resolveBusinessImageUrl(b, coupons), null);
});

Deno.test("supermarket location: matches its own multi-location coupon by campaign key, never a different location's", () => {
  const location = business({ id: "location:el-sol", categoryServiceId: "luis_benefit_supermarket", imageUrl: null });
  const supermarketCoupon = coupon({ businessId: "", campaignKey: "luis_benefit_supermarket_20", imageUrl: "https://example.com/generic-supermarket.jpg" });
  assertEquals(resolveBusinessImageUrl(location, [supermarketCoupon]), "https://example.com/generic-supermarket.jpg");
});

Deno.test("supermarket location with its own real official image never falls through to the shared coupon image", () => {
  const location = business({ id: "location:el-sol", categoryServiceId: "luis_benefit_supermarket", imageUrl: "https://example.com/el-sol-official.jpg" });
  const supermarketCoupon = coupon({ businessId: "", campaignKey: "luis_benefit_supermarket_20", imageUrl: "https://example.com/generic-supermarket.jpg" });
  assertEquals(resolveBusinessImageUrl(location, [supermarketCoupon]), "https://example.com/el-sol-official.jpg");
});
