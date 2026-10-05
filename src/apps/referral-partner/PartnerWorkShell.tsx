import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useSilentPolling } from "../../hooks/useSilentPolling";
import { supabase } from "../../lib/supabaseClient";
import { normalizeImmigrationConsent, type ImmigrationInboxRow } from "../referral-hub/operations/immigrationInbox";
import { resolveImmigrationOpportunity, type ImmigrationOpportunity } from "../referral-hub/operations/immigrationOpportunities";
import { buildTelLink, formatPhoneForDisplay, planFollowUpSteps, planPartnerActionSteps, resolveActionNote, resolvePartnerPhone, type PartnerAction } from "./partnerActions";
import { buildPartnerCsv, buildPartnerXlsx, type PartnerExportRow } from "./partnerExport";
import { CORRECTION_REASON_LABEL, canCorrectFinalResult, correctionNoteIsValid, type CorrectionReason } from "./finalStateCorrection";
import { resolveActivePartnerContext, type ActivePartnerContext } from "./partnerMembership";
import {
  combineCustomDateTime,
  computeNextFollowupAt,
  defaultReminderOptionForReason,
  FOLLOW_UP_REASON_LABEL,
  followUpReasonsForService,
  formatCustomFollowUpPreview,
  formatFollowUpMoment,
  isCustomFollowUpReady,
  isFollowUpOverdue,
  nowTimeInputValue,
  QUEUE_STATUS_LABEL,
  reminderOptionsForReason,
  resolvePartnerQueueStatus,
  sortPartnerQueue,
  todayDateInputValue,
  type FollowUpReason,
  type PartnerQueueStatus,
  type PartnerStatusFilter,
  type ReminderOptionId,
} from "./partnerQueue";
import { resolvePartnerReferralService } from "./partnerReferralVisibility";
import {
  buildHumanSummary,
  buildIntakeSummary,
  intakeDescription,
  referralServiceLabel,
  resolveIncidentDateFact,
  resolveSummaryTopicKey,
  resolveTopicDisplay,
  type ReferralService,
} from "./referralPresentation";
import "./partnerModern.css";

type AssignmentRequestRow = {
  id: string;
  lead_id: string;
  service_id: string;
  postal_code: string | null;
  intake: Record<string, unknown> | null;
  consent: Record<string, unknown> | null;
  intake_complete: boolean;
  status: string;
  case_cycle: number | null;
  created_at: string;
  leads: { full_name: string | null; phone: string | null; channel_user_id: string | null } | null;
};

type AssignmentRow = {
  id: string;
  request_id: string;
  partner_id: string;
  status: string;
  work_status: string;
  assigned_at: string;
  updated_at: string;
  follow_up_reason: string | null;
  next_followup_at: string | null;
  follow_up_attempt_count: number;
  referral_service_requests: AssignmentRequestRow | null;
};

type LegalService = "auto_accident" | "immigration" | "dui" | "criminal";
type ServiceFilter = "all" | LegalService;

const LEGAL_SERVICES = new Set<ReferralService>(["auto_accident", "immigration", "dui", "criminal"]);
const SERVICE_OPTIONS: Array<{ id: ServiceFilter; label: string }> = [
  { id: "all", label: "Todos los servicios" },
  { id: "auto_accident", label: "Accidente de auto" },
  { id: "immigration", label: "Inmigración" },
  { id: "dui", label: "DUI" },
  { id: "criminal", label: "Criminal" },
];

const SERVICE_ICON: Record<LegalService, string> = {
  auto_accident: "🚗",
  immigration: "🛂",
  dui: "⚖️",
  criminal: "⚖️",
};

const ACTION_FEEDBACK: Record<PartnerAction, string> = {
  contacted: "Registrado: contactaste a este cliente.",
  no_answer: "Registrado: intento de contacto sin respuesta.",
  pending: "Marcado como pendiente de seguimiento.",
  appointment_scheduled: "Cita registrada.",
  converted: "Caso marcado como convertido.",
  closed_not_converted: "Caso cerrado sin conversión.",
};

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  const time = new Intl.DateTimeFormat("es-US", { hour: "numeric", minute: "2-digit" }).format(date);
  return `${formatDate(value)} · ${time}`;
}

function formatRelative(value: string | null | undefined): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  const time = new Intl.DateTimeFormat("es-US", { hour: "numeric", minute: "2-digit" }).format(date);
  if (diffDays === 0) return `hoy · ${time}`;
  if (diffDays === 1) return `ayer · ${time}`;
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(date);
}

