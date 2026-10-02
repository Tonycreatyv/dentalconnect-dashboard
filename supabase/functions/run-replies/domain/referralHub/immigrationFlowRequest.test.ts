import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captureImmigrationFlowRequest } from "./immigrationFlowRequest.ts";

function fakeRpc(data: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    supabase: {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return Promise.resolve({ data: name === "auto_assign_immigration_partner" ? { assigned: true } : data, error: null });
      },
    },
  };
}

const completion = {
  topic: "GREEN_CARD",
  postal_code: "30345",
            description: "Necesito orientación sobre residencia.",
            sharing_consent: "PENDING",
            consent_version: null,
            consent_source: null,
  completed_at: "2026-08-31T15:30:00.000Z",
};

Deno.test("immigration Flow capture uses a stable canonical key and does not request assignment or notification", async () => {
  const fake = fakeRpc({ success: true, request_id: "request-1", created: true, assigned: false, notification_created: false });
  const result = await captureImmigrationFlowRequest({
    supabase: fake.supabase,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-1",
    channelUserId: "whatsapp-user-1",
    deliveryKey: "wamid.1",
    completion,
  });
  assertEquals(result, { requestId: "request-1", created: true });
  assertEquals(fake.calls, [{
    name: "capture_immigration_flow_request",
    args: {
      p_organization_id: "luis-gabriel-referral-hub",
      p_lead_id: "lead-1",
      p_channel_user_id: "whatsapp-user-1",
      p_completion_key: "luis_unified_services:immigration:v1",
      p_delivery_key: "wamid.1",
      p_completed_at: "2026-08-31T15:30:00.000Z",
      p_intake: {
        source: "whatsapp_flow",
        flow_type: "luis_unified_services",
        flow_version: "v1",
        intake_type: "IMMIGRATION",
        topic: "GREEN_CARD",
        postal_code: "30345",
        description: "Necesito orientación sobre residencia.",
        completed_at: "2026-08-31T15:30:00.000Z",
        sharing_consent: "PENDING",
        consent_version: null,
        consent_source: null,
      },
    },
  }]);
});

Deno.test("a repeated delivery retains the same request without treating it as an assignment", async () => {
  const fake = fakeRpc({ success: true, request_id: "request-1", created: false, assigned: false, notification_created: false });
  const result = await captureImmigrationFlowRequest({
    supabase: fake.supabase,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-1",
    channelUserId: "whatsapp-user-1",
    deliveryKey: "wamid.1",
    completion,
  });
  assertEquals(result, { requestId: "request-1", created: false });
});

Deno.test("AUTHORIZED completion invokes only the server-side idempotent assignment RPC", async () => {
  const fake = fakeRpc({ success: true, request_id: "request-1", created: true, assigned: false, notification_created: false });
  await captureImmigrationFlowRequest({
    supabase: fake.supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-1",
    channelUserId: "whatsapp-user-1", deliveryKey: "wamid.authorized",
    completion: { ...completion, sharing_consent: "AUTHORIZED" },
  });
  assertEquals(fake.calls[1], { name: "auto_assign_immigration_partner", args: { p_request_id: "request-1", p_idempotency_key: "immigration-partner:wamid.authorized" } });
});
