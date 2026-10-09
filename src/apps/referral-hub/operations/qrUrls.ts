import { REFERRAL_HUB_PUBLIC_URL } from "../config/product";

export function referralQrPublicUrl(publicCode: string) {
  return `${REFERRAL_HUB_PUBLIC_URL.replace(/\/$/, "")}/q/${encodeURIComponent(publicCode)}`;
}
