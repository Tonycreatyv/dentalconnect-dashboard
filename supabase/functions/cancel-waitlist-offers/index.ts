import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReqBody = {
  organization_id?: string;
  slot_start?: string;
  slot_key?: string;
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

function safeStr(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const SUPABASE_URL = safeStr(Deno.env.get("SUPABASE_URL"), "");
    const SERVICE_KEY = safeStr(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: "missing_supabase_env" });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const orgId = safeStr(body.organization_id, "").trim();
    const slotStart = safeStr(body.slot_start, "").trim();
    const slotKey = safeStr(body.slot_key, "").trim();
    if (!orgId || (!slotStart && !slotKey)) {
      return json(400, { ok: false, error: "missing_org_or_slot" });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    let outboxQ = sb
      .from("reply_outbox")
      .update({
        status: "failed",
        last_error: "cancelled:operator",
        locked_at: null,
        locked_by: null,
        claimed_at: null,
        claimed_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .in("status", ["queued", "pending", "processing"])
      .eq("payload->>source", "system_waitlist_offer")
      .select("id");

    if (slotKey) {
      outboxQ = outboxQ.eq("payload->>slot_key", slotKey);
    } else {
      outboxQ = outboxQ.eq("payload->>slot_start", slotStart);
    }

    const outboxRes = await outboxQ;

    let holdQ = sb
      .from("slot_holds")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("status", "held")
      .select("id");

    if (slotKey) {
      holdQ = holdQ.eq("slot_key", slotKey);
    } else {
      holdQ = holdQ.eq("slot_start", slotStart);
    }

    const holdRes = await holdQ;

    await sb.from("alerts").insert({
      organization_id: orgId,
      type: "waitlist_offer_cancelled",
      severity: "info",
      title: "Ofertas canceladas",
      body: "Se cancelaron ofertas pendientes del hueco seleccionado.",
      action: {
        slot_start: slotStart || null,
        slot_key: slotKey || null,
        cancelled_outbox_count: outboxRes.data?.length ?? 0,
      },
      status: "open",
    });

    return json(200, {
      ok: true,
      cancelled_outbox: outboxRes.data?.length ?? 0,
      cancelled_holds: holdRes.data?.length ?? 0,
    });
  } catch (error) {
    return json(500, { ok: false, error: safeStr((error as Error)?.message, String(error)) });
  }
});
