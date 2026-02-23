/// <reference lib="deno.unstable" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SUPABASE_URL = env("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

// Fijar org (opcional) para evitar mezclas durante demo
const DEFAULT_ORG = Deno.env.get("DEFAULT_ORG") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}

function parseIntOr(v: string | null, fallback: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json(200, { ok: true });

    const url = new URL(req.url);

    let organization_id = "";
    let date = "";
    let duration_min = 60;
    let slot_min = 15;

    if (req.method === "GET") {
      organization_id = url.searchParams.get("organization_id") ?? "";
      date = url.searchParams.get("date") ?? "";
      duration_min = parseIntOr(url.searchParams.get("duration_min"), 60);
      slot_min = parseIntOr(url.searchParams.get("slot_min"), 15);
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      organization_id = String(body.organization_id ?? "");
      date = String(body.date ?? "");
      duration_min = Number(body.duration_min ?? 60);
      slot_min = Number(body.slot_min ?? 15);
    } else {
      return json(405, { ok: false, error: "method_not_allowed" });
    }

    // Forzar org demo si está configurada
    if (DEFAULT_ORG) organization_id = DEFAULT_ORG;

    if (!organization_id) return json(400, { ok: false, error: "missing_organization_id" });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { ok: false, error: "invalid_date_YYYY-MM-DD" });
    if (!Number.isFinite(duration_min) || duration_min < 5) return json(400, { ok: false, error: "invalid_duration_min" });
    if (!Number.isFinite(slot_min) || slot_min < 5) slot_min = 15;

    // RPC to SQL function
    const { data, error } = await supabase.rpc("get_available_slots", {
      p_organization_id: organization_id,
      p_date: date,
      p_duration_min: duration_min,
      p_slot_min: slot_min,
    });

    if (error) throw error;

    return json(200, {
      ok: true,
      organization_id,
      date,
      duration_min,
      slot_min,
      slots: data ?? [],
    });
  } catch (err) {
    return json(500, { ok: false, error: String((err as any)?.message ?? err) });
  }
});
