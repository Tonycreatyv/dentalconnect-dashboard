import { chromium } from "playwright";
import { RuntimeState, SendResult, SelectorHealth, WHATSAPP_WEB_URL } from "./constants.js";
import { classifySelectorHealth, classifySendResult } from "./health.js";
import {
  identitiesMatch,
  proveStableChatIdentity,
  sanitizeChatIdentity,
  sha256Short,
} from "./identity.js";
import {
  acceptDebouncedObservation,
  classifyDirection,
  deriveObservedMessageId,
  isNewObservation,
  normalizeMessageText,
} from "./messages.js";
import { safeLog } from "./safeLogger.js";
import { SELECTORS } from "./selectors.js";

/** @typedef {import("playwright").BrowserContext} BrowserContext */
/** @typedef {import("playwright").Page} Page */

/**
 * @typedef {{
 * organizationId: string,
 * testReplyText: string,
 * headless: false,
 * profileDir: string,
 * pollIntervalMs: number,
 * debounceMs: number,
 * outboundVerifyMs: number,
 * }} BridgeConfig
 */

/**
 * @typedef {{
 * dataId: string | null,
 * className: string,
 * text: string,
 * timestampEvidence: string | null,
 * domOrder: number,
 * }} DomMessage
 */

export class WhatsAppWebClient {
  /** @param {BridgeConfig} config */
  constructor(config) {
    this.config = config;
    /** @type {BrowserContext | null} */
    this.context = null;
    /** @type {Page | null} */
    this.page = null;
    /** @type {string} */
    this.state = RuntimeState.STARTING;
  }

