// Phase 1 deliberately performs no network calls. These contracts keep the thin
// client aligned with the future Luis-only Creatyv worker API.
export const FUTURE_WORKER_ENDPOINTS = Object.freeze({
  inbound: "/internal/whatsapp-web/inbound",
  claim: "/internal/whatsapp-web/commands/claim",
  ack: "/internal/whatsapp-web/commands/{commandId}/ack",
  heartbeat: "/internal/whatsapp-web/heartbeat",
});

/**
 * Organization is intentionally absent. Future server authorization derives it
 * from a narrow worker credential, never from a client-controlled field.
 * @param {{sessionId: string, chatId: string, messageId: string, occurredAt: string,
 * observedAt: string, text: string, displayName?: string}} input
 */
export function buildFutureInboundEvent(input) {
  return {
    schemaVersion: 1,
    transport: "whatsapp_web",
    sessionId: input.sessionId,
    chatId: input.chatId,
    messageId: input.messageId,
    occurredAt: input.occurredAt,
    observedAt: input.observedAt,
    kind: "text",
    text: input.text,
    ...(input.displayName ? { displayName: input.displayName } : {}),
  };
}
