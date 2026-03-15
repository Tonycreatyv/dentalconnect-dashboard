import { buildAppointmentPayload, AppointmentPayload } from "./appointments.ts";
import { CalendarAdapter, StubCalendarAdapter } from "./calendarAdapter.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const calendarAdapter: CalendarAdapter = new StubCalendarAdapter();

// URLs de productos
const PRODUCT_URLS = {
  dental_signup: "https://dental.creatyv.io/signup",
  dental_landing: "https://creatyv.io/dentalconnect",
  creatyv_main: "https://creatyv.io",
};

export async function createLead(payload: Record<string, unknown>) {
  return { ok: true, lead_id: payload.lead_id ?? "stub" };
}

export async function getLead(id: string) {
  return { ok: true, lead: { id, name: "Lead Stub" } };
}

export async function updateLead(id: string, changes: Record<string, unknown>) {
  return { ok: true, updated: changes };
}

export async function checkCalendar(orgId: string) {
  return { ok: true, available: true };
}

export async function bookAppointment(args: {
  organization_id: string;
  lead_id: string;
  start_at?: string;
  end_at?: string;
  channel?: string;
}): Promise<{ ok: boolean; appointment: AppointmentPayload; calendar?: string }> {
  const appointment = buildAppointmentPayload({
    organization_id: args.organization_id,
    lead_id: args.lead_id,
    channel: args.channel,
    start_at: args.start_at,
    end_at: args.end_at,
    source: "run_replies",
  });
  const calendar = await calendarAdapter.bookEvent({ 
    appointmentId: appointment.id, 
    startAt: appointment.start_at ?? undefined, 
    endAt: appointment.end_at ?? undefined 
  });
  return {
    ok: calendar.ok,
    appointment: { ...appointment, calendar_event_id: calendar.eventId ?? null },
    calendar: calendar.eventId,
  };
}

export async function cancelAppointment({ eventId }: { eventId: string }) {
  const result = await calendarAdapter.cancelEvent({ eventId });
  return { ok: result.ok, canceled_event: eventId, message: result.message };
}

export async function rescheduleAppointment({ eventId, start_at, end_at }: { eventId: string; start_at?: string; end_at?: string }) {
  const result = await calendarAdapter.rescheduleEvent({ eventId, startAt: start_at, endAt: end_at });
  return { ok: result.ok, rescheduled_event: eventId, message: result.message };
}

export async function sendFollowup(args: Record<string, unknown>) {
  return { ok: true, followup_id: "stub-followup", scheduled: args.date ?? "tomorrow" };
}

export async function showDemo() {
  return { ok: true, message: "Demo trigger recorded" };
}

export async function startTrial(leadId: string) {
  return { ok: true, trial_id: `${leadId}-trial`, started_at: new Date().toISOString() };
}

export async function beginOnboarding(leadId: string) {
  return { ok: true, onboarding_id: `${leadId}-onboard`, started_at: new Date().toISOString() };
}

export async function captureBusinessType(leadId: string, businessType: string) {
  return { ok: true, business_type: businessType, lead_id: leadId };
}

export async function captureLeadGoal(leadId: string, goal: string) {
  return { ok: true, goal, lead_id: leadId };
}

// ============================================
// CREATE TRIAL ACCOUNT - Genera link de signup
// ============================================
export async function createTrialAccount(args: {
  supabase: ReturnType<typeof createClient>;
  organizationId: string;
  leadId: string;
  email: string;
  name?: string;
  businessType?: string;
}): Promise<{
  ok: boolean;
  signupUrl?: string;
  error?: string;
  productUrls?: typeof PRODUCT_URLS;
}> {
  const { supabase, leadId, email, name, businessType } = args;

  // Validar email
  if (!email || !email.includes("@")) {
    return { ok: false, error: "invalid_email" };
  }

  // Generar token único
  const signupToken = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    // Actualizar lead con email y token
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        email: email.toLowerCase().trim(),
        signup_token: signupToken,
        signup_requested_at: now,
      })
      .eq("id", leadId);

    if (updateError) {
      console.error("[createTrialAccount] update lead failed:", updateError);
      return { ok: false, error: "db_error" };
    }

    // Construir URL de signup
    const signupUrl = `${PRODUCT_URLS.dental_signup}?email=${encodeURIComponent(email)}&token=${signupToken}`;

    console.log("[createTrialAccount] success", { 
      leadId, 
      email, 
      signupUrl,
      name,
      businessType 
    });

    return {
      ok: true,
      signupUrl,
      productUrls: PRODUCT_URLS,
    };
  } catch (err) {
    console.error("[createTrialAccount] error:", err);
    return { ok: false, error: String(err) };
  }
}