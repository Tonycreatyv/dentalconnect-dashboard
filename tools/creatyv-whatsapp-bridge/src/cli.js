/* global console, process */
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadRuntimeConfig } from "./config.js";
import { RuntimeState, SelectorHealth } from "./constants.js";
import { sanitizeChatIdentity } from "./identity.js";
import { safeLog } from "./safeLogger.js";
import { WhatsAppWebClient } from "./whatsappWebClient.js";

const config = loadRuntimeConfig();
await mkdir(config.profileDir, { recursive: true, mode: 0o700 });
await mkdir(config.diagnosticsDir, { recursive: true, mode: 0o700 });

const terminal = createInterface({ input, output });
const client = new WhatsAppWebClient(config);
let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  terminal.close();
  await client.close().catch(() => undefined);
}

process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

try {
  safeLog("bridge_start", {
    organization: config.organizationId,
    profileMode: "DEDICATED_PERSISTENT_PROFILE",
    headless: config.headless,
  });
  await client.launch();
  await client.waitForLogin();

  await terminal.question(
    "Open the one controlled direct-message test chat in WhatsApp Web, then press Enter to arm observation. ",
  );

  const identity = await client.readOpenChatIdentity();
  if (!identity.proven || !identity.identity) {
    client.setState(RuntimeState.PAUSED);
    console.log("STABLE CHAT IDENTITY NOT PROVEN");
    safeLog("identity_proof_failed", {
      reason: identity.reason,
      availableStableIdentityCount: identity.evidenceCount,
      displayName: identity.displayName,
    });
    console.log("Browser remains open for inspection. Press Ctrl+C to stop.");
    await new Promise(() => {});
  }
  const chatIdentity = identity.identity;
  if (!chatIdentity) throw new Error("Stable chat identity unexpectedly missing");

  const health = await client.getSelectorHealth();
  safeLog("selector_health", health);
  if (health.status !== SelectorHealth.HEALTHY) {
    client.setState(health.status === SelectorHealth.FAILED ? RuntimeState.FAILED : RuntimeState.DEGRADED);
    console.log("Required selector health is not HEALTHY. No send will be attempted.");
    console.log("Browser remains open for inspection. Press Ctrl+C to stop.");
    await new Promise(() => {});
  }

  safeLog("controlled_chat_verified", {
    chatIdentity: sanitizeChatIdentity(chatIdentity),
    displayName: identity.displayName,
  });
  console.log("Send one new inbound TEXT message to the controlled chat from the other phone.");

  const inbound = await client.waitForNewInboundText(chatIdentity);
  client.printInboundDiagnostic(inbound);

  const authorization = await terminal.question(
    'Type SEND to authorize the one fixed test reply, or press Enter to pause: ',
  );
  if (authorization.trim() !== "SEND") {
    client.setState(RuntimeState.PAUSED);
    console.log("No reply authorized. Browser remains open. Press Ctrl+C to stop.");
    await new Promise(() => {});
  }

  const result = await client.sendAuthorizedTestReply(chatIdentity);
  safeLog("test_send_result", {
    result,
    chatIdentity: sanitizeChatIdentity(chatIdentity),
  });
  console.log(`SEND RESULT: ${result}`);
  console.log("Phase 1 processes no additional messages. Press Ctrl+C to stop.");
  await new Promise(() => {});
} catch (error) {
  client.setState(RuntimeState.FAILED);
  safeLog("bridge_failed", {
    error: error instanceof Error ? error.message : "Unknown bridge failure",
  });
  process.exitCode = 1;
  await close();
}
