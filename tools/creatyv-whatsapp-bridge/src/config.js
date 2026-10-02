import { EXPECTED_BUSINESS_NUMBER, ORGANIZATION_ID, TEST_REPLY_TEXT } from "./constants.js";
import { validateRuntimePaths } from "./paths.js";

/** @param {NodeJS.ProcessEnv} [env] */
export function loadRuntimeConfig(env = process.env) {
  const paths = validateRuntimePaths();
  const pollIntervalMs = parseBoundedInteger(env.CREATYV_BRIDGE_POLL_MS, 750, 250, 5_000);
  const debounceMs = parseBoundedInteger(env.CREATYV_BRIDGE_DEBOUNCE_MS, 1_000, 250, 10_000);
  const outboundVerifyMs = parseBoundedInteger(
    env.CREATYV_BRIDGE_OUTBOUND_VERIFY_MS,
    12_000,
    2_000,
    60_000,
  );

  return Object.freeze({
    organizationId: ORGANIZATION_ID,
    expectedBusinessNumber: EXPECTED_BUSINESS_NUMBER,
    testReplyText: TEST_REPLY_TEXT,
    headless: false,
    pollIntervalMs,
    debounceMs,
    outboundVerifyMs,
    ...paths,
  });
}

/** @param {string | undefined} value @param {number} fallback @param {number} min @param {number} max */
function parseBoundedInteger(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}
