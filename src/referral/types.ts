export type ReferralStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "sent_to_partner"
  | "closed"
  | "not_qualified";

export type ReferralLead = {
  id: string;
  organization_id: string;
  service_id?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  name?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  channel_user_id?: string | null;
  extracted_data?: Record<string, unknown> | null;
  resumen_auto?: string | null;
  recomendacion?: string | null;
  partner_recomendado?: string | null;
};

export type ReferralService = {
  id: string;
  nombre?: string | null;
  menu_label?: string | null;
  icono?: string | null;
};

export type ReferralPartner = {
  id: string;
  nombre?: string | null;
  servicios?: string[] | null;
};

export type ReferralAssignmentSyncWarning = {
  assignmentId: string;
  leadId: string;
  partnerId: string;
};
