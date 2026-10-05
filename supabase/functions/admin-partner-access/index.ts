import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ORGANIZATION_ID = "luis-gabriel-referral-hub";
const PARTNER_APP_URL = "https://referral.creatyv.io/partner/app";
const ALLOWED_ORIGINS = new Set([
  "https://referral.creatyv.io",
  "http://localhost:5173",
]);
const VALID_ROLES = new Set(["partner_admin", "partner_agent"]);

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

function text(value: unknown, max = 320) {
  return typeof value === "string" && value.trim().length <= max ? value.trim() : "";
}

async function findUserByEmail(admin: any, email: string) {
  const result = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (result.error) throw result.error;
  return result.data.users.find((user: any) => String(user.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { success: false, error: "method_not_allowed" });

  try {
    const authorization = req.headers.get("authorization") ?? "";
    const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json(req, 401, { success: false, error: "unauthorized" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("service_configuration_missing");

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const userResult = await admin.auth.getUser(bearer);
    const actorId = userResult.data.user?.id;
    if (!actorId) return json(req, 401, { success: false, error: "unauthorized" });

    const actorMembership = await admin.from("org_members").select("role")
      .eq("organization_id", ORGANIZATION_ID)
      .eq("user_id", actorId)
      .maybeSingle();
    if (!actorMembership.data || !["owner", "admin"].includes(String(actorMembership.data.role))) {
      return json(req, 403, { success: false, error: "permission_denied" });
    }

    const body = await req.json() as Record<string, unknown>;
    const action = text(body.action, 40);
    const partnerId = text(body.partner_id, 100);
    if (!partnerId) return json(req, 400, { success: false, error: "partner_id_required" });

    const partner = await admin.from("referral_partners").select("id,name")
      .eq("organization_id", ORGANIZATION_ID)
      .eq("id", partnerId)
      .maybeSingle();
    if (!partner.data) return json(req, 404, { success: false, error: "partner_not_found" });

    if (action === "list") {
      const memberships = await admin.from("referral_partner_memberships")
        .select("id,user_id,role,active,created_at,updated_at")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("partner_id", partnerId)
        .order("created_at", { ascending: true });
      if (memberships.error) throw memberships.error;

      const rows = await Promise.all((memberships.data ?? []).map(async (membership: any) => {
        const user = await admin.auth.admin.getUserById(String(membership.user_id));
        return {
          id: membership.id,
          user_id: membership.user_id,
          email: user.data.user?.email ?? null,
          role: membership.role,
          active: membership.active,
          created_at: membership.created_at,
          updated_at: membership.updated_at,
        };
      }));
      return json(req, 200, { success: true, memberships: rows });
    }

    if (action === "invite") {
      const email = text(body.email, 320).toLowerCase();
      const role = text(body.role, 40) || "partner_admin";
      if (!email || !email.includes("@")) return json(req, 400, { success: false, error: "valid_email_required" });
      if (!VALID_ROLES.has(role)) return json(req, 400, { success: false, error: "invalid_role" });

      let targetUser = await findUserByEmail(admin, email);
      let invitationSent = false;
      if (!targetUser) {
        const invited = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: PARTNER_APP_URL,
          data: { organization_id: ORGANIZATION_ID, partner_id: partnerId, partner_role: role },
        });
        if (invited.error) throw invited.error;
        targetUser = invited.data.user;
        invitationSent = true;
      }
      if (!targetUser?.id) throw new Error("partner_user_creation_failed");

      const membership = await admin.from("referral_partner_memberships").upsert({
        organization_id: ORGANIZATION_ID,
        partner_id: partnerId,
        user_id: targetUser.id,
        role,
        active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,partner_id,user_id" })
        .select("id,user_id,role,active,created_at,updated_at")
        .single();
      if (membership.error) throw membership.error;

      await admin.from("referral_operational_events").insert({
        organization_id: ORGANIZATION_ID,
        aggregate_type: "partner_membership",
        aggregate_id: membership.data.id,
        event_type: invitationSent ? "partner_access_invited" : "partner_access_granted",
        actor_type: "user",
        actor_id: actorId,
        source: "admin_operator_mode",
        previous_state: null,
        new_state: { partner_id: partnerId, user_id: targetUser.id, email, role, active: true },
        metadata: { partner_name: partner.data.name },
      });

      return json(req, 200, {
        success: true,
        invitation_sent: invitationSent,
        membership: { ...membership.data, email },
      });
    }

    if (action === "update") {
      const membershipId = text(body.membership_id, 100);
      const role = text(body.role, 40);
      const active = typeof body.active === "boolean" ? body.active : null;
      if (!membershipId) return json(req, 400, { success: false, error: "membership_id_required" });
      if (role && !VALID_ROLES.has(role)) return json(req, 400, { success: false, error: "invalid_role" });
      if (!role && active === null) return json(req, 400, { success: false, error: "no_changes" });

      const before = await admin.from("referral_partner_memberships")
        .select("id,user_id,role,active")
        .eq("id", membershipId)
        .eq("organization_id", ORGANIZATION_ID)
        .eq("partner_id", partnerId)
        .maybeSingle();
      if (!before.data) return json(req, 404, { success: false, error: "membership_not_found" });

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (role) patch.role = role;
      if (active !== null) patch.active = active;

      const updated = await admin.from("referral_partner_memberships")
        .update(patch)
        .eq("id", membershipId)
        .eq("organization_id", ORGANIZATION_ID)
        .eq("partner_id", partnerId)
        .select("id,user_id,role,active,created_at,updated_at")
        .single();
      if (updated.error) throw updated.error;

      await admin.from("referral_operational_events").insert({
        organization_id: ORGANIZATION_ID,
        aggregate_type: "partner_membership",
        aggregate_id: membershipId,
        event_type: "partner_access_updated",
        actor_type: "user",
        actor_id: actorId,
        source: "admin_operator_mode",
        previous_state: before.data,
        new_state: updated.data,
        metadata: { partner_id: partnerId, partner_name: partner.data.name },
      });

      return json(req, 200, { success: true, membership: updated.data });
    }

    return json(req, 400, { success: false, error: "invalid_action" });
  } catch (error) {
    console.error("admin-partner-access", error);
    return json(req, 500, { success: false, error: "internal_error" });
  }
});
