export type MessengerInboundEvent = {
  channel: "messenger";
  page_id: string;
  sender_id: string;
  mid: string;
  text: string;
  payload_action: string | null;
  timestamp: number;
};

function safeString(input: unknown): string {
  return typeof input === "string" || typeof input === "number"
    ? String(input).trim()
    : "";
}

export function extractMessengerEvents(body: any): MessengerInboundEvent[] {
  const events: MessengerInboundEvent[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const pageId = safeString(entry?.id);
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const item of messaging) {
      const senderId = safeString(item?.sender?.id);
      const timestamp = Number(item?.timestamp ?? Date.now());
      const message = item?.message;
      if (message && !message?.is_echo) {
        const mid = safeString(message?.mid);
        const text = safeString(message?.text);
        const payloadAction = safeString(message?.quick_reply?.payload) || null;
        if (pageId && senderId && mid && (text || payloadAction)) {
          events.push({
            channel: "messenger",
            page_id: pageId,
            sender_id: senderId,
            mid,
            text: text || payloadAction || "",
            payload_action: payloadAction,
            timestamp,
          });
        }
      }

      const postback = item?.postback;
      const postbackPayload = safeString(postback?.payload);
      if (pageId && senderId && postbackPayload) {
        events.push({
          channel: "messenger",
          page_id: pageId,
          sender_id: senderId,
          mid: `postback:${senderId}:${timestamp}:${postbackPayload}`,
          text: safeString(postback?.title) || postbackPayload,
          payload_action: postbackPayload,
          timestamp,
        });
      }
    }
  }
  return events;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function validateMetaSignature(args: {
  rawBody: string;
  signatureHeader: string | null;
  appSecret: string;
}): Promise<boolean> {
  const signature = safeString(args.signatureHeader).toLowerCase();
  const secret = safeString(args.appSecret);
  if (!signature.startsWith("sha256=") || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(args.rawBody)),
  );
  const expected = `sha256=${Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return timingSafeEqual(signature, expected);
}

export function resolveMessengerOrganization(
  rows: Array<{ organization_id?: unknown; business_type?: unknown; meta_page_id?: unknown; messenger_enabled?: unknown }>,
  pageId: string,
): { organizationId: string; businessType: string } | null {
  const matches = rows.filter((row) =>
    safeString(row.meta_page_id) === safeString(pageId) && row.messenger_enabled === true
  );
  if (matches.length !== 1) return null;
  const organizationId = safeString(matches[0].organization_id);
  if (!organizationId) return null;
  return {
    organizationId,
    businessType: safeString(matches[0].business_type),
  };
}
