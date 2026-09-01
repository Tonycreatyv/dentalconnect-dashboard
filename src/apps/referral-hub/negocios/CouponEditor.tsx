import { AlertTriangle, ArrowLeft, ImageOff, MapPin, Tag } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
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

// Illustrative-only sample values for the live preview. Never confused with
// real customer data — labeled as a sample directly in the UI.
const PREVIEW_SAMPLE = { customer_first_name: "María", claim_code: "LG-A1B2" };

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
      // A malformed template is a real editing mistake worth surfacing, but
      // in plain language — never the raw exception text.
      return { text: null, error: "Revisá el mensaje: parece que falta cerrar un dato insertado." };
    }
    // Recomputed on every keystroke/chip click (customerCopy, not
    // coupon.customerCopy) so the preview updates immediately, not only
    // once the textarea loses focus and the value is persisted.
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
        <p className="hub-coupon-preview-bubble">Sin mensaje personalizado todavía — se envía el mensaje del sistema (saludo, beneficio, código y negocio).</p>
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
      {location.officialMediaUrl ? (
        <img src={location.officialMediaUrl} alt="" />
      ) : (
        <div className="hub-location-card-image-empty"><ImageOff size={16} /></div>
      )}
      <div>
        <strong>{location.displayName}</strong>
        <small>{location.addressText || `ZIP ${location.postalCode}`}</small>
      </div>
    </button>
  );
}