function formatLeadAge(value: string | null | undefined): string {
  if (!value) return "—";
  const created = new Date(value);
  if (Number.isNaN(created.getTime())) return "—";
  const elapsed = Math.max(0, Date.now() - created.getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return minutes <= 1 ? "1 min" : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 día" : `${days} días`;
}

function queueStatusTone(status: PartnerQueueStatus, overdue: boolean): string {
  return overdue ? "overdue" : status;
}

function isLegalService(service: ReferralService | null): service is LegalService {
  return Boolean(service && LEGAL_SERVICES.has(service));
}

function toOpportunity(row: AssignmentRow): ImmigrationOpportunity | null {
  const request = row.referral_service_requests;
  if (!request) return null;
  const intake = request.intake ?? {};
  const consent = request.consent ?? {};
  const inboxRow: ImmigrationInboxRow = {
    id: request.id,
    leadId: request.lead_id,
    leadName: request.leads?.full_name || "Cliente",
    channelUserId: request.leads?.channel_user_id ?? null,
    topic: optionalText(intake.topic),
    description: optionalText(intake.description),
    postalCode: request.postal_code ?? optionalText(intake.postal_code),
    consentStatus: normalizeImmigrationConsent(consent),
    consentVersion: optionalText((consent as { version?: unknown }).version),
    consentCapturedAt: optionalText((consent as { captured_at?: unknown }).captured_at),
    intakeComplete: request.intake_complete === true,
    status: request.status,
    caseCycle: request.case_cycle ?? 1,
    createdAt: request.created_at,
  };
  return resolveImmigrationOpportunity(inboxRow, {
    id: row.id,
    status: row.status,
    workStatus: row.work_status,
    assignedAt: row.assigned_at,
    updatedAt: row.updated_at,
    partnerName: null,
  });
}

function usePartnerReferrals(partnerId: string) {
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) { setLoading(true); setError(""); }
    const result = await supabase
      .from("referral_assignments")
      .select("id,request_id,partner_id,status,work_status,assigned_at,updated_at,follow_up_reason,next_followup_at,follow_up_attempt_count,referral_service_requests!inner(id,lead_id,service_id,postal_code,intake,consent,intake_complete,status,case_cycle,created_at,leads(full_name,phone,channel_user_id))")
      .eq("partner_id", partnerId)
      .in("status", ["assigned", "accepted"])
      .order("assigned_at", { ascending: false });
    if (result.error) {
      if (!silent) { setError("No se pudieron cargar las referencias asignadas."); setRows([]); }
    } else {
      setRows((result.data ?? []) as unknown as AssignmentRow[]);
    }
    if (!silent) setLoading(false);
  }, [partnerId]);

  useEffect(() => { void load(); }, [load]);
  useSilentPolling(() => load({ silent: true }), 2500);
  return { rows, loading, error, load };
}

function useActivePartnerMembership(): { status: "loading" } | { status: "resolved"; context: ActivePartnerContext } {
  const [state, setState] = useState<{ status: "loading" } | { status: "resolved"; context: ActivePartnerContext }>({ status: "loading" });
  useEffect(() => {
    let mounted = true;
    (async () => {
      const result = await supabase.from("referral_partner_memberships").select("partner_id, role").eq("active", true);
      if (!mounted) return;
      const memberships = (result.error ? [] : result.data ?? []) as { partner_id: string; role: string }[];
      setState({ status: "resolved", context: resolveActivePartnerContext(memberships) });
    })();
    return () => { mounted = false; };
  }, []);
  return state;
}

function referralPresentation(row: AssignmentRow, opportunity: ImmigrationOpportunity) {
  const intake = row.referral_service_requests?.intake ?? {};
  const service = resolvePartnerReferralService(row.referral_service_requests?.service_id, intake);
  const topicKey = resolveSummaryTopicKey(intake);
  const incidentDateFact = resolveIncidentDateFact(service, intake);
  return {
    service,
    topic: resolveTopicDisplay(opportunity.topic, service),
    summary: buildIntakeSummary(intake, topicKey),
    sharedInfoSummary: buildIntakeSummary(intake, topicKey, { omitIncidentDate: Boolean(incidentDateFact) }),
    description: intakeDescription(intake) ?? opportunity.description,
    incidentDateFact,
    humanSummary: buildHumanSummary({
      leadName: opportunity.leadName,
      service,
      topicKey,
      intake,
      consentStatus: null,
      includeIncidentDate: false,
    }),
  };
}

