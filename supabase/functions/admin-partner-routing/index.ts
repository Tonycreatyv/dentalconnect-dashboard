import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ALLOWED_ORIGINS = new Set([
  "https://referral.creatyv.io",
  "http://localhost:5173",
]);
const ORGANIZATION_ID = "luis-gabriel-referral-hub";
const MAX_BODY_BYTES = 16_000;

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://referral.creatyv.io",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function text(value: unknown, max = 500) {
  return typeof value === "string" && value.trim().length <= max ? value.trim() : "";
}

function textArray(value: unknown, maxItems = 100) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function positiveInteger(value: unknown, nullable = false) {
  if ((value === null || value === "") && nullable) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { success: false, error: "method_not_allowed" });

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return json(req, 413, { success: false, error: "request_too_large" });

  try {
    const authorization = req.headers.get("authorization") ?? "";
    const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json(req, 401, { success: false, error: "unauthorized" });

    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json(req, 413, { success: false, error: "request_too_large" });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (text(body.organization_id, 100) !== ORGANIZATION_ID) {
      return json(req, 403, { success: false, error: "organization_forbidden" });
    }

    const partnerId = text(body.partner_id, 100);
    const serviceId = text(body.service_id, 100);
    const ruleId = text(body.rule_id, 100) || null;
    const active = typeof body.active === "boolean" ? body.active : null;
    const assignmentPriority = Number(body.assignment_priority);
    const capacityLimit = positiveInteger(body.capacity_limit, true);
    const acceptanceSlaMinutes = positiveInteger(body.acceptance_sla_minutes, false);
    const postalCodes = textArray(body.postal_codes).filter((zip) => /^\d{5}$/.test(zip));
    const cities = textArray(body.cities);
    const languages = textArray(body.languages);
    const specialties = textArray(body.specialties);

    if (!partnerId || !serviceId || active === null || !Number.isInteger(assignmentPriority) || assignmentPriority < 0) {
      return json(req, 400, { success: false, error: "invalid_request" });
    }
    if (capacityLimit === undefined || acceptanceSlaMinutes === undefined) {
      return json(req, 400, { success: false, error: "invalid_capacity_or_sla" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("service_configuration_missing");

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const userResult = await admin.auth.getUser(bearer);
    const userId = userResult.data.user?.id;
    if (!userId) return json(req, 401, { success: false, error: "unauthorized" });

    const membership = await admin
      .from("org_members")
      .select("role")
      .eq("organization_id", ORGANIZATION_ID)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership.data || !["owner", "admin"].includes(String(membership.data.role))) {
      return json(req, 403, { success: false, error: "permission_denied" });
    }

    const partner = await admin
      .from("referral_partners")
      .select("id,name")
      .eq("organization_id", ORGANIZATION_ID)
      .eq("id", partnerId)
      .maybeSingle();
    if (!partner.data) return json(req, 404, { success: false, error: "partner_not_found" });

    const previousQuery = admin
      .from("referral_partner_service_rules")
      .select("id,service_id,active,assignment_priority,postal_codes,cities,languages,specialties,capacity_limit,acceptance_sla_minutes,starts_at,expires_at,workspace_config,partner_location_id")
      .eq("organization_id", ORGANIZATION_ID)
      .eq("partner_id", partnerId)
      .eq("service_id", serviceId);
    const previous = ruleId
      ? await previousQuery.eq("id", ruleId).maybeSingle()
      : await previousQuery.maybeSingle();

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const saveResult = await userClient.rpc("admin_save_referral_partner_service_rule", {
      p_organization_id: ORGANIZATION_ID,
      p_rule_id: ruleId,
      p_partner_id: partnerId,
      p_service_id: serviceId,
      p_active: active,
      p_assignment_priority: assignmentPriority,
      p_partner_location_id: previous.data?.partner_location_id ?? null,
      p_postal_codes: postalCodes,
      p_cities: cities,
      p_languages: languages,
      p_specialties: specialties,
      p_capacity_limit: capacityLimit,
      p_acceptance_sla_minutes: acceptanceSlaMinutes,
      p_starts_at: previous.data?.starts_at ?? null,
      p_expires_at: previous.data?.expires_at ?? null,
      p_workspace_config: previous.data?.workspace_config ?? {},
    });
    if (saveResult.error) {
      return json(req, 400, { success: false, error: saveResult.error.message });
    }

    const saved = saveResult.data;
    const audit = await admin.from("referral_operational_events").insert({
      organization_id: ORGANIZATION_ID,
      aggregate_type: "partner_service_rule",
      aggregate_id: saved.id,
      event_type: "admin_partner_service_rule_updated",
      actor_type: "user",
      actor_id: userId,
      source: "admin_operator_mode",
      previous_state: previous.data ?? {},
      new_state: saved,
      metadata: {
        partner_id: partnerId,
        partner_name: partner.data.name,
        service_id: serviceId,
      },
    });
    if (audit.error) console.error("partner_rule_audit_failed", audit.error.message);

    return json(req, 200, { success: true, rule: saved });
  } catch (error) {
    console.error("admin_partner_routing_failed", error);
    return json(req, 500, { success: false, error: "internal_error" });
  }
});
