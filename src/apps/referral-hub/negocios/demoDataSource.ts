import type {
  Business,
  BusinessEditInput,
  Campaign,
  Coupon,
  NegociosDataSource,
  NewBusinessInput,
  NewCampaignInput,
  SupermarketLocation,
} from "./types";

// In-memory demo/seed data source — the ONLY active data source for this
// pass (see docs/proposed-migrations/20260822_draft_business_coupon_canonical_fields.sql:
// the columns this screen reads/writes don't exist in the live database
// yet). Every screen that reads from this adapter must show a "Datos de
// ejemplo" badge. Nothing here is a real production record, and "Guardar"
// only mutates this in-memory array — it does not persist anywhere.
//
// The medical coupon's customerCopy below must stay byte-identical to
// MEDICAL_SEEDED_TEMPLATE in
// supabase/functions/run-replies/tests/couponMessageTemplateParity.test.ts
// (that test is what proves this exact string reproduces today's real
// WhatsApp message).
const MEDICAL_SEEDED_CUSTOMER_COPY = [
  "¡Listo{{#customer_first_name}}, {{customer_first_name}}{{/customer_first_name}}! 🎉",
  "",
  "Tu beneficio ya está activo.",
  "",
  "{{benefit_name}}",
  "",
  "Código de activación: {{claim_code}}",
  "",
  "Guardá este mensaje y presentá tu beneficio en {{business_name}}.",
].join("\n");

let businesses: Business[] = [
  {
    id: "demo-business-medico-urgencias",
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
    requestCount: 12,
    faqs: [],
  },
  {
    id: "demo-business-dental-now-14",
    name: "Dental Now 14",
    categoryServiceId: "luis_benefit_dental",
    categoryLabel: "Dental",
    contactName: null,
    phone: null,
    addressText: null,
    postalCode: null,
    imageUrl: null,
    hours: {},
    offersCoupon: true,
    receivesServiceRequests: false,
    active: true,
    requestCount: 8,
    faqs: [],
  },
  {
    id: "demo-business-ultra-cargo",
    name: "Ultra Cargo",
    categoryServiceId: "luis_benefit_shipping",
    categoryLabel: "Envíos",
    contactName: null,
    phone: null,
    addressText: null,
    postalCode: null,
    imageUrl: null,
    hours: {},
    offersCoupon: true,
    receivesServiceRequests: false,
    active: true,
    requestCount: 5,
    faqs: [],
  },
  {
    id: "demo-business-mi-tierra-supermercados",
    name: "Mi Tierra Supermercados",
    categoryServiceId: "luis_benefit_supermarket",
    categoryLabel: "Supermercado",
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
  },
];

let coupons: Coupon[] = [
  {
    id: "demo-coupon-medical-20",
    businessId: "demo-business-medico-urgencias",
    campaignKey: "luis_benefit_medical_20",
    displayName: "20% de descuento en servicios médicos",
    imageUrl: "https://referral.creatyv.io/images/coupons/luis/medico-urgencias.jpeg",
    customerCopy: MEDICAL_SEEDED_CUSTOMER_COPY,
    termsText: "",
    active: true,
    expiresAt: null,
    deliverySource: "legacy",
  },
  {
    id: "demo-coupon-dental-29",
    businessId: "demo-business-dental-now-14",
    campaignKey: "luis_benefit_dental_29",
    displayName: "Consulta + limpieza + rayos X por $29",
    imageUrl: "https://referral.creatyv.io/images/coupons/luis/dental-now-14.jpeg",
    customerCopy: "",
    termsText: "",
    active: true,
    expiresAt: null,
    deliverySource: "legacy",
  },
  {
    id: "demo-coupon-shipping-20",
    businessId: "demo-business-ultra-cargo",
    campaignKey: "luis_benefit_shipping_20",
    displayName: "$20 de descuento en tu próximo envío",
    imageUrl: "https://referral.creatyv.io/images/coupons/luis/ultra-cargo.jpeg",
    customerCopy: "",
    termsText: "",
    active: true,
    expiresAt: null,
    deliverySource: "legacy",
  },
  {
    id: "demo-coupon-supermarket-20",
    businessId: "demo-business-mi-tierra-supermercados",
    campaignKey: "luis_benefit_supermarket_20",
    displayName: "$20 para tu compra de supermercado",
    imageUrl: "",
    customerCopy: "",
    termsText: "",
    active: true,
    expiresAt: null,
    deliverySource: "legacy",
  },
];

