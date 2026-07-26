type SupabaseLike = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };

export type IssuedCoupon = {
  id: string; code: string; publicUrl: string;
  status: "active" | "redeemed" | "expired" | "void";
  issuedAt: string; expiresAt: string | null; wasCreated: boolean;
};

function publicBaseUrl(): string {
  const value = String(Deno.env.get("REFERRAL_HUB_PUBLIC_BASE_URL") ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value)) throw new Error("invalid_referral_hub_public_base_url");
  return value;
}

export async function issueOrGetCoupon(args: { supabase: SupabaseLike; organizationId: string; leadId: string; campaignKey?: string }): Promise<IssuedCoupon> {
  const { data, error } = await args.supabase.rpc("issue_or_get_coupon", {
    p_organization_id: args.organizationId, p_campaign_key: args.campaignKey ?? "super20", p_lead_id: args.leadId,
  });
  if (error) throw new Error(`coupon_issue_failed:${String(error.message ?? "unknown")}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row?.coupon_id || !row?.public_token) throw new Error("coupon_issue_empty_result");
  return {
    id: String(row.coupon_id), code: String(row.code),
    publicUrl: `${publicBaseUrl()}/coupon/${encodeURIComponent(String(row.public_token))}`,
    status: String(row.coupon_status) as IssuedCoupon["status"], issuedAt: String(row.issued_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null, wasCreated: Boolean(row.was_created),
  };
}
