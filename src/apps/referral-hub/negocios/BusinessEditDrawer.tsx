import { Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { BENEFIT_SERVICE_IDS, LEGAL_SERVICE_IDS, SERVICE_LABELS, type LuisServiceId } from "../operations/luisCatalog";
import type { Business, BusinessEditInput, BusinessFaq, BusinessHours } from "./types";

const CATEGORY_OPTIONS: LuisServiceId[] = [...BENEFIT_SERVICE_IDS, ...LEGAL_SERVICE_IDS];
const DAYS: Array<{ id: keyof BusinessHours; label: string }> = [
  { id: "mon", label: "Lunes" },
  { id: "tue", label: "Martes" },
  { id: "wed", label: "Miércoles" },
  { id: "thu", label: "Jueves" },
  { id: "fri", label: "Viernes" },
  { id: "sat", label: "Sábado" },
  { id: "sun", label: "Domingo" },
];
const MAX_FAQS = 5;
const POSTAL_CODE_PATTERN = /^\d{5}$/;

function fieldsEqual(a: BusinessEditInput, b: BusinessEditInput): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function BusinessEditDrawer({ business, onClose, onSave, canPersist }: {
  business: Business;
  onClose: () => void;
  onSave: (patch: Partial<BusinessEditInput>) => Promise<void>;
  canPersist: boolean;
}) {
  const initial = useMemo<BusinessEditInput>(() => ({
    name: business.name,
    categoryServiceId: business.categoryServiceId,
    contactName: business.contactName,
    phone: business.phone,
    addressText: business.addressText,
    postalCode: business.postalCode,
    imageUrl: business.imageUrl,
    hours: business.hours,
    active: business.active,
    offersCoupon: business.offersCoupon,
    receivesServiceRequests: business.receivesServiceRequests,
    faqs: business.faqs,
  }), [business]);

  const [form, setForm] = useState<BusinessEditInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = !fieldsEqual(form, initial);

  function update<K extends keyof BusinessEditInput>(key: K, value: BusinessEditInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateDay(day: keyof BusinessHours, patch: { open?: string; close?: string } | null) {
    setForm((prev) => {
      const nextHours = { ...prev.hours };
      if (patch === null) { delete nextHours[day]; return { ...prev, hours: nextHours }; }
      nextHours[day] = { open: patch.open ?? nextHours[day]?.open ?? "09:00", close: patch.close ?? nextHours[day]?.close ?? "18:00" };
      return { ...prev, hours: nextHours };
    });
  }

  function addFaq() {
    if (form.faqs.length >= MAX_FAQS) return;
    update("faqs", [...form.faqs, { question: "", answer: "" }]);
  }
  function updateFaq(index: number, patch: Partial<BusinessFaq>) {
    update("faqs", form.faqs.map((faq, i) => (i === index ? { ...faq, ...patch } : faq)));
  }
  function removeFaq(index: number) {
    update("faqs", form.faqs.filter((_, i) => i !== index));
  }

  function requestClose() {
    if (dirty && !window.confirm("Tenés cambios sin guardar. ¿Salir sin guardar?")) return;
    onClose();
  }

  async function submit() {
    if (!form.name.trim()) { setError("Ingresa el nombre del negocio."); return; }
    if (form.postalCode && !POSTAL_CODE_PATTERN.test(form.postalCode.trim())) {
      setError("El código postal debe tener 5 dígitos.");
      return;
    }
    for (const faq of form.faqs) {
      if ((faq.question.trim() && !faq.answer.trim()) || (!faq.question.trim() && faq.answer.trim())) {
        setError("Completá tanto la pregunta como la respuesta, o eliminá la fila.");
        return;
      }
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await onSave({
        ...form,
        name: form.name.trim(),
        contactName: form.contactName?.trim() || null,
        phone: form.phone?.trim() || null,
        addressText: form.addressText?.trim() || null,
        postalCode: form.postalCode?.trim() || null,
        faqs: form.faqs.filter((faq) => faq.question.trim() && faq.answer.trim()),
      });
      setNotice(canPersist ? "Guardado." : "Guardado localmente en esta sesión — todavía no se guarda en el servidor.");
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="hub-drawer-scrim" aria-label="Cerrar" onClick={requestClose} />
      <div className="hub-drawer" role="dialog" aria-label="Editar negocio">
        <div className="hub-drawer-header"><h2>Editar negocio</h2><button type="button" className="hub-drawer-close" onClick={requestClose} aria-label="Cerrar"><X size={18} /></button></div>
        <div className="hub-drawer-body">
          {!canPersist ? (
            <p className="hub-blocked-note">Los cambios se guardan localmente en esta sesión mientras se habilita el guardado en el servidor.</p>
          ) : null}
          <div className="hub-field">
            <label htmlFor="edit-business-name">Nombre</label>
            <input id="edit-business-name" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Nombre del negocio" />
          </div>
          <div className="hub-field">
            <label htmlFor="edit-business-category">Categoría</label>
            <select id="edit-business-category" value={form.categoryServiceId} onChange={(e) => update("categoryServiceId", e.target.value)}>
              {CATEGORY_OPTIONS.map((id) => <option key={id} value={id}>{SERVICE_LABELS[id]}</option>)}
            </select>
          </div>
          <div className="hub-field">
            <label htmlFor="edit-business-contact">Persona de contacto</label>
            <input id="edit-business-contact" value={form.contactName ?? ""} onChange={(e) => update("contactName", e.target.value)} placeholder="Pendiente — agregar nombre" />
          </div>
          <div className="hub-field">
            <label htmlFor="edit-business-phone">Teléfono</label>
            <input id="edit-business-phone" value={form.phone ?? ""} onChange={(e) => update("phone", e.target.value)} placeholder="Pendiente — agregar teléfono" />
          </div>
          <div className="hub-field">
            <label htmlFor="edit-business-address">Dirección</label>
            <input id="edit-business-address" value={form.addressText ?? ""} onChange={(e) => update("addressText", e.target.value)} placeholder="Pendiente — agregar dirección" />
          </div>
          <div className="hub-field">
            <label htmlFor="edit-business-postal">Código postal</label>
            <input id="edit-business-postal" value={form.postalCode ?? ""} onChange={(e) => update("postalCode", e.target.value)} placeholder="Pendiente — agregar ZIP" inputMode="numeric" maxLength={5} />
          </div>
          <div className="hub-field">
            <label htmlFor="edit-business-image">Imagen del negocio (opcional)</label>
            <input id="edit-business-image" value={form.imageUrl ?? ""} onChange={(e) => update("imageUrl", e.target.value || null)} placeholder="https://…" />
            <p className="hub-field-hint">Si lo dejás vacío, se usa la imagen del cupón asociado cuando exista.</p>
          </div>
          <div className="hub-field">
            <span className="hub-field-label">Horarios</span>
            <div className="hub-hours-grid">
              {DAYS.map((day) => {
                const value = form.hours[day.id];
                return (
                  <div key={day.id} className="hub-hours-row">
                    <label className="hub-hours-day">
                      <input type="checkbox" checked={Boolean(value)} onChange={(e) => updateDay(day.id, e.target.checked ? {} : null)} />
                      {day.label}
                    </label>
                    {value ? (
                      <div className="hub-hours-times">
                        <input type="time" value={value.open} onChange={(e) => updateDay(day.id, { open: e.target.value })} aria-label={`${day.label} abre`} />
                        <span>–</span>
                        <input type="time" value={value.close} onChange={(e) => updateDay(day.id, { close: e.target.value })} aria-label={`${day.label} cierra`} />
                      </div>
                    ) : <span className="hub-hours-closed">Cerrado</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <label className="hub-delivery-toggle">
            <div><strong>Negocio activo</strong><small>Un negocio pausado no aparece como opción activa</small></div>
            <input type="checkbox" checked={form.active} onChange={(e) => update("active", e.target.checked)} />
          </label>
          <label className="hub-delivery-toggle">
            <div><strong>Ofrece cupón</strong><small>Aparece en la sección Cupones</small></div>
            <input type="checkbox" checked={form.offersCoupon} onChange={(e) => update("offersCoupon", e.target.checked)} />
          </label>
          <label className="hub-delivery-toggle">
            <div><strong>Recibe solicitudes</strong><small>Aparece en su categoría de servicio</small></div>
            <input type="checkbox" checked={form.receivesServiceRequests} onChange={(e) => update("receivesServiceRequests", e.target.checked)} />
          </label>
          <div className="hub-field">
            <span className="hub-field-label">Preguntas frecuentes (opcional, hasta {MAX_FAQS})</span>
            {form.faqs.map((faq, index) => (
              <div key={index} className="hub-faq-row">
                <input value={faq.question} onChange={(e) => updateFaq(index, { question: e.target.value })} placeholder="Ej. ¿Necesito cita?" aria-label="Pregunta" />
                <input value={faq.answer} onChange={(e) => updateFaq(index, { answer: e.target.value })} placeholder="Respuesta" aria-label="Respuesta" />
                <button type="button" className="hub-icon-btn" onClick={() => removeFaq(index)} aria-label="Eliminar pregunta"><Trash2 size={15} /></button>
              </div>
            ))}
            {form.faqs.length < MAX_FAQS ? (
              <button type="button" className="hub-chip-btn" onClick={addFaq}><Plus size={14} />Agregar pregunta</button>
            ) : null}
          </div>
          {error ? <p className="hub-account-error" role="alert">{error}</p> : null}
          {notice ? <p className="hub-field-hint" role="status">{notice}</p> : null}
        </div>
        <div className="hub-drawer-footer">
          <button type="button" className="hub-secondary" onClick={requestClose}>Cancelar</button>
          <button type="button" className="hub-primary" disabled={saving || !dirty} onClick={() => void submit()}>{saving ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </>
  );
}