let supermarketLocations: SupermarketLocation[] = [
  { id: "demo-location-uno", locationKey: "demo-uno", displayName: "Supermercado Uno (ejemplo)", officialMediaUrl: "https://referral.creatyv.io/images/coupons/luis/el-sol-supermarket-30071.jpeg", postalCode: "30071", addressText: "" },
  { id: "demo-location-dos", locationKey: "demo-dos", displayName: "Supermercado Dos (ejemplo)", officialMediaUrl: "https://referral.creatyv.io/images/coupons/luis/mi-tierra-supermercados-30341.jpeg", postalCode: "30341", addressText: "" },
  { id: "demo-location-tres", locationKey: "demo-tres", displayName: "Supermercado Tres (ejemplo)", officialMediaUrl: "https://referral.creatyv.io/images/coupons/luis/el-guero-supermercado-30501.jpeg", postalCode: "30501", addressText: "" },
];

let campaigns: Campaign[] = [
  {
    id: "demo-campaign-medical-flyer",
    publicCode: "DEMOMED01",
    label: "Flyer consultorio — Médico Urgencias",
    promotes: { kind: "coupon", couponId: "demo-coupon-medical-20" },
    active: true,
    requestsCount: 12,
  },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 120));
}

const DEMO_CAPABILITIES = {
  canEditBusiness: true,
  canCreateBusiness: true,
  canEditCoupon: true,
  canUploadImages: false,
  canEditLocationImages: true,
};

export class DemoNegociosDataSource implements NegociosDataSource {
  readonly mode = "demo" as const;
  readonly capabilities = DEMO_CAPABILITIES;

  async listBusinesses(): Promise<Business[]> {
    return delay(clone(businesses));
  }

  async getBusiness(id: string): Promise<Business | null> {
    return delay(clone(businesses.find((b) => b.id === id) ?? null));
  }

  async createBusiness(input: NewBusinessInput): Promise<Business> {
    const business: Business = {
      id: `demo-business-${crypto.randomUUID()}`,
      hours: {},
      active: true,
      requestCount: 0,
      postalCode: null,
      imageUrl: null,
      faqs: [],
      categoryLabel: input.categoryServiceId,
      ...input,
    };
    businesses = [...businesses, business];
    return delay(clone(business));
  }

  async updateBusiness(id: string, patch: Partial<BusinessEditInput>): Promise<Business> {
    const existing = businesses.find((b) => b.id === id);
    if (!existing) throw new Error("Negocio de ejemplo no encontrado.");
    const updated = { ...existing, ...patch };
    businesses = businesses.map((b) => (b.id === id ? updated : b));
    return delay(clone(updated));
  }

  async listCoupons(): Promise<Coupon[]> {
    return delay(clone(coupons));
  }

  async getCoupon(id: string): Promise<Coupon | null> {
    return delay(clone(coupons.find((c) => c.id === id) ?? null));
  }

  async updateCoupon(id: string, patch: Partial<Coupon>): Promise<Coupon> {
    const existing = coupons.find((c) => c.id === id);
    if (!existing) throw new Error("Cupón de ejemplo no encontrado.");
    const updated = { ...existing, ...patch };
    coupons = coupons.map((c) => (c.id === id ? updated : c));
    return delay(clone(updated));
  }

  async listCampaigns(): Promise<Campaign[]> {
    return delay(clone(campaigns));
  }

  async createCampaign(input: NewCampaignInput): Promise<Campaign> {
    const campaign: Campaign = {
      id: `demo-campaign-${crypto.randomUUID()}`,
      publicCode: `DEMO${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      active: true,
      requestsCount: 0,
      ...input,
    };
    campaigns = [...campaigns, campaign];
    return delay(clone(campaign));
  }

  async listSupermarketLocations(campaignKey: string): Promise<SupermarketLocation[]> {
    if (campaignKey !== "luis_benefit_supermarket_20") return delay([]);
    return delay(clone(supermarketLocations));
  }

  async updateSupermarketLocation(id: string, patch: Partial<Pick<SupermarketLocation, "officialMediaUrl">>): Promise<SupermarketLocation> {
    const existing = supermarketLocations.find((l) => l.id === id);
    if (!existing) throw new Error("Ubicación de ejemplo no encontrada.");
    const updated = { ...existing, ...patch };
    supermarketLocations = supermarketLocations.map((l) => (l.id === id ? updated : l));
    return delay(clone(updated));
  }
}

export const demoNegociosDataSource = new DemoNegociosDataSource();
