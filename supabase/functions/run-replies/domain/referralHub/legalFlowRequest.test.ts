import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captureLegalFlowRequest } from "./legalFlowRequest.ts";

function fakeRpc(data: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    supabase: {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return Promise.resolve({ data: name === "auto_assign_legal_partner" ? { assigned: true } : data, error: null });
      },
    },
  };
}

const fields = {
  intake_type: "AUTO_ACCIDENT",
  full_name: "Ana Cliente",
  accident_date: "2026-03-05",
  participant_role: null,
  received_medical_attention: "YES",
  police_report: "YES",
  medical_provider: null,
  description: "Choque en la interseccion, sin heridos graves.",
  sharing_consent: "PENDING",
  consent_version: null,
  consent_source: null,
};

Deno.test("legal Flow capture (AUTO_ACCIDENT) uses the accident-specific canonical key and does not request assignment or notification", async () => {
  const fake = fakeRpc({ success: true, request_id: "request-1", created: true, assigned: false, notification_created: false });
  const result = await captureLegalFlowRequest({
    supabase: fake.supabase,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-1",
    channelUserId: "whatsapp-user-1",
    deliveryKey: "wamid.1",
    completedAt: "2026-09-08T13:36:58.718Z",
    sharingConsent: "PENDING",
    consentVersion: null,
    consentSource: null,
    fields,
  });
  assertEquals(result, { requestId: "request-1", created: true });
  assertEquals(fake.calls, [{
    name: "capture_legal_flow_request",
    args: {
      p_organization_id: "luis-gabriel-referral-hub",
      p_lead_id: "lead-1",
      p_channel_user_id: "whatsapp-user-1",
      p_intake_type: "AUTO_ACCIDENT",
      p_completion_key: "luis_unified_services:legal:auto_accident:v1",
      p_delivery_key: "wamid.1",
      p_completed_at: "2026-09-08T13:36:58.718Z",
      p_intake: {
        ...fields,
        source: "whatsapp_flow",
        flow_type: "luis_unified_services",
        flow_version: "v1",
        intake_type: "AUTO_ACCIDENT",
        service: "auto_accident",
        completed_at: "2026-09-08T13:36:58.718Z",
        sharing_consent: "PENDING",
        consent_version: null,
        consent_source: null,
      },
    },
  }]);
});

Deno.test("a repeated delivery retains the same request without treating it as an assignment", async () => {
  const fake = fakeRpc({ success: true, request_id: "request-1", created: false, assigned: false, notification_created: false });
  const result = await captureLegalFlowRequest({
    supabase: fake.supabase,
    organizationId: "luis-gabriel-referral-hub",
    leadId: "lead-1",
    channelUserId: "whatsapp-user-1",
    deliveryKey: "wamid.1",
    completedAt: "2026-09-08T13:36:58.718Z",
    sharingConsent: "PENDING",
    fields,
  });
  assertEquals(result, { requestId: "request-1", created: false });
});

Deno.test("AUTHORIZED completion invokes only the server-side idempotent Clinica Pastor assignment RPC", async () => {
  const fake = fakeRpc({ success: true, request_id: "request-1", created: true, assigned: false, notification_created: false });
  await captureLegalFlowRequest({
    supabase: fake.supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-1",
    channelUserId: "whatsapp-user-1", deliveryKey: "wamid.authorized",
    completedAt: "2026-09-08T13:36:58.718Z",
    sharingConsent: "AUTHORIZED",
    fields: { ...fields, sharing_consent: "AUTHORIZED" },
  });
  assertEquals(fake.calls[1], { name: "auto_assign_legal_partner", args: { p_request_id: "request-1", p_idempotency_key: "legal-partner:wamid.authorized" } });
});

Deno.test("PENDING or DECLINED consent never invokes the assignment RPC", async () => {
  for (const consent of ["PENDING", "DECLINED", undefined]) {
    const fake = fakeRpc({ success: true, request_id: "request-1", created: true, assigned: false, notification_created: false });
    await captureLegalFlowRequest({
      supabase: fake.supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-1",
      channelUserId: "whatsapp-user-1", deliveryKey: "wamid.pending",
      completedAt: "2026-09-08T13:36:58.718Z",
      sharingConsent: consent,
      fields,
    });
    assertEquals(fake.calls.length, 1, `consent=${consent} must not call the assignment RPC`);
  }
});

Deno.test("a capture RPC error surfaces as legal_flow_request_capture_failed, never silently swallowed", async () => {
  const supabase = { rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
  let threw = false;
  try {
    await captureLegalFlowRequest({
      supabase, organizationId: "luis-gabriel-referral-hub", leadId: "lead-1",
      channelUserId: "whatsapp-user-1", deliveryKey: "wamid.err",
      completedAt: "2026-09-08T13:36:58.718Z", fields,
    });
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "legal_flow_request_capture_failed");
  }
  assertEquals(threw, true);
});