export default function CouponEditor() {
  const { couponId = "" } = useParams();
  const location = useLocation();
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [locations, setLocations] = useState<SupermarketLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copyDisplay, setCopyDisplay] = useState("");
  const copyTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([dataSource.getCoupon(couponId), dataSource.listBusinesses()])
      .then(([couponRow, businessRows]) => {
        setCoupon(couponRow);
        setBusinesses(businessRows);
        setCopyDisplay(couponRow ? toDisplayText(couponRow.customerCopy) : "");
        setError(couponRow ? "" : "Cupón no encontrado.");
        // The shared campaign has no single business/location — real
        // per-location data (name + official image) always comes from
        // referral_benefit_campaign_locations, fetched separately.
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
  }, [couponId]);

  const backTo = (location.state as { from?: string } | null)?.from || "/negocios?view=cupones";

  if (loading) return <div className="hub-page"><Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link><EmptyState icon={Tag} title="Cargando cupón…" /></div>;
  if (error || !coupon) return <div className="hub-page"><Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link><EmptyState tone="error" icon={AlertTriangle} title="No se pudo cargar el cupón" description={error} /></div>;

  const business = businesses.find((b) => b.id === coupon.businessId);
  const canPersist = dataSource.capabilities.canEditCoupon;
  const canEditLocationImages = dataSource.capabilities.canEditLocationImages;
  const isSupermarketCoupon = isSupermarketCampaignKey(coupon.campaignKey);
  // Real values actually shown for this coupon: for the supermarket
  // campaign that's whichever location is selected (never a single global
  // image, never a different location's data — see supermarketCoupon.ts);
  // for every other coupon it's the coupon's own fields, unchanged. This is
  // a preview-only computation — it never touches actual outbound delivery,
  // which stays entirely inside request_referral_benefit_claim/run-replies.
  const selectedLocationPreview = resolveSelectedLocationPreview(locations, selectedLocationId);
  const selectedLocation = selectedLocationPreview.location;
  const previewImageUrl = isSupermarketCoupon ? selectedLocationPreview.imageUrl : coupon.imageUrl;
  const previewBusinessName = isSupermarketCoupon ? selectedLocationPreview.businessName : (business?.name ?? "");

  async function save(patch: Partial<Coupon>) {
    setSaving(true);
    setNotice("");
    try {
      const updated = await dataSource.updateCoupon(couponId, patch);
      setCoupon(updated);
      setNotice(canPersist ? "Guardado." : "Guardado localmente en esta sesión — todavía no se guarda en el servidor.");
    } catch {
      setNotice("Esta función todavía no está disponible.");
    } finally {
      setSaving(false);
    }
  }

  async function saveLocationImage(url: string) {
    if (!selectedLocationId) return;
    setSaving(true);
    setNotice("");
    try {
      const updated = await dataSource.updateSupermarketLocation(selectedLocationId, { officialMediaUrl: url });
      setLocations((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      setNotice(canEditLocationImages ? "Guardado." : "Guardado localmente en esta sesión — todavía no se guarda en el servidor.");
    } catch {
      setNotice("Esta función todavía no está disponible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hub-page">
      <Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link>
      <PageHeader eyebrow="Cupón" title={coupon.displayName} meta={dataSource.mode === "demo" ? <DemoBadge /> : null} />
      {!canPersist ? (
        <p className="hub-blocked-note">Esta función todavía no está disponible: los cambios se guardan localmente en esta sesión mientras se habilita el guardado en el servidor.</p>
      ) : null}
      {isSupermarketCoupon ? (
        <p className="hub-field-hint">
          Este cupón no tiene una sola tienda ni una sola imagen — es un beneficio compartido por {locations.length || "varias"} ubicaciones. Elegí una abajo para ver exactamente lo que recibe un cliente de esa tienda.
        </p>
      ) : null}
      <MessagePreview
        coupon={coupon}
        customerCopy={isSupermarketCoupon ? "" : toStoredText(copyDisplay)}
        businessName={previewBusinessName}
        imageUrl={previewImageUrl}
        onOpenImage={() => setLightboxOpen(true)}
      />
      {lightboxOpen && previewImageUrl ? <ImageLightbox src={previewImageUrl} alt={previewBusinessName || coupon.displayName} onClose={() => setLightboxOpen(false)} /> : null}

      <section className="hub-section">
        <h2>Cupón</h2>
        <div className="hub-field">
          <label htmlFor="coupon-name">Nombre del cupón</label>
          <input
            id="coupon-name"
            value={coupon.displayName}
            onChange={(e) => setCoupon({ ...coupon, displayName: e.target.value })}
            onBlur={() => void save({ displayName: coupon.displayName })}
            placeholder="Ej. 20% de descuento en servicios médicos"
          />
        </div>
        {!isSupermarketCoupon ? (
          <div className="hub-field">
            <label htmlFor="coupon-business">Negocio asociado</label>
            <select id="coupon-business" value={coupon.businessId} onChange={(e) => void save({ businessId: e.target.value })}>
              <option value="">Sin asignar</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        ) : null}
      </section>

      {isSupermarketCoupon ? (
        <section className="hub-section">
          <h2><MapPin size={16} />Ubicaciones participantes</h2>
          {locations.length === 0 ? (
            <EmptyState icon={MapPin} title="Sin ubicaciones activas" description="No hay supermercados activos configurados para este beneficio." />
          ) : (
            <>
              <div className="hub-location-grid">
                {locations.map((loc) => (
                  <LocationCard key={loc.id} location={loc} selected={loc.id === selectedLocationId} onSelect={() => setSelectedLocationId(loc.id)} />
                ))}
              </div>
              {selectedLocation ? (
                <div className="hub-location-editor">
                  <p className="hub-field-hint">
                    Estás editando la imagen de <strong>{selectedLocation.displayName}</strong> únicamente — no afecta a las otras ubicaciones ni al cupón compartido.
                  </p>
                  {!canEditLocationImages ? (
                    <p className="hub-blocked-note">Esta función todavía no está disponible: la imagen se guarda localmente en esta sesión mientras se habilita el guardado en el servidor.</p>
                  ) : null}
                  <StorageUploadField onLocalPreview={() => { /* local-only demo preview, never saved as the real image */ }} />
                  <div className="hub-field">
                    <label htmlFor="location-image">O pegá el enlace de la imagen de esta ubicación</label>
                    <input
                      id="location-image"
                      value={selectedLocation.officialMediaUrl}
                      onChange={(e) => setLocations((rows) => rows.map((r) => (r.id === selectedLocationId ? { ...r, officialMediaUrl: e.target.value } : r)))}
                      onBlur={() => void saveLocationImage(selectedLocation.officialMediaUrl)}
                      placeholder="https://…"
                    />
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : (
        <section className="hub-section">
          <h2>Imagen del cupón</h2>
          <StorageUploadField onLocalPreview={() => { /* local-only demo preview, never saved as the real coupon image */ }} />
          <div className="hub-field">
            <label htmlFor="coupon-image">O pegá el enlace de una imagen</label>
            <input
              id="coupon-image"
              value={coupon.imageUrl}
              onChange={(e) => setCoupon({ ...coupon, imageUrl: e.target.value })}
              onBlur={() => void save({ imageUrl: coupon.imageUrl })}
              placeholder="https://…"
            />
          </div>
        </section>
      )}

      {!isSupermarketCoupon ? (
        <section className="hub-section">
          <h2>Mensaje de WhatsApp</h2>
          <TokenToolbar
            textareaRef={copyTextareaRef}
            value={copyDisplay}
            onChange={setCopyDisplay}
          />
          <div className="hub-field">
            <label htmlFor="coupon-copy">Mensaje completo</label>
            <textarea
              id="coupon-copy"
              ref={copyTextareaRef}
              className="hub-textarea"
              value={copyDisplay}
              onChange={(e) => setCopyDisplay(e.target.value)}
              onBlur={() => void save({ customerCopy: toStoredText(copyDisplay) })}
              placeholder="Dejalo vacío para usar el mensaje del sistema, o escribí el tuyo usando los datos de arriba."
            />
          </div>
          <div className="hub-field">
            <label htmlFor="coupon-terms">Condiciones (opcional)</label>
            <textarea
              id="coupon-terms"
              className="hub-textarea"
              style={{ minHeight: 70 }}
              value={coupon.termsText}
              onChange={(e) => setCoupon({ ...coupon, termsText: e.target.value })}
              onBlur={() => void save({ termsText: coupon.termsText })}
            />
          </div>
          {copyDisplay.trim() ? (
            <label className="hub-delivery-toggle">
              <div><strong>Usar mi mensaje personalizado</strong><small>Si lo desactivás, se envía el mensaje del sistema aunque hayas escrito uno propio</small></div>
              <input
                type="checkbox"
                checked={coupon.deliverySource === "db"}
                onChange={(e) => void save({ deliverySource: e.target.checked ? "db" : "legacy" })}
              />
            </label>
          ) : null}
        </section>
      ) : (
        <section className="hub-section">
          <h2>Mensaje de WhatsApp</h2>
          <p className="hub-field-hint">Este beneficio usa el mensaje estándar del sistema con el nombre real de la tienda confirmada — todavía no se puede personalizar por separado.</p>
        </section>
      )}

      <section className="hub-section">
        <h2>Vigencia y estado</h2>
        <div className="hub-field">
          <label htmlFor="coupon-expires">Vence</label>
          <input
            id="coupon-expires"
            type="date"
            value={coupon.expiresAt ? coupon.expiresAt.slice(0, 10) : ""}
            onChange={(e) => void save({ expiresAt: e.target.value ? new Date(`${e.target.value}T23:59:59Z`).toISOString() : null })}
          />
        </div>
        <label className="hub-delivery-toggle">
          <div><strong>Activo</strong><small>Un cupón pausado no se entrega a los clientes</small></div>
          <input type="checkbox" checked={coupon.active} onChange={(e) => void save({ active: e.target.checked })} />
        </label>
      </section>

      {saving ? <p className="hub-field-hint">Guardando…</p> : notice ? <p className="hub-field-hint" role="status">{notice}</p> : null}
    </div>
  );
}
