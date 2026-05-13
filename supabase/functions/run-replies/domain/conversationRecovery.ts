import type { ConversationContext, OrchestratorDecision } from "./conversationOrchestrator.ts";
import { classifyPendingFlowMessage } from "./pendingFlowClassifier.ts";

function safeStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function formatPending(service?: string | null, date?: string | null, time?: string | null): string {
  const s = safeStr(service, "").trim();
  const d = safeStr(date, "").trim();
  const t = safeStr(time, "").trim();
  if (s && d && t) return `${s} para ${d} a las ${t}`;
  if (s) return s;
  return "la cita pendiente";
}

export function buildContextualRecoveryReply(args: {
  inboundText: string;
  context: ConversationContext;
}): OrchestratorDecision {
  const intent = classifyPendingFlowMessage(args.inboundText);
  const ctx = args.context;
  const recoveryCount = Number(ctx.recoveryCount ?? 0);

  if (recoveryCount >= 2) {
    return {
      handled: true,
      intent,
      route: "handoff",
      replyText:
        "Para evitar darte una respuesta incorrecta, puedo pasar tu consulta a recepción. También puedo ayudarte a revisar horarios si querés.",
      statePatch: { collected: { recovery_count: recoveryCount + 1 } },
    };
  }

  if (intent === "frustration") {
    return {
      handled: true,
      intent,
      route: "contextual_recovery",
      replyText:
        "Tenés razón, déjame ordenarlo para no confundirte. ¿Querés agendar una cita nueva, cambiar una cita existente o hablar con recepción?",
      statePatch: { collected: { recovery_count: recoveryCount + 1 } },
    };
  }

  if (ctx.currentGoal === "confirm_booking") {
    if (intent === "business_hours_question") {
      return {
        handled: true,
        intent,
        route: "answer_then_return",
        replyText: "Te comparto los horarios de atención. Sobre la cita pendiente, ¿querés confirmar ese horario o revisar otro?",
        statePatch: { collected: { recovery_count: recoveryCount + 1 } },
      };
    }
    if (intent === "pricing_question") {
      return {
        handled: true,
        intent,
        route: "answer_then_return",
        replyText: "Depende del caso, pero en consulta te dan el número exacto. Sobre la cita pendiente, ¿querés confirmar ese horario o revisar otro?",
        statePatch: { collected: { recovery_count: recoveryCount + 1 } },
      };
    }
    if (intent === "location_question") {
      return {
        handled: true,
        intent,
        route: "answer_then_return",
        replyText: "Claro, te comparto la ubicación. Sobre la cita pendiente, ¿querés confirmar ese horario o revisar otro?",
        statePatch: { collected: { recovery_count: recoveryCount + 1 } },
      };
    }
    return {
      handled: true,
      intent,
      route: "contextual_recovery",
      replyText:
        `Solo para no confundirme: teníamos pendiente ${formatPending(ctx.service, ctx.pendingDate, ctx.pendingTime)}. ¿Querés confirmar ese horario o revisar otro?`,
      statePatch: { collected: { recovery_count: recoveryCount + 1 } },
    };
  }

  if (ctx.currentGoal === "confirm_reschedule" || ctx.currentGoal === "reschedule_appointment") {
    if (ctx.pendingDate && ctx.pendingTime) {
      return {
        handled: true,
        intent,
        route: "contextual_recovery",
        replyText:
          `Estamos revisando un cambio para tu cita. Tenía pendiente cambiarla para ${ctx.pendingDate} a las ${ctx.pendingTime}. ¿Querés confirmar ese cambio o revisar otro horario?`,
        statePatch: { collected: { recovery_count: recoveryCount + 1 } },
      };
    }
    return {
      handled: true,
      intent,
      route: "contextual_recovery",
      replyText: "Estamos revisando un cambio para tu cita. ¿Querés buscar otro horario o mantener la cita actual?",
      statePatch: { collected: { recovery_count: recoveryCount + 1 } },
    };
  }

  if (ctx.currentGoal === "active_appointment_choice" && ctx.activeAppointment) {
    return {
      handled: true,
      intent,
      route: "active_appointment_clarify",
      replyText:
        `Veo que ya tenés una cita confirmada para ${safeStr(ctx.activeAppointment.service, "la consulta")} el ${safeStr(ctx.activeAppointment.dateLabel, "")} a las ${safeStr(ctx.activeAppointment.timeLabel, "")}. ¿Querés agregar esto a esa cita, buscar un horario más pronto o agendar una cita adicional?`,
      statePatch: { collected: { recovery_count: recoveryCount + 1 } },
    };
  }

  if (ctx.currentGoal === "book_appointment" && safeStr(ctx.service, "").trim()) {
    return {
      handled: true,
      intent,
      route: "continue_booking",
      replyText: `Te ayudo con ${safeStr(ctx.service, "")}. ¿Qué día u hora te queda mejor?`,
      statePatch: { collected: { recovery_count: recoveryCount + 1 } },
    };
  }

  if (ctx.currentGoal === "book_appointment" && !safeStr(ctx.service, "").trim()) {
    return {
      handled: true,
      intent,
      route: "contextual_recovery",
      replyText:
        "Claro. Para ayudarte bien, ¿la cita sería por revisión, limpieza, ortodoncia, blanqueamiento o alguna molestia dental?",
      statePatch: { collected: { recovery_count: recoveryCount + 1 } },
    };
  }

  return {
    handled: true,
    intent,
    route: "contextual_recovery",
    replyText: "Solo para ubicarme bien: ¿querés agendar una cita, cambiar una cita existente o hacer una consulta rápida?",
    statePatch: { collected: { recovery_count: recoveryCount + 1 } },
  };
}
