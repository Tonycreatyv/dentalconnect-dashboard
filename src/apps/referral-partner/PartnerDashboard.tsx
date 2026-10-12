import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { normalizeImmigrationConsent, type ImmigrationInboxRow } from "../referral-hub/operations/immigrationInbox";
import { resolveImmigrationOpportunity, type ImmigrationOpportunity } from "../referral-hub/operations/immigrationOpportunities";
import { buildTelLink, buildWhatsAppLink, formatPhoneForDisplay, planPartnerManagementSteps, resolveManagementNote, resolvePartnerPhone, type PartnerCloseResult, type PartnerContactOutcome, type PartnerManagementNextStep } from "./partnerActions";
import { buildHumanSummary, buildIntakeSummary, intakeDescription, referralServiceLabel, resolveIncidentDateFact, resolveSummaryTopicKey, resolveTopicDisplay } from "./referralPresentation";
import { resolveActivePartnerContext, type ActivePartnerContext } from "./partnerMembership";
import { resolvePartnerReferralService } from "./partnerReferralVisibility";
import { downloadPartnerCases, partnerCasesCsv, partnerCasesXlsx, type PartnerExportRow } from "./partnerExport";
import { partnerConfiguredServiceIds, resolvePartnerServiceWorkspace, type PartnerWorkspaceRule, type PartnerWorkspaceService } from "./partnerWorkspaceConfig";
import { type PartnerWorkspaceConfig } from "./workspaceConfig";
import { useSilentPolling } from "../../hooks/useSilentPolling";
import {
  countOverdueFollowUps,
  formatFollowUpMoment,
  isFollowUpOverdue,
  QUEUE_STATUS_LABEL,
  FOLLOW_UP_REASON_LABEL,
  resolvePartnerQueueStatus,
  sortPartnerQueue,
  type FollowUpReason,
  type PartnerQueueStatus,
  type PartnerStatusFilter,
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

function usePartnerWorkspaceConfiguration(partnerId: string) {
  const [partnerConfig, setPartnerConfig] = useState<PartnerWorkspaceConfig | null>(null);
  const [rules, setRules] = useState<PartnerWorkspaceRule[]>([]);
  const [services, setServices] = useState<PartnerWorkspaceService[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => { let mounted = true; (async () => {
    const [partner, ruleResult, serviceResult] = await Promise.all([
      supabase.from("referral_partners").select("workspace_config").eq("id", partnerId).maybeSingle(),
      supabase.from("referral_partner_service_rules").select("service_id,active,workspace_config").eq("partner_id", partnerId),
      supabase.from("service_configs").select("id,workspace_config"),
    ]);
    if (!mounted) return;
    setPartnerConfig((partner.data as { workspace_config?: PartnerWorkspaceConfig } | null)?.workspace_config ?? null);
    setRules(ruleResult.error ? [] : (ruleResult.data ?? []) as PartnerWorkspaceRule[]);
    setServices(serviceResult.error ? [] : (serviceResult.data ?? []) as PartnerWorkspaceService[]);
    setReady(!ruleResult.error && !serviceResult.error);
  })(); return () => { mounted = false; }; }, [partnerId]);
  const resolve = useCallback((serviceId: string) => resolvePartnerServiceWorkspace(serviceId, partnerConfig, rules, services), [partnerConfig, rules, services]);
  return { ready, allowedServiceIds: partnerConfiguredServiceIds(rules), resolve, displayName: partnerConfig?.display_name || "Referencias" };
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
              <Route path="*" element={<PartnerWorkspaceRoutes partnerId={membership.context.partnerId} />} />
            </Routes>
          )}
        </div>
      </div>
    </main>
  );
}

