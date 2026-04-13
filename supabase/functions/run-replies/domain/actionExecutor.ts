import {
  createClient,
  type SupabaseClient as SupabaseClientBase,
} from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  beginOnboarding,
  bookAppointment,
  captureBusinessType,
  captureLeadGoal,
  createTrialAccount,
  showDemo,
  startTrial,
} from "./tools.ts";
import { syncCalendarEvent } from "./calendar/calendarSync.ts";

type Json = Record<string, unknown>;
type SupabaseClientType = SupabaseClientBase<any, "public", any>;

const nowIso = () => new Date().toISOString();

export type ToolActionName =
  | "show_demo"
  | "start_trial"
  | "begin_onboarding"
  | "capture_business_type"
  | "capture_lead_goal"
  | "book_appointment"
  | "cancel_appointment" 
  | "create_trial_account"
  | "get_clinic_info"; // Nueva herramienta para que la IA pregunte precios/horarios

export type ToolActionExecution = {
  name: ToolActionName;
  payload?: Json;
};

export type ActionExecutionResult = {
  statePatch?: Json;
  event?: { type: string; payload: Json };
  replyOverride?: string;
};

/**
 * Función para obtener el contexto real de la clínica (Precios, Horarios, Info)
 */
async function getClinicContext(supabase: SupabaseClientType, organizationId: string) {
  const { data: org } = await supabase.from('org_settings').select('name, address, phone, specialties, timezone').eq('organization_id', organizationId).single();
  const { data: services } = await supabase.from('services').select('name, price, duration_min').eq('organization_id', organizationId);
  const { data: hours } = await supabase.from('business_hours').select('day_of_week, open_time, close_time, is_closed').eq('organization_id', organizationId);

  const servicesText = services?.map(s => `- ${s.name}: ${s.price} LPS (${s.duration_min} min)`).join('\n') || "No hay servicios listados.";
  const hoursText = hours?.map(h => `Día ${h.day_of_week}: ${h.is_closed ? 'Cerrado' : `${h.open_time} - ${h.close_time}`}`).join('\n') || "Horarios no configurados.";

  return `
    CLÍNICA: ${org?.name || 'DentalConnect Clinic'}
    UBICACIÓN: ${org?.address || 'No especificada'}
    TELÉFONO: ${org?.phone || 'No especificado'}
    SERVICIOS Y PRECIOS:
    ${servicesText}
    HORARIOS DE ATENCIÓN:
    ${hoursText}
  `;
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
  let replyOverride: string | undefined;

  // Obtener info de la organización (Timezone)
  const { data: orgData } = await supabase.from("org_settings").select("timezone").eq("organization_id", organizationId).single();
  const orgTimezone = orgData?.timezone || "America/Tegucigalpa";

  try {
    switch (action.name) {
      case "get_clinic_info": {
        const context = await getClinicContext(supabase, organizationId);
        replyOverride = `Aquí tienes la información oficial: ${context}`;
        break;
      }

      case "book_appointment": {
        const payload: Record<string, unknown> = action.payload ?? {};
        const appointmentDate = String(payload.appointment_date ?? "").trim();
        const appointmentTime = String(payload.appointment_time ?? "").trim();
        const patientName = String(payload.patient_name ?? "").trim();
        const service = String(payload.service ?? payload.reason ?? "Consulta General").trim();
        
        const startIso = buildIsoTimestamp(appointmentDate, appointmentTime, String(payload.starts_at ?? ""), orgTimezone);
        const durationMin = Number(payload.duration_min) || 60;
        const endIso = buildEndIso(String(payload.ends_at ?? ""), startIso, durationMin);

        if (!startIso) break;

        const appointmentFields = {
          organization_id: organizationId,
          lead_id: leadId,
          patient_name: patientName || null,
          reason: service,
          start_at: startIso,
          starts_at: startIso,
          end_at: endIso,
          ends_at: endIso || startIso,
          status: "confirmed",
          appointment_date: appointmentDate || startIso.slice(0, 10),
          appointment_time: appointmentTime || startIso.slice(11, 16),
          title: `Cita: ${service}`,
          updated_at: now,
        };

        const { data: existingAppt } = await supabase.from("appointments").select("id").eq("lead_id", leadId).eq("organization_id", organizationId).in("status", ["confirmed", "pending"]).maybeSingle();

        let appointmentId: string | null = null;
        if (existingAppt?.id) {
          const { data } = await supabase.from("appointments").update(appointmentFields).eq("id", existingAppt.id).select("id").single();
          appointmentId = data?.id ?? null;
        } else {
          const { data } = await supabase.from("appointments").insert({ ...appointmentFields, created_at: now }).select("id").single();
          appointmentId = data?.id ?? null;
        }

        if (appointmentId) {
          await syncCalendarEvent({
            organization_id: organizationId,
            title: appointmentFields.title,
            starts_at: startIso,
            ends_at: endIso || startIso,
            patient_name: patientName,
            metadata: { source: "groq_ai_bot", appointment_id: appointmentId }
          } as any);
        }

        statePatch = { stage: "BOOKING_CONFIRMED", collected: { booking: { completed: true, date: appointmentDate, time: appointmentTime } } };
        eventType = "appointment_booked";
        replyOverride = `¡Listo! He agendado tu cita de ${service} para el ${appointmentDate} a las ${appointmentTime}. ¡Te esperamos! 🦷✨`;
        break;
      }

      case "create_trial_account": {
        const email = String(action.payload?.email ?? "").trim().toLowerCase();
        const name = String(action.payload?.name ?? "").trim();
        if (!email.includes("@") || name.length < 2) {
          replyOverride = "Por favor, dime tu nombre y tu correo para prepararte el acceso correctamente. 😊";
          break;
        }
        await supabase.from("leads").upsert({ organization_id: organizationId, email, full_name: name, status: "interested", updated_at: now }, { onConflict: "email" });
        const result = await createTrialAccount({ supabase: supabase as any, organizationId, leadId, email, name, businessType: "dental" });
        if (result.ok) {
          const finalUrl = `https://dental.creatyv.io/signup?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`;
          statePatch = { stage: "SIGNUP_LINK_SENT", collected: { email, signup_url: finalUrl } };
          eventType = "trial_signup_link_sent";
          replyOverride = `¡Excelente, ${name}! He preparado tu acceso de prueba por 14 días. Entra aquí: ${finalUrl} \n\nConfigura tu clínica en 5 minutos. 🚀`;
        }
        break;
      }
      default: break;
    }
  } catch (error) {
    console.error("[actionExecutor] ERROR:", error);
  }

  if (eventType) {
    try {
      await supabase.from("lead_events").insert({ organization_id: organizationId, lead_id: leadId, event_type: eventType, payload: { action: action.name, timestamp: now } });
    } catch (e) { console.warn("Error logueando evento"); }
    return { statePatch, event: { type: eventType, payload: { action: action.name } }, replyOverride };
  }
  return { statePatch, replyOverride };
}

