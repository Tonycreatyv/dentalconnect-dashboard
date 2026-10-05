import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ORGANIZATION_ID = "luis-gabriel-referral-hub";
const ALLOWED_ORIGINS = new Set([
  "https://referral.creatyv.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://referral.creatyv.io";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
}

function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "content-type": "application/json", "cache-control": "no-store" },
  });
}

function cleanText(value: unknown, max = 240): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function normalizePhone(value: unknown): string | null {
  const text = cleanText(value, 40);
  if (!text) return null;
  if (!/^[+()\-\s.0-9]{7,40}$/.test(text)) throw new Error("invalid_phone");
  return text;
}

function normalizeEmail(value: unknown): string | null {
  const text = cleanText(value, 254)?.toLowerCase() ?? null;
  if (!text) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new Error("invalid_email");
  return text;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json(405, { success: false, error: "method_not_allowed" }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  if (!supabaseUrl || !anonKey || !serviceKey || !authorization) {
    return json(401, { success: false, error: "authentication_required" }, origin);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const userResult = await caller.auth.getUser();
  const user = userResult.data.user;
  if (!user) return json(401, { success: false, error: "authentication_required" }, origin);

  const membership = await admin.from("org_members")
    .select("role")
    .eq("organization_id", ORGANIZATION_ID)
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (membership.error || !membership.data) {
    return json(403, { success: false, error: "admin_access_required" }, origin);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { success: false, error: "invalid_json" }, origin); }
  const action = String(body.action ?? "");

  try {
    if (action === "update_client") {
      const leadId = String(body.lead_id ?? "");
      if (!leadId) return json(400, { success: false, error: "lead_id_required" }, origin);

      const current = await admin.from("leads")
        .select("id,organization_id,first_name,last_name,full_name,phone,email")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("id", leadId)
        .maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) return json(404, { success: false, error: "lead_not_found" }, origin);

      const firstName = cleanText(body.first_name, 120);
      const lastName = cleanText(body.last_name, 120);
      const explicitFullName = cleanText(body.full_name, 240);
      const fullName = explicitFullName || [firstName, lastName].filter(Boolean).join(" ") || null;
      const patch = {
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        phone: normalizePhone(body.phone),
        email: normalizeEmail(body.email),
        updated_at: new Date().toISOString(),
      };

      const updated = await admin.from("leads")
        .update(patch)
        .eq("organization_id", ORGANIZATION_ID)
        .eq("id", leadId)
        .select("id,first_name,last_name,full_name,phone,email,updated_at")
        .single();
      if (updated.error) throw updated.error;

      const event = await admin.from("referral_operational_events").insert({
        organization_id: ORGANIZATION_ID,
        aggregate_type: "lead",
        aggregate_id: leadId,
        event_type: "admin_client_updated",
        actor_type: "user",
        actor_id: user.id,
        source: "admin-client-case-edit",
        previous_state: current.data,
        new_state: updated.data,
        metadata: { changed_fields: ["first_name", "last_name", "full_name", "phone", "email"] },
        idempotency_key: `admin-client-update:${leadId}:${crypto.randomUUID()}`,
      });
      if (event.error) throw event.error;
      return json(200, { success: true, client: updated.data }, origin);
    }

    if (action === "update_case") {
      const requestId = String(body.request_id ?? "");
      if (!requestId) return json(400, { success: false, error: "request_id_required" }, origin);

      const current = await admin.from("referral_service_requests")
        .select("id,organization_id,lead_id,service_id,city,postal_code,language,specialty,status,updated_at")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("id", requestId)
        .maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) return json(404, { success: false, error: "request_not_found" }, origin);
      if (current.data.status === "closed") return json(409, { success: false, error: "closed_case_is_read_only" }, origin);

      const nextService = cleanText(body.service_id, 120) || current.data.service_id;
      if (nextService !== current.data.service_id) {
        const activeAssignment = await admin.from("referral_assignments")
          .select("id")
          .eq("organization_id", ORGANIZATION_ID)
          .eq("request_id", requestId)
          .in("status", ["pending_assignment", "assigned", "accepted"])
          .limit(1);
        if (activeAssignment.error) throw activeAssignment.error;
        if (activeAssignment.data?.length) {
          return json(409, { success: false, error: "service_change_requires_unassigned_case" }, origin);
        }
        const service = await admin.from("referral_organization_services")
          .select("service_id,enabled")
          .eq("organization_id", ORGANIZATION_ID)
          .eq("service_id", nextService)
          .eq("enabled", true)
          .maybeSingle();
        if (service.error) throw service.error;
        if (!service.data) return json(400, { success: false, error: "service_not_enabled" }, origin);
      }

      const patch = {
        service_id: nextService,
        city: cleanText(body.city, 120),
        postal_code: cleanText(body.postal_code, 20),
        language: cleanText(body.language, 40),
        specialty: cleanText(body.specialty, 120),
        updated_at: new Date().toISOString(),
      };
      const updated = await admin.from("referral_service_requests")
        .update(patch)
        .eq("organization_id", ORGANIZATION_ID)
        .eq("id", requestId)
        .select("id,lead_id,service_id,city,postal_code,language,specialty,status,updated_at")
        .single();
      if (updated.error) throw updated.error;

      const event = await admin.from("referral_operational_events").insert({
        organization_id: ORGANIZATION_ID,
        aggregate_type: "request",
        aggregate_id: requestId,
        event_type: nextService !== current.data.service_id ? "admin_case_service_changed" : "admin_case_updated",
        actor_type: "user",
        actor_id: user.id,
        source: "admin-client-case-edit",
        previous_state: current.data,
        new_state: updated.data,
        metadata: {
          service_changed: nextService !== current.data.service_id,
          previous_service_id: current.data.service_id,
          new_service_id: nextService,
        },
        idempotency_key: `admin-case-update:${requestId}:${crypto.randomUUID()}`,
      });
      if (event.error) throw event.error;
      return json(200, { success: true, case: updated.data }, origin);
    }

    return json(400, { success: false, error: "unsupported_action" }, origin);
  } catch (error) {
    const code = String((error as Error)?.message || error);
    if (code === "invalid_phone" || code === "invalid_email") return json(400, { success: false, error: code }, origin);
    console.error("admin-client-case-edit", error);
    return json(500, { success: false, error: "internal_error" }, origin);
  }
});
