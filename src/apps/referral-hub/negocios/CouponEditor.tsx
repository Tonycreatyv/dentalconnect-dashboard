import { AlertTriangle, ArrowLeft, CheckCircle2, History, ImageOff, MapPin, Save, Tag } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { renderCouponMessage } from "../operations/couponMessageTemplate";
import DemoBadge from "./DemoBadge";
import { getActiveNegociosDataSource } from "./dataSource";
import ImageLightbox from "./ImageLightbox";
import StorageUploadField from "./StorageUploadField";
import TokenToolbar from "./TokenToolbar";
import { toDisplayText, toStoredText } from "./tokenDisplay";
import { isSupermarketCampaignKey, resolveSelectedLocationPreview } from "./supermarketCoupon";
import type { Business, Coupon, SupermarketLocation } from "./types";

const dataSource = getActiveNegociosDataSource();
const PREVIEW_SAMPLE = { customer_first_name: "María", claim_code: "LG-A1B2" };

type AuditEvent = {
  id: string;
  event_type: string;
  actor_email: string | null;
  metadata: { changed_fields?: string[]; location_id?: string } | null;
  occurred_at: string;
};

function MessagePreview({ coupon, customerCopy, businessName, imageUrl, onOpenImage }: {
  coupon: Coupon;
  customerCopy: string;
  businessName: string;
  imageUrl: string;
  onOpenImage: () => void;
}) {
  const rendered = useMemo(() => {
    if (!customerCopy.trim()) return null;
    try {
      return {
        text: renderCouponMessage(customerCopy, {
          customer_first_name: PREVIEW_SAMPLE.customer_first_name,
          business_name: businessName || "(elegí un negocio)",
          benefit_name: coupon.displayName,
          claim_code: PREVIEW_SAMPLE.claim_code,
          address: "",
        }),
        error: null as string | null,
      };
    } catch {
      return { text: null, error: "Revisá el mensaje: parece que falta cerrar un dato insertado." };
    }
  }, [customerCopy, coupon.displayName, businessName]);

  return (
    <div className="hub-coupon-preview">
      <span className="hub-coupon-preview-meta">Vista previa exacta del mensaje de WhatsApp</span>
      {imageUrl ? (
        <button type="button" className="hub-coupon-preview-image-btn" onClick={onOpenImage} aria-label="Ver imagen completa">
          <img src={imageUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
        </button>
      ) : (
        <div className="hub-coupon-preview-image-empty"><ImageOff size={18} /></div>
      )}
      {rendered?.error ? (
        <p className="hub-coupon-preview-error">{rendered.error}</p>
      ) : rendered?.text ? (
        <p className="hub-coupon-preview-bubble">{rendered.text}</p>
      ) : (
        <p className="hub-coupon-preview-bubble">Sin mensaje personalizado todavía — se envía el mensaje del sistema.</p>
      )}
      <span className="hub-coupon-preview-meta" style={{ color: "#8FE3B8", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
        Nombre y código son valores de ejemplo — se reemplazan por los datos reales del cliente al enviarse.
      </span>
    </div>
  );
}

function LocationCard({ location, selected, onSelect }: { location: SupermarketLocation; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={selected ? "hub-location-card is-selected" : "hub-location-card"} onClick={onSelect}>
      {location.officialMediaUrl ? <img src={location.officialMediaUrl} alt="" /> : <div className="hub-location-card-image-empty"><ImageOff size={16} /></div>}
      <div><strong>{location.displayName}</strong><small>{location.addressText || `ZIP ${location.postalCode}`}</small></div>
    </button>
  );
}

function snapshot(coupon: Coupon, copyDisplay: string) {
  return JSON.stringify({
    displayName: coupon.displayName,
    businessId: coupon.businessId,
    imageUrl: coupon.imageUrl,
    customerCopy: toStoredText(copyDisplay),
    termsText: coupon.termsText,
    active: coupon.active,
    expiresAt: coupon.expiresAt,
    deliverySource: coupon.deliverySource,
  });
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    display_name: "Nombre",
    business_id: "Negocio",
    image_url: "Imagen",
    customer_copy: "Mensaje",
    terms_text: "Condiciones",
    active: "Estado",
    expires_at: "Vigencia",
    delivery_source: "Fuente del mensaje",
    official_media_url: "Imagen de ubicación",
  };
  return labels[field] ?? field;
}

export default function CouponEditor() {
  const { couponId = "" } = useParams();
  const location = useLocation();
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [persistedSnapshot, setPersistedSnapshot] = useState("");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [locations, setLocations] = useState<SupermarketLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copyDisplay, setCopyDisplay] = useState("");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const copyTextareaRef = useRef<HTMLTextAreaElement>(null);

  async function invokeAdmin(body: Record<string, unknown>) {
    const result = await supabase.functions.invoke("admin-coupon-management", { body });
    if (result.error) throw new Error(result.error.message);
    if (!result.data?.success) throw new Error(result.data?.error || "No se pudo completar la acción.");
    return result.data;
  }

  async function loadHistory() {
    setAuditLoading(true);
    try {
      const data = await invokeAdmin({ action: "history", coupon_id: couponId });
      setAuditEvents((data.events ?? []) as AuditEvent[]);
    } catch {
      setAuditEvents([]);
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([dataSource.getCoupon(couponId), dataSource.listBusinesses()])
      .then(([couponRow, businessRows]) => {
        setCoupon(couponRow);
        setBusinesses(businessRows);
        const initialCopy = couponRow ? toDisplayText(couponRow.customerCopy) : "";
        setCopyDisplay(initialCopy);
        if (couponRow) setPersistedSnapshot(snapshot(couponRow, initialCopy));
        setError(couponRow ? "" : "Cupón no encontrado.");
        if (couponRow && isSupermarketCampaignKey(couponRow.campaignKey)) {
          dataSource.listSupermarketLocations(couponRow.campaignKey).then((rows) => {
            setLocations(rows);
            setSelectedLocationId((current) => current && rows.some((r) => r.id === current) ? current : (rows[0]?.id ?? ""));
          });
        } else {
          setLocations([]);
          setSelectedLocationId("");
        }
      })
      .catch(() => setError("No se pudo cargar el cupón."))
      .finally(() => setLoading(false));
    void loadHistory();
  }, [couponId]);

  const backTo = (location.state as { from?: string } | null)?.from || "/negocios?view=cupones";

  if (loading) return <div className="hub-page"><Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link><EmptyState icon={Tag} title="Cargando cupón…" /></div>;
  if (error || !coupon) return <div className="hub-page"><Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link><EmptyState tone="error" icon={AlertTriangle} title="No se pudo cargar el cupón" description={error} /></div>;

  const business = businesses.find((b) => b.id === coupon.businessId);
  const canPersist = dataSource.capabilities.canEditCoupon;
  const canEditLocationImages = dataSource.capabilities.canEditLocationImages;
  const canUploadImages = dataSource.capabilities.canUploadImages;
  const persistentBusinesses = businesses.filter((item) => item.id.startsWith("partner:"));
  const currentBusinessIsPersistent = !coupon.businessId || coupon.businessId.startsWith("partner:");
  const isLocationBasedCoupon = isSupermarketCampaignKey(coupon.campaignKey);
  const selectedLocationPreview = resolveSelectedLocationPreview(locations, selectedLocationId);
  const selectedLocation = selectedLocationPreview.location;
  const previewImageUrl = isLocationBasedCoupon ? selectedLocationPreview.imageUrl : coupon.imageUrl;
  const previewBusinessName = isLocationBasedCoupon ? selectedLocationPreview.businessName : (business?.name ?? "");
  const dirty = snapshot(coupon, copyDisplay) !== persistedSnapshot;
  const customMessageBlocked = coupon.deliverySource === "db" && !coupon.businessId.startsWith("partner:");

  async function saveCoupon() {
    if (!dirty || customMessageBlocked) return;
    setSaving(true);
    setNotice("");
    try {
      await invokeAdmin({
        action: "update",
        coupon_id: couponId,
        patch: {
          display_name: coupon.displayName.trim(),
          business_id: coupon.businessId.startsWith("partner:") ? coupon.businessId.slice("partner:".length) : null,
          image_url: coupon.imageUrl.trim() || null,
          customer_copy: toStoredText(copyDisplay).trim() || null,
          terms_text: coupon.termsText.trim() || null,
          active: coupon.active,
          expires_at: coupon.expiresAt,
          delivery_source: coupon.deliverySource,
        },
      });
      const refreshed = await dataSource.getCoupon(couponId);
      if (!refreshed) throw new Error("Cupón no encontrado después de guardar.");
      const refreshedCopy = toDisplayText(refreshed.customerCopy);
      setCoupon(refreshed);
      setCopyDisplay(refreshedCopy);
      setPersistedSnapshot(snapshot(refreshed, refreshedCopy));
      setNotice("Cambios guardados y registrados en el historial.");
      await loadHistory();
    } catch (reason) {
      setNotice(`No se pudo guardar: ${String((reason as Error)?.message || reason)}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveLocationImage() {
    if (!selectedLocation) return;
    setSaving(true);
    setNotice("");
    try {
      await invokeAdmin({
        action: "update_location_image",
        coupon_id: couponId,
        location_id: selectedLocation.id,
        image_url: selectedLocation.officialMediaUrl,
      });
      setNotice(`Imagen de ${selectedLocation.displayName} guardada y auditada.`);
      await loadHistory();
    } catch (reason) {
      setNotice(`No se pudo guardar la imagen: ${String((reason as Error)?.message || reason)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hub-page">
      <Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link>
      <PageHeader eyebrow="Cupón" title={coupon.displayName} meta={dataSource.mode === "demo" ? <DemoBadge /> : null} />

      {!canPersist ? <p className="hub-blocked-note">Este cupón todavía no tiene escritura persistente habilitada.</p> : null}
      {dirty ? <p className="hub-field-hint">Tenés cambios sin guardar.</p> : null}
      {customMessageBlocked ? <p className="hub-account-error"><AlertTriangle size={14} />Para usar un mensaje personalizado primero vinculá este beneficio a un partner persistente.</p> : null}

      <div style={{ position: "sticky", top: 8, zIndex: 8, display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button type="button" className="hub-primary" disabled={!dirty || saving || customMessageBlocked} onClick={() => void saveCoupon()}>
          <Save size={16} />{saving ? "Guardando…" : dirty ? "Guardar cambios" : "Guardado"}
        </button>
      </div>

      {isLocationBasedCoupon ? (
        <p className="hub-field-hint">Este beneficio usa ubicaciones reales. Elegí una para revisar su imagen exacta.</p>
      ) : null}

      <MessagePreview coupon={coupon} customerCopy={isLocationBasedCoupon ? "" : toStoredText(copyDisplay)} businessName={previewBusinessName} imageUrl={previewImageUrl} onOpenImage={() => setLightboxOpen(true)} />
      {lightboxOpen && previewImageUrl ? <ImageLightbox src={previewImageUrl} alt={previewBusinessName || coupon.displayName} onClose={() => setLightboxOpen(false)} /> : null}

      <section className="hub-section">
        <h2>Cupón</h2>
        <div className="hub-field">
          <label htmlFor="coupon-name">Nombre del cupón</label>
          <input id="coupon-name" value={coupon.displayName} onChange={(e) => setCoupon({ ...coupon, displayName: e.target.value })} />
        </div>
        {!isLocationBasedCoupon ? (
          <div className="hub-field">
            <label htmlFor="coupon-business">Negocio asociado</label>
            {currentBusinessIsPersistent ? (
              <select id="coupon-business" value={coupon.businessId} onChange={(e) => setCoupon({ ...coupon, businessId: e.target.value })}>
                <option value="">Sin asignar</option>
                {persistentBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : <p className="hub-field-hint">{business?.name || "Negocio configurado por el sistema"} · asociación de solo lectura</p>}
          </div>
        ) : null}
      </section>

      {isLocationBasedCoupon ? (
        <section className="hub-section">
          <h2><MapPin size={16} />Ubicaciones participantes</h2>
          {locations.length === 0 ? <EmptyState icon={MapPin} title="Sin ubicaciones activas" description="No hay ubicaciones activas configuradas para este beneficio." /> : (
            <>
              <div className="hub-location-grid">
                {locations.map((loc) => <LocationCard key={loc.id} location={loc} selected={loc.id === selectedLocationId} onSelect={() => setSelectedLocationId(loc.id)} />)}
              </div>
              {selectedLocation ? (
                <div className="hub-location-editor">
                  <p className="hub-field-hint">Estás editando solamente <strong>{selectedLocation.displayName}</strong>.</p>
                  {canUploadImages ? <StorageUploadField onLocalPreview={() => {}} /> : null}
                  <div className="hub-field">
                    <label htmlFor="location-image">Imagen de esta ubicación</label>
                    <input id="location-image" value={selectedLocation.officialMediaUrl} onChange={(e) => setLocations((rows) => rows.map((r) => r.id === selectedLocationId ? { ...r, officialMediaUrl: e.target.value } : r))} placeholder="https://…" />
                  </div>
                  <button type="button" className="hub-secondary" disabled={!canEditLocationImages || saving || !selectedLocation.officialMediaUrl.startsWith("https://")} onClick={() => void saveLocationImage()}>
                    <Save size={15} />Guardar imagen de esta ubicación
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : (
        <section className="hub-section">
          <h2>Imagen del cupón</h2>
          {canUploadImages ? <StorageUploadField onLocalPreview={() => {}} /> : null}
          <div className="hub-field">
            <label htmlFor="coupon-image">Enlace de la imagen</label>
            <input id="coupon-image" value={coupon.imageUrl} onChange={(e) => setCoupon({ ...coupon, imageUrl: e.target.value })} placeholder="https://…" />
          </div>
        </section>
      )}

      {!isLocationBasedCoupon ? (
        <section className="hub-section">
          <h2>Mensaje de WhatsApp</h2>
          <TokenToolbar textareaRef={copyTextareaRef} value={copyDisplay} onChange={setCopyDisplay} />
          <div className="hub-field">
            <label htmlFor="coupon-copy">Mensaje completo</label>
            <textarea id="coupon-copy" ref={copyTextareaRef} className="hub-textarea" value={copyDisplay} onChange={(e) => setCopyDisplay(e.target.value)} />
          </div>
          <div className="hub-field">
            <label htmlFor="coupon-terms">Condiciones</label>
            <textarea id="coupon-terms" className="hub-textarea" style={{ minHeight: 70 }} value={coupon.termsText} onChange={(e) => setCoupon({ ...coupon, termsText: e.target.value })} />
          </div>
          {copyDisplay.trim() ? (
            <label className="hub-delivery-toggle">
              <div><strong>Usar mi mensaje personalizado</strong><small>Solo se activa cuando el beneficio está vinculado a un partner persistente.</small></div>
              <input type="checkbox" checked={coupon.deliverySource === "db"} onChange={(e) => setCoupon({ ...coupon, deliverySource: e.target.checked ? "db" : "legacy" })} />
            </label>
          ) : null}
        </section>
      ) : (
        <section className="hub-section"><h2>Mensaje de WhatsApp</h2><p className="hub-field-hint">Este beneficio conserva el mensaje estándar del sistema y la ubicación confirmada. Esta pantalla no modifica el motor de entrega.</p></section>
      )}

      <section className="hub-section">
        <h2>Vigencia y estado</h2>
        <div className="hub-field">
          <label htmlFor="coupon-expires">Vence</label>
          <input id="coupon-expires" type="date" value={coupon.expiresAt ? coupon.expiresAt.slice(0, 10) : ""} onChange={(e) => setCoupon({ ...coupon, expiresAt: e.target.value ? new Date(`${e.target.value}T23:59:59Z`).toISOString() : null })} />
        </div>
        <label className="hub-delivery-toggle">
          <div><strong>{coupon.active ? "Activo" : "Pausado"}</strong><small>El cambio no se aplica hasta tocar Guardar cambios.</small></div>
          <input type="checkbox" checked={coupon.active} onChange={(e) => setCoupon({ ...coupon, active: e.target.checked })} />
        </label>
      </section>

      <section className="hub-section">
        <h2><History size={16} />Historial administrativo</h2>
        {auditLoading ? <p className="hub-field-hint">Cargando historial…</p> : auditEvents.length === 0 ? <p className="hub-field-hint">Todavía no hay cambios administrativos registrados.</p> : (
          <div className="hub-list">
            {auditEvents.map((event) => (
              <div className="hub-list-row" key={event.id}>
                <div>
                  <strong>{event.actor_email || "Administrador"}</strong>
                  <small>{new Date(event.occurred_at).toLocaleString("es-US")} · {(event.metadata?.changed_fields ?? []).map(fieldLabel).join(", ") || "Cambio administrativo"}</small>
                </div>
                <CheckCircle2 size={15} />
              </div>
            ))}
          </div>
        )}
      </section>

      {notice ? <p className="hub-field-hint" role="status">{notice}</p> : null}
    </div>
  );
}
