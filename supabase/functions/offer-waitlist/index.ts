import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

type ReqBody = {
  organization_id?: string;
  preview?: boolean;
  slot?: {
    slot_start?: string;
    slot_end?: string;
    service_type?: string;
  };
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SERVICE_ROLE) return json(500, { ok: false, error: "missing_supabase_env" });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const organizationId = safeStr(body.organization_id, "").trim();
    if (!organizationId) return json(400, { ok: false, error: "missing_organization_id" });

    const serviceType = safeStr(body.slot?.service_type, "general").trim() || "general";
    const slotStart = safeStr(body.slot?.slot_start, "");
    const slotEnd = safeStr(body.slot?.slot_end, "");
    const preview = Boolean(body.preview);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const baseWaitlistQuery = sb
      .from("waitlist")
      .select("id, lead_id, service_type, priority, created_at")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(20);

    const serviceQuery = serviceType && serviceType !== "general"
      ? await sb
          .from("waitlist")
          .select("id, lead_id, service_type, priority, created_at")
          .eq("organization_id", organizationId)
          .eq("status", "active")
          .eq("service_type", serviceType)
          .order("priority", { ascending: false })
          .order("created_at", { ascending: true })
          .limit(20)
      : { data: [], error: null };

    const fallbackRows = await baseWaitlistQuery;
    const candidateRows = (serviceQuery.data && serviceQuery.data.length > 0 ? serviceQuery.data : fallbackRows.data) ?? [];

    const leadIds = candidateRows
      .map((r: any) => safeStr(r.lead_id, ""))
      .filter(Boolean);

    if (!leadIds.length) {
      return json(200, { ok: true, queued: 0, contacted: 0, skipped: 0, reason: "no_waitlist_candidates" });
    }

    const leadsRes = await sb
      .from("leads")
      .select("id, channel, channel_user_id")
      .eq("organization_id", organizationId)
      .in("id", leadIds);

    const leadsMap = new Map<string, { channel: string; channel_user_id: string }>();
    for (const row of leadsRes.data ?? []) {
      const id = safeStr((row as any).id, "");
      const psid = safeStr((row as any).channel_user_id, "");
      if (!id || !psid) continue;
      leadsMap.set(id, {
        channel: safeStr((row as any).channel, "messenger") || "messenger",
        channel_user_id: psid,
      });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentOffers = await sb
      .from("reply_outbox")
      .select("lead_id, created_at, payload")
      .eq("organization_id", organizationId)
      .gte("created_at", sevenDaysAgo)
      .limit(500);

    const blockedLeadIds = new Set<string>();
    for (const row of recentOffers.data ?? []) {
      const leadId = safeStr((row as any).lead_id, "");
      const source = safeStr((row as any)?.payload?.source, "");
      if (!leadId) continue;
      if (source === "system_waitlist_offer") blockedLeadIds.add(leadId);
    }

    const picked: Array<{ waitlist_id: string; lead_id: string; channel: string; channel_user_id: string }> = [];
    for (const row of candidateRows as any[]) {
      const leadId = safeStr(row.lead_id, "");
      if (!leadId || blockedLeadIds.has(leadId)) continue;
      const lead = leadsMap.get(leadId);
      if (!lead?.channel_user_id) continue;
      picked.push({
        waitlist_id: safeStr(row.id, ""),
        lead_id: leadId,
        channel: lead.channel,
        channel_user_id: lead.channel_user_id,
      });
      if (picked.length >= 3) break;
    }

    if (preview) {
      return json(200, {
        ok: true,
        preview: true,
        preselected_count: picked.length,
        preselected_lead_ids: picked.map((p) => p.lead_id),
        cap: 3,
        hold_ttl_minutes: 30,
        service_type: serviceType,
      });
    }

    const effectiveStart = slotStart || new Date().toISOString();
    const effectiveEnd = slotEnd || new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const rpc = await sb.rpc("offer_waitlist_for_slot", {
      p_org_id: organizationId,
      p_slot_start: effectiveStart,
      p_slot_end: effectiveEnd,
      p_service_type: serviceType,
      p_trigger_source: "manual",
    });
    if (rpc.error) return json(500, { ok: false, error: `offer_rpc_failed:${rpc.error.message}` });

    const queued = Number((rpc.data as any)?.queued ?? 0);

    return json(200, {
      ok: true,
      queued,
      contacted: queued,
      skipped: Math.max(0, picked.length - queued),
      service_type: serviceType,
      result: rpc.data as Json,
    });
  } catch (error) {
    return json(500, { ok: false, error: safeStr((error as Error)?.message, String(error)) });
  }
});