  async launch() {
    this.setState(RuntimeState.STARTING);
    this.context = await chromium.launchPersistentContext(this.config.profileDir, {
      headless: this.config.headless,
      viewport: null,
      args: ["--start-maximized"],
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    await this.page.goto(WHATSAPP_WEB_URL, { waitUntil: "domcontentloaded" });
    return this.page;
  }

  async close() {
    await this.context?.close();
  }

  /** @param {string} next */
  setState(next) {
    this.state = next;
    safeLog("runtime_state", { state: next });
  }

  async waitForLogin() {
    const page = this.requirePage();
    let qrAnnounced = false;

    while (true) {
      if (await page.locator(SELECTORS.readySidebar).first().isVisible().catch(() => false)) {
        this.setState(RuntimeState.READY);
        console.log("WHATSAPP WEB READY");
        return;
      }

      if (await page.locator(SELECTORS.qrCode).first().isVisible().catch(() => false)) {
        this.setState(RuntimeState.QR_LOGIN_REQUIRED);
        if (!qrAnnounced) {
          console.log("WHATSAPP QR LOGIN REQUIRED");
          qrAnnounced = true;
        }
      }

      await page.waitForTimeout(this.config.pollIntervalMs);
    }
  }

  async getSelectorHealth() {
    const page = this.requirePage();
    const checks = {
      appRoot: await page.locator(SELECTORS.appRoot).first().isVisible().catch(() => false),
      readySidebar: await page.locator(SELECTORS.readySidebar).first().isVisible().catch(() => false),
      conversationPanel: await page
        .locator(SELECTORS.conversationPanel)
        .first()
        .isVisible()
        .catch(() => false),
      composer: await page.locator(SELECTORS.composer).first().isVisible().catch(() => false),
    };
    return { status: classifySelectorHealth(checks), checks };
  }

  async readOpenChatIdentity() {
    const page = this.requirePage();
    const messageEvidence = await page
      .locator(SELECTORS.messages)
      .evaluateAll(collectDataIdEvidence);
    const attributeEvidence = await page
      .locator(SELECTORS.identityAttributes)
      .evaluateAll(collectIdentityAttributeEvidence);
    const linkEvidence = await page.locator(SELECTORS.identityLinks).evaluateAll(collectHrefEvidence);
    const proof = proveStableChatIdentity([
      ...messageEvidence,
      ...attributeEvidence,
      ...linkEvidence,
    ]);
    const displayName = await page
      .locator(SELECTORS.headerTitle)
      .first()
      .getAttribute("title")
      .catch(() => null);

    return { ...proof, displayName: displayName?.trim() || null };
  }

  async readMessages() {
    const page = this.requirePage();
    return /** @type {DomMessage[]} */ (
      await page
        .locator(SELECTORS.messages)
        .evaluateAll(collectDomMessages, SELECTORS.messageText)
    );
  }

  /** @param {string} expectedChatIdentity */
  async waitForNewInboundText(expectedChatIdentity) {
    const initialMessages = await this.readMessages();
    const observed = new Set(
      initialMessages.map((message) =>
        deriveObservedMessageId({
          ...message,
          chatIdentity: expectedChatIdentity,
          direction: classifyDirection(message.className),
        }).id,
      ),
    );
    const debounceState = { lastKey: null, lastAt: 0 };
    safeLog("inbound_observation_armed", {
      chatIdentity: sanitizeChatIdentity(expectedChatIdentity),
      baselineMessageCount: observed.size,
    });

    while (true) {
      const currentIdentity = await this.readOpenChatIdentity();
      if (!currentIdentity.proven || !identitiesMatch(currentIdentity.identity, expectedChatIdentity)) {
        this.setState(RuntimeState.PAUSED);
        console.log("HUMAN ACTIVITY DETECTED");
        throw new Error("Controlled chat changed while observing");
      }

      const messages = await this.readMessages();
      for (const message of messages) {
        if (classifyDirection(message.className) !== "inbound") continue;
        const text = normalizeMessageText(message.text);
        if (!text) continue;

        const observedId = deriveObservedMessageId({
          ...message,
          text,
          chatIdentity: expectedChatIdentity,
          direction: "inbound",
        });
        if (!isNewObservation(observed, observedId)) continue;
        if (
          !acceptDebouncedObservation(
            debounceState,
            observedId.id,
            Date.now(),
            this.config.debounceMs,
          )
        ) {
          continue;
        }

        return {
          chatIdentity: expectedChatIdentity,
          displayName: currentIdentity.displayName,
          text,
          observedMessageId: observedId.id,
          observedMessageIdSource: observedId.source,
          productionGradeMessageId: observedId.productionGrade,
          occurredAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
        };
      }
      await this.requirePage().waitForTimeout(this.config.pollIntervalMs);
    }
  }

  /** @param {string} expectedChatIdentity */
  async sendAuthorizedTestReply(expectedChatIdentity) {
    const page = this.requirePage();
    let sendAttempted = false;

    try {
      const health = await this.getSelectorHealth();
      safeLog("selector_health", health);
      if (health.status !== SelectorHealth.HEALTHY) {
        this.setState(health.status === SelectorHealth.FAILED ? RuntimeState.FAILED : RuntimeState.DEGRADED);
        return classifySendResult({ sendAttempted, outboundBubbleObserved: false, preconditionFailed: true });
      }

      const identityBeforeSend = await this.readOpenChatIdentity();
      if (
        !identityBeforeSend.proven ||
        !identitiesMatch(identityBeforeSend.identity, expectedChatIdentity)
      ) {
        this.setState(RuntimeState.PAUSED);
        console.log("CHAT IDENTITY MISMATCH");
        return SendResult.FAILED;
      }

      const composer = page.locator(SELECTORS.composer).first();
      const existingDraft = normalizeMessageText((await composer.textContent()) ?? "");
      if (existingDraft) {
        this.setState(RuntimeState.PAUSED);
        console.log("HUMAN ACTIVITY DETECTED");
        return SendResult.FAILED;
      }

      const beforeOutboundIds = new Set(
        await page.locator(SELECTORS.outboundMessages).evaluateAll(collectDataIdEvidence),
      );

      await composer.fill(this.config.testReplyText);
      const populatedText = normalizeMessageText((await composer.textContent()) ?? "");
      if (populatedText !== this.config.testReplyText) {
        await composer.fill("").catch(() => undefined);
        return SendResult.FAILED;
      }

      const identityAfterPopulate = await this.readOpenChatIdentity();
      if (
        !identityAfterPopulate.proven ||
        !identitiesMatch(identityAfterPopulate.identity, expectedChatIdentity)
      ) {
        await composer.fill("").catch(() => undefined);
        this.setState(RuntimeState.PAUSED);
        console.log("CHAT IDENTITY MISMATCH");
        return SendResult.FAILED;
      }

      sendAttempted = true;
      await composer.press("Enter");

      const deadline = Date.now() + this.config.outboundVerifyMs;
      while (Date.now() < deadline) {
        const currentIdentity = await this.readOpenChatIdentity();
        if (!currentIdentity.proven || !identitiesMatch(currentIdentity.identity, expectedChatIdentity)) {
          return SendResult.UNKNOWN;
        }

        /** @type {Array<{dataId: string | null, text: string}>} */
        const outbound = await page
          .locator(SELECTORS.outboundMessages)
          .evaluateAll(collectOutboundMessages, SELECTORS.messageText);
        const observed = outbound.some(
          (message) =>
            message.dataId &&
            !beforeOutboundIds.has(message.dataId) &&
            normalizeMessageText(message.text) === this.config.testReplyText,
        );
        if (observed) {
          return classifySendResult({ sendAttempted, outboundBubbleObserved: true });
        }
        await page.waitForTimeout(this.config.pollIntervalMs);
      }

      return classifySendResult({ sendAttempted, outboundBubbleObserved: false });
    } catch (error) {
      safeLog("send_error", {
        sendAttempted,
        error: error instanceof Error ? error.message : "Unknown send failure",
      });
      return sendAttempted ? SendResult.UNKNOWN : SendResult.FAILED;
    }
  }

  /** @param {Awaited<ReturnType<WhatsAppWebClient["waitForNewInboundText"]>>} inbound */
  printInboundDiagnostic(inbound) {
    console.log(`transport: whatsapp_web`);
    console.log(`organization: ${this.config.organizationId}`);
    console.log(`chat_identity: ${sanitizeChatIdentity(inbound.chatIdentity)}`);
    console.log(`display_name: ${inbound.displayName ?? "unknown"}`);
    console.log(`message_direction: inbound`);
    console.log(`message_text: ${inbound.text}`);
    console.log(`observed_message_id: message:${sha256Short(inbound.observedMessageId)}`);
    console.log(`observed_message_id_source: ${inbound.observedMessageIdSource}`);
    if (!inbound.productionGradeMessageId) {
      console.log("observed_message_id_quality: PHASE_1_FALLBACK_NOT_PRODUCTION_GRADE");
    }
  }

  requirePage() {
    if (!this.page) throw new Error("Browser page is not initialized");
    return this.page;
  }
}

/** @param {Element[]} nodes */
function collectDataIdEvidence(nodes) {
  return nodes
    .map((node) => node.getAttribute("data-id"))
    .filter((value) => typeof value === "string");
}

/** @param {Element[]} nodes */
function collectIdentityAttributeEvidence(nodes) {
  return nodes.flatMap((node) =>
    ["data-jid", "data-chat-id", "data-id"]
      .map((attribute) => node.getAttribute(attribute))
      .filter((value) => typeof value === "string"),
  );
}

/** @param {Element[]} nodes */
function collectHrefEvidence(nodes) {
  return nodes
    .map((node) => node.getAttribute("href"))
    .filter((value) => typeof value === "string");
}

/** @param {Element[]} nodes @param {string} textSelector */
function collectDomMessages(nodes, textSelector) {
  return nodes.map((node, domOrder) => {
    const textElement = node.querySelector(textSelector);
    const timestampElement = node.querySelector("[data-pre-plain-text]");
    return {
      dataId: node.getAttribute("data-id"),
      className: node.className,
      text: textElement?.textContent ?? "",
      timestampEvidence: timestampElement?.getAttribute("data-pre-plain-text") ?? null,
      domOrder,
    };
  });
}

/** @param {Element[]} nodes @param {string} textSelector */
function collectOutboundMessages(nodes, textSelector) {
  return nodes.map((node) => ({
    dataId: node.getAttribute("data-id"),
    text: node.querySelector(textSelector)?.textContent ?? "",
  }));
}
