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
    headers: { ...cors(req), "content-type": "application/json", "cache-control": "no-store" },
  });
}

function text(value: unknown, max = 4_000): string {
  return typeof value === "string" && value.trim().length <= max ? value.trim() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { success: false, error: "method_not_allowed" });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(req, 413, { success: false, error: "request_too_large" });

  try {
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json(req, 401, { success: false, error: "unauthorized" });

    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(req, 413, { success: false, error: "request_too_large" });
    const body = JSON.parse(raw) as Record<string, unknown>;
    const action = text(body.action, 40);
    if (!action) return json(req, 400, { success: false, error: "invalid_request" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) throw new Error("service_configuration_missing");

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const userResult = await admin.auth.getUser(bearer);
    const user = userResult.data.user;
    if (!user) return json(req, 401, { success: false, error: "unauthorized" });

    const membership = await admin.from("org_members")
      .select("role")
      .eq("organization_id", ORGANIZATION_ID)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership.data || !["owner", "admin"].includes(String(membership.data.role))) {
      return json(req, 403, { success: false, error: "permission_denied" });
    }

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";

    if (action === "status") {
      const subscriptions = await admin.from("referral_admin_push_subscriptions")
        .select("id,endpoint,device_label,active,last_seen_at,created_at")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("user_id", user.id)
        .eq("active", true)
        .order("last_seen_at", { ascending: false });
      if (subscriptions.error) throw subscriptions.error;

      const preferences = await admin.from("referral_admin_notification_preferences")
        .select("push_enabled,new_case,unassigned_case,exception_case,partner_assignment,partner_access,benefit_changes,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,timezone")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("user_id", user.id)
        .maybeSingle();
      if (preferences.error) throw preferences.error;

      return json(req, 200, {
        success: true,
        configured: Boolean(vapidPublicKey && Deno.env.get("VAPID_PRIVATE_KEY")),
        vapid_public_key: vapidPublicKey || null,
        subscriptions: subscriptions.data ?? [],
        preferences: preferences.data ?? null,
      });
    }

    if (action === "subscribe") {
      if (!vapidPublicKey) return json(req, 503, { success: false, error: "push_not_configured" });
      const endpoint = text(body.endpoint, 4_000);
      const p256dh = text(body.p256dh, 1_000);
      const authKey = text(body.auth_key, 1_000);
      const deviceLabel = text(body.device_label, 120) || null;
      const userAgent = text(body.user_agent, 1_000) || null;
      if (!endpoint.startsWith("https://") || !p256dh || !authKey) return json(req, 400, { success: false, error: "invalid_subscription" });

      const upsert = await admin.from("referral_admin_push_subscriptions")
        .upsert({
          organization_id: ORGANIZATION_ID,
          user_id: user.id,
          endpoint,
          p256dh,
          auth_key: authKey,
          device_label: deviceLabel,
          user_agent: userAgent,
          active: true,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,endpoint" })
        .select("id,endpoint,device_label,active,last_seen_at")
        .single();
      if (upsert.error) throw upsert.error;

      await admin.from("referral_admin_notification_preferences").upsert({
        organization_id: ORGANIZATION_ID,
        user_id: user.id,
        push_enabled: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,user_id" });

      return json(req, 200, { success: true, subscription: upsert.data });
    }

    if (action === "unsubscribe") {
      const endpoint = text(body.endpoint, 4_000);
      if (!endpoint) return json(req, 400, { success: false, error: "invalid_subscription" });
      const updated = await admin.from("referral_admin_push_subscriptions")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("organization_id", ORGANIZATION_ID)
        .eq("user_id", user.id)
        .eq("endpoint", endpoint)
        .select("id")
        .maybeSingle();
      if (updated.error) throw updated.error;
      return json(req, 200, { success: true });
    }

    if (action === "update_preferences") {
      const preferenceFields = [
        "push_enabled",
        "new_case",
        "unassigned_case",
        "exception_case",
        "partner_assignment",
        "partner_access",
        "benefit_changes",
        "quiet_hours_enabled",
        "quiet_hours_start",
        "quiet_hours_end",
        "timezone",
      ] as const;
      const patch: Record<string, unknown> = {
        organization_id: ORGANIZATION_ID,
        user_id: user.id,
        updated_at: new Date().toISOString(),
      };
      for (const field of preferenceFields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) patch[field] = body[field];
      }
      const saved = await admin.from("referral_admin_notification_preferences")
        .upsert(patch, { onConflict: "organization_id,user_id" })
        .select("push_enabled,new_case,unassigned_case,exception_case,partner_assignment,partner_access,benefit_changes,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,timezone")
        .single();
      if (saved.error) throw saved.error;
      return json(req, 200, { success: true, preferences: saved.data });
    }

    return json(req, 400, { success: false, error: "unsupported_action" });
  } catch (error) {
    console.error("admin-push-subscriptions", error);
    return json(req, 500, { success: false, error: "internal_error" });
  }
});