function buildIsoTimestamp(date: string, time: string, override: string, timezone: string): string | null {
  if (override && /^\d{4}-\d{2}-\d{2}T/.test(override)) return override;
  if (!date || !time) return null;
  const tzOffsets: Record<string, string> = {
    "America/Tegucigalpa": "-06:00",
    "America/Guatemala": "-06:00",
    "America/Costa_Rica": "-06:00",
    "America/Mexico_City": "-06:00",
    "America/Bogota": "-05:00",
    "America/Lima": "-05:00",
    "America/New_York": "-04:00",
    "America/Chicago": "-05:00",
    "America/Denver": "-06:00",
    "America/Los_Angeles": "-07:00",
  };
  const offset = tzOffsets[timezone] || "-06:00";
  const timeNorm = time.includes(":") ? time : `${time}:00`;
  const timeWithSec = timeNorm.length === 5 ? `${timeNorm}:00` : timeNorm;
  const constructed = `${date}T${timeWithSec}${offset}`;
  const parsed = new Date(constructed);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString();
  }
  return null;
}

function buildEndIso(override: string, startIso: string | null, duration: number): string | null {
  if (override && /^\d{4}-\d{2}-\d{2}T/.test(override)) return override;
  if (!startIso) return null;
  return new Date(new Date(startIso).getTime() + duration * 60000).toISOString();
}