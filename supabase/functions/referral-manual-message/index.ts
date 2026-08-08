import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ALLOWED_ORIGINS = new Set([
  "https://referral.creatyv.io",
  "http://localhost:5173",
]);
const LG_ORGANIZATION_ID = "luis-gabriel-referral-hub";
const MAX_BODY_BYTES = 12_000;

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://referral.creatyv.io",
    "access-control-allow-headers":
      "authorization, apikey, content-type, x-client-info",
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
function value(input: unknown, max = 2_000) {
  return typeof input === "string" && input.trim().length <= max
    ? input.trim()
    : "";
}
async function columns(client: any, table: string) {
  const result = await client.from("information_schema.columns").select(
    "column_name",
  ).eq("table_schema", "public").eq("table_name", table);
  return new Set<string>(
    (result.data ?? []).map((row: any) => String(row.column_name)),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(req) });
  }
  if (req.method !== "POST") {
    return json(req, 405, { success: false, error: "method_not_allowed" });
  }
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json(req, 413, { success: false, error: "request_too_large" });
  }
  try {
    const authorization = req.headers.get("authorization") ?? "";
    const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!bearer) {
      return json(req, 401, { success: false, error: "unauthorized" });
    }
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json(req, 413, { success: false, error: "request_too_large" });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const organizationId = value(body.organization_id, 100);
    const leadId = value(body.lead_id, 100);
    const channel = value(body.channel, 20);
    const recipientId = value(body.channel_user_id, 200);
    const text = value(body.text);
    const imageUrl = value(body.image_url, 1_000);
    const idempotencyKey = value(body.idempotency_key, 200);
    if (organizationId !== LG_ORGANIZATION_ID) {
      return json(req, 403, {
        success: false,
        error: "organization_forbidden",
      });
    }
    if (
      !leadId || !recipientId || !idempotencyKey ||
      !["messenger", "whatsapp"].includes(channel)
    ) return json(req, 400, { success: false, error: "invalid_request" });
    if ((!text && !imageUrl) || (imageUrl && !/^https:\/\//i.test(imageUrl))) {
      return json(req, 400, { success: false, error: "invalid_content" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      throw new Error("service_configuration_missing");
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const userResult = await admin.auth.getUser(bearer);
    const userId = userResult.data.user?.id;
    if (!userId) {
      return json(req, 401, { success: false, error: "unauthorized" });
    }
    const membership = await admin.from("org_members").select("role").eq(
      "organization_id",
      organizationId,
    ).eq("user_id", userId).maybeSingle();
    if (
      !membership.data ||
      !["owner", "admin"].includes(String(membership.data.role))
    ) return json(req, 403, { success: false, error: "permission_denied" });
    const lead = await admin.from("leads").select("id,channel,channel_user_id")
      .eq("id", leadId).eq("organization_id", organizationId).maybeSingle();
    if (
      !lead.data || lead.data.channel !== channel ||
      lead.data.channel_user_id !== recipientId
    ) {
      return json(req, 404, {
        success: false,
        error: "conversation_not_found",
      });
    }

    const existing = await admin.from("reply_outbox").select(
      "id,status,last_error",
    ).eq("organization_id", organizationId).contains("payload", {
      idempotency_key: idempotencyKey,
    }).maybeSingle();
    if (existing.data) {
      return json(req, 200, {
        success: true,
        queued: true,
        idempotent_replay: true,
        job: existing.data,
      });
    }
    const messageCols = await columns(admin, "messages");
    const message: Record<string, unknown> = {
      organization_id: organizationId,
      lead_id: leadId,
      channel,
      channel_user_id: recipientId,
      actor: "staff",
      role: "assistant",
      content: text || "Imagen",
      created_at: new Date().toISOString(),
    };
    if (messageCols.has("status")) message.status = "queued";
    if (messageCols.has("payload")) {
      message.payload = {
        source: "manual_staff_reply",
        image_url: imageUrl || null,
        idempotency_key: idempotencyKey,
      };
    }
    const insertedMessage = await admin.from("messages").insert(message).select(
      "id",
    ).single();
    if (insertedMessage.error) {
      throw new Error(`message_queue_failed:${insertedMessage.error.message}`);
    }
    const payload = {
      source: "manual_staff_reply",
      type: "manual_staff_reply",
      text,
      image_url: imageUrl || null,
      channel,
      recipient_id: recipientId,
      dashboard_user_id: userId,
      ui_message_id: insertedMessage.data.id,
      idempotency_key: idempotencyKey,
    };
    const outbox = await admin.from("reply_outbox").insert({
      organization_id: organizationId,
      lead_id: leadId,
      channel,
      channel_user_id: recipientId,
      status: "queued",
      payload,
      scheduled_for: new Date().toISOString(),
    }).select("id,status").single();
    if (outbox.error) {
      await admin.from("messages").update({
        status: "failed",
        last_error: "outbox_queue_failed",
      }).eq("id", insertedMessage.data.id);
      throw new Error(`outbox_queue_failed:${outbox.error.message}`);
    }
    await admin.from("referral_operational_events").insert({
      organization_id: organizationId,
      aggregate_type: "conversation",
      aggregate_id: leadId,
      event_type: "manual_message_queued",
      actor_type: "user",
      actor_id: userId,
      source: "referral-manual-message",
      metadata: {
        channel,
        message_id: insertedMessage.data.id,
        outbox_id: outbox.data.id,
        has_image: Boolean(imageUrl),
      },
      idempotency_key: `${idempotencyKey}:event`,
    });
    return json(req, 202, {
      success: true,
      queued: true,
      idempotent_replay: false,
      message_id: insertedMessage.data.id,
      outbox_id: outbox.data.id,
      delivery_status: "queued",
    });
  } catch (error) {
    console.error("[referral-manual-message] request_failed", {
      error: String((error as Error).message).slice(0, 300),
    });
    return json(req, 500, {
      success: false,
      error: "manual_message_queue_failed",
    });
  }
});
