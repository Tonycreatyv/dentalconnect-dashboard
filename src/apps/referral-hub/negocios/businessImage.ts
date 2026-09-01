import type { Business, Coupon } from "./types";

// Image precedence (Task 6): 1) an explicit image on the business itself
// (this is already the real official_media_url for supermarket locations —
// see realDataSource.ts — so a store never shows another store's image),
// 2) the real coupon image actually linked to this business, 3) nothing —
// the caller renders a neutral category icon, never a generic stock photo
// and never a broken <img>.
export function resolveBusinessImageUrl(business: Business, coupons: Coupon[]): string | null {
  if (business.imageUrl) return business.imageUrl;
  const linkedCoupon = coupons.find((coupon) => coupon.businessId === business.id)
    ?? (business.categoryServiceId === "luis_benefit_supermarket"
      ? coupons.find((coupon) => coupon.campaignKey.includes("supermarket"))
      : undefined);
  return linkedCoupon?.imageUrl || null;
}
