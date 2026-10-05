import { supabase } from "../../../lib/supabaseClient";
import { LEGAL_INTAKE_SERVICE_ID, parseLegalIntake } from "../operations/legalIntake";
import {
  BENEFIT_MERCHANT_NAME,
  BENEFIT_SERVICE_IDS,
  BENEFIT_STATIC_IMAGE,
  CAMPAIGN_KEY_BY_SERVICE,
  SERVICE_BY_CAMPAIGN_KEY,
  SERVICE_LABELS,
  type LuisServiceId,
} from "../operations/luisCatalog";
import type {
  Business,
  BusinessEditInput,
  Campaign,
  Coupon,
  DeliverySource,
  NegociosCapabilities,
  NegociosDataSource,
  NewBusinessInput,
  SupermarketLocation,
} from "./types";

// The real operational data source — reads exclusively from tables that
// exist and are populated TODAY (no draft migration required):
// referral_coupon_campaigns, referral_benefit_campaign_locations,
// referral_partners (restricted to confirmed active/paused partnership
// states, while intentionally keeping disabled or paused partners visible
// so an administrator can reactivate them), referral_benefit_claims for real
// request counts, and the live LuisServiceId catalog for merchant-backed
// and location-backed benefits used by the production WhatsApp path.
//
// Server persistence: referral_partners got real owner/admin write RLS +
// GRANT via docs/proposed-migrations/20260824_draft_A_business_identity_editing.sql
// (applied 2026-08-24, verified against pg_catalog immediately after —
// columns, CHECK constraints, RLS policies, and the INSERT/UPDATE GRANT
// all confirmed present). capabilities.canEditBusiness/canCreateBusiness
// are genuinely true now for businesses backed by a real referral_partners
// row (id prefixed "partner:").
//
// referral_coupon_campaigns got real owner/admin write RLS + GRANT via
// docs/proposed-migrations/20260824_draft_B_coupon_editing.sql (applied
// 2026-08-24, verified against pg_catalog immediately after). canEditCoupon
// is genuinely true now — every coupon id is already a real
// referral_coupon_campaigns row (unlike businesses, there is no pseudo id
// to guard against here). The one field that is NOT always representable
// is businessId: it can only be persisted for a business backed by a real
// referral_partners row (id prefixed "partner:"), since business_id is a
// real FK to that table. Derived merchant/location businesses remain
// read-only association targets until they have a canonical partner row.
//
// referral_benefit_campaign_locations got a real, deliberately narrow
// owner/admin write path via docs/proposed-migrations/20260824_draft_C_
// supermarket_location_media_editing.sql (applied 2026-08-24, verified
// against pg_catalog immediately after): a column-level GRANT UPDATE
// restricted to official_media_url ONLY (every other column — address_
// text, postal_code, display_name, campaign_id — stays SELECT-only at the
// database level, so even a future frontend bug cannot write them), plus
// an owner/admin RLS UPDATE policy. No INSERT policy exists — the real
// location rows already exist and are never created through this app.
// canEditLocationImages is genuinely true now. canUploadImages stays
// false (no Storage bucket exists yet). Derived merchant/location
// businesses still have no referral_partners row to write to directly.

const ORGANIZATION_ID = "luis-gabriel-referral-hub";

export class ReadOnlyError extends Error {
  constructor(detail: string) {
    super(`Solo lectura: ${detail}.`);
    this.name = "ReadOnlyError";
  }
}

type CampaignRow = {
  id: string;
  campaign_key: string;
  service_id: string;
  display_name: string;
  active: boolean;
  expires_at: string | null;
  business_id: string | null;
  image_url: string | null;
  customer_copy: string | null;
  terms_text: string | null;
  delivery_source: string;
};
type LocationRow = { id: string; campaign_id: string; location_key: string; display_name: string; postal_code: string; address_text: string; official_media_url: string; active: boolean };
type ClaimCountRow = { campaign_id: string; supermarket_location_id: string | null };
type PartnerRow = {
  id: string;
  name: string;
  partnership_status: string;
  active: boolean;
  category_service_id: string | null;
  contact_name: string | null;
  phone: string | null;
  address_text: string | null;
  postal_code: string | null;
  image_url: string | null;
  hours: Business["hours"] | null;
  faqs: Business["faqs"] | null;
  offers_coupon: boolean;
  receives_service_requests: boolean;
};

