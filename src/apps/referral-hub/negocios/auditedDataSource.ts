import { supabase } from "../../../lib/supabaseClient";
import { realNegociosDataSource } from "./realDataSource";
import type { Business, BusinessEditInput, NegociosDataSource, NewBusinessInput } from "./types";

async function invokePartner(body: Record<string, unknown>) {
  const result = await supabase.functions.invoke("admin-partner-management", { body });
  if (result.error) throw new Error(result.error.message);
  if (!result.data?.success) throw new Error(result.data?.error || "No se pudo guardar el partner.");
  return result.data;
}

async function reloadPartner(partnerId: string): Promise<Business> {
  const business = await realNegociosDataSource.getBusiness(`partner:${partnerId}`);
  if (!business) throw new Error("El partner se guardó pero no pudo recargarse.");
  return business;
}

export const auditedNegociosDataSource: NegociosDataSource = {
  mode: realNegociosDataSource.mode,
  capabilities: realNegociosDataSource.capabilities,
  listBusinesses: () => realNegociosDataSource.listBusinesses(),
  getBusiness: (id) => realNegociosDataSource.getBusiness(id),

  async createBusiness(input: NewBusinessInput) {
    const data = await invokePartner({
      action: "create",
      name: input.name,
      category_service_id: input.categoryServiceId || null,
      contact_name: input.contactName,
      phone: input.phone,
      address_text: input.addressText,
      offers_coupon: input.offersCoupon,
      receives_service_requests: input.receivesServiceRequests,
    });
    return reloadPartner(String(data.partner.id));
  },

  async updateBusiness(id: string, patch: Partial<BusinessEditInput>) {
    if (!id.startsWith("partner:")) throw new Error("Este negocio no es editable como partner persistido.");
    const serverPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) serverPatch.name = patch.name;
    if (patch.categoryServiceId !== undefined) serverPatch.category_service_id = patch.categoryServiceId || null;
    if (patch.contactName !== undefined) serverPatch.contact_name = patch.contactName;
    if (patch.phone !== undefined) serverPatch.phone = patch.phone;
    if (patch.addressText !== undefined) serverPatch.address_text = patch.addressText;
    if (patch.postalCode !== undefined) serverPatch.postal_code = patch.postalCode;
    if (patch.imageUrl !== undefined) serverPatch.image_url = patch.imageUrl;
    if (patch.hours !== undefined) serverPatch.hours = patch.hours;
    if (patch.active !== undefined) serverPatch.active = patch.active;
    if (patch.offersCoupon !== undefined) serverPatch.offers_coupon = patch.offersCoupon;
    if (patch.receivesServiceRequests !== undefined) serverPatch.receives_service_requests = patch.receivesServiceRequests;
    if (patch.faqs !== undefined) serverPatch.faqs = patch.faqs;
    await invokePartner({ action: "update", partner_id: id.slice("partner:".length), patch: serverPatch });
    return reloadPartner(id.slice("partner:".length));
  },

  listCoupons: () => realNegociosDataSource.listCoupons(),
  getCoupon: (id) => realNegociosDataSource.getCoupon(id),
  updateCoupon: (id, patch) => realNegociosDataSource.updateCoupon(id, patch),
  listCampaigns: () => realNegociosDataSource.listCampaigns(),
  createCampaign: () => realNegociosDataSource.createCampaign(),
  listSupermarketLocations: (campaignKey) => realNegociosDataSource.listSupermarketLocations(campaignKey),
  updateSupermarketLocation: (id, patch) => realNegociosDataSource.updateSupermarketLocation(id, patch),
};
