import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ORGANIZATION_ID = "luis-gabriel-referral-hub";
const ALLOWED_ORIGINS = new Set(["https://referral.creatyv.io", "http://localhost:5173", "http://127.0.0.1:5173"]);
const MAX_BODY_BYTES = 24_000;

const PARTNER_COLUMNS = "id,name,slug,partnership_status,active,category_service_id,contact_name,phone,address_text,postal_code,image_url,hours,faqs,offers_coupon,receives_service_requests";
const WRITABLE_FIELDS = [
  "name", "category_service_id", "contact_name", "phone", "address_text", "postal_code",
  "image_url", "hours", "faqs", "offers_coupon", "receives_service_requests",
] as const;

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
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "content-type": "application/json", "cache-control": "no-store" } });
}
function cleanText(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("invalid_text");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new Error("invalid_text");
  return trimmed;
}
function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "partner";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
function validatePostal(value: unknown): string | null {
  const postal = cleanText(value, 5);
  if (postal && !/^\d{5}$/.test(postal)) throw new Error("invalid_postal_code");
  return postal;
}
function validateImage(value: unknown): string | null {
  const image = cleanText(value, 1500);
  if (image && !/^https:\/\//i.test(image)) throw new Error("invalid_image_url");
  return image;
}
function validateJsonObject(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid_${name}`);
  return value as Record<string, unknown>;
}
function validateFaqs(value: unknown): Array<{ question: string; answer: string }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new Error("invalid_faqs");
  return value.map((row) => {
    if (!row || typeof row !== "object") throw new Error("invalid_faqs");
    const item = row as Record<string, unknown>;
    const question = cleanText(item.question, 500);
    const answer = cleanText(item.answer, 2000);
    if (!question || !answer) throw new Error("invalid_faqs");
    return { question, answer };
  });
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) throw new Error("service_configuration_missing");
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const userResult = await admin.auth.getUser(bearer);
    const actorId = userResult.data.user?.id;
    if (!actorId) return json(req, 401, { success: false, error: "unauthorized" });
    const membership = await admin.from("org_members").select("role")
      .eq("organization_id", ORGANIZATION_ID).eq("user_id", actorId).maybeSingle();
    if (!membership.data || !["owner", "admin"].includes(String(membership.data.role))) {
      return json(req, 403, { success: false, error: "permission_denied" });
    }

    const action = String(body.action ?? "");
    if (action === "create") {
      const name = cleanText(body.name, 160);
      if (!name) return json(req, 400, { success: false, error: "name_required" });
      const inserted = await admin.from("referral_partners").insert({
        organization_id: ORGANIZATION_ID,
        name,
        slug: slugify(name),
        partnership_status: "active",
        active: true,
        category_service_id: cleanText(body.category_service_id, 120),
        contact_name: cleanText(body.contact_name, 160),
        phone: cleanText(body.phone, 60),
        address_text: cleanText(body.address_text, 500),
        postal_code: validatePostal(body.postal_code),
        image_url: validateImage(body.image_url),
        hours: validateJsonObject(body.hours, "hours"),
        faqs: validateFaqs(body.faqs),
        offers_coupon: body.offers_coupon === true,
        receives_service_requests: body.receives_service_requests === true,
      }).select(PARTNER_COLUMNS).single();
      if (inserted.error) throw inserted.error;

      const audit = await admin.from("referral_operational_events").insert({
        organization_id: ORGANIZATION_ID,
        aggregate_type: "partner",
        aggregate_id: inserted.data.id,
        event_type: "admin_partner_created",
        actor_type: "user",
        actor_id: actorId,
        source: "admin-partner-management",
        previous_state: null,
        new_state: inserted.data,
        metadata: { changed_fields: WRITABLE_FIELDS },
        idempotency_key: `admin-partner-create:${inserted.data.id}`,
      });
      if (audit.error) {
        await admin.from("referral_partners").delete().eq("organization_id", ORGANIZATION_ID).eq("id", inserted.data.id);
        throw new Error(`audit_failed:${audit.error.message}`);
      }
      return json(req, 200, { success: true, partner: inserted.data });
    }

    if (action === "update") {
      const partnerId = cleanText(body.partner_id, 100);
      if (!partnerId) return json(req, 400, { success: false, error: "partner_id_required" });
      const current = await admin.from("referral_partners").select(PARTNER_COLUMNS)
        .eq("organization_id", ORGANIZATION_ID).eq("id", partnerId).maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) return json(req, 404, { success: false, error: "partner_not_found" });

      const patchInput = body.patch;
      if (!patchInput || typeof patchInput !== "object" || Array.isArray(patchInput)) return json(req, 400, { success: false, error: "invalid_patch" });
      const input = patchInput as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (Object.hasOwn(input, "name")) patch.name = cleanText(input.name, 160);
      if (Object.hasOwn(input, "category_service_id")) patch.category_service_id = cleanText(input.category_service_id, 120);
      if (Object.hasOwn(input, "contact_name")) patch.contact_name = cleanText(input.contact_name, 160);
      if (Object.hasOwn(input, "phone")) patch.phone = cleanText(input.phone, 60);
      if (Object.hasOwn(input, "address_text")) patch.address_text = cleanText(input.address_text, 500);
      if (Object.hasOwn(input, "postal_code")) patch.postal_code = validatePostal(input.postal_code);
      if (Object.hasOwn(input, "image_url")) patch.image_url = validateImage(input.image_url);
      if (Object.hasOwn(input, "hours")) patch.hours = validateJsonObject(input.hours, "hours");
      if (Object.hasOwn(input, "faqs")) patch.faqs = validateFaqs(input.faqs);
      if (Object.hasOwn(input, "offers_coupon")) patch.offers_coupon = input.offers_coupon === true;
      if (Object.hasOwn(input, "receives_service_requests")) patch.receives_service_requests = input.receives_service_requests === true;
      if (Object.hasOwn(input, "active")) {
        if (typeof input.active !== "boolean") return json(req, 400, { success: false, error: "invalid_active" });
        patch.active = input.active;
        patch.partnership_status = input.active ? "active" : "paused";
      }
      if (patch.name === null) return json(req, 400, { success: false, error: "name_required" });
      if (!Object.keys(patch).length) return json(req, 400, { success: false, error: "empty_patch" });

      const updated = await admin.from("referral_partners").update(patch)
        .eq("organization_id", ORGANIZATION_ID).eq("id", partnerId).select(PARTNER_COLUMNS).single();
      if (updated.error) throw updated.error;

      const audit = await admin.from("referral_operational_events").insert({
        organization_id: ORGANIZATION_ID,
        aggregate_type: "partner",
        aggregate_id: partnerId,
        event_type: "admin_partner_updated",
        actor_type: "user",
        actor_id: actorId,
        source: "admin-partner-management",
        previous_state: current.data,
        new_state: updated.data,
        metadata: { changed_fields: Object.keys(patch) },
        idempotency_key: `admin-partner-update:${partnerId}:${crypto.randomUUID()}`,
      });
      if (audit.error) {
        const rollback: Record<string, unknown> = {};
        for (const key of [...WRITABLE_FIELDS, "active", "partnership_status"] as const) rollback[key] = current.data[key];
        await admin.from("referral_partners").update(rollback).eq("organization_id", ORGANIZATION_ID).eq("id", partnerId);
        throw new Error(`audit_failed:${audit.error.message}`);
      }
      return json(req, 200, { success: true, partner: updated.data });
    }

    return json(req, 400, { success: false, error: "unsupported_action" });
  } catch (error) {
    const message = String((error as Error)?.message || error);
    if (["invalid_text", "invalid_postal_code", "invalid_image_url", "invalid_hours", "invalid_faqs"].includes(message)) {
      return json(req, 400, { success: false, error: message });
    }
    console.error("admin-partner-management", error);
    return json(req, 500, { success: false, error: "internal_error" });
  }
});
