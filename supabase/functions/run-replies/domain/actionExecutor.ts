import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  startTrial,
  beginOnboarding,
  captureBusinessType,
  captureLeadGoal,
  showDemo,
} from "./tools.ts";

type Json = Record<string, unknown>;

const nowIso = () => new Date().toISOString();

export type ToolActionName =
  | "show_demo"
  | "start_trial"
  | "begin_onboarding"
  | "capture_business_type"
  | "capture_lead_goal";

export type ToolActionExecution = {
  name: ToolActionName;
  payload?: Json;
};

export type ActionExecutionResult = {
  statePatch?: Json;
  event?: { type: string; payload: Json };
};

function buildEventPayload(action: ToolActionExecution, toolResult: Json | undefined, now: string): Json {
  return {
    action: action.name,
    tool_payload: action.payload ?? {},
    result: toolResult ?? {},
    timestamp: now,
  };
}

export async function executeToolAction(params: {
  supabase: ReturnType<typeof createClient>;
  organizationId: string;
  leadId: string;
  action: ToolActionExecution;
}): Promise<ActionExecutionResult> {
  const { supabase, organizationId, leadId, action } = params;
  if (!leadId) return {};
  const now = nowIso();
  let statePatch: Json | undefined;
  let eventType: string | undefined;
  let toolResult: Json | undefined;

  try {
    switch (action.name) {
      case "start_trial": {
        toolResult = await startTrial(leadId);
        statePatch = {
          stage: "ACTIVATION",
          collected: {
            trial_offered: true,
            trial_offered_at: now,
          },
        };
        eventType = "trial_offered";
        break;
      }
      case "begin_onboarding": {
        toolResult = await beginOnboarding(leadId);
        statePatch = {
          stage: "ACTIVATION",
          collected: {
            onboarding_started: true,
            onboarding_started_at: now,
          },
        };
        eventType = "onboarding_started";
        break;
      }
      case "capture_business_type": {
        const businessType = String(action.payload?.businessType ?? "").trim();
        toolResult = await captureBusinessType(leadId, businessType);
        statePatch = {
          business_type: businessType || null,
          collected: {
            business_type: businessType || null,
          },
        };
        eventType = "business_type_captured";
        break;
      }
      case "capture_lead_goal": {
        const goal = String(action.payload?.goal ?? "").trim();
        toolResult = await captureLeadGoal(leadId, goal);
        statePatch = {
          collected: {
            selected_pain: goal || null,
            last_pain_selected_at: now,
          },
        };
        eventType = "lead_goal_captured";
        break;
      }
      case "show_demo": {
        toolResult = await showDemo();
        eventType = "demo_interest_detected";
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.warn("[actionExecutor] tool call failed", {
      action: action.name,
      leadId,
      organizationId,
      error: safeString(error),
    });
  }

  if (eventType) {
    const payload = buildEventPayload(action, toolResult, now);
    try {
      await supabase.from("lead_events").insert({
        organization_id: organizationId,
        lead_id: leadId,
        event_type: eventType,
        payload,
        created_at: now,
      });
    } catch (error) {
      console.warn("[actionExecutor] lead_events insert failed", {
        error: safeString(error),
        eventType,
        leadId,
      });
    }
    return { statePatch, event: { type: eventType, payload } };
  }
  return { statePatch };
}

function safeString(value: unknown) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
