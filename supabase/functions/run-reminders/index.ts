import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(status: number, body: unknown, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function safeStr(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const now = new Date();
    const reminderWindowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
    const reminderWindowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

    const { data: appointments, error: fetchErr } = await supabase
      .from("appointments")
      .select(
        "id, organization_id, lead_id, patient_name, reason, title, start_at, appointment_date, appointment_time, status, reminder_status"
      )
      .in("status", ["confirmed", "pending"])
      .or("reminder_status.is.null,reminder_status.eq.pending")
      .gte("start_at", reminderWindowStart)
      .lte("start_at", reminderWindowEnd)
      .limit(50);

    if (fetchErr) {
      console.error("[run-reminders] fetch error:", fetchErr);
      return json(500, { ok: false, error: fetchErr.message }, corsHeaders);
    }

    if (!appointments?.length) {
      return json(200, { ok: true, reminders_sent: 0, message: "No reminders due" }, corsHeaders);
    }

    let sent = 0;
    let failed = 0;

    for (const appt of appointments) {
      try {
        const { data: lead } = await supabase
          .from("leads")
          .select("channel_user_id, full_name, first_name, channel")
          .eq("id", appt.lead_id)
          .maybeSingle();

        if (!lead?.channel_user_id || safeStr(lead.channel, "messenger") !== "messenger") {
          console.warn("[run-reminders] no messenger PSID for lead:", appt.lead_id);
          await supabase.from("appointments").update({
            reminder_status: "skipped",
          }).eq("id", appt.id);
          continue;
        }

        const { data: settings } = await supabase
          .from("org_settings")
          .select("meta_page_access_token")
          .eq("organization_id", appt.organization_id)
          .maybeSingle();

        const pageToken = safeStr(settings?.meta_page_access_token, "").trim();
        if (!pageToken) {
          console.warn("[run-reminders] no page token for org:", appt.organization_id);
          await supabase.from("appointments").update({
            reminder_status: "skipped",
          }).eq("id", appt.id);
          continue;
        }

        const { data: clinic } = await supabase
          .from("clinics")
          .select("name")
          .eq("organization_id", appt.organization_id)
          .limit(1)
          .maybeSingle();

        const clinicName = safeStr(clinic?.name, "la clínica");
        const patientFirstName = safeStr(lead.first_name, "")
          || (safeStr(lead.full_name, "").trim() ? safeStr(lead.full_name, "").trim().split(/\s+/)[0] ?? "" : "")
          || "";

        const apptDate = new Date(appt.start_at);
        const dateStr = apptDate.toLocaleDateString("es-HN", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
        const timeStr = apptDate.toLocaleTimeString("es-HN", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        const service = safeStr(appt.reason, "") || safeStr(appt.title, "") || "tu cita";

        const greeting = patientFirstName ? `¡Hola, ${patientFirstName}! 👋` : "¡Hola! 👋";
        const reminderText = `${greeting}\n\nTe recordamos tu cita de mañana en ${clinicName}:\n\n🦷 ${service}\n📅 ${dateStr}\n🕐 ${timeStr}\n\n¿Nos confirmas que asistirás? 😊`;

        const sendRes = await fetch(
          `https://graph.facebook.com/v19.0/me/messages?access_token=${pageToken}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: lead.channel_user_id },
              message: { text: reminderText },
              messaging_type: "MESSAGE_TAG",
              tag: "CONFIRMED_EVENT_UPDATE",
            }),
          }
        );

        const sendData = await sendRes.json();
        if (!sendRes.ok || sendData?.error) {
          console.error("[run-reminders] send failed:", {
            appointment_id: appt.id,
            error: sendData?.error ?? sendData,
          });
          await supabase.from("appointments").update({
            reminder_status: "failed",
            reminder_sent_at: new Date().toISOString(),
          }).eq("id", appt.id);
          failed++;
          continue;
        }

        await supabase.from("appointments").update({
          reminder_status: "sent",
          reminder_sent_at: new Date().toISOString(),
        }).eq("id", appt.id);

        await supabase.from("messages").insert({
          organization_id: appt.organization_id,
          lead_id: appt.lead_id,
          channel: lead.channel ?? "messenger",
          channel_user_id: lead.channel_user_id,
          role: "assistant",
          actor: "bot",
          content: reminderText,
          created_at: new Date().toISOString(),
        });

        sent++;
        console.log("[run-reminders] sent reminder:", {
          appointment_id: appt.id,
          patient: patientFirstName,
        });
      } catch (err) {
        console.error("[run-reminders] error processing appointment:", {
          appointment_id: appt.id,
          error: (err as any)?.message ?? err,
        });
        failed++;
      }
    }

    return json(200, {
      ok: true,
      reminders_sent: sent,
      failed,
      total: appointments.length,
    }, corsHeaders);
  } catch (err) {
    console.error("[run-reminders] fatal:", err);
    return json(500, {
      ok: false,
      error: (err as any)?.message ?? "unknown",
    }, corsHeaders);
  }
});
