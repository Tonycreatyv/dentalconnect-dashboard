import { supabase } from "../lib/supabaseClient";

export type CouponResult = "valid" | "redeemed" | "expired" | "invalid" | "forbidden";
export type PublicCoupon = { campaign_name: string; discount_cents: number; code: string; public_status: "available" | "used" | "expired" | "invalid"; expires_at: string | null; terms: string | null };
export type StaffCoupon = { coupon_id: string | null; campaign_name: string | null; discount_cents: number | null; code: string | null; result: CouponResult; expires_at: string | null };

export async function getPublicCoupon(token: string): Promise<PublicCoupon | null> {
  const { data, error } = await supabase.rpc("get_public_coupon", { p_public_token: token });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as PublicCoupon | null;
}
export async function lookupCoupon(value: string): Promise<StaffCoupon> {
  const { data, error } = await supabase.rpc("lookup_coupon_for_redemption", { p_lookup: value.trim() });
  if (error) throw error;
  return ((Array.isArray(data) ? data[0] : data) ?? { result: "invalid" }) as StaffCoupon;
}
export async function redeemCoupon(couponId: string, totalCents: number, location: string): Promise<{ result: CouponResult; redeemed_at: string | null }> {
  const { data, error } = await supabase.rpc("redeem_coupon", { p_coupon_id: couponId, p_purchase_total_cents: totalCents, p_redeemed_location: location.trim() });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { result: CouponResult; redeemed_at: string | null };
}

export function parseCouponToken(value: string): string {
  const trimmed = value.trim();
  try { const url = new URL(trimmed); return url.pathname.match(/\/validate-coupon\/([^/]+)/)?.[1] ? decodeURIComponent(url.pathname.match(/\/validate-coupon\/([^/]+)/)![1]) : trimmed; } catch { return trimmed; }
}
