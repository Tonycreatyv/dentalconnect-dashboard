import {
  classifyPendingFlowMessage,
  type ConversationTurnIntent,
} from "./pendingFlowClassifier.ts";
import { buildContextualRecoveryReply } from "./conversationRecovery.ts";

export type ConversationContext = {
  stage?: string | null;
  nextExpected?: string | null;
  currentGoal:
    | "book_appointment"
    | "confirm_booking"
    | "reschedule_appointment"
    | "confirm_reschedule"
    | "cancel_appointment"
    | "active_appointment_choice"
    | "service_info"
    | "unknown";
  service?: string | null;
  pendingDate?: string | null;
  pendingTime?: string | null;
  activeAppointment?: {
    id?: string;
    service?: string;
    dateLabel?: string;
    timeLabel?: string;
  } | null;
  recoveryCount?: number;
};

export type OrchestratorDecision = {
  handled: boolean;
  intent: ConversationTurnIntent;
  replyText?: string;
  route?:
    | "answer_then_return"
    | "continue_booking"
    | "replace_pending_booking"
    | "continue_reschedule"
    | "active_appointment_clarify"
    | "contextual_recovery"
    | "handoff"
    | "fallback";
  statePatch?: Record<string, unknown>;
  toolAction?: Record<string, unknown>;
};

export function orchestrateConversationTurn(args: {
  inboundText: string;
  context: ConversationContext;
}): OrchestratorDecision {
  const intent = classifyPendingFlowMessage(args.inboundText);
  const recovery = buildContextualRecoveryReply({
    inboundText: args.inboundText,
    context: args.context,
  });
  if (recovery.handled) {
    return {
      handled: true,
      intent,
      replyText: recovery.replyText,
      route: intent === "human_handoff" ? "handoff" : "contextual_recovery",
      statePatch: recovery.statePatch,
    };
  }
  return { handled: false, intent, route: "fallback" };
}

