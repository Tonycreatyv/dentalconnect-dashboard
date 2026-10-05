import { supabase } from "../../../lib/supabaseClient";

async function invoke(body: Record<string, unknown>) {
  const result = await supabase.functions.invoke("admin-client-case-edit", { body });
  if (result.error) throw new Error(result.error.message);
  if (!result.data?.success) throw new Error(result.data?.error || "No se pudo guardar el cambio.");
  return result.data;
}

export async function updateAdminClient(input: {
  leadId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
}) {
  return invoke({
    action: "update_client",
    lead_id: input.leadId,
    first_name: input.firstName,
    last_name: input.lastName,
    full_name: input.fullName,
    phone: input.phone,
    email: input.email,
  });
}

export async function updateAdminCaseDetails(input: {
  requestId: string;
  serviceId: string;
  city: string;
  postalCode: string;
  language: string;
  specialty: string;
}) {
  return invoke({
    action: "update_case",
    request_id: input.requestId,
    service_id: input.serviceId,
    city: input.city,
    postal_code: input.postalCode,
    language: input.language,
    specialty: input.specialty,
  });
}
