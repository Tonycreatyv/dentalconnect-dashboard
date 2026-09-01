import { X } from "lucide-react";
import { useState } from "react";
import { BENEFIT_SERVICE_IDS, LEGAL_SERVICE_IDS, SERVICE_LABELS, type LuisServiceId } from "../operations/luisCatalog";
import type { NewBusinessInput } from "./types";

const CATEGORY_OPTIONS: LuisServiceId[] = [...BENEFIT_SERVICE_IDS, ...LEGAL_SERVICE_IDS];

export default function NewBusinessDrawer({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (input: NewBusinessInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [categoryServiceId, setCategoryServiceId] = useState<LuisServiceId>(CATEGORY_OPTIONS[0]);
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [addressText, setAddressText] = useState("");
  const [offersCoupon, setOffersCoupon] = useState(false);
  const [receivesServiceRequests, setReceivesServiceRequests] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim()) { setError("Ingresa el nombre del negocio."); return; }
    setSaving(true);
    setError("");
    try {
      await onCreate({
        name: name.trim(),
        categoryServiceId,
        contactName: contactName.trim() || null,
        phone: phone.trim() || null,
        addressText: addressText.trim() || null,
        offersCoupon,
        receivesServiceRequests,
      });
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="hub-drawer-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="hub-drawer" role="dialog" aria-label="Agregar negocio">
        <div className="hub-drawer-header"><h2>Agregar negocio</h2><button type="button" className="hub-drawer-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        <div className="hub-drawer-body">
          <div className="hub-field">
            <label htmlFor="business-name">Nombre del negocio</label>
            <input id="business-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Clínica San Rafael" />
          </div>
          <div className="hub-field">
            <label htmlFor="business-category">Categoría / servicio</label>
            <select id="business-category" value={categoryServiceId} onChange={(e) => setCategoryServiceId(e.target.value as LuisServiceId)}>
              {CATEGORY_OPTIONS.map((id) => <option key={id} value={id}>{SERVICE_LABELS[id]}</option>)}
            </select>
          </div>
          <div className="hub-field">
            <label htmlFor="business-contact">Persona de contacto</label>
            <input id="business-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="hub-field">
            <label htmlFor="business-phone">Teléfono</label>
            <input id="business-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="hub-field">
            <label htmlFor="business-address">Dirección</label>
            <input id="business-address" value={addressText} onChange={(e) => setAddressText(e.target.value)} placeholder="Opcional" />
          </div>
          <label className="hub-delivery-toggle">
            <div><strong>Ofrece cupón</strong><small>Aparecerá en Cupones una vez que tenga una campaña de cupón vinculada</small></div>
            <input type="checkbox" checked={offersCoupon} onChange={(e) => setOffersCoupon(e.target.checked)} />
          </label>
          {offersCoupon ? (
            <p className="hub-blocked-note">
              Un negocio nuevo no tiene automáticamente un cupón enviable por WhatsApp: hoy solo existen 4 tipos de beneficio configurados en el sistema de envío. Configurá el cupón desde Cupones una vez que el tipo de beneficio exista ahí.
            </p>
          ) : null}
          <label className="hub-delivery-toggle">
            <div><strong>Recibe solicitudes de servicio</strong><small>Aparecerá en Negocios y en su categoría</small></div>
            <input type="checkbox" checked={receivesServiceRequests} onChange={(e) => setReceivesServiceRequests(e.target.checked)} />
          </label>
          {error ? <p className="hub-account-error" role="alert">{error}</p> : null}
        </div>
        <div className="hub-drawer-footer">
          <button type="button" className="hub-primary" disabled={saving} onClick={() => void submit()}>{saving ? "Guardando…" : "Agregar negocio"}</button>
        </div>
      </div>
    </>
  );
}
