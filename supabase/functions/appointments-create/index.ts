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

// opcional demo
const DEFAULT_ORG = Deno.env.get("DEFAULT_ORG") ?? "";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST,OPTIONS",
    },
  });
}

function mustString(v: any, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`Missing ${name}`);
  return v.trim();
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isIsoTs(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(s) || /^\d{4}-\d{2}-\d{2} /.test(s);
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json(200, { ok: true });
    if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

    const body = await req.json().catch(() => ({}));

    let organization_id = String(body.organization_id ?? "");
    if (DEFAULT_ORG) organization_id = DEFAULT_ORG;

    if (!organization_id) return json(400, { ok: false, error: "missing_organization_id" });

    const lead_id = body.lead_id ? String(body.lead_id) : null;

    const service = mustString(body.service ?? "", "service"); // ej "blanqueamiento"
    const duration_min = Number(body.duration_min ?? 60);

    const date = mustString(body.date ?? "", "date"); // "YYYY-MM-DD"
    if (!isIsoDate(date)) return json(400, { ok: false, error: "invalid_date_YYYY-MM-DD" });

    const starts_at = mustString(body.starts_at ?? "", "starts_at"); // timestamptz string
    if (!isIsoTs(starts_at)) return json(400, { ok: false, error: "invalid_starts_at" });

    const slot_min = Number(body.slot_min ?? 15);

    const patient_name = String(body.patient_name ?? "").trim() || null;
    const patient_phone = String(body.patient_phone ?? "").trim() || null;
    const patient_email = String(body.patient_email ?? "").trim() || null;

    if (!Number.isFinite(duration_min) || duration_min < 5) {
      return json(400, { ok: false, error: "invalid_duration_min" });
    }

    // 1) validar disponibilidad: pedir slots del día y verificar que starts_at esté incluido
    const { data: slots, error: slotsErr } = await supabaseAdmin.rpc("get_available_slots", {
      p_organization_id: organization_id,
      p_date: date,
      p_duration_min: duration_min,
      p_slot_min: Number.isFinite(slot_min) && slot_min >= 5 ? slot_min : 15,
    });

    if (slotsErr) throw slotsErr;

    const wanted = new Date(starts_at).toISOString();
    const match = (slots ?? []).find((s: any) => {
      try {
        return new Date(s.starts_at).toISOString() === wanted;
      } catch {
        return false;
      }
    });

    if (!match) {
      return json(409, { ok: false, error: "slot_not_available" });
    }

    // 2) crear cita
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .insert({
        organization_id,
        lead_id,
        starts_at: match.starts_at,
        ends_at: match.ends_at,
        status: "booked",
        reason: service,
        patient_name,
        patient_phone,
        patient_email,
      })
      .select("id, starts_at, ends_at, status")
      .single();

    if (apptErr) throw apptErr;

    return json(200, { ok: true, appointment: appt });
  } catch (err) {
    return json(500, { ok: false, error: String((err as any)?.message ?? err) });
  }
});
