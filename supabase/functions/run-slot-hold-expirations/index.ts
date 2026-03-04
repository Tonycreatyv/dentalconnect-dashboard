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
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-run-slot-hold-secret",
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
    const expected = safeStr(Deno.env.get("RUN_SLOT_HOLD_SECRET"), "");
    const provided = safeStr(req.headers.get("x-run-slot-hold-secret"), "");
    if (expected && provided !== expected) return json(401, { ok: false, error: "unauthorized" });

    const SUPABASE_URL = safeStr(Deno.env.get("SUPABASE_URL"), "");
    const SERVICE_KEY = safeStr(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: "missing_supabase_env" });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const organizationId = safeStr(body.organization_id, "").trim();
    const limit = Math.max(1, Math.min(Number(body.limit ?? 25) || 25, 100));

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    let q = sb
      .from("slot_holds")
      .select("id, organization_id, slot_start, slot_end, service_type, slot_key, hold_until")
      .eq("slot_hold_scope", "slot")
      .eq("status", "held")
      .lte("hold_until", new Date().toISOString())
      .order("hold_until", { ascending: true })
      .limit(limit);

    if (organizationId) q = q.eq("organization_id", organizationId);

    const expiredRes = await q;
    if (expiredRes.error) return json(500, { ok: false, error: expiredRes.error.message });

    const expired = expiredRes.data ?? [];
    if (expired.length === 0) return json(200, { ok: true, processed: 0, reoffered: 0, fulfilled: 0, expired: 0 });

    let processed = 0;
    let reoffered = 0;
    let fulfilled = 0;
    let expiredCount = 0;
    const details: Array<Record<string, unknown>> = [];

    for (const row of expired as any[]) {
      processed += 1;
      const org = safeStr(row.organization_id, "");
      const slotStart = safeStr(row.slot_start, "");
      const slotEnd = safeStr(row.slot_end, slotStart);
      const serviceType = safeStr(row.service_type, "general") || "general";
      const slotKey = safeStr(row.slot_key, "");

      const occupied = await sb
        .from("appointments")
        .select("id,status")
        .eq("organization_id", org)
        .or(`start_at.eq.${slotStart},starts_at.eq.${slotStart}`)
        .not("status", "in", "(cancelled)")
        .limit(1);

      if (!occupied.error && (occupied.data?.length ?? 0) > 0) {
        await sb
          .from("slot_holds")
          .update({ status: "fulfilled", updated_at: new Date().toISOString() })
          .eq("id", safeStr(row.id, ""));
        fulfilled += 1;
        details.push({ slot_key: slotKey, action: "fulfilled_existing_booking" });
        continue;
      }

      const rpc = await sb.rpc("offer_waitlist_for_slot", {
        p_org_id: org,
        p_slot_start: slotStart,
        p_slot_end: slotEnd,
        p_service_type: serviceType,
        p_trigger_source: "expiration",
      });

      if (rpc.error) {
        await sb
          .from("slot_holds")
          .update({
            status: "expired",
            updated_at: new Date().toISOString(),
            metadata: { error: rpc.error.message },
          })
          .eq("id", safeStr(row.id, ""));
        expiredCount += 1;
        details.push({ slot_key: slotKey, action: "rpc_error", error: rpc.error.message });
        continue;
      }

      const queued = Number((rpc.data as any)?.queued ?? 0);
      if (queued > 0) {
        await sb
          .from("slot_holds")
          .update({
            status: "held",
            hold_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", safeStr(row.id, ""));
        reoffered += 1;
        details.push({ slot_key: slotKey, action: "reoffered", queued });
      } else {
        await sb
          .from("slot_holds")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", safeStr(row.id, ""));
        expiredCount += 1;
        details.push({ slot_key: slotKey, action: "expired_no_candidates" });
      }
    }

    return json(200, {
      ok: true,
      processed,
      reoffered,
      fulfilled,
      expired: expiredCount,
      details,
    });
  } catch (error) {
    return json(500, { ok: false, error: safeStr((error as Error)?.message, String(error)) });
  }
});