function PartnerWorkspaceRoutes({ partnerId }: { partnerId: string }) {
  const workspace = usePartnerWorkspaceConfiguration(partnerId);
  return <Routes><Route index element={<PartnerList partnerId={partnerId} workspace={workspace} />} /><Route path="referrals/:assignmentId" element={<PartnerDetail partnerId={partnerId} workspace={workspace} />} /></Routes>;
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
    // The detail now places secondary metadata after the call result, so
    // the date must remain in the concise pre-call summary.
    includeIncidentDate: true,
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

type CaseDateFilter = "all" | "today" | "yesterday" | "week" | "month" | "custom";
type CaseSort = "customer" | "service" | "received" | "status" | "followUp";

function dateFilterMatches(value: string, filter: CaseDateFilter, start: string, end: string, now = new Date()) {
  const received = new Date(value); if (Number.isNaN(received.getTime()) || filter === "all") return filter === "all";
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (filter === "today") return day(received) === day(now);
  if (filter === "yesterday") { const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); return day(received) === day(yesterday); }
  if (filter === "week") { const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(now.getDate() - 6); return day(received) >= day(sevenDaysAgo) && day(received) <= day(now); }
  if (filter === "month") return received.getFullYear() === now.getFullYear() && received.getMonth() === now.getMonth();
  const from = start ? new Date(`${start}T00:00:00`) : null; const to = end ? new Date(`${end}T23:59:59`) : null;
  return (!from || received >= from) && (!to || received <= to);
}

function CaseActionDrawer({ entry, onClose }: { entry: { row: AssignmentRow; opportunity: ImmigrationOpportunity; queueStatus: PartnerQueueStatus; overdue: boolean } | null; onClose: () => void }) {
  if (!entry) return null;
  const phone = resolvePartnerPhone(entry.row.referral_service_requests?.leads?.phone, entry.row.referral_service_requests?.leads?.channel_user_id);
  const presentation = referralPresentation(entry.row, entry.opportunity);
  return <div className="partner-drawer-backdrop" role="presentation" onMouseDown={onClose}>
    <aside className="partner-case-drawer" role="dialog" aria-modal="true" aria-label="Acciones del caso" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="partner-drawer-close" onClick={onClose}>Cerrar</button>
      <p className="partner-drawer-eyebrow">ACCIONES AVANZADAS</p><h2>{entry.opportunity.leadName}</h2>
      <p>{referralServiceLabel(presentation.service)} · {entry.overdue ? "Seguimiento vencido" : QUEUE_STATUS_LABEL[entry.queueStatus]}</p>
      <div className="partner-drawer-actions">
        <a href={buildTelLink(phone) ?? "#"} onClick={(event) => { if (!phone) event.preventDefault(); }}>Llamar</a>
        <a href={buildWhatsAppLink(phone) ?? "#"} onClick={(event) => { if (!phone) event.preventDefault(); }}>WhatsApp</a>
        <Link to={`referrals/${entry.row.id}`}>Abrir gestión del caso</Link>
      </div>
      <p className="partner-drawer-hint">Las acciones avanzadas se realizan en el detalle del caso para conservar el flujo de ciclo de vida existente.</p>
    </aside>
  </div>;
}

