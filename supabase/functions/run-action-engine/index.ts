import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReqBody = { organization_id?: string };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-run-action-engine-secret",
    },
  });
}

function safeStr(v: unknown, d = "") {
  if (typeof v === "string") return v;
  if (v == null) return d;
  return String(v);
}

async function upsertOpenAction(args: {
  sb: ReturnType<typeof createClient>;
  orgId: string;
  type: string;
  title: string;
  description: string;
  priority: number;
  payload: Record<string, unknown>;
}) {
  const sb = args.sb;
  await sb.from("actions").update({ status: "completed" }).eq("organization_id", args.orgId).eq("type", args.type).eq("status", "open");
  return await sb.from("actions").insert({
    organization_id: args.orgId,
    type: args.type,
    title: args.title,
    description: args.description,
    priority: args.priority,
    status: "open",
    payload: args.payload,
  });
}

async function closeOpenAction(sb: ReturnType<typeof createClient>, orgId: string, type: string) {
  await sb.from("actions").update({ status: "completed" }).eq("organization_id", orgId).eq("type", type).eq("status", "open");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const expected = safeStr(Deno.env.get("RUN_ACTION_ENGINE_SECRET"), "");
    const provided = safeStr(req.headers.get("x-run-action-engine-secret"), "");
    if (expected && provided !== expected) return json(401, { ok: false, error: "unauthorized" });

    const SUPABASE_URL = safeStr(Deno.env.get("SUPABASE_URL"), "");
    const SERVICE_KEY = safeStr(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: "missing_supabase_env" });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const orgId = safeStr(body.organization_id, "").trim();
    if (!orgId) return json(400, { ok: false, error: "missing_organization_id" });

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(now.getTime() + 24 * 60 * 60 * 1000); tomorrowStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000); tomorrowEnd.setHours(23, 59, 59, 999);

    let created = 0;

    const cancelled = await sb
      .from("appointments")
      .select("id, start_at, starts_at, reason, title, updated_at")
      .eq("organization_id", orgId)
      .eq("status", "cancelled")
      .gte("updated_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!cancelled.error && cancelled.data) {
      const slotStart = (cancelled.data as any).start_at ?? (cancelled.data as any).starts_at;
      const slotEnd = slotStart ? new Date(new Date(slotStart).getTime() + 60 * 60 * 1000).toISOString() : null;
      const service = safeStr((cancelled.data as any).reason ?? (cancelled.data as any).title, "general") || "general";
      const r = await upsertOpenAction({
        sb,
        orgId,
        type: "appointment_cancelled",
        title: "Slot freed tomorrow 3pm",
        description: "Offer waitlist to fill the slot.",
        priority: 100,
        payload: { slot_start: slotStart, slot_end: slotEnd, service_type: service },
      });
      if (!r.error) created += 1;
    } else {
      await closeOpenAction(sb, orgId, "appointment_cancelled");
    }

    const unanswered = await sb
      .from("leads")
      .select("id, last_message_at, last_bot_reply_at")
      .eq("organization_id", orgId)
      .not("last_message_at", "is", null)
      .limit(200);

    const unansweredCount = (unanswered.data ?? []).filter((lead: any) => {
      const lm = lead?.last_message_at ? new Date(lead.last_message_at).getTime() : 0;
      const lb = lead?.last_bot_reply_at ? new Date(lead.last_bot_reply_at).getTime() : 0;
      return lm > 0 && lm > lb;
    }).length;

    if (!unanswered.error && unansweredCount > 0) {
      const r = await upsertOpenAction({
        sb,
        orgId,
        type: "messages_unanswered",
        title: "Messages unanswered",
        description: `There are ${unansweredCount} leads waiting for response.`,
        priority: 95,
        payload: { count: unansweredCount },
      });
      if (!r.error) created += 1;
    } else {
      await closeOpenAction(sb, orgId, "messages_unanswered");
    }

    const tomorrowAppts = await sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("start_at", tomorrowStart.toISOString())
      .lte("start_at", tomorrowEnd.toISOString());

    const unconfirmedAppts = await sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("start_at", tomorrowStart.toISOString())
      .lte("start_at", tomorrowEnd.toISOString())
      .in("status", ["pending", "requested"]);

    const tomorrowCount = tomorrowAppts.count ?? 0;
    const gaps = Math.max(0, 10 - tomorrowCount);
    if (gaps > 0) {
      const r = await upsertOpenAction({
        sb,
        orgId,
        type: "schedule_gaps",
        title: "Schedule gaps detected",
        description: `Tomorrow has ${gaps} open slots.`,
        priority: 90,
        payload: {
          gaps,
          slot_start: new Date(tomorrowStart.getTime() + 15 * 60 * 60 * 1000).toISOString(),
          slot_end: new Date(tomorrowStart.getTime() + 16 * 60 * 60 * 1000).toISOString(),
          service_type: "general",
        },
      });
      if (!r.error) created += 1;
    } else {
      await closeOpenAction(sb, orgId, "schedule_gaps");
    }

    if ((unconfirmedAppts.count ?? 0) > 0) {
      const r = await upsertOpenAction({
        sb,
        orgId,
        type: "unconfirmed_appointments",
        title: "Unconfirmed appointments",
        description: `${unconfirmedAppts.count ?? 0} appointments need confirmation.`,
        priority: 88,
        payload: { count: unconfirmedAppts.count ?? 0 },
      });
      if (!r.error) created += 1;
    } else {
      await closeOpenAction(sb, orgId, "unconfirmed_appointments");
    }

    const recallCutoff = new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString();
    const recall = await sb
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .not("channel_user_id", "is", null)
      .lt("last_message_at", recallCutoff);

    if ((recall.count ?? 0) > 0) {
      const r = await upsertOpenAction({
        sb,
        orgId,
        type: "patient_recall_due",
        title: "Patients due for recall",
        description: `${recall.count ?? 0} patients are due for recall.`,
        priority: 85,
        payload: { count: recall.count ?? 0 },
      });
      if (!r.error) created += 1;
    } else {
      await closeOpenAction(sb, orgId, "patient_recall_due");
    }

    const inboundToday = await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("role", "user")
      .gte("created_at", todayStart.toISOString());

    if ((inboundToday.count ?? 0) < 3) {
      const r = await upsertOpenAction({
        sb,
        orgId,
        type: "marketing_opportunity",
        title: "Marketing opportunity",
        description: "Inbound is low today. Create a suggested post.",
        priority: 70,
        payload: { inbound_today: inboundToday.count ?? 0 },
      });
      if (!r.error) created += 1;
    } else {
      await closeOpenAction(sb, orgId, "marketing_opportunity");
    }

    return json(200, { ok: true, organization_id: orgId, created });
  } catch (error) {
    return json(500, { ok: false, error: safeStr((error as Error)?.message, String(error)) });
  }
});
