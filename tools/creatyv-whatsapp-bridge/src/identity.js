import { createHash } from "node:crypto";

const DIRECT_CHAT_DOMAINS = new Set(["c.us", "s.whatsapp.net", "lid"]);
const JID_PATTERN = /(?:^|_)([0-9]{5,}(?:-[0-9]+)?@(c\.us|s\.whatsapp\.net|lid|g\.us))(?:_|$)/i;
const PHONE_PATTERN = /(?:tel:|wa\.me\/|[?&]phone=)(\+?[0-9]{7,15})/i;

/** @param {string} value */
export function sha256Short(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Extract a browser-visible stable identity. Group identities are deliberately
 * rejected in this Luis one-to-one pilot.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function extractStableChatIdentity(value) {
  if (!value) return null;

  const jidMatch = value.match(JID_PATTERN);
  if (jidMatch) {
    const domain = jidMatch[2].toLowerCase();
    if (!DIRECT_CHAT_DOMAINS.has(domain)) return null;
    const localPart = jidMatch[1].split("@")[0];
    return domain === "lid" ? `jid:${jidMatch[1].toLowerCase()}` : `phone:${localPart}`;
  }

  const phoneMatch = value.match(PHONE_PATTERN);
  if (!phoneMatch) return null;
  return `phone:${phoneMatch[1].replace(/\D/g, "")}`;
}

/**
 * Require all browser-visible identity evidence to resolve to one exact chat.
 * @param {Array<string | null | undefined>} evidence
 */
export function proveStableChatIdentity(evidence) {
  const identities = [...new Set(evidence.map(extractStableChatIdentity).filter(Boolean))];
  if (identities.length !== 1) {
    return {
      proven: false,
      identity: null,
      reason: identities.length === 0 ? "NO_STABLE_IDENTITY" : "CONFLICTING_IDENTITIES",
      evidenceCount: identities.length,
    };
  }

  return {
    proven: true,
    identity: identities[0],
    reason: "EXACT_STABLE_IDENTITY",
    evidenceCount: identities.length,
  };
}

/** @param {string} identity */
export function sanitizeChatIdentity(identity) {
  const domain = identity.startsWith("jid:") ? identity.split("@").at(-1) : "phone";
  return `contact:${sha256Short(identity)}@${domain}`;
}

/** @param {string | null | undefined} left @param {string | null | undefined} right */
export function identitiesMatch(left, right) {
  return Boolean(left && right && left === right);
}
