type Json = Record<string, unknown>;

export type OperationalServiceId =
  | "luis_accidente"
  | "luis_inmigracion"
  | "luis_eventos"
  | "luis_representante";

export type ServiceRequestOutcome = {
  success: true;
  outcome: "assigned" | "needs_coordinator_review";
  idempotentReplay: boolean;
  requestId: string;
  requestStatus: string;
  assignmentId: string | null;
  assignmentStatus: string | null;
  notificationId: string | null;
  notificationStatus: string | null;
  exceptionId: string | null;
  exceptionType: string | null;
  assignmentKind: "partner" | "internal" | null;
  portalTokenPrepared: boolean;
};

export type ServiceRequestFailure = {
  success: false;
  error: "request_persistence_failed" | "request_response_invalid";
};

type SupabaseRpc = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<
    { data: unknown; error: { message?: string; code?: string } | null }
  >;
};

function value(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

export async function orchestrateCompletedServiceRequest(args: {
  supabase: SupabaseRpc;
  organizationId: string;
  leadId: string;
  serviceId: OperationalServiceId;
  sourceChannel: "messenger" | "whatsapp";
  channelUserId: string;
  completionKey: string;
  completionOutcome: "confirmed_intake" | "follow_up_requested";
  intake: Json;
}): Promise<ServiceRequestOutcome | ServiceRequestFailure> {
  try {
    const result = await args.supabase.rpc(
      "orchestrate_referral_service_request",
      {
        p_organization_id: args.organizationId,
        p_lead_id: args.leadId,
        p_service_id: args.serviceId,
        p_source_channel: args.sourceChannel,
        p_channel_user_id: args.channelUserId,
        p_completion_key: args.completionKey,
        p_completion_outcome: args.completionOutcome,
        p_intake: args.intake,
      },
    );
    if (result.error) {
      return { success: false, error: "request_persistence_failed" };
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row || typeof row !== "object") {
      return { success: false, error: "request_response_invalid" };
    }
    const data = row as Record<string, unknown>;
    const outcome = value(data.outcome);
    const requestId = value(data.request_id);
    if (
      data.success !== true || !requestId ||
      !["assigned", "needs_coordinator_review"].includes(outcome)
    ) return { success: false, error: "request_response_invalid" };
    return {
      success: true,
      outcome: outcome as ServiceRequestOutcome["outcome"],
      idempotentReplay: data.idempotent_replay === true,
      requestId,
      requestStatus: value(data.request_status),
      assignmentId: value(data.assignment_id) || null,
      assignmentStatus: value(data.assignment_status) || null,
      notificationId: value(data.notification_id) || null,
      notificationStatus: value(data.notification_status) || null,
      exceptionId: value(data.exception_id) || null,
      exceptionType: value(data.exception_type) || null,
      assignmentKind:
        ["partner", "internal"].includes(value(data.assignment_kind))
          ? value(data.assignment_kind) as "partner" | "internal"
          : null,
      // The raw one-time token is intentionally discarded at this boundary.
      portalTokenPrepared: Boolean(value(data.portal_token)),
    };
  } catch {
    return { success: false, error: "request_persistence_failed" };
  }
}

const REQUEST_FAILED =
  "No pudimos completar la solicitud en este momento. Inténtalo nuevamente o selecciona ‘Hablar con asesor’.";

export function customerCopyForServiceRequest(
  serviceId: OperationalServiceId,
  result: ServiceRequestOutcome | ServiceRequestFailure,
): string {
  if (!result.success) return REQUEST_FAILED;
  const requestReceived = result.outcome === "assigned"
    ? result.notificationStatus === "queued"
      ? "Recibimos tu solicitud. La asignación fue creada y su notificación está en cola. Todavía no ha sido aceptada."
      : "Recibimos tu solicitud y creamos la asignación para revisión."
    : "Recibimos tu solicitud. Un coordinador debe revisarla porque todavía no hay un recurso configurado disponible.";
  if (serviceId === "luis_accidente") {
    return `Gracias por la información.\n\nLG Community Network no ofrece asesoría legal directamente. Te conectamos con profesionales o recursos participantes.\n\n${requestReceived}`;
  }
  if (serviceId === "luis_representante" && result.outcome === "assigned") {
    return "Recibimos tu solicitud. La tarea interna fue creada y su notificación está en cola para revisión. Todavía no ha sido aceptada.";
  }
  return requestReceived;
}

export function operationalStatePatch(
  result: ServiceRequestOutcome | ServiceRequestFailure,
): Json {
  if (!result.success) {
    return {
      operational_request_status: "failed",
      operational_request_error: result.error,
    };
  }
  return {
    operational_request_id: result.requestId,
    operational_request_status: result.requestStatus || "prequalified",
    operational_assignment_id: result.assignmentId,
    operational_assignment_status: result.assignmentStatus,
    operational_notification_id: result.notificationId,
    operational_notification_status: result.notificationStatus,
    operational_exception_id: result.exceptionId,
    operational_exception_type: result.exceptionType,
    operational_outcome: result.outcome,
    operational_idempotent_replay: result.idempotentReplay,
  };
}
