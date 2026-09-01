import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { immigrationTopicLabel, normalizeImmigrationConsent, type ImmigrationInboxRow } from "../referral-hub/operations/immigrationInbox";
import { resolveImmigrationOpportunity, type ImmigrationOpportunity } from "../referral-hub/operations/immigrationOpportunities";
import { buildTelLink, buildWhatsAppLink, planPartnerActionSteps, resolveActionNote, resolvePartnerPhone, type PartnerAction } from "./partnerActions";

type AssignmentRequestRow = {
  id: string;
  lead_id: string;
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
  status: string;
  work_status: string;
  assigned_at: string;
  updated_at: string;
  referral_service_requests: AssignmentRequestRow | null;
};

const ACTION_LABEL: Record<PartnerAction, string> = {
  contacted: "Contactado",
  no_answer: "No respondió",
  pending: "Pendiente",
};

const ACTION_FEEDBACK: Record<PartnerAction, string> = {
  contacted: "Registrado: contactaste a este cliente.",
  no_answer: "Registrado: intento de contacto sin respuesta.",
  pending: "Marcado como pendiente de seguimiento.",
};

const NEEDS_ATTENTION_STATUS = new Set(["Nueva asignación", "Rechazada por aliado", "Pendiente de seguimiento"]);

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(date);
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

