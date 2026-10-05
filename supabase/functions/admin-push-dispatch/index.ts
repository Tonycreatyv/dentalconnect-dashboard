import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";

const ORGANIZATION_ID = "luis-gabriel-referral-hub";
const MAX_BATCH = 25;

const EVENT_PREFERENCE: Record<string, string> = {
  new_case: "new_case",
  unassigned_case: "unassigned_case",
  exception_case: "exception_case",
  partner_assignment: "partner_assignment",
  partner_access: "partner_access",
  benefit_changes: "benefit_changes",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function localMinutes(timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "");
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "");
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

function parseClock(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function quietDelayMinutes(preferences: Record<string, unknown>): number {
  if (!preferences.quiet_hours_enabled) return 0;
  const start = parseClock(preferences.quiet_hours_start);
  const end = parseClock(preferences.quiet_hours_end);
  const now = localMinutes(String(preferences.timezone || "America/New_York"));
  if (start === null || end === null || now === null || start === end) return 0;

  const inside = start < end ? now >= start && now < end : now >= start || now < end;
  if (!inside) return 0;
  const delta = (end - now + 1440) % 1440;
  return Math.max(delta, 1);
}

async function markOutbox(
  admin: ReturnType<typeof createClient>,
  id: string,
  patch: Record<string, unknown>,
) {
  const result = await admin.from("referral_admin_notification_outbox")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("organization_id", ORGANIZATION_ID)
    .eq("id", id);
  if (result.error) throw result.error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { success: false, error: "method_not_allowed" });

  const expectedToken = Deno.env.get("ADMIN_PUSH_DISPATCH_TOKEN") ?? "";
  const providedToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!expectedToken || providedToken !== expectedToken) {
    return json(401, { success: false, error: "unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@creatyv.io";
  if (!supabaseUrl || !serviceKey || !vapidPublicKey || !vapidPrivateKey) {
    return json(503, { success: false, error: "push_not_configured" });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const due = await admin.from("referral_admin_notification_outbox")
      .select("id,recipient_user_id,event_type,aggregate_type,aggregate_id,title,body,action_url,payload,attempts")
      .eq("organization_id", ORGANIZATION_ID)
      .eq("status", "queued")
      .lte("available_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(MAX_BATCH);
    if (due.error) throw due.error;

    const summary = { processed: 0, sent: 0, failed: 0, suppressed: 0, deferred: 0 };

    for (const row of due.data ?? []) {
      const claimed = await admin.from("referral_admin_notification_outbox")
        .update({
          status: "processing",
          attempts: Number(row.attempts ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", ORGANIZATION_ID)
        .eq("id", row.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (claimed.error) throw claimed.error;
      if (!claimed.data) continue;
      summary.processed += 1;

      try {
        const preferenceKey = EVENT_PREFERENCE[String(row.event_type)];
        if (!preferenceKey) {
          await markOutbox(admin, row.id, { status: "suppressed", last_error: "unsupported_event_type" });
          summary.suppressed += 1;
          continue;
        }

        const preferenceResult = await admin.from("referral_admin_notification_preferences")
          .select("push_enabled,new_case,unassigned_case,exception_case,partner_assignment,partner_access,benefit_changes,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,timezone")
          .eq("organization_id", ORGANIZATION_ID)
          .eq("user_id", row.recipient_user_id)
          .maybeSingle();
        if (preferenceResult.error) throw preferenceResult.error;
        const preferences = (preferenceResult.data ?? {
          push_enabled: true,
          new_case: true,
          unassigned_case: true,
          exception_case: true,
          partner_assignment: true,
          partner_access: true,
          benefit_changes: false,
          quiet_hours_enabled: false,
          timezone: "America/New_York",
        }) as Record<string, unknown>;

        if (preferences.push_enabled === false || preferences[preferenceKey] === false) {
          await markOutbox(admin, row.id, { status: "suppressed", last_error: "disabled_by_preference" });
          summary.suppressed += 1;
          continue;
        }

        const delayMinutes = quietDelayMinutes(preferences);
        if (delayMinutes > 0) {
          await markOutbox(admin, row.id, {
            status: "queued",
            available_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
            last_error: null,
          });
          summary.deferred += 1;
          continue;
        }

        const subscriptions = await admin.from("referral_admin_push_subscriptions")
          .select("id,endpoint,p256dh,auth_key")
          .eq("organization_id", ORGANIZATION_ID)
          .eq("user_id", row.recipient_user_id)
          .eq("active", true);
        if (subscriptions.error) throw subscriptions.error;
        if (!subscriptions.data?.length) {
          await markOutbox(admin, row.id, { status: "suppressed", last_error: "no_active_device" });
          summary.suppressed += 1;
          continue;
        }

        const payload = JSON.stringify({
          title: row.title,
          body: row.body,
          url: row.action_url || "/operacion",
          tag: `${row.aggregate_type}:${row.aggregate_id || row.id}`,
          data: row.payload ?? {},
        });

        let delivered = 0;
        const errors: string[] = [];
        for (const subscription of subscriptions.data) {
          try {
            await webpush.sendNotification({
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
            }, payload, { TTL: 300, urgency: "high" });
            delivered += 1;
          } catch (error) {
            const statusCode = Number((error as { statusCode?: number })?.statusCode ?? 0);
            if (statusCode === 404 || statusCode === 410) {
              await admin.from("referral_admin_push_subscriptions")
                .update({ active: false, updated_at: new Date().toISOString() })
                .eq("id", subscription.id)
                .eq("organization_id", ORGANIZATION_ID);
            }
            errors.push(statusCode ? `push_${statusCode}` : String((error as Error)?.message || error).slice(0, 180));
          }
        }

        if (delivered > 0) {
          await markOutbox(admin, row.id, {
            status: "sent",
            sent_at: new Date().toISOString(),
            last_error: errors.length ? errors.join(",") : null,
          });
          summary.sent += 1;
        } else {
          await markOutbox(admin, row.id, {
            status: "failed",
            last_error: errors.join(",") || "push_delivery_failed",
          });
          summary.failed += 1;
        }
      } catch (error) {
        await markOutbox(admin, row.id, {
          status: "failed",
          last_error: String((error as Error)?.message || error).slice(0, 500),
        });
        summary.failed += 1;
      }
    }

    return json(200, { success: true, ...summary });
  } catch (error) {
    console.error("admin-push-dispatch", error);
    return json(500, { success: false, error: "internal_error" });
  }
});
