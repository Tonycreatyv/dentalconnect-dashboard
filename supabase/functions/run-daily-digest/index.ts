import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-run-daily-digest-secret",
    },
  });
}

function safeStr(v: unknown, d = "") {
  if (typeof v === "string") return v;
  if (v == null) return d;
  return String(v);
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const expected = safeStr(Deno.env.get("RUN_DAILY_DIGEST_SECRET"), "");
  const provided = safeStr(req.headers.get("x-run-daily-digest-secret"), "");
  if (expected && provided !== expected) return json(401, { ok: false, error: "unauthorized" });

  const SUPABASE_URL = safeStr(Deno.env.get("SUPABASE_URL"), "");
  const SERVICE_KEY = safeStr(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "");
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: "missing_supabase_env" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({} as any));
  const orgId = safeStr(body.organization_id, "").trim();
  if (!orgId) return json(400, { ok: false, error: "missing_organization_id" });

  const now = new Date();
  const tomorrowStart = startOfDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const tomorrowEnd = endOfDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const [apptsRes, confirmsRes, unreadRes] = await Promise.all([
    sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("start_at", tomorrowStart.toISOString())
      .lte("start_at", tomorrowEnd.toISOString()),
    sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("start_at", tomorrowStart.toISOString())
      .lte("start_at", tomorrowEnd.toISOString())
      .in("status", ["pending", "requested"]),
    sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("role", "user")
      .gte("created_at", startOfDay(now).toISOString()),
  ]);

  const appts = apptsRes.count ?? 0;
  const unconfirmed = confirmsRes.count ?? 0;
  const unread = unreadRes.count ?? 0;
  const gaps = Math.max(0, 10 - appts);

  const summary = `Mañana: ${appts} citas · ${gaps} huecos · ${unconfirmed} por confirmar · ${unread} mensajes nuevos hoy.`;

  const insertRes = await sb.from("alerts").insert({
    organization_id: orgId,
    type: "daily_digest",
    severity: "info",
    title: "Resumen diario",
    body: summary,
    action: {
      top_actions: [
        "Confirmar citas pendientes",
        "Ofrecer huecos a lista de espera",
        "Responder mensajes nuevos",
      ],
      appts,
      gaps,
      unconfirmed,
      unread,
    },
    status: "open",
  });

  if (insertRes.error) return json(500, { ok: false, error: insertRes.error.message });
  return json(200, { ok: true, organization_id: orgId, summary, appts, gaps, unconfirmed, unread });
});
