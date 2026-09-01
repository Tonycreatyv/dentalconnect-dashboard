import { AlertTriangle, ArrowLeft, Building2, Pencil, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { SERVICE_LABELS, type LuisServiceId } from "../operations/luisCatalog";
import DemoBadge from "./DemoBadge";
import { getActiveNegociosDataSource } from "./dataSource";
import { resolveBusinessImageUrl } from "./businessImage";
import ImageLightbox from "./ImageLightbox";
import BusinessEditDrawer from "./BusinessEditDrawer";
import type { Business, BusinessHours, Coupon } from "./types";

const dataSource = getActiveNegociosDataSource();

const DAY_LABELS: Array<{ id: keyof BusinessHours; label: string }> = [
  { id: "mon", label: "Lun" },
  { id: "tue", label: "Mar" },
  { id: "wed", label: "Mié" },
  { id: "thu", label: "Jue" },
  { id: "fri", label: "Vie" },
  { id: "sat", label: "Sáb" },
  { id: "sun", label: "Dom" },
];

export default function BusinessDetail() {
  const { businessId = "" } = useParams();
  const location = useLocation();
  const [business, setBusiness] = useState<Business | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([dataSource.getBusiness(businessId), dataSource.listCoupons()])
      .then(([businessRow, allCoupons]) => {
        setBusiness(businessRow);
        // Supermarket locations share ONE coupon campaign (no single
        // business_id — see realDataSource.ts) — matched by category
        // instead of a direct id, so each real location still shows it.
        setCoupons(allCoupons.filter((c) => c.businessId === businessId
          || (businessRow?.categoryServiceId === "luis_benefit_supermarket" && c.campaignKey.includes("supermarket"))));
        setError(businessRow ? "" : "Negocio no encontrado.");
      })
      .catch((reason) => setError(String((reason as Error)?.message || reason)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [businessId]);

  const heroImage = useMemo(() => (business ? resolveBusinessImageUrl(business, coupons) : null), [business, coupons]);
  const backTo = (location.state as { from?: string } | null)?.from || "/negocios";

  if (loading) return <div className="hub-page"><Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link><EmptyState icon={Building2} title="Cargando negocio…" /></div>;
  if (error || !business) return <div className="hub-page"><Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link><EmptyState tone="error" icon={AlertTriangle} title="No se pudo cargar el negocio" description={error} /></div>;

  return (
    <div className="hub-page">
      <Link className="hub-back" to={backTo}><ArrowLeft />Volver</Link>
      <PageHeader
        eyebrow={SERVICE_LABELS[business.categoryServiceId as LuisServiceId] || business.categoryLabel}
        title={business.name}
        meta={dataSource.mode === "demo" ? <DemoBadge /> : null}
      />
      {heroImage ? (
        <button type="button" className="hub-hero-image-btn" onClick={() => setLightboxOpen(true)} aria-label="Ver imagen completa">
          <img className="hub-hero-image" src={heroImage} alt={business.name} />
        </button>
      ) : (
        <div className="hub-hero-image-empty"><Building2 size={22} /><span>Sin imagen todavía</span></div>
      )}
      {lightboxOpen && heroImage ? <ImageLightbox src={heroImage} alt={business.name} onClose={() => setLightboxOpen(false)} /> : null}
      <button type="button" className="hub-secondary" onClick={() => setEditing(true)}><Pencil size={15} />Editar negocio</button>
      <dl className="hub-facts">
        <div><dt>Categoría</dt><dd>{SERVICE_LABELS[business.categoryServiceId as LuisServiceId] || business.categoryLabel}</dd></div>
        <div><dt>Contacto</dt><dd>{business.contactName || "Pendiente"}</dd></div>
        <div><dt>Teléfono</dt><dd>{business.phone || "Pendiente"}</dd></div>
        <div><dt>Dirección</dt><dd>{business.addressText || "Pendiente"}</dd></div>
        <div><dt>Código postal</dt><dd>{business.postalCode || "Pendiente"}</dd></div>
        <div><dt>Estado</dt><dd>{business.active ? "Activo" : "Pausado"}</dd></div>
        <div><dt>Ofrece cupones</dt><dd>{business.offersCoupon ? "Sí" : "No"}</dd></div>
        <div><dt>Recibe consultas</dt><dd>{business.receivesServiceRequests ? "Sí" : "No"}</dd></div>
        {business.offersCoupon ? <div><dt>Cupones pedidos</dt><dd>{business.requestCount}</dd></div> : null}
      </dl>
      {Object.keys(business.hours).length > 0 ? (
        <section className="hub-section">
          <h2>Horarios</h2>
          <dl className="hub-facts">
            {DAY_LABELS.filter((day) => business.hours[day.id]).map((day) => (
              <div key={day.id}><dt>{day.label}</dt><dd>{business.hours[day.id]!.open} – {business.hours[day.id]!.close}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}
      {business.faqs.length > 0 ? (
        <section className="hub-section">
          <h2>Preguntas frecuentes</h2>
          <div className="hub-list">
            {business.faqs.map((faq, index) => (
              <div key={index} className="hub-list-row"><div><strong>{faq.question}</strong><small>{faq.answer}</small></div></div>
            ))}
          </div>
        </section>
      ) : null}
      {/* period=all: this card's Cupones pedidos count above is all-time
          (realDataSource.ts never filters claims by date), so the
          drill-down must open at the same all-time scope — a bare link
          here would silently land on CouponRequestsScreen's "today"
          default and could show 0 while this card truthfully shows a
          higher all-time number for the exact same claims. */}
      {business.categoryServiceId === "luis_benefit_supermarket" && business.id.startsWith("location:") ? (
        <Link className="hub-secondary" to={`/negocios/solicitudes?period=all&location=${business.id.slice("location:".length)}`} state={{ from: `/negocios/negocio/${business.id}` }}>
          Ver cupones pedidos de esta ubicación
        </Link>
      ) : business.offersCoupon ? (
        <Link className="hub-secondary" to={`/negocios/solicitudes?period=all&service=${business.categoryServiceId}`} state={{ from: `/negocios/negocio/${business.id}` }}>
          Ver cupones pedidos de este negocio
        </Link>
      ) : null}
      {business.offersCoupon ? (
        <section className="hub-section">
          <h2>Cupones de este negocio</h2>
          {coupons.length === 0 ? (
            <EmptyState icon={Tag} title="Sin cupón vinculado todavía" description="Vinculalo desde Cupones eligiendo este negocio en el editor." />
          ) : (
            <div className="hub-list">
              {coupons.map((coupon) => (
                <Link key={coupon.id} className="hub-list-row" to={`/negocios/cupon/${coupon.id}`} state={{ from: `/negocios/negocio/${business.id}` }}>
                  <div><strong>{coupon.displayName}</strong><small>{coupon.active ? "Activo" : "Pausado"}</small></div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}
      {editing ? (
        <BusinessEditDrawer
          business={business}
          // canEditBusiness is only true for a business backed by a real
          // referral_partners row (id "partner:...") — the hardcoded
          // merchant/location businesses have no row to persist to yet,
          // so they stay honestly local-only even though the capability
          // flag itself is true (see realDataSource.ts).
          canPersist={dataSource.capabilities.canEditBusiness && business.id.startsWith("partner:")}
          onClose={() => setEditing(false)}
          onSave={async (patch) => { await dataSource.updateBusiness(business.id, patch); setEditing(false); load(); }}
        />
      ) : null}
    </div>
  );
}
