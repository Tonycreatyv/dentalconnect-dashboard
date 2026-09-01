import { supabase } from "../../../lib/supabaseClient";
import { LEGAL_INTAKE_SERVICE_ID, parseLegalIntake } from "../operations/legalIntake";
import {
  BENEFIT_MERCHANT_NAME,
  BENEFIT_SERVICE_IDS,
  BENEFIT_STATIC_IMAGE,
  CAMPAIGN_KEY_BY_SERVICE,
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
// referral_partners (filtered to partnership_status='active' — every row
// today is 'demo_reference', so this genuinely returns none until a real
// partnership is confirmed, rather than showing the grocery-delivery demo
// rows as if they were real participating businesses), referral_benefit_claims
// for real request counts, and the hardcoded LuisServiceId catalog for the
// three merchants (Médico Urgencias/Dental Now 14/Ultra Cargo) that are
// real and live in the WhatsApp send path but have no referral_partners row.
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
// real FK to that table — selecting one of the three hardcoded merchant
// businesses or a supermarket location (no referral_partners row at all)
// stays a session-local-only selection, same honesty rule as
// updateBusiness below.
//
// referral_benefit_campaign_locations got a real, deliberately narrow
// owner/admin write path via docs/proposed-migrations/20260824_draft_C_
// supermarket_location_media_editing.sql (applied 2026-08-24, verified
// against pg_catalog immediately after): a column-level GRANT UPDATE
// restricted to official_media_url ONLY (every other column — address_
// text, postal_code, display_name, campaign_id — stays SELECT-only at the
// database level, so even a future frontend bug cannot write them), plus
// an owner/admin RLS UPDATE policy. No INSERT policy exists — the 3 real
// location rows already exist and are never created through this app.
// canEditLocationImages is genuinely true now. canUploadImages stays
// false (no Storage bucket exists yet). The three hardcoded merchant
// businesses (Médico Urgencias/Dental Now 14/Ultra Cargo, id prefixed
// "merchant:") still have no referral_partners row to write to at all —
// editing those still lands in the session-local overlay below, and the
// UI must check business.id.startsWith("partner:") before trusting
// capabilities.canEditBusiness for a given business (see BusinessDetail.tsx).

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

async function loadActivePartners(): Promise<PartnerRow[]> {
  const result = await supabase.from("referral_partners")
    .select("id,name,partnership_status,active,category_service_id,contact_name,phone,address_text,postal_code,image_url,hours,faqs,offers_coupon,receives_service_requests")
    .eq("organization_id", ORGANIZATION_ID)
    .eq("partnership_status", "active")
    .eq("active", true);
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
    active: partner.active,
    requestCount: 0,
    faqs: partner.faqs ?? [],
  };
}

function slugify(name: string): string {
  const base = name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "negocio";
  // Uniqueness is enforced by the real UNIQUE(organization_id, slug)
  // constraint — this suffix only reduces the odds of a collision the
  // caller would otherwise have to retry on; the constraint is the real
  // guarantee, not this.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function campaignByServiceId(campaigns: CampaignRow[], serviceId: LuisServiceId): CampaignRow | undefined {
  const key = CAMPAIGN_KEY_BY_SERVICE[serviceId];
  return campaigns.find((c) => c.campaign_key === key) ?? campaigns.find((c) => c.service_id === serviceId);
}

// canEditBusiness/canCreateBusiness are genuinely true (Gate 1-A applied
// 2026-08-24: referral_partners has real owner/admin write RLS + GRANT
// now). Callers must still check business.id.startsWith("partner:") before
// trusting canEditBusiness for a SPECIFIC business — the merchant:/
// location: derived businesses have no referral_partners row to write to
// (see the class-level comment above).
//
// canEditCoupon is genuinely true (Gate 1-B applied 2026-08-24:
// referral_coupon_campaigns has real owner/admin write RLS + GRANT now) —
// no id-prefix check is needed for coupons the way there is for
// businesses, since every coupon id is already a real row.
//
// canEditLocationImages is genuinely true (Gate 1-C applied 2026-08-24:
// referral_benefit_campaign_locations has a real owner/admin UPDATE path,
// column-restricted to official_media_url — see the class-level comment).
// canUploadImages stays honestly false: no Storage bucket exists yet (see
// docs/proposed-migrations/20260822_draft_coupon_media_storage_BLOCKED.sql) —
// the location editor still only accepts a pasted HTTPS URL, no file picker.
const REAL_CAPABILITIES: NegociosCapabilities = {
  canEditBusiness: true,
  canCreateBusiness: true,
  canEditCoupon: true,
  canUploadImages: false,
  canEditLocationImages: true,
};

// Session-only local overlay (never sent to Supabase, cleared on reload) so
// the editing UI is genuinely usable end-to-end without claiming server
// persistence that doesn't exist yet.
const localBusinessEdits = new Map<string, Partial<Business>>();
const localOnlyBusinesses: Business[] = [];
const localCouponEdits = new Map<string, Partial<Coupon>>();
const localLocationEdits = new Map<string, Partial<SupermarketLocation>>();

