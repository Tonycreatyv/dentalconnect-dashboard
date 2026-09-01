import { supabase } from "../../../lib/supabaseClient";
import type {
  Business,
  Campaign,
  Coupon,
  NegociosDataSource,
  NewBusinessInput,
  NewCampaignInput,
  SupermarketLocation,
} from "./types";
import { SchemaNotMigratedError } from "./types";

// Real implementation, written against the *drafted* schema in
// docs/proposed-migrations/20260822_draft_business_coupon_canonical_fields.sql
// so it is ready the moment that migration is applied. NOT the active data
// source for this pass — see negocios/dataSource.ts, which hard-codes the
// demo adapter as current. Every method here fails loud (SchemaNotMigratedError)
// rather than crashing or silently returning empty/wrong data if the new
// columns don't exist yet, because Postgres reports that as a specific,
// recognizable error code (42703 = undefined_column) that this adapter
// checks for explicitly rather than swallowing generically.

function isUndefinedColumnError(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

export class SupabaseNegociosDataSource implements NegociosDataSource {
  readonly mode = "supabase" as const;
  // Future-schema stub, not the active data source (see negocios/dataSource.ts).
  // Every capability stays false until this adapter is actually wired in and
  // the canonical-fields migration is applied for real.
  readonly capabilities = {
    canEditBusiness: false,
    canCreateBusiness: false,
    canEditCoupon: false,
    canUploadImages: false,
    canEditLocationImages: false,
  };

  constructor(private readonly organizationId: string) {}

  async listBusinesses(): Promise<Business[]> {
    const result = await supabase
      .from("referral_partners")
      .select("id,name,category_service_id,contact_name,phone,address_text,hours,offers_coupon,receives_service_requests,active")
      .eq("organization_id", this.organizationId);
    if (result.error) {
      if (isUndefinedColumnError(result.error)) {
        throw new SchemaNotMigratedError("referral_partners business columns");
      }
      throw new Error(result.error.message);
    }
    return (result.data ?? []).map(mapBusinessRow);
  }

  async getBusiness(id: string): Promise<Business | null> {
    const result = await supabase
      .from("referral_partners")
      .select("id,name,category_service_id,contact_name,phone,address_text,hours,offers_coupon,receives_service_requests,active")
      .eq("organization_id", this.organizationId)
      .eq("id", id)
      .maybeSingle();
    if (result.error) {
      if (isUndefinedColumnError(result.error)) {
        throw new SchemaNotMigratedError("referral_partners business columns");
      }
      throw new Error(result.error.message);
    }
    return result.data ? mapBusinessRow(result.data) : null;
  }

  async createBusiness(input: NewBusinessInput): Promise<Business> {
    const result = await supabase
      .from("referral_partners")
      .insert({
        organization_id: this.organizationId,
        name: input.name,
        slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "negocio",
        category_service_id: input.categoryServiceId,
        contact_name: input.contactName,
        phone: input.phone,
        address_text: input.addressText,
        offers_coupon: input.offersCoupon,
        receives_service_requests: input.receivesServiceRequests,
      })
      .select("id,name,category_service_id,contact_name,phone,address_text,hours,offers_coupon,receives_service_requests,active")
      .single();
    if (result.error) {
      if (isUndefinedColumnError(result.error)) {
        throw new SchemaNotMigratedError("referral_partners business columns");
      }
      throw new Error(result.error.message);
    }
    return mapBusinessRow(result.data);
  }

  async updateBusiness(id: string, patch: Partial<NewBusinessInput>): Promise<Business> {
    const result = await supabase
      .from("referral_partners")
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.categoryServiceId !== undefined ? { category_service_id: patch.categoryServiceId } : {}),
        ...(patch.contactName !== undefined ? { contact_name: patch.contactName } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.addressText !== undefined ? { address_text: patch.addressText } : {}),
        ...(patch.offersCoupon !== undefined ? { offers_coupon: patch.offersCoupon } : {}),
        ...(patch.receivesServiceRequests !== undefined ? { receives_service_requests: patch.receivesServiceRequests } : {}),
      })
      .eq("organization_id", this.organizationId)
      .eq("id", id)
      .select("id,name,category_service_id,contact_name,phone,address_text,hours,offers_coupon,receives_service_requests,active")
      .single();
    if (result.error) {
      if (isUndefinedColumnError(result.error)) {
        throw new SchemaNotMigratedError("referral_partners business columns");
      }
      throw new Error(result.error.message);
    }
    return mapBusinessRow(result.data);
  }

  async listCoupons(): Promise<Coupon[]> {
    const result = await supabase
      .from("referral_coupon_campaigns")
      .select("id,business_id,campaign_key,display_name,image_url,customer_copy,terms_text,active,expires_at,delivery_source")
      .eq("organization_id", this.organizationId);
    if (result.error) {
      if (isUndefinedColumnError(result.error)) {
        throw new SchemaNotMigratedError("referral_coupon_campaigns coupon columns");
      }
      throw new Error(result.error.message);
    }
    return (result.data ?? []).map(mapCouponRow);
  }

  async getCoupon(id: string): Promise<Coupon | null> {
    const result = await supabase
      .from("referral_coupon_campaigns")
      .select("id,business_id,campaign_key,display_name,image_url,customer_copy,terms_text,active,expires_at,delivery_source")
      .eq("organization_id", this.organizationId)
      .eq("id", id)
      .maybeSingle();
    if (result.error) {
      if (isUndefinedColumnError(result.error)) {
        throw new SchemaNotMigratedError("referral_coupon_campaigns coupon columns");
      }
      throw new Error(result.error.message);
    }
    return result.data ? mapCouponRow(result.data) : null;
  }

  async updateCoupon(id: string, patch: Partial<Pick<Coupon, "imageUrl" | "customerCopy" | "termsText" | "active" | "expiresAt" | "businessId" | "deliverySource">>): Promise<Coupon> {
    const result = await supabase
      .from("referral_coupon_campaigns")
      .update({
        ...(patch.imageUrl !== undefined ? { image_url: patch.imageUrl } : {}),
        ...(patch.customerCopy !== undefined ? { customer_copy: patch.customerCopy } : {}),
        ...(patch.termsText !== undefined ? { terms_text: patch.termsText } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.expiresAt !== undefined ? { expires_at: patch.expiresAt } : {}),
        ...(patch.businessId !== undefined ? { business_id: patch.businessId } : {}),
        ...(patch.deliverySource !== undefined ? { delivery_source: patch.deliverySource } : {}),
      })
      .eq("organization_id", this.organizationId)
      .eq("id", id)
      .select("id,business_id,campaign_key,display_name,image_url,customer_copy,terms_text,active,expires_at,delivery_source")
      .single();
    if (result.error) {
      if (isUndefinedColumnError(result.error)) {
        throw new SchemaNotMigratedError("referral_coupon_campaigns coupon columns");
      }
      throw new Error(result.error.message);
    }
    return mapCouponRow(result.data);
  }

  async listCampaigns(): Promise<Campaign[]> {
    const result = await supabase
      .from("referral_qr_entries")
      .select("id,public_code,attribution_label,entry_type,service_id,campaign_key,business_id,active,entries_count:id.count()")
      .eq("organization_id", this.organizationId);
    if (result.error) {
      if (isUndefinedColumnError(result.error)) {
        throw new SchemaNotMigratedError("referral_qr_entries business_id column");
      }
      throw new Error(result.error.message);
    }
    return (result.data ?? []).map(mapCampaignRow);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCampaign(_input: NewCampaignInput): Promise<Campaign> {
    // Deliberately not implemented this pass: creating a referral_qr_entries
    // row that "promotes" a business/coupon/service is a small additive
    // change (insert business_id alongside the existing columns) but is
    // left unimplemented until the migration is real, so this file can't
    // accidentally be exercised against production with a half-specified
    // write path.
    throw new SchemaNotMigratedError("referral_qr_entries campaign creation");
  }

  // referral_benefit_campaign_locations already exists in production today
  // (unlike the rest of this stub) — real read here, scoped by the coupon's
  // own campaign_key, never a fabricated single global image.
  async listSupermarketLocations(campaignKey: string): Promise<SupermarketLocation[]> {
    const campaignResult = await supabase
      .from("referral_coupon_campaigns")
      .select("id")
      .eq("organization_id", this.organizationId)
      .eq("campaign_key", campaignKey)
      .maybeSingle();
    if (campaignResult.error || !campaignResult.data) return [];
    const result = await supabase
      .from("referral_benefit_campaign_locations")
      .select("id,location_key,display_name,postal_code,address_text,official_media_url,active")
      .eq("organization_id", this.organizationId)
      .eq("campaign_id", campaignResult.data.id)
      .eq("active", true);
    if (result.error) throw new Error(result.error.message);
    return (result.data ?? []).map(mapLocationRow);
  }

  async updateSupermarketLocation(): Promise<SupermarketLocation> {
    // referral_benefit_campaign_locations has no write RLS today - real,
    // not a schema gap, so this is a ReadOnlyError-shaped failure rather
    // than SchemaNotMigratedError. This stub is not the active data
    // source either way (see negocios/dataSource.ts).
    throw new Error("editar la imagen de una ubicación requiere una política de escritura en referral_benefit_campaign_locations");
  }
}

