import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, UserRound } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import PageHeader from "../ui/PageHeader";
import EmptyState from "../ui/EmptyState";
import StatusBadge, { type StatusTone } from "../ui/StatusBadge";
import { SkeletonRows } from "../ui/Skeleton";
import { legalOpportunityPresentation } from "../operations/legalOpportunities";

type CaseRequest = {
  id: string;
  lead_id: string;
  service_id: string;
  status: string;
  postal_code: string | null;
  intake: Record<string, unknown> | null;
  consent: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type CaseLead = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  channel_user_id: string | null;
};

type CaseAssignment = {
  id: string;
  partner_id: string;
  status: string;
  work_status: string;
  assigned_at: string;
  updated_at: string;
  follow_up_reason: string | null;
  next_followup_at: string | null;
  follow_up_attempt_count: number;
};

type CasePartner = { id: string; name: string };
type CaseEvent = { id: string; aggregate_id: string; event_type: string; occurred_at: string; metadata: Record<string, unknown> | null };
type CaseState = { request: CaseRequest; lead: CaseLead | null; assignment: CaseAssignment | null; partner: CasePartner | null; events: CaseEvent[] };

const STATUS_LABEL: Record<string, string> = {
  new: "Nuevo", prequalified: "Nuevo", qualified: "Nuevo", contacted: "En gestión",
  in_progress: "En gestión", appointment_scheduled: "Cita", converted: "Cerrado",
  not_converted: "Cerrado", closed: "Cerrado",
};

function displayStatus(request: CaseRequest, assignment: CaseAssignment | null): string {
  if (request.status === "closed" || ["converted", "not_converted", "closed"].includes(assignment?.work_status ?? "")) return "Cerrado";
  if (assignment?.work_status === "appointment_scheduled") return "Cita";
  if (assignment && assignment.work_status !== "new") return "En gestión";
  return STATUS_LABEL[request.status] ?? "Nuevo";
}
function toneForStatus(status: string): StatusTone {
  if (status === "Cerrado" || status === "Cita") return "success";
  if (status === "En gestión") return "warning";
  return "neutral";
}
function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function leadName(lead: CaseLead | null): string {
  if (!lead) return "Cliente";
  return lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Cliente";
}
function intakeSummary(request: CaseRequest): string | null {
  const topic = typeof request.intake?.topic === "string" ? request.intake.topic : null;
  const presentation = legalOpportunityPresentation(request.service_id, request.intake ?? {}, topic);
  return presentation.summary || presentation.description || null;
}

