type Json = Record<string, unknown>;

export type ReferralQrEntryType =
  | "general"
  | "service"
  | "campaign"
  | "location";

export type ResolvedReferralQrEntry = {
  publicCode: string;
  entryType: ReferralQrEntryType;
  organizationId: string;
  serviceId: string | null;
  campaignKey: string | null;
  partnerLocationId: string | null;
  title: string;
  attributionLabel: string | null;
  attributionSource: string | null;
  whatsappPhone: string | null;
};

export type SupabaseQrResolver = { from(table: string): any };

const PUBLIC_CODE = /^[A-Za-z0-9_-]{12,64}$/;
const MARKER = /\[\[rhq:([A-Za-z0-9_-]{12,64})\]\]/i;
const META_TEST_DEMO_ORGANIZATION_ID = "luis-gabriel-referral-hub";
const META_TEST_DEMO_PHONE_NUMBER = "15551807992";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const optionalText = (value: unknown) => text(value) || null;
const activeAt = (row: Json, now: Date) =>
  row.active === true &&
  (!row.starts_at ||
    new Date(String(row.starts_at)).getTime() <= now.getTime()) &&
  (!row.expires_at ||
    new Date(String(row.expires_at)).getTime() > now.getTime());

export function isReferralQrPublicCode(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_CODE.test(value);
}

export function referralQrMarker(publicCode: string): string {
  if (!isReferralQrPublicCode(publicCode)) {
    throw new Error("invalid_qr_public_code");
  }
  return `[[rhq:${publicCode}]]`;
}

export function extractReferralQrPublicCode(value: string): string | null {
  return value.match(MARKER)?.[1] ?? null;
}

