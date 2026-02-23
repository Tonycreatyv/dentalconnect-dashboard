/// <reference lib="deno.unstable" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SUPABASE_URL = env("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const DEFAULT_ORG = Deno.env.get("DEFAULT_ORG") ?? "clinic-demo";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

serve(async (req) => {
  try {
    const url = new URL(req.url);

    const organization_id =
      url.searchParams.get("organization_id") ?? DEFAULT_ORG;

    // rango: start/end ISO (FullCalendar los manda así)
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");

    if (!start || !end) {
      return json(400, { ok: false, error: "missing start/end" });
    }

    const { data, error } = await supabase
      .from("appointments")
      .select("id, lead_id, starts_at, ends_at, status, reason")
      .eq("organization_id", organization_id)
      .gte("starts_at", start)
      .lt("starts_at", end)
      .order("starts_at", { ascending: true });

    if (error) throw error;

    // Formato compatible con FullCalendar
    const events = (data ?? []).map((a) => ({
      id: a.id,
      title: a.reason ?? a.status ?? "Cita",
      start: a.starts_at,
      end: a.ends_at,
      extendedProps: {
        lead_id: a.lead_id,
        status: a.status,
      },
    }));

    return json(200, { ok: true, organization_id, events });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message ?? err) });
  }
});
