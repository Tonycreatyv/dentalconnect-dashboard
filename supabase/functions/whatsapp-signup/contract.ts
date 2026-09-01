export const REFERRAL_HUB_ORGANIZATION_ID = "luis-gabriel-referral-hub";
export const WHATSAPP_STATE_MAX_AGE_SECONDS = 10 * 60;

export type SignupState = {
  organizationId: string;
  userId: string;
  nonce: string;
  issuedAt: number;
};

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function signingKey(secret: string) {
  return await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSignupState(userId: string, secret: string, now = Date.now()) {
  const payload: SignupState = {
    organizationId: REFERRAL_HUB_ORGANIZATION_ID,
    userId,
    nonce: crypto.randomUUID(),
    issuedAt: Math.floor(now / 1000),
  };
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), new TextEncoder().encode(encoded)));
  return `${encoded}.${base64Url(signature)}`;
}

export async function verifySignupState(token: string, userId: string, secret: string, now = Date.now()): Promise<SignupState | null> {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), fromBase64Url(signature), new TextEncoder().encode(encoded));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SignupState;
    const age = Math.floor(now / 1000) - payload.issuedAt;
    if (payload.organizationId !== REFERRAL_HUB_ORGANIZATION_ID || payload.userId !== userId || !payload.nonce || age < 0 || age > WHATSAPP_STATE_MAX_AGE_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function mayManageWhatsApp(role: unknown) {
  return role === "owner" || role === "admin";
}