type PartnerListEntry = {
  row: AssignmentRow;
  opportunity: ImmigrationOpportunity;
  queueStatus: PartnerQueueStatus;
  overdue: boolean;
  service: LegalService;
};

function followUpSummary(row: AssignmentRow, overdue: boolean): string {
  const reason = row.follow_up_reason ? FOLLOW_UP_REASON_LABEL[row.follow_up_reason as FollowUpReason] ?? row.follow_up_reason : "Seguimiento";
  if (overdue) return `${reason} · Vencido`;
  return `${reason} · ${formatFollowUpMoment(row.next_followup_at)}`;
}

function partnerExportRows(entries: PartnerListEntry[]): PartnerExportRow[] {
  return entries.map(({ row, opportunity, queueStatus, overdue, service }) => {
    const phone = resolvePartnerPhone(row.referral_service_requests?.leads?.phone, row.referral_service_requests?.leads?.channel_user_id);
    return {
      estado: overdue ? "Seguimiento vencido" : QUEUE_STATUS_LABEL[queueStatus],
      cliente: opportunity.leadName,
      servicio: referralServiceLabel(service),
      telefono: formatPhoneForDisplay(phone) || "",
      zip: opportunity.postalCode || "",
      recibido: formatDateTime(opportunity.assignment!.assignedAt),
      antiguedad: formatLeadAge(opportunity.assignment!.assignedAt),
      proximoSeguimiento: queueStatus === "follow_up" ? followUpSummary(row, overdue) : "",
    };
  });
}

