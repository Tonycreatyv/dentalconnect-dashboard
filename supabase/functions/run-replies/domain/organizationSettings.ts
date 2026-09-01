import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mergeDentalServiceTemplates } from "./serviceInfoHandler.ts";

export type OrganizationSettingsRecord = {
  organization_id: string;
  business_type: string;
  services: unknown[];
  faqs: unknown[];
  specialties: unknown[];
  hours: Record<string, unknown>;
  providers: unknown[];
  policies: Record<string, unknown>;
  location: Record<string, unknown>;
  integrations: Record<string, unknown>;
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type BusinessType = "dental" | "barbershop" | "insurance" | "referral_hub";

function normalizeBusinessType(value: unknown): BusinessType {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "insurance") return "insurance";
  if (raw === "referral_hub") return "referral_hub";
  return raw === "barbershop" ? "barbershop" : "dental";
}

export async function loadOrganizationSettings(
  supabase: SupabaseClient<any, "public", any>,
  organizationId: string,
): Promise<OrganizationSettingsRecord | null> {
  const res = await supabase
    .from("organization_settings")
    .select(
      "organization_id, business_type, services, faqs, specialties, hours, providers, policies, location, integrations",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (res.error || !res.data) return null;
  const row = res.data as Record<string, unknown>;
  return {
    organization_id: String(row.organization_id ?? organizationId),
    business_type: normalizeBusinessType(row.business_type),
    services: asArray(row.services),
    faqs: asArray(row.faqs),
    specialties: asArray(row.specialties),
    hours: asObject(row.hours),
    providers: asArray(row.providers),
    policies: asObject(row.policies),
    location: asObject(row.location),
    integrations: asObject(row.integrations),
  };
}

export function getBusinessTypeForOrg(
  settings: OrganizationSettingsRecord | null,
  fallback: unknown,
): BusinessType {
  return normalizeBusinessType(settings?.business_type ?? fallback);
}

export function getServicesForOrg(
  settings: OrganizationSettingsRecord | null,
  businessType: string,
): unknown[] {
  const source = asArray(settings?.services);
  if (source.length === 0) {
    return businessType === "barbershop" || businessType === "insurance" || businessType === "referral_hub"
      ? []
      : mergeDentalServiceTemplates([]);
  }
  if (businessType === "barbershop" || businessType === "insurance" || businessType === "referral_hub") return source;
  return mergeDentalServiceTemplates(source);
}

export function getFaqsForOrg(settings: OrganizationSettingsRecord | null): unknown[] {
  return asArray(settings?.faqs);
}

export function getProvidersForOrg(settings: OrganizationSettingsRecord | null): unknown[] {
  return asArray(settings?.providers);
}

export function getHoursForOrg(
  settings: OrganizationSettingsRecord | null,
): Record<string, unknown> {
  return asObject(settings?.hours);
}
