const SECRET_KEY_PATTERN =
  /(access.?token|client.?secret|service.?role|api.?key|authorization|password|cookie|local.?storage|session.?storage|qr.?payload|\bpin\b)/i;

/** @param {unknown} value @returns {unknown} */
export function sanitizeForLog(value) {
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (!value || typeof value !== "object") return value;

  /** @type {Record<string, unknown>} */
  const safe = {};
  for (const [key, nested] of Object.entries(value)) {
    safe[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeForLog(nested);
  }
  return safe;
}

/** @param {string} event @param {Record<string, unknown>} [details] */
export function safeLog(event, details = {}) {
  const sanitized = sanitizeForLog(details);
  const safeDetails = sanitized && typeof sanitized === "object" ? sanitized : {};
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...safeDetails }));
}
