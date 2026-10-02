type CouponDatabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type SupabaseLike = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: CouponDatabaseError | null }>;
};

export type CouponPersistenceFailure =
  | "coupon_table_missing"
  | "coupon_rpc_missing"
  | "coupon_campaign_missing"
  | "coupon_campaign_inactive"
  | "coupon_insert_rejected"
  | "coupon_select_failed"
  | "coupon_rls_denied"
  | "coupon_constraint_failed"
  | "coupon_response_invalid"
  | "coupon_issue_failed";

export class CouponPersistenceError extends Error {
  constructor(
    public readonly reason: CouponPersistenceFailure,
    public readonly operation: "rpc",
    public readonly objectName: "public.issue_or_get_coupon",
    public readonly databaseCode: string | null,
    public readonly sanitizedMessage: string,
  ) {
    super(reason);
    this.name = "CouponPersistenceError";
  }
}

export type IssuedCoupon = {
  id: string; code: string; publicUrl: string;
  status: "active" | "redeemed" | "expired" | "void";
  issuedAt: string; expiresAt: string | null; wasCreated: boolean;
};

function sanitizeDatabaseMessage(value: unknown): string {
  return String(value ?? "unknown")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[uuid]",
    )
    .replace(/\b\d{7,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "unknown";
}

export function classifyCouponDatabaseError(
  error: CouponDatabaseError,
): CouponPersistenceFailure {
  const code = String(error.code ?? "").trim().toUpperCase();
  const message = String(error.message ?? "").toLowerCase();
  if (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes("could not find the function") ||
    message.includes("function public.issue_or_get_coupon") &&
      message.includes("does not exist")
  ) return "coupon_rpc_missing";
  if (code === "42P01" || message.includes("relation") && message.includes("does not exist")) {
    return "coupon_table_missing";
  }
  if (
    message.includes("coupon_campaign_missing") ||
    /coupon campaign.*(missing|not found)/.test(message)
  ) return "coupon_campaign_missing";
  if (
    message.includes("coupon_campaign_inactive") ||
    /coupon campaign.*inactive/.test(message)
  ) return "coupon_campaign_inactive";
  if (message.includes("coupon_insert_rejected")) return "coupon_insert_rejected";
  if (message.includes("coupon_select_failed")) return "coupon_select_failed";
  if (code === "42501" || code === "28000" || message.includes("permission denied")) {
    return "coupon_rls_denied";
  }
  if (code.startsWith("23")) return "coupon_constraint_failed";
  return "coupon_issue_failed";
}

function publicBaseUrl(): string {
  const value = String(
    Deno.env.get("REFERRAL_HUB_PUBLIC_BASE_URL") ??
      Deno.env.get("REFERRAL_HUB_ASSET_BASE_URL") ??
      "",
  ).trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value)) throw new Error("invalid_referral_hub_public_base_url");
  return value;
}

export async function issueOrGetCoupon(args: {
  supabase: SupabaseLike;
  organizationId: string;
  leadId: string;
  campaignKey?: string;
}): Promise<IssuedCoupon> {
  const { data, error } = await args.supabase.rpc("issue_or_get_coupon", {
    p_organization_id: args.organizationId,
    p_campaign_key: args.campaignKey ?? "mi_tierra_10",
    p_lead_id: args.leadId,
  });
  if (error) {
    throw new CouponPersistenceError(
      classifyCouponDatabaseError(error),
      "rpc",
      "public.issue_or_get_coupon",
      String(error.code ?? "").trim() || null,
      sanitizeDatabaseMessage(error.message),
    );
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (
    !row?.coupon_id ||
    !row?.code ||
    !row?.public_token ||
    !row?.coupon_status ||
    !row?.issued_at
  ) {
    throw new CouponPersistenceError(
      "coupon_response_invalid",
      "rpc",
      "public.issue_or_get_coupon",
      null,
      "RPC returned an incomplete coupon response",
    );
  }
  return {
    id: String(row.coupon_id), code: String(row.code),
    publicUrl: `${publicBaseUrl()}/coupon/${encodeURIComponent(String(row.public_token))}`,
    status: String(row.coupon_status) as IssuedCoupon["status"], issuedAt: String(row.issued_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null, wasCreated: Boolean(row.was_created),
  };
}