function downloadPartnerExport(entries: PartnerListEntry[], format: "csv" | "xlsx"): void {
  const rows = partnerExportRows(entries);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `conexxion-mi-trabajo-${dateStamp}.${format}`;
  let blob: Blob;
  if (format === "csv") {
    blob = new Blob([buildPartnerCsv(rows)], { type: "text/csv;charset=utf-8" });
  } else {
    const xlsx = buildPartnerXlsx(rows);
    const bytes = xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer;
    blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function openOnKeyboard(event: React.KeyboardEvent, open: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    open();
  }
}

function ServiceBadge({ service }: { service: LegalService }) {
  return <span className={`partner-modern-service is-${service}`}><span aria-hidden="true">{SERVICE_ICON[service]}</span>{referralServiceLabel(service)}</span>;
}

function PartnerMobileCard({ row, opportunity, queueStatus, overdue, service }: PartnerListEntry) {
  const navigate = useNavigate();
  const presentation = referralPresentation(row, opportunity);
  const phone = resolvePartnerPhone(row.referral_service_requests?.leads?.phone, row.referral_service_requests?.leads?.channel_user_id);
  const telLink = buildTelLink(phone);
  const path = `referrals/${opportunity.assignment!.id}`;
  const open = () => navigate(path);
  return (
    <article className="partner-modern-card" role="link" tabIndex={0} onClick={open} onKeyDown={(event) => openOnKeyboard(event, open)}>
      <div className="partner-modern-card-top">
        <div className="partner-modern-card-identity">
          <strong>{opportunity.leadName}</strong>
          <div className="partner-modern-badge-row">
            <ServiceBadge service={service} />
            <span className={`partner-status is-${queueStatusTone(queueStatus, overdue)}`}>{overdue ? "Seguimiento vencido" : QUEUE_STATUS_LABEL[queueStatus]}</span>
          </div>
        </div>
        <div className="partner-modern-age"><strong>{formatLeadAge(opportunity.assignment!.assignedAt)}</strong><span>en cola</span></div>
      </div>

      <div className="partner-modern-card-times">
        {presentation.incidentDateFact ? <div><span>{presentation.incidentDateFact.label}</span><strong>{presentation.incidentDateFact.value}</strong></div> : null}
        <div><span>Recibido</span><strong>{formatRelative(opportunity.assignment!.assignedAt)}</strong></div>
      </div>

      {queueStatus === "follow_up"
        ? <p className="partner-modern-card-summary">{followUpSummary(row, overdue)}</p>
        : presentation.sharedInfoSummary
          ? <p className="partner-modern-card-summary">{presentation.sharedInfoSummary}</p>
          : null}

      <div className="partner-modern-card-footer">
        {telLink ? <a className="partner-modern-call" href={telLink} onClick={(event) => event.stopPropagation()}>Llamar</a> : <span className="partner-modern-no-phone">Sin teléfono</span>}
        <span className="partner-modern-open">Ver caso <span aria-hidden="true">→</span></span>
      </div>
    </article>
  );
}

function PartnerDesktopTable({ entries }: { entries: PartnerListEntry[] }) {
  const navigate = useNavigate();
  return (
    <div className="partner-modern-table-wrap">
      <table className="partner-modern-table">
        <thead>
          <tr>
            <th>Estado</th>
            <th>Cliente</th>
            <th>Servicio</th>
            <th>Fecha del incidente</th>
            <th>Recibido</th>
            <th>Edad del caso</th>
            <th>Teléfono</th>
            <th>Próximo seguimiento</th>
            <th aria-label="Abrir caso" />
          </tr>
        </thead>
        <tbody>
          {entries.map(({ row, opportunity, queueStatus, overdue, service }) => {
            const presentation = referralPresentation(row, opportunity);
            const phone = resolvePartnerPhone(row.referral_service_requests?.leads?.phone, row.referral_service_requests?.leads?.channel_user_id);
            const telLink = buildTelLink(phone);
            const path = `referrals/${opportunity.assignment!.id}`;
            const open = () => navigate(path);
            return (
              <tr key={row.id} role="link" tabIndex={0} onClick={open} onKeyDown={(event) => openOnKeyboard(event, open)}>
                <td><span className={`partner-status is-${queueStatusTone(queueStatus, overdue)}`}>{overdue ? "Vencido" : QUEUE_STATUS_LABEL[queueStatus]}</span></td>
                <td><strong className="partner-modern-client">{opportunity.leadName}</strong></td>
                <td><ServiceBadge service={service} /></td>
                <td className="partner-modern-incident">{presentation.incidentDateFact?.value ?? "—"}</td>
                <td className="partner-modern-muted">{formatDateTime(opportunity.assignment!.assignedAt)}</td>
                <td><strong>{formatLeadAge(opportunity.assignment!.assignedAt)}</strong></td>
                <td>{telLink ? <a className="partner-modern-phone" href={telLink} onClick={(event) => event.stopPropagation()}>{formatPhoneForDisplay(phone)}</a> : <span className="partner-modern-muted">No disponible</span>}</td>
                <td className="partner-modern-followup">{queueStatus === "follow_up" ? followUpSummary(row, overdue) : "—"}</td>
                <td className="partner-modern-chevron" aria-hidden="true">→</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PartnerList({ partnerId }: { partnerId: string }) {
  const { rows, loading, error } = usePartnerReferrals(partnerId);
  const [statusFilter, setStatusFilter] = useState<PartnerStatusFilter>("all");
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all");

  const entries = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const opportunities = rows.map(toOpportunity).filter((opportunity): opportunity is ImmigrationOpportunity => opportunity !== null);
    return sortPartnerQueue(opportunities.map((opportunity) => {
      const row = byId.get(opportunity.assignment!.id)!;
      return { opportunity, row, id: row.id, status: row.status, workStatus: row.work_status, assignedAt: row.assigned_at, updatedAt: row.updated_at, nextFollowupAt: row.next_followup_at };
    }))
      .map((entry): PartnerListEntry | null => {
        const intake = entry.row.referral_service_requests?.intake ?? {};
        const service = resolvePartnerReferralService(entry.row.referral_service_requests?.service_id, intake);
        if (!isLegalService(service)) return null;
        return { ...entry, service, queueStatus: resolvePartnerQueueStatus(entry), overdue: isFollowUpOverdue(entry) };
      })
      .filter((entry): entry is PartnerListEntry => entry !== null);
  }, [rows]);

  const filtered = useMemo(() => entries.filter((entry) => {
    const statusMatches = statusFilter === "all" || entry.queueStatus === statusFilter;
    const serviceMatches = serviceFilter === "all" || entry.service === serviceFilter;
    return statusMatches && serviceMatches;
  }), [entries, statusFilter, serviceFilter]);

  const overdueCount = useMemo(() => entries.filter((entry) => entry.overdue).length, [entries]);
  const newCount = useMemo(() => entries.filter((entry) => entry.queueStatus === "new").length, [entries]);
  const followUpCount = useMemo(() => entries.filter((entry) => entry.queueStatus === "follow_up").length, [entries]);
  const hasFilters = statusFilter !== "all" || serviceFilter !== "all";

  if (loading) return <p className="partner-empty partner-loading">Cargando referencias…</p>;
  if (error) return <p className="partner-empty partner-loading">{error}</p>;

  return (
    <div className="partner-view partner-modern-view">
      <div className="partner-modern-page-head">
        <div><h1>Mi trabajo</h1><p>Referencias asignadas para contactar y dar seguimiento.</p></div>
        <details className="partner-modern-export">
          <summary>Exportar</summary>
          <div>
            <button type="button" disabled={filtered.length === 0} onClick={() => downloadPartnerExport(filtered, "xlsx")}>Excel (.xlsx)</button>
            <button type="button" disabled={filtered.length === 0} onClick={() => downloadPartnerExport(filtered, "csv")}>CSV</button>
          </div>
        </details>
      </div>

      <div className="partner-modern-summary" aria-label="Resumen de trabajo">
        <div><strong>{newCount}</strong><span>Nuevos</span></div>
        <div><strong>{followUpCount}</strong><span>Seguimientos</span></div>
        <div className={overdueCount > 0 ? "is-overdue" : ""}><strong>{overdueCount}</strong><span>Vencidos</span></div>
      </div>

      <div className="partner-modern-toolbar">
        <div className="partner-modern-status-scroll" role="tablist" aria-label="Filtrar por estado">
          {([{ id: "all", label: "Todos" }, { id: "new", label: "Nuevos" }, { id: "follow_up", label: "Seguimiento" }, { id: "approved", label: "Aprobados" }, { id: "disqualified", label: "No calificó" }] as Array<{ id: PartnerStatusFilter; label: string }>).map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={statusFilter === tab.id} className={`partner-filter-btn${statusFilter === tab.id ? ` is-active is-${tab.id}` : ""}`} onClick={() => setStatusFilter(tab.id)}>{tab.label}</button>
          ))}
        </div>
        <label className="partner-modern-service-filter">
          <span>Servicio</span>
          <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value as ServiceFilter)}>
            {SERVICE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <div className="partner-modern-result-bar">
        <span><strong>{filtered.length}</strong> {filtered.length === 1 ? "caso" : "casos"}</span>
        {hasFilters ? <button type="button" onClick={() => { setStatusFilter("all"); setServiceFilter("all"); }}>Limpiar filtros</button> : null}
      </div>

      {filtered.length === 0 ? (
        <div className="partner-empty-state"><p>No hay referencias con estos filtros.</p><p className="partner-empty-sub">Cambia el estado o servicio para ver otros casos.</p></div>
      ) : (
        <>
          <PartnerDesktopTable entries={filtered} />
          <div className="partner-modern-mobile">{filtered.map((entry) => <PartnerMobileCard key={entry.row.id} {...entry} />)}</div>
        </>
      )}
    </div>
  );
}

function PartnerDetail({ partnerId }: { partnerId: string }) {
  const { assignmentId = "" } = useParams();
  const { rows, loading, error, load } = usePartnerReferrals(partnerId);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpReason, setFollowUpReason] = useState<FollowUpReason>("no_answer");
  const [reminderOption, setReminderOption] = useState<ReminderOptionId>(defaultReminderOptionForReason("no_answer"));
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("");
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionReason, setCorrectionReason] = useState<CorrectionReason>("marked_by_mistake");
  const [correctionNote, setCorrectionNote] = useState("");

  const row = rows.find((candidate) => candidate.id === assignmentId) ?? null;
  const opportunity = row ? toOpportunity(row) : null;

  const selectFollowUpReason = useCallback((reason: FollowUpReason) => {
    setFollowUpReason(reason);
    setReminderOption(defaultReminderOptionForReason(reason));
    setCustomDate("");
    setCustomTime("");
  }, []);

  const cancelFollowUp = useCallback(() => {
    setShowFollowUp(false);
    selectFollowUpReason("no_answer");
  }, [selectFollowUpReason]);

  const runAction = useCallback(async (action: PartnerAction) => {
    if (!row || busy) return;
    setBusy(true);
    setFeedback(null);
    const steps = planPartnerActionSteps(action, row.status);
    const finalNote = resolveActionNote(action, note);
    for (let index = 0; index < steps.length; index += 1) {
      const isFinalStep = index === steps.length - 1;
      const result = await supabase.rpc("partner_update_referral_assignment", { p_assignment_id: assignmentId, p_action: steps[index], p_note: isFinalStep ? finalNote : null, p_appointment_at: null });
      if (result.error) {
        setBusy(false);
        setFeedback({ tone: "error", text: "No se pudo registrar la acción. Intenta de nuevo." });
        return;
      }
    }
    setBusy(false);
    setNote("");
    setFeedback({ tone: "success", text: ACTION_FEEDBACK[action] });
    await load({ silent: true });
  }, [row, busy, assignmentId, note, load]);

  const runCorrection = useCallback(async () => {
    if (!row || busy || !canCorrectFinalResult(row.work_status)) return;
    if (!correctionNoteIsValid(correctionReason, correctionNote)) {
      setFeedback({ tone: "error", text: "Escribe una nota para explicar la corrección." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await supabase.rpc("partner_update_referral_assignment", { p_assignment_id: row.id, p_action: "correct_result", p_note: correctionNote.trim() || null, p_appointment_at: null, p_follow_up_reason: null, p_next_followup_at: null, p_correction_reason: correctionReason });
    if (result.error) {
      setBusy(false);
      setFeedback({ tone: "error", text: "No se pudo corregir el resultado. Intenta de nuevo." });
      return;
    }
    setCorrectionNote("");
    setShowCorrection(false);
    setBusy(false);
    setFeedback({ tone: "success", text: "Resultado corregido. El caso requiere nueva revisión." });
    await load({ silent: true });
  }, [row, busy, correctionReason, correctionNote, load]);

  const customCombined = combineCustomDateTime(customDate, customTime);
  const customReady = isCustomFollowUpReady(customCombined);
  const nextFollowupAtPreview = reminderOption === "custom" ? null : computeNextFollowupAt(reminderOption, new Date());

  const runFollowUp = useCallback(async () => {
    if (!row || busy) return;
    if (reminderOption === "custom" && !isCustomFollowUpReady(combineCustomDateTime(customDate, customTime))) return;
    const nextFollowupAt = computeNextFollowupAt(reminderOption, new Date(), reminderOption === "custom" ? combineCustomDateTime(customDate, customTime) : null);
    setBusy(true);
    setFeedback(null);
    const steps = planFollowUpSteps(row.status);
    const finalNote = note.trim() || null;
    for (let index = 0; index < steps.length; index += 1) {
      const isFinalStep = index === steps.length - 1;
      const result = await supabase.rpc("partner_update_referral_assignment", { p_assignment_id: assignmentId, p_action: steps[index], p_note: isFinalStep ? finalNote : null, p_appointment_at: null, p_follow_up_reason: isFinalStep ? followUpReason : null, p_next_followup_at: isFinalStep ? nextFollowupAt : null });
      if (result.error) {
        setBusy(false);
        setFeedback({ tone: "error", text: "No se pudo registrar el seguimiento. Intenta de nuevo." });
        return;
      }
    }
    setBusy(false);
    setNote("");
    setShowFollowUp(false);
    setFeedback({ tone: "success", text: "Seguimiento guardado." });
    await load({ silent: true });
  }, [row, busy, assignmentId, note, followUpReason, reminderOption, customDate, customTime, load]);

  if (loading) return <p className="partner-empty partner-loading">Cargando…</p>;
  if (error || !opportunity || !row) return <p className="partner-empty partner-loading">La referencia no está disponible.</p>;

  const presentation = referralPresentation(row, opportunity);
  if (!isLegalService(presentation.service)) return <p className="partner-empty partner-loading">Este servicio no está disponible en este portal.</p>;

  const phone = resolvePartnerPhone(row.referral_service_requests?.leads?.phone, row.referral_service_requests?.leads?.channel_user_id);
  const telLink = buildTelLink(phone);
  const queueStatus = resolvePartnerQueueStatus({ status: row.status, workStatus: row.work_status });
  const overdue = queueStatus === "follow_up" && isFollowUpOverdue({ id: row.id, status: row.status, workStatus: row.work_status, assignedAt: row.assigned_at, updatedAt: row.updated_at, nextFollowupAt: row.next_followup_at });
  const queueTone = queueStatusTone(queueStatus, overdue);
  const hasConsent = Object.keys(row.referral_service_requests?.consent ?? {}).length > 0;

  return (
    <div className="partner-view partner-modern-detail">
      <Link className="partner-back" to="/partner/app">← Mi trabajo</Link>

      <header className="partner-modern-detail-hero">
        <div className="partner-modern-detail-main">
          <div className="partner-modern-badge-row"><ServiceBadge service={presentation.service} /><span className={`partner-status is-${queueTone}`}>{overdue ? "Seguimiento vencido" : QUEUE_STATUS_LABEL[queueStatus]}</span></div>
          <h1>{opportunity.leadName}</h1>
          {presentation.topic ? <p>{presentation.topic}</p> : null}
        </div>
        <div className="partner-modern-detail-age"><span>Edad del caso</span><strong>{formatLeadAge(opportunity.assignment!.assignedAt)}</strong><small>Recibido {formatRelative(opportunity.assignment!.assignedAt)}</small></div>
      </header>

      {feedback ? <div className={`partner-feedback is-${feedback.tone}`}>{feedback.text}</div> : null}

      <div className="partner-modern-detail-grid">
        <section className="partner-modern-panel partner-modern-story">
          <div className="partner-modern-section-label">Qué pasó</div>
          <p>{presentation.humanSummary}</p>
          {queueStatus === "follow_up" ? <div className={`partner-modern-followup-banner${overdue ? " is-overdue" : ""}`}>{followUpSummary(row, overdue)}</div> : null}
        </section>

        <section className="partner-modern-panel partner-modern-keyfacts">
          <div className="partner-modern-section-label">Datos clave</div>
          <dl>
            {presentation.incidentDateFact ? <div><dt>{presentation.incidentDateFact.label}</dt><dd>{presentation.incidentDateFact.value}</dd></div> : null}
            <div><dt>Recibido</dt><dd>{formatDateTime(opportunity.assignment!.assignedAt)}</dd></div>
            <div><dt>Edad del caso</dt><dd>{formatLeadAge(opportunity.assignment!.assignedAt)}</dd></div>
            <div><dt>Teléfono</dt><dd>{formatPhoneForDisplay(phone) || "No disponible"}</dd></div>
            <div><dt>ZIP</dt><dd>{opportunity.postalCode || "No disponible"}</dd></div>
            {hasConsent ? <div><dt>Autorizado para contacto</dt><dd>{opportunity.consentStatus === "authorized" ? "Sí" : opportunity.consentStatus === "declined" ? "No" : "Pendiente"}</dd></div> : null}
          </dl>
        </section>
      </div>

      <section className="partner-modern-call-panel">
        <div><strong>Contactar a {opportunity.leadName}</strong><span>{formatPhoneForDisplay(phone) || "Teléfono no disponible"}</span></div>
        <a href={telLink ?? "#"} aria-disabled={!telLink} onClick={(event) => { if (!telLink) event.preventDefault(); }}>Llamar</a>
      </section>

      <section className="partner-modern-panel partner-modern-management">
        <div className="partner-modern-management-head"><div><div className="partner-modern-section-label">Registrar gestión</div><h2>{canCorrectFinalResult(row.work_status) ? "Resultado actual" : "¿Qué pasó con esta llamada?"}</h2></div></div>

        {canCorrectFinalResult(row.work_status) ? (
          <>
            <p className="partner-modern-closed-note">{queueStatus === "approved" ? "Caso aprobado. No requiere más acciones." : "Caso marcado como no calificó."}</p>
            <button type="button" className="partner-action-btn is-tertiary" disabled={busy} onClick={() => setShowCorrection((visible) => !visible)}>Corregir resultado</button>
            {showCorrection ? (
              <div className="partner-followup-panel">
                <div className="partner-note-field"><label htmlFor="partner-correction-reason">Motivo</label><select id="partner-correction-reason" className="partner-input" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value as CorrectionReason)}>{(Object.keys(CORRECTION_REASON_LABEL) as CorrectionReason[]).map((reason) => <option key={reason} value={reason}>{CORRECTION_REASON_LABEL[reason]}</option>)}</select></div>
                <div className="partner-note-field"><label htmlFor="partner-correction-note">{correctionReason === "other" ? "Nota (requerida)" : "Nota (opcional)"}</label><textarea id="partner-correction-note" className="partner-textarea" value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} placeholder="Explica la corrección" /></div>
                <div className="partner-action-row"><button type="button" className="partner-action-btn is-tertiary" disabled={busy} onClick={() => setShowCorrection(false)}>Cancelar</button><button type="button" className="partner-action-btn is-secondary" disabled={busy || !correctionNoteIsValid(correctionReason, correctionNote)} onClick={() => void runCorrection()}>Corregir resultado</button></div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="partner-modern-outcome-grid">
              <button type="button" disabled={busy} className="partner-action-btn is-approve" onClick={() => void runAction("converted")}>Aprobado</button>
              <button type="button" disabled={busy} className="partner-action-btn is-followup" onClick={() => setShowFollowUp((visible) => { if (!visible) selectFollowUpReason(followUpReason); return !visible; })}>Seguimiento</button>
              <button type="button" disabled={busy} className="partner-action-btn is-disqualify" onClick={() => void runAction("closed_not_converted")}>No calificó</button>
            </div>

            {showFollowUp ? (
              <div className="partner-modern-followup-editor">
                <div className="partner-note-field"><label htmlFor="partner-follow-up-reason">Motivo</label><select id="partner-follow-up-reason" className="partner-input" value={followUpReason} onChange={(event) => selectFollowUpReason(event.target.value as FollowUpReason)}>{followUpReasonsForService(presentation.service).map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}</select></div>
                <div className="partner-note-field"><label>Recordatorio</label><div className="partner-reminder-row">{reminderOptionsForReason(followUpReason).map((option) => <button key={option.id} type="button" disabled={busy} className={`partner-filter-btn${reminderOption === option.id ? " is-active" : ""}`} onClick={() => setReminderOption(option.id)}>{option.label}</button>)}</div>
                  {reminderOption === "custom" ? <div className="partner-custom-datetime"><div className="partner-custom-field"><label htmlFor="partner-followup-date">Fecha</label><input type="date" id="partner-followup-date" className="partner-input" min={todayDateInputValue()} value={customDate} onChange={(event) => setCustomDate(event.target.value)} /></div><div className="partner-custom-field"><label htmlFor="partner-followup-time">Hora</label><input type="time" id="partner-followup-time" className="partner-input" min={customDate === todayDateInputValue() ? nowTimeInputValue() : undefined} value={customTime} onChange={(event) => setCustomTime(event.target.value)} /></div></div> : null}
                  <p className="partner-followup-preview">Próximo seguimiento: {reminderOption === "custom" ? (customReady && customCombined ? formatCustomFollowUpPreview(customCombined) : "Selecciona fecha y hora") : formatFollowUpMoment(nextFollowupAtPreview)}</p>
                </div>
              </div>
            ) : null}

            <div className="partner-note-field"><label htmlFor="partner-note">Nota opcional</label><textarea id="partner-note" className="partner-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ej: devolví la llamada, agendamos para el jueves…" /></div>

            {showFollowUp ? <div className="partner-action-row partner-modern-save-row"><button type="button" disabled={busy} className="partner-action-btn is-tertiary" onClick={cancelFollowUp}>Cancelar</button><button type="button" disabled={busy || (reminderOption === "custom" && !customReady)} className="partner-action-btn is-primary" onClick={() => void runFollowUp()}>Guardar seguimiento</button></div> : null}
          </>
        )}
      </section>
    </div>
  );
}

export function Shell() {
  const { user, signOut } = useAuth();
  const membership = useActivePartnerMembership();
  return (
    <main className="partner-portal partner-app partner-modern-app">
      <div className="partner-shell">
        <header className="partner-topbar partner-modern-topbar">
          <div className="partner-brand"><span className="partner-brand-name">ConeXXion</span><span className="partner-brand-tag">Portal de referencias</span></div>
          <div className="partner-topbar-user"><span className="partner-user-email">{user?.email}</span><button type="button" className="partner-signout" onClick={() => void signOut()}>Salir</button></div>
        </header>
        <div className="partner-content">
          {membership.status === "loading" ? <p className="partner-empty partner-loading">Cargando…</p>
            : membership.context.kind === "none" ? <p className="partner-empty" role="alert">Tu cuenta no tiene acceso activo a ningún aliado en este portal.</p>
              : membership.context.kind === "multiple" ? <p className="partner-empty" role="alert">Tu cuenta tiene acceso activo a más de un aliado. Contacta a soporte para resolver tu acceso.</p>
                : <Routes><Route index element={<PartnerList partnerId={membership.context.partnerId} />} /><Route path="referrals/:assignmentId" element={<PartnerDetail partnerId={membership.context.partnerId} />} /></Routes>}
        </div>
      </div>
    </main>
  );
}