function toSupermarketLocation(row: LocationRow): SupermarketLocation {
  return {
    id: row.id,
    locationKey: row.location_key,
    displayName: row.display_name,
    officialMediaUrl: row.official_media_url || "",
    postalCode: row.postal_code,
    addressText: row.address_text,
    ...(localLocationEdits.get(row.id) ?? {}),
  };
}

export class RealNegociosDataSource implements NegociosDataSource {
  readonly mode = "supabase" as const;
  readonly capabilities = REAL_CAPABILITIES;

  async listBusinesses(): Promise<Business[]> {
    const [campaigns, locations, partners, claimCounts] = await Promise.all([loadCampaigns(), loadLocations(), loadActivePartners(), loadClaimCounts()]);
    const businesses: Business[] = [];

    for (const serviceId of ["luis_benefit_medical", "luis_benefit_dental", "luis_benefit_shipping"] as LuisServiceId[]) {
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

    // Each active supermarket location is its own business — never merged
    // into a single generic "Supermercado" card.
    for (const location of locations) {
      businesses.push({
        // Suffixed with the real location_key (not the raw uuid) so this id
        // is directly usable as the /negocios/solicitudes?location= filter —
        // that's the same key referral_benefit_claims/useCouponDemand
        // already group by, avoiding a second lookup just to link correctly.
        id: `location:${location.location_key}`,
        name: location.display_name,
        categoryServiceId: "luis_benefit_supermarket",
        categoryLabel: SERVICE_LABELS.luis_benefit_supermarket,
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

    // Apply the local-only overlay (never sent to Supabase) so edited
    // fields and newly added businesses show up immediately in this
    // session, and merge it in for both real and local-only businesses.
    const merged = [...businesses, ...localOnlyBusinesses].map((business) => ({
      ...business,
      ...(localBusinessEdits.get(business.id) ?? {}),
    }));
    return merged;
  }

  async getBusiness(id: string): Promise<Business | null> {
    const all = await this.listBusinesses();
    return all.find((b) => b.id === id) ?? null;
  }

  // Real write: referral_partners has owner/admin INSERT RLS + GRANT
  // (Gate 1-A, applied 2026-08-24). partnership_status is set to 'active'
  // explicitly — a business created through this form is a real confirmed
  // partner, not a 'demo_reference' row, so it appears immediately in
  // listBusinesses() (which only reads partnership_status='active' rows).
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

  // Real write for a business backed by an actual referral_partners row
  // (id prefixed "partner:") — scoped by both organization_id and id, so
  // RLS and this query agree on the same boundary. The three hardcoded
  // merchant businesses and the three supermarket locations have no
  // referral_partners row at all (Gate 1-B/1-C territory, not this file)
  // and keep using the session-local overlay exactly as before — never
  // silently claiming a persistence path that doesn't exist for them.
  async updateBusiness(id: string, patch: Partial<BusinessEditInput>): Promise<Business> {
    if (!id.startsWith("partner:")) {
      const current = localBusinessEdits.get(id) ?? {};
      localBusinessEdits.set(id, { ...current, ...patch });
      const updated = await this.getBusiness(id);
      if (!updated) throw new Error("Negocio no encontrado.");
      return updated;
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
      const isSupermarket = serviceId === "luis_benefit_supermarket";
      coupons.push({
        id: campaign.id,
        // Supermarket has no single business — it is genuinely
        // multi-location (see referral_benefit_campaign_locations) — left
        // empty rather than arbitrarily pointing at one location. For
        // every other coupon, a real linked referral_partners row (set via
        // updateCoupon) wins; otherwise fall back to the hardcoded merchant
        // pseudo-business exactly as before this row was ever linkable.
        businessId: isSupermarket
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
    // Local-only overlay — only ever holds a businessId for a merchant:/
    // location: selection that has no real row to persist to (see
    // updateCoupon); every other field is real once written.
    return coupons.map((coupon) => ({ ...coupon, ...(localCouponEdits.get(coupon.id) ?? {}) }));
  }

  async getCoupon(id: string): Promise<Coupon | null> {
    const all = await this.listCoupons();
    return all.find((c) => c.id === id) ?? null;
  }

  // Real write: referral_coupon_campaigns has owner/admin UPDATE RLS +
  // GRANT (Gate 1-B, applied 2026-08-24). businessId is the one field that
  // cannot always be represented as the real business_id FK — see the
  // class-level comment — so a merchant:/location: selection is kept as a
  // session-local overlay instead of being written or silently dropped.
  async updateCoupon(id: string, patch: Partial<Pick<Coupon, "displayName" | "businessId" | "imageUrl" | "customerCopy" | "termsText" | "active" | "expiresAt" | "deliverySource">>): Promise<Coupon> {
    const columns: Record<string, unknown> = {};
    if (patch.displayName !== undefined) columns.display_name = patch.displayName;
    if (patch.imageUrl !== undefined) columns.image_url = patch.imageUrl || null;
    if (patch.customerCopy !== undefined) columns.customer_copy = patch.customerCopy || null;
    if (patch.termsText !== undefined) columns.terms_text = patch.termsText || null;
    if (patch.active !== undefined) columns.active = patch.active;
    if (patch.expiresAt !== undefined) columns.expires_at = patch.expiresAt;
    if (patch.deliverySource !== undefined) columns.delivery_source = patch.deliverySource;

    let localBusinessId: string | undefined;
    if (patch.businessId !== undefined) {
      if (patch.businessId === "") columns.business_id = null;
      else if (patch.businessId.startsWith("partner:")) columns.business_id = patch.businessId.slice("partner:".length);
      else localBusinessId = patch.businessId;
    }

    if (Object.keys(columns).length > 0) {
      const result = await supabase.from("referral_coupon_campaigns")
        .update(columns)
        .eq("organization_id", ORGANIZATION_ID)
        .eq("id", id)
        .select("id")
        .single();
      if (result.error) throw new Error(result.error.message);
      // A real write just landed for this id — drop any stale session-local
      // overlay so it can never shadow the freshly persisted values on the
      // next read (re-applied below only if businessId is still
      // unpersistable this call).
      localCouponEdits.delete(id);
    }
    if (localBusinessId !== undefined) {
      localCouponEdits.set(id, { ...(localCouponEdits.get(id) ?? {}), businessId: localBusinessId });
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
      // Attribution is heuristic (see round-3/4 notes: derived from the
      // lead's most recently scanned QR at claim time, not a durable FK) —
      // reported honestly as 0 rather than computed with a misleading
      // precision this adapter cannot actually back up in one query.
      requestsCount: 0,
    }));
  }

  async createCampaign(): Promise<Campaign> {
    // referral_qr_entries does have real owner/admin write RLS (established
    // in an earlier round) — this is NOT a schema/RLS limitation like the
    // other ReadOnlyErrors above. It is intentionally disabled for this
    // session specifically because this round's mission constraints say
    // "do not create or mutate production records" without separate
    // approval, and creating a campaign here would do exactly that against
    // the real organization. Re-enabling this is a one-line change once
    // that approval is given.
    throw new ReadOnlyError("crear campañas está deshabilitado en esta sesión de auditoría — la política de escritura de referral_qr_entries es real, pero mutar producción no está aprobado para esta tarea");
  }

  // Real, active locations behind the shared supermarket coupon campaign —
  // never a single global image. campaignKey scopes this to the actual
  // referral_coupon_campaigns row (so a future second location-based
  // campaign, if it ever existed, could never bleed into this one).
  async listSupermarketLocations(campaignKey: string): Promise<SupermarketLocation[]> {
    const [campaigns, locations] = await Promise.all([loadCampaigns(), loadLocations()]);
    const campaign = campaigns.find((c) => c.campaign_key === campaignKey);
    if (!campaign) return [];
    return locations
      .filter((location) => location.campaign_id === campaign.id)
      .map(toSupermarketLocation);
  }

  // Real write: referral_benefit_campaign_locations has an owner/admin
  // UPDATE RLS policy + a column-level GRANT restricted to
  // official_media_url (Gate 1-C, applied 2026-08-24) — so this is the
  // only field this method (or the database) will ever accept here, which
  // matches this method's own type signature. Scoped to ONE location's
  // real id AND this organization, so an edit here can never leak into
  // another store's image or another organization's row, and never
  // touches referral_coupon_campaigns.image_url (the shared campaign
  // fallback for non-location benefits) — the supermarket benefit never
  // reads that column at all (see couponImagePrecedence.test.ts).
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
    // A real write just landed — drop any stale session-local overlay for
    // this id so it can never shadow the freshly persisted value.
    localLocationEdits.delete(id);
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

// The canonical, real service catalog (matches src/apps/referral-hub/operations/luisCatalog.ts
// exactly — the same file the live WhatsApp send path is built from) with
// real request counts. "luis_representante" (generic "talk to our team")
// is intentionally excluded — it is a handoff destination, not a service
// customers request by category.
//
// Professional-service counts (immigration/accident) are NOT read from
// referral_service_requests: that table/RPC path is only reachable from
// the older, no-longer-primary conversational text menu — the real,
// published Unified Services WhatsApp Flow persists a completed intake
// directly on leads.state.collected.luis_legal_last_completed instead (see
// buildLuisLegalFlowCompletionResult in run-replies/index.ts, and
// operations/legalIntake.ts, the shared parser also used by
// useContactDetail.ts for the lead detail screen). Using
// referral_service_requests here would show 0 forever for any real Flow
// submission even though the dashboard's own lead detail page shows it.
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
