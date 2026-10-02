import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { normalizeImmigrationConsent, type ImmigrationInboxRow } from "../referral-hub/operations/immigrationInbox";
import { resolveImmigrationOpportunity, type ImmigrationOpportunity } from "../referral-hub/operations/immigrationOpportunities";
import { buildTelLink, formatPhoneForDisplay, planFollowUpSteps, planPartnerActionSteps, resolveActionNote, resolvePartnerPhone, type PartnerAction } from "./partnerActions";
import { buildHumanSummary, buildIntakeSummary, intakeDescription, referralServiceLabel, resolveIncidentDateFact, resolveSummaryTopicKey, resolveTopicDisplay } from "./referralPresentation";
import { resolveActivePartnerContext, type ActivePartnerContext } from "./partnerMembership";
import { resolvePartnerReferralService } from "./partnerReferralVisibility";
import { useSilentPolling } from "../../hooks/useSilentPolling";
import {
  combineCustomDateTime,
  computeNextFollowupAt,
  countOverdueFollowUps,
  defaultReminderOptionForReason,
  followUpReasonsForService,
  formatCustomFollowUpPreview,
  formatFollowUpMoment,
  isCustomFollowUpReady,
  isFollowUpOverdue,
  QUEUE_STATUS_LABEL,
  FOLLOW_UP_REASON_LABEL,
  nowTimeInputValue,
  reminderOptionsForReason,
  resolvePartnerQueueStatus,
  sortPartnerQueue,
  todayDateInputValue,
  type FollowUpReason,
  type PartnerQueueStatus,
  type PartnerStatusFilter,
  type ReminderOptionId,
} from "./partnerQueue";
import { CORRECTION_REASON_LABEL, canCorrectFinalResult, correctionNoteIsValid, type CorrectionReason } from "./finalStateCorrection";

// Visual Phase 1B (work-queue redesign) — see PartnerList/PartnerDetail below.
// Every field used here already exists on ImmigrationOpportunity/AssignmentRow;
// nothing new is fetched or computed server-side.

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

const ACTION_FEEDBACK: Record<PartnerAction, string> = {
  contacted: "Registrado: contactaste a este cliente.",
  no_answer: "Registrado: intento de contacto sin respuesta.",
  pending: "Marcado como pendiente de seguimiento.",
  appointment_scheduled: "Cita registrada.",
  converted: "Caso marcado como convertido.",
  closed_not_converted: "Caso cerrado sin conversión.",
};

// Canonical status color semantics live entirely in CSS
// (.partner-status.is-new/is-follow_up/is-approved/is-disqualified/
// is-overdue) — PartnerQueueStatus's own values are already the class
// suffix, so no separate tone-mapping table to keep in sync.
function queueStatusTone(status: PartnerQueueStatus, overdue: boolean): string {
  return overdue ? "overdue" : status;
}

function reportPartnerOutcomeFailure(error: { status?: number; code?: string; message?: string; details?: string | null; hint?: string | null }) {
  // Temporary, token-free browser diagnostic for the live 403 investigation.
  console.warn("Partner outcome RPC rejected", {
    status: error.status ?? null,
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  });
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(date);
}

// "Recibido" is an instant (assigned_at), not a date-only value like
// accident_date/dui_date — showing only the date hides which of several
// same-day cases came in first. Browser-local time, same as formatRelative
// below; no organization-timezone architecture introduced here.
function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  const time = new Intl.DateTimeFormat("es-US", { hour: "numeric", minute: "2-digit" }).format(date);
  return `${formatDate(value)} · ${time}`;
}

// "Asignado hoy, 3:42 p.m." / "ayer, …" / a short date beyond that — purely
// a presentation choice over the existing assignedAt/createdAt timestamps.
function formatRelative(value: string | null | undefined): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  const time = new Intl.DateTimeFormat("es-US", { hour: "numeric", minute: "2-digit" }).format(date);
  if (diffDays === 0) return `hoy, ${time}`;
  if (diffDays === 1) return `ayer, ${time}`;
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(date);
}

// Builds the same canonical ImmigrationOpportunity Admin uses, from a
// referral_assignments row queried from the partner's side — so both sides
// of the P0 (Admin Immigration and Partner Dashboard) read the operational
// status through one shared derivation, never two.
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

