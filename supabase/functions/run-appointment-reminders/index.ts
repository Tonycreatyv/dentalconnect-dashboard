import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReqBody = {
  organization_id?: string;
  limit?: number;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-run-reminders-secret",
    },
  });
}

function safeStr(v: unknown, d = "") {
  if (typeof v === "string") return v;
  if (v == null) return d;
  return String(v);
}

function inWindow(targetIso: string, fromMinutes: number, toMinutes: number) {
  const deltaMin = (new Date(targetIso).getTime() - Date.now()) / 60000;
  return deltaMin <= toMinutes && deltaMin >= fromMinutes;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const expected = safeStr(Deno.env.get("RUN_REMINDERS_SECRET"), "");
    const provided = safeStr(req.headers.get("x-run-reminders-secret"), "");
    if (expected && provided !== expected) return json(401, { ok: false, error: "unauthorized" });

    const SUPABASE_URL = safeStr(Deno.env.get("SUPABASE_URL"), "");
    const SERVICE_KEY = safeStr(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: "missing_supabase_env" });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const orgId = safeStr(body.organization_id, "").trim();
    if (!orgId) return json(400, { ok: false, error: "missing_organization_id" });
    const limit = Math.max(1, Math.min(Number(body.limit ?? 100) || 100, 500));

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const upcoming = await sb
      .from("appointments")
      .select("id, lead_id, start_at, starts_at, status, reason, title")
      .eq("organization_id", orgId)
      .in("status", ["pending", "requested", "confirmed"])
      .gte("start_at", new Date(Date.now() + 90 * 60000).toISOString())
      .lte("start_at", new Date(Date.now() + 25 * 60 * 60000).toISOString())
      .order("start_at", { ascending: true })
      .limit(limit);

    if (upcoming.error) return json(500, { ok: false, error: upcoming.error.message });

    let sent24h = 0;
    let sent2h = 0;

    for (const appt of upcoming.data ?? []) {
      const startIso = safeStr((appt as any).start_at ?? (appt as any).starts_at, "");
      if (!startIso) continue;
      const leadId = safeStr((appt as any).lead_id, "");
      if (!leadId) continue;

      const leadRes = await sb
        .from("leads")
        .select("id, channel, channel_user_id, full_name")
        .eq("organization_id", orgId)
        .eq("id", leadId)
        .maybeSingle();
      if (leadRes.error || !leadRes.data) continue;
      const channelUserId = safeStr((leadRes.data as any).channel_user_id, "");
      if (!channelUserId) continue;

      const is24h = inWindow(startIso, 23 * 60, 24 * 60 + 10);
      const is2h = inWindow(startIso, 110, 130);
      if (!is24h && !is2h) continue;

      const eventType = is24h ? "reminder_24h_sent" : "reminder_2h_sent";
      const existingEvent = await sb
        .from("appointment_events")
        .select("id")
        .eq("organization_id", orgId)
        .eq("appointment_id", safeStr((appt as any).id, ""))
        .eq("event_type", eventType)
        .limit(1)
        .maybeSingle();

      if (!existingEvent.error && existingEvent.data?.id) continue;

      const text = is24h
        ? `Hola 👋 Te recordamos tu cita mañana a las ${new Date(startIso).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" })}. ¿Confirmas tu asistencia?`
        : `Hola 👋 Recordatorio: tu cita es hoy a las ${new Date(startIso).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" })}. ¿Necesitas reagendar?`;

      const enqueue = await sb.from("reply_outbox").insert({
        organization_id: orgId,
        lead_id: leadId,
        channel: safeStr((leadRes.data as any).channel, "messenger"),
        channel_user_id: channelUserId,
        status: "queued",
        scheduled_for: new Date().toISOString(),
        message_text: text,
        payload: {
          source: is24h ? "appointment_reminder_24h" : "appointment_reminder_2h",
          provider: "meta",
          text,
          appointment_id: safeStr((appt as any).id, ""),
        },
      });
      if (enqueue.error) continue;

      await sb.from("appointment_events").insert({
        organization_id: orgId,
        appointment_id: safeStr((appt as any).id, ""),
        event_type: eventType,
        payload: {
          lead_id: leadId,
          channel_user_id: channelUserId,
          outbox_source: is24h ? "appointment_reminder_24h" : "appointment_reminder_2h",
        },
      });

      if (is24h) sent24h += 1;
      if (is2h) sent2h += 1;
    }

    return json(200, { ok: true, organization_id: orgId, sent24h, sent2h });
  } catch (error) {
    return json(500, { ok: false, error: safeStr((error as Error)?.message, String(error)) });
  }
});
