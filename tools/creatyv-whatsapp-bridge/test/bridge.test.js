import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadRuntimeConfig } from "../src/config.js";
import { SelectorHealth, SendResult, TEST_REPLY_TEXT } from "../src/constants.js";
import { buildFutureInboundEvent } from "../src/futureApi.js";
import { classifySelectorHealth, classifySendResult } from "../src/health.js";
import {
  extractStableChatIdentity,
  identitiesMatch,
  proveStableChatIdentity,
  sanitizeChatIdentity,
} from "../src/identity.js";
import {
  acceptDebouncedObservation,
  classifyDirection,
  deriveObservedMessageId,
} from "../src/messages.js";
import { isPathInside, WORKER_ROOT } from "../src/paths.js";
import { sanitizeForLog } from "../src/safeLogger.js";

test("extracts and compares stable direct-chat identity without using display name", () => {
  const identity = extractStableChatIdentity("false_17812961757@c.us_3EB0ABC");
  assert.equal(identity, "phone:17812961757");
  assert.equal(identitiesMatch(identity, "phone:17812961757"), true);
  assert.equal(identitiesMatch(identity, "phone:17707137058"), false);
  assert.match(sanitizeChatIdentity(identity), /^contact:[a-f0-9]{16}@phone$/);
});

test("rejects group identity and conflicting browser evidence", () => {
  assert.equal(extractStableChatIdentity("false_12345-678@g.us_MSG"), null);
  assert.deepEqual(proveStableChatIdentity(["false_17812961757@c.us_A", "tel:+17812961757"]), {
    proven: true,
    identity: "phone:17812961757",
    reason: "EXACT_STABLE_IDENTITY",
    evidenceCount: 1,
  });
  assert.equal(
    proveStableChatIdentity(["false_17812961757@c.us_A", "tel:+17707137058"]).reason,
    "CONFLICTING_IDENTITIES",
  );
});

test("classifies inbound, outbound, and unknown message directions", () => {
  assert.equal(classifyDirection("message-in focusable-list-item"), "inbound");
  assert.equal(classifyDirection("message-out"), "outbound");
  assert.equal(classifyDirection("system-message"), "unknown");
});

test("uses WhatsApp data-id when present and labels fallback as Phase-1 only", () => {
  const stable = deriveObservedMessageId({
    dataId: "false_17812961757@c.us_ABC",
    chatIdentity: "17812961757@c.us",
    direction: "inbound",
    text: "hello",
    domOrder: 3,
  });
  assert.equal(stable.source, "WHATSAPP_DATA_ID");
  assert.equal(stable.productionGrade, true);

  const fallback = deriveObservedMessageId({
    dataId: null,
    chatIdentity: "17812961757@c.us",
    direction: "inbound",
    timestampEvidence: "[10:00, 8/18/2026]",
    text: "hello",
    domOrder: 3,
  });
  assert.match(fallback.id, /^observation:[a-f0-9]{64}$/);
  assert.equal(fallback.source, "PHASE1_OBSERVATION_FINGERPRINT");
  assert.equal(fallback.productionGrade, false);
});

test("debounces repeated DOM observations", () => {
  const state = { lastKey: null, lastAt: 0 };
  assert.equal(acceptDebouncedObservation(state, "message-1", 1_000, 500), true);
  assert.equal(acceptDebouncedObservation(state, "message-1", 1_200, 500), false);
  assert.equal(acceptDebouncedObservation(state, "message-1", 1_600, 500), true);
});

test("selector health fails closed and distinguishes degraded state", () => {
  assert.equal(
    classifySelectorHealth({
      appRoot: true,
      readySidebar: true,
      conversationPanel: true,
      composer: true,
    }),
    SelectorHealth.HEALTHY,
  );
  assert.equal(
    classifySelectorHealth({
      appRoot: true,
      readySidebar: true,
      conversationPanel: false,
      composer: false,
    }),
    SelectorHealth.DEGRADED,
  );
  assert.equal(
    classifySelectorHealth({
      appRoot: false,
      readySidebar: false,
      conversationPanel: false,
      composer: false,
    }),
    SelectorHealth.FAILED,
  );
});

test("send classification never retries an unverified send as success", () => {
  assert.equal(
    classifySendResult({ sendAttempted: true, outboundBubbleObserved: true }),
    SendResult.SENT,
  );
  assert.equal(
    classifySendResult({ sendAttempted: true, outboundBubbleObserved: false }),
    SendResult.UNKNOWN,
  );
  assert.equal(
    classifySendResult({
      sendAttempted: false,
      outboundBubbleObserved: false,
      preconditionFailed: true,
    }),
    SendResult.FAILED,
  );
});

test("runtime paths are portable and contained by the worker root", async () => {
  const config = loadRuntimeConfig({});
  assert.equal(path.isAbsolute(config.profileDir), true);
  assert.equal(isPathInside(WORKER_ROOT, config.profileDir), true);
  assert.equal(isPathInside(WORKER_ROOT, config.diagnosticsDir), true);
  assert.equal(config.profileDir.endsWith("tools/creatyv-whatsapp-bridge/data/whatsapp-profile"), true);
  const pathSource = await readFile(new URL("../src/paths.js", import.meta.url), "utf8");
  assert.equal(pathSource.includes("/Users/jose/"), false);
  assert.equal(config.testReplyText, TEST_REPLY_TEXT);
  assert.equal(config.headless, false);
});

test("runtime config bounds local polling values", () => {
  const config = loadRuntimeConfig({
    CREATYV_BRIDGE_POLL_MS: "1",
    CREATYV_BRIDGE_DEBOUNCE_MS: "1500",
    CREATYV_BRIDGE_OUTBOUND_VERIFY_MS: "999999",
  });
  assert.equal(config.pollIntervalMs, 750);
  assert.equal(config.debounceMs, 1_500);
  assert.equal(config.outboundVerifyMs, 12_000);
});

test("future inbound contract cannot choose an organization", () => {
  const event = buildFutureInboundEvent({
    sessionId: "session-1",
    chatId: "17812961757@c.us",
    messageId: "message-1",
    occurredAt: "2026-08-18T12:00:00.000Z",
    observedAt: "2026-08-18T12:00:01.000Z",
    text: "hello",
    displayName: "Controlled Test",
  });
  assert.equal("organizationId" in event, false);
  assert.equal(event.transport, "whatsapp_web");
  assert.equal(event.kind, "text");
});

test("safe logging allowlist redacts nested credentials", () => {
  const secret = "never-print-this-value";
  const sanitized = sanitizeForLog({
    state: "READY",
    accessToken: secret,
    nested: { client_secret: secret, cookie: secret, apiKey: secret },
  });
  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("READY"), true);
});
