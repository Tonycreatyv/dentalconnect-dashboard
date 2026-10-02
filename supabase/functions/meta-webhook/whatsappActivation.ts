export type WhatsAppOrganizationSettings = {
  organization_id?: unknown;
  business_type?: unknown;
  whatsapp_phone_number_id?: unknown;
  whatsapp_waba_id?: unknown;
  whatsapp_enabled?: unknown;
  bot_enabled?: unknown;
  whatsapp_registered?: unknown;
  whatsapp_webhooks_subscribed?: unknown;
  whatsapp_onboarding_mode?: unknown;
  whatsapp_onboarding_event?: unknown;
  whatsapp_business_app_coexistence_completed?: unknown;
  updated_at?: unknown;
};

export type WhatsAppTenantResolution =
  | { status: "resolved"; settings: WhatsAppOrganizationSettings }
  | { status: "unmapped" | "ambiguous" | "phone_mismatch" | "waba_mismatch" };

const COEXISTENCE_EVENT = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function booleanFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  const normalized = text(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" ||
    normalized === "on";
}

export function resolveExactWhatsAppTenant(
  rows: WhatsAppOrganizationSettings[],
  phoneNumberId: string,
  wabaId: string,
): WhatsAppTenantResolution {
  const phone = text(phoneNumberId);
  const waba = text(wabaId);
  const candidates = rows.filter((row) =>
    text(row.organization_id) && text(row.whatsapp_phone_number_id) === phone
  );
  if (!phone || candidates.length === 0) return { status: "unmapped" };
  if (candidates.length > 1) return { status: "ambiguous" };

  const settings = candidates[0];
  if (text(settings.whatsapp_phone_number_id) !== phone) {
    return { status: "phone_mismatch" };
  }
  // WhatsApp message webhooks identify the WABA as entry.id. When present, it
  // must agree with the canonical WABA persisted for the exact phone mapping.
  if (waba && text(settings.whatsapp_waba_id) !== waba) {
    return { status: "waba_mismatch" };
  }
  return { status: "resolved", settings };
}

export function isPendingCoexistenceActivation(
  row: WhatsAppOrganizationSettings | null | undefined,
): boolean {
  return Boolean(
    row &&
      text(row.whatsapp_onboarding_event) === COEXISTENCE_EVENT &&
      text(row.whatsapp_onboarding_mode) === "COEXISTENCE" &&
      booleanFlag(row.whatsapp_business_app_coexistence_completed) &&
      booleanFlag(row.whatsapp_registered) &&
      booleanFlag(row.whatsapp_webhooks_subscribed) &&
      !booleanFlag(row.whatsapp_enabled),
  );
}

export function isWhatsAppAutomationAllowed(
  row: WhatsAppOrganizationSettings | null | undefined,
): boolean {
  return Boolean(
    row && booleanFlag(row.whatsapp_enabled) && booleanFlag(row.bot_enabled),
  );
}

export function isDuplicateDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return text(candidate.code) === "23505" ||
    text(candidate.message).toLowerCase().includes("duplicate");
}

/**
 * Builds a deterministic UUIDv8 for the one inbound message that proves a
 * pending coexistence connection is live. The existing messages primary key
 * then closes the race between duplicate webhook deliveries without requiring
 * a new column or index.
 */
export async function coexistenceActivationMessageId(
  organizationId: string,
  channel: string,
  providerMessageId: string,
): Promise<string> {
  const input = [
    "referral-hub:coexistence-activation:v1",
    text(organizationId),
    text(channel).toLowerCase(),
    text(providerMessageId),
  ].join("\u0000");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
  ).slice(0, 16);

  // RFC 9562 UUIDv8 (application-defined payload) and RFC variant bits.
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${
    hex.slice(6, 8).join("")
  }-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
