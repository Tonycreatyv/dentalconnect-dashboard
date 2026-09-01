import { Activity, AlertTriangle, ArrowLeft, ChevronRight, MapPin, Package, Store, Tag } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useReferralOrders } from "../../../referral/useReferralOrders";
import { REFERRAL_ORDER_STATUS_LABELS } from "../../../referral/orders";
import { groceryLocations } from "../operations/referralDataMapping";
import { useOperationalPilot } from "../operations/useOperationalPilot";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { SkeletonRows } from "../ui/Skeleton";

const money = (cents: unknown, currency = "USD") => new Intl.NumberFormat("es-US", { style: "currency", currency }).format(Number(cents ?? 0) / 100);
const couponImage = (serviceId: unknown) => String(serviceId).includes("cupon_super") ? "/images/coupons/lg-supermarket-coupon.jpeg" : String(serviceId).includes("cupon_medico") ? "/images/coupons/lg-medical-coupon.jpeg" : "/images/coupons/lg-dental-coupon.jpeg";
const couponType = (serviceId: unknown) => String(serviceId).includes("cupon_super") ? "Cupón de supermercado" : String(serviceId).includes("cupon_medico") ? "Cupón médico" : "Cupón dental";
const humanize = (value: unknown) => String(value ?? "").replace(/_/g, " ").replace(/^./, (letter: string) => letter.toUpperCase());
const basketType = (value: unknown) => humanize(value) || "Canasta";
function contentRows(value: unknown): Array<{ label: string; detail?: string }> {
  const source = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { items?: unknown[] }).items) ? (value as { items: unknown[] }).items : value ? [value] : [];
  return source.map((item, index) => {
    if (typeof item === "string" || typeof item === "number") return { label: String(item) };
    if (!item || typeof item !== "object") return { label: `Artículo ${index + 1}` };
    const row = item as Record<string, unknown>;
    const label = String(row.name ?? row.nombre ?? row.label ?? row.product ?? row.item ?? `Artículo ${index + 1}`);
    const quantity = row.quantity ?? row.qty ?? row.cantidad;
    const unit = row.unit ?? row.unidad;
    return { label, detail: [quantity, unit].filter((part) => part !== undefined && part !== null && part !== "").join(" ") || undefined };
  });
}
function termRows(value: unknown): Array<{ label: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== null && entry !== undefined && typeof entry !== "object").map(([key, entry]) => {
    const labels: Record<string, string> = { discount_amount: "Descuento", discount_percent: "Descuento", minimum_purchase: "Compra mínima", promotional_price: "Precio promocional", valid_days: "Días de vigencia" };
    const suffix = key.includes("percent") ? "%" : "";
    return { label: labels[key] ?? humanize(key), value: `${String(entry)}${suffix}` };
  });
}

export function CatalogScreen() {
  return (
    <div className="hub-page">
      <PageHeader eyebrow="Negocios" title="Tiendas y catálogo" subtitle="Administración de ubicaciones y ofertas" />
      <div className="hub-list">
        <Link className="hub-list-row" to="/network/stores"><Store size={18} /><div><strong>Supermercados</strong><small>Ubicaciones y operación</small></div><ChevronRight size={16} /></Link>
        <Link className="hub-list-row" to="/baskets"><Package size={18} /><div><strong>Canastas</strong><small>Precios y contenido por ubicación</small></div><ChevronRight size={16} /></Link>
        <Link className="hub-list-row" to="/coupons"><Tag size={18} /><div><strong>Cupones</strong><small>Definiciones, campañas y entregas</small></div><ChevronRight size={16} /></Link>
        <Link className="hub-list-row" to="/coverage"><MapPin size={18} /><div><strong>Cobertura</strong><small>Zonas ZIP por supermercado</small></div><ChevronRight size={16} /></Link>
      </div>
    </div>
  );
}

