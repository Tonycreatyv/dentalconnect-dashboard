import { createHash } from "node:crypto";

/** @param {string} value */
export function normalizeMessageText(value) {
  return value.replace(/\s+/g, " ").trim();
}

/** @param {string} className */
export function classifyDirection(className) {
  const classes = new Set(className.split(/\s+/).filter(Boolean));
  if (classes.has("message-in")) return "inbound";
  if (classes.has("message-out")) return "outbound";
  return "unknown";
}

/**
 * @param {{dataId?: string | null, chatIdentity: string, direction: string,
 * timestampEvidence?: string | null, text: string, domOrder: number}} input
 */
export function deriveObservedMessageId(input) {
  if (input.dataId) {
    return {
      id: input.dataId,
      source: "WHATSAPP_DATA_ID",
      productionGrade: true,
    };
  }

  const material = [
    input.chatIdentity,
    input.direction,
    input.timestampEvidence ?? "",
    normalizeMessageText(input.text),
    String(input.domOrder),
  ].join("\u001f");

  return {
    id: `observation:${createHash("sha256").update(material).digest("hex")}`,
    source: "PHASE1_OBSERVATION_FINGERPRINT",
    productionGrade: false,
  };
}

/**
 * @param {Set<string>} observed
 * @param {{id: string}} message
 */
export function isNewObservation(observed, message) {
  if (observed.has(message.id)) return false;
  observed.add(message.id);
  return true;
}

/**
 * Minimal debounce helper for repeated MutationObserver/polling discoveries.
 * @param {{lastKey: string | null, lastAt: number}} state
 * @param {string} key
 * @param {number} now
 * @param {number} windowMs
 */
export function acceptDebouncedObservation(state, key, now, windowMs) {
  if (state.lastKey === key && now - state.lastAt < windowMs) return false;
  state.lastKey = key;
  state.lastAt = now;
  return true;
}
