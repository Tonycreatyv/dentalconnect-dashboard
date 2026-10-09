import { SelectorHealth, SendResult } from "./constants.js";

/**
 * @param {{appRoot: boolean, readySidebar: boolean, conversationPanel: boolean,
 * composer: boolean}} checks
 */
export function classifySelectorHealth(checks) {
  if (!checks.appRoot || !checks.readySidebar) return SelectorHealth.FAILED;
  if (!checks.conversationPanel || !checks.composer) return SelectorHealth.DEGRADED;
  return SelectorHealth.HEALTHY;
}

/**
 * @param {{sendAttempted: boolean, outboundBubbleObserved: boolean,
 * preconditionFailed?: boolean, postSendError?: boolean}} evidence
 */
export function classifySendResult(evidence) {
  if (evidence.preconditionFailed || !evidence.sendAttempted) return SendResult.FAILED;
  if (evidence.outboundBubbleObserved) return SendResult.SENT;
  return SendResult.UNKNOWN;
}
