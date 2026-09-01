// Types for the business-centered redesign. Mirror the *approved, drafted*
// schema in docs/proposed-migrations/20260822_draft_business_coupon_canonical_fields.sql
// — referral_partners (business), referral_coupon_campaigns (coupon),
// referral_qr_entries (campaign). No parallel tables.

export type BusinessHours = Partial<Record<
  "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
  { open: string; close: string }
>>;

export type BusinessFaq = { question: string; answer: string };

export type Business = {
  id: string;
  name: string;
  categoryServiceId: string;
  categoryLabel: string;
  contactName: string | null;
  phone: string | null;
  addressText: string | null;
  postalCode: string | null;
  imageUrl: string | null;
  hours: BusinessHours;
  offersCoupon: boolean;
  receivesServiceRequests: boolean;
  active: boolean;
  requestCount: number;
  faqs: BusinessFaq[];
};

export type NewBusinessInput = {
  name: string;
  categoryServiceId: string;
  contactName: string | null;
  phone: string | null;
  addressText: string | null;
  offersCoupon: boolean;
  receivesServiceRequests: boolean;
};

export type BusinessEditInput = {
  name: string;
  categoryServiceId: string;
  contactName: string | null;
  phone: string | null;
  addressText: string | null;
  postalCode: string | null;
  imageUrl: string | null;
  hours: BusinessHours;
  active: boolean;
  offersCoupon: boolean;
  receivesServiceRequests: boolean;
  faqs: BusinessFaq[];
};

export type DeliverySource = "legacy" | "db";

export type Coupon = {
  id: string;
  businessId: string;
  campaignKey: string;
  displayName: string;
  imageUrl: string;
  customerCopy: string;
  termsText: string;
  active: boolean;
  expiresAt: string | null;
  deliverySource: DeliverySource;
};

// One real, active participating supermarket location backing the shared
// supermarket coupon campaign. Mirrors referral_benefit_campaign_locations
// — never a fabricated per-store "business" row, never merged into a
// single global image.
export type SupermarketLocation = {
  id: string;
  locationKey: string;
  displayName: string;
  officialMediaUrl: string;
  postalCode: string;
  addressText: string;
};

export type CampaignPromotion =
  | { kind: "business"; businessId: string }
  | { kind: "coupon"; couponId: string }
  | { kind: "service"; serviceId: string }
  | { kind: "menu" };

export type Campaign = {
  id: string;
  publicCode: string;
  label: string;
  promotes: CampaignPromotion;
  active: boolean;
  requestsCount: number;
};

export type NewCampaignInput = {
  label: string;
  promotes: CampaignPromotion;
};

export class SchemaNotMigratedError extends Error {
  constructor(detail: string) {
    super(`No disponible: el modelo de datos aún no se migró (${detail}).`);
    this.name = "SchemaNotMigratedError";
  }
}

// What a given data source can actually persist right now. The editing UI
// always renders (per the operational mission this exists for) — these
// flags only decide whether "Guardar" attempts a real write or shows a
// plain, human "not available yet" state instead of a fake success.
export type NegociosCapabilities = {
  canEditBusiness: boolean;
  canCreateBusiness: boolean;
  canEditCoupon: boolean;
  canUploadImages: boolean;
  canEditLocationImages: boolean;
};

export interface NegociosDataSource {
  readonly mode: "demo" | "supabase";
  readonly capabilities: NegociosCapabilities;
  listBusinesses(): Promise<Business[]>;
  getBusiness(id: string): Promise<Business | null>;
  createBusiness(input: NewBusinessInput): Promise<Business>;
  updateBusiness(id: string, patch: Partial<BusinessEditInput>): Promise<Business>;
  listCoupons(): Promise<Coupon[]>;
  getCoupon(id: string): Promise<Coupon | null>;
  updateCoupon(id: string, patch: Partial<Pick<Coupon, "displayName" | "businessId" | "imageUrl" | "customerCopy" | "termsText" | "active" | "expiresAt" | "deliverySource">>): Promise<Coupon>;
  listCampaigns(): Promise<Campaign[]>;
  createCampaign(input: NewCampaignInput): Promise<Campaign>;
  // Real, active locations behind the shared supermarket coupon campaign —
  // campaignKey is the coupon's campaignKey (e.g. luis_benefit_supermarket_20).
  listSupermarketLocations(campaignKey: string): Promise<SupermarketLocation[]>;
  updateSupermarketLocation(id: string, patch: Partial<Pick<SupermarketLocation, "officialMediaUrl">>): Promise<SupermarketLocation>;
}
