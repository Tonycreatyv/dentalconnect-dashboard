import { assert, assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { buildContextualRecoveryReply } from "../domain/conversationRecovery.ts";
import { runConversationEngine } from "../conversationEngine.ts";

Deno.test("confirm_booking + unknown text asks contextual confirm/review", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "mmm no se",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Limpieza dental",
        preferred_date: "2026-05-11",
        preferred_time: "08:00",
        pending_booking: { ok: true },
      },
    },
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(String((result as any).replyText).includes("confirmar"));
  assert(String((result as any).replyText).includes("revisar otro"));
});

Deno.test("confirm_booking + frustration acknowledges and offers options", () => {
  const recovery = buildContextualRecoveryReply({
    inboundText: "no me estás entendiendo",
    context: { currentGoal: "confirm_booking", service: "Limpieza dental" },
  });
  assert(recovery.handled);
  assert(String(recovery.replyText).includes("Tenés razón"));
});

Deno.test("booking with known service but missing date asks day/time", () => {
  const recovery = buildContextualRecoveryReply({
    inboundText: "ok",
    context: { currentGoal: "book_appointment", service: "Ortodoncia / brackets" },
  });
  assert(recovery.handled);
  assert(String(recovery.replyText).includes("Ortodoncia / brackets"));
});

Deno.test("booking without service asks service options", () => {
  const recovery = buildContextualRecoveryReply({
    inboundText: "quiero eso",
    context: { currentGoal: "book_appointment" },
  });
  assert(recovery.handled);
  assert(String(recovery.replyText).includes("revisión"));
});

Deno.test("active appointment choice ambiguous asks add/sooner/additional", () => {
  const recovery = buildContextualRecoveryReply({
    inboundText: "no se",
    context: {
      currentGoal: "active_appointment_choice",
      activeAppointment: { id: "1", service: "Revisión dental", dateLabel: "sábado 9 de mayo", timeLabel: "10:00 AM" },
    },
  });
  assert(recovery.handled);
  assert(String(recovery.replyText).includes("agregar esto a esa cita"));
});

Deno.test("repeated unknown twice offers human handoff", () => {
  const recovery = buildContextualRecoveryReply({
    inboundText: "mmm",
    context: { currentGoal: "unknown", recoveryCount: 2 },
  });
  assert(recovery.handled);
  assertEquals(recovery.route, "handoff");
});

Deno.test("recovery must not confirm booking on correction text", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "mañana es viernes",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Limpieza dental",
        preferred_date: "2026-05-10",
        preferred_time: "08:00",
        pending_booking: { ok: true },
      },
    },
  } as any);
  assertEquals((result as any).toolAction, undefined);
  assert(!String((result as any).replyText).includes("procesando tu reserva"));
});

Deno.test("recovery preserves pending booking state", () => {
  const result = runConversationEngine({
    organizationId: "clinic-demo",
    inboundText: "mmm",
    leadState: {
      stage: "CONFIRMING",
      nextExpected: "confirm_booking",
      collected: {
        service: "Limpieza dental",
        preferred_date: "2026-05-11",
        preferred_time: "08:00",
        pending_booking: { id: "pb-1" },
      },
    },
  } as any);
  assertEquals(((result as any).statePatch?.collected ?? {}).pending_booking?.id, "pb-1");
});