export default function CaseDetailScreen() {
  const { requestId = "" } = useParams();
  const { resolvedOrgId } = useReferralOrganization();
  const [state, setState] = useState<CaseState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!resolvedOrgId || !requestId) {
      setError("Caso no disponible.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");

    const requestRes = await supabase
      .from("referral_service_requests")
      .select("id,lead_id,service_id,status,postal_code,intake,consent,created_at,updated_at")
      .eq("id", requestId)
      .eq("organization_id", resolvedOrgId)
      .maybeSingle();

    if (requestRes.error || !requestRes.data) {
      setState(null);
      setError("No se pudo cargar este caso.");
      setLoading(false);
      return;
    }

    const request = requestRes.data as unknown as CaseRequest;
    const [leadRes, assignmentsRes] = await Promise.all([
      supabase.from("leads")
        .select("id,full_name,first_name,last_name,phone,channel_user_id")
        .eq("id", request.lead_id).eq("organization_id", resolvedOrgId).maybeSingle(),
      supabase.from("referral_assignments")
        .select("id,partner_id,status,work_status,assigned_at,updated_at,follow_up_reason,next_followup_at,follow_up_attempt_count")
        .eq("request_id", request.id).eq("organization_id", resolvedOrgId)
        .order("attempt_number", { ascending: false }),
    ]);

    const assignments = (assignmentsRes.data ?? []) as unknown as CaseAssignment[];
    const assignment = assignments.find((row) => ["pending_assignment", "assigned", "accepted"].includes(row.status)) ?? assignments[0] ?? null;
    const partnerRes = assignment
      ? await supabase.from("referral_partners").select("id,name")
          .eq("id", assignment.partner_id).eq("organization_id", resolvedOrgId).maybeSingle()
      : { data: null };

    const assignmentIds = assignments.map((row) => row.id);
    const eventsRes = assignmentIds.length
      ? await supabase.from("referral_operational_events")
          .select("id,aggregate_id,event_type,occurred_at,metadata")
          .eq("organization_id", resolvedOrgId)
          .eq("aggregate_type", "assignment")
          .in("aggregate_id", assignmentIds)
          .order("occurred_at", { ascending: false })
          .limit(100)
      : { data: [] as CaseEvent[] };

    setState({
      request,
      lead: (leadRes.data as unknown as CaseLead | null) ?? null,
      assignment,
      partner: (partnerRes.data as unknown as CasePartner | null) ?? null,
      events: (eventsRes.data ?? []) as unknown as CaseEvent[],
    });
    setLoading(false);
  }, [requestId, resolvedOrgId]);

  useEffect(() => { void load(); }, [load]);

  const status = useMemo(() => state ? displayStatus(state.request, state.assignment) : "Nuevo", [state]);

  if (loading) return <div className="hub-page"><Link className="hub-back" to="/operacion"><ArrowLeft />Volver</Link><SkeletonRows count={4} /></div>;
  if (error || !state) return <div className="hub-page"><Link className="hub-back" to="/operacion"><ArrowLeft />Volver</Link><EmptyState tone="error" icon={AlertTriangle} title="Caso no encontrado" description={error || "No existe este caso."} /></div>;

  const presentation = legalOpportunityPresentation(
    state.request.service_id,
    state.request.intake ?? {},
    typeof state.request.intake?.topic === "string" ? state.request.intake.topic : null,
  );
  const summary = intakeSummary(state.request);

  return (
    <div className="hub-page hub-page--wide">
      <Link className="hub-back" to="/operacion"><ArrowLeft />Volver a Operación</Link>
      <PageHeader
        eyebrow="Caso"
        title={leadName(state.lead)}
        subtitle={`${presentation.serviceLabel || state.request.service_id} · recibido ${formatDateTime(state.request.created_at)}`}
        meta={<StatusBadge tone={toneForStatus(status)} label={status} />}
      />

      <dl className="hub-facts">
        <div><dt>Servicio</dt><dd>{presentation.serviceLabel || state.request.service_id}</dd></div>
        <div><dt>Responsable</dt><dd>{state.partner?.name || "Sin responsable"}</dd></div>
        <div><dt>ZIP</dt><dd>{state.request.postal_code || "—"}</dd></div>
        <div><dt>Última actividad</dt><dd>{formatDateTime(state.assignment?.updated_at || state.request.updated_at)}</dd></div>
        <div><dt>Próximo paso</dt><dd>{state.assignment?.next_followup_at ? formatDateTime(state.assignment.next_followup_at) : status === "Cerrado" ? "Caso cerrado" : "Falta programar el próximo paso"}</dd></div>
        <div><dt>Intentos de seguimiento</dt><dd>{state.assignment?.follow_up_attempt_count ?? 0}</dd></div>
      </dl>

      <section className="hub-section">
        <h2>Contexto del caso</h2>
        {summary ? <p style={{ whiteSpace: "pre-wrap" }}>{summary}</p> : <EmptyState icon={UserRound} title="Sin resumen adicional" />}
        {presentation.topic ? <p><strong>Tipo:</strong> {presentation.topic}</p> : null}
      </section>

      <section className="hub-section">
        <h2>Contacto</h2>
        <dl className="hub-facts">
          <div><dt>Teléfono</dt><dd>{state.lead?.phone || "—"}</dd></div>
          <div><dt>WhatsApp</dt><dd>{state.lead?.channel_user_id || "—"}</dd></div>
        </dl>
      </section>

      <section className="hub-section">
        <h2>Actividad</h2>
        {state.events.length === 0 ? (
          <EmptyState icon={Clock} title="Sin eventos registrados para este caso" />
        ) : (
          <div className="hub-list">
            {state.events.slice(0, 20).map((event) => (
              <div key={event.id} className="hub-list-row">
                <div><strong>{event.event_type.replace(/_/g, " ")}</strong><small>{formatDateTime(event.occurred_at)}</small></div>
                <CheckCircle2 size={18} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