function usableWhatsAppPhone(value: unknown): string | null {
  const digits = text(value).replace(/\D/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

async function single(query: any): Promise<Json | null> {
  const result = await query;
  return result?.error || !result?.data || typeof result.data !== "object"
    ? null
    : result.data as Json;
}

export async function resolveReferralQrEntry(
  supabase: SupabaseQrResolver,
  publicCode: string,
  now = new Date(),
): Promise<ResolvedReferralQrEntry | null> {
  if (!isReferralQrPublicCode(publicCode)) return null;

  const entry = await single(
    supabase.from("referral_qr_entries")
      .select(
        "public_code,organization_id,entry_type,service_id,campaign_key,partner_location_id,active,starts_at,expires_at,attribution_label,attribution_source",
      )
      .eq("public_code", publicCode)
      .maybeSingle(),
  );
  if (!entry || !activeAt(entry, now)) return null;
  const entryType = text(entry.entry_type) as ReferralQrEntryType;
  const organizationId = text(entry.organization_id);
  if (
    !["general", "service", "campaign", "location"].includes(entryType) ||
    !organizationId
  ) return null;

  const organization = await single(
    supabase.from("organizations").select("id,name").eq("id", organizationId)
      .maybeSingle(),
  );
  if (!organization || text(organization.id) !== organizationId) return null;

  let serviceId = optionalText(entry.service_id);
  const campaignKey = optionalText(entry.campaign_key);
  const partnerLocationId = optionalText(entry.partner_location_id);
  let title = text(organization.name) || "Referral Hub";

  if (campaignKey) {
    const campaign = await single(
      supabase.from("referral_coupon_campaigns")
        .select(
          "organization_id,campaign_key,service_id,display_name,active,starts_at,expires_at",
        )
        .eq("organization_id", organizationId)
        .eq("campaign_key", campaignKey)
        .maybeSingle(),
    );
    if (
      !campaign || !activeAt(campaign, now) ||
      text(campaign.organization_id) !== organizationId
    ) return null;
    serviceId = text(campaign.service_id) || null;
    if (!serviceId) return null;
    title = text(campaign.display_name) || title;
  }

  if (serviceId) {
    const service = await single(
      supabase.from("service_configs")
        .select("id,organization_id,nombre,menu_label,activo")
        .eq("organization_id", organizationId)
        .eq("id", serviceId)
        .maybeSingle(),
    );
    if (
      !service || service.activo === false ||
      text(service.organization_id) !== organizationId
    ) return null;
    title = text(service.menu_label) || text(service.nombre) || title;
  }

  if (partnerLocationId) {
    const location = await single(
      supabase.from("referral_partner_locations")
        .select("id,organization_id,name,active")
        .eq("organization_id", organizationId)
        .eq("id", partnerLocationId)
        .maybeSingle(),
    );
    if (
      !location || location.active === false ||
      text(location.organization_id) !== organizationId
    ) return null;
    if (!serviceId && !campaignKey) title = text(location.name) || title;
  }

  const settings = await single(
    supabase.from("org_settings")
      .select("brand_name,whatsapp_enabled,whatsapp_phone_number")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  );
  const whatsappPhone = settings?.whatsapp_enabled === true
    ? usableWhatsAppPhone(settings.whatsapp_phone_number)
    : null;

  return {
    publicCode,
    entryType,
    organizationId,
    serviceId,
    campaignKey,
    partnerLocationId,
    title: text(settings?.brand_name) || title,
    attributionLabel: optionalText(entry.attribution_label),
    attributionSource: optionalText(entry.attribution_source),
    whatsappPhone,
  };
}

export function qrWhatsAppPrefill(entry: ResolvedReferralQrEntry): string {
  // Legacy grocery/coupon entries (unchanged wording — covered by existing tests).
  const isLegacySupermarketEntry = entry.serviceId === "luis_compra_super" ||
    entry.serviceId === "luis_cupon_super" ||
    entry.campaignKey === "mi_tierra_10";
  const isLegacyMedicalEntry = entry.serviceId === "luis_cupon_medico" ||
    entry.campaignKey === "medico_urgencias_20";
  // Current luis_benefit_* campaigns (the active production benefits system).
  const isBenefitSupermarketEntry = entry.serviceId === "luis_benefit_supermarket" ||
    entry.campaignKey === "luis_benefit_supermarket_20";
  const isBenefitMedicalEntry = entry.serviceId === "luis_benefit_medical" ||
    entry.campaignKey === "luis_benefit_medical_20";
  const isBenefitDentalEntry = entry.serviceId === "luis_benefit_dental" ||
    entry.campaignKey === "luis_benefit_dental_29";
  const isBenefitShippingEntry = entry.serviceId === "luis_benefit_shipping" ||
    entry.campaignKey === "luis_benefit_shipping_20";
  const message = isLegacyMedicalEntry
    ? "Quiero mi cupón médico"
    : isLegacySupermarketEntry
    ? "Quiero mi cupón de supermercado"
    : isBenefitMedicalEntry
    ? "Quiero mi beneficio médico"
    : isBenefitSupermarketEntry
    ? "Quiero mi beneficio de supermercado"
    : isBenefitDentalEntry
    ? "Quiero mi beneficio dental"
    : isBenefitShippingEntry
    ? "Quiero mi beneficio de envío"
    : "Hola, quiero conocer los servicios";
  return `${message} ${referralQrMarker(entry.publicCode)}`;
}

export function qrWhatsAppUrl(entry: ResolvedReferralQrEntry): string | null {
  if (!entry.whatsappPhone) return null;
  return `https://wa.me/${entry.whatsappPhone}?text=${
    encodeURIComponent(qrWhatsAppPrefill(entry))
  }`;
}

export function controlledDemoQrPhone(
  entry: ResolvedReferralQrEntry,
  demoEnabled: boolean,
): string | null {
  return demoEnabled &&
      entry.organizationId === META_TEST_DEMO_ORGANIZATION_ID &&
      !entry.whatsappPhone
    ? META_TEST_DEMO_PHONE_NUMBER
    : null;
}

export function publicReferralQrResolution(entry: ResolvedReferralQrEntry) {
  const whatsappUrl = qrWhatsAppUrl(entry);
  return whatsappUrl
    ? {
      available: true,
      public_code: entry.publicCode,
      entry_type: entry.entryType,
      title: entry.title,
      whatsapp_url: whatsappUrl,
    }
    : { available: false };
}

export function qrLeadAttribution(entry: ResolvedReferralQrEntry) {
  return {
    public_code: entry.publicCode,
    entry_type: entry.entryType,
    ...(entry.campaignKey ? { campaign_key: entry.campaignKey } : {}),
    ...(entry.attributionLabel ? { label: entry.attributionLabel } : {}),
    ...(entry.attributionSource ? { source: entry.attributionSource } : {}),
  };
}