function usePartnerReferrals() {
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await supabase
      .from("referral_assignments")
      .select(
        "id,request_id,status,work_status,assigned_at,updated_at,referral_service_requests!inner(id,lead_id,postal_code,intake,consent,intake_complete,status,case_cycle,created_at,leads(full_name,phone,channel_user_id))",
      )
      .order("assigned_at", { ascending: false });
    if (result.error) {
      setError("No se pudieron cargar las referencias asignadas.");
      setRows([]);
    } else {
      setRows((result.data ?? []) as unknown as AssignmentRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { rows, loading, error, load };
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
    <main className="partner-portal">
      <section>
        <span>Conexxion · Portal de aliados</span>
        <h1>Referencias de Inmigración</h1>
        <p className="partner-empty">Accede sólo a las referencias asignadas a tu despacho.</p>
        <form onSubmit={submit} className="partner-form">
          <input className="partner-input" type="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="partner-input" type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error ? <div className="partner-feedback is-error">{error}</div> : null}
          <button type="submit" disabled={busy} className="partner-submit">
            {busy ? "Entrando…" : "Iniciar sesión"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function RequirePartner({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) return <main className="partner-portal"><section><p className="partner-empty">Cargando…</p></section></main>;
  return session ? children : <Navigate to="/partner/login" replace />;
}

export function Shell() {
  const { user, signOut } = useAuth();
  return (
    <main className="partner-portal">
      <header className="partner-header">
        <span>Conexxion · Portal de aliados</span>
        <div className="partner-header-user">
          <strong>{user?.email}</strong>
          <button type="button" onClick={() => void signOut()}>Salir</button>
        </div>
      </header>
      <Routes>
        <Route index element={<PartnerList />} />
        <Route path="referrals/:assignmentId" element={<PartnerDetail />} />
      </Routes>
    </main>
  );
}

function PartnerList() {
  const { rows, loading, error } = usePartnerReferrals();
  const opportunities = useMemo(
    () => rows.map(toOpportunity).filter((opportunity): opportunity is ImmigrationOpportunity => opportunity !== null),
    [rows],
  );

  if (loading) return <section><p className="partner-empty">Cargando referencias…</p></section>;
  if (error) return <section><p className="partner-empty">{error}</p></section>;

  return (
    <section>
      <h1>Mis referencias</h1>
      <p className="partner-empty" style={{ marginBottom: "1rem" }}>Sólo se muestran casos con autorización para compartir.</p>
      {opportunities.length === 0 ? (
        <p className="partner-empty">No tienes referencias de inmigración asignadas todavía.</p>
      ) : (
        <div className="partner-referral-list">
          {opportunities.map((opportunity) => (
            <Link
              key={opportunity.assignment!.id}
              to={`referrals/${opportunity.assignment!.id}`}
              className="partner-referral-item"
            >
              <div className="partner-referral-item-head">
                <strong>{opportunity.leadName}</strong>
                <span className={`partner-badge${NEEDS_ATTENTION_STATUS.has(opportunity.operationalStatus) ? " is-attention" : ""}`}>
                  {opportunity.operationalStatus}
                </span>
              </div>
              <p>{immigrationTopicLabel(opportunity.topic)}{opportunity.postalCode ? ` · ZIP ${opportunity.postalCode}` : ""}</p>
              <p>{opportunity.description || "Sin resumen"}</p>
              <p>Recibido {formatDate(opportunity.createdAt)} · Asignado {formatDate(opportunity.assignment!.assignedAt)}</p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function PartnerDetail() {
  const { assignmentId = "" } = useParams();
  const { rows, loading, error, load } = usePartnerReferrals();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const row = rows.find((candidate) => candidate.id === assignmentId) ?? null;
  const opportunity = row ? toOpportunity(row) : null;

  const runAction = useCallback(async (action: PartnerAction) => {
    if (!row || busy) return;
    setBusy(true);
    setFeedback(null);
    const steps = planPartnerActionSteps(action, row.status);
    const finalNote = resolveActionNote(action, note);
    for (let index = 0; index < steps.length; index += 1) {
      const isFinalStep = index === steps.length - 1;
      const result = await supabase.rpc("partner_update_immigration_assignment", {
        p_assignment_id: assignmentId,
        p_action: steps[index],
        p_note: isFinalStep ? finalNote : null,
        p_appointment_at: null,
      });
      if (result.error) {
        setBusy(false);
        setFeedback({ tone: "error", text: "No se pudo registrar la acción. Intenta de nuevo." });
        return;
      }
    }
    setBusy(false);
    setNote("");
    setFeedback({ tone: "success", text: ACTION_FEEDBACK[action] });
    void load();
  }, [row, busy, assignmentId, note, load]);

  if (loading) return <section><p className="partner-empty">Cargando…</p></section>;
  if (error || !opportunity || !row) return <section><p className="partner-empty">La referencia no está disponible.</p></section>;

  const phone = resolvePartnerPhone(row.referral_service_requests?.leads?.phone, row.referral_service_requests?.leads?.channel_user_id);
  const waLink = buildWhatsAppLink(phone);
  const telLink = buildTelLink(phone);

  return (
    <>
      <Link className="partner-back" to="/partner/app">← Mis referencias</Link>
      <section>
        <h1>{opportunity.leadName}</h1>
        <p className="partner-empty">{immigrationTopicLabel(opportunity.topic)} · {opportunity.operationalStatus}</p>
      </section>

      {feedback ? <div className={`partner-feedback is-${feedback.tone}`}>{feedback.text}</div> : null}

      {/* WhatsApp/Llamar only open a conversation or a phone call — they never
          call the RPC and never change the assignment's state. */}
      <div className="partner-contact-actions">
        <a
          className="is-whatsapp"
          href={waLink ?? "#"}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!waLink}
          onClick={(event) => { if (!waLink) event.preventDefault(); }}
        >
          WhatsApp
        </a>
        <a
          className="is-call"
          href={telLink ?? "#"}
          aria-disabled={!telLink}
          onClick={(event) => { if (!telLink) event.preventDefault(); }}
        >
          Llamar
        </a>
      </div>
      <p className="partner-actions-hint">Estos botones sólo abren la conversación o la llamada; no cambian el estado del caso.</p>

      <section className="partner-card">
        <dl>
          <div><dt>Teléfono</dt><dd>{phone || "No disponible"}</dd></div>
          <div><dt>Tipo de caso</dt><dd>Inmigración</dd></div>
          <div><dt>Tema</dt><dd>{immigrationTopicLabel(opportunity.topic)}</dd></div>
          <div><dt>ZIP</dt><dd>{opportunity.postalCode || "No disponible"}</dd></div>
          <div><dt>Resumen</dt><dd>{opportunity.description || "Sin resumen"}</dd></div>
          <div><dt>Consentimiento</dt><dd>{opportunity.consentStatus === "authorized" ? "Autorizado" : opportunity.consentStatus === "declined" ? "Rechazado" : "Pendiente"}</dd></div>
          <div><dt>Recibida</dt><dd>{formatDate(opportunity.createdAt)}</dd></div>
          <div><dt>Asignada</dt><dd>{formatDate(opportunity.assignment!.assignedAt)}</dd></div>
        </dl>
      </section>

      <section>
        <p style={{ fontWeight: 700 }}>Registrar seguimiento</p>
        <textarea
          className="partner-textarea"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Nota opcional para el equipo interno"
        />
        <div className="partner-actions" style={{ marginTop: ".75rem" }}>
          {(Object.keys(ACTION_LABEL) as PartnerAction[]).map((action) => (
            <button key={action} type="button" disabled={busy} onClick={() => void runAction(action)}>
              {ACTION_LABEL[action]}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
