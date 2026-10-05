import { AlertTriangle, CheckCircle2, MailPlus, ShieldCheck, UserRound, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type PartnerMembership = {
  id: string;
  user_id: string;
  email: string | null;
  role: "partner_admin" | "partner_agent";
  active: boolean;
  created_at: string;
  updated_at: string;
};

type ListResponse = { success: boolean; memberships?: PartnerMembership[]; error?: string };
type InviteResponse = { success: boolean; invitation_sent?: boolean; membership?: PartnerMembership; error?: string };

const ROLE_LABEL: Record<PartnerMembership["role"], string> = {
  partner_admin: "Administrador del partner",
  partner_agent: "Agente del partner",
};

export default function PartnerAccessPanel({ partnerId }: { partnerId: string }) {
  const [memberships, setMemberships] = useState<PartnerMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PartnerMembership["role"]>("partner_admin");
  const [savingId, setSavingId] = useState<string | null>(null);

  async function invoke(body: Record<string, unknown>) {
    const result = await supabase.functions.invoke("admin-partner-access", { body });
    if (result.error) throw new Error(result.error.message);
    const data = result.data as { success?: boolean; error?: string };
    if (!data?.success) throw new Error(data?.error || "No se pudo completar la acción.");
    return result.data;
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await invoke({ action: "list", partner_id: partnerId }) as ListResponse;
      setMemberships(data.memberships ?? []);
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [partnerId]);

  async function invite() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Ingresa un correo válido.");
      return;
    }
    setInviting(true);
    setError("");
    setNotice("");
    try {
      const data = await invoke({ action: "invite", partner_id: partnerId, email: cleanEmail, role }) as InviteResponse;
      setEmail("");
      setNotice(data.invitation_sent ? "Invitación enviada y acceso creado." : "El usuario ya existía; acceso al partner activado.");
      await load();
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setInviting(false);
    }
  }

  async function updateMembership(membership: PartnerMembership, patch: Partial<Pick<PartnerMembership, "role" | "active">>) {
    setSavingId(membership.id);
    setError("");
    setNotice("");
    try {
      await invoke({
        action: "update",
        partner_id: partnerId,
        membership_id: membership.id,
        ...patch,
      });
      setNotice("Acceso actualizado.");
      await load();
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="hub-section">
      <div className="hub-section-heading">
        <div>
          <h2><ShieldCheck size={17} /> Acceso al Portal Partner</h2>
          <p className="hub-field-hint">Invita usuarios, define su rol y revoca o reactiva acceso sin salir de ConeXXion.</p>
        </div>
      </div>

      {error ? <p className="hub-account-error" role="alert"><AlertTriangle size={14} /> {error}</p> : null}
      {notice ? <p className="hub-account-success" role="status"><CheckCircle2 size={14} /> {notice}</p> : null}

      <div className="hub-field-group">
        <div className="hub-field">
          <label htmlFor={`partner-invite-${partnerId}`}>Correo</label>
          <input
            id={`partner-invite-${partnerId}`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="persona@partner.com"
            autoComplete="email"
          />
        </div>
        <div className="hub-field">
          <label htmlFor={`partner-role-${partnerId}`}>Rol</label>
          <select id={`partner-role-${partnerId}`} value={role} onChange={(event) => setRole(event.target.value as PartnerMembership["role"])}>
            <option value="partner_admin">Administrador del partner</option>
            <option value="partner_agent">Agente del partner</option>
          </select>
        </div>
        <button type="button" className="hub-primary" disabled={inviting} onClick={() => void invite()}>
          <MailPlus size={15} /> {inviting ? "Enviando…" : "Enviar invitación"}
        </button>
      </div>

      <div className="hub-list">
        {loading ? <div className="hub-list-row"><div><strong>Cargando accesos…</strong></div></div> : null}
        {!loading && memberships.length === 0 ? (
          <div className="hub-list-row"><div><strong>Sin usuarios con acceso</strong><small>Invita a la primera persona del partner.</small></div></div>
        ) : null}
        {memberships.map((membership) => (
          <div className="hub-list-row" key={membership.id}>
            <div>
              <strong><UserRound size={14} /> {membership.email || "Usuario"}</strong>
              <small>{ROLE_LABEL[membership.role]} · {membership.active ? "Acceso activo" : "Acceso revocado"}</small>
            </div>
            <div className="hub-list-row-meta">
              <select
                aria-label={`Rol de ${membership.email || "usuario"}`}
                value={membership.role}
                disabled={savingId === membership.id}
                onChange={(event) => void updateMembership(membership, { role: event.target.value as PartnerMembership["role"] })}
              >
                <option value="partner_admin">Admin</option>
                <option value="partner_agent">Agente</option>
              </select>
              <button
                type="button"
                className={membership.active ? "hub-chip-btn" : "hub-chip-btn is-primary"}
                disabled={savingId === membership.id}
                onClick={() => void updateMembership(membership, { active: !membership.active })}
              >
                {membership.active ? <><UserX size={14} />Revocar</> : <><ShieldCheck size={14} />Reactivar</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