const CAMPAIGN_COLUMNS = "id,campaign_key,service_id,display_name,active,expires_at,business_id,image_url,customer_copy,terms_text,delivery_source";

async function loadCampaigns(): Promise<CampaignRow[]> {
  const result = await supabase.from("referral_coupon_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("organization_id", ORGANIZATION_ID);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as CampaignRow[];
}

async function loadLocations(): Promise<LocationRow[]> {
  const result = await supabase.from("referral_benefit_campaign_locations")
    .select("id,campaign_id,location_key,display_name,postal_code,address_text,official_media_url,active")
    .eq("organization_id", ORGANIZATION_ID)
    .eq("active", true);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as LocationRow[];
}

async function loadClaimCounts(): Promise<{ byCampaign: Map<string, number>; byLocation: Map<string, number> }> {
  const result = await supabase.from("referral_benefit_claims")
    .select("campaign_id,supermarket_location_id")
    .eq("organization_id", ORGANIZATION_ID);
  const byCampaign = new Map<string, number>();
  const byLocation = new Map<string, number>();
  if (!result.error) {
    for (const row of (result.data ?? []) as ClaimCountRow[]) {
      byCampaign.set(row.campaign_id, (byCampaign.get(row.campaign_id) ?? 0) + 1);
      if (row.supermarket_location_id) byLocation.set(row.supermarket_location_id, (byLocation.get(row.supermarket_location_id) ?? 0) + 1);
    }
  }
  return { byCampaign, byLocation };
}

async function loadConfirmedPartners(): Promise<PartnerRow[]> {
  const result = await supabase.from("referral_partners")
    .select("id,name,partnership_status,active,category_service_id,contact_name,phone,address_text,postal_code,image_url,hours,faqs,offers_coupon,receives_service_requests")
    .eq("organization_id", ORGANIZATION_ID)
    .in("partnership_status", ["active", "paused"]);
  if (result.error) return [];
  return (result.data ?? []) as PartnerRow[];
}

function partnerRowToBusiness(partner: PartnerRow): Business {
  return {
    id: `partner:${partner.id}`,
    name: partner.name,
    categoryServiceId: partner.category_service_id ?? "",
    categoryLabel: partner.category_service_id ? (SERVICE_LABELS[partner.category_service_id as LuisServiceId] ?? "Aliado confirmado") : "Aliado confirmado",
    contactName: partner.contact_name,
    phone: partner.phone,
    addressText: partner.address_text,
    postalCode: partner.postal_code,
    imageUrl: partner.image_url,
    hours: partner.hours ?? {},
    offersCoupon: partner.offers_coupon,
    receivesServiceRequests: partner.receives_service_requests,
    active: partner.partnership_status === "active" && partner.active,
    requestCount: 0,
    faqs: partner.faqs ?? [],
  };
}

function slugify(name: string): string {
  const base = name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "negocio";
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function campaignByServiceId(campaigns: CampaignRow[], serviceId: LuisServiceId): CampaignRow | undefined {
  const key = CAMPAIGN_KEY_BY_SERVICE[serviceId];
  return campaigns.find((c) => c.campaign_key === key) ?? campaigns.find((c) => c.service_id === serviceId && !c.campaign_key.startsWith("admin_draft_"));
}

const REAL_CAPABILITIES: NegociosCapabilities = {
  canEditBusiness: true,
  canCreateBusiness: true,
  canEditCoupon: true,
  canCreateCampaign: false,
  canUploadImages: false,
  canEditLocationImages: true,
};

function toSupermarketLocation(row: LocationRow): SupermarketLocation {
  return {
    id: row.id,
    locationKey: row.location_key,
    displayName: row.display_name,
    officialMediaUrl: row.official_media_url || "",
    postalCode: row.postal_code,
    addressText: row.address_text,
  };
}

export class RealNegociosDataSource implements NegociosDataSource {
  readonly mode = "supabase" as const;
  readonly capabilities = REAL_CAPABILITIES;

  async listBusinesses(): Promise<Business[]> {
    const [campaigns, locations, partners, claimCounts] = await Promise.all([loadCampaigns(), loadLocations(), loadConfirmedPartners(), loadClaimCounts()]);
    const businesses: Business[] = [];

    for (const serviceId of ["luis_benefit_medical", "luis_benefit_dental", "luis_benefit_shipping", "luis_benefit_taxes"] as LuisServiceId[]) {
      const name = BENEFIT_MERCHANT_NAME[serviceId];
      if (!name) continue;
      const campaign = campaignByServiceId(campaigns, serviceId);
      businesses.push({
        id: `merchant:${serviceId}`,
        name,
        categoryServiceId: serviceId,
        categoryLabel: SERVICE_LABELS[serviceId],
        contactName: null,
        phone: null,
        addressText: null,
        postalCode: null,
        imageUrl: null,
        hours: {},
        offersCoupon: true,
        receivesServiceRequests: false,
        active: campaign?.active ?? true,
        requestCount: campaign ? claimCounts.byCampaign.get(campaign.id) ?? 0 : 0,
        faqs: [],
      });
    }

    for (const location of locations) {
      const campaign = campaigns.find((item) => item.id === location.campaign_id);
      const categoryServiceId = campaign
        ? (SERVICE_BY_CAMPAIGN_KEY[campaign.campaign_key] ?? "luis_benefit_supermarket")
        : "luis_benefit_supermarket";
      businesses.push({
        id: `location:${location.location_key}`,
        name: location.display_name,
        categoryServiceId,
        categoryLabel: SERVICE_LABELS[categoryServiceId],
        contactName: null,
        phone: null,
        addressText: location.address_text || null,
        postalCode: location.postal_code || null,
        imageUrl: location.official_media_url || null,
        hours: {},
        offersCoupon: true,
        receivesServiceRequests: false,
        active: location.active,
        requestCount: claimCounts.byLocation.get(location.id) ?? 0,
        faqs: [],
      });
    }

    for (const partner of partners) {
      businesses.push(partnerRowToBusiness(partner));
    }

    return businesses;
  }

  async getBusiness(id: string): Promise<Business | null> {
    const all = await this.listBusinesses();
    return all.find((b) => b.id === id) ?? null;
  }

  async createBusiness(input: NewBusinessInput): Promise<Business> {
    const result = await supabase.from("referral_partners")
      .insert({
        organization_id: ORGANIZATION_ID,
        name: input.name,
        slug: slugify(input.name),
        partnership_status: "active",
        category_service_id: input.categoryServiceId || null,
        contact_name: input.contactName,
        phone: input.phone,
        address_text: input.addressText,
        offers_coupon: input.offersCoupon,
        receives_service_requests: input.receivesServiceRequests,
      })
      .select("id,name,partnership_status,active,category_service_id,contact_name,phone,address_text,postal_code,image_url,hours,faqs,offers_coupon,receives_service_requests")
      .single();
    if (result.error) throw new Error(result.error.message);
    return partnerRowToBusiness(result.data as PartnerRow);
  }

  async updateBusiness(id: string, patch: Partial<BusinessEditInput>): Promise<Business> {
    if (!id.startsWith("partner:")) {
      throw new ReadOnlyError("este negocio no tiene una fila persistible en referral_partners");
    }
    const partnerId = id.slice("partner:".length);
    const result = await supabase.from("referral_partners")
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.categoryServiceId !== undefined ? { category_service_id: patch.categoryServiceId || null } : {}),
        ...(patch.contactName !== undefined ? { contact_name: patch.contactName } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.addressText !== undefined ? { address_text: patch.addressText } : {}),
        ...(patch.postalCode !== undefined ? { postal_code: patch.postalCode } : {}),
        ...(patch.imageUrl !== undefined ? { image_url: patch.imageUrl } : {}),
        ...(patch.hours !== undefined ? { hours: patch.hours } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.offersCoupon !== undefined ? { offers_coupon: patch.offersCoupon } : {}),
        ...(patch.receivesServiceRequests !== undefined ? { receives_service_requests: patch.receivesServiceRequests } : {}),
        ...(patch.faqs !== undefined ? { faqs: patch.faqs } : {}),
      })
      .eq("organization_id", ORGANIZATION_ID)
      .eq("id", partnerId)
      .select("id,name,partnership_status,active,category_service_id,contact_name,phone,address_text,postal_code,image_url,hours,faqs,offers_coupon,receives_service_requests")
      .single();
    if (result.error) throw new Error(result.error.message);
    return partnerRowToBusiness(result.data as PartnerRow);
  }

  async listCoupons(): Promise<Coupon[]> {
    const campaigns = await loadCampaigns();
    const coupons: Coupon[] = [];
    for (const serviceId of BENEFIT_SERVICE_IDS) {
      const campaign = campaignByServiceId(campaigns, serviceId);
      if (!campaign) continue;
      const isLocationBased = serviceId === "luis_benefit_supermarket" || serviceId === "luis_benefit_mableton_parrillada";
      coupons.push({
        id: campaign.id,
        businessId: isLocationBased
          ? ""
          : (campaign.business_id ? `partner:${campaign.business_id}` : `merchant:${serviceId}`),
        campaignKey: campaign.campaign_key,
        displayName: campaign.display_name,
        imageUrl: campaign.image_url || BENEFIT_STATIC_IMAGE[serviceId] || "",
        customerCopy: campaign.customer_copy ?? "",
        termsText: campaign.terms_text ?? "",
        active: campaign.active,
        expiresAt: campaign.expires_at,
        deliverySource: (campaign.delivery_source === "db" ? "db" : "legacy") as DeliverySource,
      });
    }

    // Administrative drafts are deliberately excluded from the canonical
    // WhatsApp catalog, but they must remain visible/editable in Admin.
    // They are identified by the isolated key created by admin-coupon-management.
    const canonicalIds = new Set(coupons.map((coupon) => coupon.id));
    for (const campaign of campaigns) {
      if (canonicalIds.has(campaign.id) || !campaign.campaign_key.startsWith("admin_draft_")) continue;
      coupons.push({
        id: campaign.id,
        businessId: campaign.business_id ? `partner:${campaign.business_id}` : "",
        campaignKey: campaign.campaign_key,
        displayName: campaign.display_name,
        imageUrl: campaign.image_url || "",
        customerCopy: campaign.customer_copy ?? "",
        termsText: campaign.terms_text ?? "",
        active: false,
        expiresAt: campaign.expires_at,
        deliverySource: (campaign.delivery_source === "db" ? "db" : "legacy") as DeliverySource,
      });
    }

    return coupons;
  }

  async getCoupon(id: string): Promise<Coupon | null> {
    const all = await this.listCoupons();
    return all.find((c) => c.id === id) ?? null;
  }

  async updateCoupon(id: string, patch: Partial<Pick<Coupon, "displayName" | "businessId" | "imageUrl" | "customerCopy" | "termsText" | "active" | "expiresAt" | "deliverySource">>): Promise<Coupon> {
    const columns: Record<string, unknown> = {};
    if (patch.displayName !== undefined) columns.display_name = patch.displayName;
    if (patch.imageUrl !== undefined) columns.image_url = patch.imageUrl || null;
    if (patch.customerCopy !== undefined) columns.customer_copy = patch.customerCopy || null;
    if (patch.termsText !== undefined) columns.terms_text = patch.termsText || null;
    if (patch.active !== undefined) columns.active = patch.active;
    if (patch.expiresAt !== undefined) columns.expires_at = patch.expiresAt;
    if (patch.deliverySource !== undefined) columns.delivery_source = patch.deliverySource;

    if (patch.businessId !== undefined) {
      if (patch.businessId === "") columns.business_id = null;
      else if (patch.businessId.startsWith("partner:")) columns.business_id = patch.businessId.slice("partner:".length);
      else throw new ReadOnlyError("el negocio seleccionado no tiene una fila persistible para vincular el cupón");
    }

    if (Object.keys(columns).length > 0) {
      const result = await supabase.from("referral_coupon_campaigns")
        .update(columns)
        .eq("organization_id", ORGANIZATION_ID)
        .eq("id", id)
        .select("id")
        .single();
      if (result.error) throw new Error(result.error.message);
    }

    const updated = await this.getCoupon(id);
    if (!updated) throw new Error("Cupón no encontrado.");
    return updated;
  }

  async listCampaigns(): Promise<Campaign[]> {
    const result = await supabase.from("referral_qr_entries")
      .select("id,public_code,attribution_label,entry_type,service_id,campaign_key,active")
      .eq("organization_id", ORGANIZATION_ID);
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []) as Array<{ id: string; public_code: string; attribution_label: string | null; entry_type: string; service_id: string | null; campaign_key: string | null; active: boolean }>;
    return rows.map((row) => ({
      id: row.id,
      publicCode: row.public_code,
      label: row.attribution_label || row.public_code,
      promotes: row.campaign_key
        ? { kind: "coupon" as const, couponId: row.campaign_key }
        : row.service_id
          ? { kind: "service" as const, serviceId: row.service_id }
          : { kind: "menu" as const },
      active: row.active,
      requestsCount: 0,
    }));
  }

  async createCampaign(): Promise<Campaign> {
    throw new ReadOnlyError("crear campañas está deshabilitado en esta sesión de auditoría — la política de escritura de referral_qr_entries es real, pero mutar producción no está aprobado para esta tarea");
  }

  async listSupermarketLocations(campaignKey: string): Promise<SupermarketLocation[]> {
    const [campaigns, locations] = await Promise.all([loadCampaigns(), loadLocations()]);
    const campaign = campaigns.find((c) => c.campaign_key === campaignKey);
    if (!campaign) return [];
    return locations
      .filter((location) => location.campaign_id === campaign.id)
      .map(toSupermarketLocation);
  }

  async updateSupermarketLocation(id: string, patch: Partial<Pick<SupermarketLocation, "officialMediaUrl">>): Promise<SupermarketLocation> {
    if (patch.officialMediaUrl === undefined) {
      const locations = await loadLocations();
      const row = locations.find((l) => l.id === id);
      if (!row) throw new Error("Ubicación no encontrada.");
      return toSupermarketLocation(row);
    }
    const result = await supabase.from("referral_benefit_campaign_locations")
      .update({ official_media_url: patch.officialMediaUrl })
      .eq("organization_id", ORGANIZATION_ID)
      .eq("id", id)
      .select("id,campaign_id,location_key,display_name,postal_code,address_text,official_media_url,active")
      .single();
    if (result.error) throw new Error(result.error.message);
    return toSupermarketLocation(result.data as LocationRow);
  }
}

