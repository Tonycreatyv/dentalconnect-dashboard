import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Save, UserRound } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { updateAdminClient } from "../operations/adminClientCaseEdit";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { SkeletonRows } from "../ui/Skeleton";

type ClientDraft = {
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
  channelUserId: string;
};

const EMPTY: ClientDraft = {
  firstName: "",
  lastName: "",
  fullName: "",
  phone: "",
  email: "",
  channelUserId: "",
};

export default function ClientEditScreen() {
  const { leadId = "" } = useParams();
  const { resolvedOrgId } = useReferralOrganization();
  const [initial, setInitial] = useState<ClientDraft>(EMPTY);
  const [draft, setDraft] = useState<ClientDraft>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    if (!resolvedOrgId || !leadId) return;
    setLoading(true);
    setError("");
    const result = await supabase.from("leads")
      .select("first_name,last_name,full_name,phone,email,channel_user_id")
      .eq("organization_id", resolvedOrgId)
      .eq("id", leadId)
      .maybeSingle();
    if (result.error || !result.data) {
      setError("No se pudo cargar este cliente.");
      setLoading(false);
      return;
    }
    const next: ClientDraft = {
      firstName: result.data.first_name ?? "",
      lastName: result.data.last_name ?? "",
      fullName: result.data.full_name ?? "",
      phone: result.data.phone ?? "",
      email: result.data.email ?? "",
      channelUserId: result.data.channel_user_id ?? "",
    };
    setInitial(next);
    setDraft(next);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [leadId, resolvedOrgId]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  async function save() {
    if (!leadId || saving || !dirty) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateAdminClient({
        leadId,
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        fullName: draft.fullName.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
      });
      setInitial(draft);
      setNotice("Cliente actualizado y cambio auditado.");
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="hub-page"><Link className="hub-back" to={`/clientes/${leadId}`}><ArrowLeft />Volver</Link><SkeletonRows count={4} /></div>;
  if (error && !initial.fullName && !initial.channelUserId) return <div className="hub-page"><Link className="hub-back" to="/clientes"><ArrowLeft />Volver</Link><EmptyState icon={UserRound} tone="error" title="Cliente no disponible" description={error} /></div>;

  return (
    <div className="hub-page hub-page--wide hub-admin-edit-page">
      <Link className="hub-back" to={`/clientes/${leadId}`}><ArrowLeft />Volver al cliente</Link>
      <PageHeader eyebrow="Clientes" title="Editar cliente" subtitle="Actualiza datos de perfil. La identidad de WhatsApp permanece protegida." />

      <section className="hub-section hub-admin-edit-card">
        <div className="hub-admin-edit-grid">
          <div className="hub-field"><label htmlFor="client-first-name">Nombre</label><input id="client-first-name" className="hub-input" value={draft.firstName} onChange={(event) => setDraft((current) => ({ ...current, firstName: event.target.value }))} /></div>
          <div className="hub-field"><label htmlFor="client-last-name">Apellido</label><input id="client-last-name" className="hub-input" value={draft.lastName} onChange={(event) => setDraft((current) => ({ ...current, lastName: event.target.value }))} /></div>
          <div className="hub-field hub-admin-edit-span"><label htmlFor="client-full-name">Nombre completo</label><input id="client-full-name" className="hub-input" value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} /></div>
          <div className="hub-field"><label htmlFor="client-phone">Teléfono</label><input id="client-phone" className="hub-input" inputMode="tel" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></div>
          <div className="hub-field"><label htmlFor="client-email">Email</label><input id="client-email" className="hub-input" type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></div>
          <div className="hub-field hub-admin-edit-span"><label htmlFor="client-whatsapp-id">Identidad de WhatsApp</label><input id="client-whatsapp-id" className="hub-input" value={draft.channelUserId} disabled /><p className="hub-field-hint">No se puede editar desde Admin porque identifica la conversación y el routing del contacto.</p></div>
        </div>

        {dirty ? <p className="hub-field-hint">Tienes cambios sin guardar.</p> : null}
        {error ? <p className="hub-account-error" role="alert">{error}</p> : null}
        {notice ? <p className="hub-account-success" role="status"><CheckCircle2 size={14} />{notice}</p> : null}
        <div className="hub-admin-edit-actions">
          <button type="button" className="hub-secondary" disabled={saving || !dirty} onClick={() => setDraft(initial)}>Cancelar cambios</button>
          <button type="button" className="hub-primary" disabled={saving || !dirty} onClick={() => void save()}><Save size={16} />{saving ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </section>
    </div>
  );
}