export function BasketsScreen() {
  const data = useOperationalPilot();
  const stores = groceryLocations(data.partners, data.locations, data.rules, data.offers);
  const failed = ["partners", "locations", "rules", "offers"].some((key) => data.queryErrors[key]);
  return (
    <div className="hub-page">
      <Link className="hub-back" to="/catalog"><ArrowLeft />Volver</Link>
      <PageHeader eyebrow="Canastas" title="Canastas" subtitle="Selecciona un supermercado" />
      {data.loading ? <SkeletonRows count={4} /> : failed ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar las canastas" />
      ) : stores.length === 0 ? (
        <EmptyState icon={Store} title="No hay supermercados disponibles" />
      ) : (
        <div className="hub-list">
          {stores.map((location) => {
            const id = String(location.id);
            const count = data.offers.filter((x) => x.partner_location_id === id && x.active).length;
            return <Link key={id} className="hub-list-row" to={`/baskets/${id}`}><div><strong>{String(location.name)}</strong><small>{count} canastas activas</small></div><ChevronRight size={16} /></Link>;
          })}
        </div>
      )}
    </div>
  );
}
export function BasketLocationScreen() {
  const { locationId = "" } = useParams();
  const data = useOperationalPilot();
  const location = data.locations.find((x) => x.id === locationId);
  const offers = data.offers.filter((x) => x.partner_location_id === locationId);
  return (
    <div className="hub-page">
      <Link className="hub-back" to={`/network/stores/${locationId}`}><ArrowLeft />Volver</Link>
      <PageHeader eyebrow="Canastas" title={location?.name || "Canastas"} subtitle="Ofertas de esta ubicación" />
      {data.loading ? <SkeletonRows count={4} /> : data.queryErrors.offers ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudieron cargar las canastas" />
      ) : offers.length === 0 ? (
        <EmptyState icon={Package} title="No hay canastas configuradas" />
      ) : (
        <div className="hub-list">
          {offers.map((offer) => (
            <Link key={offer.id} className="hub-list-row" to={`/baskets/${locationId}/${offer.id}`}>
              <div><strong>{offer.display_name}</strong><small>{basketType(offer.basket_key)} · {offer.active ? "Activa" : "Inactiva"}</small></div>
              <span className="hub-list-price">{money(offer.price_cents, offer.currency)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
export function BasketOfferScreen() {
  const { locationId = "", offerId = "" } = useParams();
  const data = useOperationalPilot();
  const location = data.locations.find((x) => x.id === locationId);
  const offer = data.offers.find((x) => x.id === offerId && x.partner_location_id === locationId);
  if (data.loading) return <div className="hub-page"><Link className="hub-back" to={`/baskets/${locationId}`}><ArrowLeft />Volver</Link><EmptyState icon={Package} title="Cargando canasta…" /></div>;
  if (!offer) return <div className="hub-page"><Link className="hub-back" to={`/baskets/${locationId}`}><ArrowLeft />Volver</Link><EmptyState icon={Package} title="Canasta no encontrada" description="La oferta no existe en esta ubicación." /></div>;
  const contents = contentRows(offer.contents_snapshot);
  return (
    <div className="hub-page">
      <Link className="hub-back" to={`/baskets/${locationId}`}><ArrowLeft />Volver</Link>
      <PageHeader eyebrow={location?.name || "Ubicación"} title={offer.display_name} />
      <dl className="hub-facts">
        <div><dt>Tipo</dt><dd>{basketType(offer.basket_key)}</dd></div>
        <div><dt>Precio actual</dt><dd>{money(offer.price_cents, offer.currency)}</dd></div>
        <div><dt>Estado</dt><dd>{offer.active ? "Activa" : "Inactiva"}</dd></div>
        <div><dt>Ubicación</dt><dd>{location?.name || "No disponible"}</dd></div>
      </dl>
      <section className="hub-section">
        <h2>Contenido</h2>
        {contents.length ? (
          <div className="hub-list">{contents.map((item, index) => <div key={`${item.label}-${index}`} className="hub-list-row"><div><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</div></div>)}</div>
        ) : <EmptyState icon={Package} title="No configurado" />}
      </section>
      <p className="hub-blocked-note"><Package size={16} />Solo lectura. Los cambios de precio y contenido todavía no están habilitados para esta cuenta.</p>
    </div>
  );
}

export function CouponDetailScreen() {
  const { couponId = "" } = useParams();
  const data = useOperationalPilot();
  const campaign = data.campaigns.find((x) => x.id === couponId);
  if (data.loading) return <div className="hub-page"><Link className="hub-back" to="/campanas"><ArrowLeft />Volver</Link><EmptyState icon={Tag} title="Cargando cupón…" /></div>;
  if (!campaign) return <div className="hub-page"><Link className="hub-back" to="/campanas"><ArrowLeft />Volver</Link><EmptyState icon={Tag} title="Cupón no encontrado" description="No existe esta definición." /></div>;
  const deliveries = data.couponDeliveries.filter((x) => x.campaign_key === campaign.campaign_key);
  const terms = termRows(campaign.offer_terms);
  return (
    <div className="hub-page">
      <Link className="hub-back" to="/campanas"><ArrowLeft />Volver</Link>
      <div className="hub-detail-hero">
        <img src={couponImage(campaign.service_id)} alt={`Imagen configurada para ${couponType(campaign.service_id)}`} />
      </div>
      <h1 className="hub-detail-title">{campaign.display_name || couponType(campaign.service_id)}</h1>
      <p className="hub-detail-sub">{couponType(campaign.service_id)}</p>
      <dl className="hub-facts">
        <div><dt>Estado</dt><dd>{campaign.active ? "Activa" : "Inactiva"}</dd></div>
        <div><dt>Aplicación</dt><dd>{String(campaign.service_id).includes("cupon_super") ? "Supermercados participantes" : "Servicio asociado"}</dd></div>
        <div><dt>Entregas preparadas</dt><dd>{deliveries.length}</dd></div>
        <div><dt>Entregas confirmadas</dt><dd>{deliveries.filter((x) => x.delivered_at).length}</dd></div>
      </dl>
      <section className="hub-section">
        <h2>Términos</h2>
        {terms.length ? <dl className="hub-facts">{terms.map((term) => <div key={term.label}><dt>{term.label}</dt><dd>{term.value}</dd></div>)}</dl> : <EmptyState icon={Tag} title="No hay términos adicionales configurados" />}
      </section>
      <p className="hub-blocked-note"><Tag size={16} />Solo lectura. La edición de la imagen y el estado no está habilitada para esta cuenta.</p>
    </div>
  );
}

function StoreTabs({ locationId, active }: { locationId: string; active: string }) {
  const base = `/network/stores/${locationId}`;
  const tabs: [string, string, string][] = [["summary", "Resumen", base], ["baskets", "Canastas", `${base}/baskets`], ["coupons", "Cupones", `${base}/coupons`], ["coverage", "Cobertura", `${base}/coverage`], ["activity", "Actividad", `${base}/activity`]];
  return (
    <nav className="hub-tabs" aria-label="Espacio de supermercado">
      {tabs.map(([id, label, to]) => <Link key={id} className="hub-tab" aria-current={active === id ? "page" : undefined} to={to}>{label}</Link>)}
    </nav>
  );
}
export function StoreWorkspaceScreen({ section = "summary" }: { section?: "summary" | "baskets" | "coupons" | "coverage" | "activity" }) {
  const { locationId = "" } = useParams();
  const data = useOperationalPilot();
  const orders = useReferralOrders();
  const location = data.locations.find((x) => x.id === locationId);
  if (data.loading) return <div className="hub-page"><Link className="hub-back" to="/network/stores"><ArrowLeft />Volver</Link><EmptyState icon={Store} title="Cargando supermercado…" /></div>;
  if (!location) return <div className="hub-page"><Link className="hub-back" to="/network/stores"><ArrowLeft />Volver</Link><EmptyState icon={Store} title="Supermercado no encontrado" description="La ubicación no existe." /></div>;
  const offers = data.offers.filter((x) => x.partner_location_id === locationId);
  const coverage = data.deliveryCoverage.filter((x) => x.partner_location_id === locationId);
  const locationOrders = orders.orders.filter((x) => x.partner_location_name_snapshot === location.name);
  const supermarketCoupons = data.campaigns.filter((x) => String(x.service_id).includes("cupon_super"));
  return (
    <div className="hub-page">
      <Link className="hub-back" to="/network/stores"><ArrowLeft />Volver</Link>
      <PageHeader eyebrow="Supermercado" title={location.name} subtitle={location.formatted_address || "Dirección no configurada"} />
      <StoreTabs locationId={locationId} active={section} />
      {section === "summary" ? (
        <dl className="hub-facts">
          <div><dt>Entrega</dt><dd>{location.delivery_enabled ? "Habilitada" : "Deshabilitada"}</dd></div>
          <div><dt>Canastas activas</dt><dd>{offers.filter((x) => x.active).length}</dd></div>
          <div><dt>Cobertura</dt><dd>{coverage.filter((x) => x.active).length} zonas</dd></div>
          <div><dt>Coordenadas</dt><dd>{Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude)) ? "Verificadas" : "Pendiente"}</dd></div>
        </dl>
      ) : section === "baskets" ? (
        offers.length ? (
          <div className="hub-list">{offers.map((offer) => <Link key={offer.id} className="hub-list-row" to={`/baskets/${locationId}/${offer.id}`}><div><strong>{offer.display_name}</strong><small>{money(offer.price_cents, offer.currency)}</small></div><ChevronRight size={16} /></Link>)}</div>
        ) : <EmptyState icon={Package} title="No hay canastas configuradas" />
      ) : section === "coupons" ? (
        supermarketCoupons.length ? (
          <div className="hub-list">{supermarketCoupons.map((campaign) => <Link key={campaign.id} className="hub-list-row" to={`/coupons/${campaign.id}`}><div><strong>{campaign.display_name}</strong><small>Campaña de supermercado</small></div><ChevronRight size={16} /></Link>)}</div>
        ) : <EmptyState icon={Tag} title="No hay cupones configurados" />
      ) : section === "coverage" ? (
        coverage.length ? (
          <div className="hub-list">{coverage.map((rule) => <div key={rule.id} className="hub-list-row"><div><strong>{rule.postal_code}</strong><small>{rule.active ? "Activa" : "Inactiva"}</small></div></div>)}</div>
        ) : <EmptyState icon={MapPin} title="No hay zonas de cobertura configuradas" />
      ) : orders.loading ? <SkeletonRows count={3} /> : orders.error ? (
        <EmptyState tone="error" icon={AlertTriangle} title="No se pudo cargar la actividad" description={orders.error} />
      ) : locationOrders.length ? (
        <div className="hub-list">{locationOrders.map((order) => <Link key={order.id} className="hub-list-row" to={`/orders/${order.id}`}><div><strong>{order.order_code}</strong><small>{order.customer_name} · {REFERRAL_ORDER_STATUS_LABELS[order.status]}</small></div><ChevronRight size={16} /></Link>)}</div>
      ) : <EmptyState icon={Activity} title="No hay actividad registrada para esta ubicación" />}
    </div>
  );
}