// Explicit partner_id filter, not a bare table scan left to RLS alone:
// referral_assignments' own RLS also grants org owner/admin (see
// referral_assignments_member_read) — deliberately, for Admin's own
// organization-wide views — so without this filter a user who is BOTH an
// org owner and a partner member would see every partner's assignments
// merged in the Partner Portal. This .eq() is what actually scopes the
// Partner Portal to the resolved partner, independent of what else RLS
// would otherwise allow the caller to read.
function usePartnerReferrals(partnerId: string) {
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // silent=true is used by background polling: never shows the big loading
  // state, and a failed silent refresh keeps whatever is already on screen
  // instead of clearing it.
  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) { setLoading(true); setError(""); }
    const result = await supabase
      .from("referral_assignments")
      .select(
        "id,request_id,partner_id,status,work_status,assigned_at,updated_at,follow_up_reason,next_followup_at,follow_up_attempt_count,referral_service_requests!inner(id,lead_id,service_id,postal_code,intake,consent,intake_complete,status,case_cycle,created_at,leads(full_name,phone,channel_user_id))",
      )
      .eq("partner_id", partnerId)
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

// Resolves the Partner Portal's explicit partner context up front, from the
// caller's own active referral_partner_memberships rows (RLS already scopes
// that table to user_id = auth.uid() AND active — see
// referral_partner_memberships_self_read). Fails closed rather than merging
// when the membership count isn't exactly one; see resolveActivePartnerContext.
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

