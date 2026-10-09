import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ALLOWED_ORIGINS = new Set([
  "https://referral.creatyv.io",
  "http://localhost:5173",
]);
const ORGANIZATION_ID = "luis-gabriel-referral-hub";
const MAX_BODY_BYTES = 20_000;
const EDITABLE_FIELDS = new Set([
  "display_name",
  "business_id",
  "image_url",
  "customer_copy",
  "terms_text",
  "active",
  "expires_at",
  "delivery_source",
]);

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

function text(value: unknown, max = 2_000): string {
  return typeof value === "string" && value.trim().length <= max ? value.trim() : "";
}

function slug(value: string): string {
  return value.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "beneficio";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { success: false, error: "method_not_allowed" });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return json(req, 413, { success: false, error: "request_too_large" });
  }

  try {
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json(req, 401, { success: false, error: "unauthorized" });

    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json(req, 413, { success: false, error: "request_too_large" });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const action = text(body.action, 40);
    const couponId = text(body.coupon_id, 100);
    if (!action || !couponId) return json(req, 400, { success: false, error: "invalid_request" });

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

    const existing = await admin.from("referral_coupon_campaigns")
      .select("id,campaign_key,service_id,display_name,offer_terms,business_id,image_url,customer_copy,terms_text,active,starts_at,expires_at,delivery_source,updated_at")
      .eq("organization_id", ORGANIZATION_ID)
      .eq("id", couponId)
      .maybeSingle();
    if (!existing.data) return json(req, 404, { success: false, error: "coupon_not_found" });

    if (action === "history") {
      const events = await admin.from("referral_operational_events")
        .select("id,event_type,actor_id,previous_state,new_state,metadata,occurred_at")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("aggregate_type", "coupon_campaign")
        .eq("aggregate_id", couponId)
        .order("occurred_at", { ascending: false })
        .limit(25);
      if (events.error) throw events.error;
      const actorIds = [...new Set((events.data ?? []).map((event: any) => event.actor_id).filter(Boolean))];
      const emails = new Map<string, string>();
      if (actorIds.length > 0) {
        const users = await Promise.all(actorIds.map((id) => admin.auth.admin.getUserById(id)));
        for (const result of users) {
          const actor = result.data.user;
          if (actor?.id && actor.email) emails.set(actor.id, actor.email);
        }
      }
      return json(req, 200, {
        success: true,
        events: (events.data ?? []).map((event: any) => ({ ...event, actor_email: event.actor_id ? emails.get(event.actor_id) ?? null : null })),
      });
    }

    if (action === "duplicate_draft") {
      const displayName = text(body.display_name, 160) || `${existing.data.display_name} (borrador)`;
      const campaignKey = `admin_draft_${slug(displayName)}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
      const created = await admin.from("referral_coupon_campaigns")
        .insert({
          organization_id: ORGANIZATION_ID,
          campaign_key: campaignKey,
          service_id: existing.data.service_id,
          display_name: displayName,
          offer_terms: existing.data.offer_terms ?? {},
          business_id: existing.data.business_id,
          image_url: existing.data.image_url,
          customer_copy: existing.data.customer_copy,
          terms_text: existing.data.terms_text,
          active: false,
          starts_at: null,
          expires_at: null,
          delivery_source: "legacy",
        })
        .select("id,campaign_key,service_id,display_name,business_id,image_url,customer_copy,terms_text,active,starts_at,expires_at,delivery_source,updated_at")
        .single();
      if (created.error) throw created.error;

      const event = await admin.from("referral_operational_events").insert({
        organization_id: ORGANIZATION_ID,
        aggregate_type: "coupon_campaign",
        aggregate_id: created.data.id,
        event_type: "coupon_admin_created_from_template",
        actor_type: "user",
        actor_id: user.id,
        source: "admin_operator_mode",
        previous_state: null,
        new_state: created.data,
        metadata: { source_coupon_id: couponId, source_campaign_key: existing.data.campaign_key },
      });
      if (event.error) throw event.error;

      return json(req, 200, { success: true, coupon: created.data });
    }

    if (action === "update_location_image") {
      const locationId = text(body.location_id, 100);
      const imageUrl = text(body.image_url, 1_500);
      if (!locationId || !imageUrl || !/^https:\/\//i.test(imageUrl)) {
        return json(req, 400, { success: false, error: "invalid_location_image" });
      }
      const currentLocation = await admin.from("referral_benefit_campaign_locations")
        .select("id,campaign_id,location_key,display_name,official_media_url")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("campaign_id", couponId)
        .eq("id", locationId)
        .maybeSingle();
      if (!currentLocation.data) return json(req, 404, { success: false, error: "location_not_found" });

      const updatedLocation = await admin.from("referral_benefit_campaign_locations")
        .update({ official_media_url: imageUrl })
        .eq("organization_id", ORGANIZATION_ID)
        .eq("campaign_id", couponId)
        .eq("id", locationId)
        .select("id,campaign_id,location_key,display_name,official_media_url")
        .single();
      if (updatedLocation.error) throw updatedLocation.error;

      const event = await admin.from("referral_operational_events").insert({
        organization_id: ORGANIZATION_ID,
        aggregate_type: "coupon_campaign",
        aggregate_id: couponId,
        event_type: "coupon_location_image_updated",
        actor_type: "user",
        actor_id: user.id,
        source: "admin_operator_mode",
        previous_state: currentLocation.data,
        new_state: updatedLocation.data,
        metadata: { location_id: locationId, changed_fields: ["official_media_url"] },
      });
      if (event.error) throw event.error;

      return json(req, 200, { success: true, location: updatedLocation.data });
    }

    if (action !== "update") return json(req, 400, { success: false, error: "unsupported_action" });

    const patchInput = body.patch;
    if (!patchInput || typeof patchInput !== "object" || Array.isArray(patchInput)) {
      return json(req, 400, { success: false, error: "invalid_patch" });
    }
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patchInput as Record<string, unknown>)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      patch[key] = value;
    }
    if (Object.keys(patch).length === 0) return json(req, 400, { success: false, error: "empty_patch" });

    if (patch.delivery_source !== undefined && !["legacy", "db"].includes(String(patch.delivery_source))) {
      return json(req, 400, { success: false, error: "invalid_delivery_source" });
    }
    const nextBusinessId = patch.business_id !== undefined ? patch.business_id : existing.data.business_id;
    const nextDeliverySource = patch.delivery_source !== undefined ? patch.delivery_source : existing.data.delivery_source;
    if (nextDeliverySource === "db" && !nextBusinessId) {
      return json(req, 400, { success: false, error: "custom_message_requires_business" });
    }

    const updated = await admin.from("referral_coupon_campaigns")
      .update(patch)
      .eq("organization_id", ORGANIZATION_ID)
      .eq("id", couponId)
      .select("id,campaign_key,service_id,display_name,business_id,image_url,customer_copy,terms_text,active,starts_at,expires_at,delivery_source,updated_at")
      .single();
    if (updated.error) throw updated.error;

    const event = await admin.from("referral_operational_events").insert({
      organization_id: ORGANIZATION_ID,
      aggregate_type: "coupon_campaign",
      aggregate_id: couponId,
      event_type: "coupon_admin_updated",
      actor_type: "user",
      actor_id: user.id,
      source: "admin_operator_mode",
      previous_state: existing.data,
      new_state: updated.data,
      metadata: { changed_fields: Object.keys(patch) },
    });
    if (event.error) throw event.error;

    return json(req, 200, { success: true, coupon: updated.data });
  } catch (error) {
    console.error("admin-coupon-management", error);
    return json(req, 500, { success: false, error: "internal_error" });
  }
});
