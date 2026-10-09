import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Save } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { updateAdminCaseDetails } from "../operations/adminClientCaseEdit";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { SkeletonRows } from "../ui/Skeleton";

type CaseDraft = {
  serviceId: string;
  city: string;
  postalCode: string;
  language: string;
  specialty: string;
};

const EMPTY: CaseDraft = { serviceId: "", city: "", postalCode: "", language: "", specialty: "" };
const SERVICES = [
  ["luis_accidente", "Accidente de auto"],
  ["luis_inmigracion", "Inmigración"],
  ["luis_dui_criminal", "DUI / Criminal"],
] as const;

export default function CaseEditScreen() {
  const { requestId = "" } = useParams();
  const { resolvedOrgId } = useReferralOrganization();
  const [initial, setInitial] = useState<CaseDraft>(EMPTY);
  const [draft, setDraft] = useState<CaseDraft>(EMPTY);
  const [hasActiveAssignment, setHasActiveAssignment] = useState(false);
  const [closed, setClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    if (!resolvedOrgId || !requestId) return;
    setLoading(true);
    setError("");
    const [requestResult, assignmentResult] = await Promise.all([
      supabase.from("referral_service_requests")
        .select("service_id,city,postal_code,language,specialty,status")
        .eq("organization_id", resolvedOrgId)
        .eq("id", requestId)
        .maybeSingle(),
      supabase.from("referral_assignments")
        .select("id")
        .eq("organization_id", resolvedOrgId)
        .eq("request_id", requestId)
        .in("status", ["pending_assignment", "assigned", "accepted"])
        .limit(1),
    ]);
    if (requestResult.error || !requestResult.data) {
      setError("No se pudo cargar este caso.");
      setLoading(false);
      return;
    }
    const next: CaseDraft = {
      serviceId: requestResult.data.service_id ?? "",
      city: requestResult.data.city ?? "",
      postalCode: requestResult.data.postal_code ?? "",
      language: requestResult.data.language ?? "",
      specialty: requestResult.data.specialty ?? "",
    };
    setInitial(next);
    setDraft(next);
    setClosed(requestResult.data.status === "closed");
    setHasActiveAssignment(Boolean(assignmentResult.data?.length));
    setLoading(false);
  }

  useEffect(() => { void load(); }, [requestId, resolvedOrgId]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  async function save() {
    if (!requestId || saving || !dirty || closed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateAdminCaseDetails({
        requestId,
        serviceId: draft.serviceId,
        city: draft.city.trim(),
        postalCode: draft.postalCode.trim(),
        language: draft.language.trim(),
        specialty: draft.specialty.trim(),
      });
      setInitial(draft);
      setNotice("Datos del caso actualizados y cambio auditado.");
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="hub-page"><Link className="hub-back" to={`/operacion/${requestId}`}><ArrowLeft />Volver</Link><SkeletonRows count={4} /></div>;
  if (error && !initial.serviceId) return <div className="hub-page"><Link className="hub-back" to="/operacion"><ArrowLeft />Volver</Link><EmptyState icon={AlertTriangle} tone="error" title="Caso no disponible" description={error} /></div>;

  return (
    <div className="hub-page hub-page--wide hub-admin-edit-page">
      <Link className="hub-back" to={`/operacion/${requestId}`}><ArrowLeft />Volver al caso</Link>
      <PageHeader eyebrow="Operación" title="Editar datos del caso" subtitle="Los cambios se guardan explícitamente y quedan en auditoría." />

      <section className="hub-section hub-admin-edit-card">
        {closed ? <p className="hub-blocked-note">Este caso está cerrado. Para proteger el historial, sus datos operativos son de solo lectura.</p> : null}
        <div className="hub-admin-edit-grid">
          <div className="hub-field hub-admin-edit-span">
            <label htmlFor="case-service">Servicio</label>
            <select id="case-service" className="hub-input" value={draft.serviceId} disabled={closed || hasActiveAssignment} onChange={(event) => setDraft((current) => ({ ...current, serviceId: event.target.value }))}>
              {SERVICES.some(([id]) => id === draft.serviceId) ? null : <option value={draft.serviceId}>{draft.serviceId || "Servicio actual"}</option>}
              {SERVICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            {hasActiveAssignment ? <p className="hub-field-hint">El servicio no puede cambiar mientras exista una asignación activa. Esto evita dejar el partner asignado a un servicio incorrecto.</p> : null}
          </div>
          <div className="hub-field"><label htmlFor="case-city">Ciudad</label><input id="case-city" className="hub-input" value={draft.city} disabled={closed} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} /></div>
          <div className="hub-field"><label htmlFor="case-zip">ZIP</label><input id="case-zip" className="hub-input" inputMode="numeric" value={draft.postalCode} disabled={closed} onChange={(event) => setDraft((current) => ({ ...current, postalCode: event.target.value }))} /></div>
          <div className="hub-field"><label htmlFor="case-language">Idioma</label><input id="case-language" className="hub-input" value={draft.language} disabled={closed} onChange={(event) => setDraft((current) => ({ ...current, language: event.target.value }))} /></div>
          <div className="hub-field"><label htmlFor="case-specialty">Especialidad</label><input id="case-specialty" className="hub-input" value={draft.specialty} disabled={closed} onChange={(event) => setDraft((current) => ({ ...current, specialty: event.target.value }))} /></div>
        </div>

        {dirty && !closed ? <p className="hub-field-hint">Tienes cambios sin guardar.</p> : null}
        {error ? <p className="hub-account-error" role="alert">{error}</p> : null}
        {notice ? <p className="hub-account-success" role="status"><CheckCircle2 size={14} />{notice}</p> : null}
        <div className="hub-admin-edit-actions">
          <button type="button" className="hub-secondary" disabled={saving || !dirty} onClick={() => setDraft(initial)}>Cancelar cambios</button>
          <button type="button" className="hub-primary" disabled={saving || !dirty || closed} onClick={() => void save()}><Save size={16} />{saving ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </section>
    </div>
  );
}
