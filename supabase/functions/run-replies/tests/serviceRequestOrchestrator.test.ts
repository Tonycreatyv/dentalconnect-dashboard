import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  customerCopyForServiceRequest,
  operationalStatePatch,
  orchestrateCompletedServiceRequest,
} from "../domain/referralHub/serviceRequestOrchestrator.ts";

function rpcResult(data: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    supabase: {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return Promise.resolve({ data, error: null });
      },
    },
  };
}

const assigned = {
  success: true,
  outcome: "assigned",
  idempotent_replay: false,
  request_id: "request-1",
  request_status: "prequalified",
  assignment_id: "assignment-1",
  assignment_status: "assigned",
  notification_id: "notification-1",
  notification_status: "queued",
  exception_id: null,
  exception_type: null,
  assignment_kind: "partner",
  portal_token: "raw-token-must-not-cross-runtime-boundary",
};

Deno.test("service request bridge sends the exact tenant, identity, completion and intake contract", async () => {
  const fake = rpcResult(assigned);
  const result = await orchestrateCompletedServiceRequest({
    supabase: fake.supabase,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-1",
    serviceId: "luis_accidente",
    sourceChannel: "messenger",
    channelUserId: "page-user-1",
    completionKey: "inbound-1",
    completionOutcome: "confirmed_intake",
    intake: { accident_city: "Atlanta", language: "es" },
  });
  assertEquals(fake.calls, [{
    name: "orchestrate_referral_service_request",
    args: {
      p_organization_id: "luis-gabriel-referral-hub",
      p_lead_id: "lead-1",
      p_service_id: "luis_accidente",
      p_source_channel: "messenger",
      p_channel_user_id: "page-user-1",
      p_completion_key: "inbound-1",
      p_completion_outcome: "confirmed_intake",
      p_intake: { accident_city: "Atlanta", language: "es" },
    },
  }]);
  assert(result.success);
  assertEquals(result.portalTokenPrepared, true);
  assert(!JSON.stringify(result).includes("raw-token"));
});

Deno.test("assigned copy reports queued, not sent, delivered, accepted or a callback promise", () => {
  const fake = rpcResult(assigned);
  return orchestrateCompletedServiceRequest({
    supabase: fake.supabase,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-1",
    serviceId: "luis_inmigracion",
    sourceChannel: "whatsapp",
    channelUserId: "wa-1",
    completionKey: "inbound-2",
    completionOutcome: "confirmed_intake",
    intake: {},
  }).then((result) => {
    const copy = customerCopyForServiceRequest("luis_inmigracion", result);
    assertStringIncludes(copy, "notificación está en cola");
    assertStringIncludes(copy, "Todavía no ha sido aceptada");
    assert(!/enviada|entregada|te contactará|te llamará/i.test(copy));
  });
});

Deno.test("no eligible partner uses coordinator-review truth and preserves the exception", async () => {
  const fake = rpcResult({
    success: true,
    outcome: "needs_coordinator_review",
    idempotent_replay: false,
    request_id: "request-2",
    request_status: "prequalified",
    exception_id: "exception-1",
    exception_type: "no_eligible_partner",
  });
  const result = await orchestrateCompletedServiceRequest({
    supabase: fake.supabase,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-2",
    serviceId: "luis_inmigracion",
    sourceChannel: "whatsapp",
    channelUserId: "wa-2",
    completionKey: "inbound-3",
    completionOutcome: "confirmed_intake",
    intake: {},
  });
  assert(result.success);
  assertEquals(result.outcome, "needs_coordinator_review");
  assertEquals(result.exceptionType, "no_eligible_partner");
  const copy = customerCopyForServiceRequest("luis_inmigracion", result);
  assertStringIncludes(copy, "Un coordinador debe revisarla");
  assert(!copy.includes("no_eligible_partner"));
});

Deno.test("advisor result is internal and does not imply external portal or acceptance", async () => {
  const fake = rpcResult({
    ...assigned,
    assignment_kind: "internal",
    portal_token: null,
  });
  const result = await orchestrateCompletedServiceRequest({
    supabase: fake.supabase,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-3",
    serviceId: "luis_representante",
    sourceChannel: "messenger",
    channelUserId: "page-user-3",
    completionKey: "inbound-4",
    completionOutcome: "confirmed_intake",
    intake: {},
  });
  assert(result.success);
  assertEquals(result.assignmentKind, "internal");
  assertEquals(result.portalTokenPrepared, false);
  const copy = customerCopyForServiceRequest("luis_representante", result);
  assertStringIncludes(copy, "tarea interna");
  assertStringIncludes(copy, "Todavía no ha sido aceptada");
  assert(!copy.includes("aliado"));
});

Deno.test("idempotent replay exposes canonical existing IDs without duplicates", async () => {
  const fake = rpcResult({ ...assigned, idempotent_replay: true });
  const result = await orchestrateCompletedServiceRequest({
    supabase: fake.supabase,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-4",
    serviceId: "luis_eventos",
    sourceChannel: "whatsapp",
    channelUserId: "wa-4",
    completionKey: "inbound-5",
    completionOutcome: "follow_up_requested",
    intake: { event_follow_up: true },
  });
  assert(result.success);
  assertEquals(result.idempotentReplay, true);
  assertEquals(result.requestId, "request-1");
  assertEquals(result.assignmentId, "assignment-1");
});

Deno.test("RPC failure never claims persistence or contact", async () => {
  const result = await orchestrateCompletedServiceRequest({
    supabase: {
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { message: "private database detail", code: "XX000" },
        }),
    },
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-5",
    serviceId: "luis_accidente",
    sourceChannel: "messenger",
    channelUserId: "page-user-5",
    completionKey: "inbound-6",
    completionOutcome: "confirmed_intake",
    intake: {},
  });
  assertEquals(result, { success: false, error: "request_persistence_failed" });
  const copy = customerCopyForServiceRequest("luis_accidente", result);
  assertStringIncludes(copy, "No pudimos completar");
  assert(!/te contactará|asignad|notificad/i.test(copy));
  assertEquals(operationalStatePatch(result), {
    operational_request_status: "failed",
    operational_request_error: "request_persistence_failed",
  });
});