function PartnerList({ partnerId, workspace }: { partnerId: string; workspace: ReturnType<typeof usePartnerWorkspaceConfiguration> }) {
  const navigate = useNavigate();
  const { rows, loading, error, load } = usePartnerReferrals(partnerId);
  const [statusFilter, setStatusFilter] = useState<PartnerStatusFilter>("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<CaseDateFilter>("all");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [sort, setSort] = useState<{ key: CaseSort; direction: "asc" | "desc" }>({ key: "received", direction: "desc" });
  const [drawerEntry, setDrawerEntry] = useState<{ row: AssignmentRow; opportunity: ImmigrationOpportunity; queueStatus: PartnerQueueStatus; overdue: boolean } | null>(null);
  const [quickActionId, setQuickActionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
  const configuredEntries = useMemo(() => workspace.ready ? entries.filter((entry) => workspace.allowedServiceIds.has(entry.row.referral_service_requests?.service_id ?? "")) : entries, [entries, workspace]);
  const services = useMemo(() => Array.from(new Set(entries.map(({ row, opportunity }) => referralServiceLabel(referralPresentation(row, opportunity).service)))).sort(), [entries]);
  const filtered = useMemo(() => configuredEntries.filter((entry) => {
    const service = referralServiceLabel(referralPresentation(entry.row, entry.opportunity).service);
    const phone = resolvePartnerPhone(entry.row.referral_service_requests?.leads?.phone, entry.row.referral_service_requests?.leads?.channel_user_id) ?? "";
    const zip = entry.row.referral_service_requests?.postal_code ?? "";
    const matchesSearch = !search.trim() || `${entry.opportunity.leadName} ${phone} ${zip}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesSearch && (statusFilter === "all" || entry.queueStatus === statusFilter) && (serviceFilter === "all" || service === serviceFilter) && dateFilterMatches(entry.row.assigned_at, dateFilter, dateStart, dateEnd);
  }).sort((left, right) => {
    const cell = (entry: typeof left) => {
      const presentation = referralPresentation(entry.row, entry.opportunity);
      if (sort.key === "customer") return entry.opportunity.leadName;
      if (sort.key === "service") return referralServiceLabel(presentation.service);
      if (sort.key === "status") return entry.queueStatus;
      if (sort.key === "followUp") return entry.row.next_followup_at ?? "";
      return entry.row.assigned_at;
    };
    return cell(left).localeCompare(cell(right)) * (sort.direction === "asc" ? 1 : -1);
  }), [configuredEntries, statusFilter, serviceFilter, dateFilter, dateStart, dateEnd, sort, search]);
  // The secretary must be able to see there's overdue work without opening
  // the Seguimiento filter chip — a header-level count, always visible.
  const overdueCount = useMemo(() => countOverdueFollowUps(entries), [entries]);

  if (loading) return <p className="partner-empty partner-loading">Cargando referencias…</p>;
  if (error) return <p className="partner-empty partner-loading">{error}</p>;

  const chooseDatePreset = (filter: Exclude<CaseDateFilter, "all" | "custom">) => { setDateFilter(filter); setDateStart(""); setDateEnd(""); setDatePickerOpen(false); };
  const chooseExactDate = (value: string) => { setDateStart(value); setDateEnd(value); setDateFilter(value ? "custom" : "all"); if (value) setDatePickerOpen(false); };
  const dateLabel = dateFilter === "today" ? "Hoy" : dateFilter === "yesterday" ? "Ayer" : dateFilter === "week" ? "Últimos 7 días" : dateFilter === "month" ? "Este mes" : dateFilter === "custom" && dateStart ? new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(new Date(`${dateStart}T12:00:00`)) : "Todas las fechas";
  const resetFilters = () => { setStatusFilter("all"); setServiceFilter("all"); setDateFilter("all"); setDateStart(""); setDateEnd(""); setDatePickerOpen(false); setSearch(""); };
  const exportRows: PartnerExportRow[] = filtered.map((entry) => ({
    customer: entry.opportunity.leadName,
    phone: formatPhoneForDisplay(resolvePartnerPhone(entry.row.referral_service_requests?.leads?.phone, entry.row.referral_service_requests?.leads?.channel_user_id)) ?? "",
    service: referralServiceLabel(referralPresentation(entry.row, entry.opportunity).service),
    received: formatDateTime(entry.row.assigned_at), status: entry.overdue ? "Seguimiento vencido" : QUEUE_STATUS_LABEL[entry.queueStatus], nextFollowUp: formatFollowUpMoment(entry.row.next_followup_at),
  }));
  const sortBy = (key: CaseSort) => setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  const acceptFromTable = async (assignmentId: string) => {
    setQuickActionId(assignmentId);
    const result = await supabase.rpc("partner_update_referral_assignment", { p_assignment_id: assignmentId, p_action: "accept", p_note: null, p_appointment_at: null });
    setQuickActionId(null);
    if (!result.error) await load({ silent: true });
  };

  return (
    <div className="partner-view">
      <div className="partner-page-head">
        <h1>{workspace.displayName}</h1>
        <p>Personas que te hemos enviado para contactar.</p>
        {overdueCount > 0 ? (
          <p className="partner-overdue-counter" role="status">
            {overdueCount === 1 ? "1 seguimiento vencido" : `${overdueCount} seguimientos vencidos`}
          </p>
        ) : null}
      </div>

      <div className="partner-case-filterbar" aria-label="Filtros de casos">
        <div className="partner-primary-filters">
          <div className="partner-status-tabs" role="tablist" aria-label="Estado de los casos">
            {([ ["all", "Todos"], ["new", "Nuevos"], ["follow_up", "Seguimiento"], ["approved", "Aprobados"], ["disqualified", "No calificó"] ] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={statusFilter === id} className={`partner-filter-btn${statusFilter === id ? " is-active" : ""}${id === "all" ? "" : ` is-${id}`}`} onClick={() => setStatusFilter(id)}>{label}</button>)}
          </div>
          <label className="partner-service-select">Servicio<select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option value="all">Todos</option>{services.map((service) => <option key={service} value={service}>{service}</option>)}</select></label>
        </div>
        <details className="partner-more-filters">
          <summary>Más filtros</summary>
          <div className="partner-more-filters-panel">
            <label className="partner-search-field">Buscar<input value={search} placeholder="Cliente, teléfono o ZIP" onChange={(event) => setSearch(event.target.value)} /></label>
            <div className="partner-date-filter">
              <span className="partner-filter-label">Fecha recibida</span>
              <button type="button" className="partner-date-trigger" aria-expanded={datePickerOpen} aria-controls="partner-date-picker" onClick={() => setDatePickerOpen((open) => !open)}><span aria-hidden="true">▣</span>{dateLabel}</button>
              {datePickerOpen ? <div className="partner-date-popover" id="partner-date-picker">
                <input aria-label="Elegir fecha exacta" type="date" value={dateFilter === "custom" ? dateStart : ""} onChange={(event) => chooseExactDate(event.target.value)} />
                <div className="partner-date-presets" aria-label="Fechas rápidas">
                  <button type="button" onClick={() => chooseDatePreset("today")}>Hoy</button><button type="button" onClick={() => chooseDatePreset("yesterday")}>Ayer</button><button type="button" onClick={() => chooseDatePreset("week")}>Últimos 7 días</button><button type="button" onClick={() => chooseDatePreset("month")}>Este mes</button>
                </div>
              </div> : null}
            </div>
            <button type="button" className="partner-filter-reset" onClick={resetFilters}>Limpiar filtros</button>
            {workspace.resolve(filtered[0]?.row.referral_service_requests?.service_id ?? "").export_enabled ? <div className="partner-export-menu"><button type="button" onClick={() => downloadPartnerCases(new Blob([partnerCasesCsv(exportRows)], { type: "text/csv;charset=utf-8" }), "casos-filtrados.csv")}>CSV</button><button type="button" onClick={() => downloadPartnerCases(partnerCasesXlsx(exportRows), "casos-filtrados.xlsx")}>XLSX</button></div> : null}
          </div>
        </details>
      </div>
      {selectedIds.size ? <div className="partner-selection-bar"><span>{selectedIds.size} seleccionados</span>{workspace.resolve(filtered[0]?.row.referral_service_requests?.service_id ?? "").export_enabled ? <button type="button" onClick={() => downloadPartnerCases(new Blob([partnerCasesCsv(exportRows.filter((_, index) => selectedIds.has(filtered[index]?.row.id ?? "")))], { type: "text/csv;charset=utf-8" }), "casos-seleccionados.csv")}>Exportar seleccionados</button> : null}</div> : null}

      {filtered.length === 0 ? (
        <div className="partner-empty-state">
          <p>No hay referencias {statusFilter === "all" ? "pendientes" : "en esta categoría"}</p>
          <p className="partner-empty-sub">Las nuevas referencias aparecerán aquí automáticamente.</p>
        </div>
      ) : (
        <><div className="partner-cases-table-wrap"><table className="partner-cases-table"><thead><tr><th><input aria-label="Seleccionar todos" type="checkbox" checked={filtered.length > 0 && filtered.every((entry) => selectedIds.has(entry.row.id))} onChange={(event) => setSelectedIds(event.target.checked ? new Set(filtered.map((entry) => entry.row.id)) : new Set())} /></th>{([ ["customer", "Cliente"], ["service", "Servicio"], ["received", "Recibido"], ["status", "Estado"], ["followUp", "Próximo seguimiento"] ] as Array<[CaseSort, string]>).filter(([key]) => workspace.resolve(filtered[0]?.row.referral_service_requests?.service_id ?? "").visible_columns.includes(key === "followUp" ? "next_follow_up" : key)).map(([key, label]) => <th key={key}><button type="button" onClick={() => sortBy(key)}>{label}</button></th>)}{workspace.resolve(filtered[0]?.row.referral_service_requests?.service_id ?? "").visible_columns.includes("phone") ? <th>Teléfono</th> : null}<th>Acciones</th></tr></thead><tbody>{filtered.map((entry) => { const phone = resolvePartnerPhone(entry.row.referral_service_requests?.leads?.phone, entry.row.referral_service_requests?.leads?.channel_user_id); const presentation = referralPresentation(entry.row, entry.opportunity); const config = workspace.resolve(entry.row.referral_service_requests?.service_id ?? ""); return <tr className="partner-case-row" key={entry.row.id} onClick={() => navigate(`referrals/${entry.row.id}`)}>{<td onClick={(event) => event.stopPropagation()}><input aria-label={`Seleccionar ${entry.opportunity.leadName}`} type="checkbox" checked={selectedIds.has(entry.row.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(entry.row.id) : next.delete(entry.row.id); return next; })} /></td>}{config.visible_columns.includes("customer") ? <td><Link onClick={(event) => event.stopPropagation()} to={`referrals/${entry.row.id}`}>{entry.opportunity.leadName}</Link></td> : null}{config.visible_columns.includes("service") ? <td>{referralServiceLabel(presentation.service)}</td> : null}{config.visible_columns.includes("received") ? <td>{formatDateTime(entry.row.assigned_at)}</td> : null}{config.visible_columns.includes("status") ? <td><span className={`partner-status is-${queueStatusTone(entry.queueStatus, entry.overdue)}`}>{entry.overdue ? "Vencido" : QUEUE_STATUS_LABEL[entry.queueStatus]}</span></td> : null}{config.visible_columns.includes("next_follow_up") ? <td>{formatFollowUpMoment(entry.row.next_followup_at)}</td> : null}{config.visible_columns.includes("phone") ? <td>{formatPhoneForDisplay(phone) || "—"}</td> : null}<td onClick={(event) => event.stopPropagation()}><div className="partner-row-actions">{config.allowed_actions.includes("call") ? <a href={buildTelLink(phone) ?? "#"} onClick={(event) => { event.stopPropagation(); if (!phone) event.preventDefault(); }}>Llamar</a> : null}{config.allowed_actions.includes("whatsapp") ? <a href={buildWhatsAppLink(phone) ?? "#"} onClick={(event) => { event.stopPropagation(); if (!phone) event.preventDefault(); }}>WhatsApp</a> : null}{entry.row.status === "assigned" && config.allowed_actions.includes("accept") ? <button type="button" className="is-primary" disabled={quickActionId === entry.row.id} onClick={(event) => { event.stopPropagation(); void acceptFromTable(entry.row.id); }}>Aceptar</button> : <Link onClick={(event) => event.stopPropagation()} className="is-primary" to={`referrals/${entry.row.id}`}>Abrir</Link>}<button type="button" onClick={(event) => { event.stopPropagation(); setDrawerEntry(entry); }}>Más</button></div></td></tr>; })}</tbody></table></div>
        <div className="partner-list partner-mobile-cards">
          {filtered.map(({ row, opportunity, queueStatus, overdue }) => <ReferralCard key={row.id} row={row} opportunity={opportunity} queueStatus={queueStatus} overdue={overdue} />)}
        </div></>
      )}
      <CaseActionDrawer entry={drawerEntry} onClose={() => setDrawerEntry(null)} />
    </div>
  );
}

function PartnerDetail({ partnerId, workspace }: { partnerId: string; workspace: ReturnType<typeof usePartnerWorkspaceConfiguration> }) {
  const { assignmentId = "" } = useParams();
  const { rows, loading, error, load } = usePartnerReferrals(partnerId);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [contactOutcome, setContactOutcome] = useState<PartnerContactOutcome>("contacted");
  const [nextStep, setNextStep] = useState<PartnerManagementNextStep>("follow_up");
  const [closeResult, setCloseResult] = useState<PartnerCloseResult>("converted");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionReason, setCorrectionReason] = useState<CorrectionReason>("marked_by_mistake");
  const [correctionNote, setCorrectionNote] = useState("");

  const row = rows.find((candidate) => candidate.id === assignmentId) ?? null;
  const opportunity = row ? toOpportunity(row) : null;
  const workspaceConfig = workspace.resolve(row?.referral_service_requests?.service_id ?? "");

  const runManagement = useCallback(async () => {
    if (!row || busy) return;
    const nextFollowupAt = nextStep === "follow_up" ? new Date(`${followUpDate}T${followUpTime}`) : null;
    if (nextStep === "follow_up" && (!followUpDate || !followUpTime || !nextFollowupAt || Number.isNaN(nextFollowupAt.getTime()) || nextFollowupAt.getTime() <= Date.now())) {
      setFeedback({ tone: "error", text: "Selecciona una fecha y hora futuras para el seguimiento." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const followUpReason: FollowUpReason = contactOutcome === "no_answer" ? "no_answer" : "other";
    const steps = planPartnerManagementSteps(contactOutcome, nextStep, closeResult, row.status);
    const outcomeAction = contactOutcome === "wrong_number" ? "note" : contactOutcome;
    const outcomeNote = resolveManagementNote(contactOutcome, note);
    for (const step of steps) {
      const result = await supabase.rpc("partner_update_referral_assignment", {
        p_assignment_id: assignmentId,
        p_action: step,
        p_note: step === outcomeAction ? outcomeNote : null,
        p_appointment_at: null,
        p_follow_up_reason: step === "follow_up" ? followUpReason : null,
        p_next_followup_at: step === "follow_up" ? nextFollowupAt?.toISOString() ?? null : null,
      });
      if (result.error) {
        reportPartnerOutcomeFailure(result.error);
        setBusy(false);
        setFeedback({ tone: "error", text: "No se pudo guardar la gestión. Intenta de nuevo." });
        return;
      }
    }
    setBusy(false);
    setNote("");
    setFollowUpDate("");
    setFollowUpTime("");
    setFeedback({ tone: "success", text: nextStep === "follow_up" ? "Gestión y seguimiento guardados." : "Gestión y resultado guardados." });
    await load({ silent: true });
  }, [row, busy, assignmentId, contactOutcome, nextStep, closeResult, note, followUpDate, followUpTime, load]);

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
          {presentation.sharedInfoSummary ? <details className="partner-more-information"><summary>Ver más información</summary><p className="partner-context-text">{presentation.sharedInfoSummary}</p></details> : null}
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
          <p className="partner-call-phone">{formatPhoneForDisplay(phone) || "Teléfono no disponible"}</p>
          <p className="partner-actions-hint">Llamar abre la aplicación de teléfono del dispositivo; no cambia el estado del caso.</p>
        </div>

        <div className="partner-detail-col-side">
          <section className="partner-block partner-block--flush partner-additional-information">
            <h2>Datos</h2>
            <dl className="partner-facts">
              <div><dt>Teléfono</dt><dd>{formatPhoneForDisplay(phone) || "No disponible"}</dd></div>
              <div><dt>ZIP</dt><dd>{opportunity.postalCode || "No disponible"}</dd></div>
              {workspaceConfig.service_fields.map((field) => { const value = row.referral_service_requests?.intake?.[field]; return value === undefined || value === null || value === "" ? null : <div key={field}><dt>{field.replace(/_/g, " ")}</dt><dd>{String(value)}</dd></div>; })}
              {hasConsent ? <div><dt>Autorizado para contacto</dt><dd>{opportunity.consentStatus === "authorized" ? "Sí" : opportunity.consentStatus === "declined" ? "No" : "Pendiente de confirmar"}</dd></div> : null}
              {presentation.incidentDateFact ? <div><dt>{presentation.incidentDateFact.label}</dt><dd>{presentation.incidentDateFact.value}</dd></div> : null}
              <div><dt>Recibido</dt><dd>{formatDateTime(opportunity.assignment!.assignedAt)}</dd></div>
            </dl>
          </section>

          {canCorrectFinalResult(row.work_status) ? (
            <section className="partner-block">
              <h2>Resultado de la llamada</h2>
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
              <h2>GUARDAR GESTIÓN</h2>
              <div className="partner-management-form">
                <fieldset className="partner-management-fieldset">
                  <legend>Resultado del contacto</legend>
                  <div className="partner-management-options">
                    <label><input type="radio" name="contact-outcome" checked={contactOutcome === "contacted"} onChange={() => setContactOutcome("contacted")} /> Contactado</label>
                    <label><input type="radio" name="contact-outcome" checked={contactOutcome === "no_answer"} onChange={() => setContactOutcome("no_answer")} /> No contestó</label>
                    <label><input type="radio" name="contact-outcome" checked={contactOutcome === "wrong_number"} onChange={() => setContactOutcome("wrong_number")} /> Número incorrecto</label>
                  </div>
                </fieldset>

                <div className="partner-note-field">
                  <label htmlFor="partner-note">Nota (opcional)</label>
                  <textarea id="partner-note" className="partner-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Agrega contexto útil para el equipo…" />
                  {contactOutcome === "wrong_number" ? <p className="partner-note-hint">Se registrará como nota. No cierra el caso por sí solo porque el contrato actual no tiene un estado durable para número incorrecto.</p> : null}
                </div>

                <fieldset className="partner-management-fieldset">
                  <legend>Próximo paso</legend>
                  <div className="partner-management-options">
                    <label><input type="radio" name="next-step" checked={nextStep === "follow_up"} onChange={() => setNextStep("follow_up")} /> Seguimiento</label>
                    <label><input type="radio" name="next-step" checked={nextStep === "close"} onChange={() => setNextStep("close")} /> Cerrar caso</label>
                  </div>
                </fieldset>

                {nextStep === "follow_up" ? (
                  <div className="partner-custom-datetime">
                    <div className="partner-custom-field"><label htmlFor="partner-followup-date">Fecha</label><input required type="date" id="partner-followup-date" className="partner-input" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></div>
                    <div className="partner-custom-field"><label htmlFor="partner-followup-time">Hora</label><input required type="time" id="partner-followup-time" className="partner-input" value={followUpTime} onChange={(event) => setFollowUpTime(event.target.value)} /></div>
                    <p className="partner-note-hint">{contactOutcome === "no_answer" ? "Motivo de seguimiento: No contestó." : "Motivo de seguimiento: Otro."}</p>
                  </div>
                ) : (
                  <fieldset className="partner-management-fieldset">
                    <legend>Resultado de cierre</legend>
                    <div className="partner-management-options">
                      <label><input type="radio" name="close-result" checked={closeResult === "converted"} onChange={() => setCloseResult("converted")} /> Convertido / Aprobado</label>
                      <label><input type="radio" name="close-result" checked={closeResult === "closed_not_converted"} onChange={() => setCloseResult("closed_not_converted")} /> No convertido / No calificó</label>
                    </div>
                  </fieldset>
                )}

                <button type="button" disabled={busy} className="partner-action-btn is-primary partner-management-save" onClick={() => void runManagement()}>{busy ? "Guardando…" : "Guardar gestión"}</button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
