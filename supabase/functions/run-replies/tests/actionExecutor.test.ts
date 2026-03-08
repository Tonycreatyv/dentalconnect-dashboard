import { assertEquals } from "https://deno.land/std@0.223.0/testing/asserts.ts";
import { executeToolAction, type ToolActionExecution } from "../domain/actionExecutor.ts";

function createFakeSupabase() {
  const calls: Array<{ table: string; payload: unknown }> = [];
  const client = {
    from(table: string) {
      return {
        insert(payload: unknown) {
          calls.push({ table, payload });
          return Promise.resolve({ error: null, data: [] });
        },
      };
    },
  } as any;
  return { client, calls };
}

Deno.test("start_trial tool action updates state and logs event", async () => {
  const fake = createFakeSupabase();
  const action: ToolActionExecution = { name: "start_trial" };
  const result = await executeToolAction({ supabase: fake.client, organizationId: "org", leadId: "lead-1", action });
  assertEquals(result.statePatch?.stage, "ACTIVATION");
  assertEquals(result.statePatch?.collected?.trial_offered, true);
  assertEquals(result.statePatch?.collected?.trial_offered_at, result.statePatch?.collected?.trial_offered_at);
  assertEquals(result.event?.type, "trial_offered");
  assertEquals(fake.calls.length, 1);
  assertEquals((fake.calls[0].payload as any).event_type, "trial_offered");
});

Deno.test("begin_onboarding marks onboarding_started and logs event", async () => {
  const fake = createFakeSupabase();
  const action: ToolActionExecution = { name: "begin_onboarding" };
  const result = await executeToolAction({ supabase: fake.client, organizationId: "org", leadId: "lead-2", action });
  assertEquals(result.statePatch?.stage, "ACTIVATION");
  assertEquals(result.statePatch?.collected?.onboarding_started, true);
  assertEquals(result.event?.type, "onboarding_started");
  assertEquals((fake.calls[0].payload as any).lead_id, "lead-2");
});

Deno.test("capture_business_type persists business_type on both levels", async () => {
  const fake = createFakeSupabase();
  const action: ToolActionExecution = { name: "capture_business_type", payload: { businessType: "auto_sales" } };
  const result = await executeToolAction({ supabase: fake.client, organizationId: "org", leadId: "lead-3", action });
  assertEquals(result.statePatch?.business_type, "auto_sales");
  assertEquals(result.statePatch?.collected?.business_type, "auto_sales");
  assertEquals(result.event?.type, "business_type_captured");
});

Deno.test("capture_lead_goal stores selected_pain", async () => {
  const fake = createFakeSupabase();
  const action: ToolActionExecution = { name: "capture_lead_goal", payload: { goal: "responder mas rapido" } };
  const result = await executeToolAction({ supabase: fake.client, organizationId: "org", leadId: "lead-4", action });
  assertEquals(result.statePatch?.collected?.selected_pain, "responder mas rapido");
  assertEquals(result.event?.type, "lead_goal_captured");
});