export function PartnerLogin() {
  const { session, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/partner/app" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const failure = await signIn(email, password);
    setBusy(false);
    if (failure) setError("No pudimos iniciar sesión. Verifica tu correo y contraseña.");
    else navigate("/partner/app");
  };

  return (
    <main className="partner-portal partner-app partner-auth">
      <div className="partner-auth-card">
        <span className="partner-brand-name">ConeXXion</span>
        <p className="partner-brand-tag">Portal de referencias</p>
        <h1>Portal de referencias</h1>
        <p className="partner-empty">Accede sólo a las referencias asignadas a tu despacho.</p>
        <form onSubmit={submit} className="partner-form">
          <input className="partner-input" type="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="partner-input" type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error ? <div className="partner-feedback is-error">{error}</div> : null}
          <button type="submit" disabled={busy} className="partner-submit">
            {busy ? "Entrando…" : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </main>
  );
}

export function RequirePartner({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) return <main className="partner-portal partner-app"><p className="partner-empty partner-loading">Cargando…</p></main>;
  return session ? children : <Navigate to="/partner/login" replace />;
}

export function Shell() {
  const { user, signOut } = useAuth();
  const membership = useActivePartnerMembership();
  return (
    <main className="partner-portal partner-app">
      <div className="partner-shell">
        <header className="partner-topbar">
          <div className="partner-brand">
            <span className="partner-brand-name">ConeXXion</span>
            <span className="partner-brand-tag">Portal de referencias</span>
          </div>
          <div className="partner-topbar-user">
            <span className="partner-user-email">{user?.email}</span>
            <button type="button" className="partner-signout" onClick={() => void signOut()}>Salir</button>
          </div>
        </header>
        <div className="partner-content">
          {membership.status === "loading" ? (
            <p className="partner-empty partner-loading">Cargando…</p>
          ) : membership.context.kind === "none" ? (
            <p className="partner-empty" role="alert">
              Tu cuenta no tiene acceso activo a ningún aliado en este portal. Contacta a soporte para configurar tu acceso.
            </p>
          ) : membership.context.kind === "multiple" ? (
            <p className="partner-empty" role="alert">
              Tu cuenta tiene acceso activo a más de un aliado. Para evitar mostrar información mezclada, contacta a soporte para resolver tu acceso antes de continuar.
            </p>
          ) : (
            <Routes>
              <Route index element={<PartnerList partnerId={membership.context.partnerId} />} />
              <Route path="referrals/:assignmentId" element={<PartnerDetail partnerId={membership.context.partnerId} />} />
            </Routes>
          )}
        </div>
      </div>
    </main>
  );
}

function referralPresentation(row: AssignmentRow, opportunity: ImmigrationOpportunity) {
  const intake = row.referral_service_requests?.intake ?? {};
  const service = resolvePartnerReferralService(row.referral_service_requests?.service_id, intake);
  const topicKey = resolveSummaryTopicKey(intake);
  const incidentDateFact = resolveIncidentDateFact(service, intake);
  return {
    service,
    topic: resolveTopicDisplay(opportunity.topic, service),
    // Compact incident date stays in the list-card summary (no separate
    // field there to show it in). sharedInfoSummary is the detail-only
    // "Información compartida" variant, which omits it once the explicit
    // incidentDateFact field below is rendered — never stated twice.
    summary: buildIntakeSummary(intake, topicKey),
    sharedInfoSummary: buildIntakeSummary(intake, topicKey, { omitIncidentDate: Boolean(incidentDateFact) }),
    description: intakeDescription(intake) ?? opportunity.description,
    incidentDateFact,
    humanSummary: buildHumanSummary({
      leadName: opportunity.leadName,
      service,
      topicKey,
      intake,
      consentStatus: opportunity.consentStatus,
      // Already shown as its own labeled fact below when present — never
      // state the same incident date twice on the same card.
      includeIncidentDate: !incidentDateFact,
    }),
  };
}

function ReferralCard({ row, opportunity, queueStatus, overdue }: { row: AssignmentRow; opportunity: ImmigrationOpportunity; queueStatus: PartnerQueueStatus; overdue: boolean }) {
  const tone = queueStatusTone(queueStatus, overdue);
  const presentation = referralPresentation(row, opportunity);
  const phone = resolvePartnerPhone(row.referral_service_requests?.leads?.phone, row.referral_service_requests?.leads?.channel_user_id);
  const telLink = buildTelLink(phone);
  return (
    <Link to={`referrals/${opportunity.assignment!.id}`} className="partner-item">
      <div className="partner-item-main">
        <strong>{opportunity.leadName}</strong>
        <p className="partner-item-meta">{referralServiceLabel(presentation.service)}{presentation.topic ? ` · ${presentation.topic}` : ""}</p>
        {queueStatus === "follow_up" ? (
          <p className="partner-item-context">
            {row.follow_up_reason ? FOLLOW_UP_REASON_LABEL[row.follow_up_reason as FollowUpReason] ?? row.follow_up_reason : null}
            {row.follow_up_reason ? " · " : ""}
            {overdue ? "Seguimiento vencido" : `Próximo intento: ${formatFollowUpMoment(row.next_followup_at).toLowerCase()}`}
          </p>
        ) : presentation.summary ? <p className="partner-item-context">{presentation.summary}</p> : null}
        {presentation.description ? <p className="partner-item-summary">{presentation.description}</p> : null}
      </div>
      <div className="partner-item-side">
        <span className={`partner-status is-${tone}`}>{overdue ? "Seguimiento vencido" : QUEUE_STATUS_LABEL[queueStatus]}</span>
        {overdue && telLink ? (
          <a
            className="partner-call-now"
            href={telLink}
            onClick={(event) => event.stopPropagation()}
          >
            Llamar ahora
          </a>
        ) : (
          <p className="partner-item-time">Recibido {formatRelative(opportunity.assignment!.assignedAt)}</p>
        )}
      </div>
    </Link>
  );
}

function PartnerList({ partnerId }: { partnerId: string }) {
  const { rows, loading, error } = usePartnerReferrals(partnerId);
  const [statusFilter, setStatusFilter] = useState<PartnerStatusFilter>("all");
  const entries = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const opportunities = rows.map(toOpportunity).filter((opportunity): opportunity is ImmigrationOpportunity => opportunity !== null);
    return sortPartnerQueue(opportunities.map((opportunity) => {
      const row = byId.get(opportunity.assignment!.id)!;
      return {
        opportunity, row, id: row.id, status: row.status, workStatus: row.work_status,
        assignedAt: row.assigned_at, updatedAt: row.updated_at, nextFollowupAt: row.next_followup_at,
      };
    })).map((entry) => ({ ...entry, queueStatus: resolvePartnerQueueStatus(entry), overdue: isFollowUpOverdue(entry) }));
  }, [rows]);
  const filtered = useMemo(
    () => statusFilter === "all" ? entries : entries.filter((entry) => entry.queueStatus === statusFilter),
    [entries, statusFilter],
  );
  // The secretary must be able to see there's overdue work without opening
  // the Seguimiento filter chip — a header-level count, always visible.
  const overdueCount = useMemo(() => countOverdueFollowUps(entries), [entries]);

  if (loading) return <p className="partner-empty partner-loading">Cargando referencias…</p>;
  if (error) return <p className="partner-empty partner-loading">{error}</p>;

  return (
    <div className="partner-view">
      <div className="partner-page-head">
        <h1>Referencias</h1>
        <p>Personas que te hemos enviado para contactar.</p>
        {overdueCount > 0 ? (
          <p className="partner-overdue-counter" role="status">
            {overdueCount === 1 ? "1 seguimiento vencido" : `${overdueCount} seguimientos vencidos`}
          </p>
        ) : null}
      </div>

      <div className="partner-service-filter" role="tablist" aria-label="Filtrar por estado">
        {([{ id: "all", label: "Todos" }, { id: "new", label: "Nuevos" }, { id: "follow_up", label: "Seguimiento" }, { id: "approved", label: "Aprobados" }, { id: "disqualified", label: "No calificó" }] as Array<{ id: PartnerStatusFilter; label: string }>).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={statusFilter === tab.id}
            className={`partner-filter-btn${statusFilter === tab.id ? ` is-active is-${tab.id}` : ""}`}
            onClick={() => setStatusFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="partner-empty-state">
          <p>No hay referencias {statusFilter === "all" ? "pendientes" : "en esta categoría"}</p>
          <p className="partner-empty-sub">Las nuevas referencias aparecerán aquí automáticamente.</p>
        </div>
      ) : (
        <div className="partner-list">
          {filtered.map(({ row, opportunity, queueStatus, overdue }) => <ReferralCard key={row.id} row={row} opportunity={opportunity} queueStatus={queueStatus} overdue={overdue} />)}
        </div>
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
    const { data: authData } = await supabase.auth.getUser();
    console.info("Partner auth diagnostic", {
      user_id: authData.user?.id ?? null,
      assignment_id: row.id,
      request_id: row.request_id,
      partner_id: row.partner_id,
      action,
    });
    for (let index = 0; index < steps.length; index += 1) {
      const isFinalStep = index === steps.length - 1;
      const result = await supabase.rpc("partner_update_referral_assignment", {
        p_assignment_id: assignmentId,
        p_action: steps[index],
        p_note: isFinalStep ? finalNote : null,
        p_appointment_at: null,
      });
      if (result.error) {
        reportPartnerOutcomeFailure(result.error);
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
    const result = await supabase.rpc("partner_update_referral_assignment", {
      p_assignment_id: row.id,
      p_action: "correct_result",
      p_note: correctionNote.trim() || null,
      p_appointment_at: null,
      p_follow_up_reason: null,
      p_next_followup_at: null,
      p_correction_reason: correctionReason,
    });
    if (result.error) {
      reportPartnerOutcomeFailure(result.error);
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

  // Personalizado has its own combine/validity/preview path — it never goes
  // through "Sin recordatorio" (that phrase is reserved for the intentional
  // no-reminder preset) and is never treated as ready until both Fecha and
  // Hora are set to a moment that hasn't already passed.
  const customCombined = combineCustomDateTime(customDate, customTime);
  const customReady = isCustomFollowUpReady(customCombined);
  const nextFollowupAtPreview = reminderOption === "custom"
    ? null
    : computeNextFollowupAt(reminderOption, new Date());

  const runFollowUp = useCallback(async () => {
    if (!row || busy) return;
    if (reminderOption === "custom" && !isCustomFollowUpReady(combineCustomDateTime(customDate, customTime))) return;
    // Recomputed here (not read from the render-scoped preview above) so a
    // save triggered right as a minute rolls over still persists a value
    // consistent with what was just shown, not a stale closure.
    const nextFollowupAt = computeNextFollowupAt(
      reminderOption,
      new Date(),
      reminderOption === "custom" ? combineCustomDateTime(customDate, customTime) : null,
    );
    setBusy(true);
    setFeedback(null);
    const steps = planFollowUpSteps(row.status);
    const finalNote = note.trim() || null;
    for (let index = 0; index < steps.length; index += 1) {
      const isFinalStep = index === steps.length - 1;
      const result = await supabase.rpc("partner_update_referral_assignment", {
        p_assignment_id: assignmentId,
        p_action: steps[index],
        p_note: isFinalStep ? finalNote : null,
        p_appointment_at: null,
        p_follow_up_reason: isFinalStep ? followUpReason : null,
        p_next_followup_at: isFinalStep ? nextFollowupAt : null,
      });
      if (result.error) {
        reportPartnerOutcomeFailure(result.error);
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

  const phone = resolvePartnerPhone(row.referral_service_requests?.leads?.phone, row.referral_service_requests?.leads?.channel_user_id);
  const telLink = buildTelLink(phone);
  const presentation = referralPresentation(row, opportunity);
  const queueStatus = resolvePartnerQueueStatus({ status: row.status, workStatus: row.work_status });
  const overdue = queueStatus === "follow_up" && isFollowUpOverdue({
    id: row.id, status: row.status, workStatus: row.work_status,
    assignedAt: row.assigned_at, updatedAt: row.updated_at, nextFollowupAt: row.next_followup_at,
  });
  const queueTone = queueStatusTone(queueStatus, overdue);
  const hasConsent = Object.keys(row.referral_service_requests?.consent ?? {}).length > 0;

  return (
    <div className="partner-view">
      <Link className="partner-back" to="/partner/app">← Referencias</Link>

      <div className="partner-detail-head">
        <h1>{opportunity.leadName}</h1>
        <p className="partner-detail-meta">{referralServiceLabel(presentation.service)}{presentation.topic ? ` · ${presentation.topic}` : ""}</p>
        <span className={`partner-status is-${queueTone}`}>{overdue ? "Seguimiento vencido" : QUEUE_STATUS_LABEL[queueStatus]}</span>
        {queueStatus === "follow_up" ? (
          <p className="partner-followup-summary">
            {row.follow_up_reason ? (FOLLOW_UP_REASON_LABEL[row.follow_up_reason as FollowUpReason] ?? row.follow_up_reason) : "Seguimiento"}
            {" · "}
            {overdue ? "Volver a llamar" : `Próximo intento: ${formatFollowUpMoment(row.next_followup_at).toLowerCase()}`}
          </p>
        ) : null}
      </div>

      {feedback ? <div className={`partner-feedback is-${feedback.tone}`}>{feedback.text}</div> : null}

      {/* The call action is a rail item on wide screens, but CSS moves it
          before the lead context in the single-column mobile flow. */}
      <div className="partner-detail-columns">
        <div className="partner-detail-col-main">
          <section className="partner-block partner-block--flush"><h2>Resumen de la consulta</h2><p className="partner-summary-text">{presentation.humanSummary}</p></section>
          {presentation.sharedInfoSummary ? <section className="partner-block"><h2>Información compartida</h2><p className="partner-context-text">{presentation.sharedInfoSummary}</p></section> : null}
        </div>

        <div className="partner-detail-call">
          <div className="partner-contact-actions">
            <a
              className="is-call"
              href={telLink ?? "#"}
              aria-disabled={!telLink}
              onClick={(event) => { if (!telLink) event.preventDefault(); }}
            >
              Llamar
            </a>
          </div>
          <p className="partner-actions-hint">Llamar abre la aplicación de teléfono del dispositivo; no cambia el estado del caso.</p>
        </div>

        <div className="partner-detail-col-side">
          <section className="partner-block partner-block--flush">
            <h2>Datos</h2>
            <dl className="partner-facts">
              <div><dt>Teléfono</dt><dd>{formatPhoneForDisplay(phone) || "No disponible"}</dd></div>
              <div><dt>ZIP</dt><dd>{opportunity.postalCode || "No disponible"}</dd></div>
              {hasConsent ? <div><dt>Autorizado para contacto</dt><dd>{opportunity.consentStatus === "authorized" ? "Sí" : opportunity.consentStatus === "declined" ? "No" : "Pendiente de confirmar"}</dd></div> : null}
              {presentation.incidentDateFact ? <div><dt>{presentation.incidentDateFact.label}</dt><dd>{presentation.incidentDateFact.value}</dd></div> : null}
              <div><dt>Recibido</dt><dd>{formatDateTime(opportunity.assignment!.assignedAt)}</dd></div>
            </dl>
          </section>

          {canCorrectFinalResult(row.work_status) ? (
            <section className="partner-block">
              <h2>Resultado</h2>
              <p className="partner-closed-note">
                {queueStatus === "approved" ? "Caso aprobado. No requiere más acciones en este portal." : "Caso marcado como no calificó."}
              </p>
              <button type="button" className="partner-action-btn is-tertiary" disabled={busy} onClick={() => setShowCorrection((visible) => !visible)}>Corregir resultado</button>
              {showCorrection ? (
                <div className="partner-followup-panel">
                  <div className="partner-note-field">
                    <label htmlFor="partner-correction-reason">Motivo</label>
                    <select id="partner-correction-reason" className="partner-input" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value as CorrectionReason)}>
                      {(Object.keys(CORRECTION_REASON_LABEL) as CorrectionReason[]).map((reason) => <option key={reason} value={reason}>{CORRECTION_REASON_LABEL[reason]}</option>)}
                    </select>
                  </div>
                  <div className="partner-note-field">
                    <label htmlFor="partner-correction-note">{correctionReason === "other" ? "Nota (requerida)" : "Nota (opcional)"}</label>
                    <textarea id="partner-correction-note" className="partner-textarea" value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} placeholder="Explica la corrección" />
                    <p className="partner-note-hint">El caso volverá a Seguimiento. El cambio quedará registrado.</p>
                  </div>
                  <div className="partner-action-row">
                    <button type="button" className="partner-action-btn is-tertiary" disabled={busy} onClick={() => setShowCorrection(false)}>Cancelar</button>
                    <button type="button" className="partner-action-btn is-secondary" disabled={busy || !correctionNoteIsValid(correctionReason, correctionNote)} onClick={() => void runCorrection()}>Corregir resultado</button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <section className="partner-block">
              <h2>Resultado</h2>
              <p className="partner-action-title">Registra el resultado inicial de esta llamada.</p>
              <div className="partner-action-row">
                <button type="button" disabled={busy} className="partner-action-btn is-approve" onClick={() => void runAction("converted")}>Aprobado</button>
                <button
                  type="button"
                  disabled={busy}
                  className="partner-action-btn is-followup"
                  onClick={() => setShowFollowUp((visible) => {
                    if (!visible) selectFollowUpReason(followUpReason);
                    return !visible;
                  })}
                >
                  Seguimiento
                </button>
                <button type="button" disabled={busy} className="partner-action-btn is-disqualify" onClick={() => void runAction("closed_not_converted")}>No calificó</button>
              </div>

              {showFollowUp ? (
                <div className="partner-followup-panel">
                  <div className="partner-note-field">
                    <label htmlFor="partner-follow-up-reason">Motivo</label>
                    <select
                      id="partner-follow-up-reason"
                      className="partner-input"
                      value={followUpReason}
                      onChange={(event) => selectFollowUpReason(event.target.value as FollowUpReason)}
                    >
                      {followUpReasonsForService(presentation.service).map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
                    </select>
                  </div>

                  <div className="partner-note-field">
                    <label>Recordatorio</label>
                    <div className="partner-reminder-row">
                      {reminderOptionsForReason(followUpReason).map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          disabled={busy}
                          className={`partner-filter-btn${reminderOption === option.id ? " is-active" : ""}`}
                          onClick={() => setReminderOption(option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {reminderOption === "custom" ? (
                      <div className="partner-custom-datetime">
                        <div className="partner-custom-field">
                          <label htmlFor="partner-followup-date">Fecha</label>
                          <input
                            type="date"
                            id="partner-followup-date"
                            className="partner-input"
                            min={todayDateInputValue()}
                            value={customDate}
                            onChange={(event) => setCustomDate(event.target.value)}
                          />
                        </div>
                        <div className="partner-custom-field">
                          <label htmlFor="partner-followup-time">Hora</label>
                          <input
                            type="time"
                            id="partner-followup-time"
                            className="partner-input"
                            min={customDate === todayDateInputValue() ? nowTimeInputValue() : undefined}
                            value={customTime}
                            onChange={(event) => setCustomTime(event.target.value)}
                          />
                        </div>
                      </div>
                    ) : null}
                    <p className="partner-followup-preview">
                      Próximo seguimiento: {reminderOption === "custom"
                        ? (customReady && customCombined ? formatCustomFollowUpPreview(customCombined) : "Selecciona fecha y hora")
                        : formatFollowUpMoment(nextFollowupAtPreview)}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="partner-note-field">
                <label htmlFor="partner-note">Nota opcional</label>
                <textarea
                  id="partner-note"
                  className="partner-textarea"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Ej: devolví la llamada, agendamos para el jueves…"
                />
              </div>

              {showFollowUp ? (
                <div className="partner-action-row">
                  <button type="button" disabled={busy} className="partner-action-btn is-tertiary" onClick={cancelFollowUp}>Cancelar</button>
                  <button
                    type="button"
                    disabled={busy || (reminderOption === "custom" && !customReady)}
                    className="partner-action-btn is-primary"
                    onClick={() => void runFollowUp()}
                  >
                    Guardar seguimiento
                  </button>
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
