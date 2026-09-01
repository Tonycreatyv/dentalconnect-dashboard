import { ArrowLeft, Bell, Building2, Check, Clock, MessageCircle, UserCircle, Users as UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { supabase } from "../../../lib/supabaseClient";
import PageHeader from "../ui/PageHeader";
import StatusBadge from "../ui/StatusBadge";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";
import { profileDisplayName, profilePhone, useProfileEditor } from "../operations/useProfileEditor";
import { useOrgMembers } from "../operations/useOrgMembers";

type WhatsAppStatusRow = {
  whatsapp_enabled: boolean | null;
  whatsapp_phone_number: string | null;
  whatsapp_display_name: string | null;
  whatsapp_registered: boolean | null;
  whatsapp_webhooks_subscribed: boolean | null;
  bot_enabled: boolean | null;
  automation_enabled: boolean | null;
  timezone: string | null;
};

const ROLE_LABEL: Record<string, string> = { owner: "Propietario", admin: "Administrador", member: "Miembro" };

export default function ReferralConfiguracion() {
  const { user } = useAuth();
  const { resolvedOrgId, resolvedOrgName, membershipRole } = useReferralOrganization();
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatusRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState("");
  const [savingOrgName, setSavingOrgName] = useState(false);
  const [orgNotice, setOrgNotice] = useState("");
  const canEditOrg = membershipRole === "owner" || membershipRole === "admin";
  const isOwner = membershipRole === "owner";

  const [editingProfile, setEditingProfile] = useState(false);
  const [nameInput, setNameInput] = useState(profileDisplayName(user));
  const [phoneInput, setPhoneInput] = useState(profilePhone(user));
  const profileEditor = useProfileEditor();
  useEffect(() => {
    setNameInput(profileDisplayName(user));
    setPhoneInput(profilePhone(user));
  }, [user]);
  async function saveProfileFields() {
    const ok = await profileEditor.saveProfile({ fullName: nameInput, phone: phoneInput });
    if (ok) setEditingProfile(false);
  }

  const { members, loading: membersLoading, error: membersError, setMemberRoleToAdmin } = useOrgMembers(resolvedOrgId);
  const [roleChangeNotice, setRoleChangeNotice] = useState("");
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);
  async function promoteToAdmin(userId: string) {
    setChangingRoleFor(userId);
    setRoleChangeNotice("");
    const err = await setMemberRoleToAdmin(userId);
    setChangingRoleFor(null);
    setRoleChangeNotice(err || "Rol actualizado.");
  }

  useEffect(() => {
    if (!resolvedOrgId) { setLoading(false); return; }
    setLoading(true);
    setOrgName(resolvedOrgName);
    // Only safe, non-secret columns — never tokens, never the raw Meta payload.
    supabase.from("org_settings")
      .select("whatsapp_enabled,whatsapp_phone_number,whatsapp_display_name,whatsapp_registered,whatsapp_webhooks_subscribed,bot_enabled,automation_enabled,timezone")
      .eq("organization_id", resolvedOrgId)
      .maybeSingle()
      .then((settingsResult) => {
        setWhatsapp((settingsResult.data as WhatsAppStatusRow | null) ?? null);
        setLoading(false);
      });
  }, [resolvedOrgId, resolvedOrgName]);

  async function saveOrgName() {
    const trimmed = orgName.trim();
    if (!trimmed || !resolvedOrgId) return;
    setSavingOrgName(true);
    setOrgNotice("");
    const { error } = await supabase.from("org_settings").update({ brand_name: trimmed }).eq("organization_id", resolvedOrgId);
    setSavingOrgName(false);
    setOrgNotice(error ? "No se pudo guardar el nombre de la organización." : "Guardado.");
  }

  const whatsappConnected = Boolean(whatsapp?.whatsapp_enabled && whatsapp?.whatsapp_registered);
  const automationOn = whatsapp?.bot_enabled !== false && whatsapp?.automation_enabled !== false;

  return (
    <div className="hub-page">
      <Link className="hub-back" to="/"><ArrowLeft />Volver</Link>
      <PageHeader eyebrow="Cuenta" title="Configuración" subtitle="Perfil, WhatsApp, notificaciones y organización" />

      <section className="hub-section">
        <h2><UserCircle size={16} />Perfil</h2>
        {editingProfile ? (
          <div className="hub-field-group">
            <div className="hub-field">
              <label htmlFor="profile-name">Tu nombre</label>
              <input id="profile-name" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
            </div>
            <div className="hub-field">
              <label htmlFor="profile-phone">Tu teléfono (opcional)</label>
              <input id="profile-phone" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} />
            </div>
            <div className="hub-account-edit-actions">
              <button type="button" className="hub-chip-btn" onClick={() => { setEditingProfile(false); setNameInput(profileDisplayName(user)); setPhoneInput(profilePhone(user)); profileEditor.resetStatus(); }}>Cancelar</button>
              <button type="button" className="hub-chip-btn is-primary" disabled={profileEditor.saving} onClick={() => void saveProfileFields()}>{profileEditor.saving ? "Guardando…" : "Guardar"}</button>
            </div>
            {profileEditor.error ? <p className="hub-account-error" role="alert">{profileEditor.error}</p> : null}
          </div>
        ) : (
          <dl className="hub-facts">
            <div><dt>Tu nombre</dt><dd>{profileDisplayName(user) || "Sin nombre"}</dd></div>
            <div><dt>Tu teléfono</dt><dd>{profilePhone(user) || "Sin teléfono"}</dd></div>
            <div><dt>Tu correo</dt><dd>{user?.email || "—"}</dd></div>
            <div><dt>Organización</dt><dd>{resolvedOrgName}</dd></div>
            <div><dt>Tu rol</dt><dd>{ROLE_LABEL[membershipRole] || membershipRole || "—"}</dd></div>
          </dl>
        )}
        {!editingProfile ? (
          <button type="button" className="hub-secondary" onClick={() => { profileEditor.resetStatus(); setEditingProfile(true); }}>Editar perfil</button>
        ) : null}
        {!editingProfile && profileEditor.success ? <p className="hub-account-success"><Check size={12} />Guardado</p> : null}
      </section>

      <section className="hub-section">
        <h2><UsersIcon size={16} />Equipo</h2>
        {membersLoading ? (
          <p className="hub-field-hint">Cargando…</p>
        ) : membersError ? (
          <p className="hub-account-error" role="alert">{membersError}</p>
        ) : (
          <div className="hub-list">
            {members.map((member) => {
              const isSelf = member.userId === user?.id;
              return (
                <div key={member.userId} className="hub-list-row">
                  <div>
                    <strong>{isSelf ? (profileDisplayName(user) || user?.email || "Tú") : "Miembro del equipo"}{isSelf ? " (Tú)" : ""}</strong>
                    <small>Miembro desde {new Date(member.createdAt).toLocaleDateString("es-US")}</small>
                  </div>
                  <div className="hub-list-row-meta">
                    <StatusBadge tone={member.role === "owner" ? "success" : "neutral"} label={ROLE_LABEL[member.role] || member.role} />
                    {isOwner && !isSelf && member.role !== "owner" && member.role !== "admin" ? (
                      <button type="button" className="hub-chip-btn is-primary" disabled={changingRoleFor === member.userId} onClick={() => void promoteToAdmin(member.userId)}>
                        {changingRoleFor === member.userId ? "Actualizando…" : "Hacer administrador"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {roleChangeNotice ? <p className="hub-field-hint" role="status">{roleChangeNotice}</p> : null}
        <p className="hub-field-hint">
          {isOwner
            ? "Agregar nuevas personas al equipo todavía no está disponible desde el dashboard — contacta a soporte para invitar a alguien nuevo."
            : "Solo un propietario puede administrar quién forma parte del equipo."}
        </p>
      </section>

      <section className="hub-section">
        <h2><MessageCircle size={16} />WhatsApp</h2>
        {loading ? (
          <p className="hub-field-hint">Cargando…</p>
        ) : (
          <dl className="hub-facts">
            <div><dt>Número conectado</dt><dd>{whatsapp?.whatsapp_phone_number || whatsapp?.whatsapp_display_name || "Sin conectar"}</dd></div>
            <div><dt>Estado de conexión</dt><dd><StatusBadge tone={whatsappConnected ? "success" : "neutral"} label={whatsappConnected ? "Conectado" : "Sin conectar"} /></dd></div>
            <div><dt>Automatización</dt><dd><StatusBadge tone={automationOn ? "success" : "warning"} label={automationOn ? "Activa" : "Pausada"} /></dd></div>
          </dl>
        )}
        <Link className="hub-secondary" to="/integrations">Administrar conexión</Link>
      </section>

      <section className="hub-section">
        <h2><Bell size={16} />Notificaciones</h2>
        <p className="hub-field-hint">Todavía no hay notificaciones configurables desde aquí — cada solicitud, mensaje y ubicación pendiente ya aparece en Inicio y Mensajes en tiempo real, pero no existe hoy un envío de alertas independiente (push, email o WhatsApp interno) para activar o desactivar.</p>
      </section>

      <section className="hub-section">
        <h2><Clock size={16} />Horarios</h2>
        <dl className="hub-facts">
          <div><dt>Zona horaria</dt><dd>{whatsapp?.timezone || "America/Tegucigalpa"}</dd></div>
        </dl>
        <p className="hub-field-hint">Los horarios de silencio y seguimiento automático todavía no están configurables desde aquí.</p>
      </section>

      <section className="hub-section">
        <h2><Building2 size={16} />Organización</h2>
        <div className="hub-field">
          <label htmlFor="org-name">Nombre de la organización</label>
          <input id="org-name" value={orgName} disabled={!canEditOrg} onChange={(e) => setOrgName(e.target.value)} onBlur={() => void saveOrgName()} />
          {!canEditOrg ? <p className="hub-field-hint">Solo un propietario o administrador puede cambiar este nombre.</p> : null}
        </div>
        {savingOrgName ? <p className="hub-field-hint">Guardando…</p> : orgNotice ? <p className="hub-field-hint" role="status">{orgNotice}</p> : null}
      </section>
    </div>
  );
}