function mapLocationRow(row: Record<string, unknown>): SupermarketLocation {
  return {
    id: String(row.id),
    locationKey: String(row.location_key ?? ""),
    displayName: String(row.display_name ?? ""),
    officialMediaUrl: String(row.official_media_url ?? ""),
    postalCode: String(row.postal_code ?? ""),
    addressText: String(row.address_text ?? ""),
  };
}

function mapBusinessRow(row: Record<string, unknown>): Business {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    categoryServiceId: String(row.category_service_id ?? ""),
    categoryLabel: String(row.category_service_id ?? ""),
    contactName: (row.contact_name as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    addressText: (row.address_text as string | null) ?? null,
    postalCode: (row.postal_code as string | null) ?? null,
    imageUrl: (row.image_url as string | null) ?? null,
    hours: (row.hours as Business["hours"]) ?? {},
    offersCoupon: Boolean(row.offers_coupon),
    receivesServiceRequests: Boolean(row.receives_service_requests),
    active: row.active !== false,
    requestCount: 0,
    faqs: (row.faqs as Business["faqs"]) ?? [],
  };
}

function mapCouponRow(row: Record<string, unknown>): Coupon {
  return {
    id: String(row.id),
    businessId: String(row.business_id ?? ""),
    campaignKey: String(row.campaign_key ?? ""),
    displayName: String(row.display_name ?? ""),
    imageUrl: String(row.image_url ?? ""),
    customerCopy: String(row.customer_copy ?? ""),
    termsText: String(row.terms_text ?? ""),
    active: row.active !== false,
    expiresAt: (row.expires_at as string | null) ?? null,
    deliverySource: row.delivery_source === "db" ? "db" : "legacy",
  };
}

function mapCampaignRow(row: Record<string, unknown>): Campaign {
  return {
    id: String(row.id),
    publicCode: String(row.public_code ?? ""),
    label: String(row.attribution_label ?? row.public_code ?? ""),
    promotes: row.business_id
      ? { kind: "business", businessId: String(row.business_id) }
      : row.campaign_key
        ? { kind: "coupon", couponId: String(row.campaign_key) }
        : row.service_id
          ? { kind: "service", serviceId: String(row.service_id) }
          : { kind: "menu" },
    active: row.active !== false,
    requestsCount: Number(row.entries_count ?? 0),
  };
}
