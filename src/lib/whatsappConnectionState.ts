export type CanonicalWhatsAppState = {
  whatsapp_enabled?: boolean | null;
  whatsapp_phone_number_id?: string | null;
  whatsapp_registered?: boolean | null;
  whatsapp_webhooks_subscribed?: boolean | null;
  whatsapp_onboarding_mode?: string | null;
  whatsapp_onboarding_event?: string | null;
  whatsapp_business_app_coexistence_completed?: boolean | null;
  whatsapp_token_expires_at?: string | null;
};

export type WhatsAppConnectionStatus =
  | "disconnected"
  | "pending_verification"
  | "onboarded_pending_activation"
  | "connected"
  | "error_registration"
  | "error_webhook"
  | "token_expired";

export function deriveWhatsAppConnectionStatus(
  row: CanonicalWhatsAppState | null,
): WhatsAppConnectionStatus {
  if (!row?.whatsapp_phone_number_id) return "disconnected";
  if (
    row.whatsapp_token_expires_at &&
    new Date(row.whatsapp_token_expires_at).getTime() <= Date.now()
  ) return "token_expired";
  if (!row.whatsapp_registered) return "error_registration";
  if (!row.whatsapp_webhooks_subscribed) return "error_webhook";
  if (
    !row.whatsapp_enabled &&
    row.whatsapp_onboarding_event ===
      "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" &&
    row.whatsapp_onboarding_mode === "COEXISTENCE" &&
    row.whatsapp_business_app_coexistence_completed === true
  ) return "onboarded_pending_activation";
  return row.whatsapp_enabled ? "connected" : "pending_verification";
}

export function mayStartWhatsAppEmbeddedSignup(role: string | null | undefined) {
  return role === "owner" || role === "admin";
}
