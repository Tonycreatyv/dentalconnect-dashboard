import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ORGANIZATION_ID = "luis-gabriel-referral-hub";
const MAX_EVENTS = 200;
const LEGAL_SERVICE_IDS = new Set(["luis_accidente", "luis_inmigracion", "luis_dui_criminal"]);
const SERVICE_LABELS: Record<string, string> = {
  luis_accidente: "Accidente",
  luis_inmigracion: "Inmigración",
  luis_dui_criminal: "DUI / Criminal",
};

type OutboxEventType = "new_case" | "unassigned_case" | "exception_case" | "partner_assignment";

type NotificationCandidate = {
  eventType: OutboxEventType;
  sourceId: string;
  sourceAt: string;
  requestId: string | null;
  aggregateType: string;
  aggregateId: string | null;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requestIdForEvent(row: Record<string, unknown>): string | null {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
  const fromMetadata = stringValue(metadata.request_id);
  if (fromMetadata) return fromMetadata;
  return stringValue(row.aggregate_type) === "request" ? stringValue(row.aggregate_id) || null : null;
}

function classifyOperationalEvent(row: Record<string, unknown>): OutboxEventType | null {
  const eventType = stringValue(row.event_type);
  if (eventType.endsWith("_flow_request_created")) return "new_case";
  if (eventType.endsWith("_assignment_created")) return "partner_assignment";
  if (eventType === "assignment_unavailable" || eventType.endsWith("_assignment_unavailable")) return "unassigned_case";
  return null;
}

function labelForService(serviceId: string | undefined): string {
  return serviceId && SERVICE_LABELS[serviceId] ? SERVICE_LABELS[serviceId] : "Servicio";
}

async function insertForRecipients(
  admin: ReturnType<typeof createClient>,
  recipients: string[],
  candidate: NotificationCandidate,
) {
  if (!recipients.length) return 0;
  const rows = recipients.map((userId) => ({
    organization_id: ORGANIZATION_ID,
    recipient_user_id: userId,
    event_type: candidate.eventType,
    aggregate_type: candidate.aggregateType,
    aggregate_id: candidate.aggregateId,
    title: candidate.title,
    body: candidate.body,
    action_url: candidate.requestId ? `/operacion/${candidate.requestId}` : "/operacion",
    payload: candidate.payload ?? {},
    idempotency_key: `admin-push:${candidate.eventType}:${candidate.sourceId}:${userId}`,
    status: "queued",
  }));
  const result = await admin.from("referral_admin_notification_outbox")
    .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("id");
  if (result.error) throw result.error;
  return result.data?.length ?? 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { success: false, error: "method_not_allowed" });

  const expectedToken = Deno.env.get("ADMIN_PUSH_COLLECT_TOKEN") ?? "";
  const providedToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!expectedToken || providedToken !== expectedToken) {
    return json(401, { success: false, error: "unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json(503, { success: false, error: "service_configuration_missing" });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const now = new Date().toISOString();
    const cursorResult = await admin.from("referral_admin_notification_cursor")
      .select("last_event_at,last_exception_at")
      .eq("organization_id", ORGANIZATION_ID)
      .maybeSingle();
    if (cursorResult.error) throw cursorResult.error;

    // First run intentionally starts at deployment time instead of replaying old cases.
    if (!cursorResult.data) {
      const seeded = await admin.from("referral_admin_notification_cursor").insert({
        organization_id: ORGANIZATION_ID,
        last_event_at: now,
        last_exception_at: now,
        updated_at: now,
      });
      if (seeded.error) throw seeded.error;
      return json(200, { success: true, seeded: true, queued: 0 });
    }

    const membersResult = await admin.from("org_members")
      .select("user_id,role")
      .eq("organization_id", ORGANIZATION_ID)
      .in("role", ["owner", "admin"]);
    if (membersResult.error) throw membersResult.error;
    const recipients = [...new Set((membersResult.data ?? []).map((row) => stringValue(row.user_id)).filter(Boolean))];
    if (!recipients.length) return json(200, { success: true, queued: 0, reason: "no_admin_recipients" });

    const [eventsResult, exceptionsResult] = await Promise.all([
      admin.from("referral_operational_events")
        .select("id,event_type,aggregate_type,aggregate_id,metadata,occurred_at")
        .eq("organization_id", ORGANIZATION_ID)
        .gt("occurred_at", cursorResult.data.last_event_at)
        .lte("occurred_at", now)
        .order("occurred_at", { ascending: true })
        .limit(MAX_EVENTS),
      admin.from("referral_operational_exceptions")
        .select("id,aggregate_type,aggregate_id,exception_type,severity,summary,status,created_at")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("status", "open")
        .gt("created_at", cursorResult.data.last_exception_at)
        .lte("created_at", now)
        .order("created_at", { ascending: true })
        .limit(MAX_EVENTS),
    ]);
    if (eventsResult.error) throw eventsResult.error;
    if (exceptionsResult.error) throw exceptionsResult.error;

    const classifiedEvents = (eventsResult.data ?? [])
      .map((row) => ({ row: row as Record<string, unknown>, type: classifyOperationalEvent(row as Record<string, unknown>) }))
      .filter((item): item is { row: Record<string, unknown>; type: OutboxEventType } => Boolean(item.type));

    const requestIds = new Set<string>();
    for (const item of classifiedEvents) {
      const requestId = requestIdForEvent(item.row);
      if (requestId) requestIds.add(requestId);
    }
    for (const row of exceptionsResult.data ?? []) {
      if (row.aggregate_type === "request" && row.aggregate_id) requestIds.add(String(row.aggregate_id));
    }

    const requestMap = new Map<string, { service_id: string; case_cycle: number | null }>();
    if (requestIds.size) {
      const requestsResult = await admin.from("referral_service_requests")
        .select("id,service_id,case_cycle")
        .eq("organization_id", ORGANIZATION_ID)
        .in("id", [...requestIds]);
      if (requestsResult.error) throw requestsResult.error;
      for (const row of requestsResult.data ?? []) {
        requestMap.set(String(row.id), { service_id: String(row.service_id || ""), case_cycle: row.case_cycle ?? null });
      }
    }

    const candidates: NotificationCandidate[] = [];
    for (const item of classifiedEvents) {
      const requestId = requestIdForEvent(item.row);
      const request = requestId ? requestMap.get(requestId) : undefined;
      // P0 push scope is the live legal-service operations domain only. Furniture
      // and benefit delivery remain intentionally outside this collector.
      if (!request || !LEGAL_SERVICE_IDS.has(request.service_id)) continue;
      const serviceLabel = labelForService(request.service_id);
      const sourceId = stringValue(item.row.id);
      const sourceAt = stringValue(item.row.occurred_at);
      const aggregateId = stringValue(item.row.aggregate_id) || requestId;

      if (item.type === "new_case") {
        candidates.push({
          eventType: "new_case",
          sourceId,
          sourceAt,
          requestId,
          aggregateType: "request",
          aggregateId: requestId,
          title: `Nuevo caso · ${serviceLabel}`,
          body: "Entró una nueva solicitud y ya está disponible en Operación.",
          payload: { service_id: request.service_id, case_cycle: request.case_cycle },
        });
      } else if (item.type === "partner_assignment") {
        candidates.push({
          eventType: "partner_assignment",
          sourceId,
          sourceAt,
          requestId,
          aggregateType: "assignment",
          aggregateId,
          title: `Asignación actualizada · ${serviceLabel}`,
          body: "El caso tiene una nueva asignación de partner.",
          payload: { service_id: request.service_id, case_cycle: request.case_cycle },
        });
      } else if (item.type === "unassigned_case") {
        candidates.push({
          eventType: "unassigned_case",
          sourceId,
          sourceAt,
          requestId,
          aggregateType: "request",
          aggregateId: requestId,
          title: `Caso sin responsable · ${serviceLabel}`,
          body: "No se pudo completar una asignación. Revisa el caso en Operación.",
          payload: { service_id: request.service_id, case_cycle: request.case_cycle },
        });
      }
    }

    for (const row of exceptionsResult.data ?? []) {
      const requestId = row.aggregate_type === "request" && row.aggregate_id ? String(row.aggregate_id) : null;
      const request = requestId ? requestMap.get(requestId) : undefined;
      if (request && !LEGAL_SERVICE_IDS.has(request.service_id)) continue;
      candidates.push({
        eventType: "exception_case",
        sourceId: String(row.id),
        sourceAt: String(row.created_at),
        requestId,
        aggregateType: String(row.aggregate_type || "exception"),
        aggregateId: row.aggregate_id ? String(row.aggregate_id) : String(row.id),
        title: row.severity === "critical" ? "Excepción crítica" : "Excepción operativa",
        body: stringValue(row.summary) || "Hay una excepción que necesita revisión en Operación.",
        payload: { exception_type: row.exception_type, severity: row.severity },
      });
    }

    let queued = 0;
    for (const candidate of candidates) queued += await insertForRecipients(admin, recipients, candidate);

    const lastEventAt = (eventsResult.data ?? []).at(-1)?.occurred_at ?? cursorResult.data.last_event_at;
    const lastExceptionAt = (exceptionsResult.data ?? []).at(-1)?.created_at ?? cursorResult.data.last_exception_at;
    const cursorUpdate = await admin.from("referral_admin_notification_cursor").update({
      last_event_at: lastEventAt,
      last_exception_at: lastExceptionAt,
      updated_at: now,
    }).eq("organization_id", ORGANIZATION_ID);
    if (cursorUpdate.error) throw cursorUpdate.error;

    return json(200, {
      success: true,
      seeded: false,
      candidates: candidates.length,
      queued,
      recipients: recipients.length,
      events_scanned: eventsResult.data?.length ?? 0,
      exceptions_scanned: exceptionsResult.data?.length ?? 0,
    });
  } catch (error) {
    console.error("admin-push-collect", error);
    return json(500, { success: false, error: "internal_error" });
  }
});
