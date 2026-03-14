import { createClient, type SupabaseClient as SupabaseClientBase } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  startTrial,
  beginOnboarding,
  captureBusinessType,
  captureLeadGoal,
  showDemo,
  bookAppointment,
} from "./tools.ts";
import { syncCalendarEvent } from "./calendar/calendarSync.ts";
import { CreateCalendarEventInput } from "./calendar/types.ts";

type Json = Record<string, unknown>;

type SupabaseClientType = SupabaseClientBase<any, "public", any>;

const nowIso = () => new Date().toISOString();

export type ToolActionName =
  | "show_demo"
  | "start_trial"
  | "begin_onboarding"
  | "capture_business_type"
  | "capture_lead_goal"
  | "book_appointment";

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
  supabase: SupabaseClientType;
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
      case "book_appointment": {
        const payload: Record<string, unknown> = action.payload ?? {};
        const appointmentDate = String(payload.appointment_date ?? "").trim();
        const appointmentTime = String(payload.appointment_time ?? "").trim();
        const startsAtPayload = String(payload.starts_at ?? "").trim();
        const endsAtPayload = String(payload.ends_at ?? "").trim();
        const durationMin = Number.isFinite(Number(payload.duration_min ?? 0)) && Number(payload.duration_min ?? 0) > 0
          ? Number(payload.duration_min ?? 0)
          : 60;
        const channel = String(payload.channel ?? "messenger");
        const startIso = buildIsoTimestamp(appointmentDate, appointmentTime, startsAtPayload);
        const endIso = buildEndIso(endsAtPayload, startIso, durationMin);
        if (!startIso) {
          console.warn("[actionExecutor] missing start time", { leadId, organizationId });
          break;
        }
        toolResult = await bookAppointment({
          organization_id: organizationId,
          lead_id: leadId,
          start_at: startIso ?? undefined,
          end_at: endIso ?? undefined,
          channel,
        });
        const metadata: Record<string, unknown> = {
          channel,
          duration_min: durationMin,
          source: "run_replies",
        };
        const providerValue = String(payload.calendar_provider ?? payload.provider ?? "").trim();
        const calendarIdValue = String(payload.calendar_id ?? "").trim();
        if (providerValue) metadata.calendar_provider = providerValue;
        if (calendarIdValue) metadata.calendar_id = calendarIdValue;
        let appointmentId: string | null = null;
        try {
          const insertResult = await supabase
            .from("appointments")
            .insert({
              organization_id: organizationId,
              lead_id: leadId,
              start_at: startIso,
              starts_at: startIso,
              end_at: endIso,
              ends_at: endIso,
              status: "booked",
              appointment_date: appointmentDate || startIso.slice(0, 10),
              appointment_time: appointmentTime || startIso.slice(11, 16),
              metadata,
              calendar_provider: providerValue || null,
              calendar_id: calendarIdValue || null,
              calendar_sync_status: "pending",
            })
            .select("id")
            .single();
          appointmentId = insertResult.data?.id ?? null;
        } catch (error) {
          console.warn("[actionExecutor] appointment_insert_failed", {
            error: safeString(error),
            leadId,
            organizationId,
          });
        }
        const syncInput: CreateCalendarEventInput & { provider?: string } = {
          provider: providerValue,
          calendar_id: calendarIdValue,
          organization_id: organizationId,
          title: payload.title ?? "Cita",
          description: payload.description ?? "",
          starts_at: startIso,
          ends_at: endIso,
          patient_name: payload.patient_name ?? "",
          patient_email: payload.patient_email ?? "",
          patient_phone: payload.patient_phone ?? "",
          metadata,
        };
        const syncResult = await syncCalendarEvent(syncInput as any);
        if (appointmentId) {
          await supabase
            .from("appointments")
            .update({
              calendar_provider: providerValue || syncResult.provider || null,
              calendar_id: calendarIdValue || null,
              calendar_event_id: syncResult.event_id ?? null,
              calendar_sync_status: syncResult.sync_status,
              calendar_sync_error: syncResult.error ?? null,
              calendar_last_synced_at: nowIso(),
            })
            .eq("id", appointmentId);
        }
        statePatch = {
          collected: {
            appointment_scheduled: true,
            booking: {
              preferred_date: appointmentDate || null,
              preferred_time: appointmentTime || null,
              starts_at: startIso,
              start_at: startIso,
              ends_at: endIso,
              end_at: endIso,
              duration_min: durationMin,
              last_question_key: "booking_confirmed",
              completed: true,
            },
          },
        };
        eventType = "appointment_booked";
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

function buildIsoTimestamp(date: string, time: string, overrideValue: string): string | null {
  const candidate = overrideValue?.trim();
  if (candidate && isIsoTs(candidate)) return candidate;
  if (date && time) {
    const constructed = `${date}T${time}:00`;
    const parsed = new Date(constructed);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return null;
}

function buildEndIso(overrideValue: string, startIso: string | null, durationMin: number): string | null {
  const candidate = overrideValue?.trim();
  if (candidate && isIsoTs(candidate)) return candidate;
  if (startIso) {
    const base = new Date(startIso);
    if (!Number.isNaN(base.valueOf())) {
      const endTs = new Date(base.getTime() + Math.max(1, durationMin) * 60 * 1000);
      return endTs.toISOString();
    }
  }
  return null;
}

function isIsoTs(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
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