export type RealServiceRow = {
  serviceId: LuisServiceId;
  label: string;
  kind: "benefit" | "professional";
  requestCount: number;
  hasCustomerFacingRoute: boolean;
};

export async function loadRealServiceRows(): Promise<RealServiceRow[]> {
  const [campaigns, claims, leadsWithState] = await Promise.all([
    loadCampaigns(),
    supabase.from("referral_benefit_claims").select("campaign_id").eq("organization_id", ORGANIZATION_ID),
    supabase.from("leads").select("state").eq("organization_id", ORGANIZATION_ID),
  ]);
  const claimsByCampaign = new Map<string, number>();
  for (const row of (claims.data ?? []) as Array<{ campaign_id: string }>) {
    claimsByCampaign.set(row.campaign_id, (claimsByCampaign.get(row.campaign_id) ?? 0) + 1);
  }
  const legalIntakesByService = new Map<string, number>();
  for (const row of (leadsWithState.data ?? []) as Array<{ state: unknown }>) {
    const intake = parseLegalIntake(row.state);
    if (!intake) continue;
    const serviceId = LEGAL_INTAKE_SERVICE_ID[intake.intakeType];
    legalIntakesByService.set(serviceId, (legalIntakesByService.get(serviceId) ?? 0) + 1);
  }
  const benefitRows: RealServiceRow[] = BENEFIT_SERVICE_IDS.map((serviceId) => {
    const campaign = campaignByServiceId(campaigns, serviceId);
    return {
      serviceId,
      label: SERVICE_LABELS[serviceId],
      kind: "benefit",
      requestCount: campaign ? claimsByCampaign.get(campaign.id) ?? 0 : 0,
      hasCustomerFacingRoute: Boolean(campaign?.active),
    };
  });
  const professionalRows: RealServiceRow[] = (["luis_inmigracion", "luis_accidente"] as LuisServiceId[]).map((serviceId) => ({
    serviceId,
    label: SERVICE_LABELS[serviceId],
    kind: "professional",
    requestCount: legalIntakesByService.get(serviceId) ?? 0,
    hasCustomerFacingRoute: true,
  }));
  return [...benefitRows, ...professionalRows];
}

export const realNegociosDataSource = new RealNegociosDataSource();