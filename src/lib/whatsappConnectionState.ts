export type CanonicalWhatsAppState = {
  whatsapp_enabled?: boolean | null;
  whatsapp_phone_number_id?: string | null;
  whatsapp_registered?: boolean | null;
  whatsapp_webhooks_subscribed?: boolean | null;
  whatsapp_token_expires_at?: string | null;
};

export type WhatsAppConnectionStatus =
  | "disconnected"
  | "pending_verification"
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
  return row.whatsapp_enabled ? "connected" : "pending_verification";
}

export function mayStartWhatsAppEmbeddedSignup(role: string | null | undefined) {
  return role === "owner" || role === "admin";
}
