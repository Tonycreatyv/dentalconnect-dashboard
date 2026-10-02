import { Check, ChevronRight, LogOut, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { profileDisplayName, profilePhone, useProfileEditor } from "../operations/useProfileEditor";
import Avatar from "./Avatar";

export default function AccountMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(profileDisplayName(user));
  const [phoneInput, setPhoneInput] = useState(profilePhone(user));
  const { saving, error, success, saveProfile, resetStatus } = useProfileEditor();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNameInput(profileDisplayName(user));
    setPhoneInput(profilePhone(user));
  }, [user]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) { setOpen(false); setEditing(false); }
    }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); setEditing(false); } }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function go(to: string) { setOpen(false); navigate(to); }

  async function logout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  async function saveProfileFields() {
    const ok = await saveProfile({ fullName: nameInput, phone: phoneInput });
    if (ok) setEditing(false);
  }

  const name = profileDisplayName(user);

  return (
    <div className="hub-account-menu" ref={ref}>
      <button type="button" className="hub-account-trigger" aria-label="Cuenta" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Avatar name={name || user?.email || "Cuenta"} seed={user?.id} size={36} />
      </button>
      {open ? (
        <div className="hub-account-dropdown" role="menu">
          <div className="hub-account-head">
            <p className="hub-eyebrow">Cuenta</p>
            {editing ? (
              <div className="hub-account-edit">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Tu nombre"
                  aria-label="Tu nombre"
                />
                <input
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="Teléfono (opcional)"
                  aria-label="Tu teléfono"
                />
                <div className="hub-account-edit-actions">
                  <button type="button" className="hub-chip-btn" onClick={() => { setEditing(false); setNameInput(name); setPhoneInput(profilePhone(user)); resetStatus(); }}>Cancelar</button>
                  <button type="button" className="hub-chip-btn is-primary" disabled={saving} onClick={() => void saveProfileFields()}>{saving ? "Guardando…" : "Guardar"}</button>
                </div>
                {error ? <p className="hub-account-error" role="alert">{error}</p> : null}
              </div>
            ) : (
              <button type="button" className="hub-account-name" onClick={() => { resetStatus(); setEditing(true); }}>
                <strong>{name || "Agregar tu nombre"}</strong>
                <span>{user?.email}</span>
                {success ? <span className="hub-account-success"><Check size={12} />Guardado</span> : null}
              </button>
            )}
          </div>
          <div className="hub-account-links">
            <button type="button" onClick={() => go("/configuracion")}><Settings size={16} /><span>Configuración</span><ChevronRight size={15} /></button>
          </div>
          <div className="hub-account-links">
            <button type="button" className="is-danger" onClick={() => void logout()}><LogOut size={16} /><span>Cerrar sesión</span></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
