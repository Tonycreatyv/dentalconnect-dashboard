import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReqBody = {
  organization_id?: string;
  action_id?: string;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

function safeStr(v: unknown, d = "") {
  if (typeof v === "string") return v;
  if (v == null) return d;
  return String(v);
}

async function enqueueMessage(args: {
  sb: ReturnType<typeof createClient>;
  organizationId: string;
  leadId: string;
  channel: string;
  channelUserId: string;
  text: string;
  source: string;
}) {
  return await args.sb.from("reply_outbox").insert({
    organization_id: args.organizationId,
    lead_id: args.leadId,
    channel: args.channel || "messenger",
    channel_user_id: args.channelUserId,
    status: "queued",
    scheduled_for: new Date().toISOString(),
    message_text: args.text,
    payload: {
      source: args.source,
      provider: "meta",
      text: args.text,
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const SUPABASE_URL = safeStr(Deno.env.get("SUPABASE_URL"), "");
    const SERVICE_KEY = safeStr(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: "missing_supabase_env" });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const organizationId = safeStr(body.organization_id, "").trim();
    const actionId = safeStr(body.action_id, "").trim();
    if (!organizationId || !actionId) return json(400, { ok: false, error: "missing_org_or_action_id" });

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const actionRes = await sb
      .from("actions")
      .select("id, type, status, payload")
      .eq("id", actionId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (actionRes.error || !actionRes.data) return json(404, { ok: false, error: "action_not_found" });
    const action = actionRes.data as any;
    if (String(action.status) !== "open") return json(400, { ok: false, error: "action_not_open" });

    let executed = 0;
    const type = safeStr(action.type, "");
    const payload = (action.payload ?? {}) as Record<string, any>;

    if (type === "schedule_gaps" || type === "appointment_cancelled") {
      const rpc = await sb.rpc("offer_waitlist_for_slot", {
        p_org_id: organizationId,
        p_slot_start: payload.slot_start,
        p_slot_end: payload.slot_end,
        p_service_type: payload.service_type ?? "general",
        p_trigger_source: "action_engine",
      });
      if (rpc.error) return json(500, { ok: false, error: `offer_waitlist_failed:${rpc.error.message}` });
      executed = Number((rpc.data as any)?.queued ?? 0);
    } else if (type === "request_review") {
      const leadId = safeStr(payload.lead_id, "");
      const channel = safeStr(payload.channel, "messenger");
      const channelUserId = safeStr(payload.channel_user_id, "");
      const text =
        safeStr(payload.text, "") ||
        "Gracias por visitarnos hoy. Si tu experiencia fue buena, nos ayudaría mucho una reseña.";
      if (leadId && channelUserId && text) {
        const r = await enqueueMessage({
          sb,
          organizationId,
          leadId,
          channel,
          channelUserId,
          text,
          source: "action_request_review",
        });
        if (!r.error) {
          executed = 1;
          await sb.from("growth_events").insert({
            organization_id: organizationId,
            event_type: "review_requested",
            lead_id: leadId,
            appointment_id: safeStr(payload.appointment_id, "") || null,
            metadata: {
              source: "execute_action",
              action_id: actionId,
            },
          });
        }
      }
    } else if (type === "messages_unanswered") {
      const leads = await sb
        .from("leads")
        .select("id, channel, channel_user_id, last_message_at, last_bot_reply_at")
        .eq("organization_id", organizationId)
        .not("channel_user_id", "is", null)
        .order("last_message_at", { ascending: false })
        .limit(10);
      for (const lead of leads.data ?? []) {
        const lm = (lead as any).last_message_at ? new Date((lead as any).last_message_at).getTime() : 0;
        const lb = (lead as any).last_bot_reply_at ? new Date((lead as any).last_bot_reply_at).getTime() : 0;
        if (!lm || lm <= lb) continue;
        const r = await enqueueMessage({
          sb,
          organizationId,
          leadId: safeStr((lead as any).id),
          channel: safeStr((lead as any).channel, "messenger"),
          channelUserId: safeStr((lead as any).channel_user_id),
          text: "Seguimos disponibles para ayudarte. ¿Te parece si avanzamos con el siguiente paso?",
          source: "action_messages_unanswered",
        });
        if (!r.error) executed += 1;
        if (executed >= 3) break;
      }
    } else if (type === "unconfirmed_appointments") {
      const tomorrowStart = new Date(Date.now() + 24 * 60 * 60 * 1000); tomorrowStart.setHours(0, 0, 0, 0);
      const tomorrowEnd = new Date(Date.now() + 24 * 60 * 60 * 1000); tomorrowEnd.setHours(23, 59, 59, 999);
      const appts = await sb
        .from("appointments")
        .select("lead_id")
        .eq("organization_id", organizationId)
        .gte("start_at", tomorrowStart.toISOString())
        .lte("start_at", tomorrowEnd.toISOString())
        .in("status", ["pending", "requested"])
        .limit(10);
      const leadIds = Array.from(new Set((appts.data ?? []).map((r: any) => safeStr(r?.lead_id, "")).filter(Boolean)));
      if (leadIds.length > 0) {
        const leads = await sb
          .from("leads")
          .select("id, channel, channel_user_id")
          .eq("organization_id", organizationId)
          .in("id", leadIds);
        for (const lead of leads.data ?? []) {
          const r = await enqueueMessage({
            sb,
            organizationId,
            leadId: safeStr((lead as any).id),
            channel: safeStr((lead as any).channel, "messenger"),
            channelUserId: safeStr((lead as any).channel_user_id),
            text: "Te recordamos tu cita de mañana. ¿La confirmamos?",
            source: "action_unconfirmed_appointments",
          });
          if (!r.error) executed += 1;
          if (executed >= 3) break;
        }
      }
    } else if (type === "send_recall_message" || type === "patient_recall_due") {
      const explicitLeadId = safeStr(payload.lead_id, "");
      if (explicitLeadId) {
        const lead = await sb
          .from("leads")
          .select("id, channel, channel_user_id")
          .eq("organization_id", organizationId)
          .eq("id", explicitLeadId)
          .maybeSingle();
        if (!lead.error && lead.data) {
          const r = await enqueueMessage({
            sb,
            organizationId,
            leadId: safeStr((lead.data as any).id),
            channel: safeStr((lead.data as any).channel, "messenger"),
            channelUserId: safeStr((lead.data as any).channel_user_id),
            text:
              safeStr(payload.text, "") ||
              "Hola 👋 Hace un tiempo fue tu última visita. ¿Te gustaría agendar tu próxima cita?",
            source: "action_send_recall_message",
          });
          if (!r.error) {
            executed += 1;
            await sb.from("growth_events").insert({
              organization_id: organizationId,
              event_type: "recall_sent",
              lead_id: explicitLeadId,
              appointment_id: null,
              metadata: { source: "execute_action", action_id: actionId },
            });
          }
        }
      }
      if (executed > 0) {
        // already handled explicit path
      } else {
      const cutoff = new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString();
      const leads = await sb
        .from("leads")
        .select("id, channel, channel_user_id, last_message_at")
        .eq("organization_id", organizationId)
        .not("channel_user_id", "is", null)
        .lt("last_message_at", cutoff)
        .order("last_message_at", { ascending: true })
        .limit(3);
      for (const lead of leads.data ?? []) {
        const r = await enqueueMessage({
          sb,
          organizationId,
          leadId: safeStr((lead as any).id),
          channel: safeStr((lead as any).channel, "messenger"),
          channelUserId: safeStr((lead as any).channel_user_id),
          text: "Hace tiempo no te vemos. ¿Querés que te ayudemos a agendar tu próxima revisión?",
          source: "action_patient_recall",
        });
        if (!r.error) {
          executed += 1;
          await sb.from("growth_events").insert({
            organization_id: organizationId,
            event_type: "recall_sent",
            lead_id: safeStr((lead as any).id),
            appointment_id: null,
            metadata: { source: "execute_action", action_id: actionId },
          });
        }
      }
      }
    } else if (type === "marketing_opportunity") {
      await sb.from("alerts").insert({
        organization_id: organizationId,
        type: "marketing_suggestion_ready",
        severity: "info",
        title: "Suggested post generated",
        body: "Crear un post de oferta local con CTA a Messenger.",
        action: { source: "action_marketing_opportunity" },
        status: "open",
      });
      executed = 1;
    }

    await sb
      .from("actions")
      .update({ status: "completed", payload: { ...(payload ?? {}), executed_count: executed, executed_at: new Date().toISOString() } })
      .eq("id", actionId)
      .eq("organization_id", organizationId);

    return json(200, { ok: true, action_id: actionId, type, executed });
  } catch (error) {
    return json(500, { ok: false, error: safeStr((error as Error)?.message, String(error)) });
  }
});
