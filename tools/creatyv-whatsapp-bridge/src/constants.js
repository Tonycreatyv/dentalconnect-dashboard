export const ORGANIZATION_ID = "luis-gabriel-referral-hub";
export const EXPECTED_BUSINESS_NUMBER = "+1 770-713-7058";
export const WHATSAPP_WEB_URL = "https://web.whatsapp.com/";
export const TEST_REPLY_TEXT = "WhatsApp Web adapter test received successfully.";

export const RuntimeState = Object.freeze({
  STARTING: "STARTING",
  QR_LOGIN_REQUIRED: "QR_LOGIN_REQUIRED",
  READY: "READY",
  DEGRADED: "DEGRADED",
  PAUSED: "PAUSED",
  FAILED: "FAILED",
});

export const SelectorHealth = Object.freeze({
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  FAILED: "FAILED",
});

export const SendResult = Object.freeze({
  SENT: "SENT",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
});
